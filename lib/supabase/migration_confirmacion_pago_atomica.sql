-- migration_confirmacion_pago_atomica.sql
-- Fase 1, punto 7 de docs/auditoria_plan_correcciones_ia.md
--
-- Reemplaza las actualizaciones directas de ol_pedidos.pago_confirmado
-- (hoy hechas desde app/asignaciones/page.tsx con .update()) por dos RPC
-- atómicas, auditables e idempotentes por request_id.
--
-- No toca ol_pedidos.estado ni el flujo que lee la tienda.
-- Idempotente: puede reejecutarse.

-- ---------------------------------------------------------------------------
-- 1. Columnas de soporte en la bitácora existente (append-only)
-- ---------------------------------------------------------------------------

ALTER TABLE public.ol_pedidos_verificaciones
  ADD COLUMN IF NOT EXISTS request_id UUID,
  ADD COLUMN IF NOT EXISTS evidencia_path TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ol_pedidos_verificaciones_request_id
  ON public.ol_pedidos_verificaciones(request_id)
  WHERE request_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. confirmar_pago_admin
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirmar_pago_admin(
  p_pedido_id UUID,
  p_referencia TEXT,
  p_banco TEXT DEFAULT NULL,
  p_fecha DATE DEFAULT NULL,
  p_evidencia_path TEXT DEFAULT NULL,
  p_request_id UUID DEFAULT NULL
)
RETURNS public.ol_pedidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido ol_pedidos;
  v_existe_request RECORD;
BEGIN
  IF NOT rep_puede_confirmar_pago() THEN
    RAISE EXCEPTION 'No autorizado para confirmar pagos' USING ERRCODE = '42501';
  END IF;

  -- Idempotencia: si este request_id ya se procesó, devolver el resultado ya obtenido.
  IF p_request_id IS NOT NULL THEN
    SELECT pedido_id INTO v_existe_request
    FROM ol_pedidos_verificaciones
    WHERE request_id = p_request_id
    LIMIT 1;

    IF FOUND THEN
      SELECT * INTO v_pedido FROM ol_pedidos WHERE id = v_existe_request.pedido_id;
      RETURN v_pedido;
    END IF;
  END IF;

  SELECT * INTO v_pedido FROM ol_pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido % no existe', p_pedido_id;
  END IF;

  IF v_pedido.pago_confirmado THEN
    RAISE EXCEPTION 'El pago de este pedido ya está confirmado' USING ERRCODE = '22023';
  END IF;

  IF p_referencia IS NULL OR btrim(p_referencia) = '' THEN
    RAISE EXCEPTION 'La referencia del comprobante es obligatoria';
  END IF;

  UPDATE ol_pedidos
     SET pago_confirmado = true,
         referencia_transferencia = btrim(p_referencia)
   WHERE id = p_pedido_id
  RETURNING * INTO v_pedido;

  INSERT INTO ol_pedidos_verificaciones (
    pedido_id, accion, referencia, banco, fecha_deposito,
    admin_user_id, admin_nombre, evidencia_path, request_id
  ) VALUES (
    p_pedido_id, 'confirmado', btrim(p_referencia), p_banco, p_fecha,
    auth.uid(),
    COALESCE((SELECT nombre FROM rep_repartidores WHERE user_id = auth.uid()), auth.uid()::text),
    p_evidencia_path, p_request_id
  );

  RETURN v_pedido;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. revertir_pago_admin
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revertir_pago_admin(
  p_pedido_id UUID,
  p_motivo TEXT,
  p_request_id UUID DEFAULT NULL
)
RETURNS public.ol_pedidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido ol_pedidos;
  v_existe_request RECORD;
BEGIN
  IF NOT rep_puede_confirmar_pago() THEN
    RAISE EXCEPTION 'No autorizado para revertir pagos' USING ERRCODE = '42501';
  END IF;

  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Debes indicar un motivo para revertir la confirmación de pago';
  END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT pedido_id INTO v_existe_request
    FROM ol_pedidos_verificaciones
    WHERE request_id = p_request_id
    LIMIT 1;

    IF FOUND THEN
      SELECT * INTO v_pedido FROM ol_pedidos WHERE id = v_existe_request.pedido_id;
      RETURN v_pedido;
    END IF;
  END IF;

  SELECT * INTO v_pedido FROM ol_pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido % no existe', p_pedido_id;
  END IF;

  IF NOT v_pedido.pago_confirmado THEN
    RAISE EXCEPTION 'Este pedido no tiene un pago confirmado que revertir' USING ERRCODE = '22023';
  END IF;

  -- No se borra la referencia: queda como rastro histórico de qué comprobante
  -- se había aceptado, tal como exige la auditoría.
  UPDATE ol_pedidos
     SET pago_confirmado = false
   WHERE id = p_pedido_id
  RETURNING * INTO v_pedido;

  INSERT INTO ol_pedidos_verificaciones (
    pedido_id, accion, referencia, notas, admin_user_id, admin_nombre, request_id
  ) VALUES (
    p_pedido_id, 'anulado', v_pedido.referencia_transferencia, btrim(p_motivo),
    auth.uid(),
    COALESCE((SELECT nombre FROM rep_repartidores WHERE user_id = auth.uid()), auth.uid()::text),
    p_request_id
  );

  RETURN v_pedido;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirmar_pago_admin FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revertir_pago_admin FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_pago_admin TO authenticated;
GRANT EXECUTE ON FUNCTION public.revertir_pago_admin TO authenticated;
