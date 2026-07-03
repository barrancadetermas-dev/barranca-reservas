-- ═══════════════════════════════════════════════════
-- migration_waitlist.sql
-- Ejecutar en Supabase SQL Editor
-- Lista de espera: cuando alguien pide fechas ocupadas,
-- queda guardado acá. Si después se cancela/reprograma
-- una reserva que libera esas fechas, se avisa solo.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS waitlist (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id     UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  guest_name   TEXT NOT NULL,
  phone        TEXT,
  check_in     DATE NOT NULL,
  check_out    DATE NOT NULL,
  unit_ids     UUID[] NOT NULL DEFAULT '{}', -- vacío = cualquier unidad sirve
  pax          INTEGER,
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'open', -- open | notified | converted | expired | cancelled
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  notified_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_waitlist_hotel_status ON waitlist(hotel_id, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_dates ON waitlist(check_in, check_out);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='waitlist' AND policyname='waitlist_hotel_staff'
  ) THEN
    CREATE POLICY waitlist_hotel_staff ON waitlist FOR ALL
      USING (hotel_id IN (SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()))
      WITH CHECK (hotel_id IN (SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()));
  END IF;
END $$;
