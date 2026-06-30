-- ─────────────────────────────────────────────────
-- Migración: rate_group en units
-- Agrupa unidades de forma ESTABLE en el Cuadro Tarifario,
-- independientemente de si tienen tarifa cargada o no.
-- Unidades con el mismo rate_group se muestran en una sola
-- fila (ej: "#2 | #3"). Unidades con rate_group = NULL nunca
-- se agrupan automáticamente entre sí salvo que compartan un
-- precio real cargado (ver groupRowsByPrice en tariff-service.js).
-- ─────────────────────────────────────────────────
ALTER TABLE units ADD COLUMN IF NOT EXISTS rate_group text;

COMMENT ON COLUMN units.rate_group IS
  'Agrupador manual para el Cuadro Tarifario. Unidades con el mismo valor (no nulo) se muestran juntas en una sola fila, sin importar si el precio coincide o está vacío. Se edita en Configuración → Departamentos / Unidades.';
