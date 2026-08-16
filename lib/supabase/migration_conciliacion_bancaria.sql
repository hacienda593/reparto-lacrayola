-- migration_conciliacion_bancaria.sql
-- Hasta ahora "confirmado" (depósitos de repartidor) y "pago_confirmado"
-- (transferencias de cliente) solo significan que un admin aprobó la foto o
-- el dato a ojo -- no que se cruzó contra el extracto bancario real. Se
-- agrega un estado de verificación separado, manual por ahora (el admin
-- revisa el banco aparte y marca acá), y una vista unificada para hacer el
-- seguimiento de qué falta verificar.

ALTER TABLE public.rep_depositos_repartidor
  ADD COLUMN IF NOT EXISTS verificado_banco    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verificado_banco_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verificado_banco_por UUID;

ALTER TABLE public.ol_pedidos
  ADD COLUMN IF NOT EXISTS verificado_banco    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verificado_banco_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verificado_banco_por UUID;

CREATE OR REPLACE FUNCTION public.admin_conciliacion_bancaria()
RETURNS TABLE(
  origen TEXT, id UUID, monto NUMERIC, fecha TIMESTAMPTZ,
  banco TEXT, referencia TEXT, detalle TEXT, verificado BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT rep_puede_ver_finanzas() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  RETURN QUERY
  SELECT 'deposito_repartidor'::TEXT, d.id, d.monto, d.registrado_at,
         d.banco, d.referencia, r.nombre || ' (depósito de repartidor)', d.verificado_banco
  FROM rep_depositos_repartidor d
  JOIN rep_repartidores r ON r.id = d.repartidor_id
  WHERE d.estado = 'confirmado'
  UNION ALL
  SELECT 'transferencia_cliente'::TEXT, p.id, p.total, p.updated_at,
         NULL, p.referencia_transferencia, 'Pedido #' || p.numero || ' — ' || p.nombre_cliente, p.verificado_banco
  FROM ol_pedidos p
  WHERE p.metodo_pago = 'transferencia' AND p.pago_confirmado = true
  ORDER BY fecha DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_conciliacion_bancaria FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_conciliacion_bancaria TO authenticated;

CREATE OR REPLACE FUNCTION public.marcar_verificado_banco(p_origen TEXT, p_id UUID, p_verificado BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT rep_puede_ver_finanzas() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  IF p_origen = 'deposito_repartidor' THEN
    UPDATE rep_depositos_repartidor
    SET verificado_banco = p_verificado,
        verificado_banco_at = CASE WHEN p_verificado THEN NOW() ELSE NULL END,
        verificado_banco_por = CASE WHEN p_verificado THEN auth.uid() ELSE NULL END
    WHERE id = p_id;
  ELSIF p_origen = 'transferencia_cliente' THEN
    UPDATE ol_pedidos
    SET verificado_banco = p_verificado,
        verificado_banco_at = CASE WHEN p_verificado THEN NOW() ELSE NULL END,
        verificado_banco_por = CASE WHEN p_verificado THEN auth.uid() ELSE NULL END
    WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Origen desconocido: %', p_origen;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'No encontrado'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.marcar_verificado_banco FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_verificado_banco TO authenticated;
