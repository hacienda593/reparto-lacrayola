'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, CheckCircle2, AlertTriangle, Shield, CreditCard, Camera, ArrowRight } from 'lucide-react'

function parseDatosFactura(notas: string) {
  if (!notas) return null
  const match = notas.match(/\[FACTURA:\s*([^\]]+)\]/)
  if (!match) return null
  const content = match[1].trim()
  if (content === 'Consumidor Final') {
    return { consumidorFinal: true }
  }
  // Formato: RUC/Cédula: XXXXX | Razón Social: YYYYY | Correo: ZZZZZ
  const parts = content.split('|')
  const result: any = { consumidorFinal: false }
  parts.forEach(part => {
    const [key, ...valueParts] = part.split(':')
    if (!key) return
    const value = valueParts.join(':').trim()
    const k = key.trim().toLowerCase()
    if (k.includes('ruc') || k.includes('cédula') || k.includes('cedula') || k.includes('identificación') || k.includes('identificacion')) {
      result.identificacion = value
    } else if (k.includes('razón social') || k.includes('razon social') || k.includes('nombre')) {
      result.razonSocial = value
    } else if (k.includes('correo') || k.includes('email')) {
      result.correo = value
    }
  })
  return result
}

export default function CajaPage() {
  const { id }   = useParams<{ id: string }>()
  const router   = useRouter()
  const supabase = createClient()

  const [pedido,       setPedido]       = useState<any>(null)
  const [items,        setItems]        = useState<any[]>([])
  const [asignacion,   setAsignacion]   = useState<any>(null)
  const [cargando,     setCargando]     = useState(true)
  const [guardando,    setGuardando]    = useState(false)
  
  // Formulario SRI
  const [ruc, setRuc]                                 = useState(process.env.NEXT_PUBLIC_TIENDA_RUC || '1717067647001') // RUC por defecto de La Crayola
  const [provEstablecimiento, setProvEstablecimiento] = useState('001')
  const [provPuntoEmision, setProvPuntoEmision]       = useState('010')
  const [provSecuencial, setProvSecuencial]           = useState('')
  const [factura, setFactura]                         = useState('')
  const [claveAcceso, setClaveAcceso]                 = useState('')
  const [montoFacturado, setMontoFacturado]           = useState('')
  const [metodoPago, setMetodoPago]                   = useState('tarjeta_corporativa')
  const [fotoSubida, setFotoSubida]                   = useState(false)
  const [imagenFile, setImagenFile]                   = useState<File | null>(null)
  const [error, setError]                             = useState('')
  const [sriGenerado, setSriGenerado]                 = useState(false)

  // Datos del Proveedor para armar clave SRI
  const [provRuc, setProvRuc]                         = useState('')
  const [provCodigoNumerico, setProvCodigoNumerico]   = useState('00000001')
  const [tiendaId, setTiendaId]                       = useState('')
  
  // Obtener fecha actual en formato YYYY-MM-DD local
  const getLocalDateString = () => {
    const tzoffset = (new Date()).getTimezoneOffset() * 60000;
    return (new Date(Date.now() - tzoffset)).toISOString().slice(0, 10);
  }
  const [fechaEmision, setFechaEmision]               = useState(getLocalDateString())

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setImagenFile(file)
      setFotoSubida(true)
      setError('')
    }
  }

  useEffect(() => { cargar() }, [id])

  async function cargar() {
    const { data: asig } = await supabase.from('rep_asignaciones').select('*').eq('id', id).single()
    if (!asig) { router.replace('/pedidos'); return }
    setAsignacion(asig)

    const [{ data: ped }, { data: its }, { data: pickItems }] = await Promise.all([
      supabase.from('ol_pedidos').select('*').eq('id', asig.pedido_id).single(),
      supabase.from('ol_pedido_items').select('*').eq('pedido_id', asig.pedido_id),
      supabase.from('rep_picking').select('tienda_id, tienda_nombre').eq('pedido_id', asig.pedido_id).limit(1)
    ])

    setPedido(ped)
    if (ped) {
      setMontoFacturado(ped.total.toFixed(2))
    }
    setItems(its ?? [])

    // 1. Obtener la tienda (de rep_picking o buscando el producto en el catálogo ol_productos)
    let tId = ''
    if (pickItems && pickItems.length > 0 && pickItems[0].tienda_id) {
      tId = pickItems[0].tienda_id
    } else if (its && its.length > 0) {
      const codigos = its.map(it => it.codigo).filter(Boolean)
      if (codigos.length > 0) {
        try {
          const { data: prods } = await supabase
            .from('ol_productos')
            .select('tienda_id')
            .in('codigo', codigos)
            .limit(1)
          if (prods && prods.length > 0 && prods[0].tienda_id) {
            tId = prods[0].tienda_id
          }
        } catch (e) {
          console.error("Error al buscar tienda_id en ol_productos:", e)
        }
      }
    }

    // 2. Cargar RUC y Código Numérico del Proveedor
    if (tId) {
      setTiendaId(tId)
      
      // Fallbacks locales por defecto (según la tienda detectada)
      if (tId === '37f0c318-ef34-439b-9362-1c4c9fb4d1bd') { // Tía
        setProvRuc('0990017442001')
        setProvCodigoNumerico('00000000')
      } else if (tId === 'b402b85a-b006-42ef-b2f6-763722f68241') { // Tuti
        setProvRuc('0993152161001') // RUC Real de Tuti en Ecuador
        setProvCodigoNumerico('00000000')
      }

      // Intentar cargar la configuración directa de la base de datos (por si se actualizó)
      try {
        const { data: tiendaData } = await supabase
          .from('ol_tiendas')
          .select('ruc, codigo_numerico')
          .eq('id', tId)
          .single()
        
        if (tiendaData) {
          if (tiendaData.ruc) setProvRuc(tiendaData.ruc)
          if (tiendaData.codigo_numerico) setProvCodigoNumerico(tiendaData.codigo_numerico)
        }
      } catch (e) {
        console.error("Error al cargar datos de tienda en ol_tiendas:", e)
      }
    }
    
    setCargando(false)
  }

  // Autocompletar Código Numérico visualmente basado en la tienda y secuencial
  useEffect(() => {
    if (tiendaId === 'b402b85a-b006-42ef-b2f6-763722f68241') {
      // Tuti: Secuencial de la factura completado a 8 dígitos
      const numericSeq = provSecuencial.replace(/\D/g, '')
      if (numericSeq) {
        setProvCodigoNumerico(numericSeq.padStart(8, '0').slice(-8))
      }
    } else if (tiendaId === '37f0c318-ef34-439b-9362-1c4c9fb4d1bd') {
      // Tía: 00000000
      setProvCodigoNumerico('00000000')
    }
  }, [tiendaId, provSecuencial])

  // Generador reactivo de Clave de Acceso SRI de 49 dígitos (Ecuador Módulo 11)
  useEffect(() => {
    if (!fechaEmision || !provRuc || !provEstablecimiento || !provPuntoEmision || !provSecuencial || !provCodigoNumerico) {
      setClaveAcceso('')
      setSriGenerado(false)
      return
    }

    const cleanEstab = provEstablecimiento.padStart(3, '0')
    const cleanPtoEmi = provPuntoEmision.padStart(3, '0')
    const cleanSecuencial = provSecuencial.padStart(9, '0')
    
    // 1. Fecha de Emisión (8 dig: ddmmaaaa)
    const [y, m, d] = fechaEmision.split('-')
    if (!y || !m || !d) return
    const fechaStr = `${d}${m}${y}`
    
    // 2. Tipo de Comprobante (2 dig: 01 = Factura)
    const tipoComp = "01"
    
    // 3. RUC del Proveedor (13 dig)
    const rucStr = provRuc.replace(/\D/g, '').padEnd(13, '0').slice(0, 13)
    
    // 4. Tipo de Ambiente (1 dig: 2 = Producción)
    const ambiente = "2"
    
    // 5. Serie (6 dig)
    const serie = `${cleanEstab}${cleanPtoEmi}`
    
    // 6. Secuencial (9 dig)
    const seqStr = cleanSecuencial
    
    // 7. Código Numérico (8 dig) - LÓGICA DINÁMICA POR TIENDA
    let codNumStr = provCodigoNumerico.replace(/\D/g, '')
    if (tiendaId === 'b402b85a-b006-42ef-b2f6-763722f68241') {
      // Tuti: secuencial completado con ceros a la izquierda hasta 8 dígitos
      codNumStr = cleanSecuencial.replace(/\D/g, '').padStart(8, '0').slice(-8)
    } else if (tiendaId === '37f0c318-ef34-439b-9362-1c4c9fb4d1bd') {
      // Tía: por defecto 00000000
      codNumStr = '00000000'
    } else {
      codNumStr = codNumStr.padEnd(8, '0').slice(0, 8)
    }
    
    // 8. Tipo de Emisión (1 dig: 1 = Normal)
    const emision = "1"

    const claveSinDigito = `${fechaStr}${tipoComp}${rucStr}${ambiente}${serie}${seqStr}${codNumStr}${emision}`

    if (claveSinDigito.length !== 48) {
      setClaveAcceso('')
      setSriGenerado(false)
      return
    }

    // 9. Cálculo del Dígito Verificador usando Módulo 11
    let suma = 0
    let factor = 2
    for (let i = claveSinDigito.length - 1; i >= 0; i--) {
      suma += parseInt(claveSinDigito[i]) * factor
      factor = factor === 7 ? 2 : factor + 1
    }
    let digitoVerificador = 11 - (suma % 11)
    if (digitoVerificador === 11) digitoVerificador = 0
    if (digitoVerificador === 10) digitoVerificador = 1

    const claveCompleta = `${claveSinDigito}${digitoVerificador}`
    setClaveAcceso(claveCompleta)
    setFactura(`${cleanEstab}-${cleanPtoEmi}-${cleanSecuencial}`)
    setSriGenerado(true)
  }, [fechaEmision, provRuc, provEstablecimiento, provPuntoEmision, provSecuencial, provCodigoNumerico, tiendaId])



  async function registrarFacturacion() {
    setError('')
    
    const cleanEstab = provEstablecimiento.padStart(3, '0')
    const cleanPtoEmi = provPuntoEmision.padStart(3, '0')
    const cleanSecuencial = provSecuencial.padStart(9, '0')
    const facturaCompleta = `${cleanEstab}-${cleanPtoEmi}-${cleanSecuencial}`

    // Validaciones
    if (cleanEstab.length !== 3 || isNaN(Number(cleanEstab))) {
      setError('El establecimiento debe tener exactamente 3 dígitos numéricos')
      return
    }
    if (cleanPtoEmi.length !== 3 || isNaN(Number(cleanPtoEmi))) {
      setError('El punto de emisión debe tener exactamente 3 dígitos numéricos')
      return
    }
    if (cleanSecuencial.length !== 9 || isNaN(Number(cleanSecuencial))) {
      setError('El secuencial de la factura debe tener exactamente 9 dígitos numéricos')
      return
    }
    if (claveAcceso.length !== 49 || isNaN(Number(claveAcceso))) {
      setError('La clave de acceso SRI debe tener exactamente 49 dígitos numéricos')
      return
    }
    if (!montoFacturado.trim() || isNaN(parseFloat(montoFacturado)) || parseFloat(montoFacturado) <= 0) {
      setError('Ingrese un monto real facturado válido')
      return
    }
    if (!fotoSubida) {
      setError('Debe tomar y adjuntar una foto del comprobante físico')
      return
    }

    setGuardando(true)

    try {
      // Subir foto a Supabase Storage
      let fotoUrl = ''
      if (imagenFile) {
        const fileExt = imagenFile.name.split('.').pop() || 'jpg'
        const fileName = `${pedido.id}_${Date.now()}.${fileExt}`
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('comprobantes-proveedores')
          .upload(fileName, imagenFile, { upsert: true })

        if (uploadError) {
          setError('Error al subir la foto de la factura: ' + uploadError.message)
          setGuardando(false)
          return
        }
        
        const { data: publicUrlData } = supabase.storage
          .from('comprobantes-proveedores')
          .getPublicUrl(fileName)
        
        fotoUrl = publicUrlData?.publicUrl || ''
      }

      // 1. Guardar la información estructurada de la factura SRI en la columna 'notas' del pedido
      const provRucFinal = provRuc || ruc
      const notaSRI = `[SRI-BILLING] Factura: ${facturaCompleta} | RUC: ${provRucFinal} | Clave: ${claveAcceso} | Pago: ${metodoPago} | Total Facturado: $${parseFloat(montoFacturado).toFixed(2)}`
      const notasActuales = pedido.notas ? `${pedido.notas} \n${notaSRI}` : notaSRI

      // 2. Insertar comprobante del proveedor en la tabla relacional
      const { error: insertErr } = await supabase.from('ol_pedidos_comprobantes_proveedor').insert({
        pedido_id: pedido.id,
        tienda_id: tiendaId || '37f0c318-ef34-439b-9362-1c4c9fb4d1bd', // fallback a Tía si no hay ID
        prov_establecimiento: cleanEstab,
        prov_punto_emision: cleanPtoEmi,
        prov_secuencial: cleanSecuencial,
        prov_costo_real: parseFloat(montoFacturado),
        prov_factura_url: fotoUrl || null,
        prov_clave_acceso: claveAcceso || null,
        prov_ruc: provRucFinal,
        metodo_pago: metodoPago
      })

      if (insertErr) {
        setError('Error al registrar ticket de proveedor: ' + insertErr.message)
        setGuardando(false)
        return
      }

      // 3. Actualizar el pedido en Supabase a estado 'preparado' (picking finalizado, listo para entrega)
      await supabase.from('ol_pedidos')
        .update({ 
          estado: 'preparado', 
          notas: notasActuales
        })
        .eq('id', pedido.id)

      // 4. Actualizar la asignación a estado 'recolectado'
      await supabase.from('rep_asignaciones')
        .update({ estado: 'recolectado', updated_at: new Date().toISOString() })
        .eq('id', id)

      // 5. Redireccionar al dashboard para proceder con el traspaso o la entrega
      router.push('/repartidor')
    } catch (e) {
      setError('Ocurrió un error al guardar en la base de datos de Supabase.')
      setGuardando(false)
    }
  }

  if (cargando) return (
    <div className="min-h-screen bg-[#0c0f12] flex items-center justify-center">
      <Loader2 size={28} className="animate-spin text-[#00b074]" />
    </div>
  )

  const totalItems = items.reduce((sum, it) => sum + (it.cantidad ?? 1), 0)
  const itemsCompletados = items.filter(it => it.picking_completado).reduce((sum, it) => sum + (it.cantidad ?? 1), 0)
  const datosFactura = parseDatosFactura(pedido?.notas)

  return (
    <div className="min-h-screen bg-[#0c0f12] flex flex-col pb-32">
      
      {/* Header */}
      <div className="bg-[#181d24] border-b border-[#2d3748] px-4 pt-10 pb-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#00b074] rounded-xl flex items-center justify-center text-white font-bold text-xs">
              SRI
            </div>
            <div>
              <p className="text-white font-bold text-sm">Registro de Comprobante</p>
              <p className="text-gray-500 text-xs">La Crayola &rarr; Caja del Local</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-[#ff9f1c]/20 px-3 py-1.5 rounded-full border border-[#ff9f1c]/30">
            <div className="w-1.5 h-1.5 bg-[#ff9f1c] rounded-full animate-pulse" />
            <span className="text-[#ff9f1c] text-xs font-bold">En Caja</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 space-y-4">
        
        {/* Resumen del pedido */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 flex justify-between items-center">
          <div>
            <span className="text-gray-500 text-[10px] font-bold uppercase tracking-wider block">Total Esperado Compra</span>
            <span className="text-white text-xs mt-0.5">
              {itemsCompletados > 0 ? `${itemsCompletados} de ${totalItems}` : `${totalItems}`} productos recolectados
            </span>
          </div>
          <span className="text-[#ff9f1c] font-extrabold text-xl">${pedido?.total?.toFixed(2)}</span>
        </div>

        {/* Datos de Facturación de La Crayola (Dictar en Caja) */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-3xl p-5 space-y-3">
          <p className="font-bold uppercase tracking-wider text-[10px] text-blue-300 flex items-center gap-1.5">
            💳 DATOS PARA FACTURA DE LA CRAYOLA (Dictar en Caja)
          </p>
          <p className="text-[11.5px] text-blue-400 leading-normal">
            En la caja de Tuti/Tía/Proveedor, **pide la factura con los datos de la empresa** para justificar egresos ante el SRI:
          </p>
          <div className="bg-slate-950/60 rounded-xl p-3.5 border border-blue-900/30 text-xs text-slate-300 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-500">Razón Social:</span>
              <span className="text-white font-bold">Lilliana Maribel Gonzalez Vallejo</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">RUC Empresa:</span>
              <span className="text-white font-mono font-bold select-all">{ruc}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Correo Electrónico:</span>
              <span className="text-white font-mono select-all">librerialacrayola.ec@gmail.com</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Teléfono Contacto:</span>
              <span className="text-white font-mono select-all">0994568477</span>
            </div>
          </div>
        </div>

        {/* Datos de Entrega del Cliente (Solo Referencia) */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-4 space-y-2.5">
          <div className="flex justify-between items-center border-b border-gray-800 pb-2">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
              📍 Datos de Entrega del Cliente (Solo Referencia)
            </h3>
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
              datosFactura?.consumidorFinal 
                ? 'text-gray-400 bg-gray-500/10' 
                : 'text-green-400 bg-green-500/10'
            }`}>
              {datosFactura?.consumidorFinal ? 'CF' : 'Con Datos'}
            </span>
          </div>
          
          <div className="space-y-1 text-xs text-gray-400">
            <div className="flex justify-between">
              <span>Nombre:</span>
              <span className="text-white font-semibold">{datosFactura?.razonSocial || pedido?.nombre_cliente}</span>
            </div>
            {pedido?.direccion && (
              <div className="flex justify-between">
                <span>Dirección:</span>
                <span className="text-white font-semibold">{pedido.direccion}, {pedido.ciudad}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Teléfono Contacto:</span>
              <span className="text-white font-mono font-semibold">{pedido?.telefono || 'Sin teléfono'}</span>
            </div>
            <p className="text-[10px] text-red-400/80 leading-normal pt-1.5 border-t border-gray-800/40">
              ⚠️ *Nota: No dictes estos datos del cliente en la caja registradora del supermercado.*
            </p>
          </div>
        </div>

        {/* Notificación rápida de Caja */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-4 flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-bold">💵 Notificar Total en WhatsApp</p>
            <p className="text-gray-500 text-[10px] truncate">Envia la confirmación de la compra al cliente</p>
          </div>
          <button
            type="button"
            onClick={() => {
              const paddingNum = String(pedido?.numero ?? 0).padStart(4, '0')
              const esRetiro = pedido?.direccion === 'RETIRO EN TIENDA'
              const msg = esRetiro
                ? `¡Hola *${pedido?.nombre_cliente}*! 🛍️ Tu pedido #*${paddingNum}* de Tienda La Crayola ya está facturado y *LISTO PARA RETIRAR* en nuestro local principal. Monto total a cancelar: *$${parseFloat(montoFacturado || '0').toFixed(2)}*. ¡Te esperamos!`
                : `¡Hola *${pedido?.nombre_cliente}*! Tu pedido #*${paddingNum}* de Tienda La Crayola ha sido facturado en caja por un total de *$${parseFloat(montoFacturado || '0').toFixed(2)}* y entregado al repartidor. 📦 ¡Pronto iniciaremos la ruta de entrega!`
              const cleanPhone = pedido?.telefono?.replace(/\D/g, '') || ''
              const formattedPhone = cleanPhone.startsWith('0') ? '593' + cleanPhone.slice(1) : cleanPhone
              window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank')
            }}
            className="bg-green-600 hover:bg-green-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-all shrink-0">
            {pedido?.direccion === 'RETIRO EN TIENDA' ? '📲 Notificar Retiro' : '📲 Notificar Real'}
          </button>
        </div>

        {/* Formulario */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-4">
          <p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-2">Detalles de Facturación</p>

          {/* Fecha de Emisión del Ticket */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
              Fecha de Emisión del Ticket
            </label>
            <input
              type="date"
              value={fechaEmision}
              onChange={e => setFechaEmision(e.target.value)}
              className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#00b074] transition"
            />
          </div>

          {/* RUC del Proveedor */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
              RUC del Proveedor (Tuti/Tía/Local)
            </label>
            <input
              type="text"
              maxLength={13}
              value={provRuc}
              onChange={e => setProvRuc(e.target.value.replace(/\D/g, ''))}
              placeholder="Ej. 1793081118001"
              className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#00b074] transition font-mono"
            />
          </div>

          {/* Número de Factura Escindido */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
              Número de Factura del Proveedor
            </label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">Est.</span>
                <input
                  type="text"
                  maxLength={3}
                  value={provEstablecimiento}
                  onChange={e => setProvEstablecimiento(e.target.value.replace(/\D/g, ''))}
                  placeholder="001"
                  className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-2xl px-3 py-3 text-center text-sm font-mono focus:outline-none focus:border-[#00b074] transition"
                />
              </div>
              <div>
                <span className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">Pto. Emi</span>
                <input
                  type="text"
                  maxLength={3}
                  value={provPuntoEmision}
                  onChange={e => setProvPuntoEmision(e.target.value.replace(/\D/g, ''))}
                  placeholder="010"
                  className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-2xl px-3 py-3 text-center text-sm font-mono focus:outline-none focus:border-[#00b074] transition"
                />
              </div>
              <div>
                <span className="text-[10px] text-gray-500 uppercase tracking-wider block mb-1">Secuencial</span>
                <input
                  type="text"
                  maxLength={9}
                  value={provSecuencial}
                  onChange={e => setProvSecuencial(e.target.value.replace(/\D/g, ''))}
                  placeholder="000123456"
                  className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-2xl px-3 py-3 text-center text-sm font-mono focus:outline-none focus:border-[#00b074] transition"
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Formato: <span className="text-white font-mono">{provEstablecimiento.padStart(3, '0')}-{provPuntoEmision.padStart(3, '0')}-{provSecuencial.padStart(9, '0')}</span>
            </p>
          </div>

          {/* Código Numérico (8 dígitos) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
              Código Numérico del Ticket (8 dígitos)
            </label>
            <input
              type="text"
              maxLength={8}
              value={provCodigoNumerico}
              onChange={e => setProvCodigoNumerico(e.target.value.replace(/\D/g, ''))}
              placeholder="00000001"
              className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#00b074] transition font-mono"
            />
          </div>



          {/* Clave de Acceso Generada */}
          {sriGenerado && claveAcceso && (
            <div className="bg-[#00b074]/10 border border-[#00b074]/30 rounded-2xl p-4 space-y-1.5">
              <p className="text-[#00b074] text-[11px] font-bold uppercase tracking-wider">✓ Clave de Acceso SRI Generada</p>
              <p className="text-gray-300 font-mono text-xs break-all tracking-widest leading-relaxed bg-black/35 p-3 rounded-xl border border-gray-800">
                {claveAcceso.match(/.{1,4}/g)?.join(' ') || claveAcceso}
              </p>
              <p className="text-[10px] text-gray-500 leading-normal">
                Compara esta clave con la clave de 49 dígitos impresa al final del ticket del proveedor.
              </p>
            </div>
          )}

          {/* Monto Facturado en Cajas */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
              Monto Real Cobrado ($)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#00b074] font-bold text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={montoFacturado}
                onChange={e => setMontoFacturado(e.target.value)}
                placeholder="8.50"
                className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-2xl pl-8 pr-4 py-3.5 text-sm focus:outline-none focus:border-[#00b074] transition font-bold"
              />
            </div>
          </div>

          {/* Método de Pago */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
              Método de Pago Utilizado
            </label>
            <select
              value={metodoPago}
              onChange={e => setMetodoPago(e.target.value)}
              className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#00b074] transition appearance-none"
              style={{
                backgroundImage: 'url("data:image/svg+xml;utf8,<svg fill=\'white\' height=\'24\' viewBox=\'0 0 24 24\' width=\'24\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M7 10l5 5 5-5z\'/><path d=\'M0 0h24v24H0z\' fill=\'none\'/></svg>")',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 12px center'
              }}
            >
              <option value="tarjeta_corporativa">Tarjeta Corporativa (Visa/Mastercard)</option>
              <option value="efectivo_caja_chica">Caja Chica (Efectivo)</option>
              <option value="transferencia">Transferencia Directa</option>
            </select>
          </div>

          {/* Captura de Foto de Factura */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
              Foto de la Factura de Caja
            </label>
            <div className="relative">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                className="hidden"
                id="file-upload-factura"
              />
              <label
                htmlFor="file-upload-factura"
                className={`w-full py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2 text-sm font-semibold transition border cursor-pointer
                  ${fotoSubida 
                    ? 'bg-[#00b074]/10 border-[#00b074]/40 text-[#00b074]' 
                    : 'bg-[#1a2129] border-[#2d3748] hover:border-[#00b074] text-white'}`}
              >
                <Camera size={16} />
                <span>{fotoSubida ? `✓ Foto Cargada (${imagenFile?.name.slice(0, 15) || 'Comprobante'}...)` : 'Tomar Foto del Comprobante'}</span>
              </label>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl px-4 py-3 text-red-400 text-sm text-center">
            {error}
          </div>
        )}
      </div>

      {/* Botón flotante para guardar */}
      <div className="fixed bottom-0 inset-x-0 px-4 pb-6 pt-3 bg-gradient-to-t from-[#0c0f12] via-[#0c0f12]/95 to-transparent z-30">
        <button
          onClick={registrarFacturacion}
          disabled={guardando}
          className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-60 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 text-base shadow-lg shadow-[#00b074]/30 active:scale-95 transition"
        >
          {guardando ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
          <span>{guardando ? 'Guardando registro...' : 'Confirmar compra y continuar'}</span>
          {!guardando && <ArrowRight size={16} />}
        </button>
      </div>

    </div>
  )
}
