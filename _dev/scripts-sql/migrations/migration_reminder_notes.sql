-- ═══════════════════════════════════════════════════
-- migration_reminder_notes.sql
-- Ejecutar en Supabase SQL Editor
-- Distingue "nota" (Cumpleaños de Alicia, Mundial) de
-- "tarea/recordatorio operativo" (Cortar el pasto)
-- ═══════════════════════════════════════════════════

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS is_note BOOLEAN NOT NULL DEFAULT FALSE;
