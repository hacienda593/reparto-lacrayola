-- migration_comprobante_transferencia_cliente.sql
-- La tienda solo pedía el número de referencia de la transferencia como
-- texto libre; no había forma de adjuntar la foto del comprobante desde el
-- checkout (el cliente tenía que enviarla aparte por WhatsApp, fuera de
-- cualquier registro). Esto agrega:
--   1. Columna en ol_pedidos para guardar la ruta del archivo subido.
--   2. Un bucket privado NUEVO y separado de comprobantes-proveedores --
--      ese bucket es para evidencia interna (entregas, depósitos,
--      facturas de proveedores) subida por personal operativo; mezclar ahí
--      subidas de clientes anónimos de la tienda ampliaría su superficie de
--      escritura sin necesidad. Este bucket es exclusivo para comprobantes
--      de transferencia que sube el propio cliente en el checkout.
--
-- Política de escritura: SOLO INSERT, para anon Y authenticated (el
-- checkout admite compra sin sesión iniciada) -- nunca SELECT/UPDATE/DELETE
-- público, mismo criterio de inmutabilidad de evidencia que ya se usa en
-- comprobantes-proveedores. La lectura queda restringida al personal
-- operativo (rep_is_admin() O rep_mi_id() IS NOT NULL), igual que el otro
-- bucket. El checkout server action (service role, bypassa RLS) es quien
-- valida todo lo demás (precio, stock, referencia duplicada); esta política
-- solo evita que un cliente pueda leer/sobrescribir/borrar comprobantes de
-- OTROS pedidos ni el suyo propio una vez subido.

ALTER TABLE public.ol_pedidos ADD COLUMN IF NOT EXISTS comprobante_transferencia_path TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('comprobantes-clientes', 'comprobantes-clientes', false, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'];

DROP POLICY IF EXISTS "comprobantes_clientes_insert_publico" ON storage.objects;
CREATE POLICY "comprobantes_clientes_insert_publico" ON storage.objects
FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id = 'comprobantes-clientes' AND (storage.foldername(name))[1] = 'pendientes');

DROP POLICY IF EXISTS "comprobantes_clientes_lectura_personal_operativo" ON storage.objects;
CREATE POLICY "comprobantes_clientes_lectura_personal_operativo" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'comprobantes-clientes'
  AND (rep_is_admin() OR rep_mi_id() IS NOT NULL)
);
-- Sin UPDATE ni DELETE para ningún rol público: evidencia inmutable.
