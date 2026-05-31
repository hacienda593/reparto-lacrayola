import { createClient } from '@/lib/supabase/server'
import { logout } from '@/actions/auth'
import PedidosClient from './PedidosClient'

export default async function PedidosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: repartidor } = await supabase
    .from('rep_repartidores')
    .select('id, nombre, comision_tipo, comision_valor')
    .eq('user_id', user!.id).single()

  const { data: asignaciones } = await supabase
    .from('rep_asignaciones').select('id, estado, prioridad, pedido_id')
    .eq('repartidor_id', repartidor?.id ?? '').in('estado', ['asignado', 'en_ruta'])
    .order('prioridad', { ascending: true })

  const ids = asignaciones?.map((a: any) => a.pedido_id) ?? []
  const { data: pedidos } = ids.length > 0
    ? await supabase.from('ol_pedidos').select('*').in('id', ids) : { data: [] }

  const pm = Object.fromEntries((pedidos ?? []).map((p: any) => [p.id, p]))

  return (
    <PedidosClient
      repartidor={repartidor}
      asignaciones={asignaciones ?? []}
      pedidoMap={pm}
    />
  )
}
