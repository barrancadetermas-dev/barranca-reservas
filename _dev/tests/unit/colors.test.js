// tests/unit/colors.test.js — Tests del sistema de colores por prioridad
import { describe, test, expect } from './framework.js';

// ── Replica de getBookingBarColor ────────────────
function getBookingBarColor(booking) {
  const status = booking?.status ?? 'pending';
  const source = booking?.source ?? 'direct';
  const isPast = booking?.check_out
    ? new Date(booking.check_out + 'T00:00:00') < new Date()
    : false;
  if (status === 'blocked' || booking?.is_blocked) return { label: 'Bloqueo',  priority: 1 };
  if (source === 'family')  return { label: 'Familia',  priority: 2 };
  if (source === 'airbnb')  return { label: 'Airbnb',   priority: 3 };
  if (source === 'booking') return { label: 'Booking',  priority: 4 };
  if (status === 'paid')    return { label: 'Pagado',   priority: 5 };
  if (status === 'partial') return { label: 'Con seña', priority: 6 };
  return { label: 'Sin seña', priority: 7 };
}

describe('🎨 Prioridad de colores', () => {
  test('Bloqueo siempre tiene prioridad máxima (1)', () => {
    const r = getBookingBarColor({ status: 'blocked', source: 'airbnb' });
    expect(r.priority).toBe(1);
  });
  test('Bloqueo por is_blocked también tiene prioridad 1', () => {
    const r = getBookingBarColor({ is_blocked: true, source: 'booking', status: 'paid' });
    expect(r.priority).toBe(1);
  });
  test('Familia tiene prioridad 2 (mayor que cualquier estado de pago)', () => {
    const r = getBookingBarColor({ source: 'family', status: 'paid' });
    expect(r.priority).toBe(2);
  });
  test('Airbnb tiene prioridad 3', () => {
    const r = getBookingBarColor({ source: 'airbnb', status: 'paid' });
    expect(r.priority).toBe(3);
  });
  test('Booking tiene prioridad 4', () => {
    const r = getBookingBarColor({ source: 'booking', status: 'paid' });
    expect(r.priority).toBe(4);
  });
  test('Pagado directo tiene prioridad 5', () => {
    const r = getBookingBarColor({ source: 'direct', status: 'paid' });
    expect(r.priority).toBe(5);
  });
  test('Con seña tiene prioridad 6', () => {
    const r = getBookingBarColor({ source: 'direct', status: 'partial' });
    expect(r.priority).toBe(6);
  });
  test('Sin seña tiene prioridad mínima (7)', () => {
    const r = getBookingBarColor({ source: 'direct', status: 'pending' });
    expect(r.priority).toBe(7);
  });
});

describe('🎨 Labels correctos', () => {
  test('Bloqueo → label "Bloqueo"',    () => expect(getBookingBarColor({ status: 'blocked' }).label).toBe('Bloqueo'));
  test('Familia → label "Familia"',    () => expect(getBookingBarColor({ source: 'family'  }).label).toBe('Familia'));
  test('Airbnb  → label "Airbnb"',    () => expect(getBookingBarColor({ source: 'airbnb'  }).label).toBe('Airbnb'));
  test('Booking → label "Booking"',   () => expect(getBookingBarColor({ source: 'booking' }).label).toBe('Booking'));
  test('Pagado  → label "Pagado"',    () => expect(getBookingBarColor({ status: 'paid'    }).label).toBe('Pagado'));
  test('Parcial → label "Con seña"',  () => expect(getBookingBarColor({ status: 'partial' }).label).toBe('Con seña'));
  test('Pending → label "Sin seña"',  () => expect(getBookingBarColor({ status: 'pending' }).label).toBe('Sin seña'));
});

describe('🎨 Paleta de unidades', () => {
  const UNIT_PALETTE = { 1:'#EF4444', 2:'#3B82F6', 3:'#22D3EE', 4:'#84CC16', 5:'#38BDF8', 6:'#F472B6', 7:'#C084FC' };
  test('7 unidades tienen color asignado', () => {
    expect(Object.keys(UNIT_PALETTE).length).toBe(7);
  });
  test('Unidad 1 es roja (#EF4444)', () => {
    expect(UNIT_PALETTE[1]).toBe('#EF4444');
  });
  test('Unidad 7 es lila (#C084FC)', () => {
    expect(UNIT_PALETTE[7]).toBe('#C084FC');
  });
  test('Todos los colores son hexadecimales válidos', () => {
    Object.values(UNIT_PALETTE).forEach(c => {
      expect(/^#[0-9A-Fa-f]{6}$/.test(c)).toBeTruthy();
    });
  });
});
