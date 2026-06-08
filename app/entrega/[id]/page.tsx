'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, CheckCircle2, MapPin, Phone, Navigation, Package } from 'lucide-react'

export default function EntregaPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const sb     = createClient()

  const [pedido,     setPedido]     = useState<any>(null)
  const [items,      setItems]      = useState<any[]>([])
  const [cargando,   setCargando]   = useState(true)
  const [entregado,  setEntregado]  = useState(false)
  const [guardando,  setGuardando]  = useState(false)
  const [monto,      setMonto]      = useState('')
  const [error,      setError]      = useState('')
  const [mapUrl,     setMapUrl]     = useState('')

  useEffect(() => { cargar() }, [id])

  async function cargar() {
    const { data: asig } = await sb.from('rep_asignaciones').select('*').eq('id', id).single()
    if (!asig) { router.replace('/pedidos'); return }
    const { data: ped }  = await sb.from('ol_pedidos').select('*').eq('id', asig.pedido_id).single()
    const { data: its }  = await sb.from('ol_pedido_items').select('*').eq('pedido_id', asig.pedido_id)
    setPedido({ ...ped, repartidor_id: asig.repartidor_id })
    setItems(its ?? [])
    setMonto((ped?.total ?? 0).toFixed(2))
    // URL del mapa estático
    const q = ped?.geo_lat && ped?.geo_lng
      ? `${ped.geo_lat},${ped.geo_lng}`
      : encodeURIComponent(`${ped?.direccion ?? ''} ${ped?.ciudad ?? ''}`)
    setMapUrl(`https://maps.google.com/maps?q=${q}&z=16&output=embed`)
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
      <div className="w-28 h-28 bg-[#00b074]/20 border-2 border-[#00b074]/40 rounded-full flex items-center justify-center">
        <CheckCircle2 size={52} className="text-[#00b074]" />
      </div>
      <div>
        <h1 className="text-white font-bold text-2xl">¡Entrega Completada!</h1>
        <p className="text-gray-400 text-sm mt-1">
          El pedido de <span className="text-white">{pedido?.nombre_cliente}</span> fue entregado con éxito.
        </p>
      </div>
      <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl px-5 py-4 w-full text-left space-y-3">
        <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Resumen del Pedido</p>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Items Recolectados</span>
          <span className="text-white font-semibold">{items.filter((i: any) => i.picking_completado).length} items</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Total cobrado</span>
          <span className="text-white font-semibold">${parseFloat(monto).toFixed(2)}</span>
        </div>
        <div className="border-t border-[#2d3748] pt-3 flex justify-between text-sm font-bold">
          <span className="text-white">Total del pedido</span>
          <span className="text-[#00b074] text-lg">${(pedido?.total ?? 0).toFixed(2)}</span>
        </div>
      </div>
      <button onClick={() => router.push('/pedidos')}
        className="w-full bg-[#181d24] border border-[#2d3748] text-white font-bold py-4 rounded-2xl">
        Volver a Pedidos
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#0c0f12] pb-32">
      {/* Header */}
      <div className="bg-[#181d24] border-b border-[#2d3748] px-4 pt-10 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#00b074] rounded-xl flex items-center justify-center text-white font-bold text-xs">
              TR
            </div>
            <div>
              <p className="text-white font-bold text-sm">Ruta de Entrega</p>
              <p className="text-gray-500 text-xs">La Crayola → Cliente</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-[#00b074]/20 px-3 py-1.5 rounded-full">
            <div className="w-1.5 h-1.5 bg-[#00b074] rounded-full animate-pulse" />
            <span className="text-[#00b074] text-xs font-bold">Despachando</span>
          </div>
        </div>
      </div>

      {/* Mapa embed */}
      <div className="relative bg-[#181d24]" style={{ height: '220px' }}>
        {mapUrl ? (
          <iframe src={mapUrl} className="w-full h-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center space-y-2">
              <MapPin size={32} className="text-[#2d3748] mx-auto" />
              <p className="text-gray-600 text-sm">Sin coordenadas GPS</p>
            </div>
          </div>
        )}
        {/* Overlay con botón */}
        <button onClick={abrirMapa}
          className="absolute bottom-3 right-3 bg-[#0c0f12]/90 border border-[#2d3748] text-white text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5">
          <Navigation size={12} className="text-[#00b074]" /> Abrir Maps
        </button>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {/* Dirección */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-2">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-[#ff9f1c]/20 rounded-xl flex items-center justify-center shrink-0">
              <MapPin size={15} className="text-[#ff9f1c]" />
            </div>
            <div className="flex-1">
              <p className="text-white font-semibold text-sm">{pedido?.direccion ?? 'Sin dirección'}</p>
              <p className="text-gray-500 text-xs mt-0.5">{pedido?.ciudad}</p>
            </div>
          </div>
          {pedido?.referencias && (
            <div className="bg-[#ff9f1c]/10 border border-[#ff9f1c]/20 rounded-xl px-3 py-2 text-xs text-[#ff9f1c]">
              Instrucciones: {pedido.referencias}
            </div>
          )}
        </div>

        {/* Cliente */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#2d3748] rounded-2xl flex items-center justify-center text-white font-bold">
                {pedido?.nombre_cliente?.[0] ?? '?'}
              </div>
              <div>
                <p className="text-white font-semibold text-sm">{pedido?.nombre_cliente}</p>
                <p className="text-gray-500 text-xs">{pedido?.total_items ?? items.length} productos · ${(pedido?.total ?? 0).toFixed(2)}</p>
              </div>
            </div>
            <a href={`tel:${pedido?.telefono}`}
              className="w-10 h-10 bg-[#00b074]/20 rounded-xl flex items-center justify-center">
              <Phone size={16} className="text-[#00b074]" />
            </a>
          </div>
        </div>

        {/* Notificaciones rápidas de WhatsApp (Repartidor) */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[#00b074]">📲</span>
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Notificaciones al Cliente</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const paddingNum = String(pedido?.numero ?? 0).padStart(4, '0')
                const msg = `Hola *${pedido?.nombre_cliente}*, soy tu repartidor de Tienda La Crayola. *Voy en camino* con tu pedido #*${paddingNum}* hacia tu ubicación. Por favor, confírmame si estás en casa. A continuación te compartiré mi ubicación en tiempo real en la siguiente burbuja para que puedas seguirme:`
                const cleanPhone = pedido?.telefono?.replace(/\D/g, '') || ''
                const formattedPhone = cleanPhone.startsWith('0') ? '593' + cleanPhone.slice(1) : cleanPhone
                window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank')
              }}
              className="flex-1 bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/35 text-blue-400 py-2.5 rounded-xl text-xs font-bold transition text-center cursor-pointer"
            >
              🏍️ En Camino
            </button>
            <button
              onClick={() => {
                const trackingUrl = `https://tienda-lacrayola.vercel.app/pedido/${pedido?.id}`
                const paddingNum = String(pedido?.numero ?? 0).padStart(4, '0')
                const msg = `Hola *${pedido?.nombre_cliente}*, tu pedido #*${paddingNum}* de Tienda La Crayola ha sido *entregado con éxito*. ¡Muchas gracias por tu confianza! Si te gustó nuestro servicio, califícanos aquí: ${trackingUrl}`
                const cleanPhone = pedido?.telefono?.replace(/\D/g, '') || ''
                const formattedPhone = cleanPhone.startsWith('0') ? '593' + cleanPhone.slice(1) : cleanPhone
                window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank')
              }}
              className="flex-1 bg-green-600/20 border border-green-500/30 hover:bg-green-600/35 text-green-400 py-2.5 rounded-xl text-xs font-bold transition text-center cursor-pointer"
            >
              ✅ Entregado
            </button>
          </div>
        </div>

        {/* Cobro */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Package size={14} className="text-gray-400" />
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Confirmar cobro en efectivo</p>
          </div>
          <div className="flex justify-between text-sm border-b border-[#2d3748] pb-2">
            <span className="text-gray-400">Total estimado</span>
            <span className="text-white font-bold">${(pedido?.total ?? 0).toFixed(2)}</span>
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#00b074] font-bold">$</span>
            <input type="number" step="0.01" min="0" value={monto}
              onChange={e => setMonto(e.target.value)}
              placeholder={(pedido?.total ?? 0).toFixed(2)}
              className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-2xl pl-8 pr-4 py-3.5 text-lg font-bold focus:outline-none focus:border-[#00b074] text-center"
            />
          </div>
          {error && <p className="text-red-400 text-xs text-center">{error}</p>}
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 px-4 pb-6 pt-3 bg-gradient-to-t from-[#0c0f12] via-[#0c0f12]/95 to-transparent">
        <button onClick={confirmarEntrega} disabled={guardando}
          className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-60 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 text-base shadow-lg shadow-[#00b074]/30">
          {guardando ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
          {guardando ? 'Registrando entrega...' : '✅ Confirmar entrega'}
        </button>
      </div>
    </div>
  )
}
