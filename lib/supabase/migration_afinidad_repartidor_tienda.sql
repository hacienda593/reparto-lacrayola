-- migration_afinidad_repartidor_tienda.sql
--
-- Base para shoppers/repartidores especializados por tienda (útil ya
-- mismo para separar Tía/Tuti si hace falta, y pensado para cuando entren
-- restaurantes: el "shopper" de un restaurante debería ver únicamente los
-- pedidos de SU restaurante, ni siquiera los de otras tiendas).
--
-- Diseño: tabla de afinidad opcional. Un repartidor SIN filas aquí sigue
-- viendo todas las tiendas (comportamiento actual, sin romper nada). Un
-- repartidor CON filas queda restringido exclusivamente a esas tiendas --
-- tanto para ver como para autoasignarse pedidos del pool.
--
-- Lo que falta para el flujo de restaurantes (deliberadamente fuera de
-- esta base): un picking distinto para restaurantes (no hay pasillos ni
-- productos que recorrer, es más bien "cocina confirma listo"), y la
-- vinculación 1 restaurante = 1 usuario dueño/encargado en vez de N
-- shoppers genéricos. Eso se aborda cuando se implemente esa funcionalidad.

CREATE TABLE IF NOT EXISTS public.rep_repartidores_tiendas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repartidor_id  UUID NOT NULL REFERENCES public.rep_repartidores(id) ON DELETE CASCADE,
  tienda_id      UUID NOT NULL REFERENCES public.ol_tiendas(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(repartidor_id, tienda_id)
);
CREATE INDEX IF NOT EXISTS idx_rep_repartidores_tiendas_repartidor ON public.rep_repartidores_tiendas(repartidor_id);

ALTER TABLE public.rep_repartidores_tiendas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_repartidores_tiendas_select ON public.rep_repartidores_tiendas;
CREATE POLICY rep_repartidores_tiendas_select ON public.rep_repartidores_tiendas FOR SELECT TO authenticated
  USING (rep_is_admin() OR repartidor_id = rep_mi_id());

-- Solo administración configura quién queda restringido a qué tienda.
DROP POLICY IF EXISTS rep_repartidores_tiendas_insert ON public.rep_repartidores_tiendas;
CREATE POLICY rep_repartidores_tiendas_insert ON public.rep_repartidores_tiendas FOR INSERT TO authenticated
  WITH CHECK (rep_is_admin());
DROP POLICY IF EXISTS rep_repartidores_tiendas_delete ON public.rep_repartidores_tiendas;
CREATE POLICY rep_repartidores_tiendas_delete ON public.rep_repartidores_tiendas FOR DELETE TO authenticated
  USING (rep_is_admin());
