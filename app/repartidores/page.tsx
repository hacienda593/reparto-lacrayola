'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { RepRepartidor } from '@/lib/types'
import Sidebar from '@/components/Sidebar'
import {
  Plus, Pencil, Loader2, Phone, MapPin,
  Bike, X, Check, Mail, ShieldCheck, Info,
  UserCheck, UserX, Clock, AlertCircle,
} from 'lucide-react'

const VEHICULOS = ['moto', 'bici', 'auto', 'pie']
const EMOJI_V: Record<string, string> = { moto:'🛵', bici:'🚲', auto:'🚗', pie:'🚶' }

const EMPTY: Partial<RepRepartidor> = {
  nombre: '', cedula: '', telefono: '', email: '',
  vehiculo: 'moto', placa: '', zona_principal: '',
  comision_tipo: 'fijo', comision_valor: 1.00,
  activo: true, observaciones: '',
}

type Vista = 'activos' | 'pendientes'

interface RepConEstado extends RepRepartidor {
  estado_registro?: string
  motivo_rechazo?:  string
}

export default function RepartidoresPage() {
  const { user } = useAuth()
  const [lista,       setLista]       = useState<RepConEstado[]>([])
  const [pendientes,  setPendientes]  = useState<RepConEstado[]>([])
  const [cargando,    setCargando]    = useState(true)
  const [vista,       setVista]       = useState<Vista>('activos')
  const [modal,       setModal]       = useState(false)
  const [form,        setForm]        = useState<Partial<RepRepartidor>>(EMPTY)
  const [guardando,   setGuardando]   = useState(false)
  const [error,       setError]       = useState('')
  const [motivo,      setMotivo]      = useState('')
  const [rechazando,  setRechazando]  = useState<string | null>(null)
  const [procesando,  setProcesando]  = useState<string | null>(null)

  async function cargar() {
    const { data } = await supabase
      .from('rep_repartidores')
      .select('*')
      .order('created_at', { ascending: false })

    const todos = (data ?? []) as RepConEstado[]
    setLista(todos.filter(r => r.estado_registro === 'aprobado' || !r.estado_registro))
    setPendientes(todos.filter(r => r.estado_registro === 'pendiente'))
    setCargando(false)
  }

  useEffect(() => { cargar() }, [])

  function abrirNuevo()                    { setForm(EMPTY); setError(''); setModal(true) }
  function abrirEditar(r: RepConEstado)    { setForm(r);     setError(''); setModal(true) }

  async function guardar() {
    if (!form.nombre?.trim())   { setError('El nombre es obligatorio');   return }
    if (!form.telefono?.trim()) { setError('El teléfono es obligatorio'); return }
    if (!form.email?.trim())    { setError('El Gmail es obligatorio');    return }
    setGuardando(true); setError('')

    const payload: any = { ...form }
    if (!payload.id) {
      payload.codigo          = `REP-${String(lista.length + 1).padStart(3,'0')}`
      payload.estado_registro = 'aprobado'
      payload.activo          = true
    }

    const { error: err } = payload.id
      ? await supabase.from('rep_repartidores')
          .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', payload.id)
      : await supabase.from('rep_repartidores').insert(payload)

    if (err) { setError(err.message); setGuardando(false); return }
    await cargar(); setModal(false); setGuardando(false)
  }

  async function aprobar(rep: RepConEstado) {
    setProcesando(rep.id)
    await supabase.from('rep_repartidores').update({
      estado_registro:  'aprobado',
      activo:           true,
      fecha_aprobacion: new Date().toISOString(),
      aprobado_por:     user?.id ?? null,
      codigo:           `REP-${String(lista.length + 1).padStart(3,'0')}`,
      updated_at:       new Date().toISOString(),
    }).eq('id', rep.id)
    await cargar(); setProcesando(null)
  }

  async function rechazar(rep: RepConEstado) {
    if (!motivo.trim()) { alert('Escribe el motivo del rechazo'); return }
    setProcesando(rep.id)
    await supabase.from('rep_repartidores').update({
      estado_registro: 'rechazado',
      activo:          false,
      motivo_rechazo:  motivo,
      updated_at:      new Date().toISOString(),
    }).eq('id', rep.id)
    setRechazando(null); setMotivo('')
    await cargar(); setProcesando(null)
  }

  async function toggleActivo(r: RepConEstado) {
    await supabase.from('rep_repartidores')
      .update({ activo: !r.activo, updated_at: new Date().toISOString() }).eq('id', r.id)
    if (r.user_id) {
      await supabase.from('rep_roles').update({ activo: !r.activo }).eq('user_id', r.user_id)
    }
    await cargar()
  }

  function set(k: string, v: string | number | boolean) {
    setForm(f => ({ ...f, [k]: v }))
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 md:ml-56 pt-14 md:pt-0 p-4 md:p-6 space-y-4">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Repartidores</h1>
            <p className="text-sm text-slate-400">
              {lista.filter(r => r.activo).length} activos · {lista.length} aprobados
            </p>
          </div>
          <button onClick={abrirNuevo}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition">
            <Plus size={16} /> Nuevo repartidor
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          <button onClick={() => setVista('activos')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              vista === 'activos' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            <ShieldCheck size={15} /> Aprobados ({lista.length})
          </button>
          <button onClick={() => setVista('pendientes')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
              vista === 'pendientes' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            <Clock size={15} />
            Solicitudes
            {pendientes.length > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {pendientes.length}
              </span>
            )}
          </button>
        </div>

        {/* Aviso info */}
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700">
          <Info size={14} className="shrink-0 mt-0.5" />
          {vista === 'activos'
            ? 'Los repartidores aprobados pueden ingresar al sistema con su Gmail registrado.'
            : 'Revisa cada solicitud, verifica los datos y aprueba o rechaza según corresponda.'
          }
        </div>

        {cargando ? (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-green-500" />
          </div>
        ) : (

          /* ── VISTA APROBADOS ── */
          vista === 'activos' ? (
            lista.length === 0 ? (
              <div className="text-center py-16 space-y-2">
                <div className="text-5xl">🛵</div>
                <p className="font-semibold text-slate-600">Sin repartidores aprobados</p>
                <p className="text-sm text-slate-400">Crea uno manualmente o aprueba solicitudes pendientes.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {lista.map(r => (
                  <div key={r.id} className={`bg-white rounded-2xl border shadow-sm p-4 space-y-3 ${!r.activo ? 'opacity-60 border-slate-100' : 'border-slate-100'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 bg-green-100 rounded-xl flex items-center justify-center text-xl">
                          {EMOJI_V[r.vehiculo ?? 'moto']}
                        </div>
                        <div>
                          <div className="font-bold text-slate-800">{r.nombre}</div>
                          <div className="text-xs text-slate-400">{r.codigo ?? '—'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {r.user_id
                          ? <span title="Acceso vinculado"><ShieldCheck size={14} className="text-green-500" /></span>
                          : <span title="Aún no ha ingresado"><ShieldCheck size={14} className="text-slate-300" /></span>
                        }
                        <button onClick={() => abrirEditar(r)}
                          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => toggleActivo(r)}
                          className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition
                            ${r.activo ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-600 hover:bg-red-200'}`}>
                          {r.activo ? 'Activo' : 'Inactivo'}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-500">
                      <div className="flex items-center gap-1.5"><Phone size={11} />{r.telefono}</div>
                      {r.email && <div className="flex items-center gap-1.5"><Mail size={11} /><span className="truncate">{r.email}</span></div>}
                      {r.zona_principal && <div className="flex items-center gap-1.5"><MapPin size={11} />{r.zona_principal}</div>}
                      {r.placa && <div className="flex items-center gap-1.5"><Bike size={11} />{r.vehiculo} · {r.placa}</div>}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                      <span className="text-xs text-slate-400">Comisión</span>
                      <span className="text-sm font-bold text-green-700">
                        {r.comision_tipo === 'fijo'
                          ? `$${Number(r.comision_valor).toFixed(2)} / entrega`
                          : `${r.comision_valor}% del pedido`
                        }
                      </span>
                    </div>

                    <div className={`text-[10px] font-semibold px-2.5 py-1 rounded-full text-center
                      ${r.user_id ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
                      {r.user_id ? '✅ Acceso activado' : '⏳ Esperando primer ingreso'}
                    </div>
                  </div>
                ))}
              </div>
            )

          /* ── VISTA SOLICITUDES ── */
          ) : (
            pendientes.length === 0 ? (
              <div className="text-center py-16 space-y-2">
                <div className="text-5xl">📋</div>
                <p className="font-semibold text-slate-600">Sin solicitudes pendientes</p>
                <p className="text-sm text-slate-400">Los nuevos repartidores se registran en /registrar</p>
              </div>
            ) : (
              <div className="space-y-4">
                {pendientes.map(r => (
                  <div key={r.id} className="bg-white rounded-2xl border border-yellow-200 shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2 bg-yellow-50 border-b border-yellow-100">
                      <Clock size={13} className="text-yellow-600" />
                      <span className="text-xs font-bold text-yellow-700">Solicitud pendiente de revisión</span>
                    </div>

                    <div className="p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-2xl shrink-0">
                          {EMOJI_V[r.vehiculo ?? 'moto']}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-800">{r.nombre}</div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1.5">
                            {[
                              { icon: FileText, val: r.cedula },
                              { icon: Phone,    val: r.telefono },
                              { icon: Mail,     val: r.email },
                              { icon: MapPin,   val: r.zona_principal },
                              { icon: Bike,     val: r.placa ? `${r.vehiculo} · ${r.placa}` : r.vehiculo },
                            ].filter(i => i.val).map(({ icon: Icon, val }, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-xs text-slate-500">
                                <Icon size={11} className="shrink-0" />
                                <span className="truncate">{val}</span>
                              </div>
                            ))}
                          </div>
                          {r.observaciones && (
                            <div className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                              💬 {r.observaciones}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Panel de rechazo */}
                      {rechazando === r.id && (
                        <div className="space-y-2">
                          <textarea
                            value={motivo} onChange={e => setMotivo(e.target.value)}
                            placeholder="Motivo del rechazo (se le comunicará al repartidor)..."
                            rows={2}
                            className="w-full border border-red-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-400 resize-none bg-red-50" />
                          <div className="flex gap-2">
                            <button onClick={() => { setRechazando(null); setMotivo('') }}
                              className="flex-1 border border-slate-200 text-slate-600 font-semibold py-2 rounded-xl text-xs hover:bg-slate-50 transition">
                              Cancelar
                            </button>
                            <button onClick={() => rechazar(r)} disabled={procesando === r.id}
                              className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white font-bold py-2 rounded-xl text-xs transition flex items-center justify-center gap-1.5">
                              {procesando === r.id ? <Loader2 size={13} className="animate-spin" /> : <UserX size={13} />}
                              Confirmar rechazo
                            </button>
                          </div>
                        </div>
                      )}

                      {rechazando !== r.id && (
                        <div className="flex gap-2">
                          <button onClick={() => setRechazando(r.id)}
                            className="flex-1 flex items-center justify-center gap-1.5 border border-red-200 text-red-600 hover:bg-red-50 font-semibold py-2.5 rounded-xl text-sm transition">
                            <UserX size={15} /> Rechazar
                          </button>
                          <button onClick={() => aprobar(r)} disabled={procesando === r.id}
                            className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl text-sm transition">
                            {procesando === r.id ? <Loader2 size={15} className="animate-spin" /> : <UserCheck size={15} />}
                            Aprobar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )
        )}

        {/* Modal crear/editar */}
        {modal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <h2 className="font-bold text-slate-800">{form.id ? 'Editar repartidor' : 'Nuevo repartidor'}</h2>
                <button onClick={() => setModal(false)}><X size={18} className="text-slate-400" /></button>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Datos personales</p>
                {[
                  { k: 'nombre',   label: 'Nombre completo *', type: 'text',  placeholder: 'Juan Pérez' },
                  { k: 'cedula',   label: 'Cédula *',          type: 'text',  placeholder: '1712345678' },
                  { k: 'telefono', label: 'Teléfono *',        type: 'tel',   placeholder: '0991234567' },
                  { k: 'email',    label: 'Gmail para acceso *',type: 'email', placeholder: 'juan@gmail.com' },
                  { k: 'placa',    label: 'Placa vehículo',    type: 'text',  placeholder: 'ABC-1234' },
                  { k: 'zona_principal', label: 'Zona principal', type: 'text', placeholder: 'Los Bancos centro' },
                ].map(({ k, label, type, placeholder }) => (
                  <div key={k}>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">{label}</label>
                    <input type={type} value={(form as any)[k] ?? ''}
                      onChange={e => set(k, e.target.value)} placeholder={placeholder}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
                  </div>
                ))}
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Vehículo</label>
                  <select value={form.vehiculo ?? 'moto'} onChange={e => set('vehiculo', e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500">
                    {VEHICULOS.map(v => <option key={v} value={v}>{EMOJI_V[v]} {v}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Tipo comisión</label>
                    <select value={form.comision_tipo ?? 'fijo'} onChange={e => set('comision_tipo', e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500">
                      <option value="fijo">$ fijo / entrega</option>
                      <option value="porcentaje">% del pedido</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">
                      Valor {form.comision_tipo === 'fijo' ? '($)' : '(%)'}
                    </label>
                    <input type="number" step="0.01" min="0" value={form.comision_valor ?? 1.00}
                      onChange={e => set('comision_valor', parseFloat(e.target.value))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
                  </div>
                </div>
                {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600"><AlertCircle size={12} />{error}</div>}
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

// Needed for the FileText icon used inline
function FileText({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
    </svg>
  )
}
