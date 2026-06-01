export type Rol = 'superadmin' | 'admin' | 'supervisor' | 'repartidor' | 'contador'

export interface RepRepartidor {
  id:             string
  user_id:        string | null
  codigo:         string | null
  nombre:         string
  cedula:         string | null
  telefono:       string
  email:          string | null
  foto_url:       string | null
  vehiculo:       string | null
  placa:          string | null
  zona_principal: string | null
  comision_tipo:  'fijo' | 'porcentaje'
  comision_valor: number
  activo:         boolean
  observaciones:  string | null
  created_at:     string
  updated_at:     string
}

export interface OlPedido {
  id:             string
  numero:         number
  nombre_cliente: string
  telefono:       string
  email_cliente:  string | null
  direccion:      string | null
  ciudad:         string
  referencias:    string | null
  notas:          string | null
  estado:         string
  total:          number
  total_items:    number
  geo_lat:        number | null
  geo_lng:        number | null
  created_at:     string
}

export interface RepAsignacion {
  id:             string
  pedido_id:      string
  repartidor_id:  string
  asignado_por:   string | null
  asignado_at:    string
  estado:         'asignado' | 'recolectado' | 'en_ruta' | 'entregado' | 'devuelto' | 'cancelado'
  prioridad:      number
  notas:          string | null
  updated_at:     string
  // joins
  pedido?:        OlPedido
  repartidor?:    RepRepartidor
}

export interface RepEntrega {
  id:             string
  asignacion_id:  string
  repartidor_id:  string
  pedido_id:      string
  foto_url:       string | null
  geo_lat:        number | null
  geo_lng:        number | null
  firma_cliente:  string | null
  monto_cobrado:  number | null
  metodo_pago:    string | null
  salida_at:      string | null
  entregado_at:   string
  tiempo_entrega: number | null
  exitosa:        boolean
  motivo_fallo:   string | null
  observaciones:  string | null
  created_at:     string
}

export interface RepLiquidacion {
  id:               string
  repartidor_id:    string
  fecha:            string
  total_asignados:  number
  total_entregados: number
  total_devueltos:  number
  total_cobrado:    number
  total_comision:   number
  total_a_entregar: number
  estado:           'pendiente' | 'revisado' | 'liquidado' | 'con_diferencia'
  liquidado_at:     string | null
  liquidado_por:    string | null
  notas:            string | null
  created_at:       string
  updated_at:       string
  // join
  repartidor?:      RepRepartidor
}

export interface RepTurno {
  id:            string
  repartidor_id: string
  fecha:         string
  hora_inicio:   string | null
  hora_fin:      string | null
  estado:        'programado' | 'activo' | 'terminado' | 'ausente' | 'justificado'
  observaciones: string | null
  created_at:    string
}
