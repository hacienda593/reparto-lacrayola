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
  const [pedidosEspera, setPedidosEspera] = useState<any[]>([])
  const [cargando,   setCargando]   = useState(true)
  const [repartidor, setRepartidor] = useState<{ id: string; nombre: string; comision_valor: number; efectivo_en_mano: number; estado: string } | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)
  const [cobro,      setCobro]      = useState<Record<string, string>>({})
  
  // Selector dinámico de Rol: 'repartidor' (Entregas) o 'comprador' (Compras/Picking)
  const [modo, setModo] = useState<'repartidor' | 'comprador'>('repartidor')

  async function cargar(userId: string) {
    try {
      const { data: rep } = await supabase
        .from('rep_repartidores')
        .select('id,nombre,comision_valor,efectivo_en_mano,estado')
        .eq('user_id', userId)
        .single()

      if (!rep) { setCargando(false); return }
      setRepartidor(rep as any)

      const hoy = new Date().toISOString().split('T')[0]
      
      // 1. Cargar asignaciones vigentes del repartidor (incluyendo recolectado)
      const { data: asigs } = await supabase
        .from('rep_asignaciones')
        .select('id,estado,pedido_id,ol_pedidos(numero,nombre_cliente,telefono,direccion,ciudad,referencias,total,geo_lat,geo_lng,notas)')
        .eq('repartidor_id', rep.id)
        .in('estado', ['asignado','recolectado','en_ruta'])
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

      // 2. Cargar pedidos libres en cola (estado 'pendiente')
      const { data: pends } = await supabase
        .from('ol_pedidos')
        .select('id, numero, nombre_cliente, telefono, direccion, ciudad, referencias, total, geo_lat, geo_lng, notas')
        .eq('estado', 'pendiente')
        .order('numero', { ascending: false })

      setPedidosEspera(pends ?? [])
    } catch (err) {
      console.error('Error loading driver data:', err)
    } finally {
      setCargando(false)
    }
  }

  async function aceptarPedido(pedidoId: string, numero: number, nombreCliente: string, telefonoCliente: string) {
    if (!repartidor) return
    setProcesando(pedidoId)
    
    // 1. Crear la asignación en rep_asignaciones
    const { data: asig, error: errAsig } = await supabase
      .from('rep_asignaciones')
      .insert({
        pedido_id:     pedidoId,
        repartidor_id: repartidor.id,
        estado:        'asignado',
        notas:         'Auto-asignado por el Comprador desde el celular',
        prioridad:     1,
      })
      .select('id')
      .single()

    if (errAsig) {
      alert('Error al auto-asignar el pedido: ' + errAsig.message)
      setProcesando(null)
      return
    }

    // 2. Cambiar el estado de ol_pedidos a 'preparado'
    await supabase.from('ol_pedidos').update({ estado: 'preparado' }).eq('id', pedidoId)

    // 3. Recargar datos
    await cargar(user!.id)
    setProcesando(null)

    // 4. Abrir WhatsApp para notificar al cliente automáticamente
    const msg = `🛒 *La Crayola - Compras en curso* \n\n¡Hola *${nombreCliente}*! Soy *${repartidor.nombre}*, tu comprador asignado de La Crayola. He recibido tu pedido *#${String(numero).padStart(4,'0')}* y voy a iniciar tus compras ahora mismo en los supermercados asociados. Te mantendré al tanto de cualquier novedad por este medio. 🧺`
    window.open(`https://wa.me/${(telefonoCliente ?? '').replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  async function autotraspaso(asignacionId: string, pedidoId: string, numero: number, nombreCliente: string, telefonoCliente: string) {
    if (!repartidor) return
    setProcesando(asignacionId)
    
    // 1. Cambiar estado de asignación a en_ruta
    await supabase.from('rep_asignaciones').update({
      estado: 'en_ruta',
      updated_at: new Date().toISOString()
    }).eq('id', asignacionId)

    // 2. Cambiar estado del pedido a enviado
    await supabase.from('ol_pedidos').update({ estado: 'enviado' }).eq('id', pedidoId)

    // 3. Crear registro en rep_entregas (salida en ruta)
    await supabase.from('rep_entregas').insert({
      asignacion_id: asignacionId,
      repartidor_id: repartidor.id,
      pedido_id:     pedidoId,
      salida_at:     new Date().toISOString(),
      exitosa:       true,
    })

    // 4. Cambiar modo de la vista a 'repartidor' (Modo Entregas) y redirigir a entrega
    setModo('repartidor')
    setProcesando(null)
    router.push(`/entrega/${asignacionId}`)

    // 5. Abrir WhatsApp para avisar al cliente
    const msg = `🛵 *La Crayola - ¡Tu pedido va en camino!* \n\nHola *${nombreCliente}*, tu pedido *#${String(numero).padStart(4,'0')}* ya fue comprado y va en camino a cargo de *${repartidor.nombre}*. 📍 Puedes seguir mi trayecto y contactarme directamente. ¡Llegaré en unos minutos!`
    window.open(`https://wa.me/${(telefonoCliente ?? '').replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  useEffect(() => {
    if (authEstado === 'cargando') return
    if (!user) { router.replace('/login'); return }
    cargar(user.id)
  }, [user, authEstado])

  async function enRuta(asignacionId: string, pedidoId: string) {
    setProcesando(asignacionId)
    const geo = await new Promise<{ lat: number; lng: number } | null>(res => {
      if (typeof window === 'undefined' || !navigator?.geolocation) {
        res(null)
        return
      }
      navigator.geolocation.getCurrentPosition(
        p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => res(null),
        { timeout: 5000 }
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
    setProcesando(null)
    router.push(`/entrega/${asignacionId}`)
  }

  async function entregar(asignacionId: string, pedidoId: string) {
    const monto = parseFloat(cobro[asignacionId] || '0')
    if (!monto) { alert('Ingresa el monto cobrado'); return }
    setProcesando(asignacionId)

    const geo = await new Promise<{ lat: number; lng: number } | null>(res => {
      if (typeof window === 'undefined' || !navigator?.geolocation) {
        res(null)
        return
      }
      navigator.geolocation.getCurrentPosition(
        p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => res(null),
        { timeout: 5000 }
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

  if (repartidor && repartidor.estado === 'BLOQUEADO') {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center mb-6 animate-pulse text-red-500">
          <Loader2 size={28} className="animate-spin" />
        </div>
        <h1 className="text-xl font-black text-red-500 mb-2">CUENTA BLOQUEADA</h1>
        <p className="text-slate-400 text-xs max-w-xs mb-6 leading-relaxed">
          Has superado el límite permitido de efectivo en mano (**$40.00**). Por favor, acércate a la oficina central de La Crayola o realiza un depósito para liquidar tu billetera y continuar recibiendo pedidos.
        </p>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 w-full max-w-xs mb-6">
          <div className="text-[10px] text-slate-400 mb-1 uppercase tracking-wider font-semibold">Efectivo en mano actual</div>
          <div className="text-3xl font-black text-white">{fmt(repartidor.efectivo_en_mano)}</div>
        </div>
        <button
          onClick={() => cargar(user!.id)}
          className="bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold px-6 py-3 rounded-xl transition text-xs flex items-center gap-2">
          Verificar liquidación
        </button>
      </div>
    )
  }

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
            {modo === 'repartidor' ? (
              <div className="text-right">
                <div className="text-xs text-green-200">A cobrar hoy</div>
                <div className="text-lg font-extrabold">{fmt(totalACobrar)}</div>
              </div>
            ) : (
              <div className="text-right">
                <div className="text-xs text-green-200">Compras pendientes</div>
                <div className="text-lg font-extrabold">{pedidos.length} pedidos</div>
              </div>
            )}
            <a href="/repartidor/perfil"
              className="w-9 h-9 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center transition">
              <UserCircle size={20} />
            </a>
          </div>
        </div>

        {/* Dynamic Role Switcher (🧺 Compras / 🛵 Entregas) */}
        <div className="flex bg-white/15 p-1 rounded-xl w-full max-w-[280px] mx-auto mt-2">
          <button
            onClick={() => setModo('comprador')}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-extrabold transition-all flex items-center justify-center gap-1 ${
              modo === 'comprador' ? 'bg-white text-green-800 shadow-xs' : 'text-green-150 hover:text-white'
            }`}
          >
            🧺 Modo Compras
          </button>
          <button
            onClick={() => setModo('repartidor')}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-extrabold transition-all flex items-center justify-center gap-1 ${
              modo === 'repartidor' ? 'bg-white text-green-800 shadow-xs' : 'text-green-150 hover:text-white'
            }`}
          >
            🛵 Modo Entregas
          </button>
        </div>

        <div className="flex gap-2.5 pt-2 overflow-x-auto no-scrollbar">
          <div className="bg-white/20 rounded-xl px-3 py-1.5 text-[11px] font-semibold shrink-0">
            📦 {pedidos.length} asignados
          </div>
          {modo === 'repartidor' && (
            <a href="/repartidor/escanear"
              className="bg-yellow-500 hover:bg-yellow-600 text-slate-900 rounded-xl px-3 py-1.5 text-[11px] font-bold shrink-0 flex items-center gap-1 shadow-sm transition-all">
              📷 Recibir Traspaso
            </a>
          )}
          <div className="bg-white/20 rounded-xl px-3 py-1.5 text-[11px] font-semibold shrink-0">
            💵 Comisión: ${repartidor?.comision_valor ?? 1}/v
          </div>
          <div className="bg-white/20 rounded-xl px-3 py-1.5 text-[11px] font-semibold shrink-0 text-yellow-300 border border-yellow-400/25 flex items-center gap-1">
            💰 Caja: {fmt(repartidor?.efectivo_en_mano ?? 0)}
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
                    {(p.estado ?? '').replace('_',' ')}
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

                {/* Vista Compras - Traspaso o Híbrido (si ya está recolectado) */}
                {modo === 'comprador' && p.estado === 'recolectado' && (
                  <div className="pt-3 border-t border-slate-100 mt-2 space-y-2">
                    <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center text-xs text-green-800 font-semibold mb-2">
                      🎉 ¡Compras completadas! Realiza el traspaso al motorizado.
                    </div>
                    <div className="flex gap-2">
                      <a href={`/repartidor/traspaso/${p.asignacion_id}`}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition text-xs shadow-xs text-center">
                        📲 Traspasar por QR
                      </a>
                      <button
                        onClick={() => autotraspaso(p.asignacion_id, p.pedido_id, p.numero, p.nombre_cliente, p.telefono)}
                        disabled={procesando !== null}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl transition text-xs shadow-xs">
                        🛵 Entregar yo mismo
                      </button>
                    </div>
                  </div>
                )}

                {/* Vista Compras (Picking - solo si está en estado asignado) */}
                {modo === 'comprador' && p.estado === 'asignado' && (
                  <div className="pt-2">
                    <a href={`/repartidor/picking/${p.pedido_id}`}
                      className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-3.5 rounded-xl transition text-sm shadow-xs">
                      🛒 Iniciar Compras en Supermercados
                    </a>
                  </div>
                )}

                {/* Vista Entregas (Ruta) */}
                {modo === 'repartidor' && p.geo_lat && p.geo_lng && (
                  <a
                    href={`https://maps.google.com/?q=${p.geo_lat},${p.geo_lng}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-blue-600 font-medium pt-1">
                    <Navigation size={12} /> Ver ubicación exacta en Google Maps
                  </a>
                )}
              </div>

              {/* Acciones */}
              {modo === 'repartidor' && (
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

                  <a href={`https://wa.me/${(p.telefono ?? '').replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold py-2.5 rounded-xl transition text-sm">
                    <svg className="w-4 h-4 fill-green-500" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    WhatsApp al cliente
                  </a>
                </div>
              )}

              {/* Botón de WhatsApp visible siempre en modo Comprador también por si necesita comunicarse */}
              {modo === 'comprador' && (
                <div className="px-4 pb-4">
                  <a href={`https://wa.me/${(p.telefono ?? '').replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold py-2.5 rounded-xl transition text-sm">
                    <svg className="w-4 h-4 fill-green-500" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    WhatsApp al cliente
                  </a>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Bandeja de Pedidos Libres (Auto-Asignación) */}
      {modo === 'comprador' && (
        <div className="mt-6 border-t border-slate-200 pt-4 px-4 pb-20">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            🛒 Pedidos Libres en Espera ({pedidosEspera.length})
          </h2>
          {pedidosEspera.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-2xl p-6 text-center text-slate-400 text-xs">
              No hay pedidos en espera de compras en este momento.
            </div>
          ) : (
            <div className="space-y-3">
              {pedidosEspera.map(p => (
                <div key={p.id} className="bg-white rounded-2xl shadow-xs border border-slate-100 p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="font-extrabold text-xs text-slate-800">Pedido #{String(p.numero).padStart(4,'0')}</span>
                    <span className="font-extrabold text-sm text-green-700">{fmt(p.total)}</span>
                  </div>
                  <div className="text-xs text-slate-600 font-semibold">{p.nombre_cliente}</div>
                  {p.direccion && (
                    <div className="text-[10px] text-slate-400">
                      📍 {p.direccion}, {p.ciudad}
                    </div>
                  )}
                  {p.notas && (
                    <div className="text-[10px] text-yellow-700 bg-yellow-50 px-2 py-1 rounded-md">
                      📝 {p.notas}
                    </div>
                  )}
                  <button
                    onClick={() => aceptarPedido(p.id, p.numero, p.nombre_cliente, p.telefono)}
                    disabled={procesando !== null}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-xs transition-all flex items-center justify-center gap-1 shadow-sm">
                    {procesando === p.id ? <Loader2 size={12} className="animate-spin" /> : 'Aceptar Pedido y Empezar'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
