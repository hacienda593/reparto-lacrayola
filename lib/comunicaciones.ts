// lib/comunicaciones.ts
//
// P0-04 de la auditoría operativa (docs/auditoria_operativa_aplicacion_entregas_2026-08-21.md):
// la comunicación con el cliente/shopper se hacía con enlaces wa.me sueltos —
// abrir el enlace no prueba que el mensaje se envió ni queda registro de qué
// se dijo, a quién, ni cuándo. Este helper centraliza el patrón: reservar la
// pestaña de WhatsApp de forma síncrona (para no chocar con el bloqueador de
// popups tras un await), registrar la comunicación vía RPC, y recién ahí
// redirigir la pestaña reservada al link real de WhatsApp.

import { supabase } from '@/lib/supabase'

export type TipoComunicacion =
  | 'pago_observado'
  | 'inicio_compra'
  | 'faltante_sustitucion'
  | 'compra_lista'
  | 'recogida_multitienda'
  | 'en_camino'
  | 'problema_ubicacion'
  | 'entrega_fallida'
  | 'entregado'
  | 'otro'

export type RolDestinatario = 'cliente' | 'shopper' | 'rider' | 'admin'

export function formatWhatsApp(telefono: string): string {
  const limpio = (telefono || '').replace(/\D/g, '')
  if (limpio.startsWith('0')) return '593' + limpio.slice(1)
  if (limpio.startsWith('9') && limpio.length === 9) return '593' + limpio
  return limpio
}

export function waLink(telefono: string, mensaje?: string): string {
  const base = `https://wa.me/${formatWhatsApp(telefono)}`
  return mensaje ? `${base}?text=${encodeURIComponent(mensaje)}` : base
}

/** Deja constancia de una comunicación sin abrir ningún enlace (uso interno / fire-and-forget). */
export async function registrarComunicacion(params: {
  pedidoId: string
  tipo: TipoComunicacion
  mensaje: string
  asignacionId?: string | null
  canal?: 'whatsapp' | 'llamada' | 'otro'
  telefono?: string | null
  destinatarioRol?: RolDestinatario
  requestId?: string
}) {
  const { error } = await supabase.rpc('registrar_comunicacion', {
    p_pedido_id: params.pedidoId,
    p_tipo: params.tipo,
    p_mensaje: params.mensaje,
    p_asignacion_id: params.asignacionId ?? null,
    p_canal: params.canal ?? 'whatsapp',
    p_destinatario_telefono: params.telefono ?? null,
    p_destinatario_rol: params.destinatarioRol ?? 'cliente',
    p_request_id: params.requestId ?? (typeof crypto !== 'undefined' ? crypto.randomUUID() : undefined),
  })
  if (error) console.error('registrar_comunicacion falló:', error.message)
}

/**
 * Reemplazo directo de `window.open(\`https://wa.me/...\`, '_blank')`: abre la
 * pestaña de WhatsApp de forma segura ante el bloqueador de popups (la
 * reserva ocurre síncronamente, en el mismo tick del click) y, en paralelo,
 * registra la comunicación. Si el registro falla, el mensaje igual se abre
 * -- la comunicación con el cliente no debe depender de que el log funcione.
 */
export function registrarYAbrirWhatsApp(params: {
  pedidoId: string
  tipo: TipoComunicacion
  mensaje: string
  telefono: string
  asignacionId?: string | null
  destinatarioRol?: RolDestinatario
  requestId?: string
}) {
  const ventana = typeof window !== 'undefined' ? window.open('', '_blank') : null
  void registrarComunicacion({
    pedidoId: params.pedidoId,
    tipo: params.tipo,
    mensaje: params.mensaje,
    asignacionId: params.asignacionId,
    canal: 'whatsapp',
    telefono: params.telefono,
    destinatarioRol: params.destinatarioRol ?? 'cliente',
    requestId: params.requestId,
  })
  const url = waLink(params.telefono, params.mensaje)
  if (ventana) ventana.location.href = url
  else if (typeof window !== 'undefined') window.open(url, '_blank')
}
