import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import { ArrowLeft, Package, MapPin, User, Phone, Truck, Receipt, DollarSign } from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente de validación',
  confirmado: 'Confirmado (en cola)',
  preparado: 'En picking / caja',
  enviado: 'En ruta',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
}

export default async function PedidoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rolData } = await supabase.from('rep_roles').select('rol, activo').eq('user_id', user.id).single()
  const rol = rolData?.activo ? rolData.rol : null
  const rolesAdmin = ['superadmin', 'admin', 'supervisor', 'contador']
  if (!rol || !rolesAdmin.includes(rol)) redirect('/')

  const { data: pedido } = await supabase.from('ol_pedidos').select('*').eq('id', id).single()
  if (!pedido) notFound()

  const [{ data: items }, { data: asignacion }, { data: comprobantes }] = await Promise.all([
    supabase.from('ol_pedido_items').select('*').eq('pedido_id', id),
    supabase.from('rep_asignaciones').select('*, rep_repartidores(nombre, telefono)').eq('pedido_id', id).order('asignado_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('ol_pedidos_comprobantes_proveedor').select('*').eq('pedido_id', id),
  ])

  const { data: entrega } = asignacion
    ? await supabase.from('rep_entregas').select('*').eq('asignacion_id', asignacion.id).maybeSingle()
    : { data: null }

  const totalItems = (items ?? []).reduce((s, it) => s + (it.cantidad ?? 1), 0)
  const repartidorNombre = (asignacion as any)?.rep_repartidores?.nombre
  const repartidorTelefono = (asignacion as any)?.rep_repartidores?.telefono

  return (
    <div className="flex min-h-screen bg-[#0c0f12] text-white">
      <Sidebar />
      <main className="flex-1 md:pl-56 pt-14 md:pt-0 p-4 md:p-6 space-y-5">

        <Link href="/pedidos" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition">
          <ArrowLeft size={15} /> Volver a Pedidos
        </Link>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white">Pedido #{String(pedido.numero).padStart(4, '0')}</h1>
            <p className="text-sm text-gray-500">{new Date(pedido.created_at).toLocaleString('es-EC')}</p>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-[#00b074]/15 text-[#00b074] border border-[#00b074]/30">
            {ESTADO_LABEL[pedido.estado] ?? pedido.estado}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Cliente */}
          <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-2.5">
            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5"><User size={12} /> Cliente</p>
            <p className="text-white font-semibold text-sm">{pedido.nombre_cliente}</p>
            <p className="text-gray-400 text-xs flex items-center gap-1.5"><Phone size={11} /> {pedido.telefono}</p>
            {pedido.email_cliente && <p className="text-gray-500 text-xs">{pedido.email_cliente}</p>}
          </div>

          {/* Entrega */}
          <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-2.5">
            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5"><MapPin size={12} /> Entrega</p>
            <p className="text-white font-semibold text-sm">{pedido.direccion ?? 'Sin dirección'}</p>
            <p className="text-gray-400 text-xs">{pedido.ciudad}</p>
            {pedido.referencias && <p className="text-gray-500 text-xs italic">{pedido.referencias}</p>}
            {pedido.geo_lat && pedido.geo_lng && (
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${pedido.geo_lat},${pedido.geo_lng}`} target="_blank" rel="noopener noreferrer"
                className="text-[#00b074] text-xs font-semibold hover:underline inline-block">Ver ruta en Google Maps →</a>
            )}
          </div>

          {/* Repartidor/Comprador asignado */}
          <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-2.5">
            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5"><Truck size={12} /> Asignación</p>
            {asignacion ? (
              <>
                <p className="text-white font-semibold text-sm">{repartidorNombre ?? 'Sin nombre'}</p>
                <p className="text-gray-400 text-xs">{repartidorTelefono ?? ''}</p>
                <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400">{asignacion.estado}</span>
              </>
            ) : (
              <p className="text-gray-500 text-xs">Sin asignar todavía</p>
            )}
          </div>
        </div>

        {/* Items */}
        <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#2d3748] flex items-center justify-between">
            <p className="text-gray-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"><Package size={13} /> Productos ({totalItems})</p>
            <span className="text-[#00b074] font-extrabold text-lg">{fmt(pedido.total)}</span>
          </div>
          <div className="divide-y divide-[#2d3748]">
            {(items ?? []).map(it => (
              <div key={it.id} className="px-4 py-3 flex justify-between items-center text-sm">
                <div>
                  <p className="text-white font-medium">{it.descripcion} <span className="text-gray-500">×{it.cantidad}</span></p>
                  <p className="text-gray-600 text-[10px]">{it.categoria}{it.iva_porcentaje != null ? ` · IVA ${it.iva_porcentaje}%` : ''}</p>
                </div>
                <span className="text-white font-semibold">{fmt((it.precio_unitario ?? 0) * (it.cantidad ?? 1))}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Notas */}
        {pedido.notas && (
          <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4">
            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mb-1.5">Notas del pedido</p>
            <p className="text-gray-300 text-xs whitespace-pre-line leading-relaxed">{pedido.notas}</p>
          </div>
        )}

        {/* Comprobantes de proveedor */}
        {comprobantes && comprobantes.length > 0 && (
          <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-3">
            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5"><Receipt size={12} /> Comprobantes de proveedor</p>
            {comprobantes.map((c: any) => (
              <div key={c.id} className="bg-[#0c0f12] border border-[#2d3748] rounded-xl p-3 text-xs space-y-1">
                <div className="flex justify-between"><span className="text-gray-500">Factura</span><span className="text-white font-mono">{c.prov_establecimiento}-{c.prov_punto_emision}-{c.prov_secuencial}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">RUC Proveedor</span><span className="text-white font-mono">{c.prov_ruc}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Monto real</span><span className="text-[#00b074] font-bold">{fmt(c.prov_costo_real)}</span></div>
                {c.prov_factura_url && <a href={c.prov_factura_url} target="_blank" rel="noopener noreferrer" className="text-[#00b074] hover:underline block pt-1">Ver foto del ticket →</a>}
              </div>
            ))}
          </div>
        )}

        {/* Entrega / cobro */}
        {entrega && (
          <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-2">
            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5"><DollarSign size={12} /> Cobro en la entrega</p>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Método</span>
              <span className="text-white font-semibold capitalize">{entrega.metodo_pago}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Monto cobrado</span>
              <span className="text-white font-semibold">{fmt(entrega.monto_cobrado)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Entregado</span>
              <span className="text-white font-semibold">{entrega.entregado_at ? new Date(entrega.entregado_at).toLocaleString('es-EC') : '—'}</span>
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
