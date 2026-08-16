-- migration_autoservicio_liquidaciones.sql
-- Autoservicio del repartidor sobre su propia caja: ver su estado de
-- cuenta/comisiones e iniciar él mismo un depósito con comprobante, para
-- que el admin solo verifique -- mismo patrón que ya existe para pagos de
-- clientes (ol_pedidos_verificaciones + confirmar_pago_admin).
--
-- De paso cierra un hueco encontrado al revisar esto: la vista
-- rep_estado_cuenta no tenía ningún filtro -- cualquier usuario
-- autenticado podía consultar la caja/comisiones de TODOS los
-- repartidores, no solo la propia.

-- ---------------------------------------------------------------------------
-- 1. rep_estado_cuenta: cerrar el acceso directo, exponer solo vía RPC.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON public.rep_estado_cuenta FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.mi_estado_cuenta()
RETURNS SETOF public.rep_estado_cuenta
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM rep_estado_cuenta WHERE repartidor_id = rep_mi_id();
$$;
REVOKE EXECUTE ON FUNCTION public.mi_estado_cuenta FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_estado_cuenta TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_estados_cuenta()
RETURNS SETOF public.rep_estado_cuenta
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT rep_puede_ver_finanzas() THEN
    RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM rep_estado_cuenta;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_estados_cuenta FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_estados_cuenta TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Depósitos autoiniciados por el repartidor, pendientes de verificación.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rep_depositos_repartidor (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repartidor_id    UUID NOT NULL REFERENCES public.rep_repartidores(id),
  monto            NUMERIC(12,2) NOT NULL,
  referencia       TEXT,
  comprobante_path TEXT NOT NULL,
  estado           TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','confirmado','rechazado')),
  motivo_rechazo   TEXT,
  registrado_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revisado_por     UUID,
  revisado_at      TIMESTAMPTZ,
  request_id       UUID,
  liquidacion_id   UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_depositos_request_id
  ON public.rep_depositos_repartidor(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rep_depositos_repartidor_estado
  ON public.rep_depositos_repartidor(repartidor_id, estado);

ALTER TABLE public.rep_depositos_repartidor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rep_depositos_select ON public.rep_depositos_repartidor;
CREATE POLICY rep_depositos_select ON public.rep_depositos_repartidor FOR SELECT TO authenticated
  USING (repartidor_id = rep_mi_id() OR rep_puede_liquidar_caja());
-- Todas las escrituras van por RPC (SECURITY DEFINER); nada de INSERT/UPDATE directo.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rep_depositos_repartidor FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rep_depositos_repartidor FROM anon;

CREATE OR REPLACE FUNCTION public.crear_deposito_repartidor(
  p_monto NUMERIC,
  p_referencia TEXT,
  p_comprobante_path TEXT,
  p_request_id UUID
)
RETURNS public.rep_depositos_repartidor
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_repartidor rep_repartidores;
  v_deposito rep_depositos_repartidor;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Falta identificador de operación'; END IF;

  SELECT * INTO v_deposito FROM rep_depositos_repartidor WHERE request_id = p_request_id;
  IF FOUND THEN RETURN v_deposito; END IF;

  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe un perfil de repartidor para este usuario'; END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor que cero'; END IF;
  IF p_monto > COALESCE(v_repartidor.efectivo_en_mano, 0) THEN
    RAISE EXCEPTION 'El monto (%) supera tu efectivo en mano (%)', p_monto, v_repartidor.efectivo_en_mano;
  END IF;
  IF NULLIF(TRIM(p_comprobante_path), '') IS NULL THEN
    RAISE EXCEPTION 'Debes adjuntar el comprobante del depósito';
  END IF;

  INSERT INTO rep_depositos_repartidor (repartidor_id, monto, referencia, comprobante_path, request_id)
  VALUES (v_repartidor.id, p_monto, NULLIF(TRIM(p_referencia), ''), p_comprobante_path, p_request_id)
  RETURNING * INTO v_deposito;

  RETURN v_deposito;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crear_deposito_repartidor FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_deposito_repartidor TO authenticated;

CREATE OR REPLACE FUNCTION public.confirmar_deposito_repartidor(
  p_deposito_id UUID,
  p_recibido_por TEXT
)
RETURNS public.rep_depositos_repartidor
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deposito rep_depositos_repartidor;
  v_liq RECORD;
BEGIN
  IF NOT rep_puede_liquidar_caja() THEN RAISE EXCEPTION 'No autorizado para confirmar depósitos' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_deposito FROM rep_depositos_repartidor WHERE id = p_deposito_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Depósito no encontrado'; END IF;
  IF v_deposito.estado <> 'pendiente' THEN RAISE EXCEPTION 'Este depósito ya fue % ', v_deposito.estado; END IF;

  -- Reutiliza la misma RPC que ya usa el admin para liquidar manualmente:
  -- descuenta el saldo, calcula comisión del día y deja el mismo rastro
  -- contable, en vez de duplicar esa lógica.
  SELECT * INTO v_liq FROM liquidar_repartidor_admin(
    gen_random_uuid(), v_deposito.repartidor_id, CURRENT_DATE, v_deposito.monto,
    'transferencia', COALESCE(NULLIF(TRIM(p_recibido_por), ''), 'Admin'),
    v_deposito.referencia, v_deposito.comprobante_path, NULL
  );

  UPDATE rep_depositos_repartidor
     SET estado = 'confirmado', revisado_por = auth.uid(), revisado_at = NOW(), liquidacion_id = v_liq.liquidacion_id
   WHERE id = p_deposito_id
  RETURNING * INTO v_deposito;

  RETURN v_deposito;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.confirmar_deposito_repartidor FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_deposito_repartidor TO authenticated;

CREATE OR REPLACE FUNCTION public.rechazar_deposito_repartidor(
  p_deposito_id UUID,
  p_motivo TEXT
)
RETURNS public.rep_depositos_repartidor
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deposito rep_depositos_repartidor;
BEGIN
  IF NOT rep_puede_liquidar_caja() THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501'; END IF;
  IF NULLIF(TRIM(p_motivo), '') IS NULL THEN RAISE EXCEPTION 'Debes indicar el motivo del rechazo'; END IF;
  SELECT * INTO v_deposito FROM rep_depositos_repartidor WHERE id = p_deposito_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Depósito no encontrado'; END IF;
  IF v_deposito.estado <> 'pendiente' THEN RAISE EXCEPTION 'Este depósito ya fue %', v_deposito.estado; END IF;

  UPDATE rep_depositos_repartidor
     SET estado = 'rechazado', motivo_rechazo = TRIM(p_motivo), revisado_por = auth.uid(), revisado_at = NOW()
   WHERE id = p_deposito_id
  RETURNING * INTO v_deposito;

  RETURN v_deposito;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rechazar_deposito_repartidor FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rechazar_deposito_repartidor TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Hallazgo de paso: liquidar_repartidor_admin seguía validando el rol
-- viejo directo (incluía a supervisor), no la capacidad rep_puede_liquidar_caja()
-- migrada en el resto del sistema -- justo el criterio de aceptación del
-- punto 1 de la auditoría ("el supervisor no puede... liquidar caja").
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.liquidar_repartidor_admin(p_request_id uuid, p_repartidor_id uuid, p_fecha date, p_monto_recibido numeric, p_metodo text, p_recibido_por text, p_referencia text DEFAULT NULL::text, p_foto_url text DEFAULT NULL::text, p_numero_vale text DEFAULT NULL::text)
 RETURNS TABLE(liquidacion_id uuid, movimiento_id uuid, saldo_antes numeric, saldo_despues numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo_antes NUMERIC(12,2);
  v_saldo_despues NUMERIC(12,2);
  v_liquidacion_id UUID;
  v_movimiento_id UUID;
  v_asignados INTEGER;
  v_entregados INTEGER;
  v_devueltos INTEGER;
  v_cobrado NUMERIC(12,2);
  v_comision NUMERIC(12,2);
  v_tipo_comision TEXT;
  v_valor_comision NUMERIC;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Falta identificador de operación'; END IF;
  IF NOT rep_puede_liquidar_caja() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  IF p_fecha > CURRENT_DATE THEN RAISE EXCEPTION 'No se puede liquidar una fecha futura'; END IF;
  IF p_monto_recibido IS NULL OR p_monto_recibido <= 0 THEN RAISE EXCEPTION 'El monto recibido debe ser mayor que cero'; END IF;
  IF ROUND(p_monto_recibido,2) <> p_monto_recibido THEN RAISE EXCEPTION 'El monto admite máximo dos decimales'; END IF;
  IF p_metodo NOT IN ('caja','transferencia') THEN RAISE EXCEPTION 'Método inválido'; END IF;
  IF NULLIF(TRIM(p_recibido_por),'') IS NULL THEN RAISE EXCEPTION 'Debe indicar quién recibe'; END IF;
  IF p_metodo='transferencia' AND NULLIF(TRIM(p_referencia),'') IS NULL THEN RAISE EXCEPTION 'La referencia bancaria es obligatoria'; END IF;

  SELECT m.liquidacion_id,m.id,m.saldo_antes,m.saldo_despues
    INTO v_liquidacion_id,v_movimiento_id,v_saldo_antes,v_saldo_despues
  FROM rep_movimientos_liquidacion m WHERE m.request_id=p_request_id;
  IF FOUND THEN RETURN QUERY SELECT v_liquidacion_id,v_movimiento_id,v_saldo_antes,v_saldo_despues; RETURN; END IF;

  SELECT COALESCE(efectivo_en_mano,0),comision_tipo,COALESCE(comision_valor,0)
    INTO v_saldo_antes,v_tipo_comision,v_valor_comision
  FROM rep_repartidores WHERE id=p_repartidor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El repartidor no existe'; END IF;
  IF p_monto_recibido > v_saldo_antes THEN RAISE EXCEPTION 'El monto (%) supera el saldo disponible (%)',p_monto_recibido,v_saldo_antes; END IF;
  v_saldo_despues := v_saldo_antes-p_monto_recibido;

  SELECT COUNT(*),COUNT(*) FILTER (WHERE estado='devuelto') INTO v_asignados,v_devueltos
  FROM rep_asignaciones WHERE repartidor_id=p_repartidor_id
    AND asignado_at >= (p_fecha::timestamp AT TIME ZONE 'America/Guayaquil')
    AND asignado_at < ((p_fecha+1)::timestamp AT TIME ZONE 'America/Guayaquil');
  SELECT COUNT(*) FILTER (WHERE exitosa),COALESCE(SUM(monto_cobrado) FILTER (WHERE exitosa),0)
    INTO v_entregados,v_cobrado FROM rep_entregas
  WHERE repartidor_id=p_repartidor_id
    AND entregado_at >= (p_fecha::timestamp AT TIME ZONE 'America/Guayaquil')
    AND entregado_at < ((p_fecha+1)::timestamp AT TIME ZONE 'America/Guayaquil');
  v_comision := CASE WHEN v_tipo_comision='porcentaje' THEN ROUND(v_cobrado*v_valor_comision/100,2) ELSE ROUND(v_entregados*v_valor_comision,2) END;

  INSERT INTO rep_liquidaciones(repartidor_id,fecha,total_asignados,total_entregados,total_devueltos,total_cobrado,total_comision,total_a_entregar,monto_recibido,saldo_antes,saldo_despues,estado,liquidado_at,liquidado_por,metodo_liquidacion,comprobante_referencia,foto_comprobante_url,recibido_por,numero_vale_caja,updated_at)
  VALUES(p_repartidor_id,p_fecha,v_asignados,v_entregados,v_devueltos,v_cobrado,v_comision,GREATEST(v_cobrado-v_comision,0),p_monto_recibido,v_saldo_antes,v_saldo_despues,CASE WHEN v_saldo_despues=0 THEN 'liquidado' ELSE 'pendiente' END,NOW(),auth.uid(),p_metodo,NULLIF(TRIM(p_referencia),''),p_foto_url,TRIM(p_recibido_por),p_numero_vale,NOW())
  ON CONFLICT(repartidor_id,fecha) DO UPDATE SET
    total_asignados=EXCLUDED.total_asignados,total_entregados=EXCLUDED.total_entregados,total_devueltos=EXCLUDED.total_devueltos,total_cobrado=EXCLUDED.total_cobrado,total_comision=EXCLUDED.total_comision,total_a_entregar=EXCLUDED.total_a_entregar,monto_recibido=rep_liquidaciones.monto_recibido+EXCLUDED.monto_recibido,saldo_despues=EXCLUDED.saldo_despues,estado=EXCLUDED.estado,liquidado_at=NOW(),liquidado_por=auth.uid(),metodo_liquidacion=EXCLUDED.metodo_liquidacion,comprobante_referencia=EXCLUDED.comprobante_referencia,foto_comprobante_url=EXCLUDED.foto_comprobante_url,recibido_por=EXCLUDED.recibido_por,numero_vale_caja=EXCLUDED.numero_vale_caja,updated_at=NOW()
  RETURNING id INTO v_liquidacion_id;

  UPDATE rep_repartidores SET efectivo_en_mano=v_saldo_despues WHERE id=p_repartidor_id;
  INSERT INTO rep_movimientos_liquidacion(request_id,liquidacion_id,repartidor_id,fecha,monto,saldo_antes,saldo_despues,metodo,referencia,foto_url,numero_vale,recibido_por)
  VALUES(p_request_id,v_liquidacion_id,p_repartidor_id,p_fecha,p_monto_recibido,v_saldo_antes,v_saldo_despues,p_metodo,NULLIF(TRIM(p_referencia),''),p_foto_url,p_numero_vale,TRIM(p_recibido_por)) RETURNING id INTO v_movimiento_id;
  RETURN QUERY SELECT v_liquidacion_id,v_movimiento_id,v_saldo_antes,v_saldo_despues;
END; $function$;
