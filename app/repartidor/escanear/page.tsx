'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { ArrowLeft, Loader2, CheckCircle2, ShieldAlert, Scan, Smartphone, CreditCard } from 'lucide-react'

export default function EscanearPage() {
  const router = useRouter()
  const { user } = useAuth()
  
  const [pin, setPin] = useState(['', '', '', ''])
  const [repartidor, setRepartidor] = useState<any>(null)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState(false)
  const [pedidoNum, setPedidoNum] = useState('')
  
  // Control de interfaz: 'pin' o 'camara' (simulador)
  const [vista, setVista] = useState<'pin' | 'camara'>('pin')
  const [camaraEscaneando, setCamaraEscaneando] = useState(false)

  useEffect(() => {
    async function loadRep() {
      if (!user) return
      const { data: rep } = await supabase
        .from('rep_repartidores')
        .select('id, nombre')
        .eq('user_id', user.id)
        .single()
      setRepartidor(rep)
    }
    loadRep()
  }, [user])

  function handlePinChange(value: string, index: number) {
    if (value.length > 1) value = value.slice(-1)
    const newPin = [...pin]
    newPin[index] = value.toUpperCase()
    setPin(newPin)

    // Saltar al siguiente input automáticamente
    if (value && index < 3) {
      const nextInput = document.getElementById(`pin-${index + 1}`)
      nextInput?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      const prevInput = document.getElementById(`pin-${index - 1}`)
      prevInput?.focus()
    }
  }

  async function procesarTraspaso(pinCompleto: string) {
    setError('')
    setProcesando(true)

    try {
      // 1. Obtener todas las asignaciones en estado 'recolectado' (compras hechas)
      const { data: recolectados, error: errAsig } = await supabase
        .from('rep_asignaciones')
        .select('*, ol_pedidos(numero, nombre_cliente, total, telefono)')
        .eq('estado', 'recolectado')

      if (errAsig || !recolectados) {
        setError('Error al conectar con la base de datos de repartos.')
        setProcesando(false)
        return
      }

      // 2. Buscar la asignación que coincida con el PIN (últimos 4 caracteres del UUID de la asignación)
      const asigValida = recolectados.find((a: any) => a.id.slice(-4).toUpperCase() === pinCompleto)

      if (!asigValida) {
        setError('Código PIN de traspaso inválido o el pedido ya fue entregado/traspasado.')
        setProcesando(false)
        return
      }

      // 3. Reasignar la asignación al motorizado actual, cambiar estado a 'en_ruta'
      const { error: errUpdateAsig } = await supabase
        .from('rep_asignaciones')
        .update({
          repartidor_id: repartidor.id,
          estado:        'en_ruta',
          updated_at:    new Date().toISOString()
        })
        .eq('id', asigValida.id)

      if (errUpdateAsig) {
        setError('Error al actualizar el repartidor de la entrega.')
        setProcesando(false)
        return
      }

      // 4. Cambiar estado de ol_pedidos a enviado
      await supabase.from('ol_pedidos')
        .update({ estado: 'enviado' })
        .eq('id', asigValida.pedido_id)

      // 5. Crear el registro en rep_entregas (salida)
      await supabase.from('rep_entregas').insert({
        asignacion_id: asigValida.id,
        repartidor_id: repartidor.id,
        pedido_id:     asigValida.pedido_id,
        salida_at:     new Date().toISOString(),
        exitosa:       true,
      })

      setPedidoNum(String(asigValida.ol_pedidos?.numero).padStart(4, '0'))
      setExito(true)
      setProcesando(false)

      // 6. Abrir WhatsApp para avisar al cliente
      const msg = `🛵 *La Crayola - ¡Tu pedido va en camino!* \n\nHola *${asigValida.ol_pedidos?.nombre_cliente}*, tu pedido *#${String(asigValida.ol_pedidos?.numero).padStart(4,'0')}* ya fue comprado y va en camino a cargo del motorizado *${repartidor.nombre}*. 📍 Puedes seguir mi trayecto y contactarme directamente. ¡Llegaré en unos minutos!`
      window.open(`https://wa.me/${asigValida.ol_pedidos?.telefono?.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank')

    } catch {
      setError('Ocurrió un error inesperado al procesar el traspaso.')
      setProcesando(false)
    }
  }

  function submitPin() {
    const pinString = pin.join('').trim()
    if (pinString.length !== 4) {
      setError('Por favor ingresa el PIN de 4 caracteres completo.')
      return
    }
    procesarTraspaso(pinString)
  }

  // Simular escaneo de cámara QR
  function simularEscaneoCamara() {
    setCamaraEscaneando(true)
    setError('')
    setTimeout(async () => {
      // Obtener un pedido recolectado de la BD para simular el escaneo exitoso
      const { data: recolectados } = await supabase
        .from('rep_asignaciones')
        .select('id')
        .eq('estado', 'recolectado')
        .limit(1)

      if (recolectados && recolectados.length > 0) {
        const pinSimulado = recolectados[0].id.slice(-4).toUpperCase()
        setCamaraEscaneando(false)
        setVista('pin')
        // Rellenar pin
        setPin(pinSimulado.split(''))
        procesarTraspaso(pinSimulado)
      } else {
        setCamaraEscaneando(false)
        setError('No se encontraron compras activas listas para recolectar.')
      }
    }, 2500)
  }

  return (
    <div className="min-h-screen bg-[#0c0f12] text-white flex flex-col pb-10">
      {/* Header */}
      <div className="bg-[#181d24] border-b border-[#2d3748] px-4 pt-10 pb-4 flex items-center gap-3 shrink-0">
        <button onClick={() => router.push('/repartidor')} className="p-1.5 hover:bg-white/5 rounded-lg">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="font-extrabold text-sm text-white">Reclamar Pedido (Traspaso)</h1>
          <p className="text-gray-500 text-[10px]">Motorizado &rarr; {repartidor?.nombre ?? 'Rider'}</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto space-y-6 w-full">
        
        {exito ? (
          <div className="bg-[#181d24] border border-[#00b074]/30 rounded-3xl p-6 space-y-4 animate-fade-in w-full">
            <div className="w-14 h-14 bg-[#00b074]/10 rounded-full flex items-center justify-center mx-auto text-[#00b074]">
              <CheckCircle2 size={32} />
            </div>
            <div className="space-y-1">
              <h2 className="text-white font-extrabold text-base">¡Traspaso Exitoso!</h2>
              <p className="text-gray-400 text-xs">
                Has asumido la entrega del pedido #{pedidoNum}.
              </p>
              <p className="text-gray-500 text-[10.5px] pt-1">
                Se abrió WhatsApp para notificar tu salida y ubicación en tiempo real.
              </p>
            </div>
            <button
              onClick={() => router.push('/repartidor')}
              className="w-full bg-[#00b074] hover:bg-[#008f5d] text-white font-bold py-3 rounded-2xl text-xs transition-all shadow-md">
              Ir a mis rutas de entrega
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <h2 className="text-white text-base font-extrabold">Traspaso Virtual de Pedido</h2>
              <p className="text-gray-400 text-xs">
                Asume la entrega del pedido que el Shopper ya compró.
              </p>
            </div>

            {/* Selector de tipo de entrada */}
            <div className="flex bg-[#181d24] p-1 rounded-xl w-full border border-[#2d3748]">
              <button
                onClick={() => { setVista('pin'); setError('') }}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  vista === 'pin' ? 'bg-[#00b074] text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                <Smartphone size={14} /> Digitar PIN
              </button>
              <button
                onClick={() => { setVista('camara'); simularEscaneoCamara() }}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  vista === 'camara' ? 'bg-[#00b074] text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                <Scan size={14} /> Escanear QR
              </button>
            </div>

            {vista === 'pin' ? (
              <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-6 space-y-5 w-full">
                <p className="text-gray-400 text-xs leading-normal">
                  Ingresa el PIN de seguridad de 4 caracteres que se muestra en el celular del Shopper.
                </p>

                {/* OTP PIN inputs */}
                <div className="flex justify-center gap-3">
                  {pin.map((char, index) => (
                    <input
                      key={index}
                      id={`pin-${index}`}
                      type="text"
                      maxLength={1}
                      value={char}
                      onChange={e => handlePinChange(e.target.value, index)}
                      onKeyDown={e => handleKeyDown(e, index)}
                      className="w-12 h-14 bg-[#0c0f12] border border-[#2d3748] text-white font-black text-2xl text-center rounded-xl font-mono focus:outline-none focus:border-[#00b074] shadow-inner transition-colors uppercase"
                      disabled={procesando}
                    />
                  ))}
                </div>

                {error && (
                  <div className="flex items-center justify-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-400 p-2.5 rounded-xl text-xs">
                    <ShieldAlert size={14} className="shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  onClick={submitPin}
                  disabled={procesando}
                  className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-50 text-white font-bold py-3.5 rounded-2xl text-xs transition-all shadow-md flex items-center justify-center gap-2">
                  {procesando ? <Loader2 size={14} className="animate-spin" /> : null}
                  Confirmar y Cargar Pedido
                </button>
              </div>
            ) : (
              <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-6 space-y-4 w-full flex flex-col items-center">
                <div className="relative w-48 h-48 bg-[#0c0f12] border border-[#2d3748] rounded-2xl flex items-center justify-center overflow-hidden">
                  {camaraEscaneando ? (
                    <>
                      <div className="absolute inset-0 bg-green-500/5 animate-pulse" />
                      <div className="absolute left-2 right-2 h-0.5 bg-[#00b074] top-1/2 shadow-lg shadow-[#00b074]"
                        style={{ animation: 'scan 2s ease-in-out infinite' }} />
                      <Scan size={48} className="text-[#00b074]/35 animate-spin" />
                    </>
                  ) : (
                    <Scan size={48} className="text-gray-600" />
                  )}
                </div>

                <div className="text-xs text-gray-400">
                  {camaraEscaneando 
                    ? 'Buscando código QR de compras completadas...' 
                    : 'Alinea la cámara del celular con el código QR del Shopper.'}
                </div>

                {error && (
                  <div className="flex items-center justify-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-400 p-2.5 rounded-xl text-xs w-full">
                    <ShieldAlert size={14} className="shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  onClick={simularEscaneoCamara}
                  disabled={camaraEscaneando}
                  className="w-full bg-[#2d3748] hover:bg-[#3d4d63] disabled:opacity-50 text-white font-bold py-3 rounded-2xl text-xs transition-all shadow-sm">
                  {camaraEscaneando ? 'Escaneando...' : 'Re-intentar Escaneo'}
                </button>
              </div>
            )}

            <p className="text-[10px] text-gray-500 max-w-xs">
              Al confirmar el traspaso virtual, asumes la responsabilidad legal de la custodia física y el cobro contraentrega del pedido.
            </p>
          </>
        )}
      </div>
      
      <style>{`@keyframes scan { 0%,100%{top:8%} 50%{top:82%} }`}</style>
    </div>
  )
}
