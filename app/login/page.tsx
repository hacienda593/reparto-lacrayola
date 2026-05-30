'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Loader2, Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react'
import Link from 'next/link'

export default function LoginPage() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [verPass,  setVerPass]  = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error,    setError]    = useState('')

  async function ingresar(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password.trim()) { setError('Ingresa tu email y contraseña'); return }

    setCargando(true)
    setError('')

    // Limpiar sesión local sin llamada a red — libera locks internos del GoTrueClient
    await supabase.auth.signOut({ scope: 'local' })

    const { error: err } = await supabase.auth.signInWithPassword({
      email:    email.trim(),
      password: password,
    })

    if (err) {
      setError(
        err.message.includes('Invalid login') || err.message.includes('invalid')
          ? 'Email o contraseña incorrectos'
          : err.message.includes('Email not confirmed')
            ? 'Confirma tu email antes de ingresar'
            : err.message
      )
      setCargando(false)
      return
    }

    window.location.href = '/'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">

        <div className="bg-green-700 px-6 py-6 text-white text-center space-y-2">
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center text-3xl mx-auto">🚚</div>
          <h1 className="font-extrabold text-xl">Sistema de Reparto</h1>
          <p className="text-green-200 text-xs">La Crayola · Librería & Papelería</p>
        </div>

        <form onSubmit={ingresar} className="p-6 space-y-4">
          <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-500 space-y-1">
            <p className="font-semibold text-slate-700">Acceso exclusivo para:</p>
            <p>👑 Administradores &nbsp;·&nbsp; 📋 Supervisores &nbsp;·&nbsp; 🛵 Repartidores</p>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">Email</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@email.com"
                autoComplete="email"
                className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-green-500" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">Contraseña</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={verPass ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full border border-slate-200 rounded-xl pl-9 pr-10 py-2.5 text-sm focus:outline-none focus:border-green-500" />
              <button type="button" onClick={() => setVerPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {verPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-xs text-red-600">
              <AlertCircle size={13} className="shrink-0" /> {error}
            </div>
          )}

          <button type="submit" disabled={cargando}
            className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition text-sm">
            {cargando ? <Loader2 size={16} className="animate-spin" /> : '🔑'}
            {cargando ? 'Ingresando...' : 'Ingresar'}
          </button>

          <div className="text-center">
            <Link href="/registrar" className="text-xs text-green-600 hover:underline font-medium">
              ¿Quieres ser repartidor? Regístrate aquí →
            </Link>
          </div>
        </form>

        <div className="px-6 pb-5 text-center text-[10px] text-slate-400">
          Solo cuentas autorizadas por el administrador pueden acceder.
        </div>
      </div>
    </div>
  )
}
