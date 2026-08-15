'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
const MapaRuta = dynamic(() => import('@/components/MapaRuta'), { ssr: false })
import Link from 'next/link'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { logout } from '@/actions/auth'
import { useRouter } from 'next/navigation'
import { Loader2, MapPin, CheckCircle, Package, Phone, Navigation, DollarSign, UserCircle, ArrowRightLeft, X, AlertCircle, LogOut } from 'lucide-react'

function fmt(n: number) { return '$' + (n ?? 0).toFixed(2) }

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

  // Proof of Delivery (POD) states
  const [entregaModal, setEntregaModal] = useState<any>(null)
  const [fotoFile, setFotoFile] = useState<File | null>(null)
  const [montoCobradoModal, setMontoCobradoModal] = useState<string>('')
  const [guardandoEntrega, setGuardandoEntrega] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawingRef = useRef(false)

  // Envíos Flex states
  const [vistaRepartidor, setVistaRepartidor] = useState<'listado' | 'mapa'>('listado')
  const [paradaActivaId, setParadaActivaId] = useState<string | null>(null)
  // Antes "Listas para recoger" (pool, sin custodia aún) y "Mis pedidos en
  // camino" (ya en custodia) vivían apiladas en la misma pantalla con
  // scroll -- se sentía todo mezclado. Ahora son pestañas separadas, igual
  // que ya existían para el modo comprador.
  const [pestanaRepartidor, setPestanaRepartidor] = useState<'recoger' | 'entregar'>('recoger')

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

  async function abrirTraspaso() {
    setErrorTraspaso('')
    setMontoTraspaso('')
    setNotasTraspaso('')
    setDestinoTraspaso('')
    setShowTraspaso(true)
    const { data } = await supabase
      .from('rep_repartidores')
      .select('id, nombre')
      .eq('activo', true)
      .neq('id', repartidor?.id ?? '')
      .order('nombre')
    setColegas(data ?? [])
  }

  // Ruta combinada: ordena las entregas 'en_ruta' por cercanía (vecino más próximo) desde
  // la ubicación actual del repartidor y abre Google Maps con todas las paradas intermedias.
  function distanciaAprox(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const dLat = a.lat - b.lat
    const dLng = a.lng - b.lng
    return Math.sqrt(dLat * dLat + dLng * dLng)
  }

  // Distancia real en km (Haversine) -- distanciaAprox de arriba es solo un
  // proxy en grados, útil para ordenar por cercanía pero no para mostrarle
  // un ETA creíble al repartidor.
  function distanciaKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const R = 6371
    const dLat = (b.lat - a.lat) * Math.PI / 180
    const dLng = (b.lng - a.lng) * Math.PI / 180
    const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s))
  }

  // ETA aproximado asumiendo velocidad urbana promedio (San Miguel de los
  // Bancos y alrededores, calles de montaña/tierra) -- es una estimación
  // gruesa a partir de línea recta, se etiqueta siempre como "aprox."
  function minutosEstimados(km: number) {
    const VELOCIDAD_KMH = 25
    return Math.max(1, Math.round((km / VELOCIDAD_KMH) * 60))
  }

  function ordenarPorCercania(origenGeo: { lat: number; lng: number } | null, paradas: PedidoAsignado[]): PedidoAsignado[] {
    const restantes = [...paradas]
    const ordenadas: PedidoAsignado[] = []
    let puntoActual = origenGeo

    while (restantes.length > 0) {
      if (!puntoActual) {
        ordenadas.push(...restantes)
        break
      }
      restantes.sort((a, b) =>
        distanciaAprox(puntoActual!, { lat: a.geo_lat!, lng: a.geo_lng! }) -
        distanciaAprox(puntoActual!, { lat: b.geo_lat!, lng: b.geo_lng! })
      )
      const siguiente = restantes.shift()!
      ordenadas.push(siguiente)
      puntoActual = { lat: siguiente.geo_lat!, lng: siguiente.geo_lng! }
    }
    return ordenadas
  }

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
  }

  function formatWhatsApp(phone: string | null | undefined): string {
    if (!phone) return ''
    const clean = phone.replace(/\D/g, '')
    return clean.startsWith('0') 
      ? '593' + clean.slice(1) 
      : clean.startsWith('9') && clean.length === 9 
        ? '593' + clean 
        : clean
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
        .select('id,estado,pedido_id,rider_id,shopper_id,compra_iniciada_at,ol_pedidos(numero,nombre_cliente,telefono,direccion,ciudad,referencias,total,geo_lat,geo_lng,notas,estado,metodo_pago,pago_confirmado)')

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
          .select('pedido_id')
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

      const assignedIds = new Set((activeAsigs ?? []).map((a: any) => a.pedido_id))

      const filteredPends = (pends ?? []).filter(p => !assignedIds.has(p.id))
      setPedidosEspera(filteredPends)

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

  async function aceptarPedido(pedidoId: string, numero: number, nombreCliente: string, telefonoCliente: string) {
    if (!repartidor) return
    setProcesando(pedidoId)

    // RPC atómica: bloquea el pedido, valida que el repartidor esté
    // activo/aprobado/no bloqueado, exige estado='pendiente', crea la
    // asignación y actualiza ol_pedidos.estado en una sola transacción,
    // y es reintentable con el mismo request_id si falla la conexión
    // (migration_aceptar_pedido_atomico.sql).
    const requestKey = `aceptar-request:${pedidoId}`
    const requestId = sessionStorage.getItem(requestKey) || crypto.randomUUID()
    sessionStorage.setItem(requestKey, requestId)

    const { error } = await supabase.rpc('aceptar_pedido_shopper', {
      p_pedido_id: pedidoId,
      p_request_id: requestId,
    })

    if (error) {
      alert('Error al auto-asignar el pedido: ' + error.message)
      setProcesando(null)
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

    // 3. Abrir WhatsApp para notificar al cliente
    const msg = `🛒 *La Crayola - Compras en curso* \n\n¡Hola *${nombreCliente}*! Soy *${repartidor.nombre}*, tu comprador asignado de La Crayola. He recibido tu pedido *#${String(numero).padStart(4,'0')}* y voy a iniciar tus compras ahora mismo en los supermercados asociados. Te mantendré al tanto de cualquier novedad por este medio. 🧺`
    window.open(`https://wa.me/${formatWhatsApp(telefonoCliente)}?text=${encodeURIComponent(msg)}`, '_blank')

    // 4. Navegar a la pantalla de picking completa (escaner, avance, canasta) —
    // /picking/[id] usa el id de la ASIGNACION, no el del pedido. La otra ruta
    // /repartidor/picking/[pedidoId] es una version vieja e incompleta, sin
    // escaner ni barra de avance; no se debe enlazar mas.
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
    window.open(`https://wa.me/${formatWhatsApp(telefonoCliente)}?text=${encodeURIComponent(msg)}`, '_blank')
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

  useEffect(() => {
    if (!entregaModal) return
    const timer = setTimeout(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'

      const getPos = (e: MouseEvent | TouchEvent) => {
        const rect = canvas.getBoundingClientRect()
        if ('touches' in e) {
          if (e.touches.length === 0) return { x: 0, y: 0 }
          return {
            x: e.touches[0].clientX - rect.left,
            y: e.touches[0].clientY - rect.top
          }
        }
        return {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        }
      }

      const startDrawing = (e: MouseEvent | TouchEvent) => {
        isDrawingRef.current = true
        const pos = getPos(e)
        ctx.beginPath()
        ctx.moveTo(pos.x, pos.y)
      }

      const draw = (e: MouseEvent | TouchEvent) => {
        if (!isDrawingRef.current) return
        e.preventDefault()
        const pos = getPos(e)
        ctx.lineTo(pos.x, pos.y)
        ctx.stroke()
      }

      const stopDrawing = () => {
        isDrawingRef.current = false
      }

      canvas.addEventListener('mousedown', startDrawing)
      canvas.addEventListener('mousemove', draw)
      canvas.addEventListener('mouseup', stopDrawing)
      canvas.addEventListener('mouseleave', stopDrawing)

      canvas.addEventListener('touchstart', startDrawing, { passive: false })
      canvas.addEventListener('touchmove', draw, { passive: false })
      canvas.addEventListener('touchend', stopDrawing)
    }, 150)

    return () => clearTimeout(timer)
  }, [entregaModal])

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  async function finalizarEntregaConPOD() {
    if (!entregaModal) return
    const asignacionId = entregaModal.asignacion_id
    const pedidoId = entregaModal.pedido_id

    if (!fotoFile) {
      alert('Debes tomar una foto del pedido en la puerta como comprobante.')
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return

    setGuardandoEntrega(true)
    setProcesando(asignacionId)

    try {
      const fotoExt = fotoFile.name.split('.').pop() || 'jpg'
      const fotoName = `entregas/${pedidoId}_${Date.now()}.${fotoExt}`
      const { error: errFoto } = await supabase.storage
        .from('comprobantes-proveedores')
        .upload(fotoName, fotoFile, { upsert: true })

      if (errFoto) {
        alert('Error al subir la foto de entrega: ' + errFoto.message)
        setGuardandoEntrega(false)
        setProcesando(null)
        return
      }

      // Bucket privado (punto 10 de la auditoría): se guarda la ruta, no
      // una URL pública -- se firma bajo demanda al mostrarla.
      const fotoEntregaUrl = fotoName

      const firmaBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'))
      if (!firmaBlob) {
        alert('Error al capturar la firma del cliente.')
        setGuardandoEntrega(false)
        setProcesando(null)
        return
      }

      const firmaName = `firmas/${pedidoId}_${Date.now()}.png`
      const { error: errFirma } = await supabase.storage
        .from('comprobantes-proveedores')
        .upload(firmaName, firmaBlob, { upsert: true })

      if (errFirma) {
        alert('Error al subir la firma del cliente: ' + errFirma.message)
        setGuardandoEntrega(false)
        setProcesando(null)
        return
      }

      const firmaClienteUrl = firmaName

      const geo = await new Promise<{ lat: number; lng: number } | null>(res => {
        if (typeof window === 'undefined' || !navigator?.geolocation) {
          res(null)
          return
        }
        navigator.geolocation.getCurrentPosition(
          p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
          () => res(null),
          { timeout: 5000, enableHighAccuracy: true }
        )
      })

      // Si ya pagó por transferencia (y admin ya lo validó), no hay nada
      // que cobrar en la puerta -- antes se pedía igual el monto en
      // efectivo aunque el cliente ya hubiera pagado. La RPC ya sabía
      // manejar 'transferencia' correctamente; el bug era que el
      // frontend nunca se lo mandaba.
      const yaPagoPorTransferencia = entregaModal.metodo_pago === 'transferencia' && entregaModal.pago_confirmado === true
      const metodoReal = yaPagoPorTransferencia ? 'transferencia' : 'efectivo'
      const monto = yaPagoPorTransferencia ? 0 : parseFloat(montoCobradoModal || '0')

      const requestKey = `entrega-request:${asignacionId}`
      const requestId = sessionStorage.getItem(requestKey) || crypto.randomUUID()
      sessionStorage.setItem(requestKey, requestId)
      const { error: cierreError } = await supabase.rpc('finalizar_entrega_atomica', {
        p_request_id: requestId,p_asignacion_id:asignacionId,p_monto:monto,p_metodo:metodoReal,
        p_lat:geo?.lat??null,p_lng:geo?.lng??null,p_foto_url:fotoEntregaUrl,
        p_firma_url:firmaClienteUrl,p_referencias:null,
      })
      if(cierreError)throw cierreError
      sessionStorage.removeItem(requestKey)

      setFotoFile(null)
      setEntregaModal(null)
      setParadaActivaId(null)
      if (typeof window !== 'undefined') {
        localStorage.removeItem('paradaActivaId')
      }
      await cargar(user!.id)

    } catch (err: any) {
      alert('Error al procesar la entrega: ' + err.message)
    } finally {
      setGuardandoEntrega(false)
      setProcesando(null)
    }
  }

  async function confirmarGpsEntrega(p: PedidoAsignado) {
    setProcesando(p.asignacion_id)
    try {
      const geo = await new Promise<{ lat: number; lng: number } | null>(res => {
        if (typeof window === 'undefined' || !navigator?.geolocation) {
          res(null)
          return
        }
        navigator.geolocation.getCurrentPosition(
          pos => res({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => res(null),
          { timeout: 7000, enableHighAccuracy: true }
        )
      })

      if (!geo) {
        alert('No se pudo obtener la ubicación GPS actual. Activa el GPS de tu celular e intenta nuevamente.')
        setProcesando(null)
        return
      }

      // Comparar contra la ubicación que el sistema ya tenía registrada
      // ANTES de sobrescribirla -- antes este botón pisaba la coordenada a
      // ciegas, sin mostrarle al repartidor si coincidía con la dirección
      // del cliente o no.
      if (p.geo_lat && p.geo_lng) {
        const distanciaM = Math.round(distanciaKm({ lat: p.geo_lat, lng: p.geo_lng }, geo) * 1000)
        const lejos = distanciaM > 150
        const continuar = confirm(
          (lejos
            ? `⚠️ Tu posición actual está a ${distanciaM} metros de la ubicación registrada del pedido — podría ser la casa equivocada.\n\n`
            : `✓ Tu posición actual está a ${distanciaM} metros de la ubicación registrada (coincide razonablemente).\n\n`)
          + '¿Confirmar esta ubicación como la definitiva de entrega?'
        )
        if (!continuar) { setProcesando(null); return }
      }

      // 1. Actualizar coordenadas del pedido en ol_pedidos
      await supabase.from('ol_pedidos')
        .update({ geo_lat: geo.lat, geo_lng: geo.lng })
        .eq('id', p.pedido_id)

      // 2. Buscar si ya existe la dirección en rep_clientes_direcciones por teléfono
      const { data: extDir } = await supabase
        .from('rep_clientes_direcciones')
        .select('id, direccion')
        .eq('telefono', p.telefono)

      const matchDir = (extDir ?? []).find((d: any) => sonDireccionesSimilares(d.direccion, p.direccion))

      if (matchDir) {
        // Actualizar la dirección existente con las coordenadas definitivas de la puerta
        await supabase.from('rep_clientes_direcciones')
          .update({
            geo_lat: geo.lat,
            geo_lng: geo.lng,
            verificada: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', matchDir.id)
      } else {
        // Insertar un nuevo registro de dirección para este cliente
        await supabase.from('rep_clientes_direcciones')
          .insert({
            telefono: p.telefono,
            nombre_direccion: p.direccion ? p.direccion.slice(0, 15) : 'Nueva Dirección',
            direccion: p.direccion || 'Dirección de Entrega',
            ciudad: p.ciudad || 'Ciudad',
            referencias: p.referencias || '',
            geo_lat: geo.lat,
            geo_lng: geo.lng,
            verificada: true
          })
      }

      alert('✓ Ubicación GPS definitiva de la puerta grabada y verificada correctamente.')
      await cargar(user!.id)
    } catch (err: any) {
      alert('Error al grabar ubicación GPS: ' + err.message)
    } finally {
      setProcesando(null)
    }
  }

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
          <span className="font-bold text-green-700 text-xs">{fmt(p.total)}</span>
        </div>

        {/* Banner de Pago Destacado */}
        {p.metodo_pago === 'transferencia' && p.pago_confirmado === true && (
          <div className="bg-emerald-500 text-white font-extrabold text-[10px] py-2 text-center shadow-inner">
            💳 PAGADO POR TRANSFERENCIA (Confirmado)
          </div>
        )}
        {p.metodo_pago === 'transferencia' && p.pago_confirmado !== true && (
          <div className="bg-yellow-500 text-slate-900 font-extrabold text-[10px] py-2 text-center shadow-inner animate-pulse">
            ⚠️ TRANSFERENCIA POR CONFIRMAR: {fmt(p.total)}
          </div>
        )}
        {(!p.metodo_pago || p.metodo_pago === 'efectivo') && (
          <div className="bg-orange-600 text-white font-extrabold text-[10px] py-2 text-center shadow-inner">
            💵 COBRAR EN EFECTIVO: {fmt(p.total)}
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
                      placeholder={`Monto a cobrar (total: ${fmt(p.total)})`}
                      value={cobro[p.asignacion_id] ?? ''}
                      onChange={e => setCobro(c => ({ ...c, [p.asignacion_id]: e.target.value }))}
                      className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-green-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => confirmarGpsEntrega(p)}
                    disabled={procesando !== null}
                    className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl transition text-xs shadow-sm cursor-pointer">
                    {procesando === p.asignacion_id ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />}
                    Confirmar GPS de Entrega (en puerta)
                  </button>

                  <button
                    onClick={() => {
                      const valCobro = cobro[p.asignacion_id] || ''
                      setMontoCobradoModal(valCobro)
                      setFotoFile(null)
                      setEntregaModal(p)
                    }}
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
        {showTraspaso && (
          <div className="fixed inset-0 bg-black/60 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 text-left">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl p-5 w-full sm:max-w-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-black text-slate-800 text-base flex items-center gap-1.5">
                  <ArrowRightLeft size={16} className="text-green-600" /> Entregar efectivo
                </h3>
                <button onClick={() => setShowTraspaso(false)} className="text-slate-400 p-1 cursor-pointer"><X size={18} /></button>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 text-xs text-slate-500">
                Tienes <span className="font-black text-slate-800">{fmt(repartidor?.efectivo_en_mano ?? 0)}</span> en mano.
                Registra a quién se lo entregas físicamente (otro colaborador, no la oficina).
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">¿A quién se lo entregas?</label>
                <select
                  value={destinoTraspaso}
                  onChange={e => setDestinoTraspaso(e.target.value)}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-green-500"
                >
                  <option value="">-- Selecciona --</option>
                  {colegas.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
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

              {errorTraspaso && <p className="text-red-500 text-xs text-center">{errorTraspaso}</p>}

              <button
                onClick={confirmarTraspaso}
                disabled={procesandoTraspaso}
                className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                {procesandoTraspaso ? <Loader2 size={16} className="animate-spin" /> : <ArrowRightLeft size={15} />}
                {procesandoTraspaso ? 'Registrando...' : 'Confirmar entrega de efectivo'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const totalACobrar = pedidos.filter(p => p.estado === 'asignado' || p.estado === 'en_ruta')
    .reduce((s, p) => s + p.total, 0)

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
    <div className={`min-h-screen bg-slate-50 ${modo === 'comprador' ? 'pb-20' : ''}`}>
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
              <Link href="/repartidor/perfil"
                className="w-9 h-9 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center transition shrink-0">
                <UserCircle size={20} />
              </Link>
              <form action={logout} className="shrink-0">
                <button type="submit" title="Cerrar sesión" className="w-9 h-9 bg-red-600/30 hover:bg-red-600/50 rounded-full flex items-center justify-center transition cursor-pointer text-white">
                  <LogOut size={15} />
                </button>
              </form>
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
          <div className="flex gap-2.5 pt-2 overflow-x-auto no-scrollbar">
            <div className="bg-white/20 rounded-xl px-3 py-1.5 text-[11px] font-semibold shrink-0">
              📦 {pedidos.length} asignados
            </div>
            {modo === 'repartidor' && (
              <a href="/repartidor/escanear"
                className="bg-yellow-500 hover:bg-yellow-600 text-slate-900 rounded-xl px-3 py-1.5 text-[11px] font-bold shrink-0 flex items-center gap-1 shadow-sm transition-all">
                📷 Recibir Traspaso
              </a>
            )}
            <div className="bg-white/20 rounded-xl px-3 py-1.5 text-[11px] font-semibold shrink-0">
              💵 Comisión: ${repartidor?.comision_valor ?? 1}/v
            </div>
            <button
              onClick={abrirTraspaso}
              className="bg-white/20 hover:bg-white/30 rounded-xl px-3 py-1.5 text-[11px] font-semibold shrink-0 text-yellow-300 border border-yellow-400/25 flex items-center gap-1 transition cursor-pointer"
            >
              💰 Caja: {fmt(repartidor?.efectivo_en_mano ?? 0)}
              <ArrowRightLeft size={11} className="text-yellow-300/80" />
            </button>
          </div>
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

      {/* Pestañas: "Por recoger" (pool, aún sin custodia) vs "En camino"
          (ya recibido, rumbo al cliente) -- antes ambas secciones estaban
          apiladas en una sola pantalla con scroll y se sentían mezcladas. */}
      {modo === 'repartidor' && (
        <div className="px-4 pt-4 grid grid-cols-2 gap-2">
          <button
            onClick={() => setPestanaRepartidor('recoger')}
            className={`relative py-2.5 rounded-xl text-xs font-bold transition-all text-center border cursor-pointer ${
              pestanaRepartidor === 'recoger'
                ? 'bg-orange-600 text-white border-orange-600 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            📦 Por recoger ({poolEntregas.length})
            {poolEntregas.length > 0 && pestanaRepartidor !== 'recoger' && (
              <span className="absolute top-1.5 right-2 w-2 h-2 bg-red-500 rounded-full animate-ping" />
            )}
          </button>
          <button
            onClick={() => setPestanaRepartidor('entregar')}
            className={`py-2.5 rounded-xl text-xs font-bold transition-all text-center border cursor-pointer ${
              pestanaRepartidor === 'entregar'
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            🛵 En camino ({pedidos.filter(p => p.estado === 'en_ruta').length})
          </button>
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
                    <span className="font-bold text-green-700 text-sm">{fmt(p.total)}</span>
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
      {modo === 'repartidor' && pestanaRepartidor === 'entregar' && pedidos.filter(p => p.estado === 'en_ruta' && p.geo_lat && p.geo_lng).length > 1 && (
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

      {modo === 'repartidor' && pestanaRepartidor === 'entregar' && (
        <div className="px-4 pt-3 flex gap-2">
          <button
            onClick={() => setVistaRepartidor('listado')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all text-center border cursor-pointer ${
              vistaRepartidor === 'listado'
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            📋 Listado Paradas
          </button>
          <button
            onClick={() => setVistaRepartidor('mapa')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all text-center border cursor-pointer ${
              vistaRepartidor === 'mapa'
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            🗺️ Ver Mapa
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
                  <span className="font-extrabold text-sm text-green-700">{fmt(p.total)}</span>
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
                <button
                  onClick={() => aceptarPedido(p.id, p.numero, p.nombre_cliente, p.telefono)}
                  disabled={procesando !== null}
                  className="w-full bg-[#00b074] hover:bg-[#008f5d] disabled:opacity-50 text-white font-extrabold py-3.5 rounded-2xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer active:scale-95">
                  {procesando === p.id ? <Loader2 size={14} className="animate-spin" /> : '🧺 Auto-Asignar y Empezar'}
                </button>
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
                    <span className="font-bold text-green-700">{fmt(p.total)}</span>
                  </div>

                  {/* Banner de Pago Destacado */}
                  {p.metodo_pago === 'transferencia' && p.pago_confirmado === true && (
                    <div className="bg-emerald-500 text-white font-extrabold text-xs px-4 py-3 text-center flex items-center justify-center gap-1.5 shadow-inner">
                      <span>💳 PAGADO POR TRANSFERENCIA (Confirmado)</span>
                    </div>
                  )}
                  {p.metodo_pago === 'transferencia' && p.pago_confirmado !== true && (
                    <div className="bg-yellow-500 text-slate-900 font-extrabold text-xs px-4 py-3 text-center flex items-center justify-center gap-1.5 shadow-inner animate-pulse">
                      <span>⚠️ TRANSFERENCIA POR CONFIRMAR: {fmt(p.total)}</span>
                    </div>
                  )}
                  {(!p.metodo_pago || p.metodo_pago === 'efectivo') && (
                    <div className="bg-orange-600 text-white font-extrabold text-xs px-4 py-3 text-center flex items-center justify-center gap-1.5 shadow-inner">
                      <span>💵 COBRAR EN EFECTIVO: {fmt(p.total)}</span>
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
               columna de Listado/Mapa es solo para "En camino". */
            null
          ) : (
            /* VISTA: MIS PEDIDOS (REPARTIDOR) - Listado/Mapa estilo Envíos Flex */
            vistaRepartidor === 'mapa' ? (
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
          )
        )}
      </div>

      {/* Menú inferior fijo (solo módulo comprador) */}
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

    </div>

      {/* Modal: Entregar efectivo en mano a un colega (comprador u otro repartidor) */}
      {showTraspaso && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl p-5 w-full sm:max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-800 text-base flex items-center gap-1.5">
                <ArrowRightLeft size={16} className="text-green-600" /> Entregar efectivo
              </h3>
              <button onClick={() => setShowTraspaso(false)} className="text-slate-400 p-1 cursor-pointer"><X size={18} /></button>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 text-xs text-slate-500">
              Tienes <span className="font-black text-slate-800">{fmt(repartidor?.efectivo_en_mano ?? 0)}</span> en mano.
              Registra a quién se lo entregas físicamente (otro colaborador, no la oficina).
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">¿A quién se lo entregas?</label>
              <select
                value={destinoTraspaso}
                onChange={e => setDestinoTraspaso(e.target.value)}
                className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-green-500"
              >
                <option value="">-- Selecciona --</option>
                {colegas.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
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

            {errorTraspaso && <p className="text-red-500 text-xs text-center">{errorTraspaso}</p>}

            <button
              onClick={confirmarTraspaso}
              disabled={procesandoTraspaso}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              {procesandoTraspaso ? <Loader2 size={16} className="animate-spin" /> : <ArrowRightLeft size={15} />}
              {procesandoTraspaso ? 'Registrando...' : 'Confirmar entrega de efectivo'}
            </button>
          </div>
        </div>
      )}

      {/* Modal de Confirmación de Entrega (Proof of Delivery) */}
      {entregaModal && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 select-none">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl p-5 w-full sm:max-w-sm space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-800 text-base flex items-center gap-1.5">
                📦 Confirmar Entrega
              </h3>
              <button 
                onClick={() => {
                  setFotoFile(null)
                  setEntregaModal(null)
                }} 
                className="text-slate-400 p-1 cursor-pointer"
                disabled={guardandoEntrega}
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs text-slate-600">
              <div className="font-extrabold text-slate-800">Pedido #{entregaModal.numero}</div>
              <div>Cliente: <span className="font-bold text-slate-700">{entregaModal.nombre_cliente}</span></div>
              <div>Total pedido: <span className="font-bold text-green-700">{fmt(entregaModal.total)}</span></div>
            </div>

            {/* Paso 1: Foto en Puerta */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Paso 1: Foto del Pedido en Puerta *</label>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={e => {
                  if (e.target.files && e.target.files[0]) {
                    setFotoFile(e.target.files[0])
                  }
                }}
                className="hidden"
                id="foto-entrega"
                disabled={guardandoEntrega}
              />
              <label 
                htmlFor="foto-entrega" 
                className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-4 cursor-pointer hover:bg-slate-50 transition ${
                  fotoFile ? 'border-emerald-300 bg-emerald-50/20' : 'border-slate-300'
                }`}
              >
                {fotoFile ? (
                  <div className="text-center space-y-0.5">
                    <span className="text-xs text-emerald-600 font-bold">✓ Foto del pedido cargada</span>
                    <p className="text-[9px] text-slate-400 truncate max-w-[200px]">{fotoFile.name}</p>
                  </div>
                ) : (
                  <div className="text-center space-y-1 text-slate-500">
                    <span className="text-xs font-bold">📸 Tomar foto de las bolsas en puerta</span>
                    <p className="text-[9px] text-slate-400">Presiona para abrir la cámara de tu celular</p>
                  </div>
                )}
              </label>
            </div>

            {/* Paso 2: Firma del Cliente */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Paso 2: Firma del Cliente *</label>
              <div className="relative border border-slate-200 rounded-2xl overflow-hidden bg-slate-50">
                <canvas 
                  ref={canvasRef} 
                  width={340} 
                  height={150} 
                  className="w-full h-[150px] touch-none block bg-transparent cursor-crosshair"
                />
                <button
                  type="button"
                  onClick={clearCanvas}
                  disabled={guardandoEntrega}
                  className="absolute bottom-2 right-2 bg-slate-200/80 hover:bg-slate-300/80 text-slate-700 font-bold px-2.5 py-1 rounded-lg text-[9px] transition-colors cursor-pointer select-none"
                >
                  Limpiar lienzo
                </button>
              </div>
            </div>

            {/* Paso 3: Monto Cobrado -- solo si el cliente paga contraentrega.
                Si ya pagó por transferencia y admin lo validó, no hay nada
                que cobrar en la puerta. */}
            {entregaModal.metodo_pago === 'transferencia' && entregaModal.pago_confirmado === true ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-center gap-2.5">
                <span className="text-emerald-600 text-lg">✓</span>
                <div>
                  <p className="text-xs font-bold text-emerald-700">Pago ya confirmado por transferencia</p>
                  <p className="text-[10px] text-emerald-600">No necesitas cobrar nada en la puerta — solo entrega el pedido.</p>
                </div>
              </div>
            ) : (
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Paso 3: Monto cobrado en efectivo</label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">$</span>
                  <input
                    type="number" step="0.01" min="0"
                    value={montoCobradoModal}
                    onChange={e => setMontoCobradoModal(e.target.value)}
                    placeholder={entregaModal.total.toFixed(2)}
                    disabled={guardandoEntrega}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-3 py-2.5 text-sm font-bold text-slate-800 focus:outline-none focus:border-green-500"
                  />
                </div>
              </div>
            )}

            <button
              onClick={finalizarEntregaConPOD}
              disabled={guardandoEntrega}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold py-3.5 rounded-2xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all active:scale-95"
            >
              {guardandoEntrega ? <Loader2 size={16} className="animate-spin" /> : null}
              {guardandoEntrega ? 'Subiendo firmas y fotos...' : 'Finalizar Entrega (Guardar POD)'}
            </button>
          </div>
        </div>
      )}
    </>
    )
  }
