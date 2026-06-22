-- ================================================================
-- MILA PMS — sql/00_diagnostico.sql
-- Ya corriste esto. Guardar para futuras referencias.
-- Resultado confirmado: schema en inglés.
-- ================================================================

-- Columnas exactas de las tablas clave:
SELECT 'bookings' AS tabla, column_name, data_type
FROM information_schema.columns WHERE table_name = 'bookings'
UNION ALL
SELECT 'payments', column_name, data_type
FROM information_schema.columns WHERE table_name = 'payments'
UNION ALL
SELECT 'expenses', column_name, data_type
FROM information_schema.columns WHERE table_name = 'expenses'
UNION ALL
SELECT 'cleaning_tasks', column_name, data_type
FROM information_schema.columns WHERE table_name = 'cleaning_tasks'
ORDER BY tabla, column_name;
