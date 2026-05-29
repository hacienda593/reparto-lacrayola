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

  async function cargarRol(userId: string) {
    const { data } = await supabase
      .from('rep_roles')
      .select('rol')
      .eq('user_id', userId)
      .single()
    setRol((data?.rol as Rol) ?? null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setUser(data.session?.user ?? null)
      if (data.session?.user) cargarRol(data.session.user.id)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) cargarRol(session.user.id)
      else setRol(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function loginGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  async function logout() {
    await supabase.auth.signOut()
  }

  return (
    <Ctx.Provider value={{ user, session, rol, loading, loginGoogle, logout }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() { return useContext(Ctx) }
