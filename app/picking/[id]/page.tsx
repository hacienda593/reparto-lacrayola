'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, CheckCircle2, AlertTriangle, Navigation, Phone, MessageCircle, Truck } from 'lucide-react'

const EMOJIS: Record<string, string> = {
  default: '📦', vegetal: '🥦', fruta: '🍎', lacteo: '🥛', carne: '🥩',
  limpieza: '🧹', bebida: '🥤', snack: '🍪', pan: '🍞', aceite: '🫙',
}

function emojiProd(nombre: string) {
  const n = nombre.toLowerCase()
  if (/brocoli|acelga|lechuga|espinaca|zanahoria|papa|cebolla|ajo|tomate/.test(n)) return '🥦'
  if (/manzana|pera|mango|banano|fresa|uva|naranja|limon/.test(n)) return '🍎'
  if (/leche|queso|yogur|mantequilla|crema/.test(n)) return '🥛'
  if (/pollo|res|cerdo|carne|pesc/.test(n)) return '🥩'
  if (/jabón|detergente|limpia|cloro|lavavajil/.test(n)) return '🧹'
  if (/agua|jugo|cola|gaseosa|cerveza|vino/.test(n)) return '🥤'
  if (/pan|galleta|tostada/.test(n)) return '🍞'
  if (/aceite|manteca/.test(n)) return '🫙'
  if (/arroz|fideo|pasta/.test(n)) return '🌾'
  if (/huevo/.test(n)) return '🥚'
  return '📦'
}

type Tab = 'lista' | 'chat' | 'entrega'

export default function PickingPage() {
  const { id }   = useParams<{ id: string }>()
  const router   = useRouter()
  const supabase = createClient()

  const [pedido,      setPedido]      = useState<any>(null)
  const [productos,   setProductos]   = useState<any[]>([])
  const [asignacion,  setAsignacion]  = useState<any>(null)
  const [cargando,    setCargando]    = useState(true)
  const [escaneando,  setEscaneando]  = useState(false)
  const [prodActivo,  setProdActivo]  = useState<string | null>(null)
  const [agotadoOpen, setAgotadoOpen] = useState<string | null>(null)
  const [guardando,   setGuardando]   = useState(false)
  const [tab,         setTab]         = useState<Tab>('lista')
  const [chatMsg,     setChatMsg]     = useState('')
  const [mensajes,    setMensajes]    = useState<{ texto: string; mio: boolean }[]>([])
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
      id: it.id,
      nombre:    it.descripcion ?? it.nombre_producto ?? it.nombre ?? 'Producto',
      cantidad:  it.cantidad ?? 1,
      seccion:   it.categoria ?? it.seccion ?? null,
      completado: it.picking_completado ?? false,
      agotado:    it.picking_agotado    ?? false,
      reemplazo:  it.picking_reemplazo  ?? null,
    })))
    setCargando(false)
  }

  async function marcarCompletado(pid: string) {
    setProductos(prev => prev.map(p => p.id === pid ? { ...p, completado: true, agotado: false } : p))
    await supabase.from('ol_pedido_items').update({ picking_completado: true, picking_agotado: false }).eq('id', pid)
  }

  async function confirmarAgotado(pid: string, reemplazo?: string) {
    setProductos(prev => prev.map(p => p.id === pid ? { ...p, agotado: true, completado: false, reemplazo: reemplazo ?? null } : p))
    await supabase.from('ol_pedido_items').update({
      picking_agotado: true, picking_completado: false,
      picking_reemplazo: reemplazo ?? null,
    }).eq('id', pid)
    setAgotadoOpen(null)
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

  function enviarMensaje() {
    if (!chatMsg.trim()) return
    setMensajes(prev => [...prev, { texto: chatMsg.trim(), mio: true }])
    setChatMsg('')
  }

  const completados = productos.filter(p => p.completado || p.agotado).length
  const soloCompletos = productos.filter(p => p.completado).length
  const total   = productos.length
  const progreso = total > 0 ? Math.round((soloCompletos / total) * 100) : 0
  const listo   = completados === total && total > 0

  if (cargando) return (
    <div className="min-h-screen bg-[#0c0f12] flex items-center justify-center">
      <Loader2 size={28} className="animate-spin text-[#00b074]" />
    </div>
  )

  const prodAgotadoActivo = productos.find(p => p.id === agotadoOpen)

  return (
    <div className="min-h-screen bg-[#0c0f12] flex flex-col">

      {/* Overlay escáner */}
      {escaneando && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="px-4 pt-10 pb-4 text-center">
            <p className="text-white font-bold text-lg">Escanear Código de Barras</p>
            <p className="text-gray-400 text-sm mt-1">Alinee el código de barras dentro del recuadro</p>
          </div>
          <div className="flex-1 relative">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative w-72 h-56">
                <div className="absolute inset-0 border-2 border-[#00b074] rounded-2xl" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.7)' }} />
                {/* Línea de escaneo animada */}
                <div className="absolute left-2 right-2 h-0.5 bg-[#00b074] top-1/2 opacity-80"
                  style={{ animation: 'scan 2s ease-in-out infinite', boxShadow: '0 0 8px #00b074' }} />
              </div>
            </div>
          </div>
          <div className="px-4 pb-8 pt-4 space-y-3">
            <button onClick={confirmarEscaneo}
              className="w-full bg-[#00b074] text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2">
              <CheckCircle2 size={20} /> Producto correcto — confirmar
            </button>
            <button onClick={pararCamara} className="w-full text-gray-400 py-3 rounded-2xl border border-[#2d3748] text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Popup agotado */}
      {agotadoOpen && prodAgotadoActivo && (
        <div className="fixed inset-0 bg-black/80 z-40 flex items-end">
          <div className="w-full bg-[#181d24] rounded-t-3xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-[#ff9f1c]">
              <AlertTriangle size={20} />
              <p className="font-bold">¡Producto Sin Stock en Percha!</p>
            </div>
            <p className="text-gray-400 text-sm">
              <span className="text-white font-semibold">{prodAgotadoActivo.nombre}</span> no está disponible. ¿Qué deseas hacer?
            </p>
            <div className="space-y-2">
              <button onClick={() => confirmarAgotado(agotadoOpen, 'similar')}
                className="w-full bg-[#2d3748] hover:bg-[#374151] text-white text-left px-4 py-3.5 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">Buscar producto similar</p>
                  <p className="text-[#00b074] text-xs mt-0.5">Marcar como reemplazo</p>
                </div>
                <span className="text-gray-400">→</span>
              </button>
              <button onClick={() => { confirmarAgotado(agotadoOpen); setTab('chat') }}
                className="w-full bg-[#2d3748] hover:bg-[#374151] text-white text-left px-4 py-3.5 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">Consultar al cliente por Chat</p>
                  <p className="text-[#00b074] text-xs mt-0.5">Abrir hilo de chat</p>
                </div>
                <span className="text-gray-400">→</span>
              </button>
              <button onClick={() => confirmarAgotado(agotadoOpen)}
                className="w-full text-gray-500 py-3 text-sm">
                Omitir producto
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-[#181d24] border-b border-[#2d3748] px-4 pt-10 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#00b074] rounded-xl flex items-center justify-center text-white font-bold text-xs">
              {pedido?.nombre_cliente?.split(' ').map((n: string) => n[0]).join('').slice(0,2) ?? '?'}
            </div>
            <div>
              <p className="text-white font-bold text-sm">La Crayola · #{String(pedido?.numero ?? 0).padStart(4,'0')}</p>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-[#ff9f1c] rounded-full" />
                <span className="text-[#ff9f1c] text-xs font-semibold">Comprando</span>
              </div>
            </div>
          </div>
          <a href={`tel:${pedido?.telefono}`} className="w-9 h-9 bg-[#2d3748] rounded-xl flex items-center justify-center">
            <Phone size={15} className="text-[#00b074]" />
          </a>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Completados: <span className="text-white font-bold">{soloCompletos}/{total}</span></span>
            <span className="text-[#00b074] font-bold">{progreso}%</span>
          </div>
          <div className="h-2 bg-[#2d3748] rounded-full overflow-hidden">
            <div className="h-full bg-[#00b074] rounded-full transition-all duration-500" style={{ width: `${progreso}%` }} />
          </div>
        </div>
      </div>

      {/* Contenido tabs */}
      <div className="flex-1 overflow-y-auto">

        {/* TAB: Lista */}
        {tab === 'lista' && (
          <div className="px-4 pt-4 pb-4">
            {pedido?.notas && (
              <div className="mb-3 bg-[#ff9f1c]/10 border border-[#ff9f1c]/30 rounded-2xl px-3 py-2 text-xs text-[#ff9f1c]">
                📝 {pedido.notas}
              </div>
            )}
            <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">Lista de recolección</p>
            <div className="space-y-2">
              {productos.map(prod => (
                <div key={prod.id}
                  className={`bg-[#181d24] border rounded-2xl p-3.5 transition
                    ${prod.completado ? 'border-[#00b074]/30' : prod.agotado ? 'border-[#ff9f1c]/30' : 'border-[#2d3748]'}`}>
                  <div className="flex items-center gap-3">
                    {/* Emoji */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0
                      ${prod.completado ? 'bg-[#00b074]/10' : prod.agotado ? 'bg-[#ff9f1c]/10' : 'bg-[#2d3748]'}`}>
                      {emojiProd(prod.nombre)}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${prod.completado ? 'text-gray-500 line-through' : 'text-white'}`}>
                        {prod.reemplazo === 'similar' ? `${prod.nombre} (Reemplazo)` : prod.nombre}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {prod.seccion && <span className="text-gray-600 text-xs">{prod.seccion}</span>}
                        <span className="text-gray-500 text-xs">Cant: <span className="text-gray-300">{prod.cantidad}</span></span>
                      </div>
                    </div>
                    {/* Acciones */}
                    {prod.completado && <CheckCircle2 size={20} className="text-[#00b074] shrink-0" />}
                    {prod.agotado && !prod.completado && <AlertTriangle size={20} className="text-[#ff9f1c] shrink-0" />}
                    {!prod.completado && !prod.agotado && (
                      <div className="flex gap-1.5 shrink-0">
                        {/* Botón escanear (brackets) */}
                        <button onClick={() => abrirCamara(prod.id)}
                          className="w-9 h-9 bg-[#2d3748] rounded-xl flex items-center justify-center text-gray-400">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="7 3 3 3 3 7"/><polyline points="17 3 21 3 21 7"/>
                            <polyline points="7 21 3 21 3 17"/><polyline points="17 21 21 21 21 17"/>
                          </svg>
                        </button>
                        {/* Listo */}
                        <button onClick={() => marcarCompletado(prod.id)}
                          className="w-9 h-9 bg-[#00b074] rounded-xl flex items-center justify-center text-white">
                          <CheckCircle2 size={16} />
                        </button>
                        {/* Agotado */}
                        <button onClick={() => setAgotadoOpen(prod.id)}
                          className="w-9 h-9 bg-[#2d3748] rounded-xl flex items-center justify-center text-[#ff9f1c]">
                          <AlertTriangle size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Botón ir a entregar */}
            {listo && (
              <button onClick={iniciarRuta} disabled={guardando}
                className="w-full mt-4 bg-[#ff9f1c] hover:bg-[#e8900a] disabled:opacity-60 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 text-base">
                {guardando ? <Loader2 size={18} className="animate-spin" /> : '🚚'}
                {guardando ? 'Preparando ruta...' : 'Salir a Entregar →'}
              </button>
            )}
          </div>
        )}

        {/* TAB: Chat */}
        {tab === 'chat' && (
          <div className="flex flex-col h-full px-4 pt-4 pb-4">
            <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">Chat con cliente</p>
            <div className="flex-1 space-y-2 mb-4 min-h-[200px]">
              {mensajes.length === 0 && (
                <div className="text-center py-8 text-gray-600 text-sm">
                  Sin mensajes aún. Escribe al cliente si necesitas coordinar algo.
                </div>
              )}
              {mensajes.map((m, i) => (
                <div key={i} className={`flex ${m.mio ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm
                    ${m.mio ? 'bg-[#00b074] text-white' : 'bg-[#2d3748] text-gray-200'}`}>
                    {m.texto}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={chatMsg} onChange={e => setChatMsg(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && enviarMensaje()}
                placeholder="Escribe un mensaje al cliente..."
                className="flex-1 bg-[#181d24] border border-[#2d3748] text-white rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-[#00b074]"
              />
              <button onClick={enviarMensaje}
                className="w-12 h-12 bg-[#00b074] rounded-2xl flex items-center justify-center text-white">
                →
              </button>
            </div>
          </div>
        )}

        {/* TAB: Entrega (info) */}
        {tab === 'entrega' && (
          <div className="px-4 pt-4 space-y-4">
            <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Datos de entrega</p>
            <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-2">
              <p className="text-white font-semibold">{pedido?.nombre_cliente}</p>
              <a href={`tel:${pedido?.telefono}`} className="flex items-center gap-1.5 text-[#00b074] text-sm">
                <Phone size={13} /> {pedido?.telefono}
              </a>
              {pedido?.direccion && (
                <div className="flex items-start gap-2 mt-2">
                  <span className="text-[#00b074] mt-0.5">📍</span>
                  <p className="text-gray-300 text-sm">{pedido.direccion}, {pedido.ciudad}</p>
                </div>
              )}
              {pedido?.referencias && (
                <div className="bg-[#ff9f1c]/10 border border-[#ff9f1c]/20 rounded-xl px-3 py-2 text-xs text-[#ff9f1c] mt-2">
                  Instrucciones: {pedido.referencias}
                </div>
              )}
            </div>
            {listo && (
              <button onClick={iniciarRuta} disabled={guardando}
                className="w-full bg-[#ff9f1c] disabled:opacity-60 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2">
                {guardando ? <Loader2 size={18} className="animate-spin" /> : <Navigation size={18} />}
                {guardando ? 'Iniciando...' : '🚚 Salir a entregar'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <div className="bg-[#181d24] border-t border-[#2d3748] flex shrink-0">
        {([
          { key: 'lista',   label: 'Lista',       Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
          { key: 'chat',    label: 'Chat Cliente', Icon: () => <MessageCircle size={20} /> },
          { key: 'entrega', label: 'Entrega',      Icon: () => <Truck size={20} />, disabled: !listo },
        ] as any[]).map(({ key, label, Icon, disabled }) => (
          <button key={key}
            onClick={() => !disabled && setTab(key as Tab)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition
              ${tab === key ? 'text-[#00b074]' : disabled ? 'text-gray-700 cursor-not-allowed' : 'text-gray-500 hover:text-gray-300'}`}>
            <Icon />
            <span className="text-[10px] font-semibold">{label}</span>
          </button>
        ))}
      </div>

      <style>{`
        @keyframes scan {
          0%, 100% { top: 10%; }
          50% { top: 85%; }
        }
      `}</style>
    </div>
  )
}
