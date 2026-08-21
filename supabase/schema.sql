-- ============================================================
-- ESQUEMA CANONICO DE PRODUCCION -- generado por introspeccion
-- directa contra la base de datos live (proyecto kjshjgatoatsknbvswft),
-- NO a mano ni copiado de migraciones locales.
--
-- Este archivo es un SNAPSHOT DE SOLO LECTURA, no se aplica con
-- "supabase db push". Se regenera con:
--   npm run db:schema:snapshot
-- Generado: 2026-08-21
-- ============================================================

-- ---------------------------------------------------------------
-- Tabla: abc_productos
-- ---------------------------------------------------------------
CREATE TABLE public.abc_productos (
  id integer NOT NULL DEFAULT nextval('abc_productos_id_seq'::regclass),
  ruc text,
  codigo text,
  descripcion text,
  categoria text,
  venta_anual numeric(12,2) DEFAULT 0,
  participacion numeric(6,2) DEFAULT 0,
  acumulado numeric(6,2) DEFAULT 0,
  clase text,
  PRIMARY KEY (id)
);
ALTER TABLE public.abc_productos ADD CONSTRAINT abc_productos_ruc_codigo_key UNIQUE (ruc, codigo);
CREATE UNIQUE INDEX abc_productos_ruc_codigo_key ON public.abc_productos USING btree (ruc, codigo);
ALTER TABLE public.abc_productos ENABLE ROW LEVEL SECURITY;
-- POLICY abc_productos_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: catalogo_productos
-- ---------------------------------------------------------------
CREATE TABLE public.catalogo_productos (
  id integer NOT NULL DEFAULT nextval('catalogo_productos_id_seq'::regclass),
  ruc text,
  codigo text,
  cod_auxiliar text,
  descripcion text,
  categoria text,
  subcategoria text,
  precio_publico numeric(12,4) DEFAULT 0,
  precio_con_iva numeric(12,4) DEFAULT 0,
  stock numeric(12,4) DEFAULT 0,
  ubic_percha text,
  ubic_almacen text,
  ubic_bodega text,
  en_tienda_online boolean DEFAULT false,
  img text,
  marca text,
  stock_minimo numeric(14,2) DEFAULT 0,
  PRIMARY KEY (id)
);
ALTER TABLE public.catalogo_productos ADD CONSTRAINT catalogo_productos_ruc_codigo_key UNIQUE (ruc, codigo);
CREATE UNIQUE INDEX catalogo_productos_ruc_codigo_key ON public.catalogo_productos USING btree (ruc, codigo);
ALTER TABLE public.catalogo_productos ENABLE ROW LEVEL SECURITY;
-- POLICY catalogo_productos_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: cuentas_por_cobrar
-- ---------------------------------------------------------------
CREATE TABLE public.cuentas_por_cobrar (
  ruc text NOT NULL,
  nooperacion integer NOT NULL,
  cliente text,
  nro_cliente text,
  factura text,
  total_factura numeric(14,2) DEFAULT 0,
  valor_financiado numeric(14,2) DEFAULT 0,
  pago_acumulado numeric(14,2) DEFAULT 0,
  saldo numeric(14,2) DEFAULT 0,
  mora_dias integer DEFAULT 0,
  tramo text,
  fecha_inicial date,
  fecha_vencimiento date,
  fecha_ultimo_pago date,
  vendedor text,
  nrocuotas integer DEFAULT 1,
  plazo_dias integer DEFAULT 0,
  PRIMARY KEY (ruc, nooperacion)
);
ALTER TABLE public.cuentas_por_cobrar ENABLE ROW LEVEL SECURITY;
-- POLICY solo_admin_cuentas_por_cobrar (ALL, roles={authenticated})
--   USING: rep_puede_ver_finanzas()

-- ---------------------------------------------------------------
-- Tabla: curva_horaria
-- ---------------------------------------------------------------
CREATE TABLE public.curva_horaria (
  ruc text NOT NULL,
  fecha date NOT NULL,
  hora integer NOT NULL,
  total_acumulado numeric(14,2) DEFAULT 0,
  total_hora numeric(14,2) DEFAULT 0,
  expectativa_acum numeric(14,2) DEFAULT 0,
  PRIMARY KEY (ruc, fecha, hora)
);
ALTER TABLE public.curva_horaria ENABLE ROW LEVEL SECURITY;
-- POLICY curva_horaria_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: detalle_ventas_hoy
-- ---------------------------------------------------------------
CREATE TABLE public.detalle_ventas_hoy (
  id integer NOT NULL DEFAULT nextval('detalle_ventas_hoy_id_seq'::regclass),
  ruc text,
  fecha date,
  ref_nro text,
  ref_tipo text,
  cod_producto text,
  descripcion text,
  categoria text,
  cantidad numeric(12,4) DEFAULT 0,
  precio_venta numeric(12,4) DEFAULT 0,
  costo_unitario numeric(12,4) DEFAULT 0,
  total_linea numeric(12,2) DEFAULT 0,
  margen_pct numeric(6,2) DEFAULT 0,
  stock_actual numeric(12,4) DEFAULT 0,
  stock_minimo numeric(12,4) DEFAULT 0,
  reponer boolean DEFAULT false,
  cliente text,
  vendedor text,
  PRIMARY KEY (id)
);
ALTER TABLE public.detalle_ventas_hoy ADD CONSTRAINT detalle_ventas_hoy_ruc_fecha_ref_nro_cod_producto_key UNIQUE (ruc, fecha, ref_nro, cod_producto);
CREATE UNIQUE INDEX detalle_ventas_hoy_ruc_fecha_ref_nro_cod_producto_key ON public.detalle_ventas_hoy USING btree (ruc, fecha, ref_nro, cod_producto);
ALTER TABLE public.detalle_ventas_hoy ENABLE ROW LEVEL SECURITY;
-- POLICY detalle_ventas_hoy_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: encuesta_votos
-- ---------------------------------------------------------------
CREATE TABLE public.encuesta_votos (
  id bigint NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  candidato_id text NOT NULL,
  ip_hash text NOT NULL,
  comunidad text NOT NULL,
  edad_rango text NOT NULL,
  genero text NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX idx_enc_votos_candidato ON public.encuesta_votos USING btree (candidato_id);
CREATE UNIQUE INDEX idx_enc_votos_ip_hash ON public.encuesta_votos USING btree (ip_hash);
ALTER TABLE public.encuesta_votos ENABLE ROW LEVEL SECURITY;
-- POLICY Permitir lectura pública (SELECT, roles={public})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: encuesta_votos_duplicate
-- ---------------------------------------------------------------
CREATE TABLE public.encuesta_votos_duplicate (
  id bigint NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  candidato_id text NOT NULL,
  ip_hash text NOT NULL,
  comunidad text NOT NULL,
  edad_rango text NOT NULL,
  genero text NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX encuesta_votos_duplicate_candidato_id_idx ON public.encuesta_votos_duplicate USING btree (candidato_id);
CREATE UNIQUE INDEX encuesta_votos_duplicate_ip_hash_idx ON public.encuesta_votos_duplicate USING btree (ip_hash);
ALTER TABLE public.encuesta_votos_duplicate ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- Tabla: encuesta_votos_duplicate2
-- ---------------------------------------------------------------
CREATE TABLE public.encuesta_votos_duplicate2 (
  id bigint NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  candidato_id text NOT NULL,
  ip_hash text NOT NULL,
  comunidad text NOT NULL,
  edad_rango text NOT NULL,
  genero text NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX encuesta_votos_duplicate2_candidato_id_idx ON public.encuesta_votos_duplicate2 USING btree (candidato_id);
CREATE UNIQUE INDEX encuesta_votos_duplicate2_ip_hash_idx ON public.encuesta_votos_duplicate2 USING btree (ip_hash);
ALTER TABLE public.encuesta_votos_duplicate2 ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- Tabla: forecast_meta
-- ---------------------------------------------------------------
CREATE TABLE public.forecast_meta (
  id integer NOT NULL DEFAULT 1,
  ruc text,
  meta_commit numeric(12,2) DEFAULT 0,
  meta_stretch numeric(12,2) DEFAULT 0,
  forecast_lineal numeric(12,2) DEFAULT 0,
  forecast_inteligente numeric(12,2) DEFAULT 0,
  factor_crecimiento_yoy numeric(8,4) DEFAULT 0,
  ventas_mtd numeric(12,2) DEFAULT 0,
  gap_vs_commit numeric(12,2) DEFAULT 0,
  pace_requerido_dia numeric(12,2) DEFAULT 0,
  promedio_7d numeric(12,2) DEFAULT 0,
  dias_transcurridos integer DEFAULT 0,
  dias_restantes integer DEFAULT 0,
  source_meta text,
  actualizado_en timestamp without time zone DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.forecast_meta ENABLE ROW LEVEL SECURITY;
-- POLICY forecast_meta_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: heatmap_ventas
-- ---------------------------------------------------------------
CREATE TABLE public.heatmap_ventas (
  ruc text NOT NULL,
  hora integer NOT NULL,
  dow integer NOT NULL,
  nombre_dia text,
  promedio numeric(14,2) DEFAULT 0,
  n_dias integer DEFAULT 0,
  PRIMARY KEY (ruc, dow, hora)
);
ALTER TABLE public.heatmap_ventas ENABLE ROW LEVEL SECURITY;
-- POLICY heatmap_ventas_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: kpi_resumen
-- ---------------------------------------------------------------
CREATE TABLE public.kpi_resumen (
  id integer NOT NULL DEFAULT 1,
  ruc text,
  venta_hoy numeric(12,2) DEFAULT 0,
  venta_ayer numeric(12,2) DEFAULT 0,
  venta_semana numeric(12,2) DEFAULT 0,
  venta_mes numeric(12,2) DEFAULT 0,
  venta_ano numeric(12,2) DEFAULT 0,
  meta_mes numeric(12,2) DEFAULT 0,
  forecast_lineal numeric(12,2) DEFAULT 0,
  forecast_yoy numeric(12,2) DEFAULT 0,
  pace_requerido numeric(12,2) DEFAULT 0,
  promedio_7d numeric(12,2) DEFAULT 0,
  dias_transcurridos integer DEFAULT 0,
  dias_restantes integer DEFAULT 0,
  gap_vs_meta numeric(12,2) DEFAULT 0,
  avance_pct numeric(6,2) DEFAULT 0,
  actualizado_en timestamp without time zone DEFAULT now(),
  venta_mes_factura numeric(12,2) DEFAULT 0,
  venta_mes_pedido numeric(12,2) DEFAULT 0,
  venta_ano_factura numeric(12,2) DEFAULT 0,
  venta_ano_pedido numeric(12,2) DEFAULT 0,
  PRIMARY KEY (id)
);
ALTER TABLE public.kpi_resumen ENABLE ROW LEVEL SECURITY;
-- POLICY solo_admin_kpi_resumen (ALL, roles={authenticated})
--   USING: rep_puede_ver_finanzas()

-- ---------------------------------------------------------------
-- Tabla: monitor_dia
-- ---------------------------------------------------------------
CREATE TABLE public.monitor_dia (
  id integer NOT NULL DEFAULT 1,
  ruc text,
  fecha date,
  hora_corte integer,
  venta_hoy numeric(14,2) DEFAULT 0,
  meta_dia numeric(14,2) DEFAULT 0,
  tipo_dia text,
  nombre_dia text,
  pace_actual numeric(14,2) DEFAULT 0,
  pace_necesario numeric(14,2) DEFAULT 0,
  horas_restantes integer DEFAULT 0,
  proyeccion_dia numeric(14,2) DEFAULT 0,
  avance_pct numeric(6,2) DEFAULT 0,
  estado text,
  expectativa_hora numeric(14,2) DEFAULT 0,
  brecha_expectativa numeric(14,2) DEFAULT 0,
  promedio_dia_tipo numeric(14,2) DEFAULT 0,
  promedio_mismo_dow numeric(14,2) DEFAULT 0,
  venta_ayer numeric(14,2) DEFAULT 0,
  venta_mismo_dia_sem_ant numeric(14,2) DEFAULT 0,
  actualizado_en timestamp without time zone,
  venta_mismo_dia_ano_ant numeric(14,2) DEFAULT 0,
  PRIMARY KEY (id)
);
ALTER TABLE public.monitor_dia ENABLE ROW LEVEL SECURITY;
-- POLICY monitor_dia_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: ol_carrito_items
-- ---------------------------------------------------------------
CREATE TABLE public.ol_carrito_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  carrito_id uuid NOT NULL,
  codigo text NOT NULL,
  descripcion text NOT NULL,
  categoria text,
  precio_unitario numeric(14,2) NOT NULL,
  cantidad integer NOT NULL DEFAULT 1,
  subtotal numeric(14,2) DEFAULT (precio_unitario * (cantidad)::numeric),
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_carrito_items ADD CONSTRAINT ol_carrito_items_carrito_id_fkey FOREIGN KEY (carrito_id) REFERENCES public.ol_carritos(id);
ALTER TABLE public.ol_carrito_items ADD CONSTRAINT ol_carrito_items_carrito_id_codigo_key UNIQUE (carrito_id, codigo);
CREATE INDEX idx_ol_carrito_items_cart ON public.ol_carrito_items USING btree (carrito_id);
CREATE UNIQUE INDEX ol_carrito_items_carrito_id_codigo_key ON public.ol_carrito_items USING btree (carrito_id, codigo);
ALTER TABLE public.ol_carrito_items ENABLE ROW LEVEL SECURITY;
-- POLICY carrito_items_own (ALL, roles={public})
--   USING: (carrito_id IN ( SELECT c.id
   FROM (ol_carritos c
     LEFT JOIN ol_clientes cl ON ((c.cliente_id = cl.id)))
  WHERE ((cl.auth_id = auth.uid()) OR (auth.uid() IS NULL))))

-- ---------------------------------------------------------------
-- Tabla: ol_carritos
-- ---------------------------------------------------------------
CREATE TABLE public.ol_carritos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cliente_id uuid,
  session_id text,
  estado text DEFAULT 'activo'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_carritos ADD CONSTRAINT ol_carritos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.ol_clientes(id);
CREATE INDEX idx_ol_carritos_cliente ON public.ol_carritos USING btree (cliente_id);
CREATE INDEX idx_ol_carritos_session ON public.ol_carritos USING btree (session_id);
ALTER TABLE public.ol_carritos ENABLE ROW LEVEL SECURITY;
-- POLICY carrito_own (ALL, roles={public})
--   USING: ((cliente_id IN ( SELECT ol_clientes.id
   FROM ol_clientes
  WHERE (ol_clientes.auth_id = auth.uid()))) OR (auth.uid() IS NULL))

-- ---------------------------------------------------------------
-- Tabla: ol_clientes
-- ---------------------------------------------------------------
CREATE TABLE public.ol_clientes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  auth_id uuid,
  nombre text NOT NULL,
  email text,
  telefono text,
  cedula text,
  direccion text,
  ciudad text DEFAULT 'Quito'::text,
  referencias text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_clientes ADD CONSTRAINT ol_clientes_auth_id_key UNIQUE (auth_id);
CREATE UNIQUE INDEX ol_clientes_auth_id_key ON public.ol_clientes USING btree (auth_id);
ALTER TABLE public.ol_clientes ENABLE ROW LEVEL SECURITY;
-- POLICY cliente_own (ALL, roles={public})
--   USING: (auth.uid() = auth_id)

-- ---------------------------------------------------------------
-- Tabla: ol_direcciones_cliente
-- ---------------------------------------------------------------
CREATE TABLE public.ol_direcciones_cliente (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  telefono text NOT NULL,
  nombre_etiqueta text NOT NULL,
  direccion_texto text NOT NULL,
  ciudad text NOT NULL DEFAULT 'Los Bancos'::text,
  referencias text,
  geo_lat double precision NOT NULL,
  geo_lng double precision NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_direcciones_cliente ADD CONSTRAINT ol_direcciones_cliente_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.null(null);
ALTER TABLE public.ol_direcciones_cliente ADD CONSTRAINT unique_user_label UNIQUE (user_id, nombre_etiqueta);
ALTER TABLE public.ol_direcciones_cliente ADD CONSTRAINT unique_telefono_label UNIQUE (telefono, nombre_etiqueta);
CREATE UNIQUE INDEX unique_telefono_label ON public.ol_direcciones_cliente USING btree (telefono, nombre_etiqueta);
CREATE UNIQUE INDEX unique_user_label ON public.ol_direcciones_cliente USING btree (user_id, nombre_etiqueta);
ALTER TABLE public.ol_direcciones_cliente ENABLE ROW LEVEL SECURITY;
-- POLICY Permitir a clientes gestionar sus direcciones (ALL, roles={authenticated})
--   USING: (auth.uid() = user_id)
--   WITH CHECK: (auth.uid() = user_id)
-- POLICY ol_direcciones_cliente_delete (DELETE, roles={public})
--   USING: ((user_id = auth.uid()) OR rep_puede_gestionar_operacion())
-- POLICY ol_direcciones_cliente_insert (INSERT, roles={public})
--   WITH CHECK: (user_id = auth.uid())
-- POLICY ol_direcciones_cliente_select (SELECT, roles={public})
--   USING: ((user_id = auth.uid()) OR rep_puede_gestionar_operacion())
-- POLICY ol_direcciones_cliente_update (UPDATE, roles={public})
--   USING: ((user_id = auth.uid()) OR rep_puede_gestionar_operacion())
--   WITH CHECK: ((user_id = auth.uid()) OR rep_puede_gestionar_operacion())

-- ---------------------------------------------------------------
-- Tabla: ol_favoritos
-- ---------------------------------------------------------------
CREATE TABLE public.ol_favoritos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  codigo text NOT NULL,
  descripcion text,
  categoria text,
  precio_unitario numeric,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_favoritos ADD CONSTRAINT ol_favoritos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.null(null);
ALTER TABLE public.ol_favoritos ADD CONSTRAINT ol_favoritos_user_id_codigo_key UNIQUE (user_id, codigo);
CREATE UNIQUE INDEX ol_favoritos_user_id_codigo_key ON public.ol_favoritos USING btree (user_id, codigo);
ALTER TABLE public.ol_favoritos ENABLE ROW LEVEL SECURITY;
-- POLICY usuario ve sus favoritos (ALL, roles={public})
--   USING: (auth.uid() = user_id)

-- ---------------------------------------------------------------
-- Tabla: ol_pedido_items
-- ---------------------------------------------------------------
CREATE TABLE public.ol_pedido_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL,
  codigo text NOT NULL,
  descripcion text NOT NULL,
  categoria text,
  precio_unitario numeric(14,2) NOT NULL,
  cantidad integer NOT NULL,
  subtotal numeric(14,2) DEFAULT (precio_unitario * (cantidad)::numeric),
  picking_completado boolean DEFAULT false,
  picking_agotado boolean DEFAULT false,
  iva_codigo text,
  iva_porcentaje numeric,
  picking_reemplazo text,
  tienda_id uuid,
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_pedido_items ADD CONSTRAINT ol_pedido_items_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.ol_tiendas(id);
ALTER TABLE public.ol_pedido_items ADD CONSTRAINT ol_pedido_items_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
CREATE INDEX idx_ol_pedido_items_tienda ON public.ol_pedido_items USING btree (pedido_id, tienda_id);
ALTER TABLE public.ol_pedido_items ENABLE ROW LEVEL SECURITY;
-- POLICY Permitir a repartidores y admin actualizar items (UPDATE, roles={authenticated})
--   USING: (EXISTS ( SELECT 1
   FROM rep_roles
  WHERE ((rep_roles.user_id = auth.uid()) AND (rep_roles.rol = ANY (ARRAY['repartidor'::text, 'shopper'::text, 'admin'::text, 'superadmin'::text, 'supervisor'::text])) AND (rep_roles.activo = true))))
--   WITH CHECK: (EXISTS ( SELECT 1
   FROM rep_roles
  WHERE ((rep_roles.user_id = auth.uid()) AND (rep_roles.rol = ANY (ARRAY['repartidor'::text, 'shopper'::text, 'admin'::text, 'superadmin'::text, 'supervisor'::text])) AND (rep_roles.activo = true))))
-- POLICY ol_pedido_items_delete (DELETE, roles={public})
--   USING: rep_puede_gestionar_operacion()
-- POLICY ol_pedido_items_insert (INSERT, roles={authenticated})
--   WITH CHECK: rep_puede_ver_pedido(pedido_id)
-- POLICY ol_pedido_items_select (SELECT, roles={authenticated})
--   USING: rep_puede_ver_pedido(pedido_id)
-- POLICY ol_pedido_items_update (UPDATE, roles={authenticated})
--   USING: rep_puede_ver_pedido(pedido_id)
--   WITH CHECK: rep_puede_ver_pedido(pedido_id)

-- ---------------------------------------------------------------
-- Tabla: ol_pedidos
-- ---------------------------------------------------------------
CREATE TABLE public.ol_pedidos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  numero integer NOT NULL DEFAULT nextval('ol_pedidos_numero_seq'::regclass),
  cliente_id uuid,
  nombre_cliente text NOT NULL,
  email_cliente text,
  telefono text,
  direccion text,
  ciudad text,
  referencias text,
  notas text,
  estado text DEFAULT 'pendiente'::text,
  total numeric(14,2) NOT NULL DEFAULT 0,
  total_items integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  geo_lat double precision,
  geo_lng double precision,
  user_id uuid,
  prov_establecimiento character varying(3),
  prov_punto_emision character varying(3),
  prov_secuencial character varying(9),
  prov_costo_real numeric(10,2),
  prov_factura_url text,
  prov_clave_acceso character varying(49),
  prov_ruc character varying(13),
  metodo_pago character varying(20) DEFAULT 'contra_entrega'::character varying,
  pago_confirmado boolean DEFAULT false,
  referencia_transferencia character varying(100),
  zona_id uuid,
  costo_envio numeric(10,2),
  verificado_banco boolean NOT NULL DEFAULT false,
  verificado_banco_at timestamp with time zone,
  verificado_banco_por uuid,
  total_final numeric(12,2),
  comprobante_transferencia_path text,
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_pedidos ADD CONSTRAINT ol_pedidos_zona_id_fkey FOREIGN KEY (zona_id) REFERENCES public.zonas(id);
ALTER TABLE public.ol_pedidos ADD CONSTRAINT ol_pedidos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.ol_clientes(id);
ALTER TABLE public.ol_pedidos ADD CONSTRAINT ol_pedidos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.null(null);
CREATE INDEX idx_ol_pedidos_cliente ON public.ol_pedidos USING btree (cliente_id);
CREATE INDEX idx_ol_pedidos_estado ON public.ol_pedidos USING btree (estado);
CREATE INDEX idx_ol_pedidos_numero ON public.ol_pedidos USING btree (numero);
CREATE UNIQUE INDEX idx_ol_pedidos_ref_transferencia_unique ON public.ol_pedidos USING btree (referencia_transferencia) WHERE (referencia_transferencia IS NOT NULL);
ALTER TABLE public.ol_pedidos ENABLE ROW LEVEL SECURITY;
-- POLICY Permitir a repartidores y admin actualizar pedidos (UPDATE, roles={authenticated})
--   USING: (EXISTS ( SELECT 1
   FROM rep_roles
  WHERE ((rep_roles.user_id = auth.uid()) AND (rep_roles.rol = ANY (ARRAY['repartidor'::text, 'shopper'::text, 'admin'::text, 'superadmin'::text, 'supervisor'::text])) AND (rep_roles.activo = true))))
--   WITH CHECK: (EXISTS ( SELECT 1
   FROM rep_roles
  WHERE ((rep_roles.user_id = auth.uid()) AND (rep_roles.rol = ANY (ARRAY['repartidor'::text, 'shopper'::text, 'admin'::text, 'superadmin'::text, 'supervisor'::text])) AND (rep_roles.activo = true))))
-- POLICY ol_pedidos_delete (DELETE, roles={public})
--   USING: rep_puede_gestionar_operacion()
-- POLICY ol_pedidos_insert (INSERT, roles={authenticated})
--   WITH CHECK: ((user_id = auth.uid()) OR rep_puede_gestionar_operacion())
-- POLICY ol_pedidos_select (SELECT, roles={authenticated})
--   USING: rep_puede_ver_pedido(id)
-- POLICY ol_pedidos_update (UPDATE, roles={authenticated})
--   USING: rep_puede_ver_pedido(id)
--   WITH CHECK: rep_puede_ver_pedido(id)

-- ---------------------------------------------------------------
-- Tabla: ol_pedidos_comprobantes_proveedor
-- ---------------------------------------------------------------
CREATE TABLE public.ol_pedidos_comprobantes_proveedor (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL,
  tienda_id uuid NOT NULL,
  prov_establecimiento character varying(3) NOT NULL,
  prov_punto_emision character varying(3) NOT NULL,
  prov_secuencial character varying(9) NOT NULL,
  prov_costo_real numeric(10,2) NOT NULL,
  prov_factura_url text,
  prov_clave_acceso character varying(49),
  prov_ruc character varying(13) NOT NULL,
  metodo_pago character varying(50),
  created_at timestamp with time zone DEFAULT now(),
  estado_revision text NOT NULL DEFAULT 'pendiente'::text,
  revisada_por uuid,
  revisada_at timestamp with time zone,
  motivo_revision text,
  sri_estado text,
  sri_fecha_autorizacion timestamp with time zone,
  sri_xml text,
  sri_xml_sha256 character varying(64),
  sri_razon_social_emisor text,
  sri_identificacion_comprador character varying(20),
  sri_subtotal numeric(12,2),
  sri_iva numeric(12,2),
  sri_total numeric(12,2),
  sri_ambiente text,
  sri_consultado_at timestamp with time zone,
  conciliacion_estado text DEFAULT 'pendiente'::text,
  conciliacion_diferencias jsonb NOT NULL DEFAULT '[]'::jsonb,
  registrada_por uuid,
  registrada_at timestamp with time zone,
  request_id uuid,
  tipo_comprobante text NOT NULL DEFAULT 'electronica'::text,
  motivo_excepcion text,
  sri_mensaje_error text,
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_pedidos_comprobantes_proveedor ADD CONSTRAINT ol_pedidos_comprobantes_proveedor_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.ol_tiendas(id);
ALTER TABLE public.ol_pedidos_comprobantes_proveedor ADD CONSTRAINT ol_pedidos_comprobantes_proveedor_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
CREATE INDEX comprobante_proveedor_numero_idx ON public.ol_pedidos_comprobantes_proveedor USING btree (prov_ruc, prov_establecimiento, prov_punto_emision, prov_secuencial);
CREATE UNIQUE INDEX factura_compra_clave_acceso_uidx ON public.ol_pedidos_comprobantes_proveedor USING btree (prov_clave_acceso) WHERE (prov_clave_acceso IS NOT NULL);
CREATE INDEX factura_compra_conciliacion_idx ON public.ol_pedidos_comprobantes_proveedor USING btree (conciliacion_estado, estado_revision, created_at DESC);
CREATE UNIQUE INDEX idx_comprobantes_proveedor_request_id ON public.ol_pedidos_comprobantes_proveedor USING btree (request_id) WHERE (request_id IS NOT NULL);
ALTER TABLE public.ol_pedidos_comprobantes_proveedor ENABLE ROW LEVEL SECURITY;
-- POLICY factura_compra_insert_asignado (INSERT, roles={authenticated})
--   WITH CHECK: (rep_puede_validar_factura_compra() OR (EXISTS ( SELECT 1
   FROM rep_asignaciones a
  WHERE ((a.pedido_id = ol_pedidos_comprobantes_proveedor.pedido_id) AND ((a.shopper_id = rep_mi_id()) OR (a.repartidor_id = rep_mi_id()))))))
-- POLICY factura_compra_select_asignado (SELECT, roles={authenticated})
--   USING: (rep_puede_validar_factura_compra() OR (EXISTS ( SELECT 1
   FROM rep_asignaciones a
  WHERE ((a.pedido_id = ol_pedidos_comprobantes_proveedor.pedido_id) AND ((a.shopper_id = rep_mi_id()) OR (a.rider_id = rep_mi_id()) OR (a.repartidor_id = rep_mi_id()))))))
-- POLICY ol_comprobantes_proveedor_admin_policy (ALL, roles={authenticated})
--   USING: rep_puede_validar_factura_compra()
--   WITH CHECK: rep_puede_validar_factura_compra()

-- ---------------------------------------------------------------
-- Tabla: ol_pedidos_envio
-- ---------------------------------------------------------------
CREATE TABLE public.ol_pedidos_envio (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL,
  tarifa_base numeric(10,2) NOT NULL,
  cantidad_tiendas integer NOT NULL DEFAULT 1,
  cargo_multitienda numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL,
  origen text NOT NULL DEFAULT 'tienda'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_pedidos_envio ADD CONSTRAINT ol_pedidos_envio_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.ol_pedidos_envio ADD CONSTRAINT ol_pedidos_envio_pedido_id_key UNIQUE (pedido_id);
CREATE UNIQUE INDEX ol_pedidos_envio_pedido_id_key ON public.ol_pedidos_envio USING btree (pedido_id);
ALTER TABLE public.ol_pedidos_envio ENABLE ROW LEVEL SECURITY;
-- POLICY ol_pedidos_envio_select (SELECT, roles={public})
--   USING: rep_puede_ver_pedido(pedido_id)

-- ---------------------------------------------------------------
-- Tabla: ol_pedidos_verificaciones
-- ---------------------------------------------------------------
CREATE TABLE public.ol_pedidos_verificaciones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL,
  accion character varying(20) NOT NULL,
  referencia character varying(100),
  banco character varying(20),
  fecha_deposito date,
  admin_user_id uuid NOT NULL,
  admin_nombre character varying(150),
  notas text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  request_id uuid,
  evidencia_path text,
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_pedidos_verificaciones ADD CONSTRAINT ol_pedidos_verificaciones_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.ol_pedidos_verificaciones ADD CONSTRAINT ol_pedidos_verificaciones_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES public.null(null);
CREATE INDEX idx_ol_pedidos_verif_admin ON public.ol_pedidos_verificaciones USING btree (admin_user_id, created_at DESC);
CREATE INDEX idx_ol_pedidos_verif_fecha ON public.ol_pedidos_verificaciones USING btree (created_at DESC);
CREATE INDEX idx_ol_pedidos_verif_pedido ON public.ol_pedidos_verificaciones USING btree (pedido_id, created_at DESC);
CREATE UNIQUE INDEX idx_ol_pedidos_verificaciones_request_id ON public.ol_pedidos_verificaciones USING btree (request_id) WHERE (request_id IS NOT NULL);
ALTER TABLE public.ol_pedidos_verificaciones ENABLE ROW LEVEL SECURITY;
-- POLICY ol_pedidos_verif_insert (INSERT, roles={public})
--   WITH CHECK: (rep_puede_confirmar_pago() AND (admin_user_id = auth.uid()))
-- POLICY ol_pedidos_verif_select (SELECT, roles={public})
--   USING: rep_puede_confirmar_pago()

-- ---------------------------------------------------------------
-- Tabla: ol_productos
-- ---------------------------------------------------------------
CREATE TABLE public.ol_productos (
  id bigint NOT NULL DEFAULT nextval('ol_productos_id_seq'::regclass),
  ruc text NOT NULL,
  codigo text NOT NULL,
  descripcion text,
  categoria text,
  marca text,
  stock numeric(14,2) DEFAULT 0,
  stock_minimo numeric(14,2) DEFAULT 0,
  precio_publico numeric(14,2) DEFAULT 0,
  precio_con_iva numeric(14,2) DEFAULT 0,
  subcategoria text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  tienda_id uuid,
  imagen_url text,
  codigo_barras text,
  detalles text,
  iva_codigo character varying(5) DEFAULT '4'::character varying,
  iva_porcentaje numeric(5,2) DEFAULT 15.00,
  en_oferta boolean DEFAULT false,
  precio_oferta numeric(10,2) DEFAULT NULL::numeric,
  grupo_busqueda text,
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_productos ADD CONSTRAINT ol_productos_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.ol_tiendas(id);
ALTER TABLE public.ol_productos ADD CONSTRAINT ol_productos_ruc_codigo_key UNIQUE (ruc, codigo);
CREATE INDEX idx_ol_productos_categoria ON public.ol_productos USING btree (categoria);
CREATE INDEX idx_ol_productos_precio ON public.ol_productos USING btree (precio_publico);
CREATE INDEX idx_ol_productos_ruc ON public.ol_productos USING btree (ruc);
CREATE INDEX idx_ol_productos_stock ON public.ol_productos USING btree (stock);
CREATE UNIQUE INDEX ol_productos_ruc_codigo_key ON public.ol_productos USING btree (ruc, codigo);
ALTER TABLE public.ol_productos ENABLE ROW LEVEL SECURITY;
-- POLICY Permitir a repartidores actualizar codigo_barras (UPDATE, roles={authenticated})
--   USING: (EXISTS ( SELECT 1
   FROM rep_roles
  WHERE ((rep_roles.user_id = auth.uid()) AND (rep_roles.rol = ANY (ARRAY['repartidor'::text, 'shopper'::text, 'admin'::text, 'superadmin'::text, 'supervisor'::text])) AND (rep_roles.activo = true))))
--   WITH CHECK: (EXISTS ( SELECT 1
   FROM rep_roles
  WHERE ((rep_roles.user_id = auth.uid()) AND (rep_roles.rol = ANY (ARRAY['repartidor'::text, 'shopper'::text, 'admin'::text, 'superadmin'::text, 'supervisor'::text])) AND (rep_roles.activo = true))))
-- POLICY ol_productos_select_public (SELECT, roles={anon,authenticated})
--   USING: true
-- POLICY productos_lectura_publica (SELECT, roles={anon})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: ol_productos_busquedas_sin_resultado
-- ---------------------------------------------------------------
CREATE TABLE public.ol_productos_busquedas_sin_resultado (
  id bigint NOT NULL DEFAULT nextval('ol_productos_busquedas_sin_resultado_id_seq'::regclass),
  termino_buscado text NOT NULL,
  veces_buscado integer NOT NULL DEFAULT 1,
  primera_vez timestamp with time zone NOT NULL DEFAULT now(),
  ultima_vez timestamp with time zone NOT NULL DEFAULT now(),
  resuelto boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_productos_busquedas_sin_resultado ADD CONSTRAINT ol_productos_busquedas_sin_resultado_termino_buscado_key UNIQUE (termino_buscado);
CREATE UNIQUE INDEX ol_productos_busquedas_sin_resultado_termino_buscado_key ON public.ol_productos_busquedas_sin_resultado USING btree (termino_buscado);
ALTER TABLE public.ol_productos_busquedas_sin_resultado ENABLE ROW LEVEL SECURITY;
-- POLICY actualizacion publica busquedas fallidas (UPDATE, roles={public})
--   USING: true
--   WITH CHECK: true
-- POLICY escritura publica busquedas fallidas (INSERT, roles={public})
--   WITH CHECK: true
-- POLICY lectura publica busquedas fallidas (SELECT, roles={public})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: ol_productos_frecuentes
-- ---------------------------------------------------------------
CREATE TABLE public.ol_productos_frecuentes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  telefono text,
  producto_codigo text NOT NULL,
  veces_comprado integer DEFAULT 1,
  ultimo_pedido timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_productos_frecuentes ADD CONSTRAINT ol_productos_frecuentes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.null(null);
ALTER TABLE public.ol_productos_frecuentes ADD CONSTRAINT unique_user_product UNIQUE (user_id, producto_codigo);
ALTER TABLE public.ol_productos_frecuentes ADD CONSTRAINT unique_telefono_product UNIQUE (telefono, producto_codigo);
CREATE UNIQUE INDEX unique_telefono_product ON public.ol_productos_frecuentes USING btree (telefono, producto_codigo);
CREATE UNIQUE INDEX unique_user_product ON public.ol_productos_frecuentes USING btree (user_id, producto_codigo);
ALTER TABLE public.ol_productos_frecuentes ENABLE ROW LEVEL SECURITY;
-- POLICY Permitir a usuarios consultar sus productos frecuentes (ALL, roles={authenticated})
--   USING: (auth.uid() = user_id)
--   WITH CHECK: (auth.uid() = user_id)
-- POLICY ol_productos_frecuentes_user_policy (ALL, roles={authenticated})
--   USING: (auth.uid() = user_id)
--   WITH CHECK: (auth.uid() = user_id)

-- ---------------------------------------------------------------
-- Tabla: ol_productos_terminos_busqueda
-- ---------------------------------------------------------------
CREATE TABLE public.ol_productos_terminos_busqueda (
  id bigint NOT NULL DEFAULT nextval('ol_productos_terminos_busqueda_id_seq'::regclass),
  variante text NOT NULL,
  termino_correcto text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_productos_terminos_busqueda ADD CONSTRAINT ol_productos_terminos_busqueda_variante_key UNIQUE (variante);
CREATE UNIQUE INDEX ol_productos_terminos_busqueda_variante_key ON public.ol_productos_terminos_busqueda USING btree (variante);
ALTER TABLE public.ol_productos_terminos_busqueda ENABLE ROW LEVEL SECURITY;
-- POLICY lectura publica terminos (SELECT, roles={public})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: ol_puntos
-- ---------------------------------------------------------------
CREATE TABLE public.ol_puntos (
  user_id uuid NOT NULL,
  total integer NOT NULL DEFAULT 0,
  disponibles integer NOT NULL DEFAULT 0,
  canjeados integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (user_id)
);
ALTER TABLE public.ol_puntos ADD CONSTRAINT ol_puntos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.null(null);
ALTER TABLE public.ol_puntos ENABLE ROW LEVEL SECURITY;
-- POLICY usuario ve sus puntos (ALL, roles={public})
--   USING: (auth.uid() = user_id)

-- ---------------------------------------------------------------
-- Tabla: ol_tiendas
-- ---------------------------------------------------------------
CREATE TABLE public.ol_tiendas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  descripcion text,
  logo_url text,
  categoria text,
  direccion text,
  activa boolean DEFAULT true,
  orden integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  ruc character varying(13),
  codigo_numerico character varying(8),
  establecimiento character varying(3),
  PRIMARY KEY (id)
);
ALTER TABLE public.ol_tiendas ENABLE ROW LEVEL SECURITY;
-- POLICY ol_tiendas_select (SELECT, roles={public})
--   USING: true
-- POLICY ol_tiendas_write (ALL, roles={public})
--   USING: rep_puede_administrar_usuarios()
--   WITH CHECK: rep_puede_administrar_usuarios()

-- ---------------------------------------------------------------
-- Tabla: productos_movimientos
-- ---------------------------------------------------------------
CREATE TABLE public.productos_movimientos (
  id bigint NOT NULL,
  fecha timestamp without time zone,
  ruc text,
  almacen text,
  tipo text,
  subtipo text,
  cod_producto text,
  cantidad numeric(12,4),
  stock_antes numeric(12,4),
  stock_despues numeric(12,4),
  ref_tipo text,
  ref_nro text,
  motivo text,
  usuario text,
  fecha_reg timestamp without time zone,
  PRIMARY KEY (id)
);
CREATE INDEX idx_pm_cod_producto ON public.productos_movimientos USING btree (cod_producto);
CREATE INDEX idx_pm_fecha ON public.productos_movimientos USING btree (fecha DESC);
CREATE INDEX idx_pm_ruc ON public.productos_movimientos USING btree (ruc);
ALTER TABLE public.productos_movimientos ENABLE ROW LEVEL SECURITY;
-- POLICY productos_movimientos_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: proyecciones
-- ---------------------------------------------------------------
CREATE TABLE public.proyecciones (
  id integer NOT NULL DEFAULT 1,
  ruc text,
  cierre_mes numeric(12,2) DEFAULT 0,
  cierre_mes_opt numeric(12,2) DEFAULT 0,
  cierre_mes_pes numeric(12,2) DEFAULT 0,
  cierre_ano numeric(12,2) DEFAULT 0,
  cierre_ano_opt numeric(12,2) DEFAULT 0,
  cierre_ano_pes numeric(12,2) DEFAULT 0,
  factor_estacion numeric(8,4) DEFAULT 1,
  actualizado_en timestamp without time zone DEFAULT now(),
  cierre_lineal numeric(14,2) DEFAULT 0,
  cierre_momentum numeric(14,2) DEFAULT 0,
  cierre_yoy_ajustado numeric(14,2) DEFAULT 0,
  ritmo_mes numeric(14,2) DEFAULT 0,
  ritmo_7d numeric(14,2) DEFAULT 0,
  aceleracion_pct numeric(8,2) DEFAULT 0,
  venta_mismoperiodo_ant numeric(14,2) DEFAULT 0,
  crecimiento_mismoperiodo numeric(8,2) DEFAULT 0,
  venta_mes_ant_completo numeric(14,2) DEFAULT 0,
  PRIMARY KEY (id)
);
ALTER TABLE public.proyecciones ENABLE ROW LEVEL SECURITY;
-- POLICY proyecciones_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: rentabilidad_categoria
-- ---------------------------------------------------------------
CREATE TABLE public.rentabilidad_categoria (
  id integer NOT NULL DEFAULT nextval('rentabilidad_categoria_id_seq'::regclass),
  ruc text,
  ano integer,
  mes integer,
  categoria text,
  ventas numeric(12,2) DEFAULT 0,
  costo numeric(12,2) DEFAULT 0,
  margen_bruto numeric(12,2) DEFAULT 0,
  margen_pct numeric(6,2) DEFAULT 0,
  PRIMARY KEY (id)
);
ALTER TABLE public.rentabilidad_categoria ADD CONSTRAINT rentabilidad_categoria_ruc_ano_mes_categoria_key UNIQUE (ruc, ano, mes, categoria);
CREATE UNIQUE INDEX rentabilidad_categoria_ruc_ano_mes_categoria_key ON public.rentabilidad_categoria USING btree (ruc, ano, mes, categoria);
ALTER TABLE public.rentabilidad_categoria ENABLE ROW LEVEL SECURITY;
-- POLICY rentabilidad_categoria_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: rep_asignaciones
-- ---------------------------------------------------------------
CREATE TABLE public.rep_asignaciones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL,
  repartidor_id uuid NOT NULL,
  asignado_por uuid,
  asignado_at timestamp with time zone DEFAULT now(),
  estado text DEFAULT 'asignado'::text,
  prioridad integer DEFAULT 0,
  notas text,
  updated_at timestamp with time zone DEFAULT now(),
  shopper_id uuid,
  rider_id uuid,
  handoff_otp character varying(6),
  handoff_at timestamp with time zone,
  compra_iniciada_at timestamp with time zone,
  foto_entrega_url text,
  firma_cliente_url text,
  entrega_lat numeric(9,6),
  entrega_lng numeric(9,6),
  request_id uuid,
  compra_iniciada_request_id uuid,
  finalizar_compra_request_id uuid,
  iniciar_ruta_request_id uuid,
  tienda_id uuid,
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_asignaciones ADD CONSTRAINT rep_asignaciones_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.ol_tiendas(id);
ALTER TABLE public.rep_asignaciones ADD CONSTRAINT rep_asignaciones_shopper_id_fkey FOREIGN KEY (shopper_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_asignaciones ADD CONSTRAINT rep_asignaciones_rider_id_fkey FOREIGN KEY (rider_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_asignaciones ADD CONSTRAINT rep_asignaciones_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.rep_asignaciones ADD CONSTRAINT rep_asignaciones_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_asignaciones ADD CONSTRAINT rep_asignaciones_asignado_por_fkey FOREIGN KEY (asignado_por) REFERENCES public.null(null);
CREATE UNIQUE INDEX idx_rep_asignaciones_compra_iniciada_request_id ON public.rep_asignaciones USING btree (compra_iniciada_request_id) WHERE (compra_iniciada_request_id IS NOT NULL);
CREATE UNIQUE INDEX idx_rep_asignaciones_finalizar_compra_request_id ON public.rep_asignaciones USING btree (finalizar_compra_request_id) WHERE (finalizar_compra_request_id IS NOT NULL);
CREATE UNIQUE INDEX idx_rep_asignaciones_iniciar_ruta_request_id ON public.rep_asignaciones USING btree (iniciar_ruta_request_id) WHERE (iniciar_ruta_request_id IS NOT NULL);
CREATE UNIQUE INDEX idx_rep_asignaciones_pedido_sin_tienda ON public.rep_asignaciones USING btree (pedido_id) WHERE (tienda_id IS NULL);
CREATE UNIQUE INDEX idx_rep_asignaciones_pedido_tienda ON public.rep_asignaciones USING btree (pedido_id, tienda_id) WHERE (tienda_id IS NOT NULL);
CREATE UNIQUE INDEX idx_rep_asignaciones_request_id ON public.rep_asignaciones USING btree (request_id) WHERE (request_id IS NOT NULL);
ALTER TABLE public.rep_asignaciones ENABLE ROW LEVEL SECURITY;
-- POLICY rep_asignaciones_delete (DELETE, roles={public})
--   USING: rep_puede_gestionar_operacion()
-- POLICY rep_asignaciones_insert (INSERT, roles={public})
--   WITH CHECK: ((shopper_id = rep_mi_id()) OR (rider_id = rep_mi_id()) OR rep_puede_gestionar_operacion())
-- POLICY rep_asignaciones_select (SELECT, roles={public})
--   USING: ((shopper_id = rep_mi_id()) OR (rider_id = rep_mi_id()) OR ((rider_id IS NULL) AND (estado = 'recolectado'::text) AND (EXISTS ( SELECT 1
   FROM rep_repartidores r
  WHERE ((r.user_id = auth.uid()) AND r.activo AND (r.estado_registro = 'aprobado'::text))))) OR rep_puede_gestionar_operacion())
-- POLICY rep_asignaciones_update (UPDATE, roles={public})
--   USING: ((shopper_id = rep_mi_id()) OR (rider_id = rep_mi_id()) OR ((rider_id IS NULL) AND (EXISTS ( SELECT 1
   FROM rep_repartidores r
  WHERE ((r.user_id = auth.uid()) AND r.activo AND (r.estado_registro = 'aprobado'::text))))) OR rep_puede_gestionar_operacion())

-- ---------------------------------------------------------------
-- Tabla: rep_auditoria_cuenta
-- ---------------------------------------------------------------
CREATE TABLE public.rep_auditoria_cuenta (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  repartidor_id uuid NOT NULL,
  accion text NOT NULL,
  motivo text,
  datos jsonb DEFAULT '{}'::jsonb,
  actor uuid DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_auditoria_cuenta ADD CONSTRAINT rep_auditoria_cuenta_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES public.rep_repartidores(id);
CREATE INDEX idx_rep_auditoria_cuenta_rep ON public.rep_auditoria_cuenta USING btree (repartidor_id, created_at DESC);
ALTER TABLE public.rep_auditoria_cuenta ENABLE ROW LEVEL SECURITY;
-- POLICY rep_auditoria_cuenta_select (SELECT, roles={public})
--   USING: rep_is_admin()

-- ---------------------------------------------------------------
-- Tabla: rep_clientes_direcciones
-- ---------------------------------------------------------------
CREATE TABLE public.rep_clientes_direcciones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  telefono character varying(20) NOT NULL,
  nombre_direccion character varying(50) NOT NULL,
  direccion text NOT NULL,
  ciudad character varying(100) NOT NULL DEFAULT 'San Miguel de los Bancos'::character varying,
  referencias text,
  geo_lat numeric(9,6),
  geo_lng numeric(9,6),
  verificada boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_clientes_direcciones ENABLE ROW LEVEL SECURITY;
-- POLICY Permitir a repartidores y admins gestionar direcciones (ALL, roles={authenticated})
--   USING: (EXISTS ( SELECT 1
   FROM rep_roles
  WHERE ((rep_roles.user_id = auth.uid()) AND (rep_roles.rol = ANY (ARRAY['repartidor'::text, 'shopper'::text, 'admin'::text, 'superadmin'::text, 'supervisor'::text])) AND (rep_roles.activo = true))))
--   WITH CHECK: (EXISTS ( SELECT 1
   FROM rep_roles
  WHERE ((rep_roles.user_id = auth.uid()) AND (rep_roles.rol = ANY (ARRAY['repartidor'::text, 'shopper'::text, 'admin'::text, 'superadmin'::text, 'supervisor'::text])) AND (rep_roles.activo = true))))
-- POLICY Permitir lectura a repartidores y admins (SELECT, roles={authenticated})
--   USING: (EXISTS ( SELECT 1
   FROM rep_roles
  WHERE ((rep_roles.user_id = auth.uid()) AND (rep_roles.rol = ANY (ARRAY['repartidor'::text, 'shopper'::text, 'admin'::text, 'superadmin'::text, 'supervisor'::text])) AND (rep_roles.activo = true))))

-- ---------------------------------------------------------------
-- Tabla: rep_comisiones
-- ---------------------------------------------------------------
CREATE TABLE public.rep_comisiones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  repartidor_id uuid NOT NULL,
  tipo text DEFAULT 'fijo'::text,
  valor numeric NOT NULL,
  zona text,
  vigente_desde date DEFAULT CURRENT_DATE,
  vigente_hasta date,
  activa boolean DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_comisiones ADD CONSTRAINT rep_comisiones_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_comisiones ADD CONSTRAINT rep_comisiones_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.null(null);
ALTER TABLE public.rep_comisiones ENABLE ROW LEVEL SECURITY;
-- POLICY rep_comisiones_admin (ALL, roles={public})
--   USING: rep_puede_liquidar_caja()
--   WITH CHECK: rep_puede_liquidar_caja()

-- ---------------------------------------------------------------
-- Tabla: rep_comunicaciones
-- ---------------------------------------------------------------
CREATE TABLE public.rep_comunicaciones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid,
  asignacion_id uuid,
  tipo text NOT NULL,
  canal text NOT NULL DEFAULT 'whatsapp'::text,
  destinatario_telefono text,
  destinatario_rol text,
  mensaje text,
  actor_user_id uuid,
  actor_repartidor_id uuid,
  request_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_comunicaciones ADD CONSTRAINT rep_comunicaciones_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES public.rep_asignaciones(id);
ALTER TABLE public.rep_comunicaciones ADD CONSTRAINT rep_comunicaciones_actor_repartidor_id_fkey FOREIGN KEY (actor_repartidor_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_comunicaciones ADD CONSTRAINT rep_comunicaciones_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
CREATE INDEX idx_rep_comunicaciones_pedido ON public.rep_comunicaciones USING btree (pedido_id, created_at DESC);
CREATE UNIQUE INDEX idx_rep_comunicaciones_request_id ON public.rep_comunicaciones USING btree (request_id) WHERE (request_id IS NOT NULL);
ALTER TABLE public.rep_comunicaciones ENABLE ROW LEVEL SECURITY;
-- POLICY rep_comunicaciones_select (SELECT, roles={authenticated})
--   USING: (rep_is_admin() OR (EXISTS ( SELECT 1
   FROM rep_asignaciones a
  WHERE ((a.pedido_id = rep_comunicaciones.pedido_id) AND ((a.shopper_id = rep_mi_id()) OR (a.rider_id = rep_mi_id()))))))

-- ---------------------------------------------------------------
-- Tabla: rep_conciliacion_eventos
-- ---------------------------------------------------------------
CREATE TABLE public.rep_conciliacion_eventos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  origen text NOT NULL,
  origen_id uuid NOT NULL,
  verificado boolean NOT NULL,
  motivo text,
  actor uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX idx_rep_conciliacion_eventos_origen ON public.rep_conciliacion_eventos USING btree (origen, origen_id, created_at DESC);
ALTER TABLE public.rep_conciliacion_eventos ENABLE ROW LEVEL SECURITY;
-- POLICY conciliacion_eventos_select (SELECT, roles={public})
--   USING: rep_puede_ver_finanzas()

-- ---------------------------------------------------------------
-- Tabla: rep_configuracion
-- ---------------------------------------------------------------
CREATE TABLE public.rep_configuracion (
  clave text NOT NULL,
  valor text NOT NULL,
  descripcion text,
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (clave)
);
ALTER TABLE public.rep_configuracion ENABLE ROW LEVEL SECURITY;
-- POLICY rep_configuracion_select (SELECT, roles={authenticated})
--   USING: true
-- POLICY rep_configuracion_write (ALL, roles={public})
--   USING: rep_puede_administrar_usuarios()
--   WITH CHECK: rep_puede_administrar_usuarios()

-- ---------------------------------------------------------------
-- Tabla: rep_cuentas_cobrar
-- ---------------------------------------------------------------
CREATE TABLE public.rep_cuentas_cobrar (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL,
  asignacion_id uuid,
  repartidor_id uuid NOT NULL,
  monto_pedido numeric NOT NULL,
  monto_cobrado numeric,
  diferencia numeric,
  metodo_pago text,
  estado text DEFAULT 'pendiente'::text,
  cobrado_at timestamp with time zone,
  verificado_por uuid,
  observaciones text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_cuentas_cobrar ADD CONSTRAINT rep_cuentas_cobrar_verificado_por_fkey FOREIGN KEY (verificado_por) REFERENCES public.null(null);
ALTER TABLE public.rep_cuentas_cobrar ADD CONSTRAINT rep_cuentas_cobrar_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.rep_cuentas_cobrar ADD CONSTRAINT rep_cuentas_cobrar_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_cuentas_cobrar ADD CONSTRAINT rep_cuentas_cobrar_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES public.rep_asignaciones(id);
ALTER TABLE public.rep_cuentas_cobrar ENABLE ROW LEVEL SECURITY;
-- POLICY rep_cuentas_cobrar_delete (DELETE, roles={public})
--   USING: rep_puede_liquidar_caja()
-- POLICY rep_cuentas_cobrar_insert (INSERT, roles={public})
--   WITH CHECK: ((repartidor_id = rep_mi_id()) OR rep_puede_liquidar_caja())
-- POLICY rep_cuentas_cobrar_select (SELECT, roles={public})
--   USING: ((repartidor_id = rep_mi_id()) OR rep_puede_liquidar_caja())
-- POLICY rep_cuentas_cobrar_update (UPDATE, roles={public})
--   USING: rep_puede_liquidar_caja()
--   WITH CHECK: rep_puede_liquidar_caja()

-- ---------------------------------------------------------------
-- Tabla: rep_depositos_repartidor
-- ---------------------------------------------------------------
CREATE TABLE public.rep_depositos_repartidor (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  repartidor_id uuid NOT NULL,
  monto numeric(12,2) NOT NULL,
  referencia text,
  comprobante_path text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente'::text,
  motivo_rechazo text,
  registrado_at timestamp with time zone NOT NULL DEFAULT now(),
  revisado_por uuid,
  revisado_at timestamp with time zone,
  request_id uuid,
  liquidacion_id uuid,
  metodo text NOT NULL DEFAULT 'transferencia'::text,
  banco text,
  verificado_banco boolean NOT NULL DEFAULT false,
  verificado_banco_at timestamp with time zone,
  verificado_banco_por uuid,
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_depositos_repartidor ADD CONSTRAINT rep_depositos_repartidor_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES public.rep_repartidores(id);
CREATE UNIQUE INDEX idx_rep_depositos_referencia_unica ON public.rep_depositos_repartidor USING btree (lower(TRIM(BOTH FROM referencia)), COALESCE(lower(TRIM(BOTH FROM banco)), ''::text)) WHERE ((referencia IS NOT NULL) AND (estado <> 'rechazado'::text));
CREATE INDEX idx_rep_depositos_repartidor_estado ON public.rep_depositos_repartidor USING btree (repartidor_id, estado);
CREATE UNIQUE INDEX idx_rep_depositos_request_id ON public.rep_depositos_repartidor USING btree (request_id) WHERE (request_id IS NOT NULL);
ALTER TABLE public.rep_depositos_repartidor ENABLE ROW LEVEL SECURITY;
-- POLICY rep_depositos_select (SELECT, roles={authenticated})
--   USING: ((repartidor_id = rep_mi_id()) OR rep_puede_liquidar_caja())

-- ---------------------------------------------------------------
-- Tabla: rep_entregas
-- ---------------------------------------------------------------
CREATE TABLE public.rep_entregas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  asignacion_id uuid NOT NULL,
  repartidor_id uuid NOT NULL,
  pedido_id uuid NOT NULL,
  foto_url text,
  geo_lat numeric,
  geo_lng numeric,
  firma_cliente text,
  monto_cobrado numeric,
  metodo_pago text,
  salida_at timestamp with time zone,
  entregado_at timestamp with time zone DEFAULT now(),
  tiempo_entrega integer,
  exitosa boolean DEFAULT true,
  motivo_fallo text,
  observaciones text,
  created_at timestamp with time zone DEFAULT now(),
  request_id uuid,
  monto_esperado numeric(12,2),
  nota_diferencia_cobro text,
  comision_tipo_snapshot text,
  comision_valor_snapshot numeric(10,2),
  comision_calculada numeric(12,2),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_entregas ADD CONSTRAINT rep_entregas_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.rep_entregas ADD CONSTRAINT rep_entregas_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_entregas ADD CONSTRAINT rep_entregas_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES public.rep_asignaciones(id);
CREATE INDEX rep_entregas_pedido_exitosa_idx ON public.rep_entregas USING btree (pedido_id, exitosa, entregado_at DESC);
CREATE UNIQUE INDEX rep_entregas_request_uidx ON public.rep_entregas USING btree (request_id) WHERE (request_id IS NOT NULL);
ALTER TABLE public.rep_entregas ENABLE ROW LEVEL SECURITY;
-- POLICY rep_entregas_delete (DELETE, roles={public})
--   USING: rep_puede_gestionar_operacion()
-- POLICY rep_entregas_insert (INSERT, roles={public})
--   WITH CHECK: ((repartidor_id = rep_mi_id()) OR rep_puede_gestionar_operacion())
-- POLICY rep_entregas_select (SELECT, roles={public})
--   USING: ((repartidor_id = rep_mi_id()) OR rep_puede_ver_asignacion(asignacion_id))
-- POLICY rep_entregas_update (UPDATE, roles={public})
--   USING: ((repartidor_id = rep_mi_id()) OR rep_puede_gestionar_operacion())
--   WITH CHECK: ((repartidor_id = rep_mi_id()) OR rep_puede_gestionar_operacion())

-- ---------------------------------------------------------------
-- Tabla: rep_facturas_cliente
-- ---------------------------------------------------------------
CREATE TABLE public.rep_facturas_cliente (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente'::text,
  numero_factura text,
  clave_acceso text,
  ruc_emisor text,
  fecha_emision timestamp with time zone,
  subtotal numeric(12,2),
  iva numeric(12,2),
  total numeric(12,2),
  ride_url text,
  xml_url text,
  observaciones text,
  emitida_por uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_facturas_cliente ADD CONSTRAINT rep_facturas_cliente_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.rep_facturas_cliente ADD CONSTRAINT rep_facturas_cliente_pedido_id_key UNIQUE (pedido_id);
CREATE UNIQUE INDEX rep_facturas_cliente_pedido_id_key ON public.rep_facturas_cliente USING btree (pedido_id);
ALTER TABLE public.rep_facturas_cliente ENABLE ROW LEVEL SECURITY;
-- POLICY facturas_cliente_select (SELECT, roles={public})
--   USING: rep_puede_ver_finanzas()

-- ---------------------------------------------------------------
-- Tabla: rep_facturas_compras
-- ---------------------------------------------------------------
CREATE TABLE public.rep_facturas_compras (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid,
  asignacion_id uuid NOT NULL,
  shopper_id uuid NOT NULL,
  numero_factura character varying(17) NOT NULL,
  monto_total numeric(10,2) NOT NULL,
  monto_iva numeric(10,2) DEFAULT 0.00,
  foto_factura_url text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_facturas_compras ADD CONSTRAINT rep_facturas_compras_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.rep_facturas_compras ADD CONSTRAINT rep_facturas_compras_shopper_id_fkey FOREIGN KEY (shopper_id) REFERENCES public.null(null);
ALTER TABLE public.rep_facturas_compras ENABLE ROW LEVEL SECURITY;
-- POLICY rep_facturas_compras_admin_policy (ALL, roles={authenticated})
--   USING: rep_puede_validar_factura_compra()
--   WITH CHECK: rep_puede_validar_factura_compra()

-- ---------------------------------------------------------------
-- Tabla: rep_gastos
-- ---------------------------------------------------------------
CREATE TABLE public.rep_gastos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL,
  asignacion_id uuid,
  tienda_id uuid,
  monto numeric NOT NULL,
  foto_ticket_url text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_gastos ADD CONSTRAINT rep_gastos_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.rep_gastos ADD CONSTRAINT rep_gastos_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.ol_tiendas(id);
ALTER TABLE public.rep_gastos ADD CONSTRAINT rep_gastos_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES public.rep_asignaciones(id);
ALTER TABLE public.rep_gastos ENABLE ROW LEVEL SECURITY;
-- POLICY rep_gastos_admin (ALL, roles={public})
--   USING: rep_puede_liquidar_caja()
--   WITH CHECK: rep_puede_liquidar_caja()

-- ---------------------------------------------------------------
-- Tabla: rep_handoffs
-- ---------------------------------------------------------------
CREATE TABLE public.rep_handoffs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  asignacion_id uuid NOT NULL,
  shopper_id uuid NOT NULL,
  rider_id uuid,
  token_hash text NOT NULL,
  codigo_visual character varying(8) NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente'::text,
  expires_at timestamp with time zone NOT NULL,
  intentos integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  accepted_at timestamp with time zone,
  shopper_lat numeric,
  shopper_lng numeric,
  rider_lat numeric,
  rider_lng numeric,
  request_id uuid,
  bultos_declarados integer,
  bultos_confirmados integer,
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_handoffs ADD CONSTRAINT rep_handoffs_rider_id_fkey FOREIGN KEY (rider_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_handoffs ADD CONSTRAINT rep_handoffs_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES public.rep_asignaciones(id);
ALTER TABLE public.rep_handoffs ADD CONSTRAINT rep_handoffs_shopper_id_fkey FOREIGN KEY (shopper_id) REFERENCES public.rep_repartidores(id);
CREATE UNIQUE INDEX idx_rep_handoffs_asignacion_pendiente ON public.rep_handoffs USING btree (asignacion_id) WHERE (estado = 'pendiente'::text);
CREATE INDEX idx_rep_handoffs_codigo_visual ON public.rep_handoffs USING btree (codigo_visual) WHERE (estado = 'pendiente'::text);
CREATE UNIQUE INDEX idx_rep_handoffs_request_id ON public.rep_handoffs USING btree (request_id) WHERE (request_id IS NOT NULL);
CREATE UNIQUE INDEX idx_rep_handoffs_token_hash ON public.rep_handoffs USING btree (token_hash);
ALTER TABLE public.rep_handoffs ENABLE ROW LEVEL SECURITY;
-- POLICY rep_handoffs_select (SELECT, roles={authenticated})
--   USING: (rep_puede_gestionar_operacion() OR (shopper_id = rep_mi_id()) OR (rider_id = rep_mi_id()))

-- ---------------------------------------------------------------
-- Tabla: rep_incidencias
-- ---------------------------------------------------------------
CREATE TABLE public.rep_incidencias (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL,
  tipo text NOT NULL,
  severidad text NOT NULL DEFAULT 'media'::text,
  estado text NOT NULL DEFAULT 'abierta'::text,
  descripcion text NOT NULL,
  resolucion text,
  responsable_id uuid,
  creada_por uuid DEFAULT auth.uid(),
  resuelta_por uuid,
  created_at timestamp with time zone DEFAULT now(),
  resuelta_at timestamp with time zone,
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_incidencias ADD CONSTRAINT rep_incidencias_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.rep_incidencias ENABLE ROW LEVEL SECURITY;
-- POLICY incidencias_insert (INSERT, roles={public})
--   WITH CHECK: ((auth.uid() IS NOT NULL) AND (creada_por = auth.uid()))
-- POLICY incidencias_select (SELECT, roles={public})
--   USING: (rep_puede_gestionar_operacion() OR (responsable_id = auth.uid()))
-- POLICY incidencias_update (UPDATE, roles={public})
--   USING: (rep_puede_gestionar_operacion() OR (responsable_id = auth.uid()))
--   WITH CHECK: (rep_puede_gestionar_operacion() OR (responsable_id = auth.uid()))

-- ---------------------------------------------------------------
-- Tabla: rep_ledger_movimientos
-- ---------------------------------------------------------------
CREATE TABLE public.rep_ledger_movimientos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  repartidor_id uuid NOT NULL,
  pedido_id uuid,
  fecha_operacion timestamp with time zone NOT NULL DEFAULT now(),
  cuenta text NOT NULL,
  concepto text NOT NULL,
  debito numeric(12,2) NOT NULL DEFAULT 0,
  credito numeric(12,2) NOT NULL DEFAULT 0,
  descripcion text,
  origen_tipo text NOT NULL,
  origen_id uuid,
  reversa_de uuid,
  creado_por uuid DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_ledger_movimientos ADD CONSTRAINT rep_ledger_movimientos_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_ledger_movimientos ADD CONSTRAINT rep_ledger_movimientos_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.rep_ledger_movimientos ADD CONSTRAINT rep_ledger_movimientos_reversa_de_fkey FOREIGN KEY (reversa_de) REFERENCES public.rep_ledger_movimientos(id);
ALTER TABLE public.rep_ledger_movimientos ADD CONSTRAINT rep_ledger_movimientos_request_id_key UNIQUE (request_id);
CREATE UNIQUE INDEX rep_ledger_movimientos_request_id_key ON public.rep_ledger_movimientos USING btree (request_id);
CREATE INDEX rep_ledger_pedido_idx ON public.rep_ledger_movimientos USING btree (pedido_id) WHERE (pedido_id IS NOT NULL);
CREATE INDEX rep_ledger_rep_fecha_idx ON public.rep_ledger_movimientos USING btree (repartidor_id, fecha_operacion DESC);
ALTER TABLE public.rep_ledger_movimientos ENABLE ROW LEVEL SECURITY;
-- POLICY ledger_select (SELECT, roles={public})
--   USING: ((repartidor_id = rep_mi_id()) OR rep_puede_liquidar_caja())

-- ---------------------------------------------------------------
-- Tabla: rep_liquidacion_items
-- ---------------------------------------------------------------
CREATE TABLE public.rep_liquidacion_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deposito_id uuid NOT NULL,
  entrega_id uuid NOT NULL,
  monto numeric(12,2) NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_liquidacion_items ADD CONSTRAINT rep_liquidacion_items_entrega_id_fkey FOREIGN KEY (entrega_id) REFERENCES public.rep_entregas(id);
ALTER TABLE public.rep_liquidacion_items ADD CONSTRAINT rep_liquidacion_items_deposito_id_fkey FOREIGN KEY (deposito_id) REFERENCES public.rep_depositos_repartidor(id);
ALTER TABLE public.rep_liquidacion_items ADD CONSTRAINT rep_liquidacion_items_entrega_id_key UNIQUE (entrega_id);
CREATE INDEX idx_rep_liquidacion_items_deposito ON public.rep_liquidacion_items USING btree (deposito_id);
CREATE UNIQUE INDEX rep_liquidacion_items_entrega_id_key ON public.rep_liquidacion_items USING btree (entrega_id);
ALTER TABLE public.rep_liquidacion_items ENABLE ROW LEVEL SECURITY;
-- POLICY rep_liquidacion_items_select (SELECT, roles={authenticated})
--   USING: (rep_puede_liquidar_caja() OR (EXISTS ( SELECT 1
   FROM rep_depositos_repartidor d
  WHERE ((d.id = rep_liquidacion_items.deposito_id) AND (d.repartidor_id = rep_mi_id())))))

-- ---------------------------------------------------------------
-- Tabla: rep_liquidaciones
-- ---------------------------------------------------------------
CREATE TABLE public.rep_liquidaciones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  repartidor_id uuid NOT NULL,
  fecha date NOT NULL,
  total_asignados integer DEFAULT 0,
  total_entregados integer DEFAULT 0,
  total_devueltos integer DEFAULT 0,
  total_cobrado numeric DEFAULT 0,
  total_comision numeric DEFAULT 0,
  total_a_entregar numeric DEFAULT 0,
  estado text DEFAULT 'pendiente'::text,
  liquidado_at timestamp with time zone,
  liquidado_por uuid,
  notas text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  metodo_liquidacion character varying(20) DEFAULT 'efectivo'::character varying,
  comprobante_referencia text,
  foto_comprobante_url text,
  recibido_por uuid,
  numero_vale_caja character varying(20),
  monto_recibido numeric(12,2) NOT NULL DEFAULT 0,
  saldo_antes numeric(12,2),
  saldo_despues numeric(12,2),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_liquidaciones ADD CONSTRAINT rep_liquidaciones_liquidado_por_fkey FOREIGN KEY (liquidado_por) REFERENCES public.null(null);
ALTER TABLE public.rep_liquidaciones ADD CONSTRAINT rep_liquidaciones_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_liquidaciones ADD CONSTRAINT rep_liquidaciones_recibido_por_fkey FOREIGN KEY (recibido_por) REFERENCES public.null(null);
ALTER TABLE public.rep_liquidaciones ADD CONSTRAINT rep_liquidaciones_repartidor_id_fecha_key UNIQUE (repartidor_id, fecha);
CREATE UNIQUE INDEX rep_liquidaciones_repartidor_fecha_uidx ON public.rep_liquidaciones USING btree (repartidor_id, fecha);
CREATE UNIQUE INDEX rep_liquidaciones_repartidor_id_fecha_key ON public.rep_liquidaciones USING btree (repartidor_id, fecha);
ALTER TABLE public.rep_liquidaciones ENABLE ROW LEVEL SECURITY;
-- POLICY rep_liquidaciones_delete (DELETE, roles={public})
--   USING: rep_puede_liquidar_caja()
-- POLICY rep_liquidaciones_select (SELECT, roles={public})
--   USING: ((repartidor_id = rep_mi_id()) OR rep_puede_liquidar_caja())
-- POLICY rep_liquidaciones_update (UPDATE, roles={public})
--   USING: rep_puede_liquidar_caja()
--   WITH CHECK: rep_puede_liquidar_caja()
-- POLICY rep_liquidaciones_write (INSERT, roles={public})
--   WITH CHECK: rep_puede_liquidar_caja()

-- ---------------------------------------------------------------
-- Tabla: rep_movimientos_liquidacion
-- ---------------------------------------------------------------
CREATE TABLE public.rep_movimientos_liquidacion (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  liquidacion_id uuid NOT NULL,
  repartidor_id uuid NOT NULL,
  fecha date NOT NULL,
  monto numeric(12,2) NOT NULL,
  saldo_antes numeric(12,2) NOT NULL,
  saldo_despues numeric(12,2) NOT NULL,
  metodo text NOT NULL,
  referencia text,
  foto_url text,
  numero_vale text,
  recibido_por text NOT NULL,
  registrado_por uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  reversado_at timestamp with time zone,
  reversado_por uuid,
  motivo_reverso text,
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_movimientos_liquidacion ADD CONSTRAINT rep_movimientos_liquidacion_liquidacion_id_fkey FOREIGN KEY (liquidacion_id) REFERENCES public.rep_liquidaciones(id);
ALTER TABLE public.rep_movimientos_liquidacion ADD CONSTRAINT rep_movimientos_liquidacion_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_movimientos_liquidacion ADD CONSTRAINT rep_movimientos_liquidacion_request_id_key UNIQUE (request_id);
CREATE INDEX rep_mov_liq_repartidor_fecha_idx ON public.rep_movimientos_liquidacion USING btree (repartidor_id, fecha, created_at DESC);
CREATE UNIQUE INDEX rep_movimientos_liquidacion_request_id_key ON public.rep_movimientos_liquidacion USING btree (request_id);
ALTER TABLE public.rep_movimientos_liquidacion ENABLE ROW LEVEL SECURITY;
-- POLICY rep_mov_liq_select (SELECT, roles={public})
--   USING: ((repartidor_id = rep_mi_id()) OR rep_puede_liquidar_caja())

-- ---------------------------------------------------------------
-- Tabla: rep_notificaciones
-- ---------------------------------------------------------------
CREATE TABLE public.rep_notificaciones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  destinatario_id uuid,
  pedido_id uuid,
  asignacion_id uuid,
  mensaje text NOT NULL,
  leido boolean DEFAULT false,
  leido_at timestamp with time zone,
  enviado_whatsapp boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_notificaciones ADD CONSTRAINT rep_notificaciones_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.rep_notificaciones ADD CONSTRAINT rep_notificaciones_destinatario_id_fkey FOREIGN KEY (destinatario_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_notificaciones ADD CONSTRAINT rep_notificaciones_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES public.rep_asignaciones(id);
ALTER TABLE public.rep_notificaciones ENABLE ROW LEVEL SECURITY;
-- POLICY rep_notificaciones_admin (ALL, roles={public})
--   USING: rep_puede_gestionar_operacion()
--   WITH CHECK: rep_puede_gestionar_operacion()

-- ---------------------------------------------------------------
-- Tabla: rep_pedido_empaque_fotos
-- ---------------------------------------------------------------
CREATE TABLE public.rep_pedido_empaque_fotos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL,
  bulto_numero integer NOT NULL,
  foto_url text NOT NULL,
  subido_por uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  asignacion_id uuid,
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_pedido_empaque_fotos ADD CONSTRAINT rep_pedido_empaque_fotos_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.rep_pedido_empaque_fotos ADD CONSTRAINT rep_pedido_empaque_fotos_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES public.rep_asignaciones(id);
CREATE INDEX idx_rep_pedido_empaque_fotos_asignacion ON public.rep_pedido_empaque_fotos USING btree (asignacion_id);
CREATE INDEX idx_rep_pedido_empaque_fotos_pedido ON public.rep_pedido_empaque_fotos USING btree (pedido_id);
ALTER TABLE public.rep_pedido_empaque_fotos ENABLE ROW LEVEL SECURITY;
-- POLICY rep_pedido_empaque_fotos_select (SELECT, roles={authenticated})
--   USING: (rep_is_admin() OR (EXISTS ( SELECT 1
   FROM rep_asignaciones a
  WHERE ((a.pedido_id = rep_pedido_empaque_fotos.pedido_id) AND ((a.shopper_id = rep_mi_id()) OR (a.rider_id = rep_mi_id()))))))

-- ---------------------------------------------------------------
-- Tabla: rep_pedido_eventos
-- ---------------------------------------------------------------
CREATE TABLE public.rep_pedido_eventos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL,
  asignacion_id uuid,
  tipo text NOT NULL,
  actor_user_id uuid,
  actor_repartidor_id uuid,
  datos jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_pedido_eventos ADD CONSTRAINT rep_pedido_eventos_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.rep_pedido_eventos ADD CONSTRAINT rep_pedido_eventos_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES public.rep_asignaciones(id);
CREATE INDEX idx_rep_pedido_eventos_pedido ON public.rep_pedido_eventos USING btree (pedido_id, created_at DESC);
CREATE UNIQUE INDEX idx_rep_pedido_eventos_request_id ON public.rep_pedido_eventos USING btree (request_id) WHERE (request_id IS NOT NULL);
ALTER TABLE public.rep_pedido_eventos ENABLE ROW LEVEL SECURITY;
-- POLICY rep_pedido_eventos_select (SELECT, roles={authenticated})
--   USING: rep_puede_ver_pedido(pedido_id)

-- ---------------------------------------------------------------
-- Tabla: rep_periodos_pago
-- ---------------------------------------------------------------
CREATE TABLE public.rep_periodos_pago (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  repartidor_id uuid NOT NULL,
  desde date NOT NULL,
  hasta date NOT NULL,
  ganancias numeric(12,2) NOT NULL DEFAULT 0,
  caja_custodia numeric(12,2) NOT NULL DEFAULT 0,
  posicion_neta numeric(12,2) NOT NULL DEFAULT 0,
  monto_compensado numeric(12,2) NOT NULL DEFAULT 0,
  monto_pagar numeric(12,2) NOT NULL DEFAULT 0,
  monto_cobrar numeric(12,2) NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'borrador'::text,
  cerrado_at timestamp with time zone,
  cerrado_por uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  banco_pago text,
  referencia_pago text,
  comprobante_pago_path text,
  pagado_por uuid,
  pagado_at timestamp with time zone,
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_periodos_pago ADD CONSTRAINT rep_periodos_pago_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_periodos_pago ADD CONSTRAINT rep_periodos_pago_repartidor_id_desde_hasta_key UNIQUE (repartidor_id, desde, hasta);
CREATE UNIQUE INDEX rep_periodos_pago_repartidor_id_desde_hasta_key ON public.rep_periodos_pago USING btree (repartidor_id, desde, hasta);
ALTER TABLE public.rep_periodos_pago ENABLE ROW LEVEL SECURITY;
-- POLICY periodos_select (SELECT, roles={public})
--   USING: ((repartidor_id = rep_mi_id()) OR rep_puede_liquidar_caja())

-- ---------------------------------------------------------------
-- Tabla: rep_picking
-- ---------------------------------------------------------------
CREATE TABLE public.rep_picking (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL,
  asignacion_id uuid,
  tienda_id uuid,
  codigo_producto text,
  descripcion text NOT NULL,
  cantidad integer NOT NULL DEFAULT 1,
  precio_ref numeric,
  precio_real numeric,
  estado text DEFAULT 'pendiente'::text,
  sustitucion text,
  foto_url text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_picking ADD CONSTRAINT rep_picking_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.rep_picking ADD CONSTRAINT rep_picking_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.ol_tiendas(id);
ALTER TABLE public.rep_picking ADD CONSTRAINT rep_picking_asignacion_id_fkey FOREIGN KEY (asignacion_id) REFERENCES public.rep_asignaciones(id);
ALTER TABLE public.rep_picking ENABLE ROW LEVEL SECURITY;
-- POLICY rep_picking_delete (DELETE, roles={public})
--   USING: rep_puede_gestionar_operacion()
-- POLICY rep_picking_insert (INSERT, roles={public})
--   WITH CHECK: (rep_puede_ver_asignacion(asignacion_id) OR rep_puede_gestionar_operacion())
-- POLICY rep_picking_select (SELECT, roles={public})
--   USING: (rep_puede_ver_pedido(pedido_id) OR rep_puede_ver_asignacion(asignacion_id))
-- POLICY rep_picking_update (UPDATE, roles={public})
--   USING: (rep_puede_ver_asignacion(asignacion_id) OR rep_puede_gestionar_operacion())
--   WITH CHECK: (rep_puede_ver_asignacion(asignacion_id) OR rep_puede_gestionar_operacion())

-- ---------------------------------------------------------------
-- Tabla: rep_reclamos
-- ---------------------------------------------------------------
CREATE TABLE public.rep_reclamos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  repartidor_id uuid NOT NULL,
  tipo text NOT NULL,
  entrega_id uuid,
  deposito_id uuid,
  mensaje text NOT NULL,
  estado text NOT NULL DEFAULT 'abierto'::text,
  respuesta text,
  resuelto_por uuid,
  resuelto_at timestamp with time zone,
  request_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_reclamos ADD CONSTRAINT rep_reclamos_deposito_id_fkey FOREIGN KEY (deposito_id) REFERENCES public.rep_depositos_repartidor(id);
ALTER TABLE public.rep_reclamos ADD CONSTRAINT rep_reclamos_entrega_id_fkey FOREIGN KEY (entrega_id) REFERENCES public.rep_entregas(id);
ALTER TABLE public.rep_reclamos ADD CONSTRAINT rep_reclamos_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES public.rep_repartidores(id);
CREATE INDEX idx_rep_reclamos_estado ON public.rep_reclamos USING btree (estado, created_at DESC);
CREATE UNIQUE INDEX idx_rep_reclamos_request_id ON public.rep_reclamos USING btree (request_id) WHERE (request_id IS NOT NULL);
ALTER TABLE public.rep_reclamos ENABLE ROW LEVEL SECURITY;
-- POLICY reclamos_select (SELECT, roles={public})
--   USING: ((repartidor_id = rep_mi_id()) OR rep_puede_ver_finanzas())

-- ---------------------------------------------------------------
-- Tabla: rep_repartidores
-- ---------------------------------------------------------------
CREATE TABLE public.rep_repartidores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  codigo text,
  nombre text NOT NULL,
  cedula text,
  telefono text NOT NULL,
  email text,
  foto_url text,
  vehiculo text,
  placa text,
  zona_principal text,
  comision_tipo text DEFAULT 'fijo'::text,
  comision_valor numeric DEFAULT 1.00,
  activo boolean DEFAULT true,
  observaciones text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  estado_registro text DEFAULT 'pendiente'::text,
  motivo_rechazo text,
  fecha_aprobacion timestamp with time zone,
  aprobado_por uuid,
  efectivo_en_mano numeric(10,2) DEFAULT 0.00,
  estado character varying(20) DEFAULT 'ACTIVO'::character varying,
  conectado boolean DEFAULT true,
  gps_lat numeric,
  gps_lng numeric,
  gps_updated_at timestamp with time zone,
  zona_id uuid,
  fondo_caja_chica_diario numeric(10,2),
  motivo_bloqueo text,
  bloqueado_por uuid,
  bloqueado_at timestamp with time zone,
  invite_token text,
  invite_expires_at timestamp with time zone,
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_repartidores ADD CONSTRAINT rep_repartidores_zona_id_fkey FOREIGN KEY (zona_id) REFERENCES public.zonas(id);
ALTER TABLE public.rep_repartidores ADD CONSTRAINT rep_repartidores_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES public.null(null);
ALTER TABLE public.rep_repartidores ADD CONSTRAINT rep_repartidores_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.null(null);
ALTER TABLE public.rep_repartidores ADD CONSTRAINT rep_repartidores_cedula_key UNIQUE (cedula);
ALTER TABLE public.rep_repartidores ADD CONSTRAINT rep_repartidores_codigo_key UNIQUE (codigo);
CREATE UNIQUE INDEX idx_rep_repartidores_invite_token ON public.rep_repartidores USING btree (invite_token) WHERE (invite_token IS NOT NULL);
CREATE UNIQUE INDEX rep_repartidores_cedula_key ON public.rep_repartidores USING btree (cedula);
CREATE UNIQUE INDEX rep_repartidores_codigo_key ON public.rep_repartidores USING btree (codigo);
ALTER TABLE public.rep_repartidores ENABLE ROW LEVEL SECURITY;
-- POLICY rep_repartidores_delete (DELETE, roles={public})
--   USING: rep_puede_administrar_usuarios()
-- POLICY rep_repartidores_insert (INSERT, roles={public})
--   WITH CHECK: ((user_id = auth.uid()) OR rep_puede_gestionar_operacion())
-- POLICY rep_repartidores_select (SELECT, roles={public})
--   USING: ((user_id = auth.uid()) OR rep_puede_gestionar_operacion())
-- POLICY rep_repartidores_update (UPDATE, roles={public})
--   USING: ((user_id = auth.uid()) OR rep_puede_gestionar_operacion())
--   WITH CHECK: ((user_id = auth.uid()) OR rep_puede_gestionar_operacion())

-- ---------------------------------------------------------------
-- Tabla: rep_repartidores_tiendas
-- ---------------------------------------------------------------
CREATE TABLE public.rep_repartidores_tiendas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  repartidor_id uuid NOT NULL,
  tienda_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_repartidores_tiendas ADD CONSTRAINT rep_repartidores_tiendas_tienda_id_fkey FOREIGN KEY (tienda_id) REFERENCES public.ol_tiendas(id);
ALTER TABLE public.rep_repartidores_tiendas ADD CONSTRAINT rep_repartidores_tiendas_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_repartidores_tiendas ADD CONSTRAINT rep_repartidores_tiendas_repartidor_id_tienda_id_key UNIQUE (repartidor_id, tienda_id);
CREATE INDEX idx_rep_repartidores_tiendas_repartidor ON public.rep_repartidores_tiendas USING btree (repartidor_id);
CREATE UNIQUE INDEX rep_repartidores_tiendas_repartidor_id_tienda_id_key ON public.rep_repartidores_tiendas USING btree (repartidor_id, tienda_id);
ALTER TABLE public.rep_repartidores_tiendas ENABLE ROW LEVEL SECURITY;
-- POLICY rep_repartidores_tiendas_delete (DELETE, roles={authenticated})
--   USING: rep_is_admin()
-- POLICY rep_repartidores_tiendas_insert (INSERT, roles={authenticated})
--   WITH CHECK: rep_is_admin()
-- POLICY rep_repartidores_tiendas_select (SELECT, roles={authenticated})
--   USING: (rep_is_admin() OR (repartidor_id = rep_mi_id()))

-- ---------------------------------------------------------------
-- Tabla: rep_roles
-- ---------------------------------------------------------------
CREATE TABLE public.rep_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rol text NOT NULL,
  activo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_roles ADD CONSTRAINT rep_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.null(null);
ALTER TABLE public.rep_roles ADD CONSTRAINT rep_roles_user_id_key UNIQUE (user_id);
CREATE UNIQUE INDEX rep_roles_user_id_key ON public.rep_roles USING btree (user_id);
ALTER TABLE public.rep_roles ENABLE ROW LEVEL SECURITY;
-- POLICY rep_roles_delete (DELETE, roles={public})
--   USING: rep_puede_administrar_usuarios()
-- POLICY rep_roles_insert (INSERT, roles={public})
--   WITH CHECK: (((user_id = auth.uid()) AND (rol = 'repartidor'::text)) OR rep_puede_administrar_usuarios())
-- POLICY rep_roles_select (SELECT, roles={public})
--   USING: ((user_id = auth.uid()) OR rep_puede_administrar_usuarios())
-- POLICY rep_roles_update (UPDATE, roles={public})
--   USING: (((user_id = auth.uid()) AND (rol = 'repartidor'::text)) OR rep_puede_administrar_usuarios())
--   WITH CHECK: (((user_id = auth.uid()) AND (rol = 'repartidor'::text)) OR rep_puede_administrar_usuarios())

-- ---------------------------------------------------------------
-- Tabla: rep_transacciones_caja
-- ---------------------------------------------------------------
CREATE TABLE public.rep_transacciones_caja (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  repartidor_id uuid NOT NULL,
  pedido_id uuid,
  tipo character varying(30) NOT NULL,
  monto numeric(10,2) NOT NULL,
  comprobante_url text,
  created_at timestamp with time zone DEFAULT now(),
  estado character varying(20) DEFAULT 'pendiente'::character varying,
  fondo_origen text,
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_transacciones_caja ADD CONSTRAINT rep_transacciones_caja_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_transacciones_caja ADD CONSTRAINT rep_transacciones_caja_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.ol_pedidos(id);
ALTER TABLE public.rep_transacciones_caja ENABLE ROW LEVEL SECURITY;
-- POLICY Permitir acceso total a administradores (ALL, roles={public})
--   USING: (auth.uid() IN ( SELECT rep_roles.user_id
   FROM rep_roles
  WHERE (rep_roles.rol = ANY (ARRAY['superadmin'::text, 'admin'::text, 'supervisor'::text]))))
-- POLICY Permitir inserción a repartidores de sus transacciones (INSERT, roles={public})
--   WITH CHECK: (auth.uid() IN ( SELECT rep_repartidores.user_id
   FROM rep_repartidores
  WHERE (rep_repartidores.id = rep_transacciones_caja.repartidor_id)))
-- POLICY Permitir lectura a repartidores de sus transacciones (SELECT, roles={public})
--   USING: (auth.uid() IN ( SELECT rep_repartidores.user_id
   FROM rep_repartidores
  WHERE (rep_repartidores.id = rep_transacciones_caja.repartidor_id)))
-- POLICY rep_transacciones_caja_delete (DELETE, roles={public})
--   USING: rep_puede_liquidar_caja()
-- POLICY rep_transacciones_caja_insert (INSERT, roles={public})
--   WITH CHECK: ((repartidor_id = rep_mi_id()) OR rep_puede_liquidar_caja())
-- POLICY rep_transacciones_caja_select (SELECT, roles={public})
--   USING: ((repartidor_id = rep_mi_id()) OR rep_puede_liquidar_caja())
-- POLICY rep_transacciones_caja_update (UPDATE, roles={public})
--   USING: rep_puede_liquidar_caja()
--   WITH CHECK: rep_puede_liquidar_caja()

-- ---------------------------------------------------------------
-- Tabla: rep_traspasos_efectivo
-- ---------------------------------------------------------------
CREATE TABLE public.rep_traspasos_efectivo (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  repartidor_origen_id uuid NOT NULL,
  repartidor_destino_id uuid NOT NULL,
  monto numeric(10,2) NOT NULL,
  notas text,
  registrado_por uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  request_id uuid,
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_traspasos_efectivo ADD CONSTRAINT rep_traspasos_efectivo_repartidor_origen_id_fkey FOREIGN KEY (repartidor_origen_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_traspasos_efectivo ADD CONSTRAINT rep_traspasos_efectivo_repartidor_destino_id_fkey FOREIGN KEY (repartidor_destino_id) REFERENCES public.rep_repartidores(id);
CREATE UNIQUE INDEX rep_traspasos_request_uidx ON public.rep_traspasos_efectivo USING btree (request_id) WHERE (request_id IS NOT NULL);
ALTER TABLE public.rep_traspasos_efectivo ENABLE ROW LEVEL SECURITY;
-- POLICY rep_traspasos_efectivo_driver_admin_policy (ALL, roles={authenticated})
--   USING: ((repartidor_origen_id = rep_mi_id()) OR (repartidor_destino_id = rep_mi_id()) OR rep_puede_liquidar_caja())
--   WITH CHECK: ((repartidor_origen_id = rep_mi_id()) OR (repartidor_destino_id = rep_mi_id()) OR rep_puede_liquidar_caja())
-- POLICY rep_traspasos_select (SELECT, roles={authenticated})
--   USING: ((repartidor_origen_id = rep_mi_id()) OR (repartidor_destino_id = rep_mi_id()) OR rep_puede_liquidar_caja())

-- ---------------------------------------------------------------
-- Tabla: rep_turnos
-- ---------------------------------------------------------------
CREATE TABLE public.rep_turnos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  repartidor_id uuid NOT NULL,
  fecha date NOT NULL,
  hora_inicio time without time zone,
  hora_fin time without time zone,
  estado text DEFAULT 'programado'::text,
  observaciones text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);
ALTER TABLE public.rep_turnos ADD CONSTRAINT rep_turnos_repartidor_id_fkey FOREIGN KEY (repartidor_id) REFERENCES public.rep_repartidores(id);
ALTER TABLE public.rep_turnos ADD CONSTRAINT rep_turnos_repartidor_id_fecha_key UNIQUE (repartidor_id, fecha);
CREATE UNIQUE INDEX rep_turnos_repartidor_id_fecha_key ON public.rep_turnos USING btree (repartidor_id, fecha);
ALTER TABLE public.rep_turnos ENABLE ROW LEVEL SECURITY;
-- POLICY rep_turnos_admin (ALL, roles={public})
--   USING: rep_puede_gestionar_operacion()
--   WITH CHECK: rep_puede_gestionar_operacion()

-- ---------------------------------------------------------------
-- Tabla: rotacion_inventario
-- ---------------------------------------------------------------
CREATE TABLE public.rotacion_inventario (
  ruc text NOT NULL,
  codigo text NOT NULL,
  descripcion text,
  categoria text,
  marca text,
  stock numeric(14,2) DEFAULT 0,
  stock_minimo numeric(14,2) DEFAULT 0,
  costo_unitario numeric(14,2) DEFAULT 0,
  valor_stock numeric(14,2) DEFAULT 0,
  venta_30d numeric(14,2) DEFAULT 0,
  transacciones_30d integer DEFAULT 0,
  dias_stock integer DEFAULT 9999,
  dias_sin_venta integer,
  ultima_venta date,
  estado text,
  PRIMARY KEY (ruc, codigo)
);
ALTER TABLE public.rotacion_inventario ENABLE ROW LEVEL SECURITY;
-- POLICY rotacion_inventario_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: stock_critico
-- ---------------------------------------------------------------
CREATE TABLE public.stock_critico (
  id integer NOT NULL DEFAULT nextval('stock_critico_id_seq'::regclass),
  ruc text,
  codigo text,
  descripcion text,
  categoria text,
  stock_actual numeric(12,2) DEFAULT 0,
  stock_minimo numeric(12,2) DEFAULT 0,
  valor_inventario numeric(12,2) DEFAULT 0,
  ultima_venta date,
  PRIMARY KEY (id)
);
ALTER TABLE public.stock_critico ADD CONSTRAINT stock_critico_ruc_codigo_key UNIQUE (ruc, codigo);
CREATE UNIQUE INDEX stock_critico_ruc_codigo_key ON public.stock_critico USING btree (ruc, codigo);
ALTER TABLE public.stock_critico ENABLE ROW LEVEL SECURITY;
-- POLICY stock_critico_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: top_productos
-- ---------------------------------------------------------------
CREATE TABLE public.top_productos (
  id integer NOT NULL DEFAULT nextval('top_productos_id_seq'::regclass),
  ruc text,
  codigo text,
  descripcion text,
  categoria text,
  total_venta numeric(12,2) DEFAULT 0,
  cantidad integer DEFAULT 0,
  PRIMARY KEY (id)
);
ALTER TABLE public.top_productos ADD CONSTRAINT top_productos_ruc_codigo_key UNIQUE (ruc, codigo);
CREATE UNIQUE INDEX top_productos_ruc_codigo_key ON public.top_productos USING btree (ruc, codigo);
ALTER TABLE public.top_productos ENABLE ROW LEVEL SECURITY;
-- POLICY top_productos_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: ultima_sincronizacion
-- ---------------------------------------------------------------
CREATE TABLE public.ultima_sincronizacion (
  id integer NOT NULL DEFAULT 1,
  ejecutado_en timestamp without time zone DEFAULT now(),
  duracion_seg numeric(8,2),
  estado text,
  detalle text,
  PRIMARY KEY (id)
);
ALTER TABLE public.ultima_sincronizacion ENABLE ROW LEVEL SECURITY;
-- POLICY ultima_sincronizacion_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: ventas_por_categoria
-- ---------------------------------------------------------------
CREATE TABLE public.ventas_por_categoria (
  id integer NOT NULL DEFAULT nextval('ventas_por_categoria_id_seq'::regclass),
  ruc text,
  ano integer,
  mes integer,
  categoria text,
  total numeric(12,2) DEFAULT 0,
  cantidad integer DEFAULT 0,
  PRIMARY KEY (id)
);
ALTER TABLE public.ventas_por_categoria ADD CONSTRAINT ventas_por_categoria_ruc_ano_mes_categoria_key UNIQUE (ruc, ano, mes, categoria);
CREATE UNIQUE INDEX ventas_por_categoria_ruc_ano_mes_categoria_key ON public.ventas_por_categoria USING btree (ruc, ano, mes, categoria);
ALTER TABLE public.ventas_por_categoria ENABLE ROW LEVEL SECURITY;
-- POLICY ventas_por_categoria_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: ventas_por_dia
-- ---------------------------------------------------------------
CREATE TABLE public.ventas_por_dia (
  id integer NOT NULL DEFAULT nextval('ventas_por_dia_id_seq'::regclass),
  ruc text,
  fecha date,
  total numeric(12,2) DEFAULT 0,
  cantidad integer DEFAULT 0,
  factura numeric(14,2) DEFAULT 0,
  pedido numeric(14,2) DEFAULT 0,
  PRIMARY KEY (id)
);
ALTER TABLE public.ventas_por_dia ADD CONSTRAINT ventas_por_dia_ruc_fecha_key UNIQUE (ruc, fecha);
CREATE UNIQUE INDEX ventas_por_dia_ruc_fecha_key ON public.ventas_por_dia USING btree (ruc, fecha);
ALTER TABLE public.ventas_por_dia ENABLE ROW LEVEL SECURITY;
-- POLICY solo_admin_ventas_por_dia (ALL, roles={authenticated})
--   USING: rep_puede_ver_finanzas()

-- ---------------------------------------------------------------
-- Tabla: ventas_por_hora
-- ---------------------------------------------------------------
CREATE TABLE public.ventas_por_hora (
  id integer NOT NULL DEFAULT nextval('ventas_por_hora_id_seq'::regclass),
  ruc text,
  fecha date,
  hora integer,
  total numeric(12,2) DEFAULT 0,
  PRIMARY KEY (id)
);
ALTER TABLE public.ventas_por_hora ADD CONSTRAINT ventas_por_hora_ruc_fecha_hora_key UNIQUE (ruc, fecha, hora);
CREATE UNIQUE INDEX ventas_por_hora_ruc_fecha_hora_key ON public.ventas_por_hora USING btree (ruc, fecha, hora);
ALTER TABLE public.ventas_por_hora ENABLE ROW LEVEL SECURITY;
-- POLICY ventas_por_hora_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: ventas_por_mes
-- ---------------------------------------------------------------
CREATE TABLE public.ventas_por_mes (
  id integer NOT NULL DEFAULT nextval('ventas_por_mes_id_seq'::regclass),
  ruc text,
  ano integer,
  mes integer,
  total numeric(12,2) DEFAULT 0,
  cantidad integer DEFAULT 0,
  PRIMARY KEY (id)
);
ALTER TABLE public.ventas_por_mes ADD CONSTRAINT ventas_por_mes_ruc_ano_mes_key UNIQUE (ruc, ano, mes);
CREATE UNIQUE INDEX ventas_por_mes_ruc_ano_mes_key ON public.ventas_por_mes USING btree (ruc, ano, mes);
ALTER TABLE public.ventas_por_mes ENABLE ROW LEVEL SECURITY;
-- POLICY ventas_por_mes_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: ventas_por_vendedor
-- ---------------------------------------------------------------
CREATE TABLE public.ventas_por_vendedor (
  id integer NOT NULL DEFAULT nextval('ventas_por_vendedor_id_seq'::regclass),
  ruc text,
  ano integer,
  mes integer,
  vendedor text,
  total numeric(12,2) DEFAULT 0,
  cantidad integer DEFAULT 0,
  factura numeric(14,2) DEFAULT 0,
  pedido numeric(14,2) DEFAULT 0,
  PRIMARY KEY (id)
);
ALTER TABLE public.ventas_por_vendedor ADD CONSTRAINT ventas_por_vendedor_ruc_ano_mes_vendedor_key UNIQUE (ruc, ano, mes, vendedor);
CREATE UNIQUE INDEX ventas_por_vendedor_ruc_ano_mes_vendedor_key ON public.ventas_por_vendedor USING btree (ruc, ano, mes, vendedor);
ALTER TABLE public.ventas_por_vendedor ENABLE ROW LEVEL SECURITY;
-- POLICY ventas_por_vendedor_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: ventas_yoy
-- ---------------------------------------------------------------
CREATE TABLE public.ventas_yoy (
  id integer NOT NULL DEFAULT nextval('ventas_yoy_id_seq'::regclass),
  ruc text,
  ano integer,
  mes integer,
  venta_actual numeric(12,2) DEFAULT 0,
  venta_anterior numeric(12,2) DEFAULT 0,
  crecimiento_pct numeric(8,2) DEFAULT 0,
  PRIMARY KEY (id)
);
ALTER TABLE public.ventas_yoy ADD CONSTRAINT ventas_yoy_ruc_ano_mes_key UNIQUE (ruc, ano, mes);
CREATE UNIQUE INDEX ventas_yoy_ruc_ano_mes_key ON public.ventas_yoy USING btree (ruc, ano, mes);
ALTER TABLE public.ventas_yoy ENABLE ROW LEVEL SECURITY;
-- POLICY ventas_yoy_lectura_autenticados (SELECT, roles={authenticated})
--   USING: true

-- ---------------------------------------------------------------
-- Tabla: zonas
-- ---------------------------------------------------------------
CREATE TABLE public.zonas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  alias text[] NOT NULL DEFAULT '{}'::text[],
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  tarifa_base numeric(6,2) NOT NULL DEFAULT 1.50,
  costo_por_km numeric(6,2) NOT NULL DEFAULT 0.30,
  piso_minimo numeric(6,2) NOT NULL DEFAULT 1.50,
  techo_maximo numeric(6,2),
  cargo_por_tienda_adicional numeric(10,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
);
ALTER TABLE public.zonas ADD CONSTRAINT zonas_nombre_key UNIQUE (nombre);
CREATE UNIQUE INDEX zonas_nombre_key ON public.zonas USING btree (nombre);
ALTER TABLE public.zonas ENABLE ROW LEVEL SECURITY;
-- POLICY zonas_admin (ALL, roles={authenticated})
--   USING: rep_puede_administrar_usuarios()
--   WITH CHECK: rep_puede_administrar_usuarios()
-- POLICY zonas_select (SELECT, roles={anon,authenticated})
--   USING: true

-- ============================================================
-- FUNCIONES (esquema public) -- solo firma, no cuerpo. El cuerpo
-- vive en el migration_*.sql correspondiente dentro de
-- lib/supabase/ (convencion del repo: no se mantiene una carpeta
-- supabase/migrations/ viva, solo el historial de archivos sueltos).
-- ============================================================

-- [SECURITY DEFINER] aceptar_pedido_shopper(p_pedido_id uuid, p_request_id uuid, p_tienda_id uuid) RETURNS rep_asignaciones  [plpgsql]
-- [SECURITY DEFINER] aceptar_traspaso_rider(p_token text, p_request_id uuid, p_lat numeric, p_lng numeric, p_bultos_recibidos integer) RETURNS rep_handoffs  [plpgsql]
-- [SECURITY DEFINER] actualizar_factura_compra_sri_admin(p_id uuid, p_estado text, p_fecha timestamp with time zone, p_xml text, p_hash text, p_emisor text, p_comprador text, p_subtotal numeric, p_iva numeric, p_total numeric, p_ambiente text, p_diferencias jsonb) RETURNS ol_pedidos_comprobantes_proveedor  [plpgsql]
-- [SECURITY DEFINER] admin_conciliacion_bancaria() RETURNS TABLE(origen text, id uuid, monto numeric, fecha timestamp with time zone, banco text, referencia text, detalle text, verificado boolean)  [plpgsql]
-- [SECURITY DEFINER] admin_depositos_verificacion_atrasada() RETURNS TABLE(id uuid, repartidor_nombre text, monto numeric, banco text, referencia text, confirmado_at timestamp with time zone, dias_atraso numeric)  [plpgsql]
-- [SECURITY DEFINER] admin_estados_cuenta() RETURNS SETOF rep_estado_cuenta  [plpgsql]
-- [SECURITY DEFINER] admin_gastos_por_fondo(p_desde date, p_hasta date) RETURNS TABLE(fondo_origen text, total_gastado numeric, cantidad_compras bigint)  [plpgsql]
-- [SECURITY DEFINER] admin_reclamos_abiertos() RETURNS TABLE(id uuid, repartidor_id uuid, repartidor_nombre text, tipo text, mensaje text, created_at timestamp with time zone)  [plpgsql]
-- [SECURITY DEFINER] bloquear_repartidor_admin(p_repartidor_id uuid, p_motivo text) RETURNS rep_repartidores  [plpgsql]
-- [SECURITY DEFINER] cancelar_traspaso_shopper(p_handoff_id uuid) RETURNS rep_handoffs  [plpgsql]
-- [SECURITY DEFINER] cerrar_periodo_colaborador(p_repartidor_id uuid, p_desde date, p_hasta date) RETURNS rep_periodos_pago  [plpgsql]
-- [SECURITY DEFINER] cliente_tiene_historial(p_telefono text) RETURNS boolean  [sql]
-- [SECURITY DEFINER] conciliar_caja_repartidor(p_repartidor_id uuid, p_monto_recibido numeric, p_admin_id uuid, p_notas text) RETURNS void  [plpgsql]
-- [SECURITY DEFINER] confirmar_deposito_repartidor(p_deposito_id uuid, p_recibido_por text) RETURNS rep_depositos_repartidor  [plpgsql]
-- [SECURITY DEFINER] confirmar_pago_admin(p_pedido_id uuid, p_referencia text, p_monto numeric, p_banco text, p_fecha date, p_evidencia_path text, p_motivo_diferencia text, p_request_id uuid) RETURNS ol_pedidos  [plpgsql]
-- [SECURITY DEFINER] crear_deposito_repartidor(p_monto numeric, p_referencia text, p_comprobante_path text, p_request_id uuid, p_metodo text, p_banco text, p_entrega_ids uuid[]) RETURNS rep_depositos_repartidor  [plpgsql]
-- [SECURITY DEFINER] crear_reclamo(p_tipo text, p_mensaje text, p_entrega_id uuid, p_deposito_id uuid, p_request_id uuid) RETURNS rep_reclamos  [plpgsql]
-- [SECURITY DEFINER] crear_traspaso_shopper(p_asignacion_id uuid, p_lat numeric, p_lng numeric, p_bultos integer) RETURNS TABLE(handoff_id uuid, token text, codigo_visual text, expires_at timestamp with time zone)  [plpgsql]
-- [SECURITY DEFINER] desbloquear_repartidor_admin(p_repartidor_id uuid, p_motivo text) RETURNS rep_repartidores  [plpgsql]
-- [SECURITY DEFINER] finalizar_compra_shopper(p_asignacion_id uuid, p_request_id uuid) RETURNS rep_asignaciones  [plpgsql]
-- [SECURITY DEFINER] finalizar_entrega_atomica(p_request_id uuid, p_asignacion_id uuid, p_monto numeric, p_metodo text, p_lat numeric, p_lng numeric, p_foto_url text, p_firma_url text, p_referencias text, p_nota_diferencia text) RETURNS rep_entregas  [plpgsql]
-- [SECURITY DEFINER] finalizar_entrega_atomica(p_request_id uuid, p_asignacion_id uuid, p_monto numeric, p_metodo text, p_lat numeric, p_lng numeric, p_foto_url text, p_firma_url text, p_referencias text, p_nota_diferencia text, p_direccion_corregida boolean) RETURNS rep_entregas  [plpgsql]
-- [SECURITY DEFINER] generar_invitacion_repartidor(p_repartidor_id uuid) RETURNS text  [plpgsql]
-- [SECURITY DEFINER] guardar_costo_envio_pedido(p_pedido_id uuid, p_costo_envio numeric) RETURNS numeric  [plpgsql]
-- [SECURITY DEFINER] historial_conciliacion(p_origen text, p_id uuid) RETURNS SETOF rep_conciliacion_eventos  [plpgsql]
-- [SECURITY DEFINER] iniciar_compra_shopper(p_asignacion_id uuid, p_request_id uuid) RETURNS rep_asignaciones  [plpgsql]
-- [SECURITY DEFINER] iniciar_ruta_repartidor(p_asignacion_id uuid, p_request_id uuid, p_lat numeric, p_lng numeric) RETURNS rep_asignaciones  [plpgsql]
-- [SECURITY DEFINER] liquidar_repartidor_admin(p_request_id uuid, p_repartidor_id uuid, p_fecha date, p_monto_recibido numeric, p_metodo text, p_recibido_por text, p_referencia text, p_foto_url text, p_numero_vale text) RETURNS TABLE(liquidacion_id uuid, movimiento_id uuid, saldo_antes numeric, saldo_despues numeric)  [plpgsql]
-- [SECURITY DEFINER] marcar_verificado_banco(p_origen text, p_id uuid, p_verificado boolean, p_motivo text) RETURNS void  [plpgsql]
-- [SECURITY DEFINER] mi_comision_pendiente() RETURNS numeric  [plpgsql]
-- [SECURITY DEFINER] mi_estado_cuenta() RETURNS SETOF rep_estado_cuenta  [sql]
-- [SECURITY DEFINER] mi_fondo_caja_chica_hoy() RETURNS TABLE(fondo_diario numeric, gastado_hoy numeric, disponible numeric)  [plpgsql]
-- [SECURITY DEFINER] mis_reclamos() RETURNS SETOF rep_reclamos  [sql]
-- [SECURITY DEFINER] rechazar_deposito_repartidor(p_deposito_id uuid, p_motivo text) RETURNS rep_depositos_repartidor  [plpgsql]
-- [SECURITY DEFINER] reclamar_invitacion(p_token text) RETURNS TABLE(repartidor_id uuid, nombre text, rol_otorgado text)  [plpgsql]
-- [SECURITY DEFINER] registrar_busqueda_fallida(termino text) RETURNS void  [sql]
-- [SECURITY DEFINER] registrar_comunicacion(p_pedido_id uuid, p_tipo text, p_mensaje text, p_asignacion_id uuid, p_canal text, p_destinatario_telefono text, p_destinatario_rol text, p_request_id uuid) RETURNS rep_comunicaciones  [plpgsql]
-- [SECURITY DEFINER] registrar_entrega_fallida_atomica(p_request_id uuid, p_asignacion_id uuid, p_motivo text, p_lat numeric, p_lng numeric) RETURNS rep_entregas  [plpgsql]
-- [SECURITY DEFINER] registrar_evento_pedido(p_pedido_id uuid, p_asignacion_id uuid, p_tipo text, p_actor_user_id uuid, p_actor_repartidor_id uuid, p_datos jsonb, p_request_id uuid) RETURNS void  [plpgsql]
-- [SECURITY DEFINER] registrar_factura_cliente(p_pedido_id uuid, p_numero text, p_clave text, p_ride_url text, p_xml_url text, p_observaciones text) RETURNS rep_facturas_cliente  [plpgsql]
-- [SECURITY DEFINER] registrar_factura_compra_servidor(p_asignacion_id uuid, p_actor_user_id uuid, p_actor_repartidor_id uuid, p_tienda_id uuid, p_prov_ruc text, p_prov_establecimiento text, p_prov_punto_emision text, p_prov_secuencial text, p_monto_digitado numeric, p_metodo_pago text, p_foto_path text, p_clave_acceso text, p_sri_estado text, p_sri_fecha_autorizacion timestamp with time zone, p_sri_xml text, p_sri_sha256 text, p_sri_razon_social_emisor text, p_sri_identificacion_comprador text, p_sri_subtotal numeric, p_sri_iva numeric, p_sri_total numeric, p_sri_ambiente text, p_conciliacion_estado text, p_conciliacion_diferencias jsonb, p_request_id uuid, p_tipo_comprobante text, p_motivo_excepcion text, p_sri_mensaje_error text) RETURNS ol_pedidos_comprobantes_proveedor  [plpgsql]
-- [SECURITY DEFINER] registrar_foto_empaque(p_pedido_id uuid, p_bulto_numero integer, p_foto_path text, p_asignacion_id uuid, p_request_id uuid) RETURNS rep_pedido_empaque_fotos  [plpgsql]
-- [SECURITY DEFINER] registrar_pago_periodo(p_periodo_id uuid, p_banco text, p_referencia text, p_comprobante_path text, p_request_id uuid) RETURNS rep_periodos_pago  [plpgsql]
-- rep_direcciones_similares(p_dir1 text, p_dir2 text) RETURNS boolean  [plpgsql]
-- [SECURITY DEFINER] rep_is_admin() RETURNS boolean  [sql]
-- [SECURITY DEFINER] rep_mi_id() RETURNS uuid  [sql]
-- [SECURITY DEFINER] rep_puede_administrar_usuarios() RETURNS boolean  [sql]
-- [SECURITY DEFINER] rep_puede_confirmar_pago() RETURNS boolean  [sql]
-- [SECURITY DEFINER] rep_puede_gestionar_operacion() RETURNS boolean  [sql]
-- [SECURITY DEFINER] rep_puede_liquidar_caja() RETURNS boolean  [sql]
-- [SECURITY DEFINER] rep_puede_validar_factura_compra() RETURNS boolean  [sql]
-- [SECURITY DEFINER] rep_puede_ver_asignacion(p_asignacion_id uuid) RETURNS boolean  [sql]
-- [SECURITY DEFINER] rep_puede_ver_finanzas() RETURNS boolean  [sql]
-- [SECURITY DEFINER] rep_puede_ver_pedido(p_pedido_id uuid) RETURNS boolean  [sql]
-- [SECURITY DEFINER] rep_tiene_efectivo_vencido(p_repartidor_id uuid) RETURNS boolean  [sql]
-- [SECURITY DEFINER] rep_tiene_rol(VARIADIC roles text[]) RETURNS boolean  [sql]
-- [SECURITY DEFINER] resolver_reclamo(p_reclamo_id uuid, p_respuesta text) RETURNS rep_reclamos  [plpgsql]
-- [SECURITY DEFINER] reversar_movimiento_liquidacion(p_movimiento_id uuid, p_motivo text) RETURNS numeric  [plpgsql]
-- [SECURITY DEFINER] revertir_pago_admin(p_pedido_id uuid, p_motivo text, p_request_id uuid) RETURNS ol_pedidos  [plpgsql]
-- [SECURITY DEFINER] revisar_factura_compra(p_comprobante_id uuid, p_estado text, p_motivo text, p_request_id uuid) RETURNS ol_pedidos_comprobantes_proveedor  [plpgsql]
-- [SECURITY DEFINER] seguimiento_pedido_publico(p_id uuid) RETURNS json  [sql]
-- [SECURITY DEFINER] sincronizar_facturas_pendientes() RETURNS integer  [plpgsql]
-- [SECURITY DEFINER] sincronizar_ledger_financiero() RETURNS jsonb  [plpgsql]
-- [SECURITY DEFINER] tiendas_hermanas_pedido(p_pedido_id uuid) RETURNS TABLE(asignacion_id uuid, tienda_id uuid, tienda_nombre text, estado text)  [plpgsql]
-- [SECURITY DEFINER] transferir_efectivo_repartidor(p_origen_id uuid, p_destino_id uuid, p_monto numeric, p_notas text, p_request_id uuid) RETURNS void  [plpgsql]
-- trg_acumular_efectivo_entrega() RETURNS trigger  [plpgsql]
-- [SECURITY DEFINER] trg_asignar_zona_pedido() RETURNS trigger  [plpgsql]
-- [SECURITY DEFINER] trg_bloquear_entrega_directa() RETURNS trigger  [plpgsql]
-- [SECURITY DEFINER] trg_crear_factura_venta_pendiente() RETURNS trigger  [plpgsql]
-- trg_evaluar_bloqueo_repartidor() RETURNS trigger  [plpgsql]
-- trg_evitar_factura_compra_duplicada() RETURNS trigger  [plpgsql]
-- [SECURITY DEFINER] zona_desde_ciudad(p_ciudad text) RETURNS uuid  [sql]
