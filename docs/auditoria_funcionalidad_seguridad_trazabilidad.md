# Auditoría de funcionalidad, seguridad y trazabilidad

**Aplicación:** reparto-lacrayola  
**Fecha de revisión:** 17 de agosto de 2026  
**Alcance:** código y migraciones presentes en este repositorio. No se verificó el esquema desplegado en Supabase ni la configuración real del proyecto.

## 1. Resumen ejecutivo

La aplicación ya contiene controles valiosos: operaciones atómicas para compra y entrega, idempotencia mediante `request_id`, eventos de pedido, separación parcial de capacidades administrativas, comprobación SRI en servidor, conciliación bancaria con historial y evidencia privada mediante URLs firmadas.

Sin embargo, todavía no debe considerarse cerrada para producción de alto volumen. Los principales puntos de quiebre son:

1. **Exposición potencial de datos personales de pedidos:** algunas reglas tratan a cualquier usuario `authenticated` como personal de reparto. Como la base también sirve a la tienda, un cliente autenticado podría alcanzar pedidos confirmados o disponibles para entrega.
2. **Escritura demasiado amplia en Storage:** sobreviven políticas históricas que permiten a cualquier autenticado subir o actualizar objetos del bucket de comprobantes.
3. **Migraciones no deterministas:** múltiples archivos reemplazan las mismas funciones y cambian sus permisos. El caso más claro es `registrar_factura_compra_servidor`, concedida unas veces a `authenticated` y otras exclusivamente a `service_role`.
4. **Flujos paralelos y escrituras directas:** existen páginas antiguas y operaciones administrativas que modifican tablas desde el navegador, fuera de una única máquina de transiciones y sin evento obligatorio.
5. **Trazabilidad incompleta:** el historial cubre hitos importantes, pero no todas las correcciones, reasignaciones, cambios de ítems, accesos a evidencias ni comunicaciones con el cliente.
6. **Herramientas de prueba dentro de la aplicación:** `/test-bench` puede producir cambios destructivos y no debe estar disponible en producción.

La prioridad inmediata no es agregar más pantallas. Es consolidar permisos, migraciones y transiciones para que cada acción crítica tenga: autorización, validación de estado, transacción, idempotencia y evento inmutable.

## 2. Modelo funcional observado

El sistema coordina tres actores operativos principales:

- **Administrador y roles administrativos:** confirma pagos, asigna personal, valida facturas, concilia dinero y liquida colaboradores.
- **Shopper/comprador:** acepta o recibe una asignación, realiza picking, resuelve faltantes, compra, registra factura y entrega la custodia.
- **Repartidor/rider:** toma la custodia, inicia ruta, entrega, registra evidencia y conserva temporalmente el efectivo contra entrega.

La tabla `ol_pedidos` es correctamente la cabecera compartida con la tienda. No es necesario concentrar todos los estados en una sola columna. Sí es necesario definir una **máquina coordinadora** que valide las combinaciones permitidas entre:

- estado comercial del pedido;
- pago y conciliación;
- asignación y custodia;
- picking y compra;
- factura del proveedor;
- entrega y cobro;
- caja, depósitos y liquidación;
- factura final al cliente.

El problema no es tener varios estados especializados; el problema aparece cuando pueden cambiar independientemente y formar combinaciones imposibles, por ejemplo: pedido entregado sin entrega exitosa, factura registrada con picking pendiente, rider iniciando ruta sin transferencia de custodia o pago por transferencia entregado sin verificación.

## 3. Hallazgos críticos

### SEC-01 — El pool puede exponer pedidos de otros clientes

**Severidad:** crítica  
**Evidencia:** `migration_rls_fix_handoff.sql`, `migration_rls_fix_pool_anonimo.sql` y políticas que usan `rep_puede_ver_pedido`.

La función permite ver pedidos en estado `confirmado` a usuarios autenticados y también asignaciones `recolectado` sin rider. En una base compartida con la tienda, `authenticated` incluye clientes, no solamente administradores, shoppers y repartidores.

**Escenario:** un cliente crea una cuenta normal y consulta directamente Supabase. Podría leer pedidos ajenos, sus productos, dirección, teléfono, importes y eventos. Los eventos de pago contienen además referencia bancaria y banco dentro de JSON.

**Corrección obligatoria:**

- exigir `rep_mi_id() IS NOT NULL`, perfil activo/aprobado y rol operativo antes de mostrar cualquier pool;
- no entregar la fila completa de `ol_pedidos`; crear una vista o RPC de pool con los campos mínimos;
- mantener dirección exacta, teléfono, eventos y datos bancarios ocultos hasta que exista asignación legítima;
- crear políticas distintas para cliente propietario, personal asignado y pool operativo;
- probar las políticas con JWT de cliente, shopper, rider, supervisor, contador y administrador.

### SEC-02 — Políticas heredadas de Storage permiten escritura global

**Severidad:** crítica  
**Evidencia:** `migration_reseller_billing.sql`, `migration_rls_storage_comprobantes.sql`, `migration_storage_privado.sql`.

Convertir el bucket en privado y usar URLs firmadas mejora la lectura, pero no elimina políticas anteriores de `INSERT` y `UPDATE` concedidas a cualquier autenticado. Un cliente de la tienda podría consumir almacenamiento o reemplazar evidencias si conoce una ruta.

**Corrección obligatoria:**

- eliminar explícitamente todas las políticas históricas de lectura, inserción y actualización del bucket;
- reconstruirlas con nombres canónicos y condición por actor, pedido, asignación y tipo de evidencia;
- impedir `UPDATE`; usar objetos inmutables y registrar una nueva versión si hay corrección;
- generar la ruta de subida en servidor y validar MIME, extensión, tamaño y firma real del archivo;
- separar comprobantes, entregas, depósitos y firmas en buckets o prefijos con permisos propios;
- limitar también la lectura: un colaborador no debe ver evidencias de todos los pedidos.

### SEC-03 — Función SRI redefinida con permisos incompatibles

**Severidad:** crítica funcional  
**Evidencia:** `migration_factura_compra_servidor.sql`, `migration_excepciones_factura_compra.sql`, `migration_historial_eventos.sql`, `migration_prioridad2_fondo_compras.sql`, `migration_fondo_caja_chica_shopper.sql` y `/api/sri/registrar`.

La misma firma `registrar_factura_compra_servidor` se reemplaza repetidamente. Algunos archivos revocan `authenticated` y conceden solo `service_role`; otros vuelven a conceder `authenticated`. La API actualmente usa el cliente de sesión, no `createServiceClient()`.

**Impacto:** según el orden aplicado en la base, registrar una factura puede fallar por permisos o ejecutar una versión que perdió validaciones/eventos añadidos después. El repositorio no permite demostrar cuál es la definición real.

**Corrección obligatoria:** crear una migración canónica final que incluya todas las validaciones y una sola estrategia:

- opción recomendada: API autentica y autoriza al actor; cliente de servicio ejecuta una RPC privada cuya entrada se construye en servidor;
- alternativamente, RPC para `authenticated` que derive actor desde `auth.uid()` y nunca reciba IDs de actor confiables desde el cliente;
- agregar una prueba de esquema que compare definición, propietario, `proconfig` y privilegios de cada RPC crítica;
- adoptar migraciones versionadas y aplicadas por CLI, nunca archivos sueltos ejecutados manualmente.

### SEC-04 — `/test-bench` puede modificar datos reales

**Severidad:** crítica operativa  
**Evidencia:** ruta `app/test-bench`.

La pantalla contiene pruebas que intentan actualizar saldos, crear pedidos entregados y generar cuentas por cobrar. Aunque RLS bloquee parte de ellas, un administrador legítimo podría ejecutarlas en producción.

**Corrección obligatoria:** excluirla del build de producción o exigir simultáneamente entorno no productivo y autorización de superadministrador en servidor. Las pruebas deben usar una base aislada y datos desechables.

## 4. Hallazgos altos

### SEC-05 — Vinculación automática de cuentas por correo

`AuthContext` y las acciones de autenticación vinculan un usuario con `rep_repartidores` cuando coincide el correo. Además, el cliente y el servidor infieren el rol de manera diferente.

**Riesgo:** correo mal escrito, reciclado o compartido puede asociar una cuenta incorrecta; fallos parciales pueden dejar perfil y rol inconsistentes.

**Corrección:** invitación de un solo uso emitida por administrador, correo verificado, unicidad sobre correo normalizado y RPC transaccional. El rol debe existir en una sola fuente de verdad y nunca inferirse del vehículo.

### SEC-06 — Rutas API sin control homogéneo

- `proxy.ts` excluye `/api`; cada endpoint depende de implementar correctamente su autenticación.
- `/api/envio/calcular` es público, no limita frecuencia y no valida rangos geográficos completos.
- `/api/sri/comprobante` puede generar consultas externas costosas sin cuota por actor/pedido.
- varios endpoints devuelven mensajes crudos de Supabase, revelando detalles internos.
- `/api/login` duplica el inicio de sesión y amplía innecesariamente la superficie.

**Corrección:** middleware común para API, autorización por capacidad, rate limit por IP/usuario/pedido, límites de cuerpo y tiempos, errores públicos normalizados y eliminación de endpoints duplicados.

### SEC-07 — Procesamiento XML permisivo

`lib/sri.ts` configura `processEntities: true`.

**Riesgo:** expansión de entidades o consumo excesivo de recursos ante XML hostil o inesperado. Aunque el origen normal sea SRI, debe tratarse como entrada externa.

**Corrección:** desactivar entidades, imponer tamaño máximo a SOAP/XML, validar estructura y número de nodos, rechazar contenido inesperado y registrar solamente errores saneados.

### FUN-01 — Hay más de un camino para ejecutar la misma operación

Persisten rutas como `/repartidor/picking/[pedidoId]`, lógica extensa en `/repartidor`, y mutaciones directas desde `/asignaciones` y administración. Esto crea versiones paralelas del flujo.

**Punto de quiebre:** una pantalla nueva usa RPC atómica, mientras una pantalla antigua cambia tablas directamente y omite validaciones o eventos.

**Corrección:** inventariar y retirar rutas antiguas; toda transición crítica debe llamar a una única RPC/comando de dominio. Revocar permisos directos de `UPDATE/INSERT/DELETE` sobre tablas críticas cuando exista la RPC equivalente.

### FUN-02 — Navegación y capacidad real no coinciden

El sidebar filtra por nombres de rol y muestra todos los enlaces mientras `rol` todavía es nulo. Algunas pantallas aparecen para supervisor aunque la capacidad financiera posterior puede negarle la operación.

**Corrección:** obtener capacidades desde servidor, no replicar reglas por nombre de rol; no renderizar navegación sensible hasta resolverlas; cada página debe validar capacidad en servidor.

### SEC-08 — Reemplazo dinámico de políticas es frágil

`migration_rls_capacidades_completo.sql` modifica políticas existentes buscando texto como `rep_is_admin()`. El resultado depende del estado previo, del orden y de que la expresión coincida exactamente.

**Corrección:** una migración declarativa final debe hacer `DROP POLICY IF EXISTS` y recrear cada política con su expresión completa. Mantener una matriz tabla/operación/capacidad revisable.

## 5. Auditoría de trazabilidad

### Lo que está bien

- `rep_pedido_eventos` funciona como historial append-only y las escrituras directas están restringidas.
- muchas operaciones usan `request_id`, lo que reduce duplicados por doble clic o reintento.
- compra, pago, reverso de pago, entrega, handoff y factura del proveedor producen eventos.
- conciliación bancaria y reverso de depósitos ya tienen historiales específicos.
- la entrega guarda responsable, monto esperado/cobrado, coordenadas y evidencia.

### Vacíos de trazabilidad

No se encontró garantía uniforme de evento, dentro de la misma transacción, para:

- creación original del pedido en la aplicación de tienda;
- edición de dirección, GPS, referencia o teléfono;
- reasignación, cancelación o eliminación administrativa;
- cambio de shopper/rider y motivo del cambio;
- sustitución, agotado, cambio de cantidad/precio y aprobación del cliente;
- carga, reemplazo y acceso a fotografías, firmas y comprobantes;
- validación/rechazo con revisión versionada de una factura;
- cambios de usuario, rol, estado, comisión o fondo;
- mensajes y decisiones acordadas por WhatsApp;
- intentos fallidos de autorización y accesos denegados.

Algunos eventos usan `request_id = NULL`; por ello no tienen protección contra duplicación. El JSON de eventos mezcla datos operativos y financieros y hereda la visibilidad amplia del pedido.

### Modelo recomendado de evento

Cada comando crítico debe crear, en la misma transacción:

- `evento_id` y `request_id` únicos;
- pedido, asignación y entidad afectada;
- actor autenticado, perfil operativo, rol/capacidad efectiva;
- estado anterior y nuevo;
- motivo obligatorio en excepciones/correcciones;
- valores anteriores/nuevos para campos sensibles;
- fecha del servidor, IP/agent capturados en API cuando corresponda;
- referencia a evidencia inmutable, no URL pública;
- versión del comando o regla aplicada.

Conviene separar tres canales:

1. **timeline del cliente:** estados simples y mensajes sin información financiera interna;
2. **timeline operativo:** detalles para personal actualmente asignado;
3. **auditoría interna:** dinero, bancos, acciones administrativas y seguridad, solo para capacidades autorizadas.

Para evidencia forense adicional, los eventos pueden encadenarse con `hash_anterior` y `hash_evento`, y exportarse periódicamente a almacenamiento inmutable. Esto no sustituye backups ni logs de Supabase.

## 6. Matriz mínima de transiciones

| Transición | Actor permitido | Precondiciones esenciales | Escrituras atómicas | Evento obligatorio |
|---|---|---|---|---|
| Pedido recibido | tienda/sistema | pedido válido | pedido + ítems | `pedido_creado` |
| Pago confirmado | admin/contador | transferencia, envío calculado, importe conciliable | pedido + verificación | `pago_confirmado` |
| Shopper asignado | operación | pedido listo, shopper activo | asignación + pedido | `shopper_asignado` |
| Compra iniciada | shopper asignado | pago verificado si transferencia | asignación + pedido | `compra_iniciada` |
| Factura registrada | shopper asignado | picking resuelto, SRI/excepción válida, fondo disponible | factura + caja + estados | `factura_proveedor_registrada` |
| Custodia entregada | shopper/rider | token válido, ambos participantes correctos | handoff + asignación | `custodia_transferida` |
| Ruta iniciada | rider responsable | custodia aceptada, rider activo/no bloqueado | asignación + marca temporal | `ruta_iniciada` |
| Entrega exitosa | rider responsable | estado en ruta, evidencia, pago válido | pedido + entrega + caja/CxC | `entrega_exitosa` |
| Depósito confirmado | finanzas | saldo y evidencia válidos | depósito + caja + saldo | `deposito_confirmado` |
| Conciliación bancaria | finanzas | movimiento existente | marca + historial | `conciliacion_cambiada` |
| Liquidación | finanzas | período no superpuesto, movimientos abiertos | período + ledger | `liquidacion_cerrada` |

Toda transición debe bloquear la fila relevante con `FOR UPDATE`, validar el estado anterior y ser idempotente.

## 7. WhatsApp y trazabilidad de decisiones

WhatsApp es apropiado como canal complementario en Latinoamérica, especialmente para contactar al cliente y resolver ubicación o faltantes. No debe ser el sistema de registro de decisiones críticas.

Si el cliente aprueba una sustitución, diferencia de precio, cambio de dirección o entrega excepcional por WhatsApp, la aplicación debe registrar una acción estructurada: quién la cargó, cuándo, qué cambió, motivo y, si legalmente corresponde, evidencia o identificador del mensaje. Evitar copiar conversaciones completas con datos personales.

La recomendación es un canal propio básico dentro del pedido para decisiones y trazabilidad, con notificaciones o enlace hacia WhatsApp. Así WhatsApp facilita la comunicación, pero la verdad operativa permanece en la aplicación.

## 8. Plan de corrección para la IA de programación

### Prioridad 0 — antes de producción

1. Crear migración canónica que cierre SEC-01: cliente autenticado no puede leer ningún pedido ajeno, ítem, asignación o evento.
2. Eliminar y recrear todas las políticas de Storage; pruebas de subida/lectura por actor.
3. Consolidar `registrar_factura_compra_servidor` y todos sus `GRANT/REVOKE`; validar el esquema desplegado.
4. retirar `/test-bench` de producción.
5. crear pruebas automáticas de autorización con todos los roles y un cliente de tienda.

### Prioridad 1 — integridad funcional

6. Mover asignaciones, correcciones y administración de usuarios a RPC transaccionales con evento.
7. Eliminar flujos legacy y revocar mutación directa de tablas críticas.
8. Aplicar capacidades en servidor a páginas y APIs; corregir navegación.
9. Endurecer APIs y parser XML con rate limit, límites, validaciones y errores saneados.
10. Reemplazar vinculación por correo con invitaciones transaccionales.

### Prioridad 2 — trazabilidad completa

11. Implementar los eventos faltantes y separar visibilidad cliente/operación/auditoría.
12. Versionar evidencias y bloquear su sobrescritura.
13. Registrar decisiones tomadas por WhatsApp como acciones estructuradas.
14. Crear tablero de excepciones: estados imposibles, eventos faltantes, dinero sin conciliación y evidencias faltantes.
15. Añadir retención, respaldo, restauración probada y alertas de seguridad.

## 9. Pruebas de aceptación obligatorias

- Cliente A no puede consultar pedido, ítems, eventos ni evidencias del Cliente B.
- Cliente autenticado no puede ver el pool de `confirmado` o `recolectado`.
- Shopper no asignado no puede ver dirección completa ni registrar factura.
- Rider no puede tomar custodia sin handoff válido ni entregar sin estar en ruta.
- Supervisor no puede confirmar/conciliar/liquidar dinero si su capacidad no lo permite.
- Contador no puede reasignar personal por ser considerado genéricamente administrador.
- Doble clic/reintento conserva una sola entrega, factura, depósito y evento.
- Evidencia existente no puede ser sobrescrita por ningún cliente o colaborador.
- Factura SRI se registra igual en una base recién creada y en una actualizada.
- Cualquier corrección sensible exige motivo y conserva valor anterior/nuevo.
- Un pago por transferencia no llega a entrega sin pago confirmado.
- Un pedido contra entrega genera caja/CxC y no puede liquidarse dos veces.

## 10. Criterio de cierre

La auditoría se considera atendida cuando existe una migración final reproducible, el CI levanta una base vacía, aplica todas las migraciones, ejecuta la matriz de roles y verifica las transiciones completas de transferencia y contra entrega. Revisar solamente la interfaz no demuestra seguridad: la validación debe hacerse llamando directamente a Supabase y a las APIs con cada identidad.

## 11. Limitaciones

Este informe es una auditoría estática del repositorio, no una certificación de penetración. La prioridad real debe confirmarse inspeccionando `pg_policies`, privilegios de funciones, definición de RPC, buckets y variables del entorno desplegado. También faltaría probar la aplicación de tienda, porque allí nace el pedido y se autentica el cliente.
