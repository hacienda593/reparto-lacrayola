'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { Rol } from '@/lib/types'

interface AuthCtx {
  user:    User | null
  session: Session | null
  rol:     Rol | null
  loading: boolean
  loginGoogle: () => Promise<void>
  logout:      () => Promise<void>
}

const Ctx = createContext<AuthCtx>({
  user: null, session: null, rol: null, loading: true,
  loginGoogle: async () => {}, logout: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [rol,     setRol]     = useState<Rol | null>(null)
  const [loading, setLoading] = useState(true)

  async function cargarRol(u: User) {
    // 1. Buscar rol por user_id
    const { data: rolData } = await supabase
      .from('rep_roles')
      .select('rol')
      .eq('user_id', u.id)
      .single()

    if (rolData) {
      setRol(rolData.rol as Rol)
      return
    }

    // 2. Si no tiene rol, buscar si su email está en rep_repartidores
    const email = u.email ?? ''
    const { data: rep } = await supabase
      .from('rep_repartidores')
      .select('id, email')
      .eq('email', email)
      .eq('activo', true)
      .single()

    if (rep) {
      // El admin ya lo registró → crear rol automáticamente y vincular user_id
      await supabase.from('rep_roles').insert({ user_id: u.id, rol: 'repartidor' })
      await supabase.from('rep_repartidores').update({ user_id: u.id }).eq('id', rep.id)
      setRol('repartidor')
      return
    }

    // 3. No está autorizado
    setRol(null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setUser(data.session?.user ?? null)
      if (data.session?.user) cargarRol(data.session.user)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_e, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        await cargarRol(session.user)
      } else {
        setRol(null)
      }
      setLoading(false)
    })
    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loginGoogle() {
    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/auth/callback`
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options:  { redirectTo },
    })
  }

  async function logout() {
    await supabase.auth.signOut()
    setRol(null)
  }

  return (
    <Ctx.Provider value={{ user, session, rol, loading, loginGoogle, logout }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() { return useContext(Ctx) }
