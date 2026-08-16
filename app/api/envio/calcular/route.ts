import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Calcula el costo de envío = max(piso_minimo, tarifa_base + costo_por_km
// × distancia_real), con tarifa configurable por zona (tabla zonas,
// editable en /configuracion).
//
// Distancia real vía OSRM (router.project-osrm.org, gratuito, basado en
// OpenStreetMap) -- si el servicio no responde a tiempo o falla, cae
// automáticamente a línea recta (Haversine) × 1.3 como corrección por
// calles no rectas, para que el envío SIEMPRE se pueda calcular aunque el
// servicio externo esté caído.
//
// Pensado para que lo llame esta app u otra (ej. la tienda) vía fetch --
// no requiere sesión porque el cálculo de tarifa no es un dato sensible,
// pero si se llama desde otro origen hay que habilitar CORS ahí.

function distanciaHaversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving'
const FACTOR_CORRECCION_LINEA_RECTA = 1.3

async function distanciaKmReal(origen: { lat: number; lng: number }, destino: { lat: number; lng: number }): Promise<{ km: number; metodo: 'osrm' | 'linea_recta' }> {
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

export async function POST(req: NextRequest) {
  try {
    const { origenLat, origenLng, destinoLat, destinoLng, zonaId } = await req.json()

    for (const [k, v] of Object.entries({ origenLat, origenLng, destinoLat, destinoLng })) {
      if (typeof v !== 'number' || Number.isNaN(v)) {
        return NextResponse.json({ error: `Falta o es inválido el parámetro ${k}` }, { status: 400 })
      }
    }

    const supabase = await createClient()
    let zona = null
    if (zonaId) {
      const { data } = await supabase.from('zonas').select('nombre, tarifa_base, costo_por_km, piso_minimo, techo_maximo').eq('id', zonaId).maybeSingle()
      zona = data
    }
    // Si no viene zona (o no se encontró), usar los valores por defecto de
    // la primera zona activa -- consistente con zona_desde_ciudad() en la
    // base, que hace el mismo fallback para autoasignar pedidos.
    if (!zona) {
      const { data } = await supabase.from('zonas').select('nombre, tarifa_base, costo_por_km, piso_minimo, techo_maximo').eq('activo', true).order('created_at').limit(1).maybeSingle()
      zona = data
    }
    const tarifaBase = Number(zona?.tarifa_base ?? 1.5)
    const costoPorKm = Number(zona?.costo_por_km ?? 0.3)
    const pisoMinimo = Number(zona?.piso_minimo ?? 1.5)
    const techoMaximo = zona?.techo_maximo != null ? Number(zona.techo_maximo) : null

    const { km, metodo } = await distanciaKmReal({ lat: origenLat, lng: origenLng }, { lat: destinoLat, lng: destinoLng })

    let envio = tarifaBase + costoPorKm * km
    envio = Math.max(pisoMinimo, envio)
    if (techoMaximo != null) envio = Math.min(techoMaximo, envio)
    envio = Math.round(envio * 100) / 100

    return NextResponse.json({
      envio,
      distanciaKm: Math.round(km * 100) / 100,
      metodoDistancia: metodo,
      zona: zona?.nombre ?? null,
      desglose: { tarifaBase, costoPorKm, pisoMinimo, techoMaximo },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'No se pudo calcular el envío'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
