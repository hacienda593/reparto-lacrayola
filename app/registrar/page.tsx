'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import {
  User, Phone, Mail, MapPin, FileText,
  CheckCircle, Loader2, ArrowLeft, ChevronRight,
} from 'lucide-react'

const VEHICULOS = [
  { key: 'moto', emoji: '🛵', label: 'Moto' },
  { key: 'bici', emoji: '🚲', label: 'Bici' },
  { key: 'auto', emoji: '🚗', label: 'Auto' },
  { key: 'pie',  emoji: '🚶', label: 'A pie' },
]

export default function RegistrarPage() {
  const { user, loginGoogle, estado } = useAuth()
  const router = useRouter()

  const [paso,      setPaso]      = useState<1 | 2 | 3>(1)
  const [form,      setForm]      = useState({
    nombre: '', cedula: '', telefono: '',
    vehiculo: 'moto', placa: '', zona_principal: '',
    observaciones: '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error,     setError]     = useState('')
  const [enviado,   setEnviado]   = useState(false)

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function continuar() {
    // Paso 1 → validar datos personales
    if (paso === 1) {
      if (!form.nombre.trim()) { setError('El nombre es obligatorio'); return }
      if (!form.cedula.trim()) { setError('La cédula es obligatoria'); return }
      if (!form.telefono.trim()) { setError('El teléfono es obligatorio'); return }
      setError('')
      setPaso(2)
      return
    }
    // Paso 2 → validar vehículo, luego pedir login con Google
    if (paso === 2) {
      setError('')
      setPaso(3)
      return
    }
  }

  async function registrar() {
    if (!user) { setError('Primero inicia sesión con Google'); return }

    // Verificar que no esté ya registrado
    const { data: existente } = await supabase
      .from('rep_repartidores')
      .select('id, estado_registro')
      .eq('email', user.email ?? '')
      .single()

    if (existente) {
      if (existente.estado_registro === 'pendiente') {
        setEnviado(true); return
      }
      if (existente.estado_registro === 'aprobado') {
        router.replace('/repartidor'); return
      }
    }

    setGuardando(true)
    setError('')

    const { error: err } = await supabase.from('rep_repartidores').insert({
      nombre:          form.nombre.trim(),
      cedula:          form.cedula.trim(),
      telefono:        form.telefono.trim(),
      email:           user.email,
      vehiculo:        form.vehiculo,
      placa:           form.placa.trim() || null,
      zona_principal:  form.zona_principal.trim() || null,
      observaciones:   form.observaciones.trim() || null,
      activo:          false,
      estado_registro: 'pendiente',
    })

    if (err) { setError(err.message); setGuardando(false); return }

    setEnviado(true)
    setGuardando(false)
  }

  // Pantalla de éxito
  if (enviado) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center space-y-4">
        <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto text-3xl">
          ✅
        </div>
        <h2 className="text-lg font-extrabold text-slate-800">¡Solicitud enviada!</h2>
        <p className="text-sm text-slate-500">
          Tu registro está siendo revisado por el administrador.
          Te avisarán cuando tu cuenta esté activa.
        </p>
        <div className="bg-slate-50 rounded-xl p-4 text-left space-y-1.5 text-sm">
          <div className="flex gap-2"><span className="text-slate-400 w-24">Nombre</span><span className="font-semibold text-slate-800">{form.nombre}</span></div>
          <div className="flex gap-2"><span className="text-slate-400 w-24">Gmail</span><span className="font-semibold text-slate-800 truncate">{user?.email}</span></div>
          <div className="flex gap-2"><span className="text-slate-400 w-24">Estado</span><span className="font-semibold text-yellow-600">Pendiente de aprobación</span></div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center px-4 py-8">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="bg-green-700 px-6 py-5 text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-xl">🚚</div>
            <div>
              <h1 className="font-extrabold text-lg leading-tight">Registro de Repartidor</h1>
              <p className="text-green-200 text-xs">La Crayola · Sistema de Reparto</p>
            </div>
          </div>

          {/* Pasos */}
          <div className="flex items-center gap-1 mt-2">
            {[
              { n: 1, label: 'Tus datos' },
              { n: 2, label: 'Vehículo' },
              { n: 3, label: 'Confirmar' },
            ].map(({ n, label }, i, arr) => (
              <div key={n} className="flex items-center gap-1 flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all
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

          {/* ── PASO 1: Datos personales ── */}
          {paso === 1 && (
            <div className="space-y-3">
              <p className="text-sm font-bold text-slate-700">Tus datos personales</p>

              {[
                { k: 'nombre',   label: 'Nombre completo *',    icon: User,     type: 'text',  placeholder: 'Juan Carlos Pérez' },
                { k: 'cedula',   label: 'Cédula de identidad *', icon: FileText, type: 'text',  placeholder: '1712345678' },
                { k: 'telefono', label: 'Teléfono / WhatsApp *', icon: Phone,    type: 'tel',   placeholder: '0991234567' },
              ].map(({ k, label, icon: Icon, type, placeholder }) => (
                <div key={k}>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">{label}</label>
                  <div className="relative">
                    <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type={type} value={(form as any)[k]}
                      onChange={e => set(k, e.target.value)} placeholder={placeholder}
                      className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-green-500" />
                  </div>
                </div>
              ))}

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">Zona de trabajo</label>
                <div className="relative">
                  <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={form.zona_principal}
                    onChange={e => set('zona_principal', e.target.value)}
                    placeholder="Ej: Los Bancos centro"
                    className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-green-500" />
                </div>
              </div>
            </div>
          )}

          {/* ── PASO 2: Vehículo ── */}
          {paso === 2 && (
            <div className="space-y-4">
              <p className="text-sm font-bold text-slate-700">¿Con qué vas a repartir?</p>

              <div className="grid grid-cols-2 gap-3">
                {VEHICULOS.map(v => (
                  <button key={v.key} type="button"
                    onClick={() => set('vehiculo', v.key)}
                    className={`flex flex-col items-center gap-2 py-4 rounded-2xl border-2 transition font-semibold text-sm
                      ${form.vehiculo === v.key
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                    <span className="text-3xl">{v.emoji}</span>
                    {v.label}
                  </button>
                ))}
              </div>

              {form.vehiculo !== 'pie' && (
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">
                    Placa del vehículo
                  </label>
                  <input type="text" value={form.placa}
                    onChange={e => set('placa', e.target.value.toUpperCase())}
                    placeholder="ABC-1234"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500" />
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  Algo más que quieras decirnos
                </label>
                <textarea value={form.observaciones}
                  onChange={e => set('observaciones', e.target.value)}
                  rows={2} placeholder="Experiencia, referencias, disponibilidad..."
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 resize-none" />
              </div>
            </div>
          )}

          {/* ── PASO 3: Confirmar con Google ── */}
          {paso === 3 && (
            <div className="space-y-4">
              <p className="text-sm font-bold text-slate-700">Confirma tu identidad con Google</p>

              {/* Resumen */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Nombre</span>
                  <span className="font-semibold text-slate-800">{form.nombre}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Cédula</span>
                  <span className="font-semibold text-slate-800">{form.cedula}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Teléfono</span>
                  <span className="font-semibold text-slate-800">{form.telefono}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Vehículo</span>
                  <span className="font-semibold text-slate-800">
                    {VEHICULOS.find(v => v.key === form.vehiculo)?.emoji} {form.vehiculo}
                    {form.placa ? ` · ${form.placa}` : ''}
                  </span>
                </div>
              </div>

              {!user ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500 text-center">
                    Inicia sesión con tu Gmail para enviar la solicitud.
                    Tu Gmail será tu usuario para entrar al sistema si eres aprobado.
                  </p>
                  <button onClick={loginGoogle}
                    className="w-full flex items-center justify-center gap-3 border border-slate-200 hover:bg-slate-50 rounded-xl py-3 font-semibold text-slate-700 transition text-sm">
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Continuar con Google
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 text-xs text-green-700">
                    <CheckCircle size={14} />
                    <span>Identificado como <strong>{user.email}</strong></span>
                  </div>
                  <button onClick={registrar} disabled={guardando}
                    className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition text-sm">
                    {guardando
                      ? <Loader2 size={16} className="animate-spin" />
                      : <CheckCircle size={16} />
                    }
                    Enviar solicitud de registro
                  </button>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">
              {error}
            </div>
          )}

          {/* Botones de navegación */}
          <div className="flex gap-3 pt-1">
            {paso > 1 && (
              <button onClick={() => { setPaso(p => (p - 1) as 1|2|3); setError('') }}
                className="flex items-center gap-1.5 border border-slate-200 text-slate-600 font-semibold px-4 py-2.5 rounded-xl text-sm hover:bg-slate-50 transition">
                <ArrowLeft size={14} /> Atrás
              </button>
            )}
            {paso < 3 && (
              <button onClick={continuar}
                className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-xl text-sm transition">
                Continuar <ChevronRight size={14} />
              </button>
            )}
          </div>

          <p className="text-center text-xs text-slate-400">
            ¿Ya tienes cuenta?{' '}
            <a href="/login" className="text-green-600 font-medium hover:underline">Ingresar</a>
          </p>
        </div>
      </div>
    </div>
  )
}
