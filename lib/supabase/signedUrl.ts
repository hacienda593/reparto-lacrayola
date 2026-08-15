import type { SupabaseClient } from '@supabase/supabase-js'

// Punto 10 de docs/auditoria_plan_correcciones_ia.md: comprobantes-proveedores
// pasó a ser un bucket privado. Los valores ya guardados en columnas como
// prov_factura_url / foto_entrega_url / firma_cliente_url / comprobante_url
// son URLs públicas antiguas (de cuando el bucket era público) o, para
// registros nuevos, rutas relativas dentro del bucket. Esta función acepta
// ambos formatos y siempre devuelve la ruta relativa que necesita
// createSignedUrl().
export function extraerRutaStorage(valor: string | null | undefined): string | null {
  if (!valor) return null
  const marcador = '/comprobantes-proveedores/'
  const idx = valor.indexOf(marcador)
  if (idx !== -1) return valor.slice(idx + marcador.length)
  if (valor.startsWith('http')) return null // URL pública de otro bucket u origen: no la sabemos resolver
  return valor // ya es una ruta relativa
}

// Genera una URL firmada de corta duración para mostrar una evidencia
// privada. Devuelve null si no se pudo resolver la ruta o firmar.
export async function firmarUrlComprobante(
  supabase: SupabaseClient,
  valor: string | null | undefined,
  expiresInSeconds = 3600
): Promise<string | null> {
  const ruta = extraerRutaStorage(valor)
  if (!ruta) return null
  const { data, error } = await supabase.storage
    .from('comprobantes-proveedores')
    .createSignedUrl(ruta, expiresInSeconds)
  if (error) return null
  return data.signedUrl
}
