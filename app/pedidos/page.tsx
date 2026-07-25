import { createClient } from '@/lib/supabase/server'
import { logout } from '@/actions/auth'
import { redirect } from 'next/navigation'
import PedidosClient from './PedidosClient'

export default async function PedidosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // 1. Obtener rol desde rep_roles
  const { data: rolData } = await supabase
    .from('rep_roles')
    .select('rol, activo')
    .eq('user_id', user.id)
    .single()

  const rol = rolData?.activo ? rolData.rol : null

  // Si es un rol administrativo, redirigir a /asignaciones
  const rolesAdmin = ['superadmin', 'admin', 'supervisor', 'contador']
  if (rol && rolesAdmin.includes(rol)) {
    redirect('/asignaciones')
  }

  const { data: repartidor } = await supabase
    .from('rep_repartidores')
    .select('id, nombre, email, comision_tipo, comision_valor, estado_registro, activo, vehiculo, efectivo_en_mano')
    .eq('user_id', user.id).single()

  if (!repartidor || repartidor.estado_registro !== 'aprobado' || !repartidor.activo) {
    redirect('/')
  }

  const { data: asignaciones } = await supabase
    .from('rep_asignaciones').select('id, estado, prioridad, pedido_id')
    .eq('repartidor_id', repartidor?.id ?? '').in('estado', ['asignado', 'en_ruta'])
    .order('prioridad', { ascending: true })

  const ids = asignaciones?.map((a: any) => a.pedido_id) ?? []
  const { data: pedidos } = ids.length > 0
    ? await supabase.from('ol_pedidos').select('*').in('id', ids) : { data: [] }

  const pm = Object.fromEntries((pedidos ?? []).map((p: any) => [p.id, p]))

  // Tienda(s) real(es) de cada pedido (un pedido puede combinar Tuti + Tia + La Crayola
  // en el mismo viaje, ya que estan a pocos metros de distancia)
  const { data: picking } = ids.length > 0
    ? await supabase.from('rep_picking').select('pedido_id, ol_tiendas(nombre)').in('pedido_id', ids)
    : { data: [] }

  const tiendasPorPedido: Record<string, string> = {}
  ;(picking ?? []).forEach((row: any) => {
    const nombre = row.ol_tiendas?.nombre
    if (!nombre) return
    const actuales = tiendasPorPedido[row.pedido_id]
      ? tiendasPorPedido[row.pedido_id].split(' + ')
      : []
    if (!actuales.includes(nombre)) {
      actuales.push(nombre)
      tiendasPorPedido[row.pedido_id] = actuales.join(' + ')
    }
  })

  return (
    <PedidosClient
      repartidor={repartidor}
      asignaciones={asignaciones ?? []}
      pedidoMap={pm}
      tiendasPorPedido={tiendasPorPedido}
    />
  )
}
