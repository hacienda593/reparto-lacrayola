'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { Loader2, ShieldX, LogOut } from 'lucide-react'
import Dashboard from '@/components/Dashboard'
import Sidebar from '@/components/Sidebar'

export default function Home() {
  const { user, rol, loading, logout } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace('/login'); return }
    if (rol === 'repartidor') router.replace('/repartidor')
  }, [user, rol, loading, router])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <Loader2 size={28} className="animate-spin text-green-600" />
    </div>
  )

  // Usuario logueado pero sin rol asignado
  if (user && !rol) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm text-center space-y-4">
        <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto">
          <ShieldX size={32} className="text-red-500" />
        </div>
        <h2 className="text-lg font-extrabold text-slate-800">Acceso no autorizado</h2>
        <p className="text-sm text-slate-500">
          Tu cuenta <strong>{user.email}</strong> no tiene permisos para acceder a este sistema.
        </p>
        <p className="text-xs text-slate-400">
          Contacta al administrador para que te asigne un rol.
        </p>
        <button onClick={logout}
          className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold py-2.5 rounded-xl transition text-sm">
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
