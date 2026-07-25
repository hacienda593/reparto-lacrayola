import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

// Esta pantalla quedo duplicada con /repartidor (que tiene la logica completa y
// mantenida: 6 pestañas de clasificacion, traspaso de efectivo, ruta combinada,
// traspaso QR/PIN). En vez de mantener dos implementaciones en paralelo -que ya
// causo confusion varias veces porque las correcciones se hacian en una pantalla
// mientras se probaba la otra- esta ruta ahora reenvia directo a /repartidor.
export default async function PedidosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: rolData } = await supabase
    .from('rep_roles')
    .select('rol, activo')
    .eq('user_id', user.id)
    .single()

  const rol = rolData?.activo ? rolData.rol : null
  const rolesAdmin = ['superadmin', 'admin', 'supervisor', 'contador']
  if (rol && rolesAdmin.includes(rol)) {
    redirect('/asignaciones')
  }

  redirect('/repartidor')
}
