// Pruebas del cálculo de precios y de la distribución de huéspedes.  Correr:  node --test _dev/tests/unit/
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBookingPricing as calc, validateDistribution, autoDistribute, unitAdjustments, unitNetOf, guestsText, distributionOf } from '../../../js/services/booking-pricing.js';

const U2 = { id: 'd2', price: 120000 }, U4 = { id: 'd4', price: 110000 };

test('clásico: 2 deptos sin ajustes por unidad = 920000 (4 noches)', () => {
  const r = calc({ nights: 4, units: [U2, U4] });
  assert.equal(r.total, 920000); assert.equal(r.unitMode, false);
});
test('clásico: igual que la fórmula vieja con 1 noche sin cargo + 10% + recargo $5000', () => {
  const r = calc({ nights: 4, units: [{ id: 'a', price: 230000 }], collective: { freeNights: 1, disc: { mode: 'pct', value: 10 }, surch: { mode: 'amt', value: 5000 } } });
  assert.equal(r.total, 3 * 230000 * 0.9 + 5000);
});
test('clásico: descuento en $ se convierte a % sobre el subtotal (como antes)', () => {
  const r = calc({ nights: 4, units: [U2, U4], collective: { disc: { mode: 'amt', value: 92000 } } });
  assert.equal(r.discAmt, 92000); assert.equal(r.total, 828000);
});
test('CRITERIO 1: descuento solo al depto 2, el 4 no cambia', () => {
  const r = calc({ nights: 4, units: [{ ...U2, disc: { mode: 'pct', value: 10 } }, U4] });
  assert.equal(r.perUnit[0].net, 432000); assert.equal(r.perUnit[1].net, 440000); assert.equal(r.total, 872000);
});
test('CRITERIO 2: recargo individual afecta solo a la unidad elegida (monto y %)', () => {
  const a = calc({ nights: 4, units: [U2, { ...U4, surch: { mode: 'amt', value: 30000 } }] });
  assert.equal(a.perUnit[0].net, 480000); assert.equal(a.perUnit[1].net, 470000);
  const b = calc({ nights: 4, units: [{ ...U2, surch: { mode: 'pct', value: 10 } }, U4] });
  assert.equal(b.perUnit[0].net, 528000); assert.equal(b.perUnit[1].net, 440000);
});
test('CRITERIO 3: 1 noche sin cargo en el depto 2 y 5 noches pagas en el 4; las noches de la estadía no cambian', () => {
  const r = calc({ nights: 5, units: [{ ...U2, freeNights: 1 }, U4] });
  assert.equal(r.nights, 5);
  assert.equal(r.perUnit[0].net, 120000 * 4); assert.equal(r.perUnit[0].freeAmt, 120000);
  assert.equal(r.perUnit[1].net, 110000 * 5);
  assert.equal(r.total, 480000 + 550000);
});
test('combinado del mockup: D2 1 noche sin cargo + 10%, D4 sin ajustes → 764000', () => {
  const r = calc({ nights: 4, units: [{ ...U2, freeNights: 1, disc: { mode: 'pct', value: 10 } }, U4] });
  assert.equal(r.perUnit[0].net, 324000); assert.equal(r.perUnit[1].net, 440000); assert.equal(r.total, 764000);
});
test('colectivo + unidad: no se aplica dos veces (se suman los % sobre la base de esa unidad)', () => {
  const r = calc({ nights: 4, units: [{ ...U2, disc: { mode: 'pct', value: 10 } }, U4], collective: { disc: { mode: 'pct', value: 5 } } });
  assert.equal(r.perUnit[0].discPct, 15); assert.equal(r.perUnit[0].net, 480000 * 0.85);
  assert.equal(r.perUnit[1].discPct, 5);  assert.equal(r.perUnit[1].net, 440000 * 0.95);
});
test('noche sin cargo colectiva + individual se acumulan y tienen tope en las noches', () => {
  const r = calc({ nights: 3, units: [{ ...U2, freeNights: 5 }, U4], collective: { freeNights: 1 } });
  assert.equal(r.perUnit[0].freeNights, 3); assert.equal(r.perUnit[0].net, 0); assert.equal(r.perUnit[1].net, 110000 * 2);
});
test('recargo colectivo se suma una sola vez al total; late check-out también', () => {
  const r = calc({ nights: 4, units: [{ ...U2, disc: { mode: 'pct', value: 10 } }, U4], collective: { surch: { mode: 'amt', value: 20000 } }, late: 60000 });
  assert.equal(r.total, 432000 + 440000 + 20000 + 60000);
});
test('total = suma de importes por unidad (+ colectivos): consistente', () => {
  const r = calc({ nights: 7, units: [{ ...U2, freeNights: 2, disc: { mode: 'pct', value: 12.5 }, surch: { mode: 'amt', value: 3000 } }, { ...U4, surch: { mode: 'pct', value: 8 } }], collective: { surch: { mode: 'amt', value: 1000 } } });
  assert.equal(r.total, r.perUnit.reduce((s, u) => s + u.net, 0) + r.collectiveSurch);
});
test('descuento en $ por unidad se convierte sobre la base de esa unidad', () => {
  const r = calc({ nights: 4, units: [{ ...U2, disc: { mode: 'amt', value: 48000 } }, U4] });
  assert.equal(r.perUnit[0].discAmt, 48000); assert.equal(r.perUnit[0].net, 432000);
});

// ── Huéspedes ──
const gU = [{ id: 'd2', name: 'Depto 2', adults: 3, children: 0, maxGuests: 4 }, { id: 'd4', name: 'Depto 4', adults: 1, children: 2, maxGuests: 4 }];
test('CRITERIO 4: distribución correcta (3+1 adultos, 0+2 niños) sin advertencias', () => {
  const v = validateDistribution({ adults: 4, children: 2 }, gU); assert.equal(v.ok, true); assert.equal(v.assignedAdults, 4);
});
test('CRITERIO 5: avisa si la suma no coincide con el total', () => {
  const v = validateDistribution({ adults: 5, children: 2 }, gU);
  assert.equal(v.ok, false); assert.match(v.warnings[0].text, /falta ubicar 1/); assert.equal(v.warnings[0].blocking, false);
});
test('CRITERIO 6: respeta la capacidad de cada depto', () => {
  const v = validateDistribution({ adults: 6, children: 2 }, [{ ...gU[0], adults: 5 }, { ...gU[1], adults: 1 }]);
  assert.ok(v.warnings.some(w => w.type === 'capacity' && w.unitId === 'd2' && w.blocking));
});
test('sin distribución cargada no hay advertencias (reservas viejas)', () => {
  const v = validateDistribution({ adults: 4, children: 2 }, [{ id: 'd2', maxGuests: 4 }, { id: 'd4', maxGuests: 4 }]);
  assert.equal(v.loaded, false); assert.equal(v.ok, true);
});
test('autoDistribute reparte todo y no supera la capacidad', () => {
  const r = autoDistribute({ adults: 4, children: 2 }, [{ id: 'a', maxGuests: 4 }, { id: 'b', maxGuests: 4 }]);
  assert.equal(r.reduce((s, x) => s + x.adults, 0), 4); assert.equal(r.reduce((s, x) => s + x.children, 0), 2);
  assert.ok(r.every(x => x.adults + x.children <= 4));
});

// ── Lectura de reservas guardadas ──
test('reserva vieja (sin columnas nuevas): ajustes efectivos = colectivos de siempre', () => {
  const b = { free_nights: 1, discount_pct: 10, booking_units: [{ unit_id: 'd2' }, { unit_id: 'd4' }] };
  const a = unitAdjustments(b, 'd2'); assert.equal(a.freeNights, 1); assert.equal(a.discPct, 10); assert.equal(a.surcharge, 0);
});
test('reserva por unidad: cada depto lee los suyos + los colectivos', () => {
  const b = { unit_pricing: true, free_nights: 0, discount_pct: 0, check_in: '2026-10-21', check_out: '2026-10-25',
    booking_units: [{ unit_id: 'd2', price_per_night: 120000, free_nights: 1, discount_pct: 10 }, { unit_id: 'd4', price_per_night: 110000 }] };
  assert.equal(unitAdjustments(b, 'd2').freeNights, 1); assert.equal(unitAdjustments(b, 'd4').freeNights, 0);
  assert.equal(unitNetOf(b, 'd2'), 324000); assert.equal(unitNetOf(b, 'd4'), 440000);
});
test('unitNetOf devuelve null en reservas viejas', () => assert.equal(unitNetOf({ check_in: '2026-10-21', check_out: '2026-10-25', booking_units: [] }, 'x'), null));
test('textos y distribución guardada', () => {
  assert.equal(guestsText(3, 1), '3 adultos, 1 niño'); assert.equal(guestsText(1, 2), '1 adulto, 2 niños');
  const d = distributionOf({ booking_units: [{ unit_id: 'd4', adults: 1, children: 2, units: { name: 'D4', sort_order: 4 } }, { unit_id: 'd2', adults: 3, children: 0, units: { name: 'D2', sort_order: 2 } }] });
  assert.equal(d[0].name, 'D2'); assert.equal(distributionOf({ booking_units: [{ unit_id: 'x' }, { unit_id: 'y' }] }).length, 0);
});
