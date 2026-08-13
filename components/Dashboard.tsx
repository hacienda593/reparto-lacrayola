'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  AlertTriangle, ArrowRight, Bike, CheckCircle2, Clock3, DollarSign,
  Loader2, MapPin, Package, RefreshCw, ShoppingBasket, TrendingUp, Users,
} from 'lucide-react'

const money = (value: number) => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(value || 0)
const startOfDay = (date = new Date()) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d }
const minutesSince = (value?: string | null) => value ? Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000)) : 0

type Pedido = { id: string; numero: number; nombre_cliente: string; total: number; estado: string; created_at: string; geo_lat?: number | null; geo_lng?: number | null; metodo_pago?: string | null; pago_confirmado?: boolean | null }
type Persona = { nombre?: string } | null
type Asignacion = { id: string; pedido_id: string; estado: string; asignado_at: string; updated_at?: string; shopper_id?: string | null; rider_id?: string | null; shopper?: Persona; rider?: Persona; repartidor?: Persona }
type Entrega = { pedido_id: string; repartidor_id: string; monto_cobrado: number; exitosa: boolean; entregado_at: string; salida_at?: string | null; tiempo_entrega?: number | null }
type Repartidor = { id: string; nombre: string; activo: boolean; efectivo_en_mano: number; estado?: string | null }

export default function Dashboard() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [entregas, setEntregas] = useState<Entrega[]>([])
  const [repartidores, setRepartidores] = useState<Repartidor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true); setError('')
    const desde = new Date(); desde.setDate(desde.getDate() - 30)
    const [p, a, e, r] = await Promise.all([
      supabase.from('ol_pedidos').select('id,numero,nombre_cliente,total,estado,created_at,geo_lat,geo_lng,metodo_pago,pago_confirmado').gte('created_at', desde.toISOString()).order('created_at', { ascending: false }),
      supabase.from('rep_asignaciones').select('id,pedido_id,estado,asignado_at,updated_at,shopper_id,rider_id,shopper:rep_repartidores!rep_asignaciones_shopper_id_fkey(nombre),rider:rep_repartidores!rep_asignaciones_rider_id_fkey(nombre),repartidor:rep_repartidores!rep_asignaciones_repartidor_id_fkey(nombre)').gte('asignado_at', desde.toISOString()),
      supabase.from('rep_entregas').select('pedido_id,repartidor_id,monto_cobrado,exitosa,entregado_at,salida_at,tiempo_entrega').gte('entregado_at', desde.toISOString()),
      supabase.from('rep_repartidores').select('id,nombre,activo,estado,efectivo_en_mano').eq('activo', true).order('nombre'),
    ])
    const firstError = p.error || a.error || e.error || r.error
    if (firstError) setError(firstError.message)
    setPedidos((p.data ?? []) as Pedido[])
    setAsignaciones((a.data ?? []) as unknown as Asignacion[])
    setEntregas((e.data ?? []) as Entrega[])
    setRepartidores((r.data ?? []) as Repartidor[])
    setUpdatedAt(new Date()); setLoading(false)
  }, [])

  useEffect(() => { const timer = window.setTimeout(() => void cargar(), 0); return () => window.clearTimeout(timer) }, [cargar])

  const data = useMemo(() => {
    const today = startOfDay().getTime()
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    const asigByPedido = new Map(asignaciones.map(a => [a.pedido_id, a]))
    const entregasHoy = entregas.filter(e => new Date(e.entregado_at).getTime() >= today && e.exitosa)
    const entregasAyer = entregas.filter(e => { const t = new Date(e.entregado_at).getTime(); return t >= yesterday.getTime() && t < today && e.exitosa })
    const pedidosHoy = pedidos.filter(p => new Date(p.created_at).getTime() >= today)
    const sinAsignar = pedidos.filter(p => ['pendiente','confirmado','preparando'].includes(p.estado) && !asigByPedido.has(p.id))
    const transferencias = pedidos.filter(p => p.metodo_pago === 'transferencia' && !p.pago_confirmado && !['cancelado','entregado'].includes(p.estado))
    const sinUbicacion = pedidos.filter(p => !p.geo_lat && !p.geo_lng && ['confirmado','preparando','asignado'].includes(p.estado))
    const enRuta = asignaciones.filter(a => ['en_ruta','recolectado'].includes(a.estado))
    const demorados = enRuta.filter(a => minutesSince(a.updated_at || a.asignado_at) > 60)
    const efectivo = repartidores.reduce((s, r) => s + Number(r.efectivo_en_mano || 0), 0)
    const avgMin = entregasHoy.length ? Math.round(entregasHoy.reduce((s, e) => s + Number(e.tiempo_entrega || (e.salida_at ? (new Date(e.entregado_at).getTime() - new Date(e.salida_at).getTime()) / 60000 : 0)), 0) / entregasHoy.length) : 0
    const ranking = repartidores.map(rep => {
      const mine = entregas.filter(e => e.repartidor_id === rep.id && e.exitosa)
      return { ...rep, entregas: mine.length, cobrado: mine.reduce((s,e) => s + Number(e.monto_cobrado || 0), 0) }
    }).sort((x,y) => y.entregas - x.entregas).slice(0, 5)
    return { asigByPedido, pedidosHoy, entregasHoy, entregasAyer, sinAsignar, transferencias, sinUbicacion, enRuta, demorados, efectivo, avgMin, ranking }
  }, [pedidos, asignaciones, entregas, repartidores])

  const actions = [
    { label: 'Transferencias por verificar', value: data.transferencias.length, detail: 'Validar comprobante antes de comprar', href: '/asignaciones', icon: DollarSign },
    { label: 'Pedidos sin asignar', value: data.sinAsignar.length, detail: 'Requieren comprador o repartidor', href: '/asignaciones', icon: Users },
    { label: 'En ruta demorados', value: data.demorados.length, detail: 'Más de 60 minutos sin cierre', href: '/asignaciones', icon: Clock3 },
    { label: 'Sin ubicación GPS', value: data.sinUbicacion.length, detail: 'Confirmar dirección con el cliente', href: '/asignaciones', icon: MapPin },
  ]
  const summaryCards = [
    { label: 'Pedidos hoy', value: data.pedidosHoy.length, icon: Package, tone: 'text-blue-600 bg-blue-50' },
    { label: 'Entregados hoy', value: data.entregasHoy.length, icon: CheckCircle2, tone: 'text-green-600 bg-green-50' },
    { label: 'En ruta', value: data.enRuta.length, icon: Bike, tone: 'text-orange-600 bg-orange-50' },
    { label: 'Cobrado hoy', value: money(data.entregasHoy.reduce((s,e)=>s+Number(e.monto_cobrado||0),0)), icon: TrendingUp, tone: 'text-emerald-600 bg-emerald-50' },
    { label: 'Tiempo promedio', value: data.avgMin ? `${data.avgMin} min` : '—', icon: Clock3, tone: 'text-violet-600 bg-violet-50' },
    { label: 'Efectivo en calle', value: money(data.efectivo), icon: DollarSign, tone: 'text-amber-600 bg-amber-50' },
    { label: 'Personal activo', value: repartidores.length, icon: Users, tone: 'text-cyan-600 bg-cyan-50' },
    { label: 'Vs. ayer', value: `${data.entregasHoy.length - data.entregasAyer.length >= 0 ? '+' : ''}${data.entregasHoy.length - data.entregasAyer.length}`, icon: ShoppingBasket, tone: 'text-indigo-600 bg-indigo-50' },
  ]

  return <div className="space-y-6 text-slate-900">
    <header className="flex items-start justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-[.2em] text-green-600">Centro de operaciones</p><h1 className="text-2xl md:text-3xl font-black">Control del día</h1><p className="text-sm text-slate-500">Prioridades, desempeño y caja en una sola vista.</p></div>
      <button onClick={cargar} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>{updatedAt ? updatedAt.toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'}) : 'Actualizar'}</button>
    </header>

    {error && <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle size={18}/><span>No se pudo cargar todo el tablero: {error}</span></div>}

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {summaryCards.map(({label,value,icon:Icon,tone}) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon size={17}/></div><div className="text-xl font-black">{loading ? <Loader2 size={18} className="animate-spin"/> : value}</div><div className="text-xs text-slate-500">{label}</div></div>)}
    </section>

    <section><div className="mb-3 flex items-center justify-between"><div><h2 className="font-black">Requiere atención</h2><p className="text-xs text-slate-500">Acciones que pueden detener la operación.</p></div><Link href="/asignaciones" className="text-xs font-bold text-green-700">Abrir operación →</Link></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{actions.map(({label,value,detail,href,icon:Icon}) => <Link href={href} key={label} className={`group rounded-2xl border bg-white p-4 shadow-sm hover:-translate-y-0.5 hover:shadow-md ${value ? 'border-red-200' : 'border-slate-200'}`}><div className="flex items-center justify-between"><Icon size={18} className={value ? 'text-red-500' : 'text-slate-400'}/><span className={`text-2xl font-black ${value ? 'text-slate-900' : 'text-slate-300'}`}>{value}</span></div><p className="mt-3 text-sm font-bold">{label}</p><p className="text-xs text-slate-500">{detail}</p><ArrowRight size={15} className="mt-3 text-slate-300 group-hover:text-green-600"/></Link>)}</div></section>

    <section className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-black">Operación en curso</h2><p className="text-xs text-slate-500">Pedidos activos y responsables.</p></div><Link href="/asignaciones" className="text-xs font-bold text-green-700">Gestionar</Link></div><div className="divide-y divide-slate-100">{pedidos.filter(p=>!['entregado','cancelado'].includes(p.estado)).slice(0,8).map(p=>{const a=data.asigByPedido.get(p.id); return <Link href="/asignaciones" key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100"><Package size={15}/></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">#{String(p.numero).padStart(4,'0')} · {p.nombre_cliente}</p><p className="truncate text-xs text-slate-500">{a?.shopper?.nombre || a?.repartidor?.nombre || 'Sin comprador'}{a?.rider?.nombre ? ` → ${a.rider.nombre}` : ''}</p></div><div className="text-right"><p className="text-sm font-black">{money(p.total)}</p><p className="text-[10px] font-bold uppercase text-slate-400">{a?.estado || p.estado}</p></div></Link>})}{!loading && pedidos.length===0 && <p className="p-8 text-center text-sm text-slate-400">No hay actividad reciente.</p>}</div></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4"><h2 className="font-black">Rendimiento · 30 días</h2><p className="text-xs text-slate-500">Entregas exitosas por repartidor.</p></div><div className="space-y-4">{data.ranking.map((r,i)=><div key={r.id} className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-xs font-black">{i+1}</span><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><span className="truncate text-sm font-bold">{r.nombre}</span><span className="text-sm font-black">{r.entregas}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-500" style={{width:`${Math.max(5,(r.entregas/(data.ranking[0]?.entregas||1))*100)}%`}}/></div><p className="mt-1 text-[10px] text-slate-400">{money(r.cobrado)} cobrado</p></div></div>)}</div><Link href="/reportes" className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white">Ver analítica completa <ArrowRight size={14}/></Link></div>
    </section>
  </div>
}
