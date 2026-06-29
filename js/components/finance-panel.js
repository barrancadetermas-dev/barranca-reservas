// ═══════════════════════════════════════════════════
// finance-panel.js — Panel Financiero MILA PMS
// Dinero asegurado · Cobrado · Pendiente · Gráfico
// ═══════════════════════════════════════════════════

import { formatARS, showToast, localToday } from '../supabase-config.js';

const PERIOD_PRESETS = [
  { id: 'today',  label: 'Hoy'     },
  { id: 'week',   label: 'Semana'  },
  { id: 'month',  label: 'Mes'     },
  { id: 'year',   label: 'Año'     },
  { id: 'custom', label: 'Rango'   },
];

export class FinancePanel {
  constructor(supabase, ctx) {
    this.db    = supabase;
    this.ctx   = ctx;
    this._period = 'month';
    this._from   = null;
    this._to     = null;
  }

  async load() {
    const container = document.getElementById('financ-container');
    if (!container) return;
    container.innerHTML = this._buildShell();
    this._bindPeriod(container);
    await this._fetchAndRender(container);
  }

  _buildShell() {
    const n = new Date();
    const today = n.getFullYear() + '-' + String(n.getMonth()+1).padStart(2,'0') + '-' + String(n.getDate()).padStart(2,'0');
    return `
    <div id="financ-shell">
      <!-- Selector de período -->
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
        <span style="font-size:.72rem;color:var(--color-text-3);font-weight:600;text-transform:uppercase;letter-spacing:.05em">Período:</span>
        ${PERIOD_PRESETS.map(p =>
          '<button class="fin-period-btn' + (p.id === 'month' ? ' active' : '') + '" data-period="' + p.id + '">' + p.label + '</button>'
        ).join('')}
        <div id="fin-custom-range" style="display:none;gap:6px;align-items:center">
          <input type="date" id="fin-from" value="${today}" style="font-size:.75rem;padding:3px 8px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-surface);color:var(--color-text)">
          <span style="font-size:.72rem;color:var(--color-text-3)">→</span>
          <input type="date" id="fin-to"   value="${today}" style="font-size:.75rem;padding:3px 8px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-surface);color:var(--color-text)">
          <button class="fin-period-btn" id="fin-apply-range">Aplicar</button>
        </div>
      </div>
      <!-- KPIs principales -->
      <div id="financ-kpis" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px"></div>
      <!-- Gráfico SVG -->
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:16px 20px">
          <div style="font-size:.72rem;font-weight:700;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.05em">Distribución financiera</div>
          <div style="font-size:.65rem;color:var(--color-text-3);margin-bottom:12px;margin-top:1px">Mes en curso</div>
          <div id="financ-chart"></div>
        </div>
        <div class="card" style="padding:16px 20px">
          <div style="font-size:.72rem;font-weight:700;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.05em">Dinero asegurado</div>
          <div style="font-size:.65rem;color:var(--color-text-3);margin-bottom:12px;margin-top:1px">Reservas futuras · todas</div>
          <div id="financ-asegurado"></div>
        </div>
      </div>
      <!-- Indicadores adicionales -->
      <div id="financ-indicators" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px"></div>
    </div>`;
  }

  _bindPeriod(container) {
    container.querySelectorAll('.fin-period-btn[data-period]').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.fin-period-btn[data-period]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._period = btn.dataset.period;
        const cr = document.getElementById('fin-custom-range');
        if (cr) cr.style.display = this._period === 'custom' ? 'flex' : 'none';
        if (this._period !== 'custom') this._fetchAndRender(container);
      });
    });
    document.getElementById('fin-apply-range')?.addEventListener('click', () => {
      this._from = document.getElementById('fin-from')?.value ?? null;
      this._to   = document.getElementById('fin-to')?.value   ?? null;
      this._fetchAndRender(container);
    });
  }

  _getDateRange() {
    const n     = new Date();
    const today = n.getFullYear() + '-' + String(n.getMonth()+1).padStart(2,'0') + '-' + String(n.getDate()).padStart(2,'0');
    const d     = new Date(today + 'T12:00:00');
    if (this._period === 'today') return [today, today];
    if (this._period === 'week') {
      const dow  = (d.getDay() + 6) % 7; // lunes=0
      const from = new Date(d); from.setDate(d.getDate() - dow);
      const to   = new Date(from); to.setDate(from.getDate() + 6);
      return [from.toISOString().slice(0,10), to.toISOString().slice(0,10)];
    }
    if (this._period === 'month') {
      const y = d.getFullYear(), m = d.getMonth();
      const last = new Date(y, m+1, 0);
      return [`${y}-${String(m+1).padStart(2,'0')}-01`, last.toISOString().slice(0,10)];
    }
    if (this._period === 'year') {
      return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`];
    }
    if (this._period === 'custom' && this._from && this._to) return [this._from, this._to];
    return [today, today];
  }

  async _fetchAndRender(container) {
    const [from, to] = this._getDateRange();
    // Fecha de hoy inline (sin depender del import para robustez)
    const n     = new Date();
    const today = n.getFullYear() + '-' + String(n.getMonth()+1).padStart(2,'0') + '-' + String(n.getDate()).padStart(2,'0');

    const loading = '<div style="padding:32px;text-align:center;color:var(--color-text-3)">⟳ Calculando...</div>';
    ['financ-kpis','financ-chart','financ-asegurado','financ-indicators'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = loading;
    });

    try {
      // Reservas del período + máxima reserva con nombre del huésped
      const [periodoRes, futuroRes, maxBkRes] = await Promise.all([
        // Período seleccionado: todas las reservas que INICIAN en el rango
        this.db.from('bookings')
          .select('id,total_amount,total_paid,balance,nights,price_per_night,check_in,check_out,status')
          .eq('hotel_id', this.ctx.hotelId)
          .gte('check_in', from)
          .lte('check_in', to)
          .not('status','in','(cancelled,blocked)'),
        // Dinero asegurado = TODAS las reservas futuras (check_in >= hoy)
        this.db.from('bookings')
          .select('id,total_amount,total_paid,status')
          .eq('hotel_id', this.ctx.hotelId)
          .gte('check_in', today)
          .not('status','in','(cancelled,blocked)'),
        // Mayor reserva del período (con nombre del huésped)
        this.db.from('bookings')
          .select('id,total_amount,guests!bookings_guest_id_fkey(first_name,last_name)')
          .eq('hotel_id', this.ctx.hotelId)
          .gte('check_in', from)
          .lte('check_in', to)
          .not('status','in','(cancelled,blocked)')
          .order('total_amount', { ascending: false })
          .limit(1),
      ]);

      if (periodoRes.error) throw periodoRes.error;

      const bks    = periodoRes.data ?? [];
      const futuro = futuroRes.data ?? [];
      const maxBk  = maxBkRes.data?.[0] ?? null;

      // ── Métricas del período ──
      const totalVend  = bks.reduce((s,b) => s + (b.total_amount ?? 0), 0);
      const totalCobr  = bks.reduce((s,b) => s + (b.total_paid  ?? 0), 0);
      const totalPend  = bks.reduce((s,b) => s + Math.max(0,(b.total_amount??0)-(b.total_paid??0)), 0);
      const totalNoch  = bks.reduce((s,b) => s + (b.nights ?? 0), 0);
      const pctCobr    = totalVend > 0 ? Math.round(totalCobr / totalVend * 100) : 0;
      // maxBk viene de la query separada (con nombre del huésped)
      const avgBk      = bks.length > 0 ? totalVend / bks.length : 0;
      const avgNoche   = totalNoch > 0 ? totalVend / totalNoch : 0;
      const avgPend    = bks.length > 0 ? totalPend / bks.length : 0;

      // ── Métricas dinero asegurado ──
      const asegVend   = futuro.reduce((s,b) => s + (b.total_amount??0), 0);
      const asegCobr   = futuro.reduce((s,b) => s + (b.total_paid??0), 0);
      const asegPend   = asegVend - asegCobr;
      const asegPct    = asegVend > 0 ? Math.round(asegCobr / asegVend * 100) : 0;

      this._renderKPIs({ totalVend, totalCobr, totalPend, pctCobr, count: bks.length });
      this._renderChart({ totalVend, totalCobr, totalPend });
      this._renderAsegurado({ asegVend, asegCobr, asegPend, asegPct, count: futuro.length });
      this._renderIndicators({ maxBk, avgBk, avgNoche, avgPend, totalNoch, count: bks.length });

    } catch (err) {
      console.error('[FinancePanel]', err);
      showToast('Error al cargar datos financieros', 'error');
    }
  }

  _renderKPIs({ totalVend, totalCobr, totalPend, pctCobr, count }) {
    const el = document.getElementById('financ-kpis');
    if (!el) return;
    const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
    const kpi = (label, val, sub, color, bg) =>
      '<div class="card" style="padding:14px 16px;border-left:3px solid ' + color + '">' +
        '<div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-3);margin-bottom:6px">' + label + '</div>' +
        '<div style="font-size:1.35rem;font-weight:800;color:' + color + ';line-height:1">' + val + '</div>' +
        '<div style="font-size:.72rem;color:var(--color-text-3);margin-top:4px">' + sub + '</div>' +
      '</div>';
    el.innerHTML =
      kpi('Total vendido',    fmt(totalVend),  count + ' reserva' + (count!==1?'s':''), 'var(--color-primary)', '') +
      kpi('Total cobrado',    fmt(totalCobr),  pctCobr + '% del total vendido',         '#16a34a',               '') +
      kpi('Por cobrar',       fmt(totalPend),  'pendiente de ingreso',                   '#f59e0b',               '') +
      kpi('% Cobrado',        pctCobr + '%',  fmt(totalCobr) + ' / ' + fmt(totalVend), pctCobr >= 80 ? '#16a34a' : pctCobr >= 50 ? '#f59e0b' : '#ef4444', '');
  }

  _renderChart({ totalVend, totalCobr, totalPend }) {
    const el = document.getElementById('financ-chart');
    if (!el) return;
    const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
    const max = totalVend || 1;
    const bar = (label, val, color) => {
      const pct = Math.round(val / max * 100);
      return '<div style="margin-bottom:12px">' +
        '<div style="display:flex;justify-content:space-between;font-size:.72rem;margin-bottom:4px">' +
          '<span style="color:var(--color-text-2);font-weight:600">' + label + '</span>' +
          '<span style="font-weight:800;color:' + color + '">' + fmt(val) + '</span>' +
        '</div>' +
        '<div style="height:10px;border-radius:5px;background:var(--color-border);overflow:hidden">' +
          '<div style="height:100%;border-radius:5px;background:' + color + ';width:' + pct + '%;transition:width .6s cubic-bezier(.4,0,.2,1)"></div>' +
        '</div>' +
        '<div style="font-size:.62rem;color:var(--color-text-3);margin-top:2px">' + pct + '% del total</div>' +
      '</div>';
    };
    el.innerHTML =
      bar('Total vendido',    totalVend, 'var(--color-primary)') +
      bar('Cobrado',          totalCobr, '#16a34a') +
      bar('Pendiente de cobro', totalPend, '#f59e0b');
  }

  _renderAsegurado({ asegVend, asegCobr, asegPend, asegPct, count }) {
    const el = document.getElementById('financ-asegurado');
    if (!el) return;
    const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
    el.innerHTML =
      '<div style="font-size:1.25rem;font-weight:800;color:var(--color-text);margin-bottom:4px">' + fmt(asegVend) + '</div>' +
      '<div style="font-size:.7rem;color:var(--color-text-3);margin-bottom:12px">' + count + ' reservas futuras confirmadas</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px">' +
        '<div style="display:flex;justify-content:space-between;font-size:.75rem"><span style="color:var(--color-text-3)">Ya cobrado</span><span style="font-weight:700;color:#16a34a">' + fmt(asegCobr) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;font-size:.75rem"><span style="color:var(--color-text-3)">Por cobrar</span><span style="font-weight:700;color:#f59e0b">' + fmt(asegPend) + '</span></div>' +
      '</div>' +
      '<div style="margin-top:10px;height:8px;border-radius:4px;background:var(--color-border);overflow:hidden">' +
        '<div style="height:100%;background:#16a34a;border-radius:4px;width:' + asegPct + '%;transition:width .6s"></div>' +
      '</div>' +
      '<div style="font-size:.68rem;color:var(--color-text-3);margin-top:5px">' + asegPct + '% cobrado del dinero comprometido</div>';
  }

  _renderIndicators({ maxBk, avgBk, avgNoche, avgPend, totalNoch, count }) {
    const el = document.getElementById('financ-indicators');
    if (!el) return;
    const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
    const maxGuest = maxBk?.guests ? ((maxBk.guests.first_name ?? '') + ' ' + (maxBk.guests.last_name ?? '')).trim() || '—' : '—';
    const ind = (icon, label, val, sub) =>
      '<div class="card" style="padding:12px 14px;display:flex;align-items:flex-start;gap:10px">' +
        '<span style="font-size:1.2rem;flex-shrink:0">' + icon + '</span>' +
        '<div style="min-width:0">' +
          '<div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-3);font-weight:700;margin-bottom:2px">' + label + '</div>' +
          '<div style="font-size:.9rem;font-weight:800;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + val + '</div>' +
          (sub ? '<div style="font-size:.65rem;color:var(--color-text-3);margin-top:1px">' + sub + '</div>' : '') +
        '</div>' +
      '</div>';
    el.innerHTML =
      ind('🏆', 'Mayor reserva',       fmt(maxBk?.total_amount ?? 0), maxGuest) +
      ind('📊', 'Promedio por reserva', fmt(avgBk),   count + ' reservas en el período') +
      ind('🌙', 'Ingreso/noche',        fmt(avgNoche), totalNoch + ' noches vendidas') +
      ind('⏳', 'Saldo pend. promedio', fmt(avgPend),  'por reserva del período');
  }
}
