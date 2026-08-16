-- migration_reclamos_comision.sql
-- Gap detectado comparando contra PeYa Rider / Tipti Shopper: ambas apps dan
-- al repartidor/shopper un canal FORMAL para disputar una comisión o un
-- depósito que no cuadra ("Solicitar revisión de comisión" / "Reportar
-- discrepancia"). Nosotros solo dejábamos que el admin decidiera sin que el
-- repartidor pudiera dejar constancia de su reclamo -- es la contraparte
-- justa del aviso de responsabilidad que ya se le muestra al depositar.

CREATE TABLE IF NOT EXISTS public.rep_reclamos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repartidor_id UUID NOT NULL REFERENCES public.rep_repartidores(id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('comision', 'deposito', 'liquidacion', 'otro')),
  entrega_id    UUID REFERENCES public.rep_entregas(id),
  deposito_id   UUID REFERENCES public.rep_depositos_repartidor(id),
  mensaje       TEXT NOT NULL CHECK (length(trim(mensaje)) > 0),
  estado        TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'resuelto')),
  respuesta     TEXT,
  resuelto_por  UUID,
  resuelto_at   TIMESTAMPTZ,
  request_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_reclamos_request_id ON public.rep_reclamos(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rep_reclamos_estado ON public.rep_reclamos(estado, created_at DESC);

ALTER TABLE public.rep_reclamos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reclamos_select ON public.rep_reclamos;
CREATE POLICY reclamos_select ON public.rep_reclamos FOR SELECT
  USING (repartidor_id = rep_mi_id() OR rep_puede_ver_finanzas());

CREATE OR REPLACE FUNCTION public.crear_reclamo(
  p_tipo TEXT, p_mensaje TEXT,
  p_entrega_id UUID DEFAULT NULL, p_deposito_id UUID DEFAULT NULL,
  p_request_id UUID DEFAULT NULL
)
RETURNS public.rep_reclamos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_repartidor_id UUID;
  v_result rep_reclamos;
BEGIN
  v_repartidor_id := rep_mi_id();
  IF v_repartidor_id IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión como repartidor'; END IF;
  IF length(trim(p_mensaje)) = 0 THEN RAISE EXCEPTION 'Describe el problema antes de enviar'; END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_result FROM rep_reclamos WHERE request_id = p_request_id;
    IF FOUND THEN RETURN v_result; END IF;
  END IF;

  INSERT INTO rep_reclamos(repartidor_id, tipo, entrega_id, deposito_id, mensaje, request_id)
  VALUES (v_repartidor_id, p_tipo, p_entrega_id, p_deposito_id, trim(p_mensaje), p_request_id)
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crear_reclamo FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_reclamo TO authenticated;

CREATE OR REPLACE FUNCTION public.resolver_reclamo(p_reclamo_id UUID, p_respuesta TEXT)
RETURNS public.rep_reclamos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result rep_reclamos;
BEGIN
  IF NOT rep_puede_ver_finanzas() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  UPDATE rep_reclamos SET estado = 'resuelto', respuesta = trim(p_respuesta), resuelto_por = auth.uid(), resuelto_at = NOW()
  WHERE id = p_reclamo_id
  RETURNING * INTO v_result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reclamo no encontrado'; END IF;
  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resolver_reclamo FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_reclamo TO authenticated;

CREATE OR REPLACE FUNCTION public.mis_reclamos()
RETURNS SETOF public.rep_reclamos
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM rep_reclamos WHERE repartidor_id = rep_mi_id() ORDER BY created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.mis_reclamos FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_reclamos TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reclamos_abiertos()
RETURNS TABLE(id UUID, repartidor_id UUID, repartidor_nombre TEXT, tipo TEXT, mensaje TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT rep_puede_ver_finanzas() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  RETURN QUERY
  SELECT rc.id, rc.repartidor_id, r.nombre, rc.tipo, rc.mensaje, rc.created_at
  FROM rep_reclamos rc JOIN rep_repartidores r ON r.id = rc.repartidor_id
  WHERE rc.estado = 'abierto' ORDER BY rc.created_at ASC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_reclamos_abiertos FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reclamos_abiertos TO authenticated;
