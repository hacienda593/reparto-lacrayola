-- reset_datos_prueba.sql
-- Vacía todos los datos transaccionales de pedidos/repartos/clientes para
-- empezar pruebas desde cero. NO toca configuración, catálogo, cuentas de
-- usuario ni repartidores (solo resetea sus saldos). Irreversible.

TRUNCATE TABLE
  ol_carrito_items,
  ol_carritos,
  ol_direcciones_cliente,
  rep_clientes_direcciones,
  ol_clientes,
  ol_pedidos_envio,
  rep_facturas_compras,
  rep_incidencias,
  rep_pedido_eventos,
  rep_gastos,
  rep_notificaciones,
  rep_conciliacion_eventos,
  ol_pedidos_verificaciones,
  ol_pedidos_comprobantes_proveedor,
  rep_picking,
  rep_handoffs,
  rep_liquidacion_items,
  rep_depositos_repartidor,
  rep_movimientos_liquidacion,
  rep_liquidaciones,
  rep_ledger_movimientos,
  rep_periodos_pago,
  rep_reclamos,
  rep_traspasos_efectivo,
  rep_cuentas_cobrar,
  rep_transacciones_caja,
  rep_entregas,
  rep_facturas_cliente,
  ol_pedido_items,
  rep_asignaciones,
  ol_pedidos
RESTART IDENTITY;

UPDATE rep_repartidores SET
  efectivo_en_mano = 0,
  estado = 'ACTIVO',
  motivo_bloqueo = NULL,
  bloqueado_por = NULL,
  bloqueado_at = NULL;
