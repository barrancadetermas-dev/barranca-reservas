// ══════════════════════════════════════════════════════════════
// availability-service.js — ¿Está libre cada unidad en cada tramo?
//
// Una sola implementación, basada en stay-segments.js, para que
// formulario, calendario y asistente decidan igual. Una reserva con
// cambio de depto ocupa cada unidad SOLO durante su tramo.
// ══════════════════════════════════════════════════════════════

import { getSegments, overlapsRange } from './stay-segments.js';
import { queryWithOptionalColumns } from '../utils/db-compat.js';

const NAME_SEL = 'guests!bookings_guest_id_fkey(first_name, last_name)';

/**
 * Reservas existentes que chocan con alguno de los tramos pedidos.
 * Ignora canceladas y bloqueos (igual que el resto de la app) y, si se
 * indica, la propia reserva que se está editando.
 *
 * @param {object} db  cliente supabase
 * @param {Array<{unit_id:string, from:string, to:string}>} segments  tramos que se quieren ocupar
 * @param {{excludeBookingId?:string}} [opts]
 * @returns {Promise<Array<{unit_id:string, bookingId:string, guestName:string, from:string, to:string}>>}
 */
export async function findConflicts(db, segments, { excludeBookingId = null } = {}) {
  const wanted = (segments ?? []).filter(s => s.unit_id && s.from && s.to && s.from < s.to);
  if (!wanted.length) return [];

  const unitIds = [...new Set(wanted.map(s => String(s.unit_id)))];
  const minFrom = wanted.reduce((m, s) => (s.from < m ? s.from : m), wanted[0].from);
  const maxTo   = wanted.reduce((m, s) => (s.to   > m ? s.to   : m), wanted[0].to);

  const inner = `id, check_in, check_out, status, ${NAME_SEL}`;
  const { data, error } = await queryWithOptionalColumns(
    sel => db.from('booking_units')
      .select(sel)
      .in('unit_id', unitIds)
      .not('bookings.status', 'in', '(cancelled,blocked)')
      .lt('bookings.check_in', maxTo)
      .gt('bookings.check_out', minFrom),
    `unit_id, segment_check_in, segment_check_out, bookings!inner(${inner})`,
    `unit_id, bookings!inner(${inner})`,
  );
  if (error) throw error;

  const found = [];
  for (const row of data ?? []) {
    const bk = row.bookings;
    if (!bk || (excludeBookingId && bk.id === excludeBookingId)) continue;
    const other = { check_in: bk.check_in, check_out: bk.check_out, booking_units: [row] };
    for (const w of wanted) {
      if (String(w.unit_id) !== String(row.unit_id)) continue;
      if (!overlapsRange(other, row.unit_id, w.from, w.to)) continue;
      const g = bk.guests;
      const seg = getSegments(other)[0];
      found.push({
        unit_id: String(row.unit_id),
        bookingId: bk.id,
        guestName: g ? `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim() || 'otro huésped' : 'otro huésped',
        from: seg?.from ?? bk.check_in,
        to:   seg?.to   ?? bk.check_out,
      });
    }
  }
  return found;
}
