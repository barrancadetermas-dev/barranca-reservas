// ═══════════════════════════════════════════════════
// export-service.js — Exportación CSV
// Reservas + P&L mensual con BOM para Excel
// Gateado por can('exportData')
// ═══════════════════════════════════════════════════

import { getUnitLabel, SOURCE_CONFIG, showToast } from '../supabase-config.js';
import { can, isDemo } from '../auth/permissions.js';

const STATUS_LABELS = {
  pending:'Sin seña', partial:'Con seña', paid:'Pagado',
  cancelled:'Cancelada', blocked:'Bloqueada',
};
const PAYMENT_METHODS = {
  cash:'Efectivo', transfer:'Transferencia', mercadopago:'MercadoPago',
  naranjax:'Naranja X', uala:'Ualá', credit_card:'Tarjeta Crédito',
};
const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ── Reservas → CSV ────────────────────────────────
export function exportBookingsCSV(bookings, filename = 'reservas') {
  if (isDemo()) { showToast('🎭 Exportación no disponible en modo demo', 'warning'); return; }
  if (!can('exportData')) { showToast('🔒 Sin permiso para exportar', 'warning'); return; }

  const headers = [
    'ID','Huésped','DNI','Teléfono','Email',
    'Unidades','Check-in','Check-out','Noches',
    'Canal','Estado',
    'Precio/noche','Total','Abonado','Saldo',
    'Notas',
  ];

  const rows = bookings.map(b => {
    const units = (b.booking_units ?? []).map(bu => getUnitLabel(bu.units ?? {})).join(' + ');
    return [
      b.id,
      b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : (b.block_reason ?? 'Bloqueo'),
      b.guests?.dni     ?? '',
      b.guests?.phone   ?? '',
      b.guests?.email   ?? '',
      units,
      b.check_in        ?? '',
      b.check_out       ?? '',
      b.nights          ?? '',
      SOURCE_CONFIG[b.source ?? 'direct']?.label ?? 'Directo',
      STATUS_LABELS[b.status] ?? b.status,
      b.price_per_night ?? '',
      b.total_amount    ?? '',
      b.total_paid      ?? '',
      b.balance         ?? '',
      (b.notes ?? '').replace(/\n/g,' '),
    ];
  });

  _download(
    _toCSV(headers, rows),
    `${filename}_${_dateTag()}.csv`
  );
  showToast(`✓ Exportado: ${bookings.length} reservas`, 'success');
}

// ── P&L → CSV ─────────────────────────────────────
export function exportPLCSV(stats, expenses, commissions, month, year) {
  if (isDemo()) { showToast('🎭 Exportación no disponible en modo demo', 'warning'); return; }
  if (!can('exportData')) { showToast('🔒 Sin permiso para exportar', 'warning'); return; }

  const period       = `${MONTH_NAMES[month]} ${year}`;
  const totalRevenue = stats.reduce((s, u) => s + u.revenue, 0);
  const commAmt      = stats.reduce((s, u) => {
    const pct = (commissions[u.unit?.source] ?? commissions[u.unit?.defaultSource] ?? 0) / 100;
    return s; // simplified: commissions from source not tracked per unit here
  }, 0);
  const totalExp     = expenses.reduce((s, e) => s + (e.paid ? e.amount : 0), 0);
  const net          = totalRevenue - totalExp;

  const headers = ['Descripción','Monto (ARS)'];
  const rows = [
    [`── INGRESOS POR UNIDAD — ${period} ──`, ''],
    ['Unidad','Noches · Reservas · Ingreso · Ocupación'],
    ...stats.map(s => [
      getUnitLabel(s.unit),
      `${s.nightsOcc} noches · ${s.bookingCount} reservas · $${s.revenue.toLocaleString('es-AR')} · ${s.occupancyPct}%`,
    ]),
    ['',''],
    ['TOTAL INGRESOS BRUTOS', totalRevenue],
    ['',''],
    [`── GASTOS OPERATIVOS ──`, ''],
    ['Categoría · Descripción','Monto'],
    ...expenses.map(e => [`${e.category} · ${e.description}${e.paid?' (pagado)':' (pendiente)'}`, e.amount]),
    ['',''],
    ['TOTAL GASTOS (pagados)', totalExp],
    ['',''],
    ['══ RESULTADO NETO ══', net],
    [`  Período: ${period}`,''],
  ];

  _download(_toCSV(headers, rows), `pyl_${period.replace(' ','_')}_${_dateTag()}.csv`);
  showToast(`✓ P&L exportado: ${period}`, 'success');
}

// ── Pagos → CSV ───────────────────────────────────
export function exportPaymentsCSV(payments, filename = 'pagos') {
  if (!can('exportData')) { showToast('🔒 Sin permiso para exportar', 'warning'); return; }

  const headers = ['Reserva ID','Método','Monto','Moneda','Cotización','Total ARS','Fecha','Notas'];
  const rows = payments.map(p => [
    p.booking_id ?? '',
    PAYMENT_METHODS[p.method] ?? p.method,
    p.amount     ?? '',
    p.currency   ?? 'ARS',
    p.exchange_rate ?? '',
    p.amount_ars ?? '',
    p.paid_at ? p.paid_at.slice(0,10) : '',
    p.notes ?? '',
  ]);

  _download(_toCSV(headers, rows), `${filename}_${_dateTag()}.csv`);
  showToast(`✓ Exportado: ${payments.length} pagos`, 'success');
}

// ── Helpers internos ──────────────────────────────
function _toCSV(headers, rows) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g,'""').replace(/\n/g,' ')}"`;
  return [headers, ...rows].map(r => r.map(escape).join(',')).join('\r\n');
}

function _download(content, filename) {
  const BOM  = '\uFEFF'; // BOM para Excel en español
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _dateTag() { return new Date().toISOString().slice(0,10); }
