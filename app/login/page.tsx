'use client'
import { useAuth } from '@/context/AuthContext'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function LoginPage() {
  const { user, rol, loading, loginGoogle } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user && rol) router.replace('/')
  }, [user, rol, loading, router])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 size={28} className="animate-spin text-green-600" />
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm space-y-6 text-center">

        <div className="space-y-2">
          <div className="w-16 h-16 bg-green-600 rounded-2xl flex items-center justify-center text-3xl mx-auto shadow-lg">
            🚚
          </div>
          <h1 className="text-xl font-extrabold text-slate-800">Sistema de Reparto</h1>
          <p className="text-sm text-slate-400">La Crayola · Librería & Papelería</p>
        </div>

        <div className="bg-slate-50 rounded-xl p-4 space-y-1 text-left text-xs text-slate-500">
          <p className="font-semibold text-slate-700">Acceso exclusivo para:</p>
          <p>👑 Administradores</p>
          <p>📋 Supervisores</p>
          <p>🛵 Repartidores</p>
        </div>

        <button onClick={loginGoogle}
          className="w-full flex items-center justify-center gap-3 border border-slate-200 hover:bg-slate-50 rounded-xl py-3 font-semibold text-slate-700 transition text-sm">
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Ingresar con Google
        </button>

        <p className="text-[10px] text-slate-400">
          Solo cuentas autorizadas por el administrador pueden acceder.
        </p>
      </div>
    </div>
  )
}
