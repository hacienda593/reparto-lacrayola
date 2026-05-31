import { createClient } from '@/lib/supabase/server'
import { logout } from '@/actions/auth'
import Link from 'next/link'

export default async function PedidosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: repartidor } = await supabase
    .from('rep_repartidores').select('id, nombre').eq('user_id', user!.id).single()

  const { data: asignaciones } = await supabase
    .from('rep_asignaciones').select('id, estado, prioridad, pedido_id')
    .eq('repartidor_id', repartidor?.id ?? '').in('estado', ['asignado', 'en_ruta'])
    .order('prioridad', { ascending: true })

  const ids = asignaciones?.map((a: any) => a.pedido_id) ?? []
  const { data: pedidos } = ids.length > 0
    ? await supabase.from('ol_pedidos').select('*').in('id', ids) : { data: [] }
  const pm = Object.fromEntries((pedidos ?? []).map((p: any) => [p.id, p]))
  const ini = repartidor?.nombre?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'

  return (
    <div className="min-h-screen bg-[#0c0f12] pb-24">
      <div className="bg-[#181d24] border-b border-[#2d3748] px-4 pt-10 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#00b074] rounded-2xl flex items-center justify-center text-white font-bold text-sm">{ini}</div>
            <div>
              <p className="text-white font-bold text-sm">{repartidor?.nombre ?? 'Repartidor'}</p>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-[#00b074] rounded-full animate-pulse" />
                <span className="text-[#00b074] text-xs font-semibold">Turno activo</span>
              </div>
            </div>
          </div>
          <form action={logout}>
            <button className="text-gray-500 text-xs border border-[#2d3748] px-3 py-1.5 rounded-xl">Salir</button>
          </form>
        </div>
      </div>

      <div className="px-4 pt-5">
        <h2 className="text-white font-bold text-lg mb-4">
          Pedidos asignados
          <span className="ml-2 text-xs font-normal text-gray-500 bg-[#181d24] px-2 py-0.5 rounded-full border border-[#2d3748]">
            {asignaciones?.length ?? 0}
          </span>
        </h2>

        {(!asignaciones || asignaciones.length === 0) && (
          <div className="text-center py-24 space-y-3">
            <div className="text-6xl">📭</div>
            <p className="text-gray-400 font-semibold">Sin pedidos asignados</p>
            <p className="text-gray-600 text-sm">El admin te asignará pedidos pronto</p>
          </div>
        )}

        <div className="space-y-3">
          {asignaciones?.map((a: any) => {
            const p = pm[a.pedido_id]
            const enRuta = a.estado === 'en_ruta'
            return (
              <Link key={a.id} href={`/picking/${a.id}`}>
                <div className={`bg-[#181d24] border rounded-3xl p-4 space-y-3 active:scale-[0.98] transition
                  ${enRuta ? 'border-[#ff9f1c]/40' : 'border-[#2d3748]'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-bold">#{String(p?.numero ?? 0).padStart(4,'0')}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${enRuta ? 'bg-[#ff9f1c]/20 text-[#ff9f1c]' : 'bg-[#00b074]/20 text-[#00b074]'}`}>
                        {enRuta ? '🚚 En ruta' : '📋 Pendiente'}
                      </span>
                    </div>
                    <span className="text-[#00b074] font-bold">${(p?.total ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-[#2d3748] rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0">
                      {p?.nombre_cliente?.[0] ?? '?'}
                    </div>
                    <div>
                      <p className="text-white text-sm font-semibold">{p?.nombre_cliente ?? '—'}</p>
                      <p className="text-gray-500 text-xs">{p?.telefono ?? '—'}</p>
                    </div>
                  </div>
                  {p?.direccion && (
                    <div className="flex items-start gap-2 bg-[#0c0f12] rounded-2xl px-3 py-2">
                      <span className="text-[#00b074] mt-0.5">📍</span>
                      <p className="text-gray-300 text-xs">{p.direccion}, {p.ciudad}</p>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1 border-t border-[#2d3748]">
                    <span className="text-gray-500 text-xs">📦 {p?.total_items ?? '?'} productos</span>
                    <span className="text-[#00b074] text-xs font-semibold">{enRuta ? 'Ver progreso →' : 'Iniciar →'}</span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
