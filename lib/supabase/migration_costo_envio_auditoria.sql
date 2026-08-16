-- migration_costo_envio_auditoria.sql
-- Hallazgo: ol_pedidos.total llega YA COMBINADO (mercadería + envío) desde
-- la app de tienda, sin que exista ninguna columna separada para el costo
-- de envío. Esto hace imposible auditar desde este lado si el envío se está
-- cobrando de forma consistente entre efectivo y transferencia -- el dato
-- simplemente no se guarda por separado.
--
-- Esta migración solo prepara la columna para que, en cuanto la tienda (o
-- este mismo sistema, vía /api/envio/calcular que ya existe pero nadie
-- llama aún) empiece a poblarla, quede auditable. No resuelve el problema
-- de raíz -- eso requiere que la app de tienda mande el dato al crear el
-- pedido, o que se decida calcularlo aquí en el momento de la creación.

ALTER TABLE public.ol_pedidos ADD COLUMN IF NOT EXISTS costo_envio NUMERIC(10,2);
COMMENT ON COLUMN public.ol_pedidos.costo_envio IS
  'Valor del servicio de envío, separado de la mercadería. NULL en pedidos antiguos o si la app de tienda todavía no lo envía. No se calcula automáticamente -- ver /api/envio/calcular.';
