-- ================================================================
-- fix_maintenance_final.sql
-- Ejecutar en Supabase → SQL Editor
-- Resuelve:
--   1. CHECK constraint inválido en maintenance_issues.status
--   2. RLS sin WITH CHECK (insert/update bloqueados)
--   3. RLS sin WITH CHECK en cleaning_tasks (HEAD falla)
-- ================================================================

-- ── 1. MAINTENANCE_ISSUES ────────────────────────────────────────

-- Eliminar el check constraint viejo (sea cual sea el nombre)
DO $$ 
DECLARE r RECORD;
BEGIN
  FOR r IN 
    SELECT conname FROM pg_constraint 
    WHERE conrelid = 'maintenance_issues'::regclass 
    AND contype = 'c'
  LOOP
    EXECUTE 'ALTER TABLE maintenance_issues DROP CONSTRAINT ' || quote_ident(r.conname);
    RAISE NOTICE 'Dropped constraint: %', r.conname;
  END LOOP;
END $$;

-- Agregar constraint correcto con los valores reales
ALTER TABLE maintenance_issues 
  ADD CONSTRAINT maintenance_issues_status_check 
  CHECK (status IN ('open','in_progress','resolved'));

ALTER TABLE maintenance_issues 
  ADD CONSTRAINT maintenance_issues_priority_check 
  CHECK (priority IN ('low','medium','high','urgent'));

-- RLS correcto para maintenance_issues
ALTER TABLE maintenance_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hotel_staff_maint"  ON maintenance_issues;
DROP POLICY IF EXISTS "mi_select"          ON maintenance_issues;
DROP POLICY IF EXISTS "mi_insert"          ON maintenance_issues;
DROP POLICY IF EXISTS "mi_update"          ON maintenance_issues;
DROP POLICY IF EXISTS "mi_delete"          ON maintenance_issues;

CREATE POLICY "mi_select" ON maintenance_issues FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel_id());
CREATE POLICY "mi_insert" ON maintenance_issues FOR INSERT TO authenticated
  WITH CHECK (hotel_id = get_my_hotel_id());
CREATE POLICY "mi_update" ON maintenance_issues FOR UPDATE TO authenticated
  USING (hotel_id = get_my_hotel_id()) WITH CHECK (hotel_id = get_my_hotel_id());
CREATE POLICY "mi_delete" ON maintenance_issues FOR DELETE TO authenticated
  USING (hotel_id = get_my_hotel_id());

-- ── 2. CLEANING_TASKS ────────────────────────────────────────────

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

-- Verificación final
SELECT tablename, policyname, cmd 
FROM pg_policies 
WHERE tablename IN ('maintenance_issues','cleaning_tasks')
ORDER BY tablename, cmd;
