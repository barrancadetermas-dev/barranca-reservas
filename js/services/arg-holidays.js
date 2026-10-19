// ══════════════════════════════════════════════════
// arg-holidays.js — Feriados argentinos para el calendario y las alertas
//
// ANTES este archivo tenía su propio cálculo (heurístico): movía el Día de la
// Bandera (es inamovible), calculaba San Martín / Diversidad / Soberanía como
// "n-ésimo lunes" (no es la regla legal), omitía a Güemes y al Jueves Santo e
// INVENTABA "puentes turísticos". Ahora es una vista del módulo único
// services/special-dates.js (Ley 27.399 + decretos oficiales por año) con el mismo
// formato de siempre, para que calendario, notificaciones y temporada alta
// usen EXACTAMENTE las mismas fechas que las etiquetas de las reservas.
// Se conservan las vacaciones de invierno ESTIMADAS (tipo 'vacation').
// ══════════════════════════════════════════════════

import { holidaysForYear } from './special-dates.js';

/** Devuelve 'YYYY-MM-DD' desde componentes */
const iso = (y, m, d) =>
  `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

/** Agrega días a una fecha ISO */
function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Etiquetas históricas (otros módulos las muestran o las buscan por texto)
const LEGACY_LABEL = {
  newyear: 'Año Nuevo', memoria: 'Día Nac. de la Memoria', malvinas: 'Día del Veterano — Malvinas',
  trabajo: 'Día del Trabajador', mayo: 'Revolución de Mayo', bandera: 'Belgrano', julio: 'Día de la Independencia',
  inmaculada: 'Inmaculada Concepción', navidad: 'Navidad', guemes: 'Güemes', sanmartin: 'San Martín',
  diversidad: 'Diversidad Cultural', soberania: 'Soberanía Nac.', carnaval1: 'Carnaval', carnaval2: 'Carnaval',
  viernes_santo: 'Viernes Santo', jueves_santo: 'Jueves Santo (no laborable)', puente: 'Puente turístico',
};
// special-dates → tipos históricos: inamovible = fixed · trasladable y los que dependen de Pascua = movable · no laborables = bridge
const legacyType = h => (h.kind === 'puente' || h.kind === 'no_laborable') ? 'bridge'
  : (h.kind === 'trasladable' || h.key === 'viernes_santo' || h.key.startsWith('carnaval')) ? 'movable' : 'fixed';

/**
 * Feriados y días no laborables de un año.
 * @returns {Map<string, {label:string, type:'fixed'|'movable'|'bridge'|'vacation'}>}
 */
export function getArgHolidays(year) {
  const H = new Map(); // key: 'YYYY-MM-DD', value: { label, type }
  // Si dos cosas caen el mismo día, el feriado real manda sobre lo estimado:
  // feriado fijo > trasladable > día no laborable > vacaciones (estimadas).
  // (Antes la última en llegar pisaba el tipo: el 9/7/2024 quedaba como "vacación" y dejaba de verse como feriado.)
  const RANK = { fixed: 4, movable: 3, bridge: 2, vacation: 1 };
  const add = (dateStr, label, type = 'fixed') => {
    const prev = H.get(dateStr);
    if (!prev) H.set(dateStr, { label, type });
    else H.set(dateStr, { label: prev.label + ' / ' + label, type: (RANK[type] ?? 0) > (RANK[prev.type] ?? 0) ? type : prev.type });
  };

  // Feriados oficiales y días no laborables (decretados), ya con sus traslados
  holidaysForYear(year).forEach(h => add(h.date, LEGACY_LABEL[h.key] ?? h.name, legacyType(h)));

  // ── VACACIONES DE INVIERNO (estimadas — semana 29 y 30 del año) ──
  // Nacional: generalmente las 2 semanas de julio más cercanas al 9/7
  const winterStart = _getWinterVacStart(year);
  for (let i = 0; i < 14; i++) {
    const d = addDays(winterStart, i);
    add(d, 'Vacaciones de Invierno', 'vacation');
  }

  return H;
}

/**
 * Devuelve la fecha de inicio de las vacaciones de invierno.
 * Regla general argentina: 2 semanas, empezando el lunes de la semana
 * que contiene el 13 de julio (o la semana anterior si cae cerca del 9/7).
 */
function _getWinterVacStart(year) {
  // El 9 de julio es el feriado ancla. Las vacaciones suelen ser
  // la semana del 13/7 y la siguiente.
  const jul13 = new Date(year, 6, 13);
  const dayOfWeek = jul13.getDay();
  // Retroceder al lunes de esa semana
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(jul13);
  monday.setDate(monday.getDate() + daysToMonday);
  return monday.toISOString().slice(0, 10);
}

/**
 * Devuelve true si una fecha ISO es sábado o domingo
 */
export function isWeekend(isoDate) {
  const d = new Date(isoDate + 'T12:00:00').getDay();
  return d === 0 || d === 6;
}

/**
 * Dado un año y un mes, devuelve el mapa de feriados del mes
 * (para no calcular el año completo en cada celda)
 */
const _cache = new Map();
export function getHolidaysForYear(year) {
  if (_cache.has(year)) return _cache.get(year);
  const h = getArgHolidays(year);
  _cache.set(year, h);
  return h;
}
