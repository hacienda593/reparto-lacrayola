'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, CheckCircle2, MapPin, Phone, Navigation } from 'lucide-react'

export default function EntregaPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const sb     = createClient()

  const [pedido,    setPedido]    = useState<any>(null)
  const [cargando,  setCargando]  = useState(true)
  const [entregado, setEntregado] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [monto,     setMonto]     = useState('')
  const [error,     setError]     = useState('')

  useEffect(() => { cargar() }, [id])

  async function cargar() {
    const { data: asig } = await sb.from('rep_asignaciones').select('*').eq('id', id).single()
    if (!asig) { router.replace('/pedidos'); return }
    const { data: ped } = await sb.from('ol_pedidos').select('*').eq('id', asig.pedido_id).single()
    setPedido({ ...ped, repartidor_id: asig.repartidor_id })
    setCargando(false)
  }

  function abrirMapa() {
    const q = pedido?.geo_lat && pedido?.geo_lng
      ? `${pedido.geo_lat},${pedido.geo_lng}`
      : encodeURIComponent(`${pedido?.direccion ?? ''} ${pedido?.ciudad ?? ''}`)
    window.open(`https://maps.google.com/?q=${q}`, '_blank')
  }

  async function confirmarEntrega() {
    if (!monto.trim() || isNaN(parseFloat(monto))) { setError('Ingresa el monto cobrado'); return }
    setGuardando(true); setError('')
    const geo = await new Promise<{ lat: number; lng: number } | null>(res =>
      navigator.geolocation?.getCurrentPosition(
        p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => res(null), { timeout: 5000 }
      )
    )
    await sb.from('rep_asignaciones').update({ estado: 'entregado', updated_at: new Date().toISOString() }).eq('id', id)
    await sb.from('ol_pedidos').update({ estado: 'entregado' }).eq('id', pedido.id)
    await sb.from('rep_entregas').insert({
      asignacion_id: id, repartidor_id: pedido.repartidor_id, pedido_id: pedido.id,
      entregado_at: new Date().toISOString(), monto_cobrado: parseFloat(monto),
      metodo_pago: 'efectivo', exitosa: true,
      geo_lat: geo?.lat ?? null, geo_lng: geo?.lng ?? null,
    })
    setEntregado(true); setGuardando(false)
  }

  if (cargando) return (
    <div className="min-h-screen bg-[#0c0f12] flex items-center justify-center">
      <Loader2 size={28} className="animate-spin text-[#00b074]" />
    </div>
  )

  if (entregado) return (
    <div className="min-h-screen bg-[#0c0f12] flex flex-col items-center justify-center px-6 text-center space-y-5">
      <div className="w-24 h-24 bg-[#00b074]/20 rounded-full flex items-center justify-center">
        <CheckCircle2 size={48} className="text-[#00b074]" />
      </div>
      <h1 className="text-white font-bold text-2xl">¡Entregado!</h1>
      <p className="text-gray-400 text-sm">Pedido #{String(pedido?.numero ?? 0).padStart(4,'0')} completado.</p>
      <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl px-5 py-4 w-full text-left space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Cobrado</span>
          <span className="text-[#00b074] font-bold">${parseFloat(monto).toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Total pedido</span>
          <span className="text-white">${(pedido?.total ?? 0).toFixed(2)}</span>
        </div>
      </div>
      <button onClick={() => router.push('/pedidos')}
        className="w-full bg-[#00b074] text-white font-bold py-4 rounded-2xl">
        Volver a pedidos
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#0c0f12] pb-36">
      <div className="bg-[#181d24] border-b border-[#2d3748] px-4 pt-10 pb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400 text-xl">←</button>
          <div>
            <p className="text-white font-bold">Pedido #{String(pedido?.numero ?? 0).padStart(4,'0')}</p>
            <p className="text-[#ff9f1c] text-xs font-semibold">🚚 En ruta</p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-5 space-y-4">
        <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-4 space-y-3">
          <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Datos de entrega</p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#2d3748] rounded-2xl flex items-center justify-center text-white font-bold">
              {pedido?.nombre_cliente?.[0] ?? '?'}
            </div>
            <div>
              <p className="text-white font-semibold">{pedido?.nombre_cliente}</p>
              <a href={`tel:${pedido?.telefono}`} className="flex items-center gap-1 text-[#00b074] text-xs font-semibold">
                <Phone size={11} /> {pedido?.telefono}
              </a>
            </div>
          </div>
          {pedido?.direccion && (
            <div className="flex items-start gap-2 bg-[#0c0f12] rounded-2xl px-3 py-2.5">
              <MapPin size={14} className="text-[#00b074] shrink-0 mt-0.5" />
              <div>
                <p className="text-white text-sm">{pedido.direccion}, {pedido.ciudad}</p>
                {pedido.referencias && <p className="text-gray-500 text-xs mt-0.5">{pedido.referencias}</p>}
              </div>
            </div>
          )}
          <button onClick={abrirMapa}
            className="w-full bg-[#00b074]/10 border border-[#00b074]/30 text-[#00b074] font-semibold py-3 rounded-2xl flex items-center justify-center gap-2 text-sm">
            <Navigation size={16} /> Abrir en Google Maps
          </button>
        </div>

        <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-4 space-y-3">
          <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Confirmar cobro</p>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Total del pedido</span>
            <span className="text-white font-bold">${(pedido?.total ?? 0).toFixed(2)}</span>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Monto cobrado en efectivo</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">$</span>
              <input type="number" step="0.01" min="0" value={monto}
                onChange={e => setMonto(e.target.value)}
                placeholder={(pedido?.total ?? 0).toFixed(2)}
                className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-2xl pl-8 pr-4 py-3 text-sm focus:outline-none focus:border-[#00b074]"
              />
            </div>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 px-4 pb-6 pt-3 bg-gradient-to-t from-[#0c0f12] to-transparent">
        <button onClick={confirmarEntrega} disabled={guardando}
          className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-60 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 text-base shadow-lg shadow-[#00b074]/30">
          {guardando ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
          {guardando ? 'Registrando...' : '✅ Confirmar entrega'}
        </button>
      </div>
    </div>
  )
}
