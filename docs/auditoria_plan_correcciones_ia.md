# Auditoría técnica y plan de correcciones para IA de programación

## Objetivo

Este documento contiene las instrucciones técnicas para corregir y endurecer la aplicación operativa `reparto-lacrayola`, preservando su compatibilidad con la aplicación de tienda que comparte la misma base de datos Supabase.

Las correcciones deben ejecutarse por fases, con migraciones nuevas, pruebas y validación de permisos por rol. No se debe intentar aplicar todo en un único cambio.

## Contexto obligatorio

Existen dos aplicaciones que comparten Supabase:

1. La tienda donde el cliente registra y consulta sus pedidos.
2. La aplicación operativa utilizada por administradores, shoppers y repartidores.

La tabla `ol_pedidos` es compartida. Su columna `estado` debe mantenerse como resumen del proceso visible para el cliente:

```text
pendiente -> confirmado -> preparado -> enviado -> entregado
```

No se debe eliminar ni sustituir esta columna. Los estados internos de pago, asignación, picking, factura, entrega y caja deben continuar separados porque representan dimensiones diferentes del pedido.

El problema que debe corregirse no es la existencia de varios estados, sino las transiciones independientes que pueden dejarlos desincronizados.

Ejemplos de dimensiones válidas:

- `ol_pedidos.estado`: resumen que ve el cliente.
- `ol_pedidos.pago_confirmado`: validación financiera del pago.
- `rep_asignaciones.estado`: responsabilidad y fase operativa.
- `rep_picking.estado`: resultado de cada producto.
- `ol_pedidos_comprobantes_proveedor.estado_revision`: revisión de factura de compra.
- `rep_entregas`: resultado y evidencia de entrega.
- `rep_facturas_cliente.estado`: facturación final al cliente.

## Reglas de trabajo para la IA

Antes de modificar código:

1. Inspeccionar el esquema real de la base de datos.
2. Revisar todas las migraciones existentes y determinar su orden.
3. No asumir que todas las migraciones del repositorio están aplicadas en producción.
4. Crear migraciones nuevas; no reescribir migraciones históricas ya ejecutadas.
5. Revisar las guías pertinentes de Next.js instaladas en `node_modules/next/dist/docs/` antes de cambiar código Next.js.
6. Rastrear todos los consumidores de las tablas y columnas compartidas.
7. Preservar compatibilidad con la aplicación de tienda.
8. No confiar en validaciones o permisos exclusivos del frontend.
9. Ejecutar en Postgres las operaciones que modifican varias entidades relacionadas.
10. Hacer idempotentes las operaciones críticas para soportar reintentos por mala conectividad.

---

# Fase 1: integridad y seguridad crítica

## 1. Separar permisos por capacidad

### Problema

La función `rep_is_admin()` considera administrativos a los roles:

```text
superadmin
admin
supervisor
contador
```

Muchas políticas RLS y funciones `SECURITY DEFINER` utilizan esta función para autorizar escritura. Como consecuencia, supervisor y contador pueden heredar permisos operativos o financieros excesivos.

Archivo relacionado:

```text
lib/supabase/migration_rls_seguridad_general.sql
```

### Implementación requerida

Mantener temporalmente `rep_is_admin()` por compatibilidad, pero crear capacidades específicas:

```sql
rep_tiene_rol(VARIADIC roles TEXT[])
rep_puede_gestionar_operacion()
rep_puede_confirmar_pago()
rep_puede_validar_factura_compra()
rep_puede_liquidar_caja()
rep_puede_administrar_usuarios()
rep_puede_ver_finanzas()
```

Matriz inicial propuesta:

| Capacidad | Superadmin | Admin | Supervisor | Contador |
|---|---:|---:|---:|---:|
| Ver operación | Sí | Sí | Sí | Sí |
| Asignar pedidos | Sí | Sí | Sí | No |
| Confirmar pagos | Sí | Sí | Según política del negocio | Sí |
| Validar factura de compra | Sí | Sí | No | Sí |
| Liquidar caja | Sí | Sí | No | Sí |
| Reversar liquidación | Sí | Sí | No | Sí |
| Administrar usuarios | Sí | No | No | No |
| Configuración crítica | Sí | No | No | No |

Aplicar las capacidades en:

- Políticas RLS.
- Funciones `SECURITY DEFINER`.
- Confirmación y reverso de pagos.
- Facturas de compra.
- Liquidaciones.
- Configuración.
- Administración de usuarios.
- Navegación y botones del frontend.

### Criterios de aceptación

- El contador no puede asignar, cancelar ni modificar pedidos.
- El supervisor no puede validar facturas ni liquidar dinero.
- Supabase rechaza las operaciones aunque se invoquen directamente fuera de la interfaz.
- Toda función `SECURITY DEFINER` tiene `SET search_path=public`.
- Se revoca ejecución a `PUBLIC` y se concede solamente a los roles necesarios.
- Se prueban permisos con un usuario real de cada rol.

## 2. Crear autoasignación atómica

### Problema

El shopper crea una fila en `rep_asignaciones` y después actualiza `ol_pedidos` mediante consultas independientes. Dos shoppers pueden competir por el mismo pedido o una operación puede fallar después de crear solamente una parte.

Código relacionado:

```text
app/repartidor/page.tsx
función aceptarPedido
```

### Implementación requerida

Crear una RPC:

```sql
aceptar_pedido_shopper(
    p_pedido_id UUID,
    p_request_id UUID
)
RETURNS rep_asignaciones
```

Debe:

1. Exigir sesión autenticada.
2. Obtener el colaborador mediante `rep_mi_id()`.
3. Comprobar que está activo, aprobado, conectado y no bloqueado.
4. Comprobar que su rol permite comprar.
5. Bloquear el pedido mediante `SELECT ... FOR UPDATE`.
6. Exigir `ol_pedidos.estado = 'confirmado'`.
7. Verificar el pago cuando el método lo requiera.
8. Confirmar que no existe otra asignación activa.
9. Insertar la asignación.
10. Registrar un evento de auditoría.
11. Ser idempotente mediante `p_request_id`.

Agregar un índice único parcial por pedido para impedir múltiples asignaciones activas. Antes de crearlo, diagnosticar y corregir duplicados históricos de forma controlada.

Ejemplo conceptual:

```sql
CREATE UNIQUE INDEX ...
ON rep_asignaciones(pedido_id)
WHERE estado NOT IN ('cancelado', 'devuelto');
```

### Frontend

Reemplazar el `insert()` y `update()` directos por una única llamada RPC.

### Criterios de aceptación

- Si dos shoppers aceptan simultáneamente, solamente uno obtiene el pedido.
- Un reintento con el mismo `request_id` devuelve el mismo resultado.
- Nunca queda una asignación creada con un pedido en estado incompatible.
- Los errores se muestran claramente y no dejan la interfaz en estado falso.

## 3. Centralizar el inicio de compra

Crear:

```sql
iniciar_compra_shopper(
    p_asignacion_id UUID,
    p_request_id UUID
)
```

Debe comprobar:

- El actor es el `shopper_id` responsable.
- La asignación está en estado `asignado`.
- La asignación no está cancelada, devuelta o entregada.
- El pago cumple las reglas del método seleccionado.
- El colaborador sigue activo y habilitado.

Debe actualizar en una transacción:

```text
rep_asignaciones.compra_iniciada_at = NOW()
ol_pedidos.estado = preparado
evento = compra_iniciada
```

Eliminar las actualizaciones independientes utilizadas actualmente.

## 4. Asegurar el final del picking y la compra

Crear:

```sql
finalizar_compra_shopper(
    p_asignacion_id UUID,
    p_request_id UUID
)
```

Precondiciones:

- El actor es el shopper responsable.
- Todos los ítems están resueltos.
- Ningún ítem permanece pendiente.
- Las sustituciones contienen producto, cantidad, precio y justificación.
- Los faltantes están justificados.
- Existen los comprobantes obligatorios por proveedor.
- El costo real no es negativo.
- La operación no fue finalizada anteriormente.

Resultado:

```text
rep_asignaciones.estado = recolectado
ol_pedidos.estado = preparado
evento = compra_finalizada
```

No cambiar `ol_pedidos.estado` a `enviado` hasta que un rider reciba formalmente la custodia.

## 5. Reemplazar el PIN inseguro de traspaso

### Problema

El PIN actual utiliza los últimos cuatro caracteres del UUID, no expira y el traspaso se realiza mediante actualizaciones directas.

Código relacionado:

```text
app/repartidor/escanear/page.tsx
```

### Implementación requerida

Crear una tabla `rep_handoffs` con al menos:

```text
id UUID
asignacion_id UUID
shopper_id UUID
rider_id UUID NULL
token_hash TEXT
codigo_visual VARCHAR(8)
estado TEXT
expires_at TIMESTAMPTZ
intentos INTEGER
created_at TIMESTAMPTZ
accepted_at TIMESTAMPTZ
shopper_lat NUMERIC
shopper_lng NUMERIC
rider_lat NUMERIC
rider_lng NUMERIC
request_id UUID
```

Estados:

```text
pendiente
aceptado
expirado
cancelado
```

Crear RPC:

```sql
crear_traspaso_shopper(p_asignacion_id UUID)
aceptar_traspaso_rider(
    p_token TEXT,
    p_request_id UUID,
    p_lat NUMERIC,
    p_lng NUMERIC
)
cancelar_traspaso_shopper(p_handoff_id UUID)
```

Requisitos:

- Token aleatorio de al menos 128 bits.
- Guardar únicamente su hash.
- Expiración de 5 a 10 minutos.
- Un solo uso.
- Límite de intentos.
- Bloqueo de fila con `FOR UPDATE`.
- La asignación debe continuar en `recolectado`.
- Shopper y rider deben estar activos.
- Dos riders no pueden aceptar el mismo pedido.
- Registrar actores, fecha y GPS cuando esté disponible.

Al aceptar debe actualizar atómicamente:

```text
rep_asignaciones.rider_id
rep_asignaciones.repartidor_id, solo si sigue siendo necesario por compatibilidad
rep_asignaciones.handoff_at
rep_asignaciones.estado = en_ruta
ol_pedidos.estado = enviado
evento = custodia_transferida
```

## 6. Eliminar caminos antiguos de entrega

### Problema

Existe una entrega segura mediante `finalizar_entrega_atomica`, pero permanece código que modifica por separado pedido, asignación, entrega, cuenta por cobrar y caja.

Código relacionado:

```text
app/repartidor/page.tsx
funciones antiguas de entrega
```

### Implementación requerida

- Encontrar todos los lugares que escriben `estado='entregado'`.
- Mantener una sola operación oficial: `finalizar_entrega_atomica`.
- Eliminar funciones antiguas o impedir completamente su invocación.
- Hacer que todas las pantallas utilicen el mismo servicio.
- Prohibir por RLS que shoppers o riders actualicen directamente un pedido a `entregado`.
- Prohibir inserciones manuales que dupliquen `rep_entregas`, `rep_cuentas_cobrar` o `rep_transacciones_caja`.

### Reforzar la RPC

Debe validar:

- Estado anterior permitido: `en_ruta`.
- Actor responsable de la custodia.
- Evidencia fotográfica privada.
- Firma, OTP u otra evidencia definida por configuración.
- Diferencia entre monto esperado y monto cobrado.
- Transferencia previamente confirmada.
- Una sola entrega exitosa por pedido.
- Idempotencia por `request_id`.

Agregar un índice único parcial:

```sql
CREATE UNIQUE INDEX ...
ON rep_entregas(pedido_id)
WHERE exitosa = true;
```

## 7. Confirmación de pagos atómica y auditable

Crear:

```sql
confirmar_pago_admin(
    p_pedido_id UUID,
    p_referencia TEXT,
    p_monto NUMERIC,
    p_banco TEXT,
    p_fecha TIMESTAMPTZ,
    p_evidencia_path TEXT,
    p_request_id UUID
)

revertir_pago_admin(
    p_pedido_id UUID,
    p_motivo TEXT,
    p_request_id UUID
)
```

Debe:

- Validar la capacidad específica del actor.
- Bloquear el pedido.
- Impedir referencias duplicadas.
- Registrar actor, fecha, banco, monto y evidencia.
- Actualizar `pago_confirmado`.
- Mantener historial inmutable.
- No borrar la referencia al revertir.
- Exigir motivo para todo reverso.
- Ser idempotente.

Reemplazar las actualizaciones directas de `pago_confirmado` en `app/asignaciones/page.tsx`.

---

# Fase 2: factura de compra y SRI

## 8. Mover la persistencia SRI al servidor

### Problema

El servidor consulta el SRI, pero el navegador recibe los datos y posteriormente envía a Supabase el XML, hash, receptor, emisor y totales. Estos valores no deben considerarse confiables.

Archivos relacionados:

```text
app/api/sri/comprobante/route.ts
app/caja/[id]/page.tsx
lib/sri.ts
lib/supabase/migration_facturas_compra_sri_xml.sql
```

### Implementación requerida

Crear un endpoint server-side que reciba únicamente datos originados por el operador:

```json
{
  "asignacionId": "uuid",
  "claveAcceso": "49 dígitos",
  "montoDigitado": 0,
  "metodoPago": "...",
  "comprobanteFotoPath": "..."
}
```

El servidor debe:

1. Autenticar al usuario.
2. Verificar que sea el shopper asignado o un administrativo autorizado.
3. Consultar directamente al SRI.
4. Validar los 49 dígitos y módulo 11.
5. Exigir estado `AUTORIZADO`.
6. Exigir ambiente de producción.
7. Validar la identificación del comprador contra el RUC configurado de La Crayola.
8. Recalcular SHA-256 en el servidor.
9. Verificar que la clave consultada corresponda con la devuelta por el XML.
10. Comparar total XML, monto digitado y total real de ítems.
11. Persistir todos los datos mediante una operación de servidor o RPC segura.
12. No aceptar XML, hash, emisor, receptor ni totales provenientes del navegador.

### Reforzar la función administrativa

`actualizar_factura_compra_sri_admin()` no debe confiar en `p_hash`. Como mínimo, el hash debe recalcularse en un entorno confiable y compararse con el XML.

Preferiblemente, el frontend no debe enviar ninguno de los campos derivados del XML.

### Restricciones adicionales

Agregar validaciones compatibles con los datos históricos:

```text
sri_xml_sha256: exactamente 64 caracteres hexadecimales
sri_total >= 0
sri_subtotal >= 0
sri_iva >= 0
conciliacion_diferencias debe ser un array JSON
```

Consistencia requerida:

```text
conciliacion_estado = coincide -> conciliacion_diferencias vacío
conciliacion_estado = con_diferencia -> conciliacion_diferencias no vacío
```

No permitir validar una factura cuando:

- No está autorizada.
- Pertenece al ambiente de pruebas.
- El comprador no es La Crayola.
- El hash no coincide.
- La clave de acceso está duplicada.

Si un administrativo acepta una diferencia, exigir motivo explícito y registrar quién la autorizó.

## 9. Separar registro y validación de factura

El shopper registra el comprobante, pero no debe validarlo.

Guardar:

```text
registrada_por
registrada_at
revisada_por
revisada_at
estado_revision
motivo_revision
```

Aplicar separación de funciones, al menos para importes superiores a un umbral configurable:

```text
registrada_por != revisada_por
```

---

# Fase 3: privacidad y evidencias

## 10. Convertir almacenamiento a privado

Actualmente existen URLs públicas para facturas, fotografías y firmas.

Crear buckets privados separados:

```text
facturas-proveedor
evidencias-entrega
firmas-clientes
comprobantes-pago
```

Requisitos:

- Ninguna lectura pública.
- Subida solamente por el responsable autorizado.
- Lectura mediante URL firmada temporal.
- Validación de extensión, MIME y tamaño.
- Nombres de archivo aleatorios y no predecibles.
- Guardar `storage_path`, no URL pública permanente.
- Políticas distintas por tipo de evidencia.
- Los riders solo ven evidencias de pedidos asignados.
- Administración y contabilidad acceden según capacidad.
- Definir retención de firmas, fotos y ubicación.

Actualizar todos los usos de `getPublicUrl()` para utilizar URLs firmadas.

---

# Fase 4: coordinación de estados

## 11. Mantener estados separados y validar sus transiciones

No crear una sola columna para todo el proceso.

Transiciones del resumen compartido `ol_pedidos.estado`:

```text
pendiente -> confirmado
confirmado -> preparado
preparado -> enviado
enviado -> entregado
```

Excepciones controladas:

```text
pendiente/confirmado -> cancelado
enviado -> proceso interno de entrega fallida o devolución
```

Relaciones mínimas:

| Cambio de `ol_pedidos` | Precondición |
|---|---|
| `confirmado` | Pago válido o pago contraentrega permitido |
| `preparado` | Shopper asignado y compra iniciada |
| `enviado` | Picking terminado, comprobante registrado y rider con custodia |
| `entregado` | Entrega exitosa creada mediante RPC |

Agregar funciones de dominio y triggers defensivos para impedir estados imposibles, incluso si alguien intenta escribir directamente en Supabase.

No impedir que la aplicación de tienda lea `ol_pedidos.estado` ni cambiar los valores que actualmente interpreta.

## 12. Crear historial inmutable de eventos

Crear una tabla `rep_pedido_eventos`:

```text
id UUID
pedido_id UUID
asignacion_id UUID NULL
tipo TEXT
actor_user_id UUID NULL
actor_repartidor_id UUID NULL
datos JSONB
request_id UUID
created_at TIMESTAMPTZ
```

Eventos iniciales:

```text
pedido_confirmado
pago_confirmado
pago_revertido
shopper_asignado
compra_iniciada
item_faltante
sustitucion_solicitada
sustitucion_aprobada
compra_finalizada
factura_proveedor_registrada
factura_proveedor_validada
handoff_creado
custodia_transferida
ruta_iniciada
entrega_exitosa
entrega_fallida
efectivo_registrado
liquidacion_realizada
factura_cliente_emitida
```

Reglas:

- Solo insertar; no actualizar ni eliminar desde el frontend.
- `request_id` único para operaciones idempotentes.
- Almacenar la mínima información sensible posible.
- Utilizar los eventos para auditoría, Control 360 y timeline.
- La vista del cliente debe filtrar eventos internos o financieros sensibles.

---

# Fase 5: comunicación con el cliente

## 13. Estrategia híbrida con WhatsApp

No abandonar WhatsApp y no construir inicialmente un chat completo.

WhatsApp debe seguir siendo el canal de alcance. La aplicación debe convertirse en la fuente oficial de verdad para aprobaciones, cambios de precio, sustituciones e incidencias.

Crear `rep_comunicaciones` con al menos:

```text
pedido_id
evento_id
canal
destinatario
plantilla
estado
provider_message_id
enviado_at
entregado_at
leido_at
error
created_at
```

Canales iniciales:

```text
whatsapp_manual
whatsapp_api
notificacion_interna
email
```

Mientras se utilizan enlaces `wa.me`:

- Registrar `whatsapp_manual_solicitado`.
- No marcarlo como enviado o entregado porque abrir el enlace no demuestra que se mandó el mensaje.
- Centralizar plantillas y formato de teléfonos.
- Evitar mensajes diferentes entre pantallas.
- Utilizar el número corporativo cuando sea posible.
- No exponer números personales de shoppers o riders.

Una fase posterior puede integrar WhatsApp Business Platform/Cloud API para bandeja multiagente, webhooks y trazabilidad.

## 14. Aprobaciones estructuradas del cliente

Crear una página de seguimiento segura, sin exigir instalación, para:

- Aprobar una sustitución.
- Rechazar una sustitución.
- Aceptar una variación de precio.
- Corregir ubicación.
- Confirmar disponibilidad para recibir.
- Reportar un problema.

Usar un token temporal y limitado al pedido o acción. WhatsApp debe enviar un enlace hacia esa página.

No depender de interpretar manualmente conversaciones para saber si una sustitución fue autorizada.

---

# Fase 6: limpieza técnica

## 15. Unificar implementaciones duplicadas

Revisar y retirar:

- La ruta antigua `/repartidor/picking/[pedidoId]` si ya no tiene consumidores.
- Funciones antiguas de entrega.
- Actualizaciones directas a estados protegidos.
- Escrituras duplicadas en caja.
- Lógica duplicada para formatear teléfonos.
- Plantillas de WhatsApp duplicadas.
- Uso simultáneo de `rep_picking` y campos de picking en `ol_pedido_items` sin una fuente oficial documentada.

Elegir y documentar una fuente de verdad para cada dato.

## 16. Dividir páginas grandes

Separar archivos extensos en:

- Componentes visuales.
- Hooks de lectura y actualización.
- Servicios de aplicación.
- Validadores.
- Tipos.
- Plantillas de comunicación.
- Acciones RPC.

La lógica financiera y de transición debe permanecer protegida en Postgres, aunque también exista una abstracción en TypeScript.

## 17. Manejo de errores

- Verificar el resultado de todas las consultas Supabase.
- No continuar con pasos posteriores si una operación falla.
- Mostrar mensajes accionables al operador.
- Registrar errores técnicos sin exponer información sensible.
- Eliminar `catch {}` vacíos en autenticación, vinculación y operaciones críticas.
- Evitar que la interfaz muestre éxito antes de recibir confirmación del servidor.

---

# Pruebas mínimas obligatorias

Implementar pruebas para los siguientes escenarios:

1. Dos shoppers intentan aceptar el mismo pedido simultáneamente.
2. El teléfono repite la aceptación por mala señal.
3. Un shopper bloqueado intenta aceptar un pedido.
4. Un shopper no asignado intenta iniciar una compra.
5. Se intenta finalizar picking con productos pendientes.
6. Un rider intenta aceptar un traspaso expirado.
7. Dos riders escanean el mismo QR.
8. Un shopper intenta registrar una factura de otro pedido.
9. El XML está autorizado para un comprador diferente.
10. El XML pertenece al ambiente de pruebas.
11. El hash del XML fue manipulado.
12. La clave de acceso ya existe.
13. Un contador intenta asignar un pedido.
14. Un supervisor intenta liquidar caja.
15. Una entrega en efectivo no tiene monto.
16. Una entrega no tiene evidencia.
17. Una transferencia no está confirmada.
18. Se intenta finalizar dos veces la misma entrega.
19. Se intenta marcar un pedido entregado sin `rep_entregas.exitosa=true`.
20. Falla la red después de subir archivos, antes de cerrar la entrega.
21. Se repite una RPC crítica con el mismo `request_id`.
22. Un usuario anónimo intenta acceder a facturas, firmas o teléfonos.
23. Un rider intenta consultar evidencia de un pedido ajeno.
24. La aplicación de tienda continúa leyendo correctamente `ol_pedidos.estado`.
25. Control 360 no muestra estados contradictorios después de cada transición.

---

# Orden obligatorio de implementación

1. Crear pruebas de caracterización del comportamiento actual.
2. Documentar el esquema real y el orden de migraciones aplicado.
3. Crear matriz de capacidades y corregir permisos.
4. Implementar autoasignación atómica.
5. Implementar inicio y final de compra atómicos.
6. Implementar traspaso seguro.
7. Eliminar la entrega antigua y reforzar la RPC oficial.
8. Implementar confirmación y reverso de pago atómicos.
9. Mover consulta y persistencia SRI completamente al servidor.
10. Convertir almacenamiento de evidencias a privado.
11. Agregar historial de eventos.
12. Agregar registro de comunicaciones y aprobaciones estructuradas.
13. Retirar rutas y lógica duplicadas.
14. Ejecutar pruebas integrales con ambas aplicaciones.

Cada fase debe entregar:

- Migración SQL nueva.
- Diagnóstico previo de datos históricos.
- Cambios de frontend necesarios.
- Pruebas automatizadas.
- Pruebas RLS por rol.
- Variables de entorno requeridas.
- Instrucciones de despliegue.
- Estrategia de rollback o recuperación.
- Explicación de compatibilidad con la tienda.

---

# Criterio general de finalización

El trabajo estará terminado cuando:

1. No existan caminos directos alternativos para aceptar, comprar, transferir custodia o entregar.
2. Las operaciones críticas sean transaccionales e idempotentes.
3. Los permisos se validen en Supabase por capacidad.
4. Facturas, firmas y evidencias no sean públicas.
5. Los datos del SRI almacenados provengan exclusivamente de código servidor confiable.
6. Los estados internos puedan ser diferentes, pero no contradictorios.
7. `ol_pedidos.estado` mantenga compatibilidad con el seguimiento de la tienda.
8. Cada transición importante produzca un evento auditable.
9. Las pruebas de concurrencia, reintentos, RLS y privacidad estén aprobadas.
10. Control 360 muestre una cadena consistente desde pago hasta facturación.

## Instrucción final para la IA de programación

> No cambies estados, tablas compartidas ni políticas existentes sin rastrear primero todos sus consumidores en ambas aplicaciones. No confíes en controles del frontend para seguridad. Todas las operaciones que cambien simultáneamente pedido, asignación, pago, entrega, factura o caja deben ejecutarse en una única transacción de Postgres y ser idempotentes. Antes de cada fase presenta los archivos afectados, riesgos de compatibilidad y criterios de aceptación. Implementa y verifica una fase antes de comenzar la siguiente.
