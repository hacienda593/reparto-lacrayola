'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { RepRepartidor } from '@/lib/types'
import Sidebar from '@/components/Sidebar'
import { Plus, Pencil, Loader2, User, Phone, MapPin, Bike, X, Check } from 'lucide-react'

const VEHICULOS = ['moto','bici','auto','pie']
const COMISION_TIPOS = ['fijo','porcentaje']

const EMPTY: Partial<RepRepartidor> = {
  nombre: '', cedula: '', telefono: '', email: '',
  vehiculo: 'moto', placa: '', zona_principal: '',
  comision_tipo: 'fijo', comision_valor: 1.00,
  activo: true, observaciones: '',
}

export default function RepartidoresPage() {
  const [lista,    setLista]    = useState<RepRepartidor[]>([])
  const [cargando, setCargando] = useState(true)
  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState<Partial<RepRepartidor>>(EMPTY)
  const [guardando, setGuardando] = useState(false)
  const [error,    setError]    = useState('')

  async function cargar() {
    const { data } = await supabase.from('rep_repartidores').select('*').order('nombre')
    setLista((data ?? []) as RepRepartidor[])
    setCargando(false)
  }

  useEffect(() => { cargar() }, [])

  function abrirNuevo() { setForm(EMPTY); setError(''); setModal(true) }
  function abrirEditar(r: RepRepartidor) { setForm(r); setError(''); setModal(true) }

  async function guardar() {
    if (!form.nombre?.trim() || !form.telefono?.trim()) {
      setError('Nombre y teléfono son obligatorios')
      return
    }
    setGuardando(true)
    setError('')

    // Generar código si es nuevo
    const payload = { ...form }
    if (!payload.id) {
      const codigo = `REP-${String(lista.length + 1).padStart(3,'0')}`
      payload.codigo = codigo
    }

    const { error: err } = payload.id
      ? await supabase.from('rep_repartidores').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', payload.id)
      : await supabase.from('rep_repartidores').insert(payload)

    if (err) { setError(err.message); setGuardando(false); return }
    await cargar()
    setModal(false)
    setGuardando(false)
  }

  async function toggleActivo(r: RepRepartidor) {
    await supabase.from('rep_repartidores').update({ activo: !r.activo }).eq('id', r.id)
    await cargar()
  }

  function set(k: string, v: string | number | boolean) {
    setForm(f => ({ ...f, [k]: v }))
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 md:ml-56 pt-14 md:pt-0 p-4 md:p-6 space-y-4">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Repartidores</h1>
            <p className="text-sm text-slate-400">{lista.filter(r => r.activo).length} activos · {lista.length} total</p>
          </div>
          <button onClick={abrirNuevo}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition">
            <Plus size={16} /> Nuevo repartidor
          </button>
        </div>

        {cargando ? (
          <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-green-500" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {lista.map(r => (
              <div key={r.id} className={`bg-white rounded-2xl border shadow-sm p-4 space-y-3 ${!r.activo ? 'opacity-60' : 'border-slate-100'}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-green-100 rounded-xl flex items-center justify-center text-xl">
                      {r.vehiculo === 'moto' ? '🛵' : r.vehiculo === 'bici' ? '🚲' : r.vehiculo === 'auto' ? '🚗' : '🚶'}
                    </div>
                    <div>
                      <div className="font-bold text-slate-800">{r.nombre}</div>
                      <div className="text-xs text-slate-400">{r.codigo ?? '—'}</div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => abrirEditar(r)}
                      className="p-1.5 hover:bg-slate-100 rounded-lg transition text-slate-400 hover:text-slate-700">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => toggleActivo(r)}
                      className={`p-1.5 rounded-lg transition text-xs font-bold px-2 ${r.activo ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-600 hover:bg-red-200'}`}>
                      {r.activo ? 'Activo' : 'Inactivo'}
                    </button>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5"><Phone size={11} />{r.telefono}</div>
                  {r.zona_principal && <div className="flex items-center gap-1.5"><MapPin size={11} />{r.zona_principal}</div>}
                  {r.placa && <div className="flex items-center gap-1.5"><Bike size={11} />{r.vehiculo} · {r.placa}</div>}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <div className="text-xs text-slate-400">Comisión</div>
                  <div className="text-sm font-bold text-green-700">
                    {r.comision_tipo === 'fijo'
                      ? `$${Number(r.comision_valor).toFixed(2)} / entrega`
                      : `${r.comision_valor}% del pedido`
                    }
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal form */}
        {modal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <h2 className="font-bold text-slate-800">{form.id ? 'Editar repartidor' : 'Nuevo repartidor'}</h2>
                <button onClick={() => setModal(false)}><X size={18} className="text-slate-400" /></button>
              </div>
              <div className="p-5 space-y-3">
                {[
                  { k: 'nombre',         label: 'Nombre completo *', type: 'text',  placeholder: 'Juan Pérez' },
                  { k: 'cedula',         label: 'Cédula',           type: 'text',  placeholder: '1712345678' },
                  { k: 'telefono',       label: 'Teléfono *',       type: 'tel',   placeholder: '0991234567' },
                  { k: 'email',          label: 'Email',            type: 'email', placeholder: 'juan@email.com' },
                  { k: 'placa',          label: 'Placa vehículo',   type: 'text',  placeholder: 'ABC-1234' },
                  { k: 'zona_principal', label: 'Zona principal',   type: 'text',  placeholder: 'Los Bancos centro' },
                ].map(({ k, label, type, placeholder }) => (
                  <div key={k}>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">{label}</label>
                    <input type={type} value={(form as any)[k] ?? ''} onChange={e => set(k, e.target.value)}
                      placeholder={placeholder}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
                  </div>
                ))}

                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Vehículo</label>
                  <select value={form.vehiculo ?? 'moto'} onChange={e => set('vehiculo', e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500">
                    {VEHICULOS.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Tipo comisión</label>
                    <select value={form.comision_tipo ?? 'fijo'} onChange={e => set('comision_tipo', e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500">
                      <option value="fijo">Fijo $ por entrega</option>
                      <option value="porcentaje">% del pedido</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">
                      Valor {form.comision_tipo === 'fijo' ? '($)' : '(%)'}
                    </label>
                    <input type="number" step="0.01" min="0"
                      value={form.comision_valor ?? 1.00}
                      onChange={e => set('comision_valor', parseFloat(e.target.value))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Observaciones</label>
                  <textarea value={form.observaciones ?? ''} onChange={e => set('observaciones', e.target.value)}
                    rows={2} placeholder="Notas internas..."
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500 resize-none" />
                </div>

                {error && <p className="text-red-500 text-xs">{error}</p>}
              </div>
              <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
                <button onClick={() => setModal(false)}
                  className="flex-1 border border-slate-200 text-slate-600 font-semibold py-2.5 rounded-xl text-sm hover:bg-slate-50 transition">
                  Cancelar
                </button>
                <button onClick={guardar} disabled={guardando}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition flex items-center justify-center gap-2">
                  {guardando ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  {form.id ? 'Guardar cambios' : 'Crear repartidor'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
