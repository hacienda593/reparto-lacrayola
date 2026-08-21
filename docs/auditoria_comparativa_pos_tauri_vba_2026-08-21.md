# Auditoría comparativa de POS_TAURI y sistema VBA legado

**Fecha:** 21 de agosto de 2026  
**Sistemas revisados:**

- `C:\Users\hacienda\Documents\GitHub\POS_TAURI`
- `C:\Users\hacienda\Desktop\PROYECTO VB MIGRACION ORIGINAL`
- `C:\monica11`, únicamente como referencia estática de alcance funcional

## 1. Alcance y limitaciones

Se revisó el código React/TypeScript, backend Rust/Tauri, SQL versionado, estructura del sistema VBA y artefactos visibles de Mónica 11. Se compiló POS_TAURI con éxito mediante `npm run build` y `cargo check`.

No se ejecutaron ventas reales, no se alteró la base PostgreSQL compartida y no se abrió Mónica. Tampoco se verificaron certificados, autorizaciones del SRI, datos productivos, políticas contables particulares de cada empresa ni declaraciones presentadas. Esta es una auditoría técnica-funcional; la certificación tributaria y contable final requiere contador y asesor tributario ecuatoriano.

## 2. Dictamen ejecutivo

El proyecto tiene más valor que una simple migración tecnológica. El VBA contiene cinco años de conocimiento operativo real y POS_TAURI ya reproduce una parte considerable: ventas, clientes, precios, crédito, inventario, compras por XML, cajas por cajero, bancos, corresponsal no bancario y una base inicial de parametrización contable.

Sin embargo, POS_TAURI aún no debe reemplazar al VBA como sistema contable/fiscal principal. Puede operar como piloto controlado de POS, pero existen riesgos críticos en autenticación, separación de empresas, asignación de cajas, validación servidor de ventas, inventario, secuenciales, envío al SRI y trazabilidad contable.

La arquitectura adecuada no es “copiar todas las macros”. Debe conservar las reglas de negocio validadas del VBA y reemplazar sus debilidades por un núcleo transaccional, multiempresa, auditable y orientado a eventos contables.

**Valoración aproximada actual:**

| Área | Madurez estimada |
|---|---:|
| Experiencia POS/ventas | 75 % |
| Cuentas por cobrar | 65 % |
| Inventario y compras | 60 % |
| Caja separada por cajero | 55 % |
| Bancos y cheques | 45 % |
| Multiempresa real | 30 % |
| Facturación electrónica 2026 | 25 % |
| Contabilidad de doble partida | 15 % |
| Seguridad y auditoría | 20 % |
| Preparación para nube | 25 % |

## 3. Fortalezas que deben conservarse

### Del sistema VBA

- Cobertura funcional nacida de operación real, no de un diseño teórico.
- Facturación, caja, crédito, inventario, impresión, notas de crédito, guías, retenciones, liquidaciones, reportes y respaldos.
- Manejo histórico de varias empresas y establecimientos.
- Gran cantidad de excepciones comerciales resueltas durante cinco años.
- Formularios y atajos diseñados para velocidad de caja.

### De POS_TAURI

- Aplicación de escritorio moderna y compilable.
- Backend Rust separado de la interfaz y acceso parametrizado mediante SQLx.
- Transacción PostgreSQL para partes importantes de ventas, CxC y bancos.
- Bloqueo de secuencial electrónico con `FOR UPDATE`.
- Interfaz POS rica: búsqueda, códigos, precios por clase, crédito, múltiples medios de pago y notas de crédito.
- Importación XML de compras e integración con inventario.
- Sesiones de caja y arqueo por usuario, establecimiento y punto de emisión.
- Inicio de módulos de bancos, cheques, CNB y amarres contables.

## 4. Hallazgos críticos

### CRIT-01 — Autenticación comprometida por accesos maestros

`verificar_credenciales` permite ingresar si la clave almacenada es `*********`, si cualquier usuario escribe `admin`, o mediante un usuario/clave especial codificado. Las claves se comparan como texto.

**Impacto:** cualquier persona que conozca el bypass puede suplantar cajeros o administradores. Todos los comandos Tauri quedan disponibles después porque el backend no conserva una sesión autenticada ni verifica permisos por comando.

**Corrección:**

1. Eliminar todos los bypass.
2. Migrar claves a Argon2id con sal única por usuario.
3. Crear sesión backend con identificador aleatorio y caducidad.
4. Autorizar cada comando por rol/capacidad y empresa/establecimiento.
5. Registrar intentos fallidos, bloqueo gradual y cambios de clave.

### CRIT-02 — Credenciales PostgreSQL dentro del ejecutable

Si falta `DATABASE_URL`, el backend usa una URL PostgreSQL con usuario y contraseña codificados. Una aplicación Tauri distribuida al cajero puede ser inspeccionada; una contraseña embebida nunca es secreta.

**Impacto:** acceso directo a toda la base, omisión de permisos de la aplicación y riesgo sobre todas las empresas.

**Corrección recomendada:** para escritorio local, usar un servicio backend local con credenciales protegidas y cuentas DB de mínimo privilegio; para nube, API central con TLS. El cliente Tauri no debe conectarse con una cuenta PostgreSQL con permisos amplios.

### CRIT-03 — La empresa seleccionada no es la empresa operada

La interfaz permite elegir empresa y establecimiento, pero `registrar_venta_db` obtiene el RUC mediante `SELECT ruc FROM parametros LIMIT 1`. Varios comandos reciben `ruc_empresa` y no lo usan; catálogos bancarios y consultas carecen de filtro consistente.

**Impacto:** una venta puede emitirse, afectar inventario, banco o caja de otra empresa. Este riesgo aumenta porque todas comparten base.

**Corrección:** crear un `TenantContext` backend inmutable por sesión: `empresa_id/ruc`, `establecimiento`, `punto_emision`, `usuario_id`, `caja_sesion_id` y capacidades. Ningún comando financiero debe recibir esos valores confiando en el frontend ni usar `LIMIT 1`.

### CRIT-04 — La mejora de cajas separadas puede volver a caja compartida

La venta busca la caja abierta del vendedor y establecimiento. Si no encuentra una, toma la última sesión abierta de cualquier usuario; si tampoco encuentra, usa `1`.

**Impacto:** ventas de un cajero terminan en la caja de otro. El sistema reproduce el defecto que debía corregir y vuelve imposible responsabilizar arqueos.

**Corrección:** una venta debe fallar si no existe exactamente una sesión abierta válida para el usuario, empresa, establecimiento, punto de emisión y terminal. Prohibir fallback. Agregar restricción única parcial para una sesión abierta por combinación autorizada.

### CRIT-05 — Reglas decisivas de venta están solo en React

Límites de crédito, saldo vencido, suma de pagos, vuelto, descuentos y varias validaciones se ejecutan en `POS.tsx`. El backend acepta totales, impuestos y pagos enviados por la interfaz y no se encontró una reconciliación obligatoria `sum(pagos) = total`.

**Impacto:** errores, otra versión de la interfaz o una llamada manual a Tauri pueden crear ventas descuadradas, crédito fuera de cupo o impuestos inconsistentes.

**Corrección:** el backend debe recibir cantidades, códigos y decisiones autorizadas; luego bloquear productos/cliente/caja, consultar precios e impuestos vigentes, recalcular todo y rechazar diferencias.

### CRIT-06 — Stock puede fallar sin abortar la venta

El descuento de stock ignora el resultado con `let _ = ...`. No bloquea la fila, no exige existencia suficiente y filtra únicamente por código, sin empresa/bodega/establecimiento.

**Impacto:** factura confirmada sin movimiento de inventario, stock negativo, descuento en empresa equivocada y ventas concurrentes por encima de existencia.

**Corrección:** ledger de inventario inmutable y actualización condicionada dentro de la misma transacción. Fallar si no se afecta exactamente la fila esperada. Definir política explícita para permitir o prohibir inventario negativo.

### CRIT-07 — Facturación electrónica no completa el ciclo SRI

La venta genera XML local, pero no se encontró en el flujo principal firma XAdES, recepción, autorización, reintento, consulta de estado, almacenamiento del XML autorizado ni envío al cliente. El XML declara siempre producción, IVA 15 %, `obligadoContabilidad` en `NO` y un código numérico fijo.

Desde el 1 de enero de 2026 el SRI exige transmisión inmediata de comprobantes. Además, la autenticidad e integridad dependen de firma electrónica y autorización.

**Impacto:** una venta puede quedar `APROBADA` internamente sin ser un comprobante autorizado por el SRI.

**Corrección:** máquina de estados fiscal: `borrador → emitido → firmado → enviado → recibido → autorizado/rechazado`; cola persistente, reintentos, contingencia, XML/RIDE inmutables, correo y conciliación diaria contra SRI.

### CRIT-08 — Numeración manual con `MAX + 1`

Bancos, caja y corresponsal usan repetidamente `MAX(nro/consecutivo)+1`. Dos terminales pueden calcular el mismo valor.

**Impacto:** claves duplicadas, colisiones o movimientos rechazados a mitad de operación.

**Corrección:** secuencias PostgreSQL o tablas de folios bloqueadas por empresa/tipo/establecimiento. Mantener el `FOR UPDATE` ya usado para secuenciales SRI y eliminar el resto de `MAX + 1`.

## 5. Hallazgos altos

### ALT-01 — Saldos bancarios son acumuladores mutables

Se lee el saldo, se suma/resta en aplicación y luego se actualiza. Algunas consultas no bloquean la cuenta y no filtran por empresa. Una concurrencia puede perder movimientos.

**Modelo recomendado:** libro bancario inmutable; el saldo se deriva de movimientos conciliados o se mantiene mediante una proyección transaccional. Nunca seleccionar silenciosamente “la primera cuenta bancaria” si falta la cuenta de pago.

### ALT-02 — Compatibilidad legacy fuera de la transacción

La apertura/cierre actualiza tablas nuevas y luego intenta tablas VBA con errores ignorados. Esto preserva compatibilidad, pero puede dejar ambos sistemas viendo estados distintos.

**Corrección:** patrón de transición controlado: una fuente oficial, adaptadores de lectura para el legado, tabla de sincronización y tablero de discrepancias. No usar doble escritura silenciosa.

### ALT-03 — No hay libro diario ni motor de doble partida

El módulo contable actual administra plan de cuentas y amarres. No se observan asientos balanceados, períodos, mayorización, cierre, reversos, auxiliares ni estados financieros generados desde un ledger.

**Conclusión:** todavía es configuración contable, no contabilidad.

### ALT-04 — Uso de `FLOAT8/f64` para dinero

Dinero, impuestos, cuotas y saldos usan ampliamente coma flotante.

**Impacto:** diferencias acumuladas de centavos, especialmente en pagos parciales, IVA, retenciones y mayor contable.

**Corrección:** PostgreSQL `NUMERIC(18,6)` para cálculo y `NUMERIC(18,2)` donde corresponda; en Rust `Decimal`. Definir una única política de redondeo por impuesto y documento.

### ALT-05 — Escritura de XML en rutas fijas y errores ignorados

Se intenta guardar el mismo XML en `D:`, `C:` y ruta relativa. Los errores se descartan y el nombre incorpora texto del cliente con saneamiento parcial.

**Corrección:** repositorio documental administrado, hash SHA-256, ruta por empresa/año/mes/documento, resultado obligatorio, respaldo y cifrado. Conservar XML autorizado al menos durante el plazo legal aplicable; el SRI recuerda siete años para comprobantes electrónicos.

### ALT-06 — Monolitos difíciles de certificar

- `POS.tsx`: aproximadamente 7.100 líneas.
- `InvoiceImporter.tsx`: aproximadamente 4.000.
- `InventoryDashboard.tsx`: aproximadamente 3.400.
- `lib.rs`: aproximadamente 4.075.

**Impacto:** cambios fiscales y contables son difíciles de aislar, probar y revisar.

**Corrección:** modularizar por dominio y comando, no por pantalla: ventas, pagos, crédito, stock, documentos fiscales, caja, bancos y contabilidad.

### ALT-07 — No existe migración completa y reproducible de base

Solo se encontró una actualización SQL centrada en CxC, mientras el backend crea algunas tablas al arrancar y depende de muchas tablas legacy.

**Corrección:** adoptar migraciones versionadas, checksum, tabla de versión, respaldo previo y rollback/forward-fix. La aplicación no debe hacer `CREATE TABLE` o `ALTER TABLE` silencioso en operación normal.

### ALT-08 — CSP desactivada y apertura amplia de URL

Tauri tiene `csp: null` y permite abrir cualquier URL HTTP/HTTPS.

**Corrección:** CSP restrictiva, lista de dominios permitidos, validación de URLs y capacidades mínimas por ventana.

## 6. Matriz comparativa funcional

| Dominio | VBA | POS_TAURI | Brecha para reemplazo |
|---|---|---|---|
| Ventas POS | Muy maduro | Avanzado | Validaciones servidor, anulaciones, pruebas de concurrencia |
| Multiempresa | Operativo histórico | Selección visual parcial | Aislamiento backend obligatorio |
| Caja | Caja global histórica | Sesiones por cajero | Eliminar fallback y asegurar terminal/turno |
| CxC | Maduro | Cobros individual/masivo, cuotas | Ledger, reversos, conciliación y permisos |
| Inventario | Maduro | Catálogo, compras, combos, fracciones | Kardex, bodegas, costo y concurrencia |
| Compras | XML y procesos legacy | Importador XML avanzado | CxP, retenciones, recepción y costo completo |
| Bancos | Módulo existente | En desarrollo | Conciliación, bloqueo, empresa y ledger |
| Documentos SRI | Amplia cobertura VBA | Generación parcial de factura | Firma, envío, autorización, NC, retención, guía |
| Contabilidad | Funciones/reportes parciales | Plan y amarres | Motor completo de doble partida |
| Auditoría | Dispersa | Usuario en varias tablas | Bitácora inmutable y cadena de reversos |
| Nube | No nativo | Arquitectura todavía DB-directa | API, sincronización, observabilidad y seguridad |

## 7. Arquitectura objetivo “año 3000”

No significa usar tecnología exótica. Significa que cada hecho económico se registra una sola vez y todos los módulos se derivan de él.

```text
Tauri escritorio
     │ comandos autenticados
     ▼
API/núcleo de dominio
     ├── Ventas y documentos fiscales
     ├── Caja por cajero/terminal
     ├── CxC y CxP
     ├── Inventario/Kardex
     ├── Bancos y conciliación
     └── Motor contable
              │
              ▼
PostgreSQL multiempresa
     ├── transacciones + restricciones
     ├── eventos inmutables/outbox
     ├── documentos y evidencias
     └── auditoría
              │
              ├── SRI
              ├── correo/RIDE
              ├── respaldos
              └── futura nube
```

Para tolerar internet inestable, el escritorio puede mantener una cola local cifrada, pero los folios fiscales, cierres y sincronización deben tener protocolo explícito. “Offline” no puede significar dos terminales inventando el mismo secuencial.

## 8. Núcleo contable recomendado

### Entidades

- período contable;
- plan de cuentas versionado por empresa;
- asiento y líneas de asiento;
- auxiliares: cliente, proveedor, empleado, banco, caja, inventario;
- centro de costo, establecimiento y proyecto;
- documento origen y evento origen;
- moneda/tipo de cambio, aunque hoy la operación sea USD;
- lote, estado, aprobación, reverso y cierre.

### Reglas no negociables

1. Débitos = créditos en cada asiento.
2. No editar asientos contabilizados; se revierten.
3. Período cerrado no admite movimientos.
4. Toda línea pertenece a una empresa.
5. Cuentas de detalle solamente reciben movimientos.
6. CxC, CxP, bancos, caja e inventario cuadran contra el mayor.
7. Cada asiento conserva documento, actor, fecha real y fecha contable.
8. Los amarres se versionan; cambiar un amarre no reescribe historia.

### Asientos automáticos iniciales

**Venta al contado:**

- Débito: caja del cajero/banco/tarjeta por cobrar.
- Crédito: ventas por tarifa.
- Crédito: IVA en ventas.
- Débito: costo de ventas.
- Crédito: inventario.

**Venta a crédito:** sustituye caja por cuentas por cobrar.  
**Cobro:** débito caja/banco y crédito CxC.  
**Compra:** débito inventario/gasto e IVA crédito tributario; crédito CxP/banco/caja.  
**Retención:** separar cuentas tributarias según normativa y condición del contribuyente.

## 9. Cumplimiento ecuatoriano que debe convertirse en requisitos

- Comprobantes firmados, íntegros y autorizados según ficha técnica del SRI.
- Transmisión inmediata vigente desde el 1 de enero de 2026.
- Procedimiento vigente de anulación; desde agosto de 2025 existen reglas y aceptación del receptor para ciertos documentos.
- Entrega del XML y RIDE al receptor y conservación documental.
- Tarifas IVA, códigos y retenciones parametrizados por vigencia, nunca codificados permanentemente.
- Comprobantes de retención dentro del plazo y bajo reglas aplicables al contribuyente.
- Exportación y conciliación ATS con catálogos versionados.
- NIIF completas o NIIF para PYMES según clasificación y política de cada compañía.
- Estados financieros y auxiliares conciliables: situación financiera, resultados, cambios en patrimonio, flujos de efectivo y notas/datos de soporte.

La normativa cambia. Debe existir una tabla de reglas con `vigente_desde`, `vigente_hasta`, fuente oficial y versión de software, además de pruebas por fecha.

## 10. Estrategia segura de migración desde VBA

### Fase 0 — Congelar conocimiento, no el negocio

1. Inventariar formularios, reportes, XML y procesos VBA.
2. Entrevistar cajeros, administrador, bodeguero y contador.
3. Crear casos dorados con operaciones reales anonimizadas.
4. Clasificar cada función: migrar, rediseñar, conservar temporalmente o retirar.

### Fase 1 — Blindar POS_TAURI

1. Seguridad y sesiones backend.
2. Contexto multiempresa obligatorio.
3. Caja estricta por cajero/terminal.
4. Venta recalculada totalmente en servidor.
5. Kardex transaccional y dinero decimal.
6. Migraciones reproducibles y pruebas automáticas.

### Fase 2 — Paridad funcional controlada

1. Ejecutar VBA y Tauri en paralelo con escrituras controladas.
2. Comparar ventas, impuestos, stock, caja y CxC diariamente.
3. Resolver toda discrepancia; no “ajustar a mano” sin causa.
4. Migrar empresa por empresa y establecimiento por establecimiento.

### Fase 3 — Fiscal y contable

1. Ciclo SRI completo.
2. Compras, CxP y retenciones.
3. Motor contable y amarres versionados.
4. Conciliación bancaria.
5. ATS y estados financieros.
6. Validación formal con contador.

### Fase 4 — Nube

Solo después de estabilizar contratos y multiempresa: API central, autenticación moderna, cifrado, backups, telemetría, colas, resolución de conflictos y despliegue gradual.

## 11. Pruebas mínimas antes de reemplazar VBA

1. Dos cajeros venden simultáneamente sin cruzar caja ni secuencial.
2. Un usuario no puede operar otra empresa sin autorización.
3. No existe venta sin caja abierta propia.
4. Pagos deben cuadrar exactamente con total y vuelto.
5. El backend rechaza precio, IVA o descuento manipulados.
6. Dos terminales no pueden vender la última unidad simultáneamente.
7. Un fallo de stock revierte factura, caja, banco y CxC.
8. Una transferencia afecta la cuenta correcta, nunca “la primera”.
9. Una venta a crédito respeta cupo y mora en servidor.
10. Un abono repetido por reintento se registra una sola vez.
11. Anulación/reverso restaura módulos y produce asiento inverso.
12. XML firmado, enviado y autorizado concuerda con la venta.
13. Rechazo SRI queda en cola visible y no aparece como autorizado.
14. IVA y retenciones cambian correctamente según fecha de vigencia.
15. Kardex cuadra con existencia por empresa/bodega.
16. Caja, CxC, CxP, bancos e inventario cuadran con el mayor.
17. Un período cerrado rechaza movimientos retroactivos.
18. Restauración de respaldo se prueba en un equipo limpio.
19. El mismo conjunto de casos produce resultados equivalentes en VBA y Tauri.
20. El contador aprueba balances y anexos de una empresa piloto.

## 12. Indicadores para dirigir el proyecto

- diferencias diarias VBA vs Tauri;
- ventas sin autorización SRI después de cinco minutos;
- ventas sin caja válida;
- movimientos sin empresa o sin actor;
- stock negativo y kardex descuadrado;
- caja/CxC/bancos que no cuadran con contabilidad;
- operaciones con errores ignorados;
- tiempo promedio de venta y cierre;
- tasa de reintentos/duplicados;
- cobertura de pruebas por comando crítico;
- tiempo real de restauración de respaldo.

## 13. Prioridad inmediata para el equipo

Antes de añadir más pantallas contables:

1. Eliminar accesos maestros y credenciales embebidas.
2. Implementar contexto backend multiempresa y autorización.
3. Prohibir la caja fallback.
4. Recalcular ventas y pagos en Rust/PostgreSQL.
5. Hacer el stock obligatorio, bloqueado y trazable.
6. Sustituir `MAX + 1` y `f64` financiero.
7. Construir el ciclo SRI 2026 completo.
8. Definir ledger contable de doble partida con el contador.

Este orden protege el negocio actual. Construir diario, mayor y balances sobre ventas, cajas o inventarios no confiables solo automatizaría inconsistencias.

## 14. Fuentes normativas consultadas

- Servicio de Rentas Internas: facturación electrónica y base legal.
- Servicio de Rentas Internas: transmisión inmediata desde enero de 2026.
- Servicio de Rentas Internas: reglas de anulación vigentes desde agosto de 2025.
- Servicio de Rentas Internas: retenciones en la fuente.
- Servicio de Rentas Internas: ATS, catálogos y ficha técnica.
- Superintendencia de Compañías: instructivo de aplicación de NIIF completas y NIIF para PYMES.

Las fuentes deben revisarse nuevamente en cada liberación fiscal; esta auditoría no congela la normativa al 21 de agosto de 2026.
