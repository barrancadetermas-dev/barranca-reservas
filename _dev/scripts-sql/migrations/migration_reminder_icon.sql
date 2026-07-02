-- ═══════════════════════════════════════════════════
-- migration_reminder_icon.sql
-- Ejecutar en Supabase SQL Editor
-- Emoji elegible para notas (torta, pelota, etc.) — se
-- usa para el marcador que aparece una sola vez en el
-- encabezado del día cuando la nota es general (sin
-- departamento asociado).
-- ═══════════════════════════════════════════════════

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS icon TEXT;
