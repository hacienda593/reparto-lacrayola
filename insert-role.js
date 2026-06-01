const { createClient } = require('@supabase/supabase-js');
const url = 'https://kjshjgatoatsknbvswft.supabase.co';
// Usaremos la clave anon o service role de ser posible
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_ilmEDfVn7-U_6M__lsPQhA_YEb02Ey0';
const supabase = createClient(url, key);

async function run() {
  console.log("=== VINCULANDO ROL DE REPARTIDOR EN BASE DE DATOS ===");
  
  const userId = 'db328e90-0b6e-45ba-96db-7f37eccddfbf'; // User ID de repartidor1@test.com
  
  const { data, error } = await supabase
    .from('rep_roles')
    .upsert({
      user_id: userId,
      rol: 'repartidor',
      activo: true
    })
    .select();

  if (error) {
    console.error("❌ Error al insertar rol:", error);
  } else {
    console.log("✓ Rol insertado con éxito:", JSON.stringify(data, null, 2));
  }
}
run();
