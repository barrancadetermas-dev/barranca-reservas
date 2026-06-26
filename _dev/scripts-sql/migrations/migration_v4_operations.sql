-- ═══════════════════════════════════════════════════
-- migration_v4_operations.sql
-- Lote 1+2+3: Roles, Auditoría, Check-in/out,
--             Tarifas por temporada, Comisiones, Notas
-- Ejecutar DESPUÉS de migration_v3_identification.sql
-- ═══════════════════════════════════════════════════

-- ── 1. Check-in / Check-out tracking ────────────────
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS checked_in_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checked_out_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_note     TEXT,
  ADD COLUMN IF NOT EXISTS refund_amount   NUMERIC(12,2) DEFAULT 0;

-- ── 2. Tabla de Auditoría ───────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id    UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id),
  user_email  TEXT,
  role        TEXT,
  action      TEXT NOT NULL,           -- 'CREATE' | 'UPDATE' | 'DELETE' | 'CANCEL' | 'CHECKIN' etc.
  entity_type TEXT NOT NULL,           -- 'booking' | 'payment' | 'guest' | 'expense' etc.
  entity_id   UUID,
  summary     TEXT,                    -- Descripción legible del cambio
  changes     JSONB,                   -- { before: {}, after: {} }
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_hotel  ON audit_log(hotel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_log(user_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Solo admins ven el audit log
DROP POLICY IF EXISTS "audit_admin_only" ON audit_log;
CREATE POLICY "audit_admin_only" ON audit_log FOR ALL
  USING (
    hotel_id IN (
      SELECT hotel_id FROM hotel_users
      WHERE user_id = auth.uid() AND role IN ('admin','owner')
    )
  );

-- ── 3. Tarifas por temporada ─────────────────────────
CREATE TABLE IF NOT EXISTS season_pricing (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  unit_id         UUID REFERENCES units(id) ON DELETE CASCADE, -- NULL = todas las unidades
  name            TEXT NOT NULL,              -- 'Temporada Alta', 'Semana Santa', etc.
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  price_per_night NUMERIC(12,2) NOT NULL,
  priority        INTEGER DEFAULT 0,          -- Mayor número = mayor prioridad
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_season_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_season_dates  ON season_pricing(hotel_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_season_active ON season_pricing(hotel_id, is_active);

ALTER TABLE season_pricing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hotel_isolation" ON season_pricing;
CREATE POLICY "hotel_isolation" ON season_pricing FOR ALL
  USING (hotel_id IN (SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()));

-- Función: precio de temporada para una fecha/unidad
CREATE OR REPLACE FUNCTION get_season_price(
  p_hotel_id UUID, p_unit_id UUID, p_date DATE
)
RETURNS NUMERIC(12,2) AS $$
  SELECT price_per_night
  FROM season_pricing
  WHERE hotel_id   = p_hotel_id
    AND is_active  = TRUE
    AND p_date BETWEEN start_date AND end_date
    AND (unit_id = p_unit_id OR unit_id IS NULL)
  ORDER BY priority DESC, (unit_id IS NOT NULL) DESC
  LIMIT 1
$$ LANGUAGE sql STABLE;

-- ── 4. Comisiones por canal ──────────────────────────
CREATE TABLE IF NOT EXISTS channel_commissions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id       UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  channel        TEXT NOT NULL,          -- 'booking' | 'airbnb'
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hotel_id, channel)
);

ALTER TABLE channel_commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hotel_isolation" ON channel_commissions;
CREATE POLICY "hotel_isolation" ON channel_commissions FOR ALL
  USING (hotel_id IN (SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()));

-- Insertar comisiones por defecto
INSERT INTO channel_commissions (hotel_id, channel, commission_pct)
SELECT id, 'booking', 15.00 FROM hotels WHERE slug = 'barranca-de-termas'
ON CONFLICT (hotel_id, channel) DO NOTHING;

INSERT INTO channel_commissions (hotel_id, channel, commission_pct)
SELECT id, 'airbnb', 18.00 FROM hotels WHERE slug = 'barranca-de-termas'
ON CONFLICT (hotel_id, channel) DO NOTHING;

-- ── 5. Notas internas por unidad ────────────────────
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;

-- ── 6. Rol 'demo' en hotel_users ────────────────────
-- Agregar valor 'demo' a la restricción si existe
ALTER TABLE hotel_users
  DROP CONSTRAINT IF EXISTS chk_hotel_user_role;
ALTER TABLE hotel_users
  ADD CONSTRAINT chk_hotel_user_role
  CHECK (role IN ('owner','admin','staff','demo'));

-- ── 7. Vista P&L mensual ────────────────────────────
CREATE OR REPLACE VIEW pnl_summary AS
SELECT
  b.hotel_id,
  DATE_TRUNC('month', b.check_in::TIMESTAMPTZ) AS period,
  b.source,
  COUNT(DISTINCT b.id)                          AS booking_count,
  SUM(b.total_amount)                           AS gross_revenue,
  COALESCE(
    (SELECT commission_pct FROM channel_commissions cc
     WHERE cc.hotel_id = b.hotel_id AND cc.channel = b.source
     LIMIT 1), 0
  )                                              AS commission_pct,
  SUM(b.total_amount) * (1 - COALESCE(
    (SELECT commission_pct / 100 FROM channel_commissions cc
     WHERE cc.hotel_id = b.hotel_id AND cc.channel = b.source
     LIMIT 1), 0
  ))                                             AS net_revenue
FROM bookings b
WHERE b.status NOT IN ('cancelled','blocked')
GROUP BY b.hotel_id, period, b.source;

-- ── 8. Realtime para nuevas tablas ──────────────────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE audit_log;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE season_pricing;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE channel_commissions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 9. Verificación ──────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '✅ migration_v4_operations.sql completada';
  RAISE NOTICE '   Tablas nuevas: audit_log, season_pricing, channel_commissions';
  RAISE NOTICE '   Columnas nuevas en bookings: checked_in_at, checked_out_at, cancel_note, refund_amount';
  RAISE NOTICE '   Columnas nuevas en units: internal_notes';
  RAISE NOTICE '   Rol demo habilitado en hotel_users';
END $$;
