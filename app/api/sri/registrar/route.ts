import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { consultarFacturaSri } from '@/lib/sri'

// Punto 8 de docs/auditoria_plan_correcciones_ia.md: valida la factura de
// compra en el servidor antes de guardarla. El navegador solo envía datos
// que el operador digitó (asignacionId, claveAcceso, montoDigitado,
// metodoPago, fotoPath ya subido a Storage). El SRI se vuelve a consultar
// aquí mismo -- no se confía en el xml/hash/totales que
// /api/sri/comprobante devolvió antes al navegador para la vista previa.
//
// Este es un paso básico del lado del shopper (registro provisional); la
// aprobación final la hace un administrador con más acceso en
// app/facturas-compra, que puede volver a consultar el SRI antes de
// validar. Por eso el guardado en Supabase usa la sesión normal del
// usuario (RPC otorgada a `authenticated`, sin service_role) en vez de un
// camino restringido: la revisión humana posterior es el control real, no
// solo la escritura atómica.
//
// Soporta 3 tipos de comprobante (tipoComprobante), pedidos por el negocio
// para que el shopper nunca quede bloqueado en caja:
//   - electronica: caso normal, exige AUTORIZADO por el SRI.
//   - electronica_pendiente_sri: excepción -- hay clave de 49 dígitos pero
//     el SRI aún no la autoriza. Exige motivoExcepcion y un intento real de
//     consulta (que se hace aquí mismo). Si el SRI SÍ autoriza en ese
//     intento, se registra como electronica normal en vez de excepción.
//   - sin_comprobante: excepción -- el proveedor no emite ningún
//     comprobante. No se consulta el SRI. Exige motivoExcepcion.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })

    const {
      asignacionId, claveAcceso, montoDigitado, metodoPago, fotoPath,
      tiendaId, provRuc, provEstablecimiento, provPuntoEmision, provSecuencial,
      requestId, tipoComprobante, motivoExcepcion,
    } = await req.json()

    const tipo: string = tipoComprobante || 'electronica'
    if (!['electronica', 'electronica_pendiente_sri', 'sin_comprobante'].includes(tipo)) {
      return NextResponse.json({ error: 'Tipo de comprobante inválido' }, { status: 400 })
    }

    if (!asignacionId || !requestId) {
      return NextResponse.json({ error: 'Faltan asignacionId o requestId' }, { status: 400 })
    }
    const monto = Number(montoDigitado)
    if (!Number.isFinite(monto) || monto <= 0) {
      return NextResponse.json({ error: 'Monto digitado inválido' }, { status: 400 })
    }
    if (!fotoPath) {
      return NextResponse.json({ error: 'Falta la foto del comprobante o de la evidencia de compra' }, { status: 400 })
    }
    if (tipo !== 'electronica' && !String(motivoExcepcion ?? '').trim()) {
      return NextResponse.json({ error: 'Debes indicar el motivo de la excepción' }, { status: 400 })
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

    const rpcParamsBase = {
      p_asignacion_id: asignacionId,
      p_actor_user_id: user.id,
      p_actor_repartidor_id: repartidor.id,
      p_tienda_id: tiendaId || null,
      p_metodo_pago: metodoPago || null,
      p_foto_path: fotoPath,
      p_monto_digitado: monto,
      p_request_id: requestId,
      p_motivo_excepcion: motivoExcepcion ? String(motivoExcepcion).trim() : null,
    }

    if (tipo === 'sin_comprobante') {
      const { data: comprobante, error: rpcError } = await supabase.rpc('registrar_factura_compra_servidor', {
        ...rpcParamsBase,
        p_prov_ruc: provRuc || 'S/N',
        p_prov_establecimiento: provEstablecimiento || 'S/N',
        p_prov_punto_emision: provPuntoEmision || 'S/N',
        p_prov_secuencial: provSecuencial || 'S/N',
        p_clave_acceso: null,
        p_sri_estado: null,
        p_sri_fecha_autorizacion: null,
        p_sri_xml: null,
        p_sri_sha256: null,
        p_sri_razon_social_emisor: null,
        p_sri_identificacion_comprador: null,
        p_sri_subtotal: null,
        p_sri_iva: null,
        p_sri_total: null,
        p_sri_ambiente: null,
        p_conciliacion_estado: null,
        p_conciliacion_diferencias: [],
        p_tipo_comprobante: 'sin_comprobante',
        p_sri_mensaje_error: null,
      })
      if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 422 })
      return NextResponse.json({ comprobante })
    }

    // electronica / electronica_pendiente_sri: siempre se vuelve a consultar
    // el SRI aquí mismo -- nunca se confía en lo que el navegador consultó antes.
    const clave = String(claveAcceso ?? '').replace(/\D/g, '')
    if (clave.length !== 49) {
      return NextResponse.json({ error: 'La clave de acceso debe tener 49 dígitos' }, { status: 400 })
    }

    let factura
    let sriMensajeError: string | null = null
    try {
      factura = await consultarFacturaSri(clave)
    } catch (e) {
      if (tipo === 'electronica') throw e
      // Excepción: se registra igual, dejando constancia del motivo por el
      // que el SRI no autorizó (para que admin reintente después).
      sriMensajeError = e instanceof Error ? e.message : 'No se pudo consultar el SRI'
    }

    if (factura) {
      const rucEmpresa = (process.env.NEXT_PUBLIC_TIENDA_RUC || '1717067647001').replace(/\D/g, '')
      if (tipo === 'electronica') {
        if (factura.identificacionComprador !== rucEmpresa) {
          return NextResponse.json({ error: 'La factura no está emitida para el RUC de La Crayola' }, { status: 422 })
        }
        if (!/PRODUCCI|^2$/i.test(factura.ambiente)) {
          return NextResponse.json({ error: 'La factura pertenece al ambiente de pruebas del SRI' }, { status: 422 })
        }
      }

      const diferencia = Math.abs(factura.total - monto)
      const conciliacionEstado = diferencia <= 0.01 ? 'coincide' : 'con_diferencia'
      const conciliacionDiferencias = diferencia <= 0.01 ? [] : [`XML ${factura.total.toFixed(2)} / digitado ${monto.toFixed(2)}`]

      // Si venía como "pendiente de SRI" pero el SRI SÍ autorizó en este
      // intento, se registra como electronica normal, no como excepción.
      const tipoFinal = tipo === 'electronica_pendiente_sri' && factura.estado === 'AUTORIZADO' ? 'electronica' : tipo

      const { data: comprobante, error: rpcError } = await supabase.rpc('registrar_factura_compra_servidor', {
        ...rpcParamsBase,
        p_prov_ruc: provRuc || factura.rucEmisor,
        p_prov_establecimiento: provEstablecimiento || factura.establecimiento,
        p_prov_punto_emision: provPuntoEmision || factura.puntoEmision,
        p_prov_secuencial: provSecuencial || factura.secuencial,
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
        p_tipo_comprobante: tipoFinal,
        p_sri_mensaje_error: null,
      })
      if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 422 })
      return NextResponse.json({ comprobante, conciliacion: { estado: conciliacionEstado, diferencias: conciliacionDiferencias } })
    }

    // tipo === 'electronica_pendiente_sri' y la consulta falló: se registra
    // la excepción con el mensaje de error del SRI para que admin la revise.
    const { data: comprobante, error: rpcError } = await supabase.rpc('registrar_factura_compra_servidor', {
      ...rpcParamsBase,
      p_prov_ruc: provRuc || 'S/N',
      p_prov_establecimiento: provEstablecimiento || 'S/N',
      p_prov_punto_emision: provPuntoEmision || 'S/N',
      p_prov_secuencial: provSecuencial || 'S/N',
      p_clave_acceso: clave,
      p_sri_estado: null,
      p_sri_fecha_autorizacion: null,
      p_sri_xml: null,
      p_sri_sha256: null,
      p_sri_razon_social_emisor: null,
      p_sri_identificacion_comprador: null,
      p_sri_subtotal: null,
      p_sri_iva: null,
      p_sri_total: null,
      p_sri_ambiente: null,
      p_conciliacion_estado: null,
      p_conciliacion_diferencias: [],
      p_tipo_comprobante: 'electronica_pendiente_sri',
      p_sri_mensaje_error: sriMensajeError,
    })
    if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 422 })
    return NextResponse.json({ comprobante })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'No se pudo registrar la factura de compra'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
