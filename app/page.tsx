import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import Dashboard from '@/components/Dashboard'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // 1. Obtener rol desde rep_roles
  const { data: rolData } = await supabase
    .from('rep_roles')
    .select('rol, activo')
    .eq('user_id', user.id)
    .single()

  const rol = rolData?.activo ? rolData.rol : null

  // 2. Verificar si está registrado como repartidor
  const { data: rep } = await supabase
    .from('rep_repartidores')
    .select('id')
    .eq('user_id', user.id)
    .single()

  // Si es un repartidor (por rol o registro), redirigir a pedidos
  if (rol === 'repartidor' || rep) {
    redirect('/pedidos')
  }

  // 3. Si es administrador, supervisor, contador o superadmin, renderizar el Dashboard administrativo
  return (
    <div className="flex min-h-screen bg-[#0c0f12] text-white">
      <Sidebar />
      <main className="flex-1 md:ml-56 pt-14 md:pt-0 p-4 md:p-6 space-y-6">
        <Dashboard />
      </main>
    </div>
  )
}
