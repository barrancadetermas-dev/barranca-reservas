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
      <div id="financ-indicators" style="display:grid;grid-template-columns:repeat(7,1fr);gap:10px"></div>
      <!-- Frascos (Naranja X / plazo fijo) -->
      <div id="financ-frasco" style="margin-top:20px"></div>
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

    // ── Reservas activas para el frasco — query independiente ──────────────
    // Se carga primero y aparte para que un error en frasco_items no la borre.
    // Incluye reservas en curso + futuras + las que salieron hace ≤30 días.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    let activeBookings = [];
    try {
      const { data: abData } = await this.db.from('bookings')
        .select(`id, check_in, check_out, total_amount, total_paid, status,
                 guests(first_name, last_name),
                 booking_units(units(name, color)),
                 payments(id, amount, payment_method, payment_type)`)
        .eq('hotel_id', this.ctx.hotelId)
        .not('status', 'in', '(cancelled,blocked)')
        .gte('check_out', thirtyDaysAgo)
        .order('check_in', { ascending: true })
        .limit(200);
      activeBookings = abData ?? [];
    } catch (e) {
      console.warn('[FinancePanel] activeBookings query error:', e);
    }

    // ── Frascos — query independiente (tabla puede no existir aún) ─────────
    let frascoItems = [];
    try {
      const { data: fiData } = await this.db.from('frasco_items')
        .select(`id, original_amount, interest_amount, frasco_date, notes,
                 credited, credited_at, credited_amount, booking_id,
                 bookings(id, check_in, check_out,
                   guests(first_name, last_name),
                   booking_units(units(name, color)))`)
        .eq('hotel_id', this.ctx.hotelId)
        .order('frasco_date', { ascending: true })
        .limit(200);
      frascoItems = fiData ?? [];
    } catch (e) {
      console.warn('[FinancePanel] frasco_items no disponible (¿SQL pendiente?):', e?.message);
    }

    try {
      // Reservas del período + máxima reserva con nombre del huésped
      const [periodoRes, futuroRes, maxBkRes, prevRes, frascoRes] = await Promise.all([
        // Período seleccionado: todas las reservas que INICIAN en el rango
        // Incluye created_at (anticipación) y booking_units con unit_id (unidad más rentable)
        this.db.from('bookings')
          .select('id,total_amount,total_paid,balance,nights,price_per_night,check_in,check_out,status,created_at,booking_units(unit_id,price_per_night,units(name,color))')
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
        // Pagos en Frasco (frasco_date no nulo y aún no acreditados)
        this.db.from('payments')
          .select('id,amount,frasco_date,frasco_credited_amount,frasco_credited_at,payment_date,booking_id')
          .not('frasco_date','is',null)
          .order('frasco_date', { ascending: true })
          .limit(100),
      ]);

      if (periodoRes.error) throw periodoRes.error;

      const bks     = periodoRes.data ?? [];
      const futuro  = futuroRes.data ?? [];
      const maxBk   = maxBkRes.data?.[0] ?? null;
      const prevBks = prevRes.data ?? [];
      // Frasco: separar pendientes (frasco_credited_at null) de acreditados
      const frascoAll     = frascoRes?.data ?? [];
      const frascoPending = frascoAll.filter(p => !p.frasco_credited_at);
      const frascoOverdue = frascoPending.filter(p => p.frasco_date <= today);
      // frascoItems y activeBookings ya están cargados arriba (queries independientes)

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
      // Usa el precio real cargado por unidad si existe; si no (reservas viejas
      // o sin precio individual), reparte el monto en partes iguales (fallback).
      const unitRevMap = new Map(); // unit_id -> {name,color,total}
      bks.forEach(b => {
        const units = b.booking_units ?? [];
        if (!units.length) return;
        const nights = b.nights ?? 0;
        const share  = (b.total_amount ?? 0) / units.length; // fallback parejo
        units.forEach(bu => {
          if (!bu.unit_id) return;
          const cur = unitRevMap.get(bu.unit_id) ?? { name: bu.units?.name ?? '—', color: bu.units?.color ?? 'var(--color-primary)', total: 0 };
          cur.total += (bu.price_per_night != null && bu.price_per_night > 0)
            ? bu.price_per_night * nights
            : share;
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
      this._renderAsegurado({ asegVend, asegCobr, asegPend, asegPct, count: futuro.length, frascoPending, frascoOverdue });
      this._renderIndicators({ maxBk, avgBk, avgNoche, avgPend, totalNoch, count: bks.length, topUnit, variacionPct, avgAnticipacion });
      this._renderFrascoCard({ items: frascoItems, activeBookings });

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

  _renderAsegurado({ asegVend, asegCobr, asegPend, asegPct, count, frascoPending = [], frascoOverdue = [] }) {
    const el = document.getElementById('financ-asegurado');
    if (!el) return;
    const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');

    const frascoTotal = frascoPending.reduce((s, p) => s + (p.amount ?? 0), 0);

    // Sección frasco
    const frascoHTML = frascoPending.length > 0
      ? `<div style="margin-top:14px;padding:10px 12px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:.72rem;font-weight:700;color:#ea580c">🫙 En Frasco</span>
            <strong style="font-size:.9rem;color:#ea580c">${fmt(frascoTotal)}</strong>
          </div>
          ${frascoPending.map(p => `
            <div style="display:flex;justify-content:space-between;font-size:.7rem;padding:2px 0;border-top:1px solid #fed7aa">
              <span style="color:#9a3412">Acredita: ${p.frasco_date}${frascoOverdue.some(o => o.id === p.id) ? ' ⚠️' : ''}</span>
              <span style="color:#ea580c;font-weight:600">${fmt(p.amount ?? 0)}</span>
            </div>`).join('')}
          ${frascoOverdue.length > 0
            ? `<div style="font-size:.68rem;color:#dc2626;margin-top:6px;font-weight:600">⚠️ ${frascoOverdue.length} frasco${frascoOverdue.length > 1 ? 's' : ''} vencido${frascoOverdue.length > 1 ? 's' : ''} — registrá la acreditación</div>`
            : ''}
        </div>`
      : '';

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
      '<div style="font-size:.68rem;color:var(--color-text-3);margin-top:5px">' + asegPct + '% cobrado del dinero comprometido</div>' +
      frascoHTML;
  }

  _renderIndicators({ maxBk, avgBk, avgNoche, avgPend, totalNoch, count, topUnit, variacionPct, avgAnticipacion }) {
    const el = document.getElementById('financ-indicators');
    if (!el) return;
    const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
    const maxGuest = maxBk?.guests ? ((maxBk.guests.first_name ?? '') + ' ' + (maxBk.guests.last_name ?? '')).trim() || '—' : '—';
    const ind = (icon, label, val, sub, valColor) =>
      '<div class="card" style="padding:13px 14px;display:flex;flex-direction:column;gap:3px;min-width:0">' +
        '<span style="font-size:1.15rem;margin-bottom:1px">' + icon + '</span>' +
        '<div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-3);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + label + '</div>' +
        '<div style="font-size:.92rem;font-weight:800;color:' + (valColor ?? 'var(--color-text)') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + val + '</div>' +
        (sub ? '<div style="font-size:.65rem;color:var(--color-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + sub + '</div>' : '') +
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

  // ══════════════════════════════════════════════════
  // FRASCOS (Naranja X / plazo fijo)
  // ══════════════════════════════════════════════════

  _renderFrascoCard({ items, activeBookings }) {
    const el = document.getElementById('financ-frasco');
    if (!el) return;

    const fmt   = n  => '$' + Math.round(n ?? 0).toLocaleString('es-AR');
    const today = new Date().toISOString().slice(0, 10);

    const pending  = items.filter(i => !i.credited);
    const credited = items.filter(i =>  i.credited);

    const totalEnFrasco   = pending.reduce((s, i) => s + (i.original_amount ?? 0), 0);
    const totalConIntereses = pending.reduce((s, i) => s + (i.original_amount ?? 0) + (i.interest_amount ?? 0), 0);
    const interesesTotales  = totalConIntereses - totalEnFrasco;

    const vencidos = pending.filter(i => i.frasco_date <= today);

    const guestName = bk => {
      const g = bk?.guests ?? bk?.bookings?.guests;
      if (!g) return '—';
      return `${g.last_name ?? ''} ${g.first_name ?? ''}`.trim() || '—';
    };
    const unitName = bk => {
      const units = (bk?.booking_units ?? bk?.bookings?.booking_units ?? []);
      return units.map(bu => bu?.units?.name).filter(Boolean).join(' + ') || '—';
    };

    const rowHTML = item => {
      const bk       = item.bookings;
      const nombre   = guestName(item);
      const depto    = unitName(item);
      const checkIn  = bk?.check_in ?? '';
      const base     = item.original_amount ?? 0;
      const interes  = item.interest_amount ?? 0;
      const total    = base + interes;
      const vencido  = item.frasco_date <= today;
      return `
        <div class="frasco-row" data-id="${item.id}"
             style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;
                    padding:12px 14px;border-radius:10px;margin-bottom:8px;
                    background:${vencido ? '#fef9c3' : 'var(--color-surface-2)'};
                    border:1px solid ${vencido ? '#fde047' : 'var(--color-border)'}">
          <div>
            <div style="font-size:.82rem;font-weight:700;color:var(--color-text)">
              ${nombre} <span style="font-weight:400;color:var(--color-text-3)">· ${depto}</span>
              ${checkIn ? `<span style="font-size:.7rem;color:var(--color-text-3)"> · check-in ${checkIn}</span>` : ''}
            </div>
            <div style="display:flex;gap:12px;margin-top:4px;flex-wrap:wrap">
              <span style="font-size:.75rem;color:var(--color-text-3)">
                📥 Base: <strong style="color:var(--color-text)">${fmt(base)}</strong>
              </span>
              ${interes > 0 ? `<span style="font-size:.75rem;color:#16a34a">
                ✨ Intereses: <strong>${fmt(interes)}</strong>
              </span>` : ''}
              <span style="font-size:.75rem;color:#ea580c;font-weight:700">
                Total: ${fmt(total)}
              </span>
              <span style="font-size:.72rem;color:${vencido ? '#dc2626' : 'var(--color-text-3)'}">
                ${vencido ? '⚠️ Vencido · ' : '⏳ Acredita: '}${item.frasco_date}
              </span>
            </div>
            ${item.notes ? `<div style="font-size:.7rem;color:var(--color-text-3);margin-top:3px">📝 ${item.notes}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
            <button class="btn btn-primary btn-xs frasco-credit-btn" data-id="${item.id}"
                    style="background:#f97316;border-color:#f97316;white-space:nowrap">
              💸 Acreditar
            </button>
            <button class="btn btn-ghost btn-xs frasco-delete-btn" data-id="${item.id}">🗑️</button>
          </div>
        </div>`;
    };

    const creditedHTML = credited.length > 0
      ? `<details style="margin-top:10px">
          <summary style="font-size:.72rem;color:var(--color-text-3);cursor:pointer;font-weight:600">
            ✅ Acreditados (${credited.length})
          </summary>
          <div style="margin-top:8px;opacity:.75">
            ${credited.map(i => {
              const nombre = guestName(i);
              const depto  = unitName(i);
              const total  = i.credited_amount ?? ((i.original_amount ?? 0) + (i.interest_amount ?? 0));
              const interes = total - (i.original_amount ?? 0);
              return `<div style="display:flex;justify-content:space-between;font-size:.76rem;padding:6px 0;border-top:1px solid var(--color-border)">
                <span>${nombre} · ${depto}</span>
                <span style="color:#16a34a;font-weight:700">${fmt(total)}${interes > 0 ? ` <span style="color:var(--color-text-3)">(+${fmt(interes)} intereses)</span>` : ''}</span>
              </div>`;
            }).join('')}
          </div>
        </details>`
      : '';

    el.innerHTML = `
      <div class="card" style="padding:18px 20px;border-left:3px solid #f97316">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div>
            <span style="font-size:.72rem;font-weight:700;color:var(--color-text-3);
                         text-transform:uppercase;letter-spacing:.05em">🫙 Frascos activos</span>
            <span style="font-size:.65rem;color:var(--color-text-3);margin-left:8px">Naranja X · plazos fijos</span>
          </div>
          <button class="btn btn-primary btn-sm" id="frasco-add-btn"
                  style="background:#f97316;border-color:#f97316">+ Nuevo frasco</button>
        </div>

        ${pending.length > 0 ? `
          <div style="display:flex;gap:16px;margin:12px 0;padding:10px 12px;
                      background:#fff7ed;border-radius:8px;flex-wrap:wrap">
            <div><span style="font-size:.68rem;color:#9a3412;font-weight:700;text-transform:uppercase">En frasco</span>
              <div style="font-size:1rem;font-weight:800;color:#ea580c">${fmt(totalEnFrasco)}</div></div>
            <div><span style="font-size:.68rem;color:#9a3412;font-weight:700;text-transform:uppercase">Con intereses</span>
              <div style="font-size:1rem;font-weight:800;color:#16a34a">${fmt(totalConIntereses)}</div></div>
            <div><span style="font-size:.68rem;color:#9a3412;font-weight:700;text-transform:uppercase">A ganar</span>
              <div style="font-size:1rem;font-weight:800;color:#16a34a">+${fmt(interesesTotales)}</div></div>
            ${vencidos.length > 0 ? `<div style="margin-left:auto;align-self:center">
              <span style="background:#fef2f2;color:#dc2626;font-size:.72rem;font-weight:700;
                           padding:4px 10px;border-radius:6px">⚠️ ${vencidos.length} vencido${vencidos.length > 1 ? 's' : ''} sin acreditar</span>
            </div>` : ''}
          </div>
          <div id="frasco-list">${pending.map(rowHTML).join('')}</div>
        ` : `
          <div style="text-align:center;padding:20px;color:var(--color-text-3);font-size:.82rem">
            Sin frascos activos · presioná "+ Nuevo frasco" para cargar uno
          </div>
        `}
        ${creditedHTML}
      </div>`;

    // ── Botón nuevo frasco ─────────────────────────────────────────
    el.querySelector('#frasco-add-btn')?.addEventListener('click', () => {
      this._openFrascoModal(activeBookings);
    });

    // ── Acreditar ──────────────────────────────────────────────────
    el.querySelectorAll('.frasco-credit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = items.find(i => i.id === btn.dataset.id);
        if (item) this._openCreditModal(item);
      });
    });

    // ── Eliminar ───────────────────────────────────────────────────
    el.querySelectorAll('.frasco-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este frasco?')) return;
        btn.disabled = true;
        const { error } = await this.db.from('frasco_items').delete().eq('id', btn.dataset.id);
        if (error) { showToast('Error: ' + error.message, 'error'); btn.disabled = false; return; }
        showToast('Frasco eliminado', 'success');
        const container = document.getElementById('financ-container');
        if (container) this._fetchAndRender(container);
      });
    });
  }

  // ── Modal: nuevo frasco ────────────────────────────────────────────────────
  _openFrascoModal(activeBookings) {
    const existing = document.getElementById('overlay-frasco-new');
    if (existing) existing.remove();

    const fmt = n => Math.round(n ?? 0).toLocaleString('es-AR');

    // Métodos que SÍ van a frasco (todo menos efectivo)
    const FRASCO_METHODS = ['transfer','transferencia','card','tarjeta','debit','debito',
                            'mercadopago','qr','naranja','uala','cuenta','other'];

    const bookingOptions = activeBookings.map(bk => {
      const g      = bk.guests;
      const apellido = (g?.last_name  ?? '').trim();
      const nombre   = (g?.first_name ?? '').trim();
      const fullName = [apellido, nombre].filter(Boolean).join(', ') || '(sin nombre)';
      const deptos   = (bk.booking_units ?? []).map(bu => bu?.units?.name).filter(Boolean).join(' + ') || '—';
      const ci       = bk.check_in  ?? '';
      const co       = bk.check_out ?? '';
      const hoy      = new Date().toISOString().slice(0, 10);
      const estado   = ci > hoy ? '📅 Futura' : co >= hoy ? '🏠 En curso' : '✅ Reciente';
      // Señas no en efectivo para pre-llenar monto
      const montosNoEfectivo = (bk.payments ?? [])
        .filter(p => p.payment_type === 'deposit' && !['cash','efectivo'].includes((p.payment_method ?? '').toLowerCase()))
        .reduce((s, p) => s + (p.amount ?? 0), 0);
      const label = `${estado}  ${fullName}  ·  ${deptos}  ·  ${ci} → ${co}`;
      return { id: bk.id, label, monto: montosNoEfectivo };
    });

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'overlay-frasco-new';
    modal.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header" style="background:linear-gradient(135deg,#fff7ed,#ffedd5)">
          <h3 class="modal-title">🫙 Nuevo Frasco — Naranja X</h3>
          <button class="modal-close" id="fn-close">✕</button>
        </div>
        <div class="modal-body">

          <div class="form-group">
            <label>Reserva asociada <span style="font-size:.72rem;color:var(--color-text-3)">(opcional)</span></label>
            <select id="fn-booking" class="filter-select">
              <option value="">— Sin reserva asociada —</option>
              ${bookingOptions.length === 0
                ? `<option disabled>Sin reservas activas o recientes</option>`
                : bookingOptions.map(b =>
                    `<option value="${b.id}" data-monto="${b.monto}">${b.label}${b.monto > 0 ? `  —  seña: $${fmt(b.monto)}` : ''}</option>`
                  ).join('')
              }
            </select>
            ${bookingOptions.length === 0
              ? `<small style="color:#f59e0b;font-size:.7rem">⚠️ No se encontraron reservas activas. Recargá el panel financiero.</small>`
              : `<small style="color:var(--color-text-3);font-size:.7rem">Reservas en curso + futuras + últimas salidas</small>`
            }
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label>Monto base <span class="req">*</span>
                <span style="font-size:.68rem;color:var(--color-text-3)">(seña original)</span>
              </label>
              <div style="position:relative">
                <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--color-text-3);font-size:.85rem">$</span>
                <input type="number" id="fn-base" min="0" step="1" placeholder="75000"
                       style="padding-left:22px" class="form-input">
              </div>
            </div>
            <div class="form-group">
              <label>Intereses a ganar <span style="font-size:.68rem;color:var(--color-text-3)">(en $)</span></label>
              <div style="position:relative">
                <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#16a34a;font-size:.85rem">+$</span>
                <input type="number" id="fn-interest" min="0" step="1" placeholder="380" value="0"
                       style="padding-left:28px" class="form-input">
              </div>
            </div>
          </div>

          <div style="background:#f0fdf4;border-radius:8px;padding:10px 14px;margin-bottom:12px;
                      display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:.78rem;color:#166534;font-weight:600">Total al acreditar</span>
            <span id="fn-total-display" style="font-size:1.05rem;font-weight:800;color:#16a34a">$0</span>
          </div>

          <div class="form-group">
            <label>Fecha de acreditación <span class="req">*</span></label>
            <input type="date" id="fn-date" class="form-input">
          </div>

          <div class="form-group">
            <label>Notas <span style="font-size:.72rem;color:var(--color-text-3)">(opcional)</span></label>
            <input type="text" id="fn-notes" class="form-input"
                   placeholder="Ej: plazo 30 días, tasa 0.5% diario">
          </div>

        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="fn-cancel">Cancelar</button>
          <button class="btn btn-primary" id="fn-save"
                  style="background:#f97316;border-color:#f97316">🫙 Guardar frasco</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.style.zIndex = '210';

    const close = () => {
      modal.remove();
      if (escH) document.removeEventListener('keydown', escH);
    };
    const escH = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escH);
    modal.querySelector('#fn-close').onclick   = close;
    modal.querySelector('#fn-cancel').onclick  = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    // Pre-llenar monto al seleccionar reserva
    const bookingSel = modal.querySelector('#fn-booking');
    const baseInput  = modal.querySelector('#fn-base');
    const intInput   = modal.querySelector('#fn-interest');
    const totalDisp  = modal.querySelector('#fn-total-display');
    const fmt2 = n => '$' + Math.round(n ?? 0).toLocaleString('es-AR');

    const updateTotal = () => {
      const base = parseFloat(baseInput.value) || 0;
      const int  = parseFloat(intInput.value)  || 0;
      totalDisp.textContent = fmt2(base + int);
    };

    bookingSel.addEventListener('change', () => {
      const opt   = bookingSel.selectedOptions[0];
      const monto = parseFloat(opt?.dataset?.monto ?? 0);
      if (monto > 0) baseInput.value = monto;
      updateTotal();
    });
    baseInput.addEventListener('input', updateTotal);
    intInput.addEventListener('input',  updateTotal);
    updateTotal();

    setTimeout(() => bookingSel.focus(), 80);

    modal.querySelector('#fn-save').addEventListener('click', async () => {
      const base     = parseFloat(baseInput.value);
      const interest = parseFloat(intInput.value) || 0;
      const date     = modal.querySelector('#fn-date').value;
      const bkId     = bookingSel.value || null;
      const notes    = modal.querySelector('#fn-notes').value.trim() || null;

      if (!base || base <= 0) { showToast('Ingresá el monto base', 'warning'); return; }
      if (!date)              { showToast('Elegí la fecha de acreditación', 'warning'); return; }

      const saveBtn = modal.querySelector('#fn-save');
      saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';

      const { error } = await this.db.from('frasco_items').insert({
        hotel_id:        this.ctx.hotelId,
        booking_id:      bkId,
        original_amount: base,
        interest_amount: interest,
        frasco_date:     date,
        notes,
        credited:        false,
      });

      if (error) {
        showToast('Error: ' + error.message, 'error');
        saveBtn.disabled = false; saveBtn.textContent = '🫙 Guardar frasco';
        return;
      }

      showToast('Frasco guardado ✓', 'success');
      close();
      const container = document.getElementById('financ-container');
      if (container) this._fetchAndRender(container);
    });
  }

  // ── Modal: acreditar frasco ────────────────────────────────────────────────
  _openCreditModal(item) {
    const existing = document.getElementById('overlay-frasco-credit');
    if (existing) existing.remove();

    const fmt        = n => '$' + Math.round(n ?? 0).toLocaleString('es-AR');
    const base       = item.original_amount ?? 0;
    const intExpect  = item.interest_amount ?? 0;
    const totalExpect = base + intExpect;
    const today      = new Date().toISOString().slice(0, 10);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'overlay-frasco-credit';
    modal.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7)">
          <h3 class="modal-title">💸 Acreditar Frasco</h3>
          <button class="modal-close" id="fc-close">✕</button>
        </div>
        <div class="modal-body">

          <div style="background:#fff7ed;border-radius:8px;padding:10px 14px;margin-bottom:16px">
            <div style="font-size:.72rem;color:#9a3412;font-weight:700;text-transform:uppercase;margin-bottom:6px">
              Frasco original
            </div>
            <div style="display:flex;gap:16px;flex-wrap:wrap">
              <div><span style="font-size:.7rem;color:var(--color-text-3)">Base</span>
                <div style="font-weight:700;color:#ea580c">${fmt(base)}</div></div>
              ${intExpect > 0 ? `<div><span style="font-size:.7rem;color:var(--color-text-3)">Intereses esperados</span>
                <div style="font-weight:700;color:#16a34a">+${fmt(intExpect)}</div></div>` : ''}
              <div><span style="font-size:.7rem;color:var(--color-text-3)">Total esperado</span>
                <div style="font-weight:700;color:var(--color-text)">${fmt(totalExpect)}</div></div>
              <div><span style="font-size:.7rem;color:var(--color-text-3)">Fecha pactada</span>
                <div style="font-weight:700;color:var(--color-text)">${item.frasco_date}</div></div>
            </div>
          </div>

          <div class="form-group">
            <label>Monto real acreditado <span class="req">*</span></label>
            <div style="position:relative">
              <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#16a34a;font-size:.85rem">$</span>
              <input type="number" id="fc-amount" min="0" step="1" class="form-input"
                     style="padding-left:22px" value="${totalExpect}">
            </div>
            <small style="color:var(--color-text-3);font-size:.7rem">
              Por defecto se pre-carga el total esperado. Modificalo si el monto real es distinto.
            </small>
          </div>

          <div style="background:#f0fdf4;border-radius:8px;padding:10px 14px;margin-bottom:12px;
                      display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:.78rem;color:#166534;font-weight:600">Intereses reales</span>
            <span id="fc-interest-display" style="font-size:1rem;font-weight:800;color:#16a34a">+${fmt(intExpect)}</span>
          </div>

          <div class="form-group">
            <label>Fecha de acreditación real</label>
            <input type="date" id="fc-date" class="form-input" value="${today}">
          </div>

        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="fc-cancel">Cancelar</button>
          <button class="btn btn-primary" id="fc-save" style="background:#16a34a;border-color:#16a34a">
            ✅ Registrar acreditación
          </button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.style.zIndex = '210';

    const close = () => {
      modal.remove();
      if (escH) document.removeEventListener('keydown', escH);
    };
    const escH = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escH);
    modal.querySelector('#fc-close').onclick   = close;
    modal.querySelector('#fc-cancel').onclick  = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    const amountInput  = modal.querySelector('#fc-amount');
    const intDisp      = modal.querySelector('#fc-interest-display');
    const fmt2 = n => '$' + Math.round(n ?? 0).toLocaleString('es-AR');
    amountInput.addEventListener('input', () => {
      const real   = parseFloat(amountInput.value) || 0;
      const intRes = real - base;
      intDisp.textContent = (intRes >= 0 ? '+' : '') + fmt2(intRes);
      intDisp.style.color = intRes >= 0 ? '#16a34a' : '#ef4444';
    });

    setTimeout(() => amountInput.select(), 80);

    modal.querySelector('#fc-save').addEventListener('click', async () => {
      const creditedAmount = parseFloat(amountInput.value);
      const creditedAt     = modal.querySelector('#fc-date').value;
      if (!creditedAmount || creditedAmount <= 0) {
        showToast('Ingresá el monto acreditado', 'warning'); return;
      }

      const saveBtn = modal.querySelector('#fc-save');
      saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';

      const { error } = await this.db.from('frasco_items').update({
        credited:         true,
        credited_amount:  creditedAmount,
        credited_at:      creditedAt || today,
        interest_amount:  creditedAmount - base,
      }).eq('id', item.id);

      if (error) {
        showToast('Error: ' + error.message, 'error');
        saveBtn.disabled = false; saveBtn.textContent = '✅ Registrar acreditación';
        return;
      }

      showToast(`✅ Acreditado ${fmt2(creditedAmount)} · +${fmt2(creditedAmount - base)} intereses`, 'success');
      close();
      const container = document.getElementById('financ-container');
      if (container) this._fetchAndRender(container);
    });
  }
}
