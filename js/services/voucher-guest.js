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
  const guestName = [g.last_name, g.first_name].filter(Boolean).join(', ') || 'Huésped';
  const units     = (booking.booking_units ?? []).map(bu => bu.units?.name ?? '—').join(' / ');
  const nights    = booking.nights ?? 0;
  const pax       = booking.pax   ?? 1;
  const ciShort   = booking.check_in  ? booking.check_in.split('-').reverse().join('/')  : '—';
  const coShort   = booking.check_out ? booking.check_out.split('-').reverse().join('/') : '—';
  const ciDay     = fmtDateLong(booking.check_in).split(' ').slice(0,1).join('');
  const coDay     = fmtDateLong(booking.check_out).split(' ').slice(0,1).join('');
  const total     = booking.total_amount ?? 0;
  const paid      = booking.total_paid   ?? 0;
  const balance   = Math.max(0, total - paid);
  const payments  = booking.payments ?? [];
  const now       = fmtDate(new Date().toISOString().slice(0,10));

  const CHANNEL_LABELS = {
    direct: 'Directo', booking: 'Booking.com',
    airbnb: 'Airbnb', family: 'Familiar', walkin: 'Espontáneo',
  };
  const channel = CHANNEL_LABELS[booking.source] ?? booking.source ?? 'Directo';

  const statusText  = paid <= 0 ? 'SIN SEÑA' : balance <= 0 ? 'PAGADO TOTAL' : 'CON SEÑA';
  const pillBg      = paid <= 0 ? '#fef3c7' : balance <= 0 ? '#dcfce7' : '#ede9fe';
  const pillColor   = paid <= 0 ? '#92400e' : balance <= 0 ? '#14532d' : '#4c1d95';
  const pillBorder  = paid <= 0 ? '#fbbf24' : balance <= 0 ? '#86efac' : '#c4b5fd';
  const balanceBg   = balance > 0 ? '#fef3c7' : '#f0fdf4';
  const balanceBdr  = balance > 0 ? '#fde68a' : '#bbf7d0';
  const balanceClr  = balance > 0 ? '#92400e' : '#14532d';

  const payRows = payments.map(p => {
    const METHOD = { cash:'Efectivo', transfer:'Transferencia', mercadopago:'MercadoPago',
      naranjax:'Naranja X', uala:'Ualá', debit_card:'Tarjeta Débito',
      credit_card:'Tarjeta Crédito', credit_note:'Nota de Crédito' };
    const label = METHOD[p.method] ?? p.method ?? '—';
    const date  = p.payment_date ? p.payment_date.split('-').reverse().join('/') : '';
    const amt   = formatARS(p.amount ?? p.amount_ars ?? 0);
    return `<tr class="pay-item"><td>↳ ${label}${date ? ' · ' + date : ''}</td><td>${amt}</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8">
<title>Voucher · ${guestName} · ${ciShort}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;1,400&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Inter',sans-serif;background:#f1f5f9;color:#1e293b;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{max-width:640px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0}
  .top-stripe{height:5px;background:linear-gradient(90deg,#4f46e5,#7c3aed,#0ea5e9)}
  .head{padding:18px 24px 15px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #f1f5f9}
  .hotel-name{font-size:15px;font-weight:600;color:#1e293b;letter-spacing:-.01em}
  .hotel-sub{font-size:10px;color:#64748b;margin-top:2px}
  .hotel-contact{font-size:10px;color:#94a3b8;margin-top:3px}
  .head-right{text-align:right}
  .res-num{font-size:10px;color:#94a3b8;margin-bottom:5px}
  .status-pill{display:inline-block;background:${pillBg};color:${pillColor};border:1px solid ${pillBorder};font-size:10px;font-weight:500;padding:3px 11px;border-radius:20px}
  .dates-bar{background:#4f46e5;padding:14px 24px;display:flex;align-items:center;justify-content:space-between}
  .date-block{text-align:center;color:white}
  .date-lbl{font-size:9px;font-weight:500;opacity:.65;letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px}
  .date-val{font-size:18px;font-weight:600;letter-spacing:-.01em}
  .date-day{font-size:10px;opacity:.65;margin-top:2px;text-transform:capitalize}
  .nights-badge{text-align:center;color:white;background:rgba(255,255,255,.15);border-radius:20px;padding:6px 16px}
  .nights-n{font-size:20px;font-weight:600;display:block;line-height:1.1}
  .nights-lbl{font-size:9px;opacity:.65;letter-spacing:.06em}
  .times-row{background:#f8fafc;padding:8px 24px;display:flex;gap:28px;border-bottom:1px solid #e2e8f0}
  .time-item{font-size:10px;color:#64748b}
  .time-item strong{color:#1e293b;font-weight:500}
  .body{padding:18px 24px}
  .section{margin-bottom:16px}
  .sec-title{font-size:9px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#4f46e5;margin-bottom:9px;padding-bottom:5px;border-bottom:1px solid #e8eaf6}
  .fields-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 20px}
  .field{padding:4px 0;border-bottom:1px solid #f8fafc}
  .field.full{grid-column:1/-1}
  .field-lbl{font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px}
  .field-val{font-size:12px;color:#1e293b}
  .field-val.big{font-size:14px;font-weight:500}
  .divider{height:1px;background:#f1f5f9;margin:4px 0 14px}
  .fin-table{width:100%;border-collapse:collapse}
  .fin-table td{padding:5px 0;vertical-align:middle}
  .fin-table td:last-child{text-align:right;white-space:nowrap}
  .fin-table tr.sub td{color:#64748b;font-size:11px}
  .fin-table tr.total-row td{font-size:13px;font-weight:600;color:#1e293b;border-top:1px solid #e2e8f0;padding-top:9px;padding-bottom:4px}
  .fin-table tr.pay-item td{color:#6366f1;font-size:10px;padding:2px 0 2px 14px}
  .fin-table tr.paid-total td{color:#16a34a;font-weight:500;font-size:11px}
  .balance-box{margin-top:10px;border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;background:${balanceBg};border:1px solid ${balanceBdr}}
  .balance-lbl{font-size:11px;color:${balanceClr}}
  .balance-amt{font-size:15px;font-weight:600;color:${balanceClr}}
  .notes-box{background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:10px 14px;margin-top:14px}
  .notes-text{font-size:11px;color:#64748b;font-style:italic;line-height:1.6;margin-top:4px}
  .footer{border-top:1px solid #e2e8f0;padding:11px 24px;display:flex;justify-content:space-between;align-items:center;background:#f8fafc}
  .footer-brand{font-size:10px;color:#94a3b8}
  .footer-brand strong{color:#4f46e5}
  .footer-contact{font-size:10px;color:#94a3b8;margin-top:4px;display:flex;flex-wrap:wrap;gap:8px}
  .no-factura{font-size:9px;color:#94a3b8;border:1px solid #e2e8f0;padding:3px 10px;border-radius:4px;letter-spacing:.04em;background:#fff;white-space:nowrap}
  @media print{
    body{background:white;margin:0}
    .page{margin:0;border-radius:0;border:none;max-width:100%}
    .dates-bar,.balance-box,.top-stripe,.status-pill{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style></head><body>
<div class="page">
  <div class="top-stripe"></div>

  <div class="head">
    <div>
      <div class="hotel-name">${hotel.name ?? 'Barranca de Termas'}</div>
      <div class="hotel-sub">Complejo de Apartamentos Turísticos · ${hotel.address ?? 'San José, Entre Ríos'}</div>
      <div class="hotel-contact">+54 9 223 684 8043 · barrancadetermas@gmail.com · @barrancadetermas</div>
    </div>
    <div class="head-right">
      <div class="res-num">Voucher de reserva · ${now}</div>
      <div class="status-pill">${statusText}</div>
    </div>
  </div>

  <div class="dates-bar">
    <div class="date-block">
      <div class="date-lbl">Check-in</div>
      <div class="date-val">${ciShort}</div>
      <div class="date-day">${fmtDateLong(booking.check_in).split(',')[0] ?? ''}</div>
    </div>
    <div class="nights-badge">
      <span class="nights-n">${nights}</span>
      <span class="nights-lbl">noche${nights !== 1 ? 's' : ''}</span>
    </div>
    <div class="date-block" style="text-align:right">
      <div class="date-lbl">Check-out</div>
      <div class="date-val">${coShort}</div>
      <div class="date-day">${fmtDateLong(booking.check_out).split(',')[0] ?? ''}</div>
    </div>
  </div>

  <div class="times-row">
    <div class="time-item">Check-in desde las <strong>14:00</strong></div>
    <div class="time-item">Check-out hasta las <strong>10:00</strong></div>
  </div>

  <div class="body">
    <div class="section">
      <div class="sec-title">Huésped</div>
      <div class="fields-grid">
        <div class="field full">
          <div class="field-lbl">Nombre completo</div>
          <div class="field-val big">${guestName}</div>
        </div>
        ${g.dni   ? `<div class="field"><div class="field-lbl">DNI</div><div class="field-val">${g.dni}</div></div>` : ''}
        ${g.phone ? `<div class="field"><div class="field-lbl">Teléfono</div><div class="field-val">${g.phone}</div></div>` : ''}
        ${g.email ? `<div class="field"><div class="field-lbl">Email</div><div class="field-val">${g.email}</div></div>` : ''}
      </div>
    </div>

    <div class="section">
      <div class="sec-title">Alojamiento</div>
      <div class="fields-grid">
        <div class="field">
          <div class="field-lbl">Departamento</div>
          <div class="field-val big">${units}</div>
        </div>
        <div class="field">
          <div class="field-lbl">Huéspedes</div>
          <div class="field-val">${pax} persona${pax !== 1 ? 's' : ''}</div>
        </div>
        <div class="field">
          <div class="field-lbl">Canal de reserva</div>
          <div class="field-val">${channel}</div>
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="section">
      <div class="sec-title">Liquidación</div>
      <table class="fin-table">
        <tr class="sub"><td>Total de la reserva</td><td>${formatARS(total)}</td></tr>
        ${payRows}
        ${paid > 0 ? `<tr class="paid-total"><td>Total abonado</td><td>${formatARS(paid)}</td></tr>` : ''}
        <tr class="total-row"><td>Total estadía</td><td>${formatARS(total)}</td></tr>
      </table>
      <div class="balance-box">
        <div class="balance-lbl">${balance > 0 ? '⚠ Saldo pendiente al check-in' : '✓ Sin saldo pendiente'}</div>
        <div class="balance-amt">${balance > 0 ? formatARS(balance) : '—'}</div>
      </div>
    </div>

    ${booking.notes ? `
    <div class="notes-box">
      <div class="sec-title" style="margin-bottom:4px">Observaciones</div>
      <div class="notes-text">${booking.notes}</div>
    </div>` : ''}
  </div>

  <div class="footer">
    <div>
      <div class="footer-brand">Generado por <strong>MILA PMS</strong> · Barranca de Termas</div>
      <div class="footer-contact">
        <span>📞 +54 9 223 684 8043</span>
        <span>✉ barrancadetermas@gmail.com</span>
        <span>📷 @barrancadetermas</span>
        <span>👥 BarrancadetermasER</span>
      </div>
    </div>
    <div class="no-factura">☒ No válido como factura</div>
  </div>
</div>
<script>window.onload = () => window.print();<\/script>
</body></html>`;

  const win = window.open('', '_blank', 'width=750,height=900');
  if (win) { win.document.write(html); win.document.close(); }
}
