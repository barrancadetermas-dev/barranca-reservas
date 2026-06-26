-- ================================================================
-- MILA PMS — RLS para maintenance_issues
-- Corrige los HEAD 400 en el badge de operaciones
-- ================================================================

-- Habilitar RLS (si no está habilitado)
ALTER TABLE maintenance_issues ENABLE ROW LEVEL SECURITY;

-- SELECT — staff del hotel puede ver sus issues
DROP POLICY IF EXISTS "maintenance_select" ON maintenance_issues;
CREATE POLICY "maintenance_select"
  ON maintenance_issues FOR SELECT TO authenticated
  USING (hotel_id = get_my_hotel_id());

-- INSERT
DROP POLICY IF EXISTS "maintenance_insert" ON maintenance_issues;
CREATE POLICY "maintenance_insert"
  ON maintenance_issues FOR INSERT TO authenticated
  WITH CHECK (hotel_id = get_my_hotel_id());

-- UPDATE
DROP POLICY IF EXISTS "maintenance_update" ON maintenance_issues;
CREATE POLICY "maintenance_update"
  ON maintenance_issues FOR UPDATE TO authenticated
  USING (hotel_id = get_my_hotel_id())
  WITH CHECK (hotel_id = get_my_hotel_id());

-- DELETE
DROP POLICY IF EXISTS "maintenance_delete" ON maintenance_issues;
CREATE POLICY "maintenance_delete"
  ON maintenance_issues FOR DELETE TO authenticated
  USING (hotel_id = get_my_hotel_id());

NOTIFY pgrst, 'reload schema';
