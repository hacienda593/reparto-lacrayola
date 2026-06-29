-- 1. Crear la tabla de comprobantes de proveedores vinculada a pedidos
CREATE TABLE IF NOT EXISTS ol_pedidos_comprobantes_proveedor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID NOT NULL REFERENCES ol_pedidos(id) ON DELETE CASCADE,
  tienda_id UUID NOT NULL REFERENCES ol_tiendas(id),
  prov_establecimiento VARCHAR(3) NOT NULL,
  prov_punto_emision VARCHAR(3) NOT NULL,
  prov_secuencial VARCHAR(9) NOT NULL,
  prov_costo_real NUMERIC(10, 2) NOT NULL,
  prov_factura_url TEXT NULL,
  prov_clave_acceso VARCHAR(49) NULL,
  prov_ruc VARCHAR(13) NOT NULL,
  metodo_pago VARCHAR(50) NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Agregar columnas a ol_tiendas para datos del proveedor (RUC y Código Numérico)
ALTER TABLE ol_tiendas
ADD COLUMN IF NOT EXISTS ruc VARCHAR(13) NULL,
ADD COLUMN IF NOT EXISTS codigo_numerico VARCHAR(8) NULL;

-- 3. Registrar el bucket comprobantes-proveedores en Supabase Storage
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'comprobantes-proveedores', 
  'comprobantes-proveedores', 
  true, 
  5242880, 
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 4. Crear politicas de RLS para Storage
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
