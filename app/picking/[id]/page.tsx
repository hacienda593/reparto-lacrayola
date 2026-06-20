'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, CheckCircle2, AlertTriangle, Navigation, Phone, MessageCircle, Truck, RotateCcw } from 'lucide-react'

const EMOJIS: Record<string, string> = {}
function emojiProd(n: string) {
  const s = n.toLowerCase()
  if (/brocoli|acelga|lechuga|zanahoria|papa|cebolla|ajo|tomate|vegetal/.test(s)) return '🥦'
  if (/manzana|pera|mango|banano|fresa|naranja|limon|fruta/.test(s)) return '🍎'
  if (/leche|queso|yogur|mantequilla|lacteo/.test(s)) return '🥛'
  if (/pollo|res|cerdo|carne|pesc/.test(s)) return '🥩'
  if (/jabón|detergente|limpia|cloro/.test(s)) return '🧹'
  if (/agua|jugo|cola|gaseosa|bebida/.test(s)) return '🥤'
  if (/pan|galleta|tostada/.test(s)) return '🍞'
  if (/aceite|manteca/.test(s)) return '🫙'
  if (/arroz|fideo|pasta|grano/.test(s)) return '🌾'
  if (/huevo/.test(s)) return '🥚'
  if (/manualidad|limpiapipass|pintura|lapiz|crayon/.test(s)) return '🎨'
  if (/libro|cuaderno|papel|cartulina/.test(s)) return '📚'
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
  const [scanResult,  setScanResult]  = useState<{ prodId: string; codigo: string } | null>(null)
  const [cantConfirm, setCantConfirm] = useState(1)
  const [scanError,   setScanError]   = useState('')

  const videoRef    = useRef<HTMLVideoElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const rafRef      = useRef<number>(0)
  const detectorRef = useRef<any>(null)

  useEffect(() => { cargar(); return () => pararCamara() }, [id])

  async function cargar() {
    const { data: asig } = await supabase.from('rep_asignaciones').select('*').eq('id', id).single()
    if (!asig) { router.replace('/pedidos'); return }
    setAsignacion(asig)
    const { data: ped } = await supabase.from('ol_pedidos').select('*').eq('id', asig.pedido_id).single()
    setPedido(ped)
    const { data: items } = await supabase.from('ol_pedido_items').select('*').eq('pedido_id', asig.pedido_id)

    // Obtener imagen_url y codigo_barras de ol_productos
    const codigos = (items ?? []).map((it: any) => it.codigo).filter(Boolean)
    let prodMap: Record<string, { imagen_url: string | null; codigo_barras: string | null }> = {}
    if (codigos.length > 0) {
      const { data: prods } = await supabase
        .from('ol_productos')
        .select('codigo, imagen_url, codigo_barras')
        .in('codigo', codigos)
      if (prods) {
        prods.forEach((p: any) => {
          prodMap[p.codigo] = { imagen_url: p.imagen_url, codigo_barras: p.codigo_barras }
        })
      }
    }

    setProductos((items ?? []).map((it: any) => ({
      id: it.id,
      codigo:    it.codigo,
      nombre:    it.descripcion ?? it.nombre_producto ?? it.nombre ?? 'Producto',
      cantidad:  it.cantidad ?? 1,
      seccion:   it.categoria ?? it.seccion ?? null,
      completado: it.picking_completado ?? false,
      agotado:    it.picking_agotado    ?? false,
      reemplazo:  it.picking_reemplazo  ?? null,
      imagen_url:    prodMap[it.codigo]?.imagen_url ?? null,
      codigo_barras: prodMap[it.codigo]?.codigo_barras ?? null,
    })))
    setCargando(false)
  }

  async function marcarCompletado(pid: string, qty?: number) {
    const prevProds = productos;
    setProductos(prev => prev.map(p => p.id === pid ? { ...p, completado: true, agotado: false } : p))
    
    const { data, error } = await supabase.from('ol_pedido_items').update({
      picking_completado: true, picking_agotado: false,
      ...(qty !== undefined ? { cantidad: qty } : {}),
    }).eq('id', pid).select()

    if (error || !data || data.length === 0) {
      alert("Error de base de datos: No se pudo completar el producto (posible restricción de seguridad RLS).")
      setProductos(prevProds)
    }
  }

  async function deshacerCompletado(pid: string) {
    const prevProds = productos;
    setProductos(prev => prev.map(p => p.id === pid ? { ...p, completado: false, agotado: false } : p))
    
    const { data, error } = await supabase.from('ol_pedido_items').update({ 
      picking_completado: false, 
      picking_agotado: false 
    }).eq('id', pid).select()

    if (error || !data || data.length === 0) {
      alert("Error de base de datos: No se pudo deshacer la recolección.")
      setProductos(prevProds)
    }
  }

  async function confirmarAgotado(pid: string, reemplazo?: string) {
    const prevProds = productos;
    setProductos(prev => prev.map(p => p.id === pid ? { ...p, agotado: true, completado: false, reemplazo: reemplazo ?? null } : p))
    setAgotadoOpen(null)

    const { data, error } = await supabase.from('ol_pedido_items').update({
      picking_agotado: true, picking_completado: false,
      picking_reemplazo: reemplazo ?? null,
    }).eq('id', pid).select()

    if (error || !data || data.length === 0) {
      alert("Error de base de datos: No se pudo marcar el producto como agotado.")
      setProductos(prevProds)
    }
  }

  // ── Escáner con BarcodeDetector ────────────────────────────────────────
  async function abrirCamara(pid: string) {
    setProdActivo(pid); setEscaneando(true); setScanError(''); setScanResult(null)
    const prod = productos.find(p => p.id === pid)
    setCantConfirm(prod?.cantidad ?? 1)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      // Intentar usar BarcodeDetector nativo (Chrome/Android)
      if ('BarcodeDetector' in window) {
        const bd = new (window as any).BarcodeDetector({ formats: ['ean_13','ean_8','code_128','qr_code','code_39','upc_a','upc_e'] })
        detectorRef.current = bd
        escanearFrames(bd, pid)
      } else {
        setScanError('Escáner automático no disponible en este navegador. Confirma manualmente.')
      }
    } catch {
      setEscaneando(false)
      setScanError('No se pudo acceder a la cámara.')
    }
  }

  const escanearFrames = useCallback((bd: any, pid: string) => {
    async function loop() {
      if (!videoRef.current || !streamRef.current) return
      try {
        const codes = await bd.detect(videoRef.current)
        if (codes.length > 0) {
          const codigo = codes[0].rawValue
          setScanResult({ prodId: pid, codigo })
          return // Detener el loop al detectar
        }
      } catch {}
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [])

  function pararCamara() {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setEscaneando(false); setProdActivo(null); setScanResult(null); setScanError('')
  }

  async function confirmarEscaneo() {
    if (scanResult && prodActivoObj) {
      // Si el producto no tenía código de barras registrado, guardarlo en el catálogo
      if (!prodActivoObj.codigo_barras) {
        const { data, error } = await supabase
          .from('ol_productos')
          .update({ codigo_barras: scanResult.codigo })
          .eq('codigo', prodActivoObj.codigo)
          .select()
        
        if (error || !data || data.length === 0) {
          alert("Error: No tienes permisos para registrar el código de barras en el catálogo (posible RLS de Supabase).")
          pararCamara()
          return
        }
        
        // Actualizar en el estado local
        setProductos(prev => prev.map(p => p.id === scanResult.prodId ? { ...p, codigo_barras: scanResult.codigo } : p))
      }

      await marcarCompletado(scanResult.prodId, cantConfirm)
      pararCamara()
    }
  }

  async function confirmarManual() {
    if (prodActivo) {
      await marcarCompletado(prodActivo, cantConfirm)
      pararCamara()
    }
  }

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

  const completados   = productos.filter(p => p.completado || p.agotado).length
  const soloCompletos = productos.filter(p => p.completado).length
  const total         = productos.length
  const progreso      = total > 0 ? Math.round((soloCompletos / total) * 100) : 0
  const listo         = completados === total && total > 0
  const prodActivoObj = productos.find(p => p.id === prodActivo)
  const waLink        = `https://wa.me/${pedido?.telefono?.replace(/\D/g,'')}`

  if (cargando) return (
    <div className="min-h-screen bg-[#0c0f12] flex items-center justify-center">
      <Loader2 size={28} className="animate-spin text-[#00b074]" />
    </div>
  )

  return (
    <div className="min-h-screen bg-[#0c0f12] flex flex-col">

      {/* ── Overlay escáner ── */}
      {escaneando && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="px-4 pt-10 pb-3 text-center">
            <p className="text-white font-bold text-lg">Escanear Código</p>
            <p className="text-gray-400 text-sm mt-0.5">
              {prodActivoObj?.nombre}
            </p>
          </div>

          <div className="flex-1 relative bg-black">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-72 h-48">
                <div className="absolute inset-0 border-2 border-[#00b074] rounded-2xl"
                  style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)' }} />
                {!scanResult && (
                  <div className="absolute left-2 right-2 h-0.5 bg-[#00b074]/80 top-1/2"
                    style={{ animation: 'scan 2s ease-in-out infinite', boxShadow: '0 0 6px #00b074' }} />
                )}
                {scanResult && (
                  <div className="absolute inset-0 bg-[#00b074]/20 rounded-2xl flex items-center justify-center">
                    <CheckCircle2 size={40} className="text-[#00b074]" />
                  </div>
                )}
              </div>
            </div>
            {scanError && (
              <div className="absolute bottom-4 inset-x-4 bg-[#ff9f1c]/20 border border-[#ff9f1c]/40 rounded-xl px-3 py-2 text-[#ff9f1c] text-xs text-center">
                {scanError}
              </div>
            )}
          </div>

          {/* Resultado / Confirmación cantidad */}
          <div className="bg-[#181d24] px-4 pt-4 pb-8 space-y-3">
            {scanResult && prodActivoObj && (() => {
              const tieneCodigo = !!prodActivoObj.codigo_barras
              const codigoCoincide = tieneCodigo && scanResult.codigo === prodActivoObj.codigo_barras
              const esPrimerEscaneo = !tieneCodigo

              return (
                <div className="space-y-3">
                  {codigoCoincide && (
                    <div className="bg-[#00b074]/10 border border-[#00b074]/30 rounded-2xl p-4 text-center space-y-1">
                      <p className="text-[#00b074] text-xs font-bold uppercase tracking-wider">✅ Código Correcto y Verificado</p>
                      <p className="text-gray-300 font-mono text-xs">{scanResult.codigo}</p>
                    </div>
                  )}

                  {tieneCodigo && !codigoCoincide && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 text-center space-y-2">
                      <p className="text-red-400 text-xs font-bold uppercase tracking-wider">❌ El Código No Coincide</p>
                      <div className="text-xs text-gray-400 space-y-0.5">
                        <p>Escaneado: <span className="font-mono text-white">{scanResult.codigo}</span></p>
                        <p>Esperado: <span className="font-mono text-[#00b074]">{prodActivoObj.codigo_barras}</span></p>
                      </div>
                      <p className="text-red-400/80 text-[10px] leading-relaxed">
                        Este no es el producto correcto. Por favor, verifica la marca, presentación o sección.
                      </p>
                    </div>
                  )}

                  {esPrimerEscaneo && (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 space-y-3">
                      <div className="text-center">
                        <p className="text-yellow-500 text-xs font-bold uppercase tracking-wider">🛍️ Primer Escaneo de este Producto</p>
                        <p className="text-gray-400 text-[10.5px] mt-0.5">Confirma si el artículo físico coincide con la foto:</p>
                      </div>
                      
                      <div className="flex items-center gap-3 bg-[#0c0f12] p-2.5 rounded-xl border border-gray-800">
                        {prodActivoObj.imagen_url ? (
                          <img src={prodActivoObj.imagen_url} alt="" className="w-12 h-12 object-contain bg-white rounded-lg p-0.5 shrink-0" />
                        ) : (
                          <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center text-xl shrink-0">📦</div>
                        )}
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-white text-xs font-bold truncate">{prodActivoObj.nombre}</p>
                          <p className="text-gray-500 text-[10px] uppercase tracking-wider mt-0.5">{prodActivoObj.seccion ?? 'Sin sección'}</p>
                        </div>
                      </div>

                      <div className="text-center">
                        <p className="text-[10px] text-gray-500 font-semibold">Código a registrar:</p>
                        <p className="text-white font-mono text-xs mt-0.5">{scanResult.codigo}</p>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Selector de cantidad */}
            <div className="flex items-center justify-between bg-[#0c0f12] rounded-xl px-4 py-3">
              <span className="text-gray-400 text-sm">Cantidad a añadir:</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setCantConfirm(c => Math.max(1, c-1))}
                  className="w-8 h-8 bg-[#2d3748] rounded-lg flex items-center justify-center text-white font-bold">−</button>
                <span className="text-white font-bold text-lg w-6 text-center">{cantConfirm}</span>
                <button onClick={() => setCantConfirm(c => c+1)}
                  className="w-8 h-8 bg-[#2d3748] rounded-lg flex items-center justify-center text-white font-bold">+</button>
              </div>
            </div>

            {scanResult ? (
              (() => {
                const tieneCodigo = !!prodActivoObj?.codigo_barras
                const codigoCoincide = tieneCodigo && scanResult.codigo === prodActivoObj.codigo_barras
                const esPrimerEscaneo = !tieneCodigo

                if (codigoCoincide || esPrimerEscaneo) {
                  return (
                    <button onClick={confirmarEscaneo}
                      className="w-full bg-[#00b074] hover:bg-[#008f5d] text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95">
                      <CheckCircle2 size={18} />
                      {esPrimerEscaneo 
                        ? `Asociar Código y Añadir ${cantConfirm} ud.`
                        : `Confirmar y Añadir ${cantConfirm} ud.`
                      }
                    </button>
                  )
                } else {
                  return (
                    <button onClick={pararCamara}
                      className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95">
                      Reintentar Escaneo (Cerrar)
                    </button>
                  )
                }
              })()
            ) : (
              <button onClick={confirmarManual}
                className="w-full bg-[#2d3748] text-white font-semibold py-3.5 rounded-2xl flex items-center justify-center gap-2 text-sm">
                Confirmar manualmente ({cantConfirm} ud.)
              </button>
            )}
            <button onClick={pararCamara} className="w-full text-gray-500 py-2 text-sm">Cancelar</button>
          </div>
        </div>
      )}

      {/* ── Popup agotado ── */}
      {agotadoOpen && (
        <div className="fixed inset-0 bg-black/80 z-40 flex items-end">
          <div className="w-full bg-[#181d24] rounded-t-3xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-[#ff9f1c]">
              <AlertTriangle size={20} />
              <p className="font-bold">¡Producto Sin Stock!</p>
            </div>
            <p className="text-gray-400 text-sm">
              <span className="text-white font-semibold">{productos.find(p => p.id === agotadoOpen)?.nombre}</span> no está disponible.
            </p>
            <div className="space-y-2">
              <button onClick={() => confirmarAgotado(agotadoOpen, 'similar')}
                className="w-full bg-[#2d3748] text-white text-left px-4 py-3.5 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">Buscar producto similar</p>
                  <p className="text-[#00b074] text-xs mt-0.5">Marcar como reemplazo</p>
                </div>
                <span className="text-gray-400">→</span>
              </button>
              <button onClick={() => { confirmarAgotado(agotadoOpen); setTab('chat') }}
                className="w-full bg-[#2d3748] text-white text-left px-4 py-3.5 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">Consultar al cliente por Chat</p>
                  <p className="text-[#00b074] text-xs mt-0.5">Abrir hilo de chat</p>
                </div>
                <span className="text-gray-400">→</span>
              </button>
              <button onClick={() => {
                const prodNombre = productos.find(p => p.id === agotadoOpen)?.nombre || 'Producto'
                const msg = `⚠️ *La Crayola - Novedad de Stock* \n\nHola *${pedido?.nombre_cliente}*, en tu pedido *#${String(pedido?.numero ?? 0).padStart(4,'0')}*, te comento que no hay stock disponible de *"${prodNombre}"*. ¿Deseas sustituirlo por otra marca/tamaño similar, o prefieres omitirlo de la lista? 🛒`
                window.open(`https://wa.me/${pedido?.telefono?.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank')
                confirmarAgotado(agotadoOpen)
              }}
                className="w-full bg-green-700/25 border border-green-500/40 hover:bg-green-700/40 text-green-400 text-left px-4 py-3.5 rounded-2xl flex items-center justify-between transition-all">
                <div>
                  <p className="font-semibold text-sm">📲 Notificar por WhatsApp</p>
                  <p className="text-green-500 text-xs mt-0.5">Enviar plantilla de falta de stock</p>
                </div>
                <span className="text-green-400">→</span>
              </button>
              <button onClick={() => confirmarAgotado(agotadoOpen)}
                className="w-full text-gray-500 py-3 text-sm">Omitir producto</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="bg-[#181d24] border-b border-[#2d3748] px-4 pt-10 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#00b074] rounded-xl flex items-center justify-center text-white font-bold text-xs">
              {pedido?.nombre_cliente?.split(' ').map((n:string)=>n[0]).join('').slice(0,2) ?? '?'}
            </div>
            <div>
              <p className="text-white font-bold text-sm">La Crayola · #{String(pedido?.numero ?? 0).padStart(4,'0')}</p>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-[#ff9f1c] rounded-full" />
                <span className="text-[#ff9f1c] text-xs font-semibold">Comprando</span>
              </div>
            </div>
          </div>
          {/* Botones comunicación */}
          <div className="flex gap-2">
            <a href={`tel:${pedido?.telefono}`}
              className="w-9 h-9 bg-[#00b074]/20 rounded-xl flex items-center justify-center">
              <Phone size={15} className="text-[#00b074]" />
            </a>
            <a href={waLink} target="_blank" rel="noopener noreferrer"
              className="w-9 h-9 bg-[#25D366]/20 rounded-xl flex items-center justify-center">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="#25D366">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </a>
          </div>
        </div>
        {/* Barra progreso */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Completados: <span className="text-white font-bold">{soloCompletos}/{total}</span></span>
            <span className="text-[#00b074] font-bold">{progreso}%</span>
          </div>
          <div className="h-2 bg-[#2d3748] rounded-full overflow-hidden">
            <div className="h-full bg-[#00b074] rounded-full transition-all duration-500" style={{ width: `${progreso}%` }} />
          </div>
        </div>

        {/* Notificaciones rápidas de WhatsApp (Shopper) */}
        <div className="flex gap-2 pt-3 border-t border-[#2d3748] mt-3">
          <button
            onClick={() => {
              const trackingUrl = `https://tienda-lacrayola.vercel.app/pedido/${pedido?.id}`
              const paddingNum = String(pedido?.numero ?? 0).padStart(4, '0')
              const msg = `Hola *${pedido?.nombre_cliente}*, soy el encargado de compras de Tienda La Crayola. He *aceptado* tu pedido #*${paddingNum}* de Tuti/Tía y ya me preparo para realizarlo. Puedes seguir el estado en tiempo real en: ${trackingUrl}`
              window.open(`https://wa.me/${pedido?.telefono?.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank')
            }}
            className="flex-1 bg-indigo-600/20 border border-indigo-500/30 hover:bg-indigo-600/35 text-indigo-400 py-2 rounded-xl text-[11px] font-bold transition text-center cursor-pointer"
          >
            🤝 Avisar Aceptado
          </button>
          <button
            onClick={() => {
              const paddingNum = String(pedido?.numero ?? 0).padStart(4, '0')
              const msg = `Hola *${pedido?.nombre_cliente}*, ya me encuentro en el supermercado *realizando tus compras* para el pedido #*${paddingNum}*. Si un artículo no está disponible, te consultaré por esta vía.`
              window.open(`https://wa.me/${pedido?.telefono?.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank')
            }}
            className="flex-1 bg-purple-600/20 border border-purple-500/30 hover:bg-purple-600/35 text-purple-400 py-2 rounded-xl text-[11px] font-bold transition text-center cursor-pointer"
          >
            🛒 Avisar Comprando
          </button>
        </div>
      </div>

      {/* ── Contenido ── */}
      <div className="flex-1 overflow-y-auto">

        {/* TAB: Lista */}
        {tab === 'lista' && (
          <div className="px-4 pt-4 pb-4">
            {pedido?.notas && (
              <div className="mb-3 bg-[#ff9f1c]/10 border border-[#ff9f1c]/30 rounded-2xl px-3 py-2 text-xs text-[#ff9f1c]">
                📝 {pedido.notas}
              </div>
            )}
            <p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-3">Lista de recolección</p>
            <div className="space-y-2">
              {productos.map(prod => (
                <div key={prod.id}
                  className={`bg-[#181d24] border rounded-2xl p-3.5 transition
                    ${prod.completado ? 'border-[#00b074]/30' : prod.agotado ? 'border-[#ff9f1c]/30' : 'border-[#2d3748]'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 overflow-hidden
                      ${prod.completado ? 'bg-[#00b074]/10' : prod.agotado ? 'bg-[#ff9f1c]/10' : 'bg-[#2d3748]'}`}>
                      {prod.imagen_url ? (
                        <img src={prod.imagen_url} alt={prod.nombre} className="w-full h-full object-contain p-0.5" />
                      ) : (
                        emojiProd(prod.nombre)
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${prod.completado ? 'text-gray-500 line-through' : 'text-white'}`}>
                        {prod.reemplazo === 'similar' ? `${prod.nombre} (Reemplazo)` : prod.nombre}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {prod.seccion && <span className="text-gray-600 text-[10px] uppercase tracking-wider">{prod.seccion}</span>}
                        <span className="text-gray-500 text-xs">Cant: <span className="text-gray-300">{prod.cantidad}</span></span>
                      </div>
                    </div>

                    {/* Acciones según estado */}
                    {prod.completado && (
                      <button onClick={() => deshacerCompletado(prod.id)}
                        title="Deshacer — sacar de la canasta"
                        className="w-9 h-9 bg-[#2d3748] rounded-xl flex items-center justify-center text-gray-400 shrink-0">
                        <RotateCcw size={14} />
                      </button>
                    )}
                    {prod.agotado && !prod.completado && (
                      <div className="flex items-center gap-1 shrink-0">
                        <AlertTriangle size={16} className="text-[#ff9f1c]" />
                        <button onClick={() => deshacerCompletado(prod.id)}
                          title="Deshacer agotado"
                          className="w-8 h-8 bg-[#2d3748] rounded-xl flex items-center justify-center text-gray-400">
                          <RotateCcw size={13} />
                        </button>
                      </div>
                    )}
                    {!prod.completado && !prod.agotado && (
                      <div className="flex gap-1.5 shrink-0">
                        {/* Escanear */}
                        <button onClick={() => abrirCamara(prod.id)} title="Escanear código"
                          className="w-9 h-9 bg-[#2d3748] rounded-xl flex items-center justify-center text-gray-400">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="7 3 3 3 3 7"/><polyline points="17 3 21 3 21 7"/>
                            <polyline points="7 21 3 21 3 17"/><polyline points="17 21 21 21 21 17"/>
                          </svg>
                        </button>
                        {/* Listo */}
                        <button onClick={() => marcarCompletado(prod.id)} title="Añadir a canasta"
                          className="w-9 h-9 bg-[#00b074] rounded-xl flex items-center justify-center text-white">
                          <CheckCircle2 size={15} />
                        </button>
                        {/* Agotado */}
                        <button onClick={() => setAgotadoOpen(prod.id)} title="Sin stock"
                          className="w-9 h-9 bg-[#2d3748] rounded-xl flex items-center justify-center text-[#ff9f1c]">
                          <AlertTriangle size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {listo && (
              <button onClick={() => router.push(`/caja/${id}`)}
                className="w-full mt-4 bg-[#ff9f1c] text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 text-base shadow-lg shadow-[#ff9f1c]/30 active:scale-95 transition">
                🛒 Ir a Cajas / Facturar SRI →
              </button>
            )}
          </div>
        )}

        {/* TAB: Chat */}
        {tab === 'chat' && (
          <div className="flex flex-col h-full px-4 pt-4 pb-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Chat con cliente</p>
              <a href={waLink} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 bg-[#25D366]/20 border border-[#25D366]/30 text-[#25D366] text-xs font-semibold px-3 py-1.5 rounded-xl">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                WhatsApp
              </a>
            </div>
            <div className="flex-1 space-y-2 mb-4 min-h-[200px]">
              {mensajes.length === 0 && (
                <div className="text-center py-10 space-y-2">
                  <MessageCircle size={32} className="text-[#2d3748] mx-auto" />
                  <p className="text-gray-600 text-sm">Sin mensajes. Escribe al cliente o usa WhatsApp.</p>
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
                placeholder="Escribe un mensaje..."
                className="flex-1 bg-[#181d24] border border-[#2d3748] text-white rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-[#00b074]"
              />
              <button onClick={enviarMensaje}
                className="w-12 h-12 bg-[#00b074] rounded-2xl flex items-center justify-center text-white font-bold">→</button>
            </div>
          </div>
        )}

        {/* TAB: Entrega */}
        {tab === 'entrega' && (
          <div className="px-4 pt-4 space-y-4">
            <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Datos de entrega</p>
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
              <button onClick={() => router.push(`/caja/${id}`)}
                className="w-full bg-[#ff9f1c] text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 text-base shadow-lg shadow-[#ff9f1c]/30 active:scale-95 transition">
                🛒 Ir a Cajas / Facturar SRI →
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom Nav ── */}
      <div className="bg-[#181d24] border-t border-[#2d3748] flex shrink-0">
        {([
          { key: 'lista',   label: 'Lista',       Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
          { key: 'chat',    label: 'Chat Cliente', Icon: () => <MessageCircle size={20} /> },
          { key: 'entrega', label: 'Entrega',      Icon: () => <Truck size={20} />, disabled: !listo },
        ] as any[]).map(({ key, label, Icon, disabled }) => (
          <button key={key} onClick={() => !disabled && setTab(key as Tab)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition
              ${tab === key ? 'text-[#00b074]' : disabled ? 'text-gray-700 cursor-not-allowed' : 'text-gray-500'}`}>
            <Icon />
            <span className="text-[10px] font-semibold">{label}</span>
          </button>
        ))}
      </div>

      <style>{`@keyframes scan { 0%,100%{top:8%} 50%{top:82%} }`}</style>
    </div>
  )
}
