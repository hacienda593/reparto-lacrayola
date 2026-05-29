'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { OlPedido, RepRepartidor, RepAsignacion } from '@/lib/types'
import Sidebar from '@/components/Sidebar'
import {
  Package, Search, X, ChevronRight, Truck,
  AlertCircle, CheckCircle, Clock, Loader2,
} from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

const ESTADOS_PEDIDO = ['pendiente','confirmado','preparando','enviado','entregado','cancelado']
const ESTADOS_ASIG   = ['asignado','en_ruta','entregado','devuelto','cancelado']

const EST_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pendiente:  { label: 'Pendiente',  color: 'text-yellow-700', bg: 'bg-yellow-100' },
  confirmado: { label: 'Confirmado', color: 'text-blue-700',   bg: 'bg-blue-100' },
  preparando: { label: 'Preparando', color: 'text-purple-700', bg: 'bg-purple-100' },
  asignado:   { label: 'Asignado',   color: 'text-indigo-700', bg: 'bg-indigo-100' },
  en_ruta:    { label: 'En ruta',    color: 'text-orange-700', bg: 'bg-orange-100' },
  enviado:    { label: 'Enviado',    color: 'text-orange-700', bg: 'bg-orange-100' },
  entregado:  { label: 'Entregado',  color: 'text-green-700',  bg: 'bg-green-100' },
  devuelto:   { label: 'Devuelto',   color: 'text-red-700',    bg: 'bg-red-100' },
  cancelado:  { label: 'Cancelado',  color: 'text-red-700',    bg: 'bg-red-100' },
}

function PedidosContent() {
  const params = useSearchParams()
  const router = useRouter()

  const [pedidos,      setPedidos]      = useState<OlPedido[]>([])
  const [asigMap,      setAsigMap]      = useState<Map<string, RepAsignacion>>(new Map())
  const [repartidores, setRepartidores] = useState<RepRepartidor[]>([])
  const [cargando,     setCargando]     = useState(true)
  const [q,            setQ]            = useState('')
  const [filtroEstado, setFiltroEstado] = useState(params.get('filtro') === 'sin_asignar' ? 'sin_asignar' : '')
  const [asignando,    setAsignando]    = useState<string | null>(null) // pedido_id en proceso

  async function cargar() {
    const [{ data: ps }, { data: as }, { data: rs }] = await Promise.all([
      supabase.from('ol_pedidos').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('rep_asignaciones').select('*, rep_repartidores(nombre,telefono)'),
      supabase.from('rep_repartidores').select('*').eq('activo', true).order('nombre'),
    ])
    setPedidos((ps ?? []) as OlPedido[])
    setAsigMap(new Map((as ?? []).map(a => [a.pedido_id, a as RepAsignacion])))
    setRepartidores((rs ?? []) as RepRepartidor[])
    setCargando(false)
  }

  useEffect(() => { cargar() }, [])

  async function asignar(pedidoId: string, repartidorId: string) {
    setAsignando(pedidoId)
    const existente = asigMap.get(pedidoId)
    if (existente) {
      await supabase.from('rep_asignaciones').update({ repartidor_id: repartidorId, estado: 'asignado', updated_at: new Date().toISOString() }).eq('id', existente.id)
    } else {
      await supabase.from('rep_asignaciones').insert({ pedido_id: pedidoId, repartidor_id: repartidorId })
    }
    await supabase.from('ol_pedidos').update({ estado: 'confirmado' }).eq('id', pedidoId)
    await cargar()
    setAsignando(null)
  }

  async function cambiarEstado(pedidoId: string, nuevoEstado: string) {
    await supabase.from('ol_pedidos').update({ estado: nuevoEstado }).eq('id', pedidoId)
    const asig = asigMap.get(pedidoId)
    if (asig && ESTADOS_ASIG.includes(nuevoEstado)) {
      await supabase.from('rep_asignaciones').update({ estado: nuevoEstado, updated_at: new Date().toISOString() }).eq('id', asig.id)
    }
    await cargar()
  }

  const filtrados = pedidos.filter(p => {
    if (q && !p.nombre_cliente.toLowerCase().includes(q.toLowerCase()) &&
        !String(p.numero).includes(q) && !p.telefono.includes(q)) return false
    if (filtroEstado === 'sin_asignar') return !asigMap.has(p.id) && ['pendiente','confirmado','preparando'].includes(p.estado)
    if (filtroEstado && p.estado !== filtroEstado) return false
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Pedidos</h1>
          <p className="text-sm text-slate-400">{filtrados.length} pedidos</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Buscar cliente, número, teléfono..."
            className="bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-green-500 w-64" />
        </div>
        {['', 'sin_asignar', 'pendiente', 'confirmado', 'preparando', 'en_ruta', 'entregado'].map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            className={`text-xs font-semibold px-3 py-2 rounded-xl border transition ${
              filtroEstado === e ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}>
            {e === '' ? 'Todos' : e === 'sin_asignar' ? '⚠️ Sin asignar' : EST_CFG[e]?.label ?? e}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {cargando ? (
          <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-green-500" /></div>
        ) : filtrados.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Package size={40} className="mx-auto mb-2 text-slate-200" />
            <p>Sin pedidos con ese filtro</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {filtrados.map(p => {
              const asig  = asigMap.get(p.id) as any
              const est   = EST_CFG[p.estado] ?? { label: p.estado, color: 'text-slate-600', bg: 'bg-slate-100' }
              const sinA  = !asig && ['pendiente','confirmado','preparando'].includes(p.estado)
              return (
                <div key={p.id} className="px-4 py-3.5 hover:bg-slate-50 transition">
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Número + cliente */}
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => router.push(`/pedidos/${p.id}`)}>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 text-sm">#{String(p.numero).padStart(4,'0')}</span>
                        {sinA && <AlertCircle size={13} className="text-red-500" />}
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${est.bg} ${est.color}`}>{est.label}</span>
                      </div>
                      <div className="text-sm text-slate-600 truncate">{p.nombre_cliente} · {p.telefono}</div>
                      {p.direccion && <div className="text-xs text-slate-400 truncate">📍 {p.direccion}, {p.ciudad}</div>}
                    </div>

                    {/* Total */}
                    <div className="text-right shrink-0">
                      <div className="font-bold text-slate-800">{fmt(p.total)}</div>
                      <div className="text-[10px] text-slate-400">{new Date(p.created_at).toLocaleDateString('es')}</div>
                    </div>

                    {/* Asignar repartidor */}
                    <div className="shrink-0 min-w-[160px]">
                      {asignando === p.id
                        ? <Loader2 size={16} className="animate-spin text-green-500 mx-auto" />
                        : (
                          <select
                            value={asig?.repartidor_id ?? ''}
                            onChange={e => e.target.value && asignar(p.id, e.target.value)}
                            className={`w-full text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:border-green-500 transition ${
                              sinA ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
                            }`}>
                            <option value="">{sinA ? '⚠️ Sin repartidor' : asig?.rep_repartidores?.nombre ?? '— Reasignar —'}</option>
                            {repartidores.map(r => (
                              <option key={r.id} value={r.id}>{r.nombre}</option>
                            ))}
                          </select>
                        )
                      }
                    </div>

                    {/* Cambiar estado */}
                    <div className="shrink-0 min-w-[120px]">
                      <select
                        value={p.estado}
                        onChange={e => cambiarEstado(p.id, e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-green-500">
                        {ESTADOS_PEDIDO.map(e => (
                          <option key={e} value={e}>{EST_CFG[e]?.label ?? e}</option>
                        ))}
                      </select>
                    </div>

                    <button onClick={() => router.push(`/pedidos/${p.id}`)}
                      className="text-slate-400 hover:text-slate-600 transition shrink-0">
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function PedidosPage() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 md:ml-56 pt-14 md:pt-0 p-4 md:p-6">
        <Suspense fallback={<div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-green-500" /></div>}>
          <PedidosContent />
        </Suspense>
      </main>
    </div>
  )
}
