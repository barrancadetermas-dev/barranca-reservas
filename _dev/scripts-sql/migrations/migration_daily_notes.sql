-- migration_daily_notes.sql
-- Tabla para "Notas del día" del dashboard — una nota libre por hotel+fecha

CREATE TABLE IF NOT EXISTS daily_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   UUID NOT NULL,
  note_date  DATE NOT NULL,
  note       TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (hotel_id, note_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_notes_hotel_date ON daily_notes(hotel_id, note_date);

-- RLS: mismo patrón que el resto de las tablas del hotel
ALTER TABLE daily_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_notes_all" ON daily_notes;
CREATE POLICY "daily_notes_all" ON daily_notes
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION touch_daily_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_daily_notes_touch ON daily_notes;
CREATE TRIGGER trg_daily_notes_touch
  BEFORE UPDATE ON daily_notes
  FOR EACH ROW EXECUTE FUNCTION touch_daily_notes_updated_at();
