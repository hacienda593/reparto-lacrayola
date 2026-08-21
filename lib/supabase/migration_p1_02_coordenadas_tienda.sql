-- migration_p1_02_coordenadas_tienda.sql
--
-- P1-02 de la auditoría operativa (docs/auditoria_operativa_aplicacion_entregas_2026-08-21.md):
-- heurística de orden de recogida para pedidos multi-tienda. El
-- esquema no tenía coordenadas de tienda (ol_tiendas solo tiene
-- "direccion" en texto), así que no había forma de calcular distancia
-- real entre paradas -- P1-01 (ya aplicado) solo podía ofrecer el
-- orden manual de ol_tiendas.orden como sustituto.
--
-- No hay una API de geocodificación con key configurada en este repo
-- (se verificó: no existe GOOGLE_MAPS/GEOCOD/MAPBOX/OPENCAGE en env),
-- así que en vez de inventar coordenadas o pagar por un servicio
-- nuevo sin que el usuario lo decida, se agregan las columnas
-- nullable y se reutiliza el mismo patrón ya usado para direcciones
-- de cliente (pegar un enlace de Google Maps -> /api/geo/resolver-enlace):
-- un admin las carga una vez por tienda desde /repartidores (o donde
-- se decida) y de ahí en adelante la heurística de cercanía real
-- entra a funcionar sola. Mientras falten, el orden sigue
-- degradándose con honestidad al campo manual (ver lib/geo.ts).

ALTER TABLE public.ol_tiendas
  ADD COLUMN IF NOT EXISTS geo_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geo_lng DOUBLE PRECISION;

DROP FUNCTION IF EXISTS public.tiendas_hermanas_pedido(UUID);

CREATE OR REPLACE FUNCTION public.tiendas_hermanas_pedido(p_pedido_id UUID)
RETURNS TABLE(
  asignacion_id UUID, tienda_id UUID, tienda_nombre TEXT, estado TEXT,
  tienda_direccion TEXT, orden_sugerido INT,
  shopper_nombre TEXT, shopper_telefono TEXT,
  geo_lat DOUBLE PRECISION, geo_lng DOUBLE PRECISION
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

  RETURN QUERY
  SELECT a.id, a.tienda_id, t.nombre, a.estado,
         t.direccion, COALESCE(t.orden, 999),
         r.nombre, r.telefono,
         t.geo_lat, t.geo_lng
  FROM rep_asignaciones a
  LEFT JOIN ol_tiendas t ON t.id = a.tienda_id
  LEFT JOIN rep_repartidores r ON r.id = a.shopper_id
  WHERE a.pedido_id = p_pedido_id
  ORDER BY COALESCE(t.orden, 999), t.nombre;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tiendas_hermanas_pedido FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tiendas_hermanas_pedido TO authenticated;
