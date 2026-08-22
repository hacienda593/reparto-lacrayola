'use client'
// P1-04 de la auditoría operativa (docs/auditoria_operativa_aplicacion_entregas_2026-08-21.md):
// esta era la función `renderCardRepartidor()` dentro de app/repartidor/page.tsx.
// Se extrae solo la PRESENTACIÓN a un componente propio -- toda la lógica
// de negocio (activarParada, cargar montos, calcular orden/distancia) se
// queda en la pantalla del repartidor, este componente solo recibe los
// valores ya calculados como props. Cero cambio de comportamiento.
import { useRouter } from 'next/navigation'
import { Package, Phone, MapPin, Navigation, DollarSign, CheckCircle, Loader2 } from 'lucide-react'
import { formatWhatsApp } from '@/lib/comunicaciones'
import { minutosEstimados } from '@/lib/geo'

const EST_COLOR: Record<string, string> = {
  asignado: 'bg-indigo-100 text-indigo-700',
  en_ruta:  'bg-orange-100 text-orange-700',
  entregado:'bg-green-100 text-green-700',
  devuelto: 'bg-red-100 text-red-700',
}

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }
function montoACobrar(p: { total: number; costo_envio: number | null }) {
  return Number(p.total ?? 0) + Number(p.costo_envio ?? 0)
}

export interface PedidoAsignadoCard {
  asignacion_id: string
  estado: string
  numero: number
  nombre_cliente: string
  telefono: string
  direccion: string | null
  ciudad: string
  referencias: string | null
  total: number
  costo_envio: number | null
  geo_lat: number | null
  geo_lng: number | null
  notas: string | null
  metodo_pago?: string | null
  pago_confirmado?: boolean | null
}

export interface CardPedidoRepartidorProps {
  p: PedidoAsignadoCard
  isActive: boolean
  ordenParada: number
  distanciaEntreParada: number | undefined
  cobroValor: string | undefined
  onCambiarCobro: (asignacionId: string, valor: string) => void
  repartidorNombre: string | null | undefined
  procesando: string | null
  onActivarParada: (p: PedidoAsignadoCard) => void
}

export default function CardPedidoRepartidor({
  p, isActive, ordenParada, distanciaEntreParada, cobroValor, onCambiarCobro,
  repartidorNombre, procesando, onActivarParada,
}: CardPedidoRepartidorProps) {
  const router = useRouter()
  const numPedido = String(p.numero).padStart(4, '0')

  return (
    <div key={p.asignacion_id} className={`bg-white rounded-3xl border transition-all ${
      isActive
        ? 'border-red-500 shadow-md ring-2 ring-red-500/10'
        : 'border-slate-200/80 shadow-sm opacity-95'
    } overflow-hidden`}>
      {/* Cabecera del pedido */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-extrabold flex items-center justify-center shrink-0">
            {ordenParada}
          </span>
          <Package size={15} className="text-slate-400" />
          <span className="font-bold text-slate-800 text-xs">Pedido #{numPedido}</span>
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${EST_COLOR[p.estado] ?? 'bg-slate-100 text-slate-600'}`}>
            {p.estado === 'en_ruta' ? 'En camino' : 'Asignado'}
          </span>
        </div>
        <span className="font-bold text-green-700 text-xs">{fmt(montoACobrar(p))}</span>
      </div>

      {/* Banner de Pago Destacado */}
      {p.metodo_pago === 'transferencia' && p.pago_confirmado === true && (
        <div className="bg-emerald-500 text-white font-extrabold text-[10px] py-2 text-center shadow-inner">
          💳 PAGADO POR TRANSFERENCIA (Confirmado)
        </div>
      )}
      {p.metodo_pago === 'transferencia' && p.pago_confirmado !== true && (
        <div className="bg-yellow-500 text-slate-900 font-extrabold text-[10px] py-2 text-center shadow-inner animate-pulse">
          ⚠️ TRANSFERENCIA POR CONFIRMAR: {fmt(montoACobrar(p))}
        </div>
      )}
      {(!p.metodo_pago || p.metodo_pago === 'efectivo') && (
        <div className="bg-orange-600 text-white font-extrabold text-[10px] py-2 text-center shadow-inner">
          💵 COBRAR EN EFECTIVO: {fmt(montoACobrar(p))}
        </div>
      )}

      {/* Datos cliente */}
      <div className="px-4 py-3 space-y-2.5">
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-green-700">{p.nombre_cliente?.[0]}</span>
          </div>
          <div>
            <div className="font-bold text-slate-800 text-xs">{p.nombre_cliente}</div>
            <a href={`tel:${p.telefono}`} className="flex items-center gap-1 text-[11px] text-green-600 font-semibold">
              <Phone size={10} /> {p.telefono}
            </a>
          </div>
        </div>

        {p.direccion && (
          <div className="flex items-start gap-2 text-xs text-slate-500">
            <MapPin size={12} className="shrink-0 mt-0.5 text-slate-400" />
            <div>
              <div className="font-medium">{p.direccion}, {p.ciudad}</div>
              {p.referencias && <div className="text-[10px] text-slate-400 mt-0.5">{p.referencias}</div>}
            </div>
          </div>
        )}

        {p.notas && (
          <div className="bg-yellow-50 border border-yellow-100 rounded-lg px-2.5 py-1.5 text-[10px] text-yellow-800">
            📝 {p.notas}
          </div>
        )}
      </div>

      {/* Acciones */}
      <div className="px-4 pb-4 space-y-2">
        {isActive ? (
          /* SI ES LA PARADA ACTIVA: Mostrar todos los controles de cobro, mapa y POD */
          <div className="space-y-3 pt-2 border-t border-slate-100">
            {p.geo_lat && p.geo_lng && (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${p.geo_lat},${p.geo_lng}`}
                target="_blank" rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-extrabold py-2.5 rounded-xl text-xs shadow-sm border border-blue-200"
              >
                <Navigation size={12} /> Navegar con GPS (Google Maps)
              </a>
            )}

            {p.estado === 'en_ruta' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <DollarSign size={14} className="text-slate-400 shrink-0" />
                  <input
                    type="number" step="0.01" min="0"
                    // Antes empezaba vacío y el total solo aparecía como
                    // placeholder de ayuda -- fácil de pasar por alto,
                    // sobre todo el envío (que no se "ve" físicamente
                    // como el precio de los productos). Ahora arranca
                    // con el total real ya puesto; si cobra distinto,
                    // tiene que editarlo a propósito.
                    value={cobroValor ?? montoACobrar(p).toFixed(2)}
                    onChange={e => onCambiarCobro(p.asignacion_id, e.target.value)}
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-green-500"
                  />
                </div>

                {/* Antes había un botón "Confirmar GPS de Entrega" aquí
                    mismo, que corregía ol_pedidos + rep_clientes_direcciones
                    con escrituras sueltas, sin transacción y desconectadas
                    del cierre real de la entrega (P0-03 de la auditoría
                    operativa) -- /entrega/[id] ya tiene su propio paso de
                    confirmar/corregir GPS, ahora atómico con el cierre.
                    Se elimina para no dejar dos caminos que puedan
                    divergir otra vez. */}

                {/* Antes abría un modal propio (foto+firma+cobro) que
                    duplicaba casi entero /entrega/[id] -- con divergencias
                    reales entre las dos copias (P0-02 de la auditoría
                    operativa). Ahora navega a la única pantalla de
                    cierre de entrega, para que cualquier corrección
                    futura aplique sin importar por dónde se entre. */}
                <button
                  onClick={() => router.push(`/entrega/${p.asignacion_id}`)}
                  disabled={procesando !== null}
                  className="w-full flex items-center justify-center gap-1.5 bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-60 text-white font-bold py-3 rounded-xl transition text-xs cursor-pointer shadow-md"
                >
                  <CheckCircle size={14} />
                  Confirmar entrega (Foto y Firma)
                </button>
              </div>
            )}

            {/* Plantillas de WhatsApp */}
            <div className="pt-2.5 border-t border-slate-100 mt-2 space-y-2 text-left">
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">💬 WhatsApp rápido:</div>
              <div className="grid grid-cols-2 gap-1.5">
                <a
                  href={`https://wa.me/${formatWhatsApp(p.telefono)}?text=${encodeURIComponent(
                    "Hola " + p.nombre_cliente + ", te saluda " + (repartidorNombre || "tu Repartidor") + " de La Crayola. Tu pedido #" + p.numero + " va en camino a tu domicilio."
                    + (distanciaEntreParada ? ` Llego en aproximadamente ${minutosEstimados(distanciaEntreParada)} minutos.` : ' Por favor estar atento.')
                  )}`}
                  target="_blank" rel="noopener noreferrer"
                  className="bg-green-50 hover:bg-green-100 border border-green-200 text-green-700 text-[10px] font-bold py-2 rounded-xl text-center flex items-center justify-center gap-1"
                >
                  🛵 En Camino
                </a>
                <a
                  href={`https://wa.me/${formatWhatsApp(p.telefono)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="border border-slate-200 hover:bg-slate-50 text-slate-600 text-[10px] font-bold py-2 rounded-xl text-center flex items-center justify-center gap-1"
                >
                  💬 Chat Directo
                </a>
              </div>
            </div>
          </div>
        ) : (
          /* SI NO ES LA PARADA ACTIVA: Mostrar solo botón de activación Voy para allá */
          <button
            onClick={() => onActivarParada(p)}
            disabled={procesando !== null}
            className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-50 text-white font-extrabold py-3 rounded-xl transition text-xs flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
          >
            {procesando === p.asignacion_id ? <Loader2 size={13} className="animate-spin" /> : <span>🛵 Voy para allá →</span>}
          </button>
        )}
      </div>
    </div>
  )
}
