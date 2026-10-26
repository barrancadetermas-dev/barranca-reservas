-- ═══════════════════════════════════════════════════════════════════════════
-- migration_multiunidad_nombre.sql — Nombre propio de cada depto DENTRO de una reserva de 2+ deptos
--   (ej.: "Depto de los abuelos", "Los primos"). Solo agrega una columna que acepta NULL.
-- Si todavía NO corriste migration_multiunidad.sql, corré ESA (ya incluye este paso) y no hace falta esta.
-- Idempotente. Supabase → SQL Editor → pegar → Run.
-- Rollback: ALTER TABLE booking_units DROP COLUMN IF EXISTS label;
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE booking_units ADD COLUMN IF NOT EXISTS label text;
DO $$ BEGIN
  ALTER TABLE booking_units ADD CONSTRAINT booking_units_label_len CHECK (label IS NULL OR char_length(label) <= 60) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
