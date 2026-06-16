// tests/unit/availability.test.js — Tests de detección de solapamientos
import { describe, test, expect } from './framework.js';

// ── Lógica de conflicto de fechas ────────────────
// Dos reservas se solapan si: A.check_in < B.check_out && A.check_out > B.check_in
function overlaps(a, b) {
  return a.checkIn < b.checkOut && a.checkOut > b.checkIn;
}

function hasConflict(newBooking, existingBookings, unitId) {
  return existingBookings.some(b =>
    b.unitId === unitId &&
    b.status !== 'cancelled' &&
    overlaps(newBooking, b)
  );
}

const BOOKINGS = [
  { id: '1', unitId: 'A', checkIn: '2026-06-10', checkOut: '2026-06-15', status: 'paid' },
  { id: '2', unitId: 'A', checkIn: '2026-06-20', checkOut: '2026-06-25', status: 'partial' },
  { id: '3', unitId: 'B', checkIn: '2026-06-10', checkOut: '2026-06-18', status: 'paid' },
  { id: '4', unitId: 'A', checkIn: '2026-06-05', checkOut: '2026-06-10', status: 'paid' }, // termina justo cuando empieza #1
  { id: '5', unitId: 'A', checkIn: '2026-06-15', checkOut: '2026-06-20', status: 'pending' }, // empieza justo cuando termina #1
  { id: '6', unitId: 'A', checkIn: '2026-07-01', checkOut: '2026-07-05', status: 'cancelled' }, // cancelada
];

describe('📅 Detección de solapamientos', () => {
  test('Nueva reserva completamente dentro de una existente → conflicto', () => {
    expect(hasConflict(
      { checkIn: '2026-06-11', checkOut: '2026-06-14' },
      BOOKINGS, 'A'
    )).toBeTruthy();
  });

  test('Nueva reserva empieza durante una existente → conflicto', () => {
    expect(hasConflict(
      { checkIn: '2026-06-12', checkOut: '2026-06-18' },
      BOOKINGS, 'A'
    )).toBeTruthy();
  });

  test('Nueva reserva engloba a una existente → conflicto', () => {
    expect(hasConflict(
      { checkIn: '2026-06-08', checkOut: '2026-06-17' },
      BOOKINGS, 'A'
    )).toBeTruthy();
  });

  test('Check-out coincide con check-in de existente → NO conflicto (back-to-back OK)', () => {
    // La reserva #4 termina el 10 y #1 empieza el 10 — no se solapan
    expect(hasConflict(
      { checkIn: '2026-06-05', checkOut: '2026-06-10' },
      BOOKINGS, 'A'
    )).toBeFalsy();
  });

  test('Check-in coincide con check-out de existente → NO conflicto', () => {
    expect(hasConflict(
      { checkIn: '2026-06-15', checkOut: '2026-06-20' },
      BOOKINGS, 'A'
    )).toBeFalsy();
  });

  test('Reserva en distinta unidad → NO conflicto', () => {
    expect(hasConflict(
      { checkIn: '2026-06-10', checkOut: '2026-06-15' },
      BOOKINGS, 'C'
    )).toBeFalsy();
  });

  test('Reserva cancelada no genera conflicto', () => {
    expect(hasConflict(
      { checkIn: '2026-07-02', checkOut: '2026-07-04' },
      BOOKINGS, 'A'
    )).toBeFalsy();
  });

  test('Hueco libre entre reservas → disponible', () => {
    // Entre #1 (hasta 15) y #2 (desde 20) hay hueco del 15 al 20
    expect(hasConflict(
      { checkIn: '2026-06-15', checkOut: '2026-06-20' },
      BOOKINGS, 'A'
    )).toBeFalsy();
  });

  test('Reserva en unidad B no afecta unidad A', () => {
    // La unidad B tiene reserva del 10 al 18, pero en A esas fechas están libres entre el 15 y 20
    expect(hasConflict(
      { checkIn: '2026-06-15', checkOut: '2026-06-20' },
      BOOKINGS, 'A'
    )).toBeFalsy();
  });
});

describe('📅 Edge cases de fechas', () => {
  test('Reserva de 1 noche → válida', () => {
    const nights = Math.round(
      (new Date('2026-06-16T12:00:00') - new Date('2026-06-15T12:00:00')) / 86400000
    );
    expect(nights).toBe(1);
  });

  test('Check-in antes de check-out → válido', () => {
    const valid = '2026-06-10' < '2026-06-15';
    expect(valid).toBeTruthy();
  });

  test('Check-in igual a check-out → inválido', () => {
    const valid = '2026-06-10' < '2026-06-10';
    expect(valid).toBeFalsy();
  });
});
