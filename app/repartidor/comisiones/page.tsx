'use client'
import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Loader2, ArrowLeft, TrendingUp, AlertTriangle, X, Check } from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

// Pantalla dedicada a comisiones -- antes esto vivía escondido dentro de
// "Mi Caja" en Perfil, sin desglose ni forma de reclamar una diferencia.
// Estructura inspirada en cómo lo resuelven PeYa Rider / Tipti Shopper:
// total del período arriba, desglose ganado/pagado/pendiente, historial con
// la ganancia de CADA entrega, y un canal formal de disputa (rep_reclamos).
export default function ComisionesRepartidorPage() {
  const { user, estado: authEstado, repartidorId } = useAuth()
  const router = useRouter()

  const [cargando, setCargando] = useState(true)
  const [comisionConfig, setComisionConfig] = useState<{ tipo: string; valor: number }>({ tipo: 'fijo', valor: 0 })
  const [entregas, setEntregas] = useState<any[]>([])
  const [periodosPago, setPeriodosPago] = useState<any[]>([])
  const [comisionPendiente, setComisionPendiente] = useState(0)
  const [misReclamos, setMisReclamos] = useState<any[]>([])

  const [reclamoAbierto, setReclamoAbierto] = useState<any | null>(null) // entrega sobre la que se reclama
  const [mensajeReclamo, setMensajeReclamo] = useState('')
  const [enviandoReclamo, setEnviandoReclamo] = useState(false)
  const [errorReclamo, setErrorReclamo] = useState('')

  useEffect(() => {
    if (authEstado === 'cargando') return
    if (!user) { router.replace('/login'); return }
    if (!repartidorId) { router.replace('/'); return }
    cargar()
    // `router` es estable (useRouter() de next/navigation no cambia de
    // referencia entre renders) y `cargar` se define de nuevo en cada
    // render -- agregarla real causaría refetch continuo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authEstado, repartidorId])

  async function cargar() {
    const [{ data: rep }, { data: ents }, { data: periodos }, { data: comisionPend }, { data: reclamos }] = await Promise.all([
      supabase.from('rep_repartidores').select('comision_tipo,comision_valor').eq('id', repartidorId).single(),
      supabase.from('rep_entregas')
        .select('id,pedido_id,entregado_at,monto_cobrado,exitosa,ol_pedidos(numero,nombre_cliente,total)')
        .eq('repartidor_id', repartidorId).eq('exitosa', true)
        .order('entregado_at', { ascending: false }).limit(30),
      supabase.from('rep_periodos_pago').select('*').eq('estado', 'cerrado').order('hasta', { ascending: false }).limit(12),
      supabase.rpc('mi_comision_pendiente'),
      supabase.rpc('mis_reclamos'),
    ])
    if (rep) setComisionConfig({ tipo: rep.comision_tipo ?? 'fijo', valor: Number(rep.comision_valor ?? 0) })
    setEntregas(ents ?? [])
    setPeriodosPago(periodos ?? [])
    setComisionPendiente(Number(comisionPend ?? 0))
    setMisReclamos(reclamos ?? [])
    setCargando(false)
  }

  function gananciaEntrega(e: any) {
    if (comisionConfig.tipo === 'porcentaje') {
      return Math.round(Number(e.ol_pedidos?.total ?? 0) * comisionConfig.valor) / 100
    }
    return comisionConfig.valor
  }

  const totalPagado = periodosPago.reduce((s, p) => s + Number(p.ganancias || 0), 0)
  const totalGanado = totalPagado + comisionPendiente

  function reclamoDeEntrega(entregaId: string) {
    return misReclamos.find(r => r.entrega_id === entregaId)
  }

  async function enviarReclamo() {
    if (!mensajeReclamo.trim()) { setErrorReclamo('Describe brevemente el problema'); return }
    setEnviandoReclamo(true); setErrorReclamo('')
    const { error } = await supabase.rpc('crear_reclamo', {
      p_tipo: 'comision',
      p_mensaje: mensajeReclamo.trim(),
      p_entrega_id: reclamoAbierto?.id ?? null,
      p_deposito_id: null,
      p_request_id: crypto.randomUUID(),
    })
    setEnviandoReclamo(false)
    if (error) { setErrorReclamo(error.message); return }
    setReclamoAbierto(null)
    setMensajeReclamo('')
    const { data: reclamos } = await supabase.rpc('mis_reclamos')
    setMisReclamos(reclamos ?? [])
  }

  if (cargando) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 size={24} className="animate-spin text-green-600" />
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <div className="bg-green-700 text-white px-4 pt-10 pb-5">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => router.back()} className="p-1.5 hover:bg-white/10 rounded-lg transition">
            <ArrowLeft size={18} />
          </button>
          <h1 className="font-extrabold text-lg flex items-center gap-1.5"><TrendingUp size={18} /> Mis comisiones</h1>
        </div>
        <div className="text-center py-3">
          <div className="text-green-200 text-xs">Ganado en total (histórico)</div>
          <div className="text-3xl font-black">{fmt(totalGanado)}</div>
          <div className="text-green-200 text-[11px] mt-0.5">{entregas.length} entregas exitosas mostradas</div>
        </div>
      </div>

      <div className="px-4 py-5 space-y-5">
        {/* Desglose: ganado -> pagado -> pendiente, igual que el patrón de
            PeYa/Tipti (comm-row con dashed separator antes del total). */}
        <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-2 shadow-sm">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Desglose</p>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-500">Comisión ganada (total)</span>
            <span className="font-bold text-slate-800">{fmt(totalGanado)}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-500">Ya pagada (períodos cerrados)</span>
            <span className="font-bold text-slate-400">-{fmt(totalPagado)}</span>
          </div>
          <div className="border-t border-dashed border-slate-200 my-1" />
          <div className="flex justify-between items-center">
            <span className="text-sm font-bold text-slate-700">Por cobrar ahora</span>
            <span className="text-lg font-black text-green-700">{fmt(comisionPendiente)}</span>
          </div>
        </div>

        {/* Historial con la ganancia de CADA entrega -- "Earning per order" */}
        <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-2 shadow-sm">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Historial de entregas</p>
          {entregas.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">Aún no tienes entregas registradas.</p>
          ) : (
            entregas.map(e => {
              const reclamo = reclamoDeEntrega(e.id)
              return (
                <div key={e.id} className="flex items-center gap-2 border-b border-slate-50 last:border-0 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-700 truncate">
                      #{String(e.ol_pedidos?.numero ?? 0).padStart(4, '0')} · {e.ol_pedidos?.nombre_cliente ?? 'Cliente'}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {e.entregado_at ? new Date(e.entregado_at).toLocaleString('es-EC', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </div>
                    {reclamo && (
                      <div className={`text-[9px] font-bold mt-0.5 ${reclamo.estado === 'abierto' ? 'text-amber-600' : 'text-slate-400'}`}>
                        {reclamo.estado === 'abierto' ? '🕓 Reclamo en revisión' : '✓ Reclamo resuelto'}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold text-green-700">+{fmt(gananciaEntrega(e))}</div>
                    {!reclamo && (
                      <button
                        onClick={() => { setReclamoAbierto(e); setMensajeReclamo('') }}
                        className="text-[9px] text-slate-400 hover:text-amber-600 underline cursor-pointer"
                      >
                        Reportar
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {periodosPago.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-1.5 shadow-sm">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Períodos ya pagados</p>
            {periodosPago.map(p => (
              <div key={p.id} className="flex justify-between items-center text-xs">
                <span className="text-slate-500">{p.desde} → {p.hasta}</span>
                <span className="font-bold text-slate-700">{fmt(Number(p.ganancias))}</span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => { setReclamoAbierto({ id: null, ol_pedidos: {} }); setMensajeReclamo('') }}
          className="w-full flex items-center justify-center gap-1.5 border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
        >
          <AlertTriangle size={13} /> Reportar otra diferencia general
        </button>
      </div>

      {/* Modal de reclamo */}
      {reclamoAbierto && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl p-5 w-full sm:max-w-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-800 text-base flex items-center gap-1.5">
                <AlertTriangle size={16} className="text-amber-600" /> Reportar diferencia
              </h3>
              <button onClick={() => setReclamoAbierto(null)} className="text-slate-400 p-1 cursor-pointer"><X size={18} /></button>
            </div>
            {reclamoAbierto.id && (
              <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs text-slate-500">
                Sobre el pedido <span className="font-bold text-slate-700">#{String(reclamoAbierto.ol_pedidos?.numero ?? 0).padStart(4, '0')}</span>
              </div>
            )}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">¿Qué no cuadra?</label>
              <textarea
                value={mensajeReclamo}
                onChange={e => setMensajeReclamo(e.target.value)}
                rows={4}
                placeholder="Ej: esta entrega debería tener comisión de $1.50 y me aparece $1.00"
                className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-amber-500"
              />
            </div>
            {errorReclamo && <p className="text-red-500 text-xs text-center">{errorReclamo}</p>}
            <button
              onClick={enviarReclamo}
              disabled={enviandoReclamo}
              className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              {enviandoReclamo ? <Loader2 size={16} className="animate-spin" /> : <Check size={15} />}
              {enviandoReclamo ? 'Enviando...' : 'Enviar reclamo al administrador'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
