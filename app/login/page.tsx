'use client'
import { useState, useTransition } from 'react'
import { login } from '@/actions/auth'
import { Loader2 } from 'lucide-react'

export default function LoginPage() {
  const [error, setError]       = useState('')
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await login(fd)
      if (res?.error) setError(res.error)
    })
  }

  return (
    <div className="min-h-screen bg-[#0c0f12] flex items-center justify-center px-4"
      style={{ backgroundImage: 'radial-gradient(at 0% 0%, rgba(0,176,116,0.15) 0px, transparent 50%)' }}>

      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-[#00b074] rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#00b074]/30">
            <span className="text-4xl">🚚</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Reparto</h1>
          <p className="text-[#00b074] font-semibold text-sm">La Crayola · Librería & Papelería</p>
          <p className="text-gray-500 text-xs mt-1">Sistema de entregas para repartidores</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
              Email
            </label>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="tu@email.com"
              className="w-full bg-[#181d24] border border-[#2d3748] text-white rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#00b074] transition placeholder:text-gray-600"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
              Contraseña
            </label>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full bg-[#181d24] border border-[#2d3748] text-white rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#00b074] transition placeholder:text-gray-600"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl px-4 py-3 text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-60 text-white font-bold py-4 rounded-2xl transition flex items-center justify-center gap-2 text-base mt-2"
          >
            {pending ? <Loader2 size={18} className="animate-spin" /> : '→'}
            {pending ? 'Verificando...' : 'Iniciar turno'}
          </button>
        </form>

        <p className="text-center text-gray-600 text-xs mt-8">
          Solo repartidores autorizados · La Crayola © 2026
        </p>
      </div>
    </div>
  )
}
