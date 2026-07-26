-- =====================================================================
-- LIMPIEZA DE POLITICAS VIEJAS "DE DESARROLLO" QUE ANULABAN EL RLS
-- =====================================================================
-- El script anterior (migration_rls_seguridad_general.sql) SI se aplico
-- bien, pero seguia sin servir de nada: en pg_policies aparecieron
-- politicas antiguas tipo "rep_dev_asignaciones" / "dev_tiendas" con
-- USING (true) -- "permitir todo a cualquiera" -- que quedaron de
-- cuando se armo el proyecto por primera vez. Postgres combina todas
-- las politicas de una tabla con OR: basta con que UNA diga "true" para
-- que las demas, por mas estrictas que sean, no sirvan de nada.
--
-- Este script borra esas politicas viejas y, en las tablas que no
-- tenian ninguna proteccion real todavia (cuentas por cobrar,
-- direcciones de clientes, config, etc.), agrega una politica minima
-- correcta en su lugar.
--
-- Ejecuta esto DESPUES de migration_rls_seguridad_general.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Politicas "true para cualquiera" en tablas que YA quedaron
--    correctamente protegidas por el script anterior -- aqui solo se
--    borra el agujero, no hace falta agregar nada mas.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS rep_dev_repartidores  ON rep_repartidores;
DROP POLICY IF EXISTS rep_dev_asignaciones  ON rep_asignaciones;
DROP POLICY IF EXISTS rep_dev_entregas      ON rep_entregas;
DROP POLICY IF EXISTS rep_dev_liquidaciones ON rep_liquidaciones;
DROP POLICY IF EXISTS rep_dev_roles         ON rep_roles;
DROP POLICY IF EXISTS dev_picking           ON rep_picking;
DROP POLICY IF EXISTS dev_tiendas           ON ol_tiendas;

-- Estas dos NO tenian ningun reemplazo real todavia sobre ol_pedidos /
-- ol_pedido_items -- las cubre la politica ol_pedidos_select /
-- ol_pedido_items_select ya creada en el script anterior.
DROP POLICY IF EXISTS "leer pedido por id" ON ol_pedidos;
DROP POLICY IF EXISTS "leer items por pedido" ON ol_pedido_items;

-- ---------------------------------------------------------------------
-- 2. rep_cuentas_cobrar (dinero por cobrar por repartidor -- mismo
--    criterio que rep_transacciones_caja: el dueno o el admin)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS rep_dev_cuentas_cobrar ON rep_cuentas_cobrar;
ALTER TABLE rep_cuentas_cobrar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_cuentas_cobrar_select ON rep_cuentas_cobrar;
CREATE POLICY rep_cuentas_cobrar_select ON rep_cuentas_cobrar FOR SELECT
  USING (repartidor_id = rep_mi_id() OR rep_is_admin());

DROP POLICY IF EXISTS rep_cuentas_cobrar_insert ON rep_cuentas_cobrar;
CREATE POLICY rep_cuentas_cobrar_insert ON rep_cuentas_cobrar FOR INSERT
  WITH CHECK (repartidor_id = rep_mi_id() OR rep_is_admin());

DROP POLICY IF EXISTS rep_cuentas_cobrar_update ON rep_cuentas_cobrar;
CREATE POLICY rep_cuentas_cobrar_update ON rep_cuentas_cobrar FOR UPDATE
  USING (rep_is_admin()) WITH CHECK (rep_is_admin());

DROP POLICY IF EXISTS rep_cuentas_cobrar_delete ON rep_cuentas_cobrar;
CREATE POLICY rep_cuentas_cobrar_delete ON rep_cuentas_cobrar FOR DELETE
  USING (rep_is_admin());

-- ---------------------------------------------------------------------
-- 3. rep_configuracion (parametros globales: cualquier colaborador
--    logueado puede leerlos, solo el admin los cambia)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS rep_dev_configuracion ON rep_configuracion;
ALTER TABLE rep_configuracion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_configuracion_select ON rep_configuracion;
CREATE POLICY rep_configuracion_select ON rep_configuracion FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS rep_configuracion_write ON rep_configuracion;
CREATE POLICY rep_configuracion_write ON rep_configuracion FOR ALL
  USING (rep_is_admin()) WITH CHECK (rep_is_admin());

-- ---------------------------------------------------------------------
-- 4. rep_turnos, rep_comisiones, rep_gastos, rep_notificaciones:
--    no se usan hoy en ningun lugar del codigo (verificado por
--    busqueda en reparto-lacrayola y tienda-lacrayola), asi que se
--    dejan solo para admin -- si en el futuro se activa alguna de
--    estas funciones, se ajusta la politica junto con el codigo que
--    la use.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS rep_dev_turnos ON rep_turnos;
ALTER TABLE rep_turnos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rep_turnos_admin ON rep_turnos;
CREATE POLICY rep_turnos_admin ON rep_turnos FOR ALL
  USING (rep_is_admin()) WITH CHECK (rep_is_admin());

DROP POLICY IF EXISTS rep_dev_comisiones ON rep_comisiones;
ALTER TABLE rep_comisiones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rep_comisiones_admin ON rep_comisiones;
CREATE POLICY rep_comisiones_admin ON rep_comisiones FOR ALL
  USING (rep_is_admin()) WITH CHECK (rep_is_admin());

DROP POLICY IF EXISTS dev_gastos ON rep_gastos;
ALTER TABLE rep_gastos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rep_gastos_admin ON rep_gastos;
CREATE POLICY rep_gastos_admin ON rep_gastos FOR ALL
  USING (rep_is_admin()) WITH CHECK (rep_is_admin());

DROP POLICY IF EXISTS rep_dev_notificaciones ON rep_notificaciones;
ALTER TABLE rep_notificaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rep_notificaciones_admin ON rep_notificaciones;
CREATE POLICY rep_notificaciones_admin ON rep_notificaciones FOR ALL
  USING (rep_is_admin()) WITH CHECK (rep_is_admin());

-- ---------------------------------------------------------------------
-- 5. ol_direcciones_cliente (direcciones guardadas por el cliente en
--    tienda-lacrayola -- cada quien ve solo las suyas)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Permitir select a todos" ON ol_direcciones_cliente;
DROP POLICY IF EXISTS "Permitir inserción y modificación" ON ol_direcciones_cliente;
ALTER TABLE ol_direcciones_cliente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ol_direcciones_cliente_select ON ol_direcciones_cliente;
CREATE POLICY ol_direcciones_cliente_select ON ol_direcciones_cliente FOR SELECT
  USING (user_id = auth.uid() OR rep_is_admin());

DROP POLICY IF EXISTS ol_direcciones_cliente_insert ON ol_direcciones_cliente;
CREATE POLICY ol_direcciones_cliente_insert ON ol_direcciones_cliente FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS ol_direcciones_cliente_update ON ol_direcciones_cliente;
CREATE POLICY ol_direcciones_cliente_update ON ol_direcciones_cliente FOR UPDATE
  USING (user_id = auth.uid() OR rep_is_admin())
  WITH CHECK (user_id = auth.uid() OR rep_is_admin());

DROP POLICY IF EXISTS ol_direcciones_cliente_delete ON ol_direcciones_cliente;
CREATE POLICY ol_direcciones_cliente_delete ON ol_direcciones_cliente FOR DELETE
  USING (user_id = auth.uid() OR rep_is_admin());

-- ---------------------------------------------------------------------
-- 6. rep_clientes_direcciones (agenda interna de direcciones por
--    telefono, sin dueno individual -- se deja para cualquier
--    colaborador logueado, ya no para el publico)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Permitir todo en rep_clientes_direcciones" ON rep_clientes_direcciones;
ALTER TABLE rep_clientes_direcciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_clientes_direcciones_all ON rep_clientes_direcciones;
CREATE POLICY rep_clientes_direcciones_all ON rep_clientes_direcciones FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- =====================================================================
-- Verificacion sugerida despues de correr esto: repetir
--   SELECT tablename, policyname, roles, cmd, qual FROM pg_policies
--   WHERE qual = 'true' OR policyname ILIKE '%dev%';
-- Solo deberian quedar las de catalogos publicos legitimos (productos,
-- terminos de busqueda, etc.), ninguna sobre pedidos, asignaciones,
-- repartidores, dinero o direcciones de clientes.
-- =====================================================================
