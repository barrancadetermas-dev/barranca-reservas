// ══════════════════════════════════════════════════════════════
// voucher-guest.js — Genera un voucher/comprobante de reserva
// para el huésped, en formato HTML imprimible → PDF via window.print()
// ══════════════════════════════════════════════════════════════

import { formatARS } from '../supabase-config.js';

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${d} ${MONTHS[+m-1]} ${y}`;
}

function fmtDateLong(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  const DAYS   = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const dt = new Date(iso + 'T12:00:00');
  return `${DAYS[dt.getDay()]} ${+d} de ${MONTHS[+m-1]} de ${y}`;
}

/**
 * Abre una ventana nueva con el voucher listo para imprimir / guardar como PDF.
 * @param {object} booking — reserva con guests, booking_units, payments
 * @param {object} hotel   — { name, address, phone, email, logo_url? }
 */
export function openGuestVoucher(booking, hotel = {}) {
  const g         = booking.guests ?? {};
  const guestName = `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim() || 'Huésped';
  const units     = (booking.booking_units ?? []).map(bu => bu.units?.name ?? '—').join(', ');
  const nights    = booking.nights ?? 0;
  const pax       = booking.pax   ?? 1;
  const checkIn   = fmtDateLong(booking.check_in);
  const checkOut  = fmtDateLong(booking.check_out);
  const total     = booking.total_amount ?? 0;
  const paid      = booking.total_paid   ?? 0;
  const balance   = Math.max(0, total - paid);
  const payments  = booking.payments ?? [];

  const CHANNEL_LABELS = {
    direct: 'Reserva directa', booking: 'Booking.com',
    airbnb: 'Airbnb', family: 'Familiar', walkin: 'Espontáneo',
  };
  const channel = CHANNEL_LABELS[booking.source] ?? booking.source ?? 'Directa';

  const statusLabel = balance <= 0
    ? '<span style="color:#16a34a;font-weight:700">✅ Abonada en su totalidad</span>'
    : paid > 0
    ? `<span style="color:#d97706;font-weight:700">⏳ Seña abonada — saldo pendiente ${formatARS(balance)}</span>`
    : `<span style="color:#dc2626;font-weight:700">⚠️ Pendiente de pago ${formatARS(total)}</span>`;

  const paymentsHTML = payments.length ? `
    <table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:12px">
      <thead>
        <tr style="background:#f1f5f9">
          <th style="text-align:left;padding:5px 8px;border:1px solid #e2e8f0">Fecha</th>
          <th style="text-align:left;padding:5px 8px;border:1px solid #e2e8f0">Método</th>
          <th style="text-align:right;padding:5px 8px;border:1px solid #e2e8f0">Monto</th>
        </tr>
      </thead>
      <tbody>
        ${payments.map(p => `
          <tr>
            <td style="padding:5px 8px;border:1px solid #e2e8f0">${fmtDate(p.payment_date ?? booking.check_in)}</td>
            <td style="padding:5px 8px;border:1px solid #e2e8f0;text-transform:capitalize">${p.method?.replace('_',' ') ?? '—'}</td>
            <td style="padding:5px 8px;border:1px solid #e2e8f0;text-align:right;font-weight:600">${formatARS(p.amount ?? p.amount_ars ?? 0)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>` : '<p style="font-size:12px;color:#64748b;margin:4px 0">Sin pagos registrados.</p>';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Comprobante de Reserva — ${guestName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body { font-family: -apple-system, Arial, sans-serif; color: #1e293b; background: #fff; padding: 32px; max-width: 680px; margin: 0 auto }
    .header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 20px; border-bottom: 2px solid #1e40af; margin-bottom: 24px }
    .hotel-name { font-size: 22px; font-weight: 800; color: #1e40af }
    .hotel-sub  { font-size: 12px; color: #64748b; margin-top: 3px }
    .voucher-title { font-size: 13px; font-weight: 700; color: #1e40af; text-transform: uppercase; letter-spacing: .08em; text-align: right }
    .voucher-num   { font-size: 11px; color: #94a3b8; margin-top: 2px; text-align: right }
    .section { margin-bottom: 20px }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #64748b; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0 }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px }
    .field-label { font-size: 11px; color: #64748b; margin-bottom: 2px }
    .field-value { font-size: 14px; font-weight: 600; color: #1e293b }
    .dates-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px 18px; display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center; margin-bottom: 16px }
    .date-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #3b82f6; font-weight: 700; margin-bottom: 3px }
    .date-val   { font-size: 14px; font-weight: 700; color: #1e293b }
    .arrow { font-size: 20px; color: #93c5fd; text-align: center }
    .nights-badge { background: #1e40af; color: #fff; border-radius: 20px; padding: 5px 14px; font-size: 13px; font-weight: 700; text-align: center; white-space: nowrap }
    .total-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-top: 1px solid #e2e8f0 }
    .total-label { font-size: 12px; color: #64748b }
    .total-value { font-size: 14px; font-weight: 700; color: #1e293b }
    .total-value.big { font-size: 18px; color: #1e40af }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; line-height: 1.6 }
    @media print {
      body { padding: 16px }
      @page { margin: 12mm }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="hotel-name">${hotel.name ?? 'Barranca de Termas'}</div>
      <div class="hotel-sub">${hotel.address ?? ''}${hotel.phone ? ' · ' + hotel.phone : ''}</div>
    </div>
    <div>
      <div class="voucher-title">Comprobante de Reserva</div>
      <div class="voucher-num">Emitido ${fmtDate(new Date().toISOString().slice(0,10))}</div>
    </div>
  </div>

  <!-- Huésped -->
  <div class="section">
    <div class="section-title">Datos del huésped</div>
    <div class="grid-2">
      <div>
        <div class="field-label">Nombre completo</div>
        <div class="field-value">${guestName}</div>
      </div>
      <div>
        <div class="field-label">Canal de reserva</div>
        <div class="field-value">${channel}</div>
      </div>
      ${g.dni ? `<div><div class="field-label">DNI</div><div class="field-value">${g.dni}</div></div>` : ''}
      ${g.phone ? `<div><div class="field-label">Teléfono</div><div class="field-value">${g.phone}</div></div>` : ''}
    </div>
  </div>

  <!-- Estadía -->
  <div class="section">
    <div class="section-title">Estadía</div>
    <div class="dates-box">
      <div>
        <div class="date-label">Check-in</div>
        <div class="date-val">${checkIn}</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px">A partir de las 14:00 hs</div>
      </div>
      <div style="text-align:center">
        <div class="nights-badge">${nights} noche${nights !== 1 ? 's' : ''}</div>
      </div>
      <div style="text-align:right">
        <div class="date-label" style="text-align:right">Check-out</div>
        <div class="date-val">${checkOut}</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px">Hasta las 10:00 hs</div>
      </div>
    </div>
    <div class="grid-2">
      <div>
        <div class="field-label">Alojamiento</div>
        <div class="field-value">${units}</div>
      </div>
      <div>
        <div class="field-label">Huéspedes</div>
        <div class="field-value">${pax} persona${pax !== 1 ? 's' : ''}</div>
      </div>
    </div>
    ${booking.notes ? `<div style="margin-top:10px"><div class="field-label">Notas</div><div style="font-size:13px;color:#475569;margin-top:2px">${booking.notes}</div></div>` : ''}
  </div>

  <!-- Financiero -->
  <div class="section">
    <div class="section-title">Resumen de pagos</div>
    ${paymentsHTML}
    <div style="margin-top:12px">
      <div class="total-row">
        <span class="total-label">Total de la reserva</span>
        <span class="total-value big">${formatARS(total)}</span>
      </div>
      <div class="total-row">
        <span class="total-label">Cobrado</span>
        <span class="total-value" style="color:#16a34a">${formatARS(paid)}</span>
      </div>
      ${balance > 0 ? `<div class="total-row"><span class="total-label">Saldo pendiente</span><span class="total-value" style="color:#dc2626">${formatARS(balance)}</span></div>` : ''}
    </div>
    <div style="margin-top:12px;padding:10px 14px;background:${balance <= 0 ? '#f0fdf4' : '#fffbeb'};border-radius:6px;border:1px solid ${balance <= 0 ? '#bbf7d0' : '#fde68a'}">
      ${statusLabel}
    </div>
  </div>

  <div class="footer">
    ${hotel.name ?? 'Barranca de Termas'} · Gracias por elegirnos.<br>
    Para consultas: ${hotel.phone ?? ''} ${hotel.email ? '· ' + hotel.email : ''}<br>
    Este comprobante fue emitido el ${fmtDate(new Date().toISOString().slice(0,10))} a través del sistema MILA PMS.
  </div>

  <script>window.onload = () => window.print();<\/script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=750,height=900');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
