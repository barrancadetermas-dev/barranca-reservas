// tests/unit/arg-holidays.test.js — El calendario y las etiquetas usan LAS MISMAS fechas
import { describe, test, expect } from './framework.js';
import { getArgHolidays, getHolidaysForYear } from '../../../js/services/arg-holidays.js';
import { holidaysForYear } from '../../../js/services/special-dates.js';

const real = y => [...getArgHolidays(y).entries()].filter(([, v]) => v.type !== 'vacation').map(([d]) => d).sort();
const official = y => [...new Set(holidaysForYear(y).map(h => h.date))].sort();
const puentes = y => [...getArgHolidays(y).entries()].filter(([, v]) => v.label.includes('Puente turístico')).map(([d]) => d);

describe('🔗 arg-holidays ≡ special-dates (única fuente de verdad)', () => {
  test('mismas fechas en 2024 a 2030 (excepto vacaciones de invierno estimadas)', () => {
    for (let y = 2024; y <= 2030; y++) expect(JSON.stringify(real(y))).toBe(JSON.stringify(official(y)));
  });
  test('ya no se inventan puentes: 2027 no tiene ninguno hasta que haya decreto', () => { expect(puentes(2027).length).toBe(0); });
  test('2026: los puentes son SOLO los decretados (23/3, 10/7, 7/12)', () => {
    expect(JSON.stringify(puentes(2026))).toBe(JSON.stringify(['2026-03-23', '2026-07-10', '2026-12-07']));
  });
  test('un feriado que coincide con las vacaciones de invierno estimadas SIGUE siendo feriado (9/7/2024)', () => {
    const v = getArgHolidays(2024).get('2024-07-09'); expect(v.type).toBe('fixed'); expect(v.label.includes('Independencia')).toBe(true);
  });
  test('Malvinas + Jueves Santo (2/4/2026): manda el feriado real y se combinan en una entrada', () => {
    const v = getArgHolidays(2026).get('2026-04-02');
    expect(v.type).toBe('fixed'); expect(v.label.includes('Malvinas') && v.label.includes('Jueves Santo')).toBe(true);
  });
  test('correcciones de reglas: Güemes existe, Bandera no se mueve, Soberanía por ley', () => {
    const h = getArgHolidays(2026);
    expect(h.get('2026-06-15')?.label).toBe('Güemes');            // 17/6 miércoles → lunes 15
    expect(h.get('2026-06-20')?.label).toBe('Belgrano');          // sábado: inamovible, no se corre a lunes
    expect(h.has('2026-06-22')).toBe(false);
    expect(h.get('2026-11-23')?.label).toBe('Soberanía Nac.');
  });
  test('2027 Soberanía cae sábado 20/11: no se corre a un lunes por cuenta propia', () => {
    expect(getArgHolidays(2027).has('2027-11-20')).toBe(true); expect(getArgHolidays(2027).has('2027-11-22')).toBe(false);
  });
  test('formato y etiquetas que usan otros módulos', () => {
    const h = getArgHolidays(2026);
    expect(JSON.stringify(h.get('2026-04-03'))).toBe(JSON.stringify({ label: 'Viernes Santo', type: 'movable' }));   // high-season-notifications lo busca por texto
    expect(h.get('2026-01-01').type).toBe('fixed'); expect(JSON.stringify(h.get('2026-02-16'))).toBe(JSON.stringify({ label: 'Carnaval', type: 'movable' }));
    expect([...h.values()].some(v => v.type === 'vacation')).toBe(true);
  });
  test('getHolidaysForYear sigue cacheando y devolviendo el mismo Map', () => { expect(getHolidaysForYear(2026) === getHolidaysForYear(2026)).toBe(true); });
});
