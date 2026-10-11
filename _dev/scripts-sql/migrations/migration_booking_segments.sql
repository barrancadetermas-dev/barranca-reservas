-- ═══════════════════════════════════════════════════════════════════
-- migration_booking_segments.sql — Reservas con varios tramos (cambio de depto)
-- PASO A · SEGURA · aditiva · idempotente. Correr en Supabase → SQL Editor.
--
-- Modelo (ver js/services/stay-segments.js):
--   booking_units = tramos de la reserva (unidad, desde, hasta).
--   segment_* = NULL  ⇒ "toda la estadía" (reservas comunes y viejas: NO se
--   tocan, siguen las fechas de la reserva solas).
--   segment_* con fechas ⇒ tramo explícito de un cambio de departamento.
--
-- No modifica ni borra ninguna fila existente.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Columnas (ya las crea migration_quick_quotes.sql; acá por si faltan)
ALTER TABLE booking_units ADD COLUMN IF NOT EXISTS segment_check_in  date;
ALTER TABLE booking_units ADD COLUMN IF NOT EXISTS segment_check_out date;
ALTER TABLE booking_units ADD COLUMN IF NOT EXISTS price_per_night   numeric(12,2);

-- 2) Integridad: ambas fechas juntas o ninguna, y hasta > desde.
--    NOT VALID = se exige en filas nuevas/modificadas sin frenar por datos viejos.
ALTER TABLE booking_units DROP CONSTRAINT IF EXISTS booking_units_segment_check;
ALTER TABLE booking_units ADD CONSTRAINT booking_units_segment_check CHECK (
  (segment_check_in IS NULL AND segment_check_out IS NULL)
  OR (segment_check_in IS NOT NULL AND segment_check_out IS NOT NULL
      AND segment_check_out > segment_check_in)
) NOT VALID;
DO $$
BEGIN
  ALTER TABLE booking_units VALIDATE CONSTRAINT booking_units_segment_check;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Hay filas viejas con tramos inconsistentes; la regla queda activa solo para filas nuevas. Detalle: %', SQLERRM;
END $$;

-- 3) Índice para buscar ocupación de una unidad por fechas
CREATE INDEX IF NOT EXISTS idx_bu_unit_segments
  ON booking_units (unit_id, segment_check_in, segment_check_out);

-- 4) Si cambian las fechas de la reserva, los tramos explícitos la acompañan.
--    Cubre TODOS los caminos que editan fechas (formulario, arrastrar/estirar en
--    el calendario, extender estadía, salida anticipada, reprogramar):
--      • mismo largo        → se desplazan todos los tramos (mover la reserva)
--      • cambia el largo    → el primer tramo sigue al check-in, el último al
--                             check-out; lo que queda fuera se recorta/elimina
--    Solo toca reservas CON tramos explícitos. Las demás ni se enteran.
CREATE OR REPLACE FUNCTION sync_booking_unit_segments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift integer;
BEGIN
  IF NEW.check_in IS NOT DISTINCT FROM OLD.check_in
     AND NEW.check_out IS NOT DISTINCT FROM OLD.check_out THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM booking_units
                  WHERE booking_id = NEW.id AND segment_check_in IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  -- Mover la reserva sin cambiar su largo
  IF (NEW.check_out - NEW.check_in) = (OLD.check_out - OLD.check_in) THEN
    v_shift := NEW.check_in - OLD.check_in;
    UPDATE booking_units
       SET segment_check_in  = segment_check_in  + v_shift,
           segment_check_out = segment_check_out + v_shift
     WHERE booking_id = NEW.id AND segment_check_in IS NOT NULL;
    RETURN NEW;
  END IF;

  -- Cambió el largo: 1) borrar tramos que quedaron totalmente fuera
  DELETE FROM booking_units
   WHERE booking_id = NEW.id AND segment_check_in IS NOT NULL
     AND (segment_check_out <= NEW.check_in OR segment_check_in >= NEW.check_out);

  -- 2) anclar los extremos (primer tramo ↔ check-in, último ↔ check-out)
  UPDATE booking_units SET segment_check_in = NEW.check_in
   WHERE booking_id = NEW.id AND segment_check_in = OLD.check_in;
  UPDATE booking_units SET segment_check_out = NEW.check_out
   WHERE booking_id = NEW.id AND segment_check_out = OLD.check_out;

  -- 3) recortar lo que se pase de la nueva ventana
  UPDATE booking_units
     SET segment_check_in  = GREATEST(segment_check_in,  NEW.check_in),
         segment_check_out = LEAST(segment_check_out, NEW.check_out)
   WHERE booking_id = NEW.id AND segment_check_in IS NOT NULL
     AND (segment_check_in < NEW.check_in OR segment_check_out > NEW.check_out);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_booking_unit_segments ON bookings;
CREATE TRIGGER trg_sync_booking_unit_segments
  AFTER UPDATE OF check_in, check_out ON bookings
  FOR EACH ROW EXECUTE FUNCTION sync_booking_unit_segments();

-- ── Verificación ─────────────────────────────────────────────────
-- SELECT conname FROM pg_constraint WHERE conname = 'booking_units_segment_check';
-- SELECT tgname FROM pg_trigger WHERE tgname = 'trg_sync_booking_unit_segments';
--
-- ── Rollback (si hiciera falta) ──────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_sync_booking_unit_segments ON bookings;
-- DROP FUNCTION IF EXISTS sync_booking_unit_segments();
-- ALTER TABLE booking_units DROP CONSTRAINT IF EXISTS booking_units_segment_check;
-- DROP INDEX IF EXISTS idx_bu_unit_segments;
