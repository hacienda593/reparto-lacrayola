-- migration_fix_aceptar_pedido_estado.sql
-- Corrige un bug introducido en migration_aceptar_pedido_atomico.sql.
--
-- Esa migración asumió (siguiendo el texto literal de la auditoría) que la
-- precondición era ol_pedidos.estado='pendiente'. En el modelo real de esta
-- app NO es así: el pool "Inicio" que ve el shopper en
-- app/repartidor/page.tsx filtra .eq('estado','confirmado') -- 'confirmado'
-- es el estado que deja el admin al verificar pago+GPS y "Liberar al Pool"
-- (app/asignaciones/page.tsx, liberarPedido()). 'pendiente' es previo a esa
-- verificación y nunca debería ser aceptable para autoasignación.
--
-- Con la precondición equivocada, todo shopper que intentaba autoasignarse
-- un pedido ya verificado y liberado recibía "Este pedido ya no está
-- disponible para aceptar (estado actual: confirmado)" -- bloqueando el
-- flujo entero y obligando al admin a asignar manualmente.
--
-- Como ahora el pedido YA llega en 'confirmado' (el admin lo puso ahí), la
-- RPC ya no necesita re-escribir ol_pedidos.estado al aceptar -- se elimina
-- ese UPDATE redundante. La comprobación de duplicado pasa a un EXISTS
-- explícito (antes dependía del UPDATE de estado + el índice único; ahora
-- el índice único de rep_asignaciones(pedido_id) sigue siendo la última
-- línea de defensa contra doble-aceptación concurrente).

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
  IF v_pedido.estado <> 'confirmado' THEN
    RAISE EXCEPTION 'Este pedido ya no está disponible para aceptar (estado actual: %)', v_pedido.estado;
  END IF;
  IF EXISTS (SELECT 1 FROM rep_asignaciones WHERE pedido_id = p_pedido_id) THEN
    RAISE EXCEPTION 'Este pedido ya fue tomado por otro repartidor';
  END IF;

  INSERT INTO rep_asignaciones (
    pedido_id, repartidor_id, shopper_id, estado, notas, prioridad, request_id, asignado_por, asignado_at
  ) VALUES (
    p_pedido_id, v_repartidor_id, v_repartidor_id, 'asignado',
    'Auto-asignado por el Comprador desde el celular', 1, p_request_id, auth.uid(), NOW()
  )
  RETURNING * INTO v_asignacion;

  PERFORM registrar_evento_pedido(p_pedido_id, v_asignacion.id, 'shopper_asignado', auth.uid(), v_repartidor_id, jsonb_build_object('shopper', v_repartidor.nombre), p_request_id);

  RETURN v_asignacion;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Este pedido ya fue tomado por otro repartidor';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aceptar_pedido_shopper FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceptar_pedido_shopper TO authenticated;
