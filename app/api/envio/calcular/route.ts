import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calcularEnvio } from '@/lib/envio'

// Calcula el costo de envío = max(piso_minimo, tarifa_base + costo_por_km
// × distancia_real), con tarifa configurable por zona (tabla zonas,
// editable en /configuracion). No persiste nada -- solo calcula. Para
// calcular Y guardar en un pedido puntual, ver /api/envio/calcular-pedido.
//
// Pensado para que lo llame esta app u otra (ej. la tienda) vía fetch --
// no requiere sesión porque el cálculo de tarifa no es un dato sensible,
// pero si se llama desde otro origen hay que habilitar CORS ahí.

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
    const tarifa = {
      nombre: zona?.nombre ?? null,
      tarifa_base: Number(zona?.tarifa_base ?? 1.5),
      costo_por_km: Number(zona?.costo_por_km ?? 0.3),
      piso_minimo: Number(zona?.piso_minimo ?? 1.5),
      techo_maximo: zona?.techo_maximo != null ? Number(zona.techo_maximo) : null,
    }

    const { envio, distanciaKm, metodoDistancia } = await calcularEnvio(
      { lat: origenLat, lng: origenLng }, { lat: destinoLat, lng: destinoLng }, tarifa
    )

    return NextResponse.json({
      envio, distanciaKm, metodoDistancia,
      zona: tarifa.nombre,
      desglose: { tarifaBase: tarifa.tarifa_base, costoPorKm: tarifa.costo_por_km, pisoMinimo: tarifa.piso_minimo, techoMaximo: tarifa.techo_maximo },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'No se pudo calcular el envío'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
