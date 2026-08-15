import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { consultarFacturaSri } from '@/lib/sri'

// Punto 8 de docs/auditoria_plan_correcciones_ia.md: persiste la factura de
// compra completamente en el servidor. El navegador solo envía datos que el
// operador digitó (asignacionId, claveAcceso, montoDigitado, metodoPago,
// fotoPath ya subido a Storage). El SRI se vuelve a consultar aquí mismo —
// nunca se confía en el xml/hash/totales que /api/sri/comprobante devolvió
// antes al navegador para la vista previa, porque ese valor pudo ser
// manipulado en el cliente antes de llegar aquí.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })

    const {
      asignacionId, claveAcceso, montoDigitado, metodoPago, fotoPath,
      tiendaId, provRuc, provEstablecimiento, provPuntoEmision, provSecuencial,
      requestId,
    } = await req.json()

    if (!asignacionId || !requestId) {
      return NextResponse.json({ error: 'Faltan asignacionId o requestId' }, { status: 400 })
    }
    const monto = Number(montoDigitado)
    if (!Number.isFinite(monto) || monto <= 0) {
      return NextResponse.json({ error: 'Monto digitado inválido' }, { status: 400 })
    }
    if (!fotoPath) {
      return NextResponse.json({ error: 'Falta la foto del comprobante físico' }, { status: 400 })
    }

    // El propio acceso a la fila ya está sujeto a RLS (rep_puede_ver_asignacion),
    // así que si el usuario no es el shopper/rider/admin de esta asignación,
    // esto no devuelve nada.
    const { data: asig, error: errAsig } = await supabase
      .from('rep_asignaciones')
      .select('id, shopper_id')
      .eq('id', asignacionId)
      .single()
    if (errAsig || !asig) {
      return NextResponse.json({ error: 'No tiene acceso a esta asignación' }, { status: 403 })
    }

    const { data: repartidor } = await supabase
      .from('rep_repartidores')
      .select('id')
      .eq('user_id', user.id)
      .single()
    if (!repartidor) {
      return NextResponse.json({ error: 'No existe un perfil de repartidor para este usuario' }, { status: 403 })
    }

    // Re-consulta autoritativa al SRI -- nunca se acepta xml/hash/totales del navegador.
    const clave = String(claveAcceso ?? '').replace(/\D/g, '')
    const factura = await consultarFacturaSri(clave)

    const rucEmpresa = (process.env.NEXT_PUBLIC_TIENDA_RUC || '1717067647001').replace(/\D/g, '')
    if (factura.identificacionComprador !== rucEmpresa) {
      return NextResponse.json({ error: 'La factura no está emitida para el RUC de La Crayola' }, { status: 422 })
    }
    if (!/PRODUCCI|^2$/i.test(factura.ambiente)) {
      return NextResponse.json({ error: 'La factura pertenece al ambiente de pruebas del SRI' }, { status: 422 })
    }

    const diferencia = Math.abs(factura.total - monto)
    const conciliacionEstado = diferencia <= 0.01 ? 'coincide' : 'con_diferencia'
    const conciliacionDiferencias = diferencia <= 0.01
      ? []
      : [`XML ${factura.total.toFixed(2)} / digitado ${monto.toFixed(2)}`]

    const serviceClient = createServiceClient()
    const { data: comprobante, error: rpcError } = await serviceClient.rpc('registrar_factura_compra_servidor', {
      p_asignacion_id: asignacionId,
      p_actor_user_id: user.id,
      p_actor_repartidor_id: repartidor.id,
      p_tienda_id: tiendaId || null,
      p_prov_ruc: provRuc || factura.rucEmisor,
      p_prov_establecimiento: provEstablecimiento || factura.establecimiento,
      p_prov_punto_emision: provPuntoEmision || factura.puntoEmision,
      p_prov_secuencial: provSecuencial || factura.secuencial,
      p_monto_digitado: monto,
      p_metodo_pago: metodoPago || null,
      p_foto_path: fotoPath,
      p_clave_acceso: clave,
      p_sri_estado: factura.estado,
      p_sri_fecha_autorizacion: factura.fechaAutorizacion,
      p_sri_xml: factura.xml,
      p_sri_sha256: factura.sha256,
      p_sri_razon_social_emisor: factura.razonSocialEmisor,
      p_sri_identificacion_comprador: factura.identificacionComprador,
      p_sri_subtotal: factura.subtotal,
      p_sri_iva: factura.iva,
      p_sri_total: factura.total,
      p_sri_ambiente: factura.ambiente,
      p_conciliacion_estado: conciliacionEstado,
      p_conciliacion_diferencias: conciliacionDiferencias,
      p_request_id: requestId,
    })

    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 422 })
    }

    return NextResponse.json({ comprobante, conciliacion: { estado: conciliacionEstado, diferencias: conciliacionDiferencias } })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'No se pudo registrar la factura de compra'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
