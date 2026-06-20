const { createClient } = require('@supabase/supabase-js');
const url = 'https://kjshjgatoatsknbvswft.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtqc2hqZ2F0b2F0c2tuYnZzd2Z0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTM2Mzg2NiwiZXhwIjoyMDk0OTM5ODY2fQ.Kxh9ZfL81Hj9uNV63O2nezPEU6wlc19jx-4Sii45rt4';
const supabase = createClient(url, key);

async function run() {
  console.log("Checking pg_policies for rep_roles and rep_repartidores...");
  const { data, error } = await supabase
    .rpc('execute_sql_temp', { sql_query: "SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename IN ('rep_roles', 'rep_repartidores')" });
  
  if (error) {
    console.error("Direct SQL rpc execute_sql_temp failed:", error);
    // Let's try listing pg_policies directly if exposed
    const { data: directData, error: directErr } = await supabase
      .from('pg_policies')
      .select('*')
      .in('tablename', ['rep_roles', 'rep_repartidores']);
    if (directErr) {
      console.error("Direct query on pg_policies table failed:", directErr);
    } else {
      console.log("Direct pg_policies result:", directData);
    }
  } else {
    console.log("SQL Results for policies:", data);
  }
}
run();
