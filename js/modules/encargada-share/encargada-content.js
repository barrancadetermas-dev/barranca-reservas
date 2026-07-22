// ═══════════════════════════════════════════════════
// encargada-content.js — Contenido para compartir con encargada
// Genera PDF (ventana imprimible) + texto WhatsApp editable
// ═══════════════════════════════════════════════════

export const MANAGER_PHONE = '+5493447448135';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// Fecha corta SIN año: "26/07"
const fmtShort = (s) => {
  if (!s) return '—';
  const [, m, d] = s.split('-');
  return `${d}/${m}`;
};

// Fecha con día de semana SIN año: "DOM 26/06"
const DIAS = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
const fmtWithDay = (s) => {
  if (!s) return '—';
  const dow = DIAS[new Date(s + 'T12:00:00').getDay()];
  return `${dow} ${fmtShort(s)}`;
};

const fmtMoney = (n) => '$' + Math.round(n ?? 0).toLocaleString('es-AR');

function unitLabel(bu) {
  const u = bu.units;
  if (!u) return '—';
  return `#${u.sort_order ?? '?'} – ${u.name ?? 'Unidad'}`;
}

// Versión abreviada para WhatsApp (mensaje de limpieza): "Planta Baja/Alta"
// se acorta a "P. Baja/Alta" para que la línea entre más corta, y separa
// el número (negrita) del resto (cursiva) para que el n° de depto resalte.
function unitLabelWA(bu) {
  const u = bu.units;
  if (!u) return { num: '—', rest: '' };
  const shortName = (u.name ?? 'Unidad')
    .replace(/Planta Baja/i, 'P. Baja')
    .replace(/Planta Alta/i, 'P. Alta');
  return { num: `#${u.sort_order ?? '?'}`, rest: `– ${shortName}` };
}

function unitDot(bu) {
  const u = bu.units;
  if (!u) return '';
  const color = u.color ?? '#1A3A90';
  return `<span class="enc-unit-dot" style="background:${esc(color)}"></span>#${u.sort_order ?? '?'} – ${esc(u.name ?? 'Unidad')}`;
}

function paymentStatus(b) {
  const balance = b.balance ?? Math.max(0, (b.total_amount ?? 0) - (b.total_paid ?? 0));
  if (balance <= 0) return 'Pago completo';
  if ((b.total_paid ?? 0) > 0) return 'Con seña';
  return 'Sin seña';
}

// Detecta si en la lista hay un check-in de la misma unidad el mismo día (= recambio)
function isRecambio(booking, unitId, allBookings) {
  const coDate = booking.check_out;
  return allBookings.some(b =>
    b.id !== booking.id &&
    b.check_in === coDate &&
    (b.booking_units ?? []).some(bu => bu.unit_id === unitId)
  );
}

// ─────────────────────────────────────────────────────────
// MODO LIMPIEZA — agrupa por día de checkout, detecta recambio
// ─────────────────────────────────────────────────────────
function buildCleaningGroups(bookings) {
  const valid = bookings.filter(b => b.status !== 'cancelled' && b.status !== 'blocked');
  // Un bloque por cada unidad/reserva (puede haber varias unidades en una reserva)
  const items = [];
  valid.forEach(b => {
    const nights = b.nights ?? Math.round((new Date(b.check_out) - new Date(b.check_in)) / 86400000);
    (b.booking_units ?? [{ unit_id: null, units: null }]).forEach(bu => {
      items.push({
        b,
        bu,
        unitId: bu.unit_id,
        checkoutDate: b.check_out,
        nights,
        recambio: isRecambio(b, bu.unit_id, valid),
      });
    });
  });
  // Ordenar por fecha checkout → sort_order de unidad
  items.sort((a, b) => {
    const dc = a.checkoutDate.localeCompare(b.checkoutDate);
    if (dc !== 0) return dc;
    return (a.bu?.units?.sort_order ?? 99) - (b.bu?.units?.sort_order ?? 99);
  });
  // Agrupar por día
  const groups = new Map();
  items.forEach(item => {
    const k = item.checkoutDate;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  });
  return groups;
}

// ─────────────────────────────────────────────────────────
// MODO RESERVAS — igual que antes
// ─────────────────────────────────────────────────────────
function buildReservaBlocks(bookings) {
  return bookings
    .filter(b => b.status !== 'cancelled' && b.status !== 'blocked')
    .map(b => {
      const g    = b.guests;
      const name = g ? `${g.last_name ?? ''}, ${g.first_name ?? ''}`.trim().replace(/^,\s*/, '') : '—';
      return {
        b, name,
        phone:   g?.phone ?? '—',
        age:     g?.age ?? null,
        car:     [g?.car_model, g?.car_plate].filter(Boolean).join(' · ') || null,
        units:   b.booking_units ?? [],
        nights:  b.nights ?? Math.round((new Date(b.check_out) - new Date(b.check_in)) / 86400000),
        pax:     (b.adults ?? b.pax ?? '') || '',
        balance: Math.max(0, (b.total_amount ?? 0) - (b.total_paid ?? 0)),
        notes:   b.notes ?? '',
        status:  paymentStatus(b),
      };
    });
}

// ══════════════════════════════════════════════════
// PDF
// ══════════════════════════════════════════════════
export function generateEncargadaPDF(bookings, rangeLabel, includeAmounts) {
  const now = new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' });
  let rows = '';
  let totalCount = 0;

  if (!includeAmounts) {
    // ── Modo limpieza ──
    const groups = buildCleaningGroups(bookings);
    totalCount = [...groups.values()].reduce((s, g) => s + g.length, 0);

    groups.forEach((items, date) => {
      const dayLabel = fmtWithDay(date);
      const count = items.length;
      if (count > 1) {
        rows += `<div class="enc-day-header">${dayLabel} · ${count} departamento${count !== 1 ? 's' : ''}</div>`;
      }
      items.forEach(({ b, bu, nights, recambio }) => {
        const unitHtml = bu.units
          ? `<span class="enc-unit">${unitDot(bu)}${recambio ? ' <strong class="enc-recambio">RECAMBIO</strong>' : ''}</span>`
          : '—';
        rows += `
          <div class="enc-card enc-card-cleaning">
            <div class="enc-cleaning-date-row">🧹 <strong>Día de limpieza: ${dayLabel}</strong></div>
            <div class="enc-row"><span class="enc-lbl">Apart. N°:</span><span class="enc-val">${unitHtml}</span></div>
            <div class="enc-row"><span class="enc-lbl">Noches:</span><span class="enc-val enc-italic">Estuvieron ${nights} noche${nights !== 1 ? 's' : ''}</span></div>
            <div class="enc-row enc-notes"><span class="enc-lbl">Nota:</span><span class="enc-val enc-note-blank"></span></div>
          </div>`;
      });
    });
  } else {
    // ── Modo reservas ──
    const blocks = buildReservaBlocks(bookings);
    totalCount = blocks.length;
    rows = blocks.map(({ b, name, phone, units, nights, pax, balance, notes, status }) => {
      const unitHtml = units.map(bu =>
        `<span class="enc-unit">${unitDot(bu)}</span>`).join(' ');
      const amountRow = balance > 0
        ? `<div class="enc-row"><span class="enc-lbl">Abonan al ingreso:</span><span class="enc-val enc-money">${esc(fmtMoney(balance))}</span></div>`
        : '';
      const badgeCls = balance <= 0 ? 'paid' : (b.total_paid > 0 ? 'partial' : 'pending');
      return `
        <div class="enc-card">
          <div class="enc-card-head">
            <span class="enc-head-label">Nueva Reserva 🧾</span>
            <span class="enc-badge enc-badge-${badgeCls}">${esc(status)}</span>
          </div>
          <div class="enc-row"><span class="enc-lbl">Apellido y Nombre:</span><span class="enc-val enc-bold">${esc(name)}</span></div>
          <div class="enc-row"><span class="enc-lbl">Contacto:</span><span class="enc-val">${esc(phone)}</span></div>
          <div class="enc-row"><span class="enc-lbl">Apart. N°:</span><span class="enc-val">${unitHtml || '—'}</span></div>
          <div class="enc-row"><span class="enc-lbl">Fecha Ingreso:</span><span class="enc-val">${esc(fmtShort(b.check_in))}</span></div>
          <div class="enc-row"><span class="enc-lbl">Fecha Salida:</span><span class="enc-val">${esc(fmtShort(b.check_out))}</span></div>
          <div class="enc-row"><span class="enc-lbl">Noches:</span><span class="enc-val">${nights}</span></div>
          <div class="enc-row"><span class="enc-lbl">Cant. de Personas:</span><span class="enc-val">${pax !== '' ? esc(String(pax)) : '—'}</span></div>
          ${amountRow}
          <div class="enc-row enc-notes"><span class="enc-lbl">Nota:</span><span class="enc-val enc-note-text">${esc(notes) || '—'}</span></div>
        </div>`;
    }).join('');
  }

  const modeLabel = includeAmounts ? 'Reservas con importes' : '🧹 Solo limpieza';
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!DOCTYPE html><html lang="es"><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Encargada${rangeLabel ? ' · ' + rangeLabel : ''}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;background:#f0f4fa;padding:24px 16px}
      .enc-doc{max-width:540px;margin:0 auto}
      .enc-header{background:linear-gradient(135deg,#1A3A90,#1E4DB7);color:#fff;border-radius:14px 14px 0 0;padding:20px 24px}
      .enc-header-title{font-size:18px;font-weight:900}
      .enc-header-sub{font-size:11px;opacity:.8;margin-top:6px}
      .enc-meta{background:#fff;padding:10px 20px;border-bottom:2px solid #eef2ff;font-size:11px;color:#64748b;display:flex;justify-content:space-between;border-radius:0 0 8px 8px;margin-bottom:16px}
      .enc-day-header{font-size:13px;font-weight:800;color:#0369a1;background:#dbeafe;border-radius:10px;padding:8px 14px;margin-bottom:8px;letter-spacing:.02em}
      .enc-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px;margin-bottom:12px;page-break-inside:avoid}
      .enc-card-cleaning{border-color:#bae6fd;background:#f0f9ff}
      .enc-card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid #eef2ff}
      .enc-head-label{font-size:13px;font-weight:800;color:#1A3A90}
      .enc-badge{font-size:10px;font-weight:800;padding:3px 10px;border-radius:999px;text-transform:uppercase}
      .enc-badge-paid{background:#dcfce7;color:#15803d}
      .enc-badge-partial{background:#fef3c7;color:#b45309}
      .enc-badge-pending{background:#fee2e2;color:#dc2626}
      .enc-cleaning-date-row{font-size:15px;font-weight:800;color:#0369a1;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid #bae6fd}
      .enc-row{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px dashed #f1f5f9;font-size:13px}
      .enc-row:last-child{border-bottom:none}
      .enc-lbl{color:#64748b;flex-shrink:0;min-width:130px;font-size:12px}
      .enc-val{color:#1e293b;flex:1;font-size:13px}
      .enc-bold{font-weight:700;color:#0f172a}
      .enc-italic{font-style:italic;color:#475569}
      .enc-money{font-weight:800;color:#1A3A90;font-size:14px}
      .enc-recambio{color:#dc2626;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-left:4px}
      .enc-notes{align-items:flex-start}
      .enc-note-text{font-style:italic;color:#475569;font-size:12px}
      .enc-note-blank{flex:1;border-bottom:1px solid #cbd5e1;min-height:18px}
      .enc-unit{display:inline-flex;align-items:center;gap:5px;background:#f0f4fa;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:600;margin:1px}
      .enc-unit-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0}
      .enc-footer{text-align:center;font-size:11px;color:#94a3b8;padding:16px;margin-top:8px}
      .no-print{text-align:center;margin:18px 0}
      .print-btn{padding:10px 24px;background:#1A3A90;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer}
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
        <div class="enc-header-title">🏡 Barranca de Termas</div>
        <div class="enc-header-sub">${modeLabel}${rangeLabel ? ' · ' + esc(rangeLabel) : ''} · ${totalCount} ítem${totalCount !== 1 ? 's' : ''} · ${now}</div>
      </div>
      <div class="enc-meta">
        <span><strong>${modeLabel}</strong></span>
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

// ══════════════════════════════════════════════════
// TEXTO WHATSAPP
// ══════════════════════════════════════════════════
export function generateEncargadaWhatsApp(bookings, rangeLabel, includeAmounts) {
  const now = new Date().toLocaleDateString('es-AR');
  const lines = [];

  if (!includeAmounts) {
    // ── Modo limpieza ──
    const groups = buildCleaningGroups(bookings);

    groups.forEach((items, date) => {
      const dayLabel = fmtWithDay(date);
      if (lines.length > 0) lines.push(`──────────────────────`);
      if (items.length > 1) {
        lines.push(`📅 *${dayLabel}* · ${items.length} departamentos`);
      }
      items.forEach(({ b, bu, nights, recambio }) => {
        const { num, rest } = unitLabelWA(bu);
        const recLabel = recambio ? ' ⚠️ *RECAMBIO*' : '';
        if (items.length > 1) lines.push(``);
        lines.push(
          `🧹 *Limpieza ${dayLabel}*`,
          `- Apart. N°: *${num}* _${rest}_${recLabel}`,
          `- _Estuvieron ${nights} noche${nights !== 1 ? 's' : ''}_`,
          `- _NOTA:_`,
        );
      });
    });
  } else {
    // ── Modo reservas ──
    const blocks = buildReservaBlocks(bookings);
    blocks.forEach(({ b, name, phone, age, car, units, nights, pax, balance, notes }, i) => {
      // Unidades: número en negrita, nombre en cursiva
      const unitsText = units.map(bu => {
        const { num, rest } = unitLabelWA(bu);
        return `*${num}* _${rest}_`;
      }).join(' / ') || '—';

      // Badge _(cliente)_ si el huésped ya tenía reservas previas
      const isReturning = (b.guests?.bookings_count ?? b._guestBookingsCount ?? 0) > 1
        || b.guests?.is_returning === true;
      const clienteTag = isReturning ? ' _(cliente)_' : '';

      if (i > 0) lines.push(`──────────────────────`);
      lines.push(
        `*Nueva Reserva* 🧾`,
        ``,
        `- Apellido y Nombre: *${name}*${clienteTag}`,
        `- Contacto: ${phone}`,
        `- Apart. N°: ${unitsText}`,
        `- Fecha Ingreso: ${fmtShort(b.check_in)}`,
        `- Fecha Salida: ${fmtShort(b.check_out)} _(${nights} ${nights !== 1 ? 'noches' : 'noche'})_`,
        `- Cant. de Personas: ${pax !== '' ? String(pax) : '—'}`,
        age ? `- Edad: ${age}` : null,
        car ? `- Auto: ${car}` : null,
        balance > 0 ? `- Abonan al ingreso: *${fmtMoney(balance)}*` : null,
        `- Nota: ${notes || '—'}`,
      );
    });
  }

  return lines.filter(l => l !== null).join('\n');
}
