// ══════════════════════════════════════════════════════════════════════════
// booking-pricing.js — ÚNICA fuente del cálculo de precios de una reserva
//
// Reservas de 1 depto, o de varios SIN ajustes por unidad: misma fórmula de siempre
//   subtotal = (noches − sin cargo) × Σ precios → − descuento → + recargo → + late check-out
// (idéntica al formulario anterior, al centavo: las reservas viejas no cambian).
//
// Reservas con ajustes por unidad (noches sin cargo / descuento / recargo de un depto):
//   por unidad:  base = precio × (noches − (sin cargo colectivas + sin cargo de la unidad))
//                descuento = base × (desc. colectivo % + desc. de la unidad %) / 100   (tope 100%)
//                neto = base − descuento + recargo de la unidad
//   total = Σ neto + recargo colectivo + late check-out
// Las noches y fechas de la estadía NUNCA cambian: la noche sin cargo es solo económica.
//
// Un ajuste se expresa como { mode: 'pct' | 'amt', value }.
// ══════════════════════════════════════════════════════════════════════════

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const int = v => Math.max(0, parseInt(v, 10) || 0);

/** ¿Este ajuste de unidad tiene algún efecto? */
export function hasUnitAdjustment(u = {}) {
  return int(u.freeNights) > 0 || num(u.disc?.value) > 0 || num(u.surch?.value) > 0;
}

/**
 * @param {object} p
 * @param {number} p.nights
 * @param {Array<{id:string, price:number, freeNights?:number, disc?:{mode:string,value:number}, surch?:{mode:string,value:number}}>} p.units
 * @param {{freeNights?:number, disc?:{mode:string,value:number}, surch?:{mode:string,value:number}}} [p.collective]
 * @param {number} [p.late]  monto de late check-out (ya resuelto; 0 si no se cobra)
 */
export function computeBookingPricing({ nights, units = [], collective = {}, late = 0 }) {
  const N = int(nights);
  const priceSum = units.reduce((s, u) => s + num(u.price), 0);
  const freeC = int(collective.freeNights);
  const discC = collective.disc ?? { mode: 'pct', value: 0 };
  const surC  = collective.surch ?? { mode: 'amt', value: 0 };
  const unitMode = units.some(hasUnitAdjustment);

  // ── Camino clásico (todas las reservas actuales) ──────────────────────
  if (!unitMode) {
    const billable = Math.max(0, N - freeC);
    const subtotal = billable * priceSum;
    const discPct  = discC.mode === 'amt'
      ? (subtotal > 0 ? Math.min(100, num(discC.value) / subtotal * 100) : 0)
      : num(discC.value);
    const discAmt  = Math.round(subtotal * discPct / 100);
    const surchAmt = surC.mode === 'pct' ? Math.round(subtotal * num(surC.value) / 100) : num(surC.value);
    const total    = Math.max(0, Math.round(subtotal - discAmt + surchAmt + late));
    // Desglose por unidad (informativo): reparto proporcional al precio, el resto va a la última
    let left = Math.max(0, Math.round(subtotal - discAmt));
    const perUnit = units.map((u, i) => {
      const share = i === units.length - 1 ? left : (priceSum > 0 ? Math.round((subtotal - discAmt) * num(u.price) / priceSum) : 0);
      left -= i === units.length - 1 ? 0 : share;
      return { id: u.id, price: num(u.price), gross: num(u.price) * N, freeNights: Math.min(N, freeC), freeAmt: num(u.price) * Math.min(N, freeC),
               discPct, discAmt: 0, surchAmt: 0, net: share };
    });
    return { unitMode: false, nights: N, priceSum, perUnit, subtotalGross: priceSum * N, freeAmt: priceSum * Math.min(N, freeC),
             subtotal, discPct, discAmt, unitDiscAmt: 0, collectiveSurch: surchAmt, unitSurch: 0, surchAmt, late, total,
             collectiveDiscPct: discPct, collective: { freeNights: freeC } };
  }

  // ── Con ajustes por unidad ────────────────────────────────────────────
  const freeEff = u => Math.min(N, freeC + int(u.freeNights));
  const baseOf  = u => num(u.price) * (N - freeEff(u));
  const sumBase = units.reduce((s, u) => s + baseOf(u), 0);
  const pctC = discC.mode === 'amt'
    ? (sumBase > 0 ? Math.min(100, num(discC.value) / sumBase * 100) : 0)
    : num(discC.value);

  const perUnit = units.map(u => {
    const base = baseOf(u);
    const d = u.disc ?? { mode: 'pct', value: 0 };
    const s = u.surch ?? { mode: 'amt', value: 0 };
    const pctU = d.mode === 'amt' ? (base > 0 ? Math.min(100, num(d.value) / base * 100) : 0) : num(d.value);
    const discPct = Math.min(100, pctC + pctU);
    const discAmt = Math.round(base * discPct / 100);
    const surchAmt = s.mode === 'pct' ? Math.round(base * num(s.value) / 100) : num(s.value);
    const freeN = freeEff(u);
    return { id: u.id, price: num(u.price), gross: num(u.price) * N, freeNights: freeN, freeAmt: num(u.price) * freeN,
             base, discPct, unitDiscPct: pctU, discAmt, surchAmt, net: Math.max(0, base - discAmt + surchAmt) };
  });
  const collectiveSurch = surC.mode === 'pct' ? Math.round(sumBase * num(surC.value) / 100) : num(surC.value);
  const unitSurch = perUnit.reduce((s, u) => s + u.surchAmt, 0);
  const total = Math.max(0, Math.round(perUnit.reduce((s, u) => s + u.net, 0) + collectiveSurch + late));
  return { unitMode: true, nights: N, priceSum, perUnit, subtotalGross: priceSum * N,
           freeAmt: perUnit.reduce((s, u) => s + u.freeAmt, 0), subtotal: sumBase,
           discPct: pctC, discAmt: perUnit.reduce((s, u) => s + u.discAmt, 0),
           collectiveSurch, unitSurch, surchAmt: collectiveSurch + unitSurch, late, total,
           collectiveDiscPct: pctC, collective: { freeNights: freeC } };
}

// ── Lectura de una reserva guardada (para calendario, tarjetas, estadísticas…) ──

/** Ajustes EFECTIVOS de un depto dentro de una reserva guardada. Sin datos por unidad = los colectivos de siempre. */
export function unitAdjustments(booking = {}, unitId) {
  const bu = (booking.booking_units ?? []).find(x => String(x.unit_id) === String(unitId)) ?? {};
  const freeNights = int(booking.free_nights) + int(bu.free_nights);
  const discPct = Math.min(100, num(booking.discount_pct) + num(bu.discount_pct));
  const surcharge = num(bu.surcharge_amount);   // el colectivo se muestra aparte (no es de un solo depto)
  return { freeNights, discPct, surcharge, unitFree: int(bu.free_nights), unitDiscPct: num(bu.discount_pct), unitSurcharge: surcharge };
}

/** ¿La reserva tiene precios/ajustes por unidad? */
export const hasUnitPricing = (booking = {}) => booking.unit_pricing === true;

/** Neto guardado de un depto (para estadísticas por unidad). null si la reserva no usa precios por unidad. */
export function unitNetOf(booking = {}, unitId) {
  if (!hasUnitPricing(booking)) return null;
  const nights = Math.round((new Date(booking.check_out + 'T12:00:00') - new Date(booking.check_in + 'T12:00:00')) / 86400000);
  const units = (booking.booking_units ?? []).map(bu => ({
    id: String(bu.unit_id), price: num(bu.price_per_night), freeNights: int(bu.free_nights),
    disc: { mode: 'pct', value: num(bu.discount_pct) }, surch: { mode: 'amt', value: num(bu.surcharge_amount) } }));
  const r = computeBookingPricing({ nights, units,
    collective: { freeNights: int(booking.free_nights), disc: { mode: 'pct', value: num(booking.discount_pct) }, surch: { mode: 'amt', value: 0 } } });
  return r.perUnit.find(u => u.id === String(unitId))?.net ?? null;
}

// ── Distribución de huéspedes por unidad ───────────────────────────────

const hasDist = u => u.adults != null && u.adults !== '' || u.children != null && u.children !== '';

/**
 * @param {{adults:number, children:number}} totals  total de la reserva
 * @param {Array<{id:string, name?:string, adults?:number|null, children?:number|null, maxGuests?:number|null}>} units
 * @returns {{loaded:boolean, ok:boolean, assignedAdults:number, assignedChildren:number, warnings:Array<{type:'sum'|'capacity', unitId?:string, text:string, blocking:boolean}>}}
 */
export function validateDistribution(totals, units = []) {
  const loaded = units.some(hasDist);
  const aA = units.reduce((s, u) => s + int(u.adults), 0);
  const aC = units.reduce((s, u) => s + int(u.children), 0);
  const warnings = [];
  if (loaded) {
    const dA = int(totals.adults) - aA, dC = int(totals.children) - aC;
    if (dA !== 0) warnings.push({ type: 'sum', text: dA > 0 ? `Adultos asignados ${aA} de ${int(totals.adults)}: falta ubicar ${dA}.` : `Adultos asignados ${aA}: sobran ${-dA} respecto del total (${int(totals.adults)}).`, blocking: false });
    if (dC !== 0) warnings.push({ type: 'sum', text: dC > 0 ? `Niños asignados ${aC} de ${int(totals.children)}: falta ubicar ${dC}.` : `Niños asignados ${aC}: sobran ${-dC} respecto del total (${int(totals.children)}).`, blocking: false });
  }
  units.forEach(u => {
    const occ = int(u.adults) + int(u.children);
    if (u.maxGuests && occ > u.maxGuests)
      warnings.push({ type: 'capacity', unitId: u.id, text: `${u.name ?? 'Un depto'} supera su capacidad: ${occ} personas, máximo ${u.maxGuests}.`, blocking: true });
  });
  return { loaded, ok: warnings.length === 0, assignedAdults: aA, assignedChildren: aC, warnings };
}

/** Reparte adultos y niños entre los deptos respetando la capacidad (primero adultos, después niños). */
export function autoDistribute(totals, units = []) {
  const out = units.map(u => ({ id: u.id, adults: 0, children: 0, cap: u.maxGuests ?? Infinity }));
  const put = (field, qty) => {
    let left = qty, guard = 0;
    while (left > 0 && guard++ < 1000) {
      const cand = out.filter(o => o.adults + o.children < o.cap).sort((a, b) => (a.adults + a.children) - (b.adults + b.children))[0] ?? out[0];
      if (!cand) break;
      cand[field] += 1; left -= 1;
    }
  };
  put('adults', int(totals.adults)); put('children', int(totals.children));
  return out.map(({ id, adults, children }) => ({ id, adults, children }));
}

/** Texto corto para tarjetas / encargada: "3 adultos, 1 niño". */
export function guestsText(adults, children) {
  const a = int(adults), c = int(children);
  const parts = [];
  if (a) parts.push(`${a} adulto${a !== 1 ? 's' : ''}`);
  if (c) parts.push(`${c} niño${c !== 1 ? 's' : ''}`);
  return parts.join(', ') || '—';
}

/** Versión corta para espacios chicos: "3 ad" / "1 ad 2 ni". */
export function guestsShort(adults, children) {
  const a = int(adults), c = int(children);
  return [a ? `${a} ad` : '', c ? `${c} ni` : ''].filter(Boolean).join(' ') || '—';
}

/** Distribución guardada de una reserva: [{unitId, name, adults, children}] o [] si no se cargó. */
export function distributionOf(booking = {}) {
  const bus = booking.booking_units ?? [];
  if (bus.length < 2 || !bus.some(bu => bu.adults != null || bu.children != null)) return [];
  return bus.map(bu => ({ unitId: bu.unit_id, name: bu.units?.name ?? '', label: cleanLabel(bu.label), order: bu.units?.sort_order ?? 99, color: bu.units?.color,
                          adults: int(bu.adults), children: int(bu.children) })).sort((a, b) => a.order - b.order);
}

// ── Saldo por unidad ──
/**
 * Cuánto corresponde, cuánto se pagó y cuánto falta en CADA depto de una reserva guardada.
 *  - Corresponde = neto del depto (con sus noches sin cargo / descuento / recargo) + parte proporcional de lo colectivo
 *    (recargo de toda la reserva, late check-out y redondeos), repartido según el neto de cada depto.
 *  - Pagado = pagos asignados a ese depto (payments.unit_id) + parte proporcional de los pagos GENERALES (sin depto),
 *    repartida según lo que corresponde a cada depto.
 * Suma de "corresponde" = total de la reserva y suma de "pagado" = total pagado (se reparte el resto en el último depto).
 * @returns {Array<{unitId:string, due:number, paid:number, balance:number, over:number}>}
 */
export function unitBalances(booking = {}, payments = booking.payments ?? []) {
  const bus = booking.booking_units ?? [];
  if (!bus.length) return [];
  const amts = unitAmounts(booking);
  const total = Math.max(0, Math.round(Number(booking.total_amount) || 0));
  const sumNet = amts.reduce((s, x) => s + x.net, 0);
  const weights = amts.map(x => (sumNet > 0 ? x.net / sumNet : 1 / amts.length));
  // 1) lo que corresponde a cada depto (el resto colectivo se reparte proporcional al neto)
  const rest = total - sumNet;
  let left = total;
  const due = amts.map((x, i) => {
    const v = i === amts.length - 1 ? left : Math.round(x.net + rest * weights[i]);
    left -= v; return Math.max(0, v);
  });
  // 2) pagos: directos al depto + parte proporcional de los generales
  const amt = p => num(p.amount_ars ?? p.amount);
  const direct = Object.fromEntries(amts.map(x => [x.unitId, 0]));
  let general = 0;
  (payments ?? []).forEach(p => {
    const uid = p.unit_id != null ? String(p.unit_id) : null;
    if (uid && uid in direct) direct[uid] += amt(p); else general += amt(p);
  });
  const sumDue = due.reduce((s, v) => s + v, 0);
  let gLeft = Math.round(general);
  return amts.map((x, i) => {
    const share = i === amts.length - 1 ? gLeft : Math.round(general * (sumDue > 0 ? due[i] / sumDue : 1 / amts.length));
    gLeft -= share;
    const paid = Math.round(direct[x.unitId]) + share;
    return { unitId: x.unitId, due: due[i], paid, balance: Math.max(0, due[i] - paid), over: Math.max(0, paid - due[i]) };
  });
}

// ── Nombre propio del depto dentro de una reserva (ej.: "Depto de los abuelos") ──
export const cleanLabel = v => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 60) : '') || '';

/** Cómo mostrar un depto de una reserva: su nombre propio si lo tiene, si no el nombre del depto. */
export function unitDisplayName(bu = {}) {
  return cleanLabel(bu.label) || bu.units?.name || 'Depto';
}

/**
 * Importe de cada depto de una reserva guardada (sin late check-out ni recargo colectivo).
 * Con precios por unidad = neto real; si no, reparto proporcional al precio (informativo).
 * @returns {Array<{unitId:string, net:number}>}
 */
export function unitAmounts(booking = {}) {
  const bus = booking.booking_units ?? [];
  if (!bus.length) return [];
  const nights = Number(booking.nights) || Math.round((new Date(booking.check_out + 'T12:00:00') - new Date(booking.check_in + 'T12:00:00')) / 86400000);
  const r = computeBookingPricing({
    nights,
    units: bus.map(bu => ({ id: String(bu.unit_id), price: num(bu.price_per_night) || num(booking.price_per_night) / bus.length,
      freeNights: hasUnitPricing(booking) ? bu.free_nights : 0,
      disc:  { mode: 'pct', value: hasUnitPricing(booking) ? bu.discount_pct : 0 },
      surch: { mode: 'amt', value: hasUnitPricing(booking) ? bu.surcharge_amount : 0 } })),
    collective: { freeNights: booking.free_nights, disc: { mode: 'pct', value: booking.discount_pct }, surch: { mode: 'amt', value: 0 } } });
  return r.perUnit.map(u => ({ unitId: u.id, net: u.net }));
}
