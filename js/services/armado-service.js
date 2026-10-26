// ══════════════════════════════════════════════════════════════════════════
// armado-service.js — Mensaje de WhatsApp para la encargada: llegadas de HOY y MAÑANA, por depto
//
//   HOY
//   #6 ~ LILIANA LÓPEZ, 2PERS, (27/10 al 30/10) 3 noches. $100.000
//
//   MAÑANA
//   #7 ~ MARCELA BEDU, 4PERS, (28/10 al 29/10) 1 noche. $40.000
//
// Una línea por depto. En reservas de 2+ deptos: nombre propio del depto, personas de ese depto (si están
// distribuidas) y saldo DE ESE DEPTO (los pagos generales se reparten proporcional). Saldo 0 → "PAGADO".
// ══════════════════════════════════════════════════════════════════════════
import { unitBalances, distributionOf, cleanLabel } from './booking-pricing.js';
import { multiUnitColumns } from '../utils/db-compat.js';

const ARS = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const ddmm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const addDaysISO = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/** Texto de la persona: "2PERS", "3PERS (1 NIÑO)"; sin dato → "S/D". */
function persText(adults, children, fallbackPax) {
  const a = Number(adults) || 0, c = Number(children) || 0;
  if (a + c > 0) return `${a + c}PERS${c > 0 ? ` (${c} NIÑO${c !== 1 ? 'S' : ''})` : ''}`;
  return fallbackPax ? `${fallbackPax}PERS` : 'PERS S/D';
}

/**
 * @param {Array} bookings reservas con guests, booking_units(units, label, adults, children…) y payments
 * @param {string} todayISO fecha de hoy (YYYY-MM-DD)
 * @param {{saldo?:boolean, hoy?:boolean, manana?:boolean}} [opt]
 */
export function buildArmadoText(bookings = [], todayISO, { saldo = true, hoy = true, manana = true } = {}) {
  const tomorrow = addDaysISO(todayISO, 1);
  const lineFor = (b) => {
    const bus = [...(b.booking_units ?? [])].sort((x, y) => (x.units?.sort_order ?? 99) - (y.units?.sort_order ?? 99));
    const multi = bus.length > 1;
    const nights = Math.round((new Date(b.check_out + 'T12:00:00') - new Date(b.check_in + 'T12:00:00')) / 86400000);
    const guest = `${b.guests?.first_name ?? ''} ${b.guests?.last_name ?? ''}`.trim().toUpperCase() || 'SIN NOMBRE';
    const dist = distributionOf(b);
    const bal = multi ? unitBalances(b) : null;
    const when = `(${ddmm(b.check_in)} al ${ddmm(b.check_out)}) ${nights} noche${nights !== 1 ? 's' : ''}`;
    return bus.map(bu => {
      const uid = String(bu.unit_id);
      const lbl = cleanLabel(bu.label);
      const name = lbl ? `${guest} (${lbl.toUpperCase()})` : guest;
      let pers;
      if (multi) { const d = dist.find(x => String(x.unitId) === uid); pers = d ? persText(d.adults, d.children) : `PERS S/D (TOTAL ${persText(b.adults, b.children, b.pax).replace('PERS', '')})`; }
      else pers = persText(b.adults, b.children, b.pax);
      const owed = multi ? (bal.find(x => x.unitId === uid)?.balance ?? 0) : Math.max(0, Number(b.balance ?? ((b.total_amount || 0) - (b.total_paid || 0))) || 0);
      const money = saldo ? ` ${owed > 0 ? ARS(owed) : 'PAGADO'}` : '';
      return `#${bu.units?.sort_order ?? '?'} ~ ${name}, ${pers}, ${when}.${money}`;
    });
  };
  const valid = bookings.filter(b => !b.is_blocked && b.status !== 'blocked' && b.status !== 'cancelled');
  const section = (title, date) => {
    const lines = valid.filter(b => b.check_in === date)
      .sort((a, b) => (a.booking_units?.[0]?.units?.sort_order ?? 99) - (b.booking_units?.[0]?.units?.sort_order ?? 99))
      .flatMap(lineFor);
    return `${title}\n${lines.length ? lines.join('\n') : 'Sin llegadas'}`;
  };
  return [hoy ? section('HOY', todayISO) : '', manana ? section('MAÑANA', tomorrow) : ''].filter(Boolean).join('\n\n');
}

/** Llegadas de hoy y mañana (con pagos por depto). Si la base aún no tiene payments.unit_id, se piden sin esa columna. */
export async function fetchArrivals(db, hotelId, todayISO) {
  const MU = await multiUnitColumns(db);
  const tomorrow = addDaysISO(todayISO, 1);
  const q = (payCols) => db.from('bookings')
    .select(`id, check_in, check_out, nights, status, is_blocked, pax, adults, children, total_amount, total_paid, balance, price_per_night,
      free_nights, discount_pct, surcharge_amount, late_checkout, unit_pricing,
      guests!bookings_guest_id_fkey(first_name, last_name, phone),
      booking_units(unit_id, price_per_night${MU}, units(name, sort_order, color)),
      payments(${payCols})`)
    .eq('hotel_id', hotelId).gte('check_in', todayISO).lte('check_in', tomorrow).neq('status', 'cancelled');
  let r = await q('amount_ars, amount, unit_id');
  if (r.error && /column|schema cache/i.test(r.error.message ?? '')) r = await q('amount_ars, amount');
  if (r.error && /unit_pricing/i.test(r.error.message ?? '')) throw new Error('Falta correr la migración multiunidad en Supabase.');
  if (r.error) throw r.error;
  return r.data ?? [];
}
