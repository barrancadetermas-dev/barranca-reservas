// ══════════════════════════════════════════════════════════════
// booking-display.js — Textos de una reserva que se repiten en varias pantallas
// (lista, ficha, formulario de pagos, tooltip del calendario). Una sola fuente
// para que todas digan lo mismo. Puro: sin DOM ni red.
// ══════════════════════════════════════════════════════════════

import { resolveGuestCounts } from './guest-count.js';

// ── Porcentaje de pago ────────────────────────────────────────
const round1 = n => Math.round(n * 10) / 10;

/** Porcentaje que representa `amount` sobre `total` (null si no hay total). */
export function pctOf(amount, total) {
  const t = Number(total), a = Number(amount);
  if (!(t > 0) || !Number.isFinite(a)) return null;
  return round1((a / t) * 100);
}

/**
 * Cuánto va abonado y cuánto resta, en % del total de la estadía. Siempre suman 100.
 * Nunca muestra 100 % abonado mientras quede saldo, ni 0 % si ya se pagó algo.
 * @returns {{paidPct:number, restPct:number, tiny:boolean}|null}
 */
export function paymentPercents(paid, total) {
  const t = Number(total), p = Math.max(0, Number(paid) || 0);
  if (!(t > 0)) return null;
  const raw = Math.min(100, (p / t) * 100);
  let paidPct = round1(raw);
  const tiny = raw > 0 && paidPct < 1;
  if (raw < 100 && paidPct >= 100) paidPct = 99.9;          // todavía hay saldo
  if (p >= t - 0.5) paidPct = 100;                           // saldada
  return { paidPct, restPct: round1(100 - paidPct), tiny };
}

/** 20 → "20%" · 33.3 → "33,3%" · 0.4 → "<1%" */
export function fmtPct(p, { tiny = false } = {}) {
  if (tiny) return '<1%';
  if (p == null || !Number.isFinite(p)) return '';
  const r = round1(p);
  return (Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',')) + '%';
}

/** Texto "20% abonado · resta 80%" (o "100% abonado"). */
export function paymentProgressText(paid, total) {
  const pp = paymentPercents(paid, total);
  if (!pp) return '';
  if (pp.paidPct >= 100) return '100% abonado';
  return `${fmtPct(pp.paidPct, { tiny: pp.tiny })} abonado · resta ${fmtPct(pp.restPct)}`;
}

// ── PROMO (noches sin cargo): 3 noches pagando 2 → "2+1" ──────
/** "2+1" si hay noches sin cargo (se pagan N y se regalan F), '' si no hay promo. */
export function promoLabel(nights, freeNights) {
  const n = Number(nights) || 0, f = Number(freeNights) || 0;
  if (f <= 0) return '';
  return n > f ? `${n - f}+${f}` : '';
}

// ── Personas: total + adultos + menores ───────────────────────
/**
 * @returns {{total:number, adults:number, children:number, text:string, short:string}}
 *  text:  "3 adultos + 1 menor"  ·  short: "👥 4 · 3 adultos + 1 menor" / "👥 2 adultos"
 */
export function guestCountsText(booking) {
  const { adults, children, total } = resolveGuestCounts(booking);
  const a = `${adults} adulto${adults === 1 ? '' : 's'}`;
  const c = children ? ` + ${children} menor${children === 1 ? '' : 'es'}` : '';
  return { total, adults, children, text: a + c, short: children ? `👥 ${total} · ${a}${c}` : `👥 ${a}` };
}
