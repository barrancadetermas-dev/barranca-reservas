import { isDemo, can } from '../auth/permissions.js';
import { formatARS, showToast, getUnitLabel, getUnitColor, getUnitChipHTML, AppContext } from '../supabase-config.js';

// ══════════════════════════════════════════════════
// statistics.js v5.1 — MILA
// • KPIs compactos sin scroll vertical
// • 4 métricas por fila: ADR, RevPAR, ocupación, ingresos
// • Heatmap de ocupación (nueva pestaña)
// • Exportar PDF y Excel
// • Gastos + P&L completo (preservados)
// ══════════════════════════════════════════════════

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const CATEGORY_COLORS = {
  servicios:    '#3B82F6', mantenimiento:'#F59E0B',
  limpieza:     '#34D399', impuestos:    '#F43F5E',
  personal:     '#A855F7', otros:        '#94A3B8',
};

const SOURCE_LABELS = {
  direct:'Directo', booking:'Booking', airbnb:'Airbnb',
  family:'Familia', walkin:'Espontáneo', company:'Empresa',
  referral:'Referido', despegar:'Despegar', expedia:'Expedia',
};

export class Statistics {
  constructor(supabase, ctx) {
    this.db   = supabase;
    this.ctx  = ctx;
    this._tab = 'units';
    this._initPeriodSelectors();
    this._bindTabs();
    this._bindButtons();
    window._statsInstance = this;
  }

  init() {
    const now = new Date();
    document.getElementById('stats-month').value = now.getMonth();
    document.getElementById('stats-year').value  = now.getFullYear();
    this._tab = 'units';
    this.loadUnits();
  }

  _initPeriodSelectors() {
    const monthSel = document.getElementById('stats-month');
    const yearSel  = document.getElementById('stats-year');
    if (!monthSel || !yearSel) return;
    MONTH_NAMES.forEach((m, i) => { monthSel.innerHTML += `<option value="${i}">${m}</option>`; });
    const now = new Date(), curYear = now.getFullYear();
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
        this._showPanel(this._tab);
        if (this._tab === 'units')    this.loadUnits();
        if (this._tab === 'expenses') this.loadExpenses();
        if (this._tab === 'pl')       this.loadPL();
        if (this._tab === 'heatmap')  this.loadHeatmap();
        if (this._tab === 'charts')   this.loadCharts();
      });
    });
  }

  _showPanel(tab) {
    ['units','expenses','pl','heatmap','charts'].forEach(t => {
      document.getElementById(`stats-${t}-panel`)?.classList.toggle('hidden', t !== tab);
    });
  }

  _bindButtons() {
    document.getElementById('btn-load-stats')?.addEventListener('click', () => {
      if (this._tab === 'units')    this.loadUnits();
      if (this._tab === 'expenses') this.loadExpenses();
      if (this._tab === 'heatmap')  this.loadHeatmap();
      if (this._tab === 'charts')   this.loadCharts();
      if (this._tab === 'pl')       this.loadPL();
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

    if (AppContext.IS_DEMO) {
      const { generateMockStats } = await import('../services/mock-data.js');
      const stats = generateMockStats(this.ctx.units);
      this._renderUnitStats(stats, month, year, 30);
      return;
    }

    const firstDay   = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const lastDay    = new Date(year, month + 1, 0);
    const lastDayStr = `${year}-${String(month+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
    const daysInMonth = lastDay.getDate();

    try {
      const { data: bookings } = await this.db
        .from('bookings')
        .select('id, check_in, check_out, price_per_night, total_amount, status, nights, booking_units(unit_id)')
        .eq('hotel_id', this.ctx.hotelId)
        .neq('status', 'cancelled').neq('status', 'blocked')
        .lte('check_in', lastDayStr).gt('check_out', firstDay);

      const stats = this._computeUnitStats(bookings ?? [], firstDay, lastDayStr, daysInMonth);
      this._renderUnitStats(stats, month, year, daysInMonth);
    } catch (err) {
      console.error('[Statistics] loadUnits error:', err);
      showToast('Error al cargar estadísticas', 'error');
    }
  }

  _computeUnitStats(bookings, firstDay, lastDay, daysInMonth) {
    const statsMap = {};
    this.ctx.units.forEach(u => {
      statsMap[u.id] = { unit: u, nightsOcc: 0, revenue: 0, bookingCount: 0, totalPriceNights: 0 };
    });

    bookings.forEach(b => {
      (b.booking_units ?? []).forEach(({ unit_id }) => {
        if (!statsMap[unit_id]) return;
        const ciDate  = new Date(Math.max(new Date(b.check_in + 'T00:00:00'),  new Date(firstDay + 'T00:00:00')));
        const coDate  = new Date(Math.min(new Date(b.check_out + 'T00:00:00'), new Date(lastDay  + 'T23:59:59')));
        const nights  = Math.max(0, Math.round((coDate - ciDate) / 86400000));
        statsMap[unit_id].nightsOcc       += nights;
        statsMap[unit_id].bookingCount    += 1;
        statsMap[unit_id].totalPriceNights += nights * (b.price_per_night ?? 0);
        const totalNights = Math.round((new Date(b.check_out + 'T00:00:00') - new Date(b.check_in + 'T00:00:00')) / 86400000);
        if (totalNights > 0) statsMap[unit_id].revenue += (b.total_amount ?? 0) * (nights / totalNights);
      });
    });

    return Object.values(statsMap).map(s => ({
      ...s,
      occupancyPct:     Math.min(100, Math.round((s.nightsOcc / daysInMonth) * 100)),
      avgPricePerNight: s.nightsOcc > 0 ? Math.round(s.totalPriceNights / s.nightsOcc) : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }

  _renderUnitStats(stats, month, year, daysInMonth) {
    const container = document.getElementById('stats-units-grid');
    if (!container) return;

    const totalRevenue  = stats.reduce((s, u) => s + u.revenue, 0);
    const totalNights   = stats.reduce((s, u) => s + u.nightsOcc, 0);
    const avgOcc        = Math.round(stats.reduce((s, u) => s + u.occupancyPct, 0) / (stats.length || 1));
    const totalBookings = stats.reduce((s, u) => s + u.bookingCount, 0);
    const ADR           = totalNights > 0 ? Math.round(totalRevenue / totalNights) : 0;
    const totalRooms    = this.ctx.units.length;
    const RevPAR        = totalRooms > 0 ? Math.round((totalRevenue / (totalRooms * daysInMonth))) : 0;
    const avgStay       = totalBookings > 0 ? (totalNights / totalBookings).toFixed(1) : '0';

    // ── KPIs compactos (fila única, 4 columnas) ────
    let html = `
      <div class="stats-kpi-row">
        ${this._kpiCard('Ingreso bruto', formatARS(totalRevenue), 'blue', '↗ vs período')}
        ${this._kpiCard('ADR', formatARS(ADR), 'green', 'Tarifa prom. diaria')}
        ${this._kpiCard('RevPAR', formatARS(RevPAR), 'purple', 'Ingreso por hab. disp.')}
        ${this._kpiCard('Ocupación', avgOcc + '%', avgOcc >= 70 ? 'green' : avgOcc >= 40 ? 'amber' : 'rose', `${totalNights} noches`)}
        ${this._kpiCard('Estadía prom.', avgStay + ' noches', 'blue', `${totalBookings} reservas`)}
        ${this._kpiCard('Unidades', totalRooms, 'gray', `${daysInMonth} días disponibles`)}
      </div>`;

    // ── Exportar ──────────────────────────────────
    if (can('exportData')) {
      html += `
        <div class="stats-export-row">
          <span style="font-size:.78rem;color:var(--color-text-3)">${MONTH_NAMES[month]} ${year} · ${daysInMonth} días</span>
          <div style="display:flex;gap:8px">
            <button class="btn btn-outline btn-sm" id="btn-exp-excel">📊 Excel</button>
            <button class="btn btn-outline btn-sm" id="btn-exp-pdf">📄 PDF</button>
          </div>
        </div>`;
    }

    // ── Gráfico de barras por canal de ingreso ──────
    const channelRevenue = {};
    (this._lastBookings ?? []).forEach(b => {
      const src = b.source ?? 'direct';
      channelRevenue[src] = (channelRevenue[src] ?? 0) + (b.total_amount ?? 0);
    });
    const sortedChannels = Object.entries(channelRevenue)
      .sort(([,a],[,b]) => b - a).slice(0, 6);
    const maxCh = sortedChannels[0]?.[1] ?? 1;

    const CHANNEL_COLORS = {
      direct:'#6366f1', walkin:'#0891b2', booking:'#1d4ed8',
      airbnb:'#ea580c', family:'#7c3aed', company:'#0f766e',
      referral:'#b45309', despegar:'#059669', expedia:'#dc2626',
    };
    const CHANNEL_NAMES = {
      direct:'Directo', walkin:'Espontáneo', booking:'Booking',
      airbnb:'Airbnb', family:'Familia', company:'Empresa',
      referral:'Referido', despegar:'Despegar', expedia:'Expedia',
    };

    if (sortedChannels.length > 1) {
      html += `
        <div class="stats-section-title">Ingresos por canal</div>
        <div class="channel-chart-card">
          ${sortedChannels.map(([src, rev]) => {
            const pct   = Math.round((rev / maxCh) * 100);
            const color = CHANNEL_COLORS[src] ?? '#64748b';
            const name  = CHANNEL_NAMES[src] ?? src;
            return `
              <div class="ch-row">
                <div class="ch-label">
                  <span class="ch-dot" style="background:${color}"></span>
                  ${name}
                </div>
                <div class="ch-bar-track">
                  <div class="ch-bar-fill" style="width:${pct}%;background:${color}"></div>
                </div>
                <div class="ch-val">${formatARS(rev)}</div>
              </div>`;
          }).join('')}
        </div>`;
    }

    // ── Tabla compacta por unidad ─────────────────
    html += `
      <div class="stats-table-wrap">
        <table class="stats-compact-table">
          <thead>
            <tr>
              <th>Unidad</th>
              <th>Ocupación</th>
              <th>Noches</th>
              <th>ADR</th>
              <th>Reservas</th>
              <th>Ingreso</th>
            </tr>
          </thead>
          <tbody>
            ${stats.map((s, i) => {
              const color  = getUnitColor(s.unit);
              const occW   = Math.max(4, s.occupancyPct);
              const rank   = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
              return `
              <tr>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
                    <span style="font-weight:600;font-size:.82rem">${rank} ${s.unit.name}</span>
                  </div>
                </td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px;min-width:120px">
                    <div class="occ-bar-track" style="flex:1;height:6px">
                      <div class="occ-bar-fill" style="width:${occW}%;background:${color};transition:width .6s"></div>
                    </div>
                    <span style="font-size:.78rem;font-weight:700;color:${color};min-width:34px">${s.occupancyPct}%</span>
                  </div>
                </td>
                <td style="font-size:.82rem">${s.nightsOcc}</td>
                <td style="font-size:.82rem">${s.avgPricePerNight > 0 ? formatARS(s.avgPricePerNight) : '—'}</td>
                <td style="font-size:.82rem">${s.bookingCount}</td>
                <td style="font-weight:700;font-size:.875rem">${formatARS(s.revenue)}</td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="font-weight:700;background:var(--color-surface-2)">
              <td>TOTAL</td>
              <td>${avgOcc}% prom.</td>
              <td>${totalNights}</td>
              <td>${formatARS(ADR)}</td>
              <td>${totalBookings}</td>
              <td>${formatARS(totalRevenue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;

    container.innerHTML = html;

    // Bind exportar
    document.getElementById('btn-exp-excel')?.addEventListener('click', () => this._exportExcel(stats, month, year));
    document.getElementById('btn-exp-pdf')?.addEventListener('click',   () => this._exportPDF(stats, month, year, { ADR, RevPAR, avgOcc, totalRevenue, totalNights, daysInMonth }));
  }

  _kpiCard(label, value, color, sub) {
    const colors = {
      blue:   { bg:'#e6f1fb', text:'#185fa5' },
      green:  { bg:'#eaf3de', text:'#3b6d11' },
      purple: { bg:'#eeedfe', text:'#534ab7' },
      amber:  { bg:'#faeeda', text:'#854f0b' },
      rose:   { bg:'#fcebeb', text:'#a32d2d' },
      gray:   { bg:'#f1efe8', text:'#5f5e5a' },
    };
    const c = colors[color] ?? colors.blue;
    return `
      <div class="stat-kpi-card" style="background:${c.bg}">
        <div class="stat-kpi-val" style="color:${c.text}">${value}</div>
        <div class="stat-kpi-lbl">${label}</div>
        <div class="stat-kpi-sub">${sub}</div>
      </div>`;
  }

  // ══════════════════════════════════════════════════
  // HEATMAP DE OCUPACIÓN
  // ══════════════════════════════════════════════════
  async loadHeatmap() {
    const panel = document.getElementById('stats-heatmap-panel');
    if (!panel) return;
    panel.innerHTML = '<div class="loading-state">Generando mapa de calor...</div>';

    const month = parseInt(document.getElementById('stats-month')?.value ?? new Date().getMonth());
    const year  = parseInt(document.getElementById('stats-year')?.value  ?? new Date().getFullYear());

    const firstDay   = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const lastDay    = new Date(year, month + 1, 0);
    const lastDayStr = `${year}-${String(month+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
    const daysInMonth = lastDay.getDate();
    const today = new Date().toISOString().split('T')[0];

    try {
      let bookings = [];
      if (AppContext.IS_DEMO) {
        const { generateMockBookings } = await import('../services/mock-data.js');
        bookings = generateMockBookings(this.ctx.units, year, month);
      } else {
        const { data } = await this.db
          .from('bookings')
          .select('check_in, check_out, status, source, booking_units(unit_id)')
          .eq('hotel_id', this.ctx.hotelId)
          .neq('status', 'cancelled')
          .lte('check_in', lastDayStr)
          .gt('check_out', firstDay);
        bookings = data ?? [];
      }

      // Construir mapa: unitId → Set de días ocupados
      const occMap = {};
      this.ctx.units.forEach(u => { occMap[u.id] = new Set(); });

      bookings.forEach(b => {
        (b.booking_units ?? []).forEach(({ unit_id }) => {
          if (!occMap[unit_id]) return;
          let d = new Date(Math.max(new Date(b.check_in + 'T00:00:00'), new Date(firstDay + 'T00:00:00')));
          const end = new Date(Math.min(new Date(b.check_out + 'T00:00:00'), new Date(lastDayStr + 'T23:59:59')));
          while (d <= end) {
            occMap[unit_id].add(d.getDate());
            d.setDate(d.getDate() + 1);
          }
        });
      });

      // Días de la semana abreviados
      const dayNames = ['D','L','M','X','J','V','S'];
      const days     = Array.from({ length: daysInMonth }, (_, i) => i + 1);

      // Calcular % ocupación por día (para la leyenda)
      const dailyOcc = days.map(d => {
        const occ = this.ctx.units.filter(u => occMap[u.id].has(d)).length;
        return Math.round((occ / this.ctx.units.length) * 100);
      });

      const todayDay = today.startsWith(`${year}-${String(month+1).padStart(2,'0')}`)
        ? parseInt(today.split('-')[2]) : null;

      // Header de días
      const daysHeaderHTML = days.map(d => {
        const date   = new Date(year, month, d);
        const dayOfW = date.getDay();
        const isWknd = dayOfW === 0 || dayOfW === 6;
        const isToday = d === todayDay;
        return `<div class="hm-day-head ${isWknd ? 'hm-weekend' : ''} ${isToday ? 'hm-today' : ''}"
                     title="${date.toLocaleDateString('es-AR', {weekday:'long', day:'numeric'})}">
          <div class="hm-day-num">${d}</div>
          <div class="hm-day-name">${dayNames[dayOfW]}</div>
        </div>`;
      }).join('');

      // Filas por unidad
      const rowsHTML = this.ctx.units.map(u => {
        const color = getUnitColor(u);
        const cells = days.map(d => {
          const occupied = occMap[u.id].has(d);
          const isToday  = d === todayDay;
          return `<div class="hm-cell ${occupied ? 'hm-occ' : 'hm-free'} ${isToday ? 'hm-today' : ''}"
                       style="${occupied ? `background:${color};opacity:.85` : ''}"
                       title="${u.name} — día ${d}: ${occupied ? 'Ocupado' : 'Libre'}">
          </div>`;
        }).join('');

        const unitOcc = Math.round((occMap[u.id].size / daysInMonth) * 100);
        return `
          <div class="hm-row">
            <div class="hm-unit-label">
              <span class="hm-unit-dot" style="background:${color}"></span>
              <span class="hm-unit-name">${u.name}</span>
              <span class="hm-unit-pct">${unitOcc}%</span>
            </div>
            <div class="hm-cells-row">${cells}</div>
          </div>`;
      }).join('');

      // Fila de calor total (resumen inferior)
      const heatRow = days.map(d => {
        const pct = dailyOcc[d - 1];
        const bg  = pct >= 90 ? '#ef4444'
                  : pct >= 70 ? '#f59e0b'
                  : pct >= 40 ? '#22c55e'
                  : pct > 0  ? '#93c5fd'
                  : '#f1f5f9';
        const isToday = d === todayDay;
        return `<div class="hm-cell hm-heat" style="background:${bg};opacity:${Math.max(.3, pct/100 + .3)}"
                     title="Día ${d}: ${pct}% ocupado"></div>`;
      }).join('');

      panel.innerHTML = `
        <div class="hm-header-row">
          <h4>Mapa de Ocupación — ${MONTH_NAMES[month]} ${year}</h4>
          <div class="hm-legend">
            <span class="hm-leg-item"><span class="hm-leg-dot" style="background:#93c5fd"></span>Baja</span>
            <span class="hm-leg-item"><span class="hm-leg-dot" style="background:#22c55e"></span>Media</span>
            <span class="hm-leg-item"><span class="hm-leg-dot" style="background:#f59e0b"></span>Alta</span>
            <span class="hm-leg-item"><span class="hm-leg-dot" style="background:#ef4444"></span>Completo</span>
          </div>
        </div>
        <div class="heatmap-scroll">
          <div class="heatmap-grid" style="--days:${daysInMonth}">
            <div class="hm-corner"></div>
            <div class="hm-days-header">${daysHeaderHTML}</div>
            ${rowsHTML}
            <div class="hm-row">
              <div class="hm-unit-label" style="font-size:.7rem;font-weight:700;color:var(--color-text-3)">TOTAL %</div>
              <div class="hm-cells-row">${heatRow}</div>
            </div>
          </div>
        </div>`;

    } catch (err) {
      console.error('[Statistics] heatmap error:', err);
      panel.innerHTML = '<div class="error-state"><p>Error al cargar el mapa de calor.</p></div>';
    }
  }

  // ══════════════════════════════════════════════════
  // GASTOS OPERATIVOS (preservado)
  // ══════════════════════════════════════════════════
  async loadExpenses() {
    const month = parseInt(document.getElementById('stats-month')?.value ?? new Date().getMonth());
    const year  = parseInt(document.getElementById('stats-year')?.value  ?? new Date().getFullYear());
    const firstDay   = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const lastDay    = new Date(year, month + 1, 0);
    const lastDayStr = `${year}-${String(month+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
    try {
      const { data: expenses } = await this.db.from('expenses').select('*')
        .eq('hotel_id', this.ctx.hotelId)
        .or(`due_date.is.null,and(due_date.gte.${firstDay},due_date.lte.${lastDayStr})`)
        .order('due_date', { ascending: true, nullsFirst: false });
      this._renderExpenses(expenses ?? []);
    } catch (err) { console.error('[Statistics] expenses error:', err); }
  }

  _renderExpenses(expenses) {
    const container = document.getElementById('expenses-list');
    const summary   = document.getElementById('expenses-summary');
    if (!container) return;
    const totalAmt   = expenses.reduce((s,e) => s+e.amount, 0);
    const paidAmt    = expenses.filter(e=>e.paid).reduce((s,e) => s+e.amount, 0);
    const pendingAmt = totalAmt - paidAmt;
    if (summary) {
      summary.innerHTML = `
        <div class="expense-summary-item"><label>Total</label><strong>${formatARS(totalAmt)}</strong></div>
        <div class="expense-summary-item"><label style="color:var(--color-success)">Pagados</label><strong style="color:var(--color-success)">${formatARS(paidAmt)}</strong></div>
        <div class="expense-summary-item"><label style="color:var(--color-warning)">Pendientes</label><strong style="color:var(--color-warning)">${formatARS(pendingAmt)}</strong></div>`;
    }
    if (!expenses.length) {
      container.innerHTML = `<div class="empty-state"><span class="empty-state-icon">💰</span><p>Sin gastos en este período.</p></div>`;
      return;
    }
    container.innerHTML = expenses.map(e => `
      <div class="expense-row ${e.paid ? 'paid':''}" id="exp-row-${e.id}">
        <div class="expense-category-dot" style="background:${CATEGORY_COLORS[e.category]??'#94A3B8'}"></div>
        <div class="expense-info">
          <div class="expense-desc">${e.description}</div>
          <div class="expense-meta">${e.category}${e.due_date?` · Vence: ${e.due_date}`:''}${e.paid&&e.paid_at?` · Pagado: ${e.paid_at.slice(0,10)}`:''}</div>
        </div>
        <strong class="expense-amount" style="color:${e.paid?'var(--color-success)':'var(--color-text)'}">${formatARS(e.amount)}</strong>
        <label class="expense-paid-toggle" title="${e.paid?'Marcar pendiente':'Marcar pagado'}">
          <input type="checkbox" ${e.paid?'checked':''} onchange="window._statsInstance.toggleExpense('${e.id}',this.checked)">
        </label>
        <button class="btn btn-ghost btn-xs" onclick="window._statsInstance.editExpense('${e.id}')" title="Editar">✏️</button>
        <button class="btn btn-ghost btn-xs" onclick="window._statsInstance.deleteExpense('${e.id}')" title="Eliminar" style="color:var(--color-danger)">🗑️</button>
      </div>`).join('');
  }

  async toggleExpense(id, paid) {
    const { error } = await this.db.from('expenses').update({ paid, paid_at: paid ? new Date().toISOString() : null }).eq('id', id);
    if (error) { showToast('Error', 'error'); return; }
    document.getElementById(`exp-row-${id}`)?.classList.toggle('paid', paid);
    showToast(paid ? 'Pagado ✓' : 'Marcado como pendiente', 'success');
  }
  async editExpense(id) {
    const { data: e } = await this.db.from('expenses').select('*').eq('id', id).single();
    if (!e) return;
    document.getElementById('expense-editing-id').value = id;
    document.getElementById('expense-category').value   = e.category ?? 'otros';
    document.getElementById('expense-desc').value       = e.description ?? '';
    document.getElementById('expense-amount').value     = e.amount ?? '';
    document.getElementById('expense-due').value        = e.due_date ?? '';
    document.getElementById('expense-modal-title').textContent = 'Editar Gasto';
    document.getElementById('overlay-expense').classList.remove('hidden');
  }
  async deleteExpense(id) {
    if (!confirm('¿Eliminar este gasto?')) return;
    await this.db.from('expenses').delete().eq('id', id);
    document.getElementById(`exp-row-${id}`)?.remove();
    showToast('Gasto eliminado', 'success');
  }

  // ══════════════════════════════════════════════════
  // P&L (preservado, fuente de verdad)
  // ══════════════════════════════════════════════════
  async loadPL() {
    const container = document.getElementById('stats-pl-panel');
    if (!container) return;
    container.innerHTML = `<div class="skeleton-box" style="height:320px"></div>`;
    const month = parseInt(document.getElementById('stats-month')?.value ?? new Date().getMonth());
    const year  = parseInt(document.getElementById('stats-year')?.value  ?? new Date().getFullYear());
    if (AppContext.IS_DEMO) {
      const { generateMockStats, generateMockExpenses, MOCK_COMMISSIONS } = await import('../services/mock-data.js');
      const stats    = generateMockStats(this.ctx.units);
      const expenses = generateMockExpenses();
      this._renderPL(stats.reduce((m,s)=>{m[s.unit.source??'direct']=(m[s.unit.source??'direct']??0)+s.revenue;return m;},{}), expenses, MOCK_COMMISSIONS, month, year);
      return;
    }
    const firstDay   = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const lastDay    = new Date(year,month+1,0);
    const lastDayStr = `${year}-${String(month+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
    const [bRes, eRes, cRes, cfgRes] = await Promise.all([
      this.db.from('bookings').select('source,total_amount,net_amount,commission_pct').eq('hotel_id',this.ctx.hotelId).not('status','in','(cancelled,blocked)').gte('check_in',firstDay).lte('check_in',lastDayStr),
      this.db.from('expenses').select('*').eq('hotel_id',this.ctx.hotelId).or(`due_date.is.null,and(due_date.gte.${firstDay},due_date.lte.${lastDayStr})`),
      this.db.from('channel_commissions').select('*').eq('hotel_id',this.ctx.hotelId).then(r => r).catch(() => ({ data: [] })),
      this.db.from('hotel_config').select('key,value').eq('hotel_id',this.ctx.hotelId).ilike('key','commission_%').then(r => r).catch(() => ({ data: [] })),
    ]);
    const revenueBySource = {};
    (bRes.data??[]).forEach(b=>{ const s=b.source??'direct'; revenueBySource[s]=(revenueBySource[s]??0)+(b.total_amount??0); });
    // Comisiones: prioridad channel_commissions → hotel_config → booking.commission_pct
    const commMap = {};
    (cRes.data??[]).forEach(c=>{ commMap[c.channel]=c.commission_pct; });
    // Fallback a hotel_config si channel_commissions está vacía
    if (!Object.keys(commMap).length) {
      (cfgRes.data??[]).forEach(row => {
        const channel = row.key.replace('commission_','');
        commMap[channel] = parseFloat(row.value) || 0;
      });
    }
    this._renderPL(revenueBySource, eRes.data??[], commMap, month, year);
  }

  _renderPL(revenueBySource, expenses, commMap, month, year) {
    const container = document.getElementById('stats-pl-panel');
    if (!container) return;
    const period = `${MONTH_NAMES[month]} ${year}`;
    let totalGross=0, totalComm=0;
    const sourceRows = Object.entries(revenueBySource).map(([src,gross])=>{
      const commPct=commMap[src]??0, comm=gross*(commPct/100), net=gross-comm;
      totalGross+=gross; totalComm+=comm;
      return { src, gross, comm, commPct, net };
    });
    const totalNet=totalGross-totalComm;
    const totalExpPaid=expenses.filter(e=>e.paid).reduce((s,e)=>s+e.amount,0);
    const totalExpAll=expenses.reduce((s,e)=>s+e.amount,0);
    const result=totalNet-totalExpPaid;
    const resultColor=result>=0?'var(--color-success)':'var(--color-danger)';
    const expByCategory={};
    expenses.forEach(e=>{ expByCategory[e.category]=(expByCategory[e.category]??0)+e.amount; });
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div><h3 style="font-size:1rem;font-weight:700">Estado de Resultados — ${period}</h3>
        <p style="font-size:.78rem;color:var(--color-text-3);margin-top:4px">Ingresos netos vs. gastos operativos</p></div>
        ${can('exportData')?`<button class="btn btn-outline btn-sm" id="btn-export-pl">📥 Exportar</button>`:''}
      </div>
      <div class="card" style="margin-bottom:16px">
        <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-3);margin-bottom:12px">Ingresos por canal</div>
        <table class="pl-table"><thead><tr><th>Canal</th><th>Bruto</th><th>Comisión</th><th>Neto</th></tr></thead>
        <tbody>${sourceRows.length?sourceRows.map(r=>`<tr><td>${SOURCE_LABELS[r.src]??r.src}</td><td>${formatARS(r.gross)}</td><td style="color:var(--color-danger)">${r.commPct>0?`−${formatARS(r.comm)} (${r.commPct}%)`:'—'}</td><td style="font-weight:600">${formatARS(r.net)}</td></tr>`).join(''):`<tr><td colspan="4" style="text-align:center;color:var(--color-text-3)">Sin reservas</td></tr>`}
        </tbody><tfoot><tr class="pl-total"><td><strong>TOTAL</strong></td><td><strong>${formatARS(totalGross)}</strong></td><td style="color:var(--color-danger)">${totalComm>0?`−${formatARS(totalComm)}`:'—'}</td><td style="color:var(--color-success)"><strong>${formatARS(totalNet)}</strong></td></tr></tfoot></table>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-3);margin-bottom:12px">Gastos operativos</div>
        <table class="pl-table"><thead><tr><th>Categoría</th><th>Total</th><th>Pagados</th><th>Pendientes</th></tr></thead>
        <tbody>${Object.entries(expByCategory).length?Object.entries(expByCategory).map(([cat,total])=>{const paid=expenses.filter(e=>e.category===cat&&e.paid).reduce((s,e)=>s+e.amount,0);return `<tr><td style="text-transform:capitalize">${cat}</td><td>${formatARS(total)}</td><td style="color:var(--color-success)">${formatARS(paid)}</td><td style="color:var(--color-warning)">${formatARS(total-paid)}</td></tr>`;}).join(''):`<tr><td colspan="4" style="text-align:center;color:var(--color-text-3)">Sin gastos</td></tr>`}
        </tbody><tfoot><tr class="pl-total"><td><strong>TOTAL GASTOS</strong></td><td><strong>${formatARS(totalExpAll)}</strong></td><td style="color:var(--color-success)"><strong>${formatARS(totalExpPaid)}</strong></td><td style="color:var(--color-warning)"><strong>${formatARS(totalExpAll-totalExpPaid)}</strong></td></tr></tfoot></table>
      </div>
      <div class="card" style="background:${result>=0?'rgba(34,197,94,.06)':'rgba(239,68,68,.06)'};border-color:${result>=0?'rgba(34,197,94,.2)':'rgba(239,68,68,.2)'}">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div><div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-3)">Resultado Neto del Período</div>
          <div style="font-size:.78rem;color:var(--color-text-3);margin-top:4px">${formatARS(totalNet)} − ${formatARS(totalExpPaid)} gastos</div></div>
          <div style="text-align:right"><div style="font-size:2rem;font-weight:800;color:${resultColor}">${result>=0?'+':''}${formatARS(result)}</div>
          <div style="font-size:.75rem;color:var(--color-text-3)">${period}</div></div>
        </div>
      </div>`;
    document.getElementById('btn-export-pl')?.addEventListener('click', async () => {
      const { exportPLCSV } = await import('../services/export-service.js');
      exportPLCSV(sourceRows.map(r=>({unit:{name:SOURCE_LABELS[r.src]??r.src,sort_order:0},revenue:r.net,nightsOcc:0,bookingCount:0,avgPricePerNight:0,occupancyPct:0})), expenses, commMap, month, year);
    });
  }

  // ══════════════════════════════════════════════════
  // EXPORTACIÓN
  // ══════════════════════════════════════════════════
  _exportExcel(stats, month, year) {
    const rows = [
      ['Unidad','Ocupación %','Noches','ADR','Reservas','Ingreso'],
      ...stats.map(s => [
        s.unit.name, s.occupancyPct, s.nightsOcc,
        s.avgPricePerNight, s.bookingCount, Math.round(s.revenue),
      ]),
    ];
    const csv   = rows.map(r => r.join(',')).join('\n');
    const blob  = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const link  = document.createElement('a');
    link.href   = URL.createObjectURL(blob);
    link.download = `mila-estadisticas-${MONTH_NAMES[month]}-${year}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  _exportPDF(stats, month, year, kpis) {
    const { ADR, RevPAR, avgOcc, totalRevenue, totalNights, daysInMonth } = kpis;
    const rows = stats.map(s => `
      <tr>
        <td>${s.unit.name}</td>
        <td>${s.occupancyPct}%</td>
        <td>${s.nightsOcc}</td>
        <td>${formatARS(s.avgPricePerNight)}</td>
        <td>${s.bookingCount}</td>
        <td>${formatARS(s.revenue)}</td>
      </tr>`).join('');

    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><title>MILA Estadísticas ${MONTH_NAMES[month]} ${year}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#1e293b}
        h1{font-size:18px;margin-bottom:4px}p{font-size:12px;color:#64748b;margin-bottom:20px}
        .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
        .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}
        .kpi-val{font-size:20px;font-weight:700;color:#1e293b}
        .kpi-lbl{font-size:11px;color:#64748b;margin-top:2px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th{background:#f1f5f9;text-align:left;padding:8px 10px;font-weight:600;border-bottom:1px solid #e2e8f0}
        td{padding:7px 10px;border-bottom:1px solid #f1f5f9}
        tfoot td{font-weight:700;background:#f8fafc}
        @media print{.no-print{display:none}}
      </style></head>
      <body>
        <h1>MILA · Estadísticas de Ocupación</h1>
        <p>${MONTH_NAMES[month]} ${year} · ${daysInMonth} días · ${this.ctx.units.length} unidades</p>
        <button class="no-print" onclick="window.print()" style="margin-bottom:20px;padding:8px 16px;background:#6366f1;color:#fff;border:none;border-radius:6px;cursor:pointer">Imprimir / Guardar PDF</button>
        <div class="kpis">
          <div class="kpi"><div class="kpi-val">${formatARS(totalRevenue)}</div><div class="kpi-lbl">Ingreso Bruto</div></div>
          <div class="kpi"><div class="kpi-val">${formatARS(ADR)}</div><div class="kpi-lbl">ADR</div></div>
          <div class="kpi"><div class="kpi-val">${formatARS(RevPAR)}</div><div class="kpi-lbl">RevPAR</div></div>
          <div class="kpi"><div class="kpi-val">${avgOcc}%</div><div class="kpi-lbl">Ocupación</div></div>
        </div>
        <table>
          <thead><tr><th>Unidad</th><th>Ocupación</th><th>Noches</th><th>ADR</th><th>Reservas</th><th>Ingreso</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr>
            <td>TOTAL</td><td>${avgOcc}%</td><td>${totalNights}</td>
            <td>${formatARS(ADR)}</td><td>${stats.reduce((s,u)=>s+u.bookingCount,0)}</td>
            <td>${formatARS(totalRevenue)}</td>
          </tr></tfoot>
        </table>
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }
  // ══════════════════════════════════════════════════
  // GRÁFICOS (SVG puro — sin dependencias)
  // ══════════════════════════════════════════════════
  async loadCharts() {
    const container = document.getElementById('charts-container');
    if (!container) return;
    container.innerHTML = '<p style="padding:20px;text-align:center;color:var(--color-text-3)">Cargando gráficos...</p>';

    const month    = parseInt(document.getElementById('stats-month')?.value ?? new Date().getMonth());
    const year     = parseInt(document.getElementById('stats-year')?.value  ?? new Date().getFullYear());
    const hotelId  = this.ctx.hotelId;

    try {
      // Últimos 12 meses de ingresos
      const months12 = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(year, month - i, 1);
        months12.push({ y: d.getFullYear(), m: d.getMonth() });
      }

      const monthlyData = await Promise.all(months12.map(async ({ y, m }) => {
        const first = `${y}-${String(m+1).padStart(2,'0')}-01`;
        const last  = new Date(y, m+1, 0);
        const lastStr = `${y}-${String(m+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`;
        const { data } = await this.db.from('bookings')
          .select('total_amount, status, source, nights')
          .eq('hotel_id', hotelId)
          .not('status','in','(cancelled,blocked)')
          .gte('check_in', first).lte('check_in', lastStr);
        const bookings = data ?? [];
        return {
          label: MONTH_NAMES[m].slice(0,3),
          revenue:    bookings.reduce((s,b) => s + (b.total_amount ?? 0), 0),
          count:      bookings.length,
          nights:     bookings.reduce((s,b) => s + (b.nights ?? 0), 0),
          bySource:   bookings.reduce((acc,b) => {
            acc[b.source ?? 'direct'] = (acc[b.source ?? 'direct'] ?? 0) + (b.total_amount ?? 0);
            return acc;
          }, {}),
        };
      }));

      // By channel for current month
      const curMonth  = monthlyData[11];
      const totalUnits = this.ctx.units.length || 1;

      // ── Render ──────────────────────────────────────
      container.innerHTML = `
        <div class="charts-grid">

          ${this._chartBarIncome(monthlyData)}
          ${this._chartChannelPie(curMonth)}
          ${this._chartOccupancy(monthlyData, totalUnits)}
          ${this._chartBookingCount(monthlyData)}

        </div>`;

    } catch (err) {
      container.innerHTML = `<p style="color:var(--color-danger);padding:20px">Error al cargar gráficos: ${err.message}</p>`;
    }
  }

  // ── Gráfico barras: Ingresos 12 meses ───────────
  _chartBarIncome(data) {
    const maxVal = Math.max(...data.map(d => d.revenue), 1);
    const bars   = data.map((d, i) => {
      const h      = Math.max(4, Math.round((d.revenue / maxVal) * 180));
      const isLast = i === data.length - 1;
      const color  = isLast ? 'var(--color-primary)' : 'rgba(99,102,241,.4)';
      const fmt    = n => '$' + Math.round(n/1000) + 'K';
      return `
        <g>
          <rect x="${i * 34 + 2}" y="${190 - h}" width="28" height="${h}"
                rx="4" fill="${color}" style="transition:height .5s ease"/>
          <text x="${i * 34 + 16}" y="205" text-anchor="middle"
                font-size="8" fill="var(--color-text-3)">${d.label}</text>
          ${isLast || d.revenue === maxVal ? `
            <text x="${i * 34 + 16}" y="${185 - h}" text-anchor="middle"
                  font-size="8" fill="var(--color-text-2)">${fmt(d.revenue)}</text>` : ''}
        </g>`;
    }).join('');

    return `
      <div class="chart-card">
        <div class="chart-title">Ingresos — últimos 12 meses</div>
        <div class="chart-total">${'$' + Math.round(data.reduce((s,d)=>s+d.revenue,0)/1000).toLocaleString('es-AR')}K total</div>
        <svg viewBox="0 0 ${data.length * 34 + 4} 215" style="width:100%;overflow:visible">
          ${bars}
          <line x1="0" y1="190" x2="${data.length * 34 + 4}" y2="190" stroke="var(--color-border)" stroke-width="1"/>
        </svg>
      </div>`;
  }

  // ── Gráfico horizontal: Por canal ───────────────
  _chartChannelPie(curData) {
    if (!curData) return '';
    const CHANNEL_COLORS = {
      direct:'#6366f1', walkin:'#0891b2', booking:'#1d4ed8',
      airbnb:'#ea580c', family:'#7c3aed', company:'#0f766e',
      referral:'#b45309', despegar:'#059669', expedia:'#dc2626',
    };
    const entries = Object.entries(curData.bySource ?? {})
      .sort(([,a],[,b]) => b - a).slice(0,7);
    const maxVal  = entries[0]?.[1] ?? 1;
    const fmt     = n => '$' + Math.round(n).toLocaleString('es-AR');

    const rows = entries.map(([src, val]) => {
      const pct   = Math.round((val / maxVal) * 100);
      const color = CHANNEL_COLORS[src] ?? '#94a3b8';
      const label = SOURCE_LABELS[src] ?? src;
      return `
        <div class="ch-row">
          <div class="ch-label">
            <span class="ch-dot" style="background:${color}"></span>${label}
          </div>
          <div class="ch-bar-track">
            <div class="ch-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <div class="ch-val">${fmt(val)}</div>
        </div>`;
    }).join('') || '<p style="color:var(--color-text-3);font-size:.8rem;padding:8px">Sin reservas en este período</p>';

    return `
      <div class="chart-card">
        <div class="chart-title">Ingresos por canal — ${curData.label ?? 'mes actual'}</div>
        <div style="margin-top:8px">${rows}</div>
      </div>`;
  }

  // ── Gráfico de línea: Reservas por mes ──────────
  _chartBookingCount(data) {
    const maxVal = Math.max(...data.map(d => d.count), 1);
    const w = 34, pad = 20;
    const points = data.map((d, i) => {
      const x = i * w + pad;
      const y = 120 - Math.round((d.count / maxVal) * 100);
      return `${x},${y}`;
    }).join(' ');
    const dots = data.map((d, i) => {
      const x = i * w + pad;
      const y = 120 - Math.round((d.count / maxVal) * 100);
      const isLast = i === data.length - 1;
      return `
        <circle cx="${x}" cy="${y}" r="${isLast ? 5 : 3}"
                fill="${isLast ? 'var(--color-primary)' : 'rgba(99,102,241,.6)'}"/>
        ${isLast || d.count === maxVal ? `
          <text x="${x}" y="${y - 8}" text-anchor="middle"
                font-size="9" fill="var(--color-text-2)">${d.count}</text>` : ''}
        <text x="${x}" y="132" text-anchor="middle"
              font-size="8" fill="var(--color-text-3)">${d.label}</text>`;
    }).join('');
    const totalCount = data.reduce((s,d) => s+d.count, 0);

    return `
      <div class="chart-card">
        <div class="chart-title">Cantidad de reservas — 12 meses</div>
        <div class="chart-total">${totalCount} reservas en el año</div>
        <svg viewBox="0 0 ${data.length * w + pad * 2} 145" style="width:100%">
          <polyline points="${points}" fill="none"
                    stroke="rgba(99,102,241,.5)" stroke-width="2" stroke-linejoin="round"/>
          ${dots}
          <line x1="${pad}" y1="122" x2="${data.length * w + pad}" y2="122"
                stroke="var(--color-border)" stroke-width="1"/>
        </svg>
      </div>`;
  }

  // ── Gráfico de línea: Ocupación mensual ─────────
  _chartOccupancy(data, totalUnits) {
    const daysInMonths = data.map(d => {
      const [y, m] = [2000 + parseInt(d.label), 0]; // placeholder - use actual data
      return 30; // approx
    });
    const occupancyData = data.map((d, i) => ({
      label: d.label,
      pct: totalUnits > 0 ? Math.min(100, Math.round((d.nights / (totalUnits * 30)) * 100)) : 0,
    }));
    const maxPct = 100;
    const w = 34, pad = 20;
    const points = occupancyData.map((d, i) => {
      const x = i * w + pad;
      const y = 110 - Math.round((d.pct / maxPct) * 90);
      return `${x},${y}`;
    }).join(' ');
    const dots = occupancyData.map((d, i) => {
      const x = i * w + pad;
      const y = 110 - Math.round((d.pct / maxPct) * 90);
      const isLast = i === occupancyData.length - 1;
      const color = d.pct >= 80 ? '#22c55e' : d.pct >= 50 ? '#f59e0b' : '#ef4444';
      return `
        <circle cx="${x}" cy="${y}" r="${isLast ? 5 : 3}" fill="${color}"/>
        ${(isLast || i % 3 === 0) ? `
          <text x="${x}" y="${y - 8}" text-anchor="middle"
                font-size="9" fill="var(--color-text-2)">${d.pct}%</text>` : ''}
        <text x="${x}" y="122" text-anchor="middle"
              font-size="8" fill="var(--color-text-3)">${d.label}</text>`;
    }).join('');
    const avgOcc = Math.round(occupancyData.reduce((s,d) => s+d.pct, 0) / occupancyData.length);

    return `
      <div class="chart-card">
        <div class="chart-title">Ocupación mensual</div>
        <div class="chart-total">Promedio: ${avgOcc}% — ${totalUnits} departamentos</div>
        <svg viewBox="0 0 ${occupancyData.length * w + pad * 2} 135" style="width:100%">
          <!-- Meta 80% -->
          <line x1="${pad}" y1="${110 - 72}" x2="${occupancyData.length * w + pad}" y2="${110 - 72}"
                stroke="rgba(34,197,94,.25)" stroke-width="1" stroke-dasharray="4,3"/>
          <text x="${pad - 2}" y="${110 - 70}" text-anchor="end" font-size="7"
                fill="rgba(34,197,94,.6)">80%</text>
          <polyline points="${points}" fill="none"
                    stroke="rgba(99,102,241,.5)" stroke-width="2" stroke-linejoin="round"/>
          ${dots}
          <line x1="${pad}" y1="112" x2="${occupancyData.length * w + pad}" y2="112"
                stroke="var(--color-border)" stroke-width="1"/>
        </svg>
      </div>`;
  }


}