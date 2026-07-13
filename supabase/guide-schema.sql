-- ══════════════════════════════════════════════════════
-- GUÍA DEL HUÉSPED — Schema Supabase
-- Ejecutar en el SQL Editor de Supabase
-- ══════════════════════════════════════════════════════

-- 1. Configuración general de la guía
CREATE TABLE IF NOT EXISTS guide_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  hotel_name      text,
  welcome_text    text,
  cover_url       text,
  logo_url        text,
  primary_color   text DEFAULT '#1e40af',
  whatsapp        text,
  phone           text,
  email           text,
  address         text,
  coords_lat      numeric(10,7),
  coords_lng      numeric(10,7),
  maps_embed_url  text,
  wifi_ssid       text,
  wifi_password   text,
  checkin_time    text DEFAULT '14:00',
  checkout_time   text DEFAULT '10:00',
  reception_hours text DEFAULT '8:00 a 22:00',
  whatsapp_hours  text DEFAULT '9:00 a 20:00',
  instagram_url   text,
  facebook_url    text,
  is_published    boolean DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE(hotel_id)
);

-- 2. Secciones visibles y su orden
CREATE TABLE IF NOT EXISTS guide_sections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  key         text NOT NULL, -- welcome, quickinfo, howtoget, weather, visit, places, discounts, rules, emergencies, faq, contact
  title       text NOT NULL,
  icon        text NOT NULL,
  is_visible  boolean DEFAULT true,
  sort_order  int  DEFAULT 0,
  UNIQUE(hotel_id, key)
);

-- 3. Todos los ítems (restaurantes, atracciones, reglas, emergencias, descuentos, comercios)
CREATE TABLE IF NOT EXISTS guide_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  section_key  text NOT NULL, -- places, visit, discounts, rules, emergencies
  category     text,          -- Para places: restaurants, supermarkets, pharmacies, etc.
  name         text NOT NULL,
  description  text,
  address      text,
  coords_lat   numeric(10,7),
  coords_lng   numeric(10,7),
  phone        text,
  whatsapp     text,
  photo_url    text,
  extra_json   jsonb DEFAULT '{}', -- Para campos específicos: precio, horarios, vigencia, descuento, etc.
  sort_order   int  DEFAULT 0,
  is_visible   boolean DEFAULT true,
  created_at   timestamptz DEFAULT now()
);

-- 4. Preguntas frecuentes
CREATE TABLE IF NOT EXISTS guide_faqs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  question    text NOT NULL,
  answer      text NOT NULL,
  sort_order  int  DEFAULT 0,
  is_visible  boolean DEFAULT true
);

-- 5. Analytics de visitas (INSERT público, sin datos personales)
CREATE TABLE IF NOT EXISTS guide_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  section     text,
  viewed_at   timestamptz DEFAULT now()
);

-- ══ Índices ══
CREATE INDEX IF NOT EXISTS idx_guide_items_hotel   ON guide_items(hotel_id, section_key);
CREATE INDEX IF NOT EXISTS idx_guide_items_section ON guide_items(section_key, sort_order);
CREATE INDEX IF NOT EXISTS idx_guide_faqs_hotel    ON guide_faqs(hotel_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_guide_views_hotel   ON guide_views(hotel_id, viewed_at);
CREATE INDEX IF NOT EXISTS idx_guide_sections_hotel ON guide_sections(hotel_id, sort_order);

-- ══ RLS ══
ALTER TABLE guide_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE guide_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE guide_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE guide_faqs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE guide_views    ENABLE ROW LEVEL SECURITY;

-- Lectura pública (guía) — solo si está publicada
CREATE POLICY "guide_config_public_read" ON guide_config
  FOR SELECT TO anon USING (is_published = true);
CREATE POLICY "guide_sections_public_read" ON guide_sections
  FOR SELECT TO anon USING (is_visible = true);
CREATE POLICY "guide_items_public_read" ON guide_items
  FOR SELECT TO anon USING (is_visible = true);
CREATE POLICY "guide_faqs_public_read" ON guide_faqs
  FOR SELECT TO anon USING (is_visible = true);

-- Analytics: INSERT anónimo
CREATE POLICY "guide_views_public_insert" ON guide_views
  FOR INSERT TO anon WITH CHECK (true);

-- Admin: acceso total para autenticados
CREATE POLICY "guide_config_auth_all"   ON guide_config   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "guide_sections_auth_all" ON guide_sections FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "guide_items_auth_all"    ON guide_items    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "guide_faqs_auth_all"     ON guide_faqs     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "guide_views_auth_read"   ON guide_views    FOR SELECT TO authenticated USING (true);

-- ══ Función updated_at ══
CREATE OR REPLACE FUNCTION update_guide_config_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER guide_config_updated_at
  BEFORE UPDATE ON guide_config
  FOR EACH ROW EXECUTE FUNCTION update_guide_config_updated_at();

-- ══ Secciones por defecto (insertar después de crear guide_config) ══
-- Ejecutar reemplazando <HOTEL_ID> con el ID real:
/*
INSERT INTO guide_sections (hotel_id, key, title, icon, sort_order) VALUES
  ('<HOTEL_ID>', 'quickinfo',  'Info rápida',             '⚡', 1),
  ('<HOTEL_ID>', 'howtoget',   'Cómo llegar',             '📍', 2),
  ('<HOTEL_ID>', 'weather',    'Clima',                   '🌤', 3),
  ('<HOTEL_ID>', 'visit',      'Qué visitar',             '🎡', 4),
  ('<HOTEL_ID>', 'places',     'Dónde comer y comprar',   '🍽', 5),
  ('<HOTEL_ID>', 'discounts',  'Descuentos y beneficios', '🎁', 6),
  ('<HOTEL_ID>', 'rules',      'Reglas del complejo',     '📜', 7),
  ('<HOTEL_ID>', 'emergencies','Emergencias',             '🚨', 8),
  ('<HOTEL_ID>', 'faq',        'Preguntas frecuentes',    '❓', 9),
  ('<HOTEL_ID>', 'contact',    'Contacto',                '📞', 10)
ON CONFLICT (hotel_id, key) DO NOTHING;
*/
