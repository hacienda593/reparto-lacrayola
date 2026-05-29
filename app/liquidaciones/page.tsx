'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { RepRepartidor } from '@/lib/types'
import Sidebar from '@/components/Sidebar'
import { Wallet, Check, Loader2, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

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
}

export default function LiquidacionesPage() {
  const [fecha,       setFecha]       = useState(new Date().toISOString().split('T')[0])
  const [liquidaciones, setLiquidaciones] = useState<LiquidacionVista[]>([])
  const [cargando,    setCargando]    = useState(true)
  const [procesando,  setProcesando]  = useState<string | null>(null)
  const [expandido,   setExpandido]   = useState<string | null>(null)

  async function cargar() {
    setCargando(true)

    // Repartidores activos
    const { data: reps } = await supabase.from('rep_repartidores').select('id,nombre,comision_tipo,comision_valor').eq('activo', true)
    if (!reps) { setCargando(false); return }

    // Liquidaciones existentes para esa fecha
    const { data: liqs } = await supabase.from('rep_liquidaciones').select('*').eq('fecha', fecha)
    const liqMap = new Map((liqs ?? []).map(l => [l.repartidor_id, l]))

    // Entregas del día por repartidor
    const { data: entregas } = await supabase
      .from('rep_entregas')
      .select('repartidor_id,monto_cobrado,exitosa,entregado_at')
      .gte('entregado_at', fecha)
      .lt('entregado_at',  fecha + 'T23:59:59')

    // Asignaciones del día
    const { data: asigs } = await supabase
      .from('rep_asignaciones')
      .select('repartidor_id,estado')
      .gte('asignado_at', fecha)
      .lt('asignado_at',  fecha + 'T23:59:59')

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
      }
    })

    setLiquidaciones(resultado)
    setCargando(false)
  }

  useEffect(() => { cargar() }, [fecha])

  async function liquidar(liq: LiquidacionVista) {
    setProcesando(liq.repartidor_id)
    const payload = {
      repartidor_id:    liq.repartidor_id,
      fecha:            liq.fecha,
      total_asignados:  liq.total_asignados,
      total_entregados: liq.total_entregados,
      total_devueltos:  liq.total_devueltos,
      total_cobrado:    liq.total_cobrado,
      total_comision:   liq.total_comision,
      total_a_entregar: liq.total_a_entregar,
      estado:           'liquidado',
      liquidado_at:     new Date().toISOString(),
      updated_at:       new Date().toISOString(),
    }
    if (liq.id) {
      await supabase.from('rep_liquidaciones').update(payload).eq('id', liq.id)
    } else {
      await supabase.from('rep_liquidaciones').insert(payload)
    }
    await cargar()
    setProcesando(null)
  }

  const totalGeneral = liquidaciones.reduce((s, l) => ({
    cobrado:    s.cobrado    + l.total_cobrado,
    comisiones: s.comisiones + l.total_comision,
    entregar:   s.entregar   + l.total_a_entregar,
    entregas:   s.entregas   + l.total_entregados,
  }), { cobrado: 0, comisiones: 0, entregar: 0, entregas: 0 })

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 md:ml-56 pt-14 md:pt-0 p-4 md:p-6 space-y-5">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Liquidaciones</h1>
            <p className="text-sm text-slate-400">Cierre diario por repartidor</p>
          </div>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500 bg-white" />
        </div>

        {/* Resumen del día */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total cobrado',    value: fmt(totalGeneral.cobrado),    color: 'text-green-700',  bg: 'bg-green-50' },
            { label: 'Comisiones',       value: fmt(totalGeneral.comisiones), color: 'text-blue-700',   bg: 'bg-blue-50' },
            { label: 'A entregar',       value: fmt(totalGeneral.entregar),   color: 'text-orange-700', bg: 'bg-orange-50' },
            { label: 'Total entregas',   value: totalGeneral.entregas,        color: 'text-purple-700', bg: 'bg-purple-50' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`${bg} rounded-2xl p-4 border border-white`}>
              <div className={`text-xl font-extrabold ${color}`}>{value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Lista por repartidor */}
        {cargando ? (
          <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-green-500" /></div>
        ) : (
          <div className="space-y-3">
            {liquidaciones.map(liq => {
              const liquidado  = liq.estado === 'liquidado'
              const sinActividad = liq.total_asignados === 0
              return (
                <div key={liq.repartidor_id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${sinActividad ? 'opacity-60' : 'border-slate-100'}`}>
                  <div className="flex items-center justify-between px-4 py-3.5 cursor-pointer"
                    onClick={() => setExpandido(expandido === liq.repartidor_id ? null : liq.repartidor_id)}>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-green-100 rounded-xl flex items-center justify-center text-lg">🛵</div>
                      <div>
                        <div className="font-bold text-slate-800 text-sm">{liq.nombre}</div>
                        <div className="text-xs text-slate-400">
                          {liq.total_entregados} entregados · {liq.total_devueltos} devueltos
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-bold text-orange-700">{fmt(liq.total_a_entregar)}</div>
                        <div className="text-[10px] text-slate-400">a entregar al negocio</div>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${liquidado ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {liquidado ? '✓ Liquidado' : 'Pendiente'}
                      </span>
                      {expandido === liq.repartidor_id ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                    </div>
                  </div>

                  {expandido === liq.repartidor_id && (
                    <div className="border-t border-slate-100 px-4 py-4 space-y-4">
                      {/* Desglose */}
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="bg-slate-50 rounded-xl p-3">
                          <div className="text-lg font-extrabold text-slate-800">{liq.total_asignados}</div>
                          <div className="text-[10px] text-slate-400">Asignados</div>
                        </div>
                        <div className="bg-green-50 rounded-xl p-3">
                          <div className="text-lg font-extrabold text-green-700">{liq.total_entregados}</div>
                          <div className="text-[10px] text-slate-400">Entregados</div>
                        </div>
                        <div className="bg-red-50 rounded-xl p-3">
                          <div className="text-lg font-extrabold text-red-600">{liq.total_devueltos}</div>
                          <div className="text-[10px] text-slate-400">Devueltos</div>
                        </div>
                      </div>

                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between text-slate-600">
                          <span>Total cobrado al cliente</span>
                          <span className="font-semibold text-slate-800">{fmt(liq.total_cobrado)}</span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>Comisión del repartidor</span>
                          <span className="font-semibold text-blue-700">− {fmt(liq.total_comision)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-base border-t border-slate-100 pt-2">
                          <span className="text-slate-800">Debe entregar al negocio</span>
                          <span className="text-orange-700">{fmt(liq.total_a_entregar)}</span>
                        </div>
                      </div>

                      {!liquidado && liq.total_entregados > 0 && (
                        <button onClick={() => liquidar(liq)} disabled={procesando === liq.repartidor_id}
                          className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition text-sm">
                          {procesando === liq.repartidor_id
                            ? <Loader2 size={15} className="animate-spin" />
                            : <Check size={15} />
                          }
                          Marcar como liquidado
                        </button>
                      )}

                      {sinActividad && (
                        <div className="flex items-center gap-2 text-xs text-slate-400">
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
      </main>
    </div>
  )
}
