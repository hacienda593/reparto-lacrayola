-- migration_m3_historial_conciliacion.sql
-- M3 de la auditoría financiera: marcar_verificado_banco solo cambiaba un
-- booleano -- el mismo permiso que marca también puede desmarcar, sin
-- dejar ningún rastro de quién lo hizo, cuándo, ni por qué. Si alguien
-- desmarca una conciliación ya hecha (por error o para ocultar algo), no
-- queda ninguna huella.

CREATE TABLE IF NOT EXISTS public.rep_conciliacion_eventos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origen     TEXT NOT NULL CHECK (origen IN ('deposito_repartidor','transferencia_cliente')),
  origen_id  UUID NOT NULL,
  verificado BOOLEAN NOT NULL,
  motivo     TEXT,
  actor      UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rep_conciliacion_eventos_origen ON public.rep_conciliacion_eventos(origen, origen_id, created_at DESC);
ALTER TABLE public.rep_conciliacion_eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conciliacion_eventos_select ON public.rep_conciliacion_eventos;
CREATE POLICY conciliacion_eventos_select ON public.rep_conciliacion_eventos FOR SELECT USING (rep_puede_ver_finanzas());

-- Cambia la firma (nuevo p_motivo) -- DROP explícito para no dejar la
-- versión de 3 parámetros como un overload fantasma.
DROP FUNCTION IF EXISTS public.marcar_verificado_banco(text, uuid, boolean);

CREATE OR REPLACE FUNCTION public.marcar_verificado_banco(p_origen TEXT, p_id UUID, p_verificado BOOLEAN, p_motivo TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_estaba_verificado BOOLEAN;
BEGIN
  IF NOT rep_puede_ver_finanzas() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;

  IF p_origen = 'deposito_repartidor' THEN
    SELECT verificado_banco INTO v_estaba_verificado FROM rep_depositos_repartidor WHERE id = p_id FOR UPDATE;
  ELSIF p_origen = 'transferencia_cliente' THEN
    SELECT verificado_banco INTO v_estaba_verificado FROM ol_pedidos WHERE id = p_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Origen desconocido: %', p_origen;
  END IF;
  IF v_estaba_verificado IS NULL THEN RAISE EXCEPTION 'No encontrado'; END IF;

  -- Desmarcar algo que ya estaba verificado es la dirección riesgosa --
  -- exige motivo explícito. Marcar (o "desmarcar" algo que ya estaba sin
  -- marcar, un no-op) no lo exige.
  IF v_estaba_verificado = true AND p_verificado = false AND NULLIF(TRIM(p_motivo),'') IS NULL THEN
    RAISE EXCEPTION 'Debes indicar el motivo para quitar una verificación ya confirmada';
  END IF;

  IF p_origen = 'deposito_repartidor' THEN
    UPDATE rep_depositos_repartidor
    SET verificado_banco = p_verificado,
        verificado_banco_at = CASE WHEN p_verificado THEN NOW() ELSE NULL END,
        verificado_banco_por = CASE WHEN p_verificado THEN auth.uid() ELSE NULL END
    WHERE id = p_id;
  ELSE
    UPDATE ol_pedidos
    SET verificado_banco = p_verificado,
        verificado_banco_at = CASE WHEN p_verificado THEN NOW() ELSE NULL END,
        verificado_banco_por = CASE WHEN p_verificado THEN auth.uid() ELSE NULL END
    WHERE id = p_id;
  END IF;

  INSERT INTO rep_conciliacion_eventos(origen, origen_id, verificado, motivo)
  VALUES (p_origen, p_id, p_verificado, NULLIF(TRIM(p_motivo),''));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.marcar_verificado_banco FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_verificado_banco TO authenticated;

CREATE OR REPLACE FUNCTION public.historial_conciliacion(p_origen TEXT, p_id UUID)
RETURNS SETOF public.rep_conciliacion_eventos
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT rep_puede_ver_finanzas() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  RETURN QUERY SELECT * FROM rep_conciliacion_eventos WHERE origen = p_origen AND origen_id = p_id ORDER BY created_at DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.historial_conciliacion FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.historial_conciliacion TO authenticated;
