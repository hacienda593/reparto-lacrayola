import { NextRequest,NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { consultarFacturaSri } from '@/lib/sri'

export async function POST(req:NextRequest){
 try{
  const supabase=await createClient();const{data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:'Sesión requerida'},{status:401})
  const{clave,asignacionId,comprobanteId}=await req.json();let asignacion=asignacionId
  if(!asignacion&&comprobanteId){const{data:c}=await supabase.from('ol_pedidos_comprobantes_proveedor').select('pedido_id').eq('id',comprobanteId).single();if(c){const{data:a}=await supabase.from('rep_asignaciones').select('id').eq('pedido_id',c.pedido_id).order('asignado_at',{ascending:false}).limit(1).maybeSingle();asignacion=a?.id}}
  if(!asignacion)return NextResponse.json({error:'Asignación requerida'},{status:400})
  const{data:a,error}=await supabase.from('rep_asignaciones').select('id,pedido_id').eq('id',asignacion).single();if(error||!a)return NextResponse.json({error:'No tiene acceso a esta asignación'},{status:403})
  const factura=await consultarFacturaSri(String(clave??'').replace(/\D/g,''))
  const rucEmpresa=(process.env.NEXT_PUBLIC_TIENDA_RUC||'1717067647001').replace(/\D/g,'')
  return NextResponse.json({factura,conciliacion:{receptorCorrecto:factura.identificacionComprador===rucEmpresa,ambienteProduccion:/PRODUCCI|^2$/i.test(factura.ambiente),rucEsperado:rucEmpresa}})
 }catch(e){const message=e instanceof Error?e.message:'No se pudo consultar el SRI';return NextResponse.json({error:message},{status:422})}
}
