import { isDemo, can } from '../auth/permissions.js';
import { formatARS, showToast, getUnitLabel, getUnitColor, getUnitChipHTML, AppContext } from '../supabase-config.js';
// Panel analítico: ocupación, rendimiento, precios
// Módulo de gastos con vencimientos y checklist
// ═══════════════════════════════════════════════════

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const CATEGORY_COLORS = {
  servicios:    '#3B82F6',
  mantenimiento:'#F59E0B',
  limpieza:     '#34D399',
  impuestos:    '#F43F5E',
  personal:     '#A855F7',
  otros:        '#94A3B8',
};

export class Statistics {
  constructor(supabase, ctx) {
    this.db      = supabase;
    this.ctx     = ctx;
    this._tab    = 'units';

    this._initPeriodSelectors();
    this._bindTabs();
    this._bindButtons();
  }

  // ── Inicialización ────────────────────────────────
  init() {
    // Cargar por defecto el mes actual
    const now = new Date();
    document.getElementById('stats-month').value = now.getMonth();
    document.getElementById('stats-year').value  = now.getFullYear();
    this.loadUnits();
    this.loadExpenses();
  }

  _initPeriodSelectors() {
    const monthSel = document.getElementById('stats-month');
    const yearSel  = document.getElementById('stats-year');
    if (!monthSel || !yearSel) return;

    MONTH_NAMES.forEach((m, i) => {
      monthSel.innerHTML += `<option value="${i}">${m}</option>`;
    });

    const now     = new Date();
    const curYear = now.getFullYear();
    for (let y = curYear - 2; y <= curYear + 1; y++) {
      yearSel.innerHTML += `<option value="${y}" ${y === curYear ? 'selected' : ''}>${y}</option>`;
    }
    monthSel.value = now.getMonth();
  }

  _bindTabs() {
    document.querySelectorAll('#section-statistics .tabs-bar .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#section-statistics .tabs-bar .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._tab = tab.dataset.tab;
        document.getElementById('stats-units-panel')?.classList.toggle('hidden',    this._tab !== 'units');
        document.getElementById('stats-expenses-panel')?.classList.toggle('hidden', this._tab !== 'expenses');
        document.getElementById('stats-pl-panel')?.classList.toggle('hidden',       this._tab !== 'pl');

        if (this._tab === 'expenses') this.loadExpenses();
        if (this._tab === 'pl')       this.loadPL();
      });
    });
  }

  _bindButtons() {
    document.getElementById('btn-load-stats')?.addEventListener('click', () => {
      this.loadUnits();
      if (this._tab === 'expenses') this.loadExpenses();
    });

    document.getElementById('btn-add-expense')?.addEventListener('click', () => {
      document.getElementById('expense-editing-id').value = '';
      document.getElementById('expense-desc').value    = '';
      document.getElementById('expense-amount').value  = '';
      document.getElementById('expense-due').value     = '';
      document.getElementById('expense-modal-title').textContent = 'Nuevo Gasto';
      document.getElementById('overlay-expense').classList.remove('hidden');
    });
  }

  // ══════════════════════════════════════════════════
  // RENDIMIENTO POR UNIDAD
  // ══════════════════════════════════════════════════
  async loadUnits() {
    const month = parseInt(document.getElementById('stats-month')?.value ?? new Date().getMonth());
    const year  = parseInt(document.getElementById('stats-year')?.value  ?? new Date().getFullYear());

    // ── Demo mode ──
    if (AppContext.IS_DEMO) {
      const { generateMockStats } = await import('../services/mock-data.js');
      const stats = generateMockStats(this.ctx.units);
      this._renderUnitStats(stats, month, year, 30);
      return;
    }

    const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay  = new Date(year, month + 1, 0);
    const lastDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
    const daysInMonth = lastDay.getDate();

    try {
      const { data: bookings } = await this.db
        .from('bookings')
        .select(`
          id, check_in, check_out, price_per_night, total_amount, status,
          booking_units(unit_id)
        `)
        .eq('hotel_id', this.ctx.hotelId)
        .neq('status', 'cancelled')
        .neq('status', 'blocked')
        .lte('check_in',  lastDayStr)
        .gt('check_out',  firstDay);

      const stats = this._computeUnitStats(bookings ?? [], firstDay, lastDayStr, daysInMonth);
      this._renderUnitStats(stats, month, year, daysInMonth);

    } catch (err) {
      console.error('Statistics loadUnits error:', err);
      showToast('Error al cargar estadísticas', 'error');
    }
  }

  _computeUnitStats(bookings, firstDay, lastDay, daysInMonth) {
    const statsMap = {};
    this.ctx.units.forEach(u => {
      statsMap[u.id] = {
        unit:        u,
        nightsOcc:   0,
        revenue:     0,
        bookingCount: 0,
        totalPriceNights: 0, // para precio promedio ponderado
      };
    });

    bookings.forEach(b => {
      (b.booking_units ?? []).forEach(({ unit_id }) => {
        if (!statsMap[unit_id]) return;

        // Overlap entre reserva y mes
        const ciDate  = new Date(Math.max(new Date(b.check_in  + 'T00:00:00'), new Date(firstDay + 'T00:00:00')));
        const coDate  = new Date(Math.min(new Date(b.check_out + 'T00:00:00'), new Date(lastDay  + 'T23:59:59')));
        const nights  = Math.max(0, Math.round((coDate - ciDate) / 86400000));

        statsMap[unit_id].nightsOcc    += nights;
        statsMap[unit_id].bookingCount += 1;
        statsMap[unit_id].totalPriceNights += nights * (b.price_per_night ?? 0);

        // Revenue: proporcional al overlap
        const totalNights = Math.round((new Date(b.check_out + 'T00:00:00') - new Date(b.check_in + 'T00:00:00')) / 86400000);
        if (totalNights > 0) {
          statsMap[unit_id].revenue += (b.total_amount ?? 0) * (nights / totalNights);
        }
      });
    });

    return Object.values(statsMap).map(s => ({
      ...s,
      occupancyPct: Math.min(100, Math.round((s.nightsOcc / daysInMonth) * 100)),
      avgPricePerNight: s.nightsOcc > 0 ? Math.round(s.totalPriceNights / s.nightsOcc) : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }

  _renderUnitStats(stats, month, year, daysInMonth) {
    const container = document.getElementById('stats-units-grid');
    if (!container) return;

    const maxRevenue = Math.max(...stats.map(s => s.revenue), 1);

    container.innerHTML = `
      <div style="margin-bottom:20px">
        <h3 style="font-size:.95rem;font-weight:700;color:var(--color-text)">
          Reporte — ${MONTH_NAMES[month]} ${year}
          <span style="font-size:.78rem;font-weight:400;color:var(--color-text-3);margin-left:8px">(${daysInMonth} días)</span>
        </h3>
      </div>
    `;

    stats.forEach((s, idx) => {
      const card = document.createElement('div');
      card.className = 'unit-stat-card';
      const color    = getUnitColor(s.unit);
      const label    = getUnitLabel(s.unit); // "#N · Nombre"
      const revPct   = Math.round((s.revenue / maxRevenue) * 100);
      const rankLabel = idx === 0 ? '🥇 Mejor rendimiento' : idx === stats.length - 1 ? '📉 Menor rendimiento' : '';

      card.style.borderLeft = `4px solid ${color}`;
      card.innerHTML = `
        <div class="unit-stat-header">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="width:14px;height:14px;border-radius:50%;background:${color};flex-shrink:0"></span>
            <div>
              <span class="unit-stat-name" style="color:${color}">${label}</span>
              <span style="display:block;font-size:.73rem;color:var(--color-text-2);margin-top:2px">Hasta ${s.unit.max_guests} personas</span>
            </div>
          </div>
          ${rankLabel ? `<span style="font-size:.75rem;font-weight:600;color:${color}">${rankLabel}</span>` : ''}
        </div>
        <div class="unit-stat-kpis">
          <div class="unit-kpi"><span class="unit-kpi-val">${s.occupancyPct}%</span><span class="unit-kpi-lbl">Ocupación</span></div>
          <div class="unit-kpi"><span class="unit-kpi-val">${s.nightsOcc}</span><span class="unit-kpi-lbl">Noches alq.</span></div>
          <div class="unit-kpi"><span class="unit-kpi-val">${formatARS(s.avgPricePerNight)}</span><span class="unit-kpi-lbl">Precio/noche</span></div>
          <div class="unit-kpi"><span class="unit-kpi-val">${s.bookingCount}</span><span class="unit-kpi-lbl">Reservas</span></div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="occ-bar-track" style="flex:1">
            <div class="occ-bar-fill" style="width:0%;background:${color}" data-target="${revPct}%"></div>
          </div>
          <strong style="font-size:.9rem;min-width:100px;text-align:right">${formatARS(s.revenue)}</strong>
        </div>
      `;

      container.appendChild(card);
    });

    // Animar barras de rendimiento
    requestAnimationFrame(() => {
      container.querySelectorAll('.occ-bar-fill').forEach(bar => {
        const target = bar.getAttribute('data-target');
        setTimeout(() => { bar.style.width = target; }, 100);
      });
    });

    // Totales del período con chips de unidades
    const totalRevenue = stats.reduce((s, u) => s + u.revenue, 0);
    const totalNights  = stats.reduce((s, u) => s + u.nightsOcc, 0);
    const avgOcc       = Math.round(stats.reduce((s, u) => s + u.occupancyPct, 0) / stats.length);

    const rankingList = stats.map((s, i) =>
      `<div style="display:flex;align-items:center;gap:8px;padding:4px 0">
        <span style="width:18px;font-size:.78rem;font-weight:700;color:var(--color-text-3)">#${i+1}</span>
        ${getUnitChipHTML(s.unit, 'sm')}
        <span style="margin-left:auto;font-size:.82rem;font-weight:700">${formatARS(s.revenue)}</span>
        <span style="font-size:.75rem;color:var(--color-text-3)">(${s.occupancyPct}% ocup.)</span>
      </div>`).join('');

    container.innerHTML += `
      <div class="card" style="background:var(--color-primary-l);border-color:rgba(99,102,241,.2)">
        <div class="card-header"><h3 style="color:var(--color-primary)">Resumen del período — ${MONTH_NAMES[month]} ${year}</h3></div>
        <div class="unit-stat-kpis" style="margin:16px 0 20px">
          <div class="unit-kpi"><span class="unit-kpi-val">${formatARS(totalRevenue)}</span><span class="unit-kpi-lbl">Ingreso bruto</span></div>
          <div class="unit-kpi"><span class="unit-kpi-val">${totalNights}</span><span class="unit-kpi-lbl">Total noches</span></div>
          <div class="unit-kpi"><span class="unit-kpi-val">${avgOcc}%</span><span class="unit-kpi-lbl">Ocup. promedio</span></div>
          <div class="unit-kpi"><span class="unit-kpi-val">${stats.reduce((s,u)=>s+u.bookingCount,0)}</span><span class="unit-kpi-lbl">Total reservas</span></div>
        </div>
        <div style="border-top:1px solid rgba(99,102,241,.15);padding-top:16px">
          <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
            color:var(--color-text-3);margin-bottom:10px">Ranking de rendimiento</div>
          ${rankingList}
        </div>
      </div>`;
  }

  // ══════════════════════════════════════════════════
  // GASTOS OPERATIVOS
  // ══════════════════════════════════════════════════
  // ══════════════════════════════════════════════════
  // P&L MENSUAL (#18 — completado)
  // ══════════════════════════════════════════════════
  async loadPL() {
    const container = document.getElementById('stats-pl-panel');
    if (!container) return;
    container.innerHTML = `<div class="skeleton-box" style="height:320px"></div>`;

    const month = parseInt(document.getElementById('stats-month')?.value ?? new Date().getMonth());
    const year  = parseInt(document.getElementById('stats-year')?.value  ?? new Date().getFullYear());

    // Demo mode
    if (AppContext.IS_DEMO) {
      const { generateMockStats, generateMockExpenses, MOCK_COMMISSIONS } = await import('../services/mock-data.js');
      const stats    = generateMockStats(this.ctx.units);
      const expenses = generateMockExpenses();
      this._renderPL(stats.reduce((m,s) => { m[s.unit.source??'direct'] = (m[s.unit.source??'direct']??0)+s.revenue; return m; }, {}),
        expenses, MOCK_COMMISSIONS, month, year);
      return;
    }

    const firstDay   = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const lastDay    = new Date(year, month+1, 0);
    const lastDayStr = `${year}-${String(month+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;

    const [bookingsRes, expensesRes, commissionsRes] = await Promise.all([
      this.db.from('bookings').select('source, total_amount')
        .eq('hotel_id', this.ctx.hotelId)
        .not('status', 'in', '(cancelled,blocked)')
        .gte('check_in', firstDay).lte('check_in', lastDayStr),
      this.db.from('expenses').select('*').eq('hotel_id', this.ctx.hotelId)
        .or(`due_date.is.null,and(due_date.gte.${firstDay},due_date.lte.${lastDayStr})`),
      this.db.from('channel_commissions').select('*').eq('hotel_id', this.ctx.hotelId),
    ]);

    const revenueBySource = {};
    (bookingsRes.data ?? []).forEach(b => {
      const src = b.source ?? 'direct';
      revenueBySource[src] = (revenueBySource[src] ?? 0) + (b.total_amount ?? 0);
    });

    const commMap = {};
    (commissionsRes.data ?? []).forEach(c => { commMap[c.channel] = c.commission_pct; });

    this._renderPL(revenueBySource, expensesRes.data ?? [], commMap, month, year);
  }

  _renderPL(revenueBySource, expenses, commMap, month, year) {
    const container = document.getElementById('stats-pl-panel');
    if (!container) return;

    const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                         'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const period = `${MONTH_NAMES[month]} ${year}`;
    const SOURCE_LABELS = { direct:'🏠 Directo', booking:'🟦 Booking', airbnb:'🟧 Airbnb', family:'🟪 Familia' };

    let totalGross = 0, totalComm = 0;
    const sourceRows = Object.entries(revenueBySource).map(([src, gross]) => {
      const commPct  = commMap[src] ?? 0;
      const comm     = gross * (commPct / 100);
      const net      = gross - comm;
      totalGross    += gross;
      totalComm     += comm;
      return { src, gross, comm, commPct, net };
    });
    const totalNet    = totalGross - totalComm;
    const totalExpPaid= expenses.filter(e => e.paid).reduce((s, e) => s + e.amount, 0);
    const totalExpAll = expenses.reduce((s, e) => s + e.amount, 0);
    const result      = totalNet - totalExpPaid;
    const resultColor = result >= 0 ? 'var(--color-success)' : 'var(--color-danger)';

    const fmt = (n) => formatARS(n);

    const expByCategory = {};
    expenses.forEach(e => {
      expByCategory[e.category] = (expByCategory[e.category] ?? 0) + e.amount;
    });

    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div>
          <h3 style="font-size:1rem;font-weight:700">Estado de Resultados — ${period}</h3>
          <p style="font-size:.78rem;color:var(--color-text-3);margin-top:4px">Ingresos netos de comisiones vs. gastos operativos</p>
        </div>
        ${can('exportData') ? `<button class="btn btn-outline btn-sm" id="btn-export-pl">📥 Exportar</button>` : ''}
      </div>

      <!-- INGRESOS -->
      <div class="card" style="margin-bottom:16px">
        <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
          color:var(--color-text-3);margin-bottom:12px">Ingresos por canal</div>
        <table class="pl-table">
          <thead><tr><th>Canal</th><th>Bruto</th><th>Comisión</th><th>Neto</th></tr></thead>
          <tbody>
            ${sourceRows.length ? sourceRows.map(r => `
              <tr>
                <td>${SOURCE_LABELS[r.src] ?? r.src}</td>
                <td>${fmt(r.gross)}</td>
                <td style="color:var(--color-danger)">${r.commPct > 0 ? `−${fmt(r.comm)} (${r.commPct}%)` : '—'}</td>
                <td style="font-weight:600">${fmt(r.net)}</td>
              </tr>`).join('') : `<tr><td colspan="4" style="text-align:center;color:var(--color-text-3)">Sin reservas en este período</td></tr>`}
          </tbody>
          <tfoot>
            <tr class="pl-total">
              <td><strong>TOTAL INGRESOS</strong></td>
              <td><strong>${fmt(totalGross)}</strong></td>
              <td style="color:var(--color-danger)">${totalComm > 0 ? `−${fmt(totalComm)}` : '—'}</td>
              <td style="color:var(--color-success)"><strong>${fmt(totalNet)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- GASTOS -->
      <div class="card" style="margin-bottom:16px">
        <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
          color:var(--color-text-3);margin-bottom:12px">Gastos operativos</div>
        <table class="pl-table">
          <thead><tr><th>Categoría</th><th>Total</th><th>Pagados</th><th>Pendientes</th></tr></thead>
          <tbody>
            ${Object.entries(expByCategory).length ? Object.entries(expByCategory).map(([cat, total]) => {
              const paid = expenses.filter(e => e.category === cat && e.paid).reduce((s,e) => s+e.amount, 0);
              return `<tr>
                <td style="text-transform:capitalize">${cat}</td>
                <td>${fmt(total)}</td>
                <td style="color:var(--color-success)">${fmt(paid)}</td>
                <td style="color:var(--color-warning)">${fmt(total - paid)}</td>
              </tr>`;
            }).join('') : `<tr><td colspan="4" style="text-align:center;color:var(--color-text-3)">Sin gastos en este período</td></tr>`}
          </tbody>
          <tfoot>
            <tr class="pl-total">
              <td><strong>TOTAL GASTOS</strong></td>
              <td><strong>${fmt(totalExpAll)}</strong></td>
              <td style="color:var(--color-success)"><strong>${fmt(totalExpPaid)}</strong></td>
              <td style="color:var(--color-warning)"><strong>${fmt(totalExpAll - totalExpPaid)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- RESULTADO NETO -->
      <div class="card" style="background:${result >= 0 ? 'rgba(34,197,94,.06)' : 'rgba(239,68,68,.06)'};
        border-color:${result >= 0 ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-3)">
              Resultado Neto del Período
            </div>
            <div style="font-size:.78rem;color:var(--color-text-3);margin-top:4px">
              Ingresos netos (${fmt(totalNet)}) − Gastos pagados (${fmt(totalExpPaid)})
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:2rem;font-weight:800;color:${resultColor}">
              ${result >= 0 ? '+' : ''}${fmt(result)}
            </div>
            <div style="font-size:.75rem;color:var(--color-text-3)">${period}</div>
          </div>
        </div>
      </div>`;

    document.getElementById('btn-export-pl')?.addEventListener('click', async () => {
      const { exportPLCSV } = await import('../services/export-service.js');
      const stats = sourceRows.map(r => ({
        unit: { name: SOURCE_LABELS[r.src] ?? r.src, sort_order: 0 },
        revenue: r.net, nightsOcc: 0, bookingCount: 0, avgPricePerNight: 0, occupancyPct: 0,
      }));
      exportPLCSV(stats, expenses, commMap, month, year);
    });
  }

  async loadExpenses() {
    const month = parseInt(document.getElementById('stats-month')?.value ?? new Date().getMonth());
    const year  = parseInt(document.getElementById('stats-year')?.value  ?? new Date().getFullYear());

    const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay  = new Date(year, month + 1, 0);
    const lastDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

    try {
      const { data: expenses } = await this.db
        .from('expenses')
        .select('*')
        .eq('hotel_id', this.ctx.hotelId)
        .or(`due_date.is.null,and(due_date.gte.${firstDay},due_date.lte.${lastDayStr})`)
        .order('due_date', { ascending: true, nullsFirst: false });

      this._renderExpenses(expenses ?? []);
    } catch (err) {
      console.error('Expenses load error:', err);
    }
  }

  _renderExpenses(expenses) {
    const container = document.getElementById('expenses-list');
    const summary   = document.getElementById('expenses-summary');
    if (!container) return;

    const totalAmt  = expenses.reduce((s, e) => s + e.amount, 0);
    const paidAmt   = expenses.filter(e => e.paid).reduce((s, e) => s + e.amount, 0);
    const pendingAmt = totalAmt - paidAmt;

    if (summary) {
      summary.innerHTML = `
        <div class="expense-summary-item"><label>Total gastos</label><strong>${formatARS(totalAmt)}</strong></div>
        <div class="expense-summary-item"><label style="color:var(--color-success)">Pagados</label><strong style="color:var(--color-success)">${formatARS(paidAmt)}</strong></div>
        <div class="expense-summary-item"><label style="color:var(--color-warning)">Pendientes</label><strong style="color:var(--color-warning)">${formatARS(pendingAmt)}</strong></div>
      `;
    }

    if (!expenses.length) {
      container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">💰</span><p>Sin gastos registrados en este período.</p></div>`;
      return;
    }

    container.innerHTML = expenses.map(e => `
      <div class="expense-row ${e.paid ? 'paid' : ''}" id="exp-row-${e.id}">
        <div class="expense-category-dot" style="background:${CATEGORY_COLORS[e.category] ?? '#94A3B8'}"></div>
        <div class="expense-info">
          <div class="expense-desc">${e.description}</div>
          <div class="expense-meta">
            ${e.category} 
            ${e.due_date ? `· Vence: ${e.due_date}` : ''}
            ${e.paid && e.paid_at ? `· Pagado: ${e.paid_at.slice(0,10)}` : ''}
          </div>
        </div>
        <strong class="expense-amount" style="color:${e.paid ? 'var(--color-success)' : 'var(--color-text)'}">
          ${formatARS(e.amount)}
        </strong>
        <label class="expense-paid-toggle" title="${e.paid ? 'Marcar como pendiente' : 'Marcar como pagado'}">
          <input type="checkbox" ${e.paid ? 'checked' : ''} onchange="window._statsInstance.toggleExpense('${e.id}', this.checked)">
        </label>
        <button class="btn btn-ghost btn-xs" onclick="window._statsInstance.editExpense('${e.id}')" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-ghost btn-xs" onclick="window._statsInstance.deleteExpense('${e.id}')" title="Eliminar" style="color:var(--color-danger)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>
      </div>
    `).join('');

    window._statsInstance = this;
  }

  async toggleExpense(id, paid) {
    const { error } = await this.db.from('expenses').update({
      paid,
      paid_at: paid ? new Date().toISOString() : null,
    }).eq('id', id);
    if (error) { showToast('Error al actualizar gasto', 'error'); return; }
    const row = document.getElementById(`exp-row-${id}`);
    if (row) row.classList.toggle('paid', paid);
    showToast(paid ? 'Marcado como pagado ✓' : 'Marcado como pendiente', 'success');
  }

  async editExpense(id) {
    const { data: expense } = await this.db.from('expenses').select('*').eq('id', id).single();
    if (!expense) return;
    document.getElementById('expense-editing-id').value = id;
    document.getElementById('expense-category').value   = expense.category ?? 'otros';
    document.getElementById('expense-desc').value       = expense.description ?? '';
    document.getElementById('expense-amount').value     = expense.amount ?? '';
    document.getElementById('expense-due').value        = expense.due_date ?? '';
    document.getElementById('expense-modal-title').textContent = 'Editar Gasto';
    document.getElementById('overlay-expense').classList.remove('hidden');
  }

  async deleteExpense(id) {
    if (!confirm('¿Eliminar este gasto?')) return;
    const { error } = await this.db.from('expenses').delete().eq('id', id);
    if (error) { showToast('Error al eliminar', 'error'); return; }
    document.getElementById(`exp-row-${id}`)?.remove();
    showToast('Gasto eliminado', 'success');
}
}
