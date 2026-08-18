-- migration_picking_reemplazo_faltante.sql
-- Bug real encontrado en produccion: app/picking/[id]/page.tsx (confirmarAgotado)
-- intenta escribir ol_pedido_items.picking_reemplazo, columna que nunca se
-- creo. Como todo va en un solo UPDATE, el error de "columna no existe"
-- revierte TODO el statement -- ni siquiera picking_agotado/picking_completado
-- se guardaban. Resultado real: marcar un producto como "sin stock" durante
-- el picking fallaba silenciosamente en el navegador (alert generico) desde
-- que se escribio ese codigo. Reproducido y confirmado contra la BD real
-- antes de este fix.

ALTER TABLE public.ol_pedido_items ADD COLUMN IF NOT EXISTS picking_reemplazo TEXT;
