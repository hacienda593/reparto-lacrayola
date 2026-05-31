'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Camera, CheckCircle2, XCircle, Phone, Navigation } from 'lucide-react'

export default function PickingPage() {
  const { id }   = useParams<{ id: string }>()
  const router   = useRouter()
  const supabase = createClient()

  const [pedido,     setPedido]     = useState<any>(null)
  const [productos,  setProductos]  = useState<any[]>([])
  const [asignacion, setAsignacion] = useState<any>(null)
  const [cargando,   setCargando]   = useState(true)
  const [escaneando, setEscaneando] = useState(false)
  const [prodActivo, setProdActivo] = useState<string | null>(null)
  const [guardando,  setGuardando]  = useState(false)
  const videoRef  = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => { cargar(); return () => pararCamara() }, [id])

  async function cargar() {
    const { data: asig } = await supabase.from('rep_asignaciones').select('*').eq('id', id).single()
    if (!asig) { router.replace('/pedidos'); return }
    setAsignacion(asig)
    const { data: ped } = await supabase.from('ol_pedidos').select('*').eq('id', asig.pedido_id).single()
    setPedido(ped)
    const { data: items } = await supabase.from('ol_pedido_items').select('*').eq('pedido_id', asig.pedido_id)
    setProductos((items ?? []).map((it: any) => ({
      id: it.id, nombre: it.nombre_producto ?? it.nombre ?? 'Producto',
      cantidad: it.cantidad ?? 1, codigo_barras: it.codigo_barras ?? null,
      completado: it.picking_completado ?? false, agotado: it.picking_agotado ?? false,
    })))
    setCargando(false)
  }

  async function marcarCompletado(pid: string) {
    setProductos(prev => prev.map(p => p.id === pid ? { ...p, completado: true, agotado: false } : p))
    await supabase.from('ol_pedido_items').update({ picking_completado: true, picking_agotado: false }).eq('id', pid)
  }

  async function marcarAgotado(pid: string) {
    setProductos(prev => prev.map(p => p.id === pid ? { ...p, agotado: true, completado: false } : p))
    await supabase.from('ol_pedido_items').update({ picking_agotado: true, picking_completado: false }).eq('id', pid)
  }

  async function abrirCamara(pid: string) {
    setProdActivo(pid); setEscaneando(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play() }
    } catch { setEscaneando(false) }
  }

  function pararCamara() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null; setEscaneando(false); setProdActivo(null)
  }

  function confirmarEscaneo() { if (prodActivo) { marcarCompletado(prodActivo); pararCamara() } }

  async function iniciarRuta() {
    setGuardando(true)
    await supabase.from('rep_asignaciones').update({ estado: 'en_ruta', updated_at: new Date().toISOString() }).eq('id', id)
    await supabase.from('ol_pedidos').update({ estado: 'enviado' }).eq('id', asignacion.pedido_id)
    router.push(`/entrega/${id}`)
  }

  const completados = productos.filter(p => p.completado).length
  const total       = productos.length
  const progreso    = total > 0 ? Math.round((completados / total) * 100) : 0
  const listo       = completados === total && total > 0

  if (cargando) return (
    <div className="min-h-screen bg-[#0c0f12] flex items-center justify-center">
      <Loader2 size={28} className="animate-spin text-[#00b074]" />
    </div>
  )

  return (
    <div className="min-h-screen bg-[#0c0f12] pb-32">
      {escaneando && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 pt-10 pb-4">
            <button onClick={pararCamara} className="text-white text-sm border border-white/20 px-3 py-1.5 rounded-xl">Cancelar</button>
            <span className="text-white text-sm font-semibold">Escanear código</span>
            <div className="w-20" />
          </div>
          <div className="flex-1 relative">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-64 h-64 border-2 border-[#00b074] rounded-3xl"
                style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)' }} />
            </div>
            <p className="absolute bottom-8 w-full text-center text-white/60 text-sm">Apunta al código de barras</p>
          </div>
          <div className="px-4 pb-8 pt-4">
            <button onClick={confirmarEscaneo}
              className="w-full bg-[#00b074] text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2">
              <CheckCircle2 size={20} /> Producto correcto — confirmar
            </button>
          </div>
        </div>
      )}

      <div className="bg-[#181d24] border-b border-[#2d3748] px-4 pt-10 pb-4 space-y-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/pedidos')} className="text-gray-400 text-xl leading-none">←</button>
          <div>
            <p className="text-white font-bold">Pedido #{String(pedido?.numero ?? 0).padStart(4,'0')}</p>
            <p className="text-gray-500 text-xs">{pedido?.nombre_cliente}</p>
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Picking</span>
            <span className="text-[#00b074] font-bold">{completados}/{total} completados</span>
          </div>
          <div className="h-2.5 bg-[#2d3748] rounded-full overflow-hidden">
            <div className="h-full bg-[#00b074] rounded-full transition-all duration-300" style={{ width: `${progreso}%` }} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2.5 bg-[#181d24]/50 border-b border-[#2d3748]">
        <span className="text-gray-400 text-xs">Cliente: <span className="text-white font-semibold">{pedido?.nombre_cliente}</span></span>
        <a href={`tel:${pedido?.telefono}`} className="flex items-center gap-1 text-[#00b074] text-xs font-semibold">
          <Phone size={12} /> Llamar
        </a>
      </div>

      {pedido?.notas && (
        <div className="mx-4 mt-3 bg-[#ff9f1c]/10 border border-[#ff9f1c]/30 rounded-2xl px-3 py-2 text-xs text-[#ff9f1c]">
          📝 {pedido.notas}
        </div>
      )}

      <div className="px-4 pt-4 space-y-3">
        {productos.map(prod => (
          <div key={prod.id}
            className={`bg-[#181d24] border rounded-2xl p-4 transition
              ${prod.completado ? 'border-[#00b074]/30 opacity-60' : prod.agotado ? 'border-red-500/30' : 'border-[#2d3748]'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {prod.completado && <CheckCircle2 size={14} className="text-[#00b074] shrink-0" />}
                  {prod.agotado    && <XCircle      size={14} className="text-red-400 shrink-0" />}
                  <p className={`text-sm font-semibold truncate ${prod.completado ? 'text-gray-600 line-through' : 'text-white'}`}>
                    {prod.nombre}
                  </p>
                </div>
                <p className="text-gray-500 text-xs mt-0.5">Cantidad: <span className="text-white">{prod.cantidad}</span></p>
                {prod.agotado && <p className="text-red-400 text-xs mt-0.5 font-semibold">Agotado en tienda</p>}
              </div>
              {!prod.completado && !prod.agotado && (
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => abrirCamara(prod.id)}
                    title="Escanear código"
                    className="w-9 h-9 bg-[#2d3748] rounded-xl flex items-center justify-center text-[#00b074]">
                    <Camera size={15} />
                  </button>
                  <button onClick={() => marcarCompletado(prod.id)}
                    title="Listo"
                    className="w-9 h-9 bg-[#00b074] rounded-xl flex items-center justify-center text-white">
                    <CheckCircle2 size={15} />
                  </button>
                  <button onClick={() => marcarAgotado(prod.id)}
                    title="Agotado"
                    className="w-9 h-9 bg-[#2d3748] rounded-xl flex items-center justify-center text-red-400">
                    <XCircle size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {listo && (
        <div className="fixed bottom-0 inset-x-0 px-4 pb-6 pt-3 bg-gradient-to-t from-[#0c0f12] to-transparent">
          <button onClick={iniciarRuta} disabled={guardando}
            className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-60 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 text-base shadow-lg shadow-[#00b074]/30">
            {guardando ? <Loader2 size={18} className="animate-spin" /> : <Navigation size={18} />}
            {guardando ? 'Preparando ruta...' : '🚚 Todo listo — Salir a entregar'}
          </button>
        </div>
      )}
    </div>
  )
}
