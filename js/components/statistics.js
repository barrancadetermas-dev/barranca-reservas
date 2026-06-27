import { isDemo, can } from '../auth/permissions.js';
import { formatARS, showToast, getUnitLabel, getUnitColor, getUnitChipHTML, AppContext, localToday, localDateISO } from '../supabase-config.js';
import { RevenuePanel } from './revenue-panel.js';

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
    this.db           = supabase;
    this.ctx          = ctx;
    this._tab         = 'units';
    this._revenuePanel = new RevenuePanel(supabase, ctx);
    window._revenuePanel = this._revenuePanel;
    this._initPeriodSelectors();
    this._bindTabs();
    this._bindButtons();
    window._statsInstance = this;
  }

  init() {
    const now    = new Date();
    const saved  = JSON.parse(localStorage.getItem('mila_stats_period') ?? 'null');
    const month  = saved?.month ?? now.getMonth();
    const year   = saved?.year  ?? now.getFullYear();
    document.getElementById('stats-month').value = month;
    document.getElementById('stats-year').value  = year;
    this._tab = 'units';
    this.loadUnits();
  }

  _initPeriodSelectors() {
    const monthSel = document.getElementById('stats-month');
    const yearSel  = document.getElementById('stats-year');
    if (!monthSel || !yearSel) return;
    MONTH_NAMES.forEach((m, i) => { monthSel.innerHTML += `<option value="${i}">${m}</option>`; });
    const now = new Date(), curYear = now.getFullYear();
    for (let y = 2026; y <= curYear + 1; y++) {
      yearSel.innerHTML += `<option value="${y}" ${y === curYear ? 'selected' : ''}>${y}</option>`;
    }
    // Persistir selección al cambiar
    const savePeriod = () => {
      try {
        localStorage.setItem('mila_stats_period', JSON.stringify({
          month: parseInt(monthSel.value),
          year:  parseInt(yearSel.value),
        }));
      } catch {}
    };
    const reloadActive = () => {
      savePeriod();
      // Auto-reload the active tab when period changes
      if (this._tab === 'units')    this.loadUnits();
      else if (this._tab === 'charts')   this.loadCharts?.();
      else if (this._tab === 'pl')       this.loadPL?.();
      else if (this._tab === 'revenue')  this._revenuePanel?.load?.();
    };
    monthSel.addEventListener('change', reloadActive);
    yearSel.addEventListener('change',  reloadActive);
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
        if (this._tab === 'pl')       this.loadPL();
        if (this._tab === 'heatmap')  this.loadHeatmap();
        if (this._tab === 'charts')   this.loadCharts();
        if (this._tab === 'revenue')  this._revenuePanel?.load();
      });
    });
  }

  _showPanel(tab) {
    ['units','pl','heatmap','charts','revenue'].forEach(t => {
      document.getElementById(`stats-${t}-panel`)?.classList.toggle('hidden', t !== tab);
    });
  }

  _bindButtons() {
    document.getElementById('btn-load-stats')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-load-stats');
      if (btn) { btn.disabled = true; btn.textContent = 'Generando...'; }
      try {
        if (this._tab === 'units')    await this.loadUnits();
        else if (this._tab === 'heatmap')  await this.loadHeatmap?.();
        else if (this._tab === 'charts')   await this.loadCharts?.();
        else if (this._tab === 'pl')       await this.loadPL?.();
        else if (this._tab === 'revenue')  await this._revenuePanel?.load?.();
        else await this.loadUnits();
      } catch (err) {
        showToast('Error al generar reporte: ' + (err?.message ?? err), 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Generar Reporte'; }
      }
    });
    // Los gastos se gestionan desde el módulo Operaciones
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

    const firstDay    = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const lastDayObj  = new Date(year, month + 1, 0);
    const lastDayStr  = `${year}-${String(month+1).padStart(2,'0')}-${String(lastDayObj.getDate()).padStart(2,'0')}`;
    const daysInMonth = lastDayObj.getDate();

    try {
      const { data: bookings } = await this.db
        .from('bookings')
        .select('id, check_in, check_out, price_per_night, total_amount, status, nights, source, booking_units(unit_id)')
        .eq('hotel_id', this.ctx.hotelId)
        .neq('status', 'cancelled').neq('status', 'blocked')
        .lte('check_in', lastDayStr).gt('check_out', firstDay);

      this._lastBookings = bookings ?? []; // ← necesario para el gráfico de canales

      // Usar Web Worker para cálculos pesados si está disponible
      let stats;
      if (typeof Worker !== 'undefined') {
        stats = await this._computeViaWorker(bookings ?? [], firstDay, lastDayStr, daysInMonth);
      } else {
        stats = this._computeUnitStats(bookings ?? [], firstDay, lastDayStr, daysInMonth);
      }
      this._renderUnitStats(stats, month, year, daysInMonth);
    } catch (err) {
      console.error('[Statistics] loadUnits error:', err);
      showToast('Error al cargar estadísticas', 'error');
    }
  }

  /** Delegar cálculo al Web Worker */
  _computeViaWorker(bookings, firstDay, lastDay, daysInMonth) {
    return new Promise((resolve, reject) => {
      // Lazy-init worker
      if (!this._worker) {
        try {
          this._worker = new Worker(new URL('../workers/stats-worker.js', import.meta.url), { type: 'module' });
        } catch {
          // Fallback sincrónico si el worker no carga
          resolve(this._computeUnitStats(bookings, firstDay, lastDay, daysInMonth));
          return;
        }
      }
      const id = Date.now();
      const handler = ({ data }) => {
        if (data.id !== id) return;
        this._worker.removeEventListener('message', handler);
        if (data.error) reject(new Error(data.error));
        else resolve(data.result);
      };
      this._worker.addEventListener('message', handler);
      this._worker.postMessage({
        type: 'UNIT_STATS',
        id,
        payload: { bookings, units: this.ctx.units, firstDay, lastDay, daysInMonth },
      });
      // Timeout de seguridad
      setTimeout(() => {
        this._worker?.removeEventListener('message', handler);
        resolve(this._computeUnitStats(bookings, firstDay, lastDay, daysInMonth));
      }, 5000);
    });
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
    // Cachear para el dashboard de charts
    this._lastUnitStats = stats;
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

    let html = `
      <div class="stats-kpi-row">
        ${this._kpiCard('Ingreso bruto',  formatARS(totalRevenue), 'blue', 'vs periodo')}
        ${this._kpiCard('ADR',            formatARS(ADR),          'green',    'Tarifa prom. diaria')}
        ${this._kpiCard('RevPAR',         formatARS(RevPAR),       'purple',   'Ingreso por hab. disp.')}
        ${this._kpiCard('Ocupación',      avgOcc + '%',            avgOcc >= 70 ? 'green' : avgOcc >= 40 ? 'amber' : 'rose', `${totalNights} noches`)}
        ${this._kpiCard('Estadía prom.',  avgStay + ' noches',     'blue',     `${totalBookings} reservas`)}
        ${this._kpiCard('Unidades',       totalRooms,              'gray',     `${daysInMonth} días disponibles`)}
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
    const today = localToday();

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
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-3)">⟳ Cargando dashboard...</div>';

    const month   = parseInt(document.getElementById('stats-month')?.value ?? new Date().getMonth());
    const year    = parseInt(document.getElementById('stats-year')?.value  ?? new Date().getFullYear());
    const hotelId = this.ctx.hotelId;

    try {
      // Últimos 12 meses
      const months12 = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(year, month - i, 1);
        months12.push({ y: d.getFullYear(), m: d.getMonth() });
      }

      const monthlyData = await Promise.all(months12.map(async ({ y, m }) => {
        const first   = `${y}-${String(m+1).padStart(2,'0')}-01`;
        const lastDay = new Date(y, m+1, 0);
        const last    = `${y}-${String(m+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
        const { data } = await this.db.from('bookings')
          .select('total_amount, status, source, nights, price_per_night, booking_units(unit_id)')
          .eq('hotel_id', hotelId)
          .not('status', 'in', '(cancelled,blocked)')
          .gte('check_in', first).lte('check_in', last);
        const bks = data ?? [];
        return {
          label:    MONTH_NAMES[m].slice(0,3),
          fullLabel: `${MONTH_NAMES[m]} ${y}`,
          revenue:  bks.reduce((s,b) => s + (b.total_amount ?? 0), 0),
          count:    bks.length,
          nights:   bks.reduce((s,b) => s + (b.nights ?? 0), 0),
          avgPrice: bks.length > 0
            ? Math.round(bks.reduce((s,b) => s + (b.price_per_night ?? 0), 0) / bks.length)
            : 0,
          bySource: bks.reduce((acc,b) => {
            const src = b.source ?? 'direct';
            acc[src] = (acc[src] ?? 0) + (b.total_amount ?? 0);
            return acc;
          }, {}),
        };
      }));

      // Datos del mes actual
      const cur = monthlyData[11];
      const totalUnits = this.ctx.units.length || 1;
      const DAYS_IN_MONTH = new Date(year, month+1, 0).getDate();

      // RevPAR para cada mes
      const revParData = monthlyData.map(d => ({
        label: d.label,
        revpar: totalUnits > 0 ? Math.round(d.revenue / (totalUnits * 30)) : 0,
      }));

      // Promedios y tendencias
      const avgOcc = monthlyData.map(d =>
        totalUnits > 0 ? Math.min(100, Math.round((d.nights / (totalUnits * 30)) * 100)) : 0
      );
      const currentOcc  = avgOcc[11];
      const previousOcc = avgOcc[10];
      const totalRev    = monthlyData.reduce((s,d) => s+d.revenue, 0);
      const avgRevMonth = Math.round(totalRev / 12);
      const curRevDelta = cur.revenue > 0 && avgRevMonth > 0
        ? Math.round(((cur.revenue - avgRevMonth) / avgRevMonth) * 100)
        : 0;
      const totalBookings = monthlyData.reduce((s,d) => s+d.count, 0);

      // ADR (Average Daily Rate) por mes
      const adrData = monthlyData.map(d => ({
        label: d.label,
        adr: d.nights > 0 ? Math.round(d.revenue / d.nights) : 0,
      }));

      // Cancelaciones — consulta adicional
      let cancelCount = 0;
      try {
        const firstOfYear = `${year}-01-01`;
        const { count } = await this.db.from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('hotel_id', hotelId)
          .eq('status', 'cancelled')
          .gte('check_in', firstOfYear);
        cancelCount = count ?? 0;
      } catch { /* silencioso */ }

      const fmt    = n => '$' + Math.round(n).toLocaleString('es-AR');
      const fmtK   = n => '$' + (n >= 1000000 ? (n/1000000).toFixed(1)+'M' : Math.round(n/1000)+'K');

      container.innerHTML = `<div class="stats-dashboard-grid">
        ${this._sdcBarRevenue(monthlyData, fmtK, curRevDelta)}
        ${this._sdcLineOccupancy(avgOcc, monthlyData)}
        ${this._sdcDonutChannels(cur, fmt)}
        ${this._sdcAreaADR(adrData, fmt)}
        ${this._sdcBarCountBookings(monthlyData)}
        ${await this._sdcHorizUnits(month, year, fmt)}
        ${this._sdcRevPAR(revParData, fmtK, totalUnits)}
        ${this._sdcKPICard('Cancelaciones', cancelCount + ' este año', totalBookings, totalRev, fmt)}
        ${this._sdcAreaRevPARTrend(revParData, fmtK)}
      </div>`;

    } catch (err) {
      console.error('[Statistics] loadCharts error:', err);
      container.innerHTML = `<div class="error-state" style="padding:40px">
        <span class="error-icon">⚠️</span>
        <p>Error al cargar el dashboard: ${err.message}</p>
        <button class="btn btn-outline btn-sm" onclick="window._statsInstance?.loadCharts()">🔄 Reintentar</button>
      </div>`;
    }
  }

  // ── Card 1: Barras de Ingresos 12 meses ─────────
  _sdcBarRevenue(data, fmtK, delta) {
    const maxVal = Math.max(...data.map(d => d.revenue), 1);
    const total  = data.reduce((s,d) => s+d.revenue, 0);
    const bars   = data.map((d, i) => {
      const h      = Math.max(3, Math.round((d.revenue / maxVal) * 100));
      const isLast = i === data.length - 1;
      const color  = isLast ? 'var(--color-primary)' : 'rgba(99,102,241,.35)';
      return `<div class="sdc-bar" style="height:${h}%;background:${color}${isLast?';opacity:1':''}">
        <div class="sdc-bar-tooltip">${d.label}: ${fmtK(d.revenue)}</div>
      </div>`;
    }).join('');
    const deltaClass = delta >= 0 ? '' : 'down';
    return `<div class="stats-dashboard-card">
      <div class="sdc-header">
        <div>
          <div class="sdc-title">💰 Ingresos</div>
          <div class="sdc-value">${fmtK(data[11].revenue)}</div>
          <div class="sdc-sub">mes actual · ${fmtK(total)} acum. 12m</div>
        </div>
        <span class="sdc-delta ${deltaClass}">${delta >= 0 ? '+' : ''}${delta}%</span>
      </div>
      <div class="sdc-chart">${bars}</div>
    </div>`;
  }

  // ── Card 2: Línea de Ocupación ───────────────────
  _sdcLineOccupancy(occPct, monthlyData) {
    const avg  = Math.round(occPct.reduce((s,v) => s+v, 0) / occPct.length);
    const cur  = occPct[11];
    const prev = occPct[10];
    const delta = cur - prev;
    const W = 240, H = 90, pad = 10;
    const pts = occPct.map((v, i) => {
      const x = pad + (i / (occPct.length-1)) * (W - pad*2);
      const y = H - pad - (v/100) * (H - pad*2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const areaPath = `M${pad},${H-pad} ` +
      occPct.map((v, i) => {
        const x = pad + (i/(occPct.length-1)) * (W-pad*2);
        const y = H - pad - (v/100) * (H-pad*2);
        return `L${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ') +
      ` L${W-pad},${H-pad} Z`;
    const deltaClass = delta >= 0 ? '' : 'down';
    return `<div class="stats-dashboard-card">
      <div class="sdc-header">
        <div>
          <div class="sdc-title">📊 Ocupación</div>
          <div class="sdc-value">${cur}%</div>
          <div class="sdc-sub">mes actual · prom. ${avg}%</div>
        </div>
        <span class="sdc-delta ${deltaClass}">${delta >= 0 ? '+' : ''}${delta}%</span>
      </div>
      <div style="flex:1;display:flex;align-items:flex-end">
        <svg class="sdc-area-chart" viewBox="0 0 ${W} ${H}" style="overflow:visible">
          <defs><linearGradient id="occGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--color-primary)" stop-opacity=".3"/>
            <stop offset="100%" stop-color="var(--color-primary)" stop-opacity=".02"/>
          </linearGradient></defs>
          <!-- Meta 80% -->
          <line x1="${pad}" y1="${H-pad-(0.8*(H-pad*2)).toFixed(0)}" x2="${W-pad}" y2="${H-pad-(0.8*(H-pad*2)).toFixed(0)}"
                stroke="rgba(34,197,94,.3)" stroke-width="1" stroke-dasharray="3,2"/>
          <path d="${areaPath}" fill="url(#occGrad)"/>
          <polyline points="${pts}" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linejoin="round"/>
          ${occPct.map((v, i) => {
            if (i !== 11 && i % 3 !== 0) return '';
            const x = pad + (i/(occPct.length-1))*(W-pad*2);
            const y = H - pad - (v/100)*(H-pad*2);
            return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i===11?4:2.5}" fill="${i===11?'var(--color-primary)':'rgba(99,102,241,.5)'}"/>`;
          }).join('')}
        </svg>
      </div>
    </div>`;
  }

  // ── Card 3: Dona de canales ──────────────────────
  _sdcDonutChannels(cur, fmt) {
    const COLORS = {
      direct:'#6366f1',walkin:'#0891b2',booking:'#1d4ed8',
      airbnb:'#ea580c',family:'#7c3aed',company:'#0f766e',
      referral:'#b45309',despegar:'#059669',expedia:'#dc2626',
    };
    const NAMES = {
      direct:'Directo',walkin:'Espontáneo',booking:'Booking',
      airbnb:'Airbnb',family:'Familia',company:'Empresa',
      referral:'Referido',despegar:'Despegar',expedia:'Expedia',
    };
    const entries = Object.entries(cur?.bySource ?? {})
      .filter(([,v]) => v > 0)
      .sort(([,a],[,b]) => b - a).slice(0, 6);
    const total = entries.reduce((s,[,v]) => s+v, 0) || 1;

    // SVG donut
    const R = 36, r = 22, cx = 45, cy = 45;
    let startAngle = -Math.PI/2;
    const segments = entries.map(([src, val]) => {
      const frac  = val / total;
      const sweep = frac * 2 * Math.PI;
      const x1 = cx + R * Math.cos(startAngle);
      const y1 = cy + R * Math.sin(startAngle);
      const x2 = cx + R * Math.cos(startAngle + sweep);
      const y2 = cy + R * Math.sin(startAngle + sweep);
      const x3 = cx + r * Math.cos(startAngle + sweep);
      const y3 = cy + r * Math.sin(startAngle + sweep);
      const x4 = cx + r * Math.cos(startAngle);
      const y4 = cy + r * Math.sin(startAngle);
      const large = sweep > Math.PI ? 1 : 0;
      const path = `M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large},1 ${x2.toFixed(1)},${y2.toFixed(1)} L${x3.toFixed(1)},${y3.toFixed(1)} A${r},${r} 0 ${large},0 ${x4.toFixed(1)},${y4.toFixed(1)} Z`;
      const seg = `<path d="${path}" fill="${COLORS[src]??'#94a3b8'}" opacity=".85">
        <title>${NAMES[src]??src}: ${fmt(val)}</title></path>`;
      startAngle += sweep;
      return { seg, src, val };
    });

    const donut = `<svg viewBox="0 0 90 90" width="90" height="90">
      ${segments.map(s => s.seg).join('')}
      <text x="${cx}" y="${cy+3}" text-anchor="middle" font-size="9" font-weight="700" fill="var(--color-text)">${fmt(total).replace('$','$')}</text>
    </svg>`;

    const legend = segments.slice(0, 4).map(({src, val}) =>
      `<div class="sdc-legend-item">
        <div class="sdc-legend-dot" style="background:${COLORS[src]??'#94a3b8'}"></div>
        <span style="flex:1">${NAMES[src]??src}</span>
        <strong>${Math.round((val/total)*100)}%</strong>
      </div>`
    ).join('');

    return `<div class="stats-dashboard-card">
      <div class="sdc-header"><div>
        <div class="sdc-title">🔗 Canales</div>
        <div class="sdc-sub">mes actual</div>
      </div></div>
      <div class="sdc-donut-wrap">
        ${total > 0 ? donut : '<div style="color:var(--color-text-3);font-size:.8rem;padding:16px">Sin datos</div>'}
        <div class="sdc-donut-legend">${legend}</div>
      </div>
    </div>`;
  }

  // ── Card 4: Área ADR 12 meses ────────────────────
  _sdcAreaADR(adrData, fmt) {
    const maxADR = Math.max(...adrData.map(d => d.adr), 1);
    const curADR = adrData[11].adr;
    const W = 240, H = 90, pad = 10;
    const pts = adrData.map((d, i) => {
      const x = pad + (i / (adrData.length-1)) * (W-pad*2);
      const y = H - pad - (d.adr / maxADR) * (H-pad*2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const areaPath = `M${pad},${H-pad} ` +
      adrData.map((d, i) => {
        const x = pad + (i/(adrData.length-1))*(W-pad*2);
        const y = H - pad - (d.adr/maxADR)*(H-pad*2);
        return `L${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ') + ` L${W-pad},${H-pad} Z`;

    return `<div class="stats-dashboard-card">
      <div class="sdc-header"><div>
        <div class="sdc-title">💵 ADR — Tarifa Diaria</div>
        <div class="sdc-value">${fmt(curADR)}</div>
        <div class="sdc-sub">por noche ocupada</div>
      </div></div>
      <div style="flex:1;display:flex;align-items:flex-end">
        <svg class="sdc-area-chart" viewBox="0 0 ${W} ${H}">
          <defs><linearGradient id="adrGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f59e0b" stop-opacity=".4"/>
            <stop offset="100%" stop-color="#f59e0b" stop-opacity=".02"/>
          </linearGradient></defs>
          <path d="${areaPath}" fill="url(#adrGrad)"/>
          <polyline points="${pts}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linejoin="round"/>
          ${adrData.map((d, i) => {
            if (i !== 11) return '';
            const x = pad + (i/(adrData.length-1))*(W-pad*2);
            const y = H - pad - (d.adr/maxADR)*(H-pad*2);
            return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#f59e0b"/>`;
          }).join('')}
        </svg>
      </div>
    </div>`;
  }

  // ── Card 5: Barras de cantidad de reservas ───────
  _sdcBarCountBookings(data) {
    const maxVal = Math.max(...data.map(d => d.count), 1);
    const total  = data.reduce((s,d) => s+d.count, 0);
    const avgMonth = Math.round(total / data.length);
    const bars = data.map((d, i) => {
      const h     = Math.max(3, Math.round((d.count / maxVal) * 100));
      const isLast = i === data.length - 1;
      const color  = d.count >= avgMonth ? '#22c55e' : '#94a3b8';
      return `<div class="sdc-bar" style="height:${h}%;background:${isLast ? color : color + '80'}">
        <div class="sdc-bar-tooltip">${d.label}: ${d.count} reservas</div>
      </div>`;
    }).join('');
    return `<div class="stats-dashboard-card">
      <div class="sdc-header"><div>
        <div class="sdc-title">📋 Reservas</div>
        <div class="sdc-value">${data[11].count}</div>
        <div class="sdc-sub">este mes · ${total} en 12 meses</div>
      </div></div>
      <div class="sdc-chart">${bars}</div>
    </div>`;
  }

  // ── Card 6: Horizontal — top departamentos ───────
  async _sdcHorizUnits(month, year, fmt) {
    const unitStats = (this.ctx.units ?? []).map(u => ({
      id: u.id, name: u.name, color: getUnitColor(u), rev: 0, nights: 0,
    }));
    // Matchear por unit.id (no por índice) para evitar asignación errónea
    const cached = this._lastUnitStats;
    if (cached?.length) {
      cached.forEach(s => {
        const entry = unitStats.find(u => u.id === s.unit?.id);
        if (entry) { entry.rev = s.revenue ?? 0; entry.nights = s.nightsOcc ?? 0; }
      });
    } else {
      // Sin caché: consulta directa al mes actual
      try {
        const first = `${year}-${String(month+1).padStart(2,'0')}-01`;
        const last  = new Date(Date.UTC(year, month+1, 0)).toISOString().slice(0,10);
        const { data: bks } = await this.db.from('bookings')
          .select('total_amount, nights, booking_units(unit_id)')
          .eq('hotel_id', this.ctx.hotelId)
          .not('status','in','(cancelled,blocked)')
          .gte('check_in', first).lte('check_in', last);
        (bks ?? []).forEach(b => {
          (b.booking_units ?? []).forEach(bu => {
            const entry = unitStats.find(u => u.id === bu.unit_id);
            if (entry) { entry.rev += b.total_amount ?? 0; entry.nights += b.nights ?? 0; }
          });
        });
      } catch { /* silencioso */ }
    }
    const sorted = [...unitStats].sort((a,b) => b.rev - a.rev);
    const maxRev = sorted[0]?.rev ?? 1;

    if (!maxRev) {
      return `<div class="stats-dashboard-card">
        <div class="sdc-header"><div>
          <div class="sdc-title">🛏️ Departamentos</div>
          <div class="sdc-sub">Cargá primero la pestaña Unidades</div>
        </div></div>
        <div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--color-text-3);font-size:.8rem">
          Sin datos — cargá la pestaña Unidades primero
        </div>
      </div>`;
    }

    const bars = sorted.map(u => {
      const pct = Math.max(2, Math.round((u.rev / maxRev) * 100));
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <div style="width:80px;font-size:.7rem;color:var(--color-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.name.replace("Planta Baja","P. Baja").replace("Planta Alta","P. Alta")}</div>
        <div style="flex:1;height:8px;background:var(--color-surface-2);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${u.color};border-radius:4px;transition:width .6s"></div>
        </div>
        <div style="width:60px;text-align:right;font-size:.7rem;font-weight:700;color:${u.color}">${fmt(u.rev)}</div>
      </div>`;
    }).join('');

    return `<div class="stats-dashboard-card">
      <div class="sdc-header"><div>
        <div class="sdc-title">🛏️ Ingreso por Depto.</div>
        <div class="sdc-sub">mes seleccionado</div>
      </div></div>
      <div style="flex:1;padding-top:8px">${bars || '<div style="color:var(--color-text-3);font-size:.8rem">Sin datos</div>'}</div>
    </div>`;
  }

  // ── Card 7: RevPAR 12 meses ──────────────────────
  _sdcRevPAR(data, fmtK, totalUnits) {
    const maxVal = Math.max(...data.map(d => d.revpar), 1);
    const curVal = data[11].revpar;
    const W = 240, H = 70, pad = 8;
    const pts = data.map((d, i) => {
      const x = pad + (i/(data.length-1))*(W-pad*2);
      const y = H - pad - (d.revpar/maxVal)*(H-pad*2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<div class="stats-dashboard-card">
      <div class="sdc-header"><div>
        <div class="sdc-title">📈 RevPAR</div>
        <div class="sdc-value">${fmtK(curVal)}</div>
        <div class="sdc-sub">ingreso por hab. disp. · ${totalUnits} deptos.</div>
      </div></div>
      <div style="flex:1;display:flex;align-items:flex-end">
        <svg class="sdc-area-chart" viewBox="0 0 ${W} ${H}" style="height:70px">
          <defs><linearGradient id="rpGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#8b5cf6" stop-opacity=".4"/>
            <stop offset="100%" stop-color="#8b5cf6" stop-opacity=".02"/>
          </linearGradient></defs>
          <path d="M${pad},${H-pad} ${data.map((d,i) => {
            const x = pad+(i/(data.length-1))*(W-pad*2);
            const y = H-pad-(d.revpar/maxVal)*(H-pad*2);
            return `L${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(' ')} L${W-pad},${H-pad} Z" fill="url(#rpGrad)"/>
          <polyline points="${pts}" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>`;
  }

  // ── Card 8: KPI Cancelaciones + estadías prom. ───
  _sdcKPICard(title, value, totalBookings, totalRev, fmt) {
    const avgRev = totalBookings > 0 ? Math.round(totalRev / totalBookings) : 0;
    return `<div class="stats-dashboard-card">
      <div class="sdc-header"><div>
        <div class="sdc-title">❌ Cancelaciones</div>
        <div class="sdc-value" style="color:var(--color-danger)">${value}</div>
        <div class="sdc-sub">en el año calendario</div>
      </div></div>
      <div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:12px">
        <div style="background:var(--color-surface-2);border-radius:var(--r-md);padding:12px">
          <div style="font-size:.7rem;color:var(--color-text-3);margin-bottom:4px">TICKET PROMEDIO</div>
          <div style="font-size:1.1rem;font-weight:700">${fmt(avgRev)}</div>
          <div style="font-size:.72rem;color:var(--color-text-3)">${totalBookings} reservas · 12 meses</div>
        </div>
      </div>
    </div>`;
  }

  // ── Card 9: Tendencia RevPAR con área ────────────
  _sdcAreaRevPARTrend(data, fmtK) {
    const maxVal = Math.max(...data.map(d => d.revpar), 1);
    const total  = data.reduce((s,d) => s+d.revpar, 0);
    const W = 240, H = 90, pad = 10;
    const areaPath = `M${pad},${H-pad} ` +
      data.map((d,i) => {
        const x = pad+(i/(data.length-1))*(W-pad*2);
        const y = H-pad-(d.revpar/maxVal)*(H-pad*2);
        return `L${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ') + ` L${W-pad},${H-pad} Z`;
    const pts = data.map((d,i) => {
      const x = pad+(i/(data.length-1))*(W-pad*2);
      const y = H-pad-(d.revpar/maxVal)*(H-pad*2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const labels = data.filter((_,i) => i % 3 === 0 || i === data.length-1);
    return `<div class="stats-dashboard-card">
      <div class="sdc-header"><div>
        <div class="sdc-title">📉 Evolución RevPAR</div>
        <div class="sdc-value">${fmtK(Math.round(total/12))}</div>
        <div class="sdc-sub">promedio mensual 12 meses</div>
      </div></div>
      <div style="flex:1;display:flex;align-items:flex-end">
        <svg class="sdc-area-chart" viewBox="0 0 ${W} ${H}">
          <defs><linearGradient id="rpEvGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#06b6d4" stop-opacity=".4"/>
            <stop offset="100%" stop-color="#06b6d4" stop-opacity=".02"/>
          </linearGradient></defs>
          <path d="${areaPath}" fill="url(#rpEvGrad)"/>
          <polyline points="${pts}" fill="none" stroke="#06b6d4" stroke-width="2.5" stroke-linejoin="round"/>
          ${data.map((d,i) => {
            if (i !== data.length-1 && i % 3 !== 0) return '';
            const x = pad+(i/(data.length-1))*(W-pad*2);
            const y = H-pad-(d.revpar/maxVal)*(H-pad*2);
            return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i===data.length-1?4:2}" fill="#06b6d4"/>
              <text x="${x.toFixed(1)}" y="${H}" text-anchor="middle" font-size="7" fill="var(--color-text-3)">${d.label}</text>`;
          }).join('')}
        </svg>
      </div>
    </div>`;
  }


}
