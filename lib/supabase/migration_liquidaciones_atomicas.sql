-- Liquidaciones administrativas v2: caja atómica, abonos parciales e idempotencia.
-- Es idempotente: puede ejecutarse nuevamente aunque ya se haya aplicado la v1.

ALTER TABLE rep_liquidaciones ADD COLUMN IF NOT EXISTS metodo_liquidacion TEXT;
ALTER TABLE rep_liquidaciones ADD COLUMN IF NOT EXISTS comprobante_referencia TEXT;
ALTER TABLE rep_liquidaciones ADD COLUMN IF NOT EXISTS foto_comprobante_url TEXT;
ALTER TABLE rep_liquidaciones ADD COLUMN IF NOT EXISTS recibido_por TEXT;
ALTER TABLE rep_liquidaciones ADD COLUMN IF NOT EXISTS numero_vale_caja TEXT;
ALTER TABLE rep_liquidaciones ADD COLUMN IF NOT EXISTS monto_recibido NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE rep_liquidaciones ADD COLUMN IF NOT EXISTS saldo_antes NUMERIC(12,2);
ALTER TABLE rep_liquidaciones ADD COLUMN IF NOT EXISTS saldo_despues NUMERIC(12,2);

-- Una liquidación diaria es un resumen. Los movimientos individuales viven
-- en el libro de caja y permiten varios abonos durante el mismo día.
DROP INDEX IF EXISTS rep_liquidaciones_repartidor_fecha_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS rep_liquidaciones_repartidor_fecha_uidx
  ON rep_liquidaciones (repartidor_id, fecha);

CREATE TABLE IF NOT EXISTS rep_movimientos_liquidacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  liquidacion_id UUID NOT NULL REFERENCES rep_liquidaciones(id) ON DELETE RESTRICT,
  repartidor_id UUID NOT NULL REFERENCES rep_repartidores(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL,
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  saldo_antes NUMERIC(12,2) NOT NULL CHECK (saldo_antes >= 0),
  saldo_despues NUMERIC(12,2) NOT NULL CHECK (saldo_despues >= 0),
  metodo TEXT NOT NULL CHECK (metodo IN ('caja','transferencia')),
  referencia TEXT,
  foto_url TEXT,
  numero_vale TEXT,
  recibido_por TEXT NOT NULL,
  registrado_por UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rep_mov_liq_transferencia_ref CHECK (metodo <> 'transferencia' OR NULLIF(TRIM(referencia),'') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS rep_mov_liq_repartidor_fecha_idx
  ON rep_movimientos_liquidacion(repartidor_id, fecha, created_at DESC);
ALTER TABLE rep_movimientos_liquidacion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rep_mov_liq_select ON rep_movimientos_liquidacion;
CREATE POLICY rep_mov_liq_select ON rep_movimientos_liquidacion FOR SELECT
  USING (repartidor_id = rep_mi_id() OR rep_is_admin());
-- Las escrituras se realizan exclusivamente mediante la función SECURITY DEFINER.
DROP POLICY IF EXISTS rep_mov_liq_insert ON rep_movimientos_liquidacion;

-- Elimina la firma v1 para evitar que una UI antigua siga enviando totales
-- calculados por el navegador.
DROP FUNCTION IF EXISTS liquidar_repartidor_admin(UUID,DATE,INTEGER,INTEGER,INTEGER,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT);

CREATE OR REPLACE FUNCTION liquidar_repartidor_admin(
  p_request_id UUID,
  p_repartidor_id UUID,
  p_fecha DATE,
  p_monto_recibido NUMERIC,
  p_metodo TEXT,
  p_recibido_por TEXT,
  p_referencia TEXT DEFAULT NULL,
  p_foto_url TEXT DEFAULT NULL,
  p_numero_vale TEXT DEFAULT NULL
)
RETURNS TABLE(liquidacion_id UUID, movimiento_id UUID, saldo_antes NUMERIC, saldo_despues NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rol TEXT;
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
  SELECT rol INTO v_rol FROM rep_roles WHERE user_id=auth.uid() AND activo=true LIMIT 1;
  IF v_rol IS NULL OR v_rol NOT IN ('superadmin','admin','supervisor','contador') THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  IF p_fecha > CURRENT_DATE THEN RAISE EXCEPTION 'No se puede liquidar una fecha futura'; END IF;
  IF p_monto_recibido IS NULL OR p_monto_recibido <= 0 THEN RAISE EXCEPTION 'El monto recibido debe ser mayor que cero'; END IF;
  IF ROUND(p_monto_recibido,2) <> p_monto_recibido THEN RAISE EXCEPTION 'El monto admite máximo dos decimales'; END IF;
  IF p_metodo NOT IN ('caja','transferencia') THEN RAISE EXCEPTION 'Método inválido'; END IF;
  IF NULLIF(TRIM(p_recibido_por),'') IS NULL THEN RAISE EXCEPTION 'Debe indicar quién recibe'; END IF;
  IF p_metodo='transferencia' AND NULLIF(TRIM(p_referencia),'') IS NULL THEN RAISE EXCEPTION 'La referencia bancaria es obligatoria'; END IF;

  -- Una repetición de la misma solicitud devuelve el resultado original sin
  -- descontar el saldo por segunda vez.
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
END; $$;

REVOKE ALL ON FUNCTION liquidar_repartidor_admin(UUID,UUID,DATE,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION liquidar_repartidor_admin(UUID,UUID,DATE,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;
