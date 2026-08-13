'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { logout } from '@/actions/auth'
import { createClient } from '@/lib/supabase/client'
import { ArrowRightLeft, Navigation, X, Loader2 } from 'lucide-react'

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

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

function distanciaAprox(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = a.lat - b.lat
  const dLng = a.lng - b.lng
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

export default function PedidosClient({ repartidor, asignaciones, pedidoMap, tiendasPorPedido }: {
  repartidor: any; asignaciones: any[]; pedidoMap: Record<string, any>; tiendasPorPedido: Record<string, string>
}) {
  const router = useRouter()
  const sb = createClient()
  const [gps, setGps] = useState<{lat:number;lng:number}|null>(null)

  // Traspaso de efectivo en mano a otro colaborador
  const [showTraspaso, setShowTraspaso] = useState(false)
  const [colegas, setColegas] = useState<{ id: string; nombre: string }[]>([])
  const [destinoTraspaso, setDestinoTraspaso] = useState('')
  const [montoTraspaso, setMontoTraspaso] = useState('')
  const [notasTraspaso, setNotasTraspaso] = useState('')
  const [procesandoTraspaso, setProcesandoTraspaso] = useState(false)
  const [errorTraspaso, setErrorTraspaso] = useState('')

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      p => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}
    )
  }, [])

  async function abrirTraspaso() {
    setErrorTraspaso('')
    setMontoTraspaso('')
    setNotasTraspaso('')
    setDestinoTraspaso('')
    setShowTraspaso(true)
    const { data } = await sb
      .from('rep_repartidores')
      .select('id, nombre')
      .eq('activo', true)
      .neq('id', repartidor?.id ?? '')
      .order('nombre')
    setColegas(data ?? [])
  }

  async function confirmarTraspaso() {
    if (!repartidor) return
    const monto = parseFloat(montoTraspaso)
    if (!destinoTraspaso) { setErrorTraspaso('Selecciona a quién le entregas el efectivo'); return }
    if (!montoTraspaso.trim() || isNaN(monto) || monto <= 0) { setErrorTraspaso('Ingresa un monto válido'); return }
    if (monto > (repartidor.efectivo_en_mano ?? 0)) { setErrorTraspaso('No puedes entregar más de lo que tienes en mano'); return }

    setProcesandoTraspaso(true)
    setErrorTraspaso('')
    const { error } = await sb.rpc('transferir_efectivo_repartidor', {
      p_origen_id: repartidor.id,
      p_destino_id: destinoTraspaso,
      p_monto: monto,
      p_notas: notasTraspaso.trim() || null,
      p_request_id: crypto.randomUUID(),
    })
    setProcesandoTraspaso(false)

    if (error) { setErrorTraspaso(error.message); return }

    setShowTraspaso(false)
    router.refresh()
  }

  // Ruta combinada: ordena las entregas 'en_ruta' por cercanía y abre Google Maps con paradas intermedias
  function abrirRutaCombinada() {
    const paradas = asignaciones
      .filter(a => a.estado === 'en_ruta')
      .map(a => pedidoMap[a.pedido_id])
      .filter(p => p?.geo_lat && p?.geo_lng)
    if (paradas.length === 0) return

    if (typeof window === 'undefined' || !navigator?.geolocation) {
      abrirRutaDesdePunto(null, paradas)
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => abrirRutaDesdePunto({ lat: pos.coords.latitude, lng: pos.coords.longitude }, paradas),
      () => abrirRutaDesdePunto(null, paradas),
      { timeout: 6000 }
    )
  }

  function abrirRutaDesdePunto(origenGeo: { lat: number; lng: number } | null, paradas: any[]) {
    const restantes = [...paradas]
    const ordenadas: any[] = []
    let puntoActual = origenGeo

    while (restantes.length > 0) {
      if (!puntoActual) {
        ordenadas.push(...restantes)
        break
      }
      restantes.sort((a, b) =>
        distanciaAprox(puntoActual!, { lat: a.geo_lat, lng: a.geo_lng }) -
        distanciaAprox(puntoActual!, { lat: b.geo_lat, lng: b.geo_lng })
      )
      const siguiente = restantes.shift()
      ordenadas.push(siguiente)
      puntoActual = { lat: siguiente.geo_lat, lng: siguiente.geo_lng }
    }

    const destino = ordenadas[ordenadas.length - 1]
    const intermedias = ordenadas.slice(0, -1)

    const params = new URLSearchParams({
      api: '1',
      destination: `${destino.geo_lat},${destino.geo_lng}`,
      travelmode: 'driving',
    })
    if (origenGeo) params.set('origin', `${origenGeo.lat},${origenGeo.lng}`)
    if (intermedias.length > 0) {
      params.set('waypoints', intermedias.map(p => `${p.geo_lat},${p.geo_lng}`).join('|'))
    }
    window.open(`https://www.google.com/maps/dir/?${params.toString()}`, '_blank')
  }

  const ini = repartidor?.nombre?.split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase() ?? '?'
  const paradasEnRuta = asignaciones.filter(a => {
    const p = pedidoMap[a.pedido_id]
    return a.estado === 'en_ruta' && p?.geo_lat && p?.geo_lng
  })

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

        <button
          type="button"
          onClick={abrirTraspaso}
          className="mt-3 flex items-center gap-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/25 text-yellow-300 rounded-xl px-3 py-1.5 text-xs font-semibold transition cursor-pointer"
        >
          💰 Caja: {fmt(repartidor?.efectivo_en_mano ?? 0)}
          <ArrowRightLeft size={11} className="text-yellow-300/80" />
        </button>
      </div>

      {/* Ruta combinada */}
      {paradasEnRuta.length > 1 && (
        <div className="px-4 pt-4">
          <button
            onClick={abrirRutaCombinada}
            className="w-full flex items-center justify-center gap-2 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 text-orange-400 font-bold py-3 rounded-2xl text-sm transition cursor-pointer"
          >
            <Navigation size={15} />
            Ver ruta combinada ({paradasEnRuta.length} paradas)
          </button>
        </div>
      )}

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

            const yaPagado = p?.metodo_pago === 'transferencia' && p?.pago_confirmado === true

            return (
              <div key={a.id} className={`bg-[#181d24] border rounded-3xl overflow-hidden
                ${enRuta ? 'border-[#ff9f1c]/40' : 'border-[#2d3748]'}`}>

                {/* Tienda origen */}
                <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[#2d3748]/60">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${enRuta ? 'bg-[#ff9f1c]' : 'bg-[#00b074]'}`} />
                    <span className="text-white font-bold text-sm">{tiendasPorPedido[a.pedido_id] || 'Tienda por confirmar'}</span>
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
                    {enRuta && (
                      <span className={`text-[9px] font-bold px-2 py-1 rounded-full shrink-0 ${
                        yaPagado ? 'bg-[#00b074]/15 text-[#00b074]' : 'bg-yellow-500/15 text-yellow-400'
                      }`}>
                        {yaPagado ? 'Pagado' : 'Cobrar efectivo'}
                      </span>
                    )}
                  </div>

                  {p?.notas && (
                    <div className="bg-[#ff9f1c]/10 border border-[#ff9f1c]/20 rounded-xl px-3 py-2 text-xs text-[#ff9f1c]">
                      📝 {p.notas}
                    </div>
                  )}

                  {/* Botón aceptar */}
                  <button onClick={() => router.push(enRuta ? `/entrega/${a.id}` : `/picking/${a.id}`)}
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

      {/* Modal: Entregar efectivo en mano a un colega */}
      {showTraspaso && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-[#181d24] border border-[#2d3748] rounded-t-3xl sm:rounded-3xl p-5 w-full sm:max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-white text-base flex items-center gap-1.5">
                <ArrowRightLeft size={16} className="text-[#00b074]" /> Entregar efectivo
              </h3>
              <button onClick={() => setShowTraspaso(false)} className="text-gray-500 p-1 cursor-pointer"><X size={18} /></button>
            </div>

            <div className="bg-[#0c0f12] border border-[#2d3748] rounded-xl px-3 py-2.5 text-xs text-gray-400">
              Tienes <span className="font-black text-white">{fmt(repartidor?.efectivo_en_mano ?? 0)}</span> en mano.
              Registra a quién se lo entregas físicamente (otro colaborador, no la oficina).
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">¿A quién se lo entregas?</label>
              <select
                value={destinoTraspaso}
                onChange={e => setDestinoTraspaso(e.target.value)}
                className="w-full mt-1 bg-[#0c0f12] border border-[#2d3748] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#00b074]"
              >
                <option value="">-- Selecciona --</option>
                {colegas.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Monto a entregar</label>
              <div className="relative mt-1">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#00b074] font-bold text-sm">$</span>
                <input
                  type="number" step="0.01" min="0"
                  value={montoTraspaso}
                  onChange={e => setMontoTraspaso(e.target.value)}
                  placeholder={(repartidor?.efectivo_en_mano ?? 0).toFixed(2)}
                  className="w-full bg-[#0c0f12] border border-[#2d3748] rounded-lg pl-7 pr-3 py-2.5 text-sm font-bold text-white focus:outline-none focus:border-[#00b074]"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Notas (opcional)</label>
              <input
                type="text"
                value={notasTraspaso}
                onChange={e => setNotasTraspaso(e.target.value)}
                placeholder="Ej: entregado en caja de Tuti"
                className="w-full mt-1 bg-[#0c0f12] border border-[#2d3748] rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-[#00b074]"
              />
            </div>

            {errorTraspaso && <p className="text-red-400 text-xs text-center">{errorTraspaso}</p>}

            <button
              onClick={confirmarTraspaso}
              disabled={procesandoTraspaso}
              className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              {procesandoTraspaso ? <Loader2 size={16} className="animate-spin" /> : <ArrowRightLeft size={15} />}
              {procesandoTraspaso ? 'Registrando...' : 'Confirmar entrega de efectivo'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
