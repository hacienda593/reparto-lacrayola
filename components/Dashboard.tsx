'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Package, Truck, CheckCircle, AlertCircle, Clock, DollarSign, Users, TrendingUp } from 'lucide-react'
import Link from 'next/link'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

interface Stats {
  pedidosPendientes:  number
  pedidosAsignados:   number
  pedidosEnRuta:      number
  pedidosEntregados:  number
  pedidosHoy:         number
  totalCobradoHoy:    number
  repartidoresActivos: number
  sinAsignar:         number
}

interface PedidoReciente {
  id:             string
  numero:         number
  nombre_cliente: string
  total:          number
  estado:         string
  created_at:     string
  repartidor?:    string
}

const ESTADO_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pendiente:  { label: 'Pendiente',  color: 'text-yellow-700', bg: 'bg-yellow-100' },
  confirmado: { label: 'Confirmado', color: 'text-blue-700',   bg: 'bg-blue-100' },
  preparando: { label: 'Preparando', color: 'text-purple-700', bg: 'bg-purple-100' },
  asignado:   { label: 'Asignado',   color: 'text-indigo-700', bg: 'bg-indigo-100' },
  en_ruta:    { label: 'En ruta',    color: 'text-orange-700', bg: 'bg-orange-100' },
  enviado:    { label: 'Enviado',    color: 'text-orange-700', bg: 'bg-orange-100' },
  entregado:  { label: 'Entregado',  color: 'text-green-700',  bg: 'bg-green-100' },
  cancelado:  { label: 'Cancelado',  color: 'text-red-700',    bg: 'bg-red-100' },
}

export default function Dashboard() {
  const [stats,   setStats]   = useState<Stats | null>(null)
  const [recientes, setRecientes] = useState<PedidoReciente[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    async function cargar() {
      const hoy = new Date().toISOString().split('T')[0]

      const [
        { data: pedidos },
        { data: asignaciones },
        { data: entregas },
        { data: repartidores },
      ] = await Promise.all([
        supabase.from('ol_pedidos').select('id,numero,nombre_cliente,total,estado,created_at').order('created_at', { ascending: false }).limit(50),
        supabase.from('rep_asignaciones').select('id,pedido_id,estado,repartidor_id,rep_repartidores!repartidor_id(nombre)'),
        supabase.from('rep_entregas').select('monto_cobrado,entregado_at').gte('entregado_at', hoy),
        supabase.from('rep_repartidores').select('id').eq('activo', true),
      ])

      const asigMap = new Map((asignaciones ?? []).map(a => [a.pedido_id, a]))

      const pedidosHoy = (pedidos ?? []).filter(p => p.created_at.startsWith(hoy))
      const sinAsignar = (pedidos ?? []).filter(p =>
        ['pendiente','confirmado','preparando'].includes(p.estado) && !asigMap.has(p.id)
      ).length

      setStats({
        pedidosPendientes:  (pedidos ?? []).filter(p => p.estado === 'pendiente').length,
        pedidosAsignados:   (asignaciones ?? []).filter(a => a.estado === 'asignado').length,
        pedidosEnRuta:      (asignaciones ?? []).filter(a => a.estado === 'en_ruta').length,
        pedidosEntregados:  (asignaciones ?? []).filter(a => a.estado === 'entregado').length,
        pedidosHoy:         pedidosHoy.length,
        totalCobradoHoy:    (entregas ?? []).reduce((s, e) => s + (e.monto_cobrado ?? 0), 0),
        repartidoresActivos: (repartidores ?? []).length,
        sinAsignar,
      })

      setRecientes((pedidos ?? []).slice(0, 8).map(p => ({
        ...p,
        repartidor: (asigMap.get(p.id) as any)?.rep_repartidores?.nombre,
      })))

      setCargando(false)
    }
    cargar()
  }, [])

  const hoy = new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-extrabold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-400 capitalize">{hoy}</p>
      </div>

      {/* Alerta sin asignar */}
      {stats && stats.sinAsignar > 0 && (
        <Link href="/pedidos?filtro=sin_asignar"
          className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 hover:bg-red-100 transition">
          <AlertCircle size={18} className="text-red-500 shrink-0" />
          <span className="text-sm font-semibold text-red-700">
            {stats.sinAsignar} pedido{stats.sinAsignar > 1 ? 's' : ''} sin asignar repartidor
          </span>
          <span className="ml-auto text-xs text-red-500 font-medium">Asignar →</span>
        </Link>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cargando
          ? [...Array(8)].map((_, i) => <div key={i} className="bg-white rounded-2xl h-24 animate-pulse" />)
          : [
              { label: 'Pedidos hoy',      value: stats?.pedidosHoy ?? 0,         icon: Package,    color: 'text-blue-600',   bg: 'bg-blue-50' },
              { label: 'En ruta',          value: stats?.pedidosEnRuta ?? 0,       icon: Truck,      color: 'text-orange-600', bg: 'bg-orange-50' },
              { label: 'Entregados hoy',   value: stats?.pedidosEntregados ?? 0,   icon: CheckCircle,color: 'text-green-600',  bg: 'bg-green-50' },
              { label: 'Pendientes',       value: stats?.pedidosPendientes ?? 0,   icon: Clock,      color: 'text-yellow-600', bg: 'bg-yellow-50' },
              { label: 'Cobrado hoy',      value: fmt(stats?.totalCobradoHoy ?? 0),icon: DollarSign, color: 'text-emerald-600',bg: 'bg-emerald-50', wide: true },
              { label: 'Sin asignar',      value: stats?.sinAsignar ?? 0,          icon: AlertCircle,color: 'text-red-600',    bg: 'bg-red-50' },
              { label: 'Asignados',        value: stats?.pedidosAsignados ?? 0,    icon: TrendingUp, color: 'text-indigo-600', bg: 'bg-indigo-50' },
              { label: 'Repartidores',     value: stats?.repartidoresActivos ?? 0, icon: Users,      color: 'text-purple-600', bg: 'bg-purple-50' },
            ].map(({ label, value, icon: Icon, color, bg }) => (
              <div key={label} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex items-center gap-3">
                <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center shrink-0`}>
                  <Icon size={18} className={color} />
                </div>
                <div>
                  <div className="text-xl font-extrabold text-slate-800">{value}</div>
                  <div className="text-xs text-slate-400">{label}</div>
                </div>
              </div>
            ))
        }
      </div>

      {/* Pedidos recientes */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-800">Pedidos recientes</h2>
          <Link href="/pedidos" className="text-xs text-green-600 font-medium hover:underline">Ver todos →</Link>
        </div>
        <div className="divide-y divide-slate-50">
          {cargando
            ? [...Array(5)].map((_, i) => <div key={i} className="h-14 animate-pulse bg-slate-50 m-3 rounded-xl" />)
            : recientes.map(p => {
                const est = ESTADO_CFG[p.estado] ?? { label: p.estado, color: 'text-slate-600', bg: 'bg-slate-100' }
                return (
                  <Link key={p.id} href={`/pedidos/${p.id}`}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition">
                    <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center shrink-0">
                      <Package size={15} className="text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">#{String(p.numero).padStart(4,'0')}</span>
                        <span className="text-sm text-slate-600 truncate">{p.nombre_cliente}</span>
                      </div>
                      <div className="text-xs text-slate-400">
                        {p.repartidor ? `🛵 ${p.repartidor}` : '⏳ Sin asignar'}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-slate-800">{fmt(p.total)}</div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${est.bg} ${est.color}`}>
                        {est.label}
                      </span>
                    </div>
                  </Link>
                )
              })
          }
        </div>
      </div>
    </div>
  )
}
