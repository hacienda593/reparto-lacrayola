-- migration_prioridad1_comision_snapshot.sql
-- A3 + A4 de la auditoría financiera:
--
-- A3: la comisión de una entrega se recalculaba SIEMPRE con la tarifa
-- ACTUAL de rep_repartidores.comision_valor, en el momento de sincronizar
-- el ledger o de pedir "mi_comision_pendiente". Si el admin cambiaba la
-- tarifa de un repartidor, entregas antiguas aún no sincronizadas podían
-- terminar calculándose con la tarifa nueva -- no había forma de saber
-- "cuánto se le prometió realmente por esta entrega puntual".
--
-- A4: cerrar_periodo_colaborador no impedía cerrar dos períodos con rangos
-- de fecha superpuestos para el mismo repartidor -- riesgo de pagar (o
-- descontar) la misma comisión dos veces.

-- Snapshot: la comisión se congela en el momento exacto de la entrega, con
-- la tarifa vigente en ESE momento -- ya no depende de cuándo se
-- sincroniza ni de si la tarifa cambió después.
ALTER TABLE public.rep_entregas ADD COLUMN IF NOT EXISTS comision_tipo_snapshot TEXT;
ALTER TABLE public.rep_entregas ADD COLUMN IF NOT EXISTS comision_valor_snapshot NUMERIC(10,2);
ALTER TABLE public.rep_entregas ADD COLUMN IF NOT EXISTS comision_calculada NUMERIC(12,2);
COMMENT ON COLUMN public.rep_entregas.comision_calculada IS
  'Comisión congelada al momento de la entrega, con la tarifa vigente en ese momento. Política: se calcula sobre ol_pedidos.total (mercadería), no incluye costo_envio -- explícito, no accidental.';

CREATE OR REPLACE FUNCTION public.finalizar_entrega_atomica(
  p_request_id uuid, p_asignacion_id uuid, p_monto numeric, p_metodo text,
  p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric,
  p_foto_url text DEFAULT NULL::text, p_firma_url text DEFAULT NULL::text,
  p_referencias text DEFAULT NULL::text, p_nota_diferencia text DEFAULT NULL::text
)
RETURNS rep_entregas
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_a rep_asignaciones;v_p ol_pedidos;v_entrega rep_entregas;v_actor UUID;v_responsable UUID;v_monto NUMERIC(12,2);v_metodo TEXT;v_total_esperado NUMERIC(12,2);
  v_comision_tipo TEXT; v_comision_valor NUMERIC; v_comision_calculada NUMERIC;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Falta identificador de operación'; END IF;
 SELECT * INTO v_entrega FROM rep_entregas WHERE request_id=p_request_id;
 IF FOUND THEN RETURN v_entrega; END IF;
 IF p_metodo NOT IN('efectivo','transferencia','retiro_local') THEN RAISE EXCEPTION 'Método de pago inválido'; END IF;
 IF p_monto IS NULL OR p_monto<0 OR ROUND(p_monto,2)<>p_monto THEN RAISE EXCEPTION 'Monto inválido'; END IF;
 IF p_lat IS NOT NULL AND (p_lat < -90 OR p_lat > 90) THEN RAISE EXCEPTION 'Latitud inválida'; END IF;
 IF p_lng IS NOT NULL AND (p_lng < -180 OR p_lng > 180) THEN RAISE EXCEPTION 'Longitud inválida'; END IF;
 IF p_metodo<>'retiro_local' AND NULLIF(TRIM(p_foto_url),'') IS NULL THEN RAISE EXCEPTION 'La evidencia fotográfica es obligatoria'; END IF;
 SELECT * INTO v_a FROM rep_asignaciones WHERE id=p_asignacion_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Asignación no encontrada'; END IF;
 IF p_metodo<>'retiro_local' AND v_a.estado NOT IN ('en_ruta') AND NOT rep_is_admin() THEN
   RAISE EXCEPTION 'La asignación debe estar en_ruta para entregarse (actual: %)', v_a.estado;
 END IF;
 SELECT id INTO v_actor FROM rep_repartidores WHERE user_id=auth.uid() AND activo=true LIMIT 1;
 v_responsable:=CASE WHEN p_metodo='retiro_local' THEN v_a.shopper_id ELSE COALESCE(v_a.rider_id,v_a.repartidor_id) END;
 IF v_actor IS DISTINCT FROM v_responsable AND NOT rep_is_admin() THEN RAISE EXCEPTION 'No es responsable de esta entrega'; END IF;
 IF v_a.estado IN('cancelado','devuelto') THEN RAISE EXCEPTION 'La asignación está cerrada como %',v_a.estado; END IF;
 SELECT * INTO v_p FROM ol_pedidos WHERE id=v_a.pedido_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
 IF EXISTS(SELECT 1 FROM rep_entregas WHERE pedido_id=v_p.id AND exitosa AND request_id IS DISTINCT FROM p_request_id) THEN RAISE EXCEPTION 'El pedido ya tiene una entrega exitosa'; END IF;
 IF p_metodo='transferencia' AND NOT COALESCE(v_p.pago_confirmado,false) THEN RAISE EXCEPTION 'La transferencia aún no ha sido verificada por administración'; END IF;
 v_metodo:=CASE WHEN p_metodo='transferencia' THEN 'transferencia' ELSE 'efectivo' END;
 v_monto:=CASE WHEN v_metodo='transferencia' THEN 0 ELSE ROUND(p_monto,2) END;
 v_total_esperado:=COALESCE(v_p.total_final, ROUND(COALESCE(v_p.total,0)+COALESCE(v_p.costo_envio,0),2));
 IF v_metodo='efectivo' AND v_monto<=0 THEN RAISE EXCEPTION 'Debe registrar el efectivo cobrado'; END IF;
 IF v_metodo='efectivo' AND v_monto < v_total_esperado - 0.01 AND NULLIF(TRIM(p_nota_diferencia),'') IS NULL THEN
   RAISE EXCEPTION 'El monto cobrado (%) es menor al total esperado (%, productos + envío). Indica el motivo de la diferencia para continuar.', v_monto, v_total_esperado;
 END IF;

 -- Snapshot de comisión: tarifa vigente AHORA, para el responsable de la
 -- entrega. Se calcula sobre el valor de mercadería (ol_pedidos.total),
 -- no sobre el envío -- política explícita, documentada en la columna.
 SELECT comision_tipo, comision_valor INTO v_comision_tipo, v_comision_valor
 FROM rep_repartidores WHERE id=v_responsable;
 v_comision_calculada := CASE
   WHEN v_comision_tipo='porcentaje' THEN ROUND(COALESCE(v_p.total,0)*COALESCE(v_comision_valor,0)/100,2)
   ELSE COALESCE(v_comision_valor,0)
 END;

 PERFORM set_config('app.via_finalizar_entrega_atomica', 'true', true);
 UPDATE rep_asignaciones SET estado='entregado',foto_entrega_url=p_foto_url,
  firma_cliente_url=p_firma_url,entrega_lat=p_lat,entrega_lng=p_lng,updated_at=NOW()
 WHERE id=v_a.id;
 UPDATE ol_pedidos SET estado='entregado',geo_lat=COALESCE(p_lat,geo_lat),
  geo_lng=COALESCE(p_lng,geo_lng),referencias=COALESCE(NULLIF(TRIM(p_referencias),''),referencias),
  total_final=v_total_esperado
 WHERE id=v_p.id;
 INSERT INTO rep_entregas(request_id,asignacion_id,repartidor_id,pedido_id,salida_at,entregado_at,monto_cobrado,
  metodo_pago,exitosa,geo_lat,geo_lng,foto_url,firma_cliente,monto_esperado,nota_diferencia_cobro,
  comision_tipo_snapshot,comision_valor_snapshot,comision_calculada)
 VALUES(p_request_id,v_a.id,v_responsable,v_p.id,v_a.updated_at,NOW(),v_monto,
  v_metodo,true,p_lat,p_lng,p_foto_url,p_firma_url,v_total_esperado,NULLIF(TRIM(p_nota_diferencia),''),
  v_comision_tipo,v_comision_valor,v_comision_calculada) RETURNING * INTO v_entrega;
 IF v_metodo='efectivo' THEN
  INSERT INTO rep_cuentas_cobrar(pedido_id,asignacion_id,repartidor_id,monto_pedido,monto_cobrado,metodo_pago,estado,cobrado_at)
  VALUES(v_p.id,v_a.id,v_entrega.repartidor_id,v_total_esperado,v_monto,'efectivo','cobrado',NOW());
  INSERT INTO rep_transacciones_caja(repartidor_id,pedido_id,tipo,monto,estado)
  VALUES(v_entrega.repartidor_id,v_p.id,'ingreso_entrega',v_monto,'pendiente');
 END IF;
 PERFORM registrar_evento_pedido(v_p.id, v_a.id, 'entrega_exitosa', auth.uid(), v_responsable, jsonb_build_object('metodo', v_metodo, 'monto', v_monto, 'monto_esperado', v_total_esperado, 'comision', v_comision_calculada), p_request_id);
 RETURN v_entrega;
END $function$;
REVOKE EXECUTE ON FUNCTION public.finalizar_entrega_atomica FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalizar_entrega_atomica TO authenticated;

-- mi_comision_pendiente() ahora suma el snapshot congelado (comision_calculada)
-- en vez de recalcular con la tarifa actual -- si cambia la tarifa hoy, las
-- entregas ya hechas no se alteran.
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

  -- Entregas con snapshot (posteriores a esta migración) usan el valor
  -- congelado; entregas viejas sin snapshot todavía, calculadas con la
  -- tarifa actual como fallback (mismo comportamiento de siempre para
  -- ellas, no se puede reconstruir un snapshot que nunca se guardó).
  SELECT COALESCE(SUM(
    COALESCE(e.comision_calculada,
      CASE WHEN r.comision_tipo = 'porcentaje'
        THEN ROUND(COALESCE(p.total, 0) * r.comision_valor / 100, 2)
        ELSE r.comision_valor
      END)
  ), 0) INTO v_ganancias_totales
  FROM rep_entregas e
  JOIN rep_repartidores r ON r.id = e.repartidor_id
  LEFT JOIN ol_pedidos p ON p.id = e.pedido_id
  WHERE e.repartidor_id = v_repartidor_id AND e.exitosa;

  SELECT COALESCE(SUM(ganancias), 0) INTO v_ya_pagado
  FROM rep_periodos_pago WHERE repartidor_id = v_repartidor_id AND estado = 'cerrado';

  RETURN GREATEST(v_ganancias_totales - v_ya_pagado, 0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mi_comision_pendiente FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_comision_pendiente TO authenticated;

-- sincronizar_ledger_financiero: mismo criterio -- usa el snapshot cuando
-- existe, para que el ledger contable coincida con lo que de verdad se
-- prometió en cada entrega.
CREATE OR REPLACE FUNCTION sincronizar_ledger_financiero()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_insertados INTEGER:=0; v_n INTEGER;
BEGIN
  IF NOT rep_is_admin() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  INSERT INTO rep_ledger_movimientos(request_id,repartidor_id,pedido_id,fecha_operacion,cuenta,concepto,debito,credito,descripcion,origen_tipo,origen_id)
  SELECT 'entrega-caja-'||e.id,e.repartidor_id,e.pedido_id,e.entregado_at,'caja','cobro_cliente',COALESCE(e.monto_cobrado,0),0,'Efectivo cobrado al cliente','rep_entregas',e.id
  FROM rep_entregas e WHERE e.exitosa AND LOWER(COALESCE(e.metodo_pago,'')) IN ('efectivo','contraentrega','cod') AND COALESCE(e.monto_cobrado,0)>0
  ON CONFLICT(request_id) DO NOTHING; GET DIAGNOSTICS v_n=ROW_COUNT; v_insertados:=v_insertados+v_n;

  INSERT INTO rep_ledger_movimientos(request_id,repartidor_id,pedido_id,fecha_operacion,cuenta,concepto,debito,credito,descripcion,origen_tipo,origen_id)
  SELECT 'entrega-comision-'||e.id,e.repartidor_id,e.pedido_id,e.entregado_at,'ganancia','comision',
    COALESCE(e.comision_calculada,
      CASE WHEN r.comision_tipo='porcentaje' THEN ROUND(COALESCE(p.total,0)*r.comision_valor/100,2) ELSE r.comision_valor END),0,
    'Comisión por entrega exitosa','rep_entregas',e.id
  FROM rep_entregas e JOIN rep_repartidores r ON r.id=e.repartidor_id LEFT JOIN ol_pedidos p ON p.id=e.pedido_id
  WHERE e.exitosa ON CONFLICT(request_id) DO NOTHING; GET DIAGNOSTICS v_n=ROW_COUNT; v_insertados:=v_insertados+v_n;

  INSERT INTO rep_ledger_movimientos(request_id,repartidor_id,fecha_operacion,cuenta,concepto,debito,credito,descripcion,origen_tipo,origen_id)
  SELECT 'traspaso-salida-'||t.id,t.repartidor_origen_id,t.created_at,'caja','traspaso_salida',0,t.monto,'Efectivo entregado a otro colaborador','rep_traspasos_efectivo',t.id FROM rep_traspasos_efectivo t
  ON CONFLICT(request_id) DO NOTHING; GET DIAGNOSTICS v_n=ROW_COUNT; v_insertados:=v_insertados+v_n;
  INSERT INTO rep_ledger_movimientos(request_id,repartidor_id,fecha_operacion,cuenta,concepto,debito,credito,descripcion,origen_tipo,origen_id)
  SELECT 'traspaso-entrada-'||t.id,t.repartidor_destino_id,t.created_at,'caja','traspaso_entrada',t.monto,0,'Efectivo recibido de otro colaborador','rep_traspasos_efectivo',t.id FROM rep_traspasos_efectivo t
  ON CONFLICT(request_id) DO NOTHING; GET DIAGNOSTICS v_n=ROW_COUNT; v_insertados:=v_insertados+v_n;
  INSERT INTO rep_ledger_movimientos(request_id,repartidor_id,fecha_operacion,cuenta,concepto,debito,credito,descripcion,origen_tipo,origen_id)
  SELECT 'liquidacion-'||m.id,m.repartidor_id,m.created_at,'caja','entrega_oficina',0,m.monto,'Entrega o depósito a oficina','rep_movimientos_liquidacion',m.id FROM rep_movimientos_liquidacion m WHERE m.reversado_at IS NULL
  ON CONFLICT(request_id) DO NOTHING; GET DIAGNOSTICS v_n=ROW_COUNT; v_insertados:=v_insertados+v_n;
  RETURN jsonb_build_object('insertados',v_insertados,'ejecutado_at',NOW());
END $$;
REVOKE ALL ON FUNCTION sincronizar_ledger_financiero() FROM PUBLIC; GRANT EXECUTE ON FUNCTION sincronizar_ledger_financiero() TO authenticated;

-- A4: impedir cerrar dos periodos con rangos de fecha superpuestos para el
-- mismo repartidor -- antes no había ninguna validación, riesgo de pagar
-- (o descontar) la misma comisión dos veces.
CREATE OR REPLACE FUNCTION public.cerrar_periodo_colaborador(p_repartidor_id uuid, p_desde date, p_hasta date)
RETURNS rep_periodos_pago
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ganancias NUMERIC;v_caja NUMERIC;v_neto NUMERIC;v_result rep_periodos_pago;v_solapado RECORD;
BEGIN
 IF NOT rep_puede_liquidar_caja() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
 IF p_hasta>=CURRENT_DATE OR p_hasta<p_desde THEN RAISE EXCEPTION 'El período debe estar terminado y las fechas ser válidas'; END IF;

 SELECT desde, hasta INTO v_solapado FROM rep_periodos_pago
 WHERE repartidor_id=p_repartidor_id AND estado='cerrado'
   AND NOT (p_desde=desde AND p_hasta=hasta)
   AND p_desde <= hasta AND p_hasta >= desde
 LIMIT 1;
 IF FOUND THEN
   RAISE EXCEPTION 'Ya existe un período cerrado que se superpone (% a %) -- ajusta el rango para no pagar la misma comisión dos veces', v_solapado.desde, v_solapado.hasta;
 END IF;

 PERFORM sincronizar_ledger_financiero();
 SELECT COALESCE(SUM(CASE WHEN cuenta='ganancia' THEN debito-credito END),0),COALESCE(SUM(CASE WHEN cuenta='caja' THEN debito-credito END),0)
 INTO v_ganancias,v_caja FROM rep_ledger_movimientos WHERE repartidor_id=p_repartidor_id AND fecha_operacion >= (p_desde::timestamp AT TIME ZONE 'America/Guayaquil') AND fecha_operacion < ((p_hasta+1)::timestamp AT TIME ZONE 'America/Guayaquil');
 v_neto:=v_ganancias-v_caja;
 INSERT INTO rep_periodos_pago(repartidor_id,desde,hasta,ganancias,caja_custodia,posicion_neta,monto_compensado,monto_pagar,monto_cobrar,estado,cerrado_at,cerrado_por)
 VALUES(p_repartidor_id,p_desde,p_hasta,v_ganancias,v_caja,v_neto,LEAST(v_ganancias,v_caja),GREATEST(v_neto,0),GREATEST(-v_neto,0),'cerrado',NOW(),auth.uid())
 ON CONFLICT(repartidor_id,desde,hasta) DO UPDATE SET ganancias=EXCLUDED.ganancias,caja_custodia=EXCLUDED.caja_custodia,posicion_neta=EXCLUDED.posicion_neta,monto_compensado=EXCLUDED.monto_compensado,monto_pagar=EXCLUDED.monto_pagar,monto_cobrar=EXCLUDED.monto_cobrar,estado='cerrado',cerrado_at=NOW(),cerrado_por=auth.uid(),updated_at=NOW() RETURNING * INTO v_result;
 RETURN v_result;
END $function$;
REVOKE EXECUTE ON FUNCTION public.cerrar_periodo_colaborador FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_periodo_colaborador TO authenticated;
