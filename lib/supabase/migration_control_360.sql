-- Torre de control administrativa: una fila por pedido con toda la cadena.
CREATE OR REPLACE VIEW rep_control_pedidos_360 WITH(security_invoker=true) AS
SELECT p.id,p.numero,p.created_at,p.nombre_cliente,p.telefono,p.total,p.estado pedido_estado,
 p.metodo_pago,p.pago_confirmado,p.referencia_transferencia,p.geo_lat,p.geo_lng,
 a.id asignacion_id,a.estado asignacion_estado,a.asignado_at,a.compra_iniciada_at,a.updated_at asignacion_updated_at,
 a.shopper_id,a.rider_id,sh.nombre shopper_nombre,ri.nombre rider_nombre,
 COALESCE(NULLIF(pk.total,0),oi.total,0) items_total,
 COALESCE(NULLIF(pk.total,0)-pk.pendientes,oi.resueltos,0) items_resueltos,
 COALESCE(NULLIF(pk.faltantes,0),oi.faltantes,0) items_faltantes,
 COALESCE(NULLIF(pk.pendientes,0),oi.pendientes,0) items_pendientes,
 cp.total comprobantes_proveedor,cp.validadas facturas_compra_validadas,cp.costo_real compra_costo_real,
 e.exitosa entrega_exitosa,e.entregado_at,e.monto_cobrado,e.metodo_pago entrega_metodo_pago,e.foto_url entrega_foto,e.geo_lat entrega_lat,e.geo_lng entrega_lng,
 cp.total facturas_compra_proveedor,fc.estado factura_cliente_estado,fc.numero_factura factura_cliente_numero,
 CASE
  WHEN p.metodo_pago='transferencia' AND COALESCE(p.pago_confirmado,false)=false THEN 'validar_pago'
  WHEN p.geo_lat IS NULL OR p.geo_lng IS NULL THEN 'confirmar_ubicacion'
  WHEN a.id IS NULL THEN 'asignar_comprador'
  WHEN COALESCE(NULLIF(pk.pendientes,0),oi.pendientes,0)>0 THEN 'completar_compra'
  WHEN COALESCE(NULLIF(pk.faltantes,0),oi.faltantes,0)>0 THEN 'revisar_faltantes'
  WHEN cp.total=0 AND a.compra_iniciada_at IS NOT NULL THEN 'subir_comprobante_compra'
  WHEN cp.total>0 AND cp.validadas<cp.total THEN 'validar_factura_compra'
  WHEN a.rider_id IS NULL AND a.estado IN ('recolectado','en_ruta') THEN 'asignar_repartidor'
  WHEN a.estado IN ('en_ruta','recolectado') AND e.id IS NULL THEN 'seguir_entrega'
  WHEN e.id IS NOT NULL AND NOT e.exitosa THEN 'resolver_entrega_fallida'
  WHEN e.exitosa AND COALESCE(fc.estado,'pendiente')<>'emitida' THEN 'facturar'
  WHEN e.exitosa AND fc.estado='emitida' THEN 'completado'
  ELSE 'en_proceso' END etapa_control,
 ARRAY_REMOVE(ARRAY[
  CASE WHEN p.metodo_pago='transferencia' AND NOT COALESCE(p.pago_confirmado,false) THEN 'Pago sin verificar' END,
  CASE WHEN p.geo_lat IS NULL OR p.geo_lng IS NULL THEN 'Sin ubicación GPS' END,
  CASE WHEN a.id IS NULL THEN 'Sin asignación' END,
  CASE WHEN COALESCE(NULLIF(pk.pendientes,0),oi.pendientes,0)>0 THEN 'Items pendientes' END,
  CASE WHEN COALESCE(NULLIF(pk.faltantes,0),oi.faltantes,0)>0 THEN 'Items faltantes' END,
  CASE WHEN cp.total>0 AND cp.validadas<cp.total THEN 'Factura de compra sin validar' END,
  CASE WHEN a.estado IN ('en_ruta','recolectado') AND NOW()-COALESCE(a.updated_at,a.asignado_at)>INTERVAL '90 minutes' THEN 'Entrega demorada' END,
  CASE WHEN e.exitosa AND e.monto_cobrado IS NULL THEN 'Entrega sin monto' END,
  CASE WHEN e.exitosa AND e.foto_url IS NULL THEN 'Entrega sin evidencia' END
 ],NULL) alertas
FROM ol_pedidos p
LEFT JOIN LATERAL (SELECT x.* FROM rep_asignaciones x WHERE x.pedido_id=p.id ORDER BY x.asignado_at DESC LIMIT 1) a ON true
LEFT JOIN rep_repartidores sh ON sh.id=a.shopper_id LEFT JOIN rep_repartidores ri ON ri.id=a.rider_id
LEFT JOIN LATERAL (SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE estado IN('recogido','sustituido','no_disponible'))::int resueltos,COUNT(*) FILTER(WHERE estado='no_disponible')::int faltantes,COUNT(*) FILTER(WHERE estado='pendiente')::int pendientes FROM rep_picking WHERE pedido_id=p.id) pk ON true
LEFT JOIN LATERAL (SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE picking_completado OR picking_agotado)::int resueltos,COUNT(*) FILTER(WHERE picking_agotado)::int faltantes,COUNT(*) FILTER(WHERE NOT COALESCE(picking_completado,false) AND NOT COALESCE(picking_agotado,false))::int pendientes FROM ol_pedido_items WHERE pedido_id=p.id) oi ON true
LEFT JOIN LATERAL (SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE estado_revision='validada')::int validadas,COALESCE(SUM(prov_costo_real),0) costo_real FROM ol_pedidos_comprobantes_proveedor WHERE pedido_id=p.id) cp ON true
LEFT JOIN LATERAL (SELECT x.* FROM rep_entregas x WHERE x.pedido_id=p.id ORDER BY x.created_at DESC LIMIT 1) e ON true
LEFT JOIN rep_facturas_cliente fc ON fc.pedido_id=p.id;
REVOKE ALL ON rep_control_pedidos_360 FROM PUBLIC,anon;GRANT SELECT ON rep_control_pedidos_360 TO authenticated;
