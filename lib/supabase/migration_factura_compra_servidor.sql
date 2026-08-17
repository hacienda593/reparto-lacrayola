-- ⚠️ OBSOLETO -- NO REEJECUTAR (SEC-03, docs/auditoria_funcionalidad_seguridad_trazabilidad.md).
-- Este archivo revoca EXECUTE de 'authenticated' en registrar_factura_compra_servidor
-- y lo deja SOLO para 'service_role' -- el frontend usa sesión normal, no
-- service_role, así que reejecutar esto rompe el registro de compras para
-- todos los shoppers. La versión vigente y correcta es
-- migration_fondo_caja_chica_shopper.sql (la más reciente que redefine
-- esta función), que sí otorga a 'authenticated'. Se conserva este archivo
-- solo como historial de migraciones ya aplicadas.

-- migration_factura_compra_servidor.sql
-- Fase 1 punto 4 (real) + Fase 2 punto 8 de docs/auditoria_plan_correcciones_ia.md
--
-- Problema real en app/caja/[id]/page.tsx:
--   1. El navegador hace 4 escrituras sueltas sin transacción (comprobante,
--      caja chica, ol_pedidos, rep_asignaciones) para cerrar la compra.
--   2. El navegador retiene y reenvía como si fueran confiables los datos
--      del SRI (xml, sha256, emisor, receptor, totales) que en realidad
--      vinieron de /api/sri/comprobante — nada impide que alguien con
--      DevTools llame el insert directo con valores fabricados.
--   3. No se valida en el servidor que el picking esté 100% resuelto antes
--      de facturar.
--
-- Esta función SOLO puede ejecutarla el service_role (revocada de
-- PUBLIC/anon/authenticated) -- la invoca app/api/sri/registrar/route.ts,
-- que es el único lugar donde se vuelve a consultar el SRI en el servidor
-- y se recalculan xml/hash/totales antes de llamar a esta función. El
-- navegador nunca puede alcanzar este camino directamente.
--
-- Idempotente por request_id.

-- Punto 9: separar registro (shopper) y validación (admin/contador) de la
-- factura de compra. estado_revision/revisada_por/revisada_at/motivo_revision
-- ya existían; faltaban quién y cuándo la registró, y el request_id.
ALTER TABLE public.ol_pedidos_comprobantes_proveedor
  ADD COLUMN IF NOT EXISTS registrada_por UUID,
  ADD COLUMN IF NOT EXISTS registrada_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_comprobantes_proveedor_request_id
  ON public.ol_pedidos_comprobantes_proveedor(request_id)
  WHERE request_id IS NOT NULL;

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
  p_request_id UUID
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

  IF p_sri_sha256 IS NULL OR LENGTH(p_sri_sha256) <> 64 THEN
    RAISE EXCEPTION 'Hash SRI inválido';
  END IF;
  IF p_sri_estado IS DISTINCT FROM 'AUTORIZADO' THEN
    RAISE EXCEPTION 'El comprobante no está autorizado por el SRI (estado: %)', p_sri_estado;
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

  IF EXISTS (SELECT 1 FROM ol_pedidos_comprobantes_proveedor WHERE prov_clave_acceso = p_clave_acceso) THEN
    RAISE EXCEPTION 'Esta clave de acceso ya fue registrada en otro comprobante';
  END IF;

  INSERT INTO ol_pedidos_comprobantes_proveedor (
    pedido_id, tienda_id, prov_establecimiento, prov_punto_emision, prov_secuencial,
    prov_costo_real, prov_factura_url, prov_clave_acceso, prov_ruc, metodo_pago,
    sri_estado, sri_fecha_autorizacion, sri_xml, sri_xml_sha256,
    sri_razon_social_emisor, sri_identificacion_comprador,
    sri_subtotal, sri_iva, sri_total, sri_ambiente, sri_consultado_at,
    conciliacion_estado, conciliacion_diferencias,
    registrada_por, registrada_at, request_id
  ) VALUES (
    v_a.pedido_id, p_tienda_id, p_prov_establecimiento, p_prov_punto_emision, p_prov_secuencial,
    p_monto_digitado, p_foto_path, p_clave_acceso, p_prov_ruc, p_metodo_pago,
    p_sri_estado, p_sri_fecha_autorizacion, p_sri_xml, p_sri_sha256,
    p_sri_razon_social_emisor, p_sri_identificacion_comprador,
    p_sri_subtotal, p_sri_iva, p_sri_total, p_sri_ambiente, NOW(),
    p_conciliacion_estado, p_conciliacion_diferencias,
    p_actor_user_id, NOW(), p_request_id
  )
  RETURNING * INTO v_comprobante;

  IF p_metodo_pago = 'efectivo_caja_chica' THEN
    INSERT INTO rep_transacciones_caja (repartidor_id, pedido_id, tipo, monto, comprobante_url, estado)
    VALUES (p_actor_repartidor_id, v_a.pedido_id, 'egreso_compra', p_monto_digitado, p_foto_path, 'pendiente');
  END IF;

  UPDATE ol_pedidos SET estado = 'preparado' WHERE id = v_a.pedido_id;
  UPDATE rep_asignaciones SET estado = 'recolectado', updated_at = NOW() WHERE id = p_asignacion_id;

  RETURN v_comprobante;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_factura_compra_servidor FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_factura_compra_servidor TO service_role;
