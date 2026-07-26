-- =====================================================================
-- FIX: el "pool" de pedidos confirmados era visible sin sesion
-- =====================================================================
-- La politica ol_pedidos_select (del primer script) permitia ver
-- cualquier pedido con estado = 'confirmado' sin exigir que hubiera
-- una sesion real -- un defecto de diseno, no una politica vieja de
-- desarrollo como las anteriores. Se corrige restringiendo esas
-- politicas a usuarios autenticados.
-- =====================================================================

DROP POLICY IF EXISTS ol_pedidos_select ON ol_pedidos;
CREATE POLICY ol_pedidos_select ON ol_pedidos FOR SELECT
  TO authenticated
  USING (rep_puede_ver_pedido(id));

DROP POLICY IF EXISTS ol_pedidos_update ON ol_pedidos;
CREATE POLICY ol_pedidos_update ON ol_pedidos FOR UPDATE
  TO authenticated
  USING (rep_puede_ver_pedido(id))
  WITH CHECK (rep_puede_ver_pedido(id));

DROP POLICY IF EXISTS ol_pedidos_insert ON ol_pedidos;
CREATE POLICY ol_pedidos_insert ON ol_pedidos FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR rep_is_admin());

DROP POLICY IF EXISTS ol_pedido_items_select ON ol_pedido_items;
CREATE POLICY ol_pedido_items_select ON ol_pedido_items FOR SELECT
  TO authenticated
  USING (rep_puede_ver_pedido(pedido_id));

DROP POLICY IF EXISTS ol_pedido_items_insert ON ol_pedido_items;
CREATE POLICY ol_pedido_items_insert ON ol_pedido_items FOR INSERT
  TO authenticated
  WITH CHECK (rep_puede_ver_pedido(pedido_id));

DROP POLICY IF EXISTS ol_pedido_items_update ON ol_pedido_items;
CREATE POLICY ol_pedido_items_update ON ol_pedido_items FOR UPDATE
  TO authenticated
  USING (rep_puede_ver_pedido(pedido_id))
  WITH CHECK (rep_puede_ver_pedido(pedido_id));
