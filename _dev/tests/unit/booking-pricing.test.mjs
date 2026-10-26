// Pruebas del cálculo de precios y de la distribución de huéspedes.  Correr:  node --test _dev/tests/unit/
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBookingPricing as calc, validateDistribution, autoDistribute, unitAdjustments, unitNetOf, guestsText, distributionOf, unitDisplayName, cleanLabel, unitAmounts, unitBalances, guestsShort } from '../../../js/services/booking-pricing.js';

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

// ── Nombre propio del depto dentro de la reserva ──
test('nombre propio: se muestra el de la reserva y, si no hay, el del depto', () => {
  assert.equal(unitDisplayName({ label: '  Depto de los   abuelos ', units: { name: '2AMB P. Baja' } }), 'Depto de los abuelos');
  assert.equal(unitDisplayName({ label: '', units: { name: '2AMB P. Baja' } }), '2AMB P. Baja');
  assert.equal(unitDisplayName({}), 'Depto');
  assert.equal(cleanLabel('x'.repeat(80)).length, 60); assert.equal(cleanLabel(null), '');
});
test('distributionOf incluye el nombre propio', () => {
  const d = distributionOf({ booking_units: [{ unit_id: 'd2', label: 'Abuelos', adults: 2, children: 0, units: { name: 'D2', sort_order: 2 } }, { unit_id: 'd4', adults: 1, children: 1, units: { name: 'D4', sort_order: 4 } }] });
  assert.equal(d[0].label, 'Abuelos'); assert.equal(d[1].label, '');
});
test('unitAmounts: neto real por depto en reservas por unidad; reparto proporcional en las viejas', () => {
  const bu = [{ unit_id: 'd2', price_per_night: 120000, free_nights: 1, discount_pct: 10 }, { unit_id: 'd4', price_per_night: 110000 }];
  const nuevo = unitAmounts({ unit_pricing: true, nights: 4, check_in: '2026-10-21', check_out: '2026-10-25', booking_units: bu });
  assert.deepEqual(nuevo.map(x => x.net), [324000, 440000]);
  const viejo = unitAmounts({ nights: 4, check_in: '2026-10-21', check_out: '2026-10-25', price_per_night: 230000, booking_units: [{ unit_id: 'd2', price_per_night: 120000 }, { unit_id: 'd4', price_per_night: 110000 }] });
  assert.equal(viejo.reduce((s, x) => s + x.net, 0), 920000);
});

// ── Saldo por unidad ──
const BAL = { unit_pricing: true, nights: 4, check_in: '2026-10-21', check_out: '2026-10-25', total_amount: 764000, price_per_night: 230000,
  booking_units: [{ unit_id: 'd2', price_per_night: 120000, free_nights: 1, discount_pct: 10 }, { unit_id: 'd4', price_per_night: 110000 }] };
test('saldo por unidad: sin pagos, cada depto debe su neto y la suma da el total', () => {
  const r = unitBalances(BAL, []);
  assert.deepEqual(r.map(x => x.due), [324000, 440000]); assert.deepEqual(r.map(x => x.balance), [324000, 440000]);
});
test('saldo por unidad: el pago asignado a un depto solo descuenta de ese depto', () => {
  const r = unitBalances(BAL, [{ unit_id: 'd2', amount_ars: 100000 }]);
  assert.equal(r[0].paid, 100000); assert.equal(r[0].balance, 224000); assert.equal(r[1].paid, 0); assert.equal(r[1].balance, 440000);
});
test('saldo por unidad: el pago GENERAL se reparte proporcional a lo que corresponde a cada depto', () => {
  const r = unitBalances(BAL, [{ unit_id: null, amount_ars: 76400 }]);   // 10% del total
  assert.equal(r[0].paid, 32400); assert.equal(r[1].paid, 44000);
  assert.equal(r[0].paid + r[1].paid, 76400);
  assert.equal(r[0].balance + r[1].balance, 764000 - 76400);
});
test('saldo por unidad: directo + general, pagado de más y la suma siempre cierra con el total', () => {
  const r = unitBalances(BAL, [{ unit_id: 'd4', amount_ars: 500000 }, { unit_id: null, amount: 100000 }]);
  assert.equal(r[1].over > 0, true); assert.equal(r[1].balance, 0);
  assert.equal(r.reduce((s, x) => s + x.paid, 0), 600000);
  assert.equal(r.reduce((s, x) => s + x.due, 0), 764000);
});
test('saldo por unidad: recargo colectivo y late check-out (resto) se reparten proporcional', () => {
  const b = { ...BAL, total_amount: 764000 + 60000 };   // +60.000 de late/recargo de toda la reserva
  const r = unitBalances(b, []);
  assert.equal(r.reduce((s, x) => s + x.due, 0), 824000);
  assert.ok(r[0].due > 324000 && r[1].due > 440000);
});
test('saldo por unidad: reserva vieja (precios iguales sin ajustes) reparte por precio', () => {
  const v = { nights: 4, check_in: '2026-10-21', check_out: '2026-10-25', total_amount: 920000, price_per_night: 230000,
    booking_units: [{ unit_id: 'd2', price_per_night: 120000 }, { unit_id: 'd4', price_per_night: 110000 }] };
  const r = unitBalances(v, [{ amount_ars: 92000 }]);
  assert.deepEqual(r.map(x => x.due), [480000, 440000]); assert.equal(r.reduce((s, x) => s + x.paid, 0), 92000);
});
test('guestsShort', () => { assert.equal(guestsShort(3, 0), '3 ad'); assert.equal(guestsShort(1, 2), '1 ad 2 ni'); assert.equal(guestsShort(0, 0), '—'); });

// ── Mensaje de armado hoy/mañana ──
import { buildArmadoText } from '../../../js/services/armado-service.js';
const U = (n, name) => ({ name, sort_order: n });
const G = (f, l) => ({ first_name: f, last_name: l });
test('armado: formato de Marian (HOY y MAÑANA, #depto ~ NOMBRE, PERS, fechas, noches, saldo)', () => {
  const txt = buildArmadoText([
    { id: 1, status: 'partial', check_in: '2026-10-27', check_out: '2026-10-30', adults: 2, children: 0, total_amount: 150000, total_paid: 50000, balance: 100000, guests: G('Liliana', 'López'), booking_units: [{ unit_id: 'd6', units: U(6, 'X') }] },
    { id: 2, status: 'partial', check_in: '2026-10-28', check_out: '2026-10-29', adults: 4, children: 0, total_amount: 40000, total_paid: 0, balance: 40000, guests: G('Marcela', 'Bedu'), booking_units: [{ unit_id: 'd7', units: U(7, 'Y') }] },
  ], '2026-10-27');
  assert.equal(txt, 'HOY\n#6 ~ LILIANA LÓPEZ, 2PERS, (27/10 al 30/10) 3 noches. $100.000\n\nMAÑANA\n#7 ~ MARCELA BEDU, 4PERS, (28/10 al 29/10) 1 noche. $40.000');
});
test('armado: reserva de 2 deptos → una línea por depto con nombre propio, personas y saldo de CADA depto', () => {
  const b = { id: 3, status: 'partial', check_in: '2026-10-27', check_out: '2026-10-31', nights: 4, adults: 4, children: 2, unit_pricing: true, total_amount: 764000, total_paid: 100000, balance: 664000, price_per_night: 230000,
    guests: G('Familia', 'Pérez'), payments: [{ unit_id: 'd2', amount_ars: 100000 }],
    booking_units: [{ unit_id: 'd2', price_per_night: 120000, free_nights: 1, discount_pct: 10, adults: 3, children: 0, label: 'Depto de los abuelos', units: U(2, 'A') },
                    { unit_id: 'd4', price_per_night: 110000, adults: 1, children: 2, label: 'Los primos', units: U(4, 'B') }] };
  const lines = buildArmadoText([b], '2026-10-27', { manana: false }).split('\n');
  assert.equal(lines[1], '#2 ~ FAMILIA PÉREZ (DEPTO DE LOS ABUELOS), 3PERS, (27/10 al 31/10) 4 noches. $224.000');
  assert.equal(lines[2], '#4 ~ FAMILIA PÉREZ (LOS PRIMOS), 3PERS (2 NIÑOS), (27/10 al 31/10) 4 noches. $440.000');
});
test('armado: saldo 0 → PAGADO; sin saldo (opción) y sin llegadas; ignora canceladas y bloqueos', () => {
  const pag = { id: 4, status: 'paid', check_in: '2026-10-27', check_out: '2026-10-28', adults: 2, total_amount: 50000, total_paid: 50000, balance: 0, guests: G('Ana', 'Paga'), booking_units: [{ unit_id: 'd1', units: U(1, 'X') }] };
  assert.match(buildArmadoText([pag], '2026-10-27'), /1 noche\. PAGADO/);
  assert.doesNotMatch(buildArmadoText([pag], '2026-10-27', { saldo: false }), /PAGADO|\$/);
  assert.equal(buildArmadoText([], '2026-10-27'), 'HOY\nSin llegadas\n\nMAÑANA\nSin llegadas');
  assert.match(buildArmadoText([{ ...pag, status: 'cancelled' }], '2026-10-27'), /Sin llegadas/);
});
