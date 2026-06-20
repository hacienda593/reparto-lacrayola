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

  // Let's find one assignment for this driver
  console.log("Fetching driver's assignments...");
  const { data: reps } = await supabase.from('rep_repartidores').select('id').eq('user_id', u.id).single();
  
  if (!reps) {
    console.log("Repartidor not found.");
    return;
  }

  const { data: asigs, error: errAsig } = await supabase
    .from('rep_asignaciones')
    .select('id, estado')
    .eq('repartidor_id', reps.id)
    .limit(1);

  if (errAsig) {
    console.error("Failed to fetch assignments:", errAsig);
    return;
  }

  if (!asigs || asigs.length === 0) {
    console.log("No assignments found for this driver.");
    return;
  }

  const asig = asigs[0];
  console.log(`Found assignment ${asig.id} with current state: ${asig.estado}`);

  console.log("Attempting to update assignment state to 'entregado'...");
  const { data: updateData, error: updateErr } = await supabase
    .from('rep_asignaciones')
    .update({ estado: 'entregado' })
    .eq('id', asig.id)
    .select();

  if (updateErr) {
    console.error("Update failed:", updateErr);
  } else {
    console.log("Update succeeded! Data returned:", updateData);
  }
}

test();
