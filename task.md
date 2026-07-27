# Checklist de Tareas: Mejoras Operativas y Control Financiero (La Crayola)

- `[x]` **1. Base de Datos y Supabase Storage (SQL)**
  - `[x]` Crear script SQL `lib/supabase/migration_mejoras_operativas.sql` con la tabla `rep_facturas_compras` y las columnas adicionales.
  - `[x]` Ejecutar la migración SQL en el Dashboard de Supabase.
  - `[x]` Crear buckets de Supabase Storage para `facturas` y `entregas` (con políticas públicas de lectura si es necesario).

- `[x]` **2. Switch de Conexión y Turno Activo (Rider/Shopper)**
  - `[x]` Diseñar e implementar el control Toggle "ON Turno Activo / OFF Desconectado" en la cabecera móvil.
  - `[x]` Vincular el Toggle a la nueva columna `conectado` en `rep_repartidores` en tiempo real.
  - `[x]` Ocultar bandejas y mostrar tarjeta placeholder de desconexión si el usuario está offline.

- `[x]` **3. Picking Organizado por Pasillos (Shopper)**
  - `[x]` Agrupar los ítems de compra por sección/categoría en la pantalla de picking (`/picking/[id]`).
  - `[x]` Diseñar un contenedor colapsable con indicadores de avance por pasillo (ej. Lácteos, Carnes).

- `[x]` **4. Checkout de Facturación y Cierre de Caja (Shopper)**
  - `[x]` Diseñar el formulario/modal de checkout en `/picking/[id]` al completar la compra.
  - `[x]` Implementar campos: número factura SRI, total real, IVA y captura de foto de factura.
  - `[x]` Guardar la imagen de factura en Storage y guardar el registro de compra en `rep_facturas_compras`.
  - `[x]` Actualizar el estado de asignación a `recolectado` únicamente tras finalizar este checkout.

- `[x]` **5. Proof of Delivery: Firma y Foto (Rider)**
  - `[x]` Crear el componente de lienzo táctil de firma digital del cliente.
  - `[x]` Diseñar el modal de entrega en `app/repartidor/page.tsx` para obligar al repartidor a capturar la foto y la firma del cliente.
  - `[x]` Subir los archivos a Supabase Storage y guardar los enlaces y ubicación GPS de entrega en la asignación.

- `[x]` **6. Bloqueo por Exceso de Efectivo en Mano (Rider)**
  - `[x]` Programar el control de saldo de `efectivo_en_mano` comparándolo contra el límite de la configuración (ej. $100.00).
  - `[x]` Renderizar la pantalla de bloqueo total con advertencia administrativa en `/repartidor` si excede el límite.
