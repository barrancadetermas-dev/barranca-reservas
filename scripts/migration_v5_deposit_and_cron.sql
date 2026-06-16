-- ═══════════════════════════════════════════════════
-- migration_v5_deposit_and_cron.sql
-- #19 Depósito de garantía reembolsable
-- #20 Cron job para recordatorios automáticos
-- ═══════════════════════════════════════════════════

-- ── 1. Depósito de garantía ──────────────────────────
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS deposit_amount   NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_returned BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deposit_returned_at TIMESTAMPTZ;

COMMENT ON COLUMN bookings.deposit_amount
  IS 'Monto de depósito de garantía reembolsable (no cuenta como ingreso)';
COMMENT ON COLUMN bookings.deposit_returned
  IS 'TRUE si el depósito fue devuelto al huésped al check-out';

-- ── 2. Cron job para recordatorios automáticos ───────
-- Requiere la extensión pg_cron (habilitada por defecto en Supabase)
-- Si pg_cron no está disponible en tu plan, usá la alternativa de Vercel cron.

-- Primero verificar si pg_cron está disponible:
-- SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- Si está disponible, crear el job:
-- (Descomentar las siguientes líneas cuando se quiera activar)
/*
SELECT cron.schedule(
  'daily-reminders',                          -- nombre del job
  '0 11 * * *',                              -- 11:00 UTC = 08:00 ARS
  $$
  SELECT net.http_post(
    url     := current_setting('app.functions_url') || '/daily-reminders',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer ' || current_setting('app.service_role_key') || '"}',
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
*/

-- ── 3. Alternativa: Vercel Cron (más simple) ─────────
-- En vercel.json agregar:
-- "crons": [{ "path": "/api/cron/reminders", "schedule": "0 11 * * *" }]
-- Y crear un archivo /api/cron/reminders.js que llame a la Edge Function.

-- ── 4. Tabla de configuración de notificaciones ──────
CREATE TABLE IF NOT EXISTS notification_config (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  admin_email     TEXT,
  notify_checkin  BOOLEAN DEFAULT TRUE,
  notify_checkout BOOLEAN DEFAULT TRUE,
  notify_balance  BOOLEAN DEFAULT TRUE,   -- avisar si hay saldo pendiente al llegada
  days_advance    INTEGER DEFAULT 1,       -- días de anticipación (1 = día anterior)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hotel_id)
);

ALTER TABLE notification_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hotel_isolation" ON notification_config FOR ALL
  USING (hotel_id IN (SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()));

-- Insertar configuración por defecto
INSERT INTO notification_config (hotel_id, admin_email, notify_checkin, notify_checkout)
SELECT id, NULL, TRUE, TRUE FROM hotels WHERE slug = 'barranca-de-termas'
ON CONFLICT (hotel_id) DO NOTHING;

-- ── 5. Verificación ──────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '✅ migration_v5_deposit_and_cron.sql completada';
  RAISE NOTICE '   Columnas nuevas en bookings: deposit_amount, deposit_returned, deposit_returned_at';
  RAISE NOTICE '   Tabla nueva: notification_config';
  RAISE NOTICE '   ACCIÓN REQUERIDA: Activar el cron job descomentando las líneas marcadas';
END $$;
