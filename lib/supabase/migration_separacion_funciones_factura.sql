-- migration_separacion_funciones_factura.sql
-- Fase 2, punto 9 de docs/auditoria_plan_correcciones_ia.md
--
-- El shopper registra el comprobante (registrada_por, ya lo hace
-- registrar_factura_compra_servidor); el que lo valida no debe ser la misma
-- persona para montos superiores a un umbral configurable. También migra
-- revisar_factura_compra() de rep_is_admin() a la capacidad específica
-- rep_puede_validar_factura_compra() (punto 1).

INSERT INTO rep_configuracion (clave, descripcion, valor)
VALUES ('umbral_separacion_funciones_factura', 'Monto (USD) desde el cual quien valida una factura de compra no puede ser quien la registró', '20.00')
ON CONFLICT (clave) DO NOTHING;

CREATE OR REPLACE FUNCTION public.revisar_factura_compra(
  p_comprobante_id UUID,
  p_estado TEXT,
  p_motivo TEXT DEFAULT NULL::TEXT
)
RETURNS ol_pedidos_comprobantes_proveedor
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result ol_pedidos_comprobantes_proveedor;
  v_umbral NUMERIC;
BEGIN
  IF NOT rep_puede_validar_factura_compra() THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;
  IF p_estado NOT IN ('validada','rechazada','con_diferencia') THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;
  IF p_estado <> 'validada' AND NULLIF(TRIM(p_motivo),'') IS NULL THEN
    RAISE EXCEPTION 'Debe indicar el motivo';
  END IF;

  SELECT * INTO v_result FROM ol_pedidos_comprobantes_proveedor WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura de compra no encontrada';
  END IF;

  SELECT COALESCE(valor::numeric, 20.00) INTO v_umbral
    FROM rep_configuracion WHERE clave = 'umbral_separacion_funciones_factura';

  IF v_result.registrada_por IS NOT NULL
     AND v_result.registrada_por = auth.uid()
     AND v_result.prov_costo_real >= COALESCE(v_umbral, 20.00)
     AND NOT rep_tiene_rol('superadmin')
  THEN
    RAISE EXCEPTION 'Por separación de funciones, quien registró esta factura (monto >= %) no puede validarla', COALESCE(v_umbral, 20.00);
  END IF;

  UPDATE ol_pedidos_comprobantes_proveedor
     SET estado_revision = p_estado, revisada_por = auth.uid(), revisada_at = NOW(), motivo_revision = NULLIF(TRIM(p_motivo),'')
   WHERE id = p_comprobante_id
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$function$;
