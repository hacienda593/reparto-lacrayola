'use client'
import { useEffect, useRef } from 'react'

interface Parada {
  asignacion_id: string
  numero: number
  nombre_cliente: string
  direccion: string | null
  total: number
  geo_lat: number | null
  geo_lng: number | null
}

export default function MapaRuta({ 
  paradas, 
  onSelectParada,
  paradaActivaId 
}: { 
  paradas: Parada[]
  onSelectParada: (p: Parada) => void
  paradaActivaId: string | null 
}) {
  const mapRef = useRef<any>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    let isMounted = true
    let L: any = null

    const initMap = async () => {
      const leaflet = await import('leaflet')
      L = leaflet.default

      if (!isMounted || !mapContainerRef.current) return

      if (mapRef.current) {
        mapRef.current.remove()
      }

      // Default center: center of Ecuador (-1.831239, -78.183406) or active/first stop
      let center: [number, number] = [-1.831239, -78.183406]
      const paradasConGeo = paradas.filter(p => p.geo_lat && p.geo_lng)
      
      const activeParada = paradasConGeo.find(p => p.asignacion_id === paradaActivaId)
      if (activeParada && activeParada.geo_lat && activeParada.geo_lng) {
        center = [activeParada.geo_lat, activeParada.geo_lng]
      } else if (paradasConGeo.length > 0 && paradasConGeo[0].geo_lat && paradasConGeo[0].geo_lng) {
        center = [paradasConGeo[0].geo_lat, paradasConGeo[0].geo_lng]
      }

      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        attributionControl: false
      }).setView(center, 14)
      
      mapRef.current = map

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 20
      }).addTo(map)

      // Custom HTML markers using L.divIcon
      const activeIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color: #ef4444; width: 28px; height: 28px; border-radius: 50%; border: 3px solid white; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 11px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3);">★</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })

      const pendingIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color: #00b074; width: 24px; height: 24px; border-radius: 50%; border: 2.5px solid white; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 10px; box-shadow: 0 3px 5px -1px rgba(0,0,0,0.2);">•</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })

      paradasConGeo.forEach(p => {
        if (!p.geo_lat || !p.geo_lng) return
        const isActive = p.asignacion_id === paradaActivaId
        
        const marker = L.marker([p.geo_lat, p.geo_lng], {
          icon: isActive ? activeIcon : pendingIcon
        }).addTo(map)

        const popupHtml = `
          <div style="font-family: system-ui, -apple-system, sans-serif; color: #0f172a; padding: 4px; min-width: 140px; text-align: left;">
            <div style="font-weight: 800; font-size: 12px; margin-bottom: 2px;">Pedido #${String(p.numero).padStart(4, '0')}</div>
            <div style="font-size: 10px; color: #64748b; margin-bottom: 6px;">${p.nombre_cliente}</div>
            <div style="font-size: 11px; font-weight: 700; color: #00b074; margin-bottom: 8px;">Total: $${p.total.toFixed(2)}</div>
            ${isActive 
              ? `<div style="background: #ef4444; color: white; font-size: 9px; font-weight: bold; text-align: center; padding: 4px 8px; border-radius: 6px;">En camino...</div>`
              : `<button 
                  style="background: #00b074; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 9px; font-weight: bold; cursor: pointer; width: 100%;"
                  id="btn-popup-${p.asignacion_id}"
                 >
                   Voy para allá
                 </button>`
            }
          </div>
        `
        marker.bindPopup(popupHtml)

        marker.on('popupopen', () => {
          const btn = document.getElementById(`btn-popup-${p.asignacion_id}`)
          if (btn) {
            btn.onclick = () => {
              onSelectParada(p)
              map.closePopup()
            }
          }
        })
      })
    }

    initMap()

    return () => {
      isMounted = false
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [paradas, paradaActivaId])

  return (
    <div className="relative w-full h-[450px] rounded-3xl overflow-hidden border border-[#2d3748] shadow-inner">
      <link 
        rel="stylesheet" 
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" 
        crossOrigin="" 
      />
      <div ref={mapContainerRef} className="w-full h-full bg-[#0c0f12]" />
    </div>
  )
}
