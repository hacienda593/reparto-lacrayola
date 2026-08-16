'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MapPin, Loader2, ChevronDown, Check } from 'lucide-react'

interface Zona {
  id: string; nombre: string; activo: boolean
  tarifa_base: number; costo_por_km: number; piso_minimo: number; techo_maximo: number | null
}

// Panel de administración de zonas/pueblos (superadmin, ver
// migration_zonas_multi_pueblo.sql y migration_tarifas_envio_zona.sql).
// Activar un pueblo aquí lo hace aparecer de inmediato en el selector de
// zona de cada repartidor y en el filtro del pool de pedidos -- sin tocar
// código ni desplegar nada. La tarifa de envío (envio = max(piso_minimo,
// tarifa_base + costo_por_km × distancia_real)) también se edita aquí; la
// calcula app/api/envio/calcular con la distancia real vía OSRM.
export default function ZonasAdmin() {
  const [zonas, setZonas] = useState<Zona[]>([])
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})

  async function cargar() {
    const { data, error } = await supabase.from('zonas')
      .select('id, nombre, activo, tarifa_base, costo_por_km, piso_minimo, techo_maximo').order('nombre')
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

  function abrirTarifa(z: Zona) {
    if (abierta === z.id) { setAbierta(null); return }
    setAbierta(z.id)
    setForm({
      tarifa_base: String(z.tarifa_base),
      costo_por_km: String(z.costo_por_km),
      piso_minimo: String(z.piso_minimo),
      techo_maximo: z.techo_maximo != null ? String(z.techo_maximo) : '',
    })
  }

  async function guardarTarifa(z: Zona) {
    const tarifa_base = parseFloat(form.tarifa_base)
    const costo_por_km = parseFloat(form.costo_por_km)
    const piso_minimo = parseFloat(form.piso_minimo)
    const techo_maximo = form.techo_maximo.trim() ? parseFloat(form.techo_maximo) : null
    if ([tarifa_base, costo_por_km, piso_minimo].some(v => Number.isNaN(v) || v < 0)) {
      setError('Tarifa base, costo/km y piso mínimo deben ser números válidos (0 o mayor)')
      return
    }
    setProcesando(z.id)
    setError('')
    const { error } = await supabase.from('zonas').update({ tarifa_base, costo_por_km, piso_minimo, techo_maximo }).eq('id', z.id)
    if (error) { setError(error.message); setProcesando(null); return }
    await cargar()
    setAbierta(null)
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
        Solo los pueblos activos aparecen para asignar a repartidores y filtran el pool de pedidos. La tarifa de envío se calcula como <code className="text-gray-400">envío = máx(piso mínimo, tarifa base + costo/km × distancia real)</code>, distinta por pueblo.
      </p>

      {error && <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</div>}

      <div className="space-y-2 pt-1">
        {zonas.map(z => (
          <div key={z.id} className="border-b border-[#2d3748]/50 pb-2 last:border-0 last:pb-0">
            <div className="flex items-center justify-between">
              <button onClick={() => abrirTarifa(z)} className="flex items-center gap-1.5 text-sm font-semibold text-left cursor-pointer">
                <span className={z.activo ? 'text-white' : 'text-gray-500'}>{z.nombre}</span>
                <ChevronDown size={13} className={`text-gray-500 transition-transform ${abierta === z.id ? 'rotate-180' : ''}`} />
              </button>
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

            <p className="text-[10px] text-gray-500 mt-0.5">
              Base ${z.tarifa_base.toFixed(2)} + ${z.costo_por_km.toFixed(2)}/km · piso ${z.piso_minimo.toFixed(2)}{z.techo_maximo != null ? ` · techo $${z.techo_maximo.toFixed(2)}` : ''}
            </p>

            {abierta === z.id && (
              <div className="mt-2.5 grid grid-cols-2 gap-2 bg-[#0c0f12] border border-[#2d3748] rounded-xl p-3">
                {[
                  { k: 'tarifa_base', label: 'Tarifa base ($)' },
                  { k: 'costo_por_km', label: 'Costo por km ($)' },
                  { k: 'piso_minimo', label: 'Piso mínimo ($)' },
                  { k: 'techo_maximo', label: 'Techo máx. ($, opcional)' },
                ].map(({ k, label }) => (
                  <div key={k}>
                    <label className="text-[9px] text-gray-500 uppercase font-bold block mb-1">{label}</label>
                    <input
                      type="number" step="0.01" min="0"
                      value={form[k] ?? ''}
                      onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                      className="w-full bg-[#181d24] border border-[#2d3748] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-green-500"
                    />
                  </div>
                ))}
                <button
                  onClick={() => guardarTarifa(z)}
                  disabled={procesando === z.id}
                  className="col-span-2 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold text-xs py-2 rounded-lg cursor-pointer"
                >
                  {procesando === z.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  Guardar tarifa
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
