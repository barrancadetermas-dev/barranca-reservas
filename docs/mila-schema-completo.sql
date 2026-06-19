-- ══════════════════════════════════════════════════════════════════
-- MILA Sistema Inteligente para Alojamientos
-- SQL COMPLETO — Pegar en Supabase → SQL Editor → Run
-- Es seguro ejecutarlo múltiples veces (idempotente).
-- Fecha: Junio 2026
-- ══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────
-- 0. EXTENSIONES
-- ─────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────
-- 1. HOTELES
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hotels (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  address     text,
  phone       text,
  email       text,
  logo_url    text,
  timezone    text DEFAULT 'America/Argentina/Buenos_Aires',
  currency    text DEFAULT 'ARS',
  is_active   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────────
-- 2. USUARIOS DEL HOTEL
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hotel_users (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id   uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role       text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff','demo')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(hotel_id, user_id)
);

ALTER TABLE hotel_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hotel_users_policy ON hotel_users;
CREATE POLICY hotel_users_policy ON hotel_users
  FOR ALL USING (user_id = auth.uid() OR
    hotel_id IN (SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()));

-- ─────────────────────────────────────────────────
-- 3. UNIDADES / DEPARTAMENTOS
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS units (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id       uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  name           text NOT NULL,
  number         text,
  sort_order     integer DEFAULT 1,
  floor          text,
  type           text DEFAULT 'apartment',
  max_guests     integer DEFAULT 4,
  color          text DEFAULT '#6366F1',
  internal_notes text,
  is_active      boolean DEFAULT true,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS units_policy ON units;
CREATE POLICY units_policy ON units
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────────
-- 4. HUÉSPEDES
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guests (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id       uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  first_name     text,
  last_name      text,
  dni            text,
  phone          text,
  email          text,
  city           text,
  country        text DEFAULT 'Argentina',
  tags           text[] DEFAULT '{}',
  bad_experience boolean DEFAULT false,
  bad_experience_note text,
  internal_notes text,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guests_policy ON guests;
CREATE POLICY guests_policy ON guests
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────────
-- 5. RESERVAS
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id          uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  guest_id          uuid REFERENCES guests(id) ON DELETE SET NULL,
  check_in          date NOT NULL,
  check_out         date NOT NULL,
  nights            integer GENERATED ALWAYS AS
                      (EXTRACT(DAY FROM (check_out::timestamptz - check_in::timestamptz))::integer)
                    STORED,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','partial','paid','cancelled','blocked')),
  source            text DEFAULT 'direct',
  price_per_night   numeric(12,2) DEFAULT 0,
  discount_pct      numeric(5,2)  DEFAULT 0,
  surcharge_amount  numeric(12,2) DEFAULT 0,
  free_nights       integer DEFAULT 0,
  deposit_amount    numeric(12,2) DEFAULT 0,
  total_amount      numeric(12,2) DEFAULT 0,
  total_paid        numeric(12,2) DEFAULT 0,
  balance           numeric(12,2) DEFAULT 0,
  commission_pct    numeric(5,2)  DEFAULT 0,
  commission_amount numeric(12,2) DEFAULT 0,
  net_amount        numeric(12,2) DEFAULT 0,
  pax               integer DEFAULT 1,
  adults            integer DEFAULT 1,
  children          integer DEFAULT 0,
  notes             text,
  is_blocked        boolean DEFAULT false,
  block_reason      text,
  checked_in_at     timestamptz,
  checked_out_at    timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  refund_amount     numeric(12,2),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- Índices de rendimiento
CREATE INDEX IF NOT EXISTS idx_bookings_hotel     ON bookings(hotel_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates     ON bookings(hotel_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_bookings_status    ON bookings(hotel_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_checkin   ON bookings(hotel_id, check_in);
CREATE INDEX IF NOT EXISTS idx_bookings_guest     ON bookings(guest_id);

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bookings_policy ON bookings;
CREATE POLICY bookings_policy ON bookings
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────────
-- 6. UNIDADES POR RESERVA
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_units (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE NOT NULL,
  unit_id    uuid REFERENCES units(id)    ON DELETE CASCADE NOT NULL,
  hotel_id   uuid REFERENCES hotels(id)  ON DELETE CASCADE NOT NULL,
  UNIQUE(booking_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_units_booking ON booking_units(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_units_unit    ON booking_units(unit_id);

ALTER TABLE booking_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_units_policy ON booking_units;
CREATE POLICY booking_units_policy ON booking_units
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────────
-- 7. PAGOS
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id   uuid REFERENCES bookings(id) ON DELETE CASCADE NOT NULL,
  hotel_id     uuid REFERENCES hotels(id)   ON DELETE CASCADE NOT NULL,
  amount       numeric(12,2) NOT NULL,
  method       text DEFAULT 'cash',
  payment_date date DEFAULT CURRENT_DATE,
  notes        text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_hotel   ON payments(hotel_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_policy ON payments;
CREATE POLICY payments_policy ON payments
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────────
-- 8. GASTOS OPERATIVOS
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id     uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  category     text NOT NULL,
  description  text,
  amount       numeric(12,2) NOT NULL,
  expense_date date DEFAULT CURRENT_DATE,
  supplier     text,
  created_by   text,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expenses_policy ON expenses;
CREATE POLICY expenses_policy ON expenses
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────────
-- 9. RECORDATORIOS
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reminders (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id       uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  unit_id        uuid REFERENCES units(id) ON DELETE SET NULL,
  title          text NOT NULL,
  description    text,
  scheduled_date date NOT NULL,
  completed      boolean DEFAULT false,
  completed_at   timestamptz,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminders_hotel_date ON reminders(hotel_id, scheduled_date);

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reminders_policy ON reminders;
CREATE POLICY reminders_policy ON reminders
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────────
-- 10. AUDITORÍA
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id    uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  user_id     uuid,
  user_email  text,
  action      text NOT NULL,
  entity_type text,
  entity_id   text,
  description text,
  meta        jsonb,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_hotel_date ON audit_log(hotel_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_policy ON audit_log;
CREATE POLICY audit_log_policy ON audit_log
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────────
-- 11. PRECIOS DE TEMPORADA
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS season_pricing (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id    uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  unit_id     uuid REFERENCES units(id) ON DELETE CASCADE,
  name        text NOT NULL,
  date_from   date NOT NULL,
  date_to     date NOT NULL,
  price       numeric(12,2) NOT NULL,
  multiplier  numeric(4,2) DEFAULT 1.0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE season_pricing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS season_pricing_policy ON season_pricing;
CREATE POLICY season_pricing_policy ON season_pricing
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────────
-- 12. CONFIGURACIÓN DEL HOTEL (v5.0)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hotel_config (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id    uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  key         text NOT NULL,
  value       text NOT NULL,
  updated_at  timestamptz DEFAULT now(),
  updated_by  text,
  UNIQUE(hotel_id, key)
);

ALTER TABLE hotel_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hotel_config_policy ON hotel_config;
CREATE POLICY hotel_config_policy ON hotel_config
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- Valores por defecto (no sobreescribe los existentes)
INSERT INTO hotel_config (hotel_id, key, value)
SELECT h.id, c.key, c.value
FROM hotels h
CROSS JOIN (VALUES
  ('commission_booking',   '15'),
  ('commission_airbnb',    '18'),
  ('commission_despegar',  '12'),
  ('commission_expedia',   '15'),
  ('surcharge_credit_card','10'),
  ('surcharge_debit_card', '0'),
  ('surcharge_transfer',   '0'),
  ('surcharge_mercadopago','0'),
  ('tax_iva',              '21'),
  ('tax_turismo',          '0'),
  ('checkin_hour',         '14:00'),
  ('checkout_hour',        '10:00'),
  ('min_advance_pct',      '30'),
  ('provisional_days',     '7')
) AS c(key, value)
ON CONFLICT (hotel_id, key) DO NOTHING;

-- ─────────────────────────────────────────────────
-- 13. TAREAS DE LIMPIEZA (v5.0)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cleaning_tasks (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id       uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  unit_id        uuid REFERENCES units(id) ON DELETE SET NULL,
  booking_id     uuid REFERENCES bookings(id) ON DELETE SET NULL,
  title          text NOT NULL DEFAULT 'Limpieza',
  scheduled_date date NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','in_progress','completed')),
  assigned_to    text,
  notes          text,
  completed_at   timestamptz,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cleaning_hotel_date ON cleaning_tasks(hotel_id, scheduled_date);

ALTER TABLE cleaning_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cleaning_tasks_policy ON cleaning_tasks;
CREATE POLICY cleaning_tasks_policy ON cleaning_tasks
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────────
-- 14. INCIDENCIAS DE MANTENIMIENTO (v5.0)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_issues (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id    uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  unit_id     uuid REFERENCES units(id) ON DELETE SET NULL,
  category    text NOT NULL DEFAULT 'Otro',
  title       text NOT NULL,
  description text,
  priority    text NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('low','medium','high','urgent')),
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','in_progress','resolved')),
  assigned_to text,
  resolved_at timestamptz,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE maintenance_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maintenance_issues_policy ON maintenance_issues;
CREATE POLICY maintenance_issues_policy ON maintenance_issues
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────────
-- 15. STOCK E INSUMOS (v5.0)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hotel_stock (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id      uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  item_key      text NOT NULL,
  item_label    text,
  current_stock integer NOT NULL DEFAULT 0,
  minimum_stock integer NOT NULL DEFAULT 5,
  unit_label    text DEFAULT 'unidades',
  updated_at    timestamptz DEFAULT now(),
  UNIQUE(hotel_id, item_key)
);

ALTER TABLE hotel_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hotel_stock_policy ON hotel_stock;
CREATE POLICY hotel_stock_policy ON hotel_stock
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ─────────────────────────────────────────────────
-- 16. COLUMNAS FALTANTES EN TABLAS EXISTENTES
-- ─────────────────────────────────────────────────

-- Personas en reservas (v6.3)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pax               integer DEFAULT 1;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS adults            integer DEFAULT 1;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS children          integer DEFAULT 0;

-- Comisiones en reservas (v6.3)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_pct    numeric(5,2)  DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_amount numeric(12,2) DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS net_amount        numeric(12,2) DEFAULT 0;

-- Notas internas y check-in/out en reservas
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checked_in_at    timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checked_out_at   timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at       timestamptz DEFAULT now();

-- Tags y mala experiencia en huéspedes (v5.0)
ALTER TABLE guests ADD COLUMN IF NOT EXISTS tags                text[] DEFAULT '{}';
ALTER TABLE guests ADD COLUMN IF NOT EXISTS bad_experience      boolean DEFAULT false;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS bad_experience_note text;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS internal_notes      text;

-- ─────────────────────────────────────────────────
-- 17. FUNCIÓN AUTO-UPDATE updated_at
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON bookings;
CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────
-- 18. VERIFICACIÓN FINAL
-- ─────────────────────────────────────────────────
SELECT
  'MILA SQL OK ✓' AS resultado,
  COUNT(*) AS tablas_creadas
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'hotels','hotel_users','units','bookings','booking_units',
    'payments','guests','reminders','expenses','audit_log',
    'season_pricing','hotel_config','cleaning_tasks',
    'maintenance_issues','hotel_stock'
  );
