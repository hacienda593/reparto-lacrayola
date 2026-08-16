-- migration_trazabilidad_liquidacion.sql
-- Trazabilidad real de la liquidación en efectivo, pedida por el negocio:
--   1. Cada depósito/transferencia queda ligado a los pedidos EXACTOS que
--      cubre (ej. "el depósito 2332323 cubre los pedidos #11 y #14"), no
--      solo un monto total sin desglose.
--   2. Un mismo número de referencia bancaria no se puede reutilizar para
--      cubrir otra liquidación (mismo principio que ya aplicamos a las
--      referencias de pago de clientes).
--   3. Bloqueo por antigüedad: si un repartidor tiene efectivo cobrado de
--      un día calendario ANTERIOR sin liquidar, no puede seguir aceptando
--      pedidos hoy -- cierra el hueco de "cogían el dinero en la mañana y
--      lo devolvían al final del día" que no alcanza a cubrir el límite
--      de $40 por sí solo.

-- ---------------------------------------------------------------------------
-- 1. rep_depositos_repartidor: método (depósito/transferencia/entrega a
--    colega), banco, y evitar reutilizar la misma referencia.
-- ---------------------------------------------------------------------------
ALTER TABLE public.rep_depositos_repartidor
  ADD COLUMN IF NOT EXISTS metodo TEXT NOT NULL DEFAULT 'transferencia' CHECK (metodo IN ('deposito_banco','transferencia')),
  ADD COLUMN IF NOT EXISTS banco TEXT;

-- Una referencia+banco ya usada (en un depósito no rechazado) no se puede
-- volver a registrar -- evita que el mismo comprobante "cubra" dos
-- liquidaciones distintas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_depositos_referencia_unica
  ON public.rep_depositos_repartidor(lower(TRIM(referencia)), COALESCE(lower(TRIM(banco)), ''))
  WHERE referencia IS NOT NULL AND estado <> 'rechazado';

-- ---------------------------------------------------------------------------
-- 2. Detalle: qué entregas (pedidos cobrados en efectivo) cubre cada
--    depósito. Una entrega solo puede quedar ligada UNA vez -- no se puede
--    "liquidar" el mismo cobro dos veces con depósitos distintos.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rep_liquidacion_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposito_id  UUID NOT NULL REFERENCES public.rep_depositos_repartidor(id),
  entrega_id   UUID NOT NULL REFERENCES public.rep_entregas(id),
  monto        NUMERIC(12,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entrega_id)
);
CREATE INDEX IF NOT EXISTS idx_rep_liquidacion_items_deposito ON public.rep_liquidacion_items(deposito_id);

ALTER TABLE public.rep_liquidacion_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rep_liquidacion_items_select ON public.rep_liquidacion_items;
CREATE POLICY rep_liquidacion_items_select ON public.rep_liquidacion_items FOR SELECT TO authenticated
  USING (
    rep_puede_liquidar_caja()
    OR EXISTS (SELECT 1 FROM rep_depositos_repartidor d WHERE d.id = deposito_id AND d.repartidor_id = rep_mi_id())
  );
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rep_liquidacion_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rep_liquidacion_items FROM anon;

-- ---------------------------------------------------------------------------
-- 3. crear_deposito_repartidor: ahora exige el detalle de qué pedidos
--    cobrados en efectivo cubre, y el monto debe coincidir exactamente con
--    la suma de esos cobros -- ya no es un número suelto sin respaldo.
--    Firma distinta a la anterior (parámetros nuevos) -- hay que eliminar
--    la versión vieja explícitamente o quedaría como sobrecarga aparte.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.crear_deposito_repartidor(NUMERIC, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.crear_deposito_repartidor(
  p_monto NUMERIC,
  p_referencia TEXT,
  p_comprobante_path TEXT,
  p_request_id UUID,
  p_metodo TEXT DEFAULT 'transferencia',
  p_banco TEXT DEFAULT NULL,
  p_entrega_ids UUID[] DEFAULT NULL
)
RETURNS public.rep_depositos_repartidor
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_repartidor rep_repartidores;
  v_deposito rep_depositos_repartidor;
  v_suma_entregas NUMERIC;
  v_cantidad_entregas INTEGER;
  v_entrega_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Falta identificador de operación'; END IF;
  IF p_metodo NOT IN ('deposito_banco','transferencia') THEN RAISE EXCEPTION 'Método inválido'; END IF;

  SELECT * INTO v_deposito FROM rep_depositos_repartidor WHERE request_id = p_request_id;
  IF FOUND THEN RETURN v_deposito; END IF;

  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe un perfil de repartidor para este usuario'; END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor que cero'; END IF;
  IF p_monto > COALESCE(v_repartidor.efectivo_en_mano, 0) THEN
    RAISE EXCEPTION 'El monto (%) supera tu efectivo en mano (%)', p_monto, v_repartidor.efectivo_en_mano;
  END IF;
  IF NULLIF(TRIM(p_comprobante_path), '') IS NULL THEN
    RAISE EXCEPTION 'Debes adjuntar el comprobante del depósito';
  END IF;
  IF NULLIF(TRIM(p_referencia), '') IS NULL THEN
    RAISE EXCEPTION 'La referencia del depósito/transferencia es obligatoria';
  END IF;
  IF p_entrega_ids IS NULL OR array_length(p_entrega_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecciona los pedidos cobrados en efectivo que cubre este depósito';
  END IF;

  -- Cada entrega debe ser mía, exitosa, cobrada en efectivo, y no estar ya
  -- cubierta por otro depósito.
  SELECT COUNT(*), COALESCE(SUM(e.monto_cobrado), 0)
    INTO v_cantidad_entregas, v_suma_entregas
  FROM rep_entregas e
  WHERE e.id = ANY(p_entrega_ids)
    AND e.repartidor_id = v_repartidor.id
    AND e.exitosa = true
    AND e.metodo_pago = 'efectivo'
    AND NOT EXISTS (SELECT 1 FROM rep_liquidacion_items li WHERE li.entrega_id = e.id);

  IF v_cantidad_entregas <> array_length(p_entrega_ids, 1) THEN
    RAISE EXCEPTION 'Uno o más pedidos seleccionados no son tuyos, no son en efectivo, o ya fueron liquidados en otro depósito';
  END IF;
  IF ROUND(v_suma_entregas, 2) <> ROUND(p_monto, 2) THEN
    RAISE EXCEPTION 'El monto ($%) no coincide con la suma de los pedidos seleccionados ($%)', p_monto, v_suma_entregas;
  END IF;

  INSERT INTO rep_depositos_repartidor (repartidor_id, monto, referencia, comprobante_path, request_id, metodo, banco)
  VALUES (v_repartidor.id, p_monto, TRIM(p_referencia), p_comprobante_path, p_request_id, p_metodo, NULLIF(TRIM(p_banco), ''))
  RETURNING * INTO v_deposito;

  FOREACH v_entrega_id IN ARRAY p_entrega_ids LOOP
    INSERT INTO rep_liquidacion_items (deposito_id, entrega_id, monto)
    SELECT v_deposito.id, v_entrega_id, monto_cobrado FROM rep_entregas WHERE id = v_entrega_id;
  END LOOP;

  RETURN v_deposito;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crear_deposito_repartidor FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_deposito_repartidor TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Bloqueo por antigüedad: efectivo cobrado en un día calendario anterior
--    (hora de Ecuador) y aún sin liquidar impide aceptar nuevos pedidos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rep_tiene_efectivo_vencido(p_repartidor_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM rep_entregas e
    WHERE e.repartidor_id = p_repartidor_id
      AND e.exitosa = true
      AND e.metodo_pago = 'efectivo'
      AND e.monto_cobrado > 0
      AND e.entregado_at < date_trunc('day', NOW() AT TIME ZONE 'America/Guayaquil') AT TIME ZONE 'America/Guayaquil'
      AND NOT EXISTS (SELECT 1 FROM rep_liquidacion_items li WHERE li.entrega_id = e.id)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.rep_tiene_efectivo_vencido FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_tiene_efectivo_vencido TO authenticated;

-- Se aplica en los dos puntos donde un repartidor toma nueva
-- responsabilidad de cobro: autoasignarse un pedido, y hacerse cargo de
-- una ruta de entrega (propia o por traspaso).
CREATE OR REPLACE FUNCTION public.aceptar_pedido_shopper(p_pedido_id UUID, p_request_id UUID)
RETURNS public.rep_asignaciones
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_repartidor_id UUID; v_repartidor rep_repartidores; v_pedido ol_pedidos; v_asignacion rep_asignaciones;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Falta identificador de operación'; END IF;
  SELECT * INTO v_asignacion FROM rep_asignaciones WHERE request_id = p_request_id;
  IF FOUND THEN RETURN v_asignacion; END IF;
  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe un perfil de repartidor para este usuario'; END IF;
  v_repartidor_id := v_repartidor.id;
  IF NOT v_repartidor.activo THEN RAISE EXCEPTION 'Tu cuenta de repartidor está desactivada'; END IF;
  IF v_repartidor.estado_registro <> 'aprobado' THEN RAISE EXCEPTION 'Tu registro aún no ha sido aprobado'; END IF;
  IF v_repartidor.estado = 'BLOQUEADO' THEN RAISE EXCEPTION 'Tienes la cuenta bloqueada por exceso de efectivo en mano; liquida antes de aceptar más pedidos'; END IF;
  IF v_repartidor.estado = 'INACTIVO' THEN RAISE EXCEPTION 'Tu cuenta está inactiva'; END IF;
  IF rep_tiene_efectivo_vencido(v_repartidor_id) THEN
    RAISE EXCEPTION 'Tienes efectivo cobrado de un día anterior sin liquidar. Deposítalo en "Mi Caja" antes de aceptar más pedidos.';
  END IF;
  SELECT * INTO v_pedido FROM ol_pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF v_pedido.estado <> 'confirmado' THEN RAISE EXCEPTION 'Este pedido ya no está disponible para aceptar (estado actual: %)', v_pedido.estado; END IF;
  IF v_repartidor.zona_id IS NOT NULL AND v_pedido.zona_id IS NOT NULL AND v_repartidor.zona_id IS DISTINCT FROM v_pedido.zona_id THEN
    RAISE EXCEPTION 'Este pedido pertenece a otra zona de cobertura';
  END IF;
  IF EXISTS (SELECT 1 FROM rep_asignaciones WHERE pedido_id = p_pedido_id) THEN
    RAISE EXCEPTION 'Este pedido ya fue tomado por otro repartidor';
  END IF;
  INSERT INTO rep_asignaciones (pedido_id, repartidor_id, shopper_id, estado, notas, prioridad, request_id, asignado_por, asignado_at)
  VALUES (p_pedido_id, v_repartidor_id, v_repartidor_id, 'asignado', 'Auto-asignado por el Comprador desde el celular', 1, p_request_id, auth.uid(), NOW())
  RETURNING * INTO v_asignacion;
  PERFORM registrar_evento_pedido(p_pedido_id, v_asignacion.id, 'shopper_asignado', auth.uid(), v_repartidor_id, jsonb_build_object('shopper', v_repartidor.nombre), p_request_id);
  RETURN v_asignacion;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'Este pedido ya fue tomado por otro repartidor';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aceptar_pedido_shopper FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceptar_pedido_shopper TO authenticated;

CREATE OR REPLACE FUNCTION public.iniciar_ruta_repartidor(
  p_asignacion_id UUID,
  p_request_id UUID,
  p_lat NUMERIC DEFAULT NULL,
  p_lng NUMERIC DEFAULT NULL
)
RETURNS public.rep_asignaciones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_repartidor rep_repartidores;
  v_a rep_asignaciones;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Falta identificador de operación'; END IF;
  SELECT * INTO v_a FROM rep_asignaciones WHERE iniciar_ruta_request_id = p_request_id;
  IF FOUND THEN RETURN v_a; END IF;
  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_repartidor.activo OR v_repartidor.estado_registro <> 'aprobado' OR v_repartidor.estado IN ('BLOQUEADO','INACTIVO') THEN
    RAISE EXCEPTION 'Tu cuenta no está habilitada en este momento';
  END IF;
  IF rep_tiene_efectivo_vencido(v_repartidor.id) THEN
    RAISE EXCEPTION 'Tienes efectivo cobrado de un día anterior sin liquidar. Deposítalo en "Mi Caja" antes de iniciar otra ruta.';
  END IF;
  SELECT * INTO v_a FROM rep_asignaciones WHERE id = p_asignacion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asignación no encontrada'; END IF;
  IF v_a.estado = 'recolectado' THEN
    IF v_a.shopper_id IS DISTINCT FROM v_repartidor.id AND NOT rep_is_admin() THEN
      RAISE EXCEPTION 'No eres el comprador responsable de esta asignación';
    END IF;
  ELSIF v_a.estado = 'asignado' THEN
    IF v_a.repartidor_id IS DISTINCT FROM v_repartidor.id AND v_a.rider_id IS DISTINCT FROM v_repartidor.id AND NOT rep_is_admin() THEN
      RAISE EXCEPTION 'No eres el repartidor responsable de esta asignación';
    END IF;
  ELSE
    RAISE EXCEPTION 'La asignación no está en un estado válido para iniciar ruta (actual: %)', v_a.estado;
  END IF;
  UPDATE rep_asignaciones
     SET rider_id = v_repartidor.id, repartidor_id = v_repartidor.id,
         estado = 'en_ruta', iniciar_ruta_request_id = p_request_id, updated_at = NOW()
   WHERE id = p_asignacion_id
  RETURNING * INTO v_a;
  UPDATE ol_pedidos SET estado = 'enviado' WHERE id = v_a.pedido_id;
  PERFORM registrar_evento_pedido(v_a.pedido_id, v_a.id, 'ruta_iniciada', auth.uid(), v_repartidor.id, jsonb_build_object('lat', p_lat, 'lng', p_lng), p_request_id);
  RETURN v_a;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.iniciar_ruta_repartidor FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_ruta_repartidor TO authenticated;

CREATE OR REPLACE FUNCTION public.aceptar_traspaso_rider(p_token TEXT, p_request_id UUID, p_lat NUMERIC DEFAULT NULL, p_lng NUMERIC DEFAULT NULL)
RETURNS public.rep_handoffs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_repartidor rep_repartidores; v_h rep_handoffs; v_a rep_asignaciones; v_token_limpio TEXT; v_es_codigo_visual BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Falta identificador de operación'; END IF;
  SELECT * INTO v_h FROM rep_handoffs WHERE request_id = p_request_id;
  IF FOUND THEN RETURN v_h; END IF;
  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_repartidor.activo OR v_repartidor.estado_registro <> 'aprobado' OR v_repartidor.estado IN ('BLOQUEADO','INACTIVO') THEN
    RAISE EXCEPTION 'Tu cuenta no está habilitada en este momento';
  END IF;
  IF rep_tiene_efectivo_vencido(v_repartidor.id) THEN
    RAISE EXCEPTION 'Tienes efectivo cobrado de un día anterior sin liquidar. Deposítalo en "Mi Caja" antes de recibir otra entrega.';
  END IF;
  v_token_limpio := TRIM(p_token);
  v_es_codigo_visual := LENGTH(v_token_limpio) <= 8;
  IF v_es_codigo_visual THEN
    SELECT * INTO v_h FROM rep_handoffs WHERE codigo_visual = upper(v_token_limpio) AND estado = 'pendiente' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  ELSE
    SELECT * INTO v_h FROM rep_handoffs WHERE token_hash = encode(digest(v_token_limpio, 'sha256'), 'hex') AND estado = 'pendiente' FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    UPDATE rep_handoffs SET intentos = intentos + 1 WHERE estado = 'pendiente' AND expires_at > NOW() AND v_es_codigo_visual;
    RAISE EXCEPTION 'Código inválido o expirado';
  END IF;
  IF v_h.expires_at <= NOW() THEN UPDATE rep_handoffs SET estado = 'expirado' WHERE id = v_h.id; RAISE EXCEPTION 'El código de traspaso expiró; pide uno nuevo al comprador'; END IF;
  IF v_h.intentos >= 8 THEN UPDATE rep_handoffs SET estado = 'cancelado' WHERE id = v_h.id; RAISE EXCEPTION 'Demasiados intentos fallidos; pide un código nuevo'; END IF;
  SELECT * INTO v_a FROM rep_asignaciones WHERE id = v_h.asignacion_id FOR UPDATE;
  IF NOT FOUND OR v_a.estado <> 'recolectado' THEN UPDATE rep_handoffs SET estado = 'cancelado' WHERE id = v_h.id; RAISE EXCEPTION 'La asignación ya no está disponible para traspaso'; END IF;
  IF v_repartidor.id = v_h.shopper_id THEN RAISE EXCEPTION 'El comprador no puede aceptar su propio traspaso; usa "Entregar yo mismo"'; END IF;
  UPDATE rep_handoffs SET estado = 'aceptado', rider_id = v_repartidor.id, accepted_at = NOW(), rider_lat = p_lat, rider_lng = p_lng, request_id = p_request_id WHERE id = v_h.id RETURNING * INTO v_h;
  UPDATE rep_asignaciones SET rider_id = v_repartidor.id, repartidor_id = v_repartidor.id, handoff_at = NOW(), estado = 'en_ruta', updated_at = NOW() WHERE id = v_a.id;
  UPDATE ol_pedidos SET estado = 'enviado' WHERE id = v_a.pedido_id;
  PERFORM registrar_evento_pedido(v_a.pedido_id, v_a.id, 'custodia_transferida', auth.uid(), v_repartidor.id, jsonb_build_object('shopper_id', v_h.shopper_id), p_request_id);
  RETURN v_h;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aceptar_traspaso_rider FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceptar_traspaso_rider TO authenticated;
