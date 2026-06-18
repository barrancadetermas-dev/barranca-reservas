-- ══════════════════════════════════════════════════
-- MILA Sistema Inteligente para Alojamientos
-- Nuevas tablas requeridas por v5.0
-- Ejecutar en Supabase → SQL Editor
-- ══════════════════════════════════════════════════

-- ── 1. CONFIGURACIÓN DEL HOTEL ────────────────────
CREATE TABLE IF NOT EXISTS hotel_config (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id     uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  key          text NOT NULL,
  value        text NOT NULL,
  updated_at   timestamptz DEFAULT now(),
  updated_by   text,
  UNIQUE(hotel_id, key)
);

-- Valores por defecto
INSERT INTO hotel_config (hotel_id, key, value)
SELECT id, k.key, k.value FROM hotels, (VALUES
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
) AS k(key, value)
ON CONFLICT (hotel_id, key) DO NOTHING;

-- RLS
ALTER TABLE hotel_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hotel_config_hotel" ON hotel_config
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ── 2. TAREAS DE LIMPIEZA ─────────────────────────
CREATE TABLE IF NOT EXISTS cleaning_tasks (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id       uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  unit_id        uuid REFERENCES units(id) ON DELETE SET NULL,
  booking_id     uuid REFERENCES bookings(id) ON DELETE SET NULL,
  title          text NOT NULL DEFAULT 'Limpieza',
  scheduled_date date NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  assigned_to    text,
  notes          text,
  completed_at   timestamptz,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE cleaning_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cleaning_tasks_hotel" ON cleaning_tasks
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ── 3. INCIDENCIAS DE MANTENIMIENTO ───────────────
CREATE TABLE IF NOT EXISTS maintenance_issues (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id     uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  unit_id      uuid REFERENCES units(id) ON DELETE SET NULL,
  category     text NOT NULL DEFAULT 'Otro',
  title        text NOT NULL,
  description  text,
  priority     text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','resolved')),
  assigned_to  text,
  resolved_at  timestamptz,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE maintenance_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "maintenance_issues_hotel" ON maintenance_issues
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ── 4. STOCK E INSUMOS ────────────────────────────
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
CREATE POLICY "hotel_stock_hotel" ON hotel_stock
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

-- ── 5. TAGS / ETIQUETAS DE HUÉSPEDES ─────────────
-- (agregar columna si no existe)
ALTER TABLE guests ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
ALTER TABLE guests ADD COLUMN IF NOT EXISTS bad_experience boolean DEFAULT false;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS internal_notes text;

-- ══════════════════════════════════════════════════
-- ÍNDICES PARA PERFORMANCE
-- ══════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_cleaning_hotel_date ON cleaning_tasks(hotel_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_hotel_status ON maintenance_issues(hotel_id, status);
CREATE INDEX IF NOT EXISTS idx_hotel_config_hotel ON hotel_config(hotel_id);
CREATE INDEX IF NOT EXISTS idx_hotel_stock_hotel ON hotel_stock(hotel_id);

-- ══════════════════════════════════════════════════
-- MILA v6.3 — Campos de personas en bookings
-- Ejecutar si las columnas no existen aún
-- ══════════════════════════════════════════════════
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pax      integer DEFAULT 1;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS adults   integer DEFAULT 1;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS children integer DEFAULT 0;
