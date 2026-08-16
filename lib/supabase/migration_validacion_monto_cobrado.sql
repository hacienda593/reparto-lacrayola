-- migration_validacion_monto_cobrado.sql
-- Hallazgo real: finalizar_entrega_atomica solo exigía monto>0 en efectivo,
-- pero NUNCA comparaba ese monto contra ol_pedidos.total (que incluye el
-- envío calculado por la tienda). El campo en el frontend empezaba vacío,
-- con el total solo como placeholder de ayuda -- fácil de pasar por alto,
-- especialmente el valor del envío, que el repartidor no "ve" físicamente
-- como sí ve el precio de los productos. Resultado: se podía cobrar de
-- menos (típicamente justo el envío) y el sistema lo aceptaba sin dejar
-- ningún rastro de la diferencia.
--
-- Fix de dos capas:
-- 1. rep_entregas guarda ahora monto_esperado (= total del pedido al
--    momento de entregar), para poder auditar cualquier diferencia después
--    -- sin bloquear al repartidor si hay una razón legítima (descuento,
--    problema puntual, etc.).
-- 2. Si el monto cobrado es MENOR al total del pedido por más de un
--    centavo de tolerancia, se exige que venga con una nota/motivo -- ya no
--    se puede cobrar de menos en silencio.

ALTER TABLE public.rep_entregas ADD COLUMN IF NOT EXISTS monto_esperado NUMERIC(12,2);
ALTER TABLE public.rep_entregas ADD COLUMN IF NOT EXISTS nota_diferencia_cobro TEXT;

-- Cambia la firma (nuevo parámetro p_nota_diferencia) -- CREATE OR REPLACE
-- con distinta firma crea una función duplicada en vez de reemplazar.
DROP FUNCTION IF EXISTS public.finalizar_entrega_atomica(uuid, uuid, numeric, text, numeric, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.finalizar_entrega_atomica(
  p_request_id uuid, p_asignacion_id uuid, p_monto numeric, p_metodo text,
  p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric,
  p_foto_url text DEFAULT NULL::text, p_firma_url text DEFAULT NULL::text,
  p_referencias text DEFAULT NULL::text, p_nota_diferencia text DEFAULT NULL::text
)
RETURNS rep_entregas
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
 -- Antes no se comparaba contra el total del pedido (que incluye envío) --
 -- se podía cobrar de menos sin dejar rastro. Ahora, si hay diferencia de
 -- más de un centavo por debajo del total, se exige un motivo explícito
 -- (no se bloquea del todo, por si hay una razón legítima puntual).
 IF v_metodo='efectivo' AND v_monto < ROUND(v_p.total,2) - 0.01 AND NULLIF(TRIM(p_nota_diferencia),'') IS NULL THEN
   RAISE EXCEPTION 'El monto cobrado (%) es menor al total del pedido (%, incluye envío). Indica el motivo de la diferencia para continuar.', v_monto, ROUND(v_p.total,2);
 END IF;
 PERFORM set_config('app.via_finalizar_entrega_atomica', 'true', true);
 UPDATE rep_asignaciones SET estado='entregado',foto_entrega_url=p_foto_url,
  firma_cliente_url=p_firma_url,entrega_lat=p_lat,entrega_lng=p_lng,updated_at=NOW()
 WHERE id=v_a.id;
 UPDATE ol_pedidos SET estado='entregado',geo_lat=COALESCE(p_lat,geo_lat),
  geo_lng=COALESCE(p_lng,geo_lng),referencias=COALESCE(NULLIF(TRIM(p_referencias),''),referencias)
 WHERE id=v_p.id;
 INSERT INTO rep_entregas(request_id,asignacion_id,repartidor_id,pedido_id,salida_at,entregado_at,monto_cobrado,
  metodo_pago,exitosa,geo_lat,geo_lng,foto_url,firma_cliente,monto_esperado,nota_diferencia_cobro)
 VALUES(p_request_id,v_a.id,v_responsable,v_p.id,v_a.updated_at,NOW(),v_monto,
  v_metodo,true,p_lat,p_lng,p_foto_url,p_firma_url,ROUND(v_p.total,2),NULLIF(TRIM(p_nota_diferencia),'')) RETURNING * INTO v_entrega;
 IF v_metodo='efectivo' THEN
  INSERT INTO rep_cuentas_cobrar(pedido_id,asignacion_id,repartidor_id,monto_pedido,monto_cobrado,metodo_pago,estado,cobrado_at)
  VALUES(v_p.id,v_a.id,v_entrega.repartidor_id,v_p.total,v_monto,'efectivo','cobrado',NOW());
  INSERT INTO rep_transacciones_caja(repartidor_id,pedido_id,tipo,monto,estado)
  VALUES(v_entrega.repartidor_id,v_p.id,'ingreso_entrega',v_monto,'pendiente');
 END IF;
 PERFORM registrar_evento_pedido(v_p.id, v_a.id, 'entrega_exitosa', auth.uid(), v_responsable, jsonb_build_object('metodo', v_metodo, 'monto', v_monto, 'monto_esperado', ROUND(v_p.total,2)), p_request_id);
 RETURN v_entrega;
END $function$;
REVOKE EXECUTE ON FUNCTION public.finalizar_entrega_atomica FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalizar_entrega_atomica TO authenticated;
