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
ALTER TABLE rep_traspasos_efectivo ADD COLUMN IF NOT EXISTS request_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS rep_traspasos_request_uidx ON rep_traspasos_efectivo(request_id) WHERE request_id IS NOT NULL;

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

DROP FUNCTION IF EXISTS transferir_efectivo_repartidor(UUID,UUID,NUMERIC,TEXT,UUID);
CREATE OR REPLACE FUNCTION transferir_efectivo_repartidor(
  p_origen_id UUID,
  p_destino_id UUID,
  p_monto NUMERIC(10, 2),
  p_notas TEXT DEFAULT NULL,
  p_request_id UUID DEFAULT gen_random_uuid()
)
RETURNS VOID AS $$
DECLARE
  v_saldo_origen NUMERIC(10, 2);
  v_mi_repartidor UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Falta identificador de operación'; END IF;
  IF EXISTS (SELECT 1 FROM rep_traspasos_efectivo WHERE request_id=p_request_id) THEN RETURN; END IF;
  IF p_origen_id = p_destino_id THEN
    RAISE EXCEPTION 'El origen y el destino no pueden ser el mismo repartidor';
  END IF;

  IF p_monto <= 0 OR ROUND(p_monto,2) <> p_monto THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero y tener máximo dos decimales';
  END IF;

  SELECT id INTO v_mi_repartidor FROM rep_repartidores WHERE user_id=auth.uid() AND activo=true LIMIT 1;
  IF v_mi_repartidor IS DISTINCT FROM p_origen_id AND NOT rep_is_admin() THEN
    RAISE EXCEPTION 'No puede transferir efectivo de otro custodio';
  END IF;

  PERFORM id FROM rep_repartidores WHERE id IN (p_origen_id,p_destino_id) ORDER BY id FOR UPDATE;

  SELECT efectivo_en_mano INTO v_saldo_origen
  FROM rep_repartidores
  WHERE id = p_origen_id
  ;

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
    repartidor_origen_id, repartidor_destino_id, monto, notas, registrado_por, request_id
  ) VALUES (
    p_origen_id, p_destino_id, p_monto, NULLIF(TRIM(p_notas),''), auth.uid(), p_request_id
  );

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION transferir_efectivo_repartidor(UUID,UUID,NUMERIC,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transferir_efectivo_repartidor(UUID,UUID,NUMERIC,TEXT,UUID) TO authenticated;
