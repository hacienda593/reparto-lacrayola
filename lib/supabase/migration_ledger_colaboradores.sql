-- Ledger empresarial por colaborador: caja, ganancias y cierres semanales.
-- Ejecutar en Supabase SQL Editor después de las migraciones de caja.

CREATE TABLE IF NOT EXISTS rep_ledger_movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL UNIQUE,
  repartidor_id UUID NOT NULL REFERENCES rep_repartidores(id) ON DELETE RESTRICT,
  pedido_id UUID REFERENCES ol_pedidos(id) ON DELETE RESTRICT,
  fecha_operacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cuenta TEXT NOT NULL CHECK (cuenta IN ('caja','ganancia')),
  concepto TEXT NOT NULL CHECK (concepto IN ('cobro_cliente','traspaso_entrada','traspaso_salida','entrega_oficina','comision','bono','ajuste','pago_colaborador','compensacion')),
  debito NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (debito>=0),
  credito NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (credito>=0),
  descripcion TEXT,
  origen_tipo TEXT NOT NULL,
  origen_id UUID,
  reversa_de UUID REFERENCES rep_ledger_movimientos(id),
  creado_por UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((debito>0 AND credito=0) OR (credito>0 AND debito=0))
);
CREATE INDEX IF NOT EXISTS rep_ledger_rep_fecha_idx ON rep_ledger_movimientos(repartidor_id,fecha_operacion DESC);
CREATE INDEX IF NOT EXISTS rep_ledger_pedido_idx ON rep_ledger_movimientos(pedido_id) WHERE pedido_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rep_periodos_pago (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repartidor_id UUID NOT NULL REFERENCES rep_repartidores(id) ON DELETE RESTRICT,
  desde DATE NOT NULL,
  hasta DATE NOT NULL,
  ganancias NUMERIC(12,2) NOT NULL DEFAULT 0,
  caja_custodia NUMERIC(12,2) NOT NULL DEFAULT 0,
  posicion_neta NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_compensado NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_pagar NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_cobrar NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','revisado','cerrado','pagado','con_diferencia')),
  cerrado_at TIMESTAMPTZ,
  cerrado_por UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(repartidor_id,desde,hasta), CHECK(hasta>=desde)
);

ALTER TABLE rep_ledger_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE rep_periodos_pago ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_select ON rep_ledger_movimientos;
CREATE POLICY ledger_select ON rep_ledger_movimientos FOR SELECT USING(repartidor_id=rep_mi_id() OR rep_is_admin());
DROP POLICY IF EXISTS periodos_select ON rep_periodos_pago;
CREATE POLICY periodos_select ON rep_periodos_pago FOR SELECT USING(repartidor_id=rep_mi_id() OR rep_is_admin());

-- Importa de forma idempotente entregas, traspasos y liquidaciones existentes.
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
    CASE WHEN r.comision_tipo='porcentaje' THEN ROUND(COALESCE(p.total,0)*r.comision_valor/100,2) ELSE r.comision_valor END,0,
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

CREATE OR REPLACE VIEW rep_estado_cuenta WITH(security_invoker=true) AS
SELECT r.id repartidor_id,r.nombre,r.activo,r.efectivo_en_mano,
 COALESCE(SUM(CASE WHEN l.cuenta='caja' THEN l.debito-l.credito END),0) caja_ledger,
 COALESCE(SUM(CASE WHEN l.cuenta='ganancia' THEN l.debito-l.credito END),0) ganancias,
 COALESCE(SUM(CASE WHEN l.cuenta='ganancia' THEN l.debito-l.credito WHEN l.cuenta='caja' THEN -(l.debito-l.credito) END),0) posicion_neta,
 COUNT(l.id) movimientos,MAX(l.fecha_operacion) ultima_actividad
FROM rep_repartidores r LEFT JOIN rep_ledger_movimientos l ON l.repartidor_id=r.id GROUP BY r.id,r.nombre,r.activo,r.efectivo_en_mano;
REVOKE ALL ON rep_estado_cuenta FROM PUBLIC,anon; GRANT SELECT ON rep_estado_cuenta TO authenticated;

CREATE OR REPLACE FUNCTION cerrar_periodo_colaborador(p_repartidor_id UUID,p_desde DATE,p_hasta DATE)
RETURNS rep_periodos_pago LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_ganancias NUMERIC;v_caja NUMERIC;v_neto NUMERIC;v_result rep_periodos_pago;
BEGIN
 IF NOT rep_is_admin() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
 IF p_hasta>=CURRENT_DATE OR p_hasta<p_desde THEN RAISE EXCEPTION 'El período debe estar terminado y las fechas ser válidas'; END IF;
 PERFORM sincronizar_ledger_financiero();
 SELECT COALESCE(SUM(CASE WHEN cuenta='ganancia' THEN debito-credito END),0),COALESCE(SUM(CASE WHEN cuenta='caja' THEN debito-credito END),0)
 INTO v_ganancias,v_caja FROM rep_ledger_movimientos WHERE repartidor_id=p_repartidor_id AND fecha_operacion >= (p_desde::timestamp AT TIME ZONE 'America/Guayaquil') AND fecha_operacion < ((p_hasta+1)::timestamp AT TIME ZONE 'America/Guayaquil');
 v_neto:=v_ganancias-v_caja;
 INSERT INTO rep_periodos_pago(repartidor_id,desde,hasta,ganancias,caja_custodia,posicion_neta,monto_compensado,monto_pagar,monto_cobrar,estado,cerrado_at,cerrado_por)
 VALUES(p_repartidor_id,p_desde,p_hasta,v_ganancias,v_caja,v_neto,LEAST(v_ganancias,v_caja),GREATEST(v_neto,0),GREATEST(-v_neto,0),'cerrado',NOW(),auth.uid())
 ON CONFLICT(repartidor_id,desde,hasta) DO UPDATE SET ganancias=EXCLUDED.ganancias,caja_custodia=EXCLUDED.caja_custodia,posicion_neta=EXCLUDED.posicion_neta,monto_compensado=EXCLUDED.monto_compensado,monto_pagar=EXCLUDED.monto_pagar,monto_cobrar=EXCLUDED.monto_cobrar,estado='cerrado',cerrado_at=NOW(),cerrado_por=auth.uid(),updated_at=NOW() RETURNING * INTO v_result;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION sincronizar_ledger_financiero() FROM PUBLIC; GRANT EXECUTE ON FUNCTION sincronizar_ledger_financiero() TO authenticated;
REVOKE ALL ON FUNCTION cerrar_periodo_colaborador(UUID,DATE,DATE) FROM PUBLIC; GRANT EXECUTE ON FUNCTION cerrar_periodo_colaborador(UUID,DATE,DATE) TO authenticated;
