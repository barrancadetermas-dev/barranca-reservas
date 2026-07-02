-- ═══════════════════════════════════════════════════
-- migration_reminder_multi_unit.sql
-- Ejecutar en Supabase SQL Editor
-- Permite elegir VARIOS departamentos (o ninguno = todo
-- el complejo) al crear un recordatorio/nota, en vez de
-- uno solo.
-- ═══════════════════════════════════════════════════

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS unit_ids UUID[] NOT NULL DEFAULT '{}';

-- Migra los recordatorios viejos (con unit_id simple) al array nuevo,
-- para que no se vean "vacíos" después de este cambio.
UPDATE reminders
SET unit_ids = ARRAY[unit_id]
WHERE unit_id IS NOT NULL AND unit_ids = '{}';

CREATE INDEX IF NOT EXISTS idx_reminders_unit_ids ON reminders USING GIN (unit_ids);

-- La columna vieja unit_id se deja como está (no se borra) por si algo
-- viejo todavía la lee — el código nuevo ya no la usa para guardar.
