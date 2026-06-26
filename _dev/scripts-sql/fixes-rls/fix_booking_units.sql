-- ================================================================
-- MILA PMS — sql/fix_booking_units.sql
-- Fix: duplicate key value violates unique constraint booking_units_booking_id_unit_id_key
-- Crea función RPC que hace DELETE+INSERT atómico al editar una reserva.
-- ================================================================

CREATE OR REPLACE FUNCTION set_booking_units(
  p_booking_id UUID,
  p_unit_ids   UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER AS $$
BEGIN
  DELETE FROM booking_units WHERE booking_id = p_booking_id;
  IF array_length(p_unit_ids, 1) > 0 THEN
    INSERT INTO booking_units (booking_id, unit_id)
    SELECT p_booking_id, unnest(p_unit_ids);
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- Reemplazar en el código JS:
-- ANTES: await supabase.from('booking_units').insert({ booking_id, unit_id })
-- DESPUÉS:
-- await supabase.rpc('set_booking_units', {
--   p_booking_id: bookingId,
--   p_unit_ids:   [unitId]   ← array aunque sea un solo elemento
-- });
