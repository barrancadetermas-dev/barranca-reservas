-- ═══════════════════════════════════════════════════════════════════════════
-- migration_multiunidad.sql — Reservas con 2+ deptos: huéspedes y ajustes POR UNIDAD
--
-- ✔ Solo AGREGA columnas (todas aceptan NULL) y UN trigger nuevo. No borra ni reescribe datos.
-- ✔ Reservas existentes: bookings.unit_pricing = false → el trigger actual sigue igual que siempre.
-- ✔ Idempotente: se puede correr más de una vez sin problema.
-- ✔ No reemplaza tu trigger actual (recalculate_booking_totals): funciona con CUALQUIER versión
--   que tengas viva, incluso la que suma late check-out.
--
-- CÓMO FUNCIONA EL TRIGGER NUEVO
--   Corre DESPUÉS del trigger actual (por orden alfabético de nombre: "zz_…").
--   Si la reserva usa precios por unidad (unit_pricing = true), reemplaza el total por el que calcula la app
--   (unit_pricing_total) y recalcula saldo y estado. En cualquier otro caso no hace nada.
--
-- CÓMO CORRERLO: Supabase → SQL Editor → pegar todo → Run.
-- ROLLBACK: al final del archivo (comentado).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Distribución de huéspedes por unidad (NULL = sin distribución cargada)
ALTER TABLE booking_units ADD COLUMN IF NOT EXISTS adults   smallint;
ALTER TABLE booking_units ADD COLUMN IF NOT EXISTS children smallint;

-- 2) Ajustes propios de la unidad (NULL o 0 = ninguno; lo colectivo sigue en bookings)
ALTER TABLE booking_units ADD COLUMN IF NOT EXISTS free_nights      smallint;
ALTER TABLE booking_units ADD COLUMN IF NOT EXISTS discount_pct     numeric(7,4);
ALTER TABLE booking_units ADD COLUMN IF NOT EXISTS surcharge_amount numeric(12,2);

-- 2b) Nombre propio del depto dentro de la reserva (ej.: "Depto de los abuelos"); NULL = sin nombre
ALTER TABLE booking_units ADD COLUMN IF NOT EXISTS label text;

-- 3) Marca y total de las reservas con precios por unidad (false/NULL = todas las actuales)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS unit_pricing       boolean NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS unit_pricing_total numeric(12,2);

-- 4) Validaciones suaves (NOT VALID: no revisan filas existentes, solo las nuevas)
DO $$ BEGIN
  ALTER TABLE booking_units ADD CONSTRAINT booking_units_guests_nonneg
    CHECK ((adults IS NULL OR adults >= 0) AND (children IS NULL OR children >= 0)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE booking_units ADD CONSTRAINT booking_units_adjust_range
    CHECK ((free_nights IS NULL OR free_nights >= 0)
       AND (discount_pct IS NULL OR (discount_pct >= 0 AND discount_pct <= 100))
       AND (surcharge_amount IS NULL OR surcharge_amount >= 0)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE booking_units ADD CONSTRAINT booking_units_label_len
    CHECK (label IS NULL OR char_length(label) <= 60) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5) Trigger: respeta el total calculado por la app en reservas con precios por unidad
CREATE OR REPLACE FUNCTION zz_apply_unit_pricing_total()
RETURNS TRIGGER AS $$
BEGIN
  IF COALESCE(NEW.unit_pricing, false) AND NEW.unit_pricing_total IS NOT NULL THEN
    NEW.total_amount := GREATEST(NEW.unit_pricing_total, 0);
    NEW.balance      := GREATEST(NEW.total_amount - COALESCE(NEW.total_paid, 0), 0);
    -- Solo se mueve entre pending/partial/paid; cancelled/blocked se respetan
    IF NEW.status IN ('pending', 'partial', 'paid') THEN
      IF NEW.balance = 0 AND NEW.total_amount > 0 THEN
        NEW.status := 'paid';
      ELSIF COALESCE(NEW.total_paid, 0) > 0 THEN
        NEW.status := 'partial';
      ELSE
        NEW.status := 'pending';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS zz_booking_unit_pricing_total ON bookings;
CREATE TRIGGER zz_booking_unit_pricing_total
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION zz_apply_unit_pricing_total();

COMMIT;

-- ─── VERIFICACIÓN (correr aparte, después) ───────────────────────────────────
-- 1) Las columnas existen:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'booking_units' AND column_name IN ('adults','children','free_nights','discount_pct','surcharge_amount','label');
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'bookings' AND column_name IN ('unit_pricing','unit_pricing_total');
-- 2) Ninguna reserva existente cambió de modo (debe dar 0):
--   SELECT count(*) FROM bookings WHERE unit_pricing;
-- 3) El trigger nuevo corre después del tuyo:
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'bookings'::regclass AND NOT tgisinternal ORDER BY tgname;

-- ─── ROLLBACK (solo si todavía no cargaste datos nuevos) ─────────────────────
-- DROP TRIGGER IF EXISTS zz_booking_unit_pricing_total ON bookings;
-- DROP FUNCTION IF EXISTS zz_apply_unit_pricing_total();
-- ALTER TABLE booking_units DROP CONSTRAINT IF EXISTS booking_units_guests_nonneg, DROP CONSTRAINT IF EXISTS booking_units_adjust_range;
-- ALTER TABLE booking_units DROP COLUMN IF EXISTS adults, DROP COLUMN IF EXISTS children, DROP COLUMN IF EXISTS free_nights,
--   DROP COLUMN IF EXISTS discount_pct, DROP COLUMN IF EXISTS surcharge_amount, DROP COLUMN IF EXISTS label;
-- ALTER TABLE bookings DROP COLUMN IF EXISTS unit_pricing, DROP COLUMN IF EXISTS unit_pricing_total;
