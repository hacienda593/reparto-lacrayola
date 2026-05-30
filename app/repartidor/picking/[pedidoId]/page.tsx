'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft, Check, X, AlertCircle, Camera,
  ShoppingBag, Loader2, ChevronDown, ChevronUp,
  MapPin, RefreshCw,
} from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

interface PickingItem {
  id:              string
  tienda_id:       string | null
  tienda_nombre:   string
  codigo_producto: string | null
  descripcion:     string
  cantidad:        number
  precio_ref:      number | null
  precio_real:     number | null
  estado:          'pendiente' | 'recogido' | 'no_disponible' | 'sustituido'
  sustitucion:     string | null
}

interface GrupoPorTienda {
  tienda_id:    string | null
  tienda_nombre: string
  items:        PickingItem[]
  completado:   boolean
}

const ESTADO_CFG = {
  pendiente:       { label: 'Pendiente',      color: 'text-yellow-700', bg: 'bg-yellow-100', icon: '⏳' },
  recogido:        { label: 'Recogido ✓',     color: 'text-green-700',  bg: 'bg-green-100',  icon: '✅' },
  no_disponible:   { label: 'No disponible',  color: 'text-red-700',    bg: 'bg-red-100',    icon: '❌' },
  sustituido:      { label: 'Sustituido',     color: 'text-blue-700',   bg: 'bg-blue-100',   icon: '🔄' },
}

export default function PickingPage() {
  const { pedidoId } = useParams<{ pedidoId: string }>()
  const router       = useRouter()
  const [grupos,     setGrupos]     = useState<GrupoPorTienda[]>([])
  const [cargando,   setCargando]   = useState(true)
  const [expandido,  setExpandido]  = useState<string | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)
  const [modalSust,  setModalSust]  = useState<string | null>(null) // item id
  const [textoSust,  setTextoSust]  = useState('')
  const [pedido,     setPedido]     = useState<{ numero: number; nombre_cliente: string } | null>(null)

  const cargar = useCallback(async () => {
    const [{ data: ps }, { data: ped }] = await Promise.all([
      supabase.from('rep_picking')
        .select('*, ol_tiendas(nombre)')
        .eq('pedido_id', pedidoId)
        .order('tienda_id'),
      supabase.from('ol_pedidos')
        .select('numero, nombre_cliente')
        .eq('id', pedidoId)
        .single(),
    ])

    if (ped) setPedido(ped)

    const items: PickingItem[] = (ps ?? []).map((p: any) => ({
      id:              p.id,
      tienda_id:       p.tienda_id,
      tienda_nombre:   p.ol_tiendas?.nombre ?? 'Sin tienda',
      codigo_producto: p.codigo_producto,
      descripcion:     p.descripcion,
      cantidad:        p.cantidad,
      precio_ref:      p.precio_ref,
      precio_real:     p.precio_real,
      estado:          p.estado,
      sustitucion:     p.sustitucion,
    }))

    // Agrupar por tienda
    const mapa = new Map<string, PickingItem[]>()
    items.forEach(i => {
      const key = i.tienda_id ?? 'sin_tienda'
      if (!mapa.has(key)) mapa.set(key, [])
      mapa.get(key)!.push(i)
    })

    const grupos: GrupoPorTienda[] = Array.from(mapa.entries()).map(([key, items]) => ({
      tienda_id:    key === 'sin_tienda' ? null : key,
      tienda_nombre: items[0].tienda_nombre,
      items,
      completado:   items.every(i => i.estado !== 'pendiente'),
    }))

    setGrupos(grupos)
    if (grupos.length > 0 && !expandido) setExpandido(grupos[0].tienda_id ?? 'sin_tienda')
    setCargando(false)
  }, [pedidoId])

  useEffect(() => { cargar() }, [cargar])

  async function marcarEstado(itemId: string, estado: PickingItem['estado'], sustitucion?: string) {
    setProcesando(itemId)
    await supabase.from('rep_picking').update({
      estado,
      sustitucion: sustitucion ?? null,
    }).eq('id', itemId)
    setModalSust(null)
    setTextoSust('')
    await cargar()
    setProcesando(null)
  }

  const totalItems    = grupos.reduce((s, g) => s + g.items.length, 0)
  const recogidos     = grupos.reduce((s, g) => s + g.items.filter(i => i.estado === 'recogido' || i.estado === 'sustituido').length, 0)
  const porcentaje    = totalItems > 0 ? Math.round((recogidos / totalItems) * 100) : 0
  const todosListos   = totalItems > 0 && recogidos + grupos.reduce((s, g) => s + g.items.filter(i => i.estado === 'no_disponible').length, 0) === totalItems

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-green-700 text-white px-4 pt-10 pb-4 space-y-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1.5 hover:bg-white/10 rounded-lg transition">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="font-extrabold text-lg">Lista de compras</h1>
            {pedido && (
              <p className="text-green-200 text-xs">
                Pedido #{String(pedido.numero).padStart(4,'0')} · {pedido.nombre_cliente}
              </p>
            )}
          </div>
          <button onClick={cargar} className="ml-auto p-1.5 hover:bg-white/10 rounded-lg transition">
            <RefreshCw size={16} />
          </button>
        </div>

        {/* Progreso */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-green-200">{recogidos} de {totalItems} productos</span>
            <span className="font-bold">{porcentaje}%</span>
          </div>
          <div className="w-full bg-white/20 rounded-full h-2">
            <div className="bg-white h-2 rounded-full transition-all duration-500"
              style={{ width: `${porcentaje}%` }} />
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {cargando ? (
          <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-green-500" /></div>
        ) : grupos.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <ShoppingBag size={48} className="text-gray-200 mx-auto" />
            <p className="text-gray-500">Sin productos para recoger</p>
          </div>
        ) : (
          grupos.map(grupo => {
            const key      = grupo.tienda_id ?? 'sin_tienda'
            const abierto  = expandido === key
            const pendientes = grupo.items.filter(i => i.estado === 'pendiente').length
            return (
              <div key={key} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${grupo.completado ? 'border-green-200' : 'border-slate-100'}`}>

                {/* Cabecera tienda */}
                <button
                  onClick={() => setExpandido(abierto ? null : key)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left ${grupo.completado ? 'bg-green-50' : 'bg-white'}`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${grupo.completado ? 'bg-green-100' : 'bg-slate-100'}`}>
                    🏪
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-800">{grupo.tienda_nombre}</div>
                    <div className="text-xs text-slate-400">
                      {grupo.items.length} productos
                      {pendientes > 0 && <span className="text-orange-500 font-semibold"> · {pendientes} pendientes</span>}
                    </div>
                  </div>
                  {grupo.completado
                    ? <span className="text-green-600 text-xs font-bold bg-green-100 px-2.5 py-1 rounded-full">✓ Listo</span>
                    : <span className="text-orange-600 text-xs font-bold bg-orange-100 px-2.5 py-1 rounded-full">{pendientes} pendientes</span>
                  }
                  {abierto ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
                </button>

                {/* Items */}
                {abierto && (
                  <div className="divide-y divide-slate-50 border-t border-slate-100">
                    {grupo.items.map(item => {
                      const est = ESTADO_CFG[item.estado]
                      return (
                        <div key={item.id} className="px-4 py-3 space-y-2">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-lg shrink-0 mt-0.5">
                              {est.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-slate-800 leading-snug">{item.descripcion}</div>
                              <div className="flex items-center gap-3 mt-0.5">
                                <span className="text-xs text-slate-400">Cant: <strong>{item.cantidad}</strong></span>
                                {item.precio_ref && <span className="text-xs text-slate-400">Ref: {fmt(item.precio_ref)}</span>}
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${est.bg} ${est.color}`}>
                                  {est.label}
                                </span>
                              </div>
                              {item.sustitucion && (
                                <div className="mt-1 text-xs text-blue-600 bg-blue-50 rounded-lg px-2 py-1">
                                  🔄 Sustituido por: {item.sustitucion}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Acciones — solo si pendiente */}
                          {item.estado === 'pendiente' && (
                            <div className="flex gap-2 ml-11">
                              <button
                                onClick={() => marcarEstado(item.id, 'recogido')}
                                disabled={procesando === item.id}
                                className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold py-2 rounded-xl text-xs transition">
                                {procesando === item.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                Recogido
                              </button>
                              <button
                                onClick={() => setModalSust(item.id)}
                                className="flex items-center justify-center gap-1 border border-blue-200 text-blue-600 hover:bg-blue-50 font-semibold py-2 px-3 rounded-xl text-xs transition">
                                🔄
                              </button>
                              <button
                                onClick={() => marcarEstado(item.id, 'no_disponible')}
                                disabled={procesando === item.id}
                                className="flex items-center justify-center gap-1 border border-red-200 text-red-500 hover:bg-red-50 font-semibold py-2 px-3 rounded-xl text-xs transition">
                                <X size={13} />
                              </button>
                            </div>
                          )}

                          {/* Revertir si ya está marcado */}
                          {item.estado !== 'pendiente' && (
                            <button
                              onClick={() => marcarEstado(item.id, 'pendiente')}
                              className="ml-11 text-[10px] text-slate-400 hover:text-slate-600 underline">
                              Deshacer
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}

        {/* Botón finalizar picking */}
        {todosListos && (
          <button
            onClick={() => router.back()}
            className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-2xl transition text-sm shadow-lg">
            <Check size={18} /> ¡Picking completo! Volver al pedido
          </button>
        )}
      </div>

      {/* Modal sustitución */}
      {modalSust && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3">
            <h3 className="font-bold text-slate-800">¿Por qué lo sustituyes?</h3>
            <textarea
              value={textoSust} onChange={e => setTextoSust(e.target.value)}
              placeholder="Ej: No había Arroz Gustadina, compré Arroz La Favorita 1kg..."
              rows={3}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-green-500 resize-none" />
            <div className="flex gap-2">
              <button onClick={() => { setModalSust(null); setTextoSust('') }}
                className="flex-1 border border-slate-200 text-slate-600 font-semibold py-2.5 rounded-xl text-sm">
                Cancelar
              </button>
              <button
                onClick={() => textoSust.trim() && marcarEstado(modalSust, 'sustituido', textoSust.trim())}
                disabled={!textoSust.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm">
                Confirmar sustitución
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
