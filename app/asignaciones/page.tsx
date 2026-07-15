'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import Sidebar from '@/components/Sidebar'
import { 
  Truck, Package, Users, Plus, Trash2, Loader2, 
  MapPin, CheckCircle, RefreshCw, AlertCircle, Info, ArrowRight,
  Phone, ExternalLink, Lock, Unlock, DollarSign, Check
} from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

interface Pedido {
  id: string
  numero: number
  nombre_cliente: string
  telefono: string
  direccion: string | null
  ciudad: string
  total: number
  estado: string
  created_at: string
  geo_lat?: number | null
  geo_lng?: number | null
  metodo_pago?: string | null
  pago_confirmado?: boolean | null
  referencias?: string | null
  notas?: string | null
}

interface Repartidor {
  id: string
  nombre: string
  estado: string
  activo: boolean
}

interface Asignacion {
  id: string
  pedido_id: string
  repartidor_id: string
  estado: string
  prioridad: number
  rep_repartidores?: {
    nombre: string
  }
  shopper?: {
    nombre: string
  }
  rider?: {
    nombre: string
  }
}

export default function AsignacionesPage() {
  const { user } = useAuth()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [repartidores, setRepartidores] = useState<Repartidor[]>([])
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [pickingData, setPickingData] = useState<any[]>([])
  
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  // Variables de estado para modal de validación GPS y pagos
  const [modalPedido, setModalPedido] = useState<Pedido | null>(null)
  const [direccionesCliente, setDireccionesCliente] = useState<any[]>([])
  const [direccionSeleccionada, setDireccionSeleccionada] = useState<string>('')
  const [nuevaDireccion, setNuevaDireccion] = useState({ nombre: 'Casa', lat: '', lng: '', referencias: '' })
  const [cargandoDirecciones, setCargandoDirecciones] = useState(false)

  async function abrirVerificacion(p: Pedido) {
    setModalPedido(p)
    setDireccionSeleccionada('')
    setNuevaDireccion({ nombre: 'Casa', lat: '', lng: '', referencias: p.referencias || '' })
    setCargandoDirecciones(true)
    try {
      const { data, error } = await supabase
        .from('rep_clientes_direcciones')
        .select('*')
        .eq('telefono', p.telefono)
      if (error) throw error
      setDireccionesCliente(data || [])
      
      // Auto-seleccionar si hay una verificada
      const verif = data?.find(d => d.verificada)
      if (verif) {
        setDireccionSeleccionada(verif.id)
      }
    } catch (err) {
      console.error("Error al cargar direcciones:", err)
    } finally {
      setCargandoDirecciones(false)
    }
  }

  async function confirmarPagoPedido(pedidoId: string) {
    setProcesando(true)
    setError('')
    try {
      const { error } = await supabase
        .from('ol_pedidos')
        .update({ pago_confirmado: true })
        .eq('id', pedidoId)
      if (error) throw error
      
      setPedidos(prev => prev.map(p => p.id === pedidoId ? { ...p, pago_confirmado: true } as any : p))
      setModalPedido(prev => prev && prev.id === pedidoId ? { ...prev, pago_confirmado: true } as any : prev)
      setMensaje('✓ Pago validado y registrado en el sistema.')
    } catch (err: any) {
      setError(`Error al confirmar pago: ${err.message}`)
    } finally {
      setProcesando(false)
    }
  }

  async function liberarPedido(p: Pedido) {
    setProcesando(true)
    setError('')
    try {
      let lat = p.geo_lat
      let lng = p.geo_lng

      if (direccionSeleccionada) {
        const dSel = direccionesCliente.find(d => d.id === direccionSeleccionada)
        if (dSel) {
          lat = dSel.geo_lat
          lng = dSel.geo_lng
        }
      } else if (nuevaDireccion.lat && nuevaDireccion.lng) {
        const latNum = parseFloat(nuevaDireccion.lat)
        const lngNum = parseFloat(nuevaDireccion.lng)
        
        const { error: errDir } = await supabase
          .from('rep_clientes_direcciones')
          .insert({
            telefono: p.telefono,
            nombre_direccion: nuevaDireccion.nombre,
            direccion: p.direccion || 'Sin dirección',
            ciudad: p.ciudad,
            referencias: nuevaDireccion.referencias,
            geo_lat: latNum,
            geo_lng: lngNum,
            verificada: true
          })
        if (errDir) throw errDir
        
        lat = latNum
        lng = lngNum
      }

      const { error: errPed } = await supabase
        .from('ol_pedidos')
        .update({
          estado: 'confirmado',
          geo_lat: lat,
          geo_lng: lng
        })
        .eq('id', p.id)
      if (errPed) throw errPed

      setPedidos(prev => prev.map(o => o.id === p.id ? { ...o, estado: 'confirmado', geo_lat: lat, geo_lng: lng } as any : o))
      setMensaje('✓ Pedido confirmado y liberado para Auto-Asignación.')
      setModalPedido(null)
      await cargarDatos()
    } catch (err: any) {
      setError(`Error al liberar pedido: ${err.message}`)
    } finally {
      setProcesando(false)
    }
  }

  async function cargarDatos() {
    setCargando(true)
    setError('')
    setMensaje('')
    try {
      const { data: dataPed, error: errPed } = await supabase
        .from('ol_pedidos')
        .select('*')
        .order('numero', { ascending: false })
        .limit(30)
      
      if (errPed) throw errPed
      setPedidos(dataPed || [])

      const { data: dataRep, error: errRep } = await supabase
        .from('rep_repartidores')
        .select('id, nombre, estado, activo')
        .eq('activo', true)
        .order('nombre')
      
      if (errRep) throw errRep
      setRepartidores(dataRep || [])

      const { data: dataAsig, error: errAsig } = await supabase
        .from('rep_asignaciones')
        .select(`
          *,
          shopper:rep_repartidores!shopper_id(nombre),
          rider:rep_repartidores!rider_id(nombre),
          rep_repartidores!repartidor_id(nombre)
        `)
        .in('estado', ['asignado', 'recolectado', 'en_ruta'])
      
      if (errAsig) throw errAsig
      setAsignaciones((dataAsig || []) as any)

      const activePedidoIds = dataAsig?.map((a: any) => a.pedido_id) || []
      if (activePedidoIds.length > 0) {
        const { data: pickData, error: errPick } = await supabase
          .from('rep_picking')
          .select('pedido_id, estado')
          .in('pedido_id', activePedidoIds)
        if (errPick) throw errPick
        setPickingData(pickData || [])
      } else {
        setPickingData([])
      }

    } catch (err: any) {
      setError(`Error al cargar datos: ${err.message}`)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  async function forzarAsignacion(pedidoId: string, repartidorId: string) {
    if (!pedidoId || !repartidorId) return
    setProcesando(true)
    setError('')
    setMensaje('')
    try {
      const { error: errInsert } = await supabase
        .from('rep_asignaciones')
        .insert({
          pedido_id:     pedidoId,
          repartidor_id: repartidorId,
          shopper_id:    repartidorId,
          prioridad:     1,
          notas:         'Asignación forzada manualmente por el Administrador',
          estado:        'asignado'
        })
      if (errInsert) throw errInsert

      const { error: errUpdate } = await supabase
        .from('ol_pedidos')
        .update({ estado: 'confirmado' })
        .eq('id', pedidoId)
      if (errUpdate) throw errUpdate

      setMensaje('✓ Pedido asignado con éxito (Fuerza Mayor).')
      await cargarDatos()
    } catch (err: any) {
      setError(`Error al forzar asignación: ${err.message}`)
    } finally {
      setProcesando(false)
    }
  }

  async function forzarTraspaso(asigId: string, pedidoId: string, repartidorId: string) {
    if (!asigId || !repartidorId) return
    if (!confirm('¿Estás seguro de que deseas forzar el traspaso al repartidor seleccionado?')) return
    setProcesando(true)
    setError('')
    setMensaje('')
    try {
      const { error: errAsig } = await supabase
        .from('rep_asignaciones')
        .update({
          repartidor_id: repartidorId,
          rider_id:      repartidorId,
          handoff_at:    new Date().toISOString(),
          estado:        'en_ruta',
          updated_at:    new Date().toISOString()
        })
        .eq('id', asigId)
      if (errAsig) throw errAsig

      const { error: errUpdate } = await supabase
        .from('ol_pedidos')
        .update({ estado: 'enviado' })
        .eq('id', pedidoId)
      if (errUpdate) throw errUpdate

      await supabase.from('rep_entregas').insert({
        asignacion_id: asigId,
        repartidor_id: repartidorId,
        pedido_id:     pedidoId,
        salida_at:     new Date().toISOString(),
        exitosa:       true,
      })

      setMensaje('✓ Traspaso forzado con éxito. Pedido en ruta.')
      await cargarDatos()
    } catch (err: any) {
      setError(`Error al forzar traspaso: ${err.message}`)
    } finally {
      setProcesando(false)
    }
  }

  async function desasignarPedido(asigId: string, pedidoId: string) {
    if (!confirm('¿Estás seguro de que deseas eliminar esta asignación y liberar el pedido?')) return

    setProcesando(true)
    setError('')
    setMensaje('')

    try {
      const { error: errDel } = await supabase
        .from('rep_asignaciones')
        .delete()
        .eq('id', asigId)
      
      if (errDel) throw errDel

      const { error: errUpdate } = await supabase
        .from('ol_pedidos')
        .update({ estado: 'pendiente' })
        .eq('id', pedidoId)

      if (errUpdate) throw errUpdate

      setMensaje('✓ Asignación eliminada. El pedido vuelve a estar libre.')
      await cargarDatos()
    } catch (err: any) {
      setError(`Error al eliminar asignación: ${err.message}`)
    } finally {
      setProcesando(false)
    }
  }

  const libresCount = pedidos.filter(p => !asignaciones.some(a => a.pedido_id === p.id) && p.estado !== 'entregado').length
  const slaAlertsCount = pedidos.filter(p => {
    const isFree = !asignaciones.some(a => a.pedido_id === p.id) && p.estado !== 'entregado'
    if (!isFree) return false
    const elapsed = (Date.now() - new Date(p.created_at).getTime()) / 60000
    return elapsed > 10
  }).length
  const pickingCount = asignaciones.filter(a => a.estado === 'asignado').length
  const rutaCount = asignaciones.filter(a => a.estado === 'en_ruta').length

  return (
    <div className="flex min-h-screen bg-[#0c0f12] text-white">
      <Sidebar />
      
      <main className="flex-1 md:ml-56 pt-14 md:pt-0 p-4 md:p-6 space-y-6">
        
        <div className="flex items-center justify-between flex-wrap gap-3 border-b border-gray-800 pb-4">
          <div>
            <h1 className="text-2xl font-black text-white flex items-center gap-2">
              <Truck size={24} className="text-green-500" /> TORRE DE CONTROL DE DESPACHOS
            </h1>
            <p className="text-gray-400 text-xs mt-1">
              Monitoreo operativo y despacho en tiempo real (Shopper-First & Dispatcher Pool)
            </p>
          </div>
          <button 
            onClick={cargarDatos}
            disabled={cargando}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-xs px-3.5 py-2 rounded-xl font-bold transition cursor-pointer">
            <RefreshCw size={13} className={cargando ? 'animate-spin text-green-500' : ''} />
            Actualizar
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3.5 rounded-xl flex items-center gap-2">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        {mensaje && (
          <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-xs p-3.5 rounded-xl flex items-center gap-2">
            <CheckCircle size={16} />
            <span>{mensaje}</span>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 flex flex-col justify-between">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Pedidos Libres</span>
            <span className="text-2xl font-black text-white mt-1">{libresCount}</span>
          </div>
          <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 flex flex-col justify-between">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Alertas SLA (&gt;10 min)</span>
            <span className={`text-2xl font-black mt-1 ${slaAlertsCount > 0 ? 'text-red-400 animate-pulse' : 'text-gray-400'}`}>{slaAlertsCount}</span>
          </div>
          <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 flex flex-col justify-between">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">En Picking (Shoppers)</span>
            <span className="text-2xl font-black text-indigo-400 mt-1">{pickingCount}</span>
          </div>
          <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 flex flex-col justify-between">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">En Ruta (Riders)</span>
            <span className="text-2xl font-black text-orange-400 mt-1">{rutaCount}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          
          <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-4 flex flex-col min-h-[500px]">
            <div className="border-b border-gray-800 pb-3 flex justify-between items-center">
              <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
                <Package size={16} className="text-green-500" /> Pool de Espera (Libres)
              </h2>
              <span className="bg-green-500/10 text-green-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                {libresCount}
              </span>
            </div>
            
            <div className="space-y-3 flex-1 overflow-y-auto max-h-[550px] pr-1">
              {pedidos
                .filter(p => !asignaciones.some(a => a.pedido_id === p.id) && p.estado !== 'entregado')
                .map(p => {
                  const created = new Date(p.created_at).getTime()
                  const elapsedMin = Math.floor((Date.now() - created) / 60000)
                  const esRetrasado = elapsedMin > 10

                  const esTransferencia = p.metodo_pago === 'transferencia'
                  const necesitaValidarPago = esTransferencia && !p.pago_confirmado
                  const gpsVerificado = p.geo_lat && p.geo_lng

                  // Determinar borde y fondo según el estado de pago
                  const borderClass = necesitaValidarPago 
                    ? 'border-orange-500/40 bg-orange-950/10' 
                    : 'border-[#2d3748] bg-[#0c0f12]'

                  return (
                    <div key={p.id} className={`border rounded-2xl p-4 space-y-3 transition ${borderClass}`}>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-green-400">Pedido #{String(p.numero).padStart(4,'0')}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          esRetrasado ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-gray-800 text-gray-400'
                        }`}>
                          ⏱️ Hace {elapsedMin} min
                        </span>
                      </div>
                      
                      <div className="space-y-1">
                        <div className="font-extrabold text-xs text-white">{p.nombre_cliente}</div>
                        <div className="text-[10px] text-gray-500">{p.direccion || 'Sin dirección'}, {p.ciudad}</div>
                        <div className="text-xs font-black text-white pt-1">{fmt(p.total)}</div>
                      </div>

                      {/* Badges de Estado Operativo */}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {esTransferencia ? (
                          <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-md border ${
                            p.pago_confirmado 
                              ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                              : 'bg-orange-500/10 text-orange-400 border-orange-500/20 animate-pulse'
                          }`}>
                            🏦 Transferencia {p.pago_confirmado ? '(Pagado)' : '(Por Validar)'}
                          </span>
                        ) : (
                          <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-md border bg-blue-500/10 text-blue-400 border-blue-500/20">
                            💵 Contra-Entrega (Efectivo)
                          </span>
                        )}

                        {gpsVerificado ? (
                          <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-md border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                            📍 GPS Verificado
                          </span>
                        ) : (
                          <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-md border bg-rose-500/10 text-rose-400 border-rose-500/20 animate-pulse">
                            ⚠️ Falta GPS
                          </span>
                        )}

                        <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-md border ${
                          p.estado === 'confirmado' 
                            ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                            : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                        }`}>
                          {p.estado === 'confirmado' ? '✓ Confirmado (Pool)' : '⏳ Pendiente'}
                        </span>
                      </div>
                      
                      <div className="pt-2 border-t border-gray-850 flex flex-col gap-2">
                        <button
                          onClick={() => abrirVerificacion(p)}
                          className="w-full bg-green-600 hover:bg-green-500 text-white font-extrabold text-[10px] py-1.5 rounded-xl transition cursor-pointer flex items-center justify-center gap-1">
                          🔍 Validar Pago & GPS
                        </button>
                        
                        <div className="flex gap-2 mt-1">
                          <select
                            id={`select-rep-${p.id}`}
                            defaultValue=""
                            className="flex-1 bg-[#0c0f12] border border-[#2d3748] rounded-xl px-2 py-1 text-[10px] text-white focus:outline-none focus:border-green-500">
                            <option value="">-- Forzar Shopper --</option>
                            {repartidores.map(r => (
                              <option key={r.id} value={r.id}>{r.nombre}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => {
                              const sel = document.getElementById(`select-rep-${p.id}`) as HTMLSelectElement
                              if (sel.value) forzarAsignacion(p.id, sel.value)
                            }}
                            disabled={procesando}
                            className="bg-gray-800 hover:bg-gray-700 border border-gray-750 text-white font-bold text-[10px] px-3 py-1 rounded-xl transition cursor-pointer shrink-0">
                            ⚡ Asignar
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })
              }
              {libresCount === 0 && (
                <p className="text-xs text-gray-500 text-center py-12">No hay pedidos en cola de espera.</p>
              )}
            </div>
          </div>

          <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-4 flex flex-col min-h-[500px]">
            <div className="border-b border-gray-800 pb-3 flex justify-between items-center">
              <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
                <Users size={16} className="text-green-500" /> Compras en Curso (Picking)
              </h2>
              <span className="bg-indigo-500/10 text-indigo-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                {pickingCount}
              </span>
            </div>
            
            <div className="space-y-3 flex-1 overflow-y-auto max-h-[550px] pr-1">
              {asignaciones
                .filter(a => a.estado === 'asignado')
                .map(a => {
                  const ped = pedidos.find(p => p.id === a.pedido_id)
                  const items = pickingData.filter(i => i.pedido_id === a.pedido_id)
                  const compl = items.filter(i => i.estado !== 'pendiente').length
                  const pct = items.length > 0 ? Math.round((compl / items.length) * 100) : 0
                  
                  return (
                    <div key={a.id} className="bg-[#0c0f12] border border-[#2d3748] rounded-2xl p-4 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-green-400">Pedido #{ped ? String(ped.numero).padStart(4,'0') : '????'}</span>
                        <span className="bg-indigo-500/10 text-indigo-400 text-[10px] font-bold px-2 py-0.5 rounded-md">
                          🛒 En Compra
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="font-extrabold text-xs text-white">{ped?.nombre_cliente || 'Desconocido'}</div>
                        <div className="text-[10px] text-gray-400 font-semibold flex items-center gap-1">
                          👤 Shopper: {a.shopper?.nombre || a.rep_repartidores?.nombre || 'Desconocido'}
                        </div>
                      </div>

                      {items.length > 0 ? (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[9px] text-gray-400">
                            <span>Picking: {compl} de {items.length} items</span>
                            <span className="font-bold">{pct}%</span>
                          </div>
                          <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                            <div className="bg-green-500 h-full rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      ) : (
                        <div className="text-[9px] text-yellow-500/80 bg-yellow-500/5 px-2 py-1 rounded-md">
                          ⚠️ Preparando lista de picking...
                        </div>
                      )}

                      <div className="pt-2 border-t border-gray-850 flex justify-between items-center">
                        <span className="text-xs font-black text-green-400">{fmt(ped?.total ?? 0)}</span>
                        <button
                          onClick={() => desasignarPedido(a.id, a.pedido_id)}
                          disabled={procesando}
                          className="text-red-400 hover:text-red-300 text-[10px] font-bold flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-red-500/10 transition cursor-pointer">
                          <Trash2 size={11} /> Liberar Pedido
                        </button>
                      </div>
                    </div>
                  )
                })
              }
              {pickingCount === 0 && (
                <p className="text-xs text-gray-500 text-center py-12">No hay compras activas en este momento.</p>
              )}
            </div>
          </div>

          <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-4 flex flex-col min-h-[500px]">
            <div className="border-b border-gray-800 pb-3 flex justify-between items-center">
              <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
                <Truck size={16} className="text-green-500" /> Despacho y Ruta
              </h2>
              <span className="bg-orange-500/10 text-orange-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                {asignaciones.filter(a => a.estado === 'recolectado' || a.estado === 'en_ruta').length}
              </span>
            </div>
            
            <div className="space-y-3 flex-1 overflow-y-auto max-h-[550px] pr-1">
              {asignaciones
                .filter(a => a.estado === 'recolectado' || a.estado === 'en_ruta')
                .map(a => {
                  const ped = pedidos.find(p => p.id === a.pedido_id)
                  const esCaja = a.estado === 'recolectado'
                  
                  return (
                    <div key={a.id} className="bg-[#0c0f12] border border-[#2d3748] rounded-2xl p-4 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-green-400">Pedido #{ped ? String(ped.numero).padStart(4,'0') : '????'}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          esCaja ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' : 'bg-orange-500/10 text-orange-400'
                        }`}>
                          {esCaja ? '🛍️ Listo en Caja' : '🛵 En Ruta'}
                        </span>
                      </div>
                      
                      <div className="space-y-1">
                        <div className="font-extrabold text-xs text-white">{ped?.nombre_cliente || 'Desconocido'}</div>
                        <div className="text-[10px] text-gray-400 font-semibold">
                          👤 Shopper: {a.shopper?.nombre || a.rep_repartidores?.nombre || 'Desconocido'} {a.rider?.nombre ? `· Rider: ${a.rider.nombre}` : ''}
                        </div>
                      </div>

                      {esCaja && (
                        <div className="pt-2 border-t border-gray-850 flex gap-2">
                          <select
                            id={`select-rider-${a.id}`}
                            defaultValue=""
                            className="flex-1 bg-[#0c0f12] border border-[#2d3748] rounded-xl px-2 py-1 text-[10px] text-white focus:outline-none focus:border-green-500">
                            <option value="">-- Forzar Rider --</option>
                            {repartidores.map(r => (
                              <option key={r.id} value={r.id}>{r.nombre}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => {
                              const sel = document.getElementById(`select-rider-${a.id}`) as HTMLSelectElement
                              if (sel.value) forzarTraspaso(a.id, a.pedido_id, sel.value)
                            }}
                            disabled={procesando}
                            className="bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-[10px] px-3 py-1 rounded-xl transition cursor-pointer">
                            📲 Despachar
                          </button>
                        </div>
                      )}

                      <div className="pt-2 border-t border-gray-850 flex justify-between items-center">
                        <span className="text-xs font-black text-green-400">{fmt(ped?.total ?? 0)}</span>
                        <button
                          onClick={() => desasignarPedido(a.id, a.pedido_id)}
                          disabled={procesando}
                          className="text-red-400 hover:text-red-300 text-[10px] font-bold flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-red-500/10 transition cursor-pointer">
                          <Trash2 size={11} /> Cancelar
                        </button>
                      </div>
                    </div>
                  )
                })
              }
              {asignaciones.filter(a => a.estado === 'recolectado' || a.estado === 'en_ruta').length === 0 && (
                <p className="text-xs text-gray-500 text-center py-12">No hay despachos ni rutas activas.</p>
              )}
            </div>
          </div>

        </div>

        <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2 border-b border-gray-800 pb-3">
            <Package size={16} className="text-green-500" /> Historial de Pedidos Recientes
          </h2>

          {cargando ? (
            <div className="flex justify-center py-10">
              <Loader2 size={24} className="animate-spin text-green-500" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="py-2.5 font-bold">Número</th>
                    <th className="py-2.5 font-bold">Cliente</th>
                    <th className="py-2.5 font-bold">Dirección / Ciudad</th>
                    <th className="py-2.5 font-bold">Total</th>
                    <th className="py-2.5 font-bold text-center">Asignación / Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-850">
                  {pedidos.map(p => {
                    const asig = asignaciones.find(a => a.pedido_id === p.id)
                    return (
                      <tr key={p.id} className="hover:bg-gray-805/10">
                        <td className="py-2.5 font-mono text-green-400 font-bold">#{String(p.numero).padStart(4,'0')}</td>
                        <td className="py-2.5 font-semibold text-white">{p.nombre_cliente}</td>
                        <td className="py-2.5 text-gray-400">
                          <span className="flex items-center gap-0.5 truncate max-w-xs">
                            <MapPin size={10} className="shrink-0" />
                            {p.direccion ? `${p.direccion}, ${p.ciudad}` : p.ciudad}
                          </span>
                        </td>
                        <td className="py-2.5 font-bold text-white">{fmt(p.total)}</td>
                        <td className="py-2.5 text-center">
                          {asig ? (
                            <span className="bg-green-500/10 text-green-400 px-2.5 py-1 rounded-full text-[9px] font-bold">
                              👤 S: {asig.shopper?.nombre || asig.rep_repartidores?.nombre} {asig.rider?.nombre ? `· R: ${asig.rider.nombre}` : ''} ({asig.estado})
                            </span>
                          ) : p.estado === 'entregado' ? (
                            <span className="bg-slate-800 text-slate-500 px-2.5 py-1 rounded-full text-[9px] font-semibold">
                              Entregado
                            </span>
                          ) : (
                            <span className="bg-yellow-500/10 text-yellow-400 px-2.5 py-1 rounded-full text-[9px] font-bold">
                              En Espera
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* MODAL DE VALIDACIÓN DE PAGO Y DIRECCIÓN GPS */}
        {modalPedido && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-[#0c0f12]/50">
                <div>
                  <h3 className="font-bold text-white text-base">Validación de Pedido #{String(modalPedido.numero).padStart(4, '0')}</h3>
                  <p className="text-xs text-gray-400">Verificación obligatoria de pago y localización GPS</p>
                </div>
                <button
                  onClick={() => setModalPedido(null)}
                  className="text-gray-450 hover:text-white text-lg font-bold">
                  &times;
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
                {/* 1. Datos Generales */}
                <div className="bg-[#0c0f12]/50 rounded-2xl p-4 border border-[#2d3748] space-y-2 text-xs text-left">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Cliente:</span>
                    <span className="font-bold text-white">{modalPedido.nombre_cliente}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Teléfono:</span>
                    <span className="font-bold text-white flex items-center gap-1">
                      <Phone size={11} className="text-green-500" />
                      {modalPedido.telefono}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Dirección:</span>
                    <span className="font-bold text-white text-right max-w-[240px] truncate">{modalPedido.direccion || 'Sin dirección'}</span>
                  </div>
                  
                  {modalPedido.referencias && (
                    <div className="flex justify-between items-start">
                      <span className="text-gray-400 shrink-0">Referencias:</span>
                      <span className="font-bold text-gray-300 text-right max-w-[220px] break-words">{modalPedido.referencias}</span>
                    </div>
                  )}

                  {modalPedido.notas && (
                    <div className="bg-yellow-500/5 p-2.5 rounded-xl border border-yellow-500/10 mt-1 space-y-1">
                      <div className="text-[10px] text-yellow-500 font-bold uppercase tracking-wider">Notas / Transferencia (Doble clic para copiar):</div>
                      <div className="font-mono text-xs text-white break-words select-all bg-black/40 p-1.5 rounded border border-gray-800/40">
                        {modalPedido.notas}
                      </div>
                    </div>
                  )}

                  {modalPedido.geo_lat && modalPedido.geo_lng && (
                    <div className="pt-1.5">
                      <a
                        href={"https://www.google.com/maps/search/?api=1&query=" + modalPedido.geo_lat + "," + modalPedido.geo_lng}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 font-bold underline flex items-center gap-1 hover:underline">
                        🗺️ Ver Coordenadas del Pedido en Google Maps
                      </a>
                    </div>
                  )}

                  <div className="flex justify-between border-t border-gray-800 pt-2 font-bold">
                    <span className="text-gray-400">Total a Cobrar:</span>
                    <span className="text-green-400 text-sm">{fmt(modalPedido.total)}</span>
                  </div>
                </div>

                {/* 2. Sección de Pago */}
                <div className="space-y-2 text-left">
                  <h4 className="text-xs font-bold text-gray-200 uppercase tracking-wider">💳 Control de Pago</h4>
                  
                  {modalPedido.metodo_pago === 'transferencia' ? (
                    <div className={`rounded-2xl p-4 border flex flex-col gap-3 ${
                      modalPedido.pago_confirmado 
                        ? 'bg-green-500/5 border-green-500/20' 
                        : 'bg-orange-500/5 border-orange-500/20'
                    }`}>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-300 font-semibold flex items-center gap-1.5">
                          🏦 Pago por Transferencia Bancaria
                        </span>
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                          modalPedido.pago_confirmado ? 'bg-green-500/10 text-green-400' : 'bg-orange-500/10 text-orange-400 animate-pulse'
                        }`}>
                          {modalPedido.pago_confirmado ? 'PAGO CONFIRMADO' : 'PENDIENTE DE VALIDAR'}
                        </span>
                      </div>
                      
                      {!modalPedido.pago_confirmado ? (
                        <button
                          onClick={() => confirmarPagoPedido(modalPedido.id)}
                          disabled={procesando}
                          className="w-full bg-orange-600 hover:bg-orange-500 text-white font-extrabold text-xs py-2 rounded-xl transition cursor-pointer flex items-center justify-center gap-1">
                          {procesando ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                          Validar Depósito / Pago Recibido
                        </button>
                      ) : (
                        <div className="text-[10px] text-green-400/90 font-medium flex items-center gap-1 bg-green-500/5 p-2 rounded-lg">
                          ✓ Depósito bancario verificado por el Administrador. Pago conciliado con éxito.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex justify-between items-center text-xs">
                      <span className="text-gray-300 font-semibold flex items-center gap-1.5">
                        💵 Método: Pago Contra-Entrega (Efectivo / Puerta)
                      </span>
                      <span className="bg-blue-500/10 text-blue-400 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                        PAGO AL ENTREGAR
                      </span>
                    </div>
                  )}
                </div>

                {/* 3. Sección de Ubicación GPS */}
                <div className="space-y-2.5 text-left">
                  <h4 className="text-xs font-bold text-gray-200 uppercase tracking-wider flex justify-between items-center">
                    <span>📍 Localización GPS</span>
                    {cargandoDirecciones && <Loader2 size={12} className="animate-spin text-green-500" />}
                  </h4>

                  {/* Direcciones guardadas */}
                  {direccionesCliente.length > 0 ? (
                    <div className="space-y-2">
                      <label className="text-[10px] text-gray-400 font-semibold">Seleccionar una ubicación verificada del historial:</label>
                      <div className="grid grid-cols-1 gap-2">
                        {direccionesCliente.map(d => (
                          <label
                            key={d.id}
                            className={`flex items-start gap-3 p-3 rounded-2xl border text-xs cursor-pointer transition ${
                              direccionSeleccionada === d.id 
                                ? 'bg-green-500/5 border-green-500/40 text-white' 
                                : 'bg-[#0c0f12]/30 border-gray-800 text-gray-400 hover:border-gray-700'
                            }`}>
                            <input
                              type="radio"
                              name="direccion_seleccionada"
                              checked={direccionSeleccionada === d.id}
                              onChange={() => {
                                setDireccionSeleccionada(d.id)
                              }}
                              className="mt-0.5 accent-green-500"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-bold flex items-center justify-between text-gray-200">
                                <div className="flex items-center gap-1">
                                  <span>{d.nombre_direccion}</span>
                                  {d.verificada && <span className="bg-green-500/10 text-green-400 text-[8px] font-extrabold px-1.5 py-0.2 rounded">GPS Verificado</span>}
                                </div>
                                <a
                                  href={"https://www.google.com/maps/search/?api=1&query=" + d.geo_lat + "," + d.geo_lng}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:text-blue-300 font-bold text-[9px] underline">
                                  🗺️ Ver en Mapa
                                </a>
                              </div>
                              <div className="text-[10px] truncate">{d.direccion}</div>
                              <div className="text-[9px] text-gray-500 mt-0.5">Coords: {d.geo_lat}, {d.geo_lng}</div>
                            </div>
                          </label>
                        ))}
                        
                        <label
                          className={`flex items-start gap-3 p-3 rounded-2xl border text-xs cursor-pointer transition ${
                            direccionSeleccionada === '' 
                              ? 'bg-green-500/5 border-green-500/40 text-white' 
                              : 'bg-[#0c0f12]/30 border-gray-800 text-gray-400 hover:border-gray-700'
                          }`}>
                          <input
                            type="radio"
                            name="direccion_seleccionada"
                            checked={direccionSeleccionada === ''}
                            onChange={() => setDireccionSeleccionada('')}
                            className="mt-0.5 accent-green-500"
                          />
                          <div className="flex-1">
                            <span className="font-bold text-gray-200">Nueva ubicación / Dirección personalizada</span>
                          </div>
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-4 text-xs text-rose-400 flex items-center gap-2">
                      <AlertCircle size={14} className="shrink-0" />
                      <span><strong>Cliente Nuevo:</strong> No tiene ubicaciones GPS registradas en su historial.</span>
                    </div>
                  )}

                  {/* Crear/Configurar Nueva Dirección */}
                  {direccionSeleccionada === '' && (
                    <div className="bg-[#0c0f12]/50 border border-gray-800 rounded-2xl p-4 space-y-3">
                      <div className="flex justify-between items-center flex-wrap gap-2">
                        <label className="text-[10px] text-gray-400 font-bold uppercase">Registrar Coordenadas GPS</label>
                        <a
                          href={"https://wa.me/593" + (modalPedido.telefono.startsWith('0') ? modalPedido.telefono.slice(1) : modalPedido.telefono) + "?text=" + encodeURIComponent(
                            "Hola " + modalPedido.nombre_cliente + ", te saluda La Crayola. Para poder entregar tu pedido #" + modalPedido.numero + " sin contratiempos, ¿serías tan amable de compartirnos tu ubicación GPS exacta por este medio? ¡Muchas gracias!"
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-green-600 hover:bg-green-550 text-white font-extrabold text-[9px] px-2.5 py-1 rounded-lg flex items-center gap-1 transition cursor-pointer">
                          <Phone size={10} /> Pedir Ubicación por WhatsApp
                        </a>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="space-y-1 col-span-2">
                          <label className="text-[10px] text-gray-500">Etiqueta de la dirección (ej: Casa, Trabajo):</label>
                          <input
                            type="text"
                            value={nuevaDireccion.nombre}
                            onChange={e => setNuevaDireccion(prev => ({ ...prev, nombre: e.target.value }))}
                            className="w-full bg-[#0c0f12] border border-gray-800 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-green-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-500">Latitud:</label>
                          <input
                            type="text"
                            placeholder="ej: -0.1806"
                            value={nuevaDireccion.lat}
                            onChange={e => setNuevaDireccion(prev => ({ ...prev, lat: e.target.value }))}
                            className="w-full bg-[#0c0f12] border border-gray-800 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-green-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-500">Longitud:</label>
                          <input
                            type="text"
                            placeholder="ej: -78.4658"
                            value={nuevaDireccion.lng}
                            onChange={e => setNuevaDireccion(prev => ({ ...prev, lng: e.target.value }))}
                            className="w-full bg-[#0c0f12] border border-gray-800 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-green-500"
                          />
                        </div>
                        {nuevaDireccion.lat && nuevaDireccion.lng && (
                          <div className="col-span-2 pt-1">
                            <a
                              href={"https://www.google.com/maps/search/?api=1&query=" + nuevaDireccion.lat + "," + nuevaDireccion.lng}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 font-bold underline text-[10px] flex items-center gap-1">
                              🗺️ Previsualizar Ubicación Manual en Google Maps
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-850 bg-[#0c0f12]/50 flex gap-3">
                <button
                  onClick={() => setModalPedido(null)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white font-bold text-xs py-2 rounded-xl transition cursor-pointer">
                  Cerrar
                </button>
                <button
                  onClick={() => liberarPedido(modalPedido)}
                  disabled={
                    procesando ||
                    (modalPedido.metodo_pago === 'transferencia' && !modalPedido.pago_confirmado) ||
                    (direccionSeleccionada === '' && (!nuevaDireccion.lat || !nuevaDireccion.lng))
                  }
                  className="flex-1 bg-green-600 hover:bg-green-550 text-white font-extrabold text-xs py-2 rounded-xl transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1">
                  {procesando && <Loader2 size={13} className="animate-spin" />}
                  Liberar al Pool (Aprobar)
                </button>
              </div>
            </div>
          </div>
        )}
        
      </main>
    </div>
  )
}
