// ═══════════════════════════════════════════════════
// stats-worker.js — Web Worker para cálculos de estadísticas
// Se ejecuta en hilo separado para no bloquear la UI
// Recibe datos crudos y devuelve métricas calculadas
// ═══════════════════════════════════════════════════

import { computeUnitStats } from '../services/unit-stats.js';

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
// (implementación única en services/unit-stats.js; respeta tramos de estadía)

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
