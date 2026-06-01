const { createClient } = require('@supabase/supabase-js');
const url = 'https://kjshjgatoatsknbvswft.supabase.co';
const key = 'sb_publishable_ilmEDfVn7-U_6M__lsPQhA_YEb02Ey0';
const supabase = createClient(url, key);

async function test() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'admin@lacrayola.com',
    password: 'adminlacrayola'
  });
  if (error) {
    console.error("❌ Error de inicio de sesión:", error.message);
  } else {
    console.log("✓ ¡Inicio de sesión exitoso!", data.user.email);
  }
}
test();
