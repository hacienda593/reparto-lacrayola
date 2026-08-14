-- XML autorizado SRI y conciliación con foto/datos del shopper.
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS sri_estado TEXT;
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS sri_fecha_autorizacion TIMESTAMPTZ;
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS sri_xml TEXT;
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS sri_xml_sha256 VARCHAR(64);
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS sri_razon_social_emisor TEXT;
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS sri_identificacion_comprador VARCHAR(20);
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS sri_subtotal NUMERIC(12,2);
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS sri_iva NUMERIC(12,2);
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS sri_total NUMERIC(12,2);
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS sri_ambiente TEXT;
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS sri_consultado_at TIMESTAMPTZ;
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS conciliacion_estado TEXT DEFAULT 'pendiente' CHECK(conciliacion_estado IN('pendiente','coincide','con_diferencia','no_consultado'));
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS conciliacion_diferencias JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS factura_compra_clave_acceso_uidx ON ol_pedidos_comprobantes_proveedor(prov_clave_acceso) WHERE prov_clave_acceso IS NOT NULL;
CREATE INDEX IF NOT EXISTS factura_compra_conciliacion_idx ON ol_pedidos_comprobantes_proveedor(conciliacion_estado,estado_revision,created_at DESC);
DROP POLICY IF EXISTS "insertar_autenticados_comprobantes" ON ol_pedidos_comprobantes_proveedor;
DROP POLICY IF EXISTS "lectura_autenticados_comprobantes" ON ol_pedidos_comprobantes_proveedor;
DROP POLICY IF EXISTS factura_compra_insert_asignado ON ol_pedidos_comprobantes_proveedor;
CREATE POLICY factura_compra_insert_asignado ON ol_pedidos_comprobantes_proveedor FOR INSERT TO authenticated
 WITH CHECK(rep_is_admin() OR EXISTS(SELECT 1 FROM rep_asignaciones a WHERE a.pedido_id=ol_pedidos_comprobantes_proveedor.pedido_id AND (a.shopper_id=rep_mi_id() OR a.repartidor_id=rep_mi_id())));
DROP POLICY IF EXISTS factura_compra_select_asignado ON ol_pedidos_comprobantes_proveedor;
CREATE POLICY factura_compra_select_asignado ON ol_pedidos_comprobantes_proveedor FOR SELECT TO authenticated
 USING(rep_is_admin() OR EXISTS(SELECT 1 FROM rep_asignaciones a WHERE a.pedido_id=ol_pedidos_comprobantes_proveedor.pedido_id AND (a.shopper_id=rep_mi_id() OR a.rider_id=rep_mi_id() OR a.repartidor_id=rep_mi_id())));
