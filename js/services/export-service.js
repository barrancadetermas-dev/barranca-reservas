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
// ESTILO COMPARTIDO PARA EXCEL — título, header de color,
// filas alternadas (zebra), pie con totales, encabezado
// congelado (freeze panes) y autofiltro. Todas las
// exportaciones a Excel pasan por acá, para que se vean
// todas con el mismo diseño prolijo, en vez de listas
// simples sin formato.
// ══════════════════════════════════════════════════
const XSTY = {
  title:  { font:{ bold:true, sz:14, color:{ rgb:'1A3A90' } }, alignment:{ horizontal:'left', vertical:'center' } },
  subtitle: { font:{ italic:true, sz:9, color:{ rgb:'64748B' } } },
  header: {
    font:{ bold:true, color:{ rgb:'FFFFFF' }, sz:10 },
    fill:{ fgColor:{ rgb:'1A3A90' } },
    alignment:{ horizontal:'center', vertical:'center', wrapText:true },
    border:{ bottom:{ style:'thin', color:{ rgb:'FFFFFF' } } },
  },
  evenRow: { fill:{ fgColor:{ rgb:'F0F4FA' } } },
  footer: {
    font:{ bold:true, color:{ rgb:'1A3A90' }, sz:10 },
    fill:{ fgColor:{ rgb:'DDEAFF' } },
    border:{ top:{ style:'medium', color:{ rgb:'1A3A90' } } },
  },
};

/**
 * Aplica el "traje" completo a una hoja ya creada con aoa_to_sheet.
 * @param {object} ws       - la hoja (worksheet) de SheetJS
 * @param {object} XLSX     - referencia a la librería ya cargada
 * @param {object} opts
 *   titleRow    - índice de fila (0-based) del título general (o null si no hay)
 *   headerRow   - índice de fila (0-based) de los encabezados de columna
 *   dataStart   - índice de la primera fila de datos
 *   dataEnd     - índice de la última fila de datos (inclusive)
 *   numCols     - cantidad de columnas totales
 *   footerRow   - índice de fila del pie/totales (o null si no hay)
 *   colWidths   - array de anchos de columna (en caracteres)
 */
function _styleWorksheet(ws, XLSX, { titleRow = 0, headerRow, dataStart, dataEnd, numCols, footerRow = null, colWidths }) {
  const cell = (r, c) => XLSX.utils.encode_cell({ r, c });
  const setStyle = (r, c, style) => {
    const ref = cell(r, c);
    if (!ws[ref]) ws[ref] = { t:'s', v:'' };
    ws[ref].s = style;
  };

  if (titleRow != null && ws[cell(titleRow, 0)]) setStyle(titleRow, 0, XSTY.title);

  for (let c = 0; c < numCols; c++) setStyle(headerRow, c, XSTY.header);

  for (let r = dataStart; r <= dataEnd; r++) {
    if ((r - dataStart) % 2 === 1) {
      for (let c = 0; c < numCols; c++) {
        const ref = cell(r, c);
        if (ws[ref]) ws[ref].s = XSTY.evenRow;
      }
    }
  }

  if (footerRow != null) {
    for (let c = 0; c < numCols; c++) setStyle(footerRow, c, XSTY.footer);
  }

  // Encabezado siempre visible al scrollear, y autofiltro para poder
  // ordenar/filtrar cada columna sin tener que armarlo a mano.
  ws['!freeze'] = { xSplit: 0, ySplit: headerRow + 1 };
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s:{r:headerRow,c:0}, e:{r:dataEnd,c:numCols-1} }) };
  if (colWidths) ws['!cols'] = colWidths.map(w => ({ wch: w }));
}

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
  } else if (type === 'expenses') {
    innerHtml = `
      <div class="_mila-dd-title">Exportar Gastos</div>
      <label class="_mila-dd-label">Rango de fechas <span style="color:#94a3b8">(ej: todo el verano, un trimestre, lo que necesites)</span></label>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="date" id="_exp-from" value="${first}" class="_mila-dd-input">
        <span style="color:#94a3b8;font-size:.8rem">→</span>
        <input type="date" id="_exp-to" value="${lastS}" class="_mila-dd-input">
      </div>
      <div style="display:flex;gap:6px;margin-top:10px">
        <button class="_mila-dd-btn _mila-dd-btn-outline" data-fmt="csv">📋 CSV</button>
        <button class="_mila-dd-btn _mila-dd-btn-primary" data-fmt="excel">📊 Excel</button>
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
        const dateField = type === 'expenses' ? 'due_date' : 'check_in';
        filtered = filtered.filter(item => {
          const d = item[dateField] ?? '';
          return d >= from && d <= to;
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
    const numCols = headers.length;
    const now   = new Date();
    const title = `MILA PMS · Reservas${range ? ' · ' + range : ''} · Generado el ${now.toLocaleDateString('es-AR')}`;

    // Fila de totales al pie — antes esta exportación no sumaba nada
    const totalRow = new Array(numCols).fill('');
    totalRow[9]  = 'TOTALES →';
    totalRow[11] = bookings.reduce((s,b) => s + (b.total_amount ?? 0), 0);
    totalRow[12] = bookings.reduce((s,b) => s + (b.total_paid  ?? 0), 0);
    totalRow[13] = bookings.reduce((s,b) => s + (b.balance     ?? 0), 0);

    const HEADER_ROW = 2; // fila 0: título, fila 1: subtítulo, fila 2: headers
    const subtitle = `${bookings.length} reserva${bookings.length !== 1 ? 's' : ''} · Barranca de Termas`;
    const ws = XLSX.utils.aoa_to_sheet([[title], [subtitle], headers, ...dataRows, totalRow]);

    const dataStart = HEADER_ROW + 1;
    const dataEnd   = dataStart + dataRows.length - 1;
    const footerRow = dataEnd + 1;

    _styleWorksheet(ws, XLSX, {
      titleRow: 0, headerRow: HEADER_ROW, dataStart, dataEnd, footerRow, numCols,
      colWidths: [22,12,14,22,18,11,11,7,12,10,13,12,12,12,28],
    });
    if (ws['A2']) ws['A2'].s = XSTY.subtitle;

    // Formato moneda en las columnas de precio/total/abonado/saldo
    [10,11,12,13].forEach(c => {
      for (let r = dataStart; r <= footerRow; r++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '$#,##0';
      }
    });

    ws['!merges'] = [
      { s:{r:0,c:0}, e:{r:0,c:numCols-1} },
      { s:{r:1,c:0}, e:{r:1,c:numCols-1} },
    ];

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
// EXPORTAR GASTOS — para pasarle al contador, al dueño,
// o a quien haga falta un rango puntual (ej: "los gastos
// del verano" — elegís las fechas y listo)
// ══════════════════════════════════════════════════
function _capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

export function exportExpensesCSV(expenses, filename = 'gastos', range = '') {
  if (!can('exportData')) { showToast('🔒 Sin permiso para exportar', 'warning'); return; }
  const headers = ['Categoría','Descripción','Monto','Vencimiento','Pagado','Fecha de pago'];
  const rows = expenses.map(e => [
    _capitalize(e.category ?? ''), e.description ?? '', e.amount ?? 0,
    e.due_date ?? '', e.paid ? 'Sí' : 'No', e.paid_at ? e.paid_at.slice(0,10) : '',
  ]);
  const total = expenses.reduce((s, e) => s + (e.amount ?? 0), 0);
  rows.push(['', 'TOTAL', total, '', '', '']);
  _download(_toCSV(headers, rows), `${filename}_${range || dateTag()}.csv`);
  showToast(`✓ Exportado: ${expenses.length} gastos`, 'success');
}

export async function exportExpensesExcel(expenses, filename = 'gastos', range = '') {
  if (!can('exportData')) { showToast('🔒 Sin permiso para exportar', 'warning'); return; }
  if (!window.XLSX) await _loadSheetJS();
  const XLSX = window.XLSX;

  const headers = ['Categoría','Descripción','Monto','Vencimiento','Pagado','Fecha de pago'];
  const numCols = headers.length;
  const rows = expenses.map(e => [
    _capitalize(e.category ?? ''), e.description ?? '', e.amount ?? 0,
    e.due_date ?? '', e.paid ? 'Sí' : 'No', e.paid_at ? e.paid_at.slice(0,10) : '',
  ]);
  const total = expenses.reduce((s, e) => s + (e.amount ?? 0), 0);
  const totalRow = ['', 'TOTAL →', total, '', '', ''];

  const now = new Date();
  const title = `MILA PMS · Gastos${range ? ' · ' + range : ''} · Generado el ${now.toLocaleDateString('es-AR')}`;
  const subtitle = `${expenses.length} gasto${expenses.length !== 1 ? 's' : ''} · Barranca de Termas`;

  const HEADER_ROW = 2;
  const ws = XLSX.utils.aoa_to_sheet([[title], [subtitle], headers, ...rows, totalRow]);

  const dataStart = HEADER_ROW + 1;
  const dataEnd    = dataStart + rows.length - 1;
  const footerRow  = dataEnd + 1;

  _styleWorksheet(ws, XLSX, {
    titleRow: 0, headerRow: HEADER_ROW, dataStart, dataEnd, footerRow, numCols,
    colWidths: [16, 32, 13, 13, 9, 13],
  });
  if (ws['A2']) ws['A2'].s = XSTY.subtitle;

  for (let r = dataStart; r <= footerRow; r++) {
    const ref = XLSX.utils.encode_cell({ r, c: 2 });
    if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '$#,##0';
  }

  ws['!merges'] = [
    { s:{r:0,c:0}, e:{r:0,c:numCols-1} },
    { s:{r:1,c:0}, e:{r:1,c:numCols-1} },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Gastos');
  XLSX.writeFile(wb, `${filename}_${range || dateTag()}.xlsx`);
  showToast(`✓ Exportado: ${expenses.length} gastos`, 'success');
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

// ══════════════════════════════════════════════════
// BACKUP COMPLETO — Reservas + Huéspedes + Gastos en
// un solo Excel con 3 hojas. A diferencia del resto de
// las exportaciones de este archivo, esta consulta la
// base directo (no depende de que la pantalla ya tenga
// los datos cargados) — pensado como copia de seguridad
// manual, no como reporte de una vista puntual.
// ══════════════════════════════════════════════════
export async function exportFullBackup(db, hotelId) {
  if (isDemo()) { showToast('🎭 Exportación no disponible en modo demo', 'warning'); return; }
  if (!can('exportData')) { showToast('🔒 Sin permiso para exportar', 'warning'); return; }

  showToast('Preparando backup completo… puede tardar unos segundos', 'info');
  try {
    if (!window.XLSX) await _loadSheetJS();
    const XLSX = window.XLSX;

    const [{ data: bookings }, { data: guests }, { data: expenses }] = await Promise.all([
      db.from('bookings')
        .select('check_in, check_out, nights, status, source, price_per_night, total_amount, total_paid, balance, notes, created_at, guests(first_name,last_name,dni,phone,email), booking_units(units(name))')
        .eq('hotel_id', hotelId).order('check_in', { ascending: false }),
      db.from('guests')
        .select('first_name,last_name,dni,phone,email,locality,age,car_model,car_plate,nationality,created_at')
        .eq('hotel_id', hotelId).order('created_at', { ascending: false }),
      db.from('expenses')
        .select('category,description,amount,due_date,paid,paid_at,created_at')
        .eq('hotel_id', hotelId).order('due_date', { ascending: false }),
    ]);

    const wb = XLSX.utils.book_new();
    const now = new Date();
    const genLabel = `Generado el ${now.toLocaleDateString('es-AR')}`;

    // ── Hoja Reservas ──
    const bkHeaders = ['Huésped','DNI','Teléfono','Email','Unidades','Check-in','Check-out','Noches','Canal','Estado','Precio/noche','Total','Abonado','Saldo','Notas','Creada'];
    const bkNumCols = bkHeaders.length;
    const bkRows = (bookings ?? []).map(b => {
      const g = b.guests;
      return [
        g ? `${g.first_name} ${g.last_name}` : '—', g?.dni ?? '', g?.phone ?? '', g?.email ?? '',
        (b.booking_units ?? []).map(bu => bu.units?.name ?? '').join(' + '),
        b.check_in ?? '', b.check_out ?? '', b.nights ?? '',
        SOURCE_CONFIG[b.source ?? 'direct']?.label ?? 'Directo', STATUS_LABELS[b.status] ?? b.status,
        b.price_per_night ?? 0, b.total_amount ?? 0, b.total_paid ?? 0, b.balance ?? 0,
        (b.notes ?? '').replace(/\n/g, ' '), (b.created_at ?? '').slice(0, 10),
      ];
    });
    const bkTotalRow = new Array(bkNumCols).fill('');
    bkTotalRow[9] = 'TOTALES →';
    bkTotalRow[11] = bkRows.reduce((s,r) => s + (r[11] || 0), 0);
    bkTotalRow[12] = bkRows.reduce((s,r) => s + (r[12] || 0), 0);
    bkTotalRow[13] = bkRows.reduce((s,r) => s + (r[13] || 0), 0);

    const wsBk = XLSX.utils.aoa_to_sheet([
      [`MILA PMS · Reservas · ${genLabel}`],
      [`${bkRows.length} reserva${bkRows.length !== 1 ? 's' : ''} · Barranca de Termas`],
      bkHeaders, ...bkRows, bkTotalRow,
    ]);
    const bkDataStart = 3, bkDataEnd = bkDataStart + bkRows.length - 1, bkFooter = bkDataEnd + 1;
    _styleWorksheet(wsBk, XLSX, {
      titleRow: 0, headerRow: 2, dataStart: bkDataStart, dataEnd: bkDataEnd, footerRow: bkFooter, numCols: bkNumCols,
      colWidths: [20,12,14,22,18,11,11,7,12,10,13,12,12,12,28,11],
    });
    if (wsBk['A2']) wsBk['A2'].s = XSTY.subtitle;
    [10,11,12,13].forEach(c => {
      for (let r = bkDataStart; r <= bkFooter; r++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (wsBk[ref] && typeof wsBk[ref].v === 'number') wsBk[ref].z = '$#,##0';
      }
    });
    wsBk['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:bkNumCols-1} }, { s:{r:1,c:0}, e:{r:1,c:bkNumCols-1} }];
    XLSX.utils.book_append_sheet(wb, wsBk, 'Reservas');

    // ── Hoja Huéspedes ──
    const gHeaders = ['Nombre','Apellido','DNI','Teléfono','Email','Localidad','Edad','Auto','Patente','Nacionalidad','Alta'];
    const gNumCols = gHeaders.length;
    const gRows = (guests ?? []).map(g => [
      g.first_name ?? '', g.last_name ?? '', g.dni ?? '', g.phone ?? '', g.email ?? '',
      g.locality ?? '', g.age ?? '', g.car_model ?? '', g.car_plate ?? '', g.nationality ?? '',
      (g.created_at ?? '').slice(0, 10),
    ]);
    const wsG = XLSX.utils.aoa_to_sheet([
      [`MILA PMS · Huéspedes · ${genLabel}`],
      [`${gRows.length} huésped${gRows.length !== 1 ? 'es' : ''} · Barranca de Termas`],
      gHeaders, ...gRows,
    ]);
    const gDataStart = 3, gDataEnd = gDataStart + gRows.length - 1;
    _styleWorksheet(wsG, XLSX, {
      titleRow: 0, headerRow: 2, dataStart: gDataStart, dataEnd: gDataEnd, footerRow: null, numCols: gNumCols,
      colWidths: [16,16,12,14,22,18,7,18,10,14,11],
    });
    if (wsG['A2']) wsG['A2'].s = XSTY.subtitle;
    wsG['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:gNumCols-1} }, { s:{r:1,c:0}, e:{r:1,c:gNumCols-1} }];
    XLSX.utils.book_append_sheet(wb, wsG, 'Huéspedes');

    // ── Hoja Gastos ──
    const eHeaders = ['Categoría','Descripción','Monto','Vencimiento','Pagado','Fecha de pago','Creado'];
    const eNumCols = eHeaders.length;
    const eRows = (expenses ?? []).map(e => [
      e.category ?? '', e.description ?? '', e.amount ?? 0,
      e.due_date ?? '', e.paid ? 'Sí' : 'No', (e.paid_at ?? '').slice(0, 10), (e.created_at ?? '').slice(0, 10),
    ]);
    const eTotalRow = ['', 'TOTAL →', eRows.reduce((s,r) => s + (r[2] || 0), 0), '', '', '', ''];
    const wsE = XLSX.utils.aoa_to_sheet([
      [`MILA PMS · Gastos · ${genLabel}`],
      [`${eRows.length} gasto${eRows.length !== 1 ? 's' : ''} · Barranca de Termas`],
      eHeaders, ...eRows, eTotalRow,
    ]);
    const eDataStart = 3, eDataEnd = eDataStart + eRows.length - 1, eFooter = eDataEnd + 1;
    _styleWorksheet(wsE, XLSX, {
      titleRow: 0, headerRow: 2, dataStart: eDataStart, dataEnd: eDataEnd, footerRow: eFooter, numCols: eNumCols,
      colWidths: [16,32,12,13,9,13,11],
    });
    if (wsE['A2']) wsE['A2'].s = XSTY.subtitle;
    for (let r = eDataStart; r <= eFooter; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: 2 });
      if (wsE[ref] && typeof wsE[ref].v === 'number') wsE[ref].z = '$#,##0';
    }
    wsE['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:eNumCols-1} }, { s:{r:1,c:0}, e:{r:1,c:eNumCols-1} }];
    XLSX.utils.book_append_sheet(wb, wsE, 'Gastos');

    XLSX.writeFile(wb, `MILA_backup_completo_${dateTag()}.xlsx`);
    showToast(`✓ Backup exportado: ${bkRows.length} reservas, ${gRows.length} huéspedes, ${eRows.length} gastos`, 'success');
  } catch (err) {
    console.error('[Export] Backup completo error:', err);
    showToast('Error al generar el backup: ' + (err?.message ?? err), 'error');
  }
}

// ── Internos ─────────────────────────────────────
async function _loadSheetJS() {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    // xlsx-js-style: mismo API que la versión gratuita común (XLSX.utils,
    // XLSX.writeFile, etc.) pero con soporte real para estilos de celda
    // (colores, negrita, bordes) — la versión "full.min.js" de siempre
    // los ignoraba en silencio al guardar, por eso los Excel salían sin
    // ningún diseño aunque el código ya intentara aplicarlo.
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
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
