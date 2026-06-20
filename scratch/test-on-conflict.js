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

  console.log("Attempting to upsert rep_roles with onConflict: 'user_id'...");
  const { data: roleData, error: roleErr } = await supabase
    .from('rep_roles')
    .upsert({ user_id: u.id, rol: 'repartidor', activo: true }, { onConflict: 'user_id' })
    .select();
  
  if (roleErr) {
    console.error("Failed to upsert rep_roles with onConflict:", roleErr);
  } else {
    console.log("Successfully upserted rep_roles with onConflict:", roleData);
  }
}

test();
