// Datos de facturación que el cliente eligió en el checkout de la tienda
// (consumidor final, o con RUC/cédula + razón social + correo). Se guardan
// como texto en ol_pedidos.notas con el tag [FACTURA: ...] desde que se
// crea el pedido -- este parser es compartido por cualquier pantalla que
// necesite mostrárselo a quien vaya a emitir la factura real (hoy: caja,
// para el shopper que compra por cuenta del cliente; a futuro: picking y
// la pantalla de restaurantes/tiendas afiliadas, que facturan ellos mismos
// directo al cliente y de otro modo nunca verían este dato).
export function parseDatosFactura(notas: string | null | undefined) {
  if (!notas) return null
  const match = notas.match(/\[FACTURA:\s*([^\]]+)\]/)
  if (!match) return null
  const content = match[1].trim()
  if (content === 'Consumidor Final') {
    return { consumidorFinal: true, identificacion: undefined, razonSocial: undefined, correo: undefined }
  }
  // Formato: RUC/Cédula: XXXXX | Razón Social: YYYYY | Correo: ZZZZZ
  const parts = content.split('|')
  const result: { consumidorFinal: boolean; identificacion?: string; razonSocial?: string; correo?: string } = { consumidorFinal: false }
  parts.forEach(part => {
    const [key, ...valueParts] = part.split(':')
    if (!key) return
    const value = valueParts.join(':').trim()
    const k = key.trim().toLowerCase()
    if (k.includes('ruc') || k.includes('cédula') || k.includes('cedula') || k.includes('identificación') || k.includes('identificacion')) {
      result.identificacion = value
    } else if (k.includes('razón social') || k.includes('razon social') || k.includes('nombre')) {
      result.razonSocial = value
    } else if (k.includes('correo') || k.includes('email')) {
      result.correo = value
    }
  })
  return result
}
