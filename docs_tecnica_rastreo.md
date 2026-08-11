# 🗺️ Especificación Técnica: Implementación de Seguimiento GPS en Tiempo Real
Este documento contiene la guía de arquitectura y código para implementar el seguimiento del repartidor en tiempo real, conectando la app del motorizado (`reparto-lacrayola`), la base de datos Supabase, y la tienda del cliente (`tienda-lacrayola`).

---

## 🏗️ 1. Base de Datos (PostgreSQL en Supabase)

Para almacenar el "último estado conocido" del repartidor en movimiento y permitir que los clientes lo consulten de manera segura.

### A. Ejecutar esta consulta SQL en el panel SQL de Supabase:
```sql
-- 1. Añadir columnas de GPS a la tabla rep_repartidores
ALTER TABLE rep_repartidores 
ADD COLUMN IF NOT EXISTS gps_lat NUMERIC,
ADD COLUMN IF NOT EXISTS gps_lng NUMERIC,
ADD COLUMN IF NOT EXISTS gps_updated_at TIMESTAMP WITH TIME ZONE;

-- 2. Habilitar Supabase Realtime para capturar actualizaciones en caliente
ALTER PUBLICATION supabase_realtime ADD TABLE rep_repartidores;
```

*(Nota: Asegurarse de que si se utiliza la vista `rep_repartidores_pub` para exponer datos al cliente final, esta vista también incluya y exponga los campos `gps_lat`, `gps_lng` y `gps_updated_at` para evitar fugas de información privada del chofer).*

---

## 🏍️ 2. App de Repartidor (`reparto-lacrayola`)

El repartidor debe transmitir su ubicación GPS únicamente cuando el pedido asignado se encuentra en estado `'en_ruta'` (o `'enviado'` en la tabla de pedidos).

### Implementación en la pantalla de Entrega (`app/entrega/[id]/page.tsx`):
Insertar este efecto `useEffect` en el componente para escuchar los cambios de ubicación del repartidor y enviarlos de forma controlada (máximo cada 10 segundos) a Supabase:

```typescript
import { useEffect } from 'react'

// ... dentro de EntregaPage ...

useEffect(() => {
  // Solo rastrear si el pedido existe, está en estado enviado, y tenemos el id del repartidor
  if (!pedido || pedido.estado !== 'enviado' || !pedido.repartidor_id) return

  let watchId: number | null = null
  let lastSentTime = 0
  const SEND_INTERVAL_MS = 10000 // Intervalo de 10 segundos para cuidar batería y red

  if (typeof window !== 'undefined' && navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        const now = Date.now()

        // Enviar solo si ha transcurrido el intervalo configurado
        if (now - lastSentTime > SEND_INTERVAL_MS) {
          lastSentTime = now

          try {
            await sb.from('rep_repartidores').update({
              gps_lat: latitude,
              gps_lng: longitude,
              gps_updated_at: new Date().toISOString()
            }).eq('id', pedido.repartidor_id)
            
            console.log("📍 Ubicación GPS transmitida:", latitude, longitude)
          } catch (err) {
            console.error("Error al actualizar ubicación en Supabase:", err)
          }
        }
      },
      (error) => {
        console.warn("⚠️ Error capturando GPS en movimiento:", error.message)
      },
      {
        enableHighAccuracy: true, // Utiliza GPS de hardware (no solo antenas)
        timeout: 10000,
        maximumAge: 0 // No utilizar caché
      }
    )
  }

  // Limpiar el watch del GPS cuando el componente se desmonte o cambie de estado
  return () => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      console.log("⏹️ Rastreo de GPS desactivado.")
    }
  }
}, [pedido?.id, pedido?.estado, pedido?.repartidor_id])
```

---

## 📱 3. App del Cliente (`tienda-lacrayola`)

En la página de seguimiento de la orden para el cliente final:

### A. Suscripción a Supabase Realtime:
Cuando el cliente cargue la vista, debe conectarse al WebSocket de Supabase filtrando la tabla por el ID del repartidor asignado:

```typescript
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import dynamic from 'next/dynamic'

// Cargar el componente de mapa dinámicamente para prevenir errores de SSR con Leaflet
const MapaSeguimiento = dynamic(() => import('@/components/MapaSeguimiento'), { ssr: false })

export default function PaginaSeguimientoCliente({ pedidoId }: { pedidoId: string }) {
  const sb = createClient()
  const [pedido, setPedido] = useState<any>(null)
  const [coordenadasRider, setCoordenadasRider] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    // 1. Obtener la ubicación guardada inicialmente
    async function init() {
      const { data: ped } = await sb.from('ol_pedidos').select('*, rep_asignaciones(*)').eq('id', pedidoId).single()
      if (ped) {
        setPedido(ped)
        const asignacion = ped.rep_asignaciones?.[0]
        if (asignacion && asignacion.estado === 'en_ruta') {
          const { data: rider } = await sb
            .from('rep_repartidores_pub')
            .select('gps_lat, gps_lng')
            .eq('id', asignacion.repartidor_id)
            .single()
            
          if (rider?.gps_lat && rider?.gps_lng) {
            setCoordenadasRider({ lat: rider.gps_lat, lng: rider.gps_lng })
          }
        }
      }
    }
    init()
  }, [pedidoId])

  useEffect(() => {
    if (!pedido || !pedido.rep_asignaciones?.[0]) return

    const asignacion = pedido.rep_asignaciones[0]
    if (asignacion.estado !== 'en_ruta') return

    // 2. Escuchar la actualización del GPS en tiempo real
    const canal = sb
      .channel('gps-seguimiento')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rep_repartidores_pub',
          filter: `id=eq.${asignacion.repartidor_id}`
        },
        (payload: any) => {
          const { gps_lat, gps_lng } = payload.new
          if (gps_lat && gps_lng) {
            setCoordenadasRider({ lat: gps_lat, lng: gps_lng })
          }
        }
      )
      .subscribe()

    return () => {
      sb.removeChannel(canal)
    }
  }, [pedido])

  return (
    <div className="w-full">
      {pedido?.rep_asignaciones?.[0]?.estado === 'en_ruta' ? (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-center">¡El repartidor va en camino! 🏍️</h2>
          {coordenadasRider && (
            <MapaSeguimiento 
              riderLat={coordenadasRider.lat} 
              riderLng={coordenadasRider.lng} 
              clienteLat={pedido.geo_lat} 
              clienteLng={pedido.geo_lng} 
            />
          )}
        </div>
      ) : (
        <div className="p-10 text-center text-gray-500">
          Tu pedido está listo o en cola de preparación.
        </div>
      )}
    </div>
  )
}
```

### B. Componente del Mapa del Cliente (`components/MapaSeguimiento.tsx`):
Un mapa sencillo con Leaflet.js que muestra un marcador para el cliente y un marcador animado para la moto:

```typescript
'use client'
import { useEffect, useRef } from 'react'

export default function MapaSeguimiento({
  riderLat,
  riderLng,
  clienteLat,
  clienteLng
}: {
  riderLat: number
  riderLng: number
  clienteLat: number | null
  clienteLng: number | null
}) {
  const mapRef = useRef<any>(null)
  const riderMarkerRef = useRef<any>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return

    let L: any
    let isMounted = true

    async function init() {
      const leaflet = await import('leaflet')
      L = leaflet.default

      if (!isMounted) return

      if (mapRef.current) {
        mapRef.current.remove()
      }

      // Inicializar mapa centrado en el repartidor
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        attributionControl: false
      }).setView([riderLat, riderLng], 15)

      mapRef.current = map

      // Mosaico de mapa gratuito
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
      }).addTo(map)

      // Iconos personalizados
      const motoIcon = L.divIcon({
        className: 'rider-icon',
        html: `<div style="background-color: #00b074; width: 32px; height: 32px; border-radius: 50%; border: 3px solid white; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">🏍️</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      })

      const casaIcon = L.divIcon({
        className: 'home-icon',
        html: `<div style="background-color: #ef4444; width: 28px; height: 28px; border-radius: 50%; border: 2.5px solid white; display: flex; align-items: center; justify-content: center; font-size: 13px; box-shadow: 0 3px 5px rgba(0,0,0,0.25);">🏠</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })

      // Marcador del repartidor
      riderMarkerRef.current = L.marker([riderLat, riderLng], { icon: motoIcon }).addTo(map)

      // Marcador de la casa del cliente
      if (clienteLat && clienteLng) {
        L.marker([clienteLat, clienteLng], { icon: casaIcon }).addTo(map)
        
        // Ajustar el zoom para que se vean ambos marcadores
        const group = new L.LatLngBounds([
          [riderLat, riderLng],
          [clienteLat, clienteLng]
        ])
        map.fitBounds(group, { padding: [50, 50] })
      }
    }

    init()

    return () => {
      isMounted = false
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Mover el marcador de la moto suavemente cuando cambian las coordenadas en tiempo real
  useEffect(() => {
    if (riderMarkerRef.current && mapRef.current) {
      const newPos = new (window as any).L.LatLng(riderLat, riderLng)
      riderMarkerRef.current.setLatLng(newPos)
      
      // Opcional:recentrar el mapa suavemente en la moto si se sale de la pantalla
      if (!mapRef.current.getBounds().contains(newPos)) {
        mapRef.current.panTo(newPos)
      }
    }
  }, [riderLat, riderLng])

  return (
    <div className="relative w-full h-[350px] rounded-3xl overflow-hidden border border-slate-700 shadow-inner">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={mapContainerRef} className="w-full h-full bg-[#0c0f12]" />
    </div>
  )
}
```
