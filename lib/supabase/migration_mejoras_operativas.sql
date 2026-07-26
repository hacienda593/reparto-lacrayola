-- ====================================================================
-- MIGRACIÓN DE BASE DE DATOS: MEJORAS OPERATIVAS Y CONTROL FINANCIERO
-- ====================================================================
-- Ejecuta este script en el SQL Editor de tu Dashboard de Supabase.

-- 1. Crear tabla de registro de facturas (Módulo 1: Shopper)
CREATE TABLE IF NOT EXISTS rep_facturas_compras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID REFERENCES ol_pedidos(id) ON DELETE CASCADE,
  asignacion_id UUID NOT NULL,
  shopper_id UUID REFERENCES auth.users(id) NOT NULL,
  numero_factura VARCHAR(17) NOT NULL, -- formato SRI: 000-000-000000000
  monto_total NUMERIC(10,2) NOT NULL,
  monto_iva NUMERIC(10,2) DEFAULT 0.00,
  foto_factura_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Habilitar RLS (Row Level Security) en la nueva tabla
ALTER TABLE rep_facturas_compras ENABLE ROW LEVEL SECURITY;

-- 3. Crear políticas RLS para rep_facturas_compras
DROP POLICY IF EXISTS rep_facturas_select ON rep_facturas_compras;
CREATE POLICY rep_facturas_select ON rep_facturas_compras 
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS rep_facturas_insert ON rep_facturas_compras;
CREATE POLICY rep_facturas_insert ON rep_facturas_compras 
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 4. Agregar columnas de Proof of Delivery en rep_asignaciones (Módulo 2: Repartidor)
ALTER TABLE rep_asignaciones ADD COLUMN IF NOT EXISTS foto_entrega_url TEXT;
ALTER TABLE rep_asignaciones ADD COLUMN IF NOT EXISTS firma_cliente_url TEXT;
ALTER TABLE rep_asignaciones ADD COLUMN IF NOT EXISTS entrega_lat NUMERIC(9,6);
ALTER TABLE rep_asignaciones ADD COLUMN IF NOT EXISTS entrega_lng NUMERIC(9,6);

-- 5. Agregar columna de conexión/turno en rep_repartidores (Módulo 5: Turnos)
ALTER TABLE rep_repartidores ADD COLUMN IF NOT EXISTS conectado BOOLEAN DEFAULT TRUE;
