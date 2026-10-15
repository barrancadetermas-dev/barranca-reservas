// tests/unit/guest-count.test.js — Cantidad de personas (módulo real)
import { describe, test, expect } from './framework.js';
import { resolveGuestCounts } from '../../../js/utils/guest-count.js';

describe('👥 resolveGuestCounts', () => {
  test('4 adultos guardados → 4 (no vuelve a 2)', () => {
    expect(resolveGuestCounts({ adults: 4, children: 0, pax: 4 })).toEqual({ adults: 4, children: 0, total: 4 });
  });
  test('adults=1 por defecto de la base y pax=4 → 4 personas (antes mostraba 1 y pisaba pax)', () => {
    expect(resolveGuestCounts({ adults: 1, children: 0, pax: 4 })).toEqual({ adults: 4, children: 0, total: 4 });
  });
  test('adults/children nulos y pax=5 → 5 adultos', () => {
    expect(resolveGuestCounts({ adults: null, children: null, pax: 5 })).toEqual({ adults: 5, children: 0, total: 5 });
  });
  test('3 adultos + 1 menor se respetan', () => {
    expect(resolveGuestCounts({ adults: 3, children: 1, pax: 4 })).toEqual({ adults: 3, children: 1, total: 4 });
  });
  test('pax=6 con 2 menores y adults=1 → 4 adultos + 2 menores', () => {
    expect(resolveGuestCounts({ adults: 1, children: 2, pax: 6 })).toEqual({ adults: 4, children: 2, total: 6 });
  });
  test('sin pax pero con adultos y menores → suma', () => {
    expect(resolveGuestCounts({ adults: 2, children: 1 })).toEqual({ adults: 2, children: 1, total: 3 });
  });
  test('1 sola persona se conserva (no se fuerza a 2)', () => {
    expect(resolveGuestCounts({ adults: 1, children: 0, pax: 1 }).total).toBe(1);
  });
  test('sin ningún dato → el valor predeterminado indicado', () => {
    expect(resolveGuestCounts({}).total).toBe(2); expect(resolveGuestCounts({}, 1).total).toBe(1);
  });
  test('siempre queda al menos 1 adulto', () => {
    expect(resolveGuestCounts({ adults: 0, children: 3, pax: 3 }).adults).toBe(1);
  });
});
