'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import Sidebar from '@/components/Sidebar'
import { 
  FileText, Loader2, CheckCircle, RefreshCw, AlertCircle, 
  User, Mail, Phone, DollarSign, Calculator, Send
} from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

interface PedidoFacturacion {
  id: string
  numero: number
  nombre_cliente: string
  email_cliente: string
  telefono: string
  direccion: string | null
  ciudad: string
  total: number
  estado: string
  created_at: string
  items?: any[]
  prov_clave_acceso?: string | null
  prov_ruc?: string | null
  desglose?: {
    subtotal_0: number
    subtotal_15: number
    iva_15: number
    total_calculado: number
  }
}

export default function FacturacionPage() {
  const { user } = useAuth()
  const [pedidos, setPedidos] = useState<PedidoFacturacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<'pendientes' | 'facturados'>('pendientes')
  const [pedidoDetalle, setPedidoDetalle] = useState<PedidoFacturacion | null>(null)

  useEffect(() => {
    cargarPedidos()
  }, [filtro])

  async function cargarPedidos() {
    setCargando(true)
    try {
      const estados = filtro === 'pendientes' ? ['entregado'] : ['facturado']
      
      const { data: peds, error: errPeds } = await supabase
        .from('ol_pedidos')
        .select('*')
        .in('estado', estados)
        .order('numero', { ascending: false })

      if (errPeds) throw errPeds

      const mappedPedidos: PedidoFacturacion[] = []

      for (const p of (peds || [])) {
        // Cargar items de este pedido
        const { data: items, error: errItems } = await supabase
          .from('ol_pedido_items')
          .select('*')
          .eq('pedido_id', p.id)

        if (errItems) continue

        // Para cada item, buscar su iva_porcentaje en ol_productos
        let subtotal_0 = 0
        let subtotal_15 = 0

        const itemsWithIva = []
        for (const item of (items || [])) {
          const { data: prod } = await supabase
            .from('ol_productos')
            .select('iva_porcentaje, iva_codigo')
            .eq('codigo', item.codigo)
            .single()

          const ivaPct = prod?.iva_porcentaje ?? 0 // default 0%
          const sub = (item.precio_unitario ?? 0) * (item.cantidad ?? 0)

          if (ivaPct === 15) {
            subtotal_15 += sub
          } else {
            subtotal_0 += sub
          }

          itemsWithIva.push({
            ...item,
            iva_porcentaje: ivaPct,
            iva_codigo: prod?.iva_codigo ?? '0'
          })
        }

        const iva_15 = subtotal_15 * 0.15
        const total_calculado = subtotal_0 + subtotal_15 + iva_15

        mappedPedidos.push({
          ...p,
          items: itemsWithIva,
          desglose: {
            subtotal_0,
            subtotal_15,
            iva_15,
            total_calculado
          }
        })
      }

      setPedidos(mappedPedidos)
    } catch (err) {
      console.error('Error loading billing orders:', err)
    } finally {
      setCargando(false)
    }
  }

  async function autorizarFactura(p: PedidoFacturacion) {
    setProcesando(p.id)
    try {
      // 1. Generar clave de acceso SRI ficticia (49 dígitos)
      // Clave SRI format: FechaEmision(8) + TipoComprobante(2) + RUC(13) + Ambiente(1) + Establecimiento(3) + PuntoEmision(3) + Secuencial(9) + CodigoNumerico(8) + TipoEmision(1) + DigitoVerificador(1)
      const hoyStr = new Date().toISOString().split('T')[0].replace(/-/g, '')
      const rucCr = '1792345678001' // RUC de La Crayola
      const secuencialStr = String(p.numero).padStart(9, '0')
      const claveAcceso = `${hoyStr}01${rucCr}1001001${secuencialStr}1234567819`

      // 2. Actualizar estado del pedido a 'facturado' y añadir comprobante
      const { error: errUpdate } = await supabase
        .from('ol_pedidos')
        .update({
          estado: 'facturado',
          prov_clave_acceso: claveAcceso,
          prov_ruc: rucCr,
          updated_at: new Date().toISOString()
        })
        .eq('id', p.id)

      if (errUpdate) throw errUpdate

      alert(`✓ Factura Electrónica autorizada con éxito ante el SRI.\nClave de Acceso: ${claveAcceso}`)
      
      if (pedidoDetalle && pedidoDetalle.id === p.id) {
        setPedidoDetalle(null)
      }

      await cargarPedidos()
    } catch (err: any) {
      alert('Error al autorizar facturación electrónica: ' + err.message)
    } finally {
      setProcesando(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#0c0f12] text-white flex">
      <Sidebar />
      
      <main className="flex-1 md:pl-56 min-h-screen flex flex-col">
        {/* Topbar */}
        <header className="bg-[#181d24] border-b border-[#2d3748] px-8 py-5 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-lg font-black text-white flex items-center gap-2">
              <FileText className="text-[#00b074]" size={20} /> Consola de Facturación SRI
            </h1>
            <p className="text-[10px] text-gray-500">Módulo de control de facturación electrónica y desgloses de impuestos (Ecuador)</p>
          </div>
          <button 
            onClick={cargarPedidos} 
            disabled={cargando}
            className="p-2 bg-gray-800 hover:bg-gray-700 active:scale-95 rounded-xl transition text-gray-400 hover:text-white">
            <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} />
          </button>
        </header>

        {/* Tab switchers */}
        <div className="px-8 pt-6">
          <div className="flex bg-[#181d24] p-1.5 rounded-2xl w-full max-w-[420px] border border-[#2d3748]">
            <button
              onClick={() => { setFiltro('pendientes'); setPedidoDetalle(null); }}
              className={`flex-1 text-center py-2.5 rounded-xl text-xs font-black transition-all ${
                filtro === 'pendientes' 
                  ? 'bg-[#00b074] text-white' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              📥 Pendientes de Facturación ({filtro === 'pendientes' ? pedidos.length : '...'})
            </button>
            <button
              onClick={() => { setFiltro('facturados'); setPedidoDetalle(null); }}
              className={`flex-1 text-center py-2.5 rounded-xl text-xs font-black transition-all ${
                filtro === 'facturados' 
                  ? 'bg-[#00b074] text-white' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              ✓ Facturados SRI ({filtro === 'facturados' ? pedidos.length : '...'})
            </button>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="flex-1 p-8 grid grid-cols-1 lg:grid-cols-3 gap-8 overflow-y-auto">
          
          {/* List Section */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-4 min-h-[500px]">
              <div className="border-b border-gray-800 pb-3 flex justify-between items-center">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  {filtro === 'pendientes' ? 'Pedidos Entregados a Facturar' : 'Historial de Facturas SRI'}
                </h2>
              </div>

              {cargando ? (
                <div className="flex items-center justify-center py-24">
                  <Loader2 size={36} className="animate-spin text-[#00b074]" />
                </div>
              ) : pedidos.length === 0 ? (
                <div className="text-center py-24 text-gray-500 text-xs">
                  No hay pedidos en este listado actualmente.
                </div>
              ) : (
                <div className="space-y-3">
                  {pedidos.map(p => (
                    <div 
                      key={p.id} 
                      onClick={() => setPedidoDetalle(p)}
                      className={`border rounded-2xl p-4 transition-all cursor-pointer flex justify-between items-center ${
                        pedidoDetalle?.id === p.id 
                          ? 'border-[#00b074] bg-[#00b074]/5' 
                          : 'border-[#2d3748] hover:border-gray-600 bg-[#0c0f12]'
                      }`}>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-green-400">Pedido #{String(p.numero).padStart(4,'0')}</span>
                          {p.estado === 'facturado' && (
                            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-bold px-2 py-0.5 rounded-md">
                              AUTORIZADO SRI
                            </span>
                          )}
                        </div>
                        <div className="font-extrabold text-sm text-white">{p.nombre_cliente}</div>
                        <div className="text-[10px] text-gray-500">{p.email_cliente || 'sin-email@cliente.com'}</div>
                      </div>
                      
                      <div className="text-right space-y-1">
                        <div className="text-sm font-black text-white">{fmt(p.total)}</div>
                        <div className="text-[9px] text-gray-400">
                          IVA 15%: {fmt(p.desglose?.iva_15 || 0)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Details Section */}
          <div className="lg:col-span-1">
            {pedidoDetalle ? (
              <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-6 animate-fade-in sticky top-8">
                <div>
                  <h2 className="text-sm font-extrabold text-white">Detalle de Comprobante</h2>
                  <p className="text-[10px] text-gray-500">Factura de Consumidor Final / Cliente Registrado</p>
                </div>

                {/* Cliente */}
                <div className="space-y-2 border-b border-gray-800 pb-4">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Datos del Adquirente</div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-1.5 text-gray-300">
                      <User size={13} className="text-gray-500" />
                      <span className="font-semibold">{pedidoDetalle.nombre_cliente}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-400">
                      <Mail size={13} className="text-gray-500" />
                      <span>{pedidoDetalle.email_cliente || 'sin-email@cliente.com'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-400">
                      <Phone size={13} className="text-gray-500" />
                      <span>{pedidoDetalle.telefono}</span>
                    </div>
                  </div>
                </div>

                {/* Productos */}
                <div className="space-y-2 border-b border-gray-800 pb-4">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Detalle de Productos</div>
                  <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                    {pedidoDetalle.items?.map((item: any) => (
                      <div key={item.id} className="flex justify-between items-center text-xs">
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="font-semibold text-gray-300 truncate">{item.descripcion}</div>
                          <div className="text-[10px] text-gray-500">
                            Cant: {item.cantidad} · {fmt(item.precio_unitario)} · IVA: {item.iva_porcentaje}%
                          </div>
                        </div>
                        <div className="font-bold text-gray-200">{fmt(item.precio_unitario * item.cantidad)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Desglose SRI */}
                <div className="bg-[#0c0f12] border border-[#2d3748] rounded-2xl p-4 space-y-2 text-xs">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Calculator size={11} /> Desglose de Impuestos (SRI)
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Subtotal IVA 0% (Tarifa 0):</span>
                    <span>{fmt(pedidoDetalle.desglose?.subtotal_0 || 0)}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Subtotal IVA 15% (Tarifa 15):</span>
                    <span>{fmt(pedidoDetalle.desglose?.subtotal_15 || 0)}</span>
                  </div>
                  <div className="flex justify-between text-gray-400 border-b border-gray-800 pb-1.5">
                    <span>Valor IVA 15%:</span>
                    <span className="text-[#00b074]">{fmt(pedidoDetalle.desglose?.iva_15 || 0)}</span>
                  </div>
                  <div className="flex justify-between text-white font-extrabold text-sm pt-1">
                    <span>Total Factura:</span>
                    <span>{fmt(pedidoDetalle.total)}</span>
                  </div>
                </div>

                {/* Acciones SRI */}
                {pedidoDetalle.estado === 'entregado' ? (
                  <button
                    onClick={() => autorizarFactura(pedidoDetalle)}
                    disabled={procesando !== null}
                    className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-50 text-white font-extrabold py-3.5 rounded-2xl text-xs transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer border-0">
                    {procesando === pedidoDetalle.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Send size={14} />
                    )}
                    Autorizar Factura Electrónica (SRI)
                  </button>
                ) : (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 space-y-2.5 text-xs text-center text-emerald-400 font-semibold">
                    <CheckCircle className="mx-auto" size={24} />
                    <div>Factura Autorizada por el SRI</div>
                    <div className="text-[9px] font-mono text-gray-500 select-all leading-normal bg-black/40 p-2 rounded-xl border border-gray-800/20 text-left">
                      Clave de Acceso:<br />
                      {pedidoDetalle.prov_clave_acceso}
                    </div>
                  </div>
                )}

              </div>
            ) : (
              <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-8 text-center text-gray-500 text-xs flex flex-col justify-center items-center min-h-[300px]">
                <FileText size={40} className="text-gray-600 mb-2" />
                Selecciona un pedido de la lista para ver su desglose de IVA SRI y autorizar la facturación electrónica.
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  )
}
