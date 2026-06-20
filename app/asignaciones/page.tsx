'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import Sidebar from '@/components/Sidebar'
import { 
  Truck, Package, Users, Plus, Trash2, Loader2, 
  MapPin, CheckCircle, RefreshCw, AlertCircle, Info, ArrowRight 
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
}

export default function AsignacionesPage() {
  const { user } = useAuth()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [repartidores, setRepartidores] = useState<Repartidor[]>([])
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  // Campos para nueva asignación
  const [pedidoSel, setPedidoSel] = useState<string>('')
  const [riderSel, setRiderSel] = useState<string>('')
  const [prioridad, setPrioridad] = useState<number>(1)
  const [notas, setNotas] = useState<string>('')

  async function cargarDatos() {
    setCargando(true)
    setError('')
    setMensaje('')
    try {
      // 1. Cargar ultimos 30 pedidos
      const { data: dataPed, error: errPed } = await supabase
        .from('ol_pedidos')
        .select('*')
        .order('numero', { ascending: false })
        .limit(30)
      
      if (errPed) throw errPed
      setPedidos(dataPed || [])

      // 2. Cargar repartidores activos
      const { data: dataRep, error: errRep } = await supabase
        .from('rep_repartidores')
        .select('id, nombre, estado, activo')
        .eq('activo', true)
        .order('nombre')
      
      if (errRep) throw errRep
      setRepartidores(dataRep || [])

      // 3. Cargar asignaciones vigentes
      const { data: dataAsig, error: errAsig } = await supabase
        .from('rep_asignaciones')
        .select('*, rep_repartidores(nombre)')
        .in('estado', ['asignado', 'en_ruta'])
      
      if (errAsig) throw errAsig
      setAsignaciones((dataAsig || []) as any)

    } catch (err: any) {
      setError(`Error al cargar datos: ${err.message}`)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  async function crearAsignacion(e: React.FormEvent) {
    e.preventDefault()
    if (!pedidoSel || !riderSel) {
      setError('Por favor selecciona un pedido y un repartidor')
      return
    }

    setProcesando(true)
    setError('')
    setMensaje('')

    try {
      // 1. Insertar en rep_asignaciones
      const { error: errInsert } = await supabase
        .from('rep_asignaciones')
        .insert({
          pedido_id: pedidoSel,
          repartidor_id: riderSel,
          prioridad: prioridad,
          notas: notas || 'Asignación creada desde el Panel Administrativo',
          estado: 'asignado'
        })
      
      if (errInsert) throw errInsert

      // 2. Actualizar estado del pedido a 'enviado' (en camino / preparado)
      const { error: errUpdate } = await supabase
        .from('ol_pedidos')
        .update({ estado: 'preparado' })
        .eq('id', pedidoSel)

      if (errUpdate) throw errUpdate

      setMensaje('✓ Pedido asignado con éxito al repartidor')
      
      // Limpiar campos
      setPedidoSel('')
      setNotas('')
      
      // Recargar datos
      await cargarDatos()
    } catch (err: any) {
      setError(`Error al crear asignación: ${err.message}`)
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
      // 1. Eliminar de rep_asignaciones (o marcar como cancelado)
      const { error: errDel } = await supabase
        .from('rep_asignaciones')
        .delete()
        .eq('id', asigId)
      
      if (errDel) throw errDel

      // 2. Regresar estado del pedido a 'preparado' o 'pendiente'
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

  return (
    <div className="flex min-h-screen bg-[#0c0f12] text-white">
      <Sidebar />
      
      <main className="flex-1 md:ml-56 pt-14 md:pt-0 p-4 md:p-6 space-y-6">
        
        {/* Cabecera de Página */}
        <div className="flex items-center justify-between flex-wrap gap-3 border-b border-gray-800 pb-4">
          <div>
            <h1 className="text-2xl font-black text-white flex items-center gap-2">
              <Truck size={24} className="text-green-500" /> PANEL DE ASIGNACIONES
            </h1>
            <p className="text-gray-400 text-xs mt-1">
              Despachador y Torre de Control - Asignar pedidos de la tienda a repartidores motorizados
            </p>
          </div>
          <button 
            onClick={cargarDatos}
            disabled={cargando}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-xs px-3.5 py-2 rounded-xl font-bold transition">
            <RefreshCw size={13} className={cargando ? 'animate-spin text-green-500' : ''} />
            Actualizar
          </button>
        </div>

        {/* Notificaciones */}
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Columna Izquierda: Formulario de Asignación */}
          <div className="space-y-4">
            <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2 border-b border-gray-800 pb-3">
                <Plus size={16} className="text-green-500" /> Nueva Asignación
              </h2>

              <form onSubmit={crearAsignacion} className="space-y-4">
                
                {/* Selector de Pedido */}
                <div className="space-y-1">
                  <label className="text-[11px] text-gray-400 block font-semibold">1. Seleccionar Pedido en Cola:</label>
                  <select
                    value={pedidoSel}
                    onChange={e => setPedidoSel(e.target.value)}
                    className="w-full bg-[#0c0f12] border border-[#2d3748] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-green-500">
                    <option value="">-- Seleccionar Pedido --</option>
                    {pedidos
                      .filter(p => !asignaciones.some(a => a.pedido_id === p.id) && p.estado !== 'entregado' && p.direccion !== 'RETIRO EN TIENDA')
                      .map(p => (
                        <option key={p.id} value={p.id}>
                          #{String(p.numero).padStart(4,'0')} - {p.nombre_cliente} ({fmt(p.total)})
                        </option>
                      ))
                    }
                  </select>
                  <p className="text-[10px] text-gray-500">Solo se muestran pedidos activos no asignados aún.</p>
                </div>

                {/* Selector de Repartidor */}
                <div className="space-y-1">
                  <label className="text-[11px] text-gray-400 block font-semibold">2. Seleccionar Repartidor Activo:</label>
                  <select
                    value={riderSel}
                    onChange={e => setRiderSel(e.target.value)}
                    className="w-full bg-[#0c0f12] border border-[#2d3748] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-green-500">
                    <option value="">-- Seleccionar Repartidor --</option>
                    {repartidores.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.nombre} ({r.estado === 'BLOQUEADO' ? '❌ BLOQUEADO' : '✅ ACTIVO'})
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-500">Un repartidor BLOQUEADO no podrá ver los pedidos asignados.</p>
                </div>

                {/* Prioridad de la ruta */}
                <div className="space-y-1">
                  <label className="text-[11px] text-gray-400 block font-semibold">3. Orden/Prioridad de Entrega:</label>
                  <input
                    type="number"
                    min="1"
                    value={prioridad}
                    onChange={e => setPrioridad(parseInt(e.target.value) || 1)}
                    className="w-full bg-[#0c0f12] border border-[#2d3748] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-green-500"
                  />
                  <p className="text-[10px] text-gray-500">El rider verá los pedidos en este orden secuencial.</p>
                </div>

                {/* Notas */}
                <div className="space-y-1">
                  <label className="text-[11px] text-gray-400 block font-semibold">Notas/Indicaciones (opcional):</label>
                  <input
                    type="text"
                    placeholder="Llevar cambio de $20, etc."
                    value={notas}
                    onChange={e => setNotas(e.target.value)}
                    className="w-full bg-[#0c0f12] border border-[#2d3748] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-green-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={procesando || cargando}
                  className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition text-xs flex items-center justify-center gap-1.5">
                  {procesando ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                  Asignar a Repartidor
                </button>
              </form>
            </div>

            <div className="bg-[#181d24] border border-[#2d3748] text-xs p-4 rounded-2xl flex items-start gap-2.5 text-gray-400">
              <Info size={16} className="text-green-500 shrink-0 mt-0.5" />
              <div className="space-y-1 leading-normal">
                <strong>¿Cómo funciona el flujo?</strong>
                <p>1. Al asignar, el pedido se asocia al rider y su estado en Supabase cambia a <code>preparado</code>.</p>
                <p>2. El rider verá instantáneamente este pedido en su celular en la ruta <code>/repartidor</code>.</p>
                <p>3. Si el rider supera el límite de efectivo ($40), su cuenta se bloqueará y no podrá gestionar entregas hasta que administres su caja.</p>
              </div>
            </div>
          </div>

          {/* Columna Derecha: Cola General de Pedidos y Estado de Asignación */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Asignaciones Activas en Ruta */}
            <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2 border-b border-gray-800 pb-3">
                <Truck size={16} className="text-green-500" /> Repartos en Ruta ({asignaciones.length})
              </h2>

              {cargando ? (
                <div className="flex justify-center py-10">
                  <Loader2 size={24} className="animate-spin text-green-500" />
                </div>
              ) : asignaciones.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-8">Ningún repartidor en ruta en este momento.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {asignaciones.map(a => {
                    const ped = pedidos.find(p => p.id === a.pedido_id)
                    return (
                      <div key={a.id} className="bg-[#0c0f12] border border-[#2d3748] rounded-xl p-3.5 space-y-2 flex flex-col justify-between">
                        <div className="space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-bold text-green-400">Pedido #{ped ? String(ped.numero).padStart(4,'0') : '????'}</span>
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                              a.estado === 'en_ruta' ? 'bg-orange-500/10 text-orange-400' : 'bg-indigo-500/10 text-indigo-400'
                            }`}>
                              {a.estado}
                            </span>
                          </div>
                          <div className="font-bold text-xs text-white truncate">{ped?.nombre_cliente || 'Cliente desconocido'}</div>
                          <div className="text-[10px] text-gray-400 flex items-center gap-1">
                            <Users size={10} className="text-green-500" /> Rider: {a.rep_repartidores?.nombre || '—'}
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2.5 border-t border-gray-850 mt-2">
                          <span className="text-xs font-black text-green-400">{fmt(ped?.total ?? 0)}</span>
                          <button
                            onClick={() => desasignarPedido(a.id, a.pedido_id)}
                            disabled={procesando}
                            className="text-red-400 hover:text-red-300 text-[10px] font-bold flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-red-500/10 transition">
                            <Trash2 size={11} /> Liberar
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Todos los Pedidos Recientes */}
            <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-5 space-y-4">
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
                        <th className="py-2.5 font-bold text-center">Asignación</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-850">
                      {pedidos.map(p => {
                        const asig = asignaciones.find(a => a.pedido_id === p.id)
                        return (
                          <tr key={p.id} className="hover:bg-gray-800/10">
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
                                <span className="bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full text-[9px] font-bold">
                                  {asig.rep_repartidores?.nombre}
                                </span>
                              ) : p.estado === 'entregado' ? (
                                <span className="bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full text-[9px] font-semibold">
                                  Entregado
                                </span>
                              ) : (
                                <button
                                  onClick={() => {
                                    setPedidoSel(p.id)
                                    window.scrollTo({ top: 0, behavior: 'smooth' })
                                  }}
                                  className="bg-green-600/10 hover:bg-green-600/20 text-green-400 border border-green-500/20 px-2.5 py-0.5 rounded-full text-[9px] font-bold transition">
                                  Asignar
                                </button>
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

          </div>

        </div>
        
      </main>
    </div>
  )
}
