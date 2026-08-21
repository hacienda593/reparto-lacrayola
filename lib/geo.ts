// lib/geo.ts
//
// Distancia en línea recta (haversine) entre dos coordenadas. Ya existía
// duplicada como función local en repartidor/page.tsx y otros archivos --
// se centraliza acá para P1-02 (heurística de orden de recogida) sin sumar
// una cuarta copia.
// ETA aproximado asumiendo velocidad urbana promedio (San Miguel de los
// Bancos y alrededores, calles de montaña/tierra) -- es una estimación
// gruesa a partir de línea recta, se etiqueta siempre como "aprox."
export function minutosEstimados(km: number) {
  const VELOCIDAD_KMH = 25
  return Math.max(1, Math.round((km / VELOCIDAD_KMH) * 60))
}

export function distanciaKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

/**
 * Ordena un manifiesto multi-tienda por cercanía real al punto donde está
 * el repartidor (nearest-neighbor greedy) cuando hay coordenadas de tienda
 * disponibles. Si a alguna tienda le falta geo_lat/geo_lng, se la deja al
 * final en el orden que ya traía (el campo manual ol_tiendas.orden, que
 * viene aplicado desde el propio ORDER BY de tiendas_hermanas_pedido) --
 * no se inventa una posición, se degrada con honestidad.
 */
export function ordenarPorCercania<T extends { geo_lat: number | null; geo_lng: number | null }>(
  origen: { lat: number; lng: number } | null,
  items: T[]
): T[] {
  if (!origen) return items
  const conCoords = items.filter(i => i.geo_lat != null && i.geo_lng != null)
  const sinCoords = items.filter(i => i.geo_lat == null || i.geo_lng == null)
  if (conCoords.length === 0) return items

  const restantes = [...conCoords]
  const ordenados: T[] = []
  let punto = origen
  while (restantes.length) {
    let idxMasCercano = 0
    let distMin = Infinity
    for (let i = 0; i < restantes.length; i++) {
      const d = distanciaKm(punto, { lat: restantes[i].geo_lat!, lng: restantes[i].geo_lng! })
      if (d < distMin) { distMin = d; idxMasCercano = i }
    }
    const [siguiente] = restantes.splice(idxMasCercano, 1)
    ordenados.push(siguiente)
    punto = { lat: siguiente.geo_lat!, lng: siguiente.geo_lng! }
  }
  return [...ordenados, ...sinCoords]
}
