import { isDemo } from "../auth/permissions.js";
// ═══════════════════════════════════════════════════
// dashboard.js — Panel de Hoy
// KPIs, Ocupación, Dólar, Llegadas, Recordatorios
// ═══════════════════════════════════════════════════

import { formatARS, formatDate, toISODate, showToast } from '../supabase-config.js';
import { fetchDollarRates } from '../services/dollar-api.js';
// ↑ Sin import de app.js — evita dependencia circular.
// El badge se actualiza via CustomEvent que app.js escucha.

export class Dashboard {
  constructor(supabase, ctx, bookingForm) {
    this.db          = supabase;
    this.ctx         = ctx;
    this.bookingForm = bookingForm;
    this._loaded     = false;
  }

  // ── Entrada pública ──────────────────────────────
  async load() {
    this._renderSkeleton();
    try {
      // ── Demo mode ──
      if (this.ctx.IS_DEMO) {
        const { generateMockBookings, generateMockDashboard, generateMockReminders } = await import('../services/mock-data.js');
        const now = new Date();
        const mockBookings  = generateMockBookings(this.ctx.units, now.getFullYear(), now.getMonth());
        const mockKPIs      = generateMockDashboard(this.ctx.units, mockBookings);
        const mockReminders = generateMockReminders(this.ctx.units);
        this._renderKPIs(mockKPIs, new Date().toISOString().split('T')[0]);
        this._renderOccupancyRing(mockKPIs.occupiedUnits, this.ctx.units.length);
        this._renderDollar(null); // cotización real igual
        this._renderArrivals(mockKPIs.arrivals);
        this._renderReminders(mockReminders);
        return;
      }
      const today = toISODate(new Date());
      const [kpis, dollar, reminders, forecast] = await Promise.all([
        this._fetchKPIs(today),
        fetchDollarRates(),
        this._fetchTodayReminders(today),
        this._fetchForecast(today),
      ]);

      this._renderKPIs(kpis, today);
      this._renderOccupancyRing(kpis.occupiedUnits, this.ctx.units.length);
      this._renderDollar(dollar);
      this._renderArrivals(kpis.arrivals);
      this._renderReminders(reminders);
      this._renderForecast(forecast);

      // Actualizar badge de recordatorios via evento (sin dependencia circular)
      const pendingReminders = reminders.filter(r => !r.completed).length;
      document.dispatchEvent(new CustomEvent('reminders:badge', { detail: { count: pendingReminders } }));

    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  }

  // ── Skeleton loader ───────────────────────────────
  _renderSkeleton() {
    const grid = document.getElementById('kpi-grid');
    if (!grid) return;
    grid.innerHTML = Array(4).fill(`
      <div class="skeleton-kpi">
        <div class="skeleton-box sk-icon"></div>
        <div class="skeleton-box sk-label"></div>
        <div class="skeleton-box sk-value"></div>
      </div>`).join('');
  }

  // ── Contador animado ──────────────────────────────
  _animateCounter(el, target, duration = 650) {
    if (!el || isNaN(target) || target === 0) { if (el) el.textContent = target; return; }
    const start = performance.now();
    const update = (now) => {
      const p    = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3); // cubic ease-out
      el.textContent = Math.round(ease * target);
      if (p < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  // ── KPIs: Check-ins, Check-outs, Recambios, Huéspedes ──
  async _fetchKPIs(today) {
    const hotelId = this.ctx.hotelId;

    // Reservas activas hoy (overlapping today)
    const { data: activeBookings } = await this.db
      .from('bookings')
      .select(`
        id, check_in, check_out, status, guest_id,
        guests!bookings_guest_id_fkey(first_name, last_name),
        booking_units!inner(unit_id, units!inner(name))
      `)
      .eq('hotel_id', hotelId)
      .neq('status', 'cancelled')
      .lte('check_in',  today)
      .gt('check_out', today);

    // Check-ins hoy
    const { data: checkins } = await this.db
      .from('bookings')
      .select(`
        id, check_in, check_out,
        guests!bookings_guest_id_fkey(first_name, last_name),
        booking_units(unit_id, units(name))
      `)
      .eq('hotel_id', hotelId)
      .eq('check_in', today)
      .neq('status', 'cancelled');

    // Check-outs hoy
    const { data: checkouts } = await this.db
      .from('bookings')
      .select(`
        id, check_in, check_out,
        guests!bookings_guest_id_fkey(first_name, last_name),
        booking_units(unit_id, units(name))
      `)
      .eq('hotel_id', hotelId)
      .eq('check_out', today)
      .neq('status', 'cancelled');

    // Unidades ocupadas hoy (para ocupación)
    const occupiedUnitIds = new Set();
    (activeBookings ?? []).forEach(b =>
      (b.booking_units ?? []).forEach(bu => occupiedUnitIds.add(bu.unit_id))
    );

    // Detectar recambios: unidades con checkout Y checkin el mismo día
    const recambios = [];
    if (checkins && checkouts) {
      const checkinUnitIds  = new Set(checkins.flatMap(b => (b.booking_units ?? []).map(bu => bu.unit_id)));
      const checkoutUnitIds = new Set(checkouts.flatMap(b => (b.booking_units ?? []).map(bu => bu.unit_id)));
      checkinUnitIds.forEach(uid => {
        if (checkoutUnitIds.has(uid)) {
          const unit = this.ctx.units.find(u => u.id === uid);
          if (unit) recambios.push(unit.name);
        }
      });
    }

    // Revenue del mes actual
    const monthStart = today.slice(0,7) + '-01';
    const monthEnd   = new Date(new Date(monthStart).getFullYear(),
                         new Date(monthStart).getMonth()+1, 0)
                         .toISOString().slice(0,10);
    const { data: monthBookings } = await this.db
      .from('bookings')
      .select('total_amount, total_paid, balance, status')
      .eq('hotel_id', hotelId)
      .not('status','in','(cancelled,blocked)')
      .gte('check_in', monthStart)
      .lte('check_in', monthEnd);

    const revenue = {
      total:  (monthBookings ?? []).reduce((s,b) => s + (b.total_amount ?? 0), 0),
      paid:   (monthBookings ?? []).reduce((s,b) => s + (b.total_paid  ?? 0), 0),
      count:  (monthBookings ?? []).length,
    };

    // Próximas llegadas (7 días)
    const next7 = new Date(today);
    next7.setDate(next7.getDate() + 7);
    const next7str = next7.toISOString().slice(0,10);
    const { data: upcoming } = await this.db
      .from('bookings')
      .select('check_in, check_out, guests!bookings_guest_id_fkey(first_name,last_name), booking_units(units(name,color))')
      .eq('hotel_id', hotelId)
      .neq('status', 'cancelled')
      .gt('check_in', today)
      .lte('check_in', next7str)
      .order('check_in', { ascending: true })
      .limit(8);

    // Limpiezas pendientes hoy
    let pendingClean = 0;
    try {
      const { count } = await this.db.from('cleaning_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('hotel_id', hotelId).eq('status','pending').eq('scheduled_date', today);
      pendingClean = count ?? 0;
    } catch {}

    return {
      checkins:      checkins ?? [],
      checkouts:     checkouts ?? [],
      recambios,
      occupiedUnits: occupiedUnitIds.size,
      arrivals:      checkins ?? [],
      revenue,
      upcoming:      upcoming ?? [],
      pendingClean,
    };
  }

  // ── Recordatorios del día ──
  async _fetchTodayReminders(today) {
    const { data } = await this.db
      .from('reminders')
      .select('*, units(name)')
      .eq('hotel_id', this.ctx.hotelId)
      .lte('scheduled_date', today)
      .eq('completed', false)
      .order('scheduled_date');
    return data ?? [];
  }

  // ── Render KPI cards ──────────────────────────────
  _renderKPIs(kpis, today) {
    // Check-ins (con contador animado)
    const ciEl = document.getElementById('kpi-checkins-val');
    this._setKPI('kpi-checkins-val', kpis.checkins.length);
    this._animateCounter(ciEl, kpis.checkins.length);
    this._setSubList('kpi-checkins-list', kpis.checkins.map(b =>
      `${b.guests?.first_name ?? ''} ${b.guests?.last_name ?? ''} — ${(b.booking_units?.[0]?.units?.name ?? '')}`
    ));

    const coEl = document.getElementById('kpi-checkouts-val');
    this._setKPI('kpi-checkouts-val', kpis.checkouts.length);
    this._animateCounter(coEl, kpis.checkouts.length);
    this._setSubList('kpi-checkouts-list', kpis.checkouts.map(b =>
      `${b.guests?.first_name ?? ''} ${b.guests?.last_name ?? ''} — ${(b.booking_units?.[0]?.units?.name ?? '')}`
    ));

    const rcEl = document.getElementById('kpi-recambios-val');
    this._setKPI('kpi-recambios-val', kpis.recambios.length);
    this._animateCounter(rcEl, kpis.recambios.length);
    this._setSubList('kpi-recambios-list', kpis.recambios.map(n => `${n}`));

    const guEl = document.getElementById('kpi-guests-val');
    this._setKPI('kpi-guests-val', kpis.occupiedUnits);
    this._animateCounter(guEl, kpis.occupiedUnits);

    // Nuevos widgets
    this._renderRevenueCard(kpis.revenue ?? {});
    this._renderUpcoming(kpis.upcoming  ?? []);
    this._renderPendingOps(kpis.pendingClean ?? 0);
  }

  _renderRevenueCard(rev) {
    const el = document.getElementById('dashboard-revenue');
    if (!el) return;
    const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
    const pct = rev.total > 0 ? Math.round((rev.paid / rev.total) * 100) : 0;
    const today = new Date();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth()+1, 0).getDate();
    const daysPassed  = today.getDate();
    const runRate     = rev.paid > 0 ? Math.round((rev.paid / daysPassed) * daysInMonth) : 0;
    el.innerHTML = `
      <div class="dash-revenue-card">
        <div class="dash-rev-header">
          <span class="dash-rev-label">Ingresos este mes</span>
          <span class="dash-rev-count">${rev.count ?? 0} reserva${rev.count !== 1 ? 's' : ''}</span>
        </div>
        <div class="dash-rev-total">${fmt(rev.total)}</div>
        <div class="dash-rev-bar-wrap">
          <div class="dash-rev-bar" style="width:${Math.min(100,pct)}%"></div>
        </div>
        <div class="dash-rev-sub">
          <span style="color:var(--color-success)">✓ Cobrado: ${fmt(rev.paid)}</span>
          <span style="color:var(--color-text-3)">Pendiente: ${fmt(Math.max(0,(rev.total??0)-(rev.paid??0)))}</span>
        </div>
        ${runRate > 0 ? `<div class="dash-rev-rate">A este ritmo: ${fmt(runRate)}/mes</div>` : ''}
      </div>`;
  }

  _renderUpcoming(bookings) {
    const el = document.getElementById('dashboard-upcoming');
    if (!el) return;
    if (!bookings.length) {
      el.innerHTML = '<p class="empty-state-sm">Sin llegadas en los próximos 7 días</p>';
      return;
    }
    const fmt = iso => new Date(iso+'T12:00:00').toLocaleDateString('es-AR',{weekday:'short',day:'numeric',month:'short'});
    el.innerHTML = bookings.map(b => {
      const guest = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : 'Sin nombre';
      const unit  = b.booking_units?.[0]?.units;
      const color = unit?.color ?? '#6366f1';
      const nights = Math.round((new Date(b.check_out+'T12:00:00') - new Date(b.check_in+'T12:00:00')) / 86400000);
      return `
        <div class="upcoming-item">
          <div class="upcoming-dot" style="background:${color}"></div>
          <div class="upcoming-body">
            <div class="upcoming-date">${fmt(b.check_in)}</div>
            <div class="upcoming-guest">${guest}</div>
            <div class="upcoming-unit">${unit?.name ?? '—'} · ${nights} noche${nights!==1?'s':''}</div>
          </div>
        </div>`;
    }).join('');
  }

  _renderPendingOps(count) {
    const el = document.getElementById('dashboard-ops-badge');
    if (!el) return;
    if (count > 0) {
      el.textContent = `🧹 ${count} limpieza${count !== 1 ? 's' : ''} pendiente${count !== 1 ? 's' : ''} hoy`;
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  }

  _renderSparkline(cardId, data7) {
    const card = document.getElementById(cardId);
    if (!card) return;
    // Remove existing sparkline
    card.querySelector('.kpi-sparkline')?.remove();
    if (!data7.length) return;

    const max = Math.max(...data7, 1);
    const bars = data7.map((v, i) => {
      const h = Math.max(10, Math.round((v / max) * 100));
      const isToday = i === data7.length - 1;
      return `<div class="kpi-spark-bar ${isToday ? 'today' : ''}"
                   style="height:${h}%"></div>`;
    }).join('');
    const sparkEl = document.createElement('div');
    sparkEl.className = 'kpi-sparkline';
    sparkEl.innerHTML = bars;
    card.querySelector('.kpi-body')?.appendChild(sparkEl);
  }

  _setKPI(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  _setSubList(id, items) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = items.slice(0, 3).map(text =>
      `<div class="kpi-sub-item">${text}</div>`
    ).join('');
    if (items.length > 3) {
      el.innerHTML += `<div class="kpi-sub-item">+ ${items.length - 3} más</div>`;
    }
  }

  // ── Render Occupancy Ring ─────────────────────────
  _renderOccupancyRing(occupied, total) {
    if (!total) return;
    const pct    = Math.round((occupied / total) * 100);
    const radius = 50;
    const circum = 2 * Math.PI * radius; // ≈ 314
    const offset = circum - (pct / 100) * circum;

    const circle = document.getElementById('occ-ring');
    if (circle) {
      circle.style.strokeDashoffset = offset;
      // Color dinámico según ocupación
      if (pct >= 80)      circle.style.stroke = 'var(--color-success)';
      else if (pct >= 50) circle.style.stroke = 'var(--color-primary)';
      else                circle.style.stroke = 'var(--color-warning)';
    }

    const pctEl = document.getElementById('occ-pct');
    const subEl = document.getElementById('occ-sub');
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (subEl) subEl.textContent = `${occupied}/${total} uds`;
  }

  // ── Render Dollar Widget ──────────────────────────
  _renderDollar(rates) {
    if (!rates) {
      document.getElementById('dollar-status-badge').textContent = 'Sin datos';
      return;
    }

    const fmt = (n) => n ? `$${n.toLocaleString('es-AR')}` : '—';

    document.getElementById('dol-of-buy')?.setAttribute('data-val', rates.oficial?.buy  ?? 0);
    document.getElementById('dol-of-sell')?.setAttribute('data-val', rates.oficial?.sell ?? 0);

    // Animación de contador
    this._animateValue('dol-of-buy',  rates.oficial?.buy,  fmt);
    this._animateValue('dol-of-sell', rates.oficial?.sell, fmt);
    this._animateValue('dol-bl-buy',  rates.blue?.buy,     fmt);
    this._animateValue('dol-bl-sell', rates.blue?.sell,    fmt);

    const badge = document.getElementById('dollar-status-badge');
    if (badge) { badge.textContent = 'Actualizado'; badge.style.background = ''; }

    // Header badge
    const headerBadge = document.getElementById('dollar-badge-value');
    if (headerBadge) headerBadge.textContent = fmt(rates.oficial?.sell);

    // Fecha actualización
    const updatedEl = document.getElementById('dollar-updated-at');
    if (updatedEl && rates.updatedAt) {
      updatedEl.textContent = `Actualizado: ${new Date(rates.updatedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
    }
  }

  _animateValue(id, target, formatter) {
    const el = document.getElementById(id);
    if (!el || !target) { if (el) el.textContent = '—'; return; }
    el.textContent = formatter(target);
  }

  // ── Render Arrivals ───────────────────────────────
  _renderArrivals(arrivals) {
    const container = document.getElementById('arrivals-list');
    if (!container) return;

    if (!arrivals.length) {
      container.innerHTML = `<p class="empty-state-sm">Sin llegadas hoy</p>`;
      return;
    }

    container.innerHTML = arrivals.map(b => {
      const guest     = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : 'Sin nombre';
      const unitNames = (b.booking_units ?? []).map(bu => bu.units?.name ?? '').join(', ');
      return `
        <div class="arrival-item">
          <span class="arrival-unit">${unitNames}</span>
          <span class="arrival-guest">${guest}</span>
          <span style="margin-left:auto;font-size:.72rem;color:var(--color-text-3)">Check-in</span>
        </div>`;
    }).join('');
  }

  // ── Render Reminders ──────────────────────────────
  _renderReminders(reminders) {
    const container = document.getElementById('dashboard-reminders');
    if (!container) return;

    if (!reminders.length) {
      container.innerHTML = `<p class="empty-state-sm">Sin tareas pendientes</p>`;
      return;
    }

    container.innerHTML = reminders.slice(0, 5).map(r => `
      <div class="reminder-item" id="dash-rem-${r.id}">
        <span>🔔</span>
        <div style="flex:1">
          <div style="font-weight:600;font-size:.82rem">${r.title}</div>
          <div style="font-size:.72rem;color:var(--color-text-2)">${r.scheduled_date}${r.units ? ` · ${r.units.name}` : ''}</div>
        </div>
        <label style="cursor:pointer">
          <input type="checkbox" style="accent-color:var(--color-success)" 
            onchange="window.toggleReminder('${r.id}', this.checked)">
        </label>
      </div>
    `).join('');
  }

  // ── Proyección de ingresos del mes ───────────────
  async _fetchForecast(today) {
    const year  = new Date().getFullYear();
    const month = new Date().getMonth();
    const firstDay   = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const lastDay    = new Date(year, month+1, 0);
    const lastDayStr = `${year}-${String(month+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;

    // Mismo período año anterior
    const prevYear      = year - 1;
    const prevFirstDay  = `${prevYear}-${String(month+1).padStart(2,'0')}-01`;
    const prevLastDay   = `${prevYear}-${String(month+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;

    try {
      const [curRes, prevRes] = await Promise.all([
        this.db.from('bookings').select('status, total_amount, total_paid, check_in, check_out')
          .eq('hotel_id', this.ctx.hotelId)
          .not('status', 'in', '(cancelled,blocked)')
          .gte('check_in', firstDay).lte('check_in', lastDayStr),
        this.db.from('bookings').select('total_amount')
          .eq('hotel_id', this.ctx.hotelId)
          .not('status', 'in', '(cancelled,blocked)')
          .gte('check_in', prevFirstDay).lte('check_in', prevLastDay),
      ]);

      const current = curRes.data ?? [];
      const prev    = prevRes.data ?? [];

      const confirmed   = current.filter(b => b.status === 'paid').reduce((s,b) => s + (b.total_amount ?? 0), 0);
      const partial     = current.filter(b => b.status === 'partial').reduce((s,b) => s + (b.total_amount ?? 0), 0);
      const pending     = current.filter(b => b.status === 'pending').reduce((s,b) => s + (b.total_amount ?? 0), 0);
      const prevTotal   = prev.reduce((s,b) => s + (b.total_amount ?? 0), 0);
      const estimated   = confirmed + partial * 0.9 + pending * 0.5;
      const yoyDelta    = prevTotal > 0 ? Math.round(((estimated - prevTotal) / prevTotal) * 100) : null;

      return { confirmed, partial, pending, estimated, prevTotal, yoyDelta,
               monthName: ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][month],
               prevYear };
    } catch { return null; }
  }

  _renderForecast(data) {
    const container = document.getElementById('dashboard-forecast');
    if (!container) return;
    if (!data) { container.innerHTML = ''; return; }

    const { confirmed, partial, pending, estimated, prevTotal, yoyDelta, monthName, prevYear } = data;
    const fmt = (n) => '$' + Math.round(n).toLocaleString('es-AR');
    const yoyColor = yoyDelta === null ? '#64748b' : yoyDelta >= 0 ? '#22c55e' : '#ef4444';
    const yoySign  = yoyDelta === null ? '' : yoyDelta >= 0 ? '+' : '';

    const maxBar = Math.max(confirmed + partial + pending, prevTotal, 1);
    const pctConf = Math.round((confirmed / maxBar) * 100);
    const pctPart = Math.round((partial   / maxBar) * 100);
    const pctPend = Math.round((pending   / maxBar) * 100);
    const pctPrev = Math.round((prevTotal / maxBar) * 100);

    container.innerHTML = `
      <div class="forecast-widget">
        <div class="forecast-header">
          <div>
            <div class="forecast-title">Proyección ${monthName}</div>
            <div class="forecast-sub">Estimado basado en reservas actuales</div>
          </div>
          <div class="forecast-total">${fmt(estimated)}</div>
        </div>

        <div class="forecast-bar-group">
          <div class="forecast-bar-label">Este mes</div>
          <div class="forecast-bar-track">
            <div class="forecast-bar-seg" style="width:${pctConf}%;background:#22c55e" title="Confirmado: ${fmt(confirmed)}"></div>
            <div class="forecast-bar-seg" style="width:${pctPart}%;background:#f59e0b" title="Parcial: ${fmt(partial)}"></div>
            <div class="forecast-bar-seg" style="width:${pctPend}%;background:#e2e8f0" title="Pendiente: ${fmt(pending)}"></div>
          </div>
          <span class="forecast-bar-val">${fmt(confirmed + partial + pending)}</span>
        </div>

        <div class="forecast-bar-group">
          <div class="forecast-bar-label" style="color:var(--color-text-3)">${monthName} ${prevYear}</div>
          <div class="forecast-bar-track">
            <div class="forecast-bar-seg" style="width:${pctPrev}%;background:#cbd5e1"></div>
          </div>
          <span class="forecast-bar-val" style="color:var(--color-text-3)">${fmt(prevTotal)}</span>
        </div>

        <div class="forecast-legend">
          <span><span class="fleg-dot" style="background:#22c55e"></span>Confirmado ${fmt(confirmed)}</span>
          <span><span class="fleg-dot" style="background:#f59e0b"></span>Parcial ${fmt(partial)}</span>
          <span><span class="fleg-dot" style="background:#e2e8f0"></span>Pendiente ${fmt(pending)}</span>
          ${yoyDelta !== null ? `<span style="margin-left:auto;font-weight:700;color:${yoyColor}">AaA ${yoySign}${yoyDelta}%</span>` : ''}
        </div>
      </div>`;
  }

}