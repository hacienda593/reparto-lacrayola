'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { firmarUrlComprobante } from '@/lib/supabase/signedUrl'
import Sidebar from '@/components/Sidebar'
import { 
  Truck, Package, Users, Plus, Trash2, Loader2, 
  MapPin, CheckCircle, RefreshCw, AlertCircle, Info, ArrowRight,
  Phone, ExternalLink, Lock, Unlock, DollarSign, Check
} from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

interface Pedido {
  id: string
  numero: number
  nombre_cliente: string
  telefono: string
  direccion: string | null
  ciudad: string
  total: number
  estado: string
  created_at: string
  geo_lat?: number | null
  geo_lng?: number | null
  costo_envio?: number | null
  total_final?: number | null
  metodo_pago?: string | null
  pago_confirmado?: boolean | null
  referencia_transferencia?: string | null
  comprobante_transferencia_path?: string | null
  referencias?: string | null
  notas?: string | null
  user_id?: string | null
}

interface Repartidor {
  id: string
  nombre: string
  estado: string
  activo: boolean
}

interface Asignacion {
  id: string
  pedido_id: string
  repartidor_id: string
  estado: string
  prioridad: number
  rep_repartidores?: {
    nombre: string
  }
  shopper?: {
    nombre: string
  }
  rider?: {
    nombre: string
  }
}

export default function AsignacionesPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [repartidores, setRepartidores] = useState<Repartidor[]>([])
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [pickingData, setPickingData] = useState<any[]>([])
  
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  // Variables de estado para modal de validación GPS y pagos
  const [modalPedido, setModalPedido] = useState<Pedido | null>(null)
  const [direccionesCliente, setDireccionesCliente] = useState<any[]>([])
  const [direccionSeleccionada, setDireccionSeleccionada] = useState<string>('')
  const [nuevaDireccion, setNuevaDireccion] = useState({ nombre: 'Casa', lat: '', lng: '', referencias: '' })
  const [pegarCoords, setPegarCoords] = useState('')
  const [resolviendoEnlace, setResolviendoEnlace] = useState(false)
  const [errorEnlaceUbicacion, setErrorEnlaceUbicacion] = useState('')
  const [copiadoRef, setCopiadoRef] = useState(false)
  const [refInput, setRefInput] = useState('')
  const [guardandoRef, setGuardandoRef] = useState(false)
  const [comprobanteUrl, setComprobanteUrl] = useState<string | null>(null)
  const [cargandoComprobante, setCargandoComprobante] = useState(false)
  const [confirmoPorWhatsapp, setConfirmoPorWhatsapp] = useState(false)
  const [cargandoDirecciones, setCargandoDirecciones] = useState(false)
  const [refDuplicadaEn, setRefDuplicadaEn] = useState<number | null>(null)
  const [revirtiendoPago, setRevirtiendoPago] = useState(false)
  const [bancoInput, setBancoInput] = useState<'pichincha' | 'deuna' | 'otro'>('pichincha')
  const [fechaDepositoInput, setFechaDepositoInput] = useState('')
  // Auditoría financiera (docs/auditoria_financiera_ruta_dinero.md, C1/A1):
  // antes se confirmaba el pago sin registrar ni comparar ningún monto --
  // se aprobaba una referencia a ojo. Ahora se exige el monto que el admin
  // ve en el comprobante/banco, y se compara contra total + envío.
  const [montoConfirmadoInput, setMontoConfirmadoInput] = useState('')
  const [motivoDiferenciaInput, setMotivoDiferenciaInput] = useState('')
  const [calculandoEnvio, setCalculandoEnvio] = useState(false)
  const [historialVerif, setHistorialVerif] = useState<any[]>([])
  const [mostrarHistorial, setMostrarHistorial] = useState(false)

  // A7 de la auditoría financiera: un match genérico de "transferencia" en
  // cualquier parte de las notas es frágil -- cualquier comentario que
  // mencione la palabra (ej. "no puede recibir transferencia, solo
  // efectivo") clasificaría mal el pedido. La tienda siempre escribe la
  // misma etiqueta estructurada "[PAGO: Transferencia..." cuando aplica
  // (verificado contra datos reales); solo esa etiqueta cuenta.
  const isTransferencia = modalPedido
    ? (modalPedido.metodo_pago === 'transferencia' ||
       modalPedido.notas?.toLowerCase().includes('[pago: transferencia'))
    : false

  // Fuente de verdad: la columna referencia_transferencia (con indice unico
  // anti-fraude en la BD). Si el pedido es viejo y no la tiene, se cae al
  // parseo legacy desde `notas` como respaldo.
  const refMatch = modalPedido?.notas?.match(/Ref:\s*([a-zA-Z0-9]+)/i) || modalPedido?.notas?.match(/Referencia:\s*([a-zA-Z0-9]+)/i)
  const refNumber = modalPedido?.referencia_transferencia?.trim() || (refMatch ? refMatch[1].trim() : '')

  // Cliente nuevo = sin ninguna direccion previa registrada (ni en el
  // historial de reparto ni en la agenda de la tienda). A estos se les pide
  // una verificacion mas exhaustiva antes de aprobar.
  const esClienteNuevo = !cargandoDirecciones && direccionesCliente.length === 0 && !(modalPedido?.geo_lat && modalPedido?.geo_lng)

  // Ubicacion actualmente elegida en el Paso 3 (GPS), para poder incluirla en
  // los mensajes de WhatsApp de este mismo modal. Cubre las tres fuentes
  // posibles: la del pedido, una guardada en el historial, o la recien tipeada.
  const ubicacionSel = (() => {
    if (direccionSeleccionada === 'pedido' && modalPedido?.geo_lat && modalPedido?.geo_lng) {
      return { nombre: modalPedido.direccion || 'Ubicación del pedido', lat: modalPedido.geo_lat, lng: modalPedido.geo_lng }
    }
    const guardada = direccionesCliente.find(d => d.id === direccionSeleccionada)
    if (guardada) {
      return { nombre: guardada.nombre_direccion || guardada.direccion || 'Dirección guardada', lat: guardada.geo_lat, lng: guardada.geo_lng }
    }
    if (nuevaDireccion.lat && nuevaDireccion.lng) {
      return { nombre: nuevaDireccion.nombre || 'Dirección de entrega', lat: nuevaDireccion.lat, lng: nuevaDireccion.lng }
    }
    return null
  })()
  const ubicacionUrl = ubicacionSel ? `https://www.google.com/maps/search/?api=1&query=${ubicacionSel.lat},${ubicacionSel.lng}` : ''

  // Acepta lo que Google Maps copia al mantener presionado un punto ("lat, lng"),
  // el enlace completo que WhatsApp reenvía cuando el cliente comparte su
  // ubicación (esas coordenadas suelen ir en la propia URL, ej. "?q=lat,lng"
  // o "@lat,lng"), o -- si es un enlace acortado (maps.app.goo.gl, goo.gl/maps)
  // que no trae las coordenadas visibles -- se resuelve en el servidor
  // siguiendo la redirección real.
  async function parsearCoordenadas(texto: string) {
    setPegarCoords(texto)
    setErrorEnlaceUbicacion('')
    const match = texto.match(/(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/)
    if (match) {
      setNuevaDireccion(prev => ({ ...prev, lat: match[1], lng: match[2] }))
      return
    }

    const esEnlace = /^https?:\/\//i.test(texto.trim())
    if (!esEnlace) return

    setResolviendoEnlace(true)
    try {
      const resp = await fetch('/api/geo/resolver-enlace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: texto.trim() }),
      })
      const data = await resp.json()
      if (!resp.ok || typeof data.lat !== 'number' || typeof data.lng !== 'number') {
        setErrorEnlaceUbicacion(data.error || 'No se pudo leer la ubicación de ese enlace.')
        return
      }
      setNuevaDireccion(prev => ({ ...prev, lat: String(data.lat), lng: String(data.lng) }))
    } catch {
      setErrorEnlaceUbicacion('No se pudo leer la ubicación de ese enlace. Revisa tu conexión e intenta de nuevo.')
    } finally {
      setResolviendoEnlace(false)
    }
  }

  // Inserta en la bitacora de auditoria (tabla append-only, ver migracion
  // migration_auditoria_verificacion_pagos.sql). Deliberadamente no lanza:
  // si la migracion aun no se corrio en Supabase, la accion principal
  // (confirmar/anular/corregir referencia) no debe romperse por esto.
  async function registrarAuditoria(accion: 'confirmado' | 'anulado' | 'ref_corregida', extra: {
    referencia?: string, banco?: string, fecha_deposito?: string, notas?: string
  } = {}) {
    if (!modalPedido || !user) return
    try {
      await supabase.from('ol_pedidos_verificaciones').insert({
        pedido_id:      modalPedido.id,
        accion,
        referencia:     extra.referencia ?? refNumber ?? null,
        banco:          extra.banco ?? null,
        fecha_deposito: extra.fecha_deposito ?? null,
        admin_user_id:  user.id,
        admin_nombre:   (user as any).user_metadata?.full_name || user.email || 'Admin',
        notas:          extra.notas ?? null,
      })
      cargarHistorial(modalPedido.id)
    } catch (err) {
      console.error('No se pudo registrar en la bitácora de auditoría (¿falta correr la migración?):', err)
    }
  }

  async function cargarHistorial(pedidoId: string) {
    const { data } = await supabase
      .from('ol_pedidos_verificaciones')
      .select('*')
      .eq('pedido_id', pedidoId)
      .order('created_at', { ascending: false })
    setHistorialVerif(data ?? [])
  }

  async function abrirVerificacion(p: Pedido) {
    setModalPedido(p)
    setDireccionSeleccionada('')
    setNuevaDireccion({ nombre: 'Casa', lat: '', lng: '', referencias: p.referencias || '' })
    setPegarCoords('')
    setRefInput(p.referencia_transferencia || '')
    setConfirmoPorWhatsapp(false)
    setRefDuplicadaEn(null)
    setComprobanteUrl(null)
    setBancoInput('pichincha')
    setFechaDepositoInput(new Date().toISOString().split('T')[0])
    setHistorialVerif([])
    setMostrarHistorial(false)
    setCargandoDirecciones(true)
    setMontoConfirmadoInput('')
    setMotivoDiferenciaInput('')
    cargarHistorial(p.id)

    // El envío tiene que estar calculado ANTES de poder confirmar el pago
    // (confirmar_pago_admin ahora lo exige) -- se dispara acá si todavía
    // falta, en vez de esperar a que alguien más lo abra primero.
    if (p.costo_envio == null && p.geo_lat != null && p.geo_lng != null) {
      setCalculandoEnvio(true)
      fetch('/api/envio/calcular-pedido', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId: p.id }),
      }).then(res => res.json()).then(data => {
        if (typeof data?.envio === 'number') {
          setModalPedido(prev => prev && prev.id === p.id ? { ...prev, costo_envio: data.envio } as any : prev)
          setPedidos(prev => prev.map(x => x.id === p.id ? { ...x, costo_envio: data.envio } as any : x))
        }
      }).catch(() => {}).finally(() => setCalculandoEnvio(false))
    }

    // Chequeo proactivo de comprobante duplicado: si el numero ya vino cargado
    // desde el checkout (no fue tecleado a mano aqui), nunca pasaba por el
    // unique-index de la BD hasta este momento. Se revisa apenas se abre el
    // modal para no confiar solo en que el admin decida "corregir" el campo.
    const refDelPedido = p.referencia_transferencia?.trim()
      || p.notas?.match(/Ref:\s*([a-zA-Z0-9]+)/i)?.[1]
      || p.notas?.match(/Referencia:\s*([a-zA-Z0-9]+)/i)?.[1]
    if (refDelPedido) {
      supabase.from('ol_pedidos')
        .select('numero')
        .eq('referencia_transferencia', refDelPedido.trim())
        .neq('id', p.id)
        .limit(1)
        .then(({ data }) => {
          if (data && data.length > 0) setRefDuplicadaEn(data[0].numero)
        })
    }

    try {
      // 1. Cargar desde rep_clientes_direcciones (historial de motorizados)
      const { data: repDirs, error: errRep } = await supabase
        .from('rep_clientes_direcciones')
        .select('*')
        .eq('telefono', p.telefono)
      if (errRep) throw errRep

      // 2. Cargar desde ol_direcciones_cliente (agenda de la tienda del cliente)
      let storeDirs: any[] = []
      if (p.user_id) {
        const { data: sDirs } = await supabase
          .from('ol_direcciones_cliente')
          .select('*')
          .eq('user_id', p.user_id)
        storeDirs = sDirs || []
      }

      // Combinar ambas listas
      const combinadas = [
        ...(repDirs || []).map(d => ({
          id: d.id,
          nombre_direccion: d.nombre_direccion || 'Dirección de Reparto',
          direccion: d.direccion,
          geo_lat: d.geo_lat,
          geo_lng: d.geo_lng,
          verificada: d.verificada,
          origen: 'reparto'
        })),
        ...storeDirs.map(d => ({
          id: d.id,
          nombre_direccion: `📍 Tienda: ${d.nombre_etiqueta || 'Mi dirección'}`,
          direccion: d.direccion_texto,
          geo_lat: d.geo_lat,
          geo_lng: d.geo_lng,
          verificada: false,
          origen: 'tienda'
        }))
      ]

      setDireccionesCliente(combinadas)
      
      // Auto-seleccionar si el pedido vino con coordenadas de origen en la tienda
      if (p.geo_lat && p.geo_lng) {
        setDireccionSeleccionada('pedido')
      } else {
        const verif = combinadas.find(d => d.verificada)
        if (verif) {
          setDireccionSeleccionada(verif.id)
        }
      }
    } catch (err) {
      console.error("Error al cargar direcciones:", err)
    } finally {
      setCargandoDirecciones(false)
    }
  }

  // Foto del comprobante que el cliente adjuntó en el checkout de la tienda
  // (bucket privado comprobantes-clientes). Se firma bajo demanda (no al
  // abrir el modal) porque no todos los pedidos por transferencia la tienen
  // y no vale la pena una llamada extra a Storage por cada uno que se abre.
  async function verComprobante(path: string) {
    setCargandoComprobante(true)
    try {
      const url = await firmarUrlComprobante(supabase, path, 3600, 'comprobantes-clientes')
      if (!url) { setError('No se pudo cargar la imagen del comprobante.'); return }
      setComprobanteUrl(url)
    } finally {
      setCargandoComprobante(false)
    }
  }

  // Guarda/corrige el numero de comprobante que el administrador escribio o
  // pego a mano (ej. tras verificarlo en el app del banco o pedirselo al
  // cliente por WhatsApp). No marca el pago como conciliado por si solo.
  async function guardarReferencia(pedidoId: string, valor: string) {
    const limpio = valor.trim()
    if (!limpio) return
    setGuardandoRef(true)
    setError('')
    try {
      const { error } = await supabase
        .from('ol_pedidos')
        .update({ referencia_transferencia: limpio })
        .eq('id', pedidoId)
      if (error) throw error

      setPedidos(prev => prev.map(p => p.id === pedidoId ? { ...p, referencia_transferencia: limpio } : p))
      setModalPedido(prev => prev && prev.id === pedidoId ? { ...prev, referencia_transferencia: limpio } : prev)
      // Si el guardado paso el indice unico de la BD, este numero ya no esta duplicado.
      setRefDuplicadaEn(null)
      registrarAuditoria('ref_corregida', { referencia: limpio })
    } catch (err: any) {
      // El indice unico de la BD rechaza el guardado si ese numero de
      // comprobante ya fue usado en otro pedido (posible fraude/duplicado).
      setError(err.message?.includes('duplicate')
        ? '⚠️ Este número de comprobante ya fue registrado en otro pedido. Verifica con el cliente.'
        : `Error al guardar referencia: ${err.message}`)
    } finally {
      setGuardandoRef(false)
    }
  }

  async function confirmarPagoPedido(pedidoId: string) {
    const monto = parseFloat(montoConfirmadoInput)
    if (!montoConfirmadoInput.trim() || isNaN(monto) || monto <= 0) {
      setError('Ingresa el monto que confirmaste en el comprobante/banco')
      return
    }
    setProcesando(true)
    setError('')
    try {
      // RPC atómica: valida capacidad del rol, bloquea el pedido, actualiza
      // pago_confirmado y registra la bitácora de auditoría en una sola
      // transacción de Postgres. Ahora exige el monto y lo compara contra
      // total + envío (docs/auditoria_financiera_ruta_dinero.md, C1/A1).
      const { error } = await supabase.rpc('confirmar_pago_admin', {
        p_pedido_id: pedidoId,
        p_referencia: refNumber,
        p_monto: monto,
        p_banco: bancoInput,
        p_fecha: fechaDepositoInput || null,
        p_evidencia_path: null,
        p_motivo_diferencia: motivoDiferenciaInput.trim() || null,
        p_request_id: crypto.randomUUID(),
      })
      if (error) throw error

      setPedidos(prev => prev.map(p => p.id === pedidoId ? { ...p, pago_confirmado: true } as any : p))
      setModalPedido(prev => prev && prev.id === pedidoId ? { ...prev, pago_confirmado: true } as any : prev)
      setMensaje('✓ Pago validado y registrado en el sistema.')
      cargarHistorial(pedidoId)
    } catch (err: any) {
      setError(`Error al confirmar pago: ${err.message}`)
    } finally {
      setProcesando(false)
    }
  }

  // Revierte una conciliacion marcada por error. No borra el numero de
  // comprobante (queda guardado para no perder el dato), solo el estado de
  // "verificado" — asi el admin puede volver a revisarlo con calma.
  async function revertirPago(pedidoId: string) {
    // El motivo es obligatorio: es el dato que mas importa cuando alguien
    // revise el historial despues (¿fue un error de tipeo, un reclamo del
    // cliente, algo mas serio?).
    const motivo = prompt('¿Por qué se anula esta verificación? (obligatorio, queda en el historial de auditoría)')
    if (motivo === null) return
    if (!motivo.trim()) { alert('Debes indicar un motivo para anular.'); return }

    setRevirtiendoPago(true)
    setError('')
    try {
      // RPC atómica: exige motivo, bloquea el pedido y registra el reverso
      // en la misma transacción (migration_confirmacion_pago_atomica.sql).
      const { error } = await supabase.rpc('revertir_pago_admin', {
        p_pedido_id: pedidoId,
        p_motivo: motivo.trim(),
        p_request_id: crypto.randomUUID(),
      })
      if (error) throw error

      setPedidos(prev => prev.map(p => p.id === pedidoId ? { ...p, pago_confirmado: false } as any : p))
      setModalPedido(prev => prev && prev.id === pedidoId ? { ...prev, pago_confirmado: false } as any : prev)
      setMensaje('↩️ Verificación de pago anulada.')
      cargarHistorial(pedidoId)
    } catch (err: any) {
      setError(`Error al anular verificación: ${err.message}`)
    } finally {
      setRevirtiendoPago(false)
    }
  }

  async function liberarPedido(p: Pedido) {
    setProcesando(true)
    setError('')
    try {
      let lat = p.geo_lat
      let lng = p.geo_lng

      if (direccionSeleccionada === 'pedido') {
        lat = p.geo_lat
        lng = p.geo_lng
        // Guardar/Verificar dirección en el listado de reparto
        try {
          const { data: extDir } = await supabase
            .from('rep_clientes_direcciones')
            .select('id')
            .eq('telefono', p.telefono)
            .eq('direccion', p.direccion || '')
          if (!extDir || extDir.length === 0) {
            await supabase.from('rep_clientes_direcciones').insert({
              telefono: p.telefono,
              nombre_direccion: 'Dirección Tienda',
              direccion: p.direccion || 'Dirección de Entrega',
              ciudad: p.ciudad,
              referencias: p.referencias || '',
              geo_lat: lat,
              geo_lng: lng,
              verificada: true
            })
          }
        } catch (e) {
          console.error("Error al registrar en agenda:", e)
        }
      } else if (direccionSeleccionada) {
        const dSel = direccionesCliente.find(d => d.id === direccionSeleccionada)
        if (dSel) {
          lat = dSel.geo_lat
          lng = dSel.geo_lng
        }
      } else if (nuevaDireccion.lat && nuevaDireccion.lng) {
        const latNum = parseFloat(nuevaDireccion.lat)
        const lngNum = parseFloat(nuevaDireccion.lng)
        
        const { error: errDir } = await supabase
          .from('rep_clientes_direcciones')
          .insert({
            telefono: p.telefono,
            nombre_direccion: nuevaDireccion.nombre,
            direccion: p.direccion || 'Sin dirección',
            ciudad: p.ciudad,
            referencias: nuevaDireccion.referencias,
            geo_lat: latNum,
            geo_lng: lngNum,
            verificada: true
          })
        if (errDir) throw errDir
        
        lat = latNum
        lng = lngNum
      }

      const { error: errPed } = await supabase
        .from('ol_pedidos')
        .update({
          estado: 'confirmado',
          geo_lat: lat,
          geo_lng: lng
        })
        .eq('id', p.id)
      if (errPed) throw errPed

      setPedidos(prev => prev.map(o => o.id === p.id ? { ...o, estado: 'confirmado', geo_lat: lat, geo_lng: lng } as any : o))
      setMensaje('✓ Pedido confirmado y liberado para Auto-Asignación.')
      setModalPedido(null)
      await cargarDatos()
    } catch (err: any) {
      setError(`Error al liberar pedido: ${err.message}`)
    } finally {
      setProcesando(false)
    }
  }

  async function cargarDatos() {
    setCargando(true)
    setError('')
    setMensaje('')
    try {
      // Estas tres consultas no dependen entre si, se piden en paralelo en vez de
      // una tras otra para acelerar la carga inicial de la torre de control.
      const [
        { data: dataPed, error: errPed },
        { data: dataRep, error: errRep },
        { data: dataAsig, error: errAsig },
      ] = await Promise.all([
        supabase.from('ol_pedidos').select('*').order('numero', { ascending: false }).limit(30),
        supabase.from('rep_repartidores').select('id, nombre, estado, activo').eq('activo', true).order('nombre'),
        supabase.from('rep_asignaciones').select(`
          *,
          shopper:rep_repartidores!rep_asignaciones_shopper_id_fkey(nombre),
          rider:rep_repartidores!rep_asignaciones_rider_id_fkey(nombre),
          rep_repartidores!rep_asignaciones_repartidor_id_fkey(nombre)
        `).in('estado', ['asignado', 'recolectado', 'en_ruta']),
      ])

      if (errPed) throw errPed
      setPedidos(dataPed || [])

      if (errRep) throw errRep
      setRepartidores(dataRep || [])

      if (errAsig) throw errAsig
      setAsignaciones((dataAsig || []) as any)

      const activePedidoIds = dataAsig?.map((a: any) => a.pedido_id) || []
      if (activePedidoIds.length > 0) {
        const { data: pickData, error: errPick } = await supabase
          .from('rep_picking')
          .select('pedido_id, estado')
          .in('pedido_id', activePedidoIds)
        if (errPick) throw errPick
        setPickingData(pickData || [])
      } else {
        setPickingData([])
      }

    } catch (err: any) {
      setError(`Error al cargar datos: ${err.message}`)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargarDatos()

    // Refresco en tiempo real: nuevo pedido, cambio de estado, o cambio de asignacion
    const canal = supabase
      .channel('asignaciones-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ol_pedidos' }, () => cargarDatos())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rep_asignaciones' }, () => cargarDatos())
      .subscribe()

    return () => { supabase.removeChannel(canal) }
  }, [])

  async function forzarAsignacion(pedidoId: string, repartidorId: string, pedido?: Pedido) {
    if (!pedidoId || !repartidorId) return

    // Segunda capa de seguridad ademas de deshabilitar el boton en la UI: este
    // atajo ("Forzar Shopper") hacia exactamente lo mismo que "Liberar al
    // Pool" (marcaba el pedido como 'confirmado') pero sin pasar por NINGUNA
    // de las dos validaciones del modal. Si el pago por transferencia sigue
    // pendiente, no se permite asignar bajo ninguna circunstancia desde aqui.
    const esTransferenciaPend = pedido && (
      pedido.metodo_pago === 'transferencia' ||
      pedido.notas?.toLowerCase().includes('[pago: transferencia')
    ) && !pedido.pago_confirmado
    if (esTransferenciaPend) {
      setError('No se puede asignar: el pago por transferencia de este pedido aún no ha sido validado. Usa "Validar Pago & GPS" primero.')
      return
    }

    setProcesando(true)
    setError('')
    setMensaje('')
    try {
      const { error: errInsert } = await supabase
        .from('rep_asignaciones')
        .insert({
          pedido_id:     pedidoId,
          repartidor_id: repartidorId,
          shopper_id:    repartidorId,
          prioridad:     1,
          notas:         'Asignación forzada manualmente por el Administrador',
          estado:        'asignado'
        })
      if (errInsert) throw errInsert

      const { error: errUpdate } = await supabase
        .from('ol_pedidos')
        .update({ estado: 'confirmado' })
        .eq('id', pedidoId)
      if (errUpdate) throw errUpdate

      setMensaje('✓ Pedido asignado con éxito (Fuerza Mayor).')
      await cargarDatos()
    } catch (err: any) {
      setError(`Error al forzar asignación: ${err.message}`)
    } finally {
      setProcesando(false)
    }
  }

  async function forzarTraspaso(asigId: string, pedidoId: string, repartidorId: string) {
    if (!asigId || !repartidorId) return
    if (!confirm('¿Estás seguro de que deseas forzar el traspaso al repartidor seleccionado?')) return
    setProcesando(true)
    setError('')
    setMensaje('')
    try {
      const { error: errAsig } = await supabase
        .from('rep_asignaciones')
        .update({
          repartidor_id: repartidorId,
          rider_id:      repartidorId,
          handoff_at:    new Date().toISOString(),
          estado:        'en_ruta',
          updated_at:    new Date().toISOString()
        })
        .eq('id', asigId)
      if (errAsig) throw errAsig

      const { error: errUpdate } = await supabase
        .from('ol_pedidos')
        .update({ estado: 'enviado' })
        .eq('id', pedidoId)
      if (errUpdate) throw errUpdate

      setMensaje('✓ Traspaso forzado con éxito. Pedido en ruta.')
      await cargarDatos()
    } catch (err: any) {
      setError(`Error al forzar traspaso: ${err.message}`)
    } finally {
      setProcesando(false)
    }
  }

  async function desasignarPedido(asigId: string, pedidoId: string) {
    if (!confirm('¿Estás seguro de que deseas eliminar esta asignación y liberar el pedido?')) return

    setProcesando(true)
    setError('')
    setMensaje('')

    try {
      const { error: errDel } = await supabase
        .from('rep_asignaciones')
        .delete()
        .eq('id', asigId)
      
      if (errDel) throw errDel

      const { error: errUpdate } = await supabase
        .from('ol_pedidos')
        .update({ estado: 'pendiente' })
        .eq('id', pedidoId)

      if (errUpdate) throw errUpdate

      setMensaje('✓ Asignación eliminada. El pedido vuelve a estar libre.')
      await cargarDatos()
    } catch (err: any) {
      setError(`Error al eliminar asignación: ${err.message}`)
    } finally {
      setProcesando(false)
    }
  }

  const libresCount = pedidos.filter(p => !asignaciones.some(a => a.pedido_id === p.id) && p.estado !== 'entregado').length
  const slaAlertsCount = pedidos.filter(p => {
    const isFree = !asignaciones.some(a => a.pedido_id === p.id) && p.estado !== 'entregado'
    if (!isFree) return false
    const elapsed = (Date.now() - new Date(p.created_at).getTime()) / 60000
    return elapsed > 10
  }).length
  const pickingCount = asignaciones.filter(a => a.estado === 'asignado').length
  const rutaCount = asignaciones.filter(a => a.estado === 'en_ruta').length

  return (
    <div className="flex min-h-screen bg-[#0c0f12] text-white">
      <Sidebar />
      
      <main className="flex-1 md:ml-56 pt-14 md:pt-0 p-4 md:p-6 space-y-6">
        
        <div className="flex items-center justify-between flex-wrap gap-3 border-b border-gray-800 pb-4">
          <div>
            <h1 className="text-2xl font-black text-white flex items-center gap-2">
              <Truck size={24} className="text-green-500" /> TORRE DE CONTROL DE DESPACHOS
            </h1>
            <p className="text-gray-400 text-xs mt-1">
              Monitoreo operativo y despacho en tiempo real (Shopper-First & Dispatcher Pool)
            </p>
          </div>
          <button 
            onClick={cargarDatos}
            disabled={cargando}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-xs px-3.5 py-2 rounded-xl font-bold transition cursor-pointer">
            <RefreshCw size={13} className={cargando ? 'animate-spin text-green-500' : ''} />
            Actualizar
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3.5 rounded-xl flex items-center gap-2">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        {mensaje && (
          <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-xs p-3.5 rounded-xl flex items-center gap-2">
            <CheckCircle size={16} />
            <span>{mensaje}</span>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 flex flex-col justify-between">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Pedidos Libres</span>
            <span className="text-2xl font-black text-white mt-1">{libresCount}</span>
          </div>
          <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 flex flex-col justify-between">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Alertas SLA (&gt;10 min)</span>
            <span className={`text-2xl font-black mt-1 ${slaAlertsCount > 0 ? 'text-red-400 animate-pulse' : 'text-gray-400'}`}>{slaAlertsCount}</span>
          </div>
          <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 flex flex-col justify-between">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">En Picking (Shoppers)</span>
            <span className="text-2xl font-black text-indigo-400 mt-1">{pickingCount}</span>
          </div>
          <div className="bg-[#181d24] border border-[#2d3748] rounded-2xl p-4 flex flex-col justify-between">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">En Ruta (Riders)</span>
            <span className="text-2xl font-black text-orange-400 mt-1">{rutaCount}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          
          <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-4 flex flex-col min-h-[500px]">
            <div className="border-b border-gray-800 pb-3 flex justify-between items-center">
              <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
                <Package size={16} className="text-green-500" /> Pool de Espera (Libres)
              </h2>
              <span className="bg-green-500/10 text-green-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                {libresCount}
              </span>
            </div>
            
            <div className="space-y-3 flex-1 overflow-y-auto max-h-[550px] pr-1">
              {pedidos
                .filter(p => !asignaciones.some(a => a.pedido_id === p.id) && p.estado !== 'entregado')
                .map(p => {
                  const created = new Date(p.created_at).getTime()
                  const elapsedMin = Math.floor((Date.now() - created) / 60000)
                  const esRetrasado = elapsedMin > 10

                  const esTransferencia = p.metodo_pago === 'transferencia'
                  const necesitaValidarPago = esTransferencia && !p.pago_confirmado
                  const gpsVerificado = p.geo_lat && p.geo_lng

                  // Determinar borde y fondo según el estado de pago
                  const borderClass = necesitaValidarPago 
                    ? 'border-orange-500/40 bg-orange-950/10' 
                    : 'border-[#2d3748] bg-[#0c0f12]'

                  return (
                    <div key={p.id} className={`border rounded-2xl p-4 space-y-3 transition ${borderClass}`}>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-green-400">Pedido #{String(p.numero).padStart(4,'0')}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          esRetrasado ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-gray-800 text-gray-400'
                        }`}>
                          ⏱️ Hace {elapsedMin} min
                        </span>
                      </div>
                      
                      <div className="space-y-1">
                        <div className="font-extrabold text-xs text-white">{p.nombre_cliente}</div>
                        <div className="text-[10px] text-gray-500">{p.direccion || 'Sin dirección'}, {p.ciudad}</div>
                        <div className="text-xs font-black text-white pt-1">{fmt(p.total)}</div>
                      </div>

                      {/* Badges de Estado Operativo */}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {esTransferencia ? (
                          <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-md border ${
                            p.pago_confirmado 
                              ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                              : 'bg-orange-500/10 text-orange-400 border-orange-500/20 animate-pulse'
                          }`}>
                            🏦 Transferencia {p.pago_confirmado ? '(Pagado)' : '(Por Validar)'}
                          </span>
                        ) : (
                          <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-md border bg-blue-500/10 text-blue-400 border-blue-500/20">
                            💵 Contra-Entrega (Efectivo)
                          </span>
                        )}

                        {gpsVerificado ? (
                          <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-md border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                            📍 GPS Verificado
                          </span>
                        ) : (
                          <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-md border bg-rose-500/10 text-rose-400 border-rose-500/20 animate-pulse">
                            ⚠️ Falta GPS
                          </span>
                        )}

                        <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-md border ${
                          p.estado === 'confirmado' 
                            ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                            : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                        }`}>
                          {p.estado === 'confirmado' ? '✓ Confirmado (Pool)' : '⏳ Pendiente'}
                        </span>
                      </div>
                      
                      <div className="pt-2 border-t border-gray-850 flex flex-col gap-2">
                        <button
                          onClick={() => abrirVerificacion(p)}
                          className="w-full bg-green-600 hover:bg-green-500 text-white font-extrabold text-[10px] py-1.5 rounded-xl transition cursor-pointer flex items-center justify-center gap-1">
                          🔍 Validar Pago & GPS
                        </button>
                        
                        <div className="flex gap-2 mt-1">
                          <select
                            id={`select-rep-${p.id}`}
                            defaultValue=""
                            className="flex-1 bg-[#0c0f12] border border-[#2d3748] rounded-xl px-2 py-1 text-[10px] text-white focus:outline-none focus:border-green-500">
                            <option value="">-- Forzar Shopper --</option>
                            {repartidores.map(r => (
                              <option key={r.id} value={r.id}>{r.nombre}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => {
                              const sel = document.getElementById(`select-rep-${p.id}`) as HTMLSelectElement
                              const nombreSel = sel.options[sel.selectedIndex]?.text
                              if (sel.value && confirm(`¿Asignar el pedido #${String(p.numero).padStart(4,'0')} a ${nombreSel}?`)) {
                                forzarAsignacion(p.id, sel.value, p)
                              }
                            }}
                            disabled={procesando || (esTransferencia && !p.pago_confirmado)}
                            title={esTransferencia && !p.pago_confirmado ? 'Primero valida el pago por transferencia con "Validar Pago & GPS"' : undefined}
                            className="bg-gray-800 hover:bg-gray-700 border border-gray-750 text-white font-bold text-[10px] px-3 py-1 rounded-xl transition cursor-pointer shrink-0 disabled:opacity-30 disabled:cursor-not-allowed">
                            ⚡ Asignar
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })
              }
              {libresCount === 0 && (
                <p className="text-xs text-gray-500 text-center py-12">No hay pedidos en cola de espera.</p>
              )}
            </div>
          </div>

          <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-4 flex flex-col min-h-[500px]">
            <div className="border-b border-gray-800 pb-3 flex justify-between items-center">
              <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
                <Users size={16} className="text-green-500" /> Compras en Curso (Picking)
              </h2>
              <span className="bg-indigo-500/10 text-indigo-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                {pickingCount}
              </span>
            </div>
            
            <div className="space-y-3 flex-1 overflow-y-auto max-h-[550px] pr-1">
              {asignaciones
                .filter(a => a.estado === 'asignado')
                .map(a => {
                  const ped = pedidos.find(p => p.id === a.pedido_id)
                  const items = pickingData.filter(i => i.pedido_id === a.pedido_id)
                  const compl = items.filter(i => i.estado !== 'pendiente').length
                  const pct = items.length > 0 ? Math.round((compl / items.length) * 100) : 0
                  
                  return (
                    <div key={a.id} className="bg-[#0c0f12] border border-[#2d3748] rounded-2xl p-4 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-green-400">Pedido #{ped ? String(ped.numero).padStart(4,'0') : '????'}</span>
                        <span className="bg-indigo-500/10 text-indigo-400 text-[10px] font-bold px-2 py-0.5 rounded-md">
                          🛒 En Compra
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="font-extrabold text-xs text-white">{ped?.nombre_cliente || 'Desconocido'}</div>
                        <div className="text-[10px] text-gray-400 font-semibold flex items-center gap-1">
                          👤 Shopper: {a.shopper?.nombre || a.rep_repartidores?.nombre || 'Desconocido'}
                        </div>
                      </div>

                      {items.length > 0 ? (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[9px] text-gray-400">
                            <span>Picking: {compl} de {items.length} items</span>
                            <span className="font-bold">{pct}%</span>
                          </div>
                          <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                            <div className="bg-green-500 h-full rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      ) : (
                        <div className="text-[9px] text-yellow-500/80 bg-yellow-500/5 px-2 py-1 rounded-md">
                          ⚠️ Preparando lista de picking...
                        </div>
                      )}

                      <div className="pt-2 border-t border-gray-850 flex justify-between items-center">
                        <span className="text-xs font-black text-green-400">{fmt(ped?.total ?? 0)}</span>
                        <button
                          onClick={() => desasignarPedido(a.id, a.pedido_id)}
                          disabled={procesando}
                          className="text-red-400 hover:text-red-300 text-[10px] font-bold flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-red-500/10 transition cursor-pointer">
                          <Trash2 size={11} /> Liberar Pedido
                        </button>
                      </div>
                    </div>
                  )
                })
              }
              {pickingCount === 0 && (
                <p className="text-xs text-gray-500 text-center py-12">No hay compras activas en este momento.</p>
              )}
            </div>
          </div>

          <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-4 flex flex-col min-h-[500px]">
            <div className="border-b border-gray-800 pb-3 flex justify-between items-center">
              <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
                <Truck size={16} className="text-green-500" /> Despacho y Ruta
              </h2>
              <span className="bg-orange-500/10 text-orange-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                {asignaciones.filter(a => a.estado === 'recolectado' || a.estado === 'en_ruta').length}
              </span>
            </div>
            
            <div className="space-y-3 flex-1 overflow-y-auto max-h-[550px] pr-1">
              {asignaciones
                .filter(a => a.estado === 'recolectado' || a.estado === 'en_ruta')
                .map(a => {
                  const ped = pedidos.find(p => p.id === a.pedido_id)
                  const esCaja = a.estado === 'recolectado'
                  
                  return (
                    <div key={a.id} className="bg-[#0c0f12] border border-[#2d3748] rounded-2xl p-4 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-green-400">Pedido #{ped ? String(ped.numero).padStart(4,'0') : '????'}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          esCaja ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' : 'bg-orange-500/10 text-orange-400'
                        }`}>
                          {esCaja ? '🛍️ Listo en Caja' : '🛵 En Ruta'}
                        </span>
                      </div>
                      
                      <div className="space-y-1">
                        <div className="font-extrabold text-xs text-white">{ped?.nombre_cliente || 'Desconocido'}</div>
                        <div className="text-[10px] text-gray-400 font-semibold">
                          👤 Shopper: {a.shopper?.nombre || a.rep_repartidores?.nombre || 'Desconocido'} {a.rider?.nombre ? `· Rider: ${a.rider.nombre}` : ''}
                        </div>
                      </div>

                      {esCaja && (
                        <div className="pt-2 border-t border-gray-850 flex gap-2">
                          <select
                            id={`select-rider-${a.id}`}
                            defaultValue=""
                            className="flex-1 bg-[#0c0f12] border border-[#2d3748] rounded-xl px-2 py-1 text-[10px] text-white focus:outline-none focus:border-green-500">
                            <option value="">-- Forzar Rider --</option>
                            {repartidores.map(r => (
                              <option key={r.id} value={r.id}>{r.nombre}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => {
                              const sel = document.getElementById(`select-rider-${a.id}`) as HTMLSelectElement
                              if (sel.value) forzarTraspaso(a.id, a.pedido_id, sel.value)
                            }}
                            disabled={procesando}
                            className="bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-[10px] px-3 py-1 rounded-xl transition cursor-pointer">
                            📲 Despachar
                          </button>
                        </div>
                      )}

                      <div className="pt-2 border-t border-gray-850 flex justify-between items-center">
                        <span className="text-xs font-black text-green-400">{fmt(ped?.total ?? 0)}</span>
                        <button
                          onClick={() => desasignarPedido(a.id, a.pedido_id)}
                          disabled={procesando}
                          className="text-red-400 hover:text-red-300 text-[10px] font-bold flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-red-500/10 transition cursor-pointer">
                          <Trash2 size={11} /> Cancelar
                        </button>
                      </div>
                    </div>
                  )
                })
              }
              {asignaciones.filter(a => a.estado === 'recolectado' || a.estado === 'en_ruta').length === 0 && (
                <p className="text-xs text-gray-500 text-center py-12">No hay despachos ni rutas activas.</p>
              )}
            </div>
          </div>

        </div>

        <div className="bg-[#181d24] border border-[#2d3748] rounded-3xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2 border-b border-gray-800 pb-3">
            <Package size={16} className="text-green-500" /> Historial de Pedidos Recientes
          </h2>

          {cargando ? (
            <div className="flex justify-center py-10">
              <Loader2 size={24} className="animate-spin text-green-500" />
            </div>
          ) : (
            <>
              {/* Celular: tarjetas apiladas, mas facil de leer y tocar con una mano */}
              <div className="md:hidden space-y-2">
                {pedidos.map(p => {
                  const asig = asignaciones.find(a => a.pedido_id === p.id)
                  return (
                    <button
                      key={p.id}
                      onClick={() => router.push(`/pedidos/${p.id}`)}
                      className="w-full text-left bg-[#0c0f12] border border-[#2d3748] rounded-2xl p-3.5 space-y-2 active:bg-gray-800/60 transition">
                      <div className="flex justify-between items-center">
                        <span className="font-mono text-green-400 font-bold text-xs">#{String(p.numero).padStart(4,'0')}</span>
                        <span className="font-black text-white text-xs">{fmt(p.total)}</span>
                      </div>
                      <div className="font-semibold text-white text-sm">{p.nombre_cliente}</div>
                      <div className="flex items-center gap-1 text-gray-400 text-[11px]">
                        <MapPin size={11} className="shrink-0" />
                        <span className="truncate">{p.direccion ? `${p.direccion}, ${p.ciudad}` : p.ciudad}</span>
                      </div>
                      <div>
                        {asig ? (
                          <span className="inline-block bg-green-500/10 text-green-400 px-2.5 py-1 rounded-full text-[10px] font-bold">
                            👤 S: {asig.shopper?.nombre || asig.rep_repartidores?.nombre} {asig.rider?.nombre ? `· R: ${asig.rider.nombre}` : ''} ({asig.estado})
                          </span>
                        ) : p.estado === 'entregado' ? (
                          <span className="inline-block bg-slate-800 text-slate-500 px-2.5 py-1 rounded-full text-[10px] font-semibold">
                            Entregado
                          </span>
                        ) : (
                          <span className="inline-block bg-yellow-500/10 text-yellow-400 px-2.5 py-1 rounded-full text-[10px] font-bold">
                            En Espera
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Escritorio: tabla completa */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-800">
                      <th className="py-2.5 font-bold">Número</th>
                      <th className="py-2.5 font-bold">Cliente</th>
                      <th className="py-2.5 font-bold">Dirección / Ciudad</th>
                      <th className="py-2.5 font-bold">Total</th>
                      <th className="py-2.5 font-bold text-center">Asignación / Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-850">
                    {pedidos.map(p => {
                      const asig = asignaciones.find(a => a.pedido_id === p.id)
                      return (
                        <tr key={p.id} onClick={() => router.push(`/pedidos/${p.id}`)} className="hover:bg-gray-800/40 cursor-pointer">
                          <td className="py-2.5 font-mono text-green-400 font-bold">#{String(p.numero).padStart(4,'0')}</td>
                          <td className="py-2.5 font-semibold text-white">{p.nombre_cliente}</td>
                          <td className="py-2.5 text-gray-400">
                            <span className="flex items-center gap-0.5 truncate max-w-xs">
                              <MapPin size={10} className="shrink-0" />
                              {p.direccion ? `${p.direccion}, ${p.ciudad}` : p.ciudad}
                            </span>
                          </td>
                          <td className="py-2.5 font-bold text-white">{fmt(p.total)}</td>
                          <td className="py-2.5 text-center">
                            {asig ? (
                              <span className="bg-green-500/10 text-green-400 px-2.5 py-1 rounded-full text-[9px] font-bold">
                                👤 S: {asig.shopper?.nombre || asig.rep_repartidores?.nombre} {asig.rider?.nombre ? `· R: ${asig.rider.nombre}` : ''} ({asig.estado})
                              </span>
                            ) : p.estado === 'entregado' ? (
                              <span className="bg-slate-800 text-slate-500 px-2.5 py-1 rounded-full text-[9px] font-semibold">
                                Entregado
                              </span>
                            ) : (
                              <span className="bg-yellow-500/10 text-yellow-400 px-2.5 py-1 rounded-full text-[9px] font-bold">
                                En Espera
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* MODAL DE VALIDACIÓN DE PAGO Y DIRECCIÓN GPS */}
        {modalPedido && (
            <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-[#11161d] border border-[#2d3748] rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-[#080b0e]">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-white text-base">Validación de Pedido #{String(modalPedido.numero).padStart(4, '0')}</h3>
                      {cargandoDirecciones ? (
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 flex items-center gap-1">
                          <Loader2 size={9} className="animate-spin" /> Revisando historial...
                        </span>
                      ) : esClienteNuevo ? (
                        <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30">
                          🆕 CLIENTE NUEVO
                        </span>
                      ) : (
                        <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
                          🔁 CLIENTE FRECUENTE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      {esClienteNuevo
                        ? 'Sin pedidos previos — verificación reforzada de pago y ubicación'
                        : 'Verificación obligatoria de pago y localización GPS'}
                    </p>
                  </div>
                  <button
                    onClick={() => setModalPedido(null)}
                    className="text-gray-400 hover:text-white text-xl font-bold p-1 cursor-pointer transition">
                    &times;
                  </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-5 overflow-y-auto flex-1 text-left">
                  
                  {/* PASO 1: DATOS DE ENTREGA */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-black text-gray-450 uppercase tracking-wider">
                      <span className="w-4 h-4 rounded-full bg-[#1e2630] flex items-center justify-center text-white text-[9px] font-black">1</span>
                      <span>Datos del Destinatario</span>
                    </div>
                    
                    <div className="bg-[#181f29] rounded-2xl p-4 border border-[#2d3748] space-y-2.5 text-xs">
                      <div className="flex justify-between items-baseline gap-2">
                        <span className="text-gray-400">Cliente:</span>
                        <span className="font-bold text-white text-right">{modalPedido.nombre_cliente}</span>
                      </div>
                      <div className="flex justify-between items-baseline gap-2">
                        <span className="text-gray-400">Teléfono:</span>
                        <span className="font-bold text-white flex items-center gap-1">
                          <Phone size={11} className="text-green-500" />
                          {modalPedido.telefono}
                        </span>
                      </div>
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-gray-400 shrink-0">Dirección:</span>
                        <span className="font-bold text-white text-right max-w-[240px] break-words">{modalPedido.direccion || 'Sin dirección'}</span>
                      </div>
                      {modalPedido.referencias && (
                        <div className="flex justify-between items-start gap-2 border-t border-gray-800/60 pt-2">
                          <span className="text-gray-400 shrink-0">Referencias:</span>
                          <span className="font-bold text-gray-300 text-right max-w-[220px] break-words">{modalPedido.referencias}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center border-t border-gray-800/60 pt-2 font-bold text-sm">
                        <span className="text-gray-400 text-xs">Total a Cobrar:</span>
                        <span className="text-green-400 font-black">{fmt(modalPedido.total)}</span>
                      </div>
                    </div>
                  </div>

                  {/* PASO 2: CONCILIACIÓN DE PAGO */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-black text-gray-450 uppercase tracking-wider">
                      <span className="w-4 h-4 rounded-full bg-[#1e2630] flex items-center justify-center text-white text-[9px] font-black">2</span>
                      <span>Verificación del Pago</span>
                    </div>

                    {isTransferencia ? (
                      <div className={`rounded-2xl p-4 border flex flex-col gap-3.5 ${
                        modalPedido.pago_confirmado 
                          ? 'bg-[#1b2721] border-[#10b981]/30' 
                          : 'bg-[#292018] border-orange-500/20'
                      }`}>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-orange-400 font-bold flex items-center gap-1.5">
                            🏦 Pago por Transferencia
                          </span>
                          <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${
                            modalPedido.pago_confirmado 
                              ? 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30' 
                              : 'bg-orange-500/15 text-orange-400 border border-orange-500/30 animate-pulse'
                          }`}>
                            {modalPedido.pago_confirmado ? 'PAGO CONCILIADO' : 'PENDIENTE DE VALIDACIÓN'}
                          </span>
                        </div>

                        {/* Foto del comprobante adjuntada por el cliente en el checkout.
                            Antes solo existia el numero de referencia como texto; la
                            imagen se pedia aparte por WhatsApp y no quedaba en ningún
                            lado. Se firma bajo demanda porque es un bucket privado. */}
                        {modalPedido.comprobante_transferencia_path && (
                          comprobanteUrl ? (
                            <a
                              href={comprobanteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block rounded-xl overflow-hidden border border-gray-800 hover:border-green-500/50 transition"
                            >
                              <img src={comprobanteUrl} alt="Comprobante de transferencia" className="w-full max-h-64 object-contain bg-black" />
                            </a>
                          ) : (
                            <button
                              onClick={() => verComprobante(modalPedido.comprobante_transferencia_path!)}
                              disabled={cargandoComprobante}
                              className="w-full bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 font-bold text-[10px] py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer"
                            >
                              {cargandoComprobante ? <Loader2 size={12} className="animate-spin" /> : '📎'} Ver foto del comprobante
                            </button>
                          )
                        )}

                        {/* Alerta de comprobante repetido: se revisa apenas se abre el
                            modal, no solo cuando el admin edita el campo a mano. */}
                        {refDuplicadaEn && (
                          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs text-red-300 font-semibold flex items-start gap-2">
                            <AlertCircle size={14} className="shrink-0 mt-0.5" />
                            <span>
                              ⚠️ Este número de comprobante ya está registrado en el pedido #{String(refDuplicadaEn).padStart(4, '0')}.
                              Posible duplicado o fraude — verifica con el cliente antes de continuar.
                            </span>
                          </div>
                        )}

                        {/* Caja del comprobante: solo se muestra como "final" cuando ya
                            esta conciliado. Mientras este pendiente, se ve editable abajo
                            (asi el admin puede corregirlo hasta el ultimo momento). */}
                        {refNumber && modalPedido.pago_confirmado ? (
                          <div className="bg-[#181f29] border border-gray-800 rounded-xl p-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <span className="text-[9px] text-gray-405 uppercase font-black tracking-wide block">Nro. de Comprobante</span>
                              <span className="font-mono text-sm font-black text-white tracking-wider select-all">{refNumber}</span>
                            </div>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(refNumber)
                                setCopiadoRef(true)
                                setTimeout(() => setCopiadoRef(false), 2000)
                              }}
                              className="bg-gray-800 hover:bg-gray-700 active:scale-95 text-gray-300 font-bold text-[10px] px-3 py-1.5 rounded-lg transition flex items-center gap-1 shrink-0 cursor-pointer">
                              {copiadoRef ? '✓ ¡Copiado!' : '📋 Copiar Código'}
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {!refNumber && (
                              <div className="bg-yellow-500/5 p-3 rounded-xl border border-yellow-500/10 text-xs text-yellow-500 font-medium">
                                ⚠️ El cliente seleccionó transferencia pero no ingresó un código de comprobante.
                              </div>
                            )}

                            {/* Input editable: el admin escribe/pega el numero que verifico
                                contra el estado de cuenta del banco. Se guarda en
                                referencia_transferencia (columna con indice unico anti-fraude). */}
                            <div className="space-y-1">
                              <label className="text-[9px] text-gray-400 uppercase font-black tracking-wide block">
                                {refNumber ? 'Corregir nro. de comprobante' : 'Ingresar nro. de comprobante verificado en el banco'}
                              </label>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={refInput}
                                  onChange={e => setRefInput(e.target.value)}
                                  placeholder="ej: 000123456789"
                                  className="flex-1 bg-[#0c0f12] border border-gray-800 rounded-xl px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-green-500"
                                />
                                <button
                                  onClick={() => guardarReferencia(modalPedido.id, refInput)}
                                  disabled={guardandoRef || !refInput.trim() || refInput.trim() === refNumber}
                                  className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 font-bold text-[10px] px-3 py-2 rounded-lg transition shrink-0 cursor-pointer">
                                  {guardandoRef ? <Loader2 size={12} className="animate-spin" /> : 'Guardar'}
                                </button>
                              </div>
                            </div>

                            {/* Pedir el comprobante/numero directo al cliente por WhatsApp
                                cuando no lo dejo en el checkout. Incluye la ubicacion de
                                entrega seleccionada en el Paso 3 para que el cliente la
                                reconozca y confirme junto con el pago. */}
                            <a
                              href={"https://wa.me/593" + (modalPedido.telefono.startsWith('0') ? modalPedido.telefono.slice(1) : modalPedido.telefono) + "?text=" + encodeURIComponent(
                                `Hola ${modalPedido.nombre_cliente}, hemos recibido tu pedido #${String(modalPedido.numero).padStart(4, '0')} ($${modalPedido.total.toFixed(2)})` +
                                (ubicacionSel ? `, a ser entregado en "${ubicacionSel.nombre}" 📍 ${ubicacionUrl}` : '') +
                                `. Para continuar necesitamos verificar tu transferencia: aún no hemos recibido el comprobante o número de referencia. ¿Nos lo puedes compartir? ¡Gracias!`
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full bg-green-600 hover:bg-green-555 text-white font-extrabold text-[10px] py-2 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer">
                              <Phone size={11} /> Solicitar comprobante por WhatsApp
                            </a>
                          </div>
                        )}

                        {modalPedido.notas && (
                          <div className="text-[10px] text-gray-450 bg-black/20 p-2 rounded-lg border border-gray-850">
                            <strong>Notas completas:</strong> {modalPedido.notas}
                          </div>
                        )}

                        {/* Monto confirmado: antes se aprobaba una referencia sin comparar
                            ningún número contra el total real (productos + envío). Ahora
                            es obligatorio y se valida contra total_final del lado del
                            servidor (docs/auditoria_financiera_ruta_dinero.md, C1/A1). */}
                        {!modalPedido.pago_confirmado && (
                          <div className="bg-black/20 border border-gray-800 rounded-xl p-3 space-y-2">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-gray-400 uppercase font-black tracking-wide">Total a cobrar (productos + envío)</span>
                              <span className="font-black text-white">
                                {calculandoEnvio ? 'Calculando envío...' : modalPedido.costo_envio == null
                                  ? '⚠️ Envío sin calcular'
                                  : `$${(modalPedido.total_final ?? (modalPedido.total + (modalPedido.costo_envio ?? 0))).toFixed(2)}`}
                              </span>
                            </div>
                            <div>
                              <label className="text-[9px] text-gray-400 uppercase font-black tracking-wide block mb-1">Monto confirmado en el comprobante/banco *</label>
                              <input
                                type="number" step="0.01" min="0"
                                value={montoConfirmadoInput}
                                onChange={e => setMontoConfirmadoInput(e.target.value)}
                                placeholder={modalPedido.costo_envio != null ? (modalPedido.total_final ?? (modalPedido.total + modalPedido.costo_envio)).toFixed(2) : ''}
                                className="w-full bg-[#0c0f12] border border-gray-800 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-green-500"
                              />
                            </div>
                            {montoConfirmadoInput.trim() && modalPedido.costo_envio != null &&
                              Math.abs(parseFloat(montoConfirmadoInput) - (modalPedido.total_final ?? (modalPedido.total + modalPedido.costo_envio))) > 0.01 && (
                              <div>
                                <label className="text-[9px] text-amber-400 uppercase font-black tracking-wide block mb-1">
                                  ⚠️ No coincide con el total — motivo de la diferencia *
                                </label>
                                <input
                                  type="text"
                                  value={motivoDiferenciaInput}
                                  onChange={e => setMotivoDiferenciaInput(e.target.value)}
                                  placeholder="Ej: cliente pagó con descuento acordado"
                                  className="w-full bg-[#0c0f12] border border-amber-700/40 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-amber-500"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* Banco y fecha del deposito: quedan en la bitacora de auditoria
                            junto con quien confirmo y cuando -- necesarios para poder
                            distinguir un mismo numero de comprobante reutilizado en bancos
                            o fechas distintas, y para el cruce contra el estado de cuenta. */}
                        {!modalPedido.pago_confirmado && (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[9px] text-gray-400 uppercase font-black tracking-wide block">Banco / medio</label>
                              <select
                                value={bancoInput}
                                onChange={e => setBancoInput(e.target.value as any)}
                                className="w-full bg-[#0c0f12] border border-gray-800 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-green-500">
                                <option value="pichincha">🏦 Banco Pichincha</option>
                                <option value="deuna">🟣 Deuna</option>
                                <option value="otro">Otro</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] text-gray-400 uppercase font-black tracking-wide block">Fecha del depósito</label>
                              <input
                                type="date"
                                value={fechaDepositoInput}
                                onChange={e => setFechaDepositoInput(e.target.value)}
                                className="w-full bg-[#0c0f12] border border-gray-800 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-green-500"
                              />
                            </div>
                          </div>
                        )}

                        {esClienteNuevo && !modalPedido.pago_confirmado && (
                          <label className="flex items-start gap-2.5 bg-rose-500/5 border border-rose-500/20 rounded-xl p-3 text-[11px] text-rose-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={confirmoPorWhatsapp}
                              onChange={e => setConfirmoPorWhatsapp(e.target.checked)}
                              className="mt-0.5 accent-rose-500 w-3.5 h-3.5 shrink-0"
                            />
                            <span>
                              <strong>Cliente nuevo</strong> (sin historial de pedidos ni direcciones): confirmo que
                              dialogué por WhatsApp con el cliente y verifiqué el comprobante contra el estado de
                              cuenta del banco antes de aprobar.
                            </span>
                          </label>
                        )}

                        {!modalPedido.pago_confirmado ? (
                          <button
                            onClick={() => confirmarPagoPedido(modalPedido.id)}
                            disabled={
                              procesando || !refNumber || !!refDuplicadaEn || (esClienteNuevo && !confirmoPorWhatsapp) ||
                              !montoConfirmadoInput.trim() || modalPedido.costo_envio == null ||
                              (Math.abs(parseFloat(montoConfirmadoInput || '0') - (modalPedido.total_final ?? (modalPedido.total + (modalPedido.costo_envio ?? 0)))) > 0.01 && !motivoDiferenciaInput.trim())
                            }
                            className="w-full bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white font-black text-xs py-2.5 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 shadow-md disabled:opacity-40 disabled:cursor-not-allowed">
                            {procesando ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                            Confirmar Depósito Recibido
                          </button>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 text-[10px] text-green-400 font-bold flex items-center justify-center gap-1 bg-green-500/10 p-2 rounded-xl border border-green-500/20">
                                ✓ Depósito bancario verificado por Administración. Pedido conciliado.
                              </div>
                              {/* Anular solo tiene sentido antes de liberar el pedido al pool:
                                  una vez el shopper ya puede verlo, revertir el pago aqui no lo
                                  retira de su cola (esa es otra pantalla), asi que ocultarlo
                                  evita que el admin crea que tambien lo "des-libera". */}
                              {modalPedido.estado === 'pendiente' && (
                                <button
                                  onClick={() => revertirPago(modalPedido.id)}
                                  disabled={revirtiendoPago}
                                  title="Anular verificación (por si se marcó por error)"
                                  className="shrink-0 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-bold text-[10px] px-3 py-2 rounded-xl transition cursor-pointer disabled:opacity-40">
                                  {revirtiendoPago ? <Loader2 size={12} className="animate-spin" /> : '↩️ Anular'}
                                </button>
                              )}
                            </div>

                            {/* Con el pago ya conciliado, se avisa al cliente y se le pide
                                que confirme la direccion de entrega elegida (no que la
                                envie de nuevo) — cierra el ciclo de verificacion. */}
                            <a
                              href={"https://wa.me/593" + (modalPedido.telefono.startsWith('0') ? modalPedido.telefono.slice(1) : modalPedido.telefono) + "?text=" + encodeURIComponent(
                                `Hola ${modalPedido.nombre_cliente}, te confirmamos que recibimos tu pedido #${String(modalPedido.numero).padStart(4, '0')} pagado por transferencia (Ref: ${refNumber}).` +
                                (ubicacionSel
                                  ? ` ¿Nos confirmas que la entrega es en "${ubicacionSel.nombre}"? 📍 ${ubicacionUrl}`
                                  : ' ¿Nos confirmas la dirección exacta de entrega, por favor?') +
                                ` ¡Gracias!`
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full bg-green-600 hover:bg-green-555 text-white font-extrabold text-[10px] py-2 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer">
                              <Phone size={11} /> Confirmar pedido y dirección por WhatsApp
                            </a>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex justify-between items-center text-xs">
                          <span className="text-gray-300 font-bold flex items-center gap-1.5">
                            💵 Pago Contra-Entrega (Efectivo)
                          </span>
                          <span className="bg-blue-500/15 text-blue-400 text-[9px] font-extrabold px-2 py-0.5 rounded-full border border-blue-500/30">
                            PAGO AL ENTREGAR
                          </span>
                        </div>

                        {/* Contra-entrega no exige validar un comprobante, pero un cliente
                            nuevo sigue necesitando confirmar identidad/direccion antes de
                            que salga mercaderia hacia una ubicacion sin historial. */}
                        {esClienteNuevo && (
                          <label className="flex items-start gap-2.5 bg-rose-500/5 border border-rose-500/20 rounded-xl p-3 text-[11px] text-rose-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={confirmoPorWhatsapp}
                              onChange={e => setConfirmoPorWhatsapp(e.target.checked)}
                              className="mt-0.5 accent-rose-500 w-3.5 h-3.5 shrink-0"
                            />
                            <span>
                              <strong>Cliente nuevo</strong> (sin historial de pedidos ni direcciones): confirmo que
                              dialogué por WhatsApp con el cliente para verificar su identidad y la dirección de
                              entrega antes de aprobar.
                            </span>
                          </label>
                        )}
                      </div>
                    )}

                    {/* Historial de auditoria: quien confirmo/anulo/corrigio, cuando,
                        y con que datos. Viene de una tabla append-only (nadie puede
                        editarla ni borrarla, ni siquiera un superadmin desde la app). */}
                    {historialVerif.length > 0 && (
                      <div className="pt-1">
                        <button
                          onClick={() => setMostrarHistorial(v => !v)}
                          className="text-[10px] text-gray-500 hover:text-gray-300 font-semibold flex items-center gap-1 cursor-pointer">
                          {mostrarHistorial ? '▾' : '▸'} Historial de verificación ({historialVerif.length})
                        </button>
                        {mostrarHistorial && (
                          <div className="mt-2 space-y-1.5">
                            {historialVerif.map(h => (
                              <div key={h.id} className="bg-[#0c0f12] border border-gray-850 rounded-lg px-3 py-2 text-[10px] text-gray-400">
                                <div className="flex justify-between items-center">
                                  <span className={`font-bold ${
                                    h.accion === 'confirmado' ? 'text-green-400' :
                                    h.accion === 'anulado' ? 'text-red-400' : 'text-blue-400'
                                  }`}>
                                    {h.accion === 'confirmado' ? '✓ Confirmado' : h.accion === 'anulado' ? '↩️ Anulado' : '✏️ Ref. corregida'}
                                  </span>
                                  <span className="text-gray-550">{new Date(h.created_at).toLocaleString('es')}</span>
                                </div>
                                <div className="mt-0.5">
                                  Por <strong className="text-gray-300">{h.admin_nombre}</strong>
                                  {h.banco && <> · {h.banco === 'pichincha' ? 'Pichincha' : h.banco === 'deuna' ? 'Deuna' : 'Otro banco'}</>}
                                  {h.fecha_deposito && <> · depósito {h.fecha_deposito}</>}
                                  {h.referencia && <> · Ref: {h.referencia}</>}
                                </div>
                                {h.notas && <div className="mt-0.5 italic text-gray-500">"{h.notas}"</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* PASO 3: LOCALIZACIÓN GPS */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-black text-gray-450 uppercase tracking-wider flex justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-[#1e2630] flex items-center justify-center text-white text-[9px] font-black">3</span>
                        <span>Asignación de Puerta GPS</span>
                      </div>
                      {cargandoDirecciones && <Loader2 size={11} className="animate-spin text-green-500" />}
                    </div>

                    {/* Direcciones guardadas y de pedido */}
                    {(direccionesCliente.length > 0 || (modalPedido.geo_lat && modalPedido.geo_lng)) ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-1 gap-2.5">
                          {/* 1. Coordenadas del Pedido (si el cliente usó el mapa en el Checkout) */}
                          {modalPedido.geo_lat && modalPedido.geo_lng && (
                            <label
                              className={`flex items-start gap-3.5 p-3.5 rounded-2xl border text-xs cursor-pointer transition-all duration-150 ${
                                direccionSeleccionada === 'pedido' 
                                  ? 'bg-[#1b2721] border-[#10b981] text-white shadow-sm ring-1 ring-[#10b981]/30' 
                                  : 'bg-[#181f29] border-gray-800 text-gray-400 hover:border-gray-700'
                              }`}>
                              <input
                                type="radio"
                                name="direccion_seleccionada"
                                checked={direccionSeleccionada === 'pedido'}
                                onChange={() => setDireccionSeleccionada('pedido')}
                                className="mt-0.5 accent-[#10b981] w-4 h-4"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-bold flex items-center justify-between text-white">
                                  <span className="text-[#10b981] flex items-center gap-1 font-semibold">
                                    ⭐ Ubicación de este Pedido (Mapa Tienda)
                                  </span>
                                  <a
                                    href={"https://www.google.com/maps/search/?api=1&query=" + modalPedido.geo_lat + "," + modalPedido.geo_lng}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    className="text-blue-400 hover:text-blue-300 font-black text-[9px] underline bg-blue-500/5 px-2 py-0.5 rounded border border-blue-500/10 shrink-0">
                                    🗺️ Ver Mapa
                                  </a>
                                </div>
                                <div className="text-[10px] text-gray-300 mt-1 truncate">{modalPedido.direccion}</div>
                                <div className="text-[9px] text-gray-500 mt-0.5">Coords: {modalPedido.geo_lat}, {modalPedido.geo_lng}</div>
                              </div>
                            </label>
                          )}

                          {/* 2. Direcciones del historial (rep_clientes_direcciones y ol_direcciones_cliente) */}
                          {direccionesCliente.map(d => (
                            <label
                              key={d.id}
                              className={`flex items-start gap-3.5 p-3.5 rounded-2xl border text-xs cursor-pointer transition-all duration-150 ${
                                direccionSeleccionada === d.id 
                                  ? 'bg-[#1b2721] border-[#10b981] text-white shadow-sm ring-1 ring-[#10b981]/30' 
                                  : 'bg-[#181f29] border-gray-800 text-gray-400 hover:border-gray-700'
                              }`}>
                              <input
                                type="radio"
                                name="direccion_seleccionada"
                                checked={direccionSeleccionada === d.id}
                                onChange={() => setDireccionSeleccionada(d.id)}
                                className="mt-0.5 accent-[#10b981] w-4 h-4"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-bold flex items-center justify-between text-white">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span>{d.nombre_direccion}</span>
                                    {d.verificada && <span className="bg-[#10b981]/15 text-[#10b981] text-[8px] font-black px-1.5 py-0.2 rounded border border-[#10b981]/25">GPS Verificado</span>}
                                  </div>
                                  <a
                                    href={"https://www.google.com/maps/search/?api=1&query=" + d.geo_lat + "," + d.geo_lng}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    className="text-blue-400 hover:text-blue-300 font-black text-[9px] underline bg-blue-500/5 px-2 py-0.5 rounded border border-blue-500/10 shrink-0">
                                    🗺️ Ver Mapa
                                  </a>
                                </div>
                                <div className="text-[10px] text-gray-300 mt-1 truncate">{d.direccion}</div>
                                <div className="text-[9px] text-gray-500 mt-0.5">Coords: {d.geo_lat}, {d.geo_lng}</div>
                              </div>
                            </label>
                          ))}
                          
                          {/* 3. Opción de Nueva Dirección personalizada */}
                          <label
                            className={`flex items-start gap-3.5 p-3.5 rounded-2xl border text-xs cursor-pointer transition-all duration-150 ${
                              direccionSeleccionada === '' 
                                ? 'bg-[#1b2721] border-[#10b981] text-white shadow-sm ring-1 ring-[#10b981]/30' 
                                : 'bg-[#181f29] border-gray-800 text-gray-400 hover:border-gray-700'
                            }`}>
                            <input
                              type="radio"
                              name="direccion_seleccionada"
                              checked={direccionSeleccionada === ''}
                              onChange={() => setDireccionSeleccionada('')}
                              className="mt-0.5 accent-[#10b981] w-4 h-4"
                            />
                            <div className="flex-1">
                              <span className="font-bold text-white flex items-center gap-1.5">
                                🔧 Nueva ubicación / Crear otra etiqueta
                              </span>
                            </div>
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-4 text-xs text-rose-400 flex items-center gap-2">
                        <AlertCircle size={14} className="shrink-0" />
                        <span><strong>Cliente Nuevo:</strong> No tiene ubicaciones GPS registradas en su historial.</span>
                      </div>
                    )}

                    {/* Crear/Configurar Nueva Dirección */}
                    {direccionSeleccionada === '' && (
                      <div className="bg-[#181f29] border border-gray-800 rounded-2xl p-4 space-y-3">
                        <div className="flex justify-between items-center flex-wrap gap-2">
                          <label className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Registrar Coordenadas GPS</label>
                          <a
                            href={"https://wa.me/593" + (modalPedido.telefono.startsWith('0') ? modalPedido.telefono.slice(1) : modalPedido.telefono) + "?text=" + encodeURIComponent(
                              "Hola " + modalPedido.nombre_cliente + ", te saluda La Crayola. Para poder entregar tu pedido #" + modalPedido.numero + " sin contratiempos, ¿serías tan amable de compartirnos tu ubicación GPS exacta por este medio? ¡Muchas gracias!"
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-green-600 hover:bg-green-555 text-white font-extrabold text-[9px] px-2.5 py-1 rounded-lg flex items-center gap-1 transition cursor-pointer">
                            <Phone size={10} /> Pedir Ubicación por WhatsApp
                          </a>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-400">Pegar ubicación compartida por WhatsApp o coordenadas (lat, lng):</label>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="ej: https://maps.app.goo.gl/xxxx o -0.0256, -78.8924"
                              value={pegarCoords}
                              onChange={e => parsearCoordenadas(e.target.value)}
                              className="w-full bg-[#0c0f12] border border-gray-800 rounded-xl px-3.5 py-2 pr-9 text-white text-xs focus:outline-none focus:border-green-500"
                            />
                            {resolviendoEnlace && (
                              <Loader2 size={14} className="animate-spin text-gray-500 absolute right-3 top-1/2 -translate-y-1/2" />
                            )}
                          </div>
                          {errorEnlaceUbicacion && (
                            <p className="text-[9px] text-red-400 font-semibold">{errorEnlaceUbicacion}</p>
                          )}
                          <p className="text-[9px] text-gray-550 leading-relaxed">
                            Pega aquí el enlace que el cliente comparte por WhatsApp ("Ubicación en vivo" o "Ubicación actual") y se autocompletará abajo. También acepta el código de coordenadas de mantener presionado un punto en Google Maps.
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="space-y-1 col-span-2">
                            <label className="text-[10px] text-gray-400">Etiqueta de la dirección (ej: Casa, Trabajo):</label>
                            <input
                              type="text"
                              value={nuevaDireccion.nombre}
                              onChange={e => setNuevaDireccion(prev => ({ ...prev, nombre: e.target.value }))}
                              className="w-full bg-[#0c0f12] border border-gray-800 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-green-500"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-gray-400">Latitud:</label>
                            <input
                              type="text"
                              placeholder="ej: -0.1806"
                              value={nuevaDireccion.lat}
                              onChange={e => setNuevaDireccion(prev => ({ ...prev, lat: e.target.value }))}
                              className="w-full bg-[#0c0f12] border border-gray-800 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-green-500"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-gray-400">Longitud:</label>
                            <input
                              type="text"
                              placeholder="ej: -78.4658"
                              value={nuevaDireccion.lng}
                              onChange={e => setNuevaDireccion(prev => ({ ...prev, lng: e.target.value }))}
                              className="w-full bg-[#0c0f12] border border-gray-800 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-green-500"
                            />
                          </div>
                          {nuevaDireccion.lat && nuevaDireccion.lng && (
                            <div className="col-span-2 pt-1">
                              <a
                                href={"https://www.google.com/maps/search/?api=1&query=" + nuevaDireccion.lat + "," + nuevaDireccion.lng}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 font-bold underline text-[9px] flex items-center gap-1">
                                🗺️ Previsualizar Ubicación Manual en Google Maps
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-800 bg-[#080b0e] flex gap-3">
                  <button
                    onClick={() => setModalPedido(null)}
                    className="flex-1 bg-gray-850 hover:bg-gray-800 text-gray-400 hover:text-white font-bold text-xs py-2.5 rounded-xl transition cursor-pointer">
                    Cerrar
                  </button>
                  <button
                    onClick={() => liberarPedido(modalPedido)}
                    disabled={
                      procesando ||
                      (isTransferencia && !modalPedido.pago_confirmado) ||
                      (direccionSeleccionada === '' && (!nuevaDireccion.lat || !nuevaDireccion.lng)) ||
                      (esClienteNuevo && !confirmoPorWhatsapp)
                    }
                    className="flex-1 bg-[#10b981] hover:bg-[#059669] text-white font-black text-xs py-2.5 rounded-xl transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shadow-md shadow-green-900/10">
                    {procesando && <Loader2 size={13} className="animate-spin" />}
                    Liberar al Pool (Aprobar)
                  </button>
                </div>
              </div>
            </div>
        )}
        
      </main>
    </div>
  )
}
