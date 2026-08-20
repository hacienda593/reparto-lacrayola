-- migration_afinidad_tienda_enforcement_servidor.sql
--
-- Hueco real: rep_repartidores_tiendas (afinidad shopper-tienda) y el
-- filtrado del pool en /repartidor eran solo de PANTALLA -- la función que
-- de verdad reclama el pedido (aceptar_pedido_shopper) no comprobaba nada.
-- Un shopper restringido a una tienda podía llamar la función directo
-- (sin pasar por la UI) y tomar pedidos de cualquier otra tienda. Como se
-- ha repetido toda esta sesión: el rol/restricción del lado del cliente
-- nunca es el límite real de seguridad -- esto lo cierra en el servidor,
-- que es donde de verdad importa.
--
-- Si el repartidor NO tiene filas en rep_repartidores_tiendas, sigue
-- viendo y pudiendo tomar cualquier tienda (comportamiento actual, no
-- rompe a nadie). Si SÍ tiene, solo puede tomar tiendas de su lista --
-- incluidos los pedidos donde no se pudo determinar la tienda (se
-- bloquean por el mismo principio ya usado en el filtrado de pantalla:
-- ante la duda, no se le da acceso).

CREATE OR REPLACE FUNCTION public.aceptar_pedido_shopper(
  p_pedido_id UUID,
  p_request_id UUID,
  p_tienda_id UUID DEFAULT NULL
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
  v_num_tiendas INTEGER;
  v_tienda_a_verificar UUID;
  v_tiene_afinidad BOOLEAN;
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

  SELECT COUNT(DISTINCT tienda_id) INTO v_num_tiendas
  FROM ol_pedido_items WHERE pedido_id = p_pedido_id AND tienda_id IS NOT NULL;

  IF v_num_tiendas > 1 AND p_tienda_id IS NULL THEN
    RAISE EXCEPTION 'Este pedido tiene % tiendas -- elige cuál vas a comprar', v_num_tiendas;
  END IF;
  IF p_tienda_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ol_pedido_items WHERE pedido_id = p_pedido_id AND tienda_id = p_tienda_id
  ) THEN
    RAISE EXCEPTION 'Esa tienda no forma parte de este pedido';
  END IF;

  -- Afinidad: si el shopper está restringido a ciertas tiendas
  -- (rep_repartidores_tiendas), solo puede reclamar pedidos de esas
  -- tiendas. Se resuelve la tienda a verificar aunque no venga explícita
  -- en p_tienda_id (pedido de una sola tienda) para no dejar un hueco ahí.
  SELECT EXISTS (SELECT 1 FROM rep_repartidores_tiendas WHERE repartidor_id = v_repartidor_id) INTO v_tiene_afinidad;
  IF v_tiene_afinidad THEN
    v_tienda_a_verificar := p_tienda_id;
    IF v_tienda_a_verificar IS NULL THEN
      SELECT tienda_id INTO v_tienda_a_verificar
      FROM ol_pedido_items WHERE pedido_id = p_pedido_id AND tienda_id IS NOT NULL LIMIT 1;
    END IF;
    IF v_tienda_a_verificar IS NULL OR NOT EXISTS (
      SELECT 1 FROM rep_repartidores_tiendas
      WHERE repartidor_id = v_repartidor_id AND tienda_id = v_tienda_a_verificar
    ) THEN
      RAISE EXCEPTION 'No tienes acceso a esta tienda';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM rep_asignaciones
    WHERE pedido_id = p_pedido_id AND tienda_id IS NOT DISTINCT FROM p_tienda_id
  ) THEN
    RAISE EXCEPTION 'Esta tienda de este pedido ya fue tomada por otro comprador';
  END IF;

  INSERT INTO rep_asignaciones (
    pedido_id, repartidor_id, shopper_id, tienda_id, estado, notas, prioridad, request_id, asignado_por, asignado_at
  ) VALUES (
    p_pedido_id, v_repartidor_id, v_repartidor_id, p_tienda_id, 'asignado',
    'Auto-asignado por el Comprador desde el celular', 1, p_request_id, auth.uid(), NOW()
  )
  RETURNING * INTO v_asignacion;

  PERFORM registrar_evento_pedido(p_pedido_id, v_asignacion.id, 'shopper_asignado', auth.uid(), v_repartidor_id, jsonb_build_object('shopper', v_repartidor.nombre, 'tienda_id', p_tienda_id), p_request_id);

  RETURN v_asignacion;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Esta tienda de este pedido ya fue tomada por otro comprador';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aceptar_pedido_shopper FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceptar_pedido_shopper TO authenticated;
