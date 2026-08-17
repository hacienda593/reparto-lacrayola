import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calcularEnvio } from '@/lib/envio'
import { rateLimitExcedido, ipDe } from '@/lib/rateLimit'

// La app de tienda manda ol_pedidos.total SIN el costo de envío incluido
// (confirmado con captura real del cliente: un pedido de $6.49 en productos
// mostraba "Total $6.49", sin nada de envío). Mientras eso no se corrija
// en la tienda, este endpoint calcula el envío nosotros mismos y lo guarda
// en ol_pedidos.costo_envio -- desde ahí, "lo que hay que cobrar" pasa a
// ser total + costo_envio en vez de solo total (ver finalizar_entrega_atomica).
//
// Solo calcula UNA vez por pedido (no pisa un valor ya guardado) -- si el
// día de mañana la tienda empieza a mandarlo bien, esto deja de hacer nada.

const TIENDA_LAT = -0.0641
const TIENDA_LNG = -78.9654

export async function POST(req: NextRequest) {
  try {
    if (rateLimitExcedido(`envio-calcular-pedido:${ipDe(req)}`, 30, 60_000)) {
      return NextResponse.json({ error: 'Demasiadas solicitudes, espera un momento' }, { status: 429 })
    }

    const { pedidoId } = await req.json()
    if (!pedidoId || typeof pedidoId !== 'string') {
      return NextResponse.json({ error: 'Falta pedidoId' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: pedido, error: errPedido } = await supabase
      .from('ol_pedidos')
      .select('id, geo_lat, geo_lng, zona_id, costo_envio')
      .eq('id', pedidoId)
      .maybeSingle()
    if (errPedido || !pedido) {
      return NextResponse.json({ error: errPedido?.message ?? 'Pedido no encontrado' }, { status: 404 })
    }
    if (pedido.costo_envio != null) {
      return NextResponse.json({ envio: pedido.costo_envio, yaCalculado: true })
    }
    if (pedido.geo_lat == null || pedido.geo_lng == null) {
      return NextResponse.json({ error: 'El pedido no tiene coordenadas de entrega registradas' }, { status: 422 })
    }

    let zona = null
    if (pedido.zona_id) {
      const { data } = await supabase.from('zonas').select('nombre, tarifa_base, costo_por_km, piso_minimo, techo_maximo, cargo_por_tienda_adicional').eq('id', pedido.zona_id).maybeSingle()
      zona = data
    }
    if (!zona) {
      const { data } = await supabase.from('zonas').select('nombre, tarifa_base, costo_por_km, piso_minimo, techo_maximo, cargo_por_tienda_adicional').eq('activo', true).order('created_at').limit(1).maybeSingle()
      zona = data
    }
    const tarifa = {
      nombre: zona?.nombre ?? null,
      tarifa_base: Number(zona?.tarifa_base ?? 1.5),
      costo_por_km: Number(zona?.costo_por_km ?? 0.3),
      piso_minimo: Number(zona?.piso_minimo ?? 1.5),
      techo_maximo: zona?.techo_maximo != null ? Number(zona.techo_maximo) : null,
    }

    const { envio: envioBase, distanciaKm, metodoDistancia } = await calcularEnvio(
      { lat: TIENDA_LAT, lng: TIENDA_LNG },
      { lat: pedido.geo_lat, lng: pedido.geo_lng },
      tarifa
    )

    // La tienda cobra un cargo adicional cuando el pedido junta productos
    // de más de una tienda -- se detecta contando tiendas distintas en el
    // picking de este pedido (no tenemos el dato real de la tienda, pero
    // sí sabemos cuántas tiendas involucra la compra).
    const { data: tiendasPicking } = await supabase.from('rep_picking').select('tienda_id').eq('pedido_id', pedidoId)
    const cantidadTiendas = new Set((tiendasPicking ?? []).map(t => t.tienda_id).filter(Boolean)).size || 1
    const cargoMultitienda = cantidadTiendas > 1 ? Math.round((cantidadTiendas - 1) * Number(zona?.cargo_por_tienda_adicional ?? 0) * 100) / 100 : 0
    const envio = Math.round((envioBase + cargoMultitienda) * 100) / 100

    // Vía RPC (no update directo a la tabla): consistente con el resto de
    // la app, y la función ya protege contra pisar un valor si dos
    // pestañas/riders disparan el cálculo casi al mismo tiempo.
    const { data: guardado, error: errGuardar } = await supabase.rpc('guardar_costo_envio_pedido', {
      p_pedido_id: pedidoId, p_costo_envio: envio,
    })
    if (errGuardar) {
      return NextResponse.json({ error: errGuardar.message }, { status: 500 })
    }

    return NextResponse.json({ envio: guardado, distanciaKm, metodoDistancia, zona: tarifa.nombre, yaCalculado: false })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'No se pudo calcular el envío'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
