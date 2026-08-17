'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { Rol } from '@/lib/types'
import { logout as serverLogout } from '@/actions/auth'

export type EstadoAcceso =
  | 'cargando'
  | 'sin_sesion'
  | 'sin_rol'
  | 'pendiente'
  | 'rechazado'
  | 'autorizado'

interface AuthCtx {
  user:         User | null
  rol:          Rol | null
  estado:       EstadoAcceso
  repartidorId: string | null
  logout:       () => Promise<void>
}

const Ctx = createContext<AuthCtx>({
  user: null, rol: null, estado: 'cargando', repartidorId: null,
  logout: async () => {},
})

async function resolverAcceso(u: User): Promise<{
  estado: EstadoAcceso; rol: Rol | null; repartidorId: string | null
}> {
  return Promise.race([
    (async () => {
      try {
        // SEC-05 de la auditoría: antes había un fallback por EMAIL que
        // vinculaba (y otorgaba rol) a cualquier cuenta cuyo correo
        // coincidiera con un perfil sin user_id todavía -- sin ninguna
        // verificación de que fuera la persona correcta. Se eliminó por
        // completo: el único camino para vincular user_id ahora es (a) el
        // registro propio, que ya lo fija al crear la fila
        // (/api/repartidores/registrar), o (b) canjear una invitación de
        // un solo uso (reclamar_invitacion), nunca una coincidencia de
        // correo resuelta del lado del cliente.
        const [{ data: rolData }, { data: repInfo }] = await Promise.all([
          supabase.from('rep_roles').select('rol, activo').eq('user_id', u.id).single(),
          supabase.from('rep_repartidores').select('id, estado_registro, activo').eq('user_id', u.id).single(),
        ])

        if (rolData?.activo) {
          const r = rolData.rol as Rol
          const isMobileCollab = r === 'repartidor' || r === 'comprador' || r === 'comprador-repartidor'
          const repartidorId = isMobileCollab ? (repInfo?.id ?? null) : null
          return { estado: 'autorizado' as EstadoAcceso, rol: r, repartidorId }
        }

        const rep = repInfo

        if (!rep)                                { return { estado: 'sin_rol' as EstadoAcceso,   rol: null, repartidorId: null } }
        if (rep.estado_registro === 'rechazado') { return { estado: 'rechazado' as EstadoAcceso, rol: null, repartidorId: null } }
        if (rep.estado_registro === 'pendiente') { return { estado: 'pendiente' as EstadoAcceso, rol: null, repartidorId: null } }

        if (rep.estado_registro === 'aprobado' && rep.activo) {
          // El registro propio ya fija user_id al crear la fila; esto solo
          // otorga el rol la primera vez que el admin aprueba la solicitud
          // (aprobar() en /repartidores no toca rep_roles).
          try {
            await supabase.from('rep_roles').upsert({ user_id: u.id, rol: 'repartidor', activo: true }, { onConflict: 'user_id' })
          } catch {}
          return { estado: 'autorizado' as EstadoAcceso, rol: 'repartidor' as Rol, repartidorId: rep.id }
        }

        return { estado: 'sin_rol' as EstadoAcceso, rol: null, repartidorId: null }
      } catch {
        return { estado: 'sin_rol' as EstadoAcceso, rol: null, repartidorId: null }
      }
    })(),
    new Promise<{ estado: EstadoAcceso; rol: Rol | null; repartidorId: string | null }>(res => 
      setTimeout(() => res({ estado: 'sin_rol' as EstadoAcceso, rol: null, repartidorId: null }), 6000)
    )
  ])
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,         setUser]         = useState<User | null>(null)
  const [rol,          setRol]          = useState<Rol | null>(null)
  const [estado,       setEstado]       = useState<EstadoAcceso>('cargando')
  const [repartidorId, setRepartidorId] = useState<string | null>(null)

  useEffect(() => {
    // En login y registrar no hacer nada — evita que el auto-refresh tome el lock
    // e impida que signInWithPassword funcione
    const path = window.location.pathname
    if (path === '/login' || path === '/registrar') {
      setEstado('sin_sesion')
      return
    }

    let montado = true

    // getSession() en si mismo puede quedarse colgado en un navegador con
    // almacenamiento local corrupto/viejo (ej. varios dias de pruebas
    // acumuladas) -- antes esto se disimulaba porque el timeout de 6s de
    // resolverAcceso() forzaba a la pagina a seguir adelante de todos modos.
    // Ahora que las paginas ya no esperan a authEstado sino solo a `user`,
    // hace falta este mismo tope aqui tambien: si getSession() no responde
    // en 6s, se trata como sesion no encontrada en vez de colgar para
    // siempre sin ninguna salida.
    Promise.race([
      supabase.auth.getSession(),
      new Promise<{ data: { session: null } }>(res =>
        setTimeout(() => res({ data: { session: null } }), 6000)
      ),
    ]).then(async ({ data }) => {
      if (!montado) return
      const u = data.session?.user ?? null
      setUser(u)
      if (!u) { setEstado('sin_sesion'); return }
      const res = await resolverAcceso(u)
      if (!montado) return
      setRol(res.rol)
      setRepartidorId(res.repartidorId)
      setEstado(res.estado)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!montado) return
      const u = session?.user ?? null
      setUser(u)
      if (!u) { setRol(null); setRepartidorId(null); setEstado('sin_sesion'); return }
      if (event === 'INITIAL_SESSION') return
      const res = await resolverAcceso(u)
      if (!montado) return
      setRol(res.rol)
      setRepartidorId(res.repartidorId)
      setEstado(res.estado)
    })

    return () => { montado = false; subscription.unsubscribe() }
  }, [])

  async function logout() {
    setUser(null); setRol(null); setRepartidorId(null); setEstado('sin_sesion')
    try {
      await serverLogout()
    } catch {
      window.location.href = '/login'
    }
  }

  return (
    <Ctx.Provider value={{ user, rol, estado, repartidorId, logout }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() { return useContext(Ctx) }
