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

  // Let's find an order that we can try to update
  console.log("Fetching one order...");
  const { data: orders, error: errOrders } = await supabase
    .from('ol_pedidos')
    .select('id, numero, estado')
    .limit(1);

  if (errOrders) {
    console.error("Failed to fetch order:", errOrders);
    return;
  }
  if (!orders || orders.length === 0) {
    console.log("No orders found.");
    return;
  }

  const order = orders[0];
  console.log(`Found order #${order.numero} with current state: ${order.estado}`);

  console.log(`Attempting to update order status to 'entregado' as authenticated user...`);
  const { data: updateData, error: updateErr } = await supabase
    .from('ol_pedidos')
    .update({ estado: 'entregado' })
    .eq('id', order.id)
    .select();

  if (updateErr) {
    console.error("Update failed:", updateErr);
  } else {
    console.log("Update succeeded! Data returned from DB:", updateData);
  }
}

test();
