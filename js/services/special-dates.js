// ══════════════════════════════════════════════════════════════
// special-dates.js — Fechas especiales del calendario argentino
//
// ÚNICA fuente de verdad de: feriados nacionales, días no laborables,
// fines de semana largos, Carnaval / Semana Santa / Pascua, Navidad,
// Año Nuevo y temporada de verano. Pura (sin DOM ni red).
//
// Qué se CALCULA (no depende del año):
//   • Pascua (algoritmo gregoriano) → Jueves/Viernes Santo y Carnaval
//   • Feriados inamovibles y su fecha fija
//   • Traslado de feriados trasladables (Ley 27.399, art. 6):
//       martes/miércoles → lunes anterior · jueves/viernes → lunes siguiente
//   • Fines de semana largos: ≥ 3 días libres seguidos que incluyan algún
//     feriado / día no laborable (sábado y domingo cuentan como libres)
//
// Qué NO se puede calcular y se carga por año desde el Boletín Oficial:
//   • Días no laborables con fines turísticos ("puentes", art. 7)
//   • Traslados de feriados que caen sábado/domingo (Decreto 614/2025)
// Si un año no está en las tablas de abajo, NO se inventan puentes: solo se
// muestran los que corresponden por ley. Actualizar las tablas cuando se
// publique el decreto del año siguiente.
//
// Noches: igual que el resto de Mila, una estadía ocupa las noches
// [check_in, check_out). El día del check-out no es una noche.
// ══════════════════════════════════════════════════════════════

import { dayNum, addDays } from './stay-segments.js';

// ── Decisiones oficiales por año (ACTUALIZAR cuando se publiquen) ─────────
/** Días no laborables con fines turísticos (Ley 27.399 art. 7). */
export const TOURIST_BRIDGES = {
  2025: ['2025-05-02', '2025-08-15', '2025-11-21'],   // Decreto 1027/2024
  2026: ['2026-03-23', '2026-07-10', '2026-12-07'],   // Decreto 164/2025
  // 2027: pendiente — el decreto debe publicarse ≥ 50 días antes de fin de 2026
};
/** Feriados trasladables que caían sábado/domingo y la autoridad movió (Decreto 614/2025). */
export const MOVED_WEEKEND_HOLIDAYS = {
  '2025-10-12': '2025-10-10',                         // Resolución 139/2025 (JGM)
};

// ── Utilidades de fecha ───────────────────────────────────────────────────
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
/** 0 = domingo … 6 = sábado */
export const weekday = d => new Date(d + 'T12:00:00Z').getUTCDay();
const isWeekend = d => { const w = weekday(d); return w === 0 || w === 6; };
const fmtDM = d => d.split('-').reverse().slice(0, 2).join('/');
const DAYNAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** Domingo de Pascua (calendario gregoriano, algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

/** Traslado de un feriado trasladable según la Ley 27.399 art. 6 + decisiones por año. */
function movedDate(date) {
  if (MOVED_WEEKEND_HOLIDAYS[date]) return MOVED_WEEKEND_HOLIDAYS[date];
  const w = weekday(date);
  if (w === 2 || w === 3) return addDays(date, -(w - 1));   // martes/miércoles → lunes anterior
  if (w === 4 || w === 5) return addDays(date, 8 - w);      // jueves/viernes → lunes siguiente
  return date;                                              // lunes, sábado, domingo: no se mueve
}

// ── Catálogo de feriados ──────────────────────────────────────────────────
// named: etiquetas con identidad propia (siempre se muestran por su nombre)
const FIXED = [
  // [mes, día, clave, nombre, corto, emoji, tipo, named]
  [1, 1,   'newyear',   'Año Nuevo',                          'Año Nuevo',  '🎆', 'inamovible', 'newyear'],
  [3, 24,  'memoria',   'Día de la Memoria por la Verdad y la Justicia', 'Memoria', '🕊️', 'inamovible'],
  [4, 2,   'malvinas',  'Día del Veterano y de los Caídos en Malvinas', 'Malvinas', '🇦🇷', 'inamovible'],
  [5, 1,   'trabajo',   'Día del Trabajador',                 'Trabajador', '🛠️', 'inamovible'],
  [5, 25,  'mayo',      'Día de la Revolución de Mayo',       '25 de Mayo', '🇦🇷', 'inamovible'],
  [6, 20,  'bandera',   'Día de la Bandera (Gral. Belgrano)', 'Bandera',    '🇦🇷', 'inamovible'],
  [7, 9,   'julio',     'Día de la Independencia',            '9 de Julio', '🇦🇷', 'inamovible'],
  [12, 8,  'inmaculada','Inmaculada Concepción de María',     'Inmaculada', '⛪', 'inamovible'],
  [12, 25, 'navidad',   'Navidad',                            'Navidad',    '🎄', 'inamovible', 'christmas'],
];
const MOVABLE = [
  [6, 17,  'guemes',    'Paso a la Inmortalidad del Gral. Güemes', 'Güemes',      '🇦🇷', 'trasladable'],
  [8, 17,  'sanmartin', 'Paso a la Inmortalidad del Gral. San Martín', 'San Martín', '🇦🇷', 'trasladable'],
  [10, 12, 'diversidad','Día del Respeto a la Diversidad Cultural', 'Diversidad',   '🌎', 'trasladable'],
  [11, 20, 'soberania', 'Día de la Soberanía Nacional',       'Soberanía',    '🇦🇷', 'trasladable'],
];

const cache = new Map();

/**
 * Feriados y días no laborables de un año, ordenados por fecha.
 * @returns {Array<{date:string, key:string, name:string, short:string, emoji:string,
 *   kind:'inamovible'|'trasladable'|'puente'|'no_laborable', named?:string,
 *   originalDate?:string}>}
 *   kind 'puente' y 'no_laborable' NO son feriados obligatorios: son días no laborables.
 */
export function holidaysForYear(y) {
  const ck = 'h' + y;
  if (cache.has(ck)) return cache.get(ck);
  const list = [];
  FIXED.forEach(([m, d, key, name, short, emoji, kind, named]) =>
    list.push({ date: iso(y, m, d), key, name, short, emoji, kind, ...(named ? { named } : {}) }));
  MOVABLE.forEach(([m, d, key, name, short, emoji, kind]) => {
    const orig = iso(y, m, d), date = movedDate(orig);
    list.push({ date, key, name, short, emoji, kind, ...(date !== orig ? { originalDate: orig } : {}) });
  });
  // Semana Santa y Carnaval (dependen de Pascua)
  const easter = easterSunday(y);
  list.push({ date: addDays(easter, -48), key: 'carnaval1', name: 'Carnaval (lunes)',  short: 'Carnaval', emoji: '🎭', kind: 'inamovible', named: 'carnival' });
  list.push({ date: addDays(easter, -47), key: 'carnaval2', name: 'Carnaval (martes)', short: 'Carnaval', emoji: '🎭', kind: 'inamovible', named: 'carnival' });
  list.push({ date: addDays(easter, -3),  key: 'jueves_santo', name: 'Jueves Santo (día no laborable)', short: 'Semana Santa', emoji: '✝️', kind: 'no_laborable', named: 'easter' });
  list.push({ date: addDays(easter, -2),  key: 'viernes_santo', name: 'Viernes Santo', short: 'Semana Santa', emoji: '✝️', kind: 'inamovible', named: 'easter' });
  // Puentes turísticos del año (por decreto)
  (TOURIST_BRIDGES[y] ?? []).forEach(date =>
    list.push({ date, key: 'puente', name: 'Día no laborable con fines turísticos', short: 'Puente', emoji: '🧳', kind: 'puente' }));
  list.sort((a, b) => a.date.localeCompare(b.date));
  cache.set(ck, list);
  return list;
}

const holidayMapForYear = y => {
  const ck = 'm' + y;
  if (!cache.has(ck)) {
    const m = new Map();
    holidaysForYear(y).forEach(h => { if (!m.has(h.date)) m.set(h.date, []); m.get(h.date).push(h); });
    cache.set(ck, m);
  }
  return cache.get(ck);
};
/** Todos los feriados/no laborables que caen en una fecha ISO (puede haber más de uno). */
export function holidaysOn(date) {
  const y = +date.slice(0, 4);
  return holidayMapForYear(y).get(date) ?? [];
}

// ── Fines de semana largos ────────────────────────────────────────────────
/**
 * Fines de semana largos que TOCAN el año `y` (≥ 3 días libres seguidos con algún
 * feriado o día no laborable; sábado y domingo cuentan como libres).
 * @returns {Array<{from:string,to:string,days:number,holidays:Array,named:?string,label:string}>}
 */
export function longWeekends(y) {
  const ck = 'lw' + y;
  if (cache.has(ck)) return cache.get(ck);
  const out = [];
  const start = addDays(iso(y, 1, 1), -10), end = addDays(iso(y, 12, 31), 10);
  let run = [];
  const flush = () => {
    if (run.length >= 3) {
      const hs = run.flatMap(d => holidaysOn(d));
      if (hs.length) {
        const named = hs.find(h => h.named === 'carnival' || h.named === 'easter')?.named
          ?? hs.find(h => h.named === 'newyear')?.named ?? hs.find(h => h.named === 'christmas')?.named ?? null;
        out.push({ from: run[0], to: run[run.length - 1], days: run.length, holidays: hs, named,
          label: named === 'carnival' ? 'Carnaval' : named === 'easter' ? 'Semana Santa' : 'Finde largo' });
      }
    }
    run = [];
  };
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (isWeekend(d) || holidaysOn(d).length) run.push(d); else flush();
  }
  flush();
  // Solo los que tocan el año pedido (los de diciembre/enero pertenecen a ambos)
  const res = out.filter(l => l.to >= iso(y, 1, 1) && l.from <= iso(y, 12, 31));
  cache.set(ck, res);
  return res;
}

// ── Temporada de verano ───────────────────────────────────────────────────
export const SUMMER_START = { m: 1, d: 2 };    // 2 de enero
export const SUMMER_END   = { m: 3, d: 10 };   // 10 de marzo (inclusive)
/** ¿Alguna noche de la estadía cae entre el 2/1 y el 10/3 (inclusive) de cualquier año? */
export function isSummerStay(checkIn, checkOut) {
  const lastNight = addDays(checkOut, -1);
  if (lastNight < checkIn) return false;
  for (let y = +checkIn.slice(0, 4); y <= +lastNight.slice(0, 4); y++) {
    const a = iso(y, SUMMER_START.m, SUMMER_START.d), b = iso(y, SUMMER_END.m, SUMMER_END.d);
    if (checkIn <= b && lastNight >= a) return true;
  }
  return false;
}

// ── Detección para una estadía ────────────────────────────────────────────
// Prioridad visual (mayor = más importante). El verano va aparte (otra dimensión).
const PRIORITY = { newyear: 100, christmas: 100, carnival: 90, easter: 90, holiday: 70, puente: 60, longweekend: 50 };

const overlaps = (ci, lastNight, a, b) => ci <= b && lastNight >= a;

/**
 * Fechas especiales de una estadía.
 * Un feriado "coincide" si alguna NOCHE de la estadía cae en su ventana:
 *   • feriado común H → noches {H−1, H}
 *   • Año Nuevo → 31/12 y 1/1 · Navidad → 24/12 y 25/12
 *   • fin de semana largo [F..L] → noches {F−1 … L−1} (desde la víspera del primer día libre)
 * Etiquetas sin duplicar: un feriado que forma parte de un finde largo se muestra una sola vez.
 *
 * @param {string} checkIn   'YYYY-MM-DD'
 * @param {string} checkOut  'YYYY-MM-DD' (no cuenta como noche)
 * @returns {{ primary:?object, others:object[], all:object[], summer:boolean, any:boolean }}
 *   cada evento: { id, type, priority, emoji, label, short, chip, detail, from, to, longWeekend?:{from,to,days} }
 */
export function specialsForStay(checkIn, checkOut) {
  if (!checkIn || !checkOut || dayNum(checkOut) <= dayNum(checkIn)) return { primary: null, others: [], all: [], summer: false, any: false };
  const ck = `s|${checkIn}|${checkOut}`;
  if (cache.has(ck)) return cache.get(ck);

  const lastNight = addDays(checkOut, -1);
  const years = new Set();
  for (let y = +checkIn.slice(0, 4) - 1; y <= +checkOut.slice(0, 4) + 1; y++) years.add(y);

  // 1) Fines de semana largos que tocan la estadía (por noches desde la víspera)
  const lws = [];
  years.forEach(y => longWeekends(y).forEach(l => {
    if (overlaps(checkIn, lastNight, addDays(l.from, -1), addDays(l.to, -1)) && !lws.some(x => x.from === l.from)) lws.push(l);
  }));

  // 2) Feriados y días no laborables cuya ventana coincide con alguna noche
  const matched = [];
  years.forEach(y => holidaysForYear(y).forEach(h => {
    let a, b;
    if (h.key === 'newyear')      { a = addDays(h.date, -1); b = h.date; }          // Nochevieja + 1/1
    else if (h.key === 'navidad') { a = addDays(h.date, -1); b = h.date; }          // Nochebuena + 25/12
    else                          { a = addDays(h.date, -1); b = h.date; }
    if (overlaps(checkIn, lastNight, a, b) && !matched.some(m => m.date === h.date && m.key === h.key)) matched.push(h);
  }));

  const events = [];
  const usedLw = new Set();
  const lwOf = h => lws.find(l => h.date >= l.from && h.date <= l.to);

  // Carnaval / Semana Santa: un único evento con la ventana del finde largo (o de sus días)
  ['carnival', 'easter'].forEach(kind => {
    const hs = matched.filter(h => h.named === kind);
    const lw = lws.find(l => l.named === kind);
    if (!hs.length && !lw) return;
    const group = hs.length ? hs : lw.holidays.filter(h => h.named === kind);
    const lwRef = lw ?? lwOf(group[0]);
    if (lwRef) usedLw.add(lwRef.from);
    const first = lwRef?.from ?? group[0].date, last = lwRef?.to ?? group[group.length - 1].date;
    events.push({
      id: kind, type: kind, priority: PRIORITY[kind],
      emoji: kind === 'carnival' ? '🎭' : '✝️',
      label: kind === 'carnival' ? 'Carnaval' : 'Semana Santa',
      short: kind === 'carnival' ? 'Carnaval' : 'Semana Santa',
      chip: kind === 'carnival' ? 'Carnaval' : 'Semana Santa',
      detail: `${kind === 'carnival' ? 'Carnaval' : 'Semana Santa'} · ${fmtDM(first)} al ${fmtDM(last)}${lwRef ? ` (${lwRef.days} días libres)` : ''}`,
      from: first, to: last,
      ...(lwRef ? { longWeekend: { from: lwRef.from, to: lwRef.to, days: lwRef.days } } : {}),
    });
  });

  // Feriados nombrados (Año Nuevo, Navidad) y feriados/puentes comunes
  const rest = matched.filter(h => h.named !== 'carnival' && h.named !== 'easter');
  rest.forEach(h => {
    const lw = lwOf(h);
    if (lw) usedLw.add(lw.from);
    const isNamed = h.named === 'newyear' || h.named === 'christmas';
    const type = isNamed ? h.named : (h.kind === 'puente' ? 'puente' : 'holiday');
    const when = `${DAYNAMES[weekday(h.date)]} ${fmtDM(h.date)}`;
    const moved = h.originalDate ? ` (trasladado del ${fmtDM(h.originalDate)})` : '';
    // Un feriado/puente dentro de un finde largo se identifica como "Finde largo" (con su bandera);
    // los nombrados y los feriados aislados, por su nombre.
    const chip = isNamed ? h.short : (lw ? 'Finde largo' : h.short);
    events.push({
      id: `${h.key}@${h.date}`, type, priority: PRIORITY[type],
      emoji: h.emoji, label: h.name, short: h.short, chip,
      detail: `${h.name} · ${when}${moved}${h.kind === 'puente' ? ' · día no laborable' : h.kind === 'no_laborable' ? ' · día no laborable' : ''}`,
      from: h.date, to: h.date,
      ...(lw ? { longWeekend: { from: lw.from, to: lw.to, days: lw.days } } : {}),
    });
  });

  // Fines de semana largos que tocan la estadía pero NO por un feriado ya mostrado
  lws.filter(l => !usedLw.has(l.from)).forEach(l => {
    const main = l.holidays.find(h => h.kind !== 'puente') ?? l.holidays[0];
    events.push({
      id: `lw@${l.from}`, type: 'longweekend', priority: PRIORITY.longweekend,
      emoji: main?.emoji ?? '🗓️', label: 'Fin de semana largo', short: 'Finde largo', chip: 'Finde largo',
      detail: `Fin de semana largo · ${fmtDM(l.from)} al ${fmtDM(l.to)} (${l.days} días)${main ? ' · ' + main.name : ''}`,
      from: l.from, to: l.to, longWeekend: { from: l.from, to: l.to, days: l.days },
    });
  });

  // Prioridad; a igual prioridad, la más cercana al check-in
  events.sort((a, b) => b.priority - a.priority || a.from.localeCompare(b.from));
  const summer = isSummerStay(checkIn, checkOut);
  const res = { primary: events[0] ?? null, others: events.slice(1), all: events, summer, any: events.length > 0 || summer };
  if (cache.size > 4000) cache.clear();
  cache.set(ck, res);
  return res;
}

// ── Presentación (HTML compacto, reutilizable en calendario, lista y ficha) ──
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Texto del tooltip con TODAS las fechas especiales de la estadía. */
export function specialsTitle(sp) {
  if (!sp.any) return '';
  const lines = sp.all.map(e => `${e.emoji} ${e.detail}`);
  if (sp.summer) lines.push('☀️ Temporada de verano (2/1 al 10/3)');
  return lines.join('\n');
}

/**
 * Chips de fechas especiales. Nunca duplica etiquetas: un solo chip principal,
 * "+N" con el resto en el tooltip, y ☀️ aparte (el verano es una temporada, no un feriado).
 * @param {{ mode?:'bar'|'row'|'full' }} [o]
 *   bar  → principal + ☀️ (sin texto de verano) + "+N"  (espacio mínimo)
 *   row  → principal + "Verano" + "+N"
 *   full → principal + todos los demás + "Verano"
 */
export function specialChipsHTML(checkIn, checkOut, { mode = 'row' } = {}) {
  const sp = specialsForStay(checkIn, checkOut);
  if (!sp.any) return '';
  const title = escAttr(specialsTitle(sp));
  const parts = [];
  const chip = (e, extra = '') =>
    `<span class="sd-chip sd-${e.type}${extra}" title="${title}">${e.emoji} ${escAttr(e.chip)}</span>`;
  if (mode === 'full') {
    sp.all.forEach(e => parts.push(`<span class="sd-chip sd-${e.type}" title="${escAttr(e.detail)}">${e.emoji} ${escAttr(e.type === 'holiday' || e.type === 'puente' ? e.short : e.chip)}${e.longWeekend && e.type !== 'longweekend' && e.type !== 'carnival' && e.type !== 'easter' ? ' · Finde largo' : ''}</span>`));
  } else if (sp.primary) {
    parts.push(chip(sp.primary));
    if (sp.others.length) parts.push(`<span class="sd-more" title="${title}">+${sp.others.length}</span>`);
  }
  if (sp.summer) {
    parts.push(mode === 'bar'
      ? `<span class="sd-chip sd-summer sd-icon" title="${title}" aria-label="Temporada de verano">☀️</span>`
      : `<span class="sd-chip sd-summer" title="${title}">☀️ Verano</span>`);
  }
  return `<span class="sd-wrap">${parts.join('')}</span>`;
}
