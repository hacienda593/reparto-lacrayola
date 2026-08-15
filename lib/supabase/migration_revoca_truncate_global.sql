-- migration_revoca_truncate_global.sql
-- Hallazgo adicional durante la auditoría (defensa en profundidad, no un
-- punto numerado explícito, pero cae bajo "revocar ejecución/privilegios
-- innecesarios" del criterio general de docs/auditoria_plan_correcciones_ia.md).
--
-- Por configuración por defecto de Supabase, los roles anon y authenticated
-- tenían GRANT ALL (incluido TRUNCATE) sobre TODAS las tablas de public.
-- PostgREST no expone TRUNCATE como verbo REST, así que hoy no es
-- explotable desde el navegador con la anon key -- pero si alguna vez se
-- filtra una cadena de conexión Postgres directa, esos roles podrían vaciar
-- cualquier tabla sin que RLS lo impida (TRUNCATE no está sujeto a RLS).
--
-- Revocar TRUNCATE no cambia el comportamiento de ninguna llamada REST/RPC
-- existente: ninguna pasa por ese verbo.
-- Idempotente y sin downtime.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM anon, authenticated', r.table_name);
  END LOOP;
END $$;
