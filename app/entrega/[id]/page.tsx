'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, CheckCircle2, MapPin, Phone, Navigation, Package, Check, X } from 'lucide-react'

function sonDireccionesSimilares(dir1: string | null | undefined, dir2: string | null | undefined): boolean {
  if (!dir1 || !dir2) return false
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const c1 = clean(dir1)
  const c2 = clean(dir2)
  if (c1 === c2) return true
  if (c1.length > 8 && c2.length > 8 && (c1.includes(c2) || c2.includes(c1))) return true
  
  const palabras1 = dir1.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3)
  const palabras2 = dir2.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3)
  
  if (palabras1.length === 0 || palabras2.length === 0) return false
  
  const coincidentes = palabras1.filter(p => palabras2.includes(p))
  const ratio = coincidentes.length / Math.min(palabras1.length, palabras2.length)
  return ratio >= 0.5
}

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

  // "No pude entregar": motivo estructurado en vez de solo resolverlo por
  // WhatsApp sin dejar rastro -- las columnas motivo_fallo/exitosa ya
  // existian en rep_entregas, no se usaban desde ninguna pantalla.
  const [mostrarFallo, setMostrarFallo] = useState(false)
  const [motivoFallo,  setMotivoFallo]  = useState('')
  const [notasFallo,   setNotasFallo]   = useState('')
  const [noEntregado,  setNoEntregado]  = useState(false)
  const MOTIVOS_FALLO = [
    'Cliente no contesta',
    'Dirección incorrecta o inaccesible',
    'Cliente rechazó el pedido',
    'Cliente pidió reprogramar',
    'Otro',
  ]

  // Confirmación explícita de ubicación de entrega
  const [gpsConfirmado, setGpsConfirmado] = useState<boolean | null>(null)
  const [corrigiendoGps, setCorrigiendoGps] = useState(false)
  const [nuevaGeo, setNuevaGeo] = useState<{ lat: number; lng: number } | null>(null)
  const [obteniendoGps, setObteniendoGps] = useState(false)
  const [referenciaNueva, setReferenciaNueva] = useState('')

  // Proof of Delivery (POD) states
  const [entregaModalOpen, setEntregaModalOpen] = useState(false)
  const [fotoFile, setFotoFile] = useState<File | null>(null)
  const [guardandoEntrega, setGuardandoEntrega] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawingRef = useRef(false)

  const notasLower = (pedido?.notas || '').toLowerCase()
  const esTransferencia = pedido?.metodo_pago === 'transferencia' || notasLower.includes('pago: transferencia') || notasLower.includes('transferencia bancaria')
  const yaPagadoPorTransferencia = esTransferencia && pedido?.pago_confirmado === true

  // Numero de WhatsApp del admin para el boton de incidente -- se carga desde
  // rep_configuracion (clave 'admin_whatsapp') en vez de venir escrito en el
  // codigo, porque todavia no se definio cual es el numero real.
  const [adminWhatsapp, setAdminWhatsapp] = useState<string | null>(null)

  useEffect(() => { cargar() }, [id])

  async function cargar() {
    const { data: asig } = await sb.from('rep_asignaciones').select('*').eq('id', id).single()
    if (!asig) { router.replace('/pedidos'); return }
    const { data: ped }  = await sb.from('ol_pedidos').select('*').eq('id', asig.pedido_id).single()
    const { data: its }  = await sb.from('ol_pedido_items').select('*').eq('pedido_id', asig.pedido_id)

    // Fallback de dirección verified GPS para el número de teléfono
    let geoLatFallback = ped?.geo_lat
    let geoLngFallback = ped?.geo_lng
    if (!geoLatFallback && ped?.telefono) {
      const { data: verifiedDirs } = await sb
        .from('rep_clientes_direcciones')
        .select('direccion, geo_lat, geo_lng')
        .eq('telefono', ped.telefono)
      const matchDir = (verifiedDirs ?? []).find((d: any) => sonDireccionesSimilares(d.direccion, ped.direccion))
      if (matchDir) {
        geoLatFallback = matchDir.geo_lat
        geoLngFallback = matchDir.geo_lng
      }
    }

    const pedidoConFallback = { 
      ...ped, 
      repartidor_id: asig.repartidor_id,
      geo_lat: geoLatFallback,
      geo_lng: geoLngFallback
    }

    setPedido(pedidoConFallback)
    setItems(its ?? [])
    setMonto((ped?.total ?? 0).toFixed(2))
    sb.from('rep_configuracion').select('valor').eq('clave', 'admin_whatsapp').maybeSingle()
      .then(({ data }) => setAdminWhatsapp(data?.valor ?? null))
    // URL del mapa estático
    const q = geoLatFallback && geoLngFallback
      ? `${geoLatFallback},${geoLngFallback}`
      : encodeURIComponent(`${ped?.direccion ?? ''} ${ped?.ciudad ?? ''}`)
    setMapUrl(`https://maps.google.com/maps?q=${q}&z=16&output=embed`)
    setCargando(false)
  }

  function abrirMapa() {
    const q = pedido?.geo_lat && pedido?.geo_lng
      ? `${pedido.geo_lat},${pedido.geo_lng}`
      : encodeURIComponent(`${pedido?.direccion ?? ''} ${pedido?.ciudad ?? ''}`)
    const url = pedido?.geo_lat && pedido?.geo_lng
      ? `https://www.google.com/maps/dir/?api=1&destination=${pedido.geo_lat},${pedido.geo_lng}`
      : `https://maps.google.com/?q=${q}`
    window.open(url, '_blank')
  }

  function capturarUbicacionActual() {
    if (typeof window === 'undefined' || !navigator?.geolocation) return
    setObteniendoGps(true)
    navigator.geolocation.getCurrentPosition(
      p => { setNuevaGeo({ lat: p.coords.latitude, lng: p.coords.longitude }); setObteniendoGps(false) },
      () => setObteniendoGps(false),
      { timeout: 8000, enableHighAccuracy: true }
    )
  }

  useEffect(() => {
    if (!entregaModalOpen) return
    const timer = setTimeout(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'

      const getPos = (e: MouseEvent | TouchEvent) => {
        const rect = canvas.getBoundingClientRect()
        if ('touches' in e) {
          if (e.touches.length === 0) return { x: 0, y: 0 }
          return {
            x: e.touches[0].clientX - rect.left,
            y: e.touches[0].clientY - rect.top
          }
        }
        return {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        }
      }

      const startDrawing = (e: MouseEvent | TouchEvent) => {
        isDrawingRef.current = true
        const pos = getPos(e)
        ctx.beginPath()
        ctx.moveTo(pos.x, pos.y)
      }

      const draw = (e: MouseEvent | TouchEvent) => {
        if (!isDrawingRef.current) return
        e.preventDefault()
        const pos = getPos(e)
        ctx.lineTo(pos.x, pos.y)
        ctx.stroke()
      }

      const stopDrawing = () => {
        isDrawingRef.current = false
      }

      canvas.addEventListener('mousedown', startDrawing)
      canvas.addEventListener('mousemove', draw)
      canvas.addEventListener('mouseup', stopDrawing)
      canvas.addEventListener('mouseleave', stopDrawing)

      canvas.addEventListener('touchstart', startDrawing, { passive: false })
      canvas.addEventListener('touchmove', draw, { passive: false })
      canvas.addEventListener('touchend', stopDrawing)
    }, 150)

    return () => clearTimeout(timer)
  }, [entregaModalOpen])

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  async function finalizarEntregaConPOD() {
    if (!fotoFile) {
      alert('Debes tomar una foto del pedido en la puerta como comprobante.')
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return

    setGuardandoEntrega(true)
    setGuardando(true)

    try {
      const fotoExt = fotoFile.name.split('.').pop() || 'jpg'
      const fotoName = `entregas/${pedido.id}_${Date.now()}.${fotoExt}`
      const { error: errFoto } = await sb.storage
        .from('comprobantes-proveedores')
        .upload(fotoName, fotoFile, { upsert: true })

      if (errFoto) {
        alert('Error al subir la foto de entrega: ' + errFoto.message)
        setGuardandoEntrega(false)
        setGuardando(false)
        return
      }

      const { data: fotoUrlData } = sb.storage
        .from('comprobantes-proveedores')
        .getPublicUrl(fotoName)
      const fotoEntregaUrl = fotoUrlData?.publicUrl || ''

      const firmaBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'))
      if (!firmaBlob) {
        alert('Error al capturar la firma del cliente.')
        setGuardandoEntrega(false)
        setGuardando(false)
        return
      }

      const firmaName = `firmas/${pedido.id}_${Date.now()}.png`
      const { error: errFirma } = await sb.storage
        .from('comprobantes-proveedores')
        .upload(firmaName, firmaBlob, { upsert: true })

      if (errFirma) {
        alert('Error al subir la firma del cliente: ' + errFirma.message)
        setGuardandoEntrega(false)
        setGuardando(false)
        return
      }

      const { data: firmaUrlData } = sb.storage
        .from('comprobantes-proveedores')
        .getPublicUrl(firmaName)
      const firmaClienteUrl = firmaUrlData?.publicUrl || ''

      const geoFinal = corrigiendoGps && nuevaGeo ? nuevaGeo : { lat: pedido.geo_lat, lng: pedido.geo_lng }
      const referenciasFinal = corrigiendoGps && referenciaNueva.trim()
        ? [pedido.referencias, referenciaNueva.trim()].filter(Boolean).join(' · ')
        : pedido.referencias

      await sb.from('rep_asignaciones').update({ 
        estado: 'entregado', 
        foto_entrega_url: fotoEntregaUrl,
        firma_cliente_url: firmaClienteUrl,
        entrega_lat: geoFinal.lat ?? null,
        entrega_lng: geoFinal.lng ?? null,
        updated_at: new Date().toISOString() 
      }).eq('id', id)

      await sb.from('ol_pedidos').update({
        estado: 'entregado',
        geo_lat: geoFinal.lat,
        geo_lng: geoFinal.lng,
        referencias: referenciasFinal,
      }).eq('id', pedido.id)

      if (pedido.user_id && corrigiendoGps && nuevaGeo) {
        try {
          const { data: dirs } = await sb
            .from('ol_direcciones_cliente')
            .select('id')
            .eq('user_id', pedido.user_id)
            .eq('direccion_texto', pedido.direccion)

          if (dirs && dirs.length > 0) {
            await sb.from('ol_direcciones_cliente')
              .update({ geo_lat: geoFinal.lat, geo_lng: geoFinal.lng, referencias: referenciasFinal })
              .eq('id', dirs[0].id)
          }
        } catch (e) {
          console.error("Error al actualizar ubicación del cliente:", e)
        }
      }

      // Guardar también en rep_clientes_direcciones para la agenda del número de teléfono
      if (pedido.telefono && geoFinal.lat && geoFinal.lng) {
        try {
          const { data: extDir } = await sb
            .from('rep_clientes_direcciones')
            .select('id, direccion')
            .eq('telefono', pedido.telefono)

          const matchDir = (extDir ?? []).find((d: any) => sonDireccionesSimilares(d.direccion, pedido.direccion))
          if (matchDir) {
            await sb.from('rep_clientes_direcciones')
              .update({
                geo_lat: geoFinal.lat,
                geo_lng: geoFinal.lng,
                verificada: true,
                updated_at: new Date().toISOString()
              })
              .eq('id', matchDir.id)
          } else {
            await sb.from('rep_clientes_direcciones')
              .insert({
                telefono: pedido.telefono,
                nombre_direccion: pedido.direccion ? pedido.direccion.slice(0, 15) : 'Nueva Dirección',
                direccion: pedido.direccion || 'Dirección de Entrega',
                ciudad: pedido.ciudad || 'Ciudad',
                referencias: referenciasFinal || pedido.referencias || '',
                geo_lat: geoFinal.lat,
                geo_lng: geoFinal.lng,
                verificada: true
              })
          }
        } catch (e) {
          console.error("Error al guardar en rep_clientes_direcciones:", e)
        }
      }

      const montoFinal = esTransferencia ? 0 : parseFloat(monto)

      await sb.from('rep_entregas').insert({
        asignacion_id: id, repartidor_id: pedido.repartidor_id, pedido_id: pedido.id,
        entregado_at: new Date().toISOString(), monto_cobrado: montoFinal,
        metodo_pago: esTransferencia ? 'transferencia' : 'efectivo', exitosa: true,
        geo_lat: geoFinal.lat ?? null, geo_lng: geoFinal.lng ?? null,
        foto_url: fotoEntregaUrl,
        firma_cliente: firmaClienteUrl
      })

      if (!esTransferencia && montoFinal > 0) {
        await sb.from('rep_transacciones_caja').insert({
          repartidor_id: pedido.repartidor_id,
          pedido_id:     pedido.id,
          tipo:          'ingreso_entrega',
          monto:         montoFinal,
          estado:        'pendiente'
        })
      }

      setEntregado(true)
      setEntregaModalOpen(false)

    } catch (err: any) {
      alert('Error al guardar la entrega: ' + err.message)
    } finally {
      setGuardandoEntrega(false)
      setGuardando(false)
    }
  }

  async function confirmarFallo() {
    if (!motivoFallo) { setError('Selecciona un motivo'); return }
    setGuardando(true); setError('')

    await sb.from('rep_asignaciones').update({ estado: 'devuelto', updated_at: new Date().toISOString() }).eq('id', id)

    await sb.from('rep_entregas').insert({
      asignacion_id: id, repartidor_id: pedido.repartidor_id, pedido_id: pedido.id,
      entregado_at: new Date().toISOString(), monto_cobrado: 0,
      exitosa: false, motivo_fallo: motivoFallo + (notasFallo.trim() ? ` — ${notasFallo.trim()}` : ''),
      geo_lat: pedido.geo_lat ?? null, geo_lng: pedido.geo_lng ?? null,
    })

    setGuardando(false); setMostrarFallo(false); setNoEntregado(true)
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
          <span className="text-gray-400">{esTransferencia ? 'Método de Pago' : 'Total cobrado en efectivo'}</span>
          <span className="text-white font-semibold">{esTransferencia ? (pedido?.pago_confirmado === true ? 'Transferencia (Confirmada)' : 'Transferencia (Por confirmar)') : `$${parseFloat(monto).toFixed(2)}`}</span>
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

  if (noEntregado) return (
    <div className="min-h-screen bg-[#0c0f12] flex flex-col items-center justify-center px-6 text-center space-y-5">
      <div className="w-28 h-28 bg-red-500/15 border-2 border-red-500/30 rounded-full flex items-center justify-center">
        <X size={52} className="text-red-400" />
      </div>
      <div>
        <h1 className="text-white font-bold text-2xl">Entrega no completada</h1>
        <p className="text-gray-400 text-sm mt-1">
          Se registró que el pedido de <span className="text-white">{pedido?.nombre_cliente}</span> no se pudo entregar. El administrador ya puede verlo y reasignarlo.
        </p>
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

        {/* Confirmación explícita de ubicación de entrega */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MapPin size={14} className="text-gray-400" />
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">¿Es correcta esta ubicación?</p>
          </div>

          {gpsConfirmado === null && !corrigiendoGps && (
            <div className="flex gap-2">
              <button
                onClick={() => { setGpsConfirmado(true); setCorrigiendoGps(false) }}
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#00b074]/20 border border-[#00b074]/40 text-[#00b074] font-bold py-2.5 rounded-xl text-sm"
              >
                <Check size={14} /> Sí, es correcta
              </button>
              <button
                onClick={() => { setGpsConfirmado(false); setCorrigiendoGps(true) }}
                className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/15 border border-red-500/30 text-red-400 font-bold py-2.5 rounded-xl text-sm"
              >
                <X size={14} /> No, corregir
              </button>
            </div>
          )}

          {gpsConfirmado === true && (
            <span className="inline-flex items-center gap-1 bg-[#00b074]/15 border border-[#00b074]/30 rounded-full px-2.5 py-0.5 text-[10px] font-bold text-[#00b074] uppercase tracking-wider">
              📍 Ubicación confirmada
            </span>
          )}

          {corrigiendoGps && (
            <div className="space-y-2.5 border-t border-[#2d3748] pt-3">
              <button
                onClick={capturarUbicacionActual}
                disabled={obteniendoGps}
                className="w-full flex items-center justify-center gap-2 bg-[#0c0f12] border border-[#2d3748] text-white font-semibold py-2.5 rounded-xl text-xs"
              >
                {obteniendoGps ? <Loader2 size={14} className="animate-spin" /> : <Navigation size={14} className="text-[#00b074]" />}
                {nuevaGeo ? 'Ubicación capturada · tocar para repetir' : 'Usar mi ubicación actual'}
              </button>
              {nuevaGeo && (
                <p className="text-[10px] text-gray-500 text-center">Lat: {nuevaGeo.lat.toFixed(5)} · Lng: {nuevaGeo.lng.toFixed(5)}</p>
              )}
              <input
                type="text"
                value={referenciaNueva}
                onChange={e => setReferenciaNueva(e.target.value)}
                placeholder="Referencia para futuras entregas (ej: casa azul, portón negro...)"
                className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-xl px-3 py-2.5 text-xs placeholder-gray-600 focus:outline-none focus:border-[#00b074]"
              />
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
                const formattedPhone = cleanPhone.startsWith('0') ? '593' + cleanPhone.slice(1) : (cleanPhone.startsWith('9') && cleanPhone.length === 9 ? '593' + cleanPhone : cleanPhone)
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
                const formattedPhone = cleanPhone.startsWith('0') ? '593' + cleanPhone.slice(1) : (cleanPhone.startsWith('9') && cleanPhone.length === 9 ? '593' + cleanPhone : cleanPhone)
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
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">
              {esTransferencia ? 'Estado del pago' : 'Confirmar cobro en efectivo'}
            </p>
          </div>

          {esTransferencia ? (
            <div className={`border rounded-xl px-3 py-3 flex items-center gap-2 ${
              pedido?.pago_confirmado === true 
                ? 'bg-[#00b074]/10 border-[#00b074]/30 text-[#00b074]' 
                : 'bg-amber-500/10 border-amber-500/30 text-amber-500'
            }`}>
              <CheckCircle2 size={16} className="shrink-0" />
              <p className="text-xs font-semibold">
                {pedido?.pago_confirmado === true
                  ? 'Este pedido ya fue pagado por transferencia y confirmado por administración. No cobres efectivo al cliente.'
                  : 'Este pedido es de Transferencia (Por Confirmar). Valida el comprobante antes de entregar. No cobres efectivo.'}
              </p>
            </div>
          ) : (
            <>
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
            </>
          )}
          {error && <p className="text-red-400 text-xs text-center">{error}</p>}
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 px-4 pb-6 pt-3 bg-gradient-to-t from-[#0c0f12] via-[#0c0f12]/95 to-transparent space-y-2">
        <button 
          onClick={() => {
            if (!esTransferencia && (!monto.trim() || isNaN(parseFloat(monto)))) {
              setError('Ingresa el monto cobrado')
              return
            }
            if (gpsConfirmado === null) { setError('Confirma la ubicación de entrega antes de continuar'); return }
            if (corrigiendoGps && !nuevaGeo) { setError('Captura la nueva ubicación GPS antes de continuar'); return }
            setError('')
            setEntregaModalOpen(true)
          }} 
          disabled={guardando}
          className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-60 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 text-base shadow-lg shadow-[#00b074]/30 cursor-pointer"
        >
          {guardando ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
          {guardando ? 'Registrando entrega...' : '✅ Confirmar entrega'}
        </button>
        <button onClick={() => setMostrarFallo(true)} disabled={guardando}
          className="w-full text-red-400 font-semibold py-2 text-xs">
          No pude entregar este pedido
        </button>
      </div>

      {/* Modal: reportar fallo de entrega con motivo estructurado */}
      {mostrarFallo && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl w-full max-w-md p-5 space-y-4">
            <h3 className="text-white font-bold text-base">¿Por qué no se pudo entregar?</h3>
            <div className="space-y-2">
              {MOTIVOS_FALLO.map(m => (
                <button key={m} onClick={() => setMotivoFallo(m)}
                  className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-semibold border transition ${
                    motivoFallo === m
                      ? 'bg-red-500/15 border-red-500/40 text-red-300'
                      : 'bg-[#0c0f12] border-[#2d3748] text-gray-400'
                  }`}>
                  {m}
                </button>
              ))}
            </div>
            <textarea
              value={notasFallo}
              onChange={e => setNotasFallo(e.target.value)}
              placeholder="Detalle adicional (opcional)"
              rows={2}
              className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-xl px-3 py-2.5 text-xs placeholder-gray-600 focus:outline-none focus:border-red-400"
            />
            {error && <p className="text-red-400 text-xs text-center">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setMostrarFallo(false); setError('') }}
                className="flex-1 bg-gray-800 text-gray-300 font-bold py-3 rounded-xl text-sm">
                Cancelar
              </button>
              <button onClick={confirmarFallo} disabled={guardando}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2">
                {guardando ? <Loader2 size={14} className="animate-spin" /> : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmación de Entrega (Proof of Delivery) */}
      {entregaModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 select-none">
          <div className="bg-[#181d24] border border-[#2d3748] rounded-t-3xl sm:rounded-3xl p-5 w-full sm:max-w-sm space-y-4 max-h-[90vh] overflow-y-auto text-white">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-white text-base flex items-center gap-1.5">
                📦 Confirmar Entrega
              </h3>
              <button 
                onClick={() => {
                  setFotoFile(null)
                  setEntregaModalOpen(false)
                }} 
                className="text-slate-400 p-1 cursor-pointer hover:text-white"
                disabled={guardandoEntrega}
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-[#0c0f12] border border-[#2d3748] rounded-xl px-3 py-2.5 text-xs text-gray-300">
              <div className="font-extrabold text-white">Pedido #{pedido?.numero}</div>
              <div>Cliente: <span className="font-bold text-gray-200">{pedido?.nombre_cliente}</span></div>
              <div>Total cobrado: <span className="font-bold text-[#00b074]">${yaPagadoPorTransferencia ? '0.00 (Transferencia)' : parseFloat(monto).toFixed(2)}</span></div>
            </div>

            {/* Paso 1: Foto en Puerta */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">Paso 1: Foto del Pedido en Puerta *</label>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={e => {
                  if (e.target.files && e.target.files[0]) {
                    setFotoFile(e.target.files[0])
                  }
                }}
                className="hidden"
                id="foto-entrega-hybrid"
                disabled={guardandoEntrega}
              />
              <label 
                htmlFor="foto-entrega-hybrid" 
                className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-4 cursor-pointer hover:bg-white/5 transition ${
                  fotoFile ? 'border-emerald-500 bg-emerald-500/10' : 'border-[#2d3748] bg-[#0c0f12]'
                }`}
              >
                {fotoFile ? (
                  <div className="text-center space-y-0.5">
                    <span className="text-xs text-emerald-400 font-bold">✓ Foto del pedido cargada</span>
                    <p className="text-[9px] text-gray-400 truncate max-w-[200px]">{fotoFile.name}</p>
                  </div>
                ) : (
                  <div className="text-center space-y-1 text-gray-400">
                    <span className="text-xs font-bold text-white">📸 Tomar foto de las bolsas en puerta</span>
                    <p className="text-[9px] text-gray-500">Presiona para abrir la cámara de tu celular</p>
                  </div>
                )}
              </label>
            </div>

            {/* Paso 2: Firma del Cliente */}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">Paso 2: Firma del Cliente *</label>
              <div className="relative border border-[#2d3748] rounded-2xl overflow-hidden bg-white">
                <canvas 
                  ref={canvasRef} 
                  width={340} 
                  height={150} 
                  className="w-full h-[150px] touch-none block bg-transparent cursor-crosshair"
                />
                <button
                  type="button"
                  onClick={clearCanvas}
                  disabled={guardandoEntrega}
                  className="absolute bottom-2 right-2 bg-slate-200/90 hover:bg-slate-300 text-slate-800 font-bold px-2.5 py-1 rounded-lg text-[9px] transition-colors cursor-pointer select-none"
                >
                  Limpiar lienzo
                </button>
              </div>
            </div>

            <button
              onClick={finalizarEntregaConPOD}
              disabled={guardandoEntrega}
              className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-60 text-white font-bold py-3.5 rounded-2xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all active:scale-95"
            >
              {guardandoEntrega ? <Loader2 size={16} className="animate-spin" /> : null}
              {guardandoEntrega ? 'Subiendo firmas y fotos...' : 'Finalizar Entrega (Guardar POD)'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
