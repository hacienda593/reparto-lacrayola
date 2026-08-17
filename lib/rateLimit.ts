// Rate limit simple en memoria por (clave, ruta) -- mitigación básica
// contra abuso/scripts que golpean un endpoint repetidamente. No es
// perfecto en serverless (cada instancia fría tiene su propio contador),
// pero eleva el costo de abusar y evita hammering trivial de scripts
// simples, sin depender de infraestructura nueva (Redis, etc.).
// SEC-06 de la auditoría: /api/envio/calcular y /api/sri/comprobante no
// tenían ningún límite de frecuencia.

const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimitExcedido(clave: string, maxIntentos: number, ventanaMs: number): boolean {
  const ahora = Date.now()
  const actual = buckets.get(clave)
  if (!actual || actual.resetAt < ahora) {
    buckets.set(clave, { count: 1, resetAt: ahora + ventanaMs })
    return false
  }
  actual.count++
  return actual.count > maxIntentos
}

export function ipDe(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  return fwd?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'desconocida'
}
