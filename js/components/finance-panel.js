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

  // ── Rango equivalente del período INMEDIATO ANTERIOR (para % variación) ──
  _getPreviousDateRange() {
    const [from, to] = this._getDateRange();
    const fromD = new Date(from + 'T12:00:00');
    const toD   = new Date(to   + 'T12:00:00');

    if (this._period === 'today') {
      const prev = new Date(fromD); prev.setDate(prev.getDate() - 1);
      const s = prev.toISOString().slice(0,10);
      return [s, s];
    }
    if (this._period === 'week') {
      const pf = new Date(fromD); pf.setDate(pf.getDate() - 7);
      const pt = new Date(toD);   pt.setDate(pt.getDate() - 7);
      return [pf.toISOString().slice(0,10), pt.toISOString().slice(0,10)];
    }
    if (this._period === 'month') {
      const y = fromD.getFullYear(), m = fromD.getMonth();
      const prevFirst = new Date(y, m - 1, 1);
      const prevLast  = new Date(y, m, 0);
      return [
        `${prevFirst.getFullYear()}-${String(prevFirst.getMonth()+1).padStart(2,'0')}-01`,
        prevLast.toISOString().slice(0,10),
      ];
    }
    if (this._period === 'year') {
      const y = fromD.getFullYear() - 1;
      return [`${y}-01-01`, `${y}-12-31`];
    }
    // custom o fallback: mismo largo de días, inmediatamente antes
    const lengthDays = Math.round((toD - fromD) / 86400000) + 1;
    const pt = new Date(fromD); pt.setDate(pt.getDate() - 1);
    const pf = new Date(pt);    pf.setDate(pf.getDate() - lengthDays + 1);
    return [pf.toISOString().slice(0,10), pt.toISOString().slice(0,10)];
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
      const [periodoRes, futuroRes, maxBkRes, prevRes] = await Promise.all([
        // Período seleccionado: todas las reservas que INICIAN en el rango
        // Incluye created_at (anticipación) y booking_units con unit_id (unidad más rentable)
        this.db.from('bookings')
          .select('id,total_amount,total_paid,balance,nights,price_per_night,check_in,check_out,status,created_at,booking_units(unit_id,units(name,color))')
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
        // Período anterior equivalente (para % variación)
        (async () => {
          const [pf, pt] = this._getPreviousDateRange();
          return this.db.from('bookings')
            .select('id,total_amount')
            .eq('hotel_id', this.ctx.hotelId)
            .gte('check_in', pf)
            .lte('check_in', pt)
            .not('status','in','(cancelled,blocked)');
        })(),
      ]);

      if (periodoRes.error) throw periodoRes.error;

      const bks    = periodoRes.data ?? [];
      const futuro = futuroRes.data ?? [];
      const maxBk  = maxBkRes.data?.[0] ?? null;
      const prevBks = prevRes.data ?? [];

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

      // ── B: Unidad más rentable del período ──
      // Si una reserva tiene varias unidades, se reparte el monto en partes iguales entre ellas
      const unitRevMap = new Map(); // unit_id -> {name,color,total}
      bks.forEach(b => {
        const units = b.booking_units ?? [];
        if (!units.length) return;
        const share = (b.total_amount ?? 0) / units.length;
        units.forEach(bu => {
          if (!bu.unit_id) return;
          const cur = unitRevMap.get(bu.unit_id) ?? { name: bu.units?.name ?? '—', color: bu.units?.color ?? 'var(--color-primary)', total: 0 };
          cur.total += share;
          unitRevMap.set(bu.unit_id, cur);
        });
      });
      const topUnit = [...unitRevMap.values()].sort((a,b) => b.total - a.total)[0] ?? null;

      // ── D: Variación vs período anterior ──
      const prevTotal = prevBks.reduce((s,b) => s + (b.total_amount ?? 0), 0);
      let variacionPct = null;
      if (prevTotal > 0) variacionPct = Math.round((totalVend - prevTotal) / prevTotal * 100);
      else if (totalVend > 0) variacionPct = 100; // de 0 a algo = +100% (no hay base para dividir)

      // ── E: Anticipación promedio de reserva ──
      const anticipaciones = bks
        .filter(b => b.created_at && b.check_in)
        .map(b => Math.round((new Date(b.check_in + 'T12:00:00') - new Date(b.created_at)) / 86400000))
        .filter(d => d >= 0 && d < 730); // descartar outliers/negativos
      const avgAnticipacion = anticipaciones.length
        ? Math.round(anticipaciones.reduce((s,d) => s+d, 0) / anticipaciones.length)
        : null;

      this._renderKPIs({ totalVend, totalCobr, totalPend, pctCobr, count: bks.length });
      this._renderChart({ totalVend, totalCobr, totalPend });
      this._renderAsegurado({ asegVend, asegCobr, asegPend, asegPct, count: futuro.length });
      this._renderIndicators({ maxBk, avgBk, avgNoche, avgPend, totalNoch, count: bks.length, topUnit, variacionPct, avgAnticipacion });

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

  _renderIndicators({ maxBk, avgBk, avgNoche, avgPend, totalNoch, count, topUnit, variacionPct, avgAnticipacion }) {
    const el = document.getElementById('financ-indicators');
    if (!el) return;
    const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
    const maxGuest = maxBk?.guests ? ((maxBk.guests.first_name ?? '') + ' ' + (maxBk.guests.last_name ?? '')).trim() || '—' : '—';
    const ind = (icon, label, val, sub, valColor) =>
      '<div class="card" style="padding:12px 14px;display:flex;align-items:flex-start;gap:10px">' +
        '<span style="font-size:1.2rem;flex-shrink:0">' + icon + '</span>' +
        '<div style="min-width:0">' +
          '<div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-3);font-weight:700;margin-bottom:2px">' + label + '</div>' +
          '<div style="font-size:.9rem;font-weight:800;color:' + (valColor ?? 'var(--color-text)') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + val + '</div>' +
          (sub ? '<div style="font-size:.65rem;color:var(--color-text-3);margin-top:1px">' + sub + '</div>' : '') +
        '</div>' +
      '</div>';

    // D: variación vs período anterior — color e ícono según signo
    let variacionVal = '—', variacionSub = 'sin datos del período anterior', variacionColor = 'var(--color-text)', variacionIcon = '📈';
    if (variacionPct !== null) {
      const positivo = variacionPct >= 0;
      variacionIcon  = positivo ? '📈' : '📉';
      variacionColor = positivo ? '#16a34a' : '#ef4444';
      variacionVal   = (positivo ? '+' : '') + variacionPct + '%';
      variacionSub   = 'vs. período anterior';
    }

    el.innerHTML =
      ind('🏆', 'Mayor reserva',         fmt(maxBk?.total_amount ?? 0), maxGuest) +
      ind('📊', 'Promedio por reserva',  fmt(avgBk),    count + ' reservas en el período') +
      ind('🌙', 'Ingreso/noche',         fmt(avgNoche), totalNoch + ' noches vendidas') +
      ind('⏳', 'Saldo pend. promedio',  fmt(avgPend),  'por reserva del período') +
      // ── Nuevas: B, D, E ──
      (topUnit ? ind('🏠', 'Unidad más rentable', topUnit.name, fmt(topUnit.total) + ' en el período') : '') +
      ind(variacionIcon, 'Variación vs. anterior', variacionVal, variacionSub, variacionColor) +
      (avgAnticipacion !== null
        ? ind('⏱️', 'Anticipación promedio', avgAnticipacion + ' día' + (avgAnticipacion !== 1 ? 's' : ''), 'entre reserva y check-in')
        : '');
  }
}
