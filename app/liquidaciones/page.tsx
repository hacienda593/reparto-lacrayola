'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import {
  Check, Loader2, ChevronDown, ChevronUp, AlertCircle,
  Upload, CheckCircle, X, Printer, DollarSign, User, ArrowRightLeft
} from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }
function fechaLocal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function limitesDiaEcuador(fecha: string) {
  // Ecuador continental usa UTC-05:00 todo el año.
  return { inicio: `${fecha}T00:00:00-05:00`, fin: `${fecha}T23:59:59.999-05:00` }
}

interface DepositoPendiente {
  id: string
  repartidor_id: string
  monto: number
  metodo: string
  registrado_at: string
  banco: string | null
  referencia: string | null
  comprobante_path: string
  rep_repartidores?: { nombre: string } | null
  rep_liquidacion_items?: {
    monto: number
    rep_entregas?: { ol_pedidos?: { numero: number; nombre_cliente: string } | null } | null
  }[]
}
interface ReclamoAbierto {
  id: string
  repartidor_nombre: string
  tipo: string
  created_at: string
  mensaje: string
}

interface LiquidacionVista {
  id:               string | null
  repartidor_id:    string
  nombre:           string
  fecha:            string
  total_asignados:  number
  total_entregados: number
  total_devueltos:  number
  total_cobrado:    number
  total_comision:   number
  total_a_entregar: number
  estado:           string
  efectivo_en_mano: number
}

interface ValeCaja {
  numero: string
  repartidor: string
  monto: number
  fecha: string
  recibidoPor: string
  metodo: string
  referencia?: string
}
type PersonaRelacion = {nombre?:string} | {nombre?:string}[] | null
interface TraspasoDia { id:string; monto:number; notas?:string|null; created_at:string; origen?:PersonaRelacion; destino?:PersonaRelacion }
interface MovimientoLiquidacion { id:string; repartidor_id:string; monto:number; saldo_antes:number; saldo_despues:number; metodo:string; referencia?:string|null; recibido_por:string; created_at:string; reversado_at?:string|null; motivo_reverso?:string|null }
interface DiagnosticoCaja { repartidor_id:string; nombre:string; efectivo_en_mano:number; total_liquidado:number; transferido_salida:number; transferido_entrada:number; datos_anomalos:number }
function mensajeError(error: unknown) { return error instanceof Error ? error.message : String(error) }
function nombreRelacion(persona: PersonaRelacion | undefined) { return Array.isArray(persona) ? persona[0]?.nombre : persona?.nombre }

export default function LiquidacionesPage() {
  const [fecha,       setFecha]       = useState(fechaLocal)
  const [liquidaciones, setLiquidaciones] = useState<LiquidacionVista[]>([])
  const [cargando,    setCargando]    = useState(true)
  const [procesando,  setProcesando]  = useState<string | null>(null)
  const [expandido,   setExpandido]   = useState<string | null>(null)

  // Estados del Formulario de Liquidación
  const [modalLiquidar, setModalLiquidar] = useState<LiquidacionVista | null>(null)
  const [metodo, setMetodo] = useState<'caja' | 'transferencia'>('caja')
  const [referencia, setReferencia] = useState('')
  const [fotoUrl, setFotoUrl] = useState('')
  const [recibidoPor, setRecibidoPor] = useState('')
  const [montoRecibido, setMontoRecibido] = useState('')
  const [requestId, setRequestId] = useState('')
  const [subiendoFoto, setSubiendoFoto] = useState(false)

  // Estado para visualización del Vale de Caja Digital
  const [valeVista, setValeVista] = useState<ValeCaja | null>(null)

  // Traspasos de efectivo entre colaboradores (ej: repartidor entrega COD a un comprador)
  const [traspasosDia, setTraspasosDia] = useState<TraspasoDia[]>([])
  const [mostrarTraspasos, setMostrarTraspasos] = useState(false)
  const [movimientos, setMovimientos] = useState<MovimientoLiquidacion[]>([])
  const [diagnostico, setDiagnostico] = useState<DiagnosticoCaja[]>([])
  const [reversando, setReversando] = useState<string | null>(null)
  const [avisoMigracion, setAvisoMigracion] = useState('')

  // Depósitos que los repartidores registraron ellos mismos desde su
  // celular (Mi Caja), pendientes de que admin los confirme o rechace.
  const [depositosPendientes, setDepositosPendientes] = useState<DepositoPendiente[]>([])
  const [procesandoDeposito, setProcesandoDeposito] = useState<string | null>(null)

  // Reclamos que los repartidores reportan desde "Mis comisiones" cuando
  // algo no les cuadra -- canal formal que copiamos de PeYa/Tipti ("Solicitar
  // revisión de comisión" / "Reportar discrepancia").
  const [reclamosAbiertos, setReclamosAbiertos] = useState<ReclamoAbierto[]>([])
  const [procesandoReclamo, setProcesandoReclamo] = useState<string | null>(null)

  async function cargar() {
    setCargando(true)
    const limites = limitesDiaEcuador(fecha)

    // Repartidores activos
    const { data: reps } = await supabase
      .from('rep_repartidores')
      .select('id,nombre,comision_tipo,comision_valor,efectivo_en_mano')
      .eq('activo', true)
      
    if (!reps) { setCargando(false); return }

    // Liquidaciones existentes para esa fecha
    const { data: liqs } = await supabase.from('rep_liquidaciones').select('*').eq('fecha', fecha)
    const liqMap = new Map((liqs ?? []).map(l => [l.repartidor_id, l]))

    // Entregas del día por repartidor
    const { data: entregas } = await supabase
      .from('rep_entregas')
      .select('repartidor_id,monto_cobrado,exitosa,entregado_at')
      .gte('entregado_at', limites.inicio)
      .lte('entregado_at', limites.fin)

    // Asignaciones del día
    const { data: asigs } = await supabase
      .from('rep_asignaciones')
      .select('repartidor_id,estado')
      .gte('asignado_at', limites.inicio)
      .lte('asignado_at', limites.fin)

    const resultado: LiquidacionVista[] = reps.map(rep => {
      const existente    = liqMap.get(rep.id)
      const misAsigs     = (asigs ?? []).filter(a => a.repartidor_id === rep.id)
      const misEntregas  = (entregas ?? []).filter(e => e.repartidor_id === rep.id && e.exitosa)
      const totalCobrado = misEntregas.reduce((s, e) => s + (e.monto_cobrado ?? 0), 0)
      const comision     = rep.comision_tipo === 'fijo'
        ? misEntregas.length * Number(rep.comision_valor)
        : totalCobrado * (Number(rep.comision_valor) / 100)

      return {
        id:               existente?.id ?? null,
        repartidor_id:    rep.id,
        nombre:           rep.nombre,
        fecha,
        total_asignados:  misAsigs.length,
        total_entregados: misEntregas.length,
        total_devueltos:  misAsigs.filter(a => a.estado === 'devuelto').length,
        total_cobrado:    totalCobrado,
        total_comision:   comision,
        total_a_entregar: totalCobrado - comision,
        estado:           existente?.estado ?? 'pendiente',
        efectivo_en_mano: rep.efectivo_en_mano ?? 0,
      }
    })

    setLiquidaciones(resultado)

    // Traspasos de efectivo entre colaboradores ese día (ej: repartidor -> comprador)
    const { data: traspasos } = await supabase
      .from('rep_traspasos_efectivo')
      .select(`
        id, monto, notas, created_at,
        origen:rep_repartidores!rep_traspasos_efectivo_repartidor_origen_id_fkey(nombre),
        destino:rep_repartidores!rep_traspasos_efectivo_repartidor_destino_id_fkey(nombre)
      `)
      .gte('created_at', limites.inicio)
      .lte('created_at', limites.fin)
      .order('created_at', { ascending: false })
    setTraspasosDia(traspasos ?? [])
    const { data: movs, error: movError } = await supabase.from('rep_movimientos_liquidacion')
      .select('id,repartidor_id,monto,saldo_antes,saldo_despues,metodo,referencia,recibido_por,created_at,reversado_at,motivo_reverso')
      .gte('created_at', limites.inicio).lte('created_at', limites.fin).order('created_at',{ascending:false})
    setMovimientos((movs ?? []) as MovimientoLiquidacion[])
    const { data: diag, error: diagError } = await supabase.from('rep_diagnostico_caja').select('*').order('efectivo_en_mano',{ascending:false})
    setDiagnostico((diag ?? []) as DiagnosticoCaja[])
    setAvisoMigracion(movError || diagError ? 'Falta aplicar la migración financiera más reciente en Supabase.' : '')

    const { data: depsPend } = await supabase.from('rep_depositos_repartidor')
      .select('*, rep_repartidores(nombre), rep_liquidacion_items(monto, rep_entregas(pedido_id, ol_pedidos(numero, nombre_cliente)))')
      .eq('estado', 'pendiente').order('registrado_at', { ascending: true })
    setDepositosPendientes(depsPend ?? [])

    const { data: reclamos } = await supabase.rpc('admin_reclamos_abiertos')
    setReclamosAbiertos(reclamos ?? [])

    setCargando(false)
  }

  async function resolverReclamo(reclamo: ReclamoAbierto) {
    const respuesta = window.prompt('Respuesta para el repartidor (qué se revisó / resolvió):')?.trim()
    if (!respuesta) return
    setProcesandoReclamo(reclamo.id)
    const { error } = await supabase.rpc('resolver_reclamo', { p_reclamo_id: reclamo.id, p_respuesta: respuesta })
    setProcesandoReclamo(null)
    if (error) { alert('No se pudo resolver: ' + error.message); return }
    await cargar()
  }

  async function confirmarDeposito(dep: DepositoPendiente) {
    const recibidoPor = window.prompt('¿Quién confirma la recepción del depósito?')?.trim()
    if (!recibidoPor) return
    setProcesandoDeposito(dep.id)
    const { error } = await supabase.rpc('confirmar_deposito_repartidor', { p_deposito_id: dep.id, p_recibido_por: recibidoPor })
    setProcesandoDeposito(null)
    if (error) { alert('No se pudo confirmar: ' + error.message); return }
    await cargar()
  }

  async function rechazarDeposito(dep: DepositoPendiente) {
    const motivo = window.prompt('Motivo del rechazo (obligatorio, se le comunicará al repartidor):')?.trim()
    if (!motivo) return
    setProcesandoDeposito(dep.id)
    const { error } = await supabase.rpc('rechazar_deposito_repartidor', { p_deposito_id: dep.id, p_motivo: motivo })
    setProcesandoDeposito(null)
    if (error) { alert('No se pudo rechazar: ' + error.message); return }
    await cargar()
  }

  async function verComprobanteDeposito(path: string) {
    const { data } = await supabase.storage.from('comprobantes-proveedores').createSignedUrl(path, 3600)
    if (!data?.signedUrl) { alert('No se pudo generar el enlace del comprobante'); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- corre solo al cambiar `fecha`, no en cada render
  useEffect(() => { const timer = window.setTimeout(() => void cargar(), 0); return () => window.clearTimeout(timer) }, [fecha])

  async function subirFotoComprobante(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSubiendoFoto(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `liq-${Date.now()}.${fileExt}`
      const { error } = await supabase.storage
        .from('comprobantes-proveedores')
        .upload(fileName, file)

      if (error) throw error

      // Bucket privado (punto 10 de la auditoría): se guarda la ruta, no
      // una URL pública -- se firma bajo demanda al mostrarla.
      setFotoUrl(fileName)
    } catch (err: unknown) {
      alert('Error al subir la imagen: ' + mensajeError(err))
    } finally {
      setSubiendoFoto(false)
    }
  }

  function abrirModalLiquidar(liq: LiquidacionVista) {
    setModalLiquidar(liq)
    setMetodo('caja')
    setReferencia('')
    setFotoUrl('')
    setRecibidoPor('')
    setMontoRecibido(Number(liq.efectivo_en_mano || 0).toFixed(2))
    setRequestId(crypto.randomUUID())
  }

  async function confirmarLiquidacion() {
    if (!modalLiquidar) return
    if (!recibidoPor.trim()) {
      alert('Por favor ingresa el nombre de la persona que recibe.')
      return
    }
    if (metodo === 'transferencia' && !referencia.trim()) {
      alert('Por favor ingresa el número de referencia bancaria.')
      return
    }
    const monto = Number(montoRecibido)
    if (!Number.isFinite(monto) || monto <= 0) {
      alert('Ingresa un monto recibido mayor que cero.')
      return
    }
    if (monto > modalLiquidar.efectivo_en_mano) {
      alert(`El monto no puede superar el saldo en mano (${fmt(modalLiquidar.efectivo_en_mano)}).`)
      return
    }

    setProcesando(modalLiquidar.repartidor_id)
    try {
      // Generar correlativo de vale de caja si es efectivo
      const numeroVale = metodo === 'caja' 
        ? `VALE-${Date.now().toString().slice(-6)}` 
        : null

      // La liquidación y el descuento del saldo ocurren dentro de una sola
      // transacción en PostgreSQL. Así no puede guardarse uno sin el otro.
      const { error: rpcError } = await supabase.rpc('liquidar_repartidor_admin', {
        p_request_id: requestId,
        p_repartidor_id: modalLiquidar.repartidor_id,
        p_fecha: modalLiquidar.fecha,
        p_monto_recibido: monto,
        p_metodo: metodo,
        p_recibido_por: recibidoPor,
        p_referencia: referencia || null,
        p_foto_url: fotoUrl || null,
        p_numero_vale: numeroVale,
      })
      if (rpcError) throw rpcError

      // 3. Si es abono en caja (efectivo), preparar vale para visualización/impresión
      if (metodo === 'caja' && numeroVale) {
        setValeVista({
          numero: numeroVale,
          repartidor: modalLiquidar.nombre,
          monto,
          fecha: modalLiquidar.fecha,
          recibidoPor: recibidoPor,
          metodo: 'Abono en Efectivo a Oficina'
        })
      } else if (metodo === 'transferencia') {
        alert('✓ Liquidación por transferencia registrada correctamente. El saldo en mano del repartidor ha sido actualizado.')
      }

      setModalLiquidar(null)
      await cargar()
    } catch (err: unknown) {
      alert('Error al registrar la liquidación: ' + mensajeError(err))
    } finally {
      setProcesando(null)
    }
  }

  async function reversarMovimiento(movimiento: MovimientoLiquidacion) {
    const motivo = window.prompt('Motivo del reverso (mínimo 8 caracteres). Esta acción quedará auditada:')?.trim()
    if (!motivo) return
    if (motivo.length < 8) { alert('El motivo debe tener al menos 8 caracteres.'); return }
    if (!window.confirm(`Se devolverán ${fmt(Number(movimiento.monto))} al saldo del custodio. ¿Continuar?`)) return
    setReversando(movimiento.id)
    const { error } = await supabase.rpc('reversar_movimiento_liquidacion',{ p_movimiento_id:movimiento.id,p_motivo:motivo })
    setReversando(null)
    if (error) { alert('No se pudo reversar: '+error.message); return }
    await cargar()
  }

  const totalGeneral = liquidaciones.reduce((s, l) => ({
    cobrado:    s.cobrado    + l.total_cobrado,
    comisiones: s.comisiones + l.total_comision,
    entregar:   s.entregar   + l.efectivo_en_mano,
    entregas:   s.entregas   + l.total_entregados,
  }), { cobrado: 0, comisiones: 0, entregar: 0, entregas: 0 })

  return (
    <div className="flex min-h-screen bg-[#0c0f12] text-white">
      <Sidebar />
      <main className="flex-1 md:pl-56 pt-14 md:pt-0 p-4 md:p-6 space-y-5">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white">Liquidaciones de Caja Chica</h1>
            <p className="text-sm text-gray-500">Cierre diario y control de efectivo en mano de repartidores</p>
          </div>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            className="border border-[#2d3748] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500 bg-[#181d24] text-white" />
        </div>

        {/* Resumen del día */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total cobrado',    value: fmt(totalGeneral.cobrado),    color: 'text-green-400',  bg: 'bg-green-500/5 border-[#00b074]/20' },
            { label: 'Comisiones',       value: fmt(totalGeneral.comisiones), color: 'text-blue-400',   bg: 'bg-blue-500/5 border-blue-500/20' },
            { label: 'Efectivo pendiente', value: fmt(totalGeneral.entregar), color: 'text-orange-400', bg: 'bg-orange-500/5 border-orange-500/20' },
            { label: 'Total entregas',   value: totalGeneral.entregas,        color: 'text-purple-400', bg: 'bg-purple-500/5 border-purple-500/20' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`${bg} rounded-2xl p-4 border`}>
              <div className={`text-xl font-extrabold ${color}`}>{value}</div>
              <div className="text-xs text-gray-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Depósitos autoiniciados por repartidores (Mi Caja), pendientes de verificar */}
        {depositosPendientes.length > 0 && (
          <div className="bg-[#181d24] rounded-2xl border border-blue-500/30 overflow-hidden">
            <div className="px-4 py-3.5 border-b border-[#2d3748] flex items-center gap-2">
              <Upload size={15} className="text-blue-400" />
              <span className="font-bold text-white text-sm">Depósitos por verificar ({depositosPendientes.length})</span>
            </div>
            <div className="divide-y divide-[#2d3748]">
              {depositosPendientes.map(dep => (
                <div key={dep.id} className="px-4 py-3 space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-white">
                        {dep.rep_repartidores?.nombre ?? 'Repartidor'} · {fmt(Number(dep.monto))}
                        <span className="ml-1.5 text-[9px] font-bold text-blue-400 uppercase">{dep.metodo === 'deposito_banco' ? 'Depósito' : 'Transferencia'}</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(dep.registrado_at).toLocaleString('es-EC', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {dep.banco ? ` · ${dep.banco}` : ''}{dep.referencia ? ` · Ref. ${dep.referencia}` : ''}
                      </p>
                    </div>
                    <button onClick={() => verComprobanteDeposito(dep.comprobante_path)}
                      className="text-[10px] font-bold text-blue-400 border border-blue-500/30 rounded-lg px-2.5 py-1.5 hover:bg-blue-500/10">
                      Ver comprobante
                    </button>
                    <button onClick={() => confirmarDeposito(dep)} disabled={procesandoDeposito === dep.id}
                      className="text-[10px] font-bold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg px-2.5 py-1.5">
                      {procesandoDeposito === dep.id ? '...' : 'Confirmar'}
                    </button>
                    <button onClick={() => rechazarDeposito(dep)} disabled={procesandoDeposito === dep.id}
                      className="text-[10px] font-bold text-red-400 border border-red-500/30 rounded-lg px-2.5 py-1.5 hover:bg-red-500/10 disabled:opacity-50">
                      Rechazar
                    </button>
                  </div>
                  {(dep.rep_liquidacion_items?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1.5 pl-0.5">
                      {dep.rep_liquidacion_items?.map((it, i) => (
                        <span key={i} className="text-[9.5px] font-semibold bg-[#0c0f12] border border-[#2d3748] text-gray-400 rounded-lg px-2 py-1">
                          #{String(it.rep_entregas?.ol_pedidos?.numero ?? 0).padStart(4, '0')} {it.rep_entregas?.ol_pedidos?.nombre_cliente ?? ''} · {fmt(Number(it.monto))}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reclamos de comisión/depósito que los repartidores reportan desde
            "Mis comisiones" -- canal formal, no solo que se quede callado. */}
        {reclamosAbiertos.length > 0 && (
          <div className="bg-[#181d24] rounded-2xl border border-amber-500/30 overflow-hidden">
            <div className="px-4 py-3.5 border-b border-[#2d3748] flex items-center gap-2">
              <AlertCircle size={15} className="text-amber-400" />
              <span className="font-bold text-white text-sm">Reclamos por revisar ({reclamosAbiertos.length})</span>
            </div>
            <div className="divide-y divide-[#2d3748]">
              {reclamosAbiertos.map(rc => (
                <div key={rc.id} className="px-4 py-3 space-y-1.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-white">
                        {rc.repartidor_nombre}
                        <span className="ml-1.5 text-[9px] font-bold text-amber-400 uppercase">{rc.tipo}</span>
                      </p>
                      <p className="text-xs text-gray-500">{new Date(rc.created_at).toLocaleString('es-EC', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <button onClick={() => resolverReclamo(rc)} disabled={procesandoReclamo === rc.id}
                      className="text-[10px] font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg px-2.5 py-1.5 shrink-0">
                      {procesandoReclamo === rc.id ? '...' : 'Responder y cerrar'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 bg-[#0c0f12] border border-[#2d3748] rounded-lg px-3 py-2">{rc.mensaje}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Traspasos de efectivo entre colaboradores */}
        {traspasosDia.length > 0 && (
          <div className="bg-[#181d24] rounded-2xl border border-[#2d3748] overflow-hidden">
            <button
              onClick={() => setMostrarTraspasos(!mostrarTraspasos)}
              className="w-full flex items-center justify-between px-4 py-3.5 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <ArrowRightLeft size={15} className="text-yellow-400" />
                <span className="font-bold text-white text-sm">Traspasos entre colaboradores ({traspasosDia.length})</span>
              </div>
              {mostrarTraspasos ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
            </button>
            {mostrarTraspasos && (
              <div className="border-t border-[#2d3748] divide-y divide-[#2d3748]">
                {traspasosDia.map(t => (
                  <div key={t.id} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2 text-gray-300">
                      <span className="font-semibold text-white">{nombreRelacion(t.origen) ?? '—'}</span>
                      <ArrowRightLeft size={12} className="text-gray-500 shrink-0" />
                      <span className="font-semibold text-white">{nombreRelacion(t.destino) ?? '—'}</span>
                      {t.notas && <span className="text-xs text-gray-500 italic">· {t.notas}</span>}
                    </div>
                    <span className="font-bold text-yellow-400 shrink-0">{fmt(t.monto)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Lista por repartidor */}
        {cargando ? (
          <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-green-500" /></div>
        ) : (
          <div className="space-y-3">
            {liquidaciones.map(liq => {
              const liquidado  = liq.estado === 'liquidado'
              const sinActividad = liq.total_asignados === 0 && liq.efectivo_en_mano <= 0
              // Cuánto de "efectivo en mano" ya está cubierto por un
              // depósito que el propio repartidor registró y está
              // esperando que lo confirmes -- sin esto, la fila se veía
              // igual que si nada se hubiera registrado, y el botón de
              // abajo dejaba liquidar por otra vía el mismo dinero dos veces.
              const enDepositoPendiente = depositosPendientes
                .filter(d => d.repartidor_id === liq.repartidor_id)
                .reduce((s, d) => s + Number(d.monto || 0), 0)
              const efectivoSinCubrir = Math.max(0, liq.efectivo_en_mano - enDepositoPendiente)
              return (
                <div key={liq.repartidor_id} className={`bg-[#181d24] rounded-2xl border shadow-sm overflow-hidden ${sinActividad ? 'opacity-60 border-[#2d3748]' : 'border-[#2d3748]'}`}>
                  <div className="flex items-center justify-between px-4 py-3.5 cursor-pointer"
                    onClick={() => setExpandido(expandido === liq.repartidor_id ? null : liq.repartidor_id)}>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-green-950/20 rounded-xl flex items-center justify-center text-lg">🛵</div>
                      <div>
                        <div className="font-bold text-white text-sm">{liq.nombre}</div>
                        <div className="text-xs text-gray-400">
                          {liq.total_entregados} entregados · {liq.total_devueltos} devueltos
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-bold text-orange-400">{fmt(liq.efectivo_en_mano)}</div>
                        <div className="text-[10px] text-gray-500">Efectivo pendiente en mano</div>
                        {enDepositoPendiente > 0 && (
                          <div className="text-[9px] text-blue-400 font-semibold">🕓 {fmt(enDepositoPendiente)} en depósito por verificar</div>
                        )}
                      </div>
                      <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${liquidado ? 'bg-green-500/15 text-green-400 border border-green-500/30' : 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'}`}>
                        {liquidado ? '✓ Liquidado' : 'Pendiente'}
                      </span>
                      {expandido === liq.repartidor_id ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                    </div>
                  </div>

                  {expandido === liq.repartidor_id && (
                    <div className="border-t border-[#2d3748] px-4 py-4 space-y-4">
                      {/* Desglose */}
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="bg-[#0c0f12] rounded-xl p-3 border border-[#2d3748]">
                          <div className="text-lg font-extrabold text-white">{liq.total_asignados}</div>
                          <div className="text-[10px] text-gray-500">Asignados</div>
                        </div>
                        <div className="bg-[#0c0f12] rounded-xl p-3 border border-[#2d3748]">
                          <div className="text-lg font-extrabold text-green-400">{liq.total_entregados}</div>
                          <div className="text-[10px] text-gray-500">Entregados</div>
                        </div>
                        <div className="bg-[#0c0f12] rounded-xl p-3 border border-[#2d3748]">
                          <div className="text-lg font-extrabold text-red-400">{liq.total_devueltos}</div>
                          <div className="text-[10px] text-gray-500">Devueltos</div>
                        </div>
                      </div>

                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between text-gray-400">
                          <span>Total cobrado al cliente (en mano)</span>
                          <span className="font-semibold text-white">{fmt(liq.total_cobrado)}</span>
                        </div>
                        <div className="flex justify-between text-gray-400">
                          <span>Comisión del repartidor</span>
                          <span className="font-semibold text-blue-400">− {fmt(liq.total_comision)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-base border-t border-[#2d3748] pt-2">
                          <span className="text-white">Debe entregar al negocio</span>
                          <span className="text-orange-400">{fmt(liq.total_a_entregar)}</span>
                        </div>
                      </div>

                      {efectivoSinCubrir > 0 ? (
                        <button onClick={() => abrirModalLiquidar({ ...liq, efectivo_en_mano: efectivoSinCubrir })} disabled={procesando === liq.repartidor_id}
                          className="w-full flex items-center justify-center gap-2 bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-60 text-white font-bold py-3 rounded-xl transition text-sm cursor-pointer border-0">
                          {procesando === liq.repartidor_id
                            ? <Loader2 size={15} className="animate-spin" />
                            : <Check size={15} />
                          }
                          Procesar Liquidación{enDepositoPendiente > 0 ? ` (resto: ${fmt(efectivoSinCubrir)})` : ''}
                        </button>
                      ) : liq.efectivo_en_mano > 0 && (
                        <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-xl px-3 py-2.5">
                          <AlertCircle size={13} /> Todo el efectivo en mano ya está cubierto por un depósito pendiente de verificar arriba.
                        </div>
                      )}

                      {sinActividad && (
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <AlertCircle size={13} /> Sin actividad este día
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {avisoMigracion&&<div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300"><AlertCircle size={15}/>{avisoMigracion}</div>}

        {diagnostico.length>0&&<section className="bg-[#181d24] rounded-2xl border border-[#2d3748] overflow-hidden"><div className="px-4 py-3.5 border-b border-[#2d3748]"><h2 className="font-bold text-white text-sm">Conciliación por custodio</h2><p className="text-[10px] text-gray-500">Saldo actual, movimientos y alertas de calidad.</p></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="text-gray-500 bg-[#0c0f12]"><tr><th className="text-left px-4 py-2">Custodio</th><th className="text-right px-3">En mano</th><th className="text-right px-3">Liquidado</th><th className="text-right px-3">Entradas</th><th className="text-right px-3">Salidas</th><th className="text-right px-4">Alertas</th></tr></thead><tbody className="divide-y divide-[#2d3748]">{diagnostico.map(d=><tr key={d.repartidor_id}><td className="px-4 py-3 font-bold text-white">{d.nombre}</td><td className="px-3 text-right text-orange-400 font-bold">{fmt(Number(d.efectivo_en_mano))}</td><td className="px-3 text-right text-green-400">{fmt(Number(d.total_liquidado))}</td><td className="px-3 text-right text-gray-300">{fmt(Number(d.transferido_entrada))}</td><td className="px-3 text-right text-gray-300">{fmt(Number(d.transferido_salida))}</td><td className={`px-4 text-right font-bold ${Number(d.datos_anomalos)>0?'text-red-400':'text-green-500'}`}>{Number(d.datos_anomalos)>0?d.datos_anomalos:'✓'}</td></tr>)}</tbody></table></div></section>}

        <section className="bg-[#181d24] rounded-2xl border border-[#2d3748] overflow-hidden">
          <div className="px-4 py-3.5 border-b border-[#2d3748]"><h2 className="font-bold text-white text-sm">Libro de movimientos ({movimientos.length})</h2><p className="text-[10px] text-gray-500">Registro inmutable de cada ingreso de caja del día.</p></div>
          {movimientos.length===0?<p className="p-6 text-center text-xs text-gray-500">Todavía no hay movimientos registrados.</p>:<div className="divide-y divide-[#2d3748]">{movimientos.map(m=>{const rep=liquidaciones.find(l=>l.repartidor_id===m.repartidor_id);return <div key={m.id} className={`px-4 py-3 flex flex-wrap items-center gap-3 text-xs ${m.reversado_at?'opacity-50':''}`}><div className="min-w-0 flex-1"><p className="font-bold text-white">{rep?.nombre||'Repartidor'} · {m.metodo==='caja'?'Efectivo':'Transferencia'}</p><p className="text-gray-500">{new Date(m.created_at).toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'})} · recibió {m.recibido_por}{m.referencia?` · Ref. ${m.referencia}`:''}</p>{m.reversado_at&&<p className="text-red-400">Reversado: {m.motivo_reverso}</p>}</div><div className="text-right"><p className={`font-black ${m.reversado_at?'line-through text-gray-500':'text-green-400'}`}>{fmt(Number(m.monto))}</p><p className="text-[9px] text-gray-600">{fmt(Number(m.saldo_antes))} → {fmt(Number(m.saldo_despues))}</p></div>{!m.reversado_at&&<button onClick={()=>reversarMovimiento(m)} disabled={reversando===m.id} className="rounded-lg border border-red-500/30 px-2.5 py-1.5 text-[10px] font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-50">{reversando===m.id?'Procesando…':'Reversar'}</button>}</div>})}</div>}
        </section>

        {/* MODAL DE PROCESAR LIQUIDACIÓN */}
        {modalLiquidar && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-6 w-full max-w-md space-y-5">
              <div className="flex justify-between items-center border-b border-[#2d3748] pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white">Registrar Liquidación</h3>
                  <p className="text-[10px] text-gray-500">Repartidor: {modalLiquidar.nombre}</p>
                </div>
                <button onClick={() => setModalLiquidar(null)} className="text-gray-500 hover:text-white p-1">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                
                {/* Monto a Liquidar */}
                <div className="bg-[#0c0f12] border border-[#2d3748] rounded-2xl p-4 flex justify-between items-center">
                  <div><span className="block text-gray-400 font-semibold">Saldo registrado en mano</span><span className="text-[9px] text-gray-600">Puede registrar un abono parcial</span></div>
                  <span className="text-lg font-black text-orange-400">{fmt(modalLiquidar.efectivo_en_mano)}</span>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Monto realmente recibido</label>
                  <div className="relative"><DollarSign className="absolute left-3 top-2.5 text-gray-500" size={14}/><input type="number" min="0.01" step="0.01" max={modalLiquidar.efectivo_en_mano} value={montoRecibido} onChange={e=>setMontoRecibido(e.target.value)} className="w-full bg-[#0c0f12] border border-[#2d3748] rounded-xl pl-9 pr-3 py-2 text-white focus:outline-none focus:border-green-500 text-xs"/></div>
                </div>

                {/* Persona que recibe */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Responsable Receptor (Administrador)</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 text-gray-500" size={14} />
                    <input 
                      type="text"
                      placeholder="Nombre del responsable de caja"
                      value={recibidoPor}
                      onChange={e => setRecibidoPor(e.target.value)}
                      className="w-full bg-[#0c0f12] border border-[#2d3748] rounded-xl pl-9 pr-3 py-2 text-white focus:outline-none focus:border-green-500 text-xs"
                    />
                  </div>
                </div>

                {/* Método de Liquidación */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Método de Entrega</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setMetodo('caja')}
                      className={`py-2 px-3 rounded-xl border text-center font-bold transition ${
                        metodo === 'caja' 
                          ? 'bg-[#00b074]/15 border-[#00b074] text-white' 
                          : 'bg-[#0c0f12] border-[#2d3748] text-gray-400 hover:text-white'
                      }`}>
                      💵 Efectivo en Oficina
                    </button>
                    <button
                      type="button"
                      onClick={() => setMetodo('transferencia')}
                      className={`py-2 px-3 rounded-xl border text-center font-bold transition ${
                        metodo === 'transferencia' 
                          ? 'bg-[#00b074]/15 border-[#00b074] text-white' 
                          : 'bg-[#0c0f12] border-[#2d3748] text-gray-400 hover:text-white'
                      }`}>
                      🏦 Depósito / Transf.
                    </button>
                  </div>
                </div>

                {/* Campos condicionales para transferencia */}
                {metodo === 'transferencia' && (
                  <div className="space-y-3 p-3 bg-[#0c0f12] border border-[#2d3748] rounded-2xl">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Número de Comprobante / Referencia</label>
                      <input 
                        type="text"
                        placeholder="Nro. referencia del depósito"
                        value={referencia}
                        onChange={e => setReferencia(e.target.value)}
                        className="w-full bg-[#181d24] border border-[#2d3748] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-green-500 text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Foto del Comprobante Bancario</label>
                      <div className="flex items-center gap-3">
                        <label className="flex-1 flex items-center justify-center gap-2 bg-[#181d24] border border-[#2d3748] rounded-xl py-2 cursor-pointer hover:bg-gray-800 text-gray-400 hover:text-white transition">
                          <Upload size={14} />
                          <span>Subir Voucher</span>
                          <input 
                            type="file"
                            accept="image/*"
                            onChange={subirFotoComprobante}
                            className="hidden"
                          />
                        </label>
                        {subiendoFoto && <Loader2 size={16} className="animate-spin text-green-500" />}
                      </div>
                      {fotoUrl && (
                        <div className="text-[9.5px] text-green-400 flex items-center gap-1 mt-1">
                          <CheckCircle size={11} /> Archivo cargado con éxito.
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setModalLiquidar(null)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 rounded-2xl text-xs transition cursor-pointer border-0">
                  Cancelar
                </button>
                <button
                  onClick={confirmarLiquidacion}
                  disabled={procesando !== null || subiendoFoto}
                  className="flex-1 bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-50 text-white font-bold py-3 rounded-2xl text-xs transition cursor-pointer border-0">
                  Confirmar Liquidación
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VALE DE CAJA DIGITAL (IMPRESIÓN / VISUALIZACIÓN) */}
        {valeVista && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-6 w-full max-w-sm space-y-6 flex flex-col items-center">
              
              {/* Vale digital imprimible */}
              <div id="printable-receipt" className="w-full bg-white text-slate-900 p-6 rounded-2xl shadow-inner border border-slate-300 font-mono text-[10.5px] space-y-4">
                <div className="text-center border-b border-dashed border-slate-400 pb-3">
                  <div className="text-sm font-black tracking-widest">LA CRAYOLA</div>
                  <div className="text-[9px] text-slate-500">VALE DE CAJA DIGITAL</div>
                  <div className="text-xs font-bold mt-1.5">{valeVista.numero}</div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span>Fecha:</span>
                    <span className="font-bold">{valeVista.fecha}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Entregado Por:</span>
                    <span className="font-bold">{valeVista.repartidor}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Recibido Por:</span>
                    <span className="font-bold">{valeVista.recibidoPor}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Método:</span>
                    <span className="font-bold">{valeVista.metodo}</span>
                  </div>
                </div>

                <div className="border-t border-b border-dashed border-slate-400 py-3 text-center my-3">
                  <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Total Recibido en Efectivo</div>
                  <div className="text-2xl font-black text-slate-900 mt-1">{fmt(valeVista.monto)}</div>
                </div>

                <div className="text-center pt-2 text-[8px] text-slate-400 leading-normal">
                  Este documento digital certifica el recibo formal de efectivo en caja chica. Transacción registrada y validada en el sistema.
                </div>
              </div>

              <div className="flex gap-3 w-full">
                <button
                  onClick={() => {
                    const printContent = document.getElementById('printable-receipt')?.innerHTML;
                    if (printContent) {
                      const printWindow = window.open('', '_blank');
                      printWindow?.document.write(`
                        <html>
                          <head>
                            <title>Imprimir Vale de Caja</title>
                            <style>
                              body { font-family: monospace; padding: 20px; }
                              #printable-receipt { max-width: 300px; margin: 0 auto; }
                            </style>
                          </head>
                          <body>
                            <div id="printable-receipt">${printContent}</div>
                            <script>window.print(); window.close();</script>
                          </body>
                        </html>
                      `);
                      printWindow?.document.close();
                    }
                  }}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 rounded-2xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer border-0">
                  <Printer size={14} /> Imprimir Vale
                </button>
                
                <button
                  onClick={() => setValeVista(null)}
                  className="flex-1 bg-[#00b074] hover:bg-[#008f5d] text-white font-bold py-3 rounded-2xl text-xs transition cursor-pointer border-0">
                  Finalizar
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
