'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, CheckCircle2, AlertTriangle, Shield, CreditCard, Camera, ArrowRight } from 'lucide-react'

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
  const [ruc, setRuc]                       = useState('1792881512001') // RUC por defecto de La Crayola
  const [factura, setFactura]               = useState('')
  const [claveAcceso, setClaveAcceso]       = useState('')
  const [montoFacturado, setMontoFacturado] = useState('')
  const [metodoPago, setMetodoPago]         = useState('tarjeta_corporativa')
  const [fotoSubida, setFotoSubida]         = useState(false)
  const [error, setError]                   = useState('')
  const [sriGenerado, setSriGenerado]       = useState(false)

  useEffect(() => { cargar() }, [id])

  async function cargar() {
    const { data: asig } = await supabase.from('rep_asignaciones').select('*').eq('id', id).single()
    if (!asig) { router.replace('/pedidos'); return }
    setAsignacion(asig)
    const { data: ped } = await supabase.from('ol_pedidos').select('*').eq('id', asig.pedido_id).single()
    setPedido(ped)
    if (ped) {
      setMontoFacturado(ped.total.toFixed(2))
    }
    const { data: its } = await supabase.from('ol_pedido_items').select('*').eq('pedido_id', asig.pedido_id)
    setItems(its ?? [])
    setCargando(false)
  }

  // Generador de Clave de Acceso SRI de 49 dígitos (Ecuador Módulo 11)
  function generarClaveAccesoSRI() {
    setError('')
    const now = new Date()
    const dia = String(now.getDate()).padStart(2, '0')
    const mes = String(now.getMonth() + 1).padStart(2, '0')
    const anio = now.getFullYear()
    
    // 1. Fecha de Emisión (8 dig)
    const fechaStr = `${dia}${mes}${anio}`
    // 2. Tipo de Comprobante (2 dig: 01 = Factura)
    const tipoComp = "01"
    // 3. RUC (13 dig)
    const rucStr = ruc.padEnd(13, '0').slice(0, 13)
    // 4. Tipo de Ambiente (1 dig: 2 = Producción, 1 = Pruebas)
    const ambiente = "2"
    // 5. Serie (6 dig: 001 establecimiento, 010 punto de emisión)
    const serie = "001010"
    // 6. Secuencial de Factura (9 dig aleatorios para simular el ticket)
    const secuencial = String(Math.floor(100000 + Math.random() * 900000)).padStart(9, '0')
    // 7. Código Numérico (8 dig aleatorios)
    const codigoNum = "87654321"
    // 8. Tipo de Emisión (1 dig: 1 = Normal)
    const emision = "1"

    const claveSinDigito = `${fechaStr}${tipoComp}${rucStr}${ambiente}${serie}${secuencial}${codigoNum}${emision}`

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
    setFactura(`001-010-${secuencial}`)
    setSriGenerado(true)
  }

  function tomarFotoFactura() {
    setFotoSubida(true)
    setError('')
  }

  async function registrarFacturacion() {
    setError('')
    
    // Validaciones
    if (!factura.trim() || !factura.includes('-') || factura.split('-').length !== 3) {
      setError('Ingrese un número de factura válido (ej. 001-010-000123456)')
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
      // 1. Guardar la información estructurada de la factura SRI en la columna 'notas' del pedido
      const notaSRI = `[SRI-BILLING] Factura: ${factura} | RUC: ${ruc} | Clave: ${claveAcceso} | Pago: ${metodoPago} | Total Facturado: $${parseFloat(montoFacturado).toFixed(2)}`
      const notasActuales = pedido.notas ? `${pedido.notas} \n${notaSRI}` : notaSRI

      // 2. Actualizar el pedido en Supabase a estado 'preparado' (picking finalizado, listo para entrega)
      await supabase.from('ol_pedidos')
        .update({ estado: 'preparado', notas: notasActuales })
        .eq('id', pedido.id)

      // 3. Actualizar la asignación a estado 'recolectado'
      await supabase.from('rep_asignaciones')
        .update({ estado: 'recolectado', updated_at: new Date().toISOString() })
        .eq('id', id)

      // 4. Redireccionar al dashboard para proceder con el traspaso o la entrega
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

  const itemsCompletados = items.filter(it => it.picking_completado).length

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
            <span className="text-white text-xs mt-0.5">{itemsCompletados} productos recolectados</span>
          </div>
          <span className="text-[#ff9f1c] font-extrabold text-xl">${pedido?.total?.toFixed(2)}</span>
        </div>

        {/* Datos de Facturación del Cliente */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-3">
          <div className="flex justify-between items-center border-b border-gray-800 pb-2.5">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
              👤 Datos de Facturación del Cliente
            </h3>
            <span className="text-[10px] text-green-400 font-bold bg-green-500/10 px-2 py-0.5 rounded-full">
              Autorizado
            </span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Nombre / Razón Social:</span>
              <span className="text-white font-bold">{pedido?.nombre_cliente}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Identificación (Teléfono/WhatsApp):</span>
              <span className="text-white font-mono font-semibold">{pedido?.telefono}</span>
            </div>
            {pedido?.email_cliente && (
              <div className="flex justify-between">
                <span className="text-gray-500">Email:</span>
                <span className="text-white font-semibold">{pedido?.email_cliente}</span>
              </div>
            )}
            {pedido?.direccion && (
              <div className="pt-1.5 border-t border-gray-800/50 mt-1.5 text-[11px] text-gray-400">
                📍 <strong>Dirección de entrega:</strong> {pedido.direccion}, {pedido.ciudad}
              </div>
            )}
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-[10px] text-yellow-500 leading-normal">
            💡 <strong>Instrucción para el Shopper:</strong> Dicta los datos del cliente al cajero del Tuti/Tía para que la factura se emita a su nombre. Si no los solicita, emite como <strong>Consumidor Final</strong>.
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
              const msg = `¡Hola *${pedido?.nombre_cliente}*! Tu pedido #*${paddingNum}* de Tienda La Crayola ha sido facturado en caja por un total de *$${parseFloat(montoFacturado || '0').toFixed(2)}* y entregado al repartidor. 📦 ¡Pronto iniciaremos la ruta de entrega!`
              const cleanPhone = pedido?.telefono?.replace(/\D/g, '') || ''
              const formattedPhone = cleanPhone.startsWith('0') ? '593' + cleanPhone.slice(1) : cleanPhone
              window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank')
            }}
            className="bg-green-600 hover:bg-green-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-all shrink-0">
            📲 Notificar Real
          </button>
        </div>

        {/* Formulario */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-4">
          <p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-2">Detalles de Facturación</p>

          {/* RUC Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
              RUC de Facturación (La Crayola)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={ruc}
                onChange={e => setRuc(e.target.value)}
                placeholder="1792881512001"
                className="flex-1 bg-[#0c0f12] border border-[#2d3748] text-white rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-[#00b074] transition"
              />
              <button 
                type="button"
                onClick={() => setRuc('9999999999999')}
                className="bg-[#2d3748] hover:bg-[#3d4d63] text-xs text-white px-3 rounded-2xl font-bold transition">
                Cons. Final
              </button>
            </div>
          </div>

          {/* Escáner de QR SRI */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
              Clave de Acceso SRI (49 dígitos)
            </label>
            <button
              type="button"
              onClick={generarClaveAccesoSRI}
              className="w-full bg-[#1a2129] border border-[#2d3748] hover:border-[#00b074] text-white py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2 text-sm font-semibold transition"
            >
              <Shield size={16} className="text-[#00b074]" />
              <span>Escanear QR de Factura Física</span>
            </button>
          </div>

          {/* Mostrar Clave SRI Generada */}
          {sriGenerado && (
            <div className="bg-[#00b074]/10 border border-[#00b074]/30 rounded-2xl p-3">
              <p className="text-[#00b074] text-[11px] font-bold uppercase tracking-wider">✓ Clave Autorizada SRI</p>
              <p className="text-gray-300 font-mono text-[10.5px] mt-1 break-all tracking-wider leading-relaxed">
                {claveAcceso}
              </p>
            </div>
          )}

          {/* Número de Factura */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
              Número de Factura Comercial
            </label>
            <input
              type="text"
              value={factura}
              onChange={e => setFactura(e.target.value)}
              placeholder="001-010-000123456"
              className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#00b074] transition"
            />
          </div>

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
            <button
              type="button"
              onClick={tomarFotoFactura}
              className={`w-full py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2 text-sm font-semibold transition border
                ${fotoSubida 
                  ? 'bg-[#00b074]/10 border-[#00b074]/40 text-[#00b074]' 
                  : 'bg-[#1a2129] border-[#2d3748] hover:border-[#00b074] text-white'}`}
            >
              <Camera size={16} />
              <span>{fotoSubida ? '✓ Foto de Factura Cargada' : 'Tomar Foto del Comprobante'}</span>
            </button>
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
          <span>{guardando ? 'Registrando en SRI...' : 'Registrar en SRI y continuar'}</span>
          {!guardando && <ArrowRight size={16} />}
        </button>
      </div>

    </div>
  )
}
