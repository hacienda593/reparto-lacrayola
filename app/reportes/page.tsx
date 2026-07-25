'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import { Loader2, Package, DollarSign, Wallet, XCircle, ArrowRightLeft, TrendingUp } from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

function haceNDias(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

export default function ReportesPage() {
  const [desde, setDesde] = useState(haceNDias(7))
  const [hasta, setHasta] = useState(new Date().toISOString().split('T')[0])
  const [cargando, setCargando] = useState(true)

  const [pedidosEntregados, setPedidosEntregados] = useState(0)
  const [totalFacturado, setTotalFacturado] = useState(0)
  const [pedidosCancelados, setPedidosCancelados] = useState(0)
  const [comisionesTotales, setComisionesTotales] = useState(0)
  const [traspasos, setTraspasos] = useState<{ count: number; monto: number }>({ count: 0, monto: 0 })
  const [efectivoPendiente, setEfectivoPendiente] = useState(0)
  const [porEstado, setPorEstado] = useState<Record<string, number>>({})

  useEffect(() => { cargar() }, [desde, hasta])

  async function cargar() {
    setCargando(true)
    const hastaFin = hasta + 'T23:59:59'

    const [{ data: pedidos }, { data: entregas }, { data: reps }, { data: traspasosData }] = await Promise.all([
      supabase.from('ol_pedidos').select('id, estado, total, created_at').gte('created_at', desde).lt('created_at', hastaFin),
      supabase.from('rep_entregas').select('monto_cobrado, exitosa, entregado_at').gte('entregado_at', desde).lt('entregado_at', hastaFin),
      supabase.from('rep_repartidores').select('efectivo_en_mano').eq('activo', true),
      supabase.from('rep_traspasos_efectivo').select('monto, created_at').gte('created_at', desde).lt('created_at', hastaFin),
    ])

    const entregadosArr = (pedidos ?? []).filter(p => p.estado === 'entregado')
    const canceladosArr = (pedidos ?? []).filter(p => p.estado === 'cancelado')

    setPedidosEntregados(entregadosArr.length)
    setTotalFacturado(entregadosArr.reduce((s, p) => s + (p.total ?? 0), 0))
    setPedidosCancelados(canceladosArr.length)

    const estados: Record<string, number> = {}
    ;(pedidos ?? []).forEach(p => { estados[p.estado] = (estados[p.estado] ?? 0) + 1 })
    setPorEstado(estados)

    // Comisiones: aproximación simple ($1 por entrega exitosa, ajustable manualmente en Repartidores)
    const entregasExitosas = (entregas ?? []).filter(e => e.exitosa)
    setComisionesTotales(entregasExitosas.length * 1)

    setEfectivoPendiente((reps ?? []).reduce((s, r) => s + (r.efectivo_en_mano ?? 0), 0))

    setTraspasos({
      count: (traspasosData ?? []).length,
      monto: (traspasosData ?? []).reduce((s, t) => s + (t.monto ?? 0), 0),
    })

    setCargando(false)
  }

  const kpis = [
    { label: 'Pedidos entregados', value: pedidosEntregados, icon: Package, color: 'text-[#00b074]', bg: 'bg-[#00b074]/5 border-[#00b074]/20' },
    { label: 'Total facturado', value: fmt(totalFacturado), icon: TrendingUp, color: 'text-blue-400', bg: 'bg-blue-500/5 border-blue-500/20' },
    { label: 'Comisiones (aprox.)', value: fmt(comisionesTotales), icon: DollarSign, color: 'text-purple-400', bg: 'bg-purple-500/5 border-purple-500/20' },
    { label: 'Pedidos cancelados', value: pedidosCancelados, icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/5 border-red-500/20' },
    { label: 'Efectivo pendiente de liquidar', value: fmt(efectivoPendiente), icon: Wallet, color: 'text-yellow-400', bg: 'bg-yellow-500/5 border-yellow-500/20' },
    { label: 'Traspasos entre colaboradores', value: `${traspasos.count} · ${fmt(traspasos.monto)}`, icon: ArrowRightLeft, color: 'text-orange-400', bg: 'bg-orange-500/5 border-orange-500/20' },
  ]

  return (
    <div className="flex min-h-screen bg-[#0c0f12] text-white">
      <Sidebar />
      <main className="flex-1 md:pl-56 pt-14 md:pt-0 p-4 md:p-6 space-y-5">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white">Reportes</h1>
            <p className="text-sm text-gray-500">Resumen operativo de La Crayola Reparto</p>
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
              className="border border-[#2d3748] rounded-xl px-3 py-2 text-sm bg-[#181d24] text-white focus:outline-none focus:border-green-500" />
            <span className="text-gray-500 text-xs">a</span>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
              className="border border-[#2d3748] rounded-xl px-3 py-2 text-sm bg-[#181d24] text-white focus:outline-none focus:border-green-500" />
          </div>
        </div>

        {cargando ? (
          <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-green-500" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {kpis.map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className={`${bg} rounded-2xl p-4 border`}>
                  <Icon size={16} className={`${color} mb-2`} />
                  <div className={`text-xl font-extrabold ${color}`}>{value}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-2">
              <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Pedidos por estado en el rango</p>
              {Object.keys(porEstado).length === 0 ? (
                <p className="text-gray-600 text-xs">Sin pedidos en este rango de fechas.</p>
              ) : (
                Object.entries(porEstado).map(([estado, count]) => (
                  <div key={estado} className="flex justify-between text-sm border-b border-[#2d3748]/50 py-1.5 last:border-0">
                    <span className="text-gray-400 capitalize">{estado}</span>
                    <span className="text-white font-semibold">{count}</span>
                  </div>
                ))
              )}
            </div>

            <p className="text-[10px] text-gray-600 leading-relaxed">
              Nota: las comisiones son un estimado de $1 por entrega exitosa. Para el cálculo exacto por repartidor (fijo o porcentaje), revisa Liquidaciones.
            </p>
          </>
        )}
      </main>
    </div>
  )
}
