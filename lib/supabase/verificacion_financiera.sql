-- Verificación no destructiva posterior a migraciones financieras.
-- Ejecutar en SQL Editor: todas las filas deben mostrar ok=true.

SELECT 'rpc_liquidacion_v2' prueba,
  to_regprocedure('public.liquidar_repartidor_admin(uuid,uuid,date,numeric,text,text,text,text,text)') IS NOT NULL ok;
SELECT 'rpc_reverso' prueba,
  to_regprocedure('public.reversar_movimiento_liquidacion(uuid,text)') IS NOT NULL ok;
SELECT 'rpc_traspaso_seguro' prueba,
  to_regprocedure('public.transferir_efectivo_repartidor(uuid,uuid,numeric,text,uuid)') IS NOT NULL ok;
SELECT 'libro_movimientos' prueba,to_regclass('public.rep_movimientos_liquidacion') IS NOT NULL ok;
SELECT 'diagnostico_caja' prueba,to_regclass('public.rep_diagnostico_caja') IS NOT NULL ok;
SELECT 'requests_liquidacion_duplicados' prueba,COUNT(*)=0 ok FROM (
  SELECT request_id FROM rep_movimientos_liquidacion GROUP BY request_id HAVING COUNT(*)>1
) d;
SELECT 'requests_traspaso_duplicados' prueba,COUNT(*)=0 ok FROM (
  SELECT request_id FROM rep_traspasos_efectivo WHERE request_id IS NOT NULL GROUP BY request_id HAVING COUNT(*)>1
) d;
SELECT 'saldos_negativos' prueba,COUNT(*)=0 ok FROM rep_repartidores WHERE efectivo_en_mano<0;
SELECT 'movimientos_saldo_invalido' prueba,COUNT(*)=0 ok FROM rep_movimientos_liquidacion
 WHERE saldo_antes<0 OR saldo_despues<0 OR (reversado_at IS NULL AND saldo_antes-saldo_despues<>monto);
SELECT 'entregas_anomalas' prueba,COUNT(*)=0 ok FROM rep_entregas
 WHERE exitosa AND (monto_cobrado IS NULL OR (salida_at IS NOT NULL AND salida_at>entregado_at));

-- Resumen para conciliación manual. Una anomalía no se corrige automáticamente:
-- debe investigarse contra comprobante, entrega y custodio.
SELECT * FROM rep_diagnostico_caja ORDER BY datos_anomalos DESC,efectivo_en_mano DESC;
