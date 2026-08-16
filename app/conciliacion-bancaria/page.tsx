'use client'
import { useCallback, useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { supabase } from '@/lib/supabase'
import { AlertTriangle, Banknote, Check, Loader2, RefreshCw } from 'lucide-react'

const money = (n: number) => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(n || 0)

type Mov = {
  origen: 'deposito_repartidor' | 'transferencia_cliente'
  id: string
  monto: number
  fecha: string
  banco: string | null
  referencia: string | null
  detalle: string
  verificado: boolean
}

// Conciliación bancaria: junta en una sola vista todo lo que DEBERÍA
// aparecer en la cuenta bancaria de la empresa -- depósitos que hacen los
// repartidores con el efectivo cobrado, y transferencias que hacen los
// clientes directo. Antes "confirmado" solo significaba que un admin
// aprobó la foto/dato a ojo, no que se cruzó contra el extracto real del
// banco. Verificación manual por ahora: el admin revisa el banco aparte
// (app del banco, no integrado acá) y marca cada movimiento.
export default function ConciliacionBancariaPage() {
  const [movs, setMovs] = useState<Mov[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [procesando, setProcesando] = useState<string | null>(null)
  const [soloPendientes, setSoloPendientes] = useState(true)

  const cargar = useCallback(async () => {
    setLoading(true); setError('')
    const { data, error } = await supabase.rpc('admin_conciliacion_bancaria')
    if (error) setError(error.message)
    setMovs((data ?? []) as Mov[])
    setLoading(false)
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  async function toggleVerificado(m: Mov) {
    setProcesando(m.id)
    const { error } = await supabase.rpc('marcar_verificado_banco', {
      p_origen: m.origen, p_id: m.id, p_verificado: !m.verificado,
    })
    setProcesando(null)
    if (error) { setError(error.message); return }
    await cargar()
  }

  const visibles = soloPendientes ? movs.filter(m => !m.verificado) : movs
  const totalPendiente = movs.filter(m => !m.verificado).reduce((s, m) => s + Number(m.monto || 0), 0)

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar />
      <main className="flex-1 space-y-5 p-4 pt-16 md:ml-56 md:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[.18em] text-green-600">Finanzas</p>
            <h1 className="text-2xl font-black text-slate-900">Conciliación bancaria</h1>
            <p className="text-sm text-slate-500">Depósitos de repartidores y transferencias de clientes, cruzados contra el extracto real del banco.</p>
          </div>
          <button onClick={cargar} disabled={loading} className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </header>

        {error && (
          <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle size={18} /><span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><Banknote size={17} /></div>
            <p className="text-xl font-black">{money(totalPendiente)}</p>
            <p className="text-xs text-slate-500">Pendiente de verificar</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-green-50 text-green-600"><Check size={17} /></div>
            <p className="text-xl font-black">{movs.filter(m => m.verificado).length}</p>
            <p className="text-xs text-slate-500">Ya verificados</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><AlertTriangle size={17} /></div>
            <p className="text-xl font-black">{movs.filter(m => !m.verificado).length}</p>
            <p className="text-xs text-slate-500">Movimientos por revisar</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 p-4">
            <div>
              <h2 className="font-black">Movimientos</h2>
              <p className="text-xs text-slate-500">Marca cada uno cuando lo confirmes contra el extracto del banco.</p>
            </div>
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer">
              <input type="checkbox" checked={soloPendientes} onChange={e => setSoloPendientes(e.target.checked)} className="accent-green-600" />
              Solo pendientes
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Origen</th>
                  <th className="px-3 text-left">Detalle</th>
                  <th className="px-3 text-left">Banco / Referencia</th>
                  <th className="px-3 text-left">Fecha</th>
                  <th className="px-3 text-right">Monto</th>
                  <th className="px-4 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={6} className="p-10 text-center"><Loader2 className="mx-auto animate-spin text-slate-400" /></td></tr>
                ) : visibles.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-sm text-slate-400">
                    {soloPendientes ? 'Nada pendiente de verificar 🎉' : 'Sin movimientos.'}
                  </td></tr>
                ) : visibles.map(m => (
                  <tr key={`${m.origen}-${m.id}`}>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                        m.origen === 'deposito_repartidor' ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {m.origen === 'deposito_repartidor' ? 'Depósito repartidor' : 'Transferencia cliente'}
                      </span>
                    </td>
                    <td className="px-3 text-xs text-slate-600">{m.detalle}</td>
                    <td className="px-3 text-xs text-slate-500">{[m.banco, m.referencia].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-3 whitespace-nowrap text-xs text-slate-500">{new Date(m.fecha).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="px-3 text-right text-xs font-black text-slate-800">{money(m.monto)}</td>
                    <td className="px-4 text-center">
                      <button
                        onClick={() => toggleVerificado(m)}
                        disabled={procesando === m.id}
                        className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition disabled:opacity-50 ${
                          m.verificado
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-slate-900 text-white hover:bg-slate-700'
                        }`}
                      >
                        {procesando === m.id ? '...' : m.verificado ? '✓ Verificado' : 'Marcar verificado'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
