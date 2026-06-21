-- ═══════════════════════════════════════════════════
-- migration_complete_v8.sql — MILA v8
-- Ejecutar en el SQL Editor de Supabase
-- Usa IF NOT EXISTS en todo para ser idempotente
-- ═══════════════════════════════════════════════════

-- ── 1. Columnas faltantes en bookings ─────────────
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS price_per_night  numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_pct     numeric(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS surcharge_amount numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_nights      integer       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adults           integer       DEFAULT 1,
  ADD COLUMN IF NOT EXISTS children         integer       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pax              integer       DEFAULT 1,
  ADD COLUMN IF NOT EXISTS checked_in_at    timestamptz,
  ADD COLUMN IF NOT EXISTS checked_out_at   timestamptz,
  ADD COLUMN IF NOT EXISTS is_blocked       boolean       DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_reason     text;

-- ── 2. Audit log — columna summary (alias description) ─
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS summary     text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS changes     jsonb,
  ADD COLUMN IF NOT EXISTS role        text;

-- Asegurar que la columna que usen las queries exista
-- (el código usa "summary"; si el schema original usa "description", copiar)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='audit_log' AND column_name='description'
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='audit_log' AND column_name='summary'
      )
  ) THEN
    ALTER TABLE audit_log ADD COLUMN summary text;
    UPDATE audit_log SET summary = description WHERE summary IS NULL;
  END IF;
END $$;

-- ── 3. Tabla hotel_config ─────────────────────────
CREATE TABLE IF NOT EXISTS hotel_config (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id    uuid        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  key         text        NOT NULL,
  value       text,
  updated_at  timestamptz DEFAULT now(),
  updated_by  text,
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

-- ── 4. Tabla guest_notes ─────────────────────────
CREATE TABLE IF NOT EXISTS guest_notes (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id     uuid        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  guest_id     uuid        NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  author_id    uuid        REFERENCES auth.users(id),
  author_name  text,
  body         text        NOT NULL,
  category     text        DEFAULT 'general'
               CHECK (category IN ('general','preferencia','pedido','incidente','positivo')),
  created_at   timestamptz DEFAULT now() NOT NULL,
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_notes_guest   ON guest_notes(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_notes_hotel   ON guest_notes(hotel_id);
CREATE INDEX IF NOT EXISTS idx_guest_notes_created ON guest_notes(created_at DESC);

ALTER TABLE guest_notes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='guest_notes' AND policyname='hotel_staff_notes'
  ) THEN
    CREATE POLICY hotel_staff_notes ON guest_notes
      USING (hotel_id IN (SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()));
  END IF;
END $$;

-- ── 5. Tabla hotel_stock ──────────────────────────
CREATE TABLE IF NOT EXISTS hotel_stock (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id      uuid        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  item_key      text        NOT NULL,
  item_label    text,
  current_stock integer     DEFAULT 0,
  minimum_stock integer     DEFAULT 5,
  unit          text        DEFAULT 'unidades',
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (hotel_id, item_key)
);

ALTER TABLE hotel_stock ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='hotel_stock' AND policyname='hotel_staff_stock'
  ) THEN
    CREATE POLICY hotel_staff_stock ON hotel_stock
      USING (hotel_id IN (SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()));
  END IF;
END $$;

-- ── 6. Columna color en units ─────────────────────
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS color           text,
  ADD COLUMN IF NOT EXISTS internal_notes  text,
  ADD COLUMN IF NOT EXISTS suggested_price numeric(10,2);

-- ── 7. Trigger updated_at genérico ───────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='guest_notes_updated_at') THEN
    CREATE TRIGGER guest_notes_updated_at
      BEFORE UPDATE ON guest_notes
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

-- ── 8. Índices de performance ─────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_checkin        ON bookings(check_in);
CREATE INDEX IF NOT EXISTS idx_bookings_checkout       ON bookings(check_out);
CREATE INDEX IF NOT EXISTS idx_bookings_status         ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_hotel_checkin  ON bookings(hotel_id, check_in);
CREATE INDEX IF NOT EXISTS idx_audit_log_hotel_created ON audit_log(hotel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminders_hotel_date    ON reminders(hotel_id, scheduled_date) WHERE completed = false;

-- ── 9. Valores iniciales de hotel_config (ejemplo) ─
-- Descomenta y ajusta si querés seed con valores por defecto:
-- INSERT INTO hotel_config (hotel_id, key, value)
-- SELECT id, 'commission_booking', '15'  FROM hotels LIMIT 1 ON CONFLICT DO NOTHING;
-- SELECT id, 'commission_airbnb',  '18'  FROM hotels LIMIT 1 ON CONFLICT DO NOTHING;
-- SELECT id, 'checkin_hour',       '14:00' FROM hotels LIMIT 1 ON CONFLICT DO NOTHING;
-- SELECT id, 'checkout_hour',      '10:00' FROM hotels LIMIT 1 ON CONFLICT DO NOTHING;

-- ── FIN ───────────────────────────────────────────
-- Verificar las tablas creadas:
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;

-- ── 10. Tabla cleaning_tasks ───────────────────────
CREATE TABLE IF NOT EXISTS cleaning_tasks (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id       uuid        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  unit_id        uuid        REFERENCES units(id) ON DELETE SET NULL,
  title          text        NOT NULL,
  scheduled_date date        NOT NULL,
  status         text        DEFAULT 'pending'
                 CHECK (status IN ('pending','in_progress','done','skipped')),
  assigned_to    text,
  notes          text,
  completed_at   timestamptz,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cleaning_hotel_date ON cleaning_tasks(hotel_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_cleaning_unit       ON cleaning_tasks(unit_id);

ALTER TABLE cleaning_tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='cleaning_tasks' AND policyname='hotel_staff_cleaning'
  ) THEN
    CREATE POLICY hotel_staff_cleaning ON cleaning_tasks
      USING (hotel_id IN (
        SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cleaning_tasks_updated_at') THEN
    CREATE TRIGGER cleaning_tasks_updated_at
      BEFORE UPDATE ON cleaning_tasks
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ── 11. Tabla maintenance_issues ──────────────────
CREATE TABLE IF NOT EXISTS maintenance_issues (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id       uuid        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  unit_id        uuid        REFERENCES units(id) ON DELETE SET NULL,
  title          text        NOT NULL,
  description    text,
  priority       text        DEFAULT 'normal'
                 CHECK (priority IN ('low','normal','high','urgent')),
  status         text        DEFAULT 'open'
                 CHECK (status IN ('open','in_progress','resolved','closed')),
  reported_by    text,
  resolved_at    timestamptz,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maint_hotel_status ON maintenance_issues(hotel_id, status);

ALTER TABLE maintenance_issues ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='maintenance_issues' AND policyname='hotel_staff_maint'
  ) THEN
    CREATE POLICY hotel_staff_maint ON maintenance_issues
      USING (hotel_id IN (
        SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='maintenance_issues_updated_at') THEN
    CREATE TRIGGER maintenance_issues_updated_at
      BEFORE UPDATE ON maintenance_issues
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ── 12. audit_log — si no existe aún ─────────────
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
    SELECT 1 FROM pg_policies
    WHERE tablename='audit_log' AND policyname='audit_admin_only'
  ) THEN
    CREATE POLICY audit_admin_only ON audit_log FOR ALL
      USING (hotel_id IN (
        SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid() AND role = 'admin'
      ));
  END IF;
END $$;

-- ── FIN ───────────────────────────────────────────
-- Tablas existentes después de esta migración:
-- hotels, hotel_users, units, guests, bookings, booking_units,
-- payments, expenses, reminders, exchange_rates,
-- hotel_config, guest_notes, hotel_stock,
-- cleaning_tasks, maintenance_issues, audit_log,
-- season_pricing, channel_commissions

-- ── Columnas faltantes detectadas en producción ──────
-- Ejecutar si hay errores 400 en payments o reminders

ALTER TABLE payments  ADD COLUMN IF NOT EXISTS payment_date date;
ALTER TABLE payments  ADD COLUMN IF NOT EXISTS notes        text;
ALTER TABLE payments  ADD COLUMN IF NOT EXISTS amount_ars   numeric(12,2);
ALTER TABLE payments  ADD COLUMN IF NOT EXISTS currency     text DEFAULT 'ARS';
ALTER TABLE payments  ADD COLUMN IF NOT EXISTS exchange_rate numeric(12,2);

ALTER TABLE reminders ADD COLUMN IF NOT EXISTS completed    boolean DEFAULT false;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS price_per_night numeric(12,2);
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS total_amount    numeric(12,2);
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS total_paid      numeric(12,2) DEFAULT 0;
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS balance         numeric(12,2);
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS nights          int;
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS adults          int DEFAULT 1;
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS children        int DEFAULT 0;
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS pax             int DEFAULT 1;
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS is_blocked      boolean DEFAULT false;
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS block_reason    text;
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS checked_in_at   timestamptz;
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS checked_out_at  timestamptz;
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS source          text DEFAULT 'direct';

-- Refresca schema cache de PostgREST (importante!)
NOTIFY pgrst, 'reload schema';
