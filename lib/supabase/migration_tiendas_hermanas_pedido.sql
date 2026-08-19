-- migration_tiendas_hermanas_pedido.sql
--
-- Hueco real encontrado en vivo: con un pedido repartido entre varios
-- compradores (una asignación por tienda), la política RLS de
-- rep_asignaciones (shopper_id = rep_mi_id() OR rider_id = rep_mi_id() OR
-- rep_is_admin()) solo deja ver la fila propia -- el shopper de Tuti no
-- podía ver el estado de la tienda de Tía del mismo pedido, así que la
-- pantalla de traspaso no podía mostrarle si ya estaba lista.
--
-- En vez de ampliar el RLS de la tabla completa (expondría columnas como
-- handoff_otp, notas, foto_entrega_url de la asignación ajena), se crea una
-- función acotada que solo devuelve tienda + estado -- lo mínimo necesario
-- para el panel de consolidación -- y solo si quien llama ya participa en
-- ese pedido (o es admin).

CREATE OR REPLACE FUNCTION public.tiendas_hermanas_pedido(p_pedido_id UUID)
RETURNS TABLE(asignacion_id UUID, tienda_id UUID, tienda_nombre TEXT, estado TEXT)
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
  SELECT a.id, a.tienda_id, t.nombre, a.estado
  FROM rep_asignaciones a
  LEFT JOIN ol_tiendas t ON t.id = a.tienda_id
  WHERE a.pedido_id = p_pedido_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tiendas_hermanas_pedido FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tiendas_hermanas_pedido TO authenticated;
