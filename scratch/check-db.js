const { createClient } = require('@supabase/supabase-js');
const url = 'https://kjshjgatoatsknbvswft.supabase.co';
const key = 'sb_publishable_ilmEDfVn7-U_6M__lsPQhA_YEb02Ey0';
const supabase = createClient(url, key);

async function run() {
  const { data, error } = await supabase
    .from('ol_productos')
    .select('*')
    .limit(1);
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Columns:", Object.keys(data[0] || {}));
    console.log("Sample product:", data[0]);
  }
}
run();
