// ══════════════════════════════════════════════════════════════
// stay-segments.js — ÚNICA fuente de verdad de "qué unidad ocupa
// una reserva en cada noche".
//
// Modelo: una reserva es un conjunto de TRAMOS (unidad, desde, hasta)
// guardados en booking_units. Intervalos semiabiertos [desde, hasta):
// la noche del día `hasta` ya NO pertenece al tramo (ahí entra el
// siguiente, igual que un recambio normal de check-out / check-in).
//
//   • Reserva común → 1 fila con segment_* = NULL  ⇒ "toda la estadía".
//     Sigue las fechas de la reserva sola: mover/extender/acortar no
//     requiere tocar nada más. (Por eso NO se completan los NULL.)
//   • Dos deptos A LA VEZ → 2 filas con segment_* = NULL.
//   • Cambio de depto → filas con segment_* explícitos, uno por tramo.
//
// Todo el que necesite saber ocupación (disponibilidad, calendario,
// estadísticas, limpieza, voucher, ficha) debe pasar por acá en vez
// de leer segment_check_in/out por su cuenta.
//
// Fechas: 'YYYY-MM-DD'. Sin zonas horarias (se cuenta en días UTC).
// ══════════════════════════════════════════════════════════════

const DAY_MS = 86400000;

/** Número de día absoluto de una fecha ISO (para restar/comparar sin husos). */
export const dayNum  = iso => Math.round(Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z') / DAY_MS);
export const addDays = (iso, n) => new Date((dayNum(iso) + n) * DAY_MS).toISOString().slice(0, 10);
export const nightsBetween = (from, to) => dayNum(to) - dayNum(from);

const maxIso = (a, b) => (a >= b ? a : b);
const minIso = (a, b) => (a <= b ? a : b);

/**
 * Tramos normalizados de una reserva, ordenados cronológicamente.
 * - segment_* NULL → ventana completa de la reserva.
 * - Tramos que se pasan de la ventana (datos viejos tras acortar/mover la
 *   reserva con código que no conocía los tramos) se recortan; los que
 *   quedan vacíos se descartan. Autocorrección de lectura, nunca escribe.
 *
 * @returns {Array<{id:?string, unit_id:string, from:string, to:string, nights:number,
 *                  pricePerNight:?number, unit:?object, explicit:boolean, row:object}>}
 */
export function getSegments(booking) {
  if (!booking?.check_in || !booking?.check_out) return [];
  const ci = booking.check_in, co = booking.check_out;
  const out = [];
  for (const bu of booking.booking_units ?? []) {
    if (!bu?.unit_id) continue;
    const explicit = !!(bu.segment_check_in && bu.segment_check_out);
    const from = explicit ? maxIso(bu.segment_check_in, ci) : ci;
    const to   = explicit ? minIso(bu.segment_check_out, co) : co;
    if (dayNum(to) <= dayNum(from)) continue;
    const price = bu.price_per_night;
    out.push({
      id: bu.id ?? null,
      unit_id: String(bu.unit_id),
      from, to,
      nights: nightsBetween(from, to),
      pricePerNight: price == null || price === '' ? null : Number(price),
      unit: bu.units ?? null,
      explicit,
      row: bu,                       // fila original de booking_units (para conservar `units`, etc.)
    });
  }
  return out.sort((a, b) =>
    a.from.localeCompare(b.from) || a.to.localeCompare(b.to)
    || (a.unit?.sort_order ?? 0) - (b.unit?.sort_order ?? 0)
    || a.unit_id.localeCompare(b.unit_id));
}

/** ¿La reserva cambia de departamento durante la estadía? (algún tramo no cubre toda la ventana) */
export function isSplit(booking) {
  const segs = getSegments(booking);
  return segs.length > 1 && segs.some(s => s.from !== booking.check_in || s.to !== booking.check_out);
}

/** ¿El depto `unitId` está ocupado por esta reserva en la NOCHE que empieza el día `iso`? */
export function occupiesNight(booking, unitId, iso) {
  const id = String(unitId);
  return getSegments(booking).some(s => s.unit_id === id && s.from <= iso && iso < s.to);
}

/** Ids de deptos ocupados por la reserva en la noche que empieza `iso`. */
export function unitIdsOnNight(booking, iso) {
  return [...new Set(getSegments(booking).filter(s => s.from <= iso && iso < s.to).map(s => s.unit_id))];
}

/** ¿El depto `unitId` tiene algún tramo de esta reserva que pise [from, to)? */
export function overlapsRange(booking, unitId, from, to) {
  const id = String(unitId);
  return getSegments(booking).some(s => s.unit_id === id && s.from < to && s.to > from);
}

/** Noches que el depto `unitId` ocupa dentro de la ventana [from, to) (para estadísticas por unidad). */
export function unitNightsInRange(booking, unitId, from, to) {
  const id = String(unitId);
  let n = 0;
  for (const s of getSegments(booking)) {
    if (s.unit_id !== id) continue;
    n += Math.max(0, nightsBetween(maxIso(s.from, from), minIso(s.to, to)));
  }
  return n;
}

/**
 * Filas de booking_units (con su `units`) que la reserva ocupa la NOCHE que empieza `iso`.
 * Para pantallas que ya iteran `booking_units` y solo necesitan filtrar por día.
 */
export function rowsOnNight(booking, iso) {
  return getSegments(booking).filter(s => s.from <= iso && iso < s.to).map(s => s.row);
}
/** Filas de las unidades donde el huésped ENTRA (check-in). */
export function rowsAtArrival(booking) { return arrivalSegments(booking).map(s => s.row); }
/** Filas de las unidades de las que el huésped SALE (check-out final). */
export function rowsAtDeparture(booking) { return departureSegments(booking).map(s => s.row); }

/** Tramos donde el huésped ENTRA (primer día de la reserva): son los deptos del check-in. */
export function arrivalSegments(booking) {
  return getSegments(booking).filter(s => s.from === booking.check_in);
}
/** Tramos donde el huésped SALE (último día): son los deptos del check-out. */
export function departureSegments(booking) {
  return getSegments(booking).filter(s => s.to === booking.check_out);
}

/**
 * Cambios de departamento: fechas intermedias donde un tramo termina y otro empieza.
 * @returns {Array<{date:string, leaving:string[], entering:string[]}>}
 */
export function handoffs(booking) {
  const segs = getSegments(booking);
  const dates = [...new Set(segs.flatMap(s => [s.from, s.to]))]
    .filter(d => d > booking.check_in && d < booking.check_out).sort();
  return dates.map(date => ({
    date,
    leaving:  segs.filter(s => s.to === date).map(s => s.unit_id),
    entering: segs.filter(s => s.from === date).map(s => s.unit_id),
  })).filter(h => h.leaving.length && h.entering.length);
}

/**
 * Subtotal de alojamiento según los tramos: Σ precio del tramo × noches del tramo.
 * Sirve igual para 1 depto, 2 simultáneos y cambios de depto.
 * @returns {number|null} null si algún tramo no tiene precio propio
 */
export function segmentsSubtotal(segments) {
  if (!segments.length || segments.some(s => s.pricePerNight == null)) return null;
  return segments.reduce((sum, s) => sum + s.pricePerNight * s.nights, 0);
}

/**
 * Valida un conjunto de tramos contra la ventana de la reserva.
 * Reglas (las que evitan reservas "rotas"):
 *  1. cada tramo con depto, desde < hasta y dentro de [check_in, check_out]
 *  2. un depto aparece UNA sola vez por reserva (restricción UNIQUE de la base)
 *  3. toda noche de la reserva queda cubierta por al menos un tramo (sin huecos)
 * @param {{check_in:string, check_out:string}} window
 * @param {Array<{unit_id:string, from:string, to:string}>} segments
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateSegments(window, segments) {
  const errors = [];
  const { check_in: ci, check_out: co } = window;
  if (!ci || !co || dayNum(co) <= dayNum(ci)) return { ok: false, errors: ['Fechas de la reserva inválidas'] };
  if (!segments?.length) return { ok: false, errors: ['La reserva necesita al menos un departamento'] };

  const seen = new Set();
  for (const s of segments) {
    if (!s.unit_id)                        { errors.push('Hay un tramo sin departamento'); continue; }
    if (!s.from || !s.to || dayNum(s.to) <= dayNum(s.from)) { errors.push('Un tramo tiene fechas inválidas (el hasta debe ser posterior al desde)'); continue; }
    if (s.from < ci || s.to > co)          errors.push('Un tramo se sale de las fechas de la reserva');
    const id = String(s.unit_id);
    if (seen.has(id))                      errors.push('Un departamento no puede repetirse en la misma reserva');
    seen.add(id);
  }
  if (!errors.length) {
    for (let d = ci; d < co; d = addDays(d, 1)) {
      if (!segments.some(s => s.from <= d && d < s.to)) {
        errors.push(`La noche del ${d.split('-').reverse().join('/')} no tiene departamento asignado`);
        break;
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Filas para guardar en booking_units a partir de tramos validados.
 * Un tramo que cubre TODA la ventana se guarda con segment_* = NULL
 * (conserva el formato histórico: sigue las fechas de la reserva solo).
 */
export function toBookingUnitRows(window, segments, bookingId = undefined) {
  return segments.map(s => {
    const full = s.from === window.check_in && s.to === window.check_out;
    const row = {
      unit_id: s.unit_id,
      segment_check_in:  full ? null : s.from,
      segment_check_out: full ? null : s.to,
    };
    if (s.pricePerNight != null) row.price_per_night = s.pricePerNight;
    if (bookingId) row.booking_id = bookingId;
    return row;
  });
}

/**
 * Parte una estadía en dos tramos consecutivos en `splitDate` (ej: 12/01).
 * Atajo para el caso más común "2 noches en Depto 2 + 1 noche en Depto 5".
 */
export function twoSegments(window, unitA, unitB, splitDate) {
  return [
    { unit_id: unitA, from: window.check_in, to: splitDate },
    { unit_id: unitB, from: splitDate, to: window.check_out },
  ];
}

/** "10/01 → 12/01 · Depto 2 · 2 noches" (texto reutilizable en ficha, tooltip, WhatsApp). */
export function describeSegment(s, unitName, { year = false } = {}) {
  const f = iso => iso.split('-').reverse().slice(0, year ? 3 : 2).join('/');
  return `${f(s.from)} → ${f(s.to)} · ${unitName ?? s.unit?.name ?? '—'} · ${s.nights} noche${s.nights === 1 ? '' : 's'}`;
}
