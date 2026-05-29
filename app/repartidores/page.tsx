'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { RepRepartidor } from '@/lib/types'
import Sidebar from '@/components/Sidebar'
import {
  Plus, Pencil, Loader2, Phone, MapPin,
  Bike, X, Check, Mail, ShieldCheck, Info,
} from 'lucide-react'

const VEHICULOS = ['moto', 'bici', 'auto', 'pie']

const EMPTY: Partial<RepRepartidor> = {
  nombre: '', cedula: '', telefono: '', email: '',
  vehiculo: 'moto', placa: '', zona_principal: '',
  comision_tipo: 'fijo', comision_valor: 1.00,
  activo: true, observaciones: '',
}

export default function RepartidoresPage() {
  const [lista,     setLista]     = useState<RepRepartidor[]>([])
  const [cargando,  setCargando]  = useState(true)
  const [modal,     setModal]     = useState(false)
  const [form,      setForm]      = useState<Partial<RepRepartidor>>(EMPTY)
  const [guardando, setGuardando] = useState(false)
  const [error,     setError]     = useState('')

  async function cargar() {
    const { data } = await supabase.from('rep_repartidores').select('*').order('nombre')
    setLista((data ?? []) as RepRepartidor[])
    setCargando(false)
  }

  useEffect(() => { cargar() }, [])

  function abrirNuevo()           { setForm(EMPTY); setError(''); setModal(true) }
  function abrirEditar(r: RepRepartidor) { setForm(r); setError(''); setModal(true) }

  async function guardar() {
    if (!form.nombre?.trim())    { setError('El nombre es obligatorio');    return }
    if (!form.telefono?.trim())  { setError('El teléfono es obligatorio');  return }
    if (!form.email?.trim())     { setError('El Gmail es obligatorio para dar acceso al repartidor'); return }
    if (!form.email.includes('@gmail.com') && !form.email.includes('@')) {
      setError('Ingresa un correo Gmail válido'); return
    }

    setGuardando(true)
    setError('')

    const payload = { ...form }

    // Generar código automático para nuevos repartidores
    if (!payload.id) {
      payload.codigo = `REP-${String(lista.length + 1).padStart(3,'0')}`
    }

    const { error: err } = payload.id
      ? await supabase.from('rep_repartidores')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', payload.id)
      : await supabase.from('rep_repartidores').insert(payload)

    if (err) { setError(err.message); setGuardando(false); return }

    await cargar()
    setModal(false)
    setGuardando(false)
  }

  async function toggleActivo(r: RepRepartidor) {
    await supabase.from('rep_repartidores')
      .update({ activo: !r.activo, updated_at: new Date().toISOString() })
      .eq('id', r.id)
    // Si se desactiva, también desactivar su rol
    if (r.user_id) {
      await supabase.from('rep_roles')
        .update({ activo: !r.activo })
        .eq('user_id', r.user_id)
    }
    await cargar()
  }

  function set(k: string, v: string | number | boolean) {
    setForm(f => ({ ...f, [k]: v }))
  }

  const EMOJI_VEHICULO: Record<string, string> = {
    moto: '🛵', bici: '🚲', auto: '🚗', pie: '🚶',
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 md:ml-56 pt-14 md:pt-0 p-4 md:p-6 space-y-4">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Repartidores</h1>
            <p className="text-sm text-slate-400">
              {lista.filter(r => r.activo).length} activos · {lista.length} total
            </p>
          </div>
          <button onClick={abrirNuevo}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition">
            <Plus size={16} /> Nuevo repartidor
          </button>
        </div>

        {/* Aviso de cómo funciona el acceso */}
        <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>
            Para que un repartidor pueda ingresar al sistema, regístralo aquí con su <strong>Gmail</strong>.
            La próxima vez que entre con ese Gmail tendrá acceso automáticamente.
          </span>
        </div>

        {cargando ? (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-green-500" />
          </div>
        ) : lista.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <div className="text-5xl">🛵</div>
            <p className="font-semibold text-slate-600">Sin repartidores aún</p>
            <p className="text-sm text-slate-400">Crea el primer repartidor para empezar a asignar pedidos.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {lista.map(r => (
              <div key={r.id}
                className={`bg-white rounded-2xl border shadow-sm p-4 space-y-3 transition
                  ${!r.activo ? 'opacity-50 border-slate-100' : 'border-slate-100'}`}>

                {/* Cabecera */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-green-100 rounded-xl flex items-center justify-center text-xl">
                      {EMOJI_VEHICULO[r.vehiculo ?? 'moto'] ?? '🛵'}
                    </div>
                    <div>
                      <div className="font-bold text-slate-800">{r.nombre}</div>
                      <div className="text-xs text-slate-400">{r.codigo ?? '—'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Indicador de acceso vinculado */}
                    {r.user_id
                      ? <ShieldCheck size={14} className="text-green-500" title="Acceso vinculado" />
                      : <ShieldCheck size={14} className="text-slate-300" title="Aún no ha ingresado" />
                    }
                    <button onClick={() => abrirEditar(r)}
                      className="p-1.5 hover:bg-slate-100 rounded-lg transition text-slate-400 hover:text-slate-700">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => toggleActivo(r)}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition
                        ${r.activo
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-red-100 text-red-600 hover:bg-red-200'}`}>
                      {r.activo ? 'Activo' : 'Inactivo'}
                    </button>
                  </div>
                </div>

                {/* Datos */}
                <div className="space-y-1.5 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <Phone size={11} className="shrink-0" />
                    {r.telefono}
                  </div>
                  {r.email && (
                    <div className="flex items-center gap-1.5">
                      <Mail size={11} className="shrink-0" />
                      <span className="truncate">{r.email}</span>
                    </div>
                  )}
                  {r.zona_principal && (
                    <div className="flex items-center gap-1.5">
                      <MapPin size={11} className="shrink-0" />
                      {r.zona_principal}
                    </div>
                  )}
                  {r.placa && (
                    <div className="flex items-center gap-1.5">
                      <Bike size={11} className="shrink-0" />
                      {r.vehiculo} · {r.placa}
                    </div>
                  )}
                </div>

                {/* Comisión */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <span className="text-xs text-slate-400">Comisión</span>
                  <span className="text-sm font-bold text-green-700">
                    {r.comision_tipo === 'fijo'
                      ? `$${Number(r.comision_valor).toFixed(2)} / entrega`
                      : `${r.comision_valor}% del pedido`
                    }
                  </span>
                </div>

                {/* Estado de acceso */}
                <div className={`text-[10px] font-semibold px-2.5 py-1 rounded-full text-center
                  ${r.user_id ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
                  {r.user_id ? '✅ Acceso activado' : '⏳ Esperando primer ingreso'}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Modal formulario ── */}
        {modal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">

              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <h2 className="font-bold text-slate-800">
                  {form.id ? 'Editar repartidor' : 'Nuevo repartidor'}
                </h2>
                <button onClick={() => setModal(false)}>
                  <X size={18} className="text-slate-400" />
                </button>
              </div>

              <div className="p-5 space-y-3">

                {/* Sección datos personales */}
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Datos personales</p>

                {[
                  { k: 'nombre',   label: 'Nombre completo *', type: 'text',  placeholder: 'Juan Pérez' },
                  { k: 'cedula',   label: 'Cédula',            type: 'text',  placeholder: '1712345678' },
                  { k: 'telefono', label: 'Teléfono *',        type: 'tel',   placeholder: '0991234567' },
                ].map(({ k, label, type, placeholder }) => (
                  <div key={k}>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">{label}</label>
                    <input type={type} value={(form as any)[k] ?? ''}
                      onChange={e => set(k, e.target.value)} placeholder={placeholder}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
                  </div>
                ))}

                {/* Email — campo especial con explicación */}
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">
                    Gmail para acceso al sistema *
                  </label>
                  <div className="relative">
                    <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="email" value={form.email ?? ''}
                      onChange={e => set('email', e.target.value)}
                      placeholder="repartidor@gmail.com"
                      className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-green-500" />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Con este Gmail podrá ingresar al sistema automáticamente.
                  </p>
                </div>

                {/* Sección vehículo */}
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider pt-1">Vehículo</p>

                <div className="grid grid-cols-4 gap-2">
                  {VEHICULOS.map(v => (
                    <button key={v} type="button"
                      onClick={() => set('vehiculo', v)}
                      className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-semibold transition
                        ${form.vehiculo === v
                          ? 'bg-green-600 text-white border-green-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                      <span className="text-lg">{EMOJI_VEHICULO[v]}</span>
                      {v}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Placa</label>
                  <input type="text" value={form.placa ?? ''}
                    onChange={e => set('placa', e.target.value)} placeholder="ABC-1234"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Zona principal</label>
                  <input type="text" value={form.zona_principal ?? ''}
                    onChange={e => set('zona_principal', e.target.value)}
                    placeholder="Los Bancos centro"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
                </div>

                {/* Sección comisión */}
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider pt-1">Comisión</p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Tipo</label>
                    <select value={form.comision_tipo ?? 'fijo'}
                      onChange={e => set('comision_tipo', e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500">
                      <option value="fijo">$ fijo por entrega</option>
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
                  <textarea value={form.observaciones ?? ''}
                    onChange={e => set('observaciones', e.target.value)}
                    rows={2} placeholder="Notas internas..."
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500 resize-none" />
                </div>

                {error && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">
                    <X size={12} /> {error}
                  </div>
                )}
              </div>

              <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
                <button onClick={() => setModal(false)}
                  className="flex-1 border border-slate-200 text-slate-600 font-semibold py-2.5 rounded-xl text-sm hover:bg-slate-50 transition">
                  Cancelar
                </button>
                <button onClick={guardar} disabled={guardando}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition flex items-center justify-center gap-2">
                  {guardando
                    ? <Loader2 size={15} className="animate-spin" />
                    : <Check size={15} />
                  }
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
