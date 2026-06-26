// tests/unit/pricing.test.js — Tests de cálculo financiero
import { describe, test, expect } from './framework.js';

// ── Lógica de precios (replicada del schema.sql) ──
function calcTotal(pricePerNight, nights, freeNights = 0, discountPct = 0, surchargeAmount = 0) {
  const base     = pricePerNight * nights;
  const freeAmt  = freeNights * pricePerNight;
  const discAmt  = (base - freeAmt) * (discountPct / 100);
  const total    = base - freeAmt - discAmt + surchargeAmount;
  return Math.max(total, 0);
}

function calcNights(checkIn, checkOut) {
  const d1 = new Date(checkIn  + 'T12:00:00');
  const d2 = new Date(checkOut + 'T12:00:00');
  return Math.round((d2 - d1) / 86400000);
}

// ── Tests ─────────────────────────────────────────
describe('💰 Cálculo de noches', () => {
  test('5 noches entre lunes y sábado', () => {
    expect(calcNights('2026-06-01', '2026-06-06')).toBe(5);
  });
  test('1 noche entre días consecutivos', () => {
    expect(calcNights('2026-06-10', '2026-06-11')).toBe(1);
  });
  test('30 noches (mes completo)', () => {
    expect(calcNights('2026-06-01', '2026-07-01')).toBe(30);
  });
});

describe('💰 Precio base', () => {
  test('7 noches a $65.000 = $455.000', () => {
    expect(calcTotal(65000, 7)).toBe(455000);
  });
  test('3 noches a $85.000 = $255.000', () => {
    expect(calcTotal(85000, 3)).toBe(255000);
  });
});

describe('💰 Noches gratis', () => {
  test('7 noches, 1 gratis → paga 6 a $65.000 = $390.000', () => {
    expect(calcTotal(65000, 7, 1)).toBe(390000);
  });
  test('Todas las noches gratis → $0', () => {
    expect(calcTotal(65000, 3, 3)).toBe(0);
  });
});

describe('💰 Descuento porcentual', () => {
  test('10% descuento sobre 7 noches a $65.000 = $409.500', () => {
    expect(calcTotal(65000, 7, 0, 10)).toBe(409500);
  });
  test('50% descuento sobre $100.000 = $50.000', () => {
    expect(calcTotal(100000, 1, 0, 50)).toBe(50000);
  });
  test('100% descuento → $0', () => {
    expect(calcTotal(65000, 5, 0, 100)).toBe(0);
  });
});

describe('💰 Recargo fijo', () => {
  test('$10.000 de recargo sobre $65.000 = $75.000', () => {
    expect(calcTotal(65000, 1, 0, 0, 10000)).toBe(75000);
  });
});

describe('💰 Combinado', () => {
  test('7 noches, 1 gratis, 10% descuento, $5.000 recargo', () => {
    // base = 65000 * 7 = 455000
    // free = 65000 * 1 = 65000
    // disc = (455000 - 65000) * 0.10 = 39000
    // total = 455000 - 65000 - 39000 + 5000 = 356000
    expect(calcTotal(65000, 7, 1, 10, 5000)).toBe(356000);
  });
});

describe('💰 Saldo pendiente', () => {
  test('Reserva de $100.000 con $30.000 pagado → saldo $70.000', () => {
    const balance = Math.max(100000 - 30000, 0);
    expect(balance).toBe(70000);
  });
  test('Reserva pagada → saldo $0', () => {
    const balance = Math.max(100000 - 100000, 0);
    expect(balance).toBe(0);
  });
  test('Saldo nunca negativo', () => {
    const balance = Math.max(100000 - 120000, 0); // sobrepago
    expect(balance).toBe(0);
  });
});
