const { createClient } = require('@supabase/supabase-js');
const url = 'https://kjshjgatoatsknbvswft.supabase.co';
const key = 'sb_publishable_ilmEDfVn7-U_6M__lsPQhA_YEb02Ey0';
const supabase = createClient(url, key);

const ADMIN_EMAIL = 'admin@lacrayola.com';
const ADMIN_PASSWORD = 'adminlacrayola';

async function setupAdmin() {
  console.log(`--- REGISTRANDO ADMINISTRADOR EN SUPABASE ---`);
  
  // 1. Registrar en Supabase Auth
  console.log(`1. Creando usuario auth para: ${ADMIN_EMAIL}...`);
  const { data: authData, error: authErr } = await supabase.auth.signUp({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD
  });

  if (authErr) {
    if (authErr.message.includes('already registered')) {
      console.log(`💡 El usuario ya está registrado en Auth. Intentando recuperar o re-vincular rol...`);
      // Si ya existe, podemos intentar ver si podemos obtener un user_id.
      // Dado que no podemos listar auth.users, buscaremos si existe en rep_roles para ver si podemos actualizarlo.
      // O le pedimos que use signIn para verificar.
    } else {
      console.error(`❌ Error en Auth SignUp:`, authErr.message);
      return;
    }
  }

  const userId = authData?.user?.id;
  if (!userId) {
    console.log(`❌ No se pudo obtener el User ID. Si ya existe la cuenta, intenta iniciar sesión con ella directamente.`);
    
    // De todos modos, intentaremos insertar en rep_roles con un user_id dummy o el que encontremos en auth si es posible.
    // Como no tenemos el id directo si ya existe, le daremos instrucciones al usuario.
    return;
  }

  console.log(`✓ Usuario auth creado con éxito. ID: ${userId}`);

  // 2. Insertar rol en rep_roles
  console.log(`2. Asignando rol de 'superadmin' en rep_roles...`);
  const { error: roleErr } = await supabase
    .from('rep_roles')
    .upsert({
      user_id: userId,
      rol: 'superadmin',
      activo: true
    }, { onConflict: 'user_id' });

  if (roleErr) {
    console.error(`❌ Error al asignar rol en rep_roles:`, roleErr.message);
  } else {
    console.log(`✓ Rol de 'superadmin' asignado correctamente en la base de datos!`);
    console.log(`\n🎉 ¡ADMINISTRADOR CONFIGURADO CON ÉXITO!`);
    console.log(`========================================`);
    console.log(`Correo: ${ADMIN_EMAIL}`);
    console.log(`Clave: ${ADMIN_PASSWORD}`);
    console.log(`========================================`);
  }
}

setupAdmin();
