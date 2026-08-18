-- migration_evidencia_empaque_traspaso.sql
--
-- Cierra el hueco de trazabilidad entre "se compró" (factura SRI) y "se
-- entregó" (foto+firma al cliente): hoy no hay ninguna evidencia de que lo
-- comprado se empacó completo y se traspasó íntegro al repartidor. Si un
-- cliente reclama que faltan 3 de 20 ítems, no hay forma de saber en qué
-- eslabón se perdieron.
--
-- Agrega:
--  1. rep_pedido_empaque_fotos: foto(s) por bulto/funda, tomadas ANTES de
--     sellar, durante el empaquetado en caja.
--  2. rep_handoffs.bultos_declarados / bultos_confirmados: el shopper
--     declara cuántos bultos entrega al traspasar, el repartidor confirma
--     el mismo número al aceptar -- si no coincide, se abre una incidencia
--     automática (tipo 'faltante', ya contemplado en rep_incidencias).
--  3. crear_traspaso_shopper ahora EXIGE, antes de generar el código de
--     traspaso: (a) que todos los ítems del pedido estén resueltos
--     (picking_completado o picking_agotado, ninguno sin marcar), y (b)
--     que exista al menos una foto por cada bulto declarado.

CREATE TABLE IF NOT EXISTS public.rep_pedido_empaque_fotos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id     UUID NOT NULL REFERENCES public.ol_pedidos(id),
  bulto_numero  INTEGER NOT NULL CHECK (bulto_numero >= 1),
  foto_url      TEXT NOT NULL,
  subido_por    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rep_pedido_empaque_fotos_pedido ON public.rep_pedido_empaque_fotos(pedido_id);

ALTER TABLE public.rep_pedido_empaque_fotos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_pedido_empaque_fotos_select ON public.rep_pedido_empaque_fotos;
CREATE POLICY rep_pedido_empaque_fotos_select ON public.rep_pedido_empaque_fotos FOR SELECT TO authenticated
  USING (
    rep_is_admin()
    OR EXISTS (
      SELECT 1 FROM rep_asignaciones a
      WHERE a.pedido_id = rep_pedido_empaque_fotos.pedido_id
        AND (a.shopper_id = rep_mi_id() OR a.rider_id = rep_mi_id())
    )
  );
-- Sin INSERT/UPDATE/DELETE directo: solo via registrar_foto_empaque().
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rep_pedido_empaque_fotos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rep_pedido_empaque_fotos FROM anon;

ALTER TABLE public.rep_handoffs ADD COLUMN IF NOT EXISTS bultos_declarados INTEGER;
ALTER TABLE public.rep_handoffs ADD COLUMN IF NOT EXISTS bultos_confirmados INTEGER;

-- ---------------------------------------------------------------------------
-- registrar_foto_empaque: el shopper sube 1-2 fotos por bulto mientras
-- empaca, antes de sellarlo. Requiere ser el shopper de una asignación
-- activa de ese pedido (o admin).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_foto_empaque(
  p_pedido_id UUID, p_bulto_numero INT, p_foto_path TEXT, p_request_id UUID DEFAULT NULL
)
RETURNS public.rep_pedido_empaque_fotos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result rep_pedido_empaque_fotos;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF p_bulto_numero < 1 THEN RAISE EXCEPTION 'Número de bulto inválido'; END IF;
  IF NULLIF(TRIM(p_foto_path), '') IS NULL THEN RAISE EXCEPTION 'Falta la foto'; END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_result FROM rep_pedido_empaque_fotos
     WHERE pedido_id = p_pedido_id AND bulto_numero = p_bulto_numero AND foto_url = p_foto_path;
    IF FOUND THEN RETURN v_result; END IF;
  END IF;

  IF NOT rep_is_admin() AND NOT EXISTS (
    SELECT 1 FROM rep_asignaciones a
    WHERE a.pedido_id = p_pedido_id AND a.shopper_id = rep_mi_id()
      AND a.estado IN ('asignado', 'recolectado')
  ) THEN
    RAISE EXCEPTION 'No eres el comprador responsable de este pedido';
  END IF;

  INSERT INTO rep_pedido_empaque_fotos (pedido_id, bulto_numero, foto_url, subido_por)
  VALUES (p_pedido_id, p_bulto_numero, p_foto_path, auth.uid())
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.registrar_foto_empaque FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_foto_empaque TO authenticated;

-- ---------------------------------------------------------------------------
-- crear_traspaso_shopper: se agrega p_bultos y las dos validaciones nuevas.
-- Postgres trata un parámetro nuevo como un OVERLOAD, no un reemplazo --
-- hay que borrar la firma vieja primero o quedan dos funciones con el
-- mismo nombre (ambiguo para REVOKE/GRANT y para quien la llame).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.crear_traspaso_shopper(UUID, NUMERIC, NUMERIC);

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

  -- Cancela cualquier traspaso pendiente previo de esta asignación (permite regenerar código).
  UPDATE rep_handoffs SET estado = 'cancelado' WHERE asignacion_id = p_asignacion_id AND estado = 'pendiente';

  v_token := encode(gen_random_bytes(16), 'hex');           -- 128 bits, va en el QR
  v_codigo := upper(substr(encode(gen_random_bytes(6), 'base64'), 1, 6));
  v_codigo := regexp_replace(v_codigo, '[^A-Z0-9]', 'X', 'g'); -- solo caracteres fáciles de digitar
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

-- ---------------------------------------------------------------------------
-- aceptar_traspaso_rider: se agrega p_bultos_recibidos; si no coincide con
-- lo declarado, se abre una incidencia automática (no bloquea la entrega --
-- el bulto puede ser correcto y solo contarse distinto, o el repartidor
-- puede estar recibiendo dos pedidos juntos; se deja para que el admin lo
-- revise con la foto de respaldo).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.aceptar_traspaso_rider(TEXT, UUID, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.aceptar_traspaso_rider(
  p_token TEXT,
  p_request_id UUID,
  p_lat NUMERIC DEFAULT NULL,
  p_lng NUMERIC DEFAULT NULL,
  p_bultos_recibidos INT DEFAULT NULL
)
RETURNS public.rep_handoffs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_repartidor rep_repartidores;
  v_h rep_handoffs;
  v_a rep_asignaciones;
  v_token_limpio TEXT;
  v_es_codigo_visual BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Falta identificador de operación';
  END IF;

  SELECT * INTO v_h FROM rep_handoffs WHERE request_id = p_request_id;
  IF FOUND THEN
    RETURN v_h;
  END IF;

  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_repartidor.activo OR v_repartidor.estado_registro <> 'aprobado' OR v_repartidor.estado IN ('BLOQUEADO','INACTIVO') THEN
    RAISE EXCEPTION 'Tu cuenta no está habilitada en este momento';
  END IF;

  v_token_limpio := TRIM(p_token);
  v_es_codigo_visual := LENGTH(v_token_limpio) <= 8;

  IF v_es_codigo_visual THEN
    SELECT * INTO v_h FROM rep_handoffs
     WHERE codigo_visual = upper(v_token_limpio)
       AND estado = 'pendiente'
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE;
  ELSE
    SELECT * INTO v_h FROM rep_handoffs
     WHERE token_hash = encode(digest(v_token_limpio, 'sha256'), 'hex')
       AND estado = 'pendiente'
     FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    UPDATE rep_handoffs
       SET intentos = intentos + 1
     WHERE estado = 'pendiente' AND expires_at > NOW() AND v_es_codigo_visual;
    RAISE EXCEPTION 'Código inválido o expirado';
  END IF;

  IF v_h.expires_at <= NOW() THEN
    UPDATE rep_handoffs SET estado = 'expirado' WHERE id = v_h.id;
    RAISE EXCEPTION 'El código de traspaso expiró; pide uno nuevo al comprador';
  END IF;
  IF v_h.intentos >= 8 THEN
    UPDATE rep_handoffs SET estado = 'cancelado' WHERE id = v_h.id;
    RAISE EXCEPTION 'Demasiados intentos fallidos; pide un código nuevo';
  END IF;

  SELECT * INTO v_a FROM rep_asignaciones WHERE id = v_h.asignacion_id FOR UPDATE;
  IF NOT FOUND OR v_a.estado <> 'recolectado' THEN
    UPDATE rep_handoffs SET estado = 'cancelado' WHERE id = v_h.id;
    RAISE EXCEPTION 'La asignación ya no está disponible para traspaso';
  END IF;
  IF v_repartidor.id = v_h.shopper_id THEN
    RAISE EXCEPTION 'El comprador no puede aceptar su propio traspaso; usa "Entregar yo mismo"';
  END IF;

  UPDATE rep_handoffs
     SET estado = 'aceptado', rider_id = v_repartidor.id, accepted_at = NOW(),
         rider_lat = p_lat, rider_lng = p_lng, request_id = p_request_id,
         bultos_confirmados = p_bultos_recibidos
   WHERE id = v_h.id
  RETURNING * INTO v_h;

  UPDATE rep_asignaciones
     SET rider_id = v_repartidor.id,
         repartidor_id = v_repartidor.id,
         handoff_at = NOW(),
         estado = 'en_ruta',
         updated_at = NOW()
   WHERE id = v_a.id;

  UPDATE ol_pedidos SET estado = 'enviado' WHERE id = v_a.pedido_id;

  IF p_bultos_recibidos IS NOT NULL AND v_h.bultos_declarados IS NOT NULL
     AND p_bultos_recibidos <> v_h.bultos_declarados THEN
    INSERT INTO rep_incidencias (pedido_id, tipo, severidad, estado, descripcion, creada_por)
    VALUES (
      v_a.pedido_id, 'faltante', 'media', 'abierta',
      format('Discrepancia de bultos en el traspaso: el comprador declaró %s y el repartidor confirmó %s.', v_h.bultos_declarados, p_bultos_recibidos),
      auth.uid()
    );
  END IF;

  RETURN v_h;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crear_traspaso_shopper FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.aceptar_traspaso_rider FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_traspaso_shopper TO authenticated;
GRANT EXECUTE ON FUNCTION public.aceptar_traspaso_rider TO authenticated;
