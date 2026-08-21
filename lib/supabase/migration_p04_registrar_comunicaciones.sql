-- migration_p04_registrar_comunicaciones.sql
--
-- P0-04 de la auditoría operativa (docs/auditoria_operativa_aplicacion_entregas_2026-08-21.md):
-- la comunicación con el cliente se hace casi toda con enlaces wa.me --
-- abrir el enlace no demuestra que el mensaje se envió, llegó ni fue
-- leído, y no queda ningún registro de qué se le dijo al cliente ni
-- cuándo. Se mantiene WhatsApp como canal (no hay integración con su API
-- todavía), pero cada intención de comunicación queda registrada:
-- quién, a quién, qué mensaje, sobre qué pedido, en qué momento.

CREATE TABLE IF NOT EXISTS public.rep_comunicaciones (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id             UUID REFERENCES public.ol_pedidos(id),
  asignacion_id         UUID REFERENCES public.rep_asignaciones(id),
  tipo                  TEXT NOT NULL CHECK (tipo IN (
                          'pago_observado', 'inicio_compra', 'faltante_sustitucion',
                          'compra_lista', 'recogida_multitienda', 'en_camino',
                          'problema_ubicacion', 'entrega_fallida', 'entregado', 'otro'
                        )),
  canal                 TEXT NOT NULL DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp', 'llamada', 'otro')),
  destinatario_telefono TEXT,
  destinatario_rol      TEXT CHECK (destinatario_rol IN ('cliente', 'shopper', 'rider', 'admin')),
  mensaje               TEXT,
  actor_user_id         UUID,
  actor_repartidor_id   UUID REFERENCES public.rep_repartidores(id),
  request_id            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rep_comunicaciones_pedido ON public.rep_comunicaciones(pedido_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_comunicaciones_request_id ON public.rep_comunicaciones(request_id) WHERE request_id IS NOT NULL;

ALTER TABLE public.rep_comunicaciones ENABLE ROW LEVEL SECURITY;

-- Mismo criterio de visibilidad que rep_pedido_eventos: admin, o quien
-- participa en ese pedido (shopper/rider de alguna asignación).
DROP POLICY IF EXISTS rep_comunicaciones_select ON public.rep_comunicaciones;
CREATE POLICY rep_comunicaciones_select ON public.rep_comunicaciones FOR SELECT TO authenticated
  USING (
    rep_is_admin()
    OR EXISTS (
      SELECT 1 FROM rep_asignaciones a
      WHERE a.pedido_id = rep_comunicaciones.pedido_id AND (a.shopper_id = rep_mi_id() OR a.rider_id = rep_mi_id())
    )
  );
-- Sin INSERT/UPDATE/DELETE directo: solo vía registrar_comunicacion().
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rep_comunicaciones FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rep_comunicaciones FROM anon;

CREATE OR REPLACE FUNCTION public.registrar_comunicacion(
  p_pedido_id UUID, p_tipo TEXT, p_mensaje TEXT,
  p_asignacion_id UUID DEFAULT NULL, p_canal TEXT DEFAULT 'whatsapp',
  p_destinatario_telefono TEXT DEFAULT NULL, p_destinatario_rol TEXT DEFAULT 'cliente',
  p_request_id UUID DEFAULT NULL
)
RETURNS public.rep_comunicaciones
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result rep_comunicaciones;
  v_actor UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_result FROM rep_comunicaciones WHERE request_id = p_request_id;
    IF FOUND THEN RETURN v_result; END IF;
  END IF;

  -- No se exige que el actor tenga un perfil de repartidor (un admin
  -- puro también puede comunicarse), solo que haya sesión. La visibilidad
  -- de quién puede INSERTAR de más ya la cierra el hecho de que esta es
  -- la única vía de escritura (SECURITY DEFINER, sin GRANT directo a la
  -- tabla) -- no hace falta duplicar la validación de "participa en el
  -- pedido" aquí: registrar una comunicación no mueve dinero ni estado.
  SELECT id INTO v_actor FROM rep_repartidores WHERE user_id = auth.uid();

  INSERT INTO rep_comunicaciones (
    pedido_id, asignacion_id, tipo, canal, destinatario_telefono, destinatario_rol,
    mensaje, actor_user_id, actor_repartidor_id, request_id
  ) VALUES (
    p_pedido_id, p_asignacion_id, p_tipo, p_canal, p_destinatario_telefono, p_destinatario_rol,
    p_mensaje, auth.uid(), v_actor, p_request_id
  )
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_comunicacion FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_comunicacion TO authenticated;
