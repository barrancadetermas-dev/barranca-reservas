-- ═══════════════════════════════════════════════════
-- migration_quick_quotes.sql
-- Ejecutar en Supabase SQL Editor
-- Cotización rápida desde el calendario: al seleccionar
-- un rango de fechas DISPONIBLES, Mila arma una mini
-- planilla (una celda por noche, editable) y la guarda
-- acá. No ocupa disponibilidad — es solo un presupuesto.
-- Si se "Convierte en reserva" queda linkeada a bookings.id.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS quick_quotes (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id           UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  unit_id            UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  check_in           DATE NOT NULL,
  check_out          DATE NOT NULL,
  nights_detail      JSONB NOT NULL DEFAULT '[]',
  -- nights_detail: [{ "date":"2026-11-19", "price":80000, "free":false }, ...]
  -- guarda EXACTAMENTE el precio que quedó definido por noche.
  discount_mode      TEXT,              -- 'pct' | 'amt' | null
  discount_value     NUMERIC DEFAULT 0,
  surcharge_mode     TEXT,              -- 'pct' | 'amt' | null
  surcharge_value    NUMERIC DEFAULT 0,
  subtotal           NUMERIC NOT NULL DEFAULT 0,
  total              NUMERIC NOT NULL DEFAULT 0,
  guest_name         TEXT,
  notes              TEXT,
  status             TEXT NOT NULL DEFAULT 'draft', -- draft | converted | expired
  converted_booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  created_by         UUID,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quick_quotes_hotel      ON quick_quotes(hotel_id);
CREATE INDEX IF NOT EXISTS idx_quick_quotes_unit_dates ON quick_quotes(unit_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_quick_quotes_status     ON quick_quotes(hotel_id, status);

ALTER TABLE quick_quotes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='quick_quotes' AND policyname='quick_quotes_hotel_staff'
  ) THEN
    CREATE POLICY quick_quotes_hotel_staff ON quick_quotes FOR ALL
      USING (hotel_id IN (SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()))
      WITH CHECK (hotel_id IN (SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()));
  END IF;
END $$;
