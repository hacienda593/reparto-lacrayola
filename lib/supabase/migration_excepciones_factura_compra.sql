-- ⚠️ OBSOLETO -- NO REEJECUTAR (SEC-03, docs/auditoria_funcionalidad_seguridad_trazabilidad.md).
-- Este archivo revoca EXECUTE de 'authenticated' en registrar_factura_compra_servidor
-- y lo deja SOLO para 'service_role' -- el frontend usa sesión normal, no
-- service_role, así que reejecutar esto rompe el registro de compras para
-- todos los shoppers. La versión vigente y correcta es
-- migration_fondo_caja_chica_shopper.sql (la más reciente que redefine
-- esta función), que sí otorga a 'authenticated'. Se conserva este archivo
-- solo como historial de migraciones ya aplicadas.

-- migration_excepciones_factura_compra.sql
-- Excepciones controladas al registro de factura de compra (Fase 1 punto 4 /
-- Fase 2 punto 8 de docs/auditoria_plan_correcciones_ia.md), pedidas por el
-- negocio: el shopper no debe quedar bloqueado en caja cuando:
--   a) el proveedor SÍ da factura electrónica pero el SRI aún no la autoriza
--      (tarda minutos/horas en procesar), o
--   b) el proveedor no emite ningún comprobante (típico de mercados/tiendas
--      informales, ej. verdulería).
-- Ambos casos son la EXCEPCIÓN, no la norma: exigen motivo obligatorio y
-- quedan marcados para que administración/contabilidad les preste más
-- atención, sin bloquear la operación ni el picking del pedido.

ALTER TABLE public.ol_pedidos_comprobantes_proveedor
  ADD COLUMN IF NOT EXISTS tipo_comprobante TEXT NOT NULL DEFAULT 'electronica'
    CHECK (tipo_comprobante IN ('electronica', 'electronica_pendiente_sri', 'sin_comprobante')),
  ADD COLUMN IF NOT EXISTS motivo_excepcion TEXT,
  ADD COLUMN IF NOT EXISTS sri_mensaje_error TEXT;

-- prov_costo_real/prov_ruc/prov_establecimiento/etc. ya son NOT NULL y se
-- siguen llenando siempre (con lo que el shopper sepa, aunque sea parcial);
-- lo único que se vuelve condicional es prov_clave_acceso y los campos sri_*.

-- Se agregan parámetros nuevos: es una firma distinta, así que
-- CREATE OR REPLACE no basta para sustituir la versión anterior (quedaría
-- como una sobrecarga aparte). Se elimina explícitamente primero.
DROP FUNCTION IF EXISTS public.registrar_factura_compra_servidor(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT,
  TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT,
  TEXT, JSONB, UUID
);

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
    -- Excepción: sí hay clave de 49 dígitos, pero el SRI todavía no la
    -- autoriza. Exige motivo y al menos un intento real de consulta (el
    -- servidor ya lo hizo antes de llamar aquí; guarda su mensaje de error).
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
    -- Las excepciones nacen ya marcadas "pendiente" de revisión explícita,
    -- aunque estado_revision ya lo era por defecto -- se deja explícito
    -- para que quede claro que aquí es obligatorio, no incidental.
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

  IF p_metodo_pago = 'efectivo_caja_chica' THEN
    INSERT INTO rep_transacciones_caja (repartidor_id, pedido_id, tipo, monto, comprobante_url, estado)
    VALUES (p_actor_repartidor_id, v_a.pedido_id, 'egreso_compra', p_monto_digitado, p_foto_path, 'pendiente');
  END IF;

  UPDATE ol_pedidos SET estado = 'preparado' WHERE id = v_a.pedido_id;
  UPDATE rep_asignaciones SET estado = 'recolectado', updated_at = NOW() WHERE id = p_asignacion_id;

  PERFORM registrar_evento_pedido(
    v_a.pedido_id, v_a.id, 'factura_proveedor_registrada', p_actor_user_id, p_actor_repartidor_id,
    jsonb_build_object('clave_acceso', p_clave_acceso, 'total', p_sri_total, 'tipo_comprobante', p_tipo_comprobante, 'motivo_excepcion', p_motivo_excepcion),
    p_request_id
  );

  RETURN v_comprobante;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_factura_compra_servidor FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_factura_compra_servidor TO service_role;
