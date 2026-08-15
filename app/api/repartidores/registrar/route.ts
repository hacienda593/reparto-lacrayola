import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validarCedulaEcuador, validarCelularEcuador } from '@/lib/cedula'

// Registro de repartidor: el navegador ya creó la cuenta de Supabase Auth
// (auth.signUp, tiene que quedar del lado del cliente para que la sesión
// se guarde en las cookies del navegador). Esta ruta hace lo que el
// navegador NO debe decidir por sí solo: revalida cédula/teléfono con un
// algoritmo real (no solo "no vacío") y bloquea solicitudes duplicadas,
// para no acumular solicitudes basura en la bandeja de aprobación del
// administrador.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })

    const { nombre, cedula, telefono, vehiculo, placa, zonaId, observaciones } = await req.json()

    const nombreLimpio = String(nombre ?? '').trim()
    const cedulaLimpia = String(cedula ?? '').replace(/\D/g, '')
    const telefonoLimpio = String(telefono ?? '').replace(/\D/g, '')

    if (nombreLimpio.length < 3) {
      return NextResponse.json({ error: 'Ingresa tu nombre completo' }, { status: 400 })
    }
    if (!validarCedulaEcuador(cedulaLimpia)) {
      return NextResponse.json({ error: 'La cédula ingresada no es válida' }, { status: 400 })
    }
    if (!validarCelularEcuador(telefonoLimpio)) {
      return NextResponse.json({ error: 'El celular debe tener el formato 09XXXXXXXX' }, { status: 400 })
    }
    if (!['moto', 'bici', 'auto', 'pie'].includes(vehiculo)) {
      return NextResponse.json({ error: 'Vehículo inválido' }, { status: 400 })
    }

    // Anti-spam: no permitir una segunda solicitud con la misma cédula o
    // teléfono si ya existe una pendiente o aprobada (evita que alguien
    // rechazado, o un bot, reintente en bucle con el mismo documento).
    const { data: existente } = await supabase
      .from('rep_repartidores')
      .select('id, estado_registro')
      .or(`cedula.eq.${cedulaLimpia},telefono.eq.${telefonoLimpio}`)
      .neq('user_id', user.id)
      .limit(1)
      .maybeSingle()

    if (existente && existente.estado_registro !== 'rechazado') {
      return NextResponse.json({ error: 'Ya existe una solicitud con esta cédula o celular' }, { status: 409 })
    }

    const { error: insertErr } = await supabase.from('rep_repartidores').insert({
      user_id: user.id,
      nombre: nombreLimpio,
      cedula: cedulaLimpia,
      telefono: telefonoLimpio,
      email: user.email,
      vehiculo,
      placa: placa ? String(placa).trim().toUpperCase() : null,
      zona_id: zonaId || null,
      observaciones: observaciones ? String(observaciones).trim() : null,
      activo: false,
      estado_registro: 'pendiente',
    })

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 422 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'No se pudo registrar la solicitud'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
