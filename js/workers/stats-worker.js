// ═══════════════════════════════════════════════════
// stats-worker.js — Web Worker para cálculos de estadísticas
// Se ejecuta en hilo separado para no bloquear la UI
// Recibe datos crudos y devuelve métricas calculadas
// ═══════════════════════════════════════════════════

self.addEventListener('message', ({ data }) => {
  const { type, payload, id } = data;
  try {
    let result;
    switch (type) {
      case 'UNIT_STATS':    result = computeUnitStats(payload);    break;
      case 'MONTHLY_CHART': result = computeMonthlyChart(payload); break;
      case 'PL':            result = computePL(payload);           break;
      default:
        self.postMessage({ id, error: `Unknown type: ${type}` });
        return;
    }
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
});

// ── Estadísticas por unidad ───────────────────────
function computeUnitStats({ bookings, units, firstDay, lastDay, daysInMonth }) {
  const statsMap = {};
  units.forEach(u => {
    statsMap[u.id] = { unit: u, nightsOcc: 0, revenue: 0, bookingCount: 0, totalPriceNights: 0 };
  });

  bookings.forEach(b => {
    const bUnits = b.booking_units ?? [];
    const unitCount = bUnits.length || 1;
    bUnits.forEach(({ unit_id, price_per_night: unitPrice }) => {
      if (!statsMap[unit_id]) return;
      const ciDate  = new Date(Math.max(new Date(b.check_in  + 'T00:00:00'), new Date(firstDay + 'T00:00:00')));
      const coDate  = new Date(Math.min(new Date(b.check_out + 'T00:00:00'), new Date(lastDay  + 'T23:59:59')));
      const nights  = Math.max(0, Math.round((coDate - ciDate) / 86400000));
      const s       = statsMap[unit_id];
      s.nightsOcc        += nights;
      s.bookingCount     += 1;
      s.totalPriceNights += nights * (b.price_per_night ?? 0);
      // Precio real de la unidad si existe; si no, repartir el total entre unidades (fallback)
      if (unitPrice != null && unitPrice > 0) {
        s.revenue += unitPrice * nights;
      } else {
        const totalNights = Math.round(
          (new Date(b.check_out + 'T00:00:00') - new Date(b.check_in + 'T00:00:00')) / 86400000
        );
        if (totalNights > 0) s.revenue += ((b.total_amount ?? 0) / unitCount) * (nights / totalNights);
      }
    });
  });

  return Object.values(statsMap).map(s => ({
    unit:             s.unit,
    nightsOcc:        s.nightsOcc,
    revenue:          Math.round(s.revenue),
    bookingCount:     s.bookingCount,
    occupancyPct:     Math.min(100, Math.round((s.nightsOcc / daysInMonth) * 100)),
    avgPricePerNight: s.nightsOcc > 0 ? Math.round(s.totalPriceNights / s.nightsOcc) : 0,
  })).sort((a, b) => b.revenue - a.revenue);
}

// ── Datos para gráficos mensuales ──────────────────
function computeMonthlyChart({ monthlyBookings }) {
  return monthlyBookings.map(({ label, fullLabel, bookings }) => {
    const bks     = bookings ?? [];
    const revenue = bks.reduce((s,b) => s + (b.total_amount ?? 0), 0);
    const nights  = bks.reduce((s,b) => s + (b.nights ?? 0), 0);
    const bySource= bks.reduce((acc,b) => {
      const src = b.source ?? 'direct';
      acc[src] = (acc[src] ?? 0) + (b.total_amount ?? 0);
      return acc;
    }, {});
    const avgPrice = bks.length > 0
      ? Math.round(bks.reduce((s,b) => s + (b.price_per_night ?? 0), 0) / bks.length)
      : 0;
    return { label, fullLabel, revenue: Math.round(revenue), count: bks.length, nights, bySource, avgPrice };
  });
}

// ── P&L simplificado ──────────────────────────────
function computePL({ bookings, expenses, commissions }) {
  const totalRevenue = bookings.reduce((s,b) => s + (b.total_amount ?? 0), 0);
  const totalPaid    = bookings.reduce((s,b) => s + (b.total_paid ?? 0), 0);
  const totalExp     = expenses.reduce((s,e) => s + (e.amount ?? 0), 0);

  // Comisiones por canal
  const commCost = bookings.reduce((s,b) => {
    const pct = commissions?.[b.source] ?? 0;
    return s + (b.total_amount ?? 0) * (pct / 100);
  }, 0);

  const netRevenue = totalRevenue - commCost;
  const result     = netRevenue - totalExp;

  const byChannel  = {};
  bookings.forEach(b => {
    const src = b.source ?? 'direct';
    if (!byChannel[src]) byChannel[src] = { revenue: 0, count: 0, commission: 0 };
    byChannel[src].revenue    += b.total_amount ?? 0;
    byChannel[src].count      += 1;
    byChannel[src].commission += (b.total_amount ?? 0) * ((commissions?.[src] ?? 0) / 100);
  });

  return {
    totalRevenue:  Math.round(totalRevenue),
    totalPaid:     Math.round(totalPaid),
    commCost:      Math.round(commCost),
    netRevenue:    Math.round(netRevenue),
    totalExpenses: Math.round(totalExp),
    result:        Math.round(result),
    byChannel,
    bookingCount:  bookings.length,
  };
}
