import { createBrowserClient } from '@supabase/ssr'

// Usa el mismo cliente basado en cookies que el middleware y los server
// components (lib/supabase/server.ts, lib/supabase/client.ts). Antes este
// archivo usaba el cliente "plano" de @supabase/supabase-js, que guarda la
// sesion en localStorage en vez de cookies -- como el login real se hace por
// server action (cookies), cualquier pantalla que dependiera de este cliente
// (AuthContext, /repartidor, /asignaciones, /liquidaciones, etc.) nunca veia
// al usuario como logueado, provocando un loop infinito de redireccion hacia
// /login (el middleware si veia la cookie valida y rebotaba de vuelta).
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
