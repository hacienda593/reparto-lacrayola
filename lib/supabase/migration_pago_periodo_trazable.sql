-- migration_pago_periodo_trazable.sql
-- Hallazgo real: rep_periodos_pago.estado ya contemplaba 'pagado' en su
-- CHECK constraint desde el diseño original, pero nunca se construyó la
-- función que lo usa -- "Cerrar período" solo calcula cuánto se le debe
-- pagar al repartidor (monto_pagar) y ahí se queda. No hay ningún registro
-- de que ese pago (transferencia/depósito a la cuenta del repartidor)
-- realmente se hizo, ni banco, ni fecha, ni referencia, ni comprobante --
-- exactamente lo contrario de rep_depositos_repartidor, que sí exige todo
-- eso cuando el dinero va en la dirección repartidor -> empresa.

ALTER TABLE public.rep_periodos_pago ADD COLUMN IF NOT EXISTS banco_pago TEXT;
ALTER TABLE public.rep_periodos_pago ADD COLUMN IF NOT EXISTS referencia_pago TEXT;
ALTER TABLE public.rep_periodos_pago ADD COLUMN IF NOT EXISTS comprobante_pago_path TEXT;
ALTER TABLE public.rep_periodos_pago ADD COLUMN IF NOT EXISTS pagado_por UUID;
ALTER TABLE public.rep_periodos_pago ADD COLUMN IF NOT EXISTS pagado_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.registrar_pago_periodo(
  p_periodo_id UUID, p_banco TEXT, p_referencia TEXT, p_comprobante_path TEXT DEFAULT NULL, p_request_id UUID DEFAULT NULL
)
RETURNS public.rep_periodos_pago
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result rep_periodos_pago;
BEGIN
  IF NOT rep_puede_liquidar_caja() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_result FROM rep_periodos_pago WHERE id = p_periodo_id AND referencia_pago = TRIM(p_referencia) AND pagado_at IS NOT NULL;
    IF FOUND THEN RETURN v_result; END IF;
  END IF;
  IF NULLIF(TRIM(p_referencia), '') IS NULL THEN RAISE EXCEPTION 'La referencia de la transferencia/depósito es obligatoria'; END IF;
  IF NULLIF(TRIM(p_banco), '') IS NULL THEN RAISE EXCEPTION 'El banco es obligatorio'; END IF;

  SELECT * INTO v_result FROM rep_periodos_pago WHERE id = p_periodo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período no encontrado'; END IF;
  IF v_result.estado <> 'cerrado' THEN RAISE EXCEPTION 'Solo se puede registrar el pago de un período cerrado (actual: %)', v_result.estado; END IF;
  IF v_result.monto_pagar <= 0 THEN RAISE EXCEPTION 'Este período no tiene un monto a pagar (la empresa no le debe al colaborador)'; END IF;

  UPDATE rep_periodos_pago
  SET estado = 'pagado', banco_pago = TRIM(p_banco), referencia_pago = TRIM(p_referencia),
      comprobante_pago_path = p_comprobante_path, pagado_por = auth.uid(), pagado_at = NOW(), updated_at = NOW()
  WHERE id = p_periodo_id
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.registrar_pago_periodo FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pago_periodo TO authenticated;
