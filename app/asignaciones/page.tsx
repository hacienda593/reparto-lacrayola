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
  const [pickingData, setPickingData] = useState<any[]>([])
  
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

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
        .select('*, rep_repartidores(nombre)')
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
                  return (
                    <div key={p.id} className="bg-[#0c0f12] border border-[#2d3748] rounded-2xl p-4 space-y-3">
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
                      
                      <div className="pt-2 border-t border-gray-850 flex gap-2">
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
                          className="bg-green-600 hover:bg-green-500 text-white font-extrabold text-[10px] px-3 py-1 rounded-xl transition cursor-pointer">
                          ⚡ Asignar
                        </button>
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
                          👤 Shopper: {a.rep_repartidores?.nombre}
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
                          👤 Shopper/Rider: {a.rep_repartidores?.nombre}
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
                              👤 {asig.rep_repartidores?.nombre} ({asig.estado})
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
        
      </main>
    </div>
  )
}
