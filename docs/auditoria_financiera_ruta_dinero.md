# Auditoría financiera completa: ruta del dinero

Fecha de revisión: 16 de agosto de 2026  
Aplicación revisada: `reparto-lacrayola`  
Alcance: pedidos pagados por transferencia, pedidos contraentrega, compras a proveedores, custodia de efectivo, liquidaciones, comisiones, conciliación bancaria, facturación y trazabilidad.

## 1. Conclusión ejecutiva

La aplicación ya dispone de controles financieros importantes:

- Confirmación de pago mediante RPC atómica e idempotente.
- Historial de verificaciones y eventos del pedido.
- Entrega atómica con evidencia, cuenta por cobrar y movimiento de caja.
- Saldo de efectivo por custodio y bloqueo automático.
- Depósitos del repartidor relacionados con entregas concretas.
- Liquidaciones con saldo anterior, saldo posterior y reversos auditables.
- Conciliación bancaria separada de la aprobación visual de comprobantes.
- Facturas de compra consultadas nuevamente contra el SRI desde el servidor.
- Separación entre factura de compra del proveedor y factura de venta al cliente.

Sin embargo, la cadena completa todavía no garantiza que todos los valores representen el mismo dinero. El riesgo principal es el tratamiento del costo de envío:

1. La aplicación de tienda crea `ol_pedidos.total` sin incluir el envío.
2. Reparto calcula `costo_envio` más tarde, cuando el pedido ya está siendo visualizado o entregado.
3. La confirmación de transferencia no registra ni valida el monto depositado.
4. La conciliación bancaria de transferencias muestra solamente `ol_pedidos.total`.
5. La entrega por transferencia registra `monto_cobrado = 0` y solo comprueba `pago_confirmado`.
6. La factura de venta y los reportes usan `ol_pedidos.total`, también sin envío.

Por tanto, un pedido por transferencia puede avanzar y entregarse sin demostrar que el cliente pagó el envío. Además, el envío puede quedar fuera de conciliación, reportes y factura de venta.

La calificación financiera aproximada es:

| Área | Estado |
|---|---|
| Atomicidad de entrega | Buena, si está aplicada la última función |
| Custodia de efectivo COD | Buena con observaciones |
| Liquidación de efectivo | Media-alta |
| Transferencias de clientes | Media-baja |
| Conciliación bancaria | Media |
| Compra a proveedores | Media |
| Facturación y reconocimiento de ingresos | Media-baja |
| Comisiones | Media-baja |
| Trazabilidad integral por pedido | Media |
| Seguridad ante deriva de migraciones | Baja |

## 2. Limitaciones de esta revisión

Esta es una auditoría estática del repositorio. Se revisaron páginas, rutas API y migraciones SQL. No se confirmó qué versión exacta de cada función está instalada en la base de datos de producción.

Este punto es especialmente importante porque existen varias migraciones que hacen `CREATE OR REPLACE` sobre las mismas funciones. El resultado real depende del orden en el que fueron ejecutadas.

El comando `npm run lint` fue ejecutado y falló con 228 hallazgos: 171 errores y 57 advertencias. Muchos son de tipado o reglas React, pero el repositorio no pasa actualmente su puerta de calidad automatizada.

## 3. Fuentes de verdad financieras actuales

| Concepto | Fuente actual | Observación |
|---|---|---|
| Valor de productos vendido | `ol_pedidos.total` | La tienda lo envía sin transporte según comentarios y correcciones recientes |
| Transporte | `ol_pedidos.costo_envio` | Se calcula posteriormente en reparto |
| Total esperado del cliente | `total + costo_envio` | Solo algunas pantallas y la última RPC de entrega usan esta suma |
| Transferencia aprobada | `ol_pedidos.pago_confirmado` | No guarda el monto realmente aprobado |
| Transferencia conciliada en banco | `ol_pedidos.verificado_banco` | Verificación manual y separada |
| Compra al proveedor | `ol_pedidos_comprobantes_proveedor.prov_costo_real` | Comparada con XML SRI cuando existe |
| Cobro COD | `rep_entregas.monto_cobrado` | Genera cuenta por cobrar y movimiento de caja |
| Efectivo bajo custodia | `rep_repartidores.efectivo_en_mano` | Se incrementa mediante trigger sobre cuenta por cobrar |
| Depósito del rider | `rep_depositos_repartidor` | Puede relacionarse con entregas exactas mediante `rep_liquidacion_items` |
| Liquidación administrativa | `rep_movimientos_liquidacion` | Guarda saldo antes/después y admite reverso |
| Comisión | Cálculo sobre entregas y configuración actual | No hay snapshot de tarifa por entrega |
| Ledger del colaborador | `rep_ledger_movimientos` | Se llena por sincronización, no en tiempo real dentro de cada transacción |
| Factura de venta | `rep_facturas_cliente` | Actualmente toma `ol_pedidos.total`, omitiendo transporte |

## 4. Ecuación financiera que debería cumplirse

Cada pedido debe poder demostrar al menos estas cuatro cantidades:

```text
productos_vendidos
+ costo_envio
+/- ajustes_cliente
= total_final_cliente

compras_proveedor
+ otros_costos_directos
= costo_directo_pedido

total_final_cliente
- costo_directo_pedido
- comision_shopper
- comision_rider
- costos_pago
= margen_pedido
```

Actualmente no existe una vista o tabla que cierre esta ecuación por pedido. Control 360 reúne estados operativos, pero no una conciliación financiera completa.

## 5. Flujo de transferencia del cliente

### 5.1 Nacimiento del pedido

La aplicación de tienda inserta el pedido en `ol_pedidos` con:

- `total`
- `metodo_pago`
- posible `referencia_transferencia`
- datos del cliente
- ubicación
- ítems

Según el código actual de reparto, `total` representa productos y no incorpora necesariamente el costo de envío.

### 5.2 Cálculo de envío

El envío se calcula desde:

```text
app/api/envio/calcular-pedido/route.ts
lib/envio.ts
```

La fórmula usa:

```text
tarifa_base + costo_por_km * distancia
```

con piso y techo configurables. Primero intenta OSRM y, si falla, utiliza distancia Haversine multiplicada por 1,3.

El resultado se guarda en `ol_pedidos.costo_envio` mediante `guardar_costo_envio_pedido()`.

Problema temporal: el cálculo ocurre cuando reparto visualiza o entrega el pedido, no obligatoriamente antes de que el cliente transfiera ni antes de que administración confirme el pago.

### 5.3 Confirmación administrativa

La pantalla de despacho llama a:

```sql
confirmar_pago_admin(
  p_pedido_id,
  p_referencia,
  p_banco,
  p_fecha,
  p_evidencia_path,
  p_request_id
)
```

Aspectos positivos:

- Comprueba capacidad de rol.
- Bloquea el pedido con `FOR UPDATE`.
- Actualiza el pedido y la bitácora en una sola transacción.
- Mantiene historial de reversos.
- Es idempotente por `request_id`.
- Existe índice único para la referencia.

Deficiencias:

- No recibe `p_monto`.
- No comprueba `total + costo_envio`.
- El frontend envía `p_evidencia_path = null`.
- No exige que `metodo_pago = 'transferencia'`.
- No exige que el envío esté calculado.
- No valida titular, cuenta receptora, moneda ni identificador bancario real.
- `pago_confirmado` significa aprobación manual, no conciliación bancaria.

### 5.4 Liberación, compra y entrega

Las pantallas impiden normalmente liberar una transferencia no confirmada. La RPC de entrega también exige `pago_confirmado=true` cuando `p_metodo='transferencia'`.

En la entrega:

```text
p_metodo = transferencia
p_monto = 0
rep_entregas.monto_cobrado = 0
```

Esto es coherente con que el rider no recibe efectivo, pero elimina del registro de entrega la cantidad previamente cobrada por el negocio. Para reconstruir el ingreso hay que volver al pedido y asumir que `total` es correcto.

La entrega no exige `verificado_banco=true`; solamente `pago_confirmado=true`.

### 5.5 Conciliación bancaria

La función `admin_conciliacion_bancaria()` reúne:

- Transferencias de clientes confirmadas.
- Depósitos confirmados de repartidores.

La conciliación es manual. Un usuario financiero marca cada movimiento con `marcar_verificado_banco()`.

Problemas:

- Para transferencias muestra `p.total`, no `p.total + p.costo_envio`.
- No almacena monto observado en el extracto.
- No almacena cuenta bancaria, fecha valor o ID de transacción bancaria.
- No compara automáticamente esperado contra observado.
- El mismo permiso permite marcar y desmarcar sin un reverso formal.
- El pedido puede comprarse y entregarse antes de la conciliación bancaria.

### 5.6 Resultado del flujo de transferencia

La cadena actual demuestra:

```text
alguien aprobó una referencia -> el pedido avanzó -> se entregó sin efectivo
```

No demuestra necesariamente:

```text
el banco recibió exactamente productos + envío
```

## 6. Flujo de pago contraentrega

### 6.1 Creación y procesamiento

El pedido nace con método de pago en efectivo/COD. No necesita `pago_confirmado` antes de la compra.

El shopper acepta, compra y registra la factura del proveedor. Posteriormente el pedido pasa a custodia del rider.

### 6.2 Total que debe cobrar el rider

Las pantallas actuales calculan:

```text
montoACobrar = ol_pedidos.total + ol_pedidos.costo_envio
```

La última versión de `finalizar_entrega_atomica()` también calcula ese total esperado.

Si el efectivo cobrado es menor en más de un centavo, exige `p_nota_diferencia`. El sistema no bloquea completamente la diferencia porque puede existir una justificación legítima.

Aspectos positivos:

- Guarda `monto_esperado` y `monto_cobrado`.
- Guarda nota de diferencia.
- Exige foto de entrega.
- Usa `request_id` para evitar doble cobro por reintento.
- Bloquea asignación y pedido.
- Crea en la misma transacción la entrega, cuenta por cobrar y movimiento de caja.
- Genera un evento de entrega exitosa.

Deficiencias:

- La función no exige claramente `rep_asignaciones.estado='en_ruta'`; solo rechaza cancelado o devuelto.
- Un monto mayor al esperado se acepta sin motivo.
- La diferencia no genera automáticamente una incidencia financiera.
- No hay tolerancias configurables por rol o autorización de supervisor.
- Si `costo_envio` continúa `NULL`, se cobra cero por envío.

### 6.3 Acumulación del efectivo

`finalizar_entrega_atomica()` inserta una fila en `rep_cuentas_cobrar`. Un trigger posterior incrementa:

```text
rep_repartidores.efectivo_en_mano += monto_cobrado
```

Cuando el saldo llega a 40 dólares, otro trigger cambia el estado a `BLOQUEADO`.

También existe bloqueo por antigüedad: si hay entregas en efectivo de un día anterior no relacionadas con una liquidación, el repartidor no puede aceptar o recibir nuevas rutas.

Aspectos positivos:

- La custodia queda asignada a una persona concreta.
- El incremento nace de una entrega exitosa.
- Existe límite por monto y vencimiento por antigüedad.
- El traspaso de efectivo entre colaboradores es atómico e idempotente.

Observaciones:

- `efectivo_en_mano` es un saldo materializado; debe reconciliarse constantemente contra el ledger.
- El trigger reactiva automáticamente a cualquier usuario bloqueado cuando baja de 40, aunque el bloqueo pudiera tener otra causa administrativa.
- Un único campo `estado='BLOQUEADO'` no distingue exceso de efectivo, deuda vencida, fraude, suspensión o causa manual.

### 6.4 Depósito del repartidor

El repartidor puede seleccionar las entregas en efectivo que cubre y crear un depósito.

La versión de trazabilidad exige:

- Entregas propias.
- Entregas exitosas y en efectivo.
- Entregas no liquidadas anteriormente.
- Suma exacta entre pedidos seleccionados y monto del depósito.
- Referencia obligatoria.
- Evidencia.
- Unicidad de referencia.
- Idempotencia por `request_id`.

Esto es uno de los controles más sólidos de la aplicación.

### 6.5 Confirmación y conciliación del depósito

Un administrativo confirma el depósito y se ejecuta `liquidar_repartidor_admin()`, que reduce el saldo del custodio y registra:

- Liquidación resumida.
- Movimiento individual.
- Saldo antes.
- Saldo después.
- Método.
- Referencia.
- Evidencia.
- Receptor.

Después, la conciliación bancaria permite marcarlo como verificado contra el extracto.

Riesgo crítico: el saldo del rider se reduce y puede desbloquearse cuando un administrador confirma visualmente el depósito, antes de que `verificado_banco` confirme que el dinero realmente entró. Un comprobante falso o reversado puede liberar capacidad operativa prematuramente.

La confirmación del depósito y la conciliación bancaria necesitan una política explícita:

- O el administrador confirma únicamente después de mirar el banco y ambos estados se unifican.
- O se mantiene `pendiente_banco` sin reducir definitivamente la responsabilidad del rider hasta la conciliación.

## 7. Dinero utilizado para comprar al proveedor

El shopper registra:

- Proveedor.
- Factura o excepción.
- Total real pagado.
- Método de pago.
- Foto.
- XML SRI y hash cuando existe.

Cuando el método es `efectivo_caja_chica`, se inserta:

```text
rep_transacciones_caja.tipo = egreso_compra
```

La factura, el cambio de estado del pedido y la asignación se procesan atómicamente desde servidor.

Aspectos positivos:

- El navegador no persiste por sí solo los campos confiables del XML.
- El servidor vuelve a consultar el SRI.
- Se valida RUC comprador y ambiente productivo para el flujo normal.
- Se compara XML contra monto digitado.
- Existen excepciones explícitas para factura pendiente y compra sin comprobante.
- Las excepciones requieren motivo y revisión administrativa.
- Se registra quién compró y quién revisó.

Deficiencias financieras:

- `egreso_compra` no aparece integrado en el ledger del colaborador.
- No se observa una actualización del saldo de caja chica al registrar el egreso.
- No está definido en el modelo si el dinero pertenece a una caja empresarial, anticipo del shopper o fondo reembolsable.
- No existe un saldo de fondos entregados al shopper para comprar.
- No existe conciliación por pedido entre anticipo, gasto real y devolución de sobrante.
- La factura de proveedor puede tener diferencias, pero el total que se cobra al cliente no se recalcula ni queda vinculado a una política de precio.
- La pantalla envía al cliente por WhatsApp el total de la factura del proveedor como “monto total”, mientras la entrega cobra `total + costo_envio`. Si el negocio opera como revendedor, esos valores pueden ser diferentes y el mensaje puede ser incorrecto.

Debe definirse uno de estos modelos:

### Modelo A: revendedor

La Crayola compra al proveedor y vende al cliente a precio propio. En ese caso:

- La factura del proveedor es costo, no total a cobrar al cliente.
- El cliente paga el precio de venta confirmado.
- Las variaciones de costo afectan margen, no automáticamente el cobro.
- La factura de venta debe reflejar precio de venta más envío.

### Modelo B: mandatario/intermediario

El cliente reembolsa el costo real de compra y paga una tarifa de servicio. En ese caso:

- La factura de proveedor determina el reembolso.
- Deben recalcularse total final y autorización del cliente.
- El servicio/envío debe facturarse por separado o según el diseño tributario.

El código actual mezcla señales de ambos modelos.

## 8. Comisiones y pago a colaboradores

Las comisiones pueden ser fijas o porcentuales.

Riesgos encontrados:

1. La tarifa no se congela al momento de aceptar o entregar el pedido.
2. Los cálculos consultan `rep_repartidores.comision_valor` actual.
3. Si administración cambia la tarifa, entregas históricas todavía no sincronizadas pueden calcularse con la nueva tarifa.
4. El ledger es llenado posteriormente por `sincronizar_ledger_financiero()`, no dentro de la transacción de entrega.
5. Una vez sincronizado, el movimiento no cambia; el resultado depende del momento de sincronización.
6. La comisión porcentual usa `ol_pedidos.total`, no `costo_envio`; esto puede ser correcto, pero debe ser una política explícita.
7. El frontend móvil muestra en varios lugares un valor fijo por entrega aunque exista modalidad porcentual.
8. `mi_comision_pendiente()` resta ganancias de períodos cerrados; no se impiden períodos superpuestos con rangos distintos.
9. Cerrar períodos superpuestos puede pagar o descontar comisiones dos veces.

Corrección recomendada:

Guardar por entrega:

```text
comision_tipo_snapshot
comision_valor_snapshot
base_comision
comision_calculada
calculada_at
regla_version
```

Crear el movimiento de ganancia dentro de la misma transacción de entrega. Los cierres deben consumir movimientos no pagados, no volver a calcular entregas históricas.

## 9. Facturación de venta e ingresos

Después de una entrega exitosa se crea una factura de cliente pendiente. La función de emisión usa:

```text
rep_facturas_cliente.total = ol_pedidos.total
```

No suma `costo_envio`.

Consecuencias posibles:

- Factura por un valor inferior al total cobrado.
- Ingreso de transporte no facturado.
- Diferencia entre banco, efectivo, entrega y factura.
- Reportes fiscales y comerciales incompletos.

Además, la pantalla de reportes calcula “Facturado” sumando `ol_pedidos.total`, aunque no exista necesariamente una factura emitida y aunque omita envío. El nombre de la métrica es incorrecto: actualmente representa valor de pedidos entregados, no facturación real.

Se deben separar:

```text
ventas_brutas_productos
ingresos_envio
ajustes
total_cobrado
total_facturado
total_conciliado_banco
cuentas_por_cobrar
```

## 10. Trazabilidad existente por pedido

La aplicación puede enlazar buena parte de la historia mediante `pedido_id`:

```text
ol_pedidos
  -> ol_pedidos_verificaciones
  -> rep_asignaciones
  -> ol_pedido_items / rep_picking
  -> ol_pedidos_comprobantes_proveedor
  -> rep_handoffs
  -> rep_entregas
  -> rep_cuentas_cobrar
  -> rep_transacciones_caja
  -> rep_liquidacion_items
  -> rep_depositos_repartidor
  -> rep_facturas_cliente
  -> rep_pedido_eventos
```

Lo que falta es una vista financiera única que muestre por pedido:

- Productos vendidos.
- Costo de envío.
- Total final esperado.
- Método de pago.
- Monto transferido declarado.
- Monto confirmado.
- Monto conciliado en banco.
- Monto cobrado en efectivo.
- Diferencia de cobro.
- Compra real a proveedores.
- Método con que se pagó la compra.
- Custodio del efectivo.
- Depósito que cubrió la entrega.
- Estado de conciliación del depósito.
- Comisión congelada.
- Factura de venta y valor facturado.
- Margen estimado.
- Alertas.

## 11. Hallazgos priorizados

### Críticos

#### C1. Transferencias pueden omitir el costo de envío

El pago se confirma sin monto y antes de calcular obligatoriamente el envío. La entrega no cobra diferencia para transferencias.

#### C2. Factura de venta omite el envío

`registrar_factura_cliente()` usa `ol_pedidos.total` y no `total + costo_envio`.

#### C3. Depósito puede liberar al rider antes de conciliación bancaria

Confirmar foto reduce `efectivo_en_mano`; `verificado_banco` ocurre después.

#### C4. Deriva de migraciones y funciones duplicadas

Hay varias definiciones de `finalizar_entrega_atomica()`. La versión de 10 parámetros elimina la de 9 en una migración, pero migraciones históricas posteriores o ejecuciones fuera de orden pueden recrear la versión insegura. Las verificaciones existentes todavía buscan la firma antigua de 9 parámetros.

#### C5. Costo de envío puede ser escrito por cualquier usuario autenticado

`guardar_costo_envio_pedido()` solamente exige sesión y permite fijar el valor si está `NULL`. No comprueba propiedad, asignación, capacidad ni que el valor provenga del calculador autorizado.

### Altos

#### A1. Confirmación de transferencia sin monto ni evidencia obligatoria

No existe `monto_confirmado` ni comparación con el total esperado.

#### A2. Conciliación bancaria usa el monto incorrecto para transferencias

La vista usa `p.total` y omite `costo_envio`.

#### A3. Comisión histórica no está congelada

Cambiar la configuración puede alterar cálculos pendientes.

#### A4. Períodos de comisión pueden superponerse

No existe una exclusión de rangos o consumo individual de movimientos.

#### A5. Caja chica de compras no tiene saldo ni conciliación completa

Se registra el egreso, pero no queda claro qué fondo disminuye ni cómo se repone.

#### A6. La entrega no exige estado `en_ruta`

La RPC debe aceptar solamente transiciones válidas.

#### A7. Método de pago inferido desde texto libre

Varias pantallas detectan transferencia leyendo `notas`. Esto puede clasificar incorrectamente un pedido.

### Medios

#### M1. Diferencias superiores al esperado no requieren motivo

Podrían representar propina, error o sobrecobro. Deben clasificarse.

#### M2. La referencia es única globalmente sin considerar banco

Puede producir falsos duplicados o ser insuficiente según el formato bancario.

#### M3. Conciliación bancaria se puede desmarcar sin reverso formal

Debe existir historial append-only de conciliaciones y reversos.

#### M4. Reporte “Facturado” no usa facturas reales

Suma pedidos entregados y omite transporte.

#### M5. Ledger se sincroniza de forma diferida

Hasta sincronizar, el saldo materializado y el ledger pueden diferir.

#### M6. Bloqueo automático no conserva causa

Un descenso de saldo puede reactivar una suspensión aplicada por otra razón.

## 12. Arquitectura financiera recomendada

### 12.1 Congelar el precio antes del pago

Antes de permitir transferencia o liberar el pedido, guardar:

```text
subtotal_productos
descuentos
costo_envio
otros_cargos
total_final
precio_version
precio_cerrado_at
```

Después de cerrar el precio, no modificarlo silenciosamente. Todo cambio debe ser un ajuste con actor y motivo.

### 12.2 Registrar el pago como entidad

Crear `rep_pagos_cliente`:

```text
id
pedido_id
metodo
monto_esperado
monto_declarado
monto_confirmado
monto_conciliado
moneda
banco
cuenta_destino
referencia
evidencia_path
estado
confirmado_por
confirmado_at
conciliado_por
conciliado_at
request_id
created_at
```

Estados:

```text
pendiente
declarado
en_revision
confirmado
conciliado
rechazado
reversado
con_diferencia
```

### 12.3 Registrar dinero por doble entrada

Usar un ledger empresarial como fuente principal y generar movimientos dentro de las transacciones de negocio, no mediante sincronización posterior.

Cuentas conceptuales mínimas:

```text
banco
caja_empresa
efectivo_en_custodia
anticipos_shopper
cuentas_por_cobrar_cliente
ingresos_productos
ingresos_envio
costo_mercaderia
comisiones_por_pagar
ajustes
```

Cada movimiento debe balancear débitos y créditos.

### 12.4 Congelar comisión por entrega

La entrega debe guardar la regla aplicada y el valor exacto ganado. El cierre de comisión solo marca esos movimientos como pagados o compensados.

### 12.5 Vista financiera 360

Crear `rep_control_financiero_pedido` con una fila por pedido y alertas como:

```text
envio_sin_cobrar
transferencia_sin_monto
pago_confirmado_no_conciliado
entregado_sin_pago_conciliado
cobro_diferente_total
compra_sin_factura
factura_compra_con_diferencia
efectivo_sin_deposito
deposito_no_conciliado
factura_venta_por_monto_incorrecto
comision_sin_snapshot
margen_negativo
```

## 13. Plan de corrección recomendado

### Prioridad 0: impedir pérdida de ingresos

1. Calcular y congelar `costo_envio` antes de mostrar instrucciones de transferencia.
2. Crear `total_final` persistido.
3. Modificar `confirmar_pago_admin` para exigir y guardar monto.
4. Impedir confirmar si `monto_confirmado != total_final`, salvo excepción autorizada.
5. Impedir entregar transferencia si el monto confirmado no cubre `total_final`.
6. Corregir conciliación bancaria y factura de venta para usar `total_final`.
7. Restringir `guardar_costo_envio_pedido` a un servicio autorizado o RPC que calcule internamente.

### Prioridad 1: cerrar custodia y banco

1. No liberar saldo del rider hasta confirmar recepción real.
2. Unificar confirmación de depósito y conciliación, o introducir `pendiente_banco`.
3. Convertir cambios de conciliación en eventos y reversos, no toggles destructivos.
4. Exigir estado `en_ruta` para entregar.
5. Generar incidencia automática por cualquier diferencia de cobro.

### Prioridad 2: costos y caja chica

1. Definir si La Crayola es revendedor o mandatario.
2. Crear anticipos/fondos entregados al shopper.
3. Debitar el fondo correcto al registrar `egreso_compra`.
4. Conciliar anticipo, compras y sobrante por pedido o jornada.
5. Evitar comunicar al cliente el costo del proveedor como total de venta.

### Prioridad 3: comisiones y contabilidad

1. Guardar snapshot de comisión en cada entrega.
2. Crear movimiento de comisión al entregar.
3. Prohibir períodos superpuestos.
4. Pagar movimientos concretos, no totales recalculados.
5. Migrar el ledger a doble entrada.

### Prioridad 4: migraciones y calidad

1. Crear una migración consolidada que elimine firmas antiguas.
2. Consultar `pg_proc` para comprobar qué versiones existen realmente.
3. Actualizar scripts de verificación a la firma de 10 parámetros.
4. Añadir una tabla de migraciones aplicadas o usar Supabase CLI formalmente.
5. Corregir los errores de lint y agregar pruebas de concurrencia y finanzas.

## 14. Pruebas financieras obligatorias

### Transferencia

1. Pedido de productos por 20 y envío de 3: no aceptar transferencia de 20.
2. No confirmar pago si `costo_envio` es `NULL`.
3. No entregar si el pago confirmado es inferior al total final.
4. Conciliación debe mostrar 23.
5. Factura de venta debe sumar 23 o desglosar 20 + 3.
6. Reversar conciliación después de entregar debe crear alerta crítica.

### Contraentrega

1. Cobro exacto.
2. Cobro inferior con motivo.
3. Cobro superior clasificado como propina o sobrecobro.
4. Reintento con el mismo `request_id` no duplica saldo.
5. Entrega sin estado `en_ruta` es rechazada.
6. Entrega sin envío calculado es rechazada.

### Custodia

1. Saldo aumenta exactamente una vez.
2. Bloqueo a partir del límite configurado.
3. Efectivo vencido impide nuevas rutas.
4. Dos depósitos no pueden cubrir la misma entrega.
5. Depósito no verificado no libera responsabilidad definitiva.
6. Reverso restaura saldo y registra causa.

### Proveedores

1. Anticipo menos compra real produce sobrante.
2. Compra superior al anticipo produce cuenta por reembolsar.
3. Factura XML diferente al monto digitado crea diferencia.
4. Excepción sin comprobante requiere aprobación.
5. El costo del proveedor no reemplaza silenciosamente el precio al cliente.

### Comisiones

1. Cambiar tarifa hoy no modifica entregas anteriores.
2. Una entrega genera una sola comisión.
3. Dos períodos superpuestos son rechazados.
4. Un movimiento pagado no vuelve a participar.
5. Transferencias y COD generan la misma comisión si la regla del negocio así lo define.

## 15. Consultas de verificación recomendadas para producción

Ejecutar manualmente en SQL Editor después de revisar los nombres reales de columnas.

```sql
-- Transferencias entregadas sin conciliación bancaria.
SELECT p.id,p.numero,p.total,p.costo_envio,p.pago_confirmado,p.verificado_banco
FROM ol_pedidos p
JOIN rep_entregas e ON e.pedido_id=p.id AND e.exitosa
WHERE p.metodo_pago='transferencia'
  AND NOT COALESCE(p.verificado_banco,false);

-- Pedidos donde el envío nunca fue calculado.
SELECT id,numero,estado,total,costo_envio
FROM ol_pedidos
WHERE estado NOT IN ('cancelado') AND costo_envio IS NULL;

-- Diferencias de efectivo.
SELECT pedido_id,monto_esperado,monto_cobrado,nota_diferencia_cobro
FROM rep_entregas
WHERE exitosa
  AND metodo_pago='efectivo'
  AND ABS(COALESCE(monto_esperado,0)-COALESCE(monto_cobrado,0))>0.01;

-- Depósitos que redujeron caja pero no están conciliados con banco.
SELECT id,repartidor_id,monto,estado,verificado_banco,liquidacion_id
FROM rep_depositos_repartidor
WHERE estado='confirmado' AND NOT verificado_banco;

-- Facturas de venta cuyo total omite envío.
SELECT f.id,p.numero,f.total,p.total productos,p.costo_envio,
       COALESCE(p.total,0)+COALESCE(p.costo_envio,0) total_esperado
FROM rep_facturas_cliente f
JOIN ol_pedidos p ON p.id=f.pedido_id
WHERE f.estado='emitida'
  AND ABS(COALESCE(f.total,0)-(COALESCE(p.total,0)+COALESCE(p.costo_envio,0)))>0.01;

-- Funciones duplicadas de entrega instaladas.
SELECT p.oid::regprocedure
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='finalizar_entrega_atomica';
```

## 16. Criterio de cierre de la auditoría

La ruta del dinero estará realmente cerrada cuando cualquier pedido permita demostrar, sin interpretar notas ni conversaciones de WhatsApp:

```text
qué se vendió
cuánto debía pagar el cliente
cuánto pagó
por qué canal pagó
quién lo confirmó
si apareció en banco
cuánto costó comprar los productos
de qué fondo salió ese dinero
quién custodió el efectivo
qué depósito liquidó cada entrega
qué comisión se generó
cuánto se facturó
qué margen produjo
qué diferencias existieron y quién las autorizó
```

Hasta completar esos puntos, la aplicación tiene buena trazabilidad operativa y una custodia COD razonable, pero no una conciliación financiera integral de extremo a extremo.
