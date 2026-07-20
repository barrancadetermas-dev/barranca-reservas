-- migration_waitlist_source.sql
-- Agrega columna source (origen de la consulta) a la lista de espera
-- Valores: instagram, whatsapp, booking, airbnb, directo, telefono, otro

ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT NULL;

COMMENT ON COLUMN waitlist.source IS
  'Origen de la consulta: instagram, whatsapp, booking, airbnb, directo, telefono, otro';
