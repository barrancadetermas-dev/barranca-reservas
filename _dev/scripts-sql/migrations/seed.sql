-- ═══════════════════════════════════════════════════
-- seed.sql — Datos iniciales de Barranca de Termas
-- Ejecutar DESPUÉS del schema SQL principal
-- ═══════════════════════════════════════════════════
 
-- 1. Hotel
INSERT INTO hotels (slug, name, currency, timezone, settings)
VALUES (
  'barranca-de-termas',
  'Barranca de Termas',
  'ARS',
  'America/Argentina/Buenos_Aires',
  '{"credit_card_surcharge": 0.10, "max_notes_length": 200}'
)
ON CONFLICT (slug) DO UPDATE SET
  name     = EXCLUDED.name,
  settings = EXCLUDED.settings;
 
-- 2. Unidades del complejo (7 apartamentos)
DO $$
DECLARE
  v_hotel_id UUID;
BEGIN
  SELECT id INTO v_hotel_id FROM hotels WHERE slug = 'barranca-de-termas';
 
  -- Eliminar unidades existentes para evitar duplicados
  DELETE FROM units WHERE hotel_id = v_hotel_id;
 
  INSERT INTO units (hotel_id, name, description, max_guests, floor, sort_order, color, is_active)
  VALUES
    (v_hotel_id, '3AMB Duplex',     '3 ambientes, dúplex completo. Hasta 6 personas.',      6, 'Duplex', 1, '#EF4444', TRUE),
    (v_hotel_id, '2AMB Duplex',     '2 ambientes, planta dúplex. Hasta 5 personas.',         5, 'Duplex', 2, '#3B82F6', TRUE),
    (v_hotel_id, '2AMB Duplex',     '2 ambientes, planta dúplex. Hasta 5 personas.',         5, 'Duplex', 3, '#22D3EE', TRUE),
    (v_hotel_id, '2AMB Planta Baja','2 ambientes, planta baja. Hasta 4 personas.',           4, 'PB',     4, '#84CC16', TRUE),
    (v_hotel_id, '2AMB Planta Baja','2 ambientes, planta baja. Hasta 4 personas.',           4, 'PB',     5, '#38BDF8', TRUE),
    (v_hotel_id, '2AMB Planta Alta','2 ambientes, planta alta. Hasta 4 personas.',           4, 'PA',     6, '#F472B6', TRUE),
    (v_hotel_id, '2AMB Planta Alta','2 ambientes, planta alta. Hasta 4 personas.',           4, 'PA',     7, '#C084FC', TRUE);
 
  RAISE NOTICE 'Unidades insertadas para hotel: %', v_hotel_id;
END $$;
 
-- 3. Primer usuario admin (ajustar email según tu cuenta Supabase Auth)
-- NOTA: El usuario debe crearse en Supabase Auth Dashboard primero.
-- Luego ejecutar esto con el UUID real del usuario:
/*
DO $$
DECLARE
  v_hotel_id UUID;
  v_user_id  UUID := 'UUID_DEL_USUARIO_EN_AUTH'; -- ← REEMPLAZAR
BEGIN
  SELECT id INTO v_hotel_id FROM hotels WHERE slug = 'barranca-de-termas';
  INSERT INTO hotel_users (hotel_id, user_id, role)
  VALUES (v_hotel_id, v_user_id, 'admin')
  ON CONFLICT (hotel_id, user_id) DO NOTHING;
END $$;
*/
 
-- 4. Cotización de ejemplo (para testing)
INSERT INTO exchange_rates (date, rate_buy, rate_sell, source)
VALUES (CURRENT_DATE, 1050.00, 1090.00, 'seed')
ON CONFLICT (date, source) DO NOTHING;
 
-- Verificación
SELECT
  h.name AS hotel,
  COUNT(u.id) AS unidades
FROM hotels h
LEFT JOIN units u ON u.hotel_id = h.id
WHERE h.slug = 'barranca-de-termas'
GROUP BY h.name;