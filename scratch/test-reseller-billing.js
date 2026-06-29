const { createClient } = require('@supabase/supabase-js');
const url = 'https://kjshjgatoatsknbvswft.supabase.co';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_ilmEDfVn7-U_6M__lsPQhA_YEb02Ey0';
const supabase = createClient(url, key);

async function testBillingUpdate() {
  console.log("=== SIMULACIÓN DE ACTUALIZACIÓN RESELLER EN DB ===");

  // 1. Obtener el último pedido pendiente o preparado
  const { data: pedidos, error: errPed } = await supabase
    .from('ol_pedidos')
    .select('id, numero, notas')
    .limit(1);

  if (errPed || !pedidos || pedidos.length === 0) {
    console.error("No se pudo obtener ningún pedido de prueba:", errPed?.message || "Sin datos");
    return;
  }

  const pedidoTest = pedidos[0];
  console.log(`Pedido seleccionado para simulación: #${pedidoTest.numero} (ID: ${pedidoTest.id})`);

  // 2. Simulación de datos del repartidor en caja
  const payload = {
    prov_establecimiento: '002',
    prov_punto_emision: '005',
    prov_secuencial: '000012345',
    prov_costo_real: 24.50,
    prov_ruc: '1717067647001',
    prov_clave_acceso: '150620260117170676470012002005000012345876543211',
    prov_factura_url: 'https://supabase.co/storage/v1/object/public/comprobantes-proveedores/test.png'
  };

  console.log("Payload simulado a registrar:", payload);

  // Intentar una actualización de prueba (puede fallar si no se ha corrido la migración en Supabase)
  const { data: updated, error: errUpdate } = await supabase
    .from('ol_pedidos')
    .update(payload)
    .eq('id', pedidoTest.id)
    .select('id, numero, prov_establecimiento, prov_punto_emision, prov_secuencial, prov_costo_real');

  if (errUpdate) {
    console.log("\n[Resultado esperado si no has corrido la migración aún]:");
    console.warn("⚠️ Error al actualizar (posiblemente las columnas aún no existen en tu Supabase remoto):", errUpdate.message);
    console.log("👉 Por favor, ejecuta el archivo 'migration_reseller_billing.sql' en tu panel de Supabase para activar estas columnas.");
  } else {
    console.log("\n✅ ¡Actualización exitosa! Las columnas de facturación del proveedor están activas y mapeadas:");
    console.log(JSON.stringify(updated, null, 2));
  }
}

testBillingUpdate();
