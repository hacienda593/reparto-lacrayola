-- migration_p1_03_cliente_direccion_estable.sql
--
-- P1-03 de la auditoría operativa (docs/auditoria_operativa_aplicacion_entregas_2026-08-21.md):
-- "Administración considera nuevo al cliente según direcciones previas y
-- coordenadas; entrega busca coincidencias aproximadas por teléfono y
-- texto. Esto no garantiza que sea el primer pedido del cliente ni que
-- se trate de la misma vivienda."
--
-- Verificado en vivo antes de tocar nada: ol_pedidos.cliente_id YA EXISTE
-- (FK a ol_clientes) pero está en 0 de 6 pedidos reales -- es
-- infraestructura muerta. Además ol_clientes tiene auth_id UNIQUE, es
-- decir que solo cubre clientes con cuenta registrada -- 5 de los 6
-- pedidos reales son de invitado (user_id NULL). Por eso no sirve como
-- identidad estable de "cliente" para todo el negocio: se necesita algo
-- keyed por teléfono, que es lo único que de verdad identifica a un
-- comprador tanto si tiene cuenta como si no.
--
-- No se toca ol_pedidos.cliente_id / ol_clientes (no se sabe qué asume
-- tienda-lacrayola sobre esa columna sin auditar ese repo aparte) --
-- se agrega infraestructura nueva, aditiva:
--   rep_clientes            identidad estable por teléfono normalizado
--   rep_clientes_direcciones.cliente_id / .estado   direccion con estado
--   rep_direcciones_historial   bitácora append-only de correcciones
--   ol_pedidos.rep_cliente_id / .direccion_id       enlace estable

-- ------------------------------------------------------------------
-- 1. Identidad estable de cliente (por teléfono, cubre invitado + con cuenta)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rep_clientes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono   TEXT NOT NULL UNIQUE,
  nombre     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.rep_clientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rep_clientes_select ON public.rep_clientes;
CREATE POLICY rep_clientes_select ON public.rep_clientes FOR SELECT TO authenticated
  USING (rep_tiene_rol('admin', 'superadmin', 'supervisor', 'repartidor', 'shopper'));
REVOKE INSERT, UPDATE, DELETE ON public.rep_clientes FROM PUBLIC, anon, authenticated;

-- Normaliza a formato local ecuatoriano (09XXXXXXXX) para que "099..." y
-- "+593 99..." resuelvan al mismo cliente -- mismo criterio que ya usan
-- los formatWhatsApp() del frontend, en sentido inverso.
CREATE OR REPLACE FUNCTION public.rep_normalizar_telefono(p_telefono TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN regexp_replace(COALESCE(p_telefono, ''), '\D', '', 'g') LIKE '593%'
      THEN '0' || substring(regexp_replace(p_telefono, '\D', '', 'g') FROM 4)
    ELSE regexp_replace(COALESCE(p_telefono, ''), '\D', '', 'g')
  END;
$$;

CREATE OR REPLACE FUNCTION public.resolver_cliente_id(p_telefono TEXT, p_nombre TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tel TEXT; v_id UUID;
BEGIN
  v_tel := rep_normalizar_telefono(p_telefono);
  IF v_tel = '' THEN RETURN NULL; END IF;

  INSERT INTO rep_clientes (telefono, nombre)
  VALUES (v_tel, NULLIF(TRIM(p_nombre), ''))
  ON CONFLICT (telefono) DO UPDATE
    SET nombre = COALESCE(rep_clientes.nombre, EXCLUDED.nombre), updated_at = NOW()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resolver_cliente_id FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_cliente_id TO authenticated;

-- ------------------------------------------------------------------
-- 2. Dirección con estado explícito (no solo un booleano "verificada")
-- ------------------------------------------------------------------
ALTER TABLE public.rep_clientes_direcciones
  ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES public.rep_clientes(id),
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'no_verificada'
    CHECK (estado IN ('no_verificada', 'confirmada', 'corregida'));

-- Backfill de lo que ya existe: si algo ya se había marcado "verificada"
-- a mano (o por el flujo viejo de P0-03), queda como 'confirmada'.
UPDATE public.rep_clientes_direcciones
SET estado = 'confirmada'
WHERE verificada = true AND estado = 'no_verificada';

UPDATE public.rep_clientes_direcciones d
SET cliente_id = resolver_cliente_id(d.telefono, NULL)
WHERE d.cliente_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_rep_clientes_direcciones_cliente ON public.rep_clientes_direcciones(cliente_id);

-- Bitácora append-only de correcciones (la "conservación de versiones"
-- que pide la auditoría, sin reescribir un modelo temporal completo:
-- cada corrección deja un rastro de qué había antes).
CREATE TABLE IF NOT EXISTS public.rep_direcciones_historial (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direccion_id   UUID NOT NULL REFERENCES public.rep_clientes_direcciones(id),
  estado_anterior TEXT,
  estado_nuevo    TEXT NOT NULL,
  geo_lat_anterior NUMERIC(9,6), geo_lng_anterior NUMERIC(9,6),
  geo_lat_nuevo    NUMERIC(9,6), geo_lng_nuevo    NUMERIC(9,6),
  motivo         TEXT,
  actor_user_id  UUID,
  pedido_id      UUID REFERENCES public.ol_pedidos(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rep_direcciones_historial_direccion ON public.rep_direcciones_historial(direccion_id, created_at DESC);
ALTER TABLE public.rep_direcciones_historial ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rep_direcciones_historial_select ON public.rep_direcciones_historial;
CREATE POLICY rep_direcciones_historial_select ON public.rep_direcciones_historial FOR SELECT TO authenticated
  USING (rep_tiene_rol('admin', 'superadmin', 'supervisor', 'repartidor', 'shopper'));
REVOKE INSERT, UPDATE, DELETE ON public.rep_direcciones_historial FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------
-- 3. Enlace estable desde el pedido (aditivo -- no toca cliente_id/
--    ol_clientes existentes, cuyo alcance real no se auditó en este pase)
-- ------------------------------------------------------------------
ALTER TABLE public.ol_pedidos
  ADD COLUMN IF NOT EXISTS rep_cliente_id UUID REFERENCES public.rep_clientes(id),
  ADD COLUMN IF NOT EXISTS direccion_id UUID REFERENCES public.rep_clientes_direcciones(id);

-- ------------------------------------------------------------------
-- 4. resolver_direccion_id(): encuentra o crea la dirección estable
--    (telefono + texto similar, mismo criterio que ya usa el resto del
--    sistema vía rep_direcciones_similares).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolver_direccion_id(
  p_telefono TEXT, p_direccion TEXT, p_ciudad TEXT DEFAULT NULL, p_referencias TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID; v_cliente_id UUID;
BEGIN
  IF p_telefono IS NULL OR NULLIF(TRIM(p_direccion), '') IS NULL THEN RETURN NULL; END IF;
  v_cliente_id := resolver_cliente_id(p_telefono, NULL);

  SELECT id INTO v_id FROM rep_clientes_direcciones
  WHERE telefono = p_telefono AND rep_direcciones_similares(direccion, p_direccion)
  LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO rep_clientes_direcciones (telefono, cliente_id, nombre_direccion, direccion, ciudad, referencias, estado)
  VALUES (p_telefono, v_cliente_id, LEFT(p_direccion, 15), p_direccion, COALESCE(p_ciudad, 'Ciudad'), p_referencias, 'no_verificada')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resolver_direccion_id FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_direccion_id TO authenticated;

-- ------------------------------------------------------------------
-- 5. finalizar_entrega_atomica: exige confirmación explícita si la
--    dirección usada NO estaba verificada -- no basta con "el cliente
--    parece nuevo", como señala la auditoría. Además deja enlazados
--    rep_cliente_id/direccion_id en el pedido, en la misma transacción.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalizar_entrega_atomica(
  p_request_id UUID, p_asignacion_id UUID, p_monto NUMERIC, p_metodo TEXT,
  p_lat NUMERIC DEFAULT NULL, p_lng NUMERIC DEFAULT NULL,
  p_foto_url TEXT DEFAULT NULL, p_firma_url TEXT DEFAULT NULL,
  p_referencias TEXT DEFAULT NULL, p_nota_diferencia TEXT DEFAULT NULL,
  p_direccion_corregida BOOLEAN DEFAULT false,
  p_direccion_confirmada BOOLEAN DEFAULT false
)
RETURNS public.rep_entregas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $function$
DECLARE
  v_a rep_asignaciones; v_p ol_pedidos; v_entrega rep_entregas; v_actor UUID; v_responsable UUID;
  v_monto NUMERIC(12,2); v_metodo TEXT; v_total_esperado NUMERIC(12,2);
  v_comision_tipo TEXT; v_comision_valor NUMERIC; v_comision_calculada NUMERIC;
  v_geo_lat_anterior NUMERIC; v_geo_lng_anterior NUMERIC;
  v_direccion_id UUID; v_dir_estado TEXT; v_dir_lat NUMERIC; v_dir_lng NUMERIC; v_cliente_id UUID;
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

  -- P1-03: identidad estable de cliente + dirección, y exigencia de
  -- confirmación explícita si la dirección usada no estaba verificada
  -- (no alcanza con "no se detectó como cliente nuevo").
  IF v_p.metodo_pago <> 'retiro_local' AND p_metodo <> 'retiro_local' THEN
    v_cliente_id := resolver_cliente_id(v_p.telefono, v_p.nombre_cliente);
    IF v_p.telefono IS NOT NULL AND NULLIF(TRIM(v_p.direccion), '') IS NOT NULL THEN
      v_direccion_id := resolver_direccion_id(v_p.telefono, v_p.direccion, v_p.ciudad, v_p.referencias);
    END IF;

    IF v_direccion_id IS NOT NULL THEN
      SELECT estado, geo_lat, geo_lng INTO v_dir_estado, v_dir_lat, v_dir_lng
      FROM rep_clientes_direcciones WHERE id = v_direccion_id FOR UPDATE;

      IF NOT p_direccion_corregida AND v_dir_estado = 'no_verificada' AND NOT p_direccion_confirmada THEN
        RAISE EXCEPTION 'Debes confirmar que la dirección de entrega es correcta antes de finalizar (dirección aún no verificada para este cliente).';
      END IF;

      IF NOT p_direccion_corregida AND v_dir_estado = 'no_verificada' AND p_direccion_confirmada THEN
        UPDATE rep_clientes_direcciones SET estado = 'confirmada', verificada = true, updated_at = NOW() WHERE id = v_direccion_id;
        INSERT INTO rep_direcciones_historial (direccion_id, estado_anterior, estado_nuevo, geo_lat_anterior, geo_lng_anterior, geo_lat_nuevo, geo_lng_nuevo, motivo, actor_user_id, pedido_id)
        VALUES (v_direccion_id, v_dir_estado, 'confirmada', v_dir_lat, v_dir_lng, v_dir_lat, v_dir_lng, 'Confirmada por el repartidor al entregar sin corregir GPS', auth.uid(), v_p.id);
      END IF;
    END IF;
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
   total_final=v_total_esperado,
   rep_cliente_id=COALESCE(v_cliente_id, rep_cliente_id),
   direccion_id=COALESCE(v_direccion_id, direccion_id)
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

    IF v_direccion_id IS NOT NULL THEN
      INSERT INTO rep_direcciones_historial (direccion_id, estado_anterior, estado_nuevo, geo_lat_anterior, geo_lng_anterior, geo_lat_nuevo, geo_lng_nuevo, motivo, actor_user_id, pedido_id)
      VALUES (v_direccion_id, v_dir_estado, 'corregida', v_dir_lat, v_dir_lng, p_lat, p_lng, 'Corrección de GPS en el momento de la entrega', auth.uid(), v_p.id);
      UPDATE rep_clientes_direcciones
      SET geo_lat = p_lat, geo_lng = p_lng, estado = 'corregida', verificada = true, updated_at = NOW()
      WHERE id = v_direccion_id;
    ELSIF v_p.telefono IS NOT NULL THEN
      -- Sin match previo (dirección nueva de una vez): se crea ya
      -- corregida, con las coordenadas que el repartidor acaba de tomar.
      INSERT INTO rep_clientes_direcciones (telefono, cliente_id, nombre_direccion, direccion, ciudad, referencias, geo_lat, geo_lng, verificada, estado)
      VALUES (v_p.telefono, v_cliente_id, LEFT(COALESCE(v_p.direccion, 'Dirección de Entrega'), 15), COALESCE(v_p.direccion, 'Dirección de Entrega'),
              COALESCE(v_p.ciudad, 'Ciudad'), COALESCE(NULLIF(TRIM(p_referencias), ''), v_p.referencias, ''), p_lat, p_lng, true, 'corregida')
      RETURNING id INTO v_direccion_id;
      UPDATE ol_pedidos SET direccion_id = v_direccion_id WHERE id = v_p.id;
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
