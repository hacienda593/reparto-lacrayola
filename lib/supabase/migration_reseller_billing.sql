-- 1. Agregar columnas a ol_pedidos
ALTER TABLE ol_pedidos 
ADD COLUMN IF NOT EXISTS prov_establecimiento VARCHAR(3) NULL,
ADD COLUMN IF NOT EXISTS prov_punto_emision VARCHAR(3) NULL,
ADD COLUMN IF NOT EXISTS prov_secuencial VARCHAR(9) NULL,
ADD COLUMN IF NOT EXISTS prov_costo_real NUMERIC(10, 2) NULL,
ADD COLUMN IF NOT EXISTS prov_factura_url TEXT NULL,
ADD COLUMN IF NOT EXISTS prov_clave_acceso VARCHAR(49) NULL,
ADD COLUMN IF NOT EXISTS prov_ruc VARCHAR(13) NULL;

-- 2. Registrar el bucket comprobantes-proveedores
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'comprobantes-proveedores', 
  'comprobantes-proveedores', 
  true, 
  5242880, 
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 3. Crear politicas de Storage
DROP POLICY IF EXISTS "Permitir subidas a repartidores autenticados" ON storage.objects;
CREATE POLICY "Permitir subidas a repartidores autenticados"
ON storage.objects FOR INSERT 
TO authenticated
WITH CHECK (bucket_id = 'comprobantes-proveedores');

DROP POLICY IF EXISTS "Permitir lectura publica de comprobantes" ON storage.objects;
CREATE POLICY "Permitir lectura publica de comprobantes"
ON storage.objects FOR SELECT 
TO public
USING (bucket_id = 'comprobantes-proveedores');

DROP POLICY IF EXISTS "Permitir actualizacion a repartidores autenticados" ON storage.objects;
CREATE POLICY "Permitir actualizacion a repartidores autenticados"
ON storage.objects FOR UPDATE 
TO authenticated
USING (bucket_id = 'comprobantes-proveedores')
WITH CHECK (bucket_id = 'comprobantes-proveedores');
