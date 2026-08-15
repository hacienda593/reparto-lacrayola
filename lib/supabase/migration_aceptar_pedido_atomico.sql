-- migration_aceptar_pedido_atomico.sql
-- Fase 1, punto 2 de docs/auditoria_plan_correcciones_ia.md
--
-- Reemplaza el insert()+update() separados de aceptarPedido() en
-- app/repartidor/page.tsx por una RPC atómica e idempotente.
--
-- Nota de diagnóstico: rep_asignaciones ya tenía UNIQUE(pedido_id), así que
-- la doble-asignación concurrente por fila ya era imposible a nivel de BD.
-- Lo que faltaba era: atomicidad con ol_pedidos.estado, validar que el
-- repartidor esté activo/aprobado, exigir pedido.estado='pendiente', e
-- idempotencia para reintentos por mala señal.
--
-- No cambia el conjunto de valores de ol_pedidos.estado. Idempotente.

ALTER TABLE public.rep_asignaciones
  ADD COLUMN IF NOT EXISTS request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_asignaciones_request_id
  ON public.rep_asignaciones(request_id)
  WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.aceptar_pedido_shopper(
  p_pedido_id UUID,
  p_request_id UUID
)
RETURNS public.rep_asignaciones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_repartidor_id UUID;
  v_repartidor rep_repartidores;
  v_pedido ol_pedidos;
  v_asignacion rep_asignaciones;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Falta identificador de operación';
  END IF;

  -- Idempotencia: si este request_id ya se procesó, devolver la asignación ya creada.
  SELECT * INTO v_asignacion FROM rep_asignaciones WHERE request_id = p_request_id;
  IF FOUND THEN
    RETURN v_asignacion;
  END IF;

  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe un perfil de repartidor para este usuario';
  END IF;
  v_repartidor_id := v_repartidor.id;

  IF NOT v_repartidor.activo THEN
    RAISE EXCEPTION 'Tu cuenta de repartidor está desactivada';
  END IF;
  IF v_repartidor.estado_registro <> 'aprobado' THEN
    RAISE EXCEPTION 'Tu registro aún no ha sido aprobado';
  END IF;
  IF v_repartidor.estado = 'BLOQUEADO' THEN
    RAISE EXCEPTION 'Tienes la cuenta bloqueada por exceso de efectivo en mano; liquida antes de aceptar más pedidos';
  END IF;
  IF v_repartidor.estado = 'INACTIVO' THEN
    RAISE EXCEPTION 'Tu cuenta está inactiva';
  END IF;

  SELECT * INTO v_pedido FROM ol_pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;
  IF v_pedido.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Este pedido ya no está disponible para aceptar (estado actual: %)', v_pedido.estado;
  END IF;

  -- El índice único en rep_asignaciones(pedido_id) es la última línea de
  -- defensa: si dos shoppers llegan aquí casi al mismo tiempo, el segundo
  -- INSERT falla con violación de unicidad y su transacción se revierte.
  INSERT INTO rep_asignaciones (
    pedido_id, repartidor_id, shopper_id, estado, notas, prioridad, request_id, asignado_por, asignado_at
  ) VALUES (
    p_pedido_id, v_repartidor_id, v_repartidor_id, 'asignado',
    'Auto-asignado por el Comprador desde el celular', 1, p_request_id, auth.uid(), NOW()
  )
  RETURNING * INTO v_asignacion;

  UPDATE ol_pedidos SET estado = 'confirmado' WHERE id = p_pedido_id;

  RETURN v_asignacion;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Este pedido ya fue tomado por otro repartidor';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aceptar_pedido_shopper FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceptar_pedido_shopper TO authenticated;
