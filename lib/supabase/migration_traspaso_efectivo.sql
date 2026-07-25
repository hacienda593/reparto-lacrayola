-- =====================================================================
-- MIGRACION DE BD SUPABASE: TRASPASO DE EFECTIVO ENTRE REPARTIDOR Y COMPRADOR
-- =====================================================================
-- Permite que un repartidor (rider) que cobro en efectivo contraentrega
-- le entregue ese dinero fisicamente a un comprador (shopper) en vez de
-- llevarlo a la oficina, quedando registrado como un traspaso auditable.
-- El comprador que recibe el dinero pasa a ser responsable de esa caja
-- (incluyendo el limite de bloqueo de $40.00 ya existente), y el
-- administrador puede seguir liquidandola con el mismo mecanismo de
-- conciliar_caja_repartidor.
-- Ejecuta este script en el SQL Editor de tu Dashboard de Supabase.

-- ---------------------------------------------------------------------
-- 1. TABLA DE AUDITORIA: rep_traspasos_efectivo
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rep_traspasos_efectivo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repartidor_origen_id UUID NOT NULL REFERENCES rep_repartidores(id),
  repartidor_destino_id UUID NOT NULL REFERENCES rep_repartidores(id),
  monto NUMERIC(10, 2) NOT NULL CHECK (monto > 0),
  notas TEXT,
  registrado_por UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rep_traspasos_efectivo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lectura_autenticados_traspasos" ON rep_traspasos_efectivo;
CREATE POLICY "lectura_autenticados_traspasos"
  ON rep_traspasos_efectivo FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------------
-- 2. RPC: transferir_efectivo_repartidor
-- ---------------------------------------------------------------------
-- Transaccion atomica: descuenta del origen, acredita al destino, y dispara
-- el trigger de bloqueo por limite de $40 que ya existe sobre efectivo_en_mano
-- (trigger_evaluar_bloqueo / trigger_limite_caja_repartidor), sin duplicar esa logica.

CREATE OR REPLACE FUNCTION transferir_efectivo_repartidor(
  p_origen_id UUID,
  p_destino_id UUID,
  p_monto NUMERIC(10, 2),
  p_notas TEXT DEFAULT NULL,
  p_registrado_por UUID DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_saldo_origen NUMERIC(10, 2);
BEGIN
  IF p_origen_id = p_destino_id THEN
    RAISE EXCEPTION 'El origen y el destino no pueden ser el mismo repartidor';
  END IF;

  IF p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;

  SELECT efectivo_en_mano INTO v_saldo_origen
  FROM rep_repartidores
  WHERE id = p_origen_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repartidor de origen no encontrado';
  END IF;

  IF v_saldo_origen < p_monto THEN
    RAISE EXCEPTION 'El repartidor de origen no tiene suficiente efectivo en mano (saldo actual: %)', v_saldo_origen;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM rep_repartidores WHERE id = p_destino_id) THEN
    RAISE EXCEPTION 'Repartidor de destino no encontrado';
  END IF;

  UPDATE rep_repartidores
  SET efectivo_en_mano = efectivo_en_mano - p_monto
  WHERE id = p_origen_id;

  UPDATE rep_repartidores
  SET efectivo_en_mano = efectivo_en_mano + p_monto
  WHERE id = p_destino_id;

  INSERT INTO rep_traspasos_efectivo (
    repartidor_origen_id, repartidor_destino_id, monto, notas, registrado_por
  ) VALUES (
    p_origen_id, p_destino_id, p_monto, p_notas, p_registrado_por
  );

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
