'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { ArrowLeft, Loader2, CheckCircle2, ShieldAlert, RefreshCw, Camera, Plus, Minus } from 'lucide-react'
import QrCode from '@/components/QrCode'

export default function TraspasoPage() {
  const { id: asignacionId } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [traspasado, setTraspasado] = useState(false)
  const [nuevoRider, setNuevoRider] = useState('')
  const [asig, setAsig] = useState<any>(null)

  // Código de traspaso real (migration_traspaso_seguro.sql): token de 128
  // bits para el QR + código visual de 6 caracteres para digitar a mano,
  // generados por crear_traspaso_shopper() con expiración de 8 minutos.
  // Ya no es el UUID de la asignación ni un PIN sin expirar.
  const [handoffId, setHandoffId] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [codigoVisual, setCodigoVisual] = useState('')
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [segundosRestantes, setSegundosRestantes] = useState(0)
  const [generando, setGenerando] = useState(false)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Evidencia de empaque (migration_evidencia_empaque_traspaso.sql): antes
  // de generar el código de traspaso, el comprador declara cuántos bultos
  // arma y toma una foto del interior de cada uno antes de sellarlo. El
  // servidor exige esto (crear_traspaso_shopper ahora pide p_bultos y
  // valida que exista foto por cada uno) -- aquí solo se guía al usuario
  // para que no choque con el error recién al intentar generar el código.
  const [bultos, setBultos] = useState(1)
  // Un bulto puede llevar más de una foto (fundas grandes tipo Tía).
  const [fotosBultos, setFotosBultos] = useState<Record<number, string[]>>({})
  const [subiendoBulto, setSubiendoBulto] = useState<number | null>(null)
  const [errorEmpaque, setErrorEmpaque] = useState('')
  const codigoGenerado = !!token

  // Consolidación: si el pedido se repartió entre varios compradores (una
  // asignación por tienda -- migration_asignaciones_por_tienda.sql), el
  // traspaso al repartidor es UNO solo para todo el pedido y no se puede
  // generar hasta que TODAS las tiendas terminen. Esto se muestra de forma
  // clara aquí en vez de que el shopper solo choque con el error del
  // servidor al intentar generar el código.
  const [tiendasHermanas, setTiendasHermanas] = useState<{ tienda_nombre: string | null; estado: string; esLaMia: boolean }[]>([])
  const todasLasTiendasListas = tiendasHermanas.length === 0 || tiendasHermanas.every(t => t.estado === 'recolectado')

  async function subirFotoBulto(n: number, file: File) {
    if (!asig?.pedido_id) return
    setErrorEmpaque('')
    setSubiendoBulto(n)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      const path = `empaque/${asig.pedido_id}/bulto-${n}-${Date.now()}.${ext}`
      const { error: errUp } = await supabase.storage
        .from('comprobantes-proveedores')
        .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'image/jpeg' })
      if (errUp) throw errUp
      const { error: errRpc } = await supabase.rpc('registrar_foto_empaque', {
        p_pedido_id: asig.pedido_id, p_bulto_numero: n, p_foto_path: path, p_asignacion_id: asignacionId,
      })
      if (errRpc) throw errRpc
      setFotosBultos(prev => ({ ...prev, [n]: [...(prev[n] ?? []), path] }))
    } catch (e: any) {
      setErrorEmpaque(e.message || `No se pudo subir la foto del bulto ${n}`)
    } finally {
      setSubiendoBulto(null)
    }
  }

  const faltanFotos = Array.from({ length: bultos }, (_, i) => i + 1).some(n => !fotosBultos[n]?.length)

  async function generarCodigo() {
    setError('')
    setGenerando(true)
    try {
      const { data, error: errRpc } = await supabase.rpc('crear_traspaso_shopper', {
        p_asignacion_id: asignacionId,
        p_bultos: bultos,
      })
      if (errRpc) throw errRpc
      const row = Array.isArray(data) ? data[0] : data
      setHandoffId(row.handoff_id)
      setToken(row.token)
      setCodigoVisual(row.codigo_visual)
      setExpiresAt(new Date(row.expires_at))
    } catch (e: any) {
      setError(e.message || 'No se pudo generar el código de traspaso')
    } finally {
      setGenerando(false)
    }
  }

  async function cargar() {
    setError('')
    try {
      const { data, error: errAsig } = await supabase
        .from('rep_asignaciones')
        .select('*, ol_pedidos(numero, nombre_cliente, total)')
        .eq('id', asignacionId)
        .single()

      if (errAsig || !data) {
        setError('No se pudo encontrar la información del pedido asignado.')
        setCargando(false)
        return
      }

      setAsig(data)

      // Estado de las tiendas hermanas del mismo pedido (si lo repartieron
      // entre varios compradores). Vía RPC (no consulta directa): el RLS de
      // rep_asignaciones solo deja ver la fila propia, así que un shopper
      // no vería el estado de la tienda de otro comprador sin esto (ver
      // migration_tiendas_hermanas_pedido.sql). Si solo hay una asignación
      // (esta misma), tiendasHermanas queda vacío y no se muestra nada.
      if (data.pedido_id) {
        const { data: hermanas } = await supabase
          .rpc('tiendas_hermanas_pedido', { p_pedido_id: data.pedido_id })
        if (hermanas && hermanas.length > 1) {
          setTiendasHermanas(hermanas.map((h: any) => ({
            tienda_nombre: h.tienda_nombre ?? null,
            estado: h.estado,
            esLaMia: h.asignacion_id === asignacionId,
          })))
        }
      }

      // Si las fotos de empaque ya se tomaron en caja (donde físicamente se
      // arman los bultos), no se vuelven a pedir aquí -- se reutilizan. Se
      // filtra por ESTA asignación puntual: si el pedido tiene más de un
      // comprador, cada uno empaca y fotografía lo suyo por separado, y no
      // deben mezclarse los bultos de uno con los del otro.
      if (data.pedido_id) {
        const { data: fotos } = await supabase
          .from('rep_pedido_empaque_fotos')
          .select('bulto_numero, foto_url')
          .eq('pedido_id', data.pedido_id)
          .eq('asignacion_id', asignacionId)
        if (fotos && fotos.length > 0) {
          const mapa: Record<number, string[]> = {}
          let maxBulto = 1
          for (const f of fotos) {
            mapa[f.bulto_numero] = [...(mapa[f.bulto_numero] ?? []), f.foto_url]
            if (f.bulto_numero > maxBulto) maxBulto = f.bulto_numero
          }
          setFotosBultos(mapa)
          setBultos(maxBulto)
        }
      }

      if (data.estado === 'en_ruta') {
        const { data: rep } = await supabase
          .from('rep_repartidores')
          .select('id, nombre')
          .eq('user_id', user!.id)
          .single()

        if (rep && data.repartidor_id !== rep.id) {
          const { data: nRider } = await supabase
            .from('rep_repartidores')
            .select('nombre')
            .eq('id', data.repartidor_id)
            .single()

          setNuevoRider(nRider?.nombre ?? 'Otro motorizado')
          setTraspasado(true)
        }
      }
      // Ya no se genera el código automáticamente: primero hay que declarar
      // bultos y subir su foto (ver bloque de evidencia de empaque abajo).
      setCargando(false)
    } catch {
      setError('Error de comunicación con Supabase.')
      setCargando(false)
    }
  }

  useEffect(() => {
    if (!user) return
    cargar()

    const canal = supabase
      .channel('rep_asignaciones_traspaso')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rep_asignaciones',
        filter: `id=eq.${asignacionId}`
      }, async (payload: any) => {
        const d = payload.new
        if (d.estado === 'en_ruta') {
          const { data: rep } = await supabase
            .from('rep_repartidores')
            .select('id')
            .eq('user_id', user.id)
            .single()

          if (rep && d.repartidor_id !== rep.id) {
            const { data: nRider } = await supabase
              .from('rep_repartidores')
              .select('nombre')
              .eq('id', d.repartidor_id)
              .single()

            setNuevoRider(nRider?.nombre ?? 'Otro motorizado')
            setTraspasado(true)
          }
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(canal) }
  }, [asignacionId, user])

  // Cuando el pedido está repartido entre varias tiendas, se escucha en
  // vivo el estado de las asignaciones hermanas -- así el shopper ve el
  // check ponerse verde apenas la otra tienda termina, sin tener que
  // recargar la pantalla a cada rato.
  useEffect(() => {
    if (!asig?.pedido_id) return
    const canal = supabase
      .channel(`rep_asignaciones_hermanas_${asig.pedido_id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rep_asignaciones',
        filter: `pedido_id=eq.${asig.pedido_id}`
      }, async () => {
        const { data: hermanas } = await supabase
          .rpc('tiendas_hermanas_pedido', { p_pedido_id: asig.pedido_id })
        if (hermanas && hermanas.length > 1) {
          setTiendasHermanas(hermanas.map((h: any) => ({
            tienda_nombre: h.tienda_nombre ?? null,
            estado: h.estado,
            esLaMia: h.asignacion_id === asignacionId,
          })))
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(canal) }
  }, [asig?.pedido_id])

  // Cuenta regresiva + regeneración automática al expirar.
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current)
    if (!expiresAt || traspasado) return
    tickRef.current = setInterval(() => {
      const restante = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000))
      setSegundosRestantes(restante)
      if (restante === 0 && !generando) {
        generarCodigo()
      }
    }, 1000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [expiresAt, traspasado])

  if (cargando) return (
    <div className="min-h-screen bg-[#0c0f12] flex items-center justify-center">
      <Loader2 size={28} className="animate-spin text-[#00b074]" />
    </div>
  )

  if (error && !asig) return (
    <div className="min-h-screen bg-[#0c0f12] text-white flex flex-col items-center justify-center p-6 text-center">
      <ShieldAlert size={48} className="text-red-500 mb-4" />
      <h1 className="text-lg font-black text-white">Error de Carga</h1>
      <p className="text-gray-400 text-xs mt-2 max-w-xs">{error || 'Pedido no válido.'}</p>
      <button onClick={() => router.back()} className="mt-6 bg-slate-800 text-xs font-bold px-4 py-2.5 rounded-xl text-white">
        Volver
      </button>
    </div>
  )

  const numPedido = String(asig.ol_pedidos?.numero).padStart(4, '0')
  const mm = String(Math.floor(segundosRestantes / 60)).padStart(1, '0')
  const ss = String(segundosRestantes % 60).padStart(2, '0')

  return (
    <div className="min-h-screen bg-[#0c0f12] text-white flex flex-col pb-10">
      <div className="bg-[#181d24] border-b border-[#2d3748] px-4 pt-10 pb-4 flex items-center gap-3 shrink-0">
        <button onClick={() => router.back()} className="p-1.5 hover:bg-white/5 rounded-lg">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="font-extrabold text-sm text-white">Traspaso de Compra</h1>
          <p className="text-gray-500 text-[10px]">Pedido #{numPedido} · {asig.ol_pedidos?.nombre_cliente}</p>
        </div>
        <button onClick={generarCodigo} disabled={generando} className="ml-auto p-1.5 hover:bg-white/5 rounded-lg text-gray-400">
          <RefreshCw size={14} className={generando ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto space-y-6">

        {traspasado ? (
          <div className="bg-[#181d24] border border-[#00b074]/30 rounded-3xl p-6 space-y-4 animate-fade-in w-full">
            <div className="w-14 h-14 bg-[#00b074]/10 rounded-full flex items-center justify-center mx-auto text-[#00b074]">
              <CheckCircle2 size={32} />
            </div>
            <div className="space-y-1">
              <h2 className="text-white font-extrabold text-base">¡Traspaso Completado!</h2>
              <p className="text-gray-400 text-xs">
                La entrega del pedido #{numPedido} ha sido asumida por el motorizado:
              </p>
              <p className="text-[#00b074] font-black text-sm pt-1">{nuevoRider}</p>
            </div>
            <button
              onClick={() => router.push('/repartidor')}
              className="w-full bg-[#00b074] hover:bg-[#008f5d] text-white font-bold py-3 rounded-2xl text-xs transition-all shadow-md">
              Volver a mis compras
            </button>
          </div>
        ) : !codigoGenerado ? (
          <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-4 w-full text-left">
            {/* Consolidación: este pedido se repartió entre varios
                compradores (una asignación por tienda) -- el traspaso al
                repartidor es UNO solo para todo el pedido, así que hay que
                esperar a que TODAS las tiendas terminen de comprar/facturar. */}
            {tiendasHermanas.length > 0 && (
              <div className={`rounded-2xl p-4 space-y-2 border ${
                todasLasTiendasListas ? 'bg-[#00b074]/10 border-[#00b074]/30' : 'bg-[#ff9f1c]/10 border-[#ff9f1c]/30'
              }`}>
                <p className={`text-[11px] font-bold uppercase tracking-wider ${todasLasTiendasListas ? 'text-[#00b074]' : 'text-[#ff9f1c]'}`}>
                  {todasLasTiendasListas ? '✓ Todas las tiendas listas' : '⏳ Esperando a las otras tiendas'}
                </p>
                <div className="space-y-1.5">
                  {tiendasHermanas.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {t.estado === 'recolectado'
                        ? <CheckCircle2 size={14} className="text-[#00b074] shrink-0" />
                        : <Loader2 size={14} className="text-[#ff9f1c] shrink-0 animate-spin" />}
                      <span className="text-white font-bold">{t.tienda_nombre ?? 'Tienda'}</span>
                      {t.esLaMia && <span className="text-gray-500">(la tuya)</span>}
                      <span className={`ml-auto ${t.estado === 'recolectado' ? 'text-[#00b074]' : 'text-[#ff9f1c]'}`}>
                        {t.estado === 'recolectado' ? 'Lista' : 'Comprando'}
                      </span>
                    </div>
                  ))}
                </div>
                {!todasLasTiendasListas && (
                  <p className="text-[10px] text-gray-400 leading-relaxed pt-1 border-t border-white/5">
                    El código de traspaso se genera una sola vez para todo el pedido -- cuando la otra tienda termine, vuelve a esta pantalla.
                  </p>
                )}
              </div>
            )}

            {todasLasTiendasListas && (
            <>
            <div className="space-y-1">
              <span className="text-[#00b074] text-[10px] font-bold uppercase tracking-wider bg-[#00b074]/10 px-3 py-1 rounded-full">
                Antes de traspasar
              </span>
              <h2 className="text-white text-base font-extrabold">Evidencia de Empaque</h2>
              <p className="text-gray-400 text-xs">
                Toma una foto del interior de cada bulto/funda antes de sellarlo. Es obligatorio para generar el código de traspaso.
              </p>
            </div>

            <div className="flex items-center justify-between bg-[#0c0f12] border border-[#2d3748] rounded-2xl px-4 py-3">
              <span className="text-gray-300 text-xs font-bold">Cantidad de bultos/fundas</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setBultos(b => Math.max(1, b - 1))}
                  className="w-7 h-7 rounded-lg bg-[#2d3748] text-white flex items-center justify-center">
                  <Minus size={14} />
                </button>
                <span className="text-white font-black text-base w-5 text-center">{bultos}</span>
                <button
                  onClick={() => setBultos(b => Math.min(10, b + 1))}
                  className="w-7 h-7 rounded-lg bg-[#2d3748] text-white flex items-center justify-center">
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {errorEmpaque && (
              <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-400 p-2.5 rounded-xl text-xs">
                <ShieldAlert size={14} className="shrink-0" />
                <span>{errorEmpaque}</span>
              </div>
            )}

            <div className="space-y-2">
              {Array.from({ length: bultos }, (_, i) => i + 1).map(n => {
                const fotos = fotosBultos[n] ?? []
                const tope = fotos.length >= 6
                return (
                  <div key={n} className={`rounded-2xl px-4 py-3 border transition space-y-1.5 ${
                    fotos.length ? 'bg-[#00b074]/10 border-[#00b074]/30' : 'bg-[#0c0f12] border-[#2d3748]'
                  }`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-bold text-white">
                        Bulto {n} {fotos.length > 0 && `· ${fotos.length} foto${fotos.length > 1 ? 's' : ''}`}
                      </span>
                      <label className={`text-[11px] font-bold flex items-center gap-1.5 cursor-pointer ${tope ? 'opacity-40 pointer-events-none' : fotos.length ? 'text-[#00b074]' : 'text-gray-400'}`}>
                        {subiendoBulto === n
                          ? <Loader2 size={14} className="animate-spin" />
                          : fotos.length
                            ? <><Camera size={14} /> Agregar otra</>
                            : <><Camera size={14} /> Tomar foto</>}
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) subirFotoBulto(n, f) }}
                        />
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-[9px] text-gray-500 text-left">Para bultos grandes puedes tomar varias fotos del mismo bulto desde distintos ángulos.</p>

            <button
              onClick={generarCodigo}
              disabled={faltanFotos || generando}
              className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-40 text-white font-bold py-3 rounded-2xl text-xs transition-all shadow-md flex items-center justify-center gap-2">
              {generando ? <Loader2 size={14} className="animate-spin" /> : null}
              Generar código de traspaso
            </button>
            {error && (
              <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-400 p-2.5 rounded-xl text-xs">
                <ShieldAlert size={14} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}
            </>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <span className="text-[#00b074] text-[10px] font-bold uppercase tracking-wider bg-[#00b074]/10 px-3 py-1 rounded-full">
                Listo para Recogida
              </span>
              <h2 className="text-white text-base font-extrabold">Código de Traspaso Seguro</h2>
              <p className="text-gray-400 text-xs">
                Presenta este código al motorizado para transferirle las compras.
              </p>
            </div>

            {error && (
              <div className="flex items-center justify-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-400 p-2.5 rounded-xl text-xs w-full">
                <ShieldAlert size={14} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {token && (
              <>
                <div className="bg-white p-4 rounded-3xl shadow-xl shadow-black/40 border border-slate-200/10 flex items-center justify-center">
                  <QrCode data={token} size={192} />
                </div>

                <div className="w-full bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-2">
                  <p className="text-gray-500 text-[10px] uppercase font-bold tracking-wider">O digita este código de Traspaso</p>
                  <div className="flex justify-center gap-2">
                    {codigoVisual.split('').map((char, index) => (
                      <span key={index} className="w-9 h-12 bg-[#0c0f12] border border-[#2d3748] text-white font-black text-lg flex items-center justify-center rounded-xl font-mono shadow-inner shadow-black/50">
                        {char}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 leading-normal pt-1">
                    Válido por {mm}:{ss} minuto(s). Se renueva solo al expirar.
                  </p>
                </div>

                <div className="flex items-center gap-1.5 text-gray-500 text-[11px] animate-pulse">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full" />
                  <span>Esperando que el motorizado escanee o digite el código...</span>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
