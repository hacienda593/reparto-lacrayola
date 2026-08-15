-- migration_zonas_multi_pueblo.sql
-- Soporte multi-zona (varios pueblos), pedido explícito del negocio:
-- "a corto plazo" van a operar Los Bancos, Mindo, Pedro Vicente Maldonado y
-- Puerto Quito, con un solo administrador (superadmin) viendo/operando las
-- 4, pero shoppers/riders de un pueblo NUNCA deben ver ni poder aceptar
-- pedidos de otro pueblo.
--
-- Modelo: una zona se "lanza" activándola (activo=true), igual que las
-- apps grandes activan una ciudad nueva -- sin tocar código, con un simple
-- UPDATE. Ninguna zona nueva empieza activa salvo la actual (Los Bancos,
-- que ya está operando).
--
-- Compatibilidad con la tienda: ol_pedidos.zona_id es NULLABLE con
-- DEFAULT a la zona activa actual, y se autocompleta con un trigger a
-- partir de ol_pedidos.ciudad (que la tienda ya envía) -- la tienda no
-- necesita ningún cambio para que esto funcione hoy.

CREATE TABLE IF NOT EXISTS public.zonas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     TEXT NOT NULL UNIQUE,
  alias      TEXT[] NOT NULL DEFAULT '{}',
  activo     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.zonas ENABLE ROW LEVEL SECURITY;
-- Lectura pública (nombre del pueblo no es dato sensible): la necesita
-- /registrar antes de que el visitante inicie sesión.
DROP POLICY IF EXISTS zonas_select ON public.zonas;
CREATE POLICY zonas_select ON public.zonas FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.zonas TO anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.zonas FROM PUBLIC, anon, authenticated;
-- Solo superadmin activa/desactiva zonas o las administra -- se hace vía
-- rep_puede_administrar_usuarios(), reutilizando la capacidad ya creada
-- para "configuración crítica".
DROP POLICY IF EXISTS zonas_admin ON public.zonas;
CREATE POLICY zonas_admin ON public.zonas FOR ALL TO authenticated
  USING (rep_puede_administrar_usuarios()) WITH CHECK (rep_puede_administrar_usuarios());
GRANT INSERT, UPDATE, DELETE ON public.zonas TO authenticated;

INSERT INTO public.zonas (nombre, alias, activo) VALUES
  ('Los Bancos', ARRAY['los bancos','san miguel de los bancos','san miguel de los bancos '], true),
  ('Mindo', ARRAY['mindo'], false),
  ('Pedro Vicente Maldonado', ARRAY['pedro vicente maldonado','p. maldonado','pv maldonado'], false),
  ('Puerto Quito', ARRAY['puerto quito','pto quito','pto. quito'], false)
ON CONFLICT (nombre) DO NOTHING;

-- ---------------------------------------------------------------------------
-- ol_pedidos.zona_id: se autocompleta desde ciudad, sin depender de que la
-- tienda cambie nada.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ol_pedidos ADD COLUMN IF NOT EXISTS zona_id UUID REFERENCES public.zonas(id);

CREATE OR REPLACE FUNCTION public.zona_desde_ciudad(p_ciudad TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT id FROM zonas WHERE lower(trim(p_ciudad)) = ANY(alias) LIMIT 1),
    (SELECT id FROM zonas WHERE lower(nombre) = lower(trim(p_ciudad)) LIMIT 1),
    -- Sin match conocido: cae en la única zona activa hoy (Los Bancos).
    -- Cuando haya más de una zona activa a la vez, esto deja de ser
    -- automático y hay que revisar el pedido manualmente (mejor eso que
    -- perder el pedido silenciosamente).
    (SELECT id FROM zonas WHERE activo = true ORDER BY created_at LIMIT 1)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.zona_desde_ciudad FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zona_desde_ciudad TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_asignar_zona_pedido()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.zona_id IS NULL THEN
    NEW.zona_id := zona_desde_ciudad(NEW.ciudad);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ol_pedidos_asignar_zona ON public.ol_pedidos;
CREATE TRIGGER trg_ol_pedidos_asignar_zona
  BEFORE INSERT OR UPDATE OF ciudad ON public.ol_pedidos
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_asignar_zona_pedido();

-- Backfill: todo lo existente hoy es de Los Bancos.
UPDATE public.ol_pedidos SET zona_id = zona_desde_ciudad(ciudad) WHERE zona_id IS NULL;

-- ---------------------------------------------------------------------------
-- rep_repartidores.zona_id: en qué pueblo opera cada colaborador.
-- ---------------------------------------------------------------------------
ALTER TABLE public.rep_repartidores ADD COLUMN IF NOT EXISTS zona_id UUID REFERENCES public.zonas(id);

-- Backfill: todos los repartidores actuales operan en Los Bancos (única
-- zona activa hasta ahora).
UPDATE public.rep_repartidores
   SET zona_id = (SELECT id FROM zonas WHERE nombre = 'Los Bancos')
 WHERE zona_id IS NULL;

-- ---------------------------------------------------------------------------
-- Aislamiento real: la RPC de autoasignación exige que shopper y pedido
-- sean de la misma zona -- no solo un filtro visual en el pool. Un shopper
-- de Mindo no puede aceptar (ni aunque llame la RPC directo) un pedido de
-- Los Bancos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aceptar_pedido_shopper(p_pedido_id UUID, p_request_id UUID)
RETURNS public.rep_asignaciones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_repartidor_id UUID;
  v_repartidor rep_repartidores;
  v_pedido ol_pedidos;
  v_asignacion rep_asignaciones;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Debe iniciar sesión'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Falta identificador de operación'; END IF;
  SELECT * INTO v_asignacion FROM rep_asignaciones WHERE request_id = p_request_id;
  IF FOUND THEN RETURN v_asignacion; END IF;
  SELECT * INTO v_repartidor FROM rep_repartidores WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe un perfil de repartidor para este usuario'; END IF;
  v_repartidor_id := v_repartidor.id;
  IF NOT v_repartidor.activo THEN RAISE EXCEPTION 'Tu cuenta de repartidor está desactivada'; END IF;
  IF v_repartidor.estado_registro <> 'aprobado' THEN RAISE EXCEPTION 'Tu registro aún no ha sido aprobado'; END IF;
  IF v_repartidor.estado = 'BLOQUEADO' THEN RAISE EXCEPTION 'Tienes la cuenta bloqueada por exceso de efectivo en mano; liquida antes de aceptar más pedidos'; END IF;
  IF v_repartidor.estado = 'INACTIVO' THEN RAISE EXCEPTION 'Tu cuenta está inactiva'; END IF;
  SELECT * INTO v_pedido FROM ol_pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF v_pedido.estado <> 'confirmado' THEN RAISE EXCEPTION 'Este pedido ya no está disponible para aceptar (estado actual: %)', v_pedido.estado; END IF;
  IF v_repartidor.zona_id IS NOT NULL AND v_pedido.zona_id IS NOT NULL AND v_repartidor.zona_id IS DISTINCT FROM v_pedido.zona_id THEN
    RAISE EXCEPTION 'Este pedido pertenece a otra zona de cobertura';
  END IF;
  IF EXISTS (SELECT 1 FROM rep_asignaciones WHERE pedido_id = p_pedido_id) THEN
    RAISE EXCEPTION 'Este pedido ya fue tomado por otro repartidor';
  END IF;
  INSERT INTO rep_asignaciones (pedido_id, repartidor_id, shopper_id, estado, notas, prioridad, request_id, asignado_por, asignado_at)
  VALUES (p_pedido_id, v_repartidor_id, v_repartidor_id, 'asignado', 'Auto-asignado por el Comprador desde el celular', 1, p_request_id, auth.uid(), NOW())
  RETURNING * INTO v_asignacion;
  PERFORM registrar_evento_pedido(p_pedido_id, v_asignacion.id, 'shopper_asignado', auth.uid(), v_repartidor_id, jsonb_build_object('shopper', v_repartidor.nombre), p_request_id);
  RETURN v_asignacion;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'Este pedido ya fue tomado por otro repartidor';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aceptar_pedido_shopper FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aceptar_pedido_shopper TO authenticated;
