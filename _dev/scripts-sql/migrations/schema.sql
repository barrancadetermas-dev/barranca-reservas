-- ═══════════════════════════════════════════════════
-- schema.sql — Schema completo de Barranca de Termas
-- Ejecutar PRIMERO en Supabase SQL Editor
-- Luego ejecutar seed.sql
-- ═══════════════════════════════════════════════════

-- EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. HOTELES / TENANTS ─────────────────────────────
CREATE TABLE IF NOT EXISTS hotels (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  logo_url      TEXT,
  currency      TEXT DEFAULT 'ARS',
  country_code  TEXT DEFAULT 'AR',
  timezone      TEXT DEFAULT 'America/Argentina/Buenos_Aires',
  settings      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. USUARIOS / STAFF ───────────────────────────────
CREATE TABLE IF NOT EXISTS hotel_users (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id   UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'staff',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hotel_id, user_id)
);

-- ── 3. UNIDADES / APARTAMENTOS ────────────────────────
CREATE TABLE IF NOT EXISTS units (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id     UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  max_guests   INTEGER NOT NULL DEFAULT 2,
  floor        TEXT,
  sort_order   INTEGER DEFAULT 0,
  is_active    BOOLEAN DEFAULT TRUE,
  color        TEXT DEFAULT '#6366f1',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. HUÉSPEDES ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS guests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id     UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  dni          TEXT,
  phone        TEXT,
  email        TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guests_hotel ON guests(hotel_id);
CREATE INDEX IF NOT EXISTS idx_guests_dni   ON guests(hotel_id, dni);

-- ── 5. TIPO ENUM DE ESTADO ────────────────────────────
DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM (
    'pending', 'partial', 'paid', 'cancelled', 'blocked'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 6. RESERVAS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id          UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  guest_id          UUID REFERENCES guests(id) ON DELETE SET NULL,
  check_in          DATE NOT NULL,
  check_out         DATE NOT NULL,
  nights            INTEGER GENERATED ALWAYS AS (check_out - check_in) STORED,
  status            booking_status DEFAULT 'pending',
  price_per_night   NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal          NUMERIC(12,2) GENERATED ALWAYS AS (
                      (check_out - check_in) * price_per_night
                    ) STORED,
  free_nights       INTEGER DEFAULT 0,
  discount_pct      NUMERIC(5,2)  DEFAULT 0,
  surcharge_amount  NUMERIC(12,2) DEFAULT 0,
  total_amount      NUMERIC(12,2) DEFAULT 0,
  total_paid        NUMERIC(12,2) DEFAULT 0,
  balance           NUMERIC(12,2) DEFAULT 0,
  notes             TEXT CHECK (char_length(notes) <= 200),
  source            TEXT DEFAULT 'direct',
  is_blocked        BOOLEAN DEFAULT FALSE,
  block_reason      TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_dates CHECK (check_out > check_in)
);

CREATE INDEX IF NOT EXISTS idx_bookings_hotel  ON bookings(hotel_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates  ON bookings(hotel_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(hotel_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_guest  ON bookings(guest_id);

-- ── 7. RESERVA-UNIDADES (N:M) ─────────────────────────
CREATE TABLE IF NOT EXISTS booking_units (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  unit_id     UUID NOT NULL REFERENCES units(id)    ON DELETE CASCADE,
  UNIQUE(booking_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_bu_booking ON booking_units(booking_id);
CREATE INDEX IF NOT EXISTS idx_bu_unit    ON booking_units(unit_id);

-- ── 8. VISTA: CALENDARIO (detección de recambios) ─────
CREATE OR REPLACE VIEW calendar_cells AS
SELECT
  bu.unit_id,
  b.hotel_id,
  b.id          AS booking_id,
  b.check_in,
  b.check_out,
  b.status,
  b.guest_id,
  b.is_blocked,
  b.block_reason,
  g.first_name || ' ' || g.last_name AS guest_name,
  gs.calendar_date::DATE,
  CASE
    WHEN gs.calendar_date::DATE = b.check_in             THEN 'checkin'
    WHEN gs.calendar_date::DATE = b.check_out - 1        THEN 'checkout'
    ELSE 'stay'
  END AS cell_type
FROM bookings b
JOIN booking_units bu ON bu.booking_id = b.id
LEFT JOIN guests g ON g.id = b.guest_id
CROSS JOIN LATERAL generate_series(
  b.check_in::TIMESTAMPTZ,
  (b.check_out - 1)::TIMESTAMPTZ,
  INTERVAL '1 day'
) AS gs(calendar_date)
WHERE b.status != 'cancelled';

-- ── 9. TIPOS ENUM DE PAGO ─────────────────────────────
DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM (
    'cash','transfer','mercadopago','naranjax','uala','credit_card'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_currency AS ENUM ('ARS','USD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 10. PAGOS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id       UUID NOT NULL REFERENCES bookings(id)  ON DELETE CASCADE,
  hotel_id         UUID NOT NULL REFERENCES hotels(id)    ON DELETE CASCADE,
  amount           NUMERIC(12,2) NOT NULL,
  currency         payment_currency DEFAULT 'ARS',
  exchange_rate    NUMERIC(10,2),
  amount_ars       NUMERIC(12,2),
  method           payment_method NOT NULL,
  credit_surcharge NUMERIC(12,2) DEFAULT 0,
  paid_at          TIMESTAMPTZ DEFAULT NOW(),
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);

-- ── 11. GASTOS OPERATIVOS ─────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id     UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  category     TEXT NOT NULL DEFAULT 'otros',
  description  TEXT NOT NULL,
  amount       NUMERIC(12,2) NOT NULL,
  due_date     DATE,
  paid         BOOLEAN DEFAULT FALSE,
  paid_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 12. RECORDATORIOS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS reminders (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id       UUID NOT NULL REFERENCES hotels(id)  ON DELETE CASCADE,
  unit_id        UUID REFERENCES units(id)            ON DELETE SET NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  scheduled_date DATE NOT NULL,
  completed      BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_date ON reminders(hotel_id, scheduled_date);

-- ── 13. COTIZACIONES USD ──────────────────────────────
CREATE TABLE IF NOT EXISTS exchange_rates (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id   UUID REFERENCES hotels(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  rate_buy   NUMERIC(10,2),
  rate_sell  NUMERIC(10,2),
  source     TEXT DEFAULT 'bluelytics',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, source)
);

-- ══════════════════════════════════════════════════════
-- 14. TRIGGERS
-- ══════════════════════════════════════════════════════

-- Recalcular totales en cada cambio de reserva
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

  IF NEW.balance = 0 AND NEW.total_amount > 0 THEN
    NEW.status := 'paid';
  ELSIF v_paid > 0 AND NEW.balance > 0 THEN
    NEW.status := 'partial';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_booking_totals ON bookings;
CREATE TRIGGER trg_booking_totals
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION recalculate_booking_totals();

-- Actualizar saldo cuando entra un pago
CREATE OR REPLACE FUNCTION update_booking_on_payment()
RETURNS TRIGGER AS $$
DECLARE
  v_booking_id UUID;
BEGIN
  v_booking_id := COALESCE(NEW.booking_id, OLD.booking_id);
  UPDATE bookings SET
    total_paid = (SELECT COALESCE(SUM(amount_ars), 0) FROM payments WHERE booking_id = v_booking_id),
    balance    = total_amount - (SELECT COALESCE(SUM(amount_ars), 0) FROM payments WHERE booking_id = v_booking_id),
    updated_at = NOW()
  WHERE id = v_booking_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_change ON payments;
CREATE TRIGGER trg_payment_change
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_booking_on_payment();

-- updated_at automático
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guests_updated_at ON guests;
CREATE TRIGGER trg_guests_updated_at BEFORE UPDATE ON guests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_hotels_updated_at ON hotels;
CREATE TRIGGER trg_hotels_updated_at BEFORE UPDATE ON hotels FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════
-- 15. ROW LEVEL SECURITY (RLS)
-- ══════════════════════════════════════════════════════
ALTER TABLE hotels         ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE units          ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_units  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;

-- Helper: hotel_ids del usuario logueado
CREATE OR REPLACE FUNCTION user_hotel_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid();
$$;

-- Políticas de aislamiento por hotel
DO $$ BEGIN

  DROP POLICY IF EXISTS "hotel_isolation" ON hotels;
  CREATE POLICY "hotel_isolation" ON hotels FOR ALL
    USING (id IN (SELECT user_hotel_ids()));

  DROP POLICY IF EXISTS "hotel_isolation" ON hotel_users;
  CREATE POLICY "hotel_isolation" ON hotel_users FOR ALL
    USING (hotel_id IN (SELECT user_hotel_ids()));

  DROP POLICY IF EXISTS "hotel_isolation" ON units;
  CREATE POLICY "hotel_isolation" ON units FOR ALL
    USING (hotel_id IN (SELECT user_hotel_ids()));

  DROP POLICY IF EXISTS "hotel_isolation" ON guests;
  CREATE POLICY "hotel_isolation" ON guests FOR ALL
    USING (hotel_id IN (SELECT user_hotel_ids()));

  DROP POLICY IF EXISTS "hotel_isolation" ON bookings;
  CREATE POLICY "hotel_isolation" ON bookings FOR ALL
    USING (hotel_id IN (SELECT user_hotel_ids()));

  DROP POLICY IF EXISTS "hotel_isolation" ON booking_units;
  CREATE POLICY "hotel_isolation" ON booking_units FOR ALL
    USING (booking_id IN (
      SELECT id FROM bookings WHERE hotel_id IN (SELECT user_hotel_ids())
    ));

  DROP POLICY IF EXISTS "hotel_isolation" ON payments;
  CREATE POLICY "hotel_isolation" ON payments FOR ALL
    USING (hotel_id IN (SELECT user_hotel_ids()));

  DROP POLICY IF EXISTS "hotel_isolation" ON expenses;
  CREATE POLICY "hotel_isolation" ON expenses FOR ALL
    USING (hotel_id IN (SELECT user_hotel_ids()));

  DROP POLICY IF EXISTS "hotel_isolation" ON reminders;
  CREATE POLICY "hotel_isolation" ON reminders FOR ALL
    USING (hotel_id IN (SELECT user_hotel_ids()));

  DROP POLICY IF EXISTS "public_read" ON exchange_rates;
  CREATE POLICY "public_read" ON exchange_rates FOR SELECT USING (TRUE);

END $$;

-- ══════════════════════════════════════════════════════
-- 16. REALTIME
-- ══════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE payments;
ALTER PUBLICATION supabase_realtime ADD TABLE reminders;

-- ══════════════════════════════════════════════════════
-- FIN DEL SCHEMA — Ejecutar seed.sql a continuación
-- ══════════════════════════════════════════════════════
