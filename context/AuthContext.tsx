'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { Rol } from '@/lib/types'

export type EstadoAcceso =
  | 'cargando'
  | 'sin_sesion'
  | 'sin_rol'           // logueado pero no está en ninguna tabla
  | 'pendiente'         // se registró como repartidor, esperando aprobación
  | 'rechazado'         // admin rechazó su solicitud
  | 'autorizado'        // tiene rol y está aprobado

interface AuthCtx {
  user:         User | null
  session:      Session | null
  rol:          Rol | null
  estado:       EstadoAcceso
  repartidorId: string | null   // id en rep_repartidores si aplica
  loginGoogle:  () => Promise<void>
  logout:       () => Promise<void>
}

const Ctx = createContext<AuthCtx>({
  user: null, session: null, rol: null,
  estado: 'cargando', repartidorId: null,
  loginGoogle: async () => {}, logout: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,         setUser]         = useState<User | null>(null)
  const [session,      setSession]      = useState<Session | null>(null)
  const [rol,          setRol]          = useState<Rol | null>(null)
  const [estado,       setEstado]       = useState<EstadoAcceso>('cargando')
  const [repartidorId, setRepartidorId] = useState<string | null>(null)

  async function cargarAcceso(u: User) {
    // 1. Buscar rol por user_id
    const { data: rolData } = await supabase
      .from('rep_roles')
      .select('rol, activo')
      .eq('user_id', u.id)
      .single()

    if (rolData?.activo) {
      setRol(rolData.rol as Rol)
      setEstado('autorizado')

      // Si es repartidor, cargar su rep_repartidores.id
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

    if (!rep) {
      // No está en ninguna tabla → sin rol
      setEstado('sin_rol')
      return
    }

    if (rep.estado_registro === 'rechazado') {
      setEstado('rechazado')
      return
    }

    if (rep.estado_registro === 'pendiente') {
      setEstado('pendiente')
      return
    }

    if (rep.estado_registro === 'aprobado' && rep.activo) {
      // Aprobado pero aún no tiene rep_roles → crear ahora
      await supabase.from('rep_roles').upsert({ user_id: u.id, rol: 'repartidor', activo: true })
      await supabase.from('rep_repartidores').update({ user_id: u.id }).eq('id', rep.id)
      setRol('repartidor')
      setRepartidorId(rep.id)
      setEstado('autorizado')
      return
    }

    setEstado('sin_rol')
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setUser(data.session?.user ?? null)
      if (data.session?.user) {
        cargarAcceso(data.session.user)
      } else {
        setEstado('sin_sesion')
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_e, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        await cargarAcceso(session.user)
      } else {
        setRol(null)
        setRepartidorId(null)
        setEstado('sin_sesion')
      }
    })
    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loginGoogle() {
    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/auth/callback`
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
  }

  async function logout() {
    await supabase.auth.signOut()
    setRol(null)
    setRepartidorId(null)
    setEstado('sin_sesion')
  }

  return (
    <Ctx.Provider value={{ user, session, rol, estado, repartidorId, loginGoogle, logout }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() { return useContext(Ctx) }
