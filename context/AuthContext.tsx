'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { User, Session } from '@supabase/supabase-js'
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
  session:      Session | null
  rol:          Rol | null
  estado:       EstadoAcceso
  repartidorId: string | null
  login:        (email: string, password: string) => Promise<string | null>
  logout:       () => Promise<void>
}

const Ctx = createContext<AuthCtx>({
  user: null, session: null, rol: null,
  estado: 'cargando', repartidorId: null,
  login: async () => null, logout: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,         setUser]         = useState<User | null>(null)
  const [session,      setSession]      = useState<Session | null>(null)
  const [rol,          setRol]          = useState<Rol | null>(null)
  const [estado,       setEstado]       = useState<EstadoAcceso>('cargando')
  const [repartidorId, setRepartidorId] = useState<string | null>(null)

  async function cargarAcceso(u: User) {
    try {
      // 1. Buscar rol por user_id
      const { data: rolData } = await supabase
        .from('rep_roles')
        .select('rol, activo')
        .eq('user_id', u.id)
        .single()

      if (rolData?.activo) {
        setRol(rolData.rol as Rol)
        setEstado('autorizado')
        if (rolData.rol === 'repartidor') {
          const { data: rep } = await supabase
            .from('rep_repartidores')
            .select('id')
            .eq('user_id', u.id)
            .single()
          setRepartidorId(rep?.id ?? null)
        }
        return
      }

      // 2. Buscar por email en rep_repartidores
      const { data: rep } = await supabase
        .from('rep_repartidores')
        .select('id, estado_registro, activo')
        .eq('email', u.email ?? '')
        .single()

      if (!rep)                                    { setEstado('sin_rol');   return }
      if (rep.estado_registro === 'rechazado')     { setEstado('rechazado'); return }
      if (rep.estado_registro === 'pendiente')     { setEstado('pendiente'); return }

      if (rep.estado_registro === 'aprobado' && rep.activo) {
        await supabase.from('rep_roles').upsert({ user_id: u.id, rol: 'repartidor', activo: true })
        await supabase.from('rep_repartidores').update({ user_id: u.id }).eq('id', rep.id)
        setRol('repartidor')
        setRepartidorId(rep.id)
        setEstado('autorizado')
        return
      }

      setEstado('sin_rol')
    } catch {
      setEstado('sin_rol')
    }
  }

  useEffect(() => {
    // Timeout de seguridad: si en 8s no se resuelve el estado, forzar sin_sesion
    const timeout = setTimeout(() => {
      setEstado(e => e === 'cargando' ? 'sin_sesion' : e)
    }, 8000)

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setUser(data.session?.user ?? null)
      if (data.session?.user) cargarAcceso(data.session.user).finally(() => clearTimeout(timeout))
      else { setEstado('sin_sesion'); clearTimeout(timeout) }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_e, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) await cargarAcceso(session.user)
      else { setRol(null); setRepartidorId(null); setEstado('sin_sesion') }
    })
    return () => { subscription.unsubscribe(); clearTimeout(timeout) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Login con email + contraseña — sin redirects, sin OAuth
  async function login(email: string, password: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return error.message
    return null
  }

  async function logout() {
    await supabase.auth.signOut()
    setRol(null); setRepartidorId(null); setEstado('sin_sesion')
  }

  return (
    <Ctx.Provider value={{ user, session, rol, estado, repartidorId, login, logout }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() { return useContext(Ctx) }
