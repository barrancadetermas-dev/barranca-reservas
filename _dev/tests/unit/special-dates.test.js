// tests/unit/special-dates.test.js — Fechas especiales (módulo REAL)
import { describe, test, expect } from './framework.js';
import {
  emojiHTML, easterSunday, holidaysForYear, holidaysOn, longWeekends, isSummerStay, specialsForStay, specialChipsHTML, weekday,
} from '../../../js/services/special-dates.js';

const lw = y => longWeekends(y).filter(l => l.from.startsWith(String(y)) || l.to.startsWith(String(y))).map(l => `${l.from.slice(5)}..${l.to.slice(5)}`);
const dateOf = (y, key) => holidaysForYear(y).find(h => h.key === key)?.date;

describe('✝️ Pascua, Carnaval y Semana Santa (calculados)', () => {
  test('Pascua 2025 / 2026 / 2027', () => {
    expect(easterSunday(2025)).toBe('2025-04-20'); expect(easterSunday(2026)).toBe('2026-04-05'); expect(easterSunday(2027)).toBe('2027-03-28');
  });
  test('2026: Carnaval 16 y 17/2 · Jueves Santo 2/4 · Viernes Santo 3/4', () => {
    expect(dateOf(2026, 'carnaval1')).toBe('2026-02-16'); expect(dateOf(2026, 'carnaval2')).toBe('2026-02-17');
    expect(dateOf(2026, 'jueves_santo')).toBe('2026-04-02'); expect(dateOf(2026, 'viernes_santo')).toBe('2026-04-03');
  });
  test('2025: Carnaval 3 y 4/3 · Viernes Santo 18/4', () => {
    expect(dateOf(2025, 'carnaval1')).toBe('2025-03-03'); expect(dateOf(2025, 'carnaval2')).toBe('2025-03-04'); expect(dateOf(2025, 'viernes_santo')).toBe('2025-04-18');
  });
  test('2027: Carnaval en febrero (8 y 9/2) porque la Pascua cae temprano (28/3)', () => {
    expect(dateOf(2027, 'carnaval1')).toBe('2027-02-08'); expect(dateOf(2027, 'viernes_santo')).toBe('2027-03-26');
  });
});

describe('📅 Feriados trasladables (Ley 27.399 art. 6)', () => {
  test('2026: Güemes miércoles 17/6 → lunes 15/6', () => { expect(dateOf(2026, 'guemes')).toBe('2026-06-15'); });
  test('2026: Soberanía viernes 20/11 → lunes 23/11', () => { expect(dateOf(2026, 'soberania')).toBe('2026-11-23'); });
  test('2026: San Martín y Diversidad caen lunes → no se mueven', () => {
    expect(dateOf(2026, 'sanmartin')).toBe('2026-08-17'); expect(dateOf(2026, 'diversidad')).toBe('2026-10-12');
  });
  test('2025: Güemes martes 17/6 → lunes 16/6 · Soberanía jueves 20/11 → lunes 24/11', () => {
    expect(dateOf(2025, 'guemes')).toBe('2025-06-16'); expect(dateOf(2025, 'soberania')).toBe('2025-11-24');
  });
  test('2025: 12/10 (domingo) lo movió la autoridad al viernes 10/10 (Res. 139/2025)', () => { expect(dateOf(2025, 'diversidad')).toBe('2025-10-10'); });
  test('inamovibles no se mueven: 9/7, 25/12, 1/1, 24/3 (aunque caigan jueves o martes)', () => {
    expect(dateOf(2026, 'julio')).toBe('2026-07-09'); expect(dateOf(2026, 'memoria')).toBe('2026-03-24'); expect(dateOf(2026, 'navidad')).toBe('2026-12-25');
    expect(weekday('2026-07-09')).toBe(4);
  });
  test('2027 (sin decretos aún): 17/6 jueves → lunes 21/6; 17/8 martes → lunes 16/8; 12/10 martes → lunes 11/10', () => {
    expect(dateOf(2027, 'guemes')).toBe('2027-06-21'); expect(dateOf(2027, 'sanmartin')).toBe('2027-08-16'); expect(dateOf(2027, 'diversidad')).toBe('2027-10-11');
  });
});

describe('🧳 Puentes turísticos (solo los decretados, nada inventado)', () => {
  test('2026: 23/3, 10/7 y 7/12', () => {
    expect(holidaysForYear(2026).filter(h => h.kind === 'puente').map(h => h.date)).toEqual(['2026-03-23', '2026-07-10', '2026-12-07']);
  });
  test('2025: 2/5, 15/8 y 21/11', () => {
    expect(holidaysForYear(2025).filter(h => h.kind === 'puente').map(h => h.date)).toEqual(['2025-05-02', '2025-08-15', '2025-11-21']);
  });
  test('2027: ninguno hasta que se publique el decreto', () => {
    expect(holidaysForYear(2027).filter(h => h.kind === 'puente').length).toBe(0);
  });
});

describe('🗓 Fines de semana largos', () => {
  test('2026: exactamente los 12 oficiales', () => {
    expect(lw(2026)).toEqual(['02-14..02-17', '03-21..03-24', '04-02..04-05', '05-01..05-03', '05-23..05-25', '06-13..06-15',
      '07-09..07-12', '08-15..08-17', '10-10..10-12', '11-21..11-23', '12-05..12-08', '12-25..12-27']);
  });
  test('2025: 9/10 al 12/10 (viernes trasladado) y 21 al 24/11 con puente', () => {
    expect(lw(2025)).toContain('10-10..10-12'); expect(lw(2025)).toContain('11-21..11-24');
  });
  test('un feriado aislado a mitad de semana NO es finde largo (jueves 1/1/2026, 25/12/2025)', () => {
    expect(longWeekends(2026).some(l => l.from <= '2026-01-01' && l.to >= '2026-01-01')).toBe(false);
    expect(longWeekends(2025).some(l => l.from <= '2025-12-25' && l.to >= '2025-12-25')).toBe(false);
  });
  test('sábado + domingo solos nunca son finde largo', () => {
    expect(longWeekends(2026).some(l => l.days < 3)).toBe(false);
  });
});

describe('☀️ Temporada de verano (2/1 al 10/3 inclusive)', () => {
  test('límites inclusivos', () => {
    expect(isSummerStay('2026-01-02', '2026-01-03')).toBe(true);      // noche del 2/1
    expect(isSummerStay('2026-03-10', '2026-03-11')).toBe(true);      // noche del 10/3
    expect(isSummerStay('2026-03-11', '2026-03-12')).toBe(false);
    expect(isSummerStay('2026-01-01', '2026-01-02')).toBe(false);     // la única noche es la del 1/1
  });
  test('estadía que empieza en diciembre y entra en enero es de verano', () => { expect(isSummerStay('2025-12-30', '2026-01-03')).toBe(true); });
  test('funciona aunque la reserva se haya creado antes: solo depende de las fechas', () => {
    expect(isSummerStay('2027-02-10', '2027-02-14')).toBe(true); expect(isSummerStay('2026-07-01', '2026-07-05')).toBe(false);
  });
});

describe('🎯 Detección en estadías', () => {
  const sp = (a, b) => specialsForStay(a, b);
  test('25/12 · Navidad (noche del 24 → 25/12)', () => {
    expect(sp('2026-12-24', '2026-12-25').primary.chip).toBe('Navidad');
    expect(sp('2026-12-25', '2026-12-26').primary.chip).toBe('Navidad');
    expect(sp('2026-12-26', '2026-12-27').primary?.type === 'christmas').toBe(false);
  });
  test('Año Nuevo: la noche del 31/12 ya cuenta; el 2/1 no', () => {
    expect(sp('2026-12-31', '2027-01-01').primary.chip).toBe('Año Nuevo');
    expect(sp('2027-01-01', '2027-01-02').primary.chip).toBe('Año Nuevo');
    expect(sp('2027-01-03', '2027-01-04').primary?.type === 'newyear').toBe(false);
  });
  test('Navidad y Año Nuevo en la misma estadía → prioridad igual, el otro queda en "others" (sin duplicar)', () => {
    const s = sp('2026-12-23', '2027-01-02');
    expect(s.all.map(e => e.type).sort()).toEqual(['christmas', 'newyear']); expect(s.others.length).toBe(1); expect(s.summer).toBe(false);
  });
  test('Carnaval 2026 (14 al 17/2)', () => {
    const s = sp('2026-02-14', '2026-02-18'); expect(s.primary.type).toBe('carnival'); expect(s.primary.chip).toBe('Carnaval'); expect(s.summer).toBe(true);
  });
  test('Semana Santa 2026 (2 al 5/4)', () => { expect(sp('2026-04-02', '2026-04-06').primary.type).toBe('easter'); });
  test('"20/11 · 🇦🇷 Finde largo" — Soberanía 2026 (21 al 23/11)', () => {
    const s = sp('2026-11-21', '2026-11-23'); expect(s.primary.chip).toBe('Finde largo'); expect(s.primary.emoji).toBe('🇦🇷'); expect(s.primary.longWeekend.days).toBe(3);
  });
  test('Día de la Bandera 2026 cae sábado y NO forma finde largo → se muestra por su nombre', () => {
    const s = sp('2026-06-19', '2026-06-21'); expect(s.primary.short).toBe('Bandera'); expect(s.primary.chip).toBe('Bandera');
  });
  test('9 de Julio 2026 + puente 10/7 → una sola etiqueta principal "Finde largo" y el resto en detalle', () => {
    const s = sp('2026-07-08', '2026-07-12'); expect(s.primary.chip).toBe('Finde largo');
    expect(s.all.some(e => /Independencia/.test(e.detail))).toBe(true);
    expect(s.all.filter(e => e.chip === 'Finde largo').length).toBe(2);   // 9/7 y puente 10/7 son 2 feriados distintos...
  });
  test('estadía que atraviesa un feriado (lunes 17/8/2026 con salida el 18)', () => {
    expect(sp('2026-08-14', '2026-08-18').primary.chip).toBe('Finde largo');
  });
  test('estadía en octubre SIN feriados no marca nada especial', () => {
    expect(sp('2026-10-20', '2026-10-24').any).toBe(false);
  });
  test('la noche del viernes ANTES de un finde largo ya cuenta; pasado el feriado ya no', () => {
    expect(sp('2026-11-20', '2026-11-21').primary?.chip).toBe('Finde largo');   // viernes 20/11, antes del finde 21-23
    expect(sp('2026-11-24', '2026-11-25').primary).toBe(null);                   // martes 24/11: ya no hay nada
  });
  test('llegar el mismo día del feriado (lunes 23/11, trasladado) coincide con ese feriado', () => {
    const s = sp('2026-11-23', '2026-11-24'); expect(s.primary.short).toBe('Soberanía'); expect(s.primary.chip).toBe('Soberanía');
  });
  test('no marca como feriado lo que no lo es (verano, sin feriado)', () => {
    const s = sp('2026-02-03', '2026-02-06'); expect(s.primary).toBe(null); expect(s.summer).toBe(true);
  });
  test('check-out el día del feriado: ese día NO es una noche (pero la víspera sí)', () => {
    expect(sp('2026-05-24', '2026-05-25').primary?.chip).toBe('Finde largo');    // noche del domingo 24 (finde 23-25)
    expect(sp('2026-05-26', '2026-05-27').primary).toBe(null);                    // después del feriado: nada
  });
  test('fechas inválidas → sin errores', () => {
    expect(sp('', '').any).toBe(false); expect(sp('2026-01-05', '2026-01-05').any).toBe(false);
  });
});

describe('🏷 Presentación', () => {
  test('modo bar (calendario): SOLO íconos, sin cartel de texto', () => {
    const h = specialChipsHTML('2026-12-31', '2027-01-03', { mode: 'bar' });
    expect(h.includes('🎆')).toBe(true); expect(h.includes('☀️')).toBe(true);
    expect(h.includes('sd-chip')).toBe(false);                                        // nada de píldoras
    expect(h.replace(/<[^>]*>/g, '').replace(/\s/g, '').length <= 8).toBe(true);      // el texto visible son solo 2 emojis
  });
  test('modo bar: el detalle completo está en el tooltip (title)', () => {
    const h = specialChipsHTML('2026-12-23', '2027-01-04', { mode: 'bar' });
    expect(h).toContain('Navidad'); expect(h).toContain('Año Nuevo'); expect(h).toContain('Temporada de verano');
  });
  test('modo bar: Finde largo muestra la bandera (dibujada con CSS, no emoji) y el tooltip dice "Finde largo" con sus fechas', () => {
    const h = specialChipsHTML('2026-11-21', '2026-11-23', { mode: 'bar' });
    expect(h).toContain('class="flag-ar"'); expect(h.replace(/<[^>]*>/g, '').includes('🇦🇷')).toBe(false);   // el emoji solo queda en el tooltip
    expect(h).toContain('Finde largo 21/11 al 23/11');
  });
  test('la bandera es la única que se reemplaza; los demás emojis se muestran tal cual', () => {
    expect(emojiHTML('🇦🇷')).toContain('flag-ar'); expect(emojiHTML('🎄')).toBe('🎄'); expect(emojiHTML('🎭')).toBe('🎭');
  });
  test('modo row (lista): chip chico con texto y Verano como ícono', () => {
    expect(specialChipsHTML('2026-02-03', '2026-02-06')).toContain('☀️');
    expect(specialChipsHTML('2026-11-21', '2026-11-23')).toContain('Finde largo');
  });
  test('modo full (ficha): lista todo, incluido Verano con texto', () => {
    const h = specialChipsHTML('2026-12-23', '2027-01-04', { mode: 'full' });
    expect(h).toContain('Navidad'); expect(h).toContain('Año Nuevo'); expect(h).toContain('☀️ Verano');
  });
  test('estadía común → vacío', () => { expect(specialChipsHTML('2026-10-20', '2026-10-24')).toBe(''); });
});
