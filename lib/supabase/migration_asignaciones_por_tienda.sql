-- migration_asignaciones_por_tienda.sql
--
-- Hallazgo real del usuario: con un pedido de 2+ tiendas, el pool de
-- autoasignación (aceptar_pedido_shopper) le da el PEDIDO ENTERO al primer
-- comprador que lo reclame -- ol_pedidos_pedido_id_key era único, así que
-- ni siquiera existía la posibilidad de que otro comprador (el que está
-- físicamente en la otra tienda) se asignara su parte. Un pedido Tía+Tuti
-- terminaba obligando a UN solo shopper a cubrir ambas tiendas, aunque haya
-- alguien mejor posicionado en cada una.
--
-- Se agrega rep_asignaciones.tienda_id: cada tienda de un pedido puede
-- reclamarse por separado, por compradores distintos (o el mismo, varias
-- veces). El traspaso al repartidor sigue siendo UNO por pedido (no por
-- tienda) y solo se habilita cuando TODAS las asignaciones del pedido
-- (todas sus tiendas) llegan a 'recolectado'.

ALTER TABLE public.rep_asignaciones ADD COLUMN IF NOT EXISTS tienda_id UUID REFERENCES public.ol_tiendas(id);

-- El único constraint viejo (un solo rep_asignaciones por pedido_id, sin
-- importar tienda) es justo lo que bloqueaba esto.
ALTER TABLE public.rep_asignaciones DROP CONSTRAINT IF EXISTS rep_asignaciones_pedido_id_key;

-- Un comprador por (pedido, tienda) cuando sí se especifica tienda...
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_asignaciones_pedido_tienda
  ON public.rep_asignaciones(pedido_id, tienda_id) WHERE tienda_id IS NOT NULL;
-- ...y como antes (una sola fila) cuando el pedido se asigna completo sin
-- distinguir tienda (pedidos de una sola tienda, o asignación forzada por
-- admin sin elegir tienda -- compatibilidad hacia atrás).
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_asignaciones_pedido_sin_tienda
  ON public.rep_asignaciones(pedido_id) WHERE tienda_id IS NULL;

-- ---------------------------------------------------------------------------
-- aceptar_pedido_shopper: ahora recibe la tienda que se está reclamando.
-- Si el pedido tiene más de una tienda, es obligatorio indicar cuál (el
-- cliente ya la elige en /repartidor antes de llamar esto). Si el pedido
-- es de una sola tienda (o no tiene tienda_id en sus ítems), se comporta
-- exactamente igual que antes.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.aceptar_pedido_shopper(UUID, UUID);

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

-- ---------------------------------------------------------------------------
-- crear_traspaso_shopper: con tiendas repartidas entre varios compradores,
-- el traspaso al repartidor sigue siendo UNO por pedido (todas las tiendas
-- juntas) -- ahora exige que TODAS las asignaciones del pedido (no solo la
-- que llama) estén en 'recolectado' antes de generar el código. Cualquier
-- comprador que haya participado en el pedido puede iniciar el traspaso
-- una vez todas están listas (normalmente el último en terminar).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_traspaso_shopper(
  p_asignacion_id UUID,
  p_lat NUMERIC DEFAULT NULL,
  p_lng NUMERIC DEFAULT NULL,
  p_bultos INT DEFAULT NULL
)
RETURNS TABLE(handoff_id UUID, token TEXT, codigo_visual TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_repartidor rep_repartidores;
  v_a rep_asignaciones;
  v_token TEXT;
  v_codigo TEXT;
  v_id UUID;
  v_expires TIMESTAMPTZ;
  v_items_sin_resolver INT;
  v_bultos_con_foto INT;
  v_asignaciones_sin_terminar INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión';
  END IF;

  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_repartidor.activo OR v_repartidor.estado_registro <> 'aprobado' OR v_repartidor.estado IN ('BLOQUEADO','INACTIVO') THEN
    RAISE EXCEPTION 'Tu cuenta no está habilitada en este momento';
  END IF;

  SELECT * INTO v_a FROM rep_asignaciones WHERE id = p_asignacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asignación no encontrada';
  END IF;
  IF v_a.shopper_id IS DISTINCT FROM v_repartidor.id AND NOT rep_is_admin() THEN
    RAISE EXCEPTION 'No eres el comprador responsable de esta asignación';
  END IF;
  IF v_a.estado <> 'recolectado' THEN
    RAISE EXCEPTION 'La asignación debe estar en estado recolectado (actual: %)', v_a.estado;
  END IF;

  -- Si el pedido se repartió entre varios compradores (una asignación por
  -- tienda), TODAS deben estar 'recolectado' antes de traspasar -- no solo
  -- la de quien está generando el código.
  SELECT COUNT(*) INTO v_asignaciones_sin_terminar
  FROM rep_asignaciones
  WHERE pedido_id = v_a.pedido_id AND estado <> 'recolectado';
  IF v_asignaciones_sin_terminar > 0 THEN
    RAISE EXCEPTION 'Aún hay % tienda(s) de este pedido sin terminar de comprar/facturar', v_asignaciones_sin_terminar;
  END IF;

  -- Gate 1: ningún ítem del pedido puede quedar sin resolver (ni completado
  -- ni marcado agotado) -- evita traspasar un pedido a medio empacar.
  SELECT COUNT(*) INTO v_items_sin_resolver
  FROM ol_pedido_items
  WHERE pedido_id = v_a.pedido_id AND picking_completado IS NOT TRUE AND picking_agotado IS NOT TRUE;
  IF v_items_sin_resolver > 0 THEN
    RAISE EXCEPTION 'Aún hay % ítem(s) sin marcar como recolectado o agotado', v_items_sin_resolver;
  END IF;

  -- Gate 2: al menos una foto por cada bulto declarado.
  IF p_bultos IS NULL OR p_bultos < 1 THEN
    RAISE EXCEPTION 'Indica cuántos bultos/fundas entregas';
  END IF;
  SELECT COUNT(DISTINCT bulto_numero) INTO v_bultos_con_foto
  FROM rep_pedido_empaque_fotos
  WHERE pedido_id = v_a.pedido_id AND bulto_numero <= p_bultos;
  IF v_bultos_con_foto < p_bultos THEN
    RAISE EXCEPTION 'Falta la foto de al menos un bulto (% de % con foto)', v_bultos_con_foto, p_bultos;
  END IF;

  UPDATE rep_handoffs SET estado = 'cancelado' WHERE asignacion_id = p_asignacion_id AND estado = 'pendiente';

  v_token := encode(gen_random_bytes(16), 'hex');
  v_codigo := upper(substr(encode(gen_random_bytes(6), 'base64'), 1, 6));
  v_codigo := regexp_replace(v_codigo, '[^A-Z0-9]', 'X', 'g');
  v_expires := NOW() + INTERVAL '8 minutes';

  INSERT INTO rep_handoffs (
    asignacion_id, shopper_id, token_hash, codigo_visual, estado, expires_at, shopper_lat, shopper_lng, bultos_declarados
  ) VALUES (
    p_asignacion_id, v_a.shopper_id, encode(digest(v_token, 'sha256'), 'hex'), v_codigo, 'pendiente', v_expires, p_lat, p_lng, p_bultos
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_token, v_codigo, v_expires;
END;
$$;
GRANT EXECUTE ON FUNCTION public.crear_traspaso_shopper TO authenticated;
