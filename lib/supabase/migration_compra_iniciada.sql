-- =====================================================================
-- MIGRACION DE BD SUPABASE: MARCA DE INICIO DE COMPRA
-- =====================================================================
-- Permite distinguir, dentro del panel interno del comprador, entre un
-- pedido "Aceptado" (tomado pero aun no empieza a comprar) y uno
-- "Preparando" (ya esta comprando en el supermercado). Hoy ambos comparten
-- el mismo estado 'asignado' en rep_asignaciones, sin forma de diferenciarlos.
-- No afecta el seguimiento que ve el cliente final (eso sigue leyendo
-- unicamente ol_pedidos.estado, que no se toca aqui).
-- Ejecuta este script en el SQL Editor de tu Dashboard de Supabase.

ALTER TABLE rep_asignaciones ADD COLUMN IF NOT EXISTS compra_iniciada_at TIMESTAMPTZ;
