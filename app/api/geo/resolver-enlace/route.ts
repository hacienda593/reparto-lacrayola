// Cuando el cliente comparte su ubicación por WhatsApp, WhatsApp a veces
// envía un enlace acortado de Google Maps (maps.app.goo.gl, goo.gl/maps)
// que NO trae la latitud/longitud visible en el propio texto -- hay que
// seguir la redirección para llegar a la URL real donde sí aparecen. Un
// fetch así no se puede hacer desde el navegador (Google no expone la URL
// final a un origen cruzado), así que se resuelve aquí en el servidor.
//
// No requiere sesión: la extracción de coordenadas de una URL pública de
// Google Maps no expone nada sensible ni escribe en la base de datos --
// el guardado real (quién puede escribir geo_lat/geo_lng de un pedido) ya
// está protegido por RLS en /asignaciones, como siempre.

function extraerCoords(texto: string): { lat: number; lng: number } | null {
  const patrones = [
    /[?&](?:q|query|ll)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/,
  ]
  for (const p of patrones) {
    const m = texto.match(p)
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
  }
  return null
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json()
    if (!url || typeof url !== 'string') {
      return Response.json({ error: 'Falta la URL' }, { status: 400 })
    }

    let target: string
    try {
      target = new URL(url.trim()).toString()
    } catch {
      return Response.json({ error: 'No es una URL válida' }, { status: 400 })
    }

    const host = new URL(target).hostname
    const hostsPermitidos = ['maps.app.goo.gl', 'goo.gl', 'maps.google.com', 'www.google.com', 'google.com']
    if (!hostsPermitidos.some(h => host === h || host.endsWith('.' + h))) {
      return Response.json({ error: 'Solo se aceptan enlaces de Google Maps' }, { status: 400 })
    }

    // La URL original a veces ya trae las coordenadas (ej. maps.google.com/?q=...)
    const directo = extraerCoords(target)
    if (directo) return Response.json(directo)

    // Si no, es un enlace acortado: se sigue la redirección hasta la URL final.
    const resp = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(8000) })
    const finalUrl = resp.url
    const coords = extraerCoords(finalUrl) || extraerCoords(await resp.text().catch(() => ''))

    if (!coords) {
      return Response.json({ error: 'No se encontraron coordenadas en ese enlace' }, { status: 422 })
    }
    return Response.json(coords)
  } catch (err) {
    console.error('[resolver-enlace] error:', err)
    return Response.json({ error: 'No se pudo resolver el enlace' }, { status: 500 })
  }
}
