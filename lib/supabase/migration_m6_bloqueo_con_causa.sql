-- migration_m6_bloqueo_con_causa.sql
-- M6 de la auditoría financiera: el trigger de bloqueo automático
-- reactivaba a CUALQUIER repartidor bloqueado en cuanto su efectivo bajaba
-- de $40, sin distinguir si el bloqueo fue automático (exceso de
-- efectivo) o manual (ej. sospecha de fraude, suspensión disciplinaria).
-- Un bloqueo manual podía desaparecer solo con el siguiente movimiento de
-- caja, sin que nadie lo decidiera.
--
-- Tampoco existía ningún control manual de bloqueo/desbloqueo para
-- admin -- se agrega acá también, ya que sin eso el motivo_bloqueo nunca
-- se usaría en la práctica.

ALTER TABLE public.rep_repartidores ADD COLUMN IF NOT EXISTS motivo_bloqueo TEXT;
ALTER TABLE public.rep_repartidores ADD COLUMN IF NOT EXISTS bloqueado_por UUID;
ALTER TABLE public.rep_repartidores ADD COLUMN IF NOT EXISTS bloqueado_at TIMESTAMPTZ;
COMMENT ON COLUMN public.rep_repartidores.motivo_bloqueo IS
  'Por qué está BLOQUEADO: "exceso_efectivo" (automático, el trigger lo reactiva solo al bajar de $40) o cualquier otro texto = bloqueo manual de admin, que NO se reactiva solo.';

CREATE OR REPLACE FUNCTION trg_evaluar_bloqueo_repartidor()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.efectivo_en_mano >= 40.00 THEN
    -- Si ya estaba bloqueado por otra causa (manual), no se pisa el motivo.
    IF NEW.estado <> 'BLOQUEADO' THEN
      NEW.estado := 'BLOQUEADO';
      NEW.motivo_bloqueo := 'exceso_efectivo';
      NEW.bloqueado_at := NOW();
    END IF;
  -- Solo se reactiva SOLO si el bloqueo actual es el automático de exceso
  -- de efectivo -- un bloqueo manual (motivo_bloqueo distinto) requiere
  -- que un admin lo desbloquee explícitamente con desbloquear_repartidor_admin.
  ELSIF NEW.efectivo_en_mano < 40.00 AND OLD.estado = 'BLOQUEADO' AND COALESCE(OLD.motivo_bloqueo,'exceso_efectivo') = 'exceso_efectivo' THEN
    NEW.estado := 'ACTIVO';
    NEW.motivo_bloqueo := NULL;
    NEW.bloqueado_por := NULL;
    NEW.bloqueado_at := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bloqueo/desbloqueo manual explícito para admin -- antes no existía
-- ningún control desde la app, solo lo que el trigger automático hacía.
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
  -- Si el bloqueo es por exceso de efectivo, exige que ya lo haya
  -- liquidado antes de desbloquear a mano (si no, el trigger lo hubiera
  -- reactivado solo). Para cualquier otro motivo (manual), el admin
  -- decide libremente -- no depende del saldo de caja.
  IF COALESCE(v_actual.motivo_bloqueo,'exceso_efectivo') = 'exceso_efectivo' AND v_actual.efectivo_en_mano >= 40.00 THEN
    RAISE EXCEPTION 'No se puede desbloquear: todavía tiene $% en mano (límite $40)', v_actual.efectivo_en_mano;
  END IF;
  UPDATE rep_repartidores
  SET estado='ACTIVO', motivo_bloqueo=NULL, bloqueado_por=NULL, bloqueado_at=NULL
  WHERE id=p_repartidor_id
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.desbloquear_repartidor_admin FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desbloquear_repartidor_admin TO authenticated;
