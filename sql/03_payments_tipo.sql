-- ================================================================
-- MILA PMS — sql/03_payments_tipo.sql
-- Agrega columna `payment_type` a payments y crea vista de saldos.
-- NOTA: payments ya existe con 13 columnas.
-- ================================================================

-- Ver columnas actuales de payments antes de modificar:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'payments'
ORDER BY ordinal_position;

-- ──────────────────────────────
-- Agregar payment_type si no existe
-- ──────────────────────────────
DO $$ BEGIN
  -- Intentar con nombre "payment_type" primero
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'payment_type'
  ) THEN
    ALTER TABLE payments
      ADD COLUMN payment_type TEXT NOT NULL DEFAULT 'deposit'
        CHECK (payment_type IN ('deposit', 'balance', 'refund'));
    RAISE NOTICE 'OK: payment_type agregado a payments.';
  ELSE
    RAISE NOTICE 'SKIP: payment_type ya existe.';
  END IF;
END $$;

-- Índice de performance para cálculo de saldo
CREATE INDEX IF NOT EXISTS idx_payments_booking_type
  ON payments (booking_id, payment_type);

-- ──────────────────────────────
-- Vista de saldos por booking
-- Usa columnas seguras que casi seguro existen en bookings (36 cols)
-- Si falla, ver query de diagnóstico abajo.
-- ──────────────────────────────
DROP VIEW IF EXISTS v_booking_balances;

CREATE VIEW v_booking_balances AS
SELECT
  b.id                                                                   AS booking_id,
  b.hotel_id,
  COALESCE(b.total_amount, b.total, 0)                                   AS total,
  COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type != 'refund'), 0)   AS total_paid,
  COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type  = 'refund'), 0)   AS total_refunded,
  GREATEST(0,
    COALESCE(b.total_amount, b.total, 0)
    - COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type != 'refund'), 0)
    + COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type  = 'refund'), 0)
  )                                                                       AS balance_due,
  (
    COALESCE(b.total_amount, b.total, 0)
    - COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type != 'refund'), 0)
    + COALESCE(SUM(p.amount) FILTER (WHERE p.payment_type  = 'refund'), 0)
  ) <= 0                                                                  AS is_paid
FROM bookings b
LEFT JOIN payments p ON p.booking_id = b.id
GROUP BY b.id;

NOTIFY pgrst, 'reload schema';

-- ── Si la vista falla por nombre de columna ──────────────────────
-- Correr esto para ver los nombres exactos de bookings:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'bookings'
-- ORDER BY ordinal_position;
--
-- Y los de payments:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'payments'
-- ORDER BY ordinal_position;
