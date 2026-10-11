// ══════════════════════════════════════════════════════════════
// unit-stats.js — Ocupación e ingresos por unidad (función pura)
//
// Antes esta cuenta estaba COPIADA en statistics.js y stats-worker.js, y
// daba a cada unidad de una reserva TODAS las noches de la reserva: con un
// cambio de depto (2 noches en el 2 + 1 noche en el 5) contaba 6 noches y
// el doble de ingresos. Ahora cada unidad recibe solo sus tramos
// (stay-segments.js) y el precio de SU tramo.
// ══════════════════════════════════════════════════════════════

import { getSegments, addDays, nightsBetween, unitNightsInRange } from './stay-segments.js';

/**
 * @param {{bookings:Array, units:Array<{id:string}>, firstDay:string, lastDay:string, daysInMonth:number}} p
 *   firstDay/lastDay: primer y último día del período (ambos incluidos, como noches)
 * @returns {Array<{unit:object, nightsOcc:number, revenue:number, bookingCount:number, occupancyPct:number, avgPricePerNight:number}>}
 */
export function computeUnitStats({ bookings, units, firstDay, lastDay, daysInMonth }) {
  const windowEnd = addDays(lastDay, 1);
  const map = {};
  units.forEach(u => { map[u.id] = { unit: u, nightsOcc: 0, revenue: 0, bookingCount: 0, totalPriceNights: 0 }; });

  for (const b of bookings ?? []) {
    const segs = getSegments(b);
    if (!segs.length) continue;

    const allSegNights  = segs.reduce((n, s) => n + s.nights, 0);
    const fullNights    = nightsBetween(b.check_in, b.check_out);
    const free          = b.free_nights ?? 0;
    // Las noches sin cargo ocupan la unidad pero no facturan (se reparte en proporción)
    const billableRatio = fullNights > 0 ? Math.max(0, fullNights - free) / fullNights : 1;
    const unitIds       = [...new Set(segs.map(s => s.unit_id))];

    for (const uid of unitIds) {
      const st = map[uid];
      if (!st) continue;
      const nights = unitNightsInRange(b, uid, firstDay, windowEnd);
      if (nights <= 0) continue;

      const unitPrice = segs.find(s => s.unit_id === uid)?.pricePerNight;
      st.nightsOcc    += nights;
      st.bookingCount += 1;
      // Precio de esta unidad; si no tiene precio propio, el de la reserva repartido entre sus unidades
      st.totalPriceNights += nights * (unitPrice > 0 ? unitPrice : (b.price_per_night ?? 0) / unitIds.length);
      if (unitPrice > 0) {
        st.revenue += unitPrice * nights * billableRatio;
      } else if (allSegNights > 0) {
        st.revenue += (b.total_amount ?? 0) * (nights / allSegNights);
      }
    }
  }

  return Object.values(map).map(s => ({
    unit:             s.unit,
    nightsOcc:        s.nightsOcc,
    revenue:          Math.round(s.revenue),
    bookingCount:     s.bookingCount,
    occupancyPct:     Math.min(100, Math.round((s.nightsOcc / daysInMonth) * 100)),
    avgPricePerNight: s.nightsOcc > 0 ? Math.round(s.totalPriceNights / s.nightsOcc) : 0,
  })).sort((a, b) => b.revenue - a.revenue);
}
