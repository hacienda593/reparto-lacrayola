-- migration_iniciar_compra_atomica.sql
-- Fase 1, punto 3 de docs/auditoria_plan_correcciones_ia.md
--
-- Reemplaza las dos actualizaciones independientes de iniciarCompra() en
-- app/repartidor/page.tsx (rep_asignaciones.compra_iniciada_at y
-- ol_pedidos.estado='preparado') por una RPC atómica.
--
-- Gap real detectado: la versión actual no verificaba que el actor fuera el
-- shopper responsable, ni el estado del pago para transferencia, ni que el
-- colaborador siguiera activo -- cualquiera con sesión podía llamar el
-- update() de cualquier asignación ajena si conocía su id.
--
-- Idempotente por request_id. Usa una columna propia
-- (compra_iniciada_request_id) para no pisar el request_id que guardó
-- aceptar_pedido_shopper() en la misma fila.

ALTER TABLE public.rep_asignaciones
  ADD COLUMN IF NOT EXISTS compra_iniciada_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_asignaciones_compra_iniciada_request_id
  ON public.rep_asignaciones(compra_iniciada_request_id)
  WHERE compra_iniciada_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.iniciar_compra_shopper(
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
  v_p ol_pedidos;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Falta identificador de operación';
  END IF;

  SELECT * INTO v_a FROM rep_asignaciones WHERE compra_iniciada_request_id = p_request_id;
  IF FOUND THEN
    RETURN v_a;
  END IF;

  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_repartidor.activo OR v_repartidor.estado_registro <> 'aprobado' OR v_repartidor.estado = 'BLOQUEADO' OR v_repartidor.estado = 'INACTIVO' THEN
    RAISE EXCEPTION 'Tu cuenta no está habilitada para comprar en este momento';
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
  IF v_a.compra_iniciada_at IS NOT NULL THEN
    RAISE EXCEPTION 'La compra de esta asignación ya fue iniciada';
  END IF;

  SELECT * INTO v_p FROM ol_pedidos WHERE id = v_a.pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;
  IF v_p.metodo_pago = 'transferencia' AND NOT COALESCE(v_p.pago_confirmado, false) THEN
    RAISE EXCEPTION 'La transferencia de este pedido aún no ha sido validada por administración';
  END IF;

  UPDATE rep_asignaciones
     SET compra_iniciada_at = NOW(), compra_iniciada_request_id = p_request_id
   WHERE id = p_asignacion_id
  RETURNING * INTO v_a;

  UPDATE ol_pedidos SET estado = 'preparado' WHERE id = v_a.pedido_id;

  RETURN v_a;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.iniciar_compra_shopper FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_compra_shopper TO authenticated;
