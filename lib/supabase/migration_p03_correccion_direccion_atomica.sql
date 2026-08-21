-- migration_p03_correccion_direccion_atomica.sql
--
-- P0-03 de la auditoría operativa (docs/auditoria_operativa_aplicacion_entregas_2026-08-21.md):
-- la corrección de dirección/GPS al entregar se hacía con 2-3 escrituras
-- sueltas desde el navegador (ol_direcciones_cliente, rep_clientes_direcciones)
-- ANTES de llamar a finalizar_entrega_atomica -- algunas ignoraban el
-- resultado (`await ... ; } catch (e) { console.error(e) }` sin abortar
-- nada). La entrega podía cerrarse aunque la agenda quedara sin corregir,
-- o la agenda podía cambiar aunque la entrega fallara después.
--
-- Se mueve esa corrección DENTRO de finalizar_entrega_atomica, en la misma
-- transacción, y solo cuando el repartidor de verdad marcó que corrigió
-- el punto (no en cada entrega normal, para no reescribir la agenda con
-- el mismo valor de siempre). Se registra un evento con la coordenada
-- anterior y la nueva para trazabilidad (quién, cuándo, de dónde a dónde).

-- Equivalente en SQL de sonDireccionesSimilares(), duplicada hasta ahora
-- en varios archivos TS (checkout, asignaciones, entrega, repartidor) --
-- mismo criterio: texto idéntico limpio, o substring uno del otro, o al
-- menos mitad de palabras relevantes (>3 letras) en común.
CREATE OR REPLACE FUNCTION public.rep_direcciones_similares(p_dir1 TEXT, p_dir2 TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  c1 TEXT; c2 TEXT;
  palabras1 TEXT[]; palabras2 TEXT[];
  coincidentes INT;
  ratio NUMERIC;
BEGIN
  IF p_dir1 IS NULL OR p_dir2 IS NULL OR TRIM(p_dir1) = '' OR TRIM(p_dir2) = '' THEN RETURN false; END IF;

  c1 := regexp_replace(lower(p_dir1), '[^a-z0-9]', '', 'g');
  c2 := regexp_replace(lower(p_dir2), '[^a-z0-9]', '', 'g');
  IF c1 = c2 THEN RETURN true; END IF;
  IF length(c1) > 8 AND length(c2) > 8 AND (c1 LIKE '%' || c2 || '%' OR c2 LIKE '%' || c1 || '%') THEN
    RETURN true;
  END IF;

  SELECT array_agg(w) INTO palabras1
    FROM unnest(regexp_split_to_array(regexp_replace(lower(p_dir1), '[^a-z0-9\s]', '', 'g'), '\s+')) w
    WHERE length(w) > 3;
  SELECT array_agg(w) INTO palabras2
    FROM unnest(regexp_split_to_array(regexp_replace(lower(p_dir2), '[^a-z0-9\s]', '', 'g'), '\s+')) w
    WHERE length(w) > 3;

  IF palabras1 IS NULL OR palabras2 IS NULL THEN RETURN false; END IF;

  SELECT COUNT(*) INTO coincidentes FROM unnest(palabras1) p WHERE p = ANY(palabras2);
  ratio := coincidentes::numeric / LEAST(array_length(palabras1, 1), array_length(palabras2, 1));
  RETURN ratio >= 0.5;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalizar_entrega_atomica(
  p_request_id UUID, p_asignacion_id UUID, p_monto NUMERIC, p_metodo TEXT,
  p_lat NUMERIC DEFAULT NULL, p_lng NUMERIC DEFAULT NULL,
  p_foto_url TEXT DEFAULT NULL, p_firma_url TEXT DEFAULT NULL,
  p_referencias TEXT DEFAULT NULL, p_nota_diferencia TEXT DEFAULT NULL,
  p_direccion_corregida BOOLEAN DEFAULT false
)
RETURNS public.rep_entregas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $function$
DECLARE
  v_a rep_asignaciones; v_p ol_pedidos; v_entrega rep_entregas; v_actor UUID; v_responsable UUID;
  v_monto NUMERIC(12,2); v_metodo TEXT; v_total_esperado NUMERIC(12,2);
  v_comision_tipo TEXT; v_comision_valor NUMERIC; v_comision_calculada NUMERIC;
  v_geo_lat_anterior NUMERIC; v_geo_lng_anterior NUMERIC; v_dir_existente UUID;
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

  SELECT comision_tipo, comision_valor INTO v_comision_tipo, v_comision_valor
  FROM rep_repartidores WHERE id=v_responsable;
  v_comision_calculada := CASE
    WHEN v_comision_tipo='porcentaje' THEN ROUND(COALESCE(v_p.total,0)*COALESCE(v_comision_valor,0)/100,2)
    ELSE COALESCE(v_comision_valor,0)
  END;

  v_geo_lat_anterior := v_p.geo_lat;
  v_geo_lng_anterior := v_p.geo_lng;

  PERFORM set_config('app.via_finalizar_entrega_atomica', 'true', true);
  UPDATE rep_asignaciones SET estado='entregado',foto_entrega_url=p_foto_url,
   firma_cliente_url=p_firma_url,entrega_lat=p_lat,entrega_lng=p_lng,updated_at=NOW()
   WHERE id=v_a.id;
  UPDATE ol_pedidos SET estado='entregado',geo_lat=COALESCE(p_lat,geo_lat),
   geo_lng=COALESCE(p_lng,geo_lng),referencias=COALESCE(NULLIF(TRIM(p_referencias),''),referencias),
   total_final=v_total_esperado
   WHERE id=v_p.id;

  -- Corrección de agenda (P0-03): solo cuando el repartidor de verdad
  -- marcó que corrigió el punto -- no en cada entrega normal, y toda en
  -- la misma transacción que el cierre de la entrega (antes vivía suelta
  -- en el navegador, antes de siquiera llamar esta función).
  IF p_direccion_corregida AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    IF v_p.user_id IS NOT NULL THEN
      UPDATE ol_direcciones_cliente
      SET geo_lat = p_lat, geo_lng = p_lng, referencias = COALESCE(NULLIF(TRIM(p_referencias), ''), referencias)
      WHERE user_id = v_p.user_id AND direccion_texto = v_p.direccion;
    END IF;

    IF v_p.telefono IS NOT NULL THEN
      SELECT id INTO v_dir_existente FROM rep_clientes_direcciones
      WHERE telefono = v_p.telefono AND rep_direcciones_similares(direccion, v_p.direccion)
      LIMIT 1;
      IF v_dir_existente IS NOT NULL THEN
        UPDATE rep_clientes_direcciones
        SET geo_lat = p_lat, geo_lng = p_lng, verificada = true, updated_at = NOW()
        WHERE id = v_dir_existente;
      ELSE
        INSERT INTO rep_clientes_direcciones (telefono, nombre_direccion, direccion, ciudad, referencias, geo_lat, geo_lng, verificada)
        VALUES (
          v_p.telefono, LEFT(COALESCE(v_p.direccion, 'Dirección de Entrega'), 15), COALESCE(v_p.direccion, 'Dirección de Entrega'),
          COALESCE(v_p.ciudad, 'Ciudad'), COALESCE(NULLIF(TRIM(p_referencias), ''), v_p.referencias, ''), p_lat, p_lng, true
        );
      END IF;
    END IF;

    PERFORM registrar_evento_pedido(
      v_p.id, v_a.id, 'direccion_corregida_entrega', auth.uid(), v_responsable,
      jsonb_build_object(
        'lat_anterior', v_geo_lat_anterior, 'lng_anterior', v_geo_lng_anterior,
        'lat_nueva', p_lat, 'lng_nueva', p_lng, 'referencias', p_referencias
      ),
      NULL -- request_id propio distinto: no puede repetir el de la entrega (índice único), y el reintento ya corta arriba
    );
  END IF;

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
