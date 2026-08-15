-- migration_endurece_permisos_criticos.sql
-- Fase 1, punto 1 de docs/auditoria_plan_correcciones_ia.md
--
-- Objetivo:
--   1. Fijar search_path en funciones SECURITY DEFINER que no lo tenían.
--   2. Revocar EXECUTE de PUBLIC/anon sobre funciones financieras y operativas
--      críticas, dejando solo a `authenticated` (las funciones siguen validando
--      el rol internamente vía rep_mi_id()/rep_is_admin(), esto es defensa en
--      profundidad, no el control de autorización principal).
--   3. Crear las capacidades por rol (rep_puede_*) que aún no existían.
--
-- No modifica tablas compartidas con la tienda ni ol_pedidos.estado.
-- Idempotente: puede reejecutarse sin efectos adversos.

-- ---------------------------------------------------------------------------
-- 1. search_path faltante
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.conciliar_caja_repartidor(uuid, numeric, uuid, text)
  SET search_path = public;

ALTER FUNCTION public.registrar_busqueda_fallida(text)
  SET search_path = public;

ALTER FUNCTION public.transferir_efectivo_repartidor(uuid, uuid, numeric, text, uuid)
  SET search_path = public;

-- ---------------------------------------------------------------------------
-- 2. Revocar ejecución innecesaria a PUBLIC / anon en funciones críticas
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.actualizar_factura_compra_sri_admin FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cerrar_periodo_colaborador FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.conciliar_caja_repartidor FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finalizar_entrega_atomica FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.liquidar_repartidor_admin FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.registrar_entrega_fallida_atomica FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.registrar_factura_cliente FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reversar_movimiento_liquidacion FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revisar_factura_compra FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sincronizar_facturas_pendientes FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sincronizar_ledger_financiero FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transferir_efectivo_repartidor FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.actualizar_factura_compra_sri_admin TO authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_periodo_colaborador TO authenticated;
GRANT EXECUTE ON FUNCTION public.conciliar_caja_repartidor TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_entrega_atomica TO authenticated;
GRANT EXECUTE ON FUNCTION public.liquidar_repartidor_admin TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_entrega_fallida_atomica TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_factura_cliente TO authenticated;
GRANT EXECUTE ON FUNCTION public.reversar_movimiento_liquidacion TO authenticated;
GRANT EXECUTE ON FUNCTION public.revisar_factura_compra TO authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_facturas_pendientes TO authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_ledger_financiero TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferir_efectivo_repartidor TO authenticated;

-- Nota: se dejan intactas seguimiento_pedido_publico, cliente_tiene_historial
-- y registrar_busqueda_fallida porque están diseñadas para invocarse sin
-- sesión (seguimiento público de pedido, checkout de invitado, analítica de
-- búsqueda). Tampoco se tocan las funciones trg_* porque son disparadores de
-- trigger, no RPC invocadas por el cliente.

-- ---------------------------------------------------------------------------
-- 3. Capacidades por rol (rep_puede_*)
-- ---------------------------------------------------------------------------
-- rep_is_admin() se mantiene por compatibilidad con código existente que aún
-- la usa; estas funciones nuevas reemplazan gradualmente su uso en escritura.

CREATE OR REPLACE FUNCTION public.rep_tiene_rol(VARIADIC roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM rep_roles r
    WHERE r.user_id = auth.uid()
      AND r.activo = true
      AND r.rol = ANY(roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.rep_puede_gestionar_operacion()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rep_tiene_rol('superadmin', 'admin', 'supervisor');
$$;

CREATE OR REPLACE FUNCTION public.rep_puede_confirmar_pago()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rep_tiene_rol('superadmin', 'admin', 'contador');
$$;

CREATE OR REPLACE FUNCTION public.rep_puede_validar_factura_compra()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rep_tiene_rol('superadmin', 'admin', 'contador');
$$;

CREATE OR REPLACE FUNCTION public.rep_puede_liquidar_caja()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rep_tiene_rol('superadmin', 'admin', 'contador');
$$;

CREATE OR REPLACE FUNCTION public.rep_puede_administrar_usuarios()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rep_tiene_rol('superadmin');
$$;

CREATE OR REPLACE FUNCTION public.rep_puede_ver_finanzas()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rep_tiene_rol('superadmin', 'admin', 'contador');
$$;

REVOKE EXECUTE ON FUNCTION public.rep_tiene_rol FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rep_puede_gestionar_operacion FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rep_puede_confirmar_pago FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rep_puede_validar_factura_compra FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rep_puede_liquidar_caja FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rep_puede_administrar_usuarios FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rep_puede_ver_finanzas FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rep_tiene_rol TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_puede_gestionar_operacion TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_puede_confirmar_pago TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_puede_validar_factura_compra TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_puede_liquidar_caja TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_puede_administrar_usuarios TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_puede_ver_finanzas TO authenticated;
