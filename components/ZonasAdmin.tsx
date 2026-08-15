'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MapPin, Loader2 } from 'lucide-react'

interface Zona { id: string; nombre: string; activo: boolean }

// Panel de administración de zonas/pueblos (superadmin, ver
// migration_zonas_multi_pueblo.sql). Activar un pueblo aquí lo hace
// aparecer de inmediato en el selector de zona de cada repartidor y en el
// filtro del pool de pedidos -- sin tocar código ni desplegar nada.
export default function ZonasAdmin() {
  const [zonas, setZonas] = useState<Zona[]>([])
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function cargar() {
    const { data, error } = await supabase.from('zonas').select('id, nombre, activo').order('nombre')
    if (error) { setError(error.message); setCargando(false); return }
    setZonas((data ?? []) as Zona[])
    setCargando(false)
  }

  useEffect(() => { cargar() }, [])

  async function toggle(z: Zona) {
    setProcesando(z.id)
    setError('')
    const { error } = await supabase.from('zonas').update({ activo: !z.activo }).eq('id', z.id)
    if (error) { setError(error.message); setProcesando(null); return }
    await cargar()
    setProcesando(null)
  }

  if (cargando) {
    return (
      <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 flex items-center justify-center">
        <Loader2 size={18} className="animate-spin text-gray-500" />
      </div>
    )
  }

  return (
    <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-3">
      <p className="text-gray-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
        <MapPin size={13} /> Pueblos / zonas de cobertura
      </p>
      <p className="text-[10px] text-gray-600 leading-relaxed">
        Solo los pueblos activos aparecen para asignar a repartidores y filtran el pool de pedidos. Al lanzar un pueblo nuevo, actívalo aquí y asigna sus repartidores en la pantalla de Repartidores.
      </p>

      {error && <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</div>}

      <div className="space-y-2 pt-1">
        {zonas.map(z => (
          <div key={z.id} className="flex items-center justify-between border-b border-[#2d3748]/50 pb-2 last:border-0 last:pb-0">
            <span className={`text-sm font-semibold ${z.activo ? 'text-white' : 'text-gray-500'}`}>{z.nombre}</span>
            <button
              onClick={() => toggle(z)}
              disabled={procesando === z.id}
              className={`text-[10px] font-bold px-3 py-1.5 rounded-full transition disabled:opacity-50 cursor-pointer ${
                z.activo
                  ? 'bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25'
                  : 'bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700'
              }`}
            >
              {procesando === z.id ? <Loader2 size={11} className="animate-spin" /> : (z.activo ? 'Activo' : 'Inactivo')}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
