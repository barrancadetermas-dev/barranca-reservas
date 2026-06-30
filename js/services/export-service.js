// ═══════════════════════════════════════════════════
// export-service.js — Exportación MILA PMS
// Excel/CSV/PDF con diseño + dropdowns de filtro
// ═══════════════════════════════════════════════════

import { getUnitLabel, SOURCE_CONFIG, showToast, AppContext } from '../supabase-config.js';
import { can, isDemo } from '../auth/permissions.js';

const STATUS_LABELS = {
  pending:'Sin seña', partial:'Con seña', paid:'Pagado',
  cancelled:'Cancelada', blocked:'Bloqueada',
};
const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const BRAND = { primary:'#1A3A90', light:'#DDEAFF', text:'#1e293b', gray:'#64748b', border:'#e2e8f0' };
const fmt = n => '$' + Math.round(n ?? 0).toLocaleString('es-AR');
const fmtDate = s => s ? s.split('-').reverse().join('/') : '';
const dateTag = () => new Date().toISOString().slice(0,10);

// ══════════════════════════════════════════════════
// DROPDOWN HELPER — muestra panel de filtros
// ══════════════════════════════════════════════════
export function showExportDropdown({ anchorEl, type, data, onExport }) {
  document.getElementById('_mila-export-dd')?.remove();

  const dd = document.createElement('div');
  dd.id = '_mila-export-dd';
  const rect = anchorEl.getBoundingClientRect();

  const now   = new Date();
  const y     = now.getFullYear();
  const m     = String(now.getMonth()+1).padStart(2,'0');
  const first = `${y}-${m}-01`;
  const last  = new Date(y, now.getMonth()+1, 0);
  const lastS = `${y}-${m}-${String(last.getDate()).padStart(2,'0')}`;

  const units = AppContext?.units ?? [];

  let innerHtml = '';

  if (type === 'bookings') {
    innerHtml = `
      <div class="_mila-dd-title">Exportar Reservas</div>
      <label class="_mila-dd-label">Rango de fechas (check-in)</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="date" id="_exp-from" value="${first}" class="_mila-dd-input">
        <span style="color:#94a3b8;font-size:.8rem">→</span>
        <input type="date" id="_exp-to" value="${lastS}" class="_mila-dd-input">
      </div>
      <div style="display:flex;gap:6px;margin-top:10px">
        <button class="_mila-dd-btn _mila-dd-btn-outline" data-fmt="csv">📋 CSV</button>
        <button class="_mila-dd-btn _mila-dd-btn-outline" data-fmt="excel">📊 Excel</button>
        <button class="_mila-dd-btn _mila-dd-btn-primary" data-fmt="pdf">📄 PDF</button>
      </div>`;
  } else if (type === 'guests') {
    const unitOpts = units.map(u =>
      `<option value="${u.id}">${u.name}</option>`).join('');
    innerHtml = `
      <div class="_mila-dd-title">Exportar Huéspedes</div>
      <label class="_mila-dd-label">Rango de fechas</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="date" id="_exp-from" value="${first}" class="_mila-dd-input">
        <span style="color:#94a3b8;font-size:.8rem">→</span>
        <input type="date" id="_exp-to" value="${lastS}" class="_mila-dd-input">
      </div>
      <label class="_mila-dd-label" style="margin-top:8px">Departamentos <span style="color:#94a3b8">(vacío = todos)</span></label>
      <select id="_exp-units" multiple class="_mila-dd-select" style="height:72px">
        ${unitOpts}
      </select>
      <div style="display:flex;gap:6px;margin-top:10px">
        <button class="_mila-dd-btn _mila-dd-btn-outline" data-fmt="csv">📋 CSV</button>
        <button class="_mila-dd-btn _mila-dd-btn-outline" data-fmt="excel">📊 Excel</button>
        <button class="_mila-dd-btn _mila-dd-btn-primary" data-fmt="pdf">📄 PDF</button>
      </div>`;
  } else if (type === 'stats') {
    innerHtml = `
      <div class="_mila-dd-title">Exportar Estadísticas</div>
      <label class="_mila-dd-label">Rango de fechas</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="date" id="_exp-from" value="${first}" class="_mila-dd-input">
        <span style="color:#94a3b8;font-size:.8rem">→</span>
        <input type="date" id="_exp-to" value="${lastS}" class="_mila-dd-input">
      </div>
      <div style="display:flex;gap:6px;margin-top:10px">
        <button class="_mila-dd-btn _mila-dd-btn-primary" data-fmt="pdf" style="flex:1">📄 Exportar PDF</button>
      </div>`;
  }

  dd.innerHTML = `
    <style>
      #_mila-export-dd{position:fixed;z-index:9999;background:#fff;border:1px solid ${BRAND.border};border-radius:12px;padding:14px 16px;box-shadow:0 8px 32px rgba(0,0,0,.14);min-width:280px;max-width:320px;font-family:system-ui,sans-serif}
      ._mila-dd-title{font-size:.8rem;font-weight:700;color:${BRAND.text};margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid ${BRAND.border}}
      ._mila-dd-label{display:block;font-size:.68rem;font-weight:600;color:${BRAND.gray};text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
      ._mila-dd-input{flex:1;padding:5px 8px;border:1px solid ${BRAND.border};border-radius:7px;font-size:.75rem;color:${BRAND.text};background:#fff;min-width:0}
      ._mila-dd-select{width:100%;padding:4px 6px;border:1px solid ${BRAND.border};border-radius:7px;font-size:.75rem;color:${BRAND.text};background:#fff}
      ._mila-dd-btn{flex:1;padding:7px 10px;border-radius:8px;font-size:.75rem;font-weight:600;cursor:pointer;border:none;transition:all .15s}
      ._mila-dd-btn-outline{background:#f8fafc;border:1px solid ${BRAND.border}!important;color:${BRAND.text}}
      ._mila-dd-btn-outline:hover{background:${BRAND.light};border-color:${BRAND.primary}!important;color:${BRAND.primary}}
      ._mila-dd-btn-primary{background:${BRAND.primary};color:#fff}
      ._mila-dd-btn-primary:hover{opacity:.88}
    </style>
    ${innerHtml}`;

  dd.style.top  = `${rect.bottom + 6}px`;
  dd.style.left = `${Math.max(8, rect.right - 300)}px`;
  document.body.appendChild(dd);

  // Reposicionar si se sale del viewport por abajo
  requestAnimationFrame(() => {
    const ddRect = dd.getBoundingClientRect();
    if (ddRect.bottom > window.innerHeight - 12) {
      dd.style.top  = `${rect.top - ddRect.height - 6}px`;
    }
  });

  // Cerrar al click fuera
  const outside = e => { if (!dd.contains(e.target) && e.target !== anchorEl) { dd.remove(); document.removeEventListener('mousedown', outside); } };
  setTimeout(() => document.addEventListener('mousedown', outside), 0);

  // Botones de exportación
  dd.querySelectorAll('[data-fmt]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fmt_  = btn.dataset.fmt;
      const from  = document.getElementById('_exp-from')?.value ?? '';
      const to    = document.getElementById('_exp-to')?.value   ?? '';
      const selEl = document.getElementById('_exp-units');
      const unitIds = selEl ? [...selEl.selectedOptions].map(o => o.value) : [];

      let filtered = [...data];

      if (from && to) {
        filtered = filtered.filter(b => {
          const ci = b.check_in ?? '';
          return ci >= from && ci <= to;
        });
      }
      if (unitIds.length > 0) {
        filtered = filtered.filter(b =>
          (b.booking_units ?? []).some(bu => unitIds.includes(bu.unit_id))
        );
      }

      onExport({ fmt: fmt_, data: filtered, from, to });
      dd.remove();
      document.removeEventListener('mousedown', outside);
    });
  });
}

// ══════════════════════════════════════════════════
// EXPORTAR RESERVAS → CSV
// ══════════════════════════════════════════════════
export function exportBookingsCSV(bookings, filename = 'reservas') {
  if (isDemo()) { showToast('🎭 Exportación no disponible en modo demo', 'warning'); return; }
  if (!can('exportData')) { showToast('🔒 Sin permiso para exportar', 'warning'); return; }
  const headers = ['Huésped','DNI','Teléfono','Email','Unidades','Check-in','Check-out','Noches','Canal','Estado','Precio/noche','Total','Abonado','Saldo','Notas'];
  const rows = bookings.map(b => {
    const units = (b.booking_units ?? []).map(bu => getUnitLabel(bu.units ?? {})).join(' + ');
    return [
      b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : (b.block_reason ?? 'Bloqueo'),
      b.guests?.dni ?? '', b.guests?.phone ?? '', b.guests?.email ?? '',
      units, b.check_in ?? '', b.check_out ?? '', b.nights ?? '',
      SOURCE_CONFIG[b.source ?? 'direct']?.label ?? 'Directo',
      STATUS_LABELS[b.status] ?? b.status,
      b.price_per_night ?? '', b.total_amount ?? '', b.total_paid ?? '', b.balance ?? '',
      (b.notes ?? '').replace(/\n/g,' '),
    ];
  });
  _download(_toCSV(headers, rows), `${filename}_${dateTag()}.csv`);
  showToast(`✓ Exportado: ${bookings.length} reservas`, 'success');
}

// ══════════════════════════════════════════════════
// EXPORTAR RESERVAS → EXCEL con diseño
// ══════════════════════════════════════════════════
export async function exportBookingsExcel(bookings, filename = 'reservas', range = '') {
  if (isDemo()) { showToast('🎭 Exportación no disponible en modo demo', 'warning'); return; }
  if (!can('exportData')) { showToast('🔒 Sin permiso para exportar', 'warning'); return; }
  if (!bookings?.length) { showToast('Sin reservas para exportar', 'warning'); return; }

  try {
    if (!window.XLSX) await _loadSheetJS();
    const XLSX = window.XLSX;

    // ── Construir filas de datos ──
    const dataRows = bookings.map(b => {
      const g = b.guests;
      return [
        g ? `${g.first_name} ${g.last_name}` : (b.block_reason ?? 'Bloqueo'),
        g?.dni ?? '', g?.phone ?? '', g?.email ?? '',
        (b.booking_units ?? []).map(bu => bu.units?.name ?? '').join(' + '),
        b.check_in  ?? '', b.check_out ?? '', b.nights ?? '',
        SOURCE_CONFIG[b.source ?? 'direct']?.label ?? 'Directo',
        STATUS_LABELS[b.status] ?? b.status,
        b.price_per_night ?? 0, b.total_amount ?? 0, b.total_paid ?? 0, b.balance ?? 0,
        (b.notes ?? '').replace(/\n/g,' '),
      ];
    });

    const headers = ['Huésped','DNI','Teléfono','Email','Unidades','Check-in','Check-out','Noches','Canal','Estado','Precio/noche','Total','Abonado','Saldo','Notas'];

    // Fila 1: título (merged visual via valor largo)
    const now    = new Date();
    const title  = `MILA PMS · Reservas${range ? ' · ' + range : ''} · ${now.toLocaleDateString('es-AR')}`;
    const ws     = XLSX.utils.aoa_to_sheet([[title], [''], headers, ...dataRows]);

    // Estilos (requiere XLSX Pro o workaround via cell styles — usamos comentarios de celda para notas)
    const boldBlue = { font:{ bold:true, color:{ rgb:'FFFFFF' } }, fill:{ fgColor:{ rgb:'1A3A90' } }, alignment:{ horizontal:'center' } };
    const hdrStyle = { font:{ bold:true, color:{ rgb:'FFFFFF' }, sz:10 }, fill:{ fgColor:{ rgb:'1A3A90' } }, alignment:{ horizontal:'center' } };
    const titleStyle = { font:{ bold:true, sz:14, color:{ rgb:'1A3A90' } }, alignment:{ horizontal:'left' } };
    const evenRow  = { fill:{ fgColor:{ rgb:'F0F4FA' } } };

    // Aplicar estilos a header row (fila 3 = index 2)
    headers.forEach((_, ci) => {
      const ref = XLSX.utils.encode_cell({ r:2, c:ci });
      if (!ws[ref]) ws[ref] = {};
      ws[ref].s = hdrStyle;
    });
    // Título
    if (ws['A1']) ws['A1'].s = titleStyle;
    // Filas de datos — alternar color
    dataRows.forEach((_, ri) => {
      if (ri % 2 === 1) {
        headers.forEach((__, ci) => {
          const ref = XLSX.utils.encode_cell({ r:ri+3, c:ci });
          if (ws[ref]) ws[ref].s = evenRow;
        });
      }
    });

    // Merge del título
    ws['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:headers.length-1} }];
    // Anchos de columna
    ws['!cols'] = [22,12,14,22,18,11,11,7,12,10,13,12,12,12,28].map(w => ({ wch:w }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reservas');
    XLSX.writeFile(wb, `${filename}_${dateTag()}.xlsx`);
    showToast(`✓ Excel exportado: ${bookings.length} reservas`, 'success');
  } catch (err) {
    console.error('[Export] Excel error:', err);
    exportBookingsCSV(bookings, filename);
    showToast('Exportado como CSV (fallback)', 'warning');
  }
}

// ══════════════════════════════════════════════════
// EXPORTAR RESERVAS → PDF con diseño
// ══════════════════════════════════════════════════
export function exportBookingsPDF(bookings, range = '') {
  if (isDemo()) { showToast('🎭 Exportación no disponible en modo demo', 'warning'); return; }
  if (!can('exportData')) { showToast('🔒 Sin permiso para exportar', 'warning'); return; }

  const now   = new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' });
  const total = bookings.reduce((s,b) => s + (b.total_amount ?? 0), 0);
  const cobr  = bookings.reduce((s,b) => s + (b.total_paid  ?? 0), 0);

  const statusDot = s => {
    const colors = { pending:'#f59e0b', partial:'#3b82f6', paid:'#16a34a', cancelled:'#ef4444', blocked:'#94a3b8' };
    return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colors[s]??'#94a3b8'};margin-right:5px;vertical-align:middle"></span>`;
  };

  const rows = bookings.map((b, i) => {
    const g    = b.guests;
    const name = g ? `${g.first_name} ${g.last_name}` : (b.block_reason ?? 'Bloqueo');
    const unit = (b.booking_units ?? []).map(bu => bu.units?.name ?? '').join(', ');
    return `<tr style="background:${i%2===0?'#fff':'#f8fafc'}">
      <td>${name}</td>
      <td>${unit}</td>
      <td>${fmtDate(b.check_in)}</td>
      <td>${fmtDate(b.check_out)}</td>
      <td style="text-align:center">${b.nights ?? ''}</td>
      <td style="text-align:right;font-weight:600">${fmt(b.total_amount)}</td>
      <td style="text-align:right;color:#16a34a">${fmt(b.total_paid)}</td>
      <td>${statusDot(b.status)}${STATUS_LABELS[b.status] ?? b.status}</td>
    </tr>`;
  }).join('');

  const w = window.open('', '_blank');
  if (!w) { showToast('Permita ventanas emergentes para exportar PDF', 'warning'); return; }
  w.document.write(`<!DOCTYPE html><html lang="es"><head>
    <meta charset="utf-8"><title>MILA · Reservas</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;background:#fff;padding:32px}
      .header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #1A3A90;padding-bottom:16px;margin-bottom:20px}
      .logo-wrap{display:flex;align-items:center;gap:12px}
      .logo-box{width:42px;height:42px;border-radius:10px;background:#1A3A90;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:20px}
      .logo-name{font-size:18px;font-weight:800;color:#1A3A90;letter-spacing:-.02em}
      .logo-sub{font-size:10px;color:#64748b;font-weight:500;margin-top:1px}
      .meta{text-align:right;font-size:11px;color:#64748b;line-height:1.5}
      .summary{display:flex;gap:12px;margin-bottom:20px}
      .kpi{flex:1;background:#f0f4fa;border-radius:10px;padding:12px 14px;border-left:4px solid}
      .kpi-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:4px}
      .kpi-val{font-size:16px;font-weight:800}
      table{width:100%;border-collapse:collapse;font-size:11px}
      thead tr{background:#1A3A90;color:#fff}
      th{padding:8px 10px;text-align:left;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
      td{padding:7px 10px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
      .no-print{display:block;margin-bottom:16px}
      .print-btn{padding:8px 18px;background:#1A3A90;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}
      @media print{.no-print{display:none}body{padding:16px}}
    </style>
  </head><body>
    <div class="header">
      <div class="logo-wrap">
        <div class="logo-box">M</div>
        <div><div class="logo-name">MILA</div><div class="logo-sub">Sistema Inteligente para Alojamientos</div></div>
      </div>
      <div class="meta">
        <div><strong>Listado de Reservas</strong>${range ? ' · ' + range : ''}</div>
        <div>Generado: ${now}</div>
        <div>${bookings.length} reserva${bookings.length!==1?'s':''}</div>
      </div>
    </div>
    <div class="summary">
      <div class="kpi" style="border-color:#1A3A90"><div class="kpi-lbl">Total reservas</div><div class="kpi-val" style="color:#1A3A90">${bookings.length}</div></div>
      <div class="kpi" style="border-color:#1A3A90"><div class="kpi-lbl">Total vendido</div><div class="kpi-val" style="color:#1A3A90">${fmt(total)}</div></div>
      <div class="kpi" style="border-color:#16a34a"><div class="kpi-lbl">Total cobrado</div><div class="kpi-val" style="color:#16a34a">${fmt(cobr)}</div></div>
      <div class="kpi" style="border-color:#f59e0b"><div class="kpi-lbl">Pendiente</div><div class="kpi-val" style="color:#f59e0b">${fmt(total-cobr)}</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Huésped</th><th>Unidad</th><th>Check-in</th><th>Check-out</th>
        <th style="text-align:center">Noches</th><th style="text-align:right">Total</th>
        <th style="text-align:right">Cobrado</th><th>Estado</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="no-print" style="margin-top:20px">
      <button class="print-btn" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>
    </div>
  </body></html>`);
  w.document.close();
}

// ══════════════════════════════════════════════════
// EXPORTAR ESTADÍSTICAS → PDF con diseño
// ══════════════════════════════════════════════════
export function exportStatsPDF({ stats, expenses, from, to } = {}) {
  if (isDemo()) { showToast('🎭 Exportación no disponible en modo demo', 'warning'); return; }
  if (!can('exportData')) { showToast('🔒 Sin permiso para exportar', 'warning'); return; }

  const now     = new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' });
  const range   = (from && to) ? `${fmtDate(from)} → ${fmtDate(to)}` : 'Período seleccionado';
  const totalRev= (stats ?? []).reduce((s,u) => s + (u.revenue ?? 0), 0);
  const totalExp= (expenses ?? []).reduce((s,e) => s + (e.paid ? e.amount : 0), 0);

  const unitRows = (stats ?? []).map((u, i) =>
    `<tr style="background:${i%2===0?'#fff':'#f8fafc'}">
      <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${u.unit?.color??'#1A3A90'};margin-right:6px;vertical-align:middle"></span>${u.unit?.name ?? '—'}</td>
      <td style="text-align:center">${u.bookingCount ?? 0}</td>
      <td style="text-align:center">${u.nightsOcc ?? 0}</td>
      <td style="text-align:center">${u.occupancyPct ?? 0}%</td>
      <td style="text-align:right;font-weight:700;color:#1A3A90">${fmt(u.revenue)}</td>
    </tr>`
  ).join('');

  const expRows = (expenses ?? []).map((e, i) =>
    `<tr style="background:${i%2===0?'#fff':'#f8fafc'}">
      <td>${e.category ?? '—'}</td><td>${e.description ?? '—'}</td>
      <td style="text-align:right;color:${e.paid?'#16a34a':'#f59e0b'}">${fmt(e.amount)}</td>
      <td style="text-align:center">${e.paid?'✓ Pagado':'Pendiente'}</td>
    </tr>`
  ).join('');

  const w = window.open('', '_blank');
  if (!w) { showToast('Permita ventanas emergentes para exportar PDF', 'warning'); return; }
  w.document.write(`<!DOCTYPE html><html lang="es"><head>
    <meta charset="utf-8"><title>MILA · Estadísticas</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;background:#fff;padding:32px}
      .header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #1A3A90;padding-bottom:16px;margin-bottom:20px}
      .logo-box{width:42px;height:42px;border-radius:10px;background:#1A3A90;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:20px}
      .logo-name{font-size:18px;font-weight:800;color:#1A3A90}
      .logo-sub{font-size:10px;color:#64748b;margin-top:1px}
      .meta{text-align:right;font-size:11px;color:#64748b;line-height:1.5}
      .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#1A3A90;margin:20px 0 8px;padding-bottom:4px;border-bottom:1px solid #ddeaff}
      .summary{display:flex;gap:12px;margin-bottom:8px}
      .kpi{flex:1;background:#f0f4fa;border-radius:10px;padding:12px 14px;border-left:4px solid}
      .kpi-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:4px}
      .kpi-val{font-size:15px;font-weight:800}
      table{width:100%;border-collapse:collapse;font-size:11px}
      thead tr{background:#1A3A90;color:#fff}
      th{padding:8px 10px;text-align:left;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
      td{padding:7px 10px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
      .print-btn{padding:8px 18px;background:#1A3A90;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-top:20px}
      @media print{.no-print{display:none}body{padding:16px}}
    </style>
  </head><body>
    <div class="header">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="logo-box">M</div>
        <div><div class="logo-name">MILA</div><div class="logo-sub">Sistema Inteligente para Alojamientos</div></div>
      </div>
      <div class="meta"><div><strong>Reporte de Estadísticas</strong></div><div>${range}</div><div>Generado: ${now}</div></div>
    </div>
    <div class="summary">
      <div class="kpi" style="border-color:#1A3A90"><div class="kpi-lbl">Ingresos brutos</div><div class="kpi-val" style="color:#1A3A90">${fmt(totalRev)}</div></div>
      <div class="kpi" style="border-color:#ef4444"><div class="kpi-lbl">Gastos pagados</div><div class="kpi-val" style="color:#ef4444">${fmt(totalExp)}</div></div>
      <div class="kpi" style="border-color:#16a34a"><div class="kpi-lbl">Resultado neto</div><div class="kpi-val" style="color:#16a34a">${fmt(totalRev-totalExp)}</div></div>
    </div>
    <div class="section-title">Ingresos por departamento</div>
    <table>
      <thead><tr><th>Departamento</th><th style="text-align:center">Reservas</th><th style="text-align:center">Noches</th><th style="text-align:center">Ocupación</th><th style="text-align:right">Ingresos</th></tr></thead>
      <tbody>${unitRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">Sin datos para el período</td></tr>'}</tbody>
    </table>
    ${expRows ? `<div class="section-title">Gastos operativos</div>
    <table>
      <thead><tr><th>Categoría</th><th>Descripción</th><th style="text-align:right">Monto</th><th style="text-align:center">Estado</th></tr></thead>
      <tbody>${expRows}</tbody>
    </table>` : ''}
    <div class="no-print">
      <button class="print-btn" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>
    </div>
  </body></html>`);
  w.document.close();
}

// ══════════════════════════════════════════════════
// P&L → CSV (sin cambios)
// ══════════════════════════════════════════════════
export function exportPLCSV(stats, expenses, commissions, month, year) {
  if (isDemo()) { showToast('🎭 Exportación no disponible en modo demo', 'warning'); return; }
  if (!can('exportData')) { showToast('🔒 Sin permiso para exportar', 'warning'); return; }
  const period  = `${MONTH_NAMES[month]} ${year}`;
  const totalRev= stats.reduce((s,u) => s + u.revenue, 0);
  const totalExp= expenses.reduce((s,e) => s + (e.paid ? e.amount : 0), 0);
  const net     = totalRev - totalExp;
  const headers = ['Descripción','Monto (ARS)'];
  const rows = [
    [`── INGRESOS POR UNIDAD — ${period} ──`,''],
    ...stats.map(s => [getUnitLabel(s.unit), `${s.nightsOcc} noches · ${s.bookingCount} reservas · $${s.revenue.toLocaleString('es-AR')} · ${s.occupancyPct}%`]),
    ['',''],['TOTAL INGRESOS BRUTOS', totalRev],['',''],
    [`── GASTOS OPERATIVOS ──`,''],
    ...expenses.map(e => [`${e.category} · ${e.description}${e.paid?' (pagado)':' (pendiente)'}`, e.amount]),
    ['',''],['TOTAL GASTOS (pagados)', totalExp],['',''],['══ RESULTADO NETO ══', net],
  ];
  _download(_toCSV(headers, rows), `pyl_${period.replace(' ','_')}_${dateTag()}.csv`);
  showToast(`✓ P&L exportado: ${period}`, 'success');
}

export function exportPaymentsCSV(payments, filename = 'pagos') {
  if (!can('exportData')) { showToast('🔒 Sin permiso para exportar', 'warning'); return; }
  const headers = ['Reserva ID','Método','Monto','Moneda','Cotización','Total ARS','Fecha','Notas'];
  const rows = payments.map(p => [p.booking_id??'',p.method??'',p.amount??'',p.currency??'ARS',p.exchange_rate??'',p.amount_ars??'',p.paid_at?p.paid_at.slice(0,10):'',p.notes??'']);
  _download(_toCSV(headers, rows), `${filename}_${dateTag()}.csv`);
  showToast(`✓ Exportado: ${payments.length} pagos`, 'success');
}

// ══════════════════════════════════════════════════
// VOUCHER PDF — comprobante de reserva para el huésped
// ══════════════════════════════════════════════════
export function exportGuestVoucher(guest, booking) {
  if (isDemo()) { showToast('🎭 No disponible en modo demo', 'warning'); return; }

  const fmtMoney = n => '$' + Math.round(n ?? 0).toLocaleString('es-AR');
  const fmtDate  = s => s ? s.split('-').reverse().join('/') : '—';
  const fmtLong  = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long', year:'numeric' }) : '—';
  const genDate  = new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' });

  const guestName = `${guest.first_name ?? ''} ${guest.last_name ?? ''}`.trim();
  const units     = (booking.booking_units ?? []).map(bu => bu.units).filter(Boolean);
  const pax       = (booking.adults ?? 1) + (booking.children ?? 0);
  const balance   = booking.balance ?? Math.max(0, (booking.total_amount ?? 0) - (booking.total_paid ?? 0));
  const sourceLbl = SOURCE_CONFIG[booking.source ?? 'direct']?.label ?? 'Directo';
  const statusLbl = STATUS_LABELS[booking.status] ?? booking.status;

  // Etiquetas de método de pago (mismo set que booking-form.js)
  const PAY_METHOD_LABELS = {
    cash: 'Efectivo', transfer: 'Transferencia', mercadopago: 'MercadoPago',
    naranjax: 'Naranja X', uala: 'Ualá', credit_card: 'Tarjeta de Crédito',
    debit_card: 'Tarjeta de Débito', credit_note: 'Nota de Crédito / Voucher',
  };
  const payments = (booking.payments ?? []).slice().sort((a,b) => (a.payment_date ?? '').localeCompare(b.payment_date ?? ''));

  const unitChips = units.map(u =>
    `<span style="display:inline-flex;align-items:center;gap:4px;background:${u.color ?? '#1A3A90'}18;border:1.5px solid ${u.color ?? '#1A3A90'};color:${u.color ?? '#1A3A90'};padding:4px 9px;border-radius:7px;font-weight:700;font-size:11px;margin:2px;white-space:nowrap">
      <span style="width:6px;height:6px;border-radius:50%;background:${u.color ?? '#1A3A90'};flex-shrink:0"></span>${u.name}
    </span>`
  ).join('');

  const w = window.open('', '_blank');
  if (!w) { showToast('Permití ventanas emergentes para descargar el voucher', 'warning'); return; }

  w.document.write(`<!DOCTYPE html><html lang="es"><head>
    <meta charset="utf-8"><title>Voucher · ${guestName}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;background:#f0f4fa;padding:28px}
      .voucher{max-width:620px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 10px 40px rgba(26,58,144,.12)}
      .v-header{background:linear-gradient(135deg,#1A3A90,#1E4DB7);padding:28px 32px;color:#fff;display:flex;align-items:center;justify-content:space-between}
      .v-logo{display:flex;align-items:center;gap:12px}
      .v-logo-box{width:46px;height:46px;border-radius:11px;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden}
      .v-logo-box img{width:100%;height:100%;object-fit:cover;border-radius:11px}
      .v-logo-name{font-size:19px;font-weight:800;letter-spacing:-.02em}
      .v-logo-sub{font-size:10px;color:rgba(255,255,255,.75);margin-top:1px}
      .v-title{text-align:center;padding:20px 32px 4px;font-size:15px;font-weight:700;color:#1A3A90;letter-spacing:.02em}
      .v-sub{text-align:center;font-size:11px;color:#94a3b8;padding-bottom:18px}
      .v-body{padding:0 32px 28px}
      .v-section{margin-bottom:18px}
      .v-section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#1A3A90;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #eef2ff}
      .v-row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px dashed #f1f5f9}
      .v-row:last-child{border-bottom:none}
      .v-row-label{color:#64748b}
      .v-row-val{font-weight:700;color:#1e293b}
      .v-dates{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;background:#f8fafc;border-radius:12px;padding:16px 18px;margin-bottom:14px}
      .v-date-block{text-align:center}
      .v-date-label{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:4px}
      .v-date-val{font-size:14px;font-weight:800;color:#1A3A90}
      .v-date-sub{font-size:10px;color:#64748b;margin-top:2px;text-transform:capitalize}
      .v-arrow{color:#cbd5e1;font-size:18px}
      .v-nights-badge{text-align:center;font-size:11px;font-weight:700;color:#fff;background:#1A3A90;border-radius:999px;padding:3px 12px;display:inline-block;margin:0 auto 14px;width:fit-content}
      .v-nights-wrap{display:flex;justify-content:center;margin-bottom:14px}
      .v-balance{border-radius:14px;padding:18px 20px;display:flex;justify-content:space-between;align-items:center;margin-top:8px}
      .v-balance.pend{background:#fff7ed;border:2px solid #fed7aa}
      .v-balance.ok{background:#f0fdf4;border:2px solid #bbf7d0}
      .v-balance-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
      .v-balance.pend .v-balance-label{color:#c2410c}
      .v-balance.ok .v-balance-label{color:#15803d}
      .v-balance-val{font-size:22px;font-weight:900}
      .v-balance.pend .v-balance-val{color:#ea580c}
      .v-balance.ok .v-balance-val{color:#16a34a}
      .v-footer{text-align:center;padding:20px 32px;background:#f8fafc;border-top:1px solid #eef2ff}
      .v-footer-msg{font-size:14px;font-weight:700;color:#1A3A90;margin-bottom:8px}
      .v-footer-addr{font-size:11px;color:#64748b;margin-bottom:6px}
      .v-footer-social{font-size:11px;color:#475569;font-weight:600;margin-bottom:12px}
      .v-footer-disclaimer{font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:.03em;padding-top:10px;border-top:1px dashed #fecaca}
      .no-print{text-align:center;margin-top:18px}
      .print-btn{padding:10px 24px;background:#1A3A90;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer}
      @media print{.no-print{display:none}body{background:#fff;padding:0}.voucher{box-shadow:none;border-radius:0;max-width:100%}}
    </style>
  </head><body>
    <div class="voucher">
      <div class="v-header">
        <div class="v-logo">
          <div class="v-logo-box">
            <img src="/icon-192.png" alt="MILA" onerror="this.style.display='none';this.parentElement.innerHTML='<span style=\\'font-weight:900;font-size:22px;color:#1A3A90\\'>M</span>'">
          </div>
          <div><div class="v-logo-name">MILA</div><div class="v-logo-sub">Barranca de Termas</div></div>
        </div>
      </div>

      <div class="v-title">Comprobante de Reserva</div>
      <div class="v-sub">Generado el ${genDate}</div>

      <div class="v-body">
        <div class="v-dates">
          <div class="v-date-block">
            <div class="v-date-label">Check-in</div>
            <div class="v-date-val">${fmtDate(booking.check_in)}</div>
            <div class="v-date-sub">${fmtLong(booking.check_in).split(',')[0]}</div>
          </div>
          <div class="v-arrow">→</div>
          <div class="v-date-block">
            <div class="v-date-label">Check-out</div>
            <div class="v-date-val">${fmtDate(booking.check_out)}</div>
            <div class="v-date-sub">${fmtLong(booking.check_out).split(',')[0]}</div>
          </div>
        </div>

        <div class="v-nights-wrap">
          <span class="v-nights-badge">${booking.nights ?? '—'} noche${(booking.nights ?? 0) !== 1 ? 's' : ''}</span>
        </div>

        <div class="v-section">
          <div class="v-section-title">Huésped</div>
          <div class="v-row"><span class="v-row-label">Nombre</span><span class="v-row-val">${guestName}</span></div>
          ${guest.dni   ? `<div class="v-row"><span class="v-row-label">DNI</span><span class="v-row-val">${guest.dni}</span></div>` : ''}
          ${guest.phone ? `<div class="v-row"><span class="v-row-label">Teléfono</span><span class="v-row-val">${guest.phone}</span></div>` : ''}
          ${guest.email ? `<div class="v-row"><span class="v-row-label">Email</span><span class="v-row-val">${guest.email}</span></div>` : ''}
          <div class="v-row"><span class="v-row-label">Personas</span><span class="v-row-val">${pax}</span></div>
        </div>

        <div class="v-section">
          <div class="v-section-title">Alojamiento</div>
          <div style="margin-bottom:8px">${unitChips}</div>
          <div class="v-row"><span class="v-row-label">Canal de reserva</span><span class="v-row-val">${sourceLbl}</span></div>
          <div class="v-row"><span class="v-row-label">Estado</span><span class="v-row-val">${statusLbl}</span></div>
        </div>

        <div class="v-section">
          <div class="v-section-title">Resumen de pago</div>
          <div class="v-row"><span class="v-row-label">Total de la estadía</span><span class="v-row-val">${fmtMoney(booking.total_amount)}</span></div>
          ${payments.length > 0
            ? payments.map(p =>
                '<div class="v-row"><span class="v-row-label">Abonado</span><span class="v-row-val" style="color:#16a34a">' +
                  fmtMoney(p.amount) + ' (' + (PAY_METHOD_LABELS[p.method] ?? p.method ?? '—') + ') · ' + fmtDate(p.payment_date) +
                '</span></div>'
              ).join('')
            : (booking.total_paid > 0
                ? '<div class="v-row"><span class="v-row-label">Abonado</span><span class="v-row-val" style="color:#16a34a">' + fmtMoney(booking.total_paid) + '</span></div>'
                : '')
          }
        </div>

        <div class="v-balance ${balance > 0 ? 'pend' : 'ok'}">
          <span class="v-balance-label">${balance > 0 ? 'Saldo a abonar al ingreso' : '✓ Reserva saldada'}</span>
          <span class="v-balance-val">${balance > 0 ? fmtMoney(balance) + ' · ' + fmtDate(booking.check_in) : '—'}</span>
        </div>
      </div>

      <div class="v-footer">
        <div class="v-footer-msg">¡Te esperamos! 🏡</div>
        <div class="v-footer-addr">Barranca de Termas | San José (Colón) E.Ríos - Argentina</div>
        <div class="v-footer-social">📷 @barrancadetermas &nbsp;|&nbsp; 💬 +5492236848043</div>
        <div class="v-footer-disclaimer">⚠ Documento no válido como factura</div>
      </div>
    </div>

    <div class="no-print">
      <button class="print-btn" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>
    </div>
  </body></html>`);
  w.document.close();
}

// ── Internos ─────────────────────────────────────
async function _loadSheetJS() {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
function _toCSV(headers, rows) {
  const esc = v => `"${String(v??'').replace(/"/g,'""').replace(/\n/g,' ')}"`;
  return [headers,...rows].map(r => r.map(esc).join(',')).join('\r\n');
}
function _download(content, filename) {
  const blob = new Blob(['\uFEFF' + content], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href:url, download:filename });
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
