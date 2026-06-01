'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { ArrowLeft, Loader2, CheckCircle2, ShieldAlert, RefreshCw } from 'lucide-react'
import QrCode from '@/components/QrCode'

export default function TraspasoPage() {
  const { id: asignacionId } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [traspasado, setTraspasado] = useState(false)
  const [nuevoRider, setNuevoRider] = useState('')
  const [asig, setAsig] = useState<any>(null)

  // El PIN de seguridad será el último segmento de 4 caracteres del UUID de la asignación
  const pinSeguridad = asignacionId ? asignacionId.slice(-4).toUpperCase() : '0000'

  async function cargar() {
    setError('')
    try {
      const { data, error: errAsig } = await supabase
        .from('rep_asignaciones')
        .select('*, ol_pedidos(numero, nombre_cliente, total)')
        .eq('id', asignacionId)
        .single()

      if (errAsig || !data) {
        setError('No se pudo encontrar la información del pedido asignado.')
        setCargando(false)
        return
      }

      setAsig(data)

      // Si el estado ya cambió a en_ruta y el repartidor_id es diferente al del shopper actual, se completó el traspaso
      if (data.estado === 'en_ruta') {
        const { data: rep } = await supabase
          .from('rep_repartidores')
          .select('id, nombre')
          .eq('user_id', user!.id)
          .single()
        
        if (rep && data.repartidor_id !== rep.id) {
          // Obtener el nombre del nuevo repartidor
          const { data: nRider } = await supabase
            .from('rep_repartidores')
            .select('nombre')
            .eq('id', data.repartidor_id)
            .single()

          setNuevoRider(nRider?.nombre ?? 'Otro motorizado')
          setTraspasado(true)
        }
      }
      setCargando(false)
    } catch {
      setError('Error de comunicación con Supabase.')
      setCargando(false)
    }
  }

  // Polling en tiempo real o suscripción de Supabase para detectar cuando el motorizado acepta
  useEffect(() => {
    if (!user) return
    cargar()

    // Suscripción real-time
    const canal = supabase
      .channel('rep_asignaciones_traspaso')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rep_asignaciones',
        filter: `id=eq.${asignacionId}`
      }, async (payload: any) => {
        const d = payload.new
        if (d.estado === 'en_ruta') {
          const { data: rep } = await supabase
            .from('rep_repartidores')
            .select('id')
            .eq('user_id', user.id)
            .single()

          if (rep && d.repartidor_id !== rep.id) {
            const { data: nRider } = await supabase
              .from('rep_repartidores')
              .select('nombre')
              .eq('id', d.repartidor_id)
              .single()

            setNuevoRider(nRider?.nombre ?? 'Otro motorizado')
            setTraspasado(true)
          }
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(canal) }
  }, [asignacionId, user])

  if (cargando) return (
    <div className="min-h-screen bg-[#0c0f12] flex items-center justify-center">
      <Loader2 size={28} className="animate-spin text-[#00b074]" />
    </div>
  )

  if (error || !asig) return (
    <div className="min-h-screen bg-[#0c0f12] text-white flex flex-col items-center justify-center p-6 text-center">
      <ShieldAlert size={48} className="text-red-500 mb-4" />
      <h1 className="text-lg font-black text-white">Error de Carga</h1>
      <p className="text-gray-400 text-xs mt-2 max-w-xs">{error || 'Pedido no válido.'}</p>
      <button onClick={() => router.back()} className="mt-6 bg-slate-800 text-xs font-bold px-4 py-2.5 rounded-xl text-white">
        Volver
      </button>
    </div>
  )

  const numPedido = String(asig.ol_pedidos?.numero).padStart(4, '0')

  return (
    <div className="min-h-screen bg-[#0c0f12] text-white flex flex-col pb-10">
      {/* Header */}
      <div className="bg-[#181d24] border-b border-[#2d3748] px-4 pt-10 pb-4 flex items-center gap-3 shrink-0">
        <button onClick={() => router.back()} className="p-1.5 hover:bg-white/5 rounded-lg">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="font-extrabold text-sm text-white">Traspaso de Compra</h1>
          <p className="text-gray-500 text-[10px]">Pedido #{numPedido} · {asig.ol_pedidos?.nombre_cliente}</p>
        </div>
        <button onClick={cargar} className="ml-auto p-1.5 hover:bg-white/5 rounded-lg text-gray-400">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto space-y-6">
        
        {traspasado ? (
          <div className="bg-[#181d24] border border-[#00b074]/30 rounded-3xl p-6 space-y-4 animate-fade-in w-full">
            <div className="w-14 h-14 bg-[#00b074]/10 rounded-full flex items-center justify-center mx-auto text-[#00b074]">
              <CheckCircle2 size={32} />
            </div>
            <div className="space-y-1">
              <h2 className="text-white font-extrabold text-base">¡Traspaso Completado!</h2>
              <p className="text-gray-400 text-xs">
                La entrega del pedido #{numPedido} ha sido asumida por el motorizado:
              </p>
              <p className="text-[#00b074] font-black text-sm pt-1">{nuevoRider}</p>
            </div>
            <button
              onClick={() => router.push('/repartidor')}
              className="w-full bg-[#00b074] hover:bg-[#008f5d] text-white font-bold py-3 rounded-2xl text-xs transition-all shadow-md">
              Volver a mis compras
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <span className="text-[#00b074] text-[10px] font-bold uppercase tracking-wider bg-[#00b074]/10 px-3 py-1 rounded-full">
                Listo para Recogida
              </span>
              <h2 className="text-white text-base font-extrabold">Código de Traspaso Seguro</h2>
              <p className="text-gray-400 text-xs">
                Presenta este código al motorizado para transferirle las compras.
              </p>
            </div>

            {/* Código QR Premium */}
            <div className="bg-white p-4 rounded-3xl shadow-xl shadow-black/40 border border-slate-200/10 flex items-center justify-center">
              <QrCode data={asignacionId} size={192} />
            </div>

            {/* OTP PIN */}
            <div className="w-full bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 space-y-2">
              <p className="text-gray-500 text-[10px] uppercase font-bold tracking-wider">O digita este PIN de Traspaso</p>
              <div className="flex justify-center gap-2">
                {pinSeguridad.split('').map((char, index) => (
                  <span key={index} className="w-12 h-14 bg-[#0c0f12] border border-[#2d3748] text-white font-black text-2xl flex items-center justify-center rounded-xl font-mono shadow-inner shadow-black/50">
                    {char}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 leading-normal pt-1">
                El motorizado puede ingresar este PIN en su celular si tiene inconvenientes con la cámara.
              </p>
            </div>

            <div className="flex items-center gap-1.5 text-gray-500 text-[11px] animate-pulse">
              <div className="w-2 h-2 bg-yellow-500 rounded-full" />
              <span>Esperando que el motorizado escanee o digite el código...</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
