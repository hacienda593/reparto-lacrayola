-- migration_prioridad2_fondo_compras.sql
-- A5 de la auditoría financiera: "no existe un saldo de fondos entregados
-- al shopper para comprar... no existe conciliación por pedido entre
-- anticipo, gasto real y devolución de sobrante."
--
-- Hallazgo confirmado en datos reales: el formulario de compra tiene dos
-- métodos -- "Caja Chica (Efectivo)" y "Tarjeta Corporativa" (cuenta
-- bancaria de la empresa) -- pero SOLO efectivo_caja_chica generaba un
-- registro en rep_transacciones_caja. Las compras con tarjeta corporativa
-- (la mayoría de los pedidos reales revisados) no dejaban NINGÚN rastro
-- contable de que salió dinero de la cuenta bancaria de la empresa.
--
-- Política confirmada con el negocio: dos fondos posibles, caja chica
-- (efectivo físico) o cuenta bancaria (tarjeta corporativa/transferencia
-- directa al proveedor). Se registra el egreso para AMBOS, distinguiendo
-- de qué fondo salió, para poder sumar cuánto se ha gastado de cada uno.

ALTER TABLE public.rep_transacciones_caja ADD COLUMN IF NOT EXISTS fondo_origen TEXT
  CHECK (fondo_origen IN ('caja_chica', 'cuenta_bancaria'));
COMMENT ON COLUMN public.rep_transacciones_caja.fondo_origen IS
  'De qué fondo salió el dinero para esta compra: caja_chica (efectivo físico entregado al shopper) o cuenta_bancaria (tarjeta corporativa / transferencia directa al proveedor).';

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

  -- Antes solo efectivo_caja_chica generaba un registro contable -- las
  -- compras con tarjeta corporativa (cuenta bancaria) no dejaban rastro.
  -- Ahora se registra SIEMPRE, distinguiendo el fondo.
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

-- Vista de resumen por fondo: cuánto se ha gastado de caja chica vs.
-- cuenta bancaria, para que administración pueda reponer/conciliar cada
-- uno por separado. No es un sistema de anticipos con límite todavía
-- (eso requeriría decidir montos asignados por shopper/jornada), pero deja
-- de ser invisible.
CREATE OR REPLACE FUNCTION public.admin_gastos_por_fondo(p_desde DATE DEFAULT NULL, p_hasta DATE DEFAULT NULL)
RETURNS TABLE(fondo_origen TEXT, total_gastado NUMERIC, cantidad_compras BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT rep_puede_ver_finanzas() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  RETURN QUERY
  SELECT COALESCE(t.fondo_origen, 'sin_clasificar'), SUM(t.monto), COUNT(*)
  FROM rep_transacciones_caja t
  WHERE t.tipo = 'egreso_compra'
    AND (p_desde IS NULL OR t.created_at >= p_desde::timestamp AT TIME ZONE 'America/Guayaquil')
    AND (p_hasta IS NULL OR t.created_at < (p_hasta+1)::timestamp AT TIME ZONE 'America/Guayaquil')
  GROUP BY COALESCE(t.fondo_origen, 'sin_clasificar');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_gastos_por_fondo FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_gastos_por_fondo TO authenticated;
