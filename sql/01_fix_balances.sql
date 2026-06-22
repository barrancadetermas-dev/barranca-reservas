-- ================================================================
-- MILA PMS — CORRER PRIMERO
-- Fix 1: Recalcula balance/total_paid en TODOS los bookings existentes.
-- El trigger solo actúa en pagos nuevos; los anteriores quedan sin calcular.
-- ================================================================

UPDATE bookings b
SET
  total_paid = COALESCE((
    SELECT SUM(amount)
    FROM payments
    WHERE booking_id = b.id
  ), 0),
  balance = b.total_amount - COALESCE((
    SELECT SUM(amount)
    FROM payments
    WHERE booking_id = b.id
  ), 0),
  updated_at = NOW();

-- Verificar resultado:
SELECT id, total_amount, total_paid, balance
FROM bookings
ORDER BY check_in DESC
LIMIT 10;
