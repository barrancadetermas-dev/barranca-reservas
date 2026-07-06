-- ═══════════════════════════════════════════════════
-- fix_amount_ars.sql
-- EJECUTAR UNA SOLA VEZ en Supabase SQL Editor
-- Repara pagos históricos con amount_ars = NULL
-- y agrega trigger preventivo para el futuro
-- ═══════════════════════════════════════════════════

-- 1. Reparar pagos ya existentes con amount_ars NULL
UPDATE payments
SET amount_ars = amount
WHERE amount_ars IS NULL;

-- 2. Trigger preventivo: si en el futuro alguien inserta
--    sin amount_ars, se asigna automáticamente desde amount
CREATE OR REPLACE FUNCTION auto_assign_amount_ars()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.amount_ars IS NULL THEN
    IF NEW.exchange_rate IS NOT NULL THEN
      NEW.amount_ars := NEW.amount * NEW.exchange_rate;
    ELSE
      NEW.amount_ars := NEW.amount;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_amount_ars ON payments;
CREATE TRIGGER trg_auto_amount_ars
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION auto_assign_amount_ars();

-- 3. Forzar recálculo de saldos en todas las reservas
--    (el trigger trg_booking_totals se ejecuta solo)
UPDATE bookings SET updated_at = NOW()
WHERE id IN (SELECT DISTINCT booking_id FROM payments);
