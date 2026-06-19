'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { logout } from '@/actions/auth'

const TIENDA_LAT = -0.0641
const TIENDA_LNG = -78.9654

function distKm(la1: number, lo1: number, la2: number, lo2: number) {
  const R = 6371, dL = (la2-la1)*Math.PI/180, dO = (lo2-lo1)*Math.PI/180
  const a = Math.sin(dL/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dO/2)**2
  return (R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))).toFixed(1)
}

function estPicking(items: number) {
  const m = Math.max(5, items * 3)
  return m < 60 ? `${m} min` : `${Math.floor(m/60)}h ${m%60}m`
}

export default function PedidosClient({ repartidor, asignaciones, pedidoMap }: {
  repartidor: any; asignaciones: any[]; pedidoMap: Record<string, any>
}) {
  const router = useRouter()
  const [gps, setGps] = useState<{lat:number;lng:number}|null>(null)

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      p => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}
    )
  }, [])

  const ini = repartidor?.nombre?.split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase() ?? '?'

  return (
    <div className="min-h-screen bg-[#0c0f12] pb-8">
      <div className="bg-[#181d24] border-b border-[#2d3748] px-4 pt-10 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#00b074] rounded-2xl flex items-center justify-center text-white font-bold text-sm">{ini}</div>
            <div>
              <p className="text-white font-bold text-sm">{repartidor?.nombre ?? 'Repartidor'}</p>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-[#00b074] rounded-full animate-pulse" />
                <span className="text-[#00b074] text-xs font-semibold">Shift Activo</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push('/repartidor')}
              className="text-[#00b074] text-xs border border-[#00b074]/30 bg-[#00b074]/10 px-3 py-1.5 rounded-xl font-bold active:scale-95 transition-all cursor-pointer"
            >
              🧺 Auto-Asignación
            </button>
            <form action={logout}>
              <button className="text-gray-500 text-xs border border-[#2d3748] px-3 py-1.5 rounded-xl cursor-pointer">Salir</button>
            </form>
          </div>
        </div>
      </div>

      <div className="px-4 pt-5">
        <p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-4">
          Pedidos asignados ({asignaciones.length})
        </p>

        {asignaciones.length === 0 && (
          <div className="text-center py-16 space-y-4">
            <div className="text-6xl">📭</div>
            <div>
              <p className="text-gray-400 font-bold text-sm">Sin pedidos asignados</p>
              <p className="text-gray-600 text-xs mt-0.5">Puedes auto-asignarte pedidos libres en la cola general.</p>
            </div>
            <button
              onClick={() => router.push('/repartidor')}
              className="bg-[#00b074] hover:bg-[#008f5d] text-white font-bold px-6 py-3.5 rounded-2xl text-xs transition active:scale-95 shadow-md shadow-[#00b074]/20 cursor-pointer"
            >
              🧺 Ver Cola General (Auto-Asignación)
            </button>
          </div>
        )}

        <div className="space-y-4">
          {asignaciones.map((a: any) => {
            const p       = pedidoMap[a.pedido_id]
            const enRuta  = a.estado === 'en_ruta'
            const items   = p?.total_items ?? 1
            const total   = p?.total ?? 0
            const comision = repartidor?.comision_tipo === 'porcentaje'
              ? total * (repartidor.comision_valor ?? 5) / 100
              : (repartidor?.comision_valor ?? 1)
            const dist = p?.geo_lat && p?.geo_lng
              ? gps
                ? `${distKm(gps.lat, gps.lng, p.geo_lat, p.geo_lng)} km desde ti`
                : `~${distKm(TIENDA_LAT, TIENDA_LNG, p.geo_lat, p.geo_lng)} km`
              : p?.ciudad ?? 'Los Bancos'

            return (
              <div key={a.id} className={`bg-[#181d24] border rounded-3xl overflow-hidden
                ${enRuta ? 'border-[#ff9f1c]/40' : 'border-[#2d3748]'}`}>

                {/* Tienda origen */}
                <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[#2d3748]/60">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${enRuta ? 'bg-[#ff9f1c]' : 'bg-[#00b074]'}`} />
                    <span className="text-white font-bold text-sm">La Crayola · Librería</span>
                  </div>
                  <span className="text-[#00b074] font-extrabold text-lg">${total.toFixed(2)}</span>
                </div>

                <div className="px-4 py-3 space-y-3">
                  {/* Métricas */}
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { icon: '📦', val: `${items} productos`, sub: 'a recolectar' },
                      { icon: '⏱',  val: estPicking(items),   sub: 'Est. picking' },
                      { icon: '📍', val: dist,                 sub: 'distancia entrega' },
                      { icon: '💵', val: `+$${comision.toFixed(2)}`, sub: 'tu comisión', green: true },
                    ].map(({ icon, val, sub, green }) => (
                      <div key={sub} className="flex items-center gap-2 bg-[#0c0f12] rounded-xl px-3 py-2">
                        <span className="text-base">{icon}</span>
                        <div>
                          <p className={`text-xs font-semibold ${green ? 'text-[#00b074]' : 'text-white'}`}>{val}</p>
                          <p className="text-gray-600 text-[10px]">{sub}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Cliente */}
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-[#2d3748] rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0">
                      {p?.nombre_cliente?.[0] ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold truncate">{p?.nombre_cliente ?? '—'}</p>
                      {p?.direccion && <p className="text-gray-500 text-xs truncate">{p.direccion}, {p.ciudad}</p>}
                    </div>
                  </div>

                  {p?.notas && (
                    <div className="bg-[#ff9f1c]/10 border border-[#ff9f1c]/20 rounded-xl px-3 py-2 text-xs text-[#ff9f1c]">
                      📝 {p.notas}
                    </div>
                  )}

                  {/* Botón aceptar */}
                  <button onClick={() => router.push(`/picking/${a.id}`)}
                    className={`w-full font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 text-sm active:scale-95 transition
                      ${enRuta ? 'bg-[#ff9f1c] text-white' : 'bg-[#00b074] hover:bg-[#008f5d] text-white'}`}>
                    {enRuta ? '🚚 Continuar en ruta' : '✅ Aceptar y empezar compra'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
