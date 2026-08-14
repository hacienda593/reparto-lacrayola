-- Controles que deben existir aunque el usuario no los solicite explícitamente.

-- 1. Revisión administrativa de facturas de compra.
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS estado_revision TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado_revision IN('pendiente','validada','rechazada','con_diferencia'));
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS revisada_por UUID;
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS revisada_at TIMESTAMPTZ;
ALTER TABLE ol_pedidos_comprobantes_proveedor ADD COLUMN IF NOT EXISTS motivo_revision TEXT;
CREATE INDEX IF NOT EXISTS comprobante_proveedor_numero_idx ON ol_pedidos_comprobantes_proveedor(prov_ruc,prov_establecimiento,prov_punto_emision,prov_secuencial);
CREATE OR REPLACE FUNCTION trg_evitar_factura_compra_duplicada() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN IF EXISTS(SELECT 1 FROM ol_pedidos_comprobantes_proveedor c WHERE c.prov_ruc=NEW.prov_ruc AND c.prov_establecimiento=NEW.prov_establecimiento AND c.prov_punto_emision=NEW.prov_punto_emision AND c.prov_secuencial=NEW.prov_secuencial AND c.id<>NEW.id) THEN RAISE EXCEPTION 'Esta factura de compra ya fue registrada';END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS evitar_factura_compra_duplicada ON ol_pedidos_comprobantes_proveedor;
CREATE TRIGGER evitar_factura_compra_duplicada BEFORE INSERT OR UPDATE ON ol_pedidos_comprobantes_proveedor FOR EACH ROW EXECUTE FUNCTION trg_evitar_factura_compra_duplicada();

CREATE OR REPLACE FUNCTION revisar_factura_compra(p_comprobante_id UUID,p_estado TEXT,p_motivo TEXT DEFAULT NULL)
RETURNS ol_pedidos_comprobantes_proveedor LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result ol_pedidos_comprobantes_proveedor;
BEGIN
 IF NOT rep_is_admin() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
 IF p_estado NOT IN('validada','rechazada','con_diferencia') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
 IF p_estado<>'validada' AND NULLIF(TRIM(p_motivo),'') IS NULL THEN RAISE EXCEPTION 'Debe indicar el motivo'; END IF;
 UPDATE ol_pedidos_comprobantes_proveedor SET estado_revision=p_estado,revisada_por=auth.uid(),revisada_at=NOW(),motivo_revision=NULLIF(TRIM(p_motivo),'') WHERE id=p_comprobante_id RETURNING * INTO v_result;
 IF NOT FOUND THEN RAISE EXCEPTION 'Factura de compra no encontrada'; END IF;RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION revisar_factura_compra(UUID,TEXT,TEXT) FROM PUBLIC;GRANT EXECUTE ON FUNCTION revisar_factura_compra(UUID,TEXT,TEXT) TO authenticated;

-- 2. Toda entrega exitosa crea automáticamente el pendiente de factura de venta.
CREATE OR REPLACE FUNCTION trg_crear_factura_venta_pendiente() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.exitosa THEN INSERT INTO rep_facturas_cliente(pedido_id,estado) VALUES(NEW.pedido_id,'pendiente') ON CONFLICT(pedido_id) DO NOTHING;END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crear_factura_venta_al_entregar ON rep_entregas;
CREATE TRIGGER crear_factura_venta_al_entregar AFTER INSERT OR UPDATE OF exitosa ON rep_entregas FOR EACH ROW EXECUTE FUNCTION trg_crear_factura_venta_pendiente();

-- 3. Incidencias operativas auditables.
CREATE TABLE IF NOT EXISTS rep_incidencias (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),pedido_id UUID NOT NULL REFERENCES ol_pedidos(id) ON DELETE RESTRICT,
 tipo TEXT NOT NULL CHECK(tipo IN('pago','ubicacion','compra','faltante','sustitucion','entrega','efectivo','factura_compra','factura_venta','otro')),
 severidad TEXT NOT NULL DEFAULT 'media' CHECK(severidad IN('baja','media','alta','critica')),
 estado TEXT NOT NULL DEFAULT 'abierta' CHECK(estado IN('abierta','en_revision','resuelta','descartada')),
 descripcion TEXT NOT NULL,resolucion TEXT,responsable_id UUID,creada_por UUID DEFAULT auth.uid(),resuelta_por UUID,created_at TIMESTAMPTZ DEFAULT NOW(),resuelta_at TIMESTAMPTZ
);
ALTER TABLE rep_incidencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incidencias_select ON rep_incidencias;CREATE POLICY incidencias_select ON rep_incidencias FOR SELECT USING(rep_is_admin() OR responsable_id=auth.uid());
DROP POLICY IF EXISTS incidencias_insert ON rep_incidencias;CREATE POLICY incidencias_insert ON rep_incidencias FOR INSERT WITH CHECK(auth.uid() IS NOT NULL AND creada_por=auth.uid());
DROP POLICY IF EXISTS incidencias_update ON rep_incidencias;CREATE POLICY incidencias_update ON rep_incidencias FOR UPDATE USING(rep_is_admin() OR responsable_id=auth.uid()) WITH CHECK(rep_is_admin() OR responsable_id=auth.uid());

-- Seguridad pendiente coordinada: el bucket contiene información tributaria,
-- pero no se vuelve privado aquí porque las pantallas actuales aún consumen
-- URLs públicas. Primero deben migrarse todas a URLs firmadas temporales.
