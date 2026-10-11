-- ═══════════════════════════════════════════════════════════════════
-- migration_booking_segments_pricing.sql — Total exacto en reservas con cambio de depto
-- PASO B · OPCIONAL · recomendado, pero LEER ANTES DE CORRER.
--
-- Problema que resuelve: hoy el trigger recalculate_booking_totals() calcula
--   total = price_per_night × noches − …
-- y una reserva con tramos a distinto precio guarda un PROMEDIO entero, así que
-- el total puede diferir ±$1 del cotizado (y una reserva totalmente pagada
-- puede quedar "con seña" por centavos). Esta versión, SOLO para reservas con
-- tramos explícitos, usa Σ(precio del tramo × noches del tramo).
-- Reservas comunes: exactamente la misma fórmula de siempre.
--
-- ⚠ ANTES DE CORRER: ejecutá
--     SELECT pg_get_functiondef('recalculate_booking_totals'::regproc);
--   y comparalo con _dev/scripts-sql/migrations/migration_fix_status_trigger.sql.
--   Si tu base tiene una versión DISTINTA (ej. contempla late check-out), NO
--   corras este archivo: pasame esa definición y la adapto.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION recalculate_booking_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_subtotal     NUMERIC;
  v_seg_subtotal NUMERIC;
  v_free         NUMERIC;
  v_discount     NUMERIC;
  v_total        NUMERIC;
  v_paid         NUMERIC;
BEGIN
  v_subtotal := NEW.price_per_night * (NEW.check_out - NEW.check_in);

  -- Reservas con cambio de depto: Σ precio del tramo × noches del tramo
  -- (solo si TODOS los tramos tienen precio propio)
  SELECT SUM(bu.price_per_night * (COALESCE(bu.segment_check_out, NEW.check_out)
                                 - COALESCE(bu.segment_check_in,  NEW.check_in)))
    INTO v_seg_subtotal
    FROM booking_units bu
   WHERE bu.booking_id = NEW.id
     AND EXISTS (SELECT 1 FROM booking_units x
                  WHERE x.booking_id = NEW.id AND x.segment_check_in IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM booking_units y
                      WHERE y.booking_id = NEW.id AND y.price_per_night IS NULL);
  IF v_seg_subtotal IS NOT NULL THEN
    v_subtotal := v_seg_subtotal;
  END IF;

  v_free     := NEW.free_nights * NEW.price_per_night;
  v_discount := (v_subtotal - v_free) * (NEW.discount_pct / 100.0);
  v_total    := v_subtotal - v_free - v_discount + NEW.surcharge_amount;

  SELECT COALESCE(SUM(amount_ars), 0)
  INTO v_paid
  FROM payments WHERE booking_id = NEW.id;

  NEW.total_amount := GREATEST(v_total, 0);
  NEW.total_paid   := v_paid;
  NEW.balance      := GREATEST(NEW.total_amount - v_paid, 0);
  NEW.updated_at   := NOW();

  IF NEW.status NOT IN ('cancelled', 'blocked') THEN
    IF NEW.balance = 0 AND NEW.total_amount > 0 THEN
      NEW.status := 'paid';
    ELSIF v_paid > 0 AND NEW.balance > 0 THEN
      NEW.status := 'partial';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Los tramos se guardan DESPUÉS de la reserva: al cambiar sus precios se
-- recalcula el total de esa reserva (solo si tiene tramos explícitos).
CREATE OR REPLACE FUNCTION refresh_booking_total_from_segments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking uuid := COALESCE(NEW.booking_id, OLD.booking_id);
BEGIN
  IF EXISTS (SELECT 1 FROM booking_units
              WHERE booking_id = v_booking AND segment_check_in IS NOT NULL) THEN
    UPDATE bookings SET updated_at = NOW() WHERE id = v_booking;  -- dispara el recálculo
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_total_from_segments ON booking_units;
CREATE TRIGGER trg_refresh_total_from_segments
  AFTER INSERT OR UPDATE OR DELETE ON booking_units
  FOR EACH ROW EXECUTE FUNCTION refresh_booking_total_from_segments();

-- ── Rollback: volver a la función original del repo ──────────────
-- DROP TRIGGER IF EXISTS trg_refresh_total_from_segments ON booking_units;
-- DROP FUNCTION IF EXISTS refresh_booking_total_from_segments();
-- y volver a correr migration_fix_status_trigger.sql
