# Auditoría operativa de la aplicación de entregas

**Fecha:** 21 de agosto de 2026  
**Alcance:** código, pantallas y migraciones presentes en `reparto-lacrayola`.  
**Limitación:** no se comprobó la base Supabase desplegada ni se realizó una prueba integral con la aplicación de tienda. La existencia de un archivo SQL no demuestra que esté aplicado en producción.

## 1. Dictamen ejecutivo

La aplicación cubre gran parte del proceso esperado y tiene una base funcional avanzada: pago validado por administración, asignaciones separadas por tienda, shoppers con afinidad de tienda, picking ordenado por secciones, traspaso por QR, conteo de bultos, obligación de un solo rider para un pedido multitienda, rutas combinadas, evidencia de entrega, corrección GPS y control del efectivo.

No obstante, todavía no debe considerarse cerrada para una operación multitienda de producción. El riesgo principal no es la ausencia total de funciones, sino que existen varias implementaciones del mismo flujo y parte de la verdad operativa sigue repartida entre pantallas, escrituras directas desde el navegador, enlaces manuales de WhatsApp y migraciones SQL cuyo orden efectivo no está demostrado.

**Valoración funcional estimada:** 72/100 en código.  
**Preparación para producción:** condicionada a validar el esquema desplegado y cerrar los hallazgos críticos y altos.

## 2. Flujo esperado y cobertura encontrada

| Etapa | Cobertura actual | Evaluación |
|---|---|---|
| Pedido recibido desde la tienda | Usa `ol_pedidos` y `ol_pedido_items` compartidos | Parcial: falta contrato/versionado y prueba integral entre aplicaciones |
| Verificación de transferencia | RPC `confirmar_pago_admin`, referencia, monto, banco y auditoría | Buena en código; falta confirmar función y permisos reales en producción |
| Liberación al pool | Administración libera y shoppers pueden aceptar | Buena, con riesgo por coexistencia de reglas/migraciones históricas |
| Shopper por tienda | `tienda_id`, afinidad `rep_repartidores_tiendas` y aceptación por tienda | Buena |
| Picking rápido | Orden por tienda, sección/góndola, escaneo, agotados y sustituciones | Buena, aunque depende de la calidad de catálogo/secciones |
| Factura de compra | Registro, SRI, caja y revisión | Avanzada; persiste riesgo por redefiniciones históricas de la RPC |
| Traspaso shopper-rider | QR/token, expiración, un solo uso, bultos y evidencia | Buena |
| Consolidación multitienda | Mismo rider obligatorio y pedido `enviado` solo cuando todas las asignaciones están `en_ruta` | Correcta en backend; UX operativa incompleta |
| Ruta de entrega | Orden aproximado por cercanía y Google Maps con paradas | Parcial: heurística local, sin restricciones operativas ni persistencia del plan |
| Comunicación con cliente | Botones `wa.me` en varias etapas | Disponible, pero no auditable ni centralizada |
| Dirección/GPS | Reutiliza direcciones verificadas y permite corregir coordenadas | Funcional, pero con escrituras no atómicas y criterios inconsistentes de “cliente nuevo” |
| Cobro contraentrega | Alertas visuales, monto esperado, diferencias y caja del rider | Buena |
| Transferencia pagada | Etiqueta confirmada y RPC impide entregar transferencia no verificada | Buena |
| Evidencia de entrega | Foto, firma, GPS e idempotencia | Buena, duplicada en dos interfaces |

## 3. Hallazgos prioritarios

### P0-01 — No existe una versión demostrable del esquema de producción

Hay decenas de migraciones independientes que reemplazan las mismas RPC, políticas y reglas. El comportamiento final depende del orden manual en que fueron ejecutadas. Las auditorías previas ya detectaron redefiniciones incompatibles, especialmente en facturación SRI y permisos.

**Impacto:** el frontend puede estar diseñado para una firma o validación que no coincide con la base real. Una revisión exclusiva del repositorio no puede certificar seguridad ni integridad transaccional.

**Acción:** crear una migración canónica final, un historial ordenado de migraciones y una verificación automática de firmas, propietarios, `GRANT`, RLS, índices y triggers desplegados.

### P0-02 — La entrega tiene dos implementaciones activas

El cierre con foto, firma, GPS y `finalizar_entrega_atomica` existe tanto en `app/repartidor/page.tsx` como en `app/entrega/[id]/page.tsx`. Ambas contienen su propia lógica de cobro, archivos, GPS, diferencias y mensajes.

**Impacto:** una corrección puede llegar a una pantalla y no a la otra; ya se observan diferencias en actualización de dirección y experiencia de entrega.

**Acción:** conservar una única pantalla/servicio de entrega. Toda entrada debe navegar a ella y toda validación decisiva debe residir en una sola RPC.

### P0-03 — Corrección de dirección y GPS fuera de una transacción única

Las coordenadas se modifican desde el navegador en `ol_pedidos`, `ol_direcciones_cliente` y `rep_clientes_direcciones`. Algunas operaciones ignoran el resultado de `update`/`insert` o solo escriben el error en consola. La entrega puede cerrarse aunque la agenda quede sin corregir, o la agenda puede cambiar antes de que falle el cierre.

**Impacto:** datos divergentes entre la tienda y reparto; pérdida de trazabilidad de quién corrigió la dirección y por qué.

**Acción:** RPC `confirmar_entrega_y_direccion` o comando servidor transaccional que guarde coordenada anterior/nueva, precisión GPS, distancia, actor, motivo, evidencia y evento. No identificar al cliente solamente por teléfono y texto aproximado.

### P0-04 — Comunicación crítica no queda registrada

La comunicación se realiza principalmente mediante enlaces `wa.me`. Abrir el enlace no demuestra que el mensaje se envió, llegó o fue leído. En picking existe además un estado local de mensajes que no persiste una conversación real.

**Impacto:** sustituciones, diferencias de precio, cambio de ubicación o disponibilidad pueden depender de una conversación imposible de auditar.

**Acción:** mantener WhatsApp como canal, pero registrar cada intención y decisión en `rep_comunicaciones` y `rep_aprobaciones_cliente`. Para decisiones sensibles, enviar un enlace firmado donde el cliente apruebe o rechace estructuradamente.

### P1-01 — Consolidación correcta en backend, incompleta para el rider

`migration_traspaso_multitienda_independiente.sql` bloquea que riders distintos dividan el mismo pedido y espera que todas las asignaciones estén `en_ruta`. Las pantallas de escaneo y traspaso consultan tiendas hermanas.

Falta, sin embargo, una ficha consolidada única con:

- tiendas totales, listas y pendientes;
- orden sugerido de recogida;
- shopper y contacto por tienda;
- bultos declarados, recibidos e incidencias por tienda;
- bloqueo visual y de servidor para “salir hacia cliente” hasta completar todo;
- un identificador/manifesto del pedido consolidado.

**Riesgo:** el control técnico existe, pero el rider puede no comprender rápidamente qué parte falta o qué bulto pertenece a qué tienda.

### P1-02 — La “optimización” de ruta es una heurística básica

La ruta combinada usa vecino más cercano calculado en el navegador y abre Google Maps. No contempla tráfico, ventanas horarias, prioridad real, capacidad, tiempo de compra, tiendas aún no listas, máximo de paradas ni retorno.

**Acción:** distinguir dos planes: ruta de recogida y ruta de entrega. Persistir versión, orden y estado de cada parada. Para una primera mejora, usar matriz de tiempos de viaje y reglas de negocio antes de adoptar optimización avanzada.

### P1-03 — Criterio de primer pedido/dirección verificada no es único

Administración considera nuevo al cliente según direcciones previas y coordenadas; entrega busca coincidencias aproximadas por teléfono y texto. Esto no garantiza que sea el primer pedido del cliente ni que se trate de la misma vivienda.

**Acción:** usar `cliente_id` y `direccion_id` estables. La dirección debe tener estados `no_verificada`, `confirmada`, `corregida` y conservar versiones. Exigir confirmación al finalizar si la dirección usada no estaba verificada, no simplemente si el cliente parece nuevo.

### P1-04 — Exceso de lógica y estado en pantallas monolíticas

`app/repartidor/page.tsx` supera 2.600 líneas y mezcla pool, compra, rutas, caja, entrega, GPS, WhatsApp y modales. Esto eleva el riesgo de regresiones y explica parte de la duplicación.

**Acción:** separar por casos de uso, no solo por componentes visuales: `aceptarPedido`, `iniciarCompra`, `crearHandoff`, `consolidarPedido`, `iniciarRuta`, `cerrarEntrega`, `corregirDireccion` y `registrarComunicacion`.

### P1-05 — La calidad estática no está aprobada

`npm run lint` termina con **244 problemas: 194 errores y 50 advertencias**. Incluye uso extendido de `any`, efectos con actualizaciones síncronas, dependencias incompletas y archivos de diagnóstico incluidos en el alcance de ESLint.

**Impacto:** no todos son defectos funcionales, pero impiden usar el lint como puerta de calidad y ocultan regresiones nuevas entre deuda existente.

**Acción:** corregir primero errores en rutas productivas, excluir explícitamente scripts `scratch` cuando corresponda y exigir lint limpio en CI.

## 4. Controles positivos que deben conservarse

- RPC atómicas e idempotencia con `request_id` en aceptación, compra, traspaso y entrega.
- Asignación por `tienda_id` y afinidad de shoppers en servidor.
- Un único rider para todas las partes del pedido multitienda.
- Pedido marcado `enviado` solo cuando todas las partes fueron recogidas.
- Token de traspaso con hash, expiración, bloqueo de fila y límite de intentos.
- Declaración y confirmación de bultos con incidencia por diferencia.
- Transferencia no entregable si administración no la confirmó.
- Distinción visual entre “pagado” y “cobrar efectivo”.
- Registro del monto esperado, cobrado y justificación de diferencias.
- Evidencia privada mediante rutas y URLs firmadas.
- Reutilización de direcciones verificadas y comparación de distancia GPS.

## 5. Diseño operativo recomendado

El pedido debe conservar una cabecera comercial y crear una unidad operativa por tienda:

```text
Pedido cliente
  ├─ Compra tienda A → shopper A → bultos A → handoff A ┐
  ├─ Compra tienda B → shopper B → bultos B → handoff B ├─ manifiesto consolidado
  └─ Compra tienda C → shopper C → bultos C → handoff C ┘
                                      ↓ mismo rider
                              ruta hacia cliente
                                      ↓
                   entrega + cobro + GPS + evidencia
```

Estados mínimos del consolidado:

```text
esperando_compras → recogida_parcial → completo → en_ruta_cliente → entregado
```

No se debe permitir `en_ruta_cliente` si una tienda está pendiente, cancelada sin resolución o tiene discrepancia de bultos abierta.

## 6. Requisitos de comunicación por etapa

Cada pantalla operativa debe ofrecer llamada y WhatsApp, pero con plantillas centralizadas y evento interno:

| Etapa | Comunicación mínima |
|---|---|
| Pago observado | Solicitar comprobante o aclaración |
| Inicio de compra | Avisar que la compra comenzó |
| Faltante/sustitución | Solicitud estructurada con producto, precio y vencimiento |
| Compra lista | Avisar progreso sin prometer hora incorrecta |
| Recogida multitienda | Mostrar al rider contactos de shoppers por tienda |
| En camino | Compartir seguimiento y ETA |
| Problema de ubicación | Llamar, abrir WhatsApp y solicitar pin corregido |
| Entrega fallida | Registrar intentos, canal, hora y resultado |

## 7. Pruebas de aceptación obligatorias

1. Un pedido de tres tiendas crea tres asignaciones y cada shopper solo ve sus ítems.
2. Dos shoppers no pueden reclamar la misma tienda simultáneamente.
3. Un shopper no puede finalizar con ítems pendientes o sustituciones sin resolver.
4. Un rider que ya tomó una tienda es el único que puede tomar las demás del pedido.
5. El rider no puede salir hacia el cliente mientras falte una tienda.
6. Una diferencia de bultos crea incidencia y bloquea o exige resolución autorizada.
7. Una transferencia sin confirmar no puede liberarse ni entregarse.
8. Una transferencia confirmada nunca solicita efectivo al rider.
9. Un pedido contraentrega muestra una alerta persistente y exige monto.
10. Un cobro menor o mayor exige clasificación y queda auditado.
11. Una dirección no verificada obliga a confirmar/corregir GPS al entregar.
12. Si falla la corrección de dirección, el operador recibe un resultado explícito y queda tarea de reparación.
13. Cada comunicación genera un registro, aunque WhatsApp no llegue a abrirse.
14. La aplicación de tienda recibe estados compatibles y no expone estados financieros internos.
15. Reintentos por mala señal no duplican asignaciones, entregas, caja, eventos ni archivos.

## 8. Plan recomendado

### Fase 0 — Certificación técnica

1. Obtener un volcado solo de esquema de producción.
2. Compararlo con las migraciones del repositorio.
3. Crear migración canónica y pruebas RLS por rol.
4. Añadir CI con lint, tipos, build y pruebas de RPC.

### Fase 1 — Unificar el núcleo operativo

1. Retirar una de las dos implementaciones de entrega.
2. Crear manifiesto consolidado multitienda.
3. Separar ruta de recogida y ruta de entrega.
4. Hacer atómica y auditable la corrección de dirección.

### Fase 2 — Comunicación y experiencia

1. Centralizar teléfonos y plantillas.
2. Registrar comunicaciones.
3. Implementar aprobaciones estructuradas del cliente.
4. Sustituir `alert`, `confirm` y `prompt` por flujos accesibles con estados claros.

### Fase 3 — Calidad y operación

1. Dejar ESLint en cero errores.
2. Añadir pruebas móviles, mala señal y concurrencia.
3. Crear tablero de excepciones: tienda pendiente, bulto discrepante, GPS no verificado, pago sin conciliar y efectivo vencido.
4. Medir tiempos por etapa, no solo tiempo total de entrega.

## 9. Criterio de salida a producción

La aplicación estará lista cuando el esquema desplegado sea reproducible, exista un solo camino por transición crítica, ningún pedido multitienda pueda salir incompleto, toda decisión del cliente quede estructurada, las correcciones GPS sean atómicas y auditables, el lint/CI esté aprobado y las quince pruebas anteriores pasen con roles reales de tienda, administración, shopper, rider y cliente.
