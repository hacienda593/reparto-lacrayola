-- Separa factura de COMPRA del proveedor y factura de VENTA al cliente.
CREATE TABLE IF NOT EXISTS rep_facturas_cliente (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),pedido_id UUID NOT NULL UNIQUE REFERENCES ol_pedidos(id) ON DELETE RESTRICT,
 estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN('pendiente','emitida','anulada','error')),
 numero_factura TEXT,clave_acceso TEXT,ruc_emisor TEXT,fecha_emision TIMESTAMPTZ,
 subtotal NUMERIC(12,2),iva NUMERIC(12,2),total NUMERIC(12,2),ride_url TEXT,xml_url TEXT,
 observaciones TEXT,emitida_por UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(estado<>'emitida' OR (NULLIF(TRIM(numero_factura),'') IS NOT NULL AND fecha_emision IS NOT NULL))
);
ALTER TABLE rep_facturas_cliente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facturas_cliente_select ON rep_facturas_cliente;
CREATE POLICY facturas_cliente_select ON rep_facturas_cliente FOR SELECT USING(rep_is_admin());

-- Sincroniza entregas exitosas: crea la obligación de facturar, no una factura ficticia.
CREATE OR REPLACE FUNCTION sincronizar_facturas_pendientes()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_n INTEGER;
BEGIN
 IF NOT rep_is_admin() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
 INSERT INTO rep_facturas_cliente(pedido_id,estado)
 SELECT DISTINCT e.pedido_id,'pendiente' FROM rep_entregas e WHERE e.exitosa
 ON CONFLICT(pedido_id) DO NOTHING;GET DIAGNOSTICS v_n=ROW_COUNT;RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION registrar_factura_cliente(p_pedido_id UUID,p_numero TEXT,p_clave TEXT DEFAULT NULL,p_ride_url TEXT DEFAULT NULL,p_xml_url TEXT DEFAULT NULL,p_observaciones TEXT DEFAULT NULL)
RETURNS rep_facturas_cliente LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_pedido ol_pedidos;v_result rep_facturas_cliente;
BEGIN
 IF NOT rep_is_admin() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
 IF NULLIF(TRIM(p_numero),'') IS NULL THEN RAISE EXCEPTION 'Número de factura obligatorio'; END IF;
 SELECT * INTO v_pedido FROM ol_pedidos WHERE id=p_pedido_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rep_entregas WHERE pedido_id=p_pedido_id AND exitosa) THEN RAISE EXCEPTION 'Solo puede facturarse un pedido entregado exitosamente'; END IF;
 INSERT INTO rep_facturas_cliente(pedido_id,estado,numero_factura,clave_acceso,fecha_emision,total,ride_url,xml_url,observaciones,emitida_por,updated_at)
 VALUES(p_pedido_id,'emitida',TRIM(p_numero),NULLIF(TRIM(p_clave),''),NOW(),v_pedido.total,p_ride_url,p_xml_url,NULLIF(TRIM(p_observaciones),''),auth.uid(),NOW())
 ON CONFLICT(pedido_id) DO UPDATE SET estado='emitida',numero_factura=EXCLUDED.numero_factura,clave_acceso=EXCLUDED.clave_acceso,fecha_emision=EXCLUDED.fecha_emision,total=EXCLUDED.total,ride_url=EXCLUDED.ride_url,xml_url=EXCLUDED.xml_url,observaciones=EXCLUDED.observaciones,emitida_por=auth.uid(),updated_at=NOW() RETURNING * INTO v_result;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION sincronizar_facturas_pendientes() FROM PUBLIC;GRANT EXECUTE ON FUNCTION sincronizar_facturas_pendientes() TO authenticated;
REVOKE ALL ON FUNCTION registrar_factura_cliente(UUID,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;GRANT EXECUTE ON FUNCTION registrar_factura_cliente(UUID,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;
