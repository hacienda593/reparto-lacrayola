-- migration_historial_eventos.sql
-- Fase 4, punto 12 de docs/auditoria_plan_correcciones_ia.md
--
-- Historial inmutable de eventos del pedido, insert-only. Se engancha
-- dentro de las RPC ya creadas en esta auditoría (no requiere cambios de
-- frontend: el registro ocurre en el servidor, en la misma transacción que
-- cada operación).

CREATE TABLE IF NOT EXISTS public.rep_pedido_eventos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id           UUID NOT NULL REFERENCES public.ol_pedidos(id),
  asignacion_id       UUID REFERENCES public.rep_asignaciones(id),
  tipo                TEXT NOT NULL,
  actor_user_id       UUID,
  actor_repartidor_id UUID,
  datos               JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rep_pedido_eventos_pedido ON public.rep_pedido_eventos(pedido_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_pedido_eventos_request_id ON public.rep_pedido_eventos(request_id) WHERE request_id IS NOT NULL;

ALTER TABLE public.rep_pedido_eventos ENABLE ROW LEVEL SECURITY;

-- Solo lectura para el personal habilitado a ver ese pedido; nunca UPDATE/DELETE desde el cliente.
DROP POLICY IF EXISTS rep_pedido_eventos_select ON public.rep_pedido_eventos;
CREATE POLICY rep_pedido_eventos_select ON public.rep_pedido_eventos FOR SELECT TO authenticated
  USING (rep_puede_ver_pedido(pedido_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rep_pedido_eventos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rep_pedido_eventos FROM anon;

-- Helper insert-only, de uso interno desde otras funciones SECURITY DEFINER
-- (no se expone EXECUTE a authenticated/anon: solo la llaman otras RPC ya
-- otorgadas, que corren con los privilegios del dueño de la función).
CREATE OR REPLACE FUNCTION public.registrar_evento_pedido(
  p_pedido_id UUID,
  p_asignacion_id UUID,
  p_tipo TEXT,
  p_actor_user_id UUID,
  p_actor_repartidor_id UUID,
  p_datos JSONB DEFAULT '{}'::jsonb,
  p_request_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO rep_pedido_eventos (pedido_id, asignacion_id, tipo, actor_user_id, actor_repartidor_id, datos, request_id)
  VALUES (p_pedido_id, p_asignacion_id, p_tipo, p_actor_user_id, p_actor_repartidor_id, COALESCE(p_datos, '{}'::jsonb), p_request_id)
  ON CONFLICT DO NOTHING; -- si ya existe un evento con ese request_id, no duplicar
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_evento_pedido FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enganchar en las RPC críticas ya creadas en esta auditoría.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aceptar_pedido_shopper(p_pedido_id UUID, p_request_id UUID)
RETURNS public.rep_asignaciones
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_repartidor_id UUID; v_repartidor rep_repartidores; v_pedido ol_pedidos; v_asignacion rep_asignaciones;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Falta identificador de operación'; END IF;
  SELECT * INTO v_asignacion FROM rep_asignaciones WHERE request_id = p_request_id;
  IF FOUND THEN RETURN v_asignacion; END IF;
  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe un perfil de repartidor para este usuario'; END IF;
  v_repartidor_id := v_repartidor.id;
  IF NOT v_repartidor.activo THEN RAISE EXCEPTION 'Tu cuenta de repartidor está desactivada'; END IF;
  IF v_repartidor.estado_registro <> 'aprobado' THEN RAISE EXCEPTION 'Tu registro aún no ha sido aprobado'; END IF;
  IF v_repartidor.estado = 'BLOQUEADO' THEN RAISE EXCEPTION 'Tienes la cuenta bloqueada por exceso de efectivo en mano; liquida antes de aceptar más pedidos'; END IF;
  IF v_repartidor.estado = 'INACTIVO' THEN RAISE EXCEPTION 'Tu cuenta está inactiva'; END IF;
  SELECT * INTO v_pedido FROM ol_pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF v_pedido.estado <> 'pendiente' THEN RAISE EXCEPTION 'Este pedido ya no está disponible para aceptar (estado actual: %)', v_pedido.estado; END IF;
  INSERT INTO rep_asignaciones (pedido_id, repartidor_id, shopper_id, estado, notas, prioridad, request_id, asignado_por, asignado_at)
  VALUES (p_pedido_id, v_repartidor_id, v_repartidor_id, 'asignado', 'Auto-asignado por el Comprador desde el celular', 1, p_request_id, auth.uid(), NOW())
  RETURNING * INTO v_asignacion;
  UPDATE ol_pedidos SET estado = 'confirmado' WHERE id = p_pedido_id;
  PERFORM registrar_evento_pedido(p_pedido_id, v_asignacion.id, 'shopper_asignado', auth.uid(), v_repartidor_id, jsonb_build_object('shopper', v_repartidor.nombre), p_request_id);
  RETURN v_asignacion;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'Este pedido ya fue tomado por otro repartidor';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aceptar_pedido_shopper FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceptar_pedido_shopper TO authenticated;

CREATE OR REPLACE FUNCTION public.iniciar_compra_shopper(p_asignacion_id UUID, p_request_id UUID)
RETURNS public.rep_asignaciones
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_repartidor rep_repartidores; v_a rep_asignaciones; v_p ol_pedidos;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Falta identificador de operación'; END IF;
  SELECT * INTO v_a FROM rep_asignaciones WHERE compra_iniciada_request_id = p_request_id;
  IF FOUND THEN RETURN v_a; END IF;
  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_repartidor.activo OR v_repartidor.estado_registro <> 'aprobado' OR v_repartidor.estado = 'BLOQUEADO' OR v_repartidor.estado = 'INACTIVO' THEN
    RAISE EXCEPTION 'Tu cuenta no está habilitada para comprar en este momento';
  END IF;
  SELECT * INTO v_a FROM rep_asignaciones WHERE id = p_asignacion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asignación no encontrada'; END IF;
  IF v_a.shopper_id IS DISTINCT FROM v_repartidor.id AND NOT rep_is_admin() THEN RAISE EXCEPTION 'No eres el comprador responsable de esta asignación'; END IF;
  IF v_a.estado <> 'asignado' THEN RAISE EXCEPTION 'La asignación no está en estado asignado (actual: %)', v_a.estado; END IF;
  IF v_a.compra_iniciada_at IS NOT NULL THEN RAISE EXCEPTION 'La compra de esta asignación ya fue iniciada'; END IF;
  SELECT * INTO v_p FROM ol_pedidos WHERE id = v_a.pedido_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF v_p.metodo_pago = 'transferencia' AND NOT COALESCE(v_p.pago_confirmado, false) THEN RAISE EXCEPTION 'La transferencia de este pedido aún no ha sido validada por administración'; END IF;
  UPDATE rep_asignaciones SET compra_iniciada_at = NOW(), compra_iniciada_request_id = p_request_id WHERE id = p_asignacion_id RETURNING * INTO v_a;
  UPDATE ol_pedidos SET estado = 'preparado' WHERE id = v_a.pedido_id;
  PERFORM registrar_evento_pedido(v_a.pedido_id, v_a.id, 'compra_iniciada', auth.uid(), v_repartidor.id, '{}'::jsonb, p_request_id);
  RETURN v_a;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.iniciar_compra_shopper FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_compra_shopper TO authenticated;

CREATE OR REPLACE FUNCTION public.finalizar_compra_shopper(p_asignacion_id UUID, p_request_id UUID)
RETURNS public.rep_asignaciones
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_repartidor rep_repartidores; v_a rep_asignaciones; v_pendientes INTEGER; v_total_items INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Falta identificador de operación'; END IF;
  SELECT * INTO v_a FROM rep_asignaciones WHERE finalizar_compra_request_id = p_request_id;
  IF FOUND THEN RETURN v_a; END IF;
  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_repartidor.activo OR v_repartidor.estado_registro <> 'aprobado' OR v_repartidor.estado IN ('BLOQUEADO', 'INACTIVO') THEN
    RAISE EXCEPTION 'Tu cuenta no está habilitada en este momento';
  END IF;
  SELECT * INTO v_a FROM rep_asignaciones WHERE id = p_asignacion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asignación no encontrada'; END IF;
  IF v_a.shopper_id IS DISTINCT FROM v_repartidor.id AND NOT rep_is_admin() THEN RAISE EXCEPTION 'No eres el comprador responsable de esta asignación'; END IF;
  IF v_a.estado <> 'asignado' THEN RAISE EXCEPTION 'La asignación no está en estado asignado (actual: %)', v_a.estado; END IF;
  IF v_a.compra_iniciada_at IS NULL THEN RAISE EXCEPTION 'Debes iniciar la compra antes de finalizarla'; END IF;
  SELECT COUNT(*), COUNT(*) FILTER (WHERE NOT COALESCE(picking_completado, false) AND NOT COALESCE(picking_agotado, false))
    INTO v_total_items, v_pendientes FROM ol_pedido_items WHERE pedido_id = v_a.pedido_id;
  IF v_total_items = 0 THEN RAISE EXCEPTION 'El pedido no tiene ítems registrados'; END IF;
  IF v_pendientes > 0 THEN RAISE EXCEPTION 'Quedan % ítem(s) sin resolver (completar o marcar agotado)', v_pendientes; END IF;
  UPDATE rep_asignaciones SET estado = 'en_ruta', rider_id = COALESCE(rider_id, v_repartidor.id), finalizar_compra_request_id = p_request_id, updated_at = NOW()
   WHERE id = p_asignacion_id RETURNING * INTO v_a;
  UPDATE ol_pedidos SET estado = 'enviado' WHERE id = v_a.pedido_id;
  PERFORM registrar_evento_pedido(v_a.pedido_id, v_a.id, 'compra_finalizada', auth.uid(), v_repartidor.id, '{}'::jsonb, p_request_id);
  RETURN v_a;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.finalizar_compra_shopper FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalizar_compra_shopper TO authenticated;

-- confirmar_pago_admin / revertir_pago_admin: agregar evento al final de cada una.
CREATE OR REPLACE FUNCTION public.confirmar_pago_admin(
  p_pedido_id UUID, p_referencia TEXT, p_banco TEXT DEFAULT NULL, p_fecha DATE DEFAULT NULL,
  p_evidencia_path TEXT DEFAULT NULL, p_request_id UUID DEFAULT NULL
)
RETURNS public.ol_pedidos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_pedido ol_pedidos; v_existe_request RECORD;
BEGIN
  IF NOT rep_puede_confirmar_pago() THEN RAISE EXCEPTION 'No autorizado para confirmar pagos' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NOT NULL THEN
    SELECT pedido_id INTO v_existe_request FROM ol_pedidos_verificaciones WHERE request_id = p_request_id LIMIT 1;
    IF FOUND THEN SELECT * INTO v_pedido FROM ol_pedidos WHERE id = v_existe_request.pedido_id; RETURN v_pedido; END IF;
  END IF;
  SELECT * INTO v_pedido FROM ol_pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido % no existe', p_pedido_id; END IF;
  IF v_pedido.pago_confirmado THEN RAISE EXCEPTION 'El pago de este pedido ya está confirmado' USING ERRCODE = '22023'; END IF;
  IF p_referencia IS NULL OR btrim(p_referencia) = '' THEN RAISE EXCEPTION 'La referencia del comprobante es obligatoria'; END IF;
  UPDATE ol_pedidos SET pago_confirmado = true, referencia_transferencia = btrim(p_referencia) WHERE id = p_pedido_id RETURNING * INTO v_pedido;
  INSERT INTO ol_pedidos_verificaciones (pedido_id, accion, referencia, banco, fecha_deposito, admin_user_id, admin_nombre, evidencia_path, request_id)
  VALUES (p_pedido_id, 'confirmado', btrim(p_referencia), p_banco, p_fecha, auth.uid(),
    COALESCE((SELECT nombre FROM rep_repartidores WHERE user_id = auth.uid()), auth.uid()::text), p_evidencia_path, p_request_id);
  PERFORM registrar_evento_pedido(p_pedido_id, NULL, 'pago_confirmado', auth.uid(), NULL, jsonb_build_object('referencia', btrim(p_referencia), 'banco', p_banco), p_request_id);
  RETURN v_pedido;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.confirmar_pago_admin FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_pago_admin TO authenticated;

CREATE OR REPLACE FUNCTION public.revertir_pago_admin(p_pedido_id UUID, p_motivo TEXT, p_request_id UUID DEFAULT NULL)
RETURNS public.ol_pedidos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_pedido ol_pedidos; v_existe_request RECORD;
BEGIN
  IF NOT rep_puede_confirmar_pago() THEN RAISE EXCEPTION 'No autorizado para revertir pagos' USING ERRCODE = '42501'; END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN RAISE EXCEPTION 'Debes indicar un motivo para revertir la confirmación de pago'; END IF;
  IF p_request_id IS NOT NULL THEN
    SELECT pedido_id INTO v_existe_request FROM ol_pedidos_verificaciones WHERE request_id = p_request_id LIMIT 1;
    IF FOUND THEN SELECT * INTO v_pedido FROM ol_pedidos WHERE id = v_existe_request.pedido_id; RETURN v_pedido; END IF;
  END IF;
  SELECT * INTO v_pedido FROM ol_pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido % no existe', p_pedido_id; END IF;
  IF NOT v_pedido.pago_confirmado THEN RAISE EXCEPTION 'Este pedido no tiene un pago confirmado que revertir' USING ERRCODE = '22023'; END IF;
  UPDATE ol_pedidos SET pago_confirmado = false WHERE id = p_pedido_id RETURNING * INTO v_pedido;
  INSERT INTO ol_pedidos_verificaciones (pedido_id, accion, referencia, notas, admin_user_id, admin_nombre, request_id)
  VALUES (p_pedido_id, 'anulado', v_pedido.referencia_transferencia, btrim(p_motivo), auth.uid(),
    COALESCE((SELECT nombre FROM rep_repartidores WHERE user_id = auth.uid()), auth.uid()::text), p_request_id);
  PERFORM registrar_evento_pedido(p_pedido_id, NULL, 'pago_revertido', auth.uid(), NULL, jsonb_build_object('motivo', btrim(p_motivo)), p_request_id);
  RETURN v_pedido;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.revertir_pago_admin FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revertir_pago_admin TO authenticated;

-- finalizar_entrega_atomica: agregar evento de entrega_exitosa.
CREATE OR REPLACE FUNCTION public.finalizar_entrega_atomica(p_request_id uuid, p_asignacion_id uuid, p_monto numeric, p_metodo text, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_foto_url text DEFAULT NULL::text, p_firma_url text DEFAULT NULL::text, p_referencias text DEFAULT NULL::text)
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
 PERFORM set_config('app.via_finalizar_entrega_atomica', 'true', true);
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
 PERFORM registrar_evento_pedido(v_p.id, v_a.id, 'entrega_exitosa', auth.uid(), v_responsable, jsonb_build_object('metodo', v_metodo, 'monto', v_monto), p_request_id);
 RETURN v_entrega;
END $function$;

-- registrar_entrega_fallida_atomica: evento entrega_fallida.
CREATE OR REPLACE FUNCTION public.registrar_entrega_fallida_atomica(p_request_id uuid, p_asignacion_id uuid, p_motivo text, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric)
 RETURNS rep_entregas
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
 PERFORM registrar_evento_pedido(v_a.pedido_id, v_a.id, 'entrega_fallida', auth.uid(), v_actor, jsonb_build_object('motivo', TRIM(p_motivo)), p_request_id);
 RETURN v_e;
END $function$;

-- crear_traspaso_shopper / aceptar_traspaso_rider: eventos handoff_creado / custodia_transferida.
CREATE OR REPLACE FUNCTION public.crear_traspaso_shopper(p_asignacion_id UUID, p_lat NUMERIC DEFAULT NULL, p_lng NUMERIC DEFAULT NULL)
RETURNS TABLE(handoff_id UUID, token TEXT, codigo_visual TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_repartidor rep_repartidores; v_a rep_asignaciones; v_token TEXT; v_codigo TEXT; v_id UUID; v_expires TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_repartidor.activo OR v_repartidor.estado_registro <> 'aprobado' OR v_repartidor.estado IN ('BLOQUEADO','INACTIVO') THEN
    RAISE EXCEPTION 'Tu cuenta no está habilitada en este momento';
  END IF;
  SELECT * INTO v_a FROM rep_asignaciones WHERE id = p_asignacion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asignación no encontrada'; END IF;
  IF v_a.shopper_id IS DISTINCT FROM v_repartidor.id AND NOT rep_is_admin() THEN RAISE EXCEPTION 'No eres el comprador responsable de esta asignación'; END IF;
  IF v_a.estado <> 'recolectado' THEN RAISE EXCEPTION 'La asignación debe estar en estado recolectado (actual: %)', v_a.estado; END IF;
  UPDATE rep_handoffs SET estado = 'cancelado' WHERE asignacion_id = p_asignacion_id AND estado = 'pendiente';
  v_token := encode(gen_random_bytes(16), 'hex');
  v_codigo := upper(substr(encode(gen_random_bytes(6), 'base64'), 1, 6));
  v_codigo := regexp_replace(v_codigo, '[^A-Z0-9]', 'X', 'g');
  v_expires := NOW() + INTERVAL '8 minutes';
  INSERT INTO rep_handoffs (asignacion_id, shopper_id, token_hash, codigo_visual, estado, expires_at, shopper_lat, shopper_lng)
  VALUES (p_asignacion_id, v_a.shopper_id, encode(digest(v_token, 'sha256'), 'hex'), v_codigo, 'pendiente', v_expires, p_lat, p_lng)
  RETURNING id INTO v_id;
  PERFORM registrar_evento_pedido(v_a.pedido_id, v_a.id, 'handoff_creado', auth.uid(), v_repartidor.id, '{}'::jsonb, NULL);
  RETURN QUERY SELECT v_id, v_token, v_codigo, v_expires;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crear_traspaso_shopper FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_traspaso_shopper TO authenticated;

CREATE OR REPLACE FUNCTION public.aceptar_traspaso_rider(p_token TEXT, p_request_id UUID, p_lat NUMERIC DEFAULT NULL, p_lng NUMERIC DEFAULT NULL)
RETURNS public.rep_handoffs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_repartidor rep_repartidores; v_h rep_handoffs; v_a rep_asignaciones; v_token_limpio TEXT; v_es_codigo_visual BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Falta identificador de operación'; END IF;
  SELECT * INTO v_h FROM rep_handoffs WHERE request_id = p_request_id;
  IF FOUND THEN RETURN v_h; END IF;
  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND OR NOT v_repartidor.activo OR v_repartidor.estado_registro <> 'aprobado' OR v_repartidor.estado IN ('BLOQUEADO','INACTIVO') THEN
    RAISE EXCEPTION 'Tu cuenta no está habilitada en este momento';
  END IF;
  v_token_limpio := TRIM(p_token);
  v_es_codigo_visual := LENGTH(v_token_limpio) <= 8;
  IF v_es_codigo_visual THEN
    SELECT * INTO v_h FROM rep_handoffs WHERE codigo_visual = upper(v_token_limpio) AND estado = 'pendiente' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  ELSE
    SELECT * INTO v_h FROM rep_handoffs WHERE token_hash = encode(digest(v_token_limpio, 'sha256'), 'hex') AND estado = 'pendiente' FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    UPDATE rep_handoffs SET intentos = intentos + 1 WHERE estado = 'pendiente' AND expires_at > NOW() AND v_es_codigo_visual;
    RAISE EXCEPTION 'Código inválido o expirado';
  END IF;
  IF v_h.expires_at <= NOW() THEN UPDATE rep_handoffs SET estado = 'expirado' WHERE id = v_h.id; RAISE EXCEPTION 'El código de traspaso expiró; pide uno nuevo al comprador'; END IF;
  IF v_h.intentos >= 8 THEN UPDATE rep_handoffs SET estado = 'cancelado' WHERE id = v_h.id; RAISE EXCEPTION 'Demasiados intentos fallidos; pide un código nuevo'; END IF;
  SELECT * INTO v_a FROM rep_asignaciones WHERE id = v_h.asignacion_id FOR UPDATE;
  IF NOT FOUND OR v_a.estado <> 'recolectado' THEN UPDATE rep_handoffs SET estado = 'cancelado' WHERE id = v_h.id; RAISE EXCEPTION 'La asignación ya no está disponible para traspaso'; END IF;
  IF v_repartidor.id = v_h.shopper_id THEN RAISE EXCEPTION 'El comprador no puede aceptar su propio traspaso; usa "Entregar yo mismo"'; END IF;
  UPDATE rep_handoffs SET estado = 'aceptado', rider_id = v_repartidor.id, accepted_at = NOW(), rider_lat = p_lat, rider_lng = p_lng, request_id = p_request_id WHERE id = v_h.id RETURNING * INTO v_h;
  UPDATE rep_asignaciones SET rider_id = v_repartidor.id, repartidor_id = v_repartidor.id, handoff_at = NOW(), estado = 'en_ruta', updated_at = NOW() WHERE id = v_a.id;
  UPDATE ol_pedidos SET estado = 'enviado' WHERE id = v_a.pedido_id;
  PERFORM registrar_evento_pedido(v_a.pedido_id, v_a.id, 'custodia_transferida', auth.uid(), v_repartidor.id, jsonb_build_object('shopper_id', v_h.shopper_id), p_request_id);
  RETURN v_h;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aceptar_traspaso_rider FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceptar_traspaso_rider TO authenticated;

-- registrar_factura_compra_servidor: eventos factura_proveedor_registrada.
CREATE OR REPLACE FUNCTION public.registrar_factura_compra_servidor(
  p_asignacion_id UUID, p_actor_user_id UUID, p_actor_repartidor_id UUID, p_tienda_id UUID,
  p_prov_ruc TEXT, p_prov_establecimiento TEXT, p_prov_punto_emision TEXT, p_prov_secuencial TEXT,
  p_monto_digitado NUMERIC, p_metodo_pago TEXT, p_foto_path TEXT, p_clave_acceso TEXT,
  p_sri_estado TEXT, p_sri_fecha_autorizacion TIMESTAMPTZ, p_sri_xml TEXT, p_sri_sha256 TEXT,
  p_sri_razon_social_emisor TEXT, p_sri_identificacion_comprador TEXT,
  p_sri_subtotal NUMERIC, p_sri_iva NUMERIC, p_sri_total NUMERIC, p_sri_ambiente TEXT,
  p_conciliacion_estado TEXT, p_conciliacion_diferencias JSONB, p_request_id UUID
)
RETURNS public.ol_pedidos_comprobantes_proveedor
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_a rep_asignaciones; v_comprobante ol_pedidos_comprobantes_proveedor; v_pendientes INTEGER; v_total_items INTEGER;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Falta identificador de operación'; END IF;
  SELECT * INTO v_comprobante FROM ol_pedidos_comprobantes_proveedor WHERE request_id = p_request_id;
  IF FOUND THEN RETURN v_comprobante; END IF;
  IF p_sri_sha256 IS NULL OR LENGTH(p_sri_sha256) <> 64 THEN RAISE EXCEPTION 'Hash SRI inválido'; END IF;
  IF p_sri_estado IS DISTINCT FROM 'AUTORIZADO' THEN RAISE EXCEPTION 'El comprobante no está autorizado por el SRI (estado: %)', p_sri_estado; END IF;
  SELECT * INTO v_a FROM rep_asignaciones WHERE id = p_asignacion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asignación no encontrada'; END IF;
  IF v_a.estado <> 'asignado' THEN RAISE EXCEPTION 'La asignación no está en estado asignado (actual: %)', v_a.estado; END IF;
  IF v_a.shopper_id IS DISTINCT FROM p_actor_repartidor_id THEN RAISE EXCEPTION 'No eres el comprador responsable de esta asignación'; END IF;
  SELECT COUNT(*), COUNT(*) FILTER (WHERE NOT COALESCE(picking_completado, false) AND NOT COALESCE(picking_agotado, false))
    INTO v_total_items, v_pendientes FROM ol_pedido_items WHERE pedido_id = v_a.pedido_id;
  IF v_total_items = 0 THEN RAISE EXCEPTION 'El pedido no tiene ítems registrados'; END IF;
  IF v_pendientes > 0 THEN RAISE EXCEPTION 'Quedan % ítem(s) sin resolver antes de facturar', v_pendientes; END IF;
  IF EXISTS (SELECT 1 FROM ol_pedidos_comprobantes_proveedor WHERE prov_clave_acceso = p_clave_acceso) THEN
    RAISE EXCEPTION 'Esta clave de acceso ya fue registrada en otro comprobante';
  END IF;
  INSERT INTO ol_pedidos_comprobantes_proveedor (
    pedido_id, tienda_id, prov_establecimiento, prov_punto_emision, prov_secuencial,
    prov_costo_real, prov_factura_url, prov_clave_acceso, prov_ruc, metodo_pago,
    sri_estado, sri_fecha_autorizacion, sri_xml, sri_xml_sha256,
    sri_razon_social_emisor, sri_identificacion_comprador,
    sri_subtotal, sri_iva, sri_total, sri_ambiente, sri_consultado_at,
    conciliacion_estado, conciliacion_diferencias, registrada_por, registrada_at, request_id
  ) VALUES (
    v_a.pedido_id, p_tienda_id, p_prov_establecimiento, p_prov_punto_emision, p_prov_secuencial,
    p_monto_digitado, p_foto_path, p_clave_acceso, p_prov_ruc, p_metodo_pago,
    p_sri_estado, p_sri_fecha_autorizacion, p_sri_xml, p_sri_sha256,
    p_sri_razon_social_emisor, p_sri_identificacion_comprador,
    p_sri_subtotal, p_sri_iva, p_sri_total, p_sri_ambiente, NOW(),
    p_conciliacion_estado, p_conciliacion_diferencias, p_actor_user_id, NOW(), p_request_id
  ) RETURNING * INTO v_comprobante;
  IF p_metodo_pago = 'efectivo_caja_chica' THEN
    INSERT INTO rep_transacciones_caja (repartidor_id, pedido_id, tipo, monto, comprobante_url, estado)
    VALUES (p_actor_repartidor_id, v_a.pedido_id, 'egreso_compra', p_monto_digitado, p_foto_path, 'pendiente');
  END IF;
  UPDATE ol_pedidos SET estado = 'preparado' WHERE id = v_a.pedido_id;
  UPDATE rep_asignaciones SET estado = 'recolectado', updated_at = NOW() WHERE id = p_asignacion_id;
  PERFORM registrar_evento_pedido(v_a.pedido_id, v_a.id, 'factura_proveedor_registrada', p_actor_user_id, p_actor_repartidor_id, jsonb_build_object('clave_acceso', p_clave_acceso, 'total', p_sri_total), p_request_id);
  RETURN v_comprobante;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.registrar_factura_compra_servidor FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_factura_compra_servidor TO service_role;

-- revisar_factura_compra: evento factura_proveedor_validada.
CREATE OR REPLACE FUNCTION public.revisar_factura_compra(p_comprobante_id UUID, p_estado TEXT, p_motivo TEXT DEFAULT NULL::TEXT)
RETURNS ol_pedidos_comprobantes_proveedor
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_result ol_pedidos_comprobantes_proveedor; v_umbral NUMERIC;
BEGIN
  IF NOT rep_puede_validar_factura_compra() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  IF p_estado NOT IN ('validada','rechazada','con_diferencia') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
  IF p_estado <> 'validada' AND NULLIF(TRIM(p_motivo),'') IS NULL THEN RAISE EXCEPTION 'Debe indicar el motivo'; END IF;
  SELECT * INTO v_result FROM ol_pedidos_comprobantes_proveedor WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factura de compra no encontrada'; END IF;
  SELECT COALESCE(valor::numeric, 20.00) INTO v_umbral FROM rep_configuracion WHERE clave = 'umbral_separacion_funciones_factura';
  IF v_result.registrada_por IS NOT NULL AND v_result.registrada_por = auth.uid() AND v_result.prov_costo_real >= COALESCE(v_umbral, 20.00) AND NOT rep_tiene_rol('superadmin') THEN
    RAISE EXCEPTION 'Por separación de funciones, quien registró esta factura (monto >= %) no puede validarla', COALESCE(v_umbral, 20.00);
  END IF;
  UPDATE ol_pedidos_comprobantes_proveedor SET estado_revision = p_estado, revisada_por = auth.uid(), revisada_at = NOW(), motivo_revision = NULLIF(TRIM(p_motivo),'')
   WHERE id = p_comprobante_id RETURNING * INTO v_result;
  PERFORM registrar_evento_pedido(v_result.pedido_id, NULL, 'factura_proveedor_validada', auth.uid(), NULL, jsonb_build_object('estado', p_estado, 'motivo', p_motivo), NULL);
  RETURN v_result;
END;
$function$;
