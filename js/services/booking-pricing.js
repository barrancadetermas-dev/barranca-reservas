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

// Un descuento/recargo puede ser UNO ({mode,value}) o VARIOS ([{mode,value}, ...]).
const toList = x => (Array.isArray(x) ? x : (x ? [x] : [])).filter(a => num(a?.value) > 0);
/** Suma de % de descuento (los montos fijos se convierten a % sobre `base`); tope 100. */
const pctOf = (list, base) => Math.min(100, toList(list).reduce((s, a) =>
  s + (a.mode === 'amt' ? (base > 0 ? Math.min(100, num(a.value) / base * 100) : 0) : num(a.value)), 0));
/** Suma de recargos: los % se calculan sobre `base`, los montos fijos se suman. */
const surchOfList = (list, base) => toList(list).reduce((s, a) => s + (a.mode === 'pct' ? Math.round(base * num(a.value) / 100) : num(a.value)), 0);
const lateAmountOf = l => (l && l.charged !== false ? num(l.amount) : 0);

/** ¿Este ajuste de unidad tiene algún efecto sobre el precio? */
export function hasUnitAdjustment(u = {}) {
  return int(u.freeNights) > 0 || toList(u.disc).length > 0 || toList(u.surch).length > 0 || lateAmountOf(u.late) > 0;
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
  const discC = collective.disc ?? [];
  const surC  = collective.surch ?? [];
  const unitMode = units.some(hasUnitAdjustment);

  // ── Camino clásico (todas las reservas actuales) ──────────────────────
  if (!unitMode) {
    const billable = Math.max(0, N - freeC);
    const subtotal = billable * priceSum;
    const discPct  = pctOf(discC, subtotal);
    const discAmt  = Math.round(subtotal * discPct / 100);
    const surchAmt = surchOfList(surC, subtotal);
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
  const pctC = pctOf(discC, sumBase);

  const perUnit = units.map(u => {
    const base = baseOf(u);
    const pctU = pctOf(u.disc, base);
    const discPct = Math.min(100, pctC + pctU);
    const discAmt = Math.round(base * discPct / 100);
    const surchAmt = surchOfList(u.surch, base);
    const lateAmt = lateAmountOf(u.late);                // late check-out PROPIO de este depto (si se cobra)
    const freeN = freeEff(u);
    return { id: u.id, price: num(u.price), gross: num(u.price) * N, freeNights: freeN, freeAmt: num(u.price) * freeN,
             base, discPct, unitDiscPct: pctU, discAmt, surchAmt, lateAmt, net: Math.max(0, base - discAmt + surchAmt + lateAmt) };
  });
  const collectiveSurch = surchOfList(surC, sumBase);
  const unitSurch = perUnit.reduce((s, u) => s + u.surchAmt, 0);
  const total = Math.max(0, Math.round(perUnit.reduce((s, u) => s + u.net, 0) + collectiveSurch + late));
  return { unitMode: true, nights: N, priceSum, perUnit, subtotalGross: priceSum * N,
           freeAmt: perUnit.reduce((s, u) => s + u.freeAmt, 0), subtotal: sumBase,
           discPct: pctC, discAmt: perUnit.reduce((s, u) => s + u.discAmt, 0),
           collectiveSurch, unitSurch, surchAmt: collectiveSurch + unitSurch, late, total,
           collectiveDiscPct: pctC, collective: { freeNights: freeC } };
}

// ══════════════════════════════════════════════════════════════════════════
// AJUSTES de precio: lista de descuentos / recargos / noches sin cargo / late check-out,
// cada uno para TODA la reserva (unitId null) o para UN depto, con su motivo.
//   { id, unitId: string|null, kind: 'discount'|'surcharge'|'free_nights'|'late_checkout',
//     mode: 'pct'|'amt'|'nights', value: number, charged?: boolean (late), reason?: string }
// Varios descuentos de un mismo destino se SUMAN (los % se suman; los montos fijos se convierten a % sobre la base y se suman).
// ══════════════════════════════════════════════════════════════════════════

/** Motivos sugeridos (la última opción, "Otro", abre un campo de texto). */
export const ADJUSTMENT_REASONS = [
  'Atención comercial', 'Promo', 'Cliente frecuente', 'Compensación / inconveniente', 'Cumpleaños', 'Familiar / amigo',
  'Estadía larga', 'Temporada baja', 'Pago en efectivo', 'Mascota', 'Persona extra / cuna', 'Ajuste de tarifa', 'Late check-out', 'Otro'];
export const ADJUSTMENT_KINDS = { discount: 'Descuento', surcharge: 'Recargo', free_nights: 'Noches sin cargo', late_checkout: 'Late check-out' };

/** Motivo final de un ajuste (si eligió "Otro", vale el texto libre). */
export const reasonOf = a => cleanText(a?.reason === 'Otro' ? a?.reasonOther : a?.reason, 120);
const cleanText = (v, n) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, n) : '') || '';

/** Lista de ajustes → entradas de computeBookingPricing (collective + por depto). Ajustes de un depto que ya no está se ignoran. */
export function adjustmentsToSpecs(list = [], unitIds = []) {
  const blank = () => ({ freeNights: 0, disc: [], surch: [], late: null });
  const collective = blank();
  const perUnit = Object.fromEntries(unitIds.map(id => [String(id), blank()]));
  (list ?? []).forEach(a => {
    const t = a.unitId != null ? perUnit[String(a.unitId)] : collective;
    if (!t) return;
    const v = num(a.value);
    if (a.kind === 'free_nights') t.freeNights += int(v);
    else if (a.kind === 'discount') t.disc.push({ mode: a.mode === 'amt' ? 'amt' : 'pct', value: v });
    else if (a.kind === 'surcharge') t.surch.push({ mode: a.mode === 'pct' ? 'pct' : 'amt', value: v });
    else if (a.kind === 'late_checkout') t.late = { amount: num(t.late?.amount) + v, charged: a.charged !== false };
  });
  return { collective, perUnit };
}

/**
 * Cálculo completo a partir de la lista de ajustes.
 * @param {{nights:number, units:Array<{id:string, price:number}>, adjustments:Array}} p
 */
export function computeFromAdjustments({ nights, units = [], adjustments = [] }) {
  const multi = units.length > 1;
  const specs = adjustmentsToSpecs(adjustments, multi ? units.map(u => u.id) : []);
  const lateC = lateAmountOf(specs.collective.late);
  const P = computeBookingPricing({
    nights,
    units: units.map(u => ({ id: u.id, price: u.price, ...(multi ? specs.perUnit[String(u.id)] : {}) })),
    collective: { freeNights: specs.collective.freeNights, disc: specs.collective.disc, surch: specs.collective.surch },
    late: lateC });
  return { P, specs };
}

/**
 * Columnas "de siempre" que se derivan de la lista (las lee el calendario, las cards, las estadísticas y los vouchers viejos).
 * @returns {{booking:object, units:Object<string,object>}}
 */
export function aggregateColumns(P, specs, unitIds = []) {
  const lateAll = [specs.collective.late, ...unitIds.map(id => specs.perUnit[String(id)]?.late)].filter(Boolean);
  const booking = {
    free_nights: specs.collective.freeNights,
    discount_pct: P.collectiveDiscPct ?? 0,
    surcharge_amount: P.collectiveSurch ?? 0,
    late_checkout: lateAll.length > 0,
    late_checkout_charged: lateAll.length ? lateAll.some(l => l.charged !== false) : true };
  const units = {};
  unitIds.forEach(id => {
    const sp = specs.perUnit[String(id)], pu = P.perUnit.find(x => x.id === String(id));
    units[String(id)] = {
      free_nights: P.unitMode ? sp.freeNights : 0,
      discount_pct: P.unitMode ? (pu?.unitDiscPct ?? 0) : 0,
      surcharge_amount: P.unitMode ? (pu?.surchAmt ?? 0) : 0,
      // late por depto: true/false explícito si la reserva tiene late por depto; NULL = hereda de la reserva
      late_checkout: sp.late ? true : (unitIds.length > 1 && lateAll.length ? false : null),
      late_checkout_charged: sp.late ? sp.late.charged !== false : null,
      late_checkout_amount: sp.late ? num(sp.late.amount) : null };
  });
  return { booking, units };
}

const ADJ_ICON = { discount: '🏷️', surcharge: '➕', free_nights: '🎁', late_checkout: '🌅' };

/**
 * Una línea por ajuste, con su monto (descuentos y noches sin cargo restan; recargos y late suman) y su motivo.
 * La suma de los descuentos / recargos coincide con P.discAmt / P.surchAmt (el redondeo se absorbe en la última línea).
 * @param {Array} adjustments  [{unitId, kind, mode, value, charged, reason|reasonText}]
 * @param {object} P           resultado de computeBookingPricing
 * @param {Object<string,string>} [names]  nombre a mostrar de cada depto (id → nombre)
 * @returns {Array<{kind:string, icon:string, label:string, target:string, reason:string, amount:number, sign:'+'|'-'|'0', valueText:string}>}
 */
export function adjustmentBreakdown(adjustments = [], P, names = {}) {
  const units = P.perUnit ?? [];
  const sumBase = units.reduce((s, u) => s + (u.base ?? 0), 0);
  const valueText = a => a.kind === 'free_nights' ? `${int(a.value)} noche${int(a.value) === 1 ? '' : 's'}`
    : a.kind === 'late_checkout' ? (a.charged === false ? 'sin cargo' : `$${Math.round(num(a.value)).toLocaleString('es-AR')}`)
    : (a.mode === 'pct' ? `${+num(a.value).toFixed(2)}%` : `$${Math.round(num(a.value)).toLocaleString('es-AR')}`);
  const out = adjustments.map(a => {
    const targets = a.unitId != null ? units.filter(u => u.id === String(a.unitId)) : units;
    let amount = 0;
    if (a.kind === 'free_nights') amount = -targets.reduce((s, u) => s + u.price * Math.min(int(a.value), P.nights), 0);
    else if (a.kind === 'late_checkout') amount = a.charged === false ? 0 : num(a.value);
    else if (a.kind === 'discount') {
      if (P.unitMode) {
        const own = a.unitId != null;
        amount = -targets.reduce((s, u) => {
          const base = u.base ?? 0, ref = own ? base : sumBase;
          const pct = a.mode === 'amt' ? (ref > 0 ? Math.min(100, num(a.value) / ref * 100) : 0) : num(a.value);
          return s + Math.round(base * pct / 100);
        }, 0);
      } else {
        const pct = a.mode === 'amt' ? (P.subtotal > 0 ? Math.min(100, num(a.value) / P.subtotal * 100) : 0) : num(a.value);
        amount = -Math.round(P.subtotal * pct / 100);
      }
    } else if (a.kind === 'surcharge') {
      if (P.unitMode && a.unitId != null) amount = targets.reduce((s, u) => s + (a.mode === 'pct' ? Math.round((u.base ?? 0) * num(a.value) / 100) : num(a.value)), 0);
      else amount = a.mode === 'pct' ? Math.round((P.unitMode ? sumBase : P.subtotal) * num(a.value) / 100) : num(a.value);
    }
    return { kind: a.kind, icon: ADJ_ICON[a.kind], label: ADJUSTMENT_KINDS[a.kind], target: a.unitId == null ? '' : (names[String(a.unitId)] ?? 'Depto'),
             reason: a.reasonText ?? reasonOf(a), amount, sign: amount < 0 ? '-' : amount > 0 ? '+' : '0', valueText: valueText(a) };
  });
  // El redondeo de varias líneas no debe desviar el total: la última línea de cada tipo absorbe la diferencia
  const fix = (kind, want, sign) => { const idx = out.map((l, i) => (l.kind === kind ? i : -1)).filter(i => i >= 0);
    if (!idx.length) return; const have = idx.reduce((s, i) => s + out[i].amount, 0); const last = out[idx[idx.length - 1]];
    const adj = sign * want - have; if (Math.abs(adj) <= 2) last.amount += adj; };
  fix('discount', P.discAmt, -1); fix('surcharge', P.surchAmt, +1);
  return out;
}

/** Reserva guardada CON lista de ajustes (booking_adjustments) → líneas con su motivo, si el total coincide; si no, null. */
export function bookingAdjustmentView(booking = {}) {
  const rows = booking.booking_adjustments ?? [];
  if (!rows.length) return null;
  const bus = booking.booking_units ?? [];
  const nights = Number(booking.nights) || Math.round((new Date(booking.check_out + 'T12:00:00') - new Date(booking.check_in + 'T12:00:00')) / 86400000);
  const adjustments = [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(r => ({
    unitId: r.unit_id == null ? null : String(r.unit_id), kind: r.kind, mode: r.mode, value: num(r.value), charged: r.charged !== false, reasonText: cleanText(r.reason, 120) }));
  const units = bus.length > 1 ? bus.map(bu => ({ id: String(bu.unit_id), price: num(bu.price_per_night) })) : [{ id: 'all', price: bus.length ? num(bus[0].price_per_night) : num(booking.price_per_night) }];
  const { P } = computeFromAdjustments({ nights, units, adjustments });
  if (Math.abs(P.total - (Number(booking.total_amount) || 0)) > 1) return null;   // se modificó por fuera de la lista
  const names = Object.fromEntries(bus.map(bu => [String(bu.unit_id), unitDisplayName(bu)]));
  return { P, adjustments, lines: adjustmentBreakdown(adjustments, P, names), names };
}

/** Reserva guardada SIN lista de ajustes (todas las viejas) → lista equivalente, para editarla con la pantalla nueva. */
export function legacyToAdjustments(booking = {}) {
  const out = []; let n = 0;
  const add = a => out.push({ id: 'legacy-' + (n++), reason: '', ...a });
  const bus = booking.booking_units ?? [];
  if (int(booking.free_nights) > 0) add({ unitId: null, kind: 'free_nights', mode: 'nights', value: int(booking.free_nights) });
  if (num(booking.discount_pct) > 0) add({ unitId: null, kind: 'discount', mode: 'pct', value: num(booking.discount_pct) });
  if (num(booking.surcharge_amount) > 0) add({ unitId: null, kind: 'surcharge', mode: 'amt', value: num(booking.surcharge_amount) });
  let unitLate = false;
  if (bus.length > 1) bus.forEach(bu => {
    const uid = String(bu.unit_id);
    if (int(bu.free_nights) > 0) add({ unitId: uid, kind: 'free_nights', mode: 'nights', value: int(bu.free_nights) });
    if (num(bu.discount_pct) > 0) add({ unitId: uid, kind: 'discount', mode: 'pct', value: num(bu.discount_pct) });
    if (num(bu.surcharge_amount) > 0) add({ unitId: uid, kind: 'surcharge', mode: 'amt', value: num(bu.surcharge_amount) });
    if (bu.late_checkout === true) { unitLate = true; add({ unitId: uid, kind: 'late_checkout', mode: 'amt', value: num(bu.late_checkout_amount), charged: bu.late_checkout_charged !== false }); }
  });
  if (booking.late_checkout && !unitLate) {
    // reservas viejas: el late era de toda la reserva y su monto no se guardaba aparte → se obtiene de lo que sobra del total
    const nights = Number(booking.nights) || Math.round((new Date(booking.check_out + 'T12:00:00') - new Date(booking.check_in + 'T12:00:00')) / 86400000);
    const price = bus.length ? bus.reduce((s, bu) => s + num(bu.price_per_night), 0) : num(booking.price_per_night);
    const base = computeFromAdjustments({ nights, units: bus.length > 1 ? bus.map(bu => ({ id: String(bu.unit_id), price: num(bu.price_per_night) })) : [{ id: 'all', price }],
      adjustments: out.filter(a => a.kind !== 'late_checkout') }).P.total;
    const extra = Math.max(0, Math.round((Number(booking.total_amount) || 0) - base));
    add({ unitId: null, kind: 'late_checkout', mode: 'amt', value: extra, charged: booking.late_checkout_charged !== false });
  }
  return out;
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
    disc: { mode: 'pct', value: num(bu.discount_pct) }, surch: { mode: 'amt', value: num(bu.surcharge_amount) },
    late: bu.late_checkout ? { amount: bu.late_checkout_amount, charged: bu.late_checkout_charged } : null }));
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
      surch: { mode: 'amt', value: hasUnitPricing(booking) ? bu.surcharge_amount : 0 },
      late:  hasUnitPricing(booking) && bu.late_checkout ? { amount: bu.late_checkout_amount, charged: bu.late_checkout_charged } : null })),
    collective: { freeNights: booking.free_nights, disc: { mode: 'pct', value: booking.discount_pct }, surch: { mode: 'amt', value: 0 } } });
  return r.perUnit.map(u => ({ unitId: u.id, net: u.net }));
}
