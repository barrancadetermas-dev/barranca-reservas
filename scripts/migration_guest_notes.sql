-- ═══════════════════════════════════════════════════
-- migration_guest_notes.sql
-- Historial de notas internas por huésped
-- Preferencias, pedidos especiales, observaciones
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS guest_notes (
  id           uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id     uuid         NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  guest_id     uuid         NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  author_id    uuid         REFERENCES auth.users(id),
  author_name  text,
  body         text         NOT NULL,
  category     text         DEFAULT 'general'
                CHECK (category IN ('general','preferencia','pedido','incidente','positivo')),
  created_at   timestamptz  DEFAULT now() NOT NULL,
  updated_at   timestamptz  DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_guest_notes_guest   ON guest_notes(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_notes_hotel   ON guest_notes(hotel_id);
CREATE INDEX IF NOT EXISTS idx_guest_notes_created ON guest_notes(created_at DESC);

-- RLS
ALTER TABLE guest_notes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='guest_notes' AND policyname='hotel_staff_notes'
  ) THEN
    CREATE POLICY hotel_staff_notes ON guest_notes
      USING (hotel_id IN (SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()));
  END IF;
END $$;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS guest_notes_updated_at ON guest_notes;
CREATE TRIGGER guest_notes_updated_at
  BEFORE UPDATE ON guest_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
