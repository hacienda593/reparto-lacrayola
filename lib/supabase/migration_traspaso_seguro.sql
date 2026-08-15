-- migration_traspaso_seguro.sql
-- Fase 1, punto 5 de docs/auditoria_plan_correcciones_ia.md
--
-- Problema real y explotable hoy: app/repartidor/traspaso/[id]/page.tsx
-- muestra un "PIN" que son los últimos 4 caracteres del UUID de la
-- asignación (sin expirar), y app/repartidor/escanear/page.tsx lo valida
-- trayendo TODAS las asignaciones en estado 'recolectado' y comparando en
-- el navegador -- cualquier usuario autenticado (cualquier repartidor)
-- puede probar códigos de 4 caracteres contra ese conjunto sin límite de
-- intentos y robar la custodia de cualquier pedido de la ciudad.
--
-- Reemplaza esto por rep_handoffs: token aleatorio de 128 bits (se guarda
-- solo su hash), código visual de 6 caracteres para digitar a mano,
-- expiración de 8 minutos, límite de intentos, un solo uso, bloqueo de fila.
--
-- No cambia ol_pedidos.estado ni rep_asignaciones.estado más allá de lo que
-- ya hacían las pantallas de traspaso (en_ruta / enviado al aceptar).

CREATE TABLE IF NOT EXISTS public.rep_handoffs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asignacion_id  UUID NOT NULL REFERENCES public.rep_asignaciones(id),
  shopper_id     UUID NOT NULL REFERENCES public.rep_repartidores(id),
  rider_id       UUID REFERENCES public.rep_repartidores(id),
  token_hash     TEXT NOT NULL,
  codigo_visual  VARCHAR(8) NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aceptado','expirado','cancelado')),
  expires_at     TIMESTAMPTZ NOT NULL,
  intentos       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at    TIMESTAMPTZ,
  shopper_lat    NUMERIC,
  shopper_lng    NUMERIC,
  rider_lat      NUMERIC,
  rider_lng      NUMERIC,
  request_id     UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_handoffs_token_hash ON public.rep_handoffs(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_handoffs_request_id ON public.rep_handoffs(request_id) WHERE request_id IS NOT NULL;
-- Solo un traspaso pendiente activo por asignación a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_handoffs_asignacion_pendiente ON public.rep_handoffs(asignacion_id) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_rep_handoffs_codigo_visual ON public.rep_handoffs(codigo_visual) WHERE estado = 'pendiente';

ALTER TABLE public.rep_handoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_handoffs_select ON public.rep_handoffs;
CREATE POLICY rep_handoffs_select ON public.rep_handoffs FOR SELECT TO authenticated
  USING (
    rep_is_admin()
    OR shopper_id = rep_mi_id()
    OR rider_id = rep_mi_id()
  );
-- Todas las escrituras pasan por las RPC (SECURITY DEFINER); no se otorga
-- INSERT/UPDATE/DELETE directo a authenticated sobre esta tabla.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rep_handoffs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rep_handoffs FROM anon;

-- ---------------------------------------------------------------------------
-- crear_traspaso_shopper: genera token + código visual, 8 min de vigencia.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_traspaso_shopper(
  p_asignacion_id UUID,
  p_lat NUMERIC DEFAULT NULL,
  p_lng NUMERIC DEFAULT NULL
)
RETURNS TABLE(handoff_id UUID, token TEXT, codigo_visual TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
-- gen_random_bytes/digest (pgcrypto) viven en el esquema "extensions" en
-- este proyecto de Supabase, no en "public" -- hace falta en el search_path.
SET search_path = public, extensions
AS $$
DECLARE
  v_repartidor rep_repartidores;
  v_a rep_asignaciones;
  v_token TEXT;
  v_codigo TEXT;
  v_id UUID;
  v_expires TIMESTAMPTZ;
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

  -- Cancela cualquier traspaso pendiente previo de esta asignación (permite regenerar código).
  UPDATE rep_handoffs SET estado = 'cancelado' WHERE asignacion_id = p_asignacion_id AND estado = 'pendiente';

  v_token := encode(gen_random_bytes(16), 'hex');           -- 128 bits, va en el QR
  v_codigo := upper(substr(encode(gen_random_bytes(6), 'base64'), 1, 6));
  v_codigo := regexp_replace(v_codigo, '[^A-Z0-9]', 'X', 'g'); -- solo caracteres fáciles de digitar
  v_expires := NOW() + INTERVAL '8 minutes';

  INSERT INTO rep_handoffs (
    asignacion_id, shopper_id, token_hash, codigo_visual, estado, expires_at, shopper_lat, shopper_lng
  ) VALUES (
    p_asignacion_id, v_a.shopper_id, encode(digest(v_token, 'sha256'), 'hex'), v_codigo, 'pendiente', v_expires, p_lat, p_lng
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_token, v_codigo, v_expires;
END;
$$;

-- ---------------------------------------------------------------------------
-- aceptar_traspaso_rider: acepta por token completo (QR) o código visual (PIN).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aceptar_traspaso_rider(
  p_token TEXT,
  p_request_id UUID,
  p_lat NUMERIC DEFAULT NULL,
  p_lng NUMERIC DEFAULT NULL
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
    -- PIN corto: buscar entre traspasos pendientes y no expirados. El
    -- límite de intentos global (no solo por fila) importa aquí porque el
    -- código es corto -- por eso además expira en 8 minutos y es de un solo uso.
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
    -- Penaliza intentos fallidos sobre cualquier traspaso pendiente que
    -- pudiera coincidir por prefijo, para que el límite de intentos frene
    -- fuerza bruta del código visual incluso cuando no hay match exacto.
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
         rider_lat = p_lat, rider_lng = p_lng, request_id = p_request_id
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

  RETURN v_h;
END;
$$;

-- ---------------------------------------------------------------------------
-- cancelar_traspaso_shopper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_traspaso_shopper(p_handoff_id UUID)
RETURNS public.rep_handoffs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_h rep_handoffs;
  v_repartidor rep_repartidores;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión';
  END IF;
  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  SELECT * INTO v_h FROM rep_handoffs WHERE id = p_handoff_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Traspaso no encontrado';
  END IF;
  IF v_h.shopper_id IS DISTINCT FROM v_repartidor.id AND NOT rep_is_admin() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF v_h.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Este traspaso ya no está pendiente (estado: %)', v_h.estado;
  END IF;
  UPDATE rep_handoffs SET estado = 'cancelado' WHERE id = p_handoff_id RETURNING * INTO v_h;
  RETURN v_h;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crear_traspaso_shopper FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.aceptar_traspaso_rider FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancelar_traspaso_shopper FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_traspaso_shopper TO authenticated;
GRANT EXECUTE ON FUNCTION public.aceptar_traspaso_rider TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_traspaso_shopper TO authenticated;
