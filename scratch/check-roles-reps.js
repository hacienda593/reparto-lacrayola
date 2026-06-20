const { createClient } = require('@supabase/supabase-js');

const url = 'https://kjshjgatoatsknbvswft.supabase.co';
const key = 'sb_publishable_ilmEDfVn7-U_6M__lsPQhA_YEb02Ey0';
const supabase = createClient(url, key);

async function test() {
  console.log("1. Querying rep_roles...");
  try {
    const { data: roles, error: errRoles } = await supabase
      .from('rep_roles')
      .select('*');
    if (errRoles) console.error("Error rep_roles:", errRoles);
    else console.log("rep_roles:", roles);
  } catch (e) {
    console.error("Exception rep_roles:", e);
  }

  console.log("\n2. Querying rep_repartidores (all columns)...");
  try {
    const { data: reps, error: errReps } = await supabase
      .from('rep_repartidores')
      .select('*');
    if (errReps) console.error("Error rep_repartidores:", errReps);
    else console.log("rep_repartidores:", reps);
  } catch (e) {
    console.error("Exception rep_repartidores:", e);
  }
}

test();
