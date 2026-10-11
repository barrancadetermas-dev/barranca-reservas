// tests/unit/stay-segments.test.js — Tramos de estadía (módulo REAL, no una copia)
import { describe, test, expect } from './framework.js';
import {
  getSegments, isSplit, occupiesNight, unitIdsOnNight, overlapsRange, unitNightsInRange,
  arrivalSegments, departureSegments, handoffs, segmentsSubtotal, validateSegments,
  toBookingUnitRows, twoSegments, nightsBetween, addDays, describeSegment,
} from '../../../js/services/stay-segments.js';

// Reserva #1234: 10/01→13/01, Depto 2 (2 noches a $50.000) + Depto 5 (1 noche a $60.000)
const B1234 = {
  check_in: '2026-01-10', check_out: '2026-01-13',
  booking_units: [
    { unit_id: 'D5', price_per_night: 60000, segment_check_in: '2026-01-12', segment_check_out: '2026-01-13', units: { name: 'Depto 5' } },
    { unit_id: 'D2', price_per_night: 50000, segment_check_in: '2026-01-10', segment_check_out: '2026-01-12', units: { name: 'Depto 2' } },
  ],
};
// Reserva #1235: 15/01→18/01, Depto 3 (1 noche) + Depto 6 (2 noches)
const B1235 = {
  check_in: '2026-01-15', check_out: '2026-01-18',
  booking_units: [
    { unit_id: 'D3', segment_check_in: '2026-01-15', segment_check_out: '2026-01-16' },
    { unit_id: 'D6', segment_check_in: '2026-01-16', segment_check_out: '2026-01-18' },
  ],
};
// Reserva vieja (sin tramos, columnas NULL / ausentes)
const LEGACY = { check_in: '2026-02-01', check_out: '2026-02-05', booking_units: [{ unit_id: 'A' }] };
// Dos deptos simultáneos (sin tramos)
const PARALLEL = { check_in: '2026-02-01', check_out: '2026-02-04',
  booking_units: [{ unit_id: 'A', price_per_night: 40000 }, { unit_id: 'B', price_per_night: 30000 }] };

describe('🔀 Tramos: lectura y orden', () => {
  test('#1234 se ordena cronológicamente (D2 antes que D5) aunque venga al revés', () => {
    expect(getSegments(B1234).map(s => s.unit_id)).toEqual(['D2', 'D5']);
  });
  test('#1234 noches por tramo: 2 + 1 = 3', () => {
    expect(getSegments(B1234).map(s => s.nights)).toEqual([2, 1]);
  });
  test('#1234 y #1235 son cambios de departamento', () => {
    expect(isSplit(B1234)).toBe(true); expect(isSplit(B1235)).toBe(true);
  });
  test('reserva vieja: 1 tramo que cubre toda la estadía y NO es split', () => {
    const s = getSegments(LEGACY);
    expect(s.length).toBe(1); expect(s[0].from).toBe('2026-02-01'); expect(s[0].to).toBe('2026-02-05');
    expect(s[0].nights).toBe(4); expect(isSplit(LEGACY)).toBe(false);
  });
  test('dos deptos simultáneos: 2 tramos completos y NO es split', () => {
    expect(getSegments(PARALLEL).length).toBe(2); expect(isSplit(PARALLEL)).toBe(false);
  });
  test('reserva sin fechas o sin unidades → sin tramos (no explota)', () => {
    expect(getSegments({}).length).toBe(0); expect(getSegments({ check_in: '2026-01-01', check_out: '2026-01-02' }).length).toBe(0);
  });
});

describe('🛏 Tramos: ocupación por noche (disponibilidad)', () => {
  test('#1234: D2 ocupa 10 y 11; NO ocupa la noche del 12', () => {
    expect(occupiesNight(B1234, 'D2', '2026-01-10')).toBe(true);
    expect(occupiesNight(B1234, 'D2', '2026-01-11')).toBe(true);
    expect(occupiesNight(B1234, 'D2', '2026-01-12')).toBe(false);
  });
  test('#1234: D5 queda LIBRE el 10 y 11 y ocupado el 12; libre el 13 (check-out)', () => {
    expect(occupiesNight(B1234, 'D5', '2026-01-10')).toBe(false);
    expect(occupiesNight(B1234, 'D5', '2026-01-11')).toBe(false);
    expect(occupiesNight(B1234, 'D5', '2026-01-12')).toBe(true);
    expect(occupiesNight(B1234, 'D5', '2026-01-13')).toBe(false);
  });
  test('#1234: otra reserva puede tomar D5 del 10 al 12 (recambio exacto el 12) sin conflicto', () => {
    expect(overlapsRange(B1234, 'D5', '2026-01-10', '2026-01-12')).toBe(false);
  });
  test('#1234: otra reserva en D5 del 11 al 13 SÍ choca (pisa la noche del 12)', () => {
    expect(overlapsRange(B1234, 'D5', '2026-01-11', '2026-01-13')).toBe(true);
  });
  test('reserva vieja: ocupa todas sus noches', () => {
    expect(occupiesNight(LEGACY, 'A', '2026-02-01')).toBe(true);
    expect(occupiesNight(LEGACY, 'A', '2026-02-04')).toBe(true);
    expect(occupiesNight(LEGACY, 'A', '2026-02-05')).toBe(false);
  });
  test('unitIdsOnNight en el día del cambio devuelve solo el depto nuevo', () => {
    expect(unitIdsOnNight(B1234, '2026-01-11')).toEqual(['D2']);
    expect(unitIdsOnNight(B1234, '2026-01-12')).toEqual(['D5']);
    expect(unitIdsOnNight(PARALLEL, '2026-02-02').length).toBe(2);
  });
});

describe('📊 Tramos: noches por unidad (estadísticas)', () => {
  test('#1234 en enero: D2 = 2 noches, D5 = 1 noche (total 3, no 6)', () => {
    expect(unitNightsInRange(B1234, 'D2', '2026-01-01', '2026-02-01')).toBe(2);
    expect(unitNightsInRange(B1234, 'D5', '2026-01-01', '2026-02-01')).toBe(1);
  });
  test('ventana parcial: solo la noche del 11 → D2 = 1, D5 = 0', () => {
    expect(unitNightsInRange(B1234, 'D2', '2026-01-11', '2026-01-12')).toBe(1);
    expect(unitNightsInRange(B1234, 'D5', '2026-01-11', '2026-01-12')).toBe(0);
  });
  test('reserva que cruza de mes se recorta a la ventana', () => {
    const b = { check_in: '2026-01-30', check_out: '2026-02-03', booking_units: [{ unit_id: 'A' }] };
    expect(unitNightsInRange(b, 'A', '2026-01-01', '2026-02-01')).toBe(2);
    expect(unitNightsInRange(b, 'A', '2026-02-01', '2026-03-01')).toBe(2);
  });
});

describe('💰 Tramos: precio', () => {
  test('#1234: subtotal = 2×50.000 + 1×60.000 = 160.000', () => {
    expect(segmentsSubtotal(getSegments(B1234))).toBe(160000);
  });
  test('dos deptos simultáneos: 3 noches × (40.000 + 30.000) = 210.000', () => {
    expect(segmentsSubtotal(getSegments(PARALLEL))).toBe(210000);
  });
  test('si algún tramo no tiene precio → null (no inventar un total)', () => {
    expect(segmentsSubtotal(getSegments(B1235))).toBe(null);
  });
});

describe('🚪 Tramos: check-in/out y cambios', () => {
  test('#1234: el check-in es en D2 y el check-out en D5', () => {
    expect(arrivalSegments(B1234).map(s => s.unit_id)).toEqual(['D2']);
    expect(departureSegments(B1234).map(s => s.unit_id)).toEqual(['D5']);
  });
  test('#1234: un cambio el 12/01 de D2 a D5', () => {
    expect(handoffs(B1234)).toEqual([{ date: '2026-01-12', leaving: ['D2'], entering: ['D5'] }]);
  });
  test('reserva simple o simultánea: sin cambios', () => {
    expect(handoffs(LEGACY).length).toBe(0); expect(handoffs(PARALLEL).length).toBe(0);
  });
});

describe('🛡 Tramos: autocorrección de datos desfasados', () => {
  test('reserva acortada (check-out 12/01) → el tramo de D5 desaparece y D2 se mantiene', () => {
    const b = { ...B1234, check_out: '2026-01-12' };
    expect(getSegments(b).map(s => s.unit_id)).toEqual(['D2']);
    expect(isSplit(b)).toBe(false);
  });
  test('reserva desplazada: tramo fuera de ventana se recorta', () => {
    const b = { ...B1234, check_in: '2026-01-11' };
    const s = getSegments(b);
    expect(s[0].from).toBe('2026-01-11'); expect(s[0].nights).toBe(1);
  });
});

describe('✅ Tramos: validación', () => {
  const W = { check_in: '2026-01-10', check_out: '2026-01-13' };
  test('2 tramos consecutivos sin huecos → válido', () => {
    expect(validateSegments(W, twoSegments(W, 'D2', 'D5', '2026-01-12')).ok).toBe(true);
  });
  test('hueco (noche sin depto) → inválido y dice la fecha', () => {
    const r = validateSegments(W, [{ unit_id: 'D2', from: '2026-01-10', to: '2026-01-11' }, { unit_id: 'D5', from: '2026-01-12', to: '2026-01-13' }]);
    expect(r.ok).toBe(false); expect(r.errors[0]).toContain('11/01/2026');
  });
  test('depto repetido → inválido', () => {
    expect(validateSegments(W, twoSegments(W, 'D2', 'D2', '2026-01-12')).ok).toBe(false);
  });
  test('tramo fuera de la reserva → inválido', () => {
    expect(validateSegments(W, [{ unit_id: 'D2', from: '2026-01-09', to: '2026-01-13' }]).ok).toBe(false);
  });
  test('hasta <= desde → inválido', () => {
    expect(validateSegments(W, [{ unit_id: 'D2', from: '2026-01-12', to: '2026-01-12' }]).ok).toBe(false);
  });
  test('dos deptos simultáneos que cubren todo → válido', () => {
    expect(validateSegments(W, [{ unit_id: 'A', from: W.check_in, to: W.check_out }, { unit_id: 'B', from: W.check_in, to: W.check_out }]).ok).toBe(true);
  });
  test('sin tramos → inválido', () => { expect(validateSegments(W, []).ok).toBe(false); });
});

describe('💾 Tramos: filas a guardar', () => {
  const W = { check_in: '2026-01-10', check_out: '2026-01-13' };
  test('un tramo que cubre todo se guarda con segment_* NULL (formato histórico)', () => {
    const rows = toBookingUnitRows(W, [{ unit_id: 'A', from: W.check_in, to: W.check_out, pricePerNight: 5 }], 'bk');
    expect(rows[0].segment_check_in).toBe(null); expect(rows[0].segment_check_out).toBe(null);
    expect(rows[0].booking_id).toBe('bk'); expect(rows[0].price_per_night).toBe(5);
  });
  test('tramos parciales conservan sus fechas', () => {
    const rows = toBookingUnitRows(W, twoSegments(W, 'D2', 'D5', '2026-01-12'));
    expect(rows[0].segment_check_out).toBe('2026-01-12'); expect(rows[1].segment_check_in).toBe('2026-01-12');
  });
});

describe('🗓 Utilidades de fecha', () => {
  test('nightsBetween y addDays cruzan fin de mes y año bisiesto', () => {
    expect(nightsBetween('2026-01-30', '2026-02-02')).toBe(3);
    expect(nightsBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  test('describeSegment', () => {
    expect(describeSegment(getSegments(B1234)[0], 'Depto 2')).toBe('10/01 → 12/01 · Depto 2 · 2 noches');
    expect(describeSegment(getSegments(B1234)[1], 'Depto 5')).toBe('12/01 → 13/01 · Depto 5 · 1 noche');
  });
});

// ── Estadísticas por unidad (función real compartida con el worker) ──
import { computeUnitStats } from '../../../js/services/unit-stats.js';
describe('📈 Estadísticas por unidad con tramos', () => {
  const units = [{ id: 'D2' }, { id: 'D5' }, { id: 'D3' }];
  const run = bookings => Object.fromEntries(computeUnitStats({ bookings, units, firstDay: '2026-01-01', lastDay: '2026-01-31', daysInMonth: 31 })
    .map(s => [s.unit.id, s]));
  test('#1234: D2 = 2 noches/$100.000 y D5 = 1 noche/$60.000 (antes: 6 noches/$330.000)', () => {
    const r = run([{ ...B1234, price_per_night: 53333, total_amount: 160000, free_nights: 0 }]);
    expect(r.D2.nightsOcc).toBe(2); expect(r.D2.revenue).toBe(100000);
    expect(r.D5.nightsOcc).toBe(1); expect(r.D5.revenue).toBe(60000);
    expect(r.D2.nightsOcc + r.D5.nightsOcc).toBe(3);
    expect(r.D2.revenue + r.D5.revenue).toBe(160000);
  });
  test('reserva simple de una unidad: igual que antes', () => {
    const r = run([{ check_in: '2026-01-05', check_out: '2026-01-08', price_per_night: 40000, total_amount: 120000, booking_units: [{ unit_id: 'D3', price_per_night: 40000 }] }]);
    expect(r.D3.nightsOcc).toBe(3); expect(r.D3.revenue).toBe(120000); expect(r.D3.avgPricePerNight).toBe(40000);
  });
  test('reserva vieja sin precio por unidad: reparte el total', () => {
    const r = run([{ check_in: '2026-01-05', check_out: '2026-01-08', price_per_night: 40000, total_amount: 120000, booking_units: [{ unit_id: 'D3' }] }]);
    expect(r.D3.revenue).toBe(120000);
  });
  test('dos deptos simultáneos: cada uno todas las noches con su precio', () => {
    const r = run([{ ...PARALLEL, price_per_night: 70000, total_amount: 210000 }]);
    expect(r.D2.nightsOcc).toBe(0);
    const rr = computeUnitStats({ bookings: [{ ...PARALLEL, price_per_night: 70000, total_amount: 210000 }], units: [{ id: 'A' }, { id: 'B' }], firstDay: '2026-02-01', lastDay: '2026-02-28', daysInMonth: 28 });
    const by = Object.fromEntries(rr.map(s => [s.unit.id, s]));
    expect(by.A.nightsOcc).toBe(3); expect(by.A.revenue).toBe(120000);
    expect(by.B.nightsOcc).toBe(3); expect(by.B.revenue).toBe(90000);
    expect(by.A.avgPricePerNight).toBe(40000);
  });
  test('reserva dividida que cruza de mes: cada mes cuenta solo lo suyo', () => {
    const b = { check_in: '2026-01-30', check_out: '2026-02-02', price_per_night: 50000, total_amount: 150000, free_nights: 0,
      booking_units: [{ unit_id: 'D2', price_per_night: 50000, segment_check_in: '2026-01-30', segment_check_out: '2026-02-01' },
                      { unit_id: 'D5', price_per_night: 50000, segment_check_in: '2026-02-01', segment_check_out: '2026-02-02' }] };
    const jan = Object.fromEntries(computeUnitStats({ bookings: [b], units, firstDay: '2026-01-01', lastDay: '2026-01-31', daysInMonth: 31 }).map(s => [s.unit.id, s]));
    const feb = Object.fromEntries(computeUnitStats({ bookings: [b], units, firstDay: '2026-02-01', lastDay: '2026-02-28', daysInMonth: 28 }).map(s => [s.unit.id, s]));
    expect(jan.D2.nightsOcc).toBe(2); expect(jan.D5.nightsOcc).toBe(0);
    expect(feb.D2.nightsOcc).toBe(0); expect(feb.D5.nightsOcc).toBe(1);
    expect(jan.D5.bookingCount).toBe(0);
  });
  test('noches sin cargo no facturan pero sí ocupan', () => {
    const r = run([{ ...B1234, price_per_night: 53333, total_amount: 106667, free_nights: 1 }]);
    expect(r.D2.nightsOcc + r.D5.nightsOcc).toBe(3);
    expect(r.D2.revenue + r.D5.revenue).toBe(Math.round(160000 * 2 / 3));
  });
});

import { rowsOnNight, rowsAtArrival, rowsAtDeparture } from '../../../js/services/stay-segments.js';
describe('🧭 Filas por noche / llegada / salida', () => {
  test('#1234: hoy (11/01) está en D2; el 12/01 en D5', () => {
    expect(rowsOnNight(B1234, '2026-01-11').map(r => r.unit_id)).toEqual(['D2']);
    expect(rowsOnNight(B1234, '2026-01-12').map(r => r.unit_id)).toEqual(['D5']);
    expect(rowsOnNight(B1234, '2026-01-13').length).toBe(0);
  });
  test('#1234: llega a D2 y sale de D5', () => {
    expect(rowsAtArrival(B1234).map(r => r.unit_id)).toEqual(['D2']);
    expect(rowsAtDeparture(B1234).map(r => r.unit_id)).toEqual(['D5']);
  });
  test('conservan la fila original (con units)', () => {
    expect(rowsAtArrival(B1234)[0].units.name).toBe('Depto 2');
  });
  test('reserva simple: llegada y salida son su misma unidad', () => {
    expect(rowsAtArrival(LEGACY).map(r => r.unit_id)).toEqual(['A']);
    expect(rowsAtDeparture(LEGACY).map(r => r.unit_id)).toEqual(['A']);
  });
});
