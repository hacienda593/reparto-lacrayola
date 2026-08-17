-- migration_sec05_invitacion.sql
-- SEC-05 de la auditoría: AuthContext vinculaba (y otorgaba rol
-- 'repartidor' automáticamente) a CUALQUIER cuenta cuyo email coincidiera
-- con un rep_repartidores sin user_id todavía -- sin verificar que esa
-- cuenta realmente perteneciera a la persona correcta. Riesgo real: si un
-- admin da de alta a alguien con su email antes de que esa persona haya
-- creado su cuenta, cualquiera que se registre primero con ese mismo
-- correo (typo del admin, correo adivinado) queda vinculado y hereda el
-- acceso operativo completo, sin ninguna verificación adicional.
--
-- Reemplazo: invitación de un solo uso. El admin genera un token al dar
-- de alta a alguien; la vinculación de user_id solo ocurre al canjear ESE
-- token exacto, nunca por coincidencia de email.

ALTER TABLE public.rep_repartidores ADD COLUMN IF NOT EXISTS invite_token TEXT;
ALTER TABLE public.rep_repartidores ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_repartidores_invite_token ON public.rep_repartidores(invite_token) WHERE invite_token IS NOT NULL;

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
  -- Si esta cuenta ya está vinculada a OTRO perfil, no permitir que
  -- también se quede con este (una persona, un perfil).
  IF EXISTS (SELECT 1 FROM rep_repartidores WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Esta cuenta ya está vinculada a otro perfil';
  END IF;

  UPDATE rep_repartidores
  SET user_id = auth.uid(), invite_token = NULL, invite_expires_at = NULL
  WHERE id = v_rep.id;

  IF v_rep.estado_registro = 'aprobado' AND v_rep.activo THEN
    INSERT INTO rep_roles(user_id, rol, activo) VALUES (auth.uid(), 'repartidor', true)
    ON CONFLICT (user_id) DO UPDATE SET rol = 'repartidor', activo = true;
    RETURN QUERY SELECT v_rep.id, v_rep.nombre, 'repartidor'::TEXT;
  ELSE
    RETURN QUERY SELECT v_rep.id, v_rep.nombre, NULL::TEXT;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reclamar_invitacion FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reclamar_invitacion TO authenticated;
