-- ═══════════════════════════════════════════════════════════════
-- migration_guest_gender.sql — Género del huésped
-- Ejecutar en Supabase → SQL Editor ANTES de desplegar el código nuevo.
-- Es ADITIVA e idempotente: se puede correr más de una vez.
-- Reservas/huéspedes existentes quedan con gender = NULL (sin especificar)
-- y la app los sigue mostrando como hasta ahora.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE guests ADD COLUMN IF NOT EXISTS gender text;

ALTER TABLE guests DROP CONSTRAINT IF EXISTS guests_gender_check;
ALTER TABLE guests ADD CONSTRAINT guests_gender_check
  CHECK (gender IS NULL OR gender IN ('male', 'female', 'nonbinary'));

COMMENT ON COLUMN guests.gender IS
  'Género del huésped para textos (alojado/a/e): male | female | nonbinary | NULL = sin especificar';

-- Verificación (debe devolver la columna):
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'guests' AND column_name = 'gender';
