-- migration_fondo_caja_chica_shopper.sql
-- Control real (no solo visibilidad) del fondo de caja chica del shopper:
-- monto fijo configurable por jornada (America/Guayaquil), y bloqueo
-- automático si intenta registrar una compra que supera lo que le queda.
--
-- Política confirmada:
-- - Monto fijo configurable por shopper (igual patrón que comision_valor).
-- - Si no está configurado (NULL o 0), no se bloquea -- no rompe shoppers
--   existentes que nunca tuvieron un límite asignado.
-- - Si está configurado y se excede, se BLOQUEA el registro de la compra
--   (mismo criterio que el bloqueo de efectivo del repartidor a los $40).
-- - Solo aplica a compras con efectivo_caja_chica -- tarjeta corporativa
--   (cuenta bancaria) no se limita por este mecanismo, es un fondo
--   distinto (ver migration_prioridad2_fondo_compras.sql).

ALTER TABLE public.rep_repartidores ADD COLUMN IF NOT EXISTS fondo_caja_chica_diario NUMERIC(10,2);
COMMENT ON COLUMN public.rep_repartidores.fondo_caja_chica_diario IS
  'Monto máximo de caja chica (efectivo) que este shopper puede gastar por jornada. NULL o 0 = sin límite configurado (no bloquea).';

CREATE OR REPLACE FUNCTION public.registrar_factura_compra_servidor(
  p_asignacion_id UUID,
  p_actor_user_id UUID,
  p_actor_repartidor_id UUID,
  p_tienda_id UUID,
  p_prov_ruc TEXT,
  p_prov_establecimiento TEXT,
  p_prov_punto_emision TEXT,
  p_prov_secuencial TEXT,
  p_monto_digitado NUMERIC,
  p_metodo_pago TEXT,
  p_foto_path TEXT,
  p_clave_acceso TEXT,
  p_sri_estado TEXT,
  p_sri_fecha_autorizacion TIMESTAMPTZ,
  p_sri_xml TEXT,
  p_sri_sha256 TEXT,
  p_sri_razon_social_emisor TEXT,
  p_sri_identificacion_comprador TEXT,
  p_sri_subtotal NUMERIC,
  p_sri_iva NUMERIC,
  p_sri_total NUMERIC,
  p_sri_ambiente TEXT,
  p_conciliacion_estado TEXT,
  p_conciliacion_diferencias JSONB,
  p_request_id UUID,
  p_tipo_comprobante TEXT DEFAULT 'electronica',
  p_motivo_excepcion TEXT DEFAULT NULL,
  p_sri_mensaje_error TEXT DEFAULT NULL
)
RETURNS public.ol_pedidos_comprobantes_proveedor
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a rep_asignaciones;
  v_comprobante ol_pedidos_comprobantes_proveedor;
  v_pendientes INTEGER;
  v_total_items INTEGER;
  v_fondo TEXT;
  v_fondo_diario NUMERIC;
  v_gastado_hoy NUMERIC;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Falta identificador de operación';
  END IF;

  SELECT * INTO v_comprobante FROM ol_pedidos_comprobantes_proveedor WHERE request_id = p_request_id;
  IF FOUND THEN
    RETURN v_comprobante;
  END IF;

  IF p_tipo_comprobante NOT IN ('electronica', 'electronica_pendiente_sri', 'sin_comprobante') THEN
    RAISE EXCEPTION 'Tipo de comprobante inválido';
  END IF;

  IF p_tipo_comprobante = 'electronica' THEN
    IF p_sri_sha256 IS NULL OR LENGTH(p_sri_sha256) <> 64 THEN
      RAISE EXCEPTION 'Hash SRI inválido';
    END IF;
    IF p_sri_estado IS DISTINCT FROM 'AUTORIZADO' THEN
      RAISE EXCEPTION 'El comprobante no está autorizado por el SRI (estado: %)', p_sri_estado;
    END IF;
  ELSIF p_tipo_comprobante = 'electronica_pendiente_sri' THEN
    IF p_clave_acceso IS NULL OR LENGTH(regexp_replace(p_clave_acceso, '\D', '', 'g')) <> 49 THEN
      RAISE EXCEPTION 'La clave de acceso debe tener 49 dígitos para registrar esta excepción';
    END IF;
    IF NULLIF(TRIM(p_motivo_excepcion), '') IS NULL THEN
      RAISE EXCEPTION 'Debes indicar el motivo de la excepción (ej. el SRI aún no autoriza esta factura)';
    END IF;
  ELSIF p_tipo_comprobante = 'sin_comprobante' THEN
    IF NULLIF(TRIM(p_motivo_excepcion), '') IS NULL THEN
      RAISE EXCEPTION 'Debes indicar el motivo por el que no hay comprobante';
    END IF;
  END IF;

  SELECT * INTO v_a FROM rep_asignaciones WHERE id = p_asignacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asignación no encontrada';
  END IF;
  IF v_a.estado <> 'asignado' THEN
    RAISE EXCEPTION 'La asignación no está en estado asignado (actual: %)', v_a.estado;
  END IF;
  IF v_a.shopper_id IS DISTINCT FROM p_actor_repartidor_id THEN
    RAISE EXCEPTION 'No eres el comprador responsable de esta asignación';
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE NOT COALESCE(picking_completado, false) AND NOT COALESCE(picking_agotado, false))
    INTO v_total_items, v_pendientes
    FROM ol_pedido_items
   WHERE pedido_id = v_a.pedido_id;

  IF v_total_items = 0 THEN
    RAISE EXCEPTION 'El pedido no tiene ítems registrados';
  END IF;
  IF v_pendientes > 0 THEN
    RAISE EXCEPTION 'Quedan % ítem(s) sin resolver antes de facturar', v_pendientes;
  END IF;

  IF p_clave_acceso IS NOT NULL AND EXISTS (SELECT 1 FROM ol_pedidos_comprobantes_proveedor WHERE prov_clave_acceso = p_clave_acceso) THEN
    RAISE EXCEPTION 'Esta clave de acceso ya fue registrada en otro comprobante';
  END IF;

  -- Bloqueo de fondo de caja chica: solo si el shopper tiene un límite
  -- configurado y este pago es en efectivo de caja chica.
  IF p_metodo_pago = 'efectivo_caja_chica' THEN
    SELECT fondo_caja_chica_diario INTO v_fondo_diario FROM rep_repartidores WHERE id = p_actor_repartidor_id;
    IF v_fondo_diario IS NOT NULL AND v_fondo_diario > 0 THEN
      SELECT COALESCE(SUM(monto), 0) INTO v_gastado_hoy
      FROM rep_transacciones_caja
      WHERE repartidor_id = p_actor_repartidor_id AND tipo = 'egreso_compra' AND fondo_origen = 'caja_chica'
        AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Guayaquil') AT TIME ZONE 'America/Guayaquil'
        AND created_at < (date_trunc('day', NOW() AT TIME ZONE 'America/Guayaquil') + INTERVAL '1 day') AT TIME ZONE 'America/Guayaquil';
      IF v_gastado_hoy + p_monto_digitado > v_fondo_diario THEN
        RAISE EXCEPTION 'Este pago supera tu fondo de caja chica del día (llevas % de % gastados). Pide que te asignen más fondo o usa tarjeta corporativa.',
          to_char(v_gastado_hoy, 'FM999999990.00'), to_char(v_fondo_diario, 'FM999999990.00');
      END IF;
    END IF;
  END IF;

  INSERT INTO ol_pedidos_comprobantes_proveedor (
    pedido_id, tienda_id, prov_establecimiento, prov_punto_emision, prov_secuencial,
    prov_costo_real, prov_factura_url, prov_clave_acceso, prov_ruc, metodo_pago,
    sri_estado, sri_fecha_autorizacion, sri_xml, sri_xml_sha256,
    sri_razon_social_emisor, sri_identificacion_comprador,
    sri_subtotal, sri_iva, sri_total, sri_ambiente, sri_consultado_at,
    conciliacion_estado, conciliacion_diferencias, registrada_por, registrada_at, request_id,
    tipo_comprobante, motivo_excepcion, sri_mensaje_error,
    estado_revision
  ) VALUES (
    v_a.pedido_id, p_tienda_id, p_prov_establecimiento, p_prov_punto_emision, p_prov_secuencial,
    p_monto_digitado, p_foto_path, p_clave_acceso, p_prov_ruc, p_metodo_pago,
    p_sri_estado, p_sri_fecha_autorizacion, p_sri_xml, p_sri_sha256,
    p_sri_razon_social_emisor, p_sri_identificacion_comprador,
    p_sri_subtotal, p_sri_iva, p_sri_total, p_sri_ambiente,
    CASE WHEN p_tipo_comprobante = 'sin_comprobante' THEN NULL ELSE NOW() END,
    p_conciliacion_estado, p_conciliacion_diferencias, p_actor_user_id, NOW(), p_request_id,
    p_tipo_comprobante, NULLIF(TRIM(p_motivo_excepcion), ''), p_sri_mensaje_error,
    'pendiente'
  )
  RETURNING * INTO v_comprobante;

  v_fondo := CASE WHEN p_metodo_pago = 'efectivo_caja_chica' THEN 'caja_chica' ELSE 'cuenta_bancaria' END;
  INSERT INTO rep_transacciones_caja (repartidor_id, pedido_id, tipo, monto, comprobante_url, estado, fondo_origen)
  VALUES (p_actor_repartidor_id, v_a.pedido_id, 'egreso_compra', p_monto_digitado, p_foto_path, 'pendiente', v_fondo);

  UPDATE ol_pedidos SET estado = 'preparado' WHERE id = v_a.pedido_id;
  UPDATE rep_asignaciones SET estado = 'recolectado', updated_at = NOW() WHERE id = p_asignacion_id;

  PERFORM registrar_evento_pedido(
    v_a.pedido_id, v_a.id, 'factura_proveedor_registrada', p_actor_user_id, p_actor_repartidor_id,
    jsonb_build_object('clave_acceso', p_clave_acceso, 'total', p_sri_total, 'tipo_comprobante', p_tipo_comprobante, 'motivo_excepcion', p_motivo_excepcion, 'fondo_origen', v_fondo),
    p_request_id
  );

  RETURN v_comprobante;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.registrar_factura_compra_servidor FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_factura_compra_servidor TO authenticated;

-- El shopper necesita ver, antes de comprar, cuánto le queda de caja
-- chica hoy -- para no descubrir el bloqueo recién al intentar registrar.
CREATE OR REPLACE FUNCTION public.mi_fondo_caja_chica_hoy()
RETURNS TABLE(fondo_diario NUMERIC, gastado_hoy NUMERIC, disponible NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_repartidor_id UUID; v_fondo NUMERIC; v_gastado NUMERIC;
BEGIN
  v_repartidor_id := rep_mi_id();
  IF v_repartidor_id IS NULL THEN RETURN; END IF;
  SELECT fondo_caja_chica_diario INTO v_fondo FROM rep_repartidores WHERE id = v_repartidor_id;
  SELECT COALESCE(SUM(monto), 0) INTO v_gastado
  FROM rep_transacciones_caja
  WHERE repartidor_id = v_repartidor_id AND tipo = 'egreso_compra' AND fondo_origen = 'caja_chica'
    AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Guayaquil') AT TIME ZONE 'America/Guayaquil'
    AND created_at < (date_trunc('day', NOW() AT TIME ZONE 'America/Guayaquil') + INTERVAL '1 day') AT TIME ZONE 'America/Guayaquil';
  RETURN QUERY SELECT v_fondo, v_gastado, CASE WHEN v_fondo IS NULL THEN NULL ELSE GREATEST(v_fondo - v_gastado, 0) END;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mi_fondo_caja_chica_hoy FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_fondo_caja_chica_hoy TO authenticated;
