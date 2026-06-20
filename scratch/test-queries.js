const { createClient } = require('@supabase/supabase-js');

const url = 'https://kjshjgatoatsknbvswft.supabase.co';
const key = 'sb_publishable_ilmEDfVn7-U_6M__lsPQhA_YEb02Ey0';
const supabase = createClient(url, key);

async function test() {
  console.log("1. Querying rep_repartidores...");
  try {
    const { data: rep, error: errRep } = await supabase
      .from('rep_repartidores')
      .select('id, nombre, estado')
      .limit(5);
    if (errRep) console.error("Error rep_repartidores:", errRep);
    else console.log("rep_repartidores:", rep);
  } catch (e) {
    console.error("Exception rep_repartidores:", e);
  }

  console.log("\n2. Querying rep_asignaciones with join and date filter...");
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const { data: asigs, error: errAsig } = await supabase
      .from('rep_asignaciones')
      .select('id, estado, pedido_id, ol_pedidos(numero, nombre_cliente, total)')
      .in('estado', ['asignado', 'recolectado', 'en_ruta'])
      .gte('asignado_at', hoy);
    if (errAsig) console.error("Error rep_asignaciones:", errAsig);
    else console.log("rep_asignaciones:", asigs);
  } catch (e) {
    console.error("Exception rep_asignaciones:", e);
  }

  console.log("\n3. Querying ol_pedidos...");
  try {
    const { data: pends, error: errPends } = await supabase
      .from('ol_pedidos')
      .select('id, numero, estado')
      .eq('estado', 'pendiente')
      .limit(5);
    if (errPends) console.error("Error ol_pedidos:", errPends);
    else console.log("ol_pedidos:", pends);
  } catch (e) {
    console.error("Exception ol_pedidos:", e);
  }
}

test();
