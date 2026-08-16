-- migration_guardar_costo_envio.sql
-- RPC para que /api/envio/calcular-pedido pueda guardar el envío calculado
-- sin depender de que la RLS de UPDATE en ol_pedidos le abra paso al
-- usuario de turno (rider/shopper) -- consistente con el resto de la app,
-- que ya enruta todo update sensible de ol_pedidos por funciones
-- SECURITY DEFINER en vez de updates directos desde el cliente.
-- No es información sensible (es solo una tarifa calculada), así que
-- alcanza con exigir sesión válida, sin capacidad especial.

CREATE OR REPLACE FUNCTION public.guardar_costo_envio_pedido(p_pedido_id UUID, p_costo_envio NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actual NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF p_costo_envio IS NULL OR p_costo_envio < 0 THEN RAISE EXCEPTION 'Costo de envío inválido'; END IF;

  SELECT costo_envio INTO v_actual FROM ol_pedidos WHERE id = p_pedido_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  -- No pisa un valor ya guardado (ej. si algún día la tienda empieza a
  -- mandarlo, o si ya se calculó antes) -- solo llena el vacío.
  IF v_actual IS NOT NULL THEN RETURN v_actual; END IF;

  UPDATE ol_pedidos SET costo_envio = ROUND(p_costo_envio, 2) WHERE id = p_pedido_id AND costo_envio IS NULL;
  RETURN ROUND(p_costo_envio, 2);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guardar_costo_envio_pedido FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_costo_envio_pedido TO authenticated;
