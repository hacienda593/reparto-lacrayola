-- migration_prioridad1_reverso_deposito.sql
-- Prioridad 1 de la auditoría financiera (C3): confirmar el depósito de un
-- repartidor libera su custodia (efectivo_en_mano) ANTES de que
-- verificado_banco confirme que el dinero realmente entró al banco. El
-- mecanismo para devolver el dinero al saldo ya existía
-- (reversar_movimiento_liquidacion), pero al reversar dejaba el depósito
-- marcado como "confirmado" para siempre -- sin volver a quedar disponible
-- para que el repartidor lo re-deposite, y las entregas que cubría
-- seguían "liquidadas" aunque el dinero ya no estuviera.
--
-- Política elegida (opción B de la auditoría): no se bloquea la
-- confirmación rápida del admin (sigue liberando al repartidor de
-- inmediato, para no frenar la operación), pero si más tarde se descubre
-- que el depósito era falso/reversado, el reverso ahora deshace TODO:
-- saldo, estado del depósito, y las entregas vuelven a quedar "sin
-- liquidar" para que se puedan volver a cubrir con un depósito real.

CREATE OR REPLACE FUNCTION reversar_movimiento_liquidacion(p_movimiento_id UUID,p_motivo TEXT)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_mov rep_movimientos_liquidacion; v_saldo NUMERIC; v_deposito rep_depositos_repartidor;
BEGIN
  IF NOT rep_is_admin() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  IF NULLIF(TRIM(p_motivo),'') IS NULL OR LENGTH(TRIM(p_motivo))<8 THEN RAISE EXCEPTION 'Explique el motivo del reverso (mínimo 8 caracteres)'; END IF;
  SELECT * INTO v_mov FROM rep_movimientos_liquidacion WHERE id=p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movimiento no encontrado'; END IF;
  IF v_mov.reversado_at IS NOT NULL THEN RAISE EXCEPTION 'El movimiento ya fue reversado'; END IF;
  SELECT efectivo_en_mano INTO v_saldo FROM rep_repartidores WHERE id=v_mov.repartidor_id FOR UPDATE;
  v_saldo:=COALESCE(v_saldo,0)+v_mov.monto;
  UPDATE rep_repartidores SET efectivo_en_mano=v_saldo WHERE id=v_mov.repartidor_id;
  UPDATE rep_movimientos_liquidacion SET reversado_at=NOW(),reversado_por=auth.uid(),motivo_reverso=TRIM(p_motivo) WHERE id=p_movimiento_id;
  UPDATE rep_liquidaciones SET monto_recibido=GREATEST(0,monto_recibido-v_mov.monto),saldo_despues=v_saldo,estado='con_diferencia',updated_at=NOW() WHERE id=v_mov.liquidacion_id;

  -- Si este movimiento vino de un depósito autoiniciado por el repartidor
  -- (Mi Caja), deshacer también el depósito: ya no puede quedar
  -- "confirmado" si el dinero se está devolviendo al saldo, y las entregas
  -- que cubría vuelven a estar disponibles para un depósito real.
  SELECT * INTO v_deposito FROM rep_depositos_repartidor WHERE liquidacion_id=v_mov.liquidacion_id AND estado='confirmado' FOR UPDATE;
  IF FOUND THEN
    UPDATE rep_depositos_repartidor
      SET estado='rechazado', motivo_rechazo='Reversado: '||TRIM(p_motivo), revisado_por=auth.uid(), revisado_at=NOW()
    WHERE id=v_deposito.id;
    DELETE FROM rep_liquidacion_items WHERE deposito_id=v_deposito.id;
  END IF;

  RETURN v_saldo;
END; $$;
REVOKE ALL ON FUNCTION reversar_movimiento_liquidacion(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reversar_movimiento_liquidacion(UUID,TEXT) TO authenticated;

-- Visibilidad: depósitos confirmados hace más de 48h que TODAVÍA no se
-- verificaron contra el banco -- para que el admin los priorice antes de
-- que se acumulen, en vez de descubrirlos por accidente.
CREATE OR REPLACE FUNCTION admin_depositos_verificacion_atrasada()
RETURNS TABLE(id UUID, repartidor_nombre TEXT, monto NUMERIC, banco TEXT, referencia TEXT, confirmado_at TIMESTAMPTZ, dias_atraso NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT rep_puede_ver_finanzas() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  RETURN QUERY
  SELECT d.id, r.nombre, d.monto, d.banco, d.referencia, d.revisado_at,
         ROUND(EXTRACT(EPOCH FROM (NOW()-d.revisado_at))/86400, 1)
  FROM rep_depositos_repartidor d
  JOIN rep_repartidores r ON r.id = d.repartidor_id
  WHERE d.estado='confirmado' AND NOT d.verificado_banco
    AND d.revisado_at < NOW() - INTERVAL '48 hours'
  ORDER BY d.revisado_at ASC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_depositos_verificacion_atrasada FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_depositos_verificacion_atrasada TO authenticated;
