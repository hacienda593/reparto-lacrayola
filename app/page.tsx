'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { Loader2, ShieldX, Clock, LogOut, XCircle } from 'lucide-react'
import Dashboard from '@/components/Dashboard'
import Sidebar from '@/components/Sidebar'

export default function Home() {
  const { user, rol, estado, logout } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (estado === 'cargando')   return
    if (estado === 'sin_sesion') { router.replace('/login'); return }
    if (estado === 'autorizado' && rol === 'repartidor') router.replace('/repartidor')
  }, [estado, rol, router])

  // Cargando
  if (estado === 'cargando') return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <Loader2 size={28} className="animate-spin text-green-600" />
    </div>
  )

  // Solicitud pendiente de aprobación
  if (estado === 'pendiente') return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center space-y-4">
        <div className="w-16 h-16 bg-yellow-100 rounded-2xl flex items-center justify-center mx-auto">
          <Clock size={32} className="text-yellow-500" />
        </div>
        <h2 className="text-lg font-extrabold text-slate-800">Solicitud en revisión</h2>
        <p className="text-sm text-slate-500">
          Tu registro está siendo revisado por el administrador.
          Te contactarán cuando tu cuenta esté activa.
        </p>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-xs text-yellow-700">
          📧 Registrado como <strong>{user?.email}</strong>
        </div>
        <button onClick={logout}
          className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-500 font-semibold py-2.5 rounded-xl transition text-sm">
          <LogOut size={14} /> Cerrar sesión
        </button>
      </div>
    </div>
  )

  // Solicitud rechazada
  if (estado === 'rechazado') return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center space-y-4">
        <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto">
          <XCircle size={32} className="text-red-500" />
        </div>
        <h2 className="text-lg font-extrabold text-slate-800">Solicitud rechazada</h2>
        <p className="text-sm text-slate-500">
          Tu solicitud no fue aprobada. Contacta al administrador
          para más información.
        </p>
        <a href="https://wa.me/593984341953"
          className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-xl transition text-sm">
          Contactar por WhatsApp
        </a>
        <button onClick={logout}
          className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-500 font-semibold py-2.5 rounded-xl transition text-sm">
          <LogOut size={14} /> Cerrar sesión
        </button>
      </div>
    </div>
  )

  // Gmail no autorizado
  if (estado === 'sin_rol') return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center space-y-4">
        <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto">
          <ShieldX size={32} className="text-red-500" />
        </div>
        <h2 className="text-lg font-extrabold text-slate-800">Acceso no autorizado</h2>
        <p className="text-sm text-slate-500">
          La cuenta <strong>{user?.email}</strong> no tiene permisos
          para acceder a este sistema.
        </p>
        <div className="space-y-2 text-xs text-slate-400">
          <p>¿Eres repartidor? Regístrate primero:</p>
          <a href="/registrar"
            className="block bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-xl transition text-sm">
            Solicitar acceso como repartidor
          </a>
        </div>
        <button onClick={logout}
          className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-500 font-semibold py-2.5 rounded-xl transition text-sm">
          <LogOut size={14} /> Cerrar sesión
        </button>
      </div>
    </div>
  )

  if (!user || rol === 'repartidor') return null

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 md:ml-56 pt-14 md:pt-0 p-4 md:p-6">
        <Dashboard />
      </main>
    </div>
  )
}
