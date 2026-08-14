-- Endurecimiento de producción: entrega, caja, permisos e idempotencia.
-- Ejecutar después de las migraciones financieras y migration_integridad_operativa.sql.

ALTER TABLE rep_entregas ADD COLUMN IF NOT EXISTS request_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS rep_entregas_request_uidx
  ON rep_entregas(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rep_entregas_pedido_exitosa_idx
  ON rep_entregas(pedido_id,exitosa,entregado_at DESC);

-- Corrige registros históricos que fueron marcados exitosos al iniciar ruta,
-- sin cobro, método ni evidencia. No toca entregas realmente completadas.
UPDATE rep_entregas e SET exitosa=false,motivo_fallo='Registro de salida histórico corregido'
FROM rep_asignaciones a WHERE a.id=e.asignacion_id AND e.exitosa
 AND e.monto_cobrado IS NULL AND e.metodo_pago IS NULL AND e.foto_url IS NULL
 AND a.estado<>'entregado';
DELETE FROM rep_facturas_cliente f WHERE f.estado='pendiente'
 AND NOT EXISTS(SELECT 1 FROM rep_entregas e WHERE e.pedido_id=f.pedido_id AND e.exitosa);

-- Los traspasos contienen saldos y custodios: no deben ser visibles para todo usuario.
DROP POLICY IF EXISTS "lectura_autenticados_traspasos" ON rep_traspasos_efectivo;
DROP POLICY IF EXISTS rep_traspasos_select ON rep_traspasos_efectivo;
CREATE POLICY rep_traspasos_select ON rep_traspasos_efectivo FOR SELECT TO authenticated
 USING (repartidor_origen_id=rep_mi_id() OR repartidor_destino_id=rep_mi_id() OR rep_is_admin());

-- Las funciones auxiliares no deben poder invocarse desde una sesión anónima.
REVOKE ALL ON FUNCTION rep_is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION rep_mi_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION rep_puede_ver_pedido(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION rep_puede_ver_asignacion(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rep_is_admin(),rep_mi_id(),rep_puede_ver_pedido(UUID),rep_puede_ver_asignacion(UUID) TO authenticated;

-- Cierra una entrega completa en una sola transacción. Si el teléfono repite
-- la solicitud por mala señal, request_id devuelve el mismo resultado.
CREATE OR REPLACE FUNCTION finalizar_entrega_atomica(
 p_request_id UUID,p_asignacion_id UUID,p_monto NUMERIC,p_metodo TEXT,
 p_lat NUMERIC DEFAULT NULL,p_lng NUMERIC DEFAULT NULL,p_foto_url TEXT DEFAULT NULL,
 p_firma_url TEXT DEFAULT NULL,p_referencias TEXT DEFAULT NULL
) RETURNS rep_entregas LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_a rep_asignaciones;v_p ol_pedidos;v_entrega rep_entregas;v_actor UUID;v_responsable UUID;v_monto NUMERIC(12,2);v_metodo TEXT;
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
 IF v_metodo='efectivo' AND v_monto<=0 THEN RAISE EXCEPTION 'Debe registrar el efectivo cobrado'; END IF;

 UPDATE rep_asignaciones SET estado='entregado',foto_entrega_url=p_foto_url,
  firma_cliente_url=p_firma_url,entrega_lat=p_lat,entrega_lng=p_lng,updated_at=NOW()
 WHERE id=v_a.id;
 UPDATE ol_pedidos SET estado='entregado',geo_lat=COALESCE(p_lat,geo_lat),
  geo_lng=COALESCE(p_lng,geo_lng),referencias=COALESCE(NULLIF(TRIM(p_referencias),''),referencias)
 WHERE id=v_p.id;
 INSERT INTO rep_entregas(request_id,asignacion_id,repartidor_id,pedido_id,salida_at,entregado_at,monto_cobrado,
  metodo_pago,exitosa,geo_lat,geo_lng,foto_url,firma_cliente)
 VALUES(p_request_id,v_a.id,v_responsable,v_p.id,v_a.updated_at,NOW(),v_monto,
  v_metodo,true,p_lat,p_lng,p_foto_url,p_firma_url) RETURNING * INTO v_entrega;
 IF v_metodo='efectivo' THEN
  INSERT INTO rep_cuentas_cobrar(pedido_id,asignacion_id,repartidor_id,monto_pedido,monto_cobrado,metodo_pago,estado,cobrado_at)
  VALUES(v_p.id,v_a.id,v_entrega.repartidor_id,v_p.total,v_monto,'efectivo','cobrado',NOW());
  INSERT INTO rep_transacciones_caja(repartidor_id,pedido_id,tipo,monto,estado)
  VALUES(v_entrega.repartidor_id,v_p.id,'ingreso_entrega',v_monto,'pendiente');
 END IF;
 RETURN v_entrega;
END $$;
REVOKE ALL ON FUNCTION finalizar_entrega_atomica(UUID,UUID,NUMERIC,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalizar_entrega_atomica(UUID,UUID,NUMERIC,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION registrar_entrega_fallida_atomica(
 p_request_id UUID,p_asignacion_id UUID,p_motivo TEXT,p_lat NUMERIC DEFAULT NULL,p_lng NUMERIC DEFAULT NULL
) RETURNS rep_entregas LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_a rep_asignaciones;v_e rep_entregas;v_actor UUID;
BEGIN
 IF auth.uid() IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Operación no autorizada'; END IF;
 IF LENGTH(TRIM(COALESCE(p_motivo,'')))<3 THEN RAISE EXCEPTION 'Debe indicar el motivo de la entrega fallida'; END IF;
 SELECT * INTO v_e FROM rep_entregas WHERE request_id=p_request_id;IF FOUND THEN RETURN v_e;END IF;
 SELECT * INTO v_a FROM rep_asignaciones WHERE id=p_asignacion_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Asignación no encontrada';END IF;
 SELECT id INTO v_actor FROM rep_repartidores WHERE user_id=auth.uid() AND activo=true LIMIT 1;
 IF v_actor IS DISTINCT FROM COALESCE(v_a.rider_id,v_a.repartidor_id) AND NOT rep_is_admin() THEN RAISE EXCEPTION 'No es responsable de esta entrega';END IF;
 IF EXISTS(SELECT 1 FROM rep_entregas WHERE pedido_id=v_a.pedido_id AND exitosa) THEN RAISE EXCEPTION 'El pedido ya fue entregado';END IF;
 UPDATE rep_asignaciones SET estado='devuelto',updated_at=NOW() WHERE id=v_a.id;
 INSERT INTO rep_entregas(request_id,asignacion_id,repartidor_id,pedido_id,entregado_at,monto_cobrado,exitosa,motivo_fallo,geo_lat,geo_lng)
 VALUES(p_request_id,v_a.id,COALESCE(v_a.rider_id,v_a.repartidor_id),v_a.pedido_id,NOW(),0,false,TRIM(p_motivo),p_lat,p_lng) RETURNING * INTO v_e;
 RETURN v_e;
END $$;
REVOKE ALL ON FUNCTION registrar_entrega_fallida_atomica(UUID,UUID,TEXT,NUMERIC,NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_entrega_fallida_atomica(UUID,UUID,TEXT,NUMERIC,NUMERIC) TO authenticated;

-- Diagnóstico de producción: cada contador debe mantenerse en cero.
CREATE OR REPLACE VIEW rep_salud_operativa WITH(security_invoker=true) AS
SELECT
 (SELECT COUNT(*) FROM rep_entregas e JOIN ol_pedidos p ON p.id=e.pedido_id WHERE e.exitosa AND p.estado<>'entregado') pedidos_entregados_desalineados,
 COALESCE((SELECT COUNT(*) FROM (SELECT pedido_id FROM rep_entregas WHERE exitosa GROUP BY pedido_id HAVING COUNT(*)>1) d),0) pedidos_con_entrega_duplicada,
 (SELECT COUNT(*) FROM rep_entregas WHERE exitosa AND metodo_pago='efectivo' AND COALESCE(monto_cobrado,0)<=0) entregas_efectivo_sin_monto,
 (SELECT COUNT(*) FROM rep_entregas WHERE exitosa AND NULLIF(TRIM(foto_url),'') IS NULL) entregas_sin_evidencia,
 (SELECT COUNT(*) FROM rep_repartidores WHERE efectivo_en_mano<0) saldos_negativos,
 (SELECT COUNT(*) FROM rep_control_pedidos_360 WHERE CARDINALITY(alertas)>0) pedidos_con_alertas;
REVOKE ALL ON rep_salud_operativa FROM PUBLIC,anon;GRANT SELECT ON rep_salud_operativa TO authenticated;
