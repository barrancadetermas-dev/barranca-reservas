-- ════════════════════════════════════════════════════════════════
-- MILA PMS — migration_v2_nuevas_funciones.sql
-- Julio 2026 · Ejecutar en Supabase → SQL Editor
-- ════════════════════════════════════════════════════════════════
-- Incluye:
--   1. Forma de pago en gastos   (expenses.payment_method)
--   2. Destinatario en gastos    (expenses.beneficiary)
--   3. Frasco / Naranja X        (payments.frasco_date, frasco_credited_amount, frasco_credited_at)
-- ════════════════════════════════════════════════════════════════

-- ── 1. Forma de pago del gasto ───────────────────────────────────
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS payment_method text
    CHECK (payment_method IN ('efectivo','debito','transferencia','qr','cuenta'));

-- ── 2. Destinatario / Beneficiario del gasto ─────────────────────
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS beneficiary text;

-- ── 3. Frasco — plazo fijo Naranja X ─────────────────────────────
-- frasco_date           : fecha elegida de acreditación
-- frasco_credited_amount: monto real acreditado (con intereses)
-- frasco_credited_at    : fecha en que se registró la acreditación
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS frasco_date              date;
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS frasco_credited_amount   numeric(12,2);
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS frasco_credited_at       date;

-- Índice para buscar frascos pendientes rápidamente
CREATE INDEX IF NOT EXISTS idx_payments_frasco_date
  ON payments (frasco_date)
  WHERE frasco_date IS NOT NULL;

-- ── Notificar a PostgREST que el schema cambió ────────────────────
NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (opcional, ejecutar por separado):
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name IN ('expenses','payments')
--   AND column_name IN ('payment_method','beneficiary','frasco_date',
--                       'frasco_credited_amount','frasco_credited_at')
-- ORDER BY table_name, column_name;
-- ════════════════════════════════════════════════════════════════

-- ── 4. Tabla de Frascos (plazo fijo Naranja X) ───────────────────
CREATE TABLE IF NOT EXISTS frasco_items (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id         uuid REFERENCES hotels(id) ON DELETE CASCADE NOT NULL,
  booking_id       uuid REFERENCES bookings(id) ON DELETE SET NULL,
  original_amount  numeric(12,2) NOT NULL,
  interest_amount  numeric(12,2) DEFAULT 0,
  frasco_date      date NOT NULL,
  notes            text,
  credited         boolean DEFAULT false,
  credited_at      date,
  credited_amount  numeric(12,2),
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE frasco_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS frasco_items_policy ON frasco_items;
CREATE POLICY frasco_items_policy ON frasco_items
  FOR ALL USING (hotel_id IN (
    SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_frasco_items_hotel
  ON frasco_items (hotel_id, credited, frasco_date);

NOTIFY pgrst, 'reload schema';

-- ── 5. Permitir frasco_date nulo (para saldos estáticos: USD, En cuenta) ────
ALTER TABLE frasco_items ALTER COLUMN frasco_date DROP NOT NULL;
NOTIFY pgrst, 'reload schema';
