-- Agregar columna de referencia de transferencia a la tabla de pedidos
-- para validar duplicados y prevenir fraudes.

-- 1. Agregar la columna si no existe
ALTER TABLE ol_pedidos 
ADD COLUMN IF NOT EXISTS referencia_transferencia VARCHAR(100);

-- 2. Crear un índice único parcial para asegurar que no se repitan comprobantes
-- (excluyendo los valores nulos, ya que los pedidos en efectivo no llevan referencia)
DROP INDEX IF EXISTS idx_ol_pedidos_ref_transferencia_unique;
CREATE UNIQUE INDEX idx_ol_pedidos_ref_transferencia_unique 
ON ol_pedidos (referencia_transferencia) 
WHERE referencia_transferencia IS NOT NULL;
