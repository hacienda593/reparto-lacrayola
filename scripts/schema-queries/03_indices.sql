SELECT tablename AS tabla, indexname AS nombre, indexdef AS definicion FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname;
