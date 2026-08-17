-- migration_sec02_storage_abierto.sql
-- SEC-02 de la auditoría (crítico, confirmado con evidencia real): el
-- bucket 'comprobantes-proveedores' (facturas, fotos de entrega, firmas,
-- depósitos) tenía 4 políticas históricas duplicadas que permitían INSERT
-- y UPDATE a CUALQUIER usuario autenticado -- sin verificar rep_mi_id(),
-- a diferencia de la política de lectura que sí lo hacía. Cualquier
-- cliente de la tienda podía subir o REEMPLAZAR evidencia financiera.

DROP POLICY IF EXISTS "Permitir subidas a repartidores autenticados" ON storage.objects;
DROP POLICY IF EXISTS "insertar_autenticados_comprobantes_storage" ON storage.objects;
DROP POLICY IF EXISTS "Permitir actualizacion a repartidores autenticados" ON storage.objects;
DROP POLICY IF EXISTS "actualizar_autenticados_comprobantes_storage" ON storage.objects;

-- INSERT: solo personal operativo real (mismo criterio que ya usa la
-- lectura). No se recrea UPDATE -- la evidencia debe ser inmutable; una
-- corrección sube un archivo nuevo, no reemplaza el existente.
CREATE POLICY "comprobantes_insert_personal_operativo" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'comprobantes-proveedores' AND (rep_is_admin() OR rep_mi_id() IS NOT NULL));
