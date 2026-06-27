-- ================================================================
-- fix_rls_clean.sql — Limpia políticas duplicadas
-- Ejecutar en Supabase → SQL Editor
-- ================================================================

-- ── CLEANING_TASKS: eliminar TODAS y recrear limpias ─────────────
DROP POLICY IF EXISTS "cleaning_tasks_own"     ON cleaning_tasks;
DROP POLICY IF EXISTS "cleaning_tasks_hotel"   ON cleaning_tasks;
DROP POLICY IF EXISTS "hotel_staff_cleaning"   ON cleaning_tasks;
DROP POLICY IF EXISTS "cleaning_tasks_delete"  ON cleaning_tasks;
DROP POLICY IF EXISTS "ct_delete"              ON cleaning_tasks;
DROP POLICY IF EXISTS "cleaning_tasks_insert"  ON cleaning_tasks;
DROP POLICY IF EXISTS "ct_insert"              ON cleaning_tasks;
DROP POLICY IF EXISTS "cleaning_tasks_select"  ON cleaning_tasks;
DROP POLICY IF EXISTS "ct_select"              ON cleaning_tasks;
DROP POLICY IF EXISTS "cleaning_tasks_update"  ON cleaning_tasks;
DROP POLICY IF EXISTS "ct_update"              ON cleaning_tasks;

CREATE POLICY "ct_select" ON cleaning_tasks FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel_id());
CREATE POLICY "ct_insert" ON cleaning_tasks FOR INSERT TO authenticated
  WITH CHECK (hotel_id = get_my_hotel_id());
CREATE POLICY "ct_update" ON cleaning_tasks FOR UPDATE TO authenticated
  USING (hotel_id = get_my_hotel_id()) WITH CHECK (hotel_id = get_my_hotel_id());
CREATE POLICY "ct_delete" ON cleaning_tasks FOR DELETE TO authenticated
  USING (hotel_id = get_my_hotel_id());

-- ── MAINTENANCE_ISSUES: eliminar TODAS y recrear limpias ─────────
DROP POLICY IF EXISTS "maintenance_issues_hotel"  ON maintenance_issues;
DROP POLICY IF EXISTS "maintenance_issues_own"    ON maintenance_issues;
DROP POLICY IF EXISTS "hotel_staff_maint"         ON maintenance_issues;
DROP POLICY IF EXISTS "mi_delete"                 ON maintenance_issues;
DROP POLICY IF EXISTS "maintenance_delete"        ON maintenance_issues;
DROP POLICY IF EXISTS "mi_insert"                 ON maintenance_issues;
DROP POLICY IF EXISTS "maintenance_insert"        ON maintenance_issues;
DROP POLICY IF EXISTS "mi_select"                 ON maintenance_issues;
DROP POLICY IF EXISTS "maintenance_select"        ON maintenance_issues;
DROP POLICY IF EXISTS "mi_update"                 ON maintenance_issues;
DROP POLICY IF EXISTS "maintenance_update"        ON maintenance_issues;

CREATE POLICY "mi_select" ON maintenance_issues FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel_id());
CREATE POLICY "mi_insert" ON maintenance_issues FOR INSERT TO authenticated
  WITH CHECK (hotel_id = get_my_hotel_id());
CREATE POLICY "mi_update" ON maintenance_issues FOR UPDATE TO authenticated
  USING (hotel_id = get_my_hotel_id()) WITH CHECK (hotel_id = get_my_hotel_id());
CREATE POLICY "mi_delete" ON maintenance_issues FOR DELETE TO authenticated
  USING (hotel_id = get_my_hotel_id());

-- Verificación final — debe mostrar exactamente 4 filas por tabla
SELECT tablename, policyname, cmd 
FROM pg_policies 
WHERE tablename IN ('maintenance_issues','cleaning_tasks')
ORDER BY tablename, cmd;
