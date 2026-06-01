'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { ArrowLeft, Loader2, CheckCircle2, ShieldAlert, Scan, Smartphone } from 'lucide-react'

export default function EscanearPage() {
  const router = useRouter()
  const { user } = useAuth()

  const [pin, setPin] = useState(['', '', '', ''])
  const [repartidor, setRepartidor] = useState<any>(null)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState(false)
  const [pedidoNum, setPedidoNum] = useState('')
  const [vista, setVista] = useState<'pin' | 'camara'>('pin')

  // Camera refs
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<any>(null)
  const scanningRef = useRef(false)
  const [camaraSoportada, setCamaraSoportada] = useState(true)

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

  // Iniciar cámara y BarcodeDetector cuando se selecciona la vista de cámara
  useEffect(() => {
    if (vista === 'camara') {
      iniciarCamara()
    } else {
      detenerCamara()
    }
    return () => { detenerCamara() }
  }, [vista])

  async function iniciarCamara() {
    setError('')

    // Verificar soporte de BarcodeDetector
    if (!('BarcodeDetector' in window)) {
      setCamaraSoportada(false)
      setError('Tu navegador no soporta escaneo QR nativo. Usa el PIN en su lugar.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detectorRef.current = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
      scanningRef.current = true
      escanearLoop()
    } catch {
      setError('No se pudo acceder a la cámara. Verifica los permisos e intenta de nuevo.')
    }
  }

  function detenerCamara() {
    scanningRef.current = false
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  async function escanearLoop() {
    if (!scanningRef.current || !videoRef.current || !detectorRef.current) return

    try {
      const barcodes = await detectorRef.current.detect(videoRef.current)
      if (barcodes.length > 0) {
        const valor = barcodes[0].rawValue as string
        // El QR contiene el UUID de la asignación — extraemos los últimos 4 chars como PIN
        const pinExtraido = valor.slice(-4).toUpperCase()
        scanningRef.current = false
        detenerCamara()
        setVista('pin')
        setPin(pinExtraido.split(''))
        await procesarTraspaso(pinExtraido)
        return
      }
    } catch {
      // BarcodeDetector puede fallar en frames intermedios — ignorar y continuar
    }

    if (scanningRef.current) {
      requestAnimationFrame(escanearLoop)
    }
  }

  function handlePinChange(value: string, index: number) {
    if (value.length > 1) value = value.slice(-1)
    const newPin = [...pin]
    newPin[index] = value.toUpperCase()
    setPin(newPin)
    if (value && index < 3) {
      document.getElementById(`pin-${index + 1}`)?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      document.getElementById(`pin-${index - 1}`)?.focus()
    }
  }

  async function procesarTraspaso(pinCompleto: string) {
    setError('')
    setProcesando(true)

    try {
      const { data: recolectados, error: errAsig } = await supabase
        .from('rep_asignaciones')
        .select('*, ol_pedidos(numero, nombre_cliente, total, telefono)')
        .eq('estado', 'recolectado')

      if (errAsig || !recolectados) {
        setError('Error al conectar con la base de datos de repartos.')
        setProcesando(false)
        return
      }

      const asigValida = recolectados.find((a: any) => a.id.slice(-4).toUpperCase() === pinCompleto)

      if (!asigValida) {
        setError('Código PIN inválido o el pedido ya fue entregado/traspasado.')
        setProcesando(false)
        return
      }

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

      await supabase.from('ol_pedidos')
        .update({ estado: 'enviado' })
        .eq('id', asigValida.pedido_id)

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

      const msg = `🛵 *La Crayola - ¡Tu pedido va en camino!* \n\nHola *${asigValida.ol_pedidos?.nombre_cliente}*, tu pedido *#${String(asigValida.ol_pedidos?.numero).padStart(4,'0')}* ya fue comprado y va en camino a cargo del motorizado *${repartidor.nombre}*. 📍 ¡Llegaré en unos minutos!`
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

  return (
    <div className="min-h-screen bg-[#0c0f12] text-white flex flex-col pb-10">
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
          <div className="bg-[#181d24] border border-[#00b074]/30 rounded-3xl p-6 space-y-4 w-full">
            <div className="w-14 h-14 bg-[#00b074]/10 rounded-full flex items-center justify-center mx-auto text-[#00b074]">
              <CheckCircle2 size={32} />
            </div>
            <div className="space-y-1">
              <h2 className="text-white font-extrabold text-base">¡Traspaso Exitoso!</h2>
              <p className="text-gray-400 text-xs">Has asumido la entrega del pedido #{pedidoNum}.</p>
              <p className="text-gray-500 text-[10.5px] pt-1">
                Se abrió WhatsApp para notificar tu salida al cliente.
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
                onClick={() => setVista('pin')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  vista === 'pin' ? 'bg-[#00b074] text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                <Smartphone size={14} /> Digitar PIN
              </button>
              <button
                onClick={() => setVista('camara')}
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
                  Ingresa el PIN de 4 caracteres que se muestra en el celular del Shopper.
                </p>
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
              <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-4 space-y-4 w-full flex flex-col items-center">
                {camaraSoportada ? (
                  <>
                    <div className="relative w-full aspect-square max-w-xs bg-black rounded-2xl overflow-hidden">
                      <video
                        ref={videoRef}
                        className="w-full h-full object-cover"
                        playsInline
                        muted
                      />
                      {/* Visor de escaneo */}
                      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                        <div className="w-48 h-48 border-2 border-[#00b074] rounded-2xl relative">
                          <span className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-[#00b074] rounded-tl-lg" />
                          <span className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-[#00b074] rounded-tr-lg" />
                          <span className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-[#00b074] rounded-bl-lg" />
                          <span className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-[#00b074] rounded-br-lg" />
                          <div className="absolute left-2 right-2 h-0.5 bg-[#00b074]/70 shadow-lg shadow-[#00b074]"
                            style={{ animation: 'scan 2s ease-in-out infinite', top: '50%' }} />
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">Apunta la cámara al código QR del Shopper</p>
                  </>
                ) : (
                  <div className="py-6 space-y-2">
                    <Scan size={40} className="text-gray-600 mx-auto" />
                    <p className="text-xs text-gray-400 max-w-xs">
                      Escaneo QR no disponible en este dispositivo/navegador. Usa el PIN.
                    </p>
                  </div>
                )}

                {error && (
                  <div className="flex items-center justify-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-400 p-2.5 rounded-xl text-xs w-full">
                    <ShieldAlert size={14} className="shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            )}

            <p className="text-[10px] text-gray-500 max-w-xs">
              Al confirmar el traspaso, asumes la responsabilidad de la custodia y el cobro contraentrega.
            </p>
          </>
        )}
      </div>

      <style>{`@keyframes scan { 0%,100%{top:8%} 50%{top:82%} }`}</style>
    </div>
  )
}
