-- migration_finalizar_compra_atomica.sql
-- Fase 1, punto 4 de docs/auditoria_plan_correcciones_ia.md
--
-- Reemplaza iniciarRuta() en app/picking/[id]/page.tsx, que hoy hace dos
-- update() sueltos sin validar en el servidor nada de lo que la UI exige
-- solo del lado del cliente (que todos los ítems estén resueltos, que
-- quien llama sea el shopper responsable, que la compra ya se haya
-- iniciado).
--
-- Nota de modelo de negocio: a diferencia del modelo de shopper/rider
-- separados que describe la auditoría (con traspaso físico vía PIN, ver
-- punto 5, aún pendiente), este flujo es el "autoservicio": el mismo
-- comprador continúa como repartidor sin traspaso de custodia a otra
-- persona. Por eso esta RPC hace en un solo paso lo que el punto 4
-- describe como "finalizar_compra_shopper" (picking) seguido del cambio a
-- en_ruta/enviado, preservando el comportamiento visible actual de la app
-- en vez de introducir un estado intermedio que la UI no maneja.
--
-- Idempotente por request_id.

ALTER TABLE public.rep_asignaciones
  ADD COLUMN IF NOT EXISTS finalizar_compra_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_asignaciones_finalizar_compra_request_id
  ON public.rep_asignaciones(finalizar_compra_request_id)
  WHERE finalizar_compra_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.finalizar_compra_shopper(
  p_asignacion_id UUID,
  p_request_id UUID
)
RETURNS public.rep_asignaciones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_repartidor rep_repartidores;
  v_a rep_asignaciones;
  v_pendientes INTEGER;
  v_total_items INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Falta identificador de operación';
  END IF;

  SELECT * INTO v_a FROM rep_asignaciones WHERE finalizar_compra_request_id = p_request_id;
  IF FOUND THEN
    RETURN v_a;
  END IF;

  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_repartidor.activo OR v_repartidor.estado_registro <> 'aprobado' OR v_repartidor.estado IN ('BLOQUEADO', 'INACTIVO') THEN
    RAISE EXCEPTION 'Tu cuenta no está habilitada en este momento';
  END IF;

  SELECT * INTO v_a FROM rep_asignaciones WHERE id = p_asignacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asignación no encontrada';
  END IF;
  IF v_a.shopper_id IS DISTINCT FROM v_repartidor.id AND NOT rep_is_admin() THEN
    RAISE EXCEPTION 'No eres el comprador responsable de esta asignación';
  END IF;
  IF v_a.estado <> 'asignado' THEN
    RAISE EXCEPTION 'La asignación no está en estado asignado (actual: %)', v_a.estado;
  END IF;
  IF v_a.compra_iniciada_at IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar la compra antes de finalizarla';
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE NOT COALESCE(picking_completado, false) AND NOT COALESCE(picking_agotado, false))
    INTO v_total_items, v_pendientes
    FROM ol_pedido_items
   WHERE pedido_id = v_a.pedido_id;

  IF v_total_items = 0 THEN
    RAISE EXCEPTION 'El pedido no tiene ítems registrados';
  END IF;
  IF v_pendientes > 0 THEN
    RAISE EXCEPTION 'Quedan % ítem(s) sin resolver (completar o marcar agotado)', v_pendientes;
  END IF;

  UPDATE rep_asignaciones
     SET estado = 'en_ruta',
         rider_id = COALESCE(rider_id, v_repartidor.id),
         finalizar_compra_request_id = p_request_id,
         updated_at = NOW()
   WHERE id = p_asignacion_id
  RETURNING * INTO v_a;

  UPDATE ol_pedidos SET estado = 'enviado' WHERE id = v_a.pedido_id;

  RETURN v_a;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalizar_compra_shopper FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalizar_compra_shopper TO authenticated;
