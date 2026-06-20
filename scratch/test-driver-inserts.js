const { createClient } = require('@supabase/supabase-js');
const url = 'https://kjshjgatoatsknbvswft.supabase.co';
const key = 'sb_publishable_ilmEDfVn7-U_6M__lsPQhA_YEb02Ey0';
const supabase = createClient(url, key);

async function test() {
  console.log("Logging in as repartidor1@test.com...");
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'repartidor1@test.com',
    password: 'adminlacrayola'
  });

  if (authErr) {
    console.error("Auth login failed:", authErr);
    return;
  }
  const u = authData.user;
  console.log("Logged in successfully! User UID:", u.id);

  console.log("Fetching driver details...");
  const { data: rep } = await supabase.from('rep_repartidores').select('id').eq('user_id', u.id).single();
  if (!rep) {
    console.log("Repartidor not found.");
    return;
  }

  const tempAsigId = '174213fe-4382-49fd-8d31-fee412f8fb30';
  const tempPedidoId = '44bfb645-6062-4353-8ef1-b6278588856a';

  console.log("1. Testing insert into rep_entregas...");
  const { data: entregaData, error: entregaErr } = await supabase
    .from('rep_entregas')
    .insert({
      asignacion_id: tempAsigId,
      repartidor_id: rep.id,
      pedido_id: tempPedidoId,
      salida_at: new Date().toISOString(),
      entregado_at: new Date().toISOString(),
      monto_cobrado: 10.00,
      metodo_pago: 'efectivo',
      exitosa: true,
      notas: 'Prueba de inserción RLS'
    })
    .select();

  if (entregaErr) {
    console.error("Insert into rep_entregas failed:", entregaErr);
  } else {
    console.log("Insert into rep_entregas succeeded:", entregaData);
  }

  console.log("\n2. Testing insert into rep_cuentas_cobrar...");
  const { data: cobroData, error: cobroErr } = await supabase
    .from('rep_cuentas_cobrar')
    .insert({
      pedido_id: tempPedidoId,
      asignacion_id: tempAsigId,
      repartidor_id: rep.id,
      monto_pedido: 10.00,
      monto_cobrado: 10.00,
      metodo_pago: 'efectivo',
      estado: 'cobrado',
      cobrado_at: new Date().toISOString()
    })
    .select();

  if (cobroErr) {
    console.error("Insert into rep_cuentas_cobrar failed:", cobroErr);
  } else {
    console.log("Insert into rep_cuentas_cobrar succeeded:", cobroData);
  }
}

test();
