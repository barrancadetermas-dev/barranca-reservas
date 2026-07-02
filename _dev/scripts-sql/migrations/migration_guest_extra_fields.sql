-- ═══════════════════════════════════════════════════
-- migration_guest_extra_fields.sql
-- Ejecutar en Supabase SQL Editor
-- Agrega: localidad, edad, auto, patente al huésped
-- ═══════════════════════════════════════════════════

ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS locality   TEXT,
  ADD COLUMN IF NOT EXISTS age        INTEGER,
  ADD COLUMN IF NOT EXISTS car_model  TEXT,
  ADD COLUMN IF NOT EXISTS car_plate  TEXT;

-- Estos dos ya los usa el código (guests.js selecciona nationality y tags)
-- pero no aparecen en ninguna migración del repo — por las dudas, si ya
-- existen en tu base esto no hace nada (IF NOT EXISTS).
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS nationality TEXT,
  ADD COLUMN IF NOT EXISTS tags        TEXT[] DEFAULT '{}';
