'use client'
import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Loader2, MapPin, CheckCircle, Package, Phone, Navigation, DollarSign, UserCircle } from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

interface PedidoAsignado {
  asignacion_id:  string
  estado:         string
  pedido_id:      string
  numero:         number
  nombre_cliente: string
  telefono:       string
  direccion:      string | null
  ciudad:         string
  referencias:    string | null
  total:          number
  geo_lat:        number | null
  geo_lng:        number | null
  notas:          string | null
}

const EST_COLOR: Record<string, string> = {
  asignado: 'bg-indigo-100 text-indigo-700',
  en_ruta:  'bg-orange-100 text-orange-700',
  entregado:'bg-green-100 text-green-700',
  devuelto: 'bg-red-100 text-red-700',
}

export default function RepartidorPage() {
  const { user, estado: authEstado } = useAuth()
  const router = useRouter()
  const [pedidos,    setPedidos]    = useState<PedidoAsignado[]>([])
  const [cargando,   setCargando]   = useState(true)
  const [repartidor, setRepartidor] = useState<{ id: string; nombre: string; comision_valor: number } | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)
  const [cobro,      setCobro]      = useState<Record<string, string>>({})

  async function cargar(userId: string) {
    const { data: rep } = await supabase
      .from('rep_repartidores')
      .select('id,nombre,comision_valor')
      .eq('user_id', userId)
      .single()

    if (!rep) { setCargando(false); return }
    setRepartidor(rep)

    const hoy = new Date().toISOString().split('T')[0]
    const { data: asigs } = await supabase
      .from('rep_asignaciones')
      .select('id,estado,pedido_id,ol_pedidos(numero,nombre_cliente,telefono,direccion,ciudad,referencias,total,geo_lat,geo_lng,notas)')
      .eq('repartidor_id', rep.id)
      .in('estado', ['asignado','en_ruta'])
      .gte('asignado_at', hoy)

    setPedidos((asigs ?? []).map((a: any) => ({
      asignacion_id:  a.id,
      estado:         a.estado,
      pedido_id:      a.pedido_id,
      numero:         a.ol_pedidos?.numero,
      nombre_cliente: a.ol_pedidos?.nombre_cliente,
      telefono:       a.ol_pedidos?.telefono,
      direccion:      a.ol_pedidos?.direccion,
      ciudad:         a.ol_pedidos?.ciudad,
      referencias:    a.ol_pedidos?.referencias,
      total:          a.ol_pedidos?.total,
      geo_lat:        a.ol_pedidos?.geo_lat,
      geo_lng:        a.ol_pedidos?.geo_lng,
      notas:          a.ol_pedidos?.notas,
    })))
    setCargando(false)
  }

  useEffect(() => {
    if (authEstado === 'cargando') return
    if (!user) { router.replace('/login'); return }
    cargar(user.id)
  }, [user, authEstado === 'cargando'])

  async function enRuta(asignacionId: string, pedidoId: string) {
    setProcesando(asignacionId)
    const geo = await new Promise<{ lat: number; lng: number } | null>(res => {
      navigator.geolocation?.getCurrentPosition(
        p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => res(null)
      )
    })
    await supabase.from('rep_asignaciones').update({
      estado: 'en_ruta', updated_at: new Date().toISOString()
    }).eq('id', asignacionId)
    await supabase.from('ol_pedidos').update({ estado: 'enviado' }).eq('id', pedidoId)
    if (repartidor) {
      await supabase.from('rep_entregas').insert({
        asignacion_id: asignacionId,
        repartidor_id: repartidor.id,
        pedido_id:     pedidoId,
        salida_at:     new Date().toISOString(),
        geo_lat:       geo?.lat, geo_lng: geo?.lng,
        exitosa:       true,
      })
    }
    await cargar(user!.id)
    setProcesando(null)
  }

  async function entregar(asignacionId: string, pedidoId: string) {
    const monto = parseFloat(cobro[asignacionId] || '0')
    if (!monto) { alert('Ingresa el monto cobrado'); return }
    setProcesando(asignacionId)

    const geo = await new Promise<{ lat: number; lng: number } | null>(res => {
      navigator.geolocation?.getCurrentPosition(
        p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => res(null)
      )
    })

    await supabase.from('rep_asignaciones').update({
      estado: 'entregado', updated_at: new Date().toISOString()
    }).eq('id', asignacionId)

    await supabase.from('ol_pedidos').update({ estado: 'entregado' }).eq('id', pedidoId)

    await supabase.from('rep_entregas').update({
      entregado_at:  new Date().toISOString(),
      monto_cobrado: monto,
      metodo_pago:   'efectivo',
      geo_lat:       geo?.lat,
      geo_lng:       geo?.lng,
    }).eq('asignacion_id', asignacionId)

    // Registrar cuenta por cobrar
    if (repartidor) {
      await supabase.from('rep_cuentas_cobrar').insert({
        pedido_id:     pedidoId,
        asignacion_id: asignacionId,
        repartidor_id: repartidor.id,
        monto_pedido:  pedidos.find(p => p.asignacion_id === asignacionId)?.total ?? 0,
        monto_cobrado: monto,
        metodo_pago:   'efectivo',
        estado:        'cobrado',
        cobrado_at:    new Date().toISOString(),
      })
    }

    await cargar(user!.id)
    setProcesando(null)
  }

  if (authEstado === 'cargando' || cargando) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 size={28} className="animate-spin text-green-600" />
    </div>
  )

  const totalACobrar = pedidos.filter(p => p.estado === 'asignado' || p.estado === 'en_ruta')
    .reduce((s, p) => s + p.total, 0)

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-green-700 text-white px-4 pt-10 pb-4 space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-green-200 text-xs">Hola,</p>
            <h1 className="text-xl font-extrabold">{repartidor?.nombre ?? 'Repartidor'}</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-green-200">A cobrar hoy</div>
              <div className="text-lg font-extrabold">{fmt(totalACobrar)}</div>
            </div>
            <a href="/repartidor/perfil"
              className="w-9 h-9 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center transition">
              <UserCircle size={20} />
            </a>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <div className="bg-white/20 rounded-xl px-3 py-1.5 text-xs font-semibold">
            📦 {pedidos.length} pedidos asignados
          </div>
          <div className="bg-white/20 rounded-xl px-3 py-1.5 text-xs font-semibold">
            💵 Comisión: ${repartidor?.comision_valor ?? 1}/entrega
          </div>
        </div>
      </div>

      {/* Pedidos */}
      <div className="px-4 py-4 space-y-4">
        {pedidos.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <CheckCircle size={48} className="text-green-300 mx-auto" />
            <p className="font-semibold text-slate-600">Sin pedidos pendientes</p>
            <p className="text-sm text-slate-400">Cuando te asignen pedidos aparecerán aquí.</p>
          </div>
        ) : (
          pedidos.map(p => (
            <div key={p.asignacion_id} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              {/* Cabecera del pedido */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Package size={16} className="text-slate-400" />
                  <span className="font-bold text-slate-800">Pedido #{String(p.numero).padStart(4,'0')}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${EST_COLOR[p.estado] ?? 'bg-slate-100 text-slate-600'}`}>
                    {p.estado.replace('_',' ')}
                  </span>
                </div>
                <span className="font-bold text-green-700">{fmt(p.total)}</span>
              </div>

              {/* Datos cliente */}
              <div className="px-4 py-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-green-700">{p.nombre_cliente?.[0]}</span>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800 text-sm">{p.nombre_cliente}</div>
                    <a href={`tel:${p.telefono}`}
                      className="flex items-center gap-1 text-xs text-green-600 font-medium">
                      <Phone size={11} /> {p.telefono}
                    </a>
                  </div>
                </div>

                {p.direccion && (
                  <div className="flex items-start gap-2 text-xs text-slate-500">
                    <MapPin size={13} className="shrink-0 mt-0.5 text-slate-400" />
                    <div>
                      <div>{p.direccion}, {p.ciudad}</div>
                      {p.referencias && <div className="text-slate-400">{p.referencias}</div>}
                    </div>
                  </div>
                )}

                {p.notas && (
                  <div className="bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-2 text-xs text-yellow-800">
                    📝 {p.notas}
                  </div>
                )}

                {/* Botón lista de compras */}
                <a href={`/repartidor/picking/${p.pedido_id}`}
                  className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-3 py-2 rounded-xl text-xs transition">
                  🛒 Ver lista de compras por tienda
                </a>

                {p.geo_lat && p.geo_lng && (
                  <a
                    href={`https://maps.google.com/?q=${p.geo_lat},${p.geo_lng}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-blue-600 font-medium">
                    <Navigation size={12} /> Ver ubicación exacta en Google Maps
                  </a>
                )}
              </div>

              {/* Acciones */}
              <div className="px-4 pb-4 space-y-2">
                {p.estado === 'asignado' && (
                  <button
                    onClick={() => enRuta(p.asignacion_id, p.pedido_id)}
                    disabled={procesando === p.asignacion_id}
                    className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition text-sm">
                    {procesando === p.asignacion_id
                      ? <Loader2 size={16} className="animate-spin" />
                      : <Navigation size={16} />
                    }
                    Salir a entregar
                  </button>
                )}

                {p.estado === 'en_ruta' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <DollarSign size={15} className="text-slate-400 shrink-0" />
                      <input
                        type="number" step="0.01" min="0"
                        placeholder={`Monto a cobrar (total: ${fmt(p.total)})`}
                        value={cobro[p.asignacion_id] ?? ''}
                        onChange={e => setCobro(c => ({ ...c, [p.asignacion_id]: e.target.value }))}
                        className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                      />
                    </div>
                    <button
                      onClick={() => entregar(p.asignacion_id, p.pedido_id)}
                      disabled={procesando === p.asignacion_id}
                      className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition text-sm">
                      {procesando === p.asignacion_id
                        ? <Loader2 size={16} className="animate-spin" />
                        : <CheckCircle size={16} />
                      }
                      Confirmar entrega
                    </button>
                  </div>
                )}

                <a href={`https://wa.me/${p.telefono.replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold py-2.5 rounded-xl transition text-sm">
                  <svg className="w-4 h-4 fill-green-500" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  WhatsApp al cliente
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
