const { createClient } = require('@supabase/supabase-js');
const url = 'https://kjshjgatoatsknbvswft.supabase.co';
const key = 'sb_publishable_ilmEDfVn7-U_6M__lsPQhA_YEb02Ey0';
const supabase = createClient(url, key);

async function check() {
  const { data: clientes, error: errCli } = await supabase.from('ol_clientes').select('*');
  console.log("--- CLIENTES EN EL SISTEMA ---");
  if (errCli) {
    console.error("Error:", errCli);
  } else {
    console.log(JSON.stringify(clientes, null, 2));
  }
}
check();
