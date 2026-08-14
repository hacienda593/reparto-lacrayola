-- Puerta de salida a producción. Ejecutar después de todas las migraciones.
-- Las pruebas booleanas deben ser true. Los contadores críticos deben ser 0.
SELECT 'rpc_entrega_atomica' prueba,to_regprocedure('public.finalizar_entrega_atomica(uuid,uuid,numeric,text,numeric,numeric,text,text,text)') IS NOT NULL ok;
SELECT 'rpc_entrega_fallida' prueba,to_regprocedure('public.registrar_entrega_fallida_atomica(uuid,uuid,text,numeric,numeric)') IS NOT NULL ok;
SELECT 'rpc_liquidacion' prueba,to_regprocedure('public.liquidar_repartidor_admin(uuid,uuid,date,numeric,text,text,text,text,text)') IS NOT NULL ok;
SELECT 'rpc_traspaso' prueba,to_regprocedure('public.transferir_efectivo_repartidor(uuid,uuid,numeric,text,uuid)') IS NOT NULL ok;
SELECT 'control_360' prueba,to_regclass('public.rep_control_pedidos_360') IS NOT NULL ok;
SELECT 'salud_operativa' prueba,to_regclass('public.rep_salud_operativa') IS NOT NULL ok;
SELECT 'xml_sri_facturas_compra' prueba,EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ol_pedidos_comprobantes_proveedor' AND column_name='sri_xml_sha256') ok;
SELECT 'request_entrega_duplicado' prueba,COUNT(*)=0 ok FROM(SELECT request_id FROM rep_entregas WHERE request_id IS NOT NULL GROUP BY request_id HAVING COUNT(*)>1)d;
SELECT 'request_liquidacion_duplicado' prueba,COUNT(*)=0 ok FROM(SELECT request_id FROM rep_movimientos_liquidacion GROUP BY request_id HAVING COUNT(*)>1)d;
SELECT 'saldos_no_negativos' prueba,COUNT(*)=0 ok FROM rep_repartidores WHERE efectivo_en_mano<0;
SELECT 'transferencias_entregadas_verificadas' prueba,COUNT(*)=0 ok
 FROM rep_entregas e JOIN ol_pedidos p ON p.id=e.pedido_id
 WHERE e.exitosa AND e.metodo_pago='transferencia' AND NOT COALESCE(p.pago_confirmado,false);
SELECT 'claves_sri_duplicadas' prueba,COUNT(*)=0 ok FROM(SELECT prov_clave_acceso FROM ol_pedidos_comprobantes_proveedor WHERE prov_clave_acceso IS NOT NULL GROUP BY prov_clave_acceso HAVING COUNT(*)>1)d;
SELECT 'xml_sri_hash_incompleto' prueba,COUNT(*)=0 ok FROM ol_pedidos_comprobantes_proveedor WHERE sri_xml IS NOT NULL AND (sri_xml_sha256 IS NULL OR LENGTH(sri_xml_sha256)<>64);
SELECT * FROM rep_salud_operativa;
SELECT etapa_control,COUNT(*) pedidos FROM rep_control_pedidos_360 GROUP BY etapa_control ORDER BY pedidos DESC;
