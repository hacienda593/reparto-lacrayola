'use client'
import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Loader2, Check, ArrowLeft, Phone, MapPin, Bike, User } from 'lucide-react'

const VEHICULOS = [
  { key: 'moto', emoji: '🛵', label: 'Moto' },
  { key: 'bici', emoji: '🚲', label: 'Bici' },
  { key: 'auto', emoji: '🚗', label: 'Auto' },
  { key: 'pie',  emoji: '🚶', label: 'A pie' },
]

export default function PerfilRepartidorPage() {
  const { user, repartidorId } = useAuth()
  const router = useRouter()

  const [form,      setForm]      = useState({ telefono: '', vehiculo: 'moto', placa: '', zona_principal: '' })
  const [nombre,    setNombre]    = useState('')
  const [cedula,    setCedula]    = useState('')
  const [cargando,  setCargando]  = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [guardado,  setGuardado]  = useState(false)
  const [error,     setError]     = useState('')

  useEffect(() => {
    if (!repartidorId) return
    supabase.from('rep_repartidores').select('*').eq('id', repartidorId).single()
      .then(({ data }) => {
        if (!data) return
        setNombre(data.nombre)
        setCedula(data.cedula ?? '')
        setForm({
          telefono:       data.telefono       ?? '',
          vehiculo:       data.vehiculo       ?? 'moto',
          placa:          data.placa          ?? '',
          zona_principal: data.zona_principal ?? '',
        })
        setCargando(false)
      })
  }, [repartidorId])

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function guardar() {
    if (!form.telefono.trim()) { setError('El teléfono es obligatorio'); return }
    setGuardando(true); setError('')

    const { error: err } = await supabase.from('rep_repartidores').update({
      telefono:       form.telefono.trim(),
      vehiculo:       form.vehiculo,
      placa:          form.placa.trim() || null,
      zona_principal: form.zona_principal.trim() || null,
      updated_at:     new Date().toISOString(),
    }).eq('id', repartidorId!)

    if (err) { setError(err.message); setGuardando(false); return }
    setGuardado(true)
    setGuardando(false)
    setTimeout(() => setGuardado(false), 2500)
  }

  if (cargando) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 size={24} className="animate-spin text-green-600" />
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-green-700 text-white px-4 pt-10 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => router.back()} className="p-1.5 hover:bg-white/10 rounded-lg transition">
            <ArrowLeft size={18} />
          </button>
          <h1 className="font-extrabold text-lg">Mi perfil</h1>
        </div>
        <p className="text-green-200 text-xs ml-9">Actualiza tus datos de contacto y vehículo</p>
      </div>

      <div className="px-4 py-5 space-y-5">

        {/* Datos fijos (solo lectura) */}
        <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3 shadow-sm">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Datos registrados</p>
          <div className="flex items-center gap-3">
            {user?.user_metadata?.avatar_url
              ? <img src={user.user_metadata.avatar_url} className="w-12 h-12 rounded-xl" alt="" />
              : <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                  <User size={20} className="text-green-700" />
                </div>
            }
            <div>
              <div className="font-bold text-slate-800">{nombre}</div>
              <div className="text-xs text-slate-400">{user?.email}</div>
            </div>
          </div>
          <div className="text-xs text-slate-400 bg-slate-50 rounded-xl px-3 py-2">
            🔒 Nombre y cédula solo pueden ser modificados por el administrador
          </div>
          <div className="flex gap-2 text-sm text-slate-600">
            <span className="text-slate-400 w-16 shrink-0">Cédula</span>
            <span className="font-medium">{cedula || '—'}</span>
          </div>
        </div>

        {/* Datos editables */}
        <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-4 shadow-sm">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Puedes actualizar</p>

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">Teléfono / WhatsApp *</label>
            <div className="relative">
              <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="tel" value={form.telefono} onChange={e => set('telefono', e.target.value)}
                placeholder="0991234567"
                className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-green-500" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">Zona de trabajo</label>
            <div className="relative">
              <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" value={form.zona_principal} onChange={e => set('zona_principal', e.target.value)}
                placeholder="Los Bancos centro"
                className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-green-500" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-2">Vehículo</label>
            <div className="grid grid-cols-4 gap-2">
              {VEHICULOS.map(v => (
                <button key={v.key} type="button" onClick={() => set('vehiculo', v.key)}
                  className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 text-xs font-semibold transition
                    ${form.vehiculo === v.key
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                  <span className="text-2xl">{v.emoji}</span>
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {form.vehiculo !== 'pie' && (
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Placa del vehículo</label>
              <div className="relative">
                <Bike size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={form.placa} onChange={e => set('placa', e.target.value.toUpperCase())}
                  placeholder="ABC-1234"
                  className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-green-500" />
              </div>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>
          )}

          <button onClick={guardar} disabled={guardando || guardado}
            className={`w-full flex items-center justify-center gap-2 font-bold py-3.5 rounded-xl transition text-sm
              ${guardado
                ? 'bg-green-100 text-green-700'
                : 'bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white'}`}>
            {guardando
              ? <><Loader2 size={16} className="animate-spin" /> Guardando...</>
              : guardado
                ? <><Check size={16} /> ¡Datos actualizados!</>
                : <><Check size={16} /> Guardar cambios</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
