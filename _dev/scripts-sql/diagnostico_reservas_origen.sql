-- ═══════════════════════════════════════════════════════════════════
-- diagnostico_reservas_origen.sql — SOLO LECTURA (no modifica nada)
-- Ejecutar en Supabase → SQL Editor y pasarme los resultados.
-- Sirve para saber POR QUÉ la base rechaza reservas de ciertos canales.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Restricciones (CHECK, FK, UNIQUE) que tiene hoy la tabla bookings
SELECT conname, contype, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'public.bookings'::regclass
ORDER BY contype, conname;

-- 2) Triggers de bookings y booking_units (y qué función ejecutan)
SELECT c.relname AS tabla, t.tgname AS trigger, pg_get_triggerdef(t.oid) AS definicion
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal AND c.relname IN ('bookings','booking_units','payments','guests')
ORDER BY c.relname, t.tgname;

-- 3) Políticas RLS sobre las tablas que toca el guardado
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('bookings','booking_units','payments','guests')
ORDER BY tablename, cmd, policyname;

-- 4) Qué tipo tiene bookings.source (text o enum) y su valor por defecto
SELECT column_name, data_type, udt_name, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name IN ('source','pax','adults','children');

-- 5) Canales que ya existen cargados (cuántas reservas por canal)
SELECT source, COUNT(*) AS reservas FROM bookings GROUP BY source ORDER BY reservas DESC;

-- 6) ¿Existe el valor de enum de métodos de pago que usa el formulario?
SELECT unnest(enum_range(NULL::payment_method)) AS metodos_de_pago_admitidos;
