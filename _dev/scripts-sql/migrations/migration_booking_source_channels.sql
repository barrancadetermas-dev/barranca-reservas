-- ═══════════════════════════════════════════════════════════════════
-- migration_booking_source_channels.sql — Canales de reserva admitidos
-- Segura · idempotente · no borra ni modifica reservas existentes.
--
-- Problema: migration_v3_identification.sql creó
--     CHECK (source IN ('direct','booking','airbnb','family'))
-- pero la app ofrece 9 canales. Cualquier reserva con 'walkin' (Espontáneo),
-- 'company', 'referral', 'despegar' o 'expedia' es rechazada por la base.
-- (Ejecutá antes diagnostico_reservas_origen.sql: su consulta 1 muestra la
-- restricción real de tu base; si es distinta, pasame el resultado.)
--
-- Esta migración deja la restricción igual a la lista de canales de la app
-- (js/supabase-config.js → SOURCE_CONFIG). Si algún día se agrega un canal
-- nuevo en la app, hay que agregarlo acá también (hay un test que lo verifica).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS chk_booking_source;

-- NOT VALID: se exige en reservas nuevas/modificadas sin frenar por datos históricos
ALTER TABLE bookings ADD CONSTRAINT chk_booking_source CHECK (
  source IN ('direct','walkin','booking','airbnb','family','company','referral','despegar','expedia')
) NOT VALID;

DO $$
BEGIN
  ALTER TABLE bookings VALIDATE CONSTRAINT chk_booking_source;
  RAISE NOTICE 'chk_booking_source validada: todas las reservas existentes cumplen.';
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Hay reservas históricas con un canal fuera de la lista (ver consulta de abajo). La regla rige igual para reservas nuevas. Detalle: %', SQLERRM;
END $$;

-- Reservas históricas que no cumplirían (informativo):
-- SELECT id, source FROM bookings
--  WHERE source NOT IN ('direct','walkin','booking','airbnb','family','company','referral','despegar','expedia');

-- Rollback (vuelve a la restricción anterior, de 4 canales):
-- ALTER TABLE bookings DROP CONSTRAINT IF EXISTS chk_booking_source;
-- ALTER TABLE bookings ADD CONSTRAINT chk_booking_source CHECK (source IN ('direct','booking','airbnb','family'));
