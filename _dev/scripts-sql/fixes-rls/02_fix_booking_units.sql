-- ================================================================
-- MILA PMS — Fix 2: booking_units duplicate key
-- El error ocurre al EDITAR una reserva: intenta hacer INSERT
-- de una combinación booking_id+unit_id que ya existe.
-- Solución: función que hace DELETE + INSERT atómicamente.
-- ================================================================

-- Opción A (recomendada): Función que reemplaza las unidades de un booking
CREATE OR REPLACE FUNCTION set_booking_units(
  p_booking_id UUID,
  p_unit_ids   UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER AS $$
BEGIN
  -- Borrar asignaciones anteriores
  DELETE FROM booking_units WHERE booking_id = p_booking_id;

  -- Insertar las nuevas (sin duplicados posibles)
  IF array_length(p_unit_ids, 1) > 0 THEN
    INSERT INTO booking_units (booking_id, unit_id)
    SELECT p_booking_id, unnest(p_unit_ids);
  END IF;
END;
$$;

-- Uso desde JS:
-- const { error } = await supabase.rpc('set_booking_units', {
--   p_booking_id: bookingId,
--   p_unit_ids:   [unitId1, unitId2]
-- });

-- Opción B: Si preferís hacerlo directo desde JS sin RPC,
-- cambiar el INSERT por UPSERT en el código:
-- await supabase
--   .from('booking_units')
--   .upsert({ booking_id: bookingId, unit_id: unitId },
--            { onConflict: 'booking_id,unit_id' });

NOTIFY pgrst, 'reload schema';
