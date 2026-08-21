'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
const MapaRuta = dynamic(() => import('@/components/MapaRuta'), { ssr: false })
import Link from 'next/link'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { registrarYAbrirWhatsApp, formatWhatsApp } from '@/lib/comunicaciones'
import { distanciaKm, minutosEstimados, ordenarPorCercania } from '@/lib/geo'
import { logout } from '@/actions/auth'
import { useRouter } from 'next/navigation'
import { Loader2, MapPin, CheckCircle, Package, Phone, Navigation, DollarSign, UserCircle, ArrowRightLeft, X, AlertCircle, LogOut, Menu, Map as MapIcon, Target } from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }
// La app de tienda manda "total" SIN el envío incluido (confirmado con un
// pedido real). Mientras no se corrija ahí, esto es lo que hay que cobrar
// de verdad -- ver /api/envio/calcular-pedido, que rellena costo_envio.
function montoACobrar(p: { total: number; costo_envio: number | null }) {
  return Number(p.total ?? 0) + Number(p.costo_envio ?? 0)
}

function sonDireccionesSimilares(dir1: string | null | undefined, dir2: string | null | undefined): boolean {
  if (!dir1 || !dir2) return false
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const c1 = clean(dir1)
  const c2 = clean(dir2)
  if (c1 === c2) return true
  if (c1.length > 8 && c2.length > 8 && (c1.includes(c2) || c2.includes(c1))) return true
  
  const palabras1 = dir1.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3)
  const palabras2 = dir2.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3)
  
  if (palabras1.length === 0 || palabras2.length === 0) return false
  
  const coincidentes = palabras1.filter(p => palabras2.includes(p))
  const ratio = coincidentes.length / Math.min(palabras1.length, palabras2.length)
  return ratio >= 0.5
}

interface PedidoAsignado {
  asignacion_id:  string
  estado:         string
  pedido_estado:  string
  pedido_id:      string
  numero:         number
  nombre_cliente: string
  telefono:       string
  direccion:      string | null
  ciudad:         string
  referencias:    string | null
  total:          number
  costo_envio:    number | null
  geo_lat:        number | null
  geo_lng:        number | null
  notas:          string | null
  metodo_pago?:    string | null
  pago_confirmado?: boolean | null
  compra_iniciada_at?: string | null
  rider_id?:      string | null
  shopper_id?:    string | null
}

const EST_COLOR: Record<string, string> = {
  asignado: 'bg-indigo-100 text-indigo-700',
  en_ruta:  'bg-orange-100 text-orange-700',
  entregado:'bg-green-100 text-green-700',
  devuelto: 'bg-red-100 text-red-700',
}

export default function RepartidorPage() {
  const { user, rol, estado: authEstado } = useAuth()
  const router = useRouter()
  const [pedidos,    setPedidos]    = useState<PedidoAsignado[]>([])
  const [pedidosEspera, setPedidosEspera] = useState<any[]>([])
  // Pool de entregas listas para recoger (comprador ya pago en caja, sin motorizado asignado
  // todavia) — modulo independiente del comprador, solo visible en modo repartidor.
  const [poolEntregas, setPoolEntregas] = useState<any[]>([])
  // Contador de entregas de HOY (exitosas/fallidas) para el repartidor -- antes
  // no habia forma de ver el avance del dia sin preguntarle al admin.
  const [entregasHoy, setEntregasHoy] = useState({ exitosas: 0, fallidas: 0 })
  const [cargando,   setCargando]   = useState(true)
  const [repartidor, setRepartidor] = useState<{ id: string; nombre: string; comision_valor: number; efectivo_en_mano: number; estado: string; vehiculo: string | null; email: string | null; conectado: boolean } | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)
  const [cobro,      setCobro]      = useState<Record<string, string>>({})

  // La app de tienda no manda el costo de envío -- se calcula acá la
  // primera vez que se ve un pedido sin costo_envio y con coordenadas, y
  // se guarda para no recalcularlo cada vez. Sin esto, "total" se sigue
  // usando solo (sin envío) y se repite la pérdida.
  const envioSolicitado = useRef<Set<string>>(new Set())
  useEffect(() => {
    const pendientes = pedidos.filter(p =>
      p.costo_envio == null && p.geo_lat != null && p.geo_lng != null && !envioSolicitado.current.has(p.pedido_id)
    )
    if (pendientes.length === 0) return
    pendientes.forEach(p => envioSolicitado.current.add(p.pedido_id))
    ;(async () => {
      let huboCambios = false
      const resultados = await Promise.all(pendientes.map(async p => {
        try {
          const res = await fetch('/api/envio/calcular-pedido', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pedidoId: p.pedido_id }),
          })
          const data = await res.json()
          if (res.ok && typeof data.envio === 'number') { huboCambios = true; return { pedido_id: p.pedido_id, envio: data.envio } }
        } catch { /* si falla, se queda como null -- se reintenta la próxima carga */ }
        return null
      }))
      if (!huboCambios) return
      const mapa = new Map(resultados.filter(Boolean).map((r: any) => [r.pedido_id, r.envio]))
      setPedidos(prev => prev.map(p => mapa.has(p.pedido_id) ? { ...p, costo_envio: mapa.get(p.pedido_id) } : p))
    })()
  }, [pedidos])

  // Selector dinámico de Rol: 'repartidor' (Entregas) o 'comprador' (Compras/Picking)
  const [modo, setModo] = useState<'repartidor' | 'comprador'>('repartidor')
  // 'repartidor' es solo un valor inicial arbitrario -- hasta que cargar() confirma
  // el modo real contra la base de datos, no se debe mostrar NINGUNA interfaz de rol,
  // para evitar el parpadeo donde se ve el modulo equivocado por un instante
  // (ej. un comprador viendo brevemente la pantalla de repartidor, o viceversa).
  const [modoConfirmado, setModoConfirmado] = useState(false)
  const [accesoDenegado, setAccesoDenegado] = useState<{ nombre: string; estado_registro: string; activo: boolean } | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  // Si la pantalla de carga se queda pegada mas de 8s, se muestra una salida
  // de emergencia (cerrar sesion) -- ver uso mas abajo, antes del return.
  const [cargaAtascada, setCargaAtascada] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setCargaAtascada(true), 8000)
    return () => clearTimeout(t)
  }, [])

  // Si el login ya pregunto el rol (admin/comprador/repartidor), o si venimos
  // redirigidos desde /caja, el modo llega explicito por la URL — se usa
  // directo sin adivinar por nombre/vehiculo, que era lento y parpadeaba.
  const modoExplicitoRef = useRef<'comprador' | 'repartidor' | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const m = params.get('modo')
    if (m === 'comprador' || m === 'repartidor') {
      modoExplicitoRef.current = m
      setModo(m)
    }
  }, [])
  // Clasificacion interna del comprador (no afecta el seguimiento que ve el cliente):
  // inicio (pool sin tomar) / aceptadas (tomadas, sin iniciar) / preparando (comprando) /
  // porentregar (pagado en caja, esperando repartidor) / entregadasrep (traspasadas a otro) /
  // entregadasyo (compro y entrego el mismo comprador)
  type PestanaComprador = 'inicio' | 'aceptadas' | 'preparando' | 'porentregar' | 'entregadasrep' | 'entregadasyo'
  const [pestana, setPestana] = useState<PestanaComprador>('inicio')

  // Traspaso de efectivo en mano a otro colaborador (ej: repartidor entrega el COD cobrado al comprador)
  const [showTraspaso, setShowTraspaso] = useState(false)

  // Envíos Flex states
  const [paradaActivaId, setParadaActivaId] = useState<string | null>(null)
  // Menú inferior fijo (estilo apps grandes) con 4 destinos, en vez de la
  // pestaña de 2 arriba + el toggle Listado/Mapa escondido dentro de
  // "entregar" -- ahora "Activo" y "Mapa" son su propio destino directo,
  // alcanzable con el pulgar sin subpasos.
  const [pestanaRepartidor, setPestanaRepartidor] = useState<'recoger' | 'entregar' | 'activo' | 'mapa'>('recoger')
  const [menuAbierto, setMenuAbierto] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('paradaActivaId')
      if (saved) setParadaActivaId(saved)
    }
  }, [])
  const [colegas, setColegas] = useState<{ id: string; nombre: string }[]>([])
  const [destinoTraspaso, setDestinoTraspaso] = useState('')
  const [montoTraspaso, setMontoTraspaso] = useState('')
  const [notasTraspaso, setNotasTraspaso] = useState('')
  const [procesandoTraspaso, setProcesandoTraspaso] = useState(false)
  const [errorTraspaso, setErrorTraspaso] = useState('')

  // Trazabilidad real de la liquidación (auditoria_plan_correcciones_ia.md
  // + pedido del negocio): además de entregar a un colega, ahora se puede
  // depositar/transferir directo a la empresa desde este mismo formulario,
  // marcando EXACTAMENTE qué pedidos cobrados en efectivo cubre -- no un
  // monto suelto sin respaldo.
  const [metodoTraspaso, setMetodoTraspaso] = useState<'colega' | 'deposito_banco' | 'transferencia'>('colega')
  const [bancoTraspaso, setBancoTraspaso] = useState('')
  const [referenciaTraspaso, setReferenciaTraspaso] = useState('')
  const [comprobanteTraspasoFile, setComprobanteTraspasoFile] = useState<File | null>(null)
  const [entregasSinLiquidar, setEntregasSinLiquidar] = useState<any[]>([])
  // Comisión ganada y aún no pagada -- se muestra dentro de este mismo modal
  // porque es lo primero que el repartidor quiere ver al tocar "Caja", junto
  // con el efectivo en mano (antes solo estaba en Perfil, escondido).
  const [comisionPendiente, setComisionPendiente] = useState(0)
  const [entregasSeleccionadas, setEntregasSeleccionadas] = useState<Set<string>>(new Set())

  async function cargarEntregasSinLiquidar() {
    if (!repartidor) return
    const { data: entregas } = await supabase
      .from('rep_entregas')
      .select('id, pedido_id, monto_cobrado, entregado_at, ol_pedidos(numero, nombre_cliente)')
      .eq('repartidor_id', repartidor.id)
      .eq('exitosa', true)
      .eq('metodo_pago', 'efectivo')
      .order('entregado_at', { ascending: true })
    const { data: yaLiquidadas } = await supabase
      .from('rep_liquidacion_items')
      .select('entrega_id, deposito_id, rep_depositos_repartidor!inner(repartidor_id)')
      .eq('rep_depositos_repartidor.repartidor_id', repartidor.id)
    const idsLiquidados = new Set((yaLiquidadas ?? []).map((l: any) => l.entrega_id))
    setEntregasSinLiquidar((entregas ?? []).filter(e => !idsLiquidados.has(e.id)))
    setEntregasSeleccionadas(new Set())
  }

  const totalSeleccionadoTraspaso = entregasSinLiquidar
    .filter(e => entregasSeleccionadas.has(e.id))
    .reduce((s, e) => s + Number(e.monto_cobrado || 0), 0)

  function toggleEntregaSeleccionada(id: string) {
    setEntregasSeleccionadas(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function abrirTraspaso() {
    setErrorTraspaso('')
    setMontoTraspaso('')
    setNotasTraspaso('')
    setDestinoTraspaso('')
    setMetodoTraspaso('colega')
    setBancoTraspaso('')
    setReferenciaTraspaso('')
    setComprobanteTraspasoFile(null)
    setShowTraspaso(true)
    const { data } = await supabase
      .from('rep_repartidores')
      .select('id, nombre')
      .eq('activo', true)
      .neq('id', repartidor?.id ?? '')
      .order('nombre')
    setColegas(data ?? [])
    await cargarEntregasSinLiquidar()
    const { data: comisionPend } = await supabase.rpc('mi_comision_pendiente')
    setComisionPendiente(Number(comisionPend ?? 0))
  }

  // Ruta combinada: ordena las entregas 'en_ruta' por cercanía (vecino más próximo) desde
  // la ubicación actual del repartidor y abre Google Maps con todas las paradas intermedias.
  function abrirRutaCombinada() {
    const paradas = pedidos.filter(p => p.estado === 'en_ruta' && p.geo_lat && p.geo_lng)
    if (paradas.length === 0) return

    if (typeof window === 'undefined' || !navigator?.geolocation) {
      abrirRutaDesdePunto(null, paradas)
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => abrirRutaDesdePunto({ lat: pos.coords.latitude, lng: pos.coords.longitude }, paradas),
      () => abrirRutaDesdePunto(null, paradas),
      { timeout: 6000 }
    )
  }

  function abrirRutaDesdePunto(origenGeo: { lat: number; lng: number } | null, paradas: PedidoAsignado[]) {
    const ordenadas = ordenarPorCercania(origenGeo, paradas)
    const destino = ordenadas[ordenadas.length - 1]
    const intermedias = ordenadas.slice(0, -1)

    const params = new URLSearchParams({
      api: '1',
      destination: `${destino.geo_lat},${destino.geo_lng}`,
      travelmode: 'driving',
    })
    if (origenGeo) params.set('origin', `${origenGeo.lat},${origenGeo.lng}`)
    if (intermedias.length > 0) {
      params.set('waypoints', intermedias.map(p => `${p.geo_lat},${p.geo_lng}`).join('|'))
    }
    window.open(`https://www.google.com/maps/dir/?${params.toString()}`, '_blank')
  }

  // Orden real por cercanía (no A/B/C de Google Maps, que no se puede
  // rotular con el nombre del cliente) para las paradas activas
  // (asignado/en_ruta). Se recalcula cuando cambia la lista de pedidos;
  // usa el GPS del repartidor como punto de partida cuando está disponible.
  // Alimenta tanto el número que ya se muestra en cada tarjeta
  // (renderCardRepartidor) como la estimación de minutos del mensaje
  // "En Camino" -- sin duplicar la vista de mapa/lista que ya existe.
  const [ordenParadas, setOrdenParadas] = useState<Record<string, number>>({})
  const [distanciaEntreParadas, setDistanciaEntreParadas] = useState<Record<string, number>>({})

  useEffect(() => {
    const paradas = pedidos.filter(p => (p.estado === 'asignado' || p.estado === 'en_ruta') && p.geo_lat && p.geo_lng)
    if (paradas.length === 0) { setOrdenParadas({}); setDistanciaEntreParadas({}); return }

    const aplicar = (origenGeo: { lat: number; lng: number } | null) => {
      const ordenadas = ordenarPorCercania(origenGeo, paradas)
      const orden: Record<string, number> = {}
      const dist: Record<string, number> = {}
      let anterior = origenGeo
      ordenadas.forEach((p, i) => {
        orden[p.asignacion_id] = i + 1
        if (anterior) dist[p.asignacion_id] = distanciaKm(anterior, { lat: p.geo_lat!, lng: p.geo_lng! })
        anterior = { lat: p.geo_lat!, lng: p.geo_lng! }
      })
      setOrdenParadas(orden)
      setDistanciaEntreParadas(dist)
    }
    if (typeof window === 'undefined' || !navigator?.geolocation) { aplicar(null); return }
    navigator.geolocation.getCurrentPosition(
      pos => aplicar({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => aplicar(null),
      { timeout: 6000 }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidos.map(p => p.asignacion_id + p.estado).join(',')])

  async function confirmarTraspaso() {
    if (!repartidor) return

    if (metodoTraspaso === 'colega') {
      const monto = parseFloat(montoTraspaso)
      if (!destinoTraspaso) { setErrorTraspaso('Selecciona a quién le entregas el efectivo'); return }
      if (!montoTraspaso.trim() || isNaN(monto) || monto <= 0) { setErrorTraspaso('Ingresa un monto válido'); return }
      if (monto > (repartidor.efectivo_en_mano ?? 0)) { setErrorTraspaso('No puedes entregar más de lo que tienes en mano'); return }

      setProcesandoTraspaso(true)
      setErrorTraspaso('')
      const { error } = await supabase.rpc('transferir_efectivo_repartidor', {
        p_origen_id: repartidor.id,
        p_destino_id: destinoTraspaso,
        p_monto: monto,
        p_notas: notasTraspaso.trim() || null,
        p_request_id: crypto.randomUUID(),
      })
      setProcesandoTraspaso(false)
      if (error) { setErrorTraspaso(error.message); return }
      setShowTraspaso(false)
      await cargar(user!.id)
      return
    }

    // Depósito/transferencia a la empresa: exige marcar exactamente qué
    // pedidos cobrados en efectivo cubre, y el comprobante -- trazabilidad
    // real en vez de un monto suelto (auditoria_plan_correcciones_ia.md).
    if (entregasSeleccionadas.size === 0) { setErrorTraspaso('Marca los pedidos en efectivo que cubre este depósito'); return }
    if (!referenciaTraspaso.trim()) { setErrorTraspaso('Ingresa el número de referencia del depósito/transferencia'); return }
    if (!comprobanteTraspasoFile) { setErrorTraspaso('Adjunta la foto del comprobante'); return }

    setProcesandoTraspaso(true)
    setErrorTraspaso('')
    try {
      const ext = comprobanteTraspasoFile.name.split('.').pop() || 'jpg'
      const fileName = `depositos/${repartidor.id}_${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('comprobantes-proveedores').upload(fileName, comprobanteTraspasoFile)
      if (upErr) throw upErr

      const { error: rpcErr } = await supabase.rpc('crear_deposito_repartidor', {
        p_monto: totalSeleccionadoTraspaso,
        p_referencia: referenciaTraspaso.trim(),
        p_comprobante_path: fileName,
        p_request_id: crypto.randomUUID(),
        p_metodo: metodoTraspaso,
        p_banco: bancoTraspaso.trim() || null,
        p_entrega_ids: Array.from(entregasSeleccionadas),
      })
      if (rpcErr) throw rpcErr

      setShowTraspaso(false)
      await cargar(user!.id)
    } catch (e: any) {
      setErrorTraspaso(e.message || 'No se pudo registrar el depósito')
    } finally {
      setProcesandoTraspaso(false)
    }
  }

  async function cargar(userId: string, esReintento = false) {
    try {
      const { data: rep, error: errRep } = await supabase
        .from('rep_repartidores')
        .select('id,nombre,email,comision_valor,efectivo_en_mano,estado,estado_registro,activo,vehiculo,conectado,zona_id')
        .eq('user_id', userId)
        .single()

      // Si la consulta fallo con un ERROR (ej. una carrera de sesion justo
      // despues del login, antes de que el token termine de propagarse) se
      // reintenta una vez en vez de mandar al usuario de vuelta a '/' --
      // eso era lo que producia el rebote infinito entre '/' y '/repartidor'
      // cuando el fallo era transitorio, no un rechazo de acceso real.
      if (errRep && !esReintento) {
        await new Promise(res => setTimeout(res, 800))
        return cargar(userId, true)
      }

      if (!rep || rep.estado_registro !== 'aprobado' || !rep.activo) {
        setAccesoDenegado({
          nombre: rep?.nombre || user?.email || 'Usuario',
          estado_registro: rep?.estado_registro || 'sin_registro',
          activo: rep?.activo || false
        })
        setModoConfirmado(true)
        setCargando(false)
        return
      }
      setRepartidor({
        ...rep,
        conectado: rep.conectado ?? true
      } as any)

      // Determinar el modo esperado: si el login ya lo indico explicitamente
      // (?modo=comprador|repartidor en la URL), se usa eso directo — solo se
      // adivina por nombre/vehiculo como respaldo si no vino explicito
      // (ej. alguien que llega a /repartidor sin pasar por el login nuevo).
      let expectedModo: 'comprador' | 'repartidor'
      if (modoExplicitoRef.current) {
        expectedModo = modoExplicitoRef.current
      } else {
        const isShopper = rol === 'comprador' ||
                          rol === 'comprador-repartidor' ||
                          rep.nombre?.toLowerCase()?.includes('shopper') ||
                          rep.email?.toLowerCase()?.includes('shopper') ||
                          rep.vehiculo === 'pie'
        expectedModo = isShopper ? 'comprador' : 'repartidor'
      }
      if (modo !== expectedModo) {
        setModo(expectedModo)
      }
      setModoConfirmado(true)

      // 1. Cargar asignaciones vigentes del repartidor (dependiendo del modo)
      // Nota: no se filtra por fecha de asignacion — una asignacion sigue vigente
      // mientras su estado lo indique, sin importar si se creo hoy o dias atras
      // (si no, un pedido que tarda mas de un dia en completarse "desaparece"
      // de la lista del comprador/repartidor aunque siga activo).
      let queryAsigs = supabase
        .from('rep_asignaciones')
        .select('id,estado,pedido_id,rider_id,shopper_id,compra_iniciada_at,ol_pedidos(numero,nombre_cliente,telefono,direccion,ciudad,referencias,total,costo_envio,geo_lat,geo_lng,notas,estado,metodo_pago,pago_confirmado,zona_id)')

      if (expectedModo === 'comprador') {
        // Trae todo el ciclo de vida del comprador, incluyendo lo ya entregado,
        // para poder clasificarlo en las 6 pestañas internas.
        queryAsigs = queryAsigs
          .eq('shopper_id', rep.id)
          .in('estado', ['asignado', 'recolectado', 'en_ruta', 'entregado'])
      } else {
        queryAsigs = queryAsigs
          .eq('rider_id', rep.id)
          .in('estado', ['en_ruta'])
      }

      // 2. y 3. Pool de pedidos libres + asignaciones activas (para filtrar el pool).
      // Ninguna de estas tres consultas depende del resultado de las otras, asi que
      // se lanzan en paralelo en vez de una tras otra -- reduce bastante el tiempo
      // de carga inicial, que era muy lento por hacer todo en secuencia.
      const [{ data: asigs }, { data: pends }, { data: activeAsigs }, { data: pool }] = await Promise.all([
        queryAsigs,
        // Pool de pedidos disponibles: solo de la misma zona del repartidor
        // (si tiene una asignada) -- multi-pueblo, no debe verse la lista de
        // otro pueblo. La RPC de autoasignación también lo exige del lado
        // del servidor; esto es solo para no ni siquiera mostrarlo.
        (() => {
          let q = supabase
            .from('ol_pedidos')
            .select('id, numero, nombre_cliente, telefono, direccion, ciudad, referencias, total, geo_lat, geo_lng, notas, zona_id')
            .eq('estado', 'confirmado')
          if (rep.zona_id) q = q.eq('zona_id', rep.zona_id)
          return q.order('numero', { ascending: false })
        })(),
        supabase
          .from('rep_asignaciones')
          .select('pedido_id, tienda_id')
          .in('estado', ['asignado', 'recolectado', 'en_ruta']),
        // Pool de entregas: pedidos ya pagados en caja por un comprador, sin motorizado
        // asignado todavia. Solo se usa en modo repartidor, pero se pide siempre en el
        // mismo Promise.all para no complicar la carga condicional.
        supabase
          .from('rep_asignaciones')
          .select('id, pedido_id, shopper_id, ol_pedidos(numero,nombre_cliente,direccion,ciudad,total,telefono,geo_lat,geo_lng,metodo_pago,pago_confirmado,notas,zona_id)')
          .eq('estado', 'recolectado')
          .is('rider_id', null),
      ])

      // Base para shoppers especializados por tienda (útil ya para separar
      // Tía/Tuti si hace falta, y pensado para restaurantes más adelante):
      // sin filas aquí, ve todas las tiendas como siempre.
      const { data: afinidadTiendas } = await supabase
        .from('rep_repartidores_tiendas')
        .select('tienda_id')
        .eq('repartidor_id', rep.id)
      const tiendasPermitidas = afinidadTiendas && afinidadTiendas.length > 0
        ? new Set(afinidadTiendas.map((t: any) => t.tienda_id))
        : null

      // Obtener coordenadas de direcciones verificadas para todos los teléfonos cargados
      const activePhones = Array.from(new Set([
        ...(asigs ?? []).map((a: any) => a.ol_pedidos?.telefono),
        ...(pool ?? []).map((p: any) => p.ol_pedidos?.telefono)
      ].filter(Boolean)))

      const { data: verifiedDirs } = activePhones.length
        ? await supabase
            .from('rep_clientes_direcciones')
            .select('telefono, direccion, geo_lat, geo_lng')
            .in('telefono', activePhones)
        : { data: [] as any[] }

      // Agrupar direcciones verificadas por teléfono en un Map de arreglos
      const dirMap = new Map<string, any[]>()
      ;(verifiedDirs ?? []).forEach((d: any) => {
        const list = dirMap.get(d.telefono) || []
        list.push(d)
        dirMap.set(d.telefono, list)
      })

      // Contador de entregas de hoy (exitosas/fallidas), solo relevante en modo repartidor
      if (expectedModo === 'repartidor') {
        const inicioHoy = new Date(); inicioHoy.setHours(0,0,0,0)
        const { data: entHoy } = await supabase
          .from('rep_entregas')
          .select('exitosa')
          .eq('repartidor_id', rep.id)
          .gte('entregado_at', inicioHoy.toISOString())
        setEntregasHoy({
          exitosas: (entHoy ?? []).filter(e => e.exitosa).length,
          fallidas: (entHoy ?? []).filter(e => !e.exitosa).length,
        })
      }

      // El nombre/telefono del shopper se pide aparte contra la vista publica
      // (rep_repartidores_pub) en vez de embeber la tabla completa: con RLS
      // activado, un colaborador ya no puede leer la fila entera de OTRO
      // colaborador (email, cedula, efectivo en mano), solo estos datos
      // inofensivos.
      const shopperIds = Array.from(new Set((pool ?? []).map((p: any) => p.shopper_id).filter(Boolean)))
      const { data: shoppersPub } = shopperIds.length
        ? await supabase.from('rep_repartidores_pub').select('id,nombre,telefono').in('id', shopperIds)
        : { data: [] as any[] }
      const shopperMap = new Map((shoppersPub ?? []).map((s: any) => [s.id, s]))

      setPedidos((asigs ?? []).map((a: any) => {
        const tel = a.ol_pedidos?.telefono
        const listDirs = tel ? dirMap.get(tel) : null
        
        // Buscar si entre las direcciones guardadas hay alguna similar a la del pedido actual
        const matchDir = listDirs?.find((d: any) => sonDireccionesSimilares(d.direccion, a.ol_pedidos?.direccion))
        
        const notasLower = (a.ol_pedidos?.notas || '').toLowerCase()
        const esTransferencia = a.ol_pedidos?.metodo_pago === 'transferencia' || notasLower.includes('pago: transferencia') || notasLower.includes('transferencia bancaria')

        return {
          asignacion_id:  a.id,
          estado:         a.estado,
          pedido_estado:  a.ol_pedidos?.estado,
          pedido_id:      a.pedido_id,
          numero:         a.ol_pedidos?.numero,
          nombre_cliente: a.ol_pedidos?.nombre_cliente,
          telefono:       tel,
          direccion:      a.ol_pedidos?.direccion,
          ciudad:         a.ol_pedidos?.ciudad,
          referencias:    a.ol_pedidos?.referencias,
          total:          a.ol_pedidos?.total,
          costo_envio:    a.ol_pedidos?.costo_envio ?? null,
          geo_lat:        a.ol_pedidos?.geo_lat || matchDir?.geo_lat || null,
          geo_lng:        a.ol_pedidos?.geo_lng || matchDir?.geo_lng || null,
          notas:          a.ol_pedidos?.notas,
          metodo_pago:     esTransferencia ? 'transferencia' : (a.ol_pedidos?.metodo_pago || 'efectivo'),
          pago_confirmado: a.ol_pedidos?.pago_confirmado,
          compra_iniciada_at: a.compra_iniciada_at,
          rider_id:       a.rider_id,
          shopper_id:     a.shopper_id,
        }
      }))

      // Multi-tienda: un pedido puede tener una asignación (admin forzó todo
      // junto, sin distinguir tienda -- tienda_id NULL) que sí lo saca por
      // completo del pool, o asignaciones parciales POR tienda que solo
      // deben ocultar esa tienda puntual, dejando el resto reclamable.
      const assignedSinTienda = new Set(
        (activeAsigs ?? []).filter((a: any) => a.tienda_id === null).map((a: any) => a.pedido_id)
      )
      const tiendasTomadasPorPedido = new Map<string, Set<string>>()
      ;(activeAsigs ?? []).forEach((a: any) => {
        if (!a.tienda_id) return
        if (!tiendasTomadasPorPedido.has(a.pedido_id)) tiendasTomadasPorPedido.set(a.pedido_id, new Set())
        tiendasTomadasPorPedido.get(a.pedido_id)!.add(a.tienda_id)
      })

      const filteredPends = (pends ?? []).filter(p => !assignedSinTienda.has(p.id))

      // Tiendas de cada pedido pendiente, para que el comprador vea a cuál
      // pertenece y pueda elegir la suya si hay más de una (y para ocultar
      // las que ya reclamó otro comprador).
      let tiendasPends: Record<string, { id: string; nombre: string; tomada: boolean }[]> = {}
      if (filteredPends.length > 0) {
        const { data: itemsPends } = await supabase
          .from('ol_pedido_items')
          .select('pedido_id, tienda_id')
          .in('pedido_id', filteredPends.map(p => p.id))
        const idsTienda = Array.from(new Set((itemsPends ?? []).map((i: any) => i.tienda_id).filter(Boolean))) as string[]
        const { data: tiendasInfo } = idsTienda.length
          ? await supabase.from('ol_tiendas').select('id, nombre').in('id', idsTienda)
          : { data: [] as any[] }
        const nombreTienda = new Map((tiendasInfo ?? []).map((t: any) => [t.id, t.nombre]))
        ;(itemsPends ?? []).forEach((it: any) => {
          if (!it.tienda_id) return
          // Shopper especializado (rep_repartidores_tiendas): ni siquiera
          // se lista la tienda que no le corresponde, no solo se bloquea.
          if (tiendasPermitidas && !tiendasPermitidas.has(it.tienda_id)) return
          if (!tiendasPends[it.pedido_id]) tiendasPends[it.pedido_id] = []
          const yaListada = tiendasPends[it.pedido_id].some(t => t.id === it.tienda_id)
          if (!yaListada) {
            tiendasPends[it.pedido_id].push({
              id: it.tienda_id,
              nombre: nombreTienda.get(it.tienda_id) ?? 'Tienda',
              tomada: tiendasTomadasPorPedido.get(it.pedido_id)?.has(it.tienda_id) ?? false,
            })
          }
        })
      }

      // Si el pedido tiene tiendas identificadas y TODAS ya fueron
      // reclamadas por otros compradores, no queda nada disponible ahí --
      // se saca de la lista igual que antes se sacaba por completo. Un
      // shopper especializado tampoco ve pedidos sin tienda identificada
      // (no se puede confirmar que le corresponda -- por seguridad se
      // oculta en vez de mostrarlo).
      const conTiendasDisponibles = filteredPends.filter(p => {
        const t = tiendasPends[p.id]
        if (tiendasPermitidas && (!t || t.length === 0)) return false
        return !t || t.length === 0 || t.some(x => !x.tomada)
      })

      setPedidosEspera(conTiendasDisponibles.map(p => ({ ...p, tiendas: tiendasPends[p.id] ?? [] })))

      // Tienda(s) donde recoger cada pedido del pool (puede ser mas de una: Tuti + Tia + La Crayola)
      const poolPedidoIds = (pool ?? []).map((a: any) => a.pedido_id)
      let tiendasPool: Record<string, { nombres: string; direccion: string | null }> = {}
      if (poolPedidoIds.length > 0) {
        const { data: pickingPool } = await supabase
          .from('rep_picking')
          .select('pedido_id, ol_tiendas(nombre, direccion)')
          .in('pedido_id', poolPedidoIds)
        ;(pickingPool ?? []).forEach((row: any) => {
          const nombre = row.ol_tiendas?.nombre
          if (!nombre) return
          const actual = tiendasPool[row.pedido_id]
          if (!actual) {
            tiendasPool[row.pedido_id] = { nombres: nombre, direccion: row.ol_tiendas?.direccion ?? null }
          } else if (!actual.nombres.includes(nombre)) {
            actual.nombres += ' + ' + nombre
          }
        })
      }

      // Multi-pueblo: no ofrecer traspasos de otra zona (comparación
      // defensiva del lado del cliente; la RPC de traspaso también valida
      // responsable/estado, y ambas zonas comparten el mismo shopper solo
      // si es el mismo repartidor, así que esto es principalmente para no
      // ni mostrar algo irrelevante).
      const poolMismaZona = rep.zona_id
        ? (pool ?? []).filter((a: any) => !a.ol_pedidos?.zona_id || a.ol_pedidos.zona_id === rep.zona_id)
        : (pool ?? [])

      setPoolEntregas(poolMismaZona.map((a: any) => {
        const tel = a.ol_pedidos?.telefono
        const listDirs = tel ? dirMap.get(tel) : null
        const matchDir = listDirs?.find((d: any) => sonDireccionesSimilares(d.direccion, a.ol_pedidos?.direccion))
        
        const notasLower = (a.ol_pedidos?.notas || '').toLowerCase()
        const esTransferencia = a.ol_pedidos?.metodo_pago === 'transferencia' || notasLower.includes('pago: transferencia') || notasLower.includes('transferencia bancaria')

        return {
          asignacion_id: a.id,
          pedido_id:     a.pedido_id,
          tienda_recogida: tiendasPool[a.pedido_id]?.nombres ?? null,
          tienda_direccion: tiendasPool[a.pedido_id]?.direccion ?? null,
          numero:        a.ol_pedidos?.numero,
          nombre_cliente: a.ol_pedidos?.nombre_cliente,
          direccion:     a.ol_pedidos?.direccion,
          ciudad:        a.ol_pedidos?.ciudad,
          total:         a.ol_pedidos?.total,
          telefono:      tel,
          geo_lat:       a.ol_pedidos?.geo_lat || matchDir?.geo_lat || null,
          geo_lng:       a.ol_pedidos?.geo_lng || matchDir?.geo_lng || null,
          metodo_pago:   esTransferencia ? 'transferencia' : (a.ol_pedidos?.metodo_pago || 'efectivo'),
          shopper_nombre: shopperMap.get(a.shopper_id)?.nombre ?? 'Comprador',
          shopper_telefono: shopperMap.get(a.shopper_id)?.telefono ?? '',
        }
      }))
    } catch (err: any) {
      console.error('Error loading driver data:', err)
      setErrorCarga(err?.message || String(err) || 'Error de carga desconocido')
    } finally {
      setCargando(false)
    }
  }

  async function toggleConexion() {
    if (!repartidor) return
    const nuevoEstado = !repartidor.conectado
    setProcesando(repartidor.id)
    const { error } = await supabase
      .from('rep_repartidores')
      .update({ conectado: nuevoEstado })
      .eq('id', repartidor.id)

    if (error) {
      alert('Error al cambiar de estado: ' + error.message)
    } else {
      setRepartidor(r => r ? { ...r, conectado: nuevoEstado } : null)
    }
    setProcesando(null)
  }

  async function aceptarPedido(pedidoId: string, numero: number, nombreCliente: string, telefonoCliente: string, tiendaId?: string | null) {
    if (!repartidor) return
    setProcesando(pedidoId)

    // RPC atómica: bloquea el pedido, valida que el repartidor esté
    // activo/aprobado/no bloqueado, exige estado='pendiente', crea la
    // asignación y actualiza ol_pedidos.estado en una sola transacción,
    // y es reintentable con el mismo request_id si falla la conexión
    // (migration_aceptar_pedido_atomico.sql).
    // Multi-tienda: si el pedido tiene más de una tienda, tiendaId indica
    // cuál se está reclamando -- el requestKey incluye la tienda porque dos
    // compradores distintos pueden reclamar el mismo pedido_id a la vez,
    // cada uno una tienda distinta (idempotencia por operación real, no
    // solo por pedido).
    const requestKey = `aceptar-request:${pedidoId}:${tiendaId ?? 'unica'}`
    const requestId = sessionStorage.getItem(requestKey) || crypto.randomUUID()
    sessionStorage.setItem(requestKey, requestId)

    const { error } = await supabase.rpc('aceptar_pedido_shopper', {
      p_pedido_id: pedidoId,
      p_request_id: requestId,
      p_tienda_id: tiendaId ?? null,
    })

    if (error) {
      alert('Error al auto-asignar el pedido: ' + error.message)
      setProcesando(null)
      await cargar(user!.id)
      return
    }

    sessionStorage.removeItem(requestKey)
    await cargar(user!.id)
    setProcesando(null)
  }

  async function iniciarCompra(asignacionId: string, pedidoId: string, numero: number, nombreCliente: string, telefonoCliente: string) {
    if (!repartidor) return
    setProcesando(pedidoId)

    // RPC atómica: valida que seas el shopper responsable, que el pago por
    // transferencia ya esté conciliado, y actualiza rep_asignaciones y
    // ol_pedidos.estado en una sola transacción (idempotente por request_id).
    const requestKey = `iniciar-compra-request:${asignacionId}`
    const requestId = sessionStorage.getItem(requestKey) || crypto.randomUUID()
    sessionStorage.setItem(requestKey, requestId)

    const { error } = await supabase.rpc('iniciar_compra_shopper', {
      p_asignacion_id: asignacionId,
      p_request_id: requestId,
    })

    if (error) {
      alert('Error al iniciar la compra: ' + error.message)
      setProcesando(null)
      return
    }
    sessionStorage.removeItem(requestKey)

    // Recargar datos
    await cargar(user!.id)
    setProcesando(null)

    // 3. Abrir WhatsApp para notificar al cliente (y dejar constancia -- P0-04)
    const msg = `🛒 *La Crayola - Compras en curso* \n\n¡Hola *${nombreCliente}*! Soy *${repartidor.nombre}*, tu comprador asignado de La Crayola. He recibido tu pedido *#${String(numero).padStart(4,'0')}* y voy a iniciar tus compras ahora mismo en los supermercados asociados. Te mantendré al tanto de cualquier novedad por este medio. 🧺`
    registrarYAbrirWhatsApp({ pedidoId, tipo: 'inicio_compra', mensaje: msg, telefono: telefonoCliente, asignacionId })

    // 4. Navegar a la pantalla de picking completa (escaner, avance, canasta) —
    // /picking/[id] usa el id de la ASIGNACION, no el del pedido. (FUN-01
    // de la auditoría: /repartidor/picking/[pedidoId], la version vieja
    // con mutaciones directas sin RPC, ya se eliminó del repositorio.)
    router.push(`/picking/${asignacionId}`)
  }

  // Punto unificado (auditoria_plan_correcciones_ia.md, puntos 5/15): antes
  // había 3 copias de estas mismas 2 escrituras sueltas (autotraspaso,
  // enRuta, activarParada), sin validar responsable/rol/estado. Ahora una
  // sola RPC atómica e idempotente cubre los dos casos reales del negocio:
  // shopper que compró y sigue como rider (venía de 'recolectado'), o rider
  // con asignación directa (venía de 'asignado').
  async function iniciarRutaRepartidor(asignacionId: string) {
    const geo = await new Promise<{ lat: number; lng: number } | null>(res => {
      if (typeof window === 'undefined' || !navigator?.geolocation) { res(null); return }
      navigator.geolocation.getCurrentPosition(
        p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => res(null),
        { timeout: 5000 }
      )
    })
    const requestKey = `iniciar-ruta-request:${asignacionId}`
    const requestId = sessionStorage.getItem(requestKey) || crypto.randomUUID()
    sessionStorage.setItem(requestKey, requestId)

    const { error } = await supabase.rpc('iniciar_ruta_repartidor', {
      p_asignacion_id: asignacionId,
      p_request_id: requestId,
      p_lat: geo?.lat ?? null,
      p_lng: geo?.lng ?? null,
    })
    if (!error) sessionStorage.removeItem(requestKey)
    return error
  }

  async function autotraspaso(asignacionId: string, pedidoId: string, numero: number, nombreCliente: string, telefonoCliente: string) {
    if (!repartidor) return
    setProcesando(asignacionId)

    const error = await iniciarRutaRepartidor(asignacionId)
    if (error) {
      alert('No se pudo iniciar la ruta: ' + error.message)
      setProcesando(null)
      return
    }

    // La entrega se registra únicamente al finalizarla con evidencia.
    setModo('repartidor')
    setProcesando(null)
    router.push(`/entrega/${asignacionId}`)

    const msg = `🛵 *La Crayola - ¡Tu pedido va en camino!* \n\nHola *${nombreCliente}*, tu pedido *#${String(numero).padStart(4,'0')}* ya fue comprado y va en camino a cargo de *${repartidor.nombre}*. 📍 Puedes seguir mi trayecto y contactarme directamente. ¡Llegaré en unos minutos!`
    registrarYAbrirWhatsApp({ pedidoId, tipo: 'en_camino', mensaje: msg, telefono: telefonoCliente, asignacionId })
  }

  const ultimoUserId = useRef<string | null>(null)
  useEffect(() => {
    // No se espera a que AuthContext termine de resolver el rol (resolverAcceso
    // puede tardar hasta 6s en su carrera interna) -- esta pagina ya hace su
    // propia verificacion autoritativa contra rep_repartidores dentro de
    // cargar(), asi que basta con que exista la sesion (user) para arrancar.
    // Esperar tambien a authEstado duplicaba la resolucion y era la causa
    // principal del lag de 20-30s al entrar como comprador/repartidor.
    // No se redirige a /login desde aqui aunque authEstado diga 'sin_sesion':
    // ese estado puede aparecer por un instante justo despues del login real
    // (una carrera al confirmar la sesion en el cliente, no una sesion
    // invalida de verdad) y forzar la redirecion en ese momento producia un
    // rebote infinito entre /login y /repartidor. El middleware del servidor
    // ya redirige de forma confiable a quien de verdad no tiene sesion en
    // cada peticion -- no hace falta duplicar esa logica aqui.
    if (!user) return

    // Si cambio la cuenta logueada (ej. se cerro sesion y se entro con otra para
    // probar), se limpia todo el estado de la cuenta anterior antes de recargar —
    // si no, se alcanza a ver por un instante la data/modulo de la cuenta previa.
    if (ultimoUserId.current !== user.id) {
      ultimoUserId.current = user.id
      setModoConfirmado(false)
      setCargando(true)
      setRepartidor(null)
      setPedidos([])
      setPedidosEspera([])
      setPoolEntregas([])
    }

    cargar(user.id)
  }, [user, authEstado, modo, rol])

  // Refresco en tiempo real: pedidos nuevos liberados a la cola, o cambios en mis asignaciones
  useEffect(() => {
    if (!user) return
    const canal = supabase
      .channel('repartidor-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ol_pedidos' }, () => cargar(user.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rep_asignaciones' }, () => cargar(user.id))
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [user])

  async function enRuta(asignacionId: string, pedidoId: string) {
    if (!repartidor) return
    setProcesando(asignacionId)
    const error = await iniciarRutaRepartidor(asignacionId)
    setProcesando(null)
    if (error) { alert('No se pudo iniciar la ruta: ' + error.message); return }
    router.push(`/entrega/${asignacionId}`)
  }

  const activarParada = async (p: any) => {
    if (!repartidor) return
    setParadaActivaId(p.asignacion_id)
    if (typeof window !== 'undefined') {
      localStorage.setItem('paradaActivaId', p.asignacion_id)
    }
    
    if (p.estado === 'asignado') {
      setProcesando(p.asignacion_id)
      try {
        const error = await iniciarRutaRepartidor(p.asignacion_id)
        if (error) { console.error('Error al activar parada:', error.message); return }
        await cargar(user!.id)
      } catch (err) {
        console.error("Error al activar parada:", err)
      } finally {
        setProcesando(null)
      }
    }

    if (p.geo_lat && p.geo_lng) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${p.geo_lat},${p.geo_lng}`, '_blank')
    }
  }

  async function confirmarRetiroCliente(asignacionId: string, pedidoId: string) {
    setProcesando(asignacionId)
    const requestKey=`retiro-request:${asignacionId}`
    const requestId=sessionStorage.getItem(requestKey)||crypto.randomUUID();sessionStorage.setItem(requestKey,requestId)
    const {error}=await supabase.rpc('finalizar_entrega_atomica',{
      p_request_id:requestId,p_asignacion_id:asignacionId,
      p_monto:pedidos.find(p=>p.asignacion_id===asignacionId)?.total??0,p_metodo:'retiro_local',
      p_lat:null,p_lng:null,p_foto_url:null,p_firma_url:null,p_referencias:null,
    })
    if(error){alert('No se pudo confirmar el retiro: '+error.message);setProcesando(null);return}
    sessionStorage.removeItem(requestKey)
    await cargar(user!.id)
    setProcesando(null)
  }

  // NOTA (auditoria_plan_correcciones_ia.md, punto 6/15): existía aquí una
  // función `entregar()` que escribía por separado en rep_asignaciones,
  // ol_pedidos, rep_entregas, rep_cuentas_cobrar y rep_transacciones_caja
  // sin transacción ni evidencia. No tenía ningún botón que la invocara
  // (superada por finalizarEntregaConPOD(), que sí usa la RPC atómica
  // finalizar_entrega_atomica con foto y firma obligatorias). Se eliminó
  // para no dejar un camino alterno de entrega bypasseando la evidencia.

  // Modal "Entregar efectivo": estaba duplicado dos veces en este archivo
  // (idéntico en modo comprador y modo repartidor). Se unifica aquí y
  // ahora ofrece 3 métodos: a un colega (como antes), depósito bancario, o
  // transferencia -- estas dos últimas exigen marcar qué pedidos cobrados
  // en efectivo cubren, y comprobante con foto.
  const renderModalTraspaso = () => !showTraspaso ? null : (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 text-left">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl p-5 w-full sm:max-w-sm space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-slate-800 text-base flex items-center gap-1.5">
            <ArrowRightLeft size={16} className="text-green-600" /> Entregar efectivo
          </h3>
          <button onClick={() => setShowTraspaso(false)} className="text-slate-400 p-1 cursor-pointer"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-orange-50 border border-orange-100 rounded-xl px-3 py-2.5">
            <div className="text-sm font-black text-orange-600">{fmt(repartidor?.efectivo_en_mano ?? 0)}</div>
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
            <button key={m.k} type="button" onClick={() => setMetodoTraspaso(m.k as any)}
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
                  placeholder={(repartidor?.efectivo_en_mano ?? 0).toFixed(2)}
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

  const renderCardRepartidor = (p: any, isActive: boolean) => {
    const numPedido = String(p.numero).padStart(4, '0')
    return (
      <div key={p.asignacion_id} className={`bg-white rounded-3xl border transition-all ${
        isActive 
          ? 'border-red-500 shadow-md ring-2 ring-red-500/10' 
          : 'border-slate-200/80 shadow-sm opacity-95'
      } overflow-hidden`}>
        {/* Cabecera del pedido */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-extrabold flex items-center justify-center shrink-0">
              {ordenParadas[p.asignacion_id] ?? (pedidos.filter(x => x.estado === 'en_ruta' || x.estado === 'asignado').findIndex(x => x.asignacion_id === p.asignacion_id) + 1)}
            </span>
            <Package size={15} className="text-slate-400" />
            <span className="font-bold text-slate-800 text-xs">Pedido #{numPedido}</span>
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${EST_COLOR[p.estado] ?? 'bg-slate-100 text-slate-600'}`}>
              {p.estado === 'en_ruta' ? 'En camino' : 'Asignado'}
            </span>
          </div>
          <span className="font-bold text-green-700 text-xs">{fmt(montoACobrar(p))}</span>
        </div>

        {/* Banner de Pago Destacado */}
        {p.metodo_pago === 'transferencia' && p.pago_confirmado === true && (
          <div className="bg-emerald-500 text-white font-extrabold text-[10px] py-2 text-center shadow-inner">
            💳 PAGADO POR TRANSFERENCIA (Confirmado)
          </div>
        )}
        {p.metodo_pago === 'transferencia' && p.pago_confirmado !== true && (
          <div className="bg-yellow-500 text-slate-900 font-extrabold text-[10px] py-2 text-center shadow-inner animate-pulse">
            ⚠️ TRANSFERENCIA POR CONFIRMAR: {fmt(montoACobrar(p))}
          </div>
        )}
        {(!p.metodo_pago || p.metodo_pago === 'efectivo') && (
          <div className="bg-orange-600 text-white font-extrabold text-[10px] py-2 text-center shadow-inner">
            💵 COBRAR EN EFECTIVO: {fmt(montoACobrar(p))}
          </div>
        )}

        {/* Datos cliente */}
        <div className="px-4 py-3 space-y-2.5">
          <div className="flex items-start gap-2">
            <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-green-700">{p.nombre_cliente?.[0]}</span>
            </div>
            <div>
              <div className="font-bold text-slate-800 text-xs">{p.nombre_cliente}</div>
              <a href={`tel:${p.telefono}`} className="flex items-center gap-1 text-[11px] text-green-600 font-semibold">
                <Phone size={10} /> {p.telefono}
              </a>
            </div>
          </div>

          {p.direccion && (
            <div className="flex items-start gap-2 text-xs text-slate-500">
              <MapPin size={12} className="shrink-0 mt-0.5 text-slate-400" />
              <div>
                <div className="font-medium">{p.direccion}, {p.ciudad}</div>
                {p.referencias && <div className="text-[10px] text-slate-400 mt-0.5">{p.referencias}</div>}
              </div>
            </div>
          )}

          {p.notas && (
            <div className="bg-yellow-50 border border-yellow-100 rounded-lg px-2.5 py-1.5 text-[10px] text-yellow-800">
              📝 {p.notas}
            </div>
          )}
        </div>

        {/* Acciones */}
        <div className="px-4 pb-4 space-y-2">
          {isActive ? (
            /* SI ES LA PARADA ACTIVA: Mostrar todos los controles de cobro, mapa y POD */
            <div className="space-y-3 pt-2 border-t border-slate-100">
              {p.geo_lat && p.geo_lng && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${p.geo_lat},${p.geo_lng}`}
                  target="_blank" rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-extrabold py-2.5 rounded-xl text-xs shadow-sm border border-blue-200"
                >
                  <Navigation size={12} /> Navegar con GPS (Google Maps)
                </a>
              )}

              {p.estado === 'en_ruta' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <DollarSign size={14} className="text-slate-400 shrink-0" />
                    <input
                      type="number" step="0.01" min="0"
                      // Antes empezaba vacío y el total solo aparecía como
                      // placeholder de ayuda -- fácil de pasar por alto,
                      // sobre todo el envío (que no se "ve" físicamente
                      // como el precio de los productos). Ahora arranca
                      // con el total real ya puesto; si cobra distinto,
                      // tiene que editarlo a propósito.
                      value={cobro[p.asignacion_id] ?? montoACobrar(p).toFixed(2)}
                      onChange={e => setCobro(c => ({ ...c, [p.asignacion_id]: e.target.value }))}
                      className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-green-500"
                    />
                  </div>

                  {/* Antes había un botón "Confirmar GPS de Entrega" aquí
                      mismo, que corregía ol_pedidos + rep_clientes_direcciones
                      con escrituras sueltas, sin transacción y desconectadas
                      del cierre real de la entrega (P0-03 de la auditoría
                      operativa) -- /entrega/[id] ya tiene su propio paso de
                      confirmar/corregir GPS, ahora atómico con el cierre.
                      Se elimina para no dejar dos caminos que puedan
                      divergir otra vez. */}

                  {/* Antes abría un modal propio (foto+firma+cobro) que
                      duplicaba casi entero /entrega/[id] -- con divergencias
                      reales entre las dos copias (P0-02 de la auditoría
                      operativa). Ahora navega a la única pantalla de
                      cierre de entrega, para que cualquier corrección
                      futura aplique sin importar por dónde se entre. */}
                  <button
                    onClick={() => router.push(`/entrega/${p.asignacion_id}`)}
                    disabled={procesando !== null}
                    className="w-full flex items-center justify-center gap-1.5 bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-60 text-white font-bold py-3 rounded-xl transition text-xs cursor-pointer shadow-md"
                  >
                    <CheckCircle size={14} />
                    Confirmar entrega (Foto y Firma)
                  </button>
                </div>
              )}

              {/* Plantillas de WhatsApp */}
              <div className="pt-2.5 border-t border-slate-100 mt-2 space-y-2 text-left">
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">💬 WhatsApp rápido:</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <a
                    href={`https://wa.me/${formatWhatsApp(p.telefono)}?text=${encodeURIComponent(
                      "Hola " + p.nombre_cliente + ", te saluda " + (repartidor?.nombre || "tu Repartidor") + " de La Crayola. Tu pedido #" + p.numero + " va en camino a tu domicilio."
                      + (distanciaEntreParadas[p.asignacion_id] ? ` Llego en aproximadamente ${minutosEstimados(distanciaEntreParadas[p.asignacion_id])} minutos.` : ' Por favor estar atento.')
                    )}`}
                    target="_blank" rel="noopener noreferrer"
                    className="bg-green-50 hover:bg-green-100 border border-green-200 text-green-700 text-[10px] font-bold py-2 rounded-xl text-center flex items-center justify-center gap-1"
                  >
                    🛵 En Camino
                  </a>
                  <a
                    href={`https://wa.me/${formatWhatsApp(p.telefono)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="border border-slate-200 hover:bg-slate-50 text-slate-600 text-[10px] font-bold py-2 rounded-xl text-center flex items-center justify-center gap-1"
                  >
                    💬 Chat Directo
                  </a>
                </div>
              </div>
            </div>
          ) : (
            /* SI NO ES LA PARADA ACTIVA: Mostrar solo botón de activación Voy para allá */
            <button
              onClick={() => activarParada(p)}
              disabled={procesando !== null}
              className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-50 text-white font-extrabold py-3 rounded-xl transition text-xs flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
            >
              {procesando === p.asignacion_id ? <Loader2 size={13} className="animate-spin" /> : <span>🛵 Voy para allá →</span>}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (errorCarga) {
    return (
      <div className="min-h-screen bg-[#0c0f12] text-white flex flex-col items-center justify-center p-6 text-center"
        style={{ backgroundImage: 'radial-gradient(at 0% 0%, rgba(220,38,38,0.07) 0px, transparent 50%)' }}>
        <div className="w-full max-w-md bg-[#181d24] border border-[#2d3748] rounded-3xl p-8 text-center space-y-6 shadow-2xl">
          <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center mx-auto text-red-500">
            <AlertCircle size={28} />
          </div>
          <h1 className="text-xl font-bold text-white">Error al cargar datos</h1>
          <p className="text-gray-400 text-sm leading-relaxed">
            Ocurrió un error al intentar cargar los datos del repartidor desde el servidor:
          </p>
          <div className="bg-[#0c0f12] border border-[#2d3748] rounded-2xl p-4 text-left font-mono text-xs overflow-x-auto text-red-400 whitespace-pre-wrap max-h-48">
            {errorCarga}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => { setErrorCarga(null); setCargando(true); setModoConfirmado(false); cargar(user!.id) }}
              className="flex-1 bg-[#00b074] hover:bg-[#008f5d] text-white font-bold py-3.5 rounded-2xl transition text-sm cursor-pointer"
            >
              Reintentar
            </button>
            <form action={logout} className="flex-1">
              <button type="submit" className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3.5 rounded-2xl transition text-sm cursor-pointer">
                Cerrar sesión
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  if (!user || cargando || !modoConfirmado) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
      <Loader2 size={28} className="animate-spin text-green-600" />
      {/* Salida de emergencia: si la carga se queda pegada (ej. problema de
          red o de sesion), tras unos segundos aparece esta opcion para no
          dejar a nadie sin forma de cerrar sesion e intentar de nuevo. */}
      {cargaAtascada && (
        <form action={logout}>
          <button type="submit" className="text-xs text-gray-500 underline underline-offset-2">
            Esto está tardando demasiado — Cerrar sesión e intentar de nuevo
          </button>
        </form>
      )}
    </div>
  )

  if (accesoDenegado) {
    return (
      <div className="min-h-screen bg-[#0c0f12] flex items-center justify-center px-4"
        style={{ backgroundImage: 'radial-gradient(at 0% 0%, rgba(0,176,116,0.1) 0px, transparent 50%)' }}>
        <div className="w-full max-w-md bg-[#181d24] border border-[#2d3748] rounded-3xl p-8 text-center space-y-6 shadow-2xl">
          {accesoDenegado.estado_registro === 'pendiente' ? (
            <>
              <div className="w-20 h-20 bg-yellow-500/10 border border-yellow-500/20 rounded-3xl flex items-center justify-center mx-auto text-4xl animate-pulse">⏳</div>
              <h1 className="text-xl font-bold text-white">Registro en revisión</h1>
              <p className="text-gray-400 text-sm leading-relaxed">
                Hola <span className="text-white font-semibold">{accesoDenegado.nombre}</span>. Tu solicitud de registro como repartidor está siendo revisada por el administrador de La Crayola.
              </p>
              <p className="text-yellow-500 text-xs font-semibold">
                Te avisaremos en cuanto tu cuenta sea activada.
              </p>
            </>
          ) : accesoDenegado.estado_registro === 'rechazado' ? (
            <>
              <div className="w-20 h-20 bg-red-500/10 border border-red-500/20 rounded-3xl flex items-center justify-center mx-auto text-4xl">❌</div>
              <h1 className="text-xl font-bold text-white">Solicitud Rechazada</h1>
              <p className="text-gray-400 text-sm leading-relaxed">
                Lo sentimos, <span className="text-white font-semibold">{accesoDenegado.nombre}</span>. Tu solicitud de ingreso para el sistema de reparto fue rechazada.
              </p>
              <p className="text-red-400 text-xs leading-relaxed">
                Si consideras que es un error, por favor contacta al supervisor de operaciones.
              </p>
            </>
          ) : (
            <>
              <div className="w-20 h-20 bg-red-500/10 border border-red-500/20 rounded-3xl flex items-center justify-center mx-auto text-4xl">🔒</div>
              <h1 className="text-xl font-bold text-white">Acceso Restringido</h1>
              <p className="text-gray-400 text-sm leading-relaxed">
                Esta cuenta (<span className="text-white font-semibold">{accesoDenegado.nombre}</span>) no está registrada o autorizada como repartidor/shopper activo.
              </p>
              <p className="text-red-400 text-xs leading-relaxed">
                Por favor, solicita al administrador que agregue tu correo en la Consola del Administrador.
              </p>
            </>
          )}
          
          <form action={logout}>
            <button type="submit" className="w-full bg-[#00b074] hover:bg-[#008f5d] text-white font-bold py-3.5 rounded-2xl transition flex items-center justify-center gap-2 text-sm cursor-pointer">
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (repartidor && (repartidor.estado === 'BLOQUEADO' || (modo === 'repartidor' && (repartidor.efectivo_en_mano ?? 0) > 100))) {
    return (
      <div className="min-h-screen bg-[#0c0f12] text-white flex flex-col items-center justify-center p-6 text-center select-none"
        style={{ backgroundImage: 'radial-gradient(at 0% 0%, rgba(239,68,68,0.1) 0px, transparent 50%)' }}>
        <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center mb-6 text-red-500 animate-pulse text-2xl">
          🔒
        </div>
        <h1 className="text-xl font-black text-red-500 mb-2">BILLETERA BLOQUEADA</h1>
        <p className="text-slate-400 text-xs max-w-xs mb-6 leading-relaxed">
          Has superado el límite de efectivo permitido en mano (**$100.00**). Debes liquidar tu saldo para continuar recibiendo pedidos.
        </p>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 w-full max-w-xs mb-6">
          <div className="text-[10px] text-slate-400 mb-1 uppercase tracking-wider font-semibold">Efectivo en mano actual</div>
          <div className="text-3xl font-black text-white">{fmt(repartidor.efectivo_en_mano)}</div>
        </div>

        <div className="flex flex-col gap-2.5 w-full max-w-xs">
          <button
            onClick={() => setShowTraspaso(true)}
            className="w-full bg-[#00b074] hover:bg-[#008f5d] text-white font-bold py-3.5 rounded-xl transition text-xs cursor-pointer shadow-md"
          >
            🤝 Traspasar efectivo a colega
          </button>
          
          <button
            onClick={() => cargar(user!.id)}
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-355 font-bold py-3.5 rounded-xl transition text-xs cursor-pointer"
          >
            🔄 Verificar liquidación
          </button>
        </div>

        {/* Modal: Entregar efectivo en mano */}
        {renderModalTraspaso()}
      </div>
    )
  }

  const totalACobrar = pedidos.filter(p => p.estado === 'asignado' || p.estado === 'en_ruta')
    .reduce((s, p) => s + montoACobrar(p), 0)

  // Clasificacion interna del comprador en las 6 pestañas
  const pedidosAceptadas    = pedidos.filter(p => p.estado === 'asignado' && !p.compra_iniciada_at)
  const pedidosPreparando   = pedidos.filter(p => p.estado === 'asignado' && !!p.compra_iniciada_at)
  const pedidosPorEntregar  = pedidos.filter(p => p.estado === 'recolectado')
  const pedidosEntregadasRep = pedidos.filter(p =>
    (p.estado === 'en_ruta' || p.estado === 'entregado') && p.rider_id && p.rider_id !== p.shopper_id)
  // Incluye 'en_ruta' ademas de 'entregado': mientras el comprador va en camino
  // entregando el mismo, el pedido debe seguir visible aqui (antes desaparecia
  // de las 6 pestañas hasta quedar "entregado", como si se hubiera perdido).
  const pedidosEntregadasYo = pedidos.filter(p =>
    (p.estado === 'en_ruta' || p.estado === 'entregado') && p.rider_id && p.rider_id === p.shopper_id)

  const listaActivaComprador: PedidoAsignado[] =
    pestana === 'aceptadas'     ? pedidosAceptadas :
    pestana === 'preparando'    ? pedidosPreparando :
    pestana === 'porentregar'   ? pedidosPorEntregar :
    pestana === 'entregadasrep' ? pedidosEntregadasRep :
    pestana === 'entregadasyo'  ? pedidosEntregadasYo : []

  // Menú inferior (solo modo comprador): si hay un solo pedido "Preparando", ir directo
  // a su picking en vez de pasar por la pestaña — el celular lo va a tener en la mano
  // dentro del super, mientras menos toques mejor.
  function irAComprando() {
    if (pedidosPreparando.length === 1) {
      router.push(`/picking/${pedidosPreparando[0].asignacion_id}`)
    } else {
      setPestana('preparando')
    }
  }

  return (
    <>
    <div className={`min-h-screen bg-slate-50 pb-20`}>
      {/* Header completo: solo en Inicio (comprador) o siempre en modo repartidor */}
      {(modo === 'repartidor' || pestana === 'inicio') && (
        <div className="bg-green-700 text-white px-4 pt-10 pb-4 space-y-1">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-200 text-xs">Hola,</p>
              <h1 className="text-xl font-extrabold">{repartidor?.nombre ?? 'Repartidor'}</h1>
              <button
                onClick={toggleConexion}
                disabled={procesando === repartidor?.id}
                className={`mt-1 flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full border transition-all cursor-pointer active:scale-95 disabled:opacity-50 select-none ${
                  repartidor?.conectado
                    ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-200'
                    : 'bg-slate-500/20 border-slate-400/30 text-slate-300'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${repartidor?.conectado ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
                {repartidor?.conectado ? 'ON Turno Activo' : 'OFF Desconectado'}
              </button>
            </div>
            <div className="flex items-center gap-3">
              {modo === 'repartidor' ? (
                <div className="text-right">
                  <div className="text-xs text-green-200">A cobrar hoy</div>
                  <div className="text-lg font-extrabold">{fmt(totalACobrar)}</div>
                </div>
              ) : (
                <div className="text-right">
                  <div className="text-xs text-green-200">Compras pendientes</div>
                  <div className="text-lg font-extrabold">{pedidos.length} pedidos</div>
                </div>
              )}
              {modo === 'repartidor' ? (
                // Menú hamburguesa: agrupa lo que se usa ocasionalmente
                // (traspaso, caja, comisiones, perfil, salir) para que la
                // pantalla de Inicio se quede solo con lo que se usa todo
                // el tiempo. Badge rojo si hay algo que requiere atención.
                <button onClick={() => setMenuAbierto(true)}
                  className="relative w-9 h-9 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center transition shrink-0 cursor-pointer">
                  <Menu size={19} />
                  {(repartidor?.efectivo_en_mano ?? 0) > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-yellow-400 rounded-full border-2 border-green-700" />
                  )}
                </button>
              ) : (
                <>
                  <Link href="/repartidor/perfil"
                    className="w-9 h-9 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center transition shrink-0">
                    <UserCircle size={20} />
                  </Link>
                  <form action={logout} className="shrink-0">
                    <button type="submit" title="Cerrar sesión" className="w-9 h-9 bg-red-600/30 hover:bg-red-600/50 rounded-full flex items-center justify-center transition cursor-pointer text-white">
                      <LogOut size={15} />
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
          {/* Dynamic Role Switcher (🧺 Compras / 🛵 Entregas) - Solo para rol híbrido 'comprador-repartidor' */}
          {rol === 'comprador-repartidor' && (
            <div className="flex bg-white/15 p-1 rounded-xl w-full max-w-[280px] mx-auto mt-2 mb-1">
              <button
                onClick={() => setModo('comprador')}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-extrabold transition-all flex items-center justify-center gap-1 ${
                  modo === 'comprador' ? 'bg-white text-green-800 shadow-xs' : 'text-green-150 hover:text-white'
                }`}
              >
                🧺 Modo Compras
              </button>
              <button
                onClick={() => setModo('repartidor')}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-extrabold transition-all flex items-center justify-center gap-1 ${
                  modo === 'repartidor' ? 'bg-white text-green-800 shadow-xs' : 'text-green-150 hover:text-white'
                }`}
              >
                🛵 Modo Entregas
              </button>
            </div>
          )}
          {/* En modo comprador se deja la fila de pastillas de siempre
              (poca prisa, se usa parado en el super). En modo repartidor
              se reemplaza por una columna de accesos grandes -- la fila
              horizontal con scroll obligaba a usar las dos manos (una
              sostiene, otra apunta al deslizar), justo lo que no se puede
              hacer manejando. Referencia: mockup PeYa Rider/Tipti Shopper. */}
          {modo === 'comprador' && (
            <div className="flex gap-2.5 pt-2 overflow-x-auto no-scrollbar">
              <div className="bg-white/20 rounded-xl px-3 py-1.5 text-[11px] font-semibold shrink-0">
                📦 {pedidos.length} asignados
              </div>
              <button
                onClick={() => router.push('/repartidor/comisiones')}
                className="bg-white/20 hover:bg-white/30 rounded-xl px-3 py-1.5 text-[11px] font-semibold shrink-0 transition cursor-pointer"
              >
                💵 Comisión: ${repartidor?.comision_valor ?? 1}/v
              </button>
              <button
                onClick={abrirTraspaso}
                className="bg-white/20 hover:bg-white/30 rounded-xl px-3 py-1.5 text-[11px] font-semibold shrink-0 text-yellow-300 border border-yellow-400/25 flex items-center gap-1 transition cursor-pointer"
              >
                💰 Caja: {fmt(repartidor?.efectivo_en_mano ?? 0)}
                <ArrowRightLeft size={11} className="text-yellow-300/80" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Barra compacta: cuando el comprador entra a una sección por el menú inferior
          (no Inicio), se reemplaza el encabezado grande y la cuadrícula por esto,
          para aprovechar toda la pantalla en la lista de pedidos. */}
      {modo === 'comprador' && pestana !== 'inicio' && (
        <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
          <button
            onClick={() => setPestana('inicio')}
            className="flex items-center gap-2 text-slate-700 font-bold text-sm cursor-pointer"
          >
            <span className="text-lg">←</span>
            {({
              aceptadas: '📥 Aceptadas',
              preparando: '🛒 Preparando',
              porentregar: '📦 Por entregar',
              entregadasrep: '🛵 A repartidor',
              entregadasyo: '✅ Por mí mismo',
            } as Record<string, string>)[pestana]}
            <span className="text-slate-400 font-semibold">({listaActivaComprador.length})</span>
          </button>
          <button
            onClick={abrirTraspaso}
            className="flex items-center gap-1 text-[11px] font-bold text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-2.5 py-1.5 cursor-pointer"
          >
            💰 {fmt(repartidor?.efectivo_en_mano ?? 0)}
          </button>
        </div>
      )}

      {/* Tab Switcher for Shoppers: 6 pestañas de clasificación interna (solo en Inicio) */}
      {modo === 'comprador' && pestana === 'inicio' && (
        <div className="grid grid-cols-3 gap-1.5 mx-4 mt-3">
          {([
            { key: 'inicio' as const,        label: 'Inicio',       emoji: '🧺', count: pedidosEspera.length, alerta: pedidosEspera.length > 0 },
            { key: 'aceptadas' as const,      label: 'Aceptadas',    emoji: '📥', count: pedidosAceptadas.length },
            { key: 'preparando' as const,     label: 'Preparando',   emoji: '🛒', count: pedidosPreparando.length },
            { key: 'porentregar' as const,    label: 'Por entregar', emoji: '📦', count: pedidosPorEntregar.length, alerta: pedidosPorEntregar.length > 0 },
            { key: 'entregadasrep' as const,  label: 'A repartidor', emoji: '🛵', count: pedidosEntregadasRep.length },
            { key: 'entregadasyo' as const,   label: 'Por mí mismo', emoji: '✅', count: pedidosEntregadasYo.length },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setPestana(t.key)}
              className={`relative rounded-xl py-2 px-1 text-center transition-all border ${
                pestana === t.key
                  ? 'bg-white border-[#00b074] shadow-xs'
                  : 'bg-slate-100/80 border-transparent hover:bg-white'
              }`}
            >
              <div className="text-base leading-none">{t.emoji}</div>
              <div className={`text-[9px] font-black mt-1 leading-tight ${pestana === t.key ? 'text-[#00b074]' : 'text-slate-500'}`}>
                {t.label}
              </div>
              <div className={`text-[9px] font-bold ${pestana === t.key ? 'text-slate-600' : 'text-slate-400'}`}>
                ({t.count})
              </div>
              {t.alerta && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-ping" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Pool de entregas listas para recoger: pedidos que un comprador ya pago en caja
          y todavia no tienen motorizado asignado. Independiente del modulo de comprador. */}
      {modo === 'repartidor' && pestanaRepartidor === 'recoger' && (
        <div className="px-4 pt-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            📦 Listas para recoger
          </p>
          {!repartidor?.conectado ? (
            <div className="bg-white border border-slate-250/60 rounded-3xl p-8 text-center text-xs text-slate-500 space-y-2.5 shadow-xs">
              <span className="text-3xl block">😴</span>
              <div className="font-extrabold text-slate-700">Estás desconectado</div>
              <p className="text-[10px] text-slate-400 max-w-xs mx-auto leading-relaxed">
                Activa tu turno en la cabecera (haciendo clic en **OFF Desconectado**) para comenzar a recibir entregas en San Miguel de los Bancos.
              </p>
            </div>
          ) : poolEntregas.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-2xl p-4 text-center text-xs text-slate-400">
              No hay entregas esperando motorizado en este momento.
            </div>
          ) : (
            <div className="space-y-3">
              {poolEntregas.map(p => (
                <div key={p.asignacion_id} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-2.5">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-800 text-sm">Pedido #{String(p.numero).padStart(4, '0')}</span>
                    <span className="font-bold text-green-700 text-sm">{fmt(montoACobrar(p))}</span>
                  </div>
                  {/* Punto de recogida — lo primero que necesita saber el motorizado */}
                  <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 flex items-start gap-2">
                    <span className="text-orange-500 shrink-0">🏪</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-bold text-orange-700 uppercase tracking-wide">Recoger en</div>
                      <div className="text-xs font-semibold text-slate-700">{p.tienda_recogida ?? 'Tienda por confirmar'}</div>
                      {p.tienda_direccion ? (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.tienda_direccion)}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[11px] text-blue-600 font-semibold underline"
                        >
                          Ver ubicación en Maps →
                        </a>
                      ) : (
                        <div className="text-[10px] text-slate-400">Sin dirección registrada — coordina con el comprador</div>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-slate-600">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Destino final (cliente)</div>
                    <div className="font-semibold">{p.nombre_cliente}</div>
                    {p.direccion && <div className="text-slate-400">{p.direccion}, {p.ciudad}</div>}
                  </div>
                  <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2">
                    <span className="text-[11px] text-slate-500">
                      Comprador: <span className="font-semibold text-slate-700">{p.shopper_nombre}</span>
                    </span>
                    {p.shopper_telefono && (
                      <a
                        href={`https://wa.me/${formatWhatsApp(p.shopper_telefono)}?text=${encodeURIComponent(
                          `Hola ${p.shopper_nombre}, soy motorizado de La Crayola. Voy a recoger el pedido #${p.numero} — ¿dónde te encuentro?`
                        )}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] font-bold text-green-700"
                      >
                        <Phone size={11} /> Contactar
                      </a>
                    )}
                  </div>
                  <a
                    href="/repartidor/escanear"
                    className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl transition text-xs text-center"
                  >
                    📷 Ir a escanear y recibir
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cabecera de ruta al estilo "lista numerada de paquetes" (inspirado en apps
          de logistica de paquetes): cuantas entregas hay en camino ahora mismo. */}
      {modo === 'repartidor' && pestanaRepartidor === 'entregar' && (pedidos.filter(p => p.estado === 'en_ruta').length > 0 || entregasHoy.exitosas + entregasHoy.fallidas > 0) && (
        <div className="px-4 pt-4">
          <div className="bg-white border border-slate-100 rounded-2xl px-4 py-3 shadow-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-extrabold text-slate-800">
                {pedidos.filter(p => p.estado === 'en_ruta').length} en camino
              </span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Hoy</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-[11px] font-semibold">
                <span className="text-green-700">✓ {entregasHoy.exitosas} entregadas</span>
                {entregasHoy.fallidas > 0 && <span className="text-red-500">✕ {entregasHoy.fallidas} fallidas</span>}
              </div>
              <span className="text-xs font-black text-green-700">
                Ganado: {fmt(entregasHoy.exitosas * (repartidor?.comision_valor ?? 1))}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Ruta combinada en Google Maps: opción secundaria para ver el trayecto
          completo de un vistazo (Google Maps rotula las paradas A/B/C, no con
          el nombre del cliente -- para eso está la vista de mapa/lista de
          abajo, con el número real por cercanía y los datos de cada pedido). */}
      {modo === 'repartidor' && (pestanaRepartidor === 'entregar' || pestanaRepartidor === 'mapa') && pedidos.filter(p => p.estado === 'en_ruta' && p.geo_lat && p.geo_lng).length > 1 && (
        <div className="px-4 pt-3">
          <button
            onClick={abrirRutaCombinada}
            className="w-full flex items-center justify-center gap-2 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 font-bold py-2.5 rounded-2xl text-xs transition cursor-pointer"
          >
            <Navigation size={13} />
            Ver trayecto completo en Google Maps
          </button>
        </div>
      )}

      {/* Pedidos Container */}
      <div className="px-4 py-4 space-y-4">
        {modo === 'comprador' && pestana === 'inicio' ? (
          /* VISTA: PEDIDOS NUEVOS EN ESPERA (POOL) */
          !repartidor?.conectado ? (
            <div className="bg-white border border-slate-200/60 rounded-3xl p-10 text-center text-xs text-slate-500 space-y-2.5 shadow-xs">
              <span className="text-3xl block">😴</span>
              <div className="font-extrabold text-slate-700">Estás desconectado</div>
              <p className="text-[10px] text-slate-400 max-w-xs mx-auto leading-relaxed">
                Activa tu turno en la cabecera (haciendo clic en **OFF Desconectado**) para comenzar a recibir pedidos de supermercado.
              </p>
            </div>
          ) : pedidosEspera.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-3xl p-12 text-center text-slate-400 text-xs shadow-xs space-y-2">
              <Package size={36} className="mx-auto text-slate-300" />
              <div className="font-semibold text-slate-600">No hay pedidos nuevos disponibles</div>
              <p className="text-[10px] text-slate-400">Los pedidos confirmados de La Crayola aparecerán en esta lista para auto-asignarte.</p>
            </div>
          ) : (
            pedidosEspera.map(p => (
              <div key={p.id} className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5 space-y-4">
                <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                  <span className="font-extrabold text-xs text-slate-800">Pedido #{String(p.numero).padStart(4,'0')}</span>
                  <span className="font-extrabold text-sm text-green-700">{fmt(montoACobrar(p))}</span>
                </div>
                <div className="space-y-1 text-left">
                  <div className="text-xs text-slate-700 font-extrabold">{p.nombre_cliente}</div>
                  {p.direccion && (
                    <div className="text-[10px] text-slate-400 flex items-start gap-1">
                      <MapPin size={12} className="shrink-0 mt-0.5" />
                      <span>{p.direccion}, {p.ciudad}</span>
                    </div>
                  )}
                </div>
                {p.notas && (
                  <div className="text-[10px] text-yellow-700 bg-yellow-50 px-3 py-2 rounded-xl border border-yellow-100 text-left">
                    📝 {p.notas}
                  </div>
                )}

                {p.tiendas && p.tiendas.length > 1 ? (
                  /* Multi-tienda: cada tienda se reclama por separado -- el
                     comprador que esté en Tuti se asigna solo la parte de
                     Tuti, y el de Tía la parte de Tía, sin bloquearse entre
                     ellos. Las ya tomadas por otro comprador quedan grises. */
                  <div className="space-y-1.5">
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">Este pedido tiene {p.tiendas.length} tiendas — elige la tuya:</p>
                    {p.tiendas.map((t: any) => (
                      <button
                        key={t.id}
                        onClick={() => aceptarPedido(p.id, p.numero, p.nombre_cliente, p.telefono, t.id)}
                        disabled={procesando !== null || t.tomada}
                        className={`w-full font-extrabold py-3 rounded-2xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm ${
                          t.tomada
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            : 'bg-[#00b074] hover:bg-[#008f5d] text-white cursor-pointer active:scale-95'
                        }`}>
                        {procesando === p.id ? <Loader2 size={14} className="animate-spin" /> : t.tomada ? `🔒 ${t.nombre} — Ya tomada` : `🏪 Asignarme ${t.nombre}`}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={() => aceptarPedido(p.id, p.numero, p.nombre_cliente, p.telefono, p.tiendas?.[0]?.id ?? null)}
                    disabled={procesando !== null}
                    className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-50 text-white font-extrabold py-3.5 rounded-2xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer active:scale-95">
                    {procesando === p.id ? <Loader2 size={14} className="animate-spin" /> : '🧺 Auto-Asignar y Empezar'}
                  </button>
                )}
              </div>
            ))
          )
        ) : (
          modo === 'comprador' ? (
            /* VISTA: MIS PEDIDOS (COMPRADOR) */
            listaActivaComprador.length === 0 ? (
              <div className="text-center py-16 space-y-3 bg-white rounded-3xl border border-slate-100 p-5 shadow-xs">
                <CheckCircle size={48} className="text-green-300 mx-auto" />
                <p className="font-semibold text-slate-600">Sin pedidos en esta pestaña</p>
                <p className="text-sm text-slate-400">Ve a la pestaña "Inicio" para auto-asignarte un pedido.</p>
              </div>
            ) : (
              listaActivaComprador.map(p => (
                <div key={p.asignacion_id} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden text-left">
                  {/* Cabecera del pedido */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex items-center gap-2">
                      <Package size={16} className="text-slate-400" />
                      <span className="font-bold text-slate-800">Pedido #{String(p.numero).padStart(4,'0')}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${EST_COLOR[p.estado] ?? 'bg-slate-100 text-slate-600'}`}>
                        {(p.estado ?? '').replace('_',' ')}
                      </span>
                    </div>
                    <span className="font-bold text-green-700">{fmt(montoACobrar(p))}</span>
                  </div>

                  {/* Banner de Pago Destacado */}
                  {p.metodo_pago === 'transferencia' && p.pago_confirmado === true && (
                    <div className="bg-emerald-500 text-white font-extrabold text-xs px-4 py-3 text-center flex items-center justify-center gap-1.5 shadow-inner">
                      <span>💳 PAGADO POR TRANSFERENCIA (Confirmado)</span>
                    </div>
                  )}
                  {p.metodo_pago === 'transferencia' && p.pago_confirmado !== true && (
                    <div className="bg-yellow-500 text-slate-900 font-extrabold text-xs px-4 py-3 text-center flex items-center justify-center gap-1.5 shadow-inner animate-pulse">
                      <span>⚠️ TRANSFERENCIA POR CONFIRMAR: {fmt(montoACobrar(p))}</span>
                    </div>
                  )}
                  {(!p.metodo_pago || p.metodo_pago === 'efectivo') && (
                    <div className="bg-orange-600 text-white font-extrabold text-xs px-4 py-3 text-center flex items-center justify-center gap-1.5 shadow-inner">
                      <span>💵 COBRAR EN EFECTIVO: {fmt(montoACobrar(p))}</span>
                    </div>
                  )}

                  {/* Datos cliente */}
                  <div className="px-4 py-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="w-8 h-8 bg-green-55/10 rounded-lg flex items-center justify-center shrink-0">
                        <span className="text-sm font-bold text-green-700">{p.nombre_cliente?.[0]}</span>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800 text-sm">{p.nombre_cliente}</div>
                        <a href={`tel:${p.telefono}`}
                          className="flex items-center gap-1 text-xs text-green-600 font-medium">
                          <Phone size={11} /> {p.telefono}
                        </a>
                      </div>
                    </div>

                    {p.direccion && (
                      <div className="flex items-start gap-2 text-xs text-slate-500">
                        <MapPin size={13} className="shrink-0 mt-0.5 text-slate-400" />
                        <div>
                          <div>{p.direccion}, {p.ciudad}</div>
                          {p.referencias && <div className="text-slate-400">{p.referencias}</div>}
                        </div>
                      </div>
                    )}

                    {p.notas && (
                      <div className="bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-2 text-xs text-yellow-800">
                        📝 {p.notas}
                      </div>
                    )}

                    {/* Vista Compras - Traspaso o Híbrido */}
                    {p.estado === 'recolectado' && (
                      <div className="pt-3 border-t border-slate-100 mt-2 space-y-2">
                        {p.direccion === 'RETIRO EN TIENDA' ? (
                          <>
                            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-center text-xs text-yellow-800 font-semibold mb-2">
                              🛍️ Pedido de Retiro en Tienda. Está listo para que el cliente lo retire.
                            </div>
                            <button
                              onClick={() => confirmarRetiroCliente(p.asignacion_id, p.pedido_id)}
                              disabled={procesando !== null}
                              className="w-full flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl transition text-xs shadow-xs">
                              🛍️ Entregar al Cliente (Confirmar Retiro)
                            </button>
                          </>
                        ) : (
                          <>
                            <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center text-xs text-green-800 font-semibold mb-2">
                              🎉 ¡Compras completadas! Realiza el traspaso al motorizado.
                            </div>
                            <div className="flex gap-2">
                              <a href={`/repartidor/traspaso/${p.asignacion_id}`}
                                className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition text-xs shadow-xs text-center">
                                📲 Traspasar por QR
                              </a>
                              <button
                                onClick={() => autotraspaso(p.asignacion_id, p.pedido_id, p.numero, p.nombre_cliente, p.telefono)}
                                disabled={procesando !== null}
                                className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl transition text-xs shadow-xs">
                                🛵 Entregar yo mismo
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Vista Compras (Picking - solo si está en estado asignado) */}
                    {p.estado === 'asignado' && (
                      <div className="pt-2">
                        {!p.compra_iniciada_at ? (
                          <button
                            type="button"
                            onClick={() => iniciarCompra(p.asignacion_id, p.pedido_id, p.numero, p.nombre_cliente, p.telefono)}
                            disabled={procesando !== null}
                            className="w-full flex items-center justify-center gap-2 bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-50 text-white font-extrabold py-3.5 rounded-xl transition text-sm shadow-sm cursor-pointer"
                          >
                            {procesando === p.pedido_id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <span>▶️ Iniciar compra en supermercados</span>
                            )}
                          </button>
                        ) : (
                          <a href={`/picking/${p.asignacion_id}`}
                            className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-extrabold py-3.5 rounded-xl transition text-sm shadow-sm text-center">
                            🛒 Continuar compra en supermercados
                          </a>
                        )}
                      </div>
                    )}

                    {/* Vista Compras - Entrega propia en curso */}
                    {p.estado === 'en_ruta' && p.rider_id === p.shopper_id && (
                      <div className="pt-2">
                        <a href={`/entrega/${p.asignacion_id}`}
                          className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-extrabold py-3.5 rounded-xl transition text-sm shadow-sm text-center">
                          🛵 Continuar mi entrega
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="px-4 pb-4 pt-2 border-t border-slate-100">
                    <a href={`https://wa.me/${formatWhatsApp(p.telefono)}`} target="_blank" rel="noopener noreferrer"
                      className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-655 font-semibold py-2 rounded-xl transition text-sm">
                      <svg className="w-3.5 h-3.5 fill-green-500" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      Chat Directo WhatsApp
                    </a>
                  </div>
                </div>
              ))
            )
          ) : modo === 'repartidor' && pestanaRepartidor === 'recoger' ? (
            /* La pestaña "Por recoger" ya se renderiza arriba (pool); esta
               columna de Listado/Mapa/Activo es para las otras 3 pestañas. */
            null
          ) : pestanaRepartidor === 'mapa' ? (
            <div className="px-1 py-1">
              <MapaRuta
                paradas={pedidos.filter(p => p.estado === 'asignado' || p.estado === 'en_ruta').map(p => ({
                  asignacion_id: p.asignacion_id,
                  numero: p.numero,
                  nombre_cliente: p.nombre_cliente,
                  direccion: p.direccion,
                  total: p.total,
                  geo_lat: p.geo_lat,
                  geo_lng: p.geo_lng
                }))}
                onSelectParada={activarParada}
                paradaActivaId={paradaActivaId}
              />
            </div>
          ) : pestanaRepartidor === 'activo' ? (
            /* Pestaña "Activo": SOLO la parada de ahora mismo, sin lista --
               es la que importa mientras se maneja, sin tener que buscarla
               entre las demás. */
            (() => {
              const activeStop = pedidos.find(p => p.asignacion_id === paradaActivaId && (p.estado === 'asignado' || p.estado === 'en_ruta'))
                ?? pedidos.find(p => p.estado === 'en_ruta')
              if (!activeStop) {
                return (
                  <div className="text-center py-16 space-y-3 bg-white rounded-3xl border border-slate-100 p-5 shadow-xs">
                    <Target size={40} className="text-slate-300 mx-auto" />
                    <p className="font-semibold text-slate-600">Sin parada activa</p>
                    <p className="text-sm text-slate-400">Cuando aceptes o vayas en camino a una entrega, aparecerá aquí.</p>
                  </div>
                )
              }
              return renderCardRepartidor(activeStop, true)
            })()
          ) : (
            <div className="space-y-6">
              {/* 📌 SECCIÓN: PRÓXIMA PARADA / EN CAMINO */}
              {(() => {
                const activeStop = pedidos.find(p => p.asignacion_id === paradaActivaId && (p.estado === 'asignado' || p.estado === 'en_ruta'))
                if (!activeStop) return null
                return (
                  <div className="space-y-2">
                    <div className="text-[10px] font-black text-red-500 uppercase tracking-widest px-1 flex items-center gap-1.5 animate-pulse text-left">
                      🚨 Próxima Parada (En Camino)
                    </div>
                    {renderCardRepartidor(activeStop, true)}
                  </div>
                )
              })()}

              {/* 📋 SECCIÓN: OTRAS PARADAS PENDIENTES */}
              {(() => {
                const pendingStops = pedidos.filter(p => p.asignacion_id !== paradaActivaId && (p.estado === 'asignado' || p.estado === 'en_ruta'))
                if (pendingStops.length === 0) {
                  const hasActive = pedidos.some(p => p.asignacion_id === paradaActivaId && (p.estado === 'asignado' || p.estado === 'en_ruta'))
                  if (!hasActive) {
                    return (
                      <div className="text-center py-16 space-y-3 bg-white rounded-3xl border border-slate-100 p-5 shadow-xs">
                        <CheckCircle size={48} className="text-green-300 mx-auto" />
                        <p className="font-semibold text-slate-600">Sin paradas activas</p>
                        <p className="text-sm text-slate-400">Cuando te asignen entregas aparecerán aquí.</p>
                      </div>
                    )
                  }
                  return null
                }
                return (
                  <div className="space-y-3">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 text-left">
                      📋 Paradas Pendientes ({pendingStops.length})
                    </div>
                    {pendingStops.map(p => renderCardRepartidor(p, false))}
                  </div>
                )
              })()}
            </div>
          )
        )}
      </div>

      {/* Menú inferior fijo (comprador) */}
      {modo === 'comprador' && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 flex items-stretch z-[150] shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          {[
            { key: 'inicio' as const,   label: 'Inicio',    emoji: '🏠', onClick: () => setPestana('inicio') },
            { key: 'preparando' as const, label: 'Comprando', emoji: '🛒', onClick: irAComprando },
            { key: 'porentregar' as const, label: 'A repartidor', emoji: '🛵', onClick: () => setPestana('porentregar') },
          ].map(item => (
            <button
              key={item.key}
              onClick={item.onClick}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors ${
                pestana === item.key ? 'text-[#00b074]' : 'text-slate-400'
              }`}
            >
              <span className="text-xl leading-none">{item.emoji}</span>
              <span className="text-[10px] font-bold">{item.label}</span>
            </button>
          ))}
          <Link
            href="/repartidor/perfil"
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-slate-400"
          >
            <UserCircle size={20} />
            <span className="text-[10px] font-bold">Perfil</span>
          </Link>
        </div>
      )}

      {/* Menú inferior fijo (repartidor): 4 destinos con contador de
          pedidos, tocables sin puntería fina. Reemplaza la pestaña de
          arriba + el toggle Listado/Mapa que antes vivía escondido dentro
          de "entregar". */}
      {modo === 'repartidor' && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 flex items-stretch z-[150] shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          {([
            { key: 'recoger' as const,  label: 'Por recoger', icon: <Package size={20} />, count: poolEntregas.length },
            { key: 'entregar' as const, label: 'En camino',   icon: <span className="text-xl leading-none">🛵</span>, count: pedidos.filter(p => p.estado === 'en_ruta').length },
            { key: 'activo' as const,   label: 'Activo',      icon: <Target size={20} />, count: pedidos.some(p => p.estado === 'en_ruta') ? 1 : 0 },
            { key: 'mapa' as const,     label: 'Mapa',         icon: <MapIcon size={20} />, count: 0 },
          ]).map(item => (
            <button
              key={item.key}
              onClick={() => setPestanaRepartidor(item.key)}
              className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors cursor-pointer ${
                pestanaRepartidor === item.key ? 'text-orange-600' : 'text-slate-400'
              }`}
            >
              {item.icon}
              <span className="text-[10px] font-bold">{item.label}</span>
              {item.count > 0 && (
                <span className="absolute top-1 right-[26%] min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

    </div>

      {/* Menú lateral (hamburguesa, modo repartidor): traspaso, caja,
          comisiones -- lo que se usa ocasionalmente, fuera de la pantalla
          principal para no competir con lo que se usa todo el tiempo. */}
      {menuAbierto && (
        <div className="fixed inset-0 z-[250] flex">
          <div className="flex-1 bg-black/50" onClick={() => setMenuAbierto(false)} />
          <div className="w-72 max-w-[80vw] bg-white h-full shadow-xl flex flex-col">
            <div className="bg-green-700 text-white px-4 pt-10 pb-4 flex items-center justify-between">
              <div>
                <div className="font-extrabold">{repartidor?.nombre ?? 'Repartidor'}</div>
                <div className="text-green-200 text-xs">{repartidor?.conectado ? '🟢 En turno' : '⚪ Desconectado'}</div>
              </div>
              <button onClick={() => setMenuAbierto(false)} className="p-1.5 hover:bg-white/10 rounded-lg cursor-pointer">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <a href="/repartidor/escanear"
                className="flex items-center gap-3 bg-yellow-500 hover:bg-yellow-600 text-slate-900 rounded-2xl px-4 py-3.5 shadow-sm transition-all active:scale-[0.98]">
                <span className="text-2xl shrink-0">📷</span>
                <div className="flex-1 text-left">
                  <div className="font-extrabold text-sm">Recibir traspaso</div>
                  <div className="text-[11px] opacity-80">Escanear código del comprador</div>
                </div>
              </a>
              <button
                onClick={() => { setMenuAbierto(false); abrirTraspaso() }}
                className="w-full flex items-center gap-3 bg-white border border-orange-200 rounded-2xl px-4 py-3.5 shadow-sm transition-all active:scale-[0.98] cursor-pointer"
              >
                <span className="text-2xl shrink-0">💰</span>
                <div className="flex-1 text-left">
                  <div className="font-extrabold text-sm text-slate-800">Caja: {fmt(repartidor?.efectivo_en_mano ?? 0)}</div>
                  <div className="text-[11px] text-slate-400">Entregar o depositar efectivo</div>
                </div>
              </button>
              <button
                onClick={() => { setMenuAbierto(false); router.push('/repartidor/comisiones') }}
                className="w-full flex items-center gap-3 bg-white border border-green-200 rounded-2xl px-4 py-3.5 shadow-sm transition-all active:scale-[0.98] cursor-pointer"
              >
                <span className="text-2xl shrink-0">💵</span>
                <div className="flex-1 text-left">
                  <div className="font-extrabold text-sm text-slate-800">Mis comisiones</div>
                  <div className="text-[11px] text-slate-400">${repartidor?.comision_valor ?? 1}/entrega · historial y reclamos</div>
                </div>
              </button>
              <div className="border-t border-slate-100 my-2" />
              <Link href="/repartidor/perfil"
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-slate-50 transition text-slate-700">
                <UserCircle size={20} className="text-slate-400" />
                <span className="font-semibold text-sm">Mi perfil</span>
              </Link>
              <form action={logout}>
                <button type="submit"
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-red-50 transition text-red-600 cursor-pointer">
                  <LogOut size={18} />
                  <span className="font-semibold text-sm">Cerrar sesión</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Entregar efectivo en mano a un colega (comprador u otro repartidor) */}
      {renderModalTraspaso()}
    </>
    )
  }
