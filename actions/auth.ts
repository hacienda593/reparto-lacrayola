'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

const ROLES_ADMIN = ['superadmin', 'admin', 'supervisor', 'contador']

export async function login(formData: FormData) {
  const email      = formData.get('email')      as string
  const password   = formData.get('password')   as string
  const rolDeseado = formData.get('rolDeseado')  as string
  const supabase   = await createClient()

  const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !signInData.user) return { error: 'Email o contraseña incorrectos' }

  const user = signInData.user

  // Verificar de una vez, contra Supabase, si esta cuenta realmente tiene el
  // rol que el usuario selecciono al entrar -- en vez de adivinarlo despues
  // por nombre/vehiculo (lo que causaba lentitud y pantallas parpadeando
  // entre modulos mientras se resolvia).
  const [{ data: rolData }, { data: rep }] = await Promise.all([
    supabase.from('rep_roles').select('rol, activo').eq('user_id', user.id).single(),
    supabase.from('rep_repartidores').select('id, estado_registro, activo, vehiculo').eq('user_id', user.id).single(),
  ])

  const rolReal = rolData?.activo ? rolData.rol : null
  const esAdminReal = !!rolReal && ROLES_ADMIN.includes(rolReal)
  const esRepartidorAprobado = !!rep && rep.estado_registro === 'aprobado' && rep.activo
  const esComprador  = esRepartidorAprobado && (rolReal === 'comprador' || rolReal === 'comprador-repartidor')
  const esMotorizado = esRepartidorAprobado && (rolReal === 'repartidor' || rolReal === 'comprador-repartidor' || !rolReal)

  if (rolDeseado === 'admin') {
    if (!esAdminReal) {
      await supabase.auth.signOut()
      return { error: 'Esta cuenta no tiene permiso de administrador.' }
    }
    redirect('/asignaciones')
  }

  if (rolDeseado === 'comprador') {
    if (!esComprador && !esMotorizado) {
      await supabase.auth.signOut()
      return { error: 'Esta cuenta no esta registrada como repartidor/comprador aprobado.' }
    }
    redirect('/repartidor?modo=comprador')
  }

  if (rolDeseado === 'repartidor') {
    if (!esMotorizado && !esComprador) {
      await supabase.auth.signOut()
      return { error: 'Esta cuenta no esta registrada como repartidor/comprador aprobado.' }
    }
    redirect('/repartidor?modo=repartidor')
  }

  // Sin seleccion valida: dejar que / decida (compatibilidad)
  redirect('/')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
