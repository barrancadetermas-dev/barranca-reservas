// tests/unit/booking-display.test.js — Porcentaje de pago, PROMO y personas (módulo real)
import { describe, test, expect } from './framework.js';
import { pctOf, paymentPercents, fmtPct, paymentProgressText, promoLabel, guestCountsText } from '../../../js/utils/booking-display.js';

describe('💳 Porcentaje de pago', () => {
  test('de $10 abona $2 → 20% abonado, resta 80%', () => {
    const p = paymentPercents(2, 10); expect(p.paidPct).toBe(20); expect(p.restPct).toBe(80);
    expect(paymentProgressText(2, 10)).toBe('20% abonado · resta 80%');
  });
  test('pago individual como % del total', () => { expect(pctOf(50000, 150000)).toBe(33.3); expect(fmtPct(pctOf(50000, 150000))).toBe('33,3%'); });
  test('siempre suma 100', () => {
    for (const [p, t] of [[1, 3], [2, 3], [49999, 150000], [1, 1000], [999, 1000]]) {
      const r = paymentPercents(p, t); expect(Math.round((r.paidPct + r.restPct) * 10) / 10).toBe(100);
    }
  });
  test('saldada → 100% abonado', () => { expect(paymentProgressText(150000, 150000)).toBe('100% abonado'); expect(paymentPercents(150001, 150000).paidPct).toBe(100); });
  test('nunca muestra 100% mientras quede saldo', () => {
    expect(paymentPercents(149999, 150000).paidPct < 100).toBe(true);
    expect(paymentPercents(999999, 1000000).restPct > 0).toBe(true);
  });
  test('nunca muestra 0% si ya se pagó algo', () => { expect(paymentProgressText(100, 100000)).toContain('<1% abonado'); });
  test('sin abonar → 0% abonado, resta 100%', () => { expect(paymentProgressText(0, 100000)).toBe('0% abonado · resta 100%'); });
  test('sin total (0 o vacío) → no inventa porcentajes', () => { expect(paymentPercents(100, 0)).toBe(null); expect(paymentProgressText(100, 0)).toBe(''); expect(pctOf(5, 0)).toBe(null); });
  test('formato: enteros sin decimales, decimales con coma', () => { expect(fmtPct(20)).toBe('20%'); expect(fmtPct(12.5)).toBe('12,5%'); expect(fmtPct(0.4, { tiny: true })).toBe('<1%'); });
  test('pago de más (sobrepago) no pasa de 100%', () => { expect(paymentPercents(200, 100).paidPct).toBe(100); });
});

describe('🎁 PROMO (noches sin cargo)', () => {
  test('3 noches, abona 2 → 2+1', () => { expect(promoLabel(3, 1)).toBe('2+1'); });
  test('4 noches, abona 3 → 3+1', () => { expect(promoLabel(4, 1)).toBe('3+1'); });
  test('5 noches, 2 gratis → 3+2', () => { expect(promoLabel(5, 2)).toBe('3+2'); });
  test('sin noches gratis → sin promo', () => { expect(promoLabel(3, 0)).toBe(''); expect(promoLabel(3, null)).toBe(''); expect(promoLabel(3, undefined)).toBe(''); });
  test('datos incoherentes (todas gratis) no inventan una promo', () => { expect(promoLabel(2, 2)).toBe(''); expect(promoLabel(0, 1)).toBe(''); });
});

describe('👥 Personas: adultos y menores', () => {
  test('3 adultos + 1 menor', () => {
    const g = guestCountsText({ adults: 3, children: 1, pax: 4 });
    expect(g.text).toBe('3 adultos + 1 menor'); expect(g.short).toBe('👥 4 · 3 adultos + 1 menor');
  });
  test('2 menores', () => { expect(guestCountsText({ adults: 2, children: 2, pax: 4 }).text).toBe('2 adultos + 2 menores'); });
  test('solo adultos: no repite el total', () => { expect(guestCountsText({ adults: 4, children: 0, pax: 4 }).short).toBe('👥 4 adultos'); });
  test('1 adulto', () => { expect(guestCountsText({ adults: 1, children: 0, pax: 1 }).short).toBe('👥 1 adulto'); });
  test('reserva con adults=1 por defecto y pax=4 → 4 adultos (no 1)', () => { expect(guestCountsText({ adults: 1, children: 0, pax: 4 }).short).toBe('👥 4 adultos'); });
  test('reserva vieja con solo pax=3 → 3 adultos', () => { expect(guestCountsText({ pax: 3 }).text).toBe('3 adultos'); });
});
