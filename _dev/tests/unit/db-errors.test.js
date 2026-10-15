// tests/unit/db-errors.test.js — Mensajes de error de base de datos (módulo real)
import { describe, test, expect } from './framework.js';
import { friendlyDbError } from '../../../js/utils/db-errors.js';

describe('🧯 friendlyDbError', () => {
  test('canal rechazado por la restricción → nombra el canal y la migración', () => {
    const m = friendlyDbError({ code: '23514', message: 'new row for relation "bookings" violates check constraint "chk_booking_source"' }, { source: 'walkin' });
    expect(m).toContain('Espontáneo'); expect(m).toContain('migration_booking_source_channels.sql');
  });
  test('otra restricción CHECK → indica la regla', () => {
    expect(friendlyDbError({ code: '23514', message: 'violates check constraint "chk_otra"' })).toContain('chk_otra');
  });
  test('RLS → mensaje de permisos', () => {
    expect(friendlyDbError({ message: 'new row violates row-level security policy for table "bookings"' })).toContain('permisos');
  });
  test('sin conexión', () => { expect(friendlyDbError(new Error('Failed to fetch'))).toContain('conexión'); });
  test('FK y not-null', () => {
    expect(friendlyDbError({ code: '23503', message: 'x' })).toContain('relacionado');
    expect(friendlyDbError({ code: '23502', message: 'null value in column "guest_id" violates not-null constraint' })).toContain('guest_id');
  });
  test('error vacío → mensaje genérico, nunca vacío', () => {
    expect(friendlyDbError(undefined).length > 10).toBe(true); expect(friendlyDbError('').length > 10).toBe(true);
  });
  test('texto desconocido se conserva', () => { expect(friendlyDbError(new Error('algo raro'))).toBe('algo raro'); });
});
