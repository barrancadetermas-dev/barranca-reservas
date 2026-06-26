-- ═══════════════════════════════════════════════════
-- migration_v3_identification.sql
-- Sistema Visual Unificado de Departamentos — Sira
-- Actualiza nombres, colores y schema de origen
-- ═══════════════════════════════════════════════════

-- ── 1. Actualizar nombres y colores de unidades ─────
DO $$
DECLARE
  v_hotel_id UUID;
BEGIN
  SELECT id INTO v_hotel_id FROM hotels WHERE slug = 'barranca-de-termas';

  IF v_hotel_id IS NULL THEN
    RAISE EXCEPTION 'Hotel barranca-de-termas no encontrado. Ejecutá seed.sql primero.';
  END IF;

  -- #1 🟥 Rojo
  UPDATE units SET
    name       = '3AMB Duplex',
    color      = '#EF4444',
    sort_order = 1,
    description= '3 ambientes, dúplex completo. Hasta 6 personas.'
  WHERE hotel_id = v_hotel_id AND sort_order = 1;

  -- #2 🟦 Azul
  UPDATE units SET
    name       = '2AMB Duplex',
    color      = '#3B82F6',
    sort_order = 2,
    description= '2 ambientes, planta dúplex. Hasta 5 personas.'
  WHERE hotel_id = v_hotel_id AND sort_order = 2;

  -- #3 🩵 Aqua
  UPDATE units SET
    name       = '2AMB Duplex',
    color      = '#22D3EE',
    sort_order = 3,
    description= '2 ambientes, planta dúplex. Hasta 5 personas.'
  WHERE hotel_id = v_hotel_id AND sort_order = 3;

  -- #4 🟩 Verde Manzana
  UPDATE units SET
    name       = '2AMB Planta Baja',
    color      = '#84CC16',
    sort_order = 4,
    description= '2 ambientes, planta baja. Hasta 4 personas.'
  WHERE hotel_id = v_hotel_id AND sort_order = 4;

  -- #5 🩵 Celeste
  UPDATE units SET
    name       = '2AMB Planta Baja',
    color      = '#38BDF8',
    sort_order = 5,
    description= '2 ambientes, planta baja. Hasta 4 personas.'
  WHERE hotel_id = v_hotel_id AND sort_order = 5;

  -- #6 🩷 Rosa Bebé
  UPDATE units SET
    name       = '2AMB Planta Alta',
    color      = '#F472B6',
    sort_order = 6,
    description= '2 ambientes, planta alta. Hasta 4 personas.'
  WHERE hotel_id = v_hotel_id AND sort_order = 6;

  -- #7 🟪 Lila
  UPDATE units SET
    name       = '2AMB Planta Alta',
    color      = '#C084FC',
    sort_order = 7,
    description= '2 ambientes, planta alta. Hasta 4 personas.'
  WHERE hotel_id = v_hotel_id AND sort_order = 7;

  RAISE NOTICE '✅ Unidades actualizadas para hotel: %', v_hotel_id;
END $$;

-- ── 2. Agregar columna unit_number (alias de sort_order) ──
-- sort_order YA funciona como número de unidad (1-7)
-- Agregamos una columna generada para mayor claridad
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS unit_number INTEGER GENERATED ALWAYS AS (sort_order) STORED;

-- ── 3. Actualizar fuente de reservas existentes ──────
-- Las reservas sin seña siguen como 'direct'
-- Solo agregar check constraint para futuros valores
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS chk_booking_source;
ALTER TABLE bookings
  ADD CONSTRAINT chk_booking_source
  CHECK (source IN ('direct','booking','airbnb','family'));

-- ── 4. Vista enriquecida de reservas con unidad ─────
CREATE OR REPLACE VIEW bookings_enriched AS
SELECT
  b.*,
  g.first_name,
  g.last_name,
  g.first_name || ' ' || g.last_name AS guest_name,
  g.phone AS guest_phone,
  g.email AS guest_email,
  g.bad_experience,
  array_agg(DISTINCT u.sort_order) AS unit_numbers,
  array_agg(DISTINCT u.name)       AS unit_names,
  array_agg(DISTINCT u.color)      AS unit_colors,
  -- Label unificado: "#1 · 3AMB Duplex, #2 · 2AMB Duplex"
  string_agg(DISTINCT '#' || u.sort_order || ' · ' || u.name, ', ' ORDER BY '#' || u.sort_order || ' · ' || u.name) AS units_label
FROM bookings b
LEFT JOIN guests g ON g.id = b.guest_id
LEFT JOIN booking_units bu ON bu.booking_id = b.id
LEFT JOIN units u ON u.id = bu.unit_id
GROUP BY b.id, g.id;

-- ── 5. Realtime para units ────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE units;

-- ── 6. Verificación ──────────────────────────────────
SELECT
  sort_order AS "#",
  '#' || sort_order || ' · ' || name AS "Identificador",
  color AS "Color",
  max_guests AS "Cap. máx."
FROM units
WHERE hotel_id = (SELECT id FROM hotels WHERE slug = 'barranca-de-termas')
ORDER BY sort_order;
