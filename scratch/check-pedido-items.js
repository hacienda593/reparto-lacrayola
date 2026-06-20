const { createClient } = require('@supabase/supabase-js');
const url = 'https://kjshjgatoatsknbvswft.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtqc2hqZ2F0b2F0c2tuYnZzd2Z0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTM2Mzg2NiwiZXhwIjoyMDk0OTM5ODY2fQ.Kxh9ZfL81Hj9uNV63O2nezPEU6wlc19jx-4Sii45rt4';
const supabase = createClient(url, key);

async function run() {
  const { data, error } = await supabase
    .from('ol_pedido_items')
    .select('*')
    .limit(5);
  if (error) {
    console.error(error);
  } else {
    console.log("ol_pedido_items sample data:", data);
  }
}
run();
