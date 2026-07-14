import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import Dashboard from '@/components/Dashboard'
import { logout } from '@/actions/auth'

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
    .select('id, nombre, email, estado_registro, activo, vehiculo')
    .eq('user_id', user.id)
    .single()

  // 3. Si es un rol administrativo, renderizar el Dashboard administrativo
  const rolesAdmin = ['superadmin', 'admin', 'supervisor', 'contador']
  if (rol && rolesAdmin.includes(rol)) {
    return (
      <div className="flex min-h-screen bg-[#0c0f12] text-white">
        <Sidebar />
        <main className="flex-1 md:ml-56 pt-14 md:pt-0 p-4 md:p-6 space-y-6">
          <Dashboard />
        </main>
      </div>
    )
  }

  // 4. Si es un repartidor aprobado y activo, redirigir a pedidos
  if (rep && rep.estado_registro === 'aprobado' && rep.activo) {
    redirect('/pedidos')
  }

  // 5. En cualquier otro caso, mostrar pantalla de estado de acceso o sin autorización
  const nombre = rep?.nombre || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuario'
  const estado_registro = rep?.estado_registro || 'sin_registro'
  const activo = rep ? rep.activo : false

  return (
    <div className="min-h-screen bg-[#0c0f12] flex items-center justify-center px-4"
      style={{ backgroundImage: 'radial-gradient(at 0% 0%, rgba(0,176,116,0.1) 0px, transparent 50%)' }}>
      <div className="w-full max-w-md bg-[#181d24] border border-[#2d3748] rounded-3xl p-8 text-center space-y-6 shadow-2xl">
        
        {/* Badge de estado */}
        {estado_registro === 'pendiente' && (
          <>
            <div className="w-20 h-20 bg-yellow-500/10 border border-yellow-500/20 rounded-3xl flex items-center justify-center mx-auto text-4xl animate-pulse">⏳</div>
            <h1 className="text-xl font-bold text-white">Registro en revisión</h1>
            <p className="text-gray-400 text-sm leading-relaxed">
              Hola <span className="text-white font-semibold">{nombre}</span>. Tu solicitud de registro como repartidor está siendo revisada por el administrador de La Crayola.
            </p>
            <p className="text-yellow-500 text-xs font-semibold">
              Te avisaremos en cuanto tu cuenta sea activada.
            </p>
          </>
        )}

        {estado_registro === 'rechazado' && (
          <>
            <div className="w-20 h-20 bg-red-500/10 border border-red-500/20 rounded-3xl flex items-center justify-center mx-auto text-4xl">❌</div>
            <h1 className="text-xl font-bold text-white">Solicitud Rechazada</h1>
            <p className="text-gray-400 text-sm leading-relaxed">
              Lo sentimos, <span className="text-white font-semibold">{nombre}</span>. Tu solicitud de ingreso para el sistema de reparto fue rechazada.
            </p>
            <p className="text-red-400 text-xs leading-relaxed">
              Si consideras que es un error, por favor contacta al supervisor de operaciones.
            </p>
          </>
        )}

        {estado_registro === 'aprobado' && !activo && (
          <>
            <div className="w-20 h-20 bg-red-500/10 border border-red-500/20 rounded-3xl flex items-center justify-center mx-auto text-4xl">🔒</div>
            <h1 className="text-xl font-bold text-white">Cuenta Inactiva</h1>
            <p className="text-gray-400 text-sm leading-relaxed">
              Hola <span className="text-white font-semibold">{nombre}</span>. Tu cuenta de repartidor está actualmente desactivada.
            </p>
            <p className="text-red-400 text-xs leading-relaxed">
              Por favor contacta al administrador para reactivar tu acceso.
            </p>
          </>
        )}

        {estado_registro === 'sin_registro' && (
          <>
            <div className="w-20 h-20 bg-blue-500/10 border border-blue-500/20 rounded-3xl flex items-center justify-center mx-auto text-4xl">👤</div>
            <h1 className="text-xl font-bold text-white">Sin Rol Asignado</h1>
            <p className="text-gray-400 text-sm leading-relaxed">
              Hola <span className="text-white font-semibold">{nombre}</span>. Tu cuenta no tiene un rol asignado ni está vinculada a un perfil de repartidor activo.
            </p>
            <div className="bg-[#0c0f12] border border-[#2d3748] rounded-2xl p-4 text-left text-xs text-gray-500 leading-normal space-y-2">
              <p>📍 Si deseas trabajar como repartidor, debes registrarte en la página de registro.</p>
              <p>🔑 Si eres administrador, solicita a un superusuario que asigne un rol a tu cuenta.</p>
            </div>
          </>
        )}

        {/* Botones de acción */}
        <div className="flex flex-col gap-3 pt-2">
          {estado_registro === 'sin_registro' && (
            <a href="/registrar" className="w-full bg-[#00b074] hover:bg-[#008f5d] text-white font-bold py-3.5 rounded-2xl transition text-sm text-center shadow-lg shadow-[#00b074]/20">
              Registrarme como Repartidor
            </a>
          )}
          
          <form action={logout}>
            <button type="submit" className="w-full border border-[#2d3748] hover:bg-gray-800/20 text-gray-400 font-semibold py-3.5 rounded-2xl transition text-sm cursor-pointer">
              Cerrar sesión
            </button>
          </form>
        </div>

      </div>
    </div>
  )
}
