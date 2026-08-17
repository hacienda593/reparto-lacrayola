-- ⚠️ HISTÓRICO -- ya aplicado, no reejecutar sin revisar antes (SEC-08,
-- docs/auditoria_funcionalidad_seguridad_trazabilidad.md). Este script
-- busca CUALQUIER política que contenga el texto literal 'rep_is_admin()'
-- y la reescribe por búsqueda de texto -- frágil: si se reejecuta después
-- de agregar políticas nuevas que también usen 'rep_is_admin()' (aunque
-- sea dentro de una función, en teoría), podría reescribirlas sin que
-- nadie lo decida explícitamente. Verificado hoy: ningún policy vivo
-- contiene ese texto literal, así que reejecutar esto ahora mismo sería
-- un no-op -- pero no confíes en que siga siendo así en el futuro.

-- migration_rls_capacidades_completo.sql
-- Fase 1, punto 1 de docs/auditoria_plan_correcciones_ia.md (cierre)
--
-- Reemplaza rep_is_admin() por la capacidad específica en TODAS las
-- políticas RLS restantes (~60, en ~30 tablas), según la matriz de la
-- auditoría. Antes solo estaba aplicado en 8 RPC nuevas; el resto del
-- esquema seguía tratando a supervisor y contador como si fueran admin
-- para cualquier escritura.
--
-- Mapeo aplicado (coincide con la matriz del documento):
--   Operación (asignar, picking, entregas, repartidores, incidencias,
--     notificaciones, turnos, handoffs, pedidos/direcciones de cliente):
--     rep_puede_gestionar_operacion()  -- superadmin/admin/supervisor
--   Pagos (bitácora de verificación de pago del cliente):
--     rep_puede_confirmar_pago()       -- superadmin/admin/contador
--   Facturas de compra:
--     rep_puede_validar_factura_compra() -- superadmin/admin/contador
--   Caja / liquidaciones / traspasos de efectivo / gastos / comisiones:
--     rep_puede_liquidar_caja()        -- superadmin/admin/contador
--   Reportes financieros de solo lectura (facturación cliente, KPIs,
--     ventas, cuentas por cobrar agregadas):
--     rep_puede_ver_finanzas()         -- superadmin/admin/contador
--   Administración de usuarios / configuración crítica (roles, config,
--     RUC y datos de tiendas usados para la clave del SRI):
--     rep_puede_administrar_usuarios() -- superadmin
--
-- No toca ol_pedidos.estado, no cambia ninguna condición de acceso propio
-- (user_id = auth.uid(), shopper_id/rider_id = rep_mi_id()) -- solo el
-- término rep_is_admin() dentro de cada política. Reconstruye cada
-- política dinámicamente a partir de su definición actual (mismo cmd,
-- mismos roles) para no transcribir 60 políticas a mano.

DO $$
DECLARE
  r RECORD;
  v_capacidad TEXT;
  v_new_qual TEXT;
  v_new_check TEXT;
  v_roles TEXT;
  v_sql TEXT;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check, roles
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual ILIKE '%rep_is_admin()%' OR with_check ILIKE '%rep_is_admin()%')
  LOOP
    v_capacidad := CASE r.tablename
      WHEN 'rep_asignaciones'         THEN 'rep_puede_gestionar_operacion()'
      WHEN 'rep_picking'              THEN 'rep_puede_gestionar_operacion()'
      WHEN 'rep_entregas'             THEN 'rep_puede_gestionar_operacion()'
      WHEN 'rep_notificaciones'       THEN 'rep_puede_gestionar_operacion()'
      WHEN 'rep_turnos'               THEN 'rep_puede_gestionar_operacion()'
      WHEN 'rep_incidencias'          THEN 'rep_puede_gestionar_operacion()'
      WHEN 'rep_handoffs'             THEN 'rep_puede_gestionar_operacion()'
      WHEN 'ol_pedidos'               THEN 'rep_puede_gestionar_operacion()'
      WHEN 'ol_pedido_items'          THEN 'rep_puede_gestionar_operacion()'
      WHEN 'ol_direcciones_cliente'   THEN 'rep_puede_gestionar_operacion()'
      WHEN 'rep_repartidores'         THEN 'rep_puede_gestionar_operacion()'

      WHEN 'rep_roles'                THEN 'rep_puede_administrar_usuarios()'
      WHEN 'rep_configuracion'        THEN 'rep_puede_administrar_usuarios()'
      WHEN 'ol_tiendas'               THEN 'rep_puede_administrar_usuarios()'

      WHEN 'ol_pedidos_verificaciones'          THEN 'rep_puede_confirmar_pago()'
      WHEN 'ol_pedidos_comprobantes_proveedor'  THEN 'rep_puede_validar_factura_compra()'
      WHEN 'rep_facturas_compras'               THEN 'rep_puede_validar_factura_compra()'

      WHEN 'rep_transacciones_caja'      THEN 'rep_puede_liquidar_caja()'
      WHEN 'rep_cuentas_cobrar'          THEN 'rep_puede_liquidar_caja()'
      WHEN 'rep_liquidaciones'           THEN 'rep_puede_liquidar_caja()'
      WHEN 'rep_movimientos_liquidacion' THEN 'rep_puede_liquidar_caja()'
      WHEN 'rep_periodos_pago'           THEN 'rep_puede_liquidar_caja()'
      WHEN 'rep_ledger_movimientos'      THEN 'rep_puede_liquidar_caja()'
      WHEN 'rep_traspasos_efectivo'      THEN 'rep_puede_liquidar_caja()'
      WHEN 'rep_gastos'                  THEN 'rep_puede_liquidar_caja()'
      WHEN 'rep_comisiones'              THEN 'rep_puede_liquidar_caja()'

      WHEN 'rep_facturas_cliente'  THEN 'rep_puede_ver_finanzas()'
      WHEN 'cuentas_por_cobrar'    THEN 'rep_puede_ver_finanzas()'
      WHEN 'kpi_resumen'           THEN 'rep_puede_ver_finanzas()'
      WHEN 'ventas_por_dia'        THEN 'rep_puede_ver_finanzas()'
      ELSE NULL
    END;

    -- Eliminar/crear cuentas de repartidor es administración de usuarios,
    -- aunque el resto de rep_repartidores (ver/editar el propio perfil +
    -- que operación vea a los demás) sea operativo.
    IF r.tablename = 'rep_repartidores' AND r.cmd = 'DELETE' THEN
      v_capacidad := 'rep_puede_administrar_usuarios()';
    END IF;

    IF v_capacidad IS NULL THEN
      RAISE NOTICE 'Sin mapeo definido para tabla %, política % -- se deja sin cambios', r.tablename, r.policyname;
      CONTINUE;
    END IF;

    v_new_qual  := CASE WHEN r.qual IS NOT NULL THEN replace(r.qual, 'rep_is_admin()', v_capacidad) ELSE NULL END;
    v_new_check := CASE WHEN r.with_check IS NOT NULL THEN replace(r.with_check, 'rep_is_admin()', v_capacidad) ELSE NULL END;
    v_roles := array_to_string(r.roles, ', ');

    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);

    v_sql := format('CREATE POLICY %I ON public.%I FOR %s TO %s', r.policyname, r.tablename, r.cmd, v_roles);
    IF v_new_qual IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)', v_new_qual);
    END IF;
    IF v_new_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', v_new_check);
    END IF;
    EXECUTE v_sql;
  END LOOP;
END $$;
