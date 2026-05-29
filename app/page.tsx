'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { Loader2 } from 'lucide-react'
import Dashboard from '@/components/Dashboard'
import Sidebar from '@/components/Sidebar'

export default function Home() {
  const { user, rol, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace('/login'); return }
    if (rol === 'repartidor') router.replace('/repartidor')
  }, [user, rol, loading, router])

  if (loading || !user || rol === 'repartidor') return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 size={28} className="animate-spin text-green-600" />
    </div>
  )

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 md:ml-56 pt-14 md:pt-0 p-4 md:p-6">
        <Dashboard />
      </main>
    </div>
  )
}
