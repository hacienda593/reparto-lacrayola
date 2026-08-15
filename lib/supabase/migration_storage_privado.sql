-- migration_storage_privado.sql
-- Fase 3, punto 10 de docs/auditoria_plan_correcciones_ia.md
--
-- Problema real y explotable hoy: el bucket comprobantes-proveedores es
-- público (public=true) y además tiene una política de storage.objects que
-- da SELECT al rol "public" -- es decir, cualquiera con la URL (sin sesión,
-- sin ser parte de la app) puede ver fotos de entrega, firmas de clientes y
-- facturas de proveedores.
--
-- Cierra el acceso anónimo total. El acceso queda restringido al personal
-- operativo autenticado (rep_roles activo o rep_repartidores activo) más
-- admin -- no a "cualquier usuario autenticado del proyecto", que en este
-- Supabase compartido incluye también a los clientes de la tienda.
--
-- No borra ni mueve ningún archivo existente; las URLs públicas antiguas
-- dejan de funcionar y deben reemplazarse por URLs firmadas (ver
-- lib/supabase/signedUrl.ts y los cambios de frontend en la misma sesión).

UPDATE storage.buckets SET public = false WHERE id = 'comprobantes-proveedores';

DROP POLICY IF EXISTS "Permitir lectura publica de comprobantes" ON storage.objects;

DROP POLICY IF EXISTS "lectura_autenticados_comprobantes_storage" ON storage.objects;
CREATE POLICY "lectura_personal_comprobantes_storage" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'comprobantes-proveedores'
    AND (
      rep_is_admin()
      OR rep_mi_id() IS NOT NULL
    )
  );
