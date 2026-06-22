-- ================================================================
-- MILA PMS — sql/01_user_profiles.sql
-- Agrega avatar_id y avatar_color a user_profiles (ya existe).
-- ================================================================

DO $$ BEGIN

  -- avatar_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'avatar_id'
  ) THEN
    ALTER TABLE user_profiles
      ADD COLUMN avatar_id SMALLINT NOT NULL DEFAULT 1
        CHECK (avatar_id BETWEEN 1 AND 8);
    RAISE NOTICE 'OK: avatar_id agregado.';
  ELSE
    RAISE NOTICE 'SKIP: avatar_id ya existe.';
  END IF;

  -- avatar_color
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'avatar_color'
  ) THEN
    ALTER TABLE user_profiles
      ADD COLUMN avatar_color TEXT NOT NULL DEFAULT '#4F46E5'
        CHECK (avatar_color ~ '^#[0-9A-Fa-f]{6}$');
    RAISE NOTICE 'OK: avatar_color agregado.';
  ELSE
    RAISE NOTICE 'SKIP: avatar_color ya existe.';
  END IF;

END $$;

-- Trigger de updated_at (si no existe)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Verificar columnas finales
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'user_profiles'
ORDER BY ordinal_position;

NOTIFY pgrst, 'reload schema';
