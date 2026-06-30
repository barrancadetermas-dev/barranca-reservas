// ═══════════════════════════════════════════════════
// encargada-content.js — Contenido para compartir con encargada
// Genera PDF (ventana imprimible) + texto WhatsApp
// Reutiliza misma lógica de formato que export-service.js
// ═══════════════════════════════════════════════════

const MANAGER_PHONE = '+5493447448135'; // número predeterminado de la encargada

const fmtDate = (s) => s ? s.split('-').reverse().join('/') : '—';
const fmtMoney = (n) => '$' + Math.round(n ?? 0).toLocaleString('es-AR');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function unitLabel(bu) {
  const u = bu.units;
  if (!u) return '—';
  const num  = u.sort_order ?? '?';
  const name = u.name ?? 'Unidad';
  return `#${num} – ${name}`;
}

function unitDot(bu) {
  const u = bu.units;
  if (!u) return '';
  const color = u.color ?? '#1A3A90';
  const num   = u.sort_order ?? '?';
  const name  = u.name ?? 'Unidad';
  return `<span class="enc-unit-dot" style="background:${esc(color)}"></span>#${num} – ${esc(name)}`;
}

function paymentStatus(b) {
  const balance = b.balance ?? Math.max(0, (b.total_amount ?? 0) - (b.total_paid ?? 0));
  if (balance <= 0) return 'Pago completo';
  if ((b.total_paid ?? 0) > 0) return 'Con seña';
  return 'Sin seña';
}

function buildBlocks(bookings, includeAmounts) {
  return bookings
    .filter(b => b.status !== 'cancelled' && b.status !== 'blocked')
    .map(b => {
      const g       = b.guests;
      const name    = g ? `${g.last_name ?? ''}, ${g.first_name ?? ''}`.trim().replace(/^,\s*/, '') : '—';
      const phone   = g?.phone ?? '—';
      const units   = (b.booking_units ?? []);
      const nights  = b.nights ?? Math.round((new Date(b.check_out) - new Date(b.check_in)) / 86400000);
      const pax     = (b.adults ?? b.pax ?? '') || '';
      const balance = Math.max(0, (b.total_amount ?? 0) - (b.total_paid ?? 0));
      const notes   = b.notes ?? '';
      const status  = paymentStatus(b);
      return { b, g, name, phone, units, nights, pax, balance, notes, status, includeAmounts };
    });
}

// ── PDF ──────────────────────────────────────────────
export function generateEncargadaPDF(bookings, rangeLabel, includeAmounts) {
  const blocks = buildBlocks(bookings, includeAmounts);
  const now = new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' });

  const rows = blocks.map(({ b, g, name, phone, units, nights, pax, balance, notes, status }) => {
    const unitHtml = units.map(bu =>
      `<span class="enc-unit">${unitDot(bu)}</span>`
    ).join(' ');

    const isCleaning = !includeAmounts; // modo solo-limpieza
    const cardLabel  = isCleaning ? 'Limpieza 🧹' : 'Nueva Reserva 🧾';

    const amountRow = includeAmounts && balance > 0
      ? `<div class="enc-row"><span class="enc-lbl">Abonan al ingreso:</span><span class="enc-val enc-money">${esc(fmtMoney(balance))}</span></div>`
      : '';
    const cleaningRow = isCleaning
      ? `<div class="enc-row enc-cleaning-row"><span class="enc-lbl">🧹 Día de limpieza:</span><span class="enc-val enc-cleaning-date">${esc(fmtDate(b.check_out))}</span></div>`
      : '';
    const statusBadge = includeAmounts
      ? `<span class="enc-badge enc-badge-${balance <= 0 ? 'paid' : (b.total_paid > 0 ? 'partial' : 'pending')}">${esc(status)}</span>`
      : `<span class="enc-badge enc-badge-cleaning">Solo limpieza</span>`;

    return `
      <div class="enc-card${isCleaning ? ' enc-card-cleaning' : ''}">
        <div class="enc-card-head">
          <span class="enc-head-label">${cardLabel}</span>
          ${statusBadge}
        </div>
        ${cleaningRow}
        <div class="enc-row"><span class="enc-lbl">Apellido y Nombre:</span><span class="enc-val enc-bold">${esc(name)}</span></div>
        <div class="enc-row"><span class="enc-lbl">Contacto:</span><span class="enc-val">${esc(phone)}</span></div>
        <div class="enc-row"><span class="enc-lbl">Apart. N°:</span><span class="enc-val">${unitHtml || '—'}</span></div>
        <div class="enc-row"><span class="enc-lbl">Fecha Ingreso:</span><span class="enc-val">${esc(fmtDate(b.check_in))}</span></div>
        <div class="enc-row"><span class="enc-lbl">Fecha Salida:</span><span class="enc-val">${esc(fmtDate(b.check_out))}</span></div>
        <div class="enc-row"><span class="enc-lbl">Noches:</span><span class="enc-val">${esc(String(nights))}</span></div>
        <div class="enc-row"><span class="enc-lbl">Cant. de Personas:</span><span class="enc-val">${pax !== '' ? esc(String(pax)) : '—'}</span></div>
        ${amountRow}
        <div class="enc-row enc-notes"><span class="enc-lbl">Nota:</span><span class="enc-val enc-note-text">${esc(notes) || '—'}</span></div>
      </div>`;
  }).join('');

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!DOCTYPE html><html lang="es"><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Reservas · Encargada${rangeLabel ? ' · ' + rangeLabel : ''}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;background:#f0f4fa;padding:24px 16px}
      .enc-doc{max-width:540px;margin:0 auto}
      .enc-header{background:linear-gradient(135deg,#1A3A90,#1E4DB7);color:#fff;border-radius:14px 14px 0 0;padding:20px 24px;margin-bottom:0}
      .enc-header-logo{font-size:18px;font-weight:900;letter-spacing:-.01em;display:flex;align-items:center;gap:8px}
      .enc-header-logo span{font-size:10px;font-weight:500;opacity:.75;font-weight:400;margin-top:2px;display:block}
      .enc-header-sub{font-size:11px;opacity:.8;margin-top:8px}
      .enc-header-range{font-size:13px;font-weight:700;margin-top:2px}
      .enc-meta{background:#fff;padding:12px 24px;border-bottom:2px solid #eef2ff;font-size:11px;color:#64748b;display:flex;justify-content:space-between;margin-bottom:16px;border-radius:0 0 8px 8px}
      .enc-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px 20px;margin-bottom:14px;page-break-inside:avoid}
      .enc-card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #eef2ff}
      .enc-head-label{font-size:14px;font-weight:800;color:#1A3A90}
      .enc-badge{font-size:10px;font-weight:800;padding:3px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:.03em}
      .enc-badge-paid{background:#dcfce7;color:#15803d}
      .enc-badge-partial{background:#fef3c7;color:#b45309}
      .enc-badge-pending{background:#fee2e2;color:#dc2626}
      .enc-badge-cleaning{background:#f0f9ff;color:#0284c7;border:1px solid #bae6fd}
      .enc-card-cleaning{border-color:#bae6fd;background:#f0f9ff}
      .enc-card-cleaning .enc-card-head{border-bottom-color:#bae6fd}
      .enc-cleaning-row{background:#e0f2fe;border-radius:8px;margin:-4px -4px 6px;padding:8px 12px!important;border:none!important}
      .enc-cleaning-date{font-size:16px!important;font-weight:900!important;color:#0369a1!important}
      .enc-row{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px dashed #f1f5f9;font-size:13px}
      .enc-row:last-child{border-bottom:none}
      .enc-lbl{color:#64748b;flex-shrink:0;min-width:148px;font-size:12px}
      .enc-val{color:#1e293b;flex:1;font-size:13px}
      .enc-bold{font-weight:700;color:#0f172a}
      .enc-money{font-weight:800;color:#1A3A90;font-size:14px}
      .enc-notes{align-items:flex-start}
      .enc-note-text{font-style:italic;color:#475569;font-size:12px}
      .enc-unit{display:inline-flex;align-items:center;gap:5px;background:#f0f4fa;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:600;margin:1px}
      .enc-unit-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0}
      .enc-footer{text-align:center;font-size:11px;color:#94a3b8;padding:16px;margin-top:8px}
      .no-print{text-align:center;margin:18px 0}
      .print-btn{padding:10px 24px;background:#1A3A90;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;margin-right:8px}
      @media print{
        body{background:#fff;padding:10px}
        .no-print{display:none}
        .enc-header{border-radius:0}
        .enc-card{border:1px solid #d1d5db;margin-bottom:10px;break-inside:avoid}
      }
    </style>
  </head><body>
    <div class="enc-doc">
      <div class="enc-header">
        <div class="enc-header-logo">🏡 Barranca de Termas<span>Sistema MILA · Reservas para encargada</span></div>
        <div class="enc-header-range">${rangeLabel ? '📅 ' + esc(rangeLabel) : ''}</div>
        <div class="enc-header-sub">${blocks.length} reserva${blocks.length !== 1 ? 's' : ''} · Generado el ${now}</div>
      </div>
      <div class="enc-meta">
        <span>Modo: <strong>${includeAmounts ? 'Reservas con importes' : '🧹 Solo limpieza (sin importes)'}</strong></span>
        <span>Uso interno · No válido como factura</span>
      </div>
      ${rows || '<p style="text-align:center;color:#94a3b8;padding:40px">Sin reservas en el período.</p>'}
      <div class="enc-footer">📍 San José (Colón) E.Ríos · @barrancadetermas</div>
    </div>
    <div class="no-print">
      <button class="print-btn" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>
    </div>
  </body></html>`);
  w.document.close();
  return true;
}

// ── Texto WhatsApp ───────────────────────────────────
export function generateEncargadaWhatsApp(bookings, rangeLabel, includeAmounts) {
  const blocks = buildBlocks(bookings, includeAmounts);
  const now = new Date().toLocaleDateString('es-AR');

  const header = [
    `🏡 *Barranca de Termas*`,
    includeAmounts
      ? `📋 *Reservas para Encargada*${rangeLabel ? ' · ' + rangeLabel : ''}`
      : `🧹 *Limpiezas programadas*${rangeLabel ? ' · ' + rangeLabel : ''}`,
    `Generado: ${now} · ${blocks.length} reserva${blocks.length !== 1 ? 's' : ''}`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ].join('\n');

  const cards = blocks.map(({ b, name, phone, units, nights, pax, balance, notes, status }) => {
    const unitsText  = units.map(bu => unitLabel(bu)).join(' / ') || '—';
    const isCleaning = !includeAmounts;
    const lines = [
      isCleaning ? `*Limpieza* 🧹` : `*Nueva Reserva* 🧾`,
      ``,
    ];
    if (isCleaning) {
      lines.push(`🧹 *Día de limpieza: ${fmtDate(b.check_out)}*`);
      lines.push(``);
    }
    lines.push(
      `- Apellido y Nombre: *${name}*`,
      `- Contacto: ${phone}`,
      `- Apart. N°: ${unitsText}`,
      `- Fecha Ingreso: ${fmtDate(b.check_in)}`,
      `- Fecha Salida: ${fmtDate(b.check_out)}`,
      `- Noches: ${nights}`,
      `- Cant. de Personas: ${pax !== '' ? String(pax) : '—'}`,
    );
    if (includeAmounts && balance > 0) {
      lines.push(`- Abonan al ingreso: *${fmtMoney(balance)}*`);
    }
    if (includeAmounts) {
      lines.push(`- Estado: ${status}`);
    }
    lines.push(`- Nota: ${notes || '—'}`);
    return lines.join('\n');
  });

  const footer = `━━━━━━━━━━━━━━━━━━━━━━\n_MILA Sistema Inteligente · Barranca de Termas_`;
  return [header, ...cards.map((c, i) => (i > 0 ? '──────────────────────\n' : '') + c), footer].join('\n\n');
}

// ── Abrir WhatsApp con el número predeterminado ──────
export function openWhatsAppManager(text) {
  const cleaned = MANAGER_PHONE.replace(/\D/g, '');
  const url = `https://wa.me/${cleaned}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export { MANAGER_PHONE };
