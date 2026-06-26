-- ================================================================
-- MILA PMS — fix_all_rls.sql
-- Corrige todos los errores 400/404 de RLS en una sola pasada.
-- Ejecutar en Supabase Studio → SQL Editor.
-- ================================================================

-- 1. booking_units — sin RLS causa 404 en queries de booking-form
ALTER TABLE booking_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bu_select" ON booking_units;
DROP POLICY IF EXISTS "bu_insert" ON booking_units;
DROP POLICY IF EXISTS "bu_update" ON booking_units;
DROP POLICY IF EXISTS "bu_delete" ON booking_units;

CREATE POLICY "bu_select" ON booking_units FOR SELECT TO authenticated
  USING (booking_id IN (SELECT id FROM bookings WHERE hotel_id = get_my_hotel_id()));

CREATE POLICY "bu_insert" ON booking_units FOR INSERT TO authenticated
  WITH CHECK (booking_id IN (SELECT id FROM bookings WHERE hotel_id = get_my_hotel_id()));

CREATE POLICY "bu_update" ON booking_units FOR UPDATE TO authenticated
  USING (booking_id IN (SELECT id FROM bookings WHERE hotel_id = get_my_hotel_id()));

CREATE POLICY "bu_delete" ON booking_units FOR DELETE TO authenticated
  USING (booking_id IN (SELECT id FROM bookings WHERE hotel_id = get_my_hotel_id()));

-- 2. cleaning_tasks — HEAD 400 en el badge de operaciones
ALTER TABLE cleaning_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ct_select" ON cleaning_tasks;
DROP POLICY IF EXISTS "ct_insert" ON cleaning_tasks;
DROP POLICY IF EXISTS "ct_update" ON cleaning_tasks;
DROP POLICY IF EXISTS "ct_delete" ON cleaning_tasks;

CREATE POLICY "ct_select" ON cleaning_tasks FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel_id());
CREATE POLICY "ct_insert" ON cleaning_tasks FOR INSERT TO authenticated
  WITH CHECK (hotel_id = get_my_hotel_id());
CREATE POLICY "ct_update" ON cleaning_tasks FOR UPDATE TO authenticated
  USING (hotel_id = get_my_hotel_id()) WITH CHECK (hotel_id = get_my_hotel_id());
CREATE POLICY "ct_delete" ON cleaning_tasks FOR DELETE TO authenticated
  USING (hotel_id = get_my_hotel_id());

-- 3. maintenance_issues — HEAD 400 en el badge de operaciones
ALTER TABLE maintenance_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mi_select" ON maintenance_issues;
DROP POLICY IF EXISTS "mi_insert" ON maintenance_issues;
DROP POLICY IF EXISTS "mi_update" ON maintenance_issues;
DROP POLICY IF EXISTS "mi_delete" ON maintenance_issues;

CREATE POLICY "mi_select" ON maintenance_issues FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel_id());
CREATE POLICY "mi_insert" ON maintenance_issues FOR INSERT TO authenticated
  WITH CHECK (hotel_id = get_my_hotel_id());
CREATE POLICY "mi_update" ON maintenance_issues FOR UPDATE TO authenticated
  USING (hotel_id = get_my_hotel_id()) WITH CHECK (hotel_id = get_my_hotel_id());
CREATE POLICY "mi_delete" ON maintenance_issues FOR DELETE TO authenticated
  USING (hotel_id = get_my_hotel_id());

NOTIFY pgrst, 'reload schema';

-- Verificación:
SELECT tablename, COUNT(*) as policies
FROM pg_policies
WHERE tablename IN ('booking_units','cleaning_tasks','maintenance_issues')
GROUP BY tablename;
