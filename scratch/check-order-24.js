const { createClient } = require('@supabase/supabase-js');
const url = 'https://kjshjgatoatsknbvswft.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtqc2hqZ2F0b2F0c2tuYnZzd2Z0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTM2Mzg2NiwiZXhwIjoyMDk0OTM5ODY2fQ.Kxh9ZfL81Hj9uNV63O2nezPEU6wlc19jx-4Sii45rt4';
const supabase = createClient(url, key);

async function run() {
  console.log("Fetching order #0024...");
  const { data: ped } = await supabase.from('ol_pedidos').select('*').eq('numero', 24).single();
  if (!ped) {
    console.log("Order #0024 not found.");
    return;
  }
  console.log("Order #0024 details:", ped);

  console.log("\nFetching items of order #0024...");
  const { data: items } = await supabase.from('ol_pedido_items').select('*').eq('pedido_id', ped.id);
  console.log("Items:", items);

  console.log("\nFetching products from ol_productos matching these codes...");
  if (items && items.length > 0) {
    const { data: prods } = await supabase
      .from('ol_productos')
      .select('*')
      .in('codigo', items.map(i => i.codigo));
    console.log("Products in ol_productos:", prods);
  }
}
run();
