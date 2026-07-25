-- =====================================================================
-- FIX RLS: ol_pedidos_comprobantes_proveedor
-- =====================================================================
-- El comprador (shopper) registra el ticket de compra del proveedor
-- (Tuti/Tia) desde la app movil con su sesion autenticada normal, pero
-- la tabla no tenia una politica de INSERT para usuarios autenticados,
-- por lo que Supabase bloqueaba el registro con:
-- "new row violates row-level security policy for table ol_pedidos_comprobantes_proveedor"
-- Esto dejaba al comprador atascado en /caja/[id] sin poder avanzar
-- al traspaso hacia el repartidor.
-- Ejecuta este script en el SQL Editor de tu Dashboard de Supabase.

ALTER TABLE ol_pedidos_comprobantes_proveedor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insertar_autenticados_comprobantes" ON ol_pedidos_comprobantes_proveedor;
CREATE POLICY "insertar_autenticados_comprobantes"
  ON ol_pedidos_comprobantes_proveedor FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "lectura_autenticados_comprobantes" ON ol_pedidos_comprobantes_proveedor;
CREATE POLICY "lectura_autenticados_comprobantes"
  ON ol_pedidos_comprobantes_proveedor FOR SELECT
  TO authenticated
  USING (true);
