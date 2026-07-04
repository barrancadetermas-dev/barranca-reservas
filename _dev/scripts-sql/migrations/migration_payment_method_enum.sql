-- ═══════════════════════════════════════════════════
-- migration_payment_method_enum.sql
-- Ejecutar en Supabase SQL Editor — ESTO ES LA CAUSA
-- REAL del bug "la nota de crédito vuelve a $0".
--
-- El enum payment_method en la base solo tenía 6 valores
-- ('cash','transfer','mercadopago','naranjax','uala',
-- 'credit_card'), pero el formulario ofrece 8 opciones —
-- 'debit_card' y 'credit_note' nunca se agregaron acá.
-- Cualquier intento de guardar un pago con esos 2 métodos
-- fallaba con "invalid input value for enum payment_method"
-- — por eso el pago nunca se guardaba de verdad.
-- ═══════════════════════════════════════════════════

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'credit_note';
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'debit_card';
