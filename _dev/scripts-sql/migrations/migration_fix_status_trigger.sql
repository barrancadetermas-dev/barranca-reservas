-- ═══════════════════════════════════════════════════
-- migration_fix_status_trigger.sql
-- Ejecutar en Supabase SQL Editor — ESTA ES LA CAUSA
-- REAL de que "No vino" / "Reprogramar" no cancelaran
-- la reserva cuando tenía algún pago cargado.
--
-- El trigger recalculate_booking_totals() corre en CADA
-- update a bookings y recalcula el status según cuánto
-- se pagó ('paid'/'partial') — pero nunca contempló que
-- alguien quisiera poner status='cancelled' a propósito.
-- Lo pisaba sin avisar, silenciosamente, cada vez.
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION recalculate_booking_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_subtotal     NUMERIC;
  v_free         NUMERIC;
  v_discount     NUMERIC;
  v_total        NUMERIC;
  v_paid         NUMERIC;
BEGIN
  v_subtotal := NEW.price_per_night * (NEW.check_out - NEW.check_in);
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

  -- Si la reserva se está cancelando o bloqueando a propósito, respetar
  -- eso — antes, este trigger lo pisaba solo con 'partial'/'paid' según
  -- el pago, sin importar que alguien la hubiera cancelado (Reprogramar,
  -- "No vino", etc.). Por eso el estado nunca cambiaba a "cancelled"
  -- cuando la reserva tenía algún pago cargado.
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
