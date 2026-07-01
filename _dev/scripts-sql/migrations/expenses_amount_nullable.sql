-- Los gastos recurrentes se copian mes a mes SIN el monto (solo la
-- descripción/categoría/vencimiento se repiten); el monto se carga
-- de nuevo cada mes. Para eso amount debe poder quedar NULL hasta
-- que el usuario lo complete. $0 sigue siendo un valor válido.
ALTER TABLE expenses ALTER COLUMN amount DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
