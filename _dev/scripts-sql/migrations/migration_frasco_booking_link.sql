-- migration_frasco_booking_link.sql
-- Agrega columna booking_id a frasco_items para asociar frascos a reservas
-- La columna es nullable (no todos los frascos tienen reserva asociada)

ALTER TABLE frasco_items
  ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL;

-- Índice para consultas por reserva
CREATE INDEX IF NOT EXISTS idx_frasco_items_booking_id ON frasco_items(booking_id);

-- Comentario
COMMENT ON COLUMN frasco_items.booking_id IS 
  'Reserva asociada al frasco (opcional). Cuando se asocia, la fecha de acreditación sugiere el check-in de la reserva.';
