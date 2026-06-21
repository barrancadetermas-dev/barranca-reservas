-- ═══════════════════════════════════════════════════════════════
-- MILA PMS v8 — migration_complete_v8.sql
-- Idempotente (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- Ejecutar completo en Supabase SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════

-- ╔══════════════════════════════════════════════════╗
-- ║  1. BOOKINGS — columnas adicionales              ║
-- ╚══════════════════════════════════════════════════╝
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS price_per_night  numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount     numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paid       numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance          numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nights           int           DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_pct     numeric(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS surcharge_amount numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_nights      int           DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adults           int           DEFAULT 1,
  ADD COLUMN IF NOT EXISTS children         int           DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pax              int           DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source           text          DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS is_blocked       boolean       DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_reason     text,
  ADD COLUMN IF NOT EXISTS checked_in_at    timestamptz,
  ADD COLUMN IF NOT EXISTS checked_out_at   timestamptz;

-- ╔══════════════════════════════════════════════════╗
-- ║  2. PAYMENTS — columnas adicionales              ║
-- ╚══════════════════════════════════════════════════╝
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_date  date,
  ADD COLUMN IF NOT EXISTS notes         text,
  ADD COLUMN IF NOT EXISTS amount_ars    numeric(12,2),
  ADD COLUMN IF NOT EXISTS currency      text DEFAULT 'ARS',
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(12,2);

-- ╔══════════════════════════════════════════════════╗
-- ║  3. REMINDERS — columnas adicionales             ║
-- ╚══════════════════════════════════════════════════╝
ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS completed    boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- ╔══════════════════════════════════════════════════╗
-- ║  4. UNITS — columnas adicionales                 ║
-- ╚══════════════════════════════════════════════════╝
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS color           text,
  ADD COLUMN IF NOT EXISTS internal_notes  text,
  ADD COLUMN IF NOT EXISTS suggested_price numeric(10,2);

-- ╔══════════════════════════════════════════════════╗
-- ║  5. AUDIT LOG — tabla completa                   ║
-- ╚══════════════════════════════════════════════════╝
CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id    uuid        REFERENCES hotels(id) ON DELETE CASCADE,
  user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email  text,
  role        text,
  action      text        NOT NULL,
  entity_type text,
  entity_id   text,
  summary     text,
  description text,
  changes     jsonb,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_hotel  ON audit_log(hotel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='audit_log' AND policyname='audit_admin_only'
  ) THEN
    CREATE POLICY audit_admin_only ON audit_log FOR ALL
      USING (hotel_id IN (
        SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid() AND role = 'admin'
      ));
  END IF;
END $$;
-- Compatibilidad si ya existía con columna 'description' en vez de 'summary'
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS summary     text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS changes     jsonb;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS role        text;

-- ╔══════════════════════════════════════════════════╗
-- ║  6. HOTEL_CONFIG                                 ║
-- ╚══════════════════════════════════════════════════╝
CREATE TABLE IF NOT EXISTS hotel_config (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id   uuid        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  key        text        NOT NULL,
  value      text,
  updated_at timestamptz DEFAULT now(),
  updated_by text,
  UNIQUE (hotel_id, key)
);
ALTER TABLE hotel_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='hotel_config' AND policyname='hotel_staff_config'
  ) THEN
    CREATE POLICY hotel_staff_config ON hotel_config
      USING (hotel_id IN (SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()));
  END IF;
END $$;

-- ╔══════════════════════════════════════════════════╗
-- ║  7. CLEANING_TASKS                               ║
-- ║  status: pending → in_progress → completed       ║
-- ╚══════════════════════════════════════════════════╝
CREATE TABLE IF NOT EXISTS cleaning_tasks (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id       uuid        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  unit_id        uuid        REFERENCES units(id) ON DELETE SET NULL,
  title          text        NOT NULL DEFAULT 'Limpieza',
  scheduled_date date        NOT NULL,
  status         text        NOT NULL DEFAULT 'pending',
  assigned_to    text,
  notes          text,
  completed_at   timestamptz,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cleaning_hotel_date ON cleaning_tasks(hotel_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_cleaning_unit       ON cleaning_tasks(unit_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_status     ON cleaning_tasks(status);
ALTER TABLE cleaning_tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='cleaning_tasks' AND policyname='hotel_staff_cleaning'
  ) THEN
    CREATE POLICY hotel_staff_cleaning ON cleaning_tasks
      USING (hotel_id IN (
        SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
      ));
  END IF;
END $$;

-- ╔══════════════════════════════════════════════════╗
-- ║  8. MAINTENANCE_ISSUES                           ║
-- ║  priority: low | medium | high | urgent          ║
-- ║  status:   open | in_progress | resolved         ║
-- ╚══════════════════════════════════════════════════╝
CREATE TABLE IF NOT EXISTS maintenance_issues (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id     uuid        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  unit_id      uuid        REFERENCES units(id) ON DELETE SET NULL,
  title        text        NOT NULL,
  description  text,
  category     text,
  priority     text        NOT NULL DEFAULT 'medium',
  status       text        NOT NULL DEFAULT 'open',
  assigned_to  text,
  reported_by  text,
  resolved_at  timestamptz,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maint_hotel_status ON maintenance_issues(hotel_id, status);
CREATE INDEX IF NOT EXISTS idx_maint_hotel_prio   ON maintenance_issues(hotel_id, priority);
ALTER TABLE maintenance_issues ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='maintenance_issues' AND policyname='hotel_staff_maint'
  ) THEN
    CREATE POLICY hotel_staff_maint ON maintenance_issues
      USING (hotel_id IN (
        SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
      ));
  END IF;
END $$;
-- Si la tabla ya existía con CHECK constraints estrictos, agregar columnas faltantes:
ALTER TABLE maintenance_issues ADD COLUMN IF NOT EXISTS category    text;
ALTER TABLE maintenance_issues ADD COLUMN IF NOT EXISTS assigned_to text;

-- ╔══════════════════════════════════════════════════╗
-- ║  9. GUEST_NOTES                                  ║
-- ╚══════════════════════════════════════════════════╝
CREATE TABLE IF NOT EXISTS guest_notes (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id    uuid        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  guest_id    uuid        NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  author_id   uuid        REFERENCES auth.users(id),
  author_name text,
  body        text        NOT NULL,
  category    text        DEFAULT 'general',
  created_at  timestamptz DEFAULT now() NOT NULL,
  updated_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guest_notes_guest   ON guest_notes(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_notes_hotel   ON guest_notes(hotel_id);
ALTER TABLE guest_notes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='guest_notes' AND policyname='hotel_staff_notes'
  ) THEN
    CREATE POLICY hotel_staff_notes ON guest_notes
      USING (hotel_id IN (SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()));
  END IF;
END $$;

-- ╔══════════════════════════════════════════════════╗
-- ║  10. FUNCIÓN updated_at + TRIGGERS               ║
-- ╚══════════════════════════════════════════════════╝
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cleaning_tasks_updated_at') THEN
    CREATE TRIGGER cleaning_tasks_updated_at
      BEFORE UPDATE ON cleaning_tasks
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='maintenance_issues_updated_at') THEN
    CREATE TRIGGER maintenance_issues_updated_at
      BEFORE UPDATE ON maintenance_issues
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='hotel_config_updated_at') THEN
    CREATE TRIGGER hotel_config_updated_at
      BEFORE UPDATE ON hotel_config
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ╔══════════════════════════════════════════════════╗
-- ║  11. ÍNDICES DE PERFORMANCE                      ║
-- ╚══════════════════════════════════════════════════╝
CREATE INDEX IF NOT EXISTS idx_bookings_checkin       ON bookings(check_in);
CREATE INDEX IF NOT EXISTS idx_bookings_checkout      ON bookings(check_out);
CREATE INDEX IF NOT EXISTS idx_bookings_status        ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_hotel_checkin ON bookings(hotel_id, check_in);
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='reminders' AND column_name='completed'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_reminders_hotel_date ON reminders(hotel_id, scheduled_date) WHERE completed = false';
  END IF;
END $$;

-- ╔══════════════════════════════════════════════════╗
-- ║  12. REFRESCAR CACHE DE SCHEMA (¡IMPORTANTE!)    ║
-- ╚══════════════════════════════════════════════════╝
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════
-- ✅ MIGRACIÓN COMPLETA
-- Tablas creadas/actualizadas:
--   bookings, payments, reminders, units (columnas)
--   audit_log, hotel_config, cleaning_tasks,
--   maintenance_issues, guest_notes (tablas nuevas)
-- ═══════════════════════════════════════════════════════════════
