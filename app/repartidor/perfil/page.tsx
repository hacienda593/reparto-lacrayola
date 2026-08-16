'use client'
import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Loader2, Check, ArrowLeft, Phone, MapPin, Bike, User, LogOut, PackageCheck, PackageX, Wallet, Upload, X } from 'lucide-react'
import { logout } from '@/actions/auth'

const VEHICULOS = [
  { key: 'moto', emoji: '🛵', label: 'Moto' },
  { key: 'bici', emoji: '🚲', label: 'Bici' },
  { key: 'auto', emoji: '🚗', label: 'Auto' },
  { key: 'pie',  emoji: '🚶', label: 'A pie' },
]

export default function PerfilRepartidorPage() {
  const { user, estado: authEstado, repartidorId } = useAuth()
  const router = useRouter()

  const [form,      setForm]      = useState({ telefono: '', vehiculo: 'moto', placa: '', zona_principal: '' })
  const [nombre,    setNombre]    = useState('')
  const [cedula,    setCedula]    = useState('')
  const [cargando,  setCargando]  = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [guardado,  setGuardado]  = useState(false)
  const [error,     setError]     = useState('')
  const [entregas,  setEntregas]  = useState<any[]>([])

  // Mi Caja: antes solo el admin veía saldo/comisión/depósitos; ahora el
  // repartidor también los ve aquí. El formulario completo para REGISTRAR
  // un depósito/transferencia (con checklist de qué pedidos cubre) vive en
  // la pantalla principal ("Entregar efectivo") -- se centralizó ahí para
  // no duplicar esa lógica en dos lugares distintos.
  const [estadoCuenta, setEstadoCuenta] = useState<any>(null)
  const [depositos,    setDepositos]    = useState<any[]>([])

  async function cargarCaja() {
    const [{ data: estado }, { data: deps }] = await Promise.all([
      supabase.rpc('mi_estado_cuenta'),
      supabase.from('rep_depositos_repartidor').select('*').order('registrado_at', { ascending: false }).limit(10),
    ])
    setEstadoCuenta(Array.isArray(estado) ? estado[0] : estado)
    setDepositos(deps ?? [])
  }

  useEffect(() => {
    if (authEstado === 'cargando') return
    if (!user) { router.replace('/login'); return }
    if (!repartidorId) { router.replace('/'); return }

    supabase.from('rep_repartidores').select('*').eq('id', repartidorId).single()
      .then(({ data }) => {
        if (!data) {
          router.replace('/')
          return
        }
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

    // Historial propio de entregas -- antes no habia forma de ver cuanto
    // habia entregado/cobrado sin pedirselo al admin.
    supabase
      .from('rep_entregas')
      .select('id,pedido_id,entregado_at,monto_cobrado,exitosa,motivo_fallo,ol_pedidos(numero,nombre_cliente)')
      .eq('repartidor_id', repartidorId)
      .order('entregado_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setEntregas(data ?? []))

    cargarCaja()
  }, [user, authEstado, repartidorId])

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

        {/* Mi Caja: saldo, comisión acumulada, y depósito autoiniciado con
            comprobante (el admin solo verifica, no hace todo el trabajo). */}
        <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3 shadow-sm">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Wallet size={13} /> Mi caja
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-orange-50 border border-orange-100 rounded-xl p-3">
              <div className="text-lg font-black text-orange-600">${Number(estadoCuenta?.efectivo_en_mano ?? 0).toFixed(2)}</div>
              <div className="text-[10px] text-slate-500">Efectivo en mano</div>
            </div>
            <div className="bg-green-50 border border-green-100 rounded-xl p-3">
              <div className="text-lg font-black text-green-700">${Number(estadoCuenta?.ganancias ?? 0).toFixed(2)}</div>
              <div className="text-[10px] text-slate-500">Comisión ganada (histórico)</div>
            </div>
          </div>

          {Number(estadoCuenta?.efectivo_en_mano ?? 0) > 0 && (
            <button onClick={() => router.push('/repartidor')}
              className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs transition cursor-pointer">
              <Upload size={13} /> Ir a "Entregar efectivo" para depositar
            </button>
          )}

          {depositos.length > 0 && (
            <div className="pt-2 border-t border-slate-100 space-y-1.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Mis depósitos recientes</p>
              {depositos.map(d => (
                <div key={d.id} className="flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-slate-700">${Number(d.monto).toFixed(2)}</span>
                    <span className="text-slate-400 ml-1.5">{new Date(d.registrado_at).toLocaleDateString('es-EC', { day: '2-digit', month: 'short' })}</span>
                  </div>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                    d.estado === 'confirmado' ? 'bg-green-100 text-green-700' :
                    d.estado === 'rechazado' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {d.estado === 'confirmado' ? 'Confirmado' : d.estado === 'rechazado' ? 'Rechazado' : 'Por verificar'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Historial de mis entregas */}
        <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3 shadow-sm">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Mis últimas entregas</p>
          {entregas.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">Aún no tienes entregas registradas.</p>
          ) : (
            <div className="space-y-2">
              {entregas.map(e => (
                <div key={e.id} className="flex items-center gap-3 border-b border-slate-50 last:border-0 pb-2 last:pb-0">
                  {e.exitosa
                    ? <PackageCheck size={16} className="text-green-600 shrink-0" />
                    : <PackageX size={16} className="text-red-500 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-700">
                      Pedido #{String(e.ol_pedidos?.numero ?? 0).padStart(4,'0')} · {e.ol_pedidos?.nombre_cliente ?? 'Cliente'}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {e.entregado_at ? new Date(e.entregado_at).toLocaleString('es-EC', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'}
                      {!e.exitosa && e.motivo_fallo ? ` · ${e.motivo_fallo}` : ''}
                    </div>
                  </div>
                  {e.exitosa && e.monto_cobrado > 0 && (
                    <span className="text-xs font-bold text-green-700">${Number(e.monto_cobrado).toFixed(2)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <form action={logout}>
          <button type="submit"
            className="w-full flex items-center justify-center gap-2 border border-red-200 text-red-600 hover:bg-red-50 font-bold py-3 rounded-xl transition text-sm cursor-pointer">
            <LogOut size={16} /> Cerrar sesión
          </button>
        </form>
      </div>

    </div>
  )
}
