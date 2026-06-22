-- ================================================================
-- MILA PMS — sql/02_rls_policies.sql
-- RLS para: user_profiles, bookings, payments, expenses, cleaning_tasks
-- Nombres reales confirmados por diagnóstico.
-- ================================================================

-- ──────────────────────────────
-- HELPER: hotel_id del usuario autenticado
-- ──────────────────────────────
CREATE OR REPLACE FUNCTION get_my_hotel_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT hotel_id FROM hotel_users
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

-- Test: SELECT get_my_hotel_id();

-- ──────────────────────────────
-- USER_PROFILES
-- ──────────────────────────────
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "up_select_own" ON user_profiles;
DROP POLICY IF EXISTS "up_insert_own" ON user_profiles;
DROP POLICY IF EXISTS "up_update_own" ON user_profiles;

CREATE POLICY "up_select_own"
  ON user_profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "up_insert_own"
  ON user_profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "up_update_own"
  ON user_profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ──────────────────────────────
-- BOOKINGS (reservas)
-- ──────────────────────────────
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookings_select" ON bookings;
DROP POLICY IF EXISTS "bookings_insert" ON bookings;
DROP POLICY IF EXISTS "bookings_update" ON bookings;
DROP POLICY IF EXISTS "bookings_delete" ON bookings;

CREATE POLICY "bookings_select"
  ON bookings FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel_id());

CREATE POLICY "bookings_insert"
  ON bookings FOR INSERT TO authenticated
  WITH CHECK (hotel_id = get_my_hotel_id());

CREATE POLICY "bookings_update"
  ON bookings FOR UPDATE TO authenticated
  USING (hotel_id = get_my_hotel_id())
  WITH CHECK (hotel_id = get_my_hotel_id());

CREATE POLICY "bookings_delete"
  ON bookings FOR DELETE TO authenticated
  USING (hotel_id = get_my_hotel_id());

-- ──────────────────────────────
-- PAYMENTS (pagos / señas)
-- ──────────────────────────────
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments_select" ON payments;
DROP POLICY IF EXISTS "payments_insert" ON payments;
DROP POLICY IF EXISTS "payments_update" ON payments;
DROP POLICY IF EXISTS "payments_delete" ON payments;

CREATE POLICY "payments_select"
  ON payments FOR SELECT TO authenticated
  USING (
    booking_id IN (
      SELECT id FROM bookings WHERE hotel_id = get_my_hotel_id()
    )
  );

CREATE POLICY "payments_insert"
  ON payments FOR INSERT TO authenticated
  WITH CHECK (
    booking_id IN (
      SELECT id FROM bookings WHERE hotel_id = get_my_hotel_id()
    )
  );

CREATE POLICY "payments_update"
  ON payments FOR UPDATE TO authenticated
  USING (
    booking_id IN (
      SELECT id FROM bookings WHERE hotel_id = get_my_hotel_id()
    )
  );

CREATE POLICY "payments_delete"
  ON payments FOR DELETE TO authenticated
  USING (
    booking_id IN (
      SELECT id FROM bookings WHERE hotel_id = get_my_hotel_id()
    )
  );

-- ──────────────────────────────
-- EXPENSES (gastos)
-- ──────────────────────────────
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_select" ON expenses;
DROP POLICY IF EXISTS "expenses_insert" ON expenses;
DROP POLICY IF EXISTS "expenses_update" ON expenses;
DROP POLICY IF EXISTS "expenses_delete" ON expenses;

CREATE POLICY "expenses_select"
  ON expenses FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel_id());

CREATE POLICY "expenses_insert"
  ON expenses FOR INSERT TO authenticated
  WITH CHECK (hotel_id = get_my_hotel_id());

CREATE POLICY "expenses_update"
  ON expenses FOR UPDATE TO authenticated
  USING (hotel_id = get_my_hotel_id())
  WITH CHECK (hotel_id = get_my_hotel_id());

CREATE POLICY "expenses_delete"
  ON expenses FOR DELETE TO authenticated
  USING (hotel_id = get_my_hotel_id());

-- ──────────────────────────────
-- CLEANING_TASKS (limpiezas)
-- ──────────────────────────────
ALTER TABLE cleaning_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cleaning_tasks_select" ON cleaning_tasks;
DROP POLICY IF EXISTS "cleaning_tasks_insert" ON cleaning_tasks;
DROP POLICY IF EXISTS "cleaning_tasks_update" ON cleaning_tasks;
DROP POLICY IF EXISTS "cleaning_tasks_delete" ON cleaning_tasks;

CREATE POLICY "cleaning_tasks_select"
  ON cleaning_tasks FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel_id());

CREATE POLICY "cleaning_tasks_insert"
  ON cleaning_tasks FOR INSERT TO authenticated
  WITH CHECK (hotel_id = get_my_hotel_id());

CREATE POLICY "cleaning_tasks_update"
  ON cleaning_tasks FOR UPDATE TO authenticated
  USING (hotel_id = get_my_hotel_id())
  WITH CHECK (hotel_id = get_my_hotel_id());

CREATE POLICY "cleaning_tasks_delete"
  ON cleaning_tasks FOR DELETE TO authenticated
  USING (hotel_id = get_my_hotel_id());

-- ──────────────────────────────
-- VERIFICACIÓN FINAL
-- ──────────────────────────────
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN (
  'user_profiles','bookings','payments','expenses','cleaning_tasks'
)
ORDER BY tablename, cmd;

NOTIFY pgrst, 'reload schema';
