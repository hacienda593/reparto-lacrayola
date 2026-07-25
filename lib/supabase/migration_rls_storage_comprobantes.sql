-- =====================================================================
-- FIX RLS: Storage bucket "comprobantes-proveedores"
-- =====================================================================
-- Mismo problema que con la tabla ol_pedidos_comprobantes_proveedor, pero
-- esta vez en el almacenamiento de archivos: el comprador sube la foto del
-- ticket desde /caja/[id] con su sesion autenticada normal, y el bucket no
-- tenia politicas de RLS que permitieran subir/leer archivos, por lo que
-- Supabase bloqueaba la subida con:
-- "new row violates row-level security policy"
-- Ejecuta este script en el SQL Editor de tu Dashboard de Supabase.

DROP POLICY IF EXISTS "insertar_autenticados_comprobantes_storage" ON storage.objects;
CREATE POLICY "insertar_autenticados_comprobantes_storage"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'comprobantes-proveedores');

DROP POLICY IF EXISTS "lectura_autenticados_comprobantes_storage" ON storage.objects;
CREATE POLICY "lectura_autenticados_comprobantes_storage"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'comprobantes-proveedores');

-- El codigo sube la foto con upsert:true (por si se reintenta subir con el
-- mismo nombre de archivo), lo cual internamente puede requerir permiso de
-- actualizacion ademas de insercion.
DROP POLICY IF EXISTS "actualizar_autenticados_comprobantes_storage" ON storage.objects;
CREATE POLICY "actualizar_autenticados_comprobantes_storage"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'comprobantes-proveedores')
  WITH CHECK (bucket_id = 'comprobantes-proveedores');

-- Nota: la app usa getPublicUrl() para mostrar la foto despues (ej. en el
-- detalle de pedido del admin). Si al abrir esa foto desde un enlace
-- publico da error de acceso, el bucket "comprobantes-proveedores" tambien
-- debe marcarse como "Public bucket" en Supabase Dashboard -> Storage ->
-- (seleccionar el bucket) -> Settings. Eso no se puede hacer por SQL.
