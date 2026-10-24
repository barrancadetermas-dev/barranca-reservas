import { computeBookingPricing } from './booking-pricing.js';
// ══════════════════════════════════════════════════════════════
// voucher-template.js — Plantilla ÚNICA del voucher de reserva
//
// Antes había 3 copias del HTML (booking-form, voucher-guest y
// export-service). Todas usaban una tarjeta de 640px con letra de
// 9–12px y sin @page: al imprimir quedaba al 70% del alto de la hoja
// y con texto de 6,75pt. Acá el voucher se diseña para el PAPEL:
//   • @page A4 vertical, márgenes de 12mm (área útil 186×273mm)
//   • tipografía en pt (cuerpo 10,5pt · etiquetas ≥ 8pt)
//   • el pie queda al fondo de la hoja y el contenido la aprovecha
//   • nada se corta entre páginas (break-inside: avoid)
//   • todo texto dinámico se escapa (nombres/notas con < > & ya no
//     rompen el voucher)
// ══════════════════════════════════════════════════════════════

const DEFAULT_HOTEL = {
  name:    'Barranca de Termas',
  address: 'San José, Entre Ríos',
  phone:   '+54 9 223 684 8043',
  email:   'barrancadetermas@gmail.com',
};
const SOCIAL = ['📷 @barrancadetermas', '👥 BarrancadetermasER'];

/** Etiquetas de método de pago (mismo set que booking-form). */
export const PAY_METHOD_LABELS = {
  cash: 'Efectivo', transfer: 'Transferencia', mercadopago: 'MercadoPago',
  naranjax: 'Naranja X', uala: 'Ualá', credit_card: 'Tarjeta de Crédito',
  debit_card: 'Tarjeta de Débito', credit_note: 'Nota de Crédito / Voucher',
};
export const CHANNEL_LABELS = {
  direct: 'Directo', booking: 'Booking.com', airbnb: 'Airbnb',
  family: 'Familiar', walkin: 'Espontáneo',
};

/** Pagos de la base → filas del voucher (ordenados por fecha). */
export function mapPayments(payments = []) {
  return payments.slice()
    .sort((a, b) => (a.payment_date ?? '').localeCompare(b.payment_date ?? ''))
    .map(p => ({
      label:  PAY_METHOD_LABELS[p.method] ?? p.method ?? '—',
      date:   p.payment_date ? p.payment_date.split('-').reverse().join('/') : '',
      amount: Number(p.amount ?? p.amount_ars) || 0,
    }));
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const esc = escapeHtml;
const money = n => '$\u00a0' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const dmy   = iso => iso ? iso.split('-').reverse().join('/') : '—';
const dm    = iso => iso ? iso.split('-').reverse().slice(0, 2).join('/') : '—';
const DAYS  = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const weekday = iso => iso ? DAYS[new Date(iso + 'T12:00:00').getDay()] : '';
const plural  = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Nombre de archivo sugerido por el navegador al "Guardar como PDF" (usa <title>). */
export function voucherFileTitle(guestName, checkIn) {
  const clean = String(guestName || 'Huésped').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `Voucher ${clean} ${checkIn || ''}`.trim();
}

/**
 * Líneas de liquidación a partir de una reserva guardada (booking de la base).
 * Solo muestra el desglose si CIERRA con el total guardado; si no (datos
 * viejos, late check-out, etc.) cae a una sola línea con el total — nunca
 * se imprime un desglose que no suma.
 * @returns {{ lines: Array<{label:string,value:number,kind:string}>, total:number }}
 */
export function buildMoneyLines(booking, segments = []) {
  // Reserva con precios por unidad: un bloque por depto (importes de cada uno sin mezclar) + lo colectivo aparte
  if (booking.unit_pricing === true && (booking.booking_units ?? []).length > 1 && !(segments.length > 1)) {
    const nightsU = Number(booking.nights) || 0;
    const P = computeBookingPricing({
      nights: nightsU,
      units: booking.booking_units.map(bu => ({ id: String(bu.unit_id), price: Number(bu.price_per_night) || 0, freeNights: bu.free_nights,
        disc: { mode: 'pct', value: bu.discount_pct }, surch: { mode: 'amt', value: bu.surcharge_amount } })),
      collective: { freeNights: booking.free_nights, disc: { mode: 'pct', value: booking.discount_pct }, surch: { mode: 'amt', value: booking.surcharge_amount } } });
    const totalU = Number(booking.total_amount) || 0;
    const restU  = totalU - P.total;
    if (Math.abs(restU) <= 1 || (booking.late_checkout && restU > 0.5)) {
      const name = id => { const bu = booking.booking_units.find(b => String(b.unit_id) === id); const l = bu?.label ? String(bu.label).trim() : ''; const n = bu?.units?.name ?? 'Depto'; return l ? `${l} · ${n}` : n; };
      const linesU = [];
      P.perUnit.forEach(u => {
        linesU.push({ label: `${name(u.id)} · ${plural(nightsU, 'noche', 'noches')} × ${money(u.price)}`, value: u.gross, kind: 'sub' });
        if (u.freeNights > 0) linesU.push({ label: `Noches sin cargo (${name(u.id)}): ${u.freeNights}`, value: -u.freeAmt, kind: 'disc' });
        if (u.discAmt > 0)    linesU.push({ label: `Descuento ${Math.round(u.discPct * 100) / 100}% (${name(u.id)})`, value: -u.discAmt, kind: 'disc' });
        if (u.surchAmt > 0)   linesU.push({ label: `Recargo (${name(u.id)})`, value: u.surchAmt, kind: 'surcharge' });
      });
      if (P.collectiveSurch > 0) linesU.push({ label: 'Recargo adicional (toda la reserva)', value: P.collectiveSurch, kind: 'surcharge' });
      if (booking.late_checkout && restU > 0.5) linesU.push({ label: 'Late check-out', value: restU, kind: 'surcharge' });
      return { lines: linesU, total: totalU };
    }
  }
  const total      = Number(booking.total_amount) || 0;
  const nights     = Number(booking.nights) || 0;
  const free       = Number(booking.free_nights) || 0;
  const billable   = Math.max(0, nights - free);
  const price      = Number(booking.price_per_night) || 0;
  const discPct    = Number(booking.discount_pct) || 0;
  const surcharge  = Number(booking.surcharge_amount) || 0;

  const priced = segments.length > 1 && segments.every(s => Number(s.pricePerNight) > 0);
  const lines  = [];
  let subtotal;
  if (priced) {
    subtotal = segments.reduce((s, x) => s + x.pricePerNight * x.nights, 0);
    segments.forEach(s => lines.push({
      label: `${s.unitName} · ${plural(s.nights, 'noche', 'noches')} × ${money(s.pricePerNight)}`,
      value: s.pricePerNight * s.nights, kind: 'sub',
    }));
  } else {
    subtotal = price * billable;
    if (price > 0) {
      lines.push({ label: 'Precio por noche', value: price, kind: 'sub' });
      lines.push({
        label: `Noches (${billable}${free ? ` facturables de ${nights} — ${free} sin cargo` : ''})`,
        value: subtotal, kind: 'sub',
      });
    }
  }
  const disc = Math.round(subtotal * discPct / 100);
  if (disc > 0)      lines.push({ label: `Descuento ${Math.round(discPct * 100) / 100}%`, value: -disc, kind: 'disc' });
  if (surcharge > 0) lines.push({ label: 'Recargo adicional', value: surcharge, kind: 'surcharge' });

  const explained = subtotal - disc + surcharge;
  const rest      = total - explained;
  if (booking.late_checkout && rest > 0.5) {
    lines.push({ label: 'Late check-out', value: rest, kind: 'surcharge' });
  } else if (Math.abs(rest) > 1 || price <= 0) {
    // No cierra → no mostrar desglose parcial
    return { lines: [], total };
  }
  return { lines, total };
}

/** Texto de personas: "2 adultos + 1 menor" o "3 personas" si no hay detalle. */
export function paxLabel({ adults, children, pax } = {}) {
  const a = Number(adults) || 0, c = Number(children) || 0;
  if (a > 0) return `${plural(a, 'adulto', 'adultos')}${c ? ` + ${plural(c, 'menor', 'menores')}` : ''}`;
  const p = Number(pax) || 1;
  return plural(p, 'persona', 'personas');
}

/**
 * HTML completo del voucher (función pura → testeable).
 * @param {object} d  ver forma en los callers (booking-form / voucher-guest / export-service)
 */
export function renderVoucherHTML(d) {
  const hotel  = { ...DEFAULT_HOTEL, ...Object.fromEntries(Object.entries(d.hotel ?? {}).filter(([, v]) => v)) };
  const g      = d.guest ?? {};
  const s      = d.stay  ?? {};
  const m      = d.money ?? {};
  const total  = Number(m.total)   || 0;
  const paid   = Number(m.paid)    || 0;
  const balance = Math.max(0, Number(m.balance ?? (total - paid)) || 0);
  const nights = Number(s.nights) || 0;
  const segs   = (s.segments ?? []).filter(x => x && x.unitName);
  const isSplit = segs.length > 1;

  const statusText = paid <= 0 ? 'SIN SEÑA' : balance <= 0 ? 'PAGADO TOTAL' : 'CON SEÑA';
  const pill = paid <= 0
    ? { bg: '#fef3c7', c: '#92400e', b: '#fbbf24' }
    : balance <= 0 ? { bg: '#dcfce7', c: '#14532d', b: '#86efac' }
                   : { bg: '#ede9fe', c: '#4c1d95', b: '#c4b5fd' };
  const bal = balance > 0
    ? { bg: '#fef3c7', b: '#fde68a', c: '#92400e' }
    : { bg: '#f0fdf4', b: '#bbf7d0', c: '#14532d' };

  const now = d.generatedAt
    ? new Date(d.generatedAt)
    : new Date();
  const nowTxt = now.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
  const contact = [hotel.email, hotel.phone].filter(Boolean).join(' · ');
  const title = voucherFileTitle(g.fullName, s.checkIn);
  // Densidad: con muchos tramos/pagos/notas se compacta el espaciado (la letra
  // nunca baja de 8pt) para que siga entrando en UNA hoja cuando es posible.
  const density = (m.lines?.length ?? 0) + (m.payments?.length ?? 0) * 0.7
                + (isSplit ? segs.length * 1.5 : 0) + (d.notes ? Math.ceil(String(d.notes).length / 110) : 0);
  const compact = density > 5;

  const field = (lbl, val, cls = '') => val
    ? `<div class="field ${cls}"><div class="field-lbl">${esc(lbl)}</div><div class="field-val">${esc(val)}</div></div>` : '';

  const stayBlock = isSplit
    ? `<div class="field full">
         <div class="field-lbl">Departamentos · cambio durante la estadía</div>
         <div class="tramos">
           ${segs.map((x, i) => `
           <div class="tramo">
             <span class="tramo-n">${i + 1}</span>
             <span class="tramo-unit">${esc(x.unitName)}</span>
             <span class="tramo-dates">${esc(dm(x.from))} → ${esc(dm(x.to))}</span>
             <span class="tramo-nights">${esc(plural(x.nights, 'noche', 'noches'))}</span>
           </div>`).join('')}
         </div>
       </div>`
    : `<div class="field"><div class="field-lbl">Departamento</div><div class="field-val big">${esc(s.units || '—')}</div></div>`;

  const lines = (m.lines ?? []);
  const payments = (m.payments ?? []);
  const finRows = [
    ...lines.map(l => `<tr class="${esc(l.kind || 'sub')}"><td>${esc(l.label)}</td><td>${l.value < 0 ? '− ' : l.kind === 'surcharge' ? '+ ' : ''}${money(Math.abs(l.value))}</td></tr>`),
    `<tr class="total-row"><td>Total estadía</td><td>${money(total)}</td></tr>`,
    ...payments.map(p => `<tr class="pay-item"><td>↳ ${esc(p.label)}${p.date ? ' · ' + esc(p.date) : ''}${p.note ? ' · ' + esc(p.note) : ''}</td><td>${money(p.amount)}</td></tr>`),
    paid > 0 ? `<tr class="paid-total"><td>Total abonado</td><td>${money(paid)}</td></tr>` : '',
  ].join('');

  return `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  /* ── Papel: A4 vertical, 12mm de margen → área útil 186 × 273 mm ── */
  @page { size: A4 portrait; margin: 12mm; }
  *{margin:0;padding:0;box-sizing:border-box}
  html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#e2e8f0;color:#1e293b;font-size:10.5pt;line-height:1.35}

  /* ── Hoja (en pantalla simula el papel; en impresión ocupa el área útil) ── */
  .sheet{width:186mm;min-height:266mm;margin:14px auto 28px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;
         display:flex;flex-direction:column;box-shadow:0 4px 18px rgba(15,23,42,.10)}
  .toolbar{width:186mm;margin:14px auto 0;display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:10pt;color:#475569}
  .toolbar button{background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:8px 16px;font-weight:600;font-size:10pt;font-family:inherit;cursor:pointer}
  .top-stripe{height:5px;flex:none;background:linear-gradient(90deg,#4f46e5,#7c3aed,#0ea5e9)}
  .head{padding:4.5mm 8mm 4mm;display:flex;justify-content:space-between;align-items:flex-start;gap:8mm;border-bottom:1px solid #f1f5f9}
  .hotel-name{font-size:16pt;font-weight:600;letter-spacing:-.01em}
  .hotel-sub{font-size:9pt;color:#64748b;margin-top:.8mm}
  .hotel-contact{font-size:8.5pt;color:#94a3b8;margin-top:.8mm}
  .head-right{text-align:right;flex:none}
  .res-num{font-size:8.5pt;color:#94a3b8;margin-bottom:1.5mm}
  .status-pill{display:inline-block;background:${pill.bg};color:${pill.c};border:1px solid ${pill.b};font-size:9.5pt;font-weight:600;padding:1mm 4mm;border-radius:20px}

  .dates-bar{flex:none;background:#4f46e5;color:#fff;padding:4mm 8mm;display:flex;align-items:center;justify-content:space-between}
  .date-block{text-align:center}
  .date-lbl{font-size:8.5pt;font-weight:500;opacity:.75;letter-spacing:.1em;text-transform:uppercase;margin-bottom:1mm}
  .date-val{font-size:20pt;font-weight:600;letter-spacing:-.01em;line-height:1.1}
  .date-day{font-size:10pt;opacity:.8;margin-top:1mm;text-transform:capitalize}
  .nights-badge{text-align:center;background:rgba(255,255,255,.16);border-radius:22px;padding:1.8mm 6mm}
  .nights-n{font-size:21pt;font-weight:600;display:block;line-height:1.05}
  .nights-lbl{font-size:9pt;opacity:.8;letter-spacing:.06em}
  .times-row{flex:none;background:#f8fafc;padding:2.2mm 8mm;display:flex;gap:10mm;border-bottom:1px solid #e2e8f0;font-size:10pt;color:#64748b}
  .times-row strong{color:#1e293b;font-weight:600}

  .body{flex:1;padding:5mm 8mm 3mm;display:flex;flex-direction:column;gap:4mm}
  .section{break-inside:avoid}
  .sec-title{break-after:avoid;font-size:9pt;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#4f46e5;margin-bottom:2mm;padding-bottom:1.2mm;border-bottom:1px solid #e0e3f5}
  .fields-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.5mm 6mm}
  .field{padding:1mm 0;border-bottom:1px solid #f1f5f9;break-inside:avoid}
  .field.full{grid-column:1/-1}
  .field.half{grid-column:span 2}
  .field-lbl{font-size:8pt;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.6mm}
  .field-val{font-size:10.5pt;color:#1e293b;overflow-wrap:anywhere}
  .field-val.big{font-size:13pt;font-weight:500}

  .tramos{display:flex;flex-direction:column;gap:1.5mm;margin-top:1.5mm}
  .tramo{display:grid;grid-template-columns:7mm 1fr auto auto;align-items:center;gap:3mm;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;padding:1.4mm 3mm;break-inside:avoid}
  .tramo-n{width:5.5mm;height:5.5mm;border-radius:50%;background:#4f46e5;color:#fff;font-size:8.5pt;font-weight:600;display:flex;align-items:center;justify-content:center}
  .tramo-unit{font-size:11pt;font-weight:600}
  .tramo-dates{font-size:10.5pt;color:#4338ca;font-weight:500;white-space:nowrap}
  .tramo-nights{font-size:10pt;color:#64748b;white-space:nowrap;min-width:18mm;text-align:right}

  .fin-table{width:100%;border-collapse:collapse}
  .fin-table td{padding:.9mm 0;vertical-align:middle;font-size:10.5pt}
  .fin-table tr{break-inside:avoid}
  .fin-table td:last-child{text-align:right;white-space:nowrap}
  .fin-table tr.sub td{color:#64748b}
  .fin-table tr.disc td{color:#16a34a}
  .fin-table tr.surcharge td{color:#d97706}
  .fin-table tr.total-row td{font-size:13pt;font-weight:600;border-top:1px solid #e2e8f0;padding-top:2mm}
  .fin-table tr.pay-item td{color:#6366f1;font-size:9.5pt;padding:.5mm 0 .5mm 4mm}
  .fin-table tr.paid-total td{color:#16a34a;font-weight:600}
  .balance-box{break-inside:avoid;margin-top:2.5mm;border-radius:8px;padding:2.5mm 5mm;display:flex;justify-content:space-between;align-items:center;background:${bal.bg};border:1px solid ${bal.b}}
  .balance-lbl{font-size:10.5pt;color:${bal.c}}
  .balance-amt{font-size:15pt;font-weight:600;color:${bal.c}}
  .notes-box{break-inside:avoid;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:2.5mm 4mm}
  .notes-box .sec-title{margin-bottom:1.5mm;border:0;padding:0}
  .notes-text{font-size:10pt;color:#64748b;font-style:italic;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}

  .footer{flex:none;margin-top:auto;border-top:1px solid #e2e8f0;padding:3mm 8mm;display:flex;justify-content:space-between;align-items:center;gap:6mm;background:#f8fafc;break-inside:avoid}
  .footer-brand{font-size:8.5pt;color:#94a3b8}
  .footer-brand strong{color:#4f46e5}
  .footer-contact{margin-top:1mm;font-size:8.5pt;color:#94a3b8;display:flex;flex-wrap:wrap;gap:1mm 4mm}
  .no-factura{font-size:8.5pt;color:#94a3b8;border:1px solid #e2e8f0;padding:1.2mm 3.5mm;border-radius:4px;letter-spacing:.04em;background:#fff;white-space:nowrap}

  .sheet.compact .head{padding:3.5mm 8mm 3mm}
  .sheet.compact .dates-bar{padding:3mm 8mm}
  .sheet.compact .times-row{padding:1.6mm 8mm}
  .sheet.compact .body{padding:3.5mm 8mm 2mm;gap:2.8mm}
  .sheet.compact .sec-title{margin-bottom:1.4mm;padding-bottom:.8mm}
  .sheet.compact .field{padding:.5mm 0}
  .sheet.compact .tramos{gap:1mm}
  .sheet.compact .tramo{padding:.9mm 3mm}
  .sheet.compact .fin-table td{padding:.5mm 0}
  .sheet.compact .fin-table tr.total-row td{padding-top:1.4mm}
  .sheet.compact .balance-box{margin-top:1.8mm;padding:1.8mm 4mm}
  .sheet.compact .notes-box{padding:2mm 4mm}
  .sheet.compact .footer{padding:2.2mm 8mm}

  /* Pantallas angostas (celular): la hoja se adapta al ancho */
  @media screen and (max-width:740px){
    .sheet,.toolbar{width:auto;margin-left:8px;margin-right:8px}
    .date-val{font-size:16pt}
    .fields-grid{grid-template-columns:1fr 1fr}
    .field.half{grid-column:1/-1}
  }
  /* Impresión / PDF: la hoja ES el área útil de la página */
  @media print{
    body{background:#fff}
    .toolbar{display:none}
    .sheet{width:auto;min-height:268mm;margin:0;border:0;border-radius:0;box-shadow:none;overflow:visible}
  }
</style></head><body>
<div class="toolbar"><span>Elegí <b>Guardar como PDF</b> · tamaño A4 · escala 100%</span><button onclick="window.print()">🖨 Imprimir / Guardar PDF</button></div>
<div class="sheet${compact ? ' compact' : ''}">
  <div class="top-stripe"></div>

  <div class="head">
    <div>
      <div class="hotel-name">${esc(hotel.name)}</div>
      <div class="hotel-sub">Complejo de Apartamentos Turísticos${hotel.address ? ' · ' + esc(hotel.address) : ''}</div>
      ${contact ? `<div class="hotel-contact">${esc(contact)}</div>` : ''}
    </div>
    <div class="head-right">
      <div class="res-num">Voucher de reserva${d.reservationCode ? ' #' + esc(d.reservationCode) : ''} · ${esc(nowTxt)}</div>
      <div class="status-pill">${statusText}</div>
    </div>
  </div>

  <div class="dates-bar">
    <div class="date-block">
      <div class="date-lbl">Check-in</div>
      <div class="date-val">${esc(dmy(s.checkIn))}</div>
      <div class="date-day">${esc(weekday(s.checkIn))}</div>
    </div>
    <div class="nights-badge">
      <span class="nights-n">${nights}</span>
      <span class="nights-lbl">noche${nights !== 1 ? 's' : ''}</span>
    </div>
    <div class="date-block">
      <div class="date-lbl">Check-out</div>
      <div class="date-val">${esc(dmy(s.checkOut))}</div>
      <div class="date-day">${esc(weekday(s.checkOut))}</div>
    </div>
  </div>

  <div class="times-row">
    <div>Check-in desde las <strong>${esc(s.checkInTime || '14:00')}</strong></div>
    <div>Check-out hasta las <strong>${esc(s.checkOutTime || '10:00')}</strong></div>
  </div>

  <div class="body">
    <div class="section">
      <div class="sec-title">Huésped</div>
      <div class="fields-grid">
        <div class="field full"><div class="field-lbl">Nombre completo</div><div class="field-val big">${esc(g.fullName || '—')}</div></div>
        ${field('DNI / Documento', g.dni)}
        ${field('Teléfono', g.phone)}
        ${field('Email', g.email)}
        ${field('Localidad', g.locality)}
        ${field('Edad', g.age ? `${g.age} años` : '')}
        ${field('Vehículo', g.vehicle, 'full')}
      </div>
    </div>

    <div class="section">
      <div class="sec-title">Alojamiento</div>
      <div class="fields-grid">
        ${stayBlock}
        ${field('Huéspedes', s.paxLabel)}
        ${(s.distribution ?? []).length ? field('Distribución por departamento', s.distribution.map(d => `${d.name}: ${d.text}`).join(' · ')) : ''}
        ${field('Canal de reserva', s.channel)}
      </div>
    </div>

    <div class="section">
      <div class="sec-title">Liquidación</div>
      <table class="fin-table">${finRows}</table>
      <div class="balance-box">
        <div class="balance-lbl">${balance > 0 ? '⚠ Saldo pendiente al check-in' : '✓ Sin saldo pendiente'}</div>
        <div class="balance-amt">${balance > 0 ? money(balance) : '—'}</div>
      </div>
    </div>

    ${d.notes ? `<div class="notes-box"><div class="sec-title">Observaciones</div><div class="notes-text">${esc(d.notes)}</div></div>` : ''}
  </div>

  <div class="footer">
    <div>
      <div class="footer-brand">Generado por <strong>MILA PMS</strong> · ${esc(hotel.name)}</div>
      <div class="footer-contact">
        ${hotel.phone ? `<span>📞 ${esc(hotel.phone)}</span>` : ''}
        ${hotel.email ? `<span>✉ ${esc(hotel.email)}</span>` : ''}
        ${SOCIAL.map(x => `<span>${esc(x)}</span>`).join('')}
      </div>
    </div>
    <div class="no-factura">☒ No válido como factura</div>
  </div>
</div>
<script>
  // Imprimir recién cuando la fuente y el layout están listos (antes se
  // disparaba en onload y podía salir con la fuente de reemplazo).
  (function(){
    var done = false;
    function go(){ if (done) return; done = true; requestAnimationFrame(function(){ setTimeout(function(){ window.print(); }, 150); }); }
    var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.race([fonts, new Promise(function(r){ setTimeout(r, 2000); })]).then(go);
  })();
</script>
</body></html>`;
}

/**
 * Abre el voucher en una ventana nueva (se imprime solo).
 * @returns {Window|null} null si el navegador bloqueó la ventana emergente
 */
export function openVoucherWindow(data) {
  const html = renderVoucherHTML(data);
  const win  = window.open('', '_blank', 'width=820,height=960');
  if (!win) return null;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return win;
}
