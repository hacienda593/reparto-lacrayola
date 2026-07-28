-- Corrección de políticas de RLS para el catálogo de tiendas
-- El catálogo es público para que cualquier visitante (huésped o logueado)
-- de la tienda-lacrayola pueda listar los locales y ver sus nombres.

-- 1. Eliminar la política anterior restringida a usuarios autenticados
DROP POLICY IF EXISTS ol_tiendas_select ON ol_tiendas;

-- 2. Crear una nueva política de SELECT que permita lecturas públicas (público/anon y authenticated)
CREATE POLICY ol_tiendas_select ON ol_tiendas FOR SELECT
  USING (true);
