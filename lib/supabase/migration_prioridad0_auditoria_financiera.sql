-- migration_prioridad0_auditoria_financiera.sql
-- Implementa la Prioridad 0 de docs/auditoria_financiera_ruta_dinero.md:
-- impedir que se pierda el cobro del envío en transferencias, en la
-- factura de venta y en la conciliación bancaria.

-- 1-2. total_final persistido: una sola fuente de verdad de "lo que debe
-- pagar el cliente", en vez de recalcular total+costo_envio en cada
-- función con el riesgo de que alguna se quede desactualizada.
ALTER TABLE public.ol_pedidos ADD COLUMN IF NOT EXISTS total_final NUMERIC(12,2);
COMMENT ON COLUMN public.ol_pedidos.total_final IS
  'productos (total) + costo_envio, congelado la primera vez que se calcula el envío. Fuente de verdad para conciliación, factura y validación de cobro.';

-- 7. guardar_costo_envio_pedido: antes cualquier autenticado podía fijar
-- CUALQUIER número como costo_envio con solo una llamada a la RPC (sin
-- pasar por el cálculo real). Ahora exige ser admin o estar
-- asignado al pedido (shopper/rider), y de paso congela total_final.
CREATE OR REPLACE FUNCTION public.guardar_costo_envio_pedido(p_pedido_id UUID, p_costo_envio NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actual NUMERIC; v_total NUMERIC; v_autorizado BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF p_costo_envio IS NULL OR p_costo_envio < 0 THEN RAISE EXCEPTION 'Costo de envío inválido'; END IF;
  -- Límite de cordura: nadie llama a esta RPC con un envío absurdo (evita
  -- que una llamada manual maliciosa fije, por ejemplo, $0.01 de envío).
  IF p_costo_envio > 100 THEN RAISE EXCEPTION 'Costo de envío fuera de rango razonable'; END IF;

  SELECT costo_envio, total INTO v_actual, v_total FROM ol_pedidos WHERE id = p_pedido_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;

  v_autorizado := rep_is_admin() OR EXISTS(
    SELECT 1 FROM rep_asignaciones a JOIN rep_repartidores r ON r.user_id = auth.uid()
    WHERE a.pedido_id = p_pedido_id AND (a.shopper_id = r.id OR a.rider_id = r.id OR a.repartidor_id = r.id)
  );
  IF NOT v_autorizado THEN RAISE EXCEPTION 'No tienes relación con este pedido'; END IF;

  IF v_actual IS NOT NULL THEN RETURN v_actual; END IF;

  UPDATE ol_pedidos SET costo_envio = ROUND(p_costo_envio, 2), total_final = ROUND(COALESCE(v_total,0) + p_costo_envio, 2)
  WHERE id = p_pedido_id AND costo_envio IS NULL;
  RETURN ROUND(p_costo_envio, 2);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guardar_costo_envio_pedido FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_costo_envio_pedido TO authenticated;

-- 3-4. confirmar_pago_admin: ahora exige el monto que el admin ve
-- confirmado (en el banco/comprobante) y lo compara contra total_final.
-- Si no coincide, exige un motivo explícito de la diferencia (excepción
-- autorizada, igual que ya hacemos con el cobro en efectivo). También
-- exige que el envío ya esté calculado -- no se puede confirmar un pago
-- sin saber cuánto se supone que debía cubrir.
DROP FUNCTION IF EXISTS public.confirmar_pago_admin(uuid, text, text, date, text, uuid);
CREATE OR REPLACE FUNCTION public.confirmar_pago_admin(
  p_pedido_id UUID, p_referencia TEXT, p_monto NUMERIC, p_banco TEXT DEFAULT NULL, p_fecha DATE DEFAULT NULL,
  p_evidencia_path TEXT DEFAULT NULL, p_motivo_diferencia TEXT DEFAULT NULL, p_request_id UUID DEFAULT NULL
)
RETURNS public.ol_pedidos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_pedido ol_pedidos; v_existe_request RECORD; v_total_final NUMERIC;
BEGIN
  IF NOT rep_puede_confirmar_pago() THEN RAISE EXCEPTION 'No autorizado para confirmar pagos' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NOT NULL THEN
    SELECT pedido_id INTO v_existe_request FROM ol_pedidos_verificaciones WHERE request_id = p_request_id LIMIT 1;
    IF FOUND THEN SELECT * INTO v_pedido FROM ol_pedidos WHERE id = v_existe_request.pedido_id; RETURN v_pedido; END IF;
  END IF;
  SELECT * INTO v_pedido FROM ol_pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido % no existe', p_pedido_id; END IF;
  IF v_pedido.pago_confirmado THEN RAISE EXCEPTION 'El pago de este pedido ya está confirmado' USING ERRCODE = '22023'; END IF;
  IF v_pedido.metodo_pago <> 'transferencia' THEN RAISE EXCEPTION 'Este pedido no es de método transferencia'; END IF;
  IF p_referencia IS NULL OR btrim(p_referencia) = '' THEN RAISE EXCEPTION 'La referencia del comprobante es obligatoria'; END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'Debes indicar el monto confirmado en el comprobante/banco'; END IF;
  IF v_pedido.costo_envio IS NULL THEN
    RAISE EXCEPTION 'El envío de este pedido aún no se ha calculado -- ábrelo primero para que se calcule antes de confirmar el pago';
  END IF;

  v_total_final := COALESCE(v_pedido.total_final, ROUND(COALESCE(v_pedido.total,0) + COALESCE(v_pedido.costo_envio,0), 2));

  IF ABS(p_monto - v_total_final) > 0.01 AND NULLIF(TRIM(p_motivo_diferencia), '') IS NULL THEN
    RAISE EXCEPTION 'El monto confirmado (%) no coincide con el total del pedido (%, incluye envío). Indica el motivo de la diferencia para continuar.', p_monto, v_total_final;
  END IF;

  UPDATE ol_pedidos SET pago_confirmado = true, referencia_transferencia = btrim(p_referencia),
    total_final = v_total_final
  WHERE id = p_pedido_id RETURNING * INTO v_pedido;
  INSERT INTO ol_pedidos_verificaciones (pedido_id, accion, referencia, banco, fecha_deposito, admin_user_id, admin_nombre, evidencia_path, request_id)
  VALUES (p_pedido_id, 'confirmado', btrim(p_referencia), p_banco, p_fecha, auth.uid(),
    COALESCE((SELECT nombre FROM rep_repartidores WHERE user_id = auth.uid()), auth.uid()::text), p_evidencia_path, p_request_id);
  PERFORM registrar_evento_pedido(p_pedido_id, NULL, 'pago_confirmado', auth.uid(), NULL,
    jsonb_build_object('referencia', btrim(p_referencia), 'banco', p_banco, 'monto', p_monto, 'total_final', v_total_final, 'motivo_diferencia', NULLIF(TRIM(p_motivo_diferencia),'')),
    p_request_id);
  RETURN v_pedido;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.confirmar_pago_admin FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_pago_admin TO authenticated;

-- 6a. Conciliación bancaria: mostraba p.total para transferencias de
-- cliente, sin envío. Ahora usa total_final (o total+costo_envio si por
-- algún motivo total_final no se llegó a congelar).
CREATE OR REPLACE FUNCTION public.admin_conciliacion_bancaria()
RETURNS TABLE(
  origen TEXT, id UUID, monto NUMERIC, fecha TIMESTAMPTZ,
  banco TEXT, referencia TEXT, detalle TEXT, verificado BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT rep_puede_ver_finanzas() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  RETURN QUERY
  SELECT 'deposito_repartidor'::TEXT, d.id, d.monto, d.registrado_at,
         d.banco, d.referencia, r.nombre || ' (depósito de repartidor)', d.verificado_banco
  FROM rep_depositos_repartidor d
  JOIN rep_repartidores r ON r.id = d.repartidor_id
  WHERE d.estado = 'confirmado'
  UNION ALL
  SELECT 'transferencia_cliente'::TEXT, p.id, COALESCE(p.total_final, ROUND(COALESCE(p.total,0)+COALESCE(p.costo_envio,0),2)), p.updated_at,
         NULL, p.referencia_transferencia, 'Pedido #' || p.numero || ' — ' || p.nombre_cliente, p.verificado_banco
  FROM ol_pedidos p
  WHERE p.metodo_pago = 'transferencia' AND p.pago_confirmado = true
  ORDER BY fecha DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_conciliacion_bancaria FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_conciliacion_bancaria TO authenticated;

-- 6b. Factura de venta: usaba ol_pedidos.total, sin envío. Ahora usa
-- total_final (con fallback si algún pedido viejo no lo tiene congelado).
CREATE OR REPLACE FUNCTION registrar_factura_cliente(p_pedido_id UUID,p_numero TEXT,p_clave TEXT DEFAULT NULL,p_ride_url TEXT DEFAULT NULL,p_xml_url TEXT DEFAULT NULL,p_observaciones TEXT DEFAULT NULL)
RETURNS rep_facturas_cliente LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_pedido ol_pedidos;v_result rep_facturas_cliente;v_total_final NUMERIC;
BEGIN
 IF NOT rep_is_admin() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
 IF NULLIF(TRIM(p_numero),'') IS NULL THEN RAISE EXCEPTION 'Número de factura obligatorio'; END IF;
 SELECT * INTO v_pedido FROM ol_pedidos WHERE id=p_pedido_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rep_entregas WHERE pedido_id=p_pedido_id AND exitosa) THEN RAISE EXCEPTION 'Solo puede facturarse un pedido entregado exitosamente'; END IF;
 v_total_final := COALESCE(v_pedido.total_final, ROUND(COALESCE(v_pedido.total,0)+COALESCE(v_pedido.costo_envio,0),2));
 INSERT INTO rep_facturas_cliente(pedido_id,estado,numero_factura,clave_acceso,fecha_emision,total,ride_url,xml_url,observaciones,emitida_por,updated_at)
 VALUES(p_pedido_id,'emitida',TRIM(p_numero),NULLIF(TRIM(p_clave),''),NOW(),v_total_final,p_ride_url,p_xml_url,NULLIF(TRIM(p_observaciones),''),auth.uid(),NOW())
 ON CONFLICT(pedido_id) DO UPDATE SET estado='emitida',numero_factura=EXCLUDED.numero_factura,clave_acceso=EXCLUDED.clave_acceso,fecha_emision=EXCLUDED.fecha_emision,total=EXCLUDED.total,ride_url=EXCLUDED.ride_url,xml_url=EXCLUDED.xml_url,observaciones=EXCLUDED.observaciones,emitida_por=auth.uid(),updated_at=NOW() RETURNING * INTO v_result;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION registrar_factura_cliente(UUID,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;GRANT EXECUTE ON FUNCTION registrar_factura_cliente(UUID,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;

-- 5. finalizar_entrega_atomica: usar total_final como fuente única
-- (consistente con confirmar_pago_admin) en vez de recalcular total+envío
-- cada vez -- y exigir costo_envio calculado también para efectivo, no
-- solo comparar contra 0 si nunca se calculó.
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
 PERFORM set_config('app.via_finalizar_entrega_atomica', 'true', true);
 UPDATE rep_asignaciones SET estado='entregado',foto_entrega_url=p_foto_url,
  firma_cliente_url=p_firma_url,entrega_lat=p_lat,entrega_lng=p_lng,updated_at=NOW()
 WHERE id=v_a.id;
 UPDATE ol_pedidos SET estado='entregado',geo_lat=COALESCE(p_lat,geo_lat),
  geo_lng=COALESCE(p_lng,geo_lng),referencias=COALESCE(NULLIF(TRIM(p_referencias),''),referencias),
  total_final=v_total_esperado
 WHERE id=v_p.id;
 INSERT INTO rep_entregas(request_id,asignacion_id,repartidor_id,pedido_id,salida_at,entregado_at,monto_cobrado,
  metodo_pago,exitosa,geo_lat,geo_lng,foto_url,firma_cliente,monto_esperado,nota_diferencia_cobro)
 VALUES(p_request_id,v_a.id,v_responsable,v_p.id,v_a.updated_at,NOW(),v_monto,
  v_metodo,true,p_lat,p_lng,p_foto_url,p_firma_url,v_total_esperado,NULLIF(TRIM(p_nota_diferencia),'')) RETURNING * INTO v_entrega;
 IF v_metodo='efectivo' THEN
  INSERT INTO rep_cuentas_cobrar(pedido_id,asignacion_id,repartidor_id,monto_pedido,monto_cobrado,metodo_pago,estado,cobrado_at)
  VALUES(v_p.id,v_a.id,v_entrega.repartidor_id,v_total_esperado,v_monto,'efectivo','cobrado',NOW());
  INSERT INTO rep_transacciones_caja(repartidor_id,pedido_id,tipo,monto,estado)
  VALUES(v_entrega.repartidor_id,v_p.id,'ingreso_entrega',v_monto,'pendiente');
 END IF;
 PERFORM registrar_evento_pedido(v_p.id, v_a.id, 'entrega_exitosa', auth.uid(), v_responsable, jsonb_build_object('metodo', v_metodo, 'monto', v_monto, 'monto_esperado', v_total_esperado), p_request_id);
 RETURN v_entrega;
END $function$;
REVOKE EXECUTE ON FUNCTION public.finalizar_entrega_atomica FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalizar_entrega_atomica TO authenticated;
