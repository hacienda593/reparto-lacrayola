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

  console.log("1. Attempting to upsert rep_roles as authenticated user...");
  const { data: roleData, error: roleErr } = await supabase
    .from('rep_roles')
    .upsert({ user_id: u.id, rol: 'repartidor', activo: true })
    .select();
  
  if (roleErr) {
    console.error("Failed to upsert rep_roles:", roleErr);
  } else {
    console.log("Successfully upserted rep_roles:", roleData);
  }

  console.log("\n2. Attempting to update rep_repartidores user_id as authenticated user...");
  const { data: repData, error: repErr } = await supabase
    .from('rep_repartidores')
    .update({ user_id: u.id })
    .eq('email', u.email)
    .select();

  if (repErr) {
    console.error("Failed to update rep_repartidores:", repErr);
  } else {
    console.log("Successfully updated rep_repartidores:", repData);
  }
}

test();
