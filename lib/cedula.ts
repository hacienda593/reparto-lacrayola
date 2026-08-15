// Validación de cédula ecuatoriana (algoritmo módulo 10 del Registro Civil).
// Rechaza strings con formato correcto pero dígitos inventados (ej.
// "1234567890"), que es el tipo de "basura" más común en formularios
// públicos sin validar.
export function validarCedulaEcuador(cedula: string): boolean {
  const c = (cedula || '').replace(/\D/g, '')
  if (c.length !== 10) return false

  const provincia = parseInt(c.slice(0, 2), 10)
  if (provincia < 1 || provincia > 24) return false

  const tercerDigito = parseInt(c[2], 10)
  if (tercerDigito > 6) return false // 6to dígito >6 es RUC de sociedad, no cédula de persona

  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2]
  let suma = 0
  for (let i = 0; i < 9; i++) {
    let valor = parseInt(c[i], 10) * coeficientes[i]
    if (valor > 9) valor -= 9
    suma += valor
  }
  const verificador = (10 - (suma % 10)) % 10
  return verificador === parseInt(c[9], 10)
}

// Formato de celular ecuatoriano: 09XXXXXXXX (10 dígitos, empieza con 09).
export function validarCelularEcuador(telefono: string): boolean {
  const t = (telefono || '').replace(/\D/g, '')
  return /^09\d{8}$/.test(t)
}
