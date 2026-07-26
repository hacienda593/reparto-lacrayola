-- =====================================================================
-- MIGRACION DE SEGURIDAD: Row Level Security (RLS) en tablas sensibles
-- =====================================================================
-- Hallazgo: rep_asignaciones, ol_pedidos y rep_repartidores (entre otras)
-- no tenian RLS activado. Esto significa que CUALQUIER persona en
-- internet -- sin iniciar sesion, usando solo la clave publica anon que
-- va incluida en el codigo del navegador -- podia leer todos los
-- pedidos (nombre, telefono, direccion, total) y todos los repartidores
-- (email, cedula, efectivo en mano). Confirmado en vivo antes de este
-- script: una consulta anonima devolvio filas reales sin error.
--
-- Esto NO tiene relacion con que comprador y repartidor compartan la
-- misma URL (/repartidor) -- ese filtrado ya existia en el codigo del
-- navegador, pero era solo cosmetico: cualquiera podia saltarselo
-- pidiendole los datos directamente a Supabase. La proteccion real
-- tiene que vivir en la base de datos, que es justo lo que hace este
-- script.
--
-- Ejecuta esto completo en el SQL Editor de tu Dashboard de Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. FUNCIONES DE APOYO (SECURITY DEFINER: pueden leer rep_roles /
--    rep_repartidores para resolver el rol del usuario actual sin
--    caer en un ciclo con las politicas que vamos a crear sobre esas
--    mismas tablas).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION rep_is_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM rep_roles
    WHERE user_id = auth.uid()
      AND activo = true
      AND rol IN ('superadmin', 'admin', 'supervisor', 'contador')
  );
$$;

CREATE OR REPLACE FUNCTION rep_mi_id() RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT id FROM rep_repartidores WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Puede ver un pedido si: es admin, es el cliente dueno del pedido, el
-- pedido esta en el "pool" comun (confirmado, sin comprador aun), o
-- esta asignado a el (como shopper o como rider).
CREATE OR REPLACE FUNCTION rep_puede_ver_pedido(p_pedido_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT
    rep_is_admin()
    OR EXISTS (SELECT 1 FROM ol_pedidos o WHERE o.id = p_pedido_id AND o.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM ol_pedidos o WHERE o.id = p_pedido_id AND o.estado = 'confirmado')
    OR EXISTS (
      SELECT 1 FROM rep_asignaciones a
      WHERE a.pedido_id = p_pedido_id
        AND (a.shopper_id = rep_mi_id() OR a.rider_id = rep_mi_id())
    );
$$;

CREATE OR REPLACE FUNCTION rep_puede_ver_asignacion(p_asignacion_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT
    rep_is_admin()
    OR EXISTS (
      SELECT 1 FROM rep_asignaciones a
      WHERE a.id = p_asignacion_id
        AND (a.shopper_id = rep_mi_id() OR a.rider_id = rep_mi_id())
    );
$$;

-- ---------------------------------------------------------------------
-- 1. rep_roles
-- ---------------------------------------------------------------------
ALTER TABLE rep_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_roles_select ON rep_roles;
CREATE POLICY rep_roles_select ON rep_roles FOR SELECT
  USING (user_id = auth.uid() OR rep_is_admin());

-- Solo se permite auto-registrarse como 'repartidor' (lo que ya hace el
-- login la primera vez). Nadie puede auto-asignarse admin/superadmin.
DROP POLICY IF EXISTS rep_roles_insert ON rep_roles;
CREATE POLICY rep_roles_insert ON rep_roles FOR INSERT
  WITH CHECK ((user_id = auth.uid() AND rol = 'repartidor') OR rep_is_admin());

DROP POLICY IF EXISTS rep_roles_update ON rep_roles;
CREATE POLICY rep_roles_update ON rep_roles FOR UPDATE
  USING ((user_id = auth.uid() AND rol = 'repartidor') OR rep_is_admin())
  WITH CHECK ((user_id = auth.uid() AND rol = 'repartidor') OR rep_is_admin());

DROP POLICY IF EXISTS rep_roles_delete ON rep_roles;
CREATE POLICY rep_roles_delete ON rep_roles FOR DELETE
  USING (rep_is_admin());

-- ---------------------------------------------------------------------
-- 2. rep_repartidores
-- ---------------------------------------------------------------------
ALTER TABLE rep_repartidores ENABLE ROW LEVEL SECURITY;

-- Solo la propia fila (o el admin) puede leerse de la tabla completa.
-- Los datos sensibles (email, cedula, efectivo_en_mano, observaciones,
-- comision) NUNCA se exponen a otros colaboradores. Para los pocos
-- lugares donde SI se necesita mostrar el nombre/telefono de OTRO
-- colaborador (ej. "recogido por Juan", contacto por WhatsApp en el
-- pool de recogida), se usa la vista publica de abajo, que solo expone
-- columnas inofensivas.
DROP POLICY IF EXISTS rep_repartidores_select ON rep_repartidores;
CREATE POLICY rep_repartidores_select ON rep_repartidores FOR SELECT
  USING (user_id = auth.uid() OR rep_is_admin());

-- Vista publica: solo columnas seguras de mostrar entre colaboradores.
-- Al ser propiedad del dueno de la tabla (no del usuario que consulta),
-- no queda sujeta al RLS restrictivo de arriba -- por eso puede
-- devolver el nombre de CUALQUIER colaborador activo sin exponer el
-- resto de sus datos.
CREATE OR REPLACE VIEW rep_repartidores_pub AS
  SELECT id, nombre, telefono, vehiculo, placa, foto_url, activo
  FROM rep_repartidores;

GRANT SELECT ON rep_repartidores_pub TO authenticated;

DROP POLICY IF EXISTS rep_repartidores_insert ON rep_repartidores;
CREATE POLICY rep_repartidores_insert ON rep_repartidores FOR INSERT
  WITH CHECK (user_id = auth.uid() OR rep_is_admin());

DROP POLICY IF EXISTS rep_repartidores_update ON rep_repartidores;
CREATE POLICY rep_repartidores_update ON rep_repartidores FOR UPDATE
  USING (user_id = auth.uid() OR rep_is_admin())
  WITH CHECK (user_id = auth.uid() OR rep_is_admin());

DROP POLICY IF EXISTS rep_repartidores_delete ON rep_repartidores;
CREATE POLICY rep_repartidores_delete ON rep_repartidores FOR DELETE
  USING (rep_is_admin());

-- ---------------------------------------------------------------------
-- 3. rep_asignaciones
-- ---------------------------------------------------------------------
ALTER TABLE rep_asignaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_asignaciones_select ON rep_asignaciones;
CREATE POLICY rep_asignaciones_select ON rep_asignaciones FOR SELECT
  USING (shopper_id = rep_mi_id() OR rider_id = rep_mi_id() OR rep_is_admin());

-- El comprador se auto-asigna un pedido del pool (INSERT con shopper_id = el mismo)
DROP POLICY IF EXISTS rep_asignaciones_insert ON rep_asignaciones;
CREATE POLICY rep_asignaciones_insert ON rep_asignaciones FOR INSERT
  WITH CHECK (shopper_id = rep_mi_id() OR rider_id = rep_mi_id() OR rep_is_admin());

-- Permite: tocar una asignacion propia, o reclamar una del pool que aun
-- no tiene rider (rider_id IS NULL) para pasar a ser su rider.
DROP POLICY IF EXISTS rep_asignaciones_update ON rep_asignaciones;
CREATE POLICY rep_asignaciones_update ON rep_asignaciones FOR UPDATE
  USING (shopper_id = rep_mi_id() OR rider_id = rep_mi_id() OR rider_id IS NULL OR rep_is_admin())
  WITH CHECK (shopper_id = rep_mi_id() OR rider_id = rep_mi_id() OR rep_is_admin());

DROP POLICY IF EXISTS rep_asignaciones_delete ON rep_asignaciones;
CREATE POLICY rep_asignaciones_delete ON rep_asignaciones FOR DELETE
  USING (rep_is_admin());

-- ---------------------------------------------------------------------
-- 4. ol_pedidos
-- ---------------------------------------------------------------------
ALTER TABLE ol_pedidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ol_pedidos_select ON ol_pedidos;
CREATE POLICY ol_pedidos_select ON ol_pedidos FOR SELECT
  USING (rep_puede_ver_pedido(id));

-- El cliente (tienda-lacrayola) crea su propio pedido al hacer checkout.
DROP POLICY IF EXISTS ol_pedidos_insert ON ol_pedidos;
CREATE POLICY ol_pedidos_insert ON ol_pedidos FOR INSERT
  WITH CHECK (user_id = auth.uid() OR rep_is_admin());

DROP POLICY IF EXISTS ol_pedidos_update ON ol_pedidos;
CREATE POLICY ol_pedidos_update ON ol_pedidos FOR UPDATE
  USING (rep_puede_ver_pedido(id))
  WITH CHECK (rep_puede_ver_pedido(id));

DROP POLICY IF EXISTS ol_pedidos_delete ON ol_pedidos;
CREATE POLICY ol_pedidos_delete ON ol_pedidos FOR DELETE
  USING (rep_is_admin());

-- ---------------------------------------------------------------------
-- 5. ol_pedido_items
-- ---------------------------------------------------------------------
ALTER TABLE ol_pedido_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ol_pedido_items_select ON ol_pedido_items;
CREATE POLICY ol_pedido_items_select ON ol_pedido_items FOR SELECT
  USING (rep_puede_ver_pedido(pedido_id));

DROP POLICY IF EXISTS ol_pedido_items_insert ON ol_pedido_items;
CREATE POLICY ol_pedido_items_insert ON ol_pedido_items FOR INSERT
  WITH CHECK (rep_puede_ver_pedido(pedido_id));

DROP POLICY IF EXISTS ol_pedido_items_update ON ol_pedido_items;
CREATE POLICY ol_pedido_items_update ON ol_pedido_items FOR UPDATE
  USING (rep_puede_ver_pedido(pedido_id))
  WITH CHECK (rep_puede_ver_pedido(pedido_id));

DROP POLICY IF EXISTS ol_pedido_items_delete ON ol_pedido_items;
CREATE POLICY ol_pedido_items_delete ON ol_pedido_items FOR DELETE
  USING (rep_is_admin());

-- ---------------------------------------------------------------------
-- 6. rep_picking
-- ---------------------------------------------------------------------
ALTER TABLE rep_picking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_picking_select ON rep_picking;
CREATE POLICY rep_picking_select ON rep_picking FOR SELECT
  USING (rep_puede_ver_pedido(pedido_id) OR rep_puede_ver_asignacion(asignacion_id));

DROP POLICY IF EXISTS rep_picking_insert ON rep_picking;
CREATE POLICY rep_picking_insert ON rep_picking FOR INSERT
  WITH CHECK (rep_puede_ver_asignacion(asignacion_id) OR rep_is_admin());

DROP POLICY IF EXISTS rep_picking_update ON rep_picking;
CREATE POLICY rep_picking_update ON rep_picking FOR UPDATE
  USING (rep_puede_ver_asignacion(asignacion_id) OR rep_is_admin())
  WITH CHECK (rep_puede_ver_asignacion(asignacion_id) OR rep_is_admin());

DROP POLICY IF EXISTS rep_picking_delete ON rep_picking;
CREATE POLICY rep_picking_delete ON rep_picking FOR DELETE
  USING (rep_is_admin());

-- ---------------------------------------------------------------------
-- 7. rep_entregas
-- ---------------------------------------------------------------------
ALTER TABLE rep_entregas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_entregas_select ON rep_entregas;
CREATE POLICY rep_entregas_select ON rep_entregas FOR SELECT
  USING (repartidor_id = rep_mi_id() OR rep_puede_ver_asignacion(asignacion_id));

DROP POLICY IF EXISTS rep_entregas_insert ON rep_entregas;
CREATE POLICY rep_entregas_insert ON rep_entregas FOR INSERT
  WITH CHECK (repartidor_id = rep_mi_id() OR rep_is_admin());

DROP POLICY IF EXISTS rep_entregas_update ON rep_entregas;
CREATE POLICY rep_entregas_update ON rep_entregas FOR UPDATE
  USING (repartidor_id = rep_mi_id() OR rep_is_admin())
  WITH CHECK (repartidor_id = rep_mi_id() OR rep_is_admin());

DROP POLICY IF EXISTS rep_entregas_delete ON rep_entregas;
CREATE POLICY rep_entregas_delete ON rep_entregas FOR DELETE
  USING (rep_is_admin());

-- ---------------------------------------------------------------------
-- 8. rep_transacciones_caja (registro financiero: nadie edita/borra, solo admin)
-- ---------------------------------------------------------------------
ALTER TABLE rep_transacciones_caja ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_transacciones_caja_select ON rep_transacciones_caja;
CREATE POLICY rep_transacciones_caja_select ON rep_transacciones_caja FOR SELECT
  USING (repartidor_id = rep_mi_id() OR rep_is_admin());

DROP POLICY IF EXISTS rep_transacciones_caja_insert ON rep_transacciones_caja;
CREATE POLICY rep_transacciones_caja_insert ON rep_transacciones_caja FOR INSERT
  WITH CHECK (repartidor_id = rep_mi_id() OR rep_is_admin());

DROP POLICY IF EXISTS rep_transacciones_caja_update ON rep_transacciones_caja;
CREATE POLICY rep_transacciones_caja_update ON rep_transacciones_caja FOR UPDATE
  USING (rep_is_admin())
  WITH CHECK (rep_is_admin());

DROP POLICY IF EXISTS rep_transacciones_caja_delete ON rep_transacciones_caja;
CREATE POLICY rep_transacciones_caja_delete ON rep_transacciones_caja FOR DELETE
  USING (rep_is_admin());

-- ---------------------------------------------------------------------
-- 9. rep_liquidaciones (lo arma un proceso de admin/RPC; nadie mas escribe)
-- ---------------------------------------------------------------------
ALTER TABLE rep_liquidaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_liquidaciones_select ON rep_liquidaciones;
CREATE POLICY rep_liquidaciones_select ON rep_liquidaciones FOR SELECT
  USING (repartidor_id = rep_mi_id() OR rep_is_admin());

DROP POLICY IF EXISTS rep_liquidaciones_write ON rep_liquidaciones;
CREATE POLICY rep_liquidaciones_write ON rep_liquidaciones FOR INSERT
  WITH CHECK (rep_is_admin());

DROP POLICY IF EXISTS rep_liquidaciones_update ON rep_liquidaciones;
CREATE POLICY rep_liquidaciones_update ON rep_liquidaciones FOR UPDATE
  USING (rep_is_admin()) WITH CHECK (rep_is_admin());

DROP POLICY IF EXISTS rep_liquidaciones_delete ON rep_liquidaciones;
CREATE POLICY rep_liquidaciones_delete ON rep_liquidaciones FOR DELETE
  USING (rep_is_admin());

-- ---------------------------------------------------------------------
-- 10. ol_tiendas (catalogo de tiendas -- no sensible, pero sin motivo
--     para exponerlo a quien no ha iniciado sesion)
-- ---------------------------------------------------------------------
ALTER TABLE ol_tiendas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ol_tiendas_select ON ol_tiendas;
CREATE POLICY ol_tiendas_select ON ol_tiendas FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS ol_tiendas_write ON ol_tiendas;
CREATE POLICY ol_tiendas_write ON ol_tiendas FOR ALL
  USING (rep_is_admin()) WITH CHECK (rep_is_admin());

-- =====================================================================
-- NOTA: rep_traspasos_efectivo y ol_pedidos_comprobantes_proveedor ya
-- tenian RLS activado por migraciones anteriores de esta misma sesion
-- (lectura para cualquier autenticado; escritura via RPC/politica ya
-- existente) -- no se tocan aqui.
-- =====================================================================
