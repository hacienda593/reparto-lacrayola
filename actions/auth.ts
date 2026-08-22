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
  //
  // SEC-05 de la auditoría: antes había un fallback por EMAIL que vinculaba
  // (y otorgaba rol) a cualquier cuenta cuyo correo coincidiera con un
  // perfil sin user_id todavía -- sin ninguna verificación de que fuera la
  // persona correcta. Se eliminó: el único camino para vincular user_id es
  // el registro propio (ya lo fija al crear la fila) o canjear una
  // invitación de un solo uso (reclamar_invitacion).
  const [
    { data: rolDataResult },
    { data: rep },
  ] = await Promise.all([
    supabase.from('rep_roles').select('rol, activo').eq('user_id', user.id).single(),
    supabase.from('rep_repartidores').select('id, estado_registro, activo, vehiculo').eq('user_id', user.id).single(),
  ])

  let rolData = rolDataResult

  // El perfil ya está vinculado, pero puede faltar el rol si el admin
  // recién aprobó la solicitud (aprobar() no toca rep_roles).
  if (rep && rep.estado_registro === 'aprobado' && rep.activo && !rolData) {
    try {
      const rolAsignado = rep.vehiculo === 'pie' ? 'comprador' : 'repartidor'
      await supabase.from('rep_roles').upsert({ user_id: user.id, rol: rolAsignado, activo: true }, { onConflict: 'user_id' })
      rolData = { rol: rolAsignado, activo: true }
    } catch (e) {
      console.error("Error assigning role on login:", e)
    }
  }

  const rolReal = rolData?.activo ? rolData.rol : null
  const esAdminReal = !!rolReal && ROLES_ADMIN.includes(rolReal)
  const esRepartidorAprobado = !!rep && rep.estado_registro === 'aprobado' && rep.activo
  const esComprador  = esRepartidorAprobado && (rolReal === 'comprador' || rolReal === 'comprador-repartidor')
  const esMotorizado = esRepartidorAprobado && (rolReal === 'repartidor' || rolReal === 'comprador-repartidor' || !rolReal)

  // No se usa redirect() de Next aqui a proposito: eso navega del lado del
  // cliente usando el router interno (RSC/soft navigation), y se detecto que
  // esa transicion especifica se puede quedar colgada para comprador/repartidor
  // (un refresco manual de la misma URL si funcionaba siempre, lo que aislo el
  // problema a esa navegacion suave, no a los datos ni al servidor). En vez de
  // eso se devuelve la URL destino y el formulario de login hace una recarga
  // completa (window.location.href), igual que un refresco manual.
  if (rolDeseado === 'admin') {
    if (!esAdminReal) {
      await supabase.auth.signOut()
      return { error: 'Esta cuenta no tiene permiso de administrador.' }
    }
    return { redirectTo: '/asignaciones' }
  }

  if (rolDeseado === 'comprador') {
    if (!esComprador && !esMotorizado) {
      await supabase.auth.signOut()
      return { error: 'Esta cuenta no esta registrada como repartidor/comprador aprobado.' }
    }
    return { redirectTo: '/repartidor?modo=comprador' }
  }

  if (rolDeseado === 'repartidor') {
    if (!esMotorizado && !esComprador) {
      await supabase.auth.signOut()
      return { error: 'Esta cuenta no esta registrada como repartidor/comprador aprobado.' }
    }
    return { redirectTo: '/repartidor?modo=repartidor' }
  }

  return { redirectTo: '/' }
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
