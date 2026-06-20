'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { Rol } from '@/lib/types'

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
        const { data: rolData } = await supabase
          .from('rep_roles')
          .select('rol, activo')
          .eq('user_id', u.id)
          .single()

        if (rolData?.activo) {
          const r = rolData.rol as Rol
          let repartidorId: string | null = null
          if (r === 'repartidor') {
            const { data: rep } = await supabase
              .from('rep_repartidores').select('id').eq('user_id', u.id).single()
            repartidorId = rep?.id ?? null
          }
          return { estado: 'autorizado' as EstadoAcceso, rol: r, repartidorId }
        }

        const { data: rep } = await supabase
          .from('rep_repartidores')
          .select('id, estado_registro, activo')
          .eq('email', u.email ?? '')
          .single()

        if (!rep)                                { return { estado: 'sin_rol' as EstadoAcceso,   rol: null, repartidorId: null } }
        if (rep.estado_registro === 'rechazado') { return { estado: 'rechazado' as EstadoAcceso, rol: null, repartidorId: null } }
        if (rep.estado_registro === 'pendiente') { return { estado: 'pendiente' as EstadoAcceso, rol: null, repartidorId: null } }

        if (rep.estado_registro === 'aprobado' && rep.activo) {
          try {
            await supabase.from('rep_roles').upsert({ user_id: u.id, rol: 'repartidor', activo: true }, { onConflict: 'user_id' })
            await supabase.from('rep_repartidores').update({ user_id: u.id }).eq('id', rep.id)
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

    supabase.auth.getSession().then(async ({ data }) => {
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
    await supabase.auth.signOut()
    setUser(null); setRol(null); setRepartidorId(null); setEstado('sin_sesion')
    window.location.href = '/login'
  }

  return (
    <Ctx.Provider value={{ user, rol, estado, repartidorId, logout }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() { return useContext(Ctx) }
