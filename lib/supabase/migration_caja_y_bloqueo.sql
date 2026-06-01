-- =====================================================================
-- MIGRACIÓN DE BD SUPABASE: CONTROL DE CAJA Y BLOQUEO AUTOMÁTICO DE RIDERS
-- =====================================================================
-- Esta migración prepara la base de datos de Supabase para soportar el flujo
-- de Billetera de Efectivo (Cash Wallet) con control automático de fraude.
-- Ejecuta este script en el SQL Editor de tu Dashboard de Supabase.

-- ---------------------------------------------------------------------
-- 1. ESTRUCTURA DE LA TABLA: rep_repartidores
-- ---------------------------------------------------------------------
-- Agregamos la columna efectivo_en_mano y el estado con sus restricciones.

ALTER TABLE rep_repartidores 
ADD COLUMN IF NOT EXISTS efectivo_en_mano NUMERIC(10, 2) DEFAULT 0.00;

ALTER TABLE rep_repartidores 
ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'ACTIVO';

-- Agregamos una restricción CHECK para evitar valores de estado incorrectos
ALTER TABLE rep_repartidores 
DROP CONSTRAINT IF EXISTS chk_rep_repartidor_estado;

ALTER TABLE rep_repartidores 
ADD CONSTRAINT chk_rep_repartidor_estado 
CHECK (estado IN ('ACTIVO', 'BLOQUEADO', 'INACTIVO'));

-- ---------------------------------------------------------------------
-- 2. TRIGGER A: BLOQUEO AUTOMÁTICO POR EXCESO DE EFECTIVO
-- ---------------------------------------------------------------------
-- Este trigger se ejecuta ANTES de que se actualice el campo efectivo_en_mano
-- en la tabla rep_repartidores. Si supera los $40.00, cambia su estado a BLOQUEADO.

CREATE OR REPLACE FUNCTION trg_evaluar_bloqueo_repartidor()
RETURNS TRIGGER AS $$
BEGIN
  -- Límite establecido de retención de efectivo: $40.00
  IF NEW.efectivo_en_mano >= 40.00 THEN
    NEW.estado := 'BLOQUEADO';
  -- Si el saldo baja de $40.00 y estaba bloqueado, se reactiva automáticamente a ACTIVO
  ELSIF NEW.efectivo_en_mano < 40.00 AND OLD.estado = 'BLOQUEADO' THEN
    NEW.estado := 'ACTIVO';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Creamos el disparador
DROP TRIGGER IF EXISTS trigger_evaluar_bloqueo ON rep_repartidores;
CREATE TRIGGER trigger_evaluar_bloqueo
BEFORE UPDATE OF efectivo_en_mano ON rep_repartidores
FOR EACH ROW
EXECUTE FUNCTION trg_evaluar_bloqueo_repartidor();

-- ---------------------------------------------------------------------
-- 3. TRIGGER B: ACUMULACIÓN DE EFECTIVO POR CUENTA POR COBRAR (COD)
-- ---------------------------------------------------------------------
-- Este trigger se ejecuta DESPUÉS de insertarse un nuevo registro de cobro
-- en la tabla rep_cuentas_cobrar. Si fue en efectivo/contraentrega, actualiza 
-- automáticamente el balance del repartidor.

CREATE OR REPLACE FUNCTION trg_acumular_efectivo_cuentas_cobrar()
RETURNS TRIGGER AS $$
BEGIN
  -- Validar si el método de pago es contraentrega/efectivo/cod
  -- y el monto cobrado es superior a cero centavos.
  IF LOWER(NEW.metodo_pago) IN ('efectivo', 'contraentrega', 'cod') 
     AND NEW.monto_cobrado > 0 THEN
     
    UPDATE rep_repartidores
    SET efectivo_en_mano = efectivo_en_mano + NEW.monto_cobrado
    WHERE id = NEW.repartidor_id;
    
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Creamos el disparador en la tabla rep_cuentas_cobrar (Cuentas por Cobrar)
DROP TRIGGER IF EXISTS trigger_acumular_efectivo ON rep_cuentas_cobrar;
CREATE TRIGGER trigger_acumular_efectivo
AFTER INSERT ON rep_cuentas_cobrar
FOR EACH ROW
EXECUTE FUNCTION trg_acumular_efectivo_cuentas_cobrar();

-- ---------------------------------------------------------------------
-- 4. PROCEDIMIENTO CONTABLE: CONCILIACIÓN DE CAJA (LIQUIDACIÓN)
-- ---------------------------------------------------------------------
-- Esta función será invocada de forma segura por el Admin Dashboard en Next.js
-- para registrar el abono del motorizado y desbloquearlo al instante.

CREATE OR REPLACE FUNCTION conciliar_caja_repartidor(
  p_repartidor_id UUID,
  p_monto_recibido NUMERIC(10, 2),
  p_admin_id UUID,
  p_notas TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_saldo_actual NUMERIC(10, 2);
BEGIN
  -- 1. Obtener el efectivo actual del repartidor
  SELECT efectivo_en_mano INTO v_saldo_actual
  FROM rep_repartidores
  WHERE id = p_repartidor_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El repartidor no existe';
  END IF;
  
  -- 2. Insertar el registro contable en la tabla de liquidaciones
  INSERT INTO rep_liquidaciones (
    id,
    repartidor_id,
    fecha,
    total_asignados,
    total_entregados,
    total_devueltos,
    total_cobrado,
    total_comision,
    total_a_entregar,
    estado,
    liquidado_at,
    liquidado_por,
    notas,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    p_repartidor_id,
    CURRENT_DATE,
    0, -- Rellenar según reportería
    0,
    0,
    p_monto_recibido,
    0, -- Descuento de comisiones a procesarse en nómina
    (v_saldo_actual - p_monto_recibido),
    'liquidado',
    NOW(),
    p_admin_id,
    COALESCE(p_notas, 'Liquidación de caja QR conciliada en administración'),
    NOW(),
    NOW()
  );
  
  -- 3. Descontar el efectivo del saldo en mano del repartidor
  -- Si el saldo queda en negativo o se descuenta completamente, se nivela.
  -- Nota: Si se entrega una cantidad que deja una deuda fraccionaria (ej. $0.10),
  -- el saldo efectivo_en_mano quedará en $0.10 y se arrastrará.
  UPDATE rep_repartidores
  SET efectivo_en_mano = GREATEST(0.00, efectivo_en_mano - p_monto_recibido)
  WHERE id = p_repartidor_id;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
