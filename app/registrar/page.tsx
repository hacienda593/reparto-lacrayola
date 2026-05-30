'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  User, Phone, Mail, MapPin, FileText,
  CheckCircle, Loader2, ArrowLeft, ChevronRight,
  Lock, Eye, EyeOff,
} from 'lucide-react'
import Link from 'next/link'

const VEHICULOS = [
  { key: 'moto', emoji: '🛵', label: 'Moto' },
  { key: 'bici', emoji: '🚲', label: 'Bici' },
  { key: 'auto', emoji: '🚗', label: 'Auto' },
  { key: 'pie',  emoji: '🚶', label: 'A pie' },
]

export default function RegistrarPage() {
  const [paso,      setPaso]      = useState<1|2|3>(1)
  const [form,      setForm]      = useState({
    nombre: '', cedula: '', telefono: '',
    email: '', password: '', passwordConf: '',
    vehiculo: 'moto', placa: '', zona_principal: '',
    observaciones: '',
  })
  const [verPass,   setVerPass]   = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error,     setError]     = useState('')
  const [enviado,   setEnviado]   = useState(false)

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  function continuar() {
    setError('')
    if (paso === 1) {
      if (!form.nombre.trim())    { setError('El nombre es obligatorio');    return }
      if (!form.cedula.trim())    { setError('La cédula es obligatoria');    return }
      if (!form.telefono.trim())  { setError('El teléfono es obligatorio'); return }
      if (!form.email.trim())     { setError('El email es obligatorio');    return }
      if (!form.email.includes('@')) { setError('Ingresa un email válido');  return }
      if (form.password.length < 6)  { setError('La contraseña debe tener al menos 6 caracteres'); return }
      if (form.password !== form.passwordConf) { setError('Las contraseñas no coinciden'); return }
      setPaso(2)
    } else if (paso === 2) {
      setPaso(3)
    }
  }

  async function registrar() {
    setGuardando(true); setError('')

    // 1. Verificar que el email no esté ya registrado
    const { data: existente } = await supabase
      .from('rep_repartidores')
      .select('id, estado_registro')
      .eq('email', form.email.trim())
      .single()

    if (existente) {
      if (existente.estado_registro === 'pendiente') { setEnviado(true); setGuardando(false); return }
      if (existente.estado_registro === 'aprobado')  { setError('Este email ya tiene una cuenta activa'); setGuardando(false); return }
    }

    // 2. Crear cuenta en Supabase Auth con email + contraseña
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email:    form.email.trim(),
      password: form.password,
    })

    if (authErr) { setError(authErr.message); setGuardando(false); return }

    // 3. Registrar en rep_repartidores como pendiente
    const { error: repErr } = await supabase.from('rep_repartidores').insert({
      user_id:         authData.user?.id ?? null,
      nombre:          form.nombre.trim(),
      cedula:          form.cedula.trim(),
      telefono:        form.telefono.trim(),
      email:           form.email.trim(),
      vehiculo:        form.vehiculo,
      placa:           form.placa.trim() || null,
      zona_principal:  form.zona_principal.trim() || null,
      observaciones:   form.observaciones.trim() || null,
      activo:          false,
      estado_registro: 'pendiente',
    })

    if (repErr) { setError(repErr.message); setGuardando(false); return }

    setEnviado(true)
    setGuardando(false)
  }

  // ── Pantalla de éxito ──
  if (enviado) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center space-y-4">
        <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto text-3xl">✅</div>
        <h2 className="text-lg font-extrabold text-slate-800">¡Solicitud enviada!</h2>
        <p className="text-sm text-slate-500">
          Tu registro está siendo revisado por el administrador.
          Te avisarán cuando tu cuenta esté activa.
        </p>
        <div className="bg-slate-50 rounded-xl p-4 text-left space-y-1.5 text-sm">
          <div className="flex gap-2"><span className="text-slate-400 w-20">Nombre</span><span className="font-semibold text-slate-800">{form.nombre}</span></div>
          <div className="flex gap-2"><span className="text-slate-400 w-20">Email</span><span className="font-semibold text-slate-800 truncate">{form.email}</span></div>
          <div className="flex gap-2"><span className="text-slate-400 w-20">Estado</span><span className="font-semibold text-yellow-600">Pendiente de aprobación</span></div>
        </div>
        <Link href="/login" className="block w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl text-sm transition text-center">
          Ir al login
        </Link>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center px-4 py-8">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header con pasos */}
        <div className="bg-green-700 px-6 py-5 text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-xl">🚚</div>
            <div>
              <h1 className="font-extrabold text-lg leading-tight">Registro de Repartidor</h1>
              <p className="text-green-200 text-xs">La Crayola · Sistema de Reparto</p>
            </div>
          </div>
          <div className="flex items-center gap-1 mt-2">
            {[{n:1,label:'Tus datos'},{n:2,label:'Vehículo'},{n:3,label:'Confirmar'}].map(({ n, label }, i, arr) => (
              <div key={n} className="flex items-center gap-1 flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                  ${paso >= n ? 'bg-white text-green-700' : 'bg-white/20 text-white/60'}`}>
                  {paso > n ? '✓' : n}
                </div>
                <span className={`text-[10px] font-medium ${paso >= n ? 'text-white' : 'text-white/50'}`}>{label}</span>
                {i < arr.length - 1 && <div className="flex-1 h-px bg-white/20 mx-1" />}
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 space-y-4">

          {/* ── PASO 1: Datos + credenciales ── */}
          {paso === 1 && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Datos personales</p>
              {[
                { k: 'nombre',   label: 'Nombre completo *', icon: User,     type: 'text',  placeholder: 'Juan Carlos Pérez' },
                { k: 'cedula',   label: 'Cédula *',          icon: FileText, type: 'text',  placeholder: '1712345678' },
                { k: 'telefono', label: 'Teléfono / WhatsApp *', icon: Phone, type: 'tel',  placeholder: '0991234567' },
              ].map(({ k, label, icon: Icon, type, placeholder }) => (
                <div key={k}>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">{label}</label>
                  <div className="relative">
                    <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type={type} value={(form as any)[k]} onChange={e => set(k, e.target.value)}
                      placeholder={placeholder}
                      className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-green-500" />
                  </div>
                </div>
              ))}

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Zona de trabajo</label>
                <div className="relative">
                  <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={form.zona_principal} onChange={e => set('zona_principal', e.target.value)}
                    placeholder="Los Bancos centro"
                    className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-green-500" />
                </div>
              </div>

              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider pt-2">Credenciales de acceso</p>

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Email *</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                    placeholder="juan@gmail.com"
                    className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-green-500" />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Con este email y tu contraseña ingresarás al sistema.</p>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Contraseña * (mín. 6 caracteres)</label>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type={verPass ? 'text' : 'password'} value={form.password} onChange={e => set('password', e.target.value)}
                    placeholder="••••••••"
                    className="w-full border border-slate-200 rounded-xl pl-9 pr-10 py-2.5 text-sm focus:outline-none focus:border-green-500" />
                  <button type="button" onClick={() => setVerPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    {verPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Confirmar contraseña *</label>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type={verPass ? 'text' : 'password'} value={form.passwordConf} onChange={e => set('passwordConf', e.target.value)}
                    placeholder="••••••••"
                    className={`w-full border rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-green-500
                      ${form.passwordConf && form.password !== form.passwordConf ? 'border-red-300 bg-red-50' : 'border-slate-200'}`} />
                </div>
                {form.passwordConf && form.password !== form.passwordConf && (
                  <p className="text-[10px] text-red-500 mt-1">Las contraseñas no coinciden</p>
                )}
              </div>
            </div>
          )}

          {/* ── PASO 2: Vehículo ── */}
          {paso === 2 && (
            <div className="space-y-4">
              <p className="text-sm font-bold text-slate-700">¿Con qué vas a repartir?</p>
              <div className="grid grid-cols-2 gap-3">
                {VEHICULOS.map(v => (
                  <button key={v.key} type="button" onClick={() => set('vehiculo', v.key)}
                    className={`flex flex-col items-center gap-2 py-4 rounded-2xl border-2 transition font-semibold text-sm
                      ${form.vehiculo === v.key ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-200 bg-white text-slate-600'}`}>
                    <span className="text-3xl">{v.emoji}</span>{v.label}
                  </button>
                ))}
              </div>
              {form.vehiculo !== 'pie' && (
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Placa del vehículo</label>
                  <input type="text" value={form.placa} onChange={e => set('placa', e.target.value.toUpperCase())}
                    placeholder="ABC-1234"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500" />
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Algo más que quieras decirnos</label>
                <textarea value={form.observaciones} onChange={e => set('observaciones', e.target.value)}
                  rows={2} placeholder="Experiencia, disponibilidad..."
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 resize-none" />
              </div>
            </div>
          )}

          {/* ── PASO 3: Resumen ── */}
          {paso === 3 && (
            <div className="space-y-4">
              <p className="text-sm font-bold text-slate-700">Confirma tu información</p>
              <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                {[
                  { label: 'Nombre',     val: form.nombre },
                  { label: 'Cédula',     val: form.cedula },
                  { label: 'Teléfono',   val: form.telefono },
                  { label: 'Email',      val: form.email },
                  { label: 'Contraseña', val: '••••••••' },
                  { label: 'Vehículo',   val: `${VEHICULOS.find(v=>v.key===form.vehiculo)?.emoji} ${form.vehiculo}${form.placa ? ' · '+form.placa : ''}` },
                ].map(({ label, val }) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-slate-400">{label}</span>
                    <span className="font-semibold text-slate-800 truncate ml-4">{val}</span>
                  </div>
                ))}
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-xs text-yellow-700">
                ⏳ Tu solicitud será revisada por el administrador antes de activar tu acceso.
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">{error}</div>
          )}

          {/* Botones navegación */}
          <div className="flex gap-3 pt-1">
            {paso > 1 && (
              <button onClick={() => { setPaso(p => (p-1) as 1|2|3); setError('') }}
                className="flex items-center gap-1.5 border border-slate-200 text-slate-600 font-semibold px-4 py-2.5 rounded-xl text-sm hover:bg-slate-50 transition">
                <ArrowLeft size={14} /> Atrás
              </button>
            )}
            {paso < 3 ? (
              <button onClick={continuar}
                className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-xl text-sm transition">
                Continuar <ChevronRight size={14} />
              </button>
            ) : (
              <button onClick={registrar} disabled={guardando}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl text-sm transition">
                {guardando ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                Enviar solicitud
              </button>
            )}
          </div>

          <p className="text-center text-xs text-slate-400">
            ¿Ya tienes cuenta? <Link href="/login" className="text-green-600 font-medium hover:underline">Ingresar</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
