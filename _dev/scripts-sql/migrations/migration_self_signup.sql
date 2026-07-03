-- ═══════════════════════════════════════════════════
-- migration_self_signup.sql
-- Ejecutar en Supabase SQL Editor — REQUISITO para que
-- setup.html funcione. Sin esto, el wizard se traba en
-- el paso de crear el hotel (RLS lo bloquea).
--
-- Qué hace: agrega 2 políticas de INSERT bien acotadas,
-- no toca ni afloja las políticas de aislamiento que ya
-- existen (SELECT/UPDATE/DELETE siguen exactamente igual
-- que hoy — un usuario solo ve/edita SU hotel).
-- ═══════════════════════════════════════════════════

-- 1) Cualquier usuario logueado puede crear UN hotel (el suyo).
--    No puede ver ni tocar otros hoteles — eso lo sigue bloqueando
--    la política "hotel_isolation" que ya existe.
DROP POLICY IF EXISTS "hotels_self_signup_insert" ON hotels;
CREATE POLICY "hotels_self_signup_insert" ON hotels FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- 2) Un usuario puede vincularse a SÍ MISMO como admin de un hotel
--    (no puede asignarse a otro usuario, ni asignarse a un hotel
--    ajeno como "staff" para colarse — el registro debe ser el
--    propio auth.uid() y el rol debe ser 'admin').
DROP POLICY IF EXISTS "hotel_users_self_signup_insert" ON hotel_users;
CREATE POLICY "hotel_users_self_signup_insert" ON hotel_users FOR INSERT
  WITH CHECK (user_id = auth.uid() AND role = 'admin');
