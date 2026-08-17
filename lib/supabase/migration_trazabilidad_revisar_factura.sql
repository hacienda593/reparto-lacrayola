-- migration_trazabilidad_revisar_factura.sql
-- Hallazgo de la auditoría (SEC-06/trazabilidad): revisar_factura_compra()
-- no recibía p_request_id -- un doble clic o reintento de red podía crear
-- un evento 'factura_proveedor_validada' duplicado en el historial (la
-- UPDATE en sí no cambiaba de resultado, pero el registro de auditoría sí
-- se duplicaba, como si hubiera dos revisiones distintas).

DROP FUNCTION IF EXISTS public.revisar_factura_compra(uuid, text, text);

CREATE OR REPLACE FUNCTION public.revisar_factura_compra(p_comprobante_id UUID, p_estado TEXT, p_motivo TEXT DEFAULT NULL::TEXT, p_request_id UUID DEFAULT NULL)
RETURNS ol_pedidos_comprobantes_proveedor
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_result ol_pedidos_comprobantes_proveedor; v_umbral NUMERIC; v_existe RECORD;
BEGIN
  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_existe FROM ol_pedidos_comprobantes_proveedor c
      WHERE c.id = p_comprobante_id AND EXISTS (
        SELECT 1 FROM rep_pedido_eventos e WHERE e.request_id = p_request_id
      );
    IF FOUND THEN RETURN v_existe; END IF;
  END IF;
  IF NOT rep_puede_validar_factura_compra() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  IF p_estado NOT IN ('validada','rechazada','con_diferencia') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
  IF p_estado <> 'validada' AND NULLIF(TRIM(p_motivo),'') IS NULL THEN RAISE EXCEPTION 'Debe indicar el motivo'; END IF;
  SELECT * INTO v_result FROM ol_pedidos_comprobantes_proveedor WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factura de compra no encontrada'; END IF;
  SELECT COALESCE(valor::numeric, 20.00) INTO v_umbral FROM rep_configuracion WHERE clave = 'umbral_separacion_funciones_factura';
  IF v_result.registrada_por IS NOT NULL AND v_result.registrada_por = auth.uid() AND v_result.prov_costo_real >= COALESCE(v_umbral, 20.00) AND NOT rep_tiene_rol('superadmin') THEN
    RAISE EXCEPTION 'Por separación de funciones, quien registró esta factura (monto >= %) no puede validarla', COALESCE(v_umbral, 20.00);
  END IF;
  UPDATE ol_pedidos_comprobantes_proveedor SET estado_revision = p_estado, revisada_por = auth.uid(), revisada_at = NOW(), motivo_revision = NULLIF(TRIM(p_motivo),'')
   WHERE id = p_comprobante_id RETURNING * INTO v_result;
  PERFORM registrar_evento_pedido(v_result.pedido_id, NULL, 'factura_proveedor_validada', auth.uid(), NULL, jsonb_build_object('estado', p_estado, 'motivo', p_motivo), p_request_id);
  RETURN v_result;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.revisar_factura_compra FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revisar_factura_compra TO authenticated;
