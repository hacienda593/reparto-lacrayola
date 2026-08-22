'use client'
// P1-04 de la auditoría operativa (docs/auditoria_operativa_aplicacion_entregas_2026-08-21.md):
// esta era una función `renderModalTraspaso()` de ~145 líneas viviendo
// dentro de app/repartidor/page.tsx (que superaba las 2600 líneas). Se
// extrae solo la parte de PRESENTACIÓN a un componente propio -- todo el
// estado y confirmarTraspaso() se quedan en la pantalla del repartidor
// (nada de lógica de negocio se movió, cero cambio de comportamiento),
// este componente solo recibe esos valores como props.
import Link from 'next/link'
import { Loader2, ArrowRightLeft, X } from 'lucide-react'

export interface Colega { id: string; nombre: string }
export interface EntregaSinLiquidar {
  id: string
  monto_cobrado: number
  ol_pedidos?: { numero?: number; nombre_cliente?: string } | null
}

export interface ModalTraspasoEfectivoProps {
  visible: boolean
  onClose: () => void
  efectivoEnMano: number
  comisionPendiente: number
  metodoTraspaso: 'colega' | 'deposito_banco' | 'transferencia'
  setMetodoTraspaso: (m: 'colega' | 'deposito_banco' | 'transferencia') => void
  colegas: Colega[]
  destinoTraspaso: string
  setDestinoTraspaso: (v: string) => void
  montoTraspaso: string
  setMontoTraspaso: (v: string) => void
  notasTraspaso: string
  setNotasTraspaso: (v: string) => void
  entregasSinLiquidar: EntregaSinLiquidar[]
  entregasSeleccionadas: Set<string>
  toggleEntregaSeleccionada: (id: string) => void
  totalSeleccionadoTraspaso: number
  bancoTraspaso: string
  setBancoTraspaso: (v: string) => void
  referenciaTraspaso: string
  setReferenciaTraspaso: (v: string) => void
  comprobanteTraspasoFile: File | null
  setComprobanteTraspasoFile: (f: File | null) => void
  errorTraspaso: string
  procesandoTraspaso: boolean
  confirmarTraspaso: () => void
  fmt: (n: number) => string
}

export default function ModalTraspasoEfectivo(props: ModalTraspasoEfectivoProps) {
  if (!props.visible) return null
  const {
    onClose, efectivoEnMano, comisionPendiente, metodoTraspaso, setMetodoTraspaso,
    colegas, destinoTraspaso, setDestinoTraspaso, montoTraspaso, setMontoTraspaso,
    notasTraspaso, setNotasTraspaso, entregasSinLiquidar, entregasSeleccionadas,
    toggleEntregaSeleccionada, totalSeleccionadoTraspaso, bancoTraspaso, setBancoTraspaso,
    referenciaTraspaso, setReferenciaTraspaso, comprobanteTraspasoFile, setComprobanteTraspasoFile,
    errorTraspaso, procesandoTraspaso, confirmarTraspaso, fmt,
  } = props

  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 text-left">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl p-5 w-full sm:max-w-sm space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-slate-800 text-base flex items-center gap-1.5">
            <ArrowRightLeft size={16} className="text-green-600" /> Entregar efectivo
          </h3>
          <button onClick={onClose} className="text-slate-400 p-1 cursor-pointer"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-orange-50 border border-orange-100 rounded-xl px-3 py-2.5">
            <div className="text-sm font-black text-orange-600">{fmt(efectivoEnMano)}</div>
            <div className="text-[9.5px] text-slate-500">Efectivo en mano</div>
          </div>
          <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
            <div className="text-sm font-black text-green-700">{fmt(comisionPendiente)}</div>
            <div className="text-[9.5px] text-slate-500">Comisión por cobrar</div>
          </div>
        </div>
        <Link href="/repartidor/comisiones" className="block text-center text-[10px] font-bold text-blue-600 hover:underline -mt-2">
          Ver desglose y reportar diferencias →
        </Link>

        <div className="grid grid-cols-3 gap-1.5">
          {[
            { k: 'colega', label: 'A un colega' },
            { k: 'deposito_banco', label: 'Depósito' },
            { k: 'transferencia', label: 'Transferencia' },
          ].map(m => (
            <button key={m.k} type="button" onClick={() => setMetodoTraspaso(m.k as 'colega' | 'deposito_banco' | 'transferencia')}
              className={`py-2 rounded-xl border text-[10.5px] font-bold text-center transition ${
                metodoTraspaso === m.k ? 'bg-green-50 border-green-500 text-green-700' : 'bg-slate-50 border-slate-200 text-slate-500'
              }`}>
              {m.label}
            </button>
          ))}
        </div>

        {metodoTraspaso === 'colega' ? (
          <>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">¿A quién se lo entregas?</label>
              <select
                value={destinoTraspaso}
                onChange={e => setDestinoTraspaso(e.target.value)}
                className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-green-500"
              >
                <option value="">-- Selecciona --</option>
                {colegas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <p className="text-[9px] text-slate-400 mt-1">Solo para entrega física a otro colaborador de campo, no a la oficina.</p>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Monto a entregar</label>
              <div className="relative mt-1">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-green-600 font-bold text-sm">$</span>
                <input
                  type="number" step="0.01" min="0"
                  value={montoTraspaso}
                  onChange={e => setMontoTraspaso(e.target.value)}
                  placeholder={efectivoEnMano.toFixed(2)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-3 py-2.5 text-sm font-bold text-slate-800 focus:outline-none focus:border-green-500"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Notas (opcional)</label>
              <input
                type="text"
                value={notasTraspaso}
                onChange={e => setNotasTraspaso(e.target.value)}
                placeholder="Ej: entregado en caja de Tuti"
                className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-green-500"
              />
            </div>
          </>
        ) : (
          <>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-700">
              Marca exactamente qué pedidos cobrados en efectivo cubre este {metodoTraspaso === 'deposito_banco' ? 'depósito' : 'transferencia'} — queda ligado a ellos, no se puede reutilizar para otros cobros.
            </div>

            {entregasSinLiquidar.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-3">No tienes cobros en efectivo pendientes de liquidar.</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto border border-slate-100 rounded-xl p-2">
                {entregasSinLiquidar.map(e => (
                  <label key={e.id} className="flex items-center gap-2 text-xs px-1.5 py-1 rounded-lg hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={entregasSeleccionadas.has(e.id)} onChange={() => toggleEntregaSeleccionada(e.id)} className="accent-green-600" />
                    <span className="flex-1 truncate">#{String(e.ol_pedidos?.numero ?? 0).padStart(4, '0')} · {e.ol_pedidos?.nombre_cliente ?? 'Cliente'}</span>
                    <span className="font-bold text-slate-700 shrink-0">${Number(e.monto_cobrado).toFixed(2)}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex justify-between items-center text-xs bg-slate-50 rounded-xl px-3 py-2">
              <span className="text-slate-500">Total seleccionado</span>
              <span className="font-black text-slate-800">${totalSeleccionadoTraspaso.toFixed(2)}</span>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Banco</label>
              <input type="text" value={bancoTraspaso} onChange={e => setBancoTraspaso(e.target.value)}
                placeholder="Ej: Pichincha"
                className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-green-500" />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Número de referencia *</label>
              <input type="text" value={referenciaTraspaso} onChange={e => setReferenciaTraspaso(e.target.value)}
                placeholder="Nro. de comprobante"
                className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-green-500" />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Foto del comprobante *</label>
              <label className="flex items-center justify-center gap-2 border border-slate-200 rounded-xl py-2.5 mt-1 cursor-pointer hover:bg-slate-50 text-slate-500 text-xs">
                {comprobanteTraspasoFile ? comprobanteTraspasoFile.name : 'Tomar o elegir foto'}
                <input type="file" accept="image/*" className="hidden" onChange={e => setComprobanteTraspasoFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>

            <p className="text-[9.5px] text-slate-400 leading-snug">
              ⚠️ Verifica el monto y la foto antes de enviar: si el depósito reportado no coincide con lo recibido en la cuenta de la empresa, la diferencia queda a tu cargo hasta que se aclare.
            </p>
          </>
        )}

        {errorTraspaso && <p className="text-red-500 text-xs text-center">{errorTraspaso}</p>}

        <button
          onClick={confirmarTraspaso}
          disabled={procesandoTraspaso}
          className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2 cursor-pointer"
        >
          {procesandoTraspaso ? <Loader2 size={16} className="animate-spin" /> : <ArrowRightLeft size={15} />}
          {procesandoTraspaso ? 'Registrando...' : metodoTraspaso === 'colega' ? 'Confirmar entrega de efectivo' : 'Enviar para verificación'}
        </button>
      </div>
    </div>
  )
}
