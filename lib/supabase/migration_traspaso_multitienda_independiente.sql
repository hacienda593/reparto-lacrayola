-- migration_traspaso_multitienda_independiente.sql
--
-- Hallazgo real del usuario: con un pedido repartido entre varios
-- compradores (una asignación por tienda), CADA shopper debe poder
-- entregarle al repartidor lo que él compró -- son entregas físicas
-- independientes (Tuti y Tía pueden estar en puntos distintos, y uno puede
-- terminar antes que el otro). El diseño anterior tenía tres problemas
-- reales:
--
-- 1. crear_traspaso_shopper esperaba a que TODAS las tiendas del pedido
--    estuvieran listas antes de dejar generar CUALQUIER código -- ningún
--    shopper podía traspasar hasta que el otro también terminara.
-- 2. Solo existía un traspaso por pedido: una vez que UNO entregaba, el
--    otro shopper no tenía como entregar lo suyo.
-- 3. aceptar_traspaso_rider marcaba ol_pedidos.estado='enviado' con la
--    PRIMERA entrega aceptada, sin importar si faltaban más tiendas por
--    recoger -- el pedido se daba por "enviado" estando incompleto.
--
-- Además, rep_pedido_empaque_fotos no distinguía de qué asignación era
-- cada bulto -- si dos shoppers del mismo pedido usan "Bulto 1", se
-- mezclaban. Se agrega asignacion_id para separarlos.

ALTER TABLE public.rep_pedido_empaque_fotos ADD COLUMN IF NOT EXISTS asignacion_id UUID REFERENCES public.rep_asignaciones(id);

-- Backfill: todo lo que ya existía es de antes de que hubiera más de una
-- asignación por pedido, así que hay como mucho una asignación por
-- pedido_id a la que asociar cada foto sin ambigüedad.
UPDATE public.rep_pedido_empaque_fotos f
SET asignacion_id = a.id
FROM public.rep_asignaciones a
WHERE f.asignacion_id IS NULL AND a.pedido_id = f.pedido_id;

CREATE INDEX IF NOT EXISTS idx_rep_pedido_empaque_fotos_asignacion ON public.rep_pedido_empaque_fotos(asignacion_id);

-- ---------------------------------------------------------------------------
-- registrar_foto_empaque: ahora ligado a la asignación puntual del shopper
-- que sube la foto, no solo al pedido -- evita que se mezclen bultos de
-- distintos compradores del mismo pedido.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.registrar_foto_empaque(UUID, INT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.registrar_foto_empaque(
  p_pedido_id UUID, p_bulto_numero INT, p_foto_path TEXT, p_asignacion_id UUID DEFAULT NULL, p_request_id UUID DEFAULT NULL
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

  IF p_asignacion_id IS NOT NULL THEN
    IF NOT rep_is_admin() AND NOT EXISTS (
      SELECT 1 FROM rep_asignaciones a
      WHERE a.id = p_asignacion_id AND a.pedido_id = p_pedido_id AND a.shopper_id = rep_mi_id()
        AND a.estado IN ('asignado', 'recolectado')
    ) THEN
      RAISE EXCEPTION 'No eres el comprador responsable de esta asignación';
    END IF;
  ELSIF NOT rep_is_admin() AND NOT EXISTS (
    SELECT 1 FROM rep_asignaciones a
    WHERE a.pedido_id = p_pedido_id AND a.shopper_id = rep_mi_id()
      AND a.estado IN ('asignado', 'recolectado')
  ) THEN
    RAISE EXCEPTION 'No eres el comprador responsable de este pedido';
  END IF;

  INSERT INTO rep_pedido_empaque_fotos (pedido_id, bulto_numero, foto_url, subido_por, asignacion_id)
  VALUES (p_pedido_id, p_bulto_numero, p_foto_path, auth.uid(), p_asignacion_id)
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.registrar_foto_empaque(UUID, INT, TEXT, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_foto_empaque(UUID, INT, TEXT, UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- crear_traspaso_shopper: cada asignación de UNA tienda puede generar su
-- propio código de traspaso apenas ELLA esté lista (items resueltos +
-- fotos de SUS bultos) -- ya no espera a las asignaciones hermanas. Solo
-- el modelo viejo (tienda_id NULL: un shopper cubre todo el pedido en una
-- sola asignación, vía el loop de caja) sigue esperando a que todas las
-- tiendas del pedido estén facturadas, porque ahí sí es la misma persona
-- la que tiene un solo traspaso para todo.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.crear_traspaso_shopper(UUID, NUMERIC, NUMERIC, INT);

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

  -- Solo el modelo de "una asignación cubre todo el pedido" (sin tienda_id)
  -- espera a las demás tiendas -- con asignaciones por tienda, cada shopper
  -- entrega lo suyo apenas está listo, sin esperar a los demás.
  IF v_a.tienda_id IS NULL THEN
    SELECT COUNT(*) INTO v_asignaciones_sin_terminar
    FROM rep_asignaciones
    WHERE pedido_id = v_a.pedido_id AND estado <> 'recolectado';
    IF v_asignaciones_sin_terminar > 0 THEN
      RAISE EXCEPTION 'Aún hay % tienda(s) de este pedido sin terminar de comprar/facturar', v_asignaciones_sin_terminar;
    END IF;
  END IF;

  -- Gate 1: ningún ítem de LA TIENDA de esta asignación puede quedar sin
  -- resolver. Si tienda_id es NULL (modelo viejo), se revisa el pedido
  -- completo, como siempre.
  SELECT COUNT(*) INTO v_items_sin_resolver
  FROM ol_pedido_items
  WHERE pedido_id = v_a.pedido_id
    AND (v_a.tienda_id IS NULL OR tienda_id IS NULL OR tienda_id = v_a.tienda_id)
    AND picking_completado IS NOT TRUE AND picking_agotado IS NOT TRUE;
  IF v_items_sin_resolver > 0 THEN
    RAISE EXCEPTION 'Aún hay % ítem(s) sin marcar como recolectado o agotado', v_items_sin_resolver;
  END IF;

  -- Gate 2: al menos una foto por cada bulto declarado -- de ESTA
  -- asignación puntual (cada shopper empaca y fotografía lo suyo).
  IF p_bultos IS NULL OR p_bultos < 1 THEN
    RAISE EXCEPTION 'Indica cuántos bultos/fundas entregas';
  END IF;
  SELECT COUNT(DISTINCT bulto_numero) INTO v_bultos_con_foto
  FROM rep_pedido_empaque_fotos
  WHERE asignacion_id = p_asignacion_id AND bulto_numero <= p_bultos;
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

-- ---------------------------------------------------------------------------
-- aceptar_traspaso_rider: (a) exige que sea el MISMO repartidor quien
-- recoja todas las tiendas de un pedido -- no se puede partir la entrega
-- entre dos motorizados distintos; (b) ol_pedidos.estado solo pasa a
-- 'enviado' cuando TODAS las asignaciones del pedido ya están en_ruta.
-- ---------------------------------------------------------------------------
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
  v_otro_rider UUID;
  v_pendientes INT;
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

  -- Un pedido de varias tiendas debe recogerlo el MISMO motorizado en
  -- todas sus paradas -- si otra asignación de este pedido ya tiene un
  -- rider distinto asignado, se bloquea (evita partir la entrega en dos).
  SELECT rider_id INTO v_otro_rider
  FROM rep_asignaciones
  WHERE pedido_id = v_a.pedido_id AND id <> v_a.id AND rider_id IS NOT NULL
  LIMIT 1;
  IF v_otro_rider IS NOT NULL AND v_otro_rider <> v_repartidor.id THEN
    RAISE EXCEPTION 'Este pedido ya está siendo recogido por otro motorizado -- contacta al administrador si hay un problema';
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

  -- El pedido solo pasa a 'enviado' cuando TODAS sus tiendas ya fueron
  -- recogidas -- antes se marcaba "enviado" con la primera, dejando el
  -- pedido incompleto marcado como si ya estuviera en camino.
  SELECT COUNT(*) INTO v_pendientes
  FROM rep_asignaciones
  WHERE pedido_id = v_a.pedido_id AND estado <> 'en_ruta';
  IF v_pendientes = 0 THEN
    UPDATE ol_pedidos SET estado = 'enviado' WHERE id = v_a.pedido_id;
  END IF;

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
