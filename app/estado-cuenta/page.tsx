'use client'
import { useCallback,useEffect,useMemo,useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { supabase } from '@/lib/supabase'
import { AlertTriangle,ArrowDownLeft,ArrowUpRight,Banknote,CalendarDays,Loader2,RefreshCw,Scale,WalletCards } from 'lucide-react'

const money=(n:number)=>new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD'}).format(n||0)
const iso=(d:Date)=>d.toISOString().slice(0,10)
type Estado={repartidor_id:string;nombre:string;activo:boolean;efectivo_en_mano:number;caja_ledger:number;ganancias:number;posicion_neta:number;movimientos:number;ultima_actividad:string|null}
type Mov={id:string;repartidor_id:string;pedido_id:string|null;fecha_operacion:string;cuenta:'caja'|'ganancia';concepto:string;debito:number;credito:number;descripcion:string|null}
type Periodo={id:string;repartidor_id:string;desde:string;hasta:string;ganancias:number;caja_custodia:number;posicion_neta:number;monto_pagar:number;monto_cobrar:number;estado:string}

export default function EstadoCuentaPage(){
 const [estados,setEstados]=useState<Estado[]>([]),[movs,setMovs]=useState<Mov[]>([]),[periodos,setPeriodos]=useState<Periodo[]>([])
 const [seleccion,setSeleccion]=useState(''),[loading,setLoading]=useState(true),[syncing,setSyncing]=useState(false),[error,setError]=useState('')
 const hoy=new Date(), lunes=new Date(hoy);lunes.setDate(hoy.getDate()-((hoy.getDay()+6)%7)-7);const domingo=new Date(lunes);domingo.setDate(lunes.getDate()+6)
 const [desde,setDesde]=useState(iso(lunes)),[hasta,setHasta]=useState(iso(domingo))
 // rep_estado_cuenta ya no se consulta directo (no tenía ningún filtro por
 // fila -- cualquier autenticado veía la caja/ganancias de todos). Ahora
 // pasa por admin_estados_cuenta(), que exige rep_puede_ver_finanzas().
 //
 // "ganancias" sale de rep_ledger_movimientos, que solo se llena cuando se
 // llama sincronizar_ledger_financiero() -- antes había que acordarse de
 // apretar "Sincronizar" o todo se veía en $0.00 (mismo bug que encontramos
 // en la comisión del repartidor). Ahora se sincroniza solo al cargar la
 // pantalla, sin que el admin tenga que saber que ese paso existe.
 const [cerrandoTodos,setCerrandoTodos]=useState(false)
 const cargar=useCallback(async()=>{setLoading(true);setError('');await supabase.rpc('sincronizar_ledger_financiero');const [e,m,p]=await Promise.all([supabase.rpc('admin_estados_cuenta'),supabase.from('rep_ledger_movimientos').select('*').order('fecha_operacion',{ascending:false}).limit(500),supabase.from('rep_periodos_pago').select('*').order('hasta',{ascending:false}).limit(200)]);const err=e.error||m.error||p.error;if(err)setError(err.message);setEstados(((e.data||[]) as Estado[]).slice().sort((a,b)=>a.nombre.localeCompare(b.nombre)));setMovs((m.data||[]) as Mov[]);setPeriodos((p.data||[]) as Periodo[]);setSeleccion(s=>s||e.data?.[0]?.repartidor_id||'');setLoading(false)},[])
 useEffect(()=>{const t=setTimeout(()=>void cargar(),0);return()=>clearTimeout(t)},[cargar])
 const actual=estados.find(e=>e.repartidor_id===seleccion), detalle=useMemo(()=>movs.filter(m=>m.repartidor_id===seleccion),[movs,seleccion])
 const nombrePor=useMemo(()=>Object.fromEntries(estados.map(e=>[e.repartidor_id,e.nombre])),[estados])
 async function sincronizar(){setSyncing(true);const {error}=await supabase.rpc('sincronizar_ledger_financiero');setSyncing(false);if(error){setError(error.message);return}await cargar()}
 async function cerrar(){if(!seleccion)return;if(!confirm(`Cerrar período ${desde} a ${hasta}? El cierre quedará auditado.`))return;setSyncing(true);const {error}=await supabase.rpc('cerrar_periodo_colaborador',{p_repartidor_id:seleccion,p_desde:desde,p_hasta:hasta});setSyncing(false);if(error){setError(error.message);return}await cargar()}
 // Cierre masivo: liquida el mismo rango a TODOS los repartidores activos
 // de una sola vez -- para el cierre semanal real no tiene sentido entrar
 // uno por uno cuando son varios.
 async function cerrarTodos(){
  const activos=estados.filter(e=>e.activo)
  if(!activos.length)return
  if(!confirm(`Cerrar período ${desde} a ${hasta} para los ${activos.length} repartidores activos? El cierre quedará auditado.`))return
  setCerrandoTodos(true);setError('')
  const fallidos:string[]=[]
  for(const e of activos){
   const {error}=await supabase.rpc('cerrar_periodo_colaborador',{p_repartidor_id:e.repartidor_id,p_desde:desde,p_hasta:hasta})
   if(error)fallidos.push(`${e.nombre}: ${error.message}`)
  }
  setCerrandoTodos(false)
  if(fallidos.length)setError(`Algunos no se pudieron cerrar — ${fallidos.join(' · ')}`)
  await cargar()
 }
 return <div className="flex min-h-screen bg-slate-100"><Sidebar/><main className="flex-1 space-y-5 p-4 pt-16 md:ml-56 md:p-6">
  <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.18em] text-green-600">Finanzas</p><h1 className="text-2xl font-black text-slate-900">Liquidar comisiones</h1><p className="text-sm text-slate-500">Caja, ganancias y compensación por colaborador.</p></div><button onClick={sincronizar} disabled={syncing} className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"><RefreshCw size={15} className={syncing?'animate-spin':''}/>Sincronizar movimientos</button></header>
  {error&&<div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle size={18}/><span>{error.includes('does not exist')?'Ejecuta migration_ledger_colaboradores.sql en Supabase.':error}</span></div>}
  <div className="grid gap-4 xl:grid-cols-[300px_1fr]"><aside className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><p className="px-2 pb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Colaboradores</p>{loading?<Loader2 className="m-6 animate-spin"/>:<div className="space-y-1">{estados.map(e=><button key={e.repartidor_id} onClick={()=>setSeleccion(e.repartidor_id)} className={`w-full rounded-xl p-3 text-left ${seleccion===e.repartidor_id?'bg-slate-900 text-white':'hover:bg-slate-50'}`}><div className="flex justify-between gap-2"><span className="truncate text-sm font-bold">{e.nombre}</span><span className={`text-xs font-black ${e.posicion_neta>=0?'text-green-500':'text-orange-500'}`}>{money(e.posicion_neta)}</span></div><p className={`text-[10px] ${seleccion===e.repartidor_id?'text-slate-400':'text-slate-500'}`}>{e.movimientos} movimientos</p></button>)}</div>}</aside>
   <section className="space-y-4">{actual&&<><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
    {l:'Caja en custodia',v:actual.caja_ledger,i:Banknote,t:'text-orange-600 bg-orange-50'},
    {l:'Ganancias',v:actual.ganancias,i:WalletCards,t:'text-green-600 bg-green-50'},
    {l:'Posición neta',v:actual.posicion_neta,i:Scale,t:actual.posicion_neta>=0?'text-blue-600 bg-blue-50':'text-red-600 bg-red-50'},
    {l:actual.posicion_neta>=0?'Empresa debe pagar':'Debe entregar',v:Math.abs(actual.posicion_neta),i:actual.posicion_neta>=0?ArrowDownLeft:ArrowUpRight,t:'text-violet-600 bg-violet-50'},
   ].map(({l,v,i:I,t})=><div key={l} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${t}`}><I size={17}/></div><p className="text-xl font-black">{money(v)}</p><p className="text-xs text-slate-500">{l}</p></div>)}</div>
   <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-end gap-3"><div className="mr-auto"><h2 className="font-black">Cierre semanal</h2><p className="text-xs text-slate-500">Congela ganancias, caja y posición neta del período.</p></div><label className="text-[10px] font-bold text-slate-500">DESDE<input type="date" value={desde} onChange={e=>setDesde(e.target.value)} className="mt-1 block rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800"/></label><label className="text-[10px] font-bold text-slate-500">HASTA<input type="date" value={hasta} onChange={e=>setHasta(e.target.value)} className="mt-1 block rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800"/></label><button onClick={cerrar} disabled={syncing} className="flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-xs font-bold text-white"><CalendarDays size={15}/>Cerrar solo {actual?.nombre ?? 'este'}</button><button onClick={cerrarTodos} disabled={cerrandoTodos||syncing} title="Cierra el mismo período para todos los repartidores activos" className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"><CalendarDays size={15}/>{cerrandoTodos?'Cerrando...':`Cerrar TODOS (${estados.filter(e=>e.activo).length})`}</button></div></div>
   <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-4"><h2 className="font-black">Movimientos</h2><p className="text-xs text-slate-500">Cada valor conserva su pedido y origen.</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-400"><tr><th className="px-4 py-3 text-left">Fecha</th><th className="px-3 text-left">Cuenta / concepto</th><th className="px-3 text-left">Descripción</th><th className="px-4 text-right">Movimiento</th></tr></thead><tbody className="divide-y divide-slate-100">{detalle.map(m=><tr key={m.id}><td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{new Date(m.fecha_operacion).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'})}</td><td className="px-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${m.cuenta==='caja'?'bg-orange-50 text-orange-700':'bg-green-50 text-green-700'}`}>{m.cuenta}</span><p className="mt-1 text-xs font-semibold capitalize">{m.concepto.replaceAll('_',' ')}</p></td><td className="px-3 text-xs text-slate-500">{m.descripcion||'—'}{m.pedido_id&&<p className="text-[9px] text-slate-400">Pedido: {m.pedido_id.slice(0,8)}</p>}</td><td className={`px-4 text-right font-black ${m.debito>0?'text-green-600':'text-red-500'}`}>{m.debito>0?'+':'−'}{money(Number(m.debito||m.credito))}</td></tr>)}{!detalle.length&&<tr><td colSpan={4} className="p-8 text-center text-sm text-slate-400">Sin movimientos. Presiona “Sincronizar movimientos”.</td></tr>}</tbody></table></div></div>
   <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="font-black">Cierres anteriores de {actual.nombre}</h2><div className="mt-3 space-y-2">{periodos.filter(p=>p.repartidor_id===seleccion).map(p=><div key={p.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs"><span className="font-bold">{p.desde} → {p.hasta}</span><span className={p.posicion_neta>=0?'text-green-700':'text-orange-700'}>{p.posicion_neta>=0?`Pagar ${money(p.monto_pagar)}`:`Cobrar ${money(p.monto_cobrar)}`}</span><span className="rounded-full bg-white px-2 py-1 font-bold capitalize">{p.estado}</span></div>)}{!periodos.filter(p=>p.repartidor_id===seleccion).length&&<p className="py-3 text-center text-xs text-slate-400">Sin cierres todavía.</p>}</div></div></>}
   {/* Control global: TODAS las liquidaciones de TODOS los repartidores,
       no solo del que está seleccionado -- antes no existía forma de ver
       de un vistazo qué se le ha liquidado a cada quién. */}
   <div className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-4"><h2 className="font-black">Control de todas las liquidaciones</h2><p className="text-xs text-slate-500">Historial completo, todos los repartidores.</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-[10px] uppercase text-slate-400"><tr><th className="px-4 py-3 text-left">Repartidor</th><th className="px-3 text-left">Período</th><th className="px-3 text-right">Ganancias</th><th className="px-3 text-right">Caja custodia</th><th className="px-3 text-right">Neto</th><th className="px-4 text-center">Estado</th></tr></thead><tbody className="divide-y divide-slate-100">{periodos.map(p=><tr key={p.id}><td className="px-4 py-2.5 text-xs font-bold">{nombrePor[p.repartidor_id]??'—'}</td><td className="px-3 text-xs text-slate-500">{p.desde} → {p.hasta}</td><td className="px-3 text-right text-xs font-semibold text-green-700">{money(p.ganancias)}</td><td className="px-3 text-right text-xs font-semibold text-orange-600">{money(p.caja_custodia)}</td><td className={`px-3 text-right text-xs font-black ${p.posicion_neta>=0?'text-blue-600':'text-red-500'}`}>{p.posicion_neta>=0?`Pagar ${money(p.monto_pagar)}`:`Cobrar ${money(p.monto_cobrar)}`}</td><td className="px-4 text-center"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold capitalize">{p.estado}</span></td></tr>)}{!periodos.length&&<tr><td colSpan={6} className="p-8 text-center text-sm text-slate-400">Aún no se ha cerrado ningún período.</td></tr>}</tbody></table></div></div>
   </section>
  </div>
 </main></div>
}
