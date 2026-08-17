-- migration_trazabilidad_cuentas.sql
-- Vacío de trazabilidad de la auditoría: "cambios de usuario, rol, estado,
-- comisión o fondo" no tenían garantía de evento. rep_pedido_eventos exige
-- pedido_id (no aplica a acciones sobre una CUENTA, no un pedido), así que
-- se crea un registro paralelo append-only para esto -- mismo espíritu que
-- rep_conciliacion_eventos, pero para cuentas de colaboradores.
--
-- Se agrega el logueo a las funciones de esta sesión que quedaron sin
-- ningún rastro: bloqueo/desbloqueo manual y generación/canje de
-- invitación.

CREATE TABLE IF NOT EXISTS public.rep_auditoria_cuenta (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repartidor_id UUID NOT NULL REFERENCES public.rep_repartidores(id),
  accion        TEXT NOT NULL,
  motivo        TEXT,
  datos         JSONB DEFAULT '{}'::jsonb,
  actor         UUID DEFAULT auth.uid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rep_auditoria_cuenta_rep ON public.rep_auditoria_cuenta(repartidor_id, created_at DESC);
ALTER TABLE public.rep_auditoria_cuenta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rep_auditoria_cuenta_select ON public.rep_auditoria_cuenta;
CREATE POLICY rep_auditoria_cuenta_select ON public.rep_auditoria_cuenta FOR SELECT USING (rep_is_admin());

CREATE OR REPLACE FUNCTION public.bloquear_repartidor_admin(p_repartidor_id UUID, p_motivo TEXT)
RETURNS public.rep_repartidores
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result rep_repartidores;
BEGIN
  IF NOT rep_is_admin() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  IF NULLIF(TRIM(p_motivo),'') IS NULL THEN RAISE EXCEPTION 'Debe indicar el motivo del bloqueo'; END IF;
  UPDATE rep_repartidores
  SET estado='BLOQUEADO', motivo_bloqueo=TRIM(p_motivo), bloqueado_por=auth.uid(), bloqueado_at=NOW()
  WHERE id=p_repartidor_id
  RETURNING * INTO v_result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Repartidor no encontrado'; END IF;
  INSERT INTO rep_auditoria_cuenta(repartidor_id, accion, motivo) VALUES (p_repartidor_id, 'bloqueo_manual', TRIM(p_motivo));
  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bloquear_repartidor_admin FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bloquear_repartidor_admin TO authenticated;

CREATE OR REPLACE FUNCTION public.desbloquear_repartidor_admin(p_repartidor_id UUID, p_motivo TEXT)
RETURNS public.rep_repartidores
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result rep_repartidores; v_actual rep_repartidores;
BEGIN
  IF NOT rep_is_admin() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  IF NULLIF(TRIM(p_motivo),'') IS NULL THEN RAISE EXCEPTION 'Debe indicar el motivo del desbloqueo'; END IF;
  SELECT * INTO v_actual FROM rep_repartidores WHERE id=p_repartidor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Repartidor no encontrado'; END IF;
  IF v_actual.estado <> 'BLOQUEADO' THEN RAISE EXCEPTION 'Este repartidor no está bloqueado'; END IF;
  IF COALESCE(v_actual.motivo_bloqueo,'exceso_efectivo') = 'exceso_efectivo' AND v_actual.efectivo_en_mano >= 40.00 THEN
    RAISE EXCEPTION 'No se puede desbloquear: todavía tiene $% en mano (límite $40)', v_actual.efectivo_en_mano;
  END IF;
  UPDATE rep_repartidores
  SET estado='ACTIVO', motivo_bloqueo=NULL, bloqueado_por=NULL, bloqueado_at=NULL
  WHERE id=p_repartidor_id
  RETURNING * INTO v_result;
  INSERT INTO rep_auditoria_cuenta(repartidor_id, accion, motivo) VALUES (p_repartidor_id, 'desbloqueo_manual', TRIM(p_motivo));
  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.desbloquear_repartidor_admin FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desbloquear_repartidor_admin TO authenticated;

CREATE OR REPLACE FUNCTION public.generar_invitacion_repartidor(p_repartidor_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_token TEXT; v_ya_vinculado UUID;
BEGIN
  IF NOT rep_is_admin() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  SELECT user_id INTO v_ya_vinculado FROM rep_repartidores WHERE id = p_repartidor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Repartidor no encontrado'; END IF;
  IF v_ya_vinculado IS NOT NULL THEN RAISE EXCEPTION 'Este perfil ya tiene una cuenta vinculada'; END IF;

  v_token := encode(gen_random_bytes(24), 'hex');
  UPDATE rep_repartidores SET invite_token = v_token, invite_expires_at = NOW() + INTERVAL '14 days'
  WHERE id = p_repartidor_id;
  INSERT INTO rep_auditoria_cuenta(repartidor_id, accion) VALUES (p_repartidor_id, 'invitacion_generada');
  RETURN v_token;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.generar_invitacion_repartidor FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generar_invitacion_repartidor TO authenticated;

CREATE OR REPLACE FUNCTION public.reclamar_invitacion(p_token TEXT)
RETURNS TABLE(repartidor_id UUID, nombre TEXT, rol_otorgado TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rep rep_repartidores;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF NULLIF(TRIM(p_token), '') IS NULL THEN RAISE EXCEPTION 'Falta el código de invitación'; END IF;

  SELECT * INTO v_rep FROM rep_repartidores WHERE invite_token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitación no encontrada o ya usada'; END IF;
  IF v_rep.user_id IS NOT NULL THEN RAISE EXCEPTION 'Este perfil ya tiene una cuenta vinculada'; END IF;
  IF v_rep.invite_expires_at IS NULL OR v_rep.invite_expires_at < NOW() THEN
    RAISE EXCEPTION 'La invitación venció -- pide al administrador que genere una nueva';
  END IF;
  IF EXISTS (SELECT 1 FROM rep_repartidores WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Esta cuenta ya está vinculada a otro perfil';
  END IF;

  UPDATE rep_repartidores
  SET user_id = auth.uid(), invite_token = NULL, invite_expires_at = NULL
  WHERE id = v_rep.id;

  IF v_rep.estado_registro = 'aprobado' AND v_rep.activo THEN
    INSERT INTO rep_roles(user_id, rol, activo) VALUES (auth.uid(), 'repartidor', true)
    ON CONFLICT (user_id) DO UPDATE SET rol = 'repartidor', activo = true;
    INSERT INTO rep_auditoria_cuenta(repartidor_id, accion, datos) VALUES (v_rep.id, 'invitacion_canjeada', jsonb_build_object('rol_otorgado','repartidor'));
    RETURN QUERY SELECT v_rep.id, v_rep.nombre, 'repartidor'::TEXT;
  ELSE
    INSERT INTO rep_auditoria_cuenta(repartidor_id, accion) VALUES (v_rep.id, 'invitacion_canjeada');
    RETURN QUERY SELECT v_rep.id, v_rep.nombre, NULL::TEXT;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reclamar_invitacion FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reclamar_invitacion TO authenticated;
