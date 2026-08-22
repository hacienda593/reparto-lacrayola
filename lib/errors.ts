// lib/errors.ts
//
// P1-05 de la auditoría operativa (docs/auditoria_operativa_aplicacion_entregas_2026-08-21.md):
// helper mínimo para reemplazar el patrón `catch (e: any) { ...e.message... }`
// repetido por toda la app -- con TS strict, el tipo real de lo que cae en
// un catch es `unknown`, no `any`; esto extrae el mensaje de forma segura
// sin asumir que siempre es una instancia de Error (fetch/Supabase a veces
// rechaza con objetos planos).
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}
