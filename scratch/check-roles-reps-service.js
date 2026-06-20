const { createClient } = require('@supabase/supabase-js');
const url = 'https://kjshjgatoatsknbvswft.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtqc2hqZ2F0b2F0c2tuYnZzd2Z0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTM2Mzg2NiwiZXhwIjoyMDk0OTM5ODY2fQ.Kxh9ZfL81Hj9uNV63O2nezPEU6wlc19jx-4Sii45rt4';
const supabase = createClient(url, key);

async function run() {
  console.log("Fetching all from rep_roles (using service role)...");
  const { data: roles, error: errRoles } = await supabase.from('rep_roles').select('*');
  if (errRoles) console.error("Error fetching roles:", errRoles);
  else console.log("rep_roles:", roles);

  console.log("\nFetching all from rep_repartidores (using service role)...");
  const { data: reps, error: errReps } = await supabase.from('rep_repartidores').select('*');
  if (errReps) console.error("Error fetching reps:", errReps);
  else console.log("rep_repartidores:", reps);
}
run();
