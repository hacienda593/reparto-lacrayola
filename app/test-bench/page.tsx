'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Loader2, DollarSign, ShieldAlert, CheckCircle, UserCheck, Play, RotateCcw, AlertTriangle } from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

interface Repartidor {
  id: string
  nombre: string
  efectivo_en_mano: number
  estado: string
  user_id: string | null
}

export default function RiderTestBench() {
  const { user } = useAuth()
  const [repartidores, setRepartidores] = useState<Repartidor[]>([])
  const [seleccionado, setSeleccionado] = useState<Repartidor | null>(null)
  const [cargando, setCargando] = useState(true)
  const [actualizando, setActualizando] = useState(false)
  
  // Variables de control de simulación
  const [montoCobroSimulado, setMontoCobroSimulado] = useState('25.00')
  const [montoLiquidacionSimulado, setMontoLiquidacionSimulado] = useState('30.00')
  const [logs, setLogs] = useState<string[]>([])

  function addLog(msg: string) {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev])
  }

  async function cargarRiders() {
    setCargando(true)
    try {
      const { data, error } = await supabase
        .from('rep_repartidores')
        .select('id, nombre, efectivo_en_mano, estado, user_id')
        .order('nombre')
      
      if (error) throw error
      setRepartidores(data || [])
      
      // Si ya había seleccionado uno, actualizar su referencia local
      if (seleccionado) {
        const actualizado = data?.find(r => r.id === seleccionado.id)
        if (actualizado) setSeleccionado(actualizado)
      } else if (data && data.length > 0) {
        setSeleccionado(data[0])
      }
      addLog('Lista de repartidores cargada con éxito.')
    } catch (err: any) {
      addLog(`Error cargando repartidores: ${err.message}`)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargarRiders()
  }, [])

  async function actualizarEfectivoDirecto(monto: number) {
    if (!seleccionado) return
    setActualizando(true)
    addLog(`Actualizando efectivo de ${seleccionado.nombre} directamente a ${fmt(monto)}...`)
    
    try {
      const { error } = await supabase
        .from('rep_repartidores')
        .update({ efectivo_en_mano: monto })
        .eq('id', seleccionado.id)

      if (error) throw error
      
      addLog(`✓ Efectivo actualizado directamente. Disparando trigger en Supabase...`)
      await cargarRiders()
    } catch (err: any) {
      addLog(`❌ Error en actualización directa: ${err.message}`)
    } finally {
      setActualizando(false)
    }
  }

  async function simularCobroEfectivo() {
    if (!seleccionado) return
    const monto = parseFloat(montoCobroSimulado)
    if (isNaN(monto) || monto <= 0) {
      alert('Ingresa un monto de cobro válido')
      return
    }

    setActualizando(true)
    addLog(`Simulando cobro de pedido contraentrega por ${fmt(monto)} para ${seleccionado.nombre}...`)
    addLog('Paso A: Creando registro en la tabla `rep_cuentas_cobrar`...')

    try {
      // 1. Crear un pedido ficticio para no romper restricciones si las hay, o usar valores vacíos/UUIDs
      // Primero obtenemos un pedido_id ficticio o creamos una asignacion ficticia.
      // Dado que rep_cuentas_cobrar requiere pedido_id (no nulo) y asignacion_id (opcional),
      // necesitamos un pedido_id real o crear uno de prueba.
      // Vamos a verificar si existen pedidos, o insertamos uno dummy temporalmente.
      
      addLog('Creando pedido dummy temporal para el cobro...')
      const { data: pedidoDummy, error: errPed } = await supabase
        .from('ol_pedidos')
        .insert({
          nombre_cliente: 'Cliente de Prueba COD',
          telefono: '0999999999',
          ciudad: 'Los Bancos',
          direccion: 'Dirección de Sandbox',
          estado: 'entregado',
          total: monto,
          total_items: 1
        })
        .select('id')
        .single()

      if (errPed) throw errPed
      const dummyId = pedidoDummy.id
      addLog(`✓ Pedido dummy creado (ID: ${dummyId}).`)

      addLog('Insertando cobro en `rep_cuentas_cobrar` para disparar trigger_acumular_efectivo...')
      const { error: errCobro } = await supabase
        .from('rep_cuentas_cobrar')
        .insert({
          pedido_id: dummyId,
          repartidor_id: seleccionado.id,
          monto_pedido: monto,
          monto_cobrado: monto,
          metodo_pago: 'efectivo',
          estado: 'cobrado'
        })

      if (errCobro) throw errCobro
      
      addLog(`✓ Cobro registrado. ¡El trigger de Supabase acumuló el efectivo y revaluó bloqueo!`)
      await cargarRiders()
    } catch (err: any) {
      addLog(`❌ Error simulando cobro: ${err.message}`)
    } finally {
      setActualizando(false)
    }
  }

  async function simularLiquidacionRPC() {
    if (!seleccionado) return
    const monto = parseFloat(montoLiquidacionSimulado)
    if (isNaN(monto) || monto <= 0) {
      alert('Ingresa un monto de liquidación válido')
      return
    }

    setActualizando(true)
    addLog(`Simulando liquidación contable en administración de ${fmt(monto)} para ${seleccionado.nombre}...`)
    addLog('Ejecutando procedimiento remoto `conciliar_caja_repartidor` en Supabase...')

    try {
      const mockAdminId = seleccionado.user_id || '00000000-0000-0000-0000-000000000000'
      const { error } = await supabase.rpc('conciliar_caja_repartidor', {
        p_repartidor_id: seleccionado.id,
        p_monto_recibido: monto,
        p_admin_id: mockAdminId,
        p_notas: 'Simulación de conciliación QR desde el Laboratorio de Pruebas'
      })

      if (error) throw error

      addLog(`✓ RPC ejecutado. Se descontó el saldo, se registró en rep_liquidaciones y se evaluó desbloqueo.`)
      await cargarRiders()
    } catch (err: any) {
      addLog(`❌ Error en liquidación RPC: ${err.message}`)
    } finally {
      setActualizando(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-2xl font-black text-red-500">MESA DE PRUEBAS DE CAJA Y BLOQUEOS</h1>
            <p className="text-slate-400 text-xs mt-1">Ecosistema La Crayola - Control de Efectivo y Triggers Automáticos</p>
          </div>
          <a href="/repartidor" className="bg-slate-900 hover:bg-slate-800 text-xs px-3.5 py-1.5 rounded-lg transition font-semibold">
            Volver a la App de Reparto
          </a>
        </div>

        {cargando ? (
          <div className="flex items-center justify-center py-20 bg-slate-900 border border-slate-800 rounded-2xl">
            <Loader2 size={24} className="animate-spin text-red-500 mr-2.5" />
            <span className="text-slate-400 text-xs">Cargando base de datos Supabase...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Panel Izquierdo: Selección de Repartidor */}
            <div className="space-y-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">1. Seleccionar Repartidor</h2>
                
                <div className="space-y-2">
                  <label className="text-[11px] text-slate-500 block">Listado de riders registrados:</label>
                  <select 
                    value={seleccionado?.id || ''} 
                    onChange={e => {
                      const sel = repartidores.find(r => r.id === e.target.value)
                      if (sel) setSeleccionado(sel)
                    }}
                    className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-red-500">
                    {repartidores.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.nombre} (Caja: {fmt(r.efectivo_en_mano)})
                      </option>
                    ))}
                  </select>
                </div>

                {seleccionado && (
                  <div className="border-t border-slate-850 pt-4 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Repartidor activo:</span>
                      <span className="font-bold text-white flex items-center gap-1">
                        <UserCheck size={12} className="text-green-500" /> {seleccionado.nombre}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Saldo actual en mano:</span>
                      <span className="font-black text-white">{fmt(seleccionado.efectivo_en_mano)}</span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Estado operativo:</span>
                      <span className={`font-extrabold px-2 py-0.5 rounded-full text-[9px] ${
                        seleccionado.estado === 'BLOQUEADO' 
                          ? 'bg-red-500/10 text-red-500 border border-red-500/20' 
                          : seleccionado.estado === 'INACTIVO'
                            ? 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                            : 'bg-green-500/10 text-green-500 border border-green-500/20'
                      }`}>
                        {seleccionado.estado}
                      </span>
                    </div>

                    {seleccionado.estado === 'BLOQUEADO' && (
                      <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] p-2.5 rounded-xl flex items-start gap-1.5">
                        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                        <div>
                          <strong>Rider Bloqueado:</strong> Al superar los $40.00 de efectivo retenido, el trigger bloqueó automáticamente este usuario impidiéndole operar.
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Panel Central: Controles de Pruebas */}
            <div className="space-y-4 lg:col-span-2">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Play size={13} className="text-red-500" /> 2. Simular Eventos y Triggers
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  
                  {/* Evento A: Actualización directa */}
                  <div className="bg-slate-950 border border-slate-850 rounded-xl p-3.5 space-y-3">
                    <h3 className="text-xs font-bold text-slate-200">A. Actualización Directa de Caja</h3>
                    <p className="text-[10px] text-slate-500 leading-normal">
                      Establece directamente el saldo de efectivo en la tabla. Comportamiento instantáneo para validar la pantalla de bloqueo roja.
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => actualizarEfectivoDirecto(10.00)}
                        disabled={actualizando || !seleccionado}
                        className="bg-slate-900 hover:bg-slate-800 text-white font-bold py-1.5 px-2 rounded-lg text-[10px] transition active:scale-95 disabled:opacity-40">
                        Nivelar $10.00
                      </button>
                      <button
                        onClick={() => actualizarEfectivoDirecto(39.99)}
                        disabled={actualizando || !seleccionado}
                        className="bg-slate-900 hover:bg-slate-800 text-yellow-500 font-bold py-1.5 px-2 rounded-lg text-[10px] transition active:scale-95 disabled:opacity-40">
                        Límite $39.99
                      </button>
                      <button
                        onClick={() => actualizarEfectivoDirecto(45.00)}
                        disabled={actualizando || !seleccionado}
                        className="bg-red-950/40 hover:bg-red-950/80 text-red-400 font-bold py-1.5 px-2 rounded-lg text-[10px] transition active:scale-95 disabled:opacity-40 border border-red-900/30">
                        Exceder $45.00
                      </button>
                    </div>
                  </div>

                  {/* Evento B: Disparar Trigger por Cobro COD */}
                  <div className="bg-slate-950 border border-slate-850 rounded-xl p-3.5 space-y-3 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <h3 className="text-xs font-bold text-slate-200">B. Simular Cobro de Pedido (COD)</h3>
                      <p className="text-[10px] text-slate-500 leading-normal">
                        Simula la inserción de un cobro en efectivo. El trigger `trigger_acumular_efectivo` acumulará el dinero en el perfil del rider.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-900">
                      <div className="relative flex-1">
                        <DollarSign size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Monto"
                          value={montoCobroSimulado}
                          onChange={e => setMontoCobroSimulado(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-6 pr-2 py-1 text-[11px] text-white focus:outline-none focus:border-red-500"
                        />
                      </div>
                      <button
                        onClick={simularCobroEfectivo}
                        disabled={actualizando || !seleccionado}
                        className="bg-green-600 hover:bg-green-500 active:scale-95 text-white font-bold py-1.5 px-3 rounded-lg text-[10px] transition disabled:opacity-40 font-mono shrink-0">
                        + Cobrar
                      </button>
                    </div>
                  </div>

                  {/* Evento C: Conciliación de Caja (Liquidación) */}
                  <div className="bg-slate-950 border border-slate-850 rounded-xl p-3.5 space-y-3 md:col-span-2">
                    <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1">
                      <CheckCircle size={13} className="text-green-500" /> C. Conciliación y Liquidación en Administración (RPC)
                    </h3>
                    <p className="text-[10px] text-slate-500 leading-normal">
                      Ejecuta el proceso contable contramovimiento `conciliar_caja_repartidor` simulando que el rider entrega el efectivo recolectado en oficinas. Esto descuenta el balance, guarda la auditoría contable en `rep_liquidaciones` y **reactiva el estado a ACTIVO** de forma segura si estaba bloqueado.
                    </p>
                    <div className="flex items-center gap-3 pt-2 border-t border-slate-900">
                      <div className="relative w-36">
                        <DollarSign size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Monto"
                          value={montoLiquidacionSimulado}
                          onChange={e => setMontoLiquidacionSimulado(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-6 pr-2 py-1 text-[11px] text-white focus:outline-none focus:border-green-500"
                        />
                      </div>
                      <button
                        onClick={simularLiquidacionRPC}
                        disabled={actualizando || !seleccionado}
                        className="bg-green-700 hover:bg-green-600 active:scale-95 text-white font-bold py-1.5 px-4 rounded-lg text-[10px] transition disabled:opacity-40 flex items-center gap-1">
                        <RotateCcw size={11} /> Conciliar y Desbloquear
                      </button>
                    </div>
                  </div>

                </div>
              </div>

              {/* Bitácora de Eventos (Logs) */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Bitácora del Servidor Sandbox</h2>
                
                <div className="bg-slate-950 border border-slate-850 rounded-xl p-3 font-mono text-[9px] text-slate-300 h-44 overflow-y-auto space-y-1">
                  {logs.length === 0 ? (
                    <div className="text-slate-500 text-center py-10 italic">Inicia alguna acción arriba para ver los eventos del disparador en tiempo real.</div>
                  ) : (
                    logs.map((log, index) => (
                      <div key={index} className={
                        log.includes('❌') ? 'text-red-400' :
                        log.includes('✓') ? 'text-green-400 font-bold' :
                        log.includes('Actualizando') || log.includes('Simulando') ? 'text-blue-400 font-semibold' : 'text-slate-300'
                      }>
                        {log}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
