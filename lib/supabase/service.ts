import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Cliente con la service_role key: solo debe usarse en código de servidor de
// confianza (route handlers de app/api/**), NUNCA importarse desde un
// componente cliente ni exponerse al navegador. Ignora RLS por diseño.
//
// Uso previsto (auditoria_plan_correcciones_ia.md, punto 8): persistir datos
// derivados del SRI que el servidor ya validó, sin que el navegador pueda
// invocar el mismo insert con valores fabricados.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY no está configurada en el servidor')
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
