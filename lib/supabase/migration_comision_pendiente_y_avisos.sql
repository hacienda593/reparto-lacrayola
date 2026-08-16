-- migration_comision_pendiente_y_avisos.sql
-- 1. El repartidor no podía ver cuánta comisión tiene ganada Y AÚN SIN
--    PAGAR (distinto de "ganancias históricas totales", que ya mostraba
--    mi_estado_cuenta() -- ese número no restaba lo que ya se le pagó en
--    períodos cerrados).
-- 2. cerrar_periodo_colaborador seguía usando rep_is_admin() en vez de la
--    capacidad migrada -- lo mismo que ya corregimos en
--    liquidar_repartidor_admin, se había quedado este.

CREATE OR REPLACE FUNCTION public.mi_comision_pendiente()
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_repartidor_id UUID;
  v_ganancias_totales NUMERIC;
  v_ya_pagado NUMERIC;
BEGIN
  v_repartidor_id := rep_mi_id();
  IF v_repartidor_id IS NULL THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(debito - credito), 0) INTO v_ganancias_totales
  FROM rep_ledger_movimientos WHERE repartidor_id = v_repartidor_id AND cuenta = 'ganancia';

  SELECT COALESCE(SUM(ganancias), 0) INTO v_ya_pagado
  FROM rep_periodos_pago WHERE repartidor_id = v_repartidor_id AND estado = 'cerrado';

  RETURN GREATEST(v_ganancias_totales - v_ya_pagado, 0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mi_comision_pendiente FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_comision_pendiente TO authenticated;

CREATE OR REPLACE FUNCTION public.cerrar_periodo_colaborador(p_repartidor_id uuid, p_desde date, p_hasta date)
RETURNS rep_periodos_pago
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ganancias NUMERIC;v_caja NUMERIC;v_neto NUMERIC;v_result rep_periodos_pago;
BEGIN
 IF NOT rep_puede_liquidar_caja() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
 IF p_hasta>=CURRENT_DATE OR p_hasta<p_desde THEN RAISE EXCEPTION 'El período debe estar terminado y las fechas ser válidas'; END IF;
 PERFORM sincronizar_ledger_financiero();
 SELECT COALESCE(SUM(CASE WHEN cuenta='ganancia' THEN debito-credito END),0),COALESCE(SUM(CASE WHEN cuenta='caja' THEN debito-credito END),0)
 INTO v_ganancias,v_caja FROM rep_ledger_movimientos WHERE repartidor_id=p_repartidor_id AND fecha_operacion >= (p_desde::timestamp AT TIME ZONE 'America/Guayaquil') AND fecha_operacion < ((p_hasta+1)::timestamp AT TIME ZONE 'America/Guayaquil');
 v_neto:=v_ganancias-v_caja;
 INSERT INTO rep_periodos_pago(repartidor_id,desde,hasta,ganancias,caja_custodia,posicion_neta,monto_compensado,monto_pagar,monto_cobrar,estado,cerrado_at,cerrado_por)
 VALUES(p_repartidor_id,p_desde,p_hasta,v_ganancias,v_caja,v_neto,LEAST(v_ganancias,v_caja),GREATEST(v_neto,0),GREATEST(-v_neto,0),'cerrado',NOW(),auth.uid())
 ON CONFLICT(repartidor_id,desde,hasta) DO UPDATE SET ganancias=EXCLUDED.ganancias,caja_custodia=EXCLUDED.caja_custodia,posicion_neta=EXCLUDED.posicion_neta,monto_compensado=EXCLUDED.monto_compensado,monto_pagar=EXCLUDED.monto_pagar,monto_cobrar=EXCLUDED.monto_cobrar,estado='cerrado',cerrado_at=NOW(),cerrado_por=auth.uid(),updated_at=NOW() RETURNING * INTO v_result;
 RETURN v_result;
END $function$;
