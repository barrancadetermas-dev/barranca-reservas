// ══════════════════════════════════════════════════
// arg-holidays.js — Feriados argentinos dinámicos
// Feriados fijos + inamovibles + puentes turísticos
// Vacaciones de invierno (estimadas)
// Se recalcula para cualquier año
// ══════════════════════════════════════════════════

/** Devuelve 'YYYY-MM-DD' desde componentes */
const iso = (y, m, d) =>
  `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

/** Número de día de la semana para una fecha (0=dom…6=sáb) */
const dow = (y, m, d) => new Date(y, m - 1, d).getDay();

/** N-ésimo lunes de un mes */
function nthMonday(y, m, n) {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const date = new Date(y, m - 1, d);
    if (date.getMonth() !== m - 1) break;
    if (date.getDay() === 1) { count++; if (count === n) return d; }
  }
  return 1;
}

/**
 * Calcular Pascua (algoritmo de Butcher/Meeus)
 * Devuelve [mes, día] para el año dado
 */
function easterDate(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

/** Agrega días a una fecha ISO */
function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Mueve al lunes siguiente si cae en finde */
function toNearestMonday(y, m, d) {
  const dayOfWeek = dow(y, m, d);
  if (dayOfWeek === 6) return iso(y, m, d + 2); // sáb → lun
  if (dayOfWeek === 0) return iso(y, m, d + 1); // dom → lun
  return iso(y, m, d);
}

/**
 * Genera todos los feriados argentinos para un año dado.
 * @returns {{
 *   holidays: Map<string, {label:string, type:'fixed'|'movable'|'bridge'|'vacation'}>,
 * }}
 */
export function getArgHolidays(year) {
  const H = new Map(); // key: 'YYYY-MM-DD', value: { label, type }

  const add = (dateStr, label, type = 'fixed') => {
    if (!H.has(dateStr)) H.set(dateStr, { label, type });
    else H.set(dateStr, { label: H.get(dateStr).label + ' / ' + label, type });
  };

  // ── FERIADOS FIJOS ────────────────────────────────
  add(iso(year,  1,  1), 'Año Nuevo');
  add(iso(year,  3, 24), 'Día Nac. de la Memoria');
  add(iso(year,  4,  2), 'Día del Veterano — Malvinas');
  add(iso(year,  5,  1), 'Día del Trabajador');
  add(iso(year,  5, 25), 'Revolución de Mayo');
  add(iso(year,  7,  9), 'Día de la Independencia');
  add(iso(year, 12,  8), 'Inmaculada Concepción');
  add(iso(year, 12, 25), 'Navidad');

  // ── FERIADOS INAMOVIBLES (se trasladan si caen en finde) ──
  // Belgrano: 20 jun
  add(toNearestMonday(year, 6, 20), 'Belgrano', 'movable');
  // San Martín: 3.er lunes de agosto
  add(iso(year, 8, nthMonday(year, 8, 3)), 'San Martín', 'movable');
  // Diversidad Cultural: lunes más cercano al 12 oct
  add(toNearestMonday(year, 10, 12), 'Diversidad Cultural', 'movable');
  // Soberanía Nacional: 4.° lunes de noviembre
  add(iso(year, 11, nthMonday(year, 11, 4)), 'Soberanía Nac.', 'movable');

  // ── MÓVILES (dependen de Pascua) ──────────────────
  const [em, ed] = easterDate(year);
  const easterISO = iso(year, em, ed);
  add(addDays(easterISO, -2),  'Viernes Santo',  'movable');  // -2 días
  // Carnaval: lunes y martes antes del Miércoles de Ceniza (Pascua -47 días)
  add(addDays(easterISO, -48), 'Carnaval',       'movable');
  add(addDays(easterISO, -47), 'Carnaval',       'movable');

  // ── PUENTES TURÍSTICOS ESTIMADOS ──────────────────
  // El gobierno los anuncia cada diciembre. Aquí estimamos los más
  // probables (lunes/viernes entre feriado y fin de semana).
  _estimateBridges(year, H, add);

  // ── VACACIONES DE INVIERNO (estimadas — semana 29 y 30 del año) ──
  // Nacional: generalmente las 2 semanas de julio más cercanas al 9/7
  // En 2026 el 9 jul es jueves → probablemente 6-17 jul o 13-24 jul
  const winterStart = _getWinterVacStart(year);
  for (let i = 0; i < 14; i++) {
    const d = addDays(winterStart, i);
    add(d, 'Vacaciones de Invierno', 'vacation');
  }

  return H;
}

/**
 * Estima los "puentes turísticos" (días no laborables por decreto).
 * Se basa en los patrones históricos: el gobierno suele crear puentes
 * para hacer fines de semana extra-largo de 4 días.
 */
function _estimateBridges(year, H, add) {
  // Recorrer todos los feriados ya cargados y ver si hay un "gap" de 1 día
  // entre un feriado y un fin de semana. Ese día es candidato a puente.
  const feriados = [...H.keys()].filter(d => H.get(d).type !== 'vacation');
  feriados.forEach(fDate => {
    const fd = new Date(fDate + 'T12:00:00');
    const wd = fd.getDay();
    // Martes próximo a lunes libre → lunes puede ser puente (caso: feriado miércoles)
    // Viernes próximo a sábado-domingo + lunes feriado → viernes puente
    if (wd === 2) { // Martes feriado → lunes podría ser puente
      const bridgeISO = addDays(fDate, -1);
      if (!H.has(bridgeISO)) add(bridgeISO, 'Puente turístico*', 'bridge');
    }
    if (wd === 4) { // Jueves feriado → viernes podría ser puente
      const bridgeISO = addDays(fDate, 1);
      if (!H.has(bridgeISO)) add(bridgeISO, 'Puente turístico*', 'bridge');
    }
    if (wd === 3) { // Miércoles feriado → lunes+martes o jue+vie puentes
      // No agregar automáticamente (demasiado especulativo)
    }
  });
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
