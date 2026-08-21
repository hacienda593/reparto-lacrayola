-- migration_p1_01_ficha_consolidada.sql
--
-- P1-01 de la auditoría operativa (docs/auditoria_operativa_aplicacion_entregas_2026-08-21.md):
-- cuando un pedido se reparte entre varias tiendas, el repartidor
-- necesita una "ficha" única con todas las tiendas, en qué orden
-- pasar por ellas, y el contacto del comprador de cada una -- no solo
-- el nombre de la tienda que falta (que es todo lo que devolvía
-- tiendas_hermanas_pedido() hasta ahora).
--
-- Se extiende la función existente en vez de crear una nueva, porque
-- los llamadores actuales (repartidor/escanear/page.tsx,
-- repartidor/traspaso/[id]/page.tsx) ya validan participación en el
-- pedido con ella -- agregar columnas no rompe nada, solo las suma.

DROP FUNCTION IF EXISTS public.tiendas_hermanas_pedido(UUID);

CREATE OR REPLACE FUNCTION public.tiendas_hermanas_pedido(p_pedido_id UUID)
RETURNS TABLE(
  asignacion_id UUID, tienda_id UUID, tienda_nombre TEXT, estado TEXT,
  tienda_direccion TEXT, orden_sugerido INT,
  shopper_nombre TEXT, shopper_telefono TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión';
  END IF;

  IF NOT rep_is_admin() AND NOT EXISTS (
    SELECT 1 FROM rep_asignaciones a
    WHERE a.pedido_id = p_pedido_id AND (a.shopper_id = rep_mi_id() OR a.rider_id = rep_mi_id())
  ) THEN
    RAISE EXCEPTION 'No participas en este pedido';
  END IF;

  -- "Orden sugerido": por ahora el campo manual ol_tiendas.orden (ya
  -- existe, se usa para el orden de despliegue en la tienda online) --
  -- no hay coordenadas de tienda en el esquema para calcular por
  -- distancia real (eso es P1-02 de la auditoría, pendiente aparte).
  RETURN QUERY
  SELECT a.id, a.tienda_id, t.nombre, a.estado,
         t.direccion, COALESCE(t.orden, 999),
         r.nombre, r.telefono
  FROM rep_asignaciones a
  LEFT JOIN ol_tiendas t ON t.id = a.tienda_id
  LEFT JOIN rep_repartidores r ON r.id = a.shopper_id
  WHERE a.pedido_id = p_pedido_id
  ORDER BY COALESCE(t.orden, 999), t.nombre;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tiendas_hermanas_pedido FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tiendas_hermanas_pedido TO authenticated;
