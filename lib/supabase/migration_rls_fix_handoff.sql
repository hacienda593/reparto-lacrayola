-- =====================================================================
-- MIGRACIÓN SQL: CORRECCIÓN DE SEGURIDAD RLS PARA TRASPASOS (HANDOFF)
-- =====================================================================
-- Ejecuta este script en el SQL Editor de tu Dashboard de Supabase.
-- Corrige el problema que impedía a los motorizados validar el PIN/QR 
-- de pedidos recolectados por shoppers.

-- 1. Actualizar la función rep_puede_ver_pedido para incluir pedidos en 'recolectado' listos para asignar rider
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
        AND (
          a.shopper_id = rep_mi_id() 
          OR a.rider_id = rep_mi_id()
          OR (a.rider_id IS NULL AND a.estado = 'recolectado')
        )
    );
$$;

-- 2. Actualizar la función rep_puede_ver_asignacion para incluir asignaciones en 'recolectado' listas para asignar rider
CREATE OR REPLACE FUNCTION rep_puede_ver_asignacion(p_asignacion_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT
    rep_is_admin()
    OR EXISTS (
      SELECT 1 FROM rep_asignaciones a
      WHERE a.id = p_asignacion_id
        AND (
          a.shopper_id = rep_mi_id() 
          OR a.rider_id = rep_mi_id()
          OR (a.rider_id IS NULL AND a.estado = 'recolectado')
        )
    );
$$;

-- 3. Actualizar la política SELECT de rep_asignaciones para permitir lectura de pedidos en 'recolectado'
DROP POLICY IF EXISTS rep_asignaciones_select ON rep_asignaciones;
CREATE POLICY rep_asignaciones_select ON rep_asignaciones FOR SELECT
  USING (
    shopper_id = rep_mi_id() 
    OR rider_id = rep_mi_id() 
    OR (rider_id IS NULL AND estado = 'recolectado') 
    OR rep_is_admin()
  );
