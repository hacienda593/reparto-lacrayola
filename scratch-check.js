const { createClient } = require('@supabase/supabase-js');
const url = 'https://kjshjgatoatsknbvswft.supabase.co';
// Usaremos la clave de servicio o la clave anon (si no hay RLS que bloquee lectura pública)
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_ilmEDfVn7-U_6M__lsPQhA_YEb02Ey0';
const supabase = createClient(url, key);

async function check() {
  console.log("=== DIAGNÓSTICO DE REPARTIDOR ===");
  
  // 1. Consultar rep_repartidores
  const { data: rep, error: errRep } = await supabase
    .from('rep_repartidores')
    .select('*')
    .eq('email', 'repartidor1@test.com');
  
  console.log("1. Registro en rep_repartidores:");
  if (errRep) console.error("Error:", errRep);
  else console.log(JSON.stringify(rep, null, 2));

  if (rep && rep.length > 0) {
    const rId = rep[0].user_id;
    console.log(`User ID vinculado: ${rId}`);
    
    if (rId) {
      // 2. Consultar rep_roles
      const { data: rol, error: errRol } = await supabase
        .from('rep_roles')
        .select('*')
        .eq('user_id', rId);
      
      console.log("2. Rol en rep_roles:");
      if (errRol) console.error("Error:", errRol);
      else console.log(JSON.stringify(rol, null, 2));
    }
  }
}
check();
