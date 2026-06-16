-- ═══════════════════════════════════════════════════
-- migration_guests_crm.sql
-- Ejecutar en Supabase SQL Editor DESPUÉS de schema.sql
-- Agrega el módulo de CRM y antecedentes de huéspedes
-- ═══════════════════════════════════════════════════

-- ── Columnas de mala experiencia en guests ──────────
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS bad_experience            BOOLEAN   DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bad_experience_note       TEXT,
  ADD COLUMN IF NOT EXISTS bad_experience_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bad_experience_booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL;

-- ── Índice para filtrado rápido ─────────────────────
CREATE INDEX IF NOT EXISTS idx_guests_bad_exp
  ON guests(hotel_id, bad_experience)
  WHERE bad_experience = TRUE;

-- ── Habilitar RLS en exchange_rates (faltaba) ───────
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;

-- ── Vista: ficha completa del huésped ───────────────
CREATE OR REPLACE VIEW guest_profiles AS
SELECT
  g.id,
  g.hotel_id,
  g.first_name,
  g.last_name,
  g.first_name || ' ' || g.last_name AS full_name,
  g.dni,
  g.phone,
  g.email,
  g.bad_experience,
  g.bad_experience_note,
  g.bad_experience_at,
  g.bad_experience_booking_id,
  g.created_at,
  -- Estadísticas calculadas
  COUNT(DISTINCT b.id)                          AS total_bookings,
  COALESCE(SUM(b.total_amount), 0)              AS total_spent,
  COALESCE(AVG(b.nights), 0)                   AS avg_nights,
  MAX(b.check_in)                               AS last_checkin
FROM guests g
LEFT JOIN bookings b
  ON b.guest_id = g.id
  AND b.status NOT IN ('cancelled','blocked')
GROUP BY g.id;

-- ── Realtime para guests ─────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE guests;

-- ── Verificación ─────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'guests'
  AND column_name LIKE 'bad_experience%'
ORDER BY column_name;
