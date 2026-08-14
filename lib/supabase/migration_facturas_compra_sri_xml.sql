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

CREATE OR REPLACE FUNCTION actualizar_factura_compra_sri_admin(p_id UUID,p_estado TEXT,p_fecha TIMESTAMPTZ,p_xml TEXT,p_hash TEXT,p_emisor TEXT,p_comprador TEXT,p_subtotal NUMERIC,p_iva NUMERIC,p_total NUMERIC,p_ambiente TEXT,p_diferencias JSONB)
RETURNS ol_pedidos_comprobantes_proveedor LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result ol_pedidos_comprobantes_proveedor;
BEGIN
 IF NOT rep_is_admin() THEN RAISE EXCEPTION 'Acceso denegado';END IF;
 IF p_estado<>'AUTORIZADO' OR NULLIF(TRIM(p_xml),'') IS NULL OR LENGTH(COALESCE(p_hash,''))<>64 THEN RAISE EXCEPTION 'Respuesta SRI inválida';END IF;
 UPDATE ol_pedidos_comprobantes_proveedor SET sri_estado=p_estado,sri_fecha_autorizacion=p_fecha,sri_xml=p_xml,sri_xml_sha256=p_hash,sri_razon_social_emisor=p_emisor,sri_identificacion_comprador=p_comprador,sri_subtotal=p_subtotal,sri_iva=p_iva,sri_total=p_total,sri_ambiente=p_ambiente,sri_consultado_at=NOW(),conciliacion_diferencias=COALESCE(p_diferencias,'[]'::jsonb),conciliacion_estado=CASE WHEN jsonb_array_length(COALESCE(p_diferencias,'[]'::jsonb))=0 THEN 'coincide' ELSE 'con_diferencia' END WHERE id=p_id RETURNING * INTO v_result;
 IF NOT FOUND THEN RAISE EXCEPTION 'Factura de compra no encontrada';END IF;RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION actualizar_factura_compra_sri_admin(UUID,TEXT,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actualizar_factura_compra_sri_admin(UUID,TEXT,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,TEXT,JSONB) TO authenticated;
