-- Liquidaciones administrativas atómicas y auditables.
-- Ejecutar una vez en el SQL Editor de Supabase antes de publicar la UI nueva.

ALTER TABLE rep_liquidaciones ADD COLUMN IF NOT EXISTS metodo_liquidacion TEXT;
ALTER TABLE rep_liquidaciones ADD COLUMN IF NOT EXISTS comprobante_referencia TEXT;
ALTER TABLE rep_liquidaciones ADD COLUMN IF NOT EXISTS foto_comprobante_url TEXT;
ALTER TABLE rep_liquidaciones ADD COLUMN IF NOT EXISTS recibido_por TEXT;
ALTER TABLE rep_liquidaciones ADD COLUMN IF NOT EXISTS numero_vale_caja TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS rep_liquidaciones_repartidor_fecha_uidx
  ON rep_liquidaciones (repartidor_id, fecha);

CREATE OR REPLACE FUNCTION liquidar_repartidor_admin(
  p_repartidor_id UUID,
  p_fecha DATE,
  p_total_asignados INTEGER,
  p_total_entregados INTEGER,
  p_total_devueltos INTEGER,
  p_total_cobrado NUMERIC,
  p_total_comision NUMERIC,
  p_total_a_entregar NUMERIC,
  p_metodo TEXT,
  p_recibido_por TEXT,
  p_referencia TEXT DEFAULT NULL,
  p_foto_url TEXT DEFAULT NULL,
  p_numero_vale TEXT DEFAULT NULL
)
RETURNS rep_liquidaciones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saldo NUMERIC;
  v_resultado rep_liquidaciones;
BEGIN
  IF NOT rep_is_admin() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  IF p_total_a_entregar < 0 THEN RAISE EXCEPTION 'El monto a entregar no puede ser negativo'; END IF;
  IF NULLIF(TRIM(p_recibido_por), '') IS NULL THEN RAISE EXCEPTION 'Debe indicar quién recibe'; END IF;
  IF p_metodo NOT IN ('caja', 'transferencia') THEN RAISE EXCEPTION 'Método de liquidación inválido'; END IF;
  IF p_metodo = 'transferencia' AND NULLIF(TRIM(p_referencia), '') IS NULL THEN RAISE EXCEPTION 'La referencia bancaria es obligatoria'; END IF;

  SELECT efectivo_en_mano INTO v_saldo
  FROM rep_repartidores WHERE id = p_repartidor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El repartidor no existe'; END IF;
  IF EXISTS (SELECT 1 FROM rep_liquidaciones WHERE repartidor_id=p_repartidor_id AND fecha=p_fecha AND estado='liquidado') THEN
    RAISE EXCEPTION 'Este repartidor ya fue liquidado para la fecha indicada';
  END IF;
  IF p_total_a_entregar > COALESCE(v_saldo,0) THEN
    RAISE EXCEPTION 'El monto supera el efectivo en mano (%). Actualice la pantalla y revise los movimientos', v_saldo;
  END IF;

  INSERT INTO rep_liquidaciones (repartidor_id,fecha,total_asignados,total_entregados,total_devueltos,total_cobrado,total_comision,total_a_entregar,estado,liquidado_at,liquidado_por,metodo_liquidacion,comprobante_referencia,foto_comprobante_url,recibido_por,numero_vale_caja,updated_at)
  VALUES (p_repartidor_id,p_fecha,p_total_asignados,p_total_entregados,p_total_devueltos,p_total_cobrado,p_total_comision,p_total_a_entregar,'liquidado',NOW(),auth.uid(),p_metodo,NULLIF(TRIM(p_referencia),''),p_foto_url,TRIM(p_recibido_por),p_numero_vale,NOW())
  ON CONFLICT (repartidor_id,fecha) DO UPDATE SET
    total_asignados=EXCLUDED.total_asignados,total_entregados=EXCLUDED.total_entregados,total_devueltos=EXCLUDED.total_devueltos,total_cobrado=EXCLUDED.total_cobrado,total_comision=EXCLUDED.total_comision,total_a_entregar=EXCLUDED.total_a_entregar,estado='liquidado',liquidado_at=NOW(),liquidado_por=auth.uid(),metodo_liquidacion=EXCLUDED.metodo_liquidacion,comprobante_referencia=EXCLUDED.comprobante_referencia,foto_comprobante_url=EXCLUDED.foto_comprobante_url,recibido_por=EXCLUDED.recibido_por,numero_vale_caja=EXCLUDED.numero_vale_caja,updated_at=NOW()
  RETURNING * INTO v_resultado;

  UPDATE rep_repartidores SET efectivo_en_mano = efectivo_en_mano - p_total_a_entregar WHERE id=p_repartidor_id;
  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION liquidar_repartidor_admin(UUID,DATE,INTEGER,INTEGER,INTEGER,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION liquidar_repartidor_admin(UUID,DATE,INTEGER,INTEGER,INTEGER,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated;
