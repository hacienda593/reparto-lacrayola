'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import { 
  Wallet, Check, Loader2, ChevronDown, ChevronUp, AlertCircle, 
  FileText, Camera, Upload, CheckCircle, X, Printer, DollarSign, User
} from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

interface LiquidacionVista {
  id:               string | null
  repartidor_id:    string
  nombre:           string
  fecha:            string
  total_asignados:  number
  total_entregados: number
  total_devueltos:  number
  total_cobrado:    number
  total_comision:   number
  total_a_entregar: number
  estado:           string
  efectivo_en_mano: number
}

interface ValeCaja {
  numero: string
  repartidor: string
  monto: number
  fecha: string
  recibidoPor: string
  metodo: string
  referencia?: string
}

export default function LiquidacionesPage() {
  const [fecha,       setFecha]       = useState(new Date().toISOString().split('T')[0])
  const [liquidaciones, setLiquidaciones] = useState<LiquidacionVista[]>([])
  const [cargando,    setCargando]    = useState(true)
  const [procesando,  setProcesando]  = useState<string | null>(null)
  const [expandido,   setExpandido]   = useState<string | null>(null)

  // Estados del Formulario de Liquidación
  const [modalLiquidar, setModalLiquidar] = useState<LiquidacionVista | null>(null)
  const [metodo, setMetodo] = useState<'caja' | 'transferencia'>('caja')
  const [referencia, setReferencia] = useState('')
  const [fotoUrl, setFotoUrl] = useState('')
  const [recibidoPor, setRecibidoPor] = useState('')
  const [subiendoFoto, setSubiendoFoto] = useState(false)

  // Estado para visualización del Vale de Caja Digital
  const [valeVista, setValeVista] = useState<ValeCaja | null>(null)

  async function cargar() {
    setCargando(true)

    // Repartidores activos
    const { data: reps } = await supabase
      .from('rep_repartidores')
      .select('id,nombre,comision_tipo,comision_valor,efectivo_en_mano')
      .eq('activo', true)
      
    if (!reps) { setCargando(false); return }

    // Liquidaciones existentes para esa fecha
    const { data: liqs } = await supabase.from('rep_liquidaciones').select('*').eq('fecha', fecha)
    const liqMap = new Map((liqs ?? []).map(l => [l.repartidor_id, l]))

    // Entregas del día por repartidor
    const { data: entregas } = await supabase
      .from('rep_entregas')
      .select('repartidor_id,monto_cobrado,exitosa,entregado_at')
      .gte('entregado_at', fecha)
      .lt('entregado_at',  fecha + 'T23:59:59')

    // Asignaciones del día
    const { data: asigs } = await supabase
      .from('rep_asignaciones')
      .select('repartidor_id,estado')
      .gte('asignado_at', fecha)
      .lt('asignado_at',  fecha + 'T23:59:59')

    const resultado: LiquidacionVista[] = reps.map(rep => {
      const existente    = liqMap.get(rep.id)
      const misAsigs     = (asigs ?? []).filter(a => a.repartidor_id === rep.id)
      const misEntregas  = (entregas ?? []).filter(e => e.repartidor_id === rep.id && e.exitosa)
      const totalCobrado = misEntregas.reduce((s, e) => s + (e.monto_cobrado ?? 0), 0)
      const comision     = rep.comision_tipo === 'fijo'
        ? misEntregas.length * Number(rep.comision_valor)
        : totalCobrado * (Number(rep.comision_valor) / 100)

      return {
        id:               existente?.id ?? null,
        repartidor_id:    rep.id,
        nombre:           rep.nombre,
        fecha,
        total_asignados:  misAsigs.length,
        total_entregados: misEntregas.length,
        total_devueltos:  misAsigs.filter(a => a.estado === 'devuelto').length,
        total_cobrado:    totalCobrado,
        total_comision:   comision,
        total_a_entregar: totalCobrado - comision,
        estado:           existente?.estado ?? 'pendiente',
        efectivo_en_mano: rep.efectivo_en_mano ?? 0,
      }
    })

    setLiquidaciones(resultado)
    setCargando(false)
  }

  useEffect(() => { cargar() }, [fecha])

  async function subirFotoComprobante(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSubiendoFoto(true)
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `liq-${Date.now()}.${fileExt}`
      const { data, error } = await supabase.storage
        .from('comprobantes-proveedores')
        .upload(fileName, file)

      if (error) throw error

      const { data: { publicUrl } } = supabase.storage
        .from('comprobantes-proveedores')
        .getPublicUrl(fileName)

      setFotoUrl(publicUrl)
    } catch (err: any) {
      alert('Error al subir la imagen: ' + err.message)
    } finally {
      setSubiendoFoto(false)
    }
  }

  function abrirModalLiquidar(liq: LiquidacionVista) {
    setModalLiquidar(liq)
    setMetodo('caja')
    setReferencia('')
    setFotoUrl('')
    setRecibidoPor('')
  }

  async function confirmarLiquidacion() {
    if (!modalLiquidar) return
    if (!recibidoPor.trim()) {
      alert('Por favor ingresa el nombre de la persona que recibe.')
      return
    }
    if (metodo === 'transferencia' && !referencia.trim()) {
      alert('Por favor ingresa el número de referencia bancaria.')
      return
    }

    setProcesando(modalLiquidar.repartidor_id)
    try {
      // Generar correlativo de vale de caja si es efectivo
      const numeroVale = metodo === 'caja' 
        ? `VALE-${Date.now().toString().slice(-6)}` 
        : null

      const payload = {
        repartidor_id:          modalLiquidar.repartidor_id,
        fecha:                  modalLiquidar.fecha,
        total_asignados:        modalLiquidar.total_asignados,
        total_entregados:       modalLiquidar.total_entregados,
        total_devueltos:        modalLiquidar.total_devueltos,
        total_cobrado:          modalLiquidar.total_cobrado,
        total_comision:         modalLiquidar.total_comision,
        total_a_entregar:       modalLiquidar.total_a_entregar,
        estado:                 'liquidado',
        liquidado_at:           new Date().toISOString(),
        updated_at:             new Date().toISOString(),
        metodo_liquidacion:     metodo,
        comprobante_referencia: referencia || null,
        foto_comprobante_url:   fotoUrl || null,
        recibido_por:           recibidoPor,
        numero_vale_caja:       numeroVale
      }

      // 1. Guardar la liquidación en la base de datos
      if (modalLiquidar.id) {
        await supabase.from('rep_liquidaciones').update(payload).eq('id', modalLiquidar.id)
      } else {
        await supabase.from('rep_liquidaciones').insert(payload)
      }

      // 2. Descontar del efectivo_en_mano del repartidor
      const { data: rep } = await supabase
        .from('rep_repartidores')
        .select('efectivo_en_mano')
        .eq('id', modalLiquidar.repartidor_id)
        .single()

      const nuevoSaldo = (rep?.efectivo_en_mano ?? 0) - modalLiquidar.total_a_entregar
      
      await supabase
        .from('rep_repartidores')
        .update({ efectivo_en_mano: nuevoSaldo })
        .eq('id', modalLiquidar.repartidor_id)

      // 3. Si es abono en caja (efectivo), preparar vale para visualización/impresión
      if (metodo === 'caja' && numeroVale) {
        setValeVista({
          numero: numeroVale,
          repartidor: modalLiquidar.nombre,
          monto: modalLiquidar.total_a_entregar,
          fecha: modalLiquidar.fecha,
          recibidoPor: recibidoPor,
          metodo: 'Abono en Efectivo a Oficina'
        })
      } else if (metodo === 'transferencia') {
        alert('✓ Liquidación por transferencia registrada correctamente. El saldo en mano del repartidor ha sido actualizado.')
      }

      setModalLiquidar(null)
      await cargar()
    } catch (err: any) {
      alert('Error al registrar la liquidación: ' + err.message)
    } finally {
      setProcesando(null)
    }
  }

  const totalGeneral = liquidaciones.reduce((s, l) => ({
    cobrado:    s.cobrado    + l.total_cobrado,
    comisiones: s.comisiones + l.total_comision,
    entregar:   s.entregar   + l.total_a_entregar,
    entregas:   s.entregas   + l.total_entregados,
  }), { cobrado: 0, comisiones: 0, entregar: 0, entregas: 0 })

  return (
    <div className="flex min-h-screen bg-[#0c0f12] text-white">
      <Sidebar />
      <main className="flex-1 md:pl-56 pt-14 md:pt-0 p-4 md:p-6 space-y-5">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white">Liquidaciones de Caja Chica</h1>
            <p className="text-sm text-gray-500">Cierre diario y control de efectivo en mano de repartidores</p>
          </div>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            className="border border-[#2d3748] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-green-500 bg-[#181d24] text-white" />
        </div>

        {/* Resumen del día */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total cobrado',    value: fmt(totalGeneral.cobrado),    color: 'text-green-400',  bg: 'bg-green-500/5 border-[#00b074]/20' },
            { label: 'Comisiones',       value: fmt(totalGeneral.comisiones), color: 'text-blue-400',   bg: 'bg-blue-500/5 border-blue-500/20' },
            { label: 'Debe entregar',    value: fmt(totalGeneral.entregar),   color: 'text-orange-400', bg: 'bg-orange-500/5 border-orange-500/20' },
            { label: 'Total entregas',   value: totalGeneral.entregas,        color: 'text-purple-400', bg: 'bg-purple-500/5 border-purple-500/20' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`${bg} rounded-2xl p-4 border`}>
              <div className={`text-xl font-extrabold ${color}`}>{value}</div>
              <div className="text-xs text-gray-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Lista por repartidor */}
        {cargando ? (
          <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-green-500" /></div>
        ) : (
          <div className="space-y-3">
            {liquidaciones.map(liq => {
              const liquidado  = liq.estado === 'liquidado'
              const sinActividad = liq.total_asignados === 0
              return (
                <div key={liq.repartidor_id} className={`bg-[#181d24] rounded-2xl border shadow-sm overflow-hidden ${sinActividad ? 'opacity-60 border-[#2d3748]' : 'border-[#2d3748]'}`}>
                  <div className="flex items-center justify-between px-4 py-3.5 cursor-pointer"
                    onClick={() => setExpandido(expandido === liq.repartidor_id ? null : liq.repartidor_id)}>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-green-950/20 rounded-xl flex items-center justify-center text-lg">🛵</div>
                      <div>
                        <div className="font-bold text-white text-sm">{liq.nombre}</div>
                        <div className="text-xs text-gray-400">
                          {liq.total_entregados} entregados · {liq.total_devueltos} devueltos
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-bold text-orange-400">{fmt(liq.total_a_entregar)}</div>
                        <div className="text-[10px] text-gray-500">Saldo actual en mano: {fmt(liq.efectivo_en_mano)}</div>
                      </div>
                      <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${liquidado ? 'bg-green-500/15 text-green-400 border border-green-500/30' : 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'}`}>
                        {liquidado ? '✓ Liquidado' : 'Pendiente'}
                      </span>
                      {expandido === liq.repartidor_id ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                    </div>
                  </div>

                  {expandido === liq.repartidor_id && (
                    <div className="border-t border-[#2d3748] px-4 py-4 space-y-4">
                      {/* Desglose */}
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="bg-[#0c0f12] rounded-xl p-3 border border-[#2d3748]">
                          <div className="text-lg font-extrabold text-white">{liq.total_asignados}</div>
                          <div className="text-[10px] text-gray-500">Asignados</div>
                        </div>
                        <div className="bg-[#0c0f12] rounded-xl p-3 border border-[#2d3748]">
                          <div className="text-lg font-extrabold text-green-400">{liq.total_entregados}</div>
                          <div className="text-[10px] text-gray-500">Entregados</div>
                        </div>
                        <div className="bg-[#0c0f12] rounded-xl p-3 border border-[#2d3748]">
                          <div className="text-lg font-extrabold text-red-400">{liq.total_devueltos}</div>
                          <div className="text-[10px] text-gray-500">Devueltos</div>
                        </div>
                      </div>

                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between text-gray-400">
                          <span>Total cobrado al cliente (en mano)</span>
                          <span className="font-semibold text-white">{fmt(liq.total_cobrado)}</span>
                        </div>
                        <div className="flex justify-between text-gray-400">
                          <span>Comisión del repartidor</span>
                          <span className="font-semibold text-blue-400">− {fmt(liq.total_comision)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-base border-t border-[#2d3748] pt-2">
                          <span className="text-white">Debe entregar al negocio</span>
                          <span className="text-orange-400">{fmt(liq.total_a_entregar)}</span>
                        </div>
                      </div>

                      {!liquidado && liq.total_entregados > 0 && (
                        <button onClick={() => abrirModalLiquidar(liq)} disabled={procesando === liq.repartidor_id}
                          className="w-full flex items-center justify-center gap-2 bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-60 text-white font-bold py-3 rounded-xl transition text-sm cursor-pointer border-0">
                          {procesando === liq.repartidor_id
                            ? <Loader2 size={15} className="animate-spin" />
                            : <Check size={15} />
                          }
                          Procesar Liquidación
                        </button>
                      )}

                      {sinActividad && (
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <AlertCircle size={13} /> Sin actividad este día
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* MODAL DE PROCESAR LIQUIDACIÓN */}
        {modalLiquidar && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-6 w-full max-w-md space-y-5">
              <div className="flex justify-between items-center border-b border-[#2d3748] pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white">Registrar Liquidación</h3>
                  <p className="text-[10px] text-gray-500">Repartidor: {modalLiquidar.nombre}</p>
                </div>
                <button onClick={() => setModalLiquidar(null)} className="text-gray-500 hover:text-white p-1">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                
                {/* Monto a Liquidar */}
                <div className="bg-[#0c0f12] border border-[#2d3748] rounded-2xl p-4 flex justify-between items-center">
                  <span className="text-gray-400 font-semibold">Monto Neto a Entregar:</span>
                  <span className="text-lg font-black text-orange-400">{fmt(modalLiquidar.total_a_entregar)}</span>
                </div>

                {/* Persona que recibe */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Responsable Receptor (Administrador)</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 text-gray-500" size={14} />
                    <input 
                      type="text"
                      placeholder="Nombre del responsable de caja"
                      value={recibidoPor}
                      onChange={e => setRecibidoPor(e.target.value)}
                      className="w-full bg-[#0c0f12] border border-[#2d3748] rounded-xl pl-9 pr-3 py-2 text-white focus:outline-none focus:border-green-500 text-xs"
                    />
                  </div>
                </div>

                {/* Método de Liquidación */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Método de Entrega</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setMetodo('caja')}
                      className={`py-2 px-3 rounded-xl border text-center font-bold transition ${
                        metodo === 'caja' 
                          ? 'bg-[#00b074]/15 border-[#00b074] text-white' 
                          : 'bg-[#0c0f12] border-[#2d3748] text-gray-400 hover:text-white'
                      }`}>
                      💵 Efectivo en Oficina
                    </button>
                    <button
                      type="button"
                      onClick={() => setMetodo('transferencia')}
                      className={`py-2 px-3 rounded-xl border text-center font-bold transition ${
                        metodo === 'transferencia' 
                          ? 'bg-[#00b074]/15 border-[#00b074] text-white' 
                          : 'bg-[#0c0f12] border-[#2d3748] text-gray-400 hover:text-white'
                      }`}>
                      🏦 Depósito / Transf.
                    </button>
                  </div>
                </div>

                {/* Campos condicionales para transferencia */}
                {metodo === 'transferencia' && (
                  <div className="space-y-3 p-3 bg-[#0c0f12] border border-[#2d3748] rounded-2xl">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Número de Comprobante / Referencia</label>
                      <input 
                        type="text"
                        placeholder="Nro. referencia del depósito"
                        value={referencia}
                        onChange={e => setReferencia(e.target.value)}
                        className="w-full bg-[#181d24] border border-[#2d3748] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-green-500 text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Foto del Comprobante Bancario</label>
                      <div className="flex items-center gap-3">
                        <label className="flex-1 flex items-center justify-center gap-2 bg-[#181d24] border border-[#2d3748] rounded-xl py-2 cursor-pointer hover:bg-gray-800 text-gray-400 hover:text-white transition">
                          <Upload size={14} />
                          <span>Subir Voucher</span>
                          <input 
                            type="file"
                            accept="image/*"
                            onChange={subirFotoComprobante}
                            className="hidden"
                          />
                        </label>
                        {subiendoFoto && <Loader2 size={16} className="animate-spin text-green-500" />}
                      </div>
                      {fotoUrl && (
                        <div className="text-[9.5px] text-green-400 flex items-center gap-1 mt-1">
                          <CheckCircle size={11} /> Archivo cargado con éxito.
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setModalLiquidar(null)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 rounded-2xl text-xs transition cursor-pointer border-0">
                  Cancelar
                </button>
                <button
                  onClick={confirmarLiquidacion}
                  disabled={procesando !== null || subiendoFoto}
                  className="flex-1 bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-50 text-white font-bold py-3 rounded-2xl text-xs transition cursor-pointer border-0">
                  Confirmar Liquidación
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VALE DE CAJA DIGITAL (IMPRESIÓN / VISUALIZACIÓN) */}
        {valeVista && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-6 w-full max-w-sm space-y-6 flex flex-col items-center">
              
              {/* Vale digital imprimible */}
              <div id="printable-receipt" className="w-full bg-white text-slate-900 p-6 rounded-2xl shadow-inner border border-slate-300 font-mono text-[10.5px] space-y-4">
                <div className="text-center border-b border-dashed border-slate-400 pb-3">
                  <div className="text-sm font-black tracking-widest">LA CRAYOLA</div>
                  <div className="text-[9px] text-slate-500">VALE DE CAJA DIGITAL</div>
                  <div className="text-xs font-bold mt-1.5">{valeVista.numero}</div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span>Fecha:</span>
                    <span className="font-bold">{valeVista.fecha}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Entregado Por:</span>
                    <span className="font-bold">{valeVista.repartidor}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Recibido Por:</span>
                    <span className="font-bold">{valeVista.recibidoPor}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Método:</span>
                    <span className="font-bold">{valeVista.metodo}</span>
                  </div>
                </div>

                <div className="border-t border-b border-dashed border-slate-400 py-3 text-center my-3">
                  <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Total Recibido en Efectivo</div>
                  <div className="text-2xl font-black text-slate-900 mt-1">{fmt(valeVista.monto)}</div>
                </div>

                <div className="text-center pt-2 text-[8px] text-slate-400 leading-normal">
                  Este documento digital certifica el recibo formal de efectivo en caja chica. Transacción registrada y validada en el sistema.
                </div>
              </div>

              <div className="flex gap-3 w-full">
                <button
                  onClick={() => {
                    const printContent = document.getElementById('printable-receipt')?.innerHTML;
                    const originalContent = document.body.innerHTML;
                    if (printContent) {
                      const printWindow = window.open('', '_blank');
                      printWindow?.document.write(`
                        <html>
                          <head>
                            <title>Imprimir Vale de Caja</title>
                            <style>
                              body { font-family: monospace; padding: 20px; }
                              #printable-receipt { max-width: 300px; margin: 0 auto; }
                            </style>
                          </head>
                          <body>
                            <div id="printable-receipt">${printContent}</div>
                            <script>window.print(); window.close();</script>
                          </body>
                        </html>
                      `);
                      printWindow?.document.close();
                    }
                  }}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 rounded-2xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer border-0">
                  <Printer size={14} /> Imprimir Vale
                </button>
                
                <button
                  onClick={() => setValeVista(null)}
                  className="flex-1 bg-[#00b074] hover:bg-[#008f5d] text-white font-bold py-3 rounded-2xl text-xs transition cursor-pointer border-0">
                  Finalizar
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
