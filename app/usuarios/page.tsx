'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import { Plus, X, Check, Loader2, Shield, Eye, EyeOff, AlertCircle, Trash2 } from 'lucide-react'

type Rol = 'superadmin' | 'admin' | 'supervisor'

interface UsuarioInterno {
  user_id:   string
  rol:       string
  activo:    boolean
  email?:    string
  created_at: string
}

const ROLES: { key: Rol; label: string; desc: string; color: string }[] = [
  { key: 'superadmin', label: 'Super Admin',  desc: 'Acceso total, puede crear usuarios', color: 'text-purple-700 bg-purple-100' },
  { key: 'admin',      label: 'Administrador', desc: 'Gestiona pedidos, repartidores y liquidaciones', color: 'text-blue-700 bg-blue-100' },
  { key: 'supervisor', label: 'Supervisor',    desc: 'Asigna pedidos y monitorea entregas', color: 'text-green-700 bg-green-100' },
]

export default function UsuariosPage() {
  const [lista,    setLista]    = useState<UsuarioInterno[]>([])
  const [cargando, setCargando] = useState(true)
  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState({ email: '', password: '', passwordConf: '', rol: 'admin' as Rol })
  const [verPass,  setVerPass]  = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error,    setError]    = useState('')
  const [exito,    setExito]    = useState('')

  async function cargar() {
    const { data } = await supabase
      .from('rep_roles')
      .select('user_id, rol, activo, created_at')
      .in('rol', ['superadmin','admin','supervisor'])
      .order('created_at')
    setLista((data ?? []) as UsuarioInterno[])
    setCargando(false)
  }

  useEffect(() => { cargar() }, [])

  async function crear() {
    if (!form.email.trim())          { setError('El email es obligatorio');             return }
    if (!form.email.includes('@'))   { setError('Email inválido');                      return }
    if (form.password.length < 6)    { setError('Mínimo 6 caracteres');                return }
    if (form.password !== form.passwordConf) { setError('Las contraseñas no coinciden'); return }

    setGuardando(true); setError('')

    // Crear usuario en Supabase Auth
    const { data, error: authErr } = await supabase.auth.signUp({
      email:    form.email.trim(),
      password: form.password,
    })

    if (authErr || !data.user) {
      setError(authErr?.message ?? 'Error al crear usuario')
      setGuardando(false); return
    }

    // Asignar rol
    const { error: rolErr } = await supabase.from('rep_roles').insert({
      user_id: data.user.id,
      rol:     form.rol,
      activo:  true,
    })

    if (rolErr) { setError(rolErr.message); setGuardando(false); return }

    setModal(false)
    setForm({ email: '', password: '', passwordConf: '', rol: 'admin' })
    setExito(`Usuario ${form.email} creado correctamente`)
    setTimeout(() => setExito(''), 4000)
    await cargar()
    setGuardando(false)
  }

  async function toggleActivo(u: UsuarioInterno) {
    await supabase.from('rep_roles').update({ activo: !u.activo }).eq('user_id', u.user_id)
    await cargar()
  }

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 md:ml-56 pt-14 md:pt-0 p-4 md:p-6 space-y-4">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Usuarios del sistema</h1>
            <p className="text-sm text-slate-400">Administradores y supervisores</p>
          </div>
          <button onClick={() => { setModal(true); setError('') }}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition">
            <Plus size={16} /> Nuevo usuario
          </button>
        </div>

        {exito && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
            <Check size={15} /> {exito}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {lista.length} usuario{lista.length !== 1 ? 's' : ''} registrado{lista.length !== 1 ? 's' : ''}
            </p>
          </div>

          {cargando ? (
            <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-green-500" /></div>
          ) : lista.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <Shield size={40} className="text-slate-200 mx-auto" />
              <p className="text-slate-500">Sin usuarios internos aún</p>
              <p className="text-xs text-slate-400">Crea el primer administrador.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {lista.map(u => {
                const rolCfg = ROLES.find(r => r.key === u.rol)
                return (
                  <div key={u.user_id} className="flex items-center gap-4 px-5 py-4">
                    <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center shrink-0">
                      <Shield size={18} className="text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">
                        {u.email ?? u.user_id.slice(0,8) + '...'}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${rolCfg?.color ?? 'text-slate-600 bg-slate-100'}`}>
                          {rolCfg?.label ?? u.rol}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          Desde {new Date(u.created_at).toLocaleDateString('es')}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => toggleActivo(u)}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition shrink-0
                        ${u.activo ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-600 hover:bg-red-200'}`}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Modal crear usuario */}
        {modal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <h2 className="font-bold text-slate-800">Nuevo usuario interno</h2>
                <button onClick={() => setModal(false)}><X size={18} className="text-slate-400" /></button>
              </div>
              <div className="p-5 space-y-3">

                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-2">Rol</label>
                  <div className="space-y-2">
                    {ROLES.filter(r => r.key !== 'superadmin').map(r => (
                      <button key={r.key} type="button" onClick={() => set('rol', r.key)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition
                          ${form.rol === r.key ? 'border-green-500 bg-green-50' : 'border-slate-200 hover:border-slate-300'}`}>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${r.color}`}>{r.label}</span>
                        <span className="text-xs text-slate-500">{r.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Email</label>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                    placeholder="admin@ejemplo.com"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500" />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Contraseña</label>
                  <div className="relative">
                    <input type={verPass ? 'text' : 'password'} value={form.password} onChange={e => set('password', e.target.value)}
                      placeholder="mínimo 6 caracteres"
                      className="w-full border border-slate-200 rounded-xl px-3 pr-10 py-2.5 text-sm focus:outline-none focus:border-green-500" />
                    <button type="button" onClick={() => setVerPass(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      {verPass ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Confirmar contraseña</label>
                  <input type={verPass ? 'text' : 'password'} value={form.passwordConf} onChange={e => set('passwordConf', e.target.value)}
                    placeholder="••••••••"
                    className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500
                      ${form.passwordConf && form.password !== form.passwordConf ? 'border-red-300 bg-red-50' : 'border-slate-200'}`} />
                </div>

                {error && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">
                    <AlertCircle size={12} /> {error}
                  </div>
                )}
              </div>
              <div className="px-5 py-4 border-t border-slate-100 flex gap-3">
                <button onClick={() => setModal(false)}
                  className="flex-1 border border-slate-200 text-slate-600 font-semibold py-2.5 rounded-xl text-sm hover:bg-slate-50 transition">
                  Cancelar
                </button>
                <button onClick={crear} disabled={guardando}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition flex items-center justify-center gap-2">
                  {guardando ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  Crear usuario
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
