// Cálculo de costo de envío, compartido entre /api/envio/calcular (uso
// genérico, sin persistir) y /api/envio/calcular-pedido (calcula Y guarda
// en un pedido puntual). Ver migration_costo_envio_auditoria.sql para el
// porqué de esto: la app de tienda manda ol_pedidos.total SIN el envío
// incluido, así que si no lo calculamos y sumamos nosotros, se termina
// entregando el envío gratis.

export function distanciaHaversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving'
const FACTOR_CORRECCION_LINEA_RECTA = 1.3

export async function distanciaKmReal(origen: { lat: number; lng: number }, destino: { lat: number; lng: number }): Promise<{ km: number; metodo: 'osrm' | 'linea_recta' }> {
  try {
    const url = `${OSRM_URL}/${origen.lng},${origen.lat};${destino.lng},${destino.lat}?overview=false`
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (res.ok) {
      const data = await res.json()
      const metros = data?.routes?.[0]?.distance
      if (typeof metros === 'number' && metros > 0) {
        return { km: metros / 1000, metodo: 'osrm' }
      }
    }
  } catch {
    // Servicio gratuito sin SLA garantizado -- si falla o tarda, seguimos
    // con el respaldo en vez de romper el cálculo de envío.
  }
  return { km: distanciaHaversineKm(origen, destino) * FACTOR_CORRECCION_LINEA_RECTA, metodo: 'linea_recta' }
}

export type TarifaZona = { nombre?: string | null; tarifa_base: number; costo_por_km: number; piso_minimo: number; techo_maximo: number | null }

export async function calcularEnvio(
  origen: { lat: number; lng: number },
  destino: { lat: number; lng: number },
  zona: TarifaZona
) {
  const { km, metodo } = await distanciaKmReal(origen, destino)
  // Corrección real (confirmada con un pedido real): la tienda cobra un
  // "Envío estándar" PLANO -- no por distancia -- y ese monto coincide
  // exactamente con tarifa_base configurada acá ($1.50 = $1.50). Sumar
  // costo_por_km × distancia encima de eso inventaba un número que nunca
  // coincidía con lo que el cliente realmente pagó (ej. $7.25 calculado
  // vs $1.50 real), haciendo que CADA transferencia se viera como
  // "faltante" contra un total que nadie iba a pagar. Se usa la tarifa
  // plana; costo_por_km queda sin aplicar mientras la tienda siga
  // cobrando así (piso/techo se conservan como límites de seguridad).
  let envio = zona.tarifa_base
  envio = Math.max(zona.piso_minimo, envio)
  if (zona.techo_maximo != null) envio = Math.min(zona.techo_maximo, envio)
  envio = Math.round(envio * 100) / 100
  return { envio, distanciaKm: Math.round(km * 100) / 100, metodoDistancia: metodo }
}
