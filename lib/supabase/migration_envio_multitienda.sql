-- migration_envio_multitienda.sql
-- Corrige dos cosas de la conversación con el negocio sobre el envío:
--
-- 1. La tienda cobra un cargo ADICIONAL cuando el pedido junta productos
--    de más de una tienda -- nuestra tarifa plana (fix anterior) no lo
--    contempla, así que sigue quedándose corta en pedidos multi-tienda.
--    Se detecta automáticamente contando tiendas distintas en rep_picking
--    (ya existe esa relación) y se suma un cargo configurable por cada
--    tienda adicional.
--
-- 2. Diseño para que la TIENDA (app externa, sin acceso desde este repo)
--    pueda mandar el envío REAL en vez de que reparto lo siga adivinando
--    -- tabla dedicada, con desglose, para que quien mantiene la tienda
--    la llene al crear el pedido. Mientras eso no pase, reparto sigue
--    usando su propia estimación como respaldo.

ALTER TABLE public.zonas ADD COLUMN IF NOT EXISTS cargo_por_tienda_adicional NUMERIC(10,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.zonas.cargo_por_tienda_adicional IS
  'Cargo extra quese suma al envío por cada tienda adicional que compone el pedido (más allá de la primera). 0 = sin cargo extra configurado.';

-- Tabla que la tienda debería empezar a llenar al crear el pedido, con el
-- envío YA calculado y cobrado al cliente -- fuente de verdad real, en vez
-- de que reparto lo reconstruya después. Mientras la tienda no la use,
-- queda vacía y reparto sigue con su propia estimación (ver más abajo).
CREATE TABLE IF NOT EXISTS public.ol_pedidos_envio (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id              UUID NOT NULL UNIQUE REFERENCES public.ol_pedidos(id),
  tarifa_base            NUMERIC(10,2) NOT NULL,
  cantidad_tiendas       INTEGER NOT NULL DEFAULT 1,
  cargo_multitienda      NUMERIC(10,2) NOT NULL DEFAULT 0,
  total                  NUMERIC(10,2) NOT NULL,
  origen                 TEXT NOT NULL DEFAULT 'tienda' CHECK (origen IN ('tienda','reparto_estimado')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.ol_pedidos_envio IS
  'Desglose real del envío por pedido. Debería llenarlo la app de tienda al crear el pedido (origen=tienda); si no existe fila, reparto calcula una estimación propia (origen=reparto_estimado) como respaldo.';
ALTER TABLE public.ol_pedidos_envio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ol_pedidos_envio_select ON public.ol_pedidos_envio;
CREATE POLICY ol_pedidos_envio_select ON public.ol_pedidos_envio FOR SELECT USING (rep_puede_ver_pedido(pedido_id));

-- guardar_costo_envio_pedido: ahora, si YA existe una fila real de la
-- tienda en ol_pedidos_envio, esa manda -- se usa su total tal cual, sin
-- recalcular nada. Solo se estima (con el cargo multi-tienda) cuando la
-- tienda todavía no mandó el dato.
CREATE OR REPLACE FUNCTION public.guardar_costo_envio_pedido(p_pedido_id UUID, p_costo_envio NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actual NUMERIC; v_total NUMERIC; v_autorizado BOOLEAN; v_real NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;

  -- Si la tienda ya registró el envío real para este pedido, esa es la
  -- fuente de verdad -- no se pisa con una estimación.
  SELECT total INTO v_real FROM ol_pedidos_envio WHERE pedido_id = p_pedido_id;
  IF v_real IS NOT NULL THEN
    UPDATE ol_pedidos SET costo_envio = v_real, total_final = ROUND(COALESCE(total,0) + v_real, 2)
    WHERE id = p_pedido_id AND costo_envio IS NULL;
    RETURN v_real;
  END IF;

  IF p_costo_envio IS NULL OR p_costo_envio < 0 THEN RAISE EXCEPTION 'Costo de envío inválido'; END IF;
  IF p_costo_envio > 100 THEN RAISE EXCEPTION 'Costo de envío fuera de rango razonable'; END IF;

  SELECT costo_envio, total INTO v_actual, v_total FROM ol_pedidos WHERE id = p_pedido_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;

  v_autorizado := rep_is_admin() OR EXISTS(
    SELECT 1 FROM rep_asignaciones a JOIN rep_repartidores r ON r.user_id = auth.uid()
    WHERE a.pedido_id = p_pedido_id AND (a.shopper_id = r.id OR a.rider_id = r.id OR a.repartidor_id = r.id)
  );
  IF NOT v_autorizado THEN RAISE EXCEPTION 'No tienes relación con este pedido'; END IF;

  IF v_actual IS NOT NULL THEN RETURN v_actual; END IF;

  UPDATE ol_pedidos SET costo_envio = ROUND(p_costo_envio, 2), total_final = ROUND(COALESCE(v_total,0) + p_costo_envio, 2)
  WHERE id = p_pedido_id AND costo_envio IS NULL;
  RETURN ROUND(p_costo_envio, 2);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guardar_costo_envio_pedido FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_costo_envio_pedido TO authenticated;
