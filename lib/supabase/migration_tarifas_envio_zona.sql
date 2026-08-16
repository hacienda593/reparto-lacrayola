-- migration_tarifas_envio_zona.sql
-- Tarifa de envío híbrida (base + costo por km, con piso mínimo), editable
-- por pueblo -- reutiliza la tabla zonas ya creada
-- (migration_zonas_multi_pueblo.sql). El cálculo real de distancia y
-- envío vive en app/api/envio/calcular/route.ts (usa OSRM, servicio
-- gratuito basado en OpenStreetMap, con respaldo a línea recta si falla).

ALTER TABLE public.zonas
  ADD COLUMN IF NOT EXISTS tarifa_base   NUMERIC(6,2) NOT NULL DEFAULT 1.50,
  ADD COLUMN IF NOT EXISTS costo_por_km  NUMERIC(6,2) NOT NULL DEFAULT 0.30,
  ADD COLUMN IF NOT EXISTS piso_minimo   NUMERIC(6,2) NOT NULL DEFAULT 1.50,
  ADD COLUMN IF NOT EXISTS techo_maximo  NUMERIC(6,2);

-- Las políticas de zonas (lectura pública, escritura solo superadmin) ya
-- cubren estas columnas nuevas -- no hace falta tocar RLS.
