'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Loader2, CheckCircle, Lock, Mail, Eye, EyeOff } from 'lucide-react'

// SEC-05 de la auditoría: reemplaza la vinculación automática por email
// (insegura -- cualquiera que se registrara con ese correo antes que la
// persona real quedaba vinculada al perfil operativo). Ahora un admin
// genera este enlace de un solo uso desde Equipo, y SOLO canjeando el
// token exacto se vincula la cuenta -- nunca por coincidencia de correo.
export default function InvitacionPage() {
  const { token } = useParams<{ token: string }>()
  const [modo, setModo] = useState<'crear' | 'entrar'>('crear')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verPass, setVerPass] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState<{ nombre: string } | null>(null)

  async function intentarCanjearConSesionActual() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase.rpc('reclamar_invitacion', { p_token: token })
    if (!error && data) {
      const row = Array.isArray(data) ? data[0] : data
      setResultado({ nombre: row.nombre })
    }
  }
  useEffect(() => { intentarCanjearConSesionActual() }, [])

  async function enviar() {
    setError('')
    if (!email.trim() || !email.includes('@')) { setError('Ingresa un email válido'); return }
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres'); return }
    setProcesando(true)
    try {
      const { error: authErr } = modo === 'crear'
        ? await supabase.auth.signUp({ email: email.trim(), password })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (authErr) { setError(authErr.message); setProcesando(false); return }

      const { data, error: rpcErr } = await supabase.rpc('reclamar_invitacion', { p_token: token })
      if (rpcErr) { setError(rpcErr.message); setProcesando(false); return }
      const row = Array.isArray(data) ? data[0] : data
      setResultado({ nombre: row.nombre })
    } catch (e: any) {
      setError(e?.message || 'No se pudo procesar la invitación')
    } finally {
      setProcesando(false)
    }
  }

  if (resultado) {
    return (
      <div className="min-h-screen bg-[#0c0f12] flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-[#181d24] border border-[#2d3748] rounded-3xl p-6 text-center space-y-3">
          <CheckCircle size={40} className="text-[#00b074] mx-auto" />
          <h1 className="text-white font-black text-lg">¡Cuenta vinculada, {resultado.nombre}!</h1>
          <p className="text-gray-400 text-sm">Ya puedes entrar normalmente desde el login.</p>
          <a href="/login" className="block w-full bg-[#00b074] hover:bg-[#008f5d] text-white font-bold py-3 rounded-xl text-sm transition">
            Ir al login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0c0f12] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-[#00b074] rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Lock className="text-white" size={26} />
          </div>
          <h1 className="text-white font-black text-lg">Invitación de La Crayola</h1>
          <p className="text-gray-400 text-xs mt-1">Crea o entra con tu cuenta para vincular tu acceso.</p>
        </div>

        <div className="flex bg-[#181d24] border border-[#2d3748] rounded-xl p-1 mb-4">
          <button onClick={() => setModo('crear')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${modo === 'crear' ? 'bg-[#00b074] text-white' : 'text-gray-400'}`}>
            Crear cuenta nueva
          </button>
          <button onClick={() => setModo('entrar')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${modo === 'entrar' ? 'bg-[#00b074] text-white' : 'text-gray-400'}`}>
            Ya tengo cuenta
          </button>
        </div>

        <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-3">
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="tu@email.com"
              className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-xl pl-9 pr-3 py-3 text-sm focus:outline-none focus:border-[#00b074]" />
          </div>
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type={verPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Contraseña"
              className="w-full bg-[#0c0f12] border border-[#2d3748] text-white rounded-xl pl-9 pr-9 py-3 text-sm focus:outline-none focus:border-[#00b074]" />
            <button type="button" onClick={() => setVerPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
              {verPass ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          {error && <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</div>}

          <button onClick={enviar} disabled={procesando}
            className="w-full flex items-center justify-center gap-2 bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm transition">
            {procesando ? <Loader2 size={16} className="animate-spin" /> : null}
            {procesando ? 'Procesando...' : modo === 'crear' ? 'Crear cuenta y vincular' : 'Entrar y vincular'}
          </button>
        </div>
      </div>
    </div>
  )
}
