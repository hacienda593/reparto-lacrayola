-- =====================================================================
-- BITACORA DE AUDITORIA: Verificacion de pagos por transferencia
-- =====================================================================
-- Motivo: el modal de "Validacion de Pedido" en /asignaciones permite
-- confirmar o anular la conciliacion de un pago por transferencia
-- (columna ol_pedidos.pago_confirmado). Si solo se guarda el estado
-- actual, cada vez que alguien confirma/anula se PIERDE el rastro de
-- quien lo hizo antes -- justo lo que un fraude necesitaria para
-- taparse. Esta tabla es un historial que solo permite INSERT: nadie,
-- ni siquiera un superadmin desde la app, puede editar o borrar una
-- fila ya escrita (no existen politicas de UPDATE/DELETE a proposito;
-- con RLS activado eso las deniega por defecto).
--
-- Ejecuta esto completo en el SQL Editor de tu Dashboard de Supabase.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ol_pedidos_verificaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       UUID NOT NULL REFERENCES ol_pedidos(id) ON DELETE CASCADE,
  accion          VARCHAR(20) NOT NULL CHECK (accion IN ('confirmado', 'anulado', 'ref_corregida')),
  referencia      VARCHAR(100),
  -- Lista cerrada a los metodos que el checkout realmente ofrece hoy, para
  -- que los reportes no se llenen de variantes de texto libre ("Pichincha",
  -- "pichincha", "BP", ...). 'otro' + notas cubre el caso excepcional.
  banco           VARCHAR(20) CHECK (banco IN ('pichincha', 'deuna', 'otro')),
  fecha_deposito  DATE,
  admin_user_id   UUID NOT NULL REFERENCES auth.users(id),
  admin_nombre    VARCHAR(150),
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indices pensados para como se va a consultar esto en la practica:
-- historial de un pedido especifico (panel del modal), y reportes de
-- auditoria por fecha o por administrador. A ~500 pedidos/dia esta tabla
-- crece ~15k filas/mes; con estos indices no hay degradacion aunque
-- pasen varios anos sin particionar.
CREATE INDEX IF NOT EXISTS idx_ol_pedidos_verif_pedido ON ol_pedidos_verificaciones (pedido_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ol_pedidos_verif_fecha  ON ol_pedidos_verificaciones (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ol_pedidos_verif_admin  ON ol_pedidos_verificaciones (admin_user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- RLS: solo roles administrativos leen y escriben. A proposito NO se
-- crea policy de UPDATE ni de DELETE -- con RLS activado y sin esas
-- politicas, Postgres las deniega para todos, incluido el dueno de la
-- fila. Esto hace la tabla append-only de verdad, forzado por la base
-- de datos y no solo por convencion del codigo.
-- ---------------------------------------------------------------------
ALTER TABLE ol_pedidos_verificaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ol_pedidos_verif_select ON ol_pedidos_verificaciones;
CREATE POLICY ol_pedidos_verif_select ON ol_pedidos_verificaciones FOR SELECT
  USING (rep_is_admin());

DROP POLICY IF EXISTS ol_pedidos_verif_insert ON ol_pedidos_verificaciones;
CREATE POLICY ol_pedidos_verif_insert ON ol_pedidos_verificaciones FOR INSERT
  WITH CHECK (rep_is_admin() AND admin_user_id = auth.uid());
