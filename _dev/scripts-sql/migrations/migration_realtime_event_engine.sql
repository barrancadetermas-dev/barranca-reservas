-- ═══════════════════════════════════════════════════
-- migration_realtime_event_engine.sql
-- Ejecutar en Supabase SQL Editor — habilita que Supabase
-- Realtime mande la fila COMPLETA (antes y después) en
-- cada cambio, no solo el ID. Sin esto, el motor de
-- eventos no podría saber, por ejemplo, qué reserva se
-- borró o qué cambió exactamente.
-- No modifica ningún dato existente, solo config de replicación.
-- ═══════════════════════════════════════════════════

ALTER TABLE bookings REPLICA IDENTITY FULL;
ALTER TABLE payments REPLICA IDENTITY FULL;

-- Habilitar Realtime en estas 2 tablas (si ya estaba habilitado,
-- este comando no rompe nada, Postgres avisa "ya existe" y sigue).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE payments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
