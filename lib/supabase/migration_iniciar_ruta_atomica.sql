-- migration_iniciar_ruta_atomica.sql
-- Fase 1 (endurecimiento) + Fase 6 punto 15 de docs/auditoria_plan_correcciones_ia.md
--
-- app/repartidor/page.tsx tenía 3 copias casi idénticas (autotraspaso,
-- enRuta, activarParada) que hacían las mismas 2 escrituras sueltas y sin
-- validar responsable/rol/estado antes de pasar la asignación a en_ruta y
-- el pedido a enviado. Se unifican en una sola RPC atómica e idempotente.
--
-- Cubre dos casos reales de este modelo de negocio:
--   - shopper que compró y se convierte él mismo en rider (venía de 'recolectado')
--   - rider al que se le asignó directamente la entrega (venía de 'asignado')

ALTER TABLE public.rep_asignaciones
  ADD COLUMN IF NOT EXISTS iniciar_ruta_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_asignaciones_iniciar_ruta_request_id
  ON public.rep_asignaciones(iniciar_ruta_request_id)
  WHERE iniciar_ruta_request_id IS NOT NULL;

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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Falta identificador de operación';
  END IF;

  SELECT * INTO v_a FROM rep_asignaciones WHERE iniciar_ruta_request_id = p_request_id;
  IF FOUND THEN
    RETURN v_a;
  END IF;

  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_repartidor.activo OR v_repartidor.estado_registro <> 'aprobado' OR v_repartidor.estado IN ('BLOQUEADO','INACTIVO') THEN
    RAISE EXCEPTION 'Tu cuenta no está habilitada en este momento';
  END IF;

  SELECT * INTO v_a FROM rep_asignaciones WHERE id = p_asignacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asignación no encontrada';
  END IF;

  IF v_a.estado = 'recolectado' THEN
    -- Autoservicio: el shopper que compró continúa como rider.
    IF v_a.shopper_id IS DISTINCT FROM v_repartidor.id AND NOT rep_is_admin() THEN
      RAISE EXCEPTION 'No eres el comprador responsable de esta asignación';
    END IF;
  ELSIF v_a.estado = 'asignado' THEN
    -- Asignación directa de reparto (sin picking propio del rider).
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
