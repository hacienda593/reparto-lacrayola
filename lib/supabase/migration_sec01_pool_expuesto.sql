-- migration_sec01_pool_expuesto.sql
-- SEC-01 de la auditoría (crítico, confirmado con evidencia real): la base
-- de datos es compartida con la app de tienda, donde CUALQUIER cliente
-- normal también es un usuario "authenticated". rep_puede_ver_pedido()
-- dejaba ver (y ACTUALIZAR, por las políticas UPDATE que usan la misma
-- función) cualquier pedido en estado 'confirmado' a CUALQUIER usuario
-- autenticado, sin verificar que fuera personal operativo real -- incluye
-- dirección, teléfono, productos y, vía rep_pedido_eventos, hasta
-- referencia y banco de transferencias. rep_asignaciones tenía el mismo
-- hueco para el pool de "recolectado" sin rider.
--
-- Corrección: las cláusulas de "pool operativo" (confirmado / recolectado
-- sin rider) ahora exigen que el usuario tenga un perfil de
-- rep_repartidores activo y aprobado -- no basta con estar autenticado.
-- El dueño del pedido (o.user_id = auth.uid()) sigue viendo su propio
-- pedido sin restricción adicional, como corresponde.

CREATE OR REPLACE FUNCTION public.rep_puede_ver_pedido(p_pedido_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    rep_is_admin()
    OR EXISTS (SELECT 1 FROM ol_pedidos o WHERE o.id = p_pedido_id AND o.user_id = auth.uid())
    OR (
      -- Personal operativo real: perfil activo y aprobado. Sin esto, un
      -- cliente cualquiera de la tienda caía en las mismas cláusulas.
      EXISTS (SELECT 1 FROM rep_repartidores r WHERE r.user_id = auth.uid() AND r.activo AND r.estado_registro = 'aprobado')
      AND (
        EXISTS (SELECT 1 FROM ol_pedidos o WHERE o.id = p_pedido_id AND o.estado = 'confirmado')
        OR EXISTS (
          SELECT 1 FROM rep_asignaciones a
          WHERE a.pedido_id = p_pedido_id
            AND (
              a.shopper_id = rep_mi_id()
              OR a.rider_id = rep_mi_id()
              OR (a.rider_id IS NULL AND a.estado = 'recolectado')
            )
        )
      )
    );
$function$;

-- Mismo hueco en rep_asignaciones_select/update: el pool de
-- "recolectado sin rider" era visible/editable por cualquier
-- autenticado, sin exigir perfil operativo.
DROP POLICY IF EXISTS rep_asignaciones_select ON public.rep_asignaciones;
CREATE POLICY rep_asignaciones_select ON public.rep_asignaciones FOR SELECT USING (
  shopper_id = rep_mi_id()
  OR rider_id = rep_mi_id()
  OR (
    rider_id IS NULL AND estado = 'recolectado'
    AND EXISTS (SELECT 1 FROM rep_repartidores r WHERE r.user_id = auth.uid() AND r.activo AND r.estado_registro = 'aprobado')
  )
  OR rep_puede_gestionar_operacion()
);

DROP POLICY IF EXISTS rep_asignaciones_update ON public.rep_asignaciones;
CREATE POLICY rep_asignaciones_update ON public.rep_asignaciones FOR UPDATE USING (
  shopper_id = rep_mi_id()
  OR rider_id = rep_mi_id()
  OR (
    rider_id IS NULL
    AND EXISTS (SELECT 1 FROM rep_repartidores r WHERE r.user_id = auth.uid() AND r.activo AND r.estado_registro = 'aprobado')
  )
  OR rep_puede_gestionar_operacion()
);
