-- Permite marcar un gasto como recurrente para que se auto-cargue
-- (descripción, categoría y último monto) en el mes siguiente,
-- necesitando sólo ajustar monto y vencimiento.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
