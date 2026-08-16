-- migration_fix_comision_pendiente_realtime.sql
-- Bug real detectado en producción: mi_comision_pendiente() sumaba
-- rep_ledger_movimientos (cuenta='ganancia'), pero esa tabla SOLO se llena
-- dentro de sincronizar_ledger_financiero(), que exige rep_is_admin() y solo
-- se invoca desde cerrar_periodo_colaborador(). Mientras un admin no cierre
-- al menos un período de pago, la tabla está vacía para todo el mundo y el
-- repartidor ve "$0.00 comisión por cobrar" sin importar cuántas entregas
-- haya hecho. Verificado en vivo: un repartidor con 9 entregas exitosas a
-- $1 fijo (=$9.00 esperado) mostraba $0.00.
--
-- Corrección: calcular la comisión ganada directo desde rep_entregas (misma
-- fórmula que ya usa sincronizar_ledger_financiero), sin depender de que el
-- admin haya sincronizado el ledger contable. El ledger sigue existiendo
-- para el cierre formal de períodos, pero ya no es la fuente para lo que el
-- repartidor ve "en tiempo real".

CREATE OR REPLACE FUNCTION public.mi_comision_pendiente()
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_repartidor_id UUID;
  v_ganancias_totales NUMERIC;
  v_ya_pagado NUMERIC;
BEGIN
  v_repartidor_id := rep_mi_id();
  IF v_repartidor_id IS NULL THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(
    CASE WHEN r.comision_tipo = 'porcentaje'
      THEN ROUND(COALESCE(p.total, 0) * r.comision_valor / 100, 2)
      ELSE r.comision_valor
    END
  ), 0) INTO v_ganancias_totales
  FROM rep_entregas e
  JOIN rep_repartidores r ON r.id = e.repartidor_id
  LEFT JOIN ol_pedidos p ON p.id = e.pedido_id
  WHERE e.repartidor_id = v_repartidor_id AND e.exitosa;

  SELECT COALESCE(SUM(ganancias), 0) INTO v_ya_pagado
  FROM rep_periodos_pago WHERE repartidor_id = v_repartidor_id AND estado = 'cerrado';

  RETURN GREATEST(v_ganancias_totales - v_ya_pagado, 0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mi_comision_pendiente FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_comision_pendiente TO authenticated;
