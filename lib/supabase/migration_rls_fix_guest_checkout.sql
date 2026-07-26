-- =====================================================================
-- FIX: seguimiento de pedido para INVITADOS (sin cuenta) sin exponer
-- el resto de pedidos a cualquiera
-- =====================================================================
-- Las politicas "pedido_own" / "pedido_items_own" dejaban pasar CUALQUIER
-- consulta anonima ("OR auth.uid() IS NULL"), sin exigir que se supiera
-- el id del pedido -- por eso una consulta sin filtro devolvia pedidos
-- de otras personas. Se borran, y en su lugar se crea una funcion que
-- SI exige el id exacto del pedido (el UUID que ya reciben en el link
-- de seguimiento), replicando lo que la pagina de seguimiento de
-- tienda-lacrayola necesita: datos del pedido, items, comprobante de
-- proveedor y nombre/telefono del repartidor asignado.
-- =====================================================================

DROP POLICY IF EXISTS pedido_own ON ol_pedidos;
DROP POLICY IF EXISTS pedido_items_own ON ol_pedido_items;

CREATE OR REPLACE FUNCTION seguimiento_pedido_publico(p_id uuid)
RETURNS json
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT json_build_object(
    'pedido', (SELECT row_to_json(o) FROM (SELECT * FROM ol_pedidos WHERE id = p_id) o),
    'items', (
      SELECT COALESCE(json_agg(i), '[]'::json)
      FROM (
        SELECT codigo, descripcion, cantidad, precio_unitario, picking_completado, picking_agotado
        FROM ol_pedido_items WHERE pedido_id = p_id
      ) i
    ),
    'comprobantes', (
      SELECT COALESCE(json_agg(c), '[]'::json)
      FROM (
        SELECT cp.prov_establecimiento, cp.prov_punto_emision, cp.prov_secuencial,
               cp.prov_costo_real, cp.prov_factura_url, cp.prov_ruc, cp.tienda_id,
               t.nombre AS tienda_nombre
        FROM ol_pedidos_comprobantes_proveedor cp
        LEFT JOIN ol_tiendas t ON t.id = cp.tienda_id
        WHERE cp.pedido_id = p_id
      ) c
    ),
    'repartidor', (
      SELECT row_to_json(r) FROM (
        SELECT rr.nombre, rr.telefono
        FROM rep_asignaciones a
        JOIN rep_repartidores rr ON rr.id = a.repartidor_id
        WHERE a.pedido_id = p_id
        LIMIT 1
      ) r
    )
  );
$$;

GRANT EXECUTE ON FUNCTION seguimiento_pedido_publico(uuid) TO anon, authenticated;
