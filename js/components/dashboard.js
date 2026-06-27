import { isDemo } from "../auth/permissions.js";
// ═══════════════════════════════════════════════════
// dashboard.js — Panel de Hoy
// KPIs, Ocupación, Dólar, Llegadas, Recordatorios
// ═══════════════════════════════════════════════════

import { formatARS, formatDate, toISODate, showToast, localToday, localDateISO } from '../supabase-config.js';
import { fetchDollarRates } from '../services/dollar-api.js';
// ↑ Sin import de app.js — evita dependencia circular.
// El badge se actualiza via CustomEvent que app.js escucha.

export class Dashboard {
  constructor(supabase, ctx, bookingForm) {
    this.db          = supabase;
    this.ctx         = ctx;
    this.bookingForm = bookingForm;
    this._loaded     = false;

    // Exponer para handlers inline de los cards de arrival/departure
    window._dashCheckIn  = async (bookingId, rowId, guest) => {
      if (!confirm(`Registrar check-in de ${guest}?`)) return;
      try {
        await this.db.from('bookings')
          .update({ checked_in_at: new Date().toISOString() }).eq('id', bookingId);
        const row = document.getElementById(rowId);
        if (row) {
          row.classList.add('done');
          row.querySelector('.dac-btn')?.remove();
          row.querySelector('.dac-left').insertAdjacentHTML('beforeend',
            `<span class="dac-done-label">✓ Check-in registrado</span>`);
          row.insertAdjacentHTML('beforeend', `<span class="dac-done-badge">✓</span>`);
        }
        document.dispatchEvent(new CustomEvent('show:toast', { detail: { msg: `✅ Check-in: ${guest}`, type: 'success' } }));
        document.dispatchEvent(new CustomEvent('booking:changed'));
        if (typeof Sound !== 'undefined') Sound?.checkIn?.();
      } catch (e) {
        document.dispatchEvent(new CustomEvent('show:toast', { detail: { msg: 'Error: ' + e.message, type: 'error' } }));
      }
    };

    window._dashCheckOut = async (bookingId, rowId, guest) => {
      if (!confirm(`Registrar check-out de ${guest}?`)) return;
      try {
        await this.db.from('bookings')
          .update({ checked_out_at: new Date().toISOString() }).eq('id', bookingId);
        const row = document.getElementById(rowId);
        if (row) {
          row.classList.add('done');
          row.querySelector('.dac-btn')?.remove();
          row.querySelector('.dac-left').insertAdjacentHTML('beforeend',
            `<span class="dac-done-label">✓ Check-out registrado</span>`);
          row.insertAdjacentHTML('beforeend', `<span class="dac-done-badge" style="background:var(--color-surface-2)">✓</span>`);
        }
        document.dispatchEvent(new CustomEvent('show:toast', { detail: { msg: `👋 Check-out: ${guest}`, type: 'success' } }));
        document.dispatchEvent(new CustomEvent('booking:changed'));
        if (typeof Sound !== 'undefined') Sound?.checkOut?.();
      } catch (e) {
        document.dispatchEvent(new CustomEvent('show:toast', { detail: { msg: 'Error: ' + e.message, type: 'error' } }));
      }
    };
  }

  // ── Entrada pública ──────────────────────────────
  async load() {
    window._dashboardInstance = this;
    this._renderSkeleton();
    try {
      // ── Demo mode ──
      if (this.ctx.IS_DEMO) {
        const { generateMockBookings, generateMockDashboard, generateMockReminders } = await import('../services/mock-data.js');
        const now = new Date();
        const mockBookings  = generateMockBookings(this.ctx.units, now.getFullYear(), now.getMonth());
        const mockKPIs      = generateMockDashboard(this.ctx.units, mockBookings);
        const mockReminders = generateMockReminders(this.ctx.units);
        this._renderKPIs(mockKPIs, localToday());
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
      this._clearSkeleton();
      this._renderOccupancyRing(kpis.occupiedUnits, this.ctx.units.length);
      this._renderDollar(dollar);
      this._renderArrivals(kpis.arrivals ?? kpis.checkins ?? []);
      this._renderDepartures(kpis.checkouts ?? []);
      this._renderReminders(reminders);
      this._renderForecast(forecast);

      // Actualizar badge de recordatorios via evento (sin dependencia circular)
      const pendingReminders = reminders.filter(r => !r.completed).length;
      document.dispatchEvent(new CustomEvent('reminders:badge', { detail: { count: pendingReminders } }));

    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  }

  // ── Skeleton loader — no reemplaza el HTML, solo aplica clase CSS ──
  _renderSkeleton() {
    const grid = document.getElementById('kpi-grid');
    if (!grid) return;
    grid.querySelectorAll('.kpi-card').forEach(c => c.classList.add('kpi-loading'));
  }

  _clearSkeleton() {
    const grid = document.getElementById('kpi-grid');
    if (!grid) return;
    grid.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('kpi-loading'));
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
      .neq('status', 'blocked')
      .lte('check_in',  today)
      .gt('check_out', today);

    // Check-ins hoy
    const { data: checkins } = await this.db
      .from('bookings')
      .select(`
        id, check_in, check_out, checked_in_at, total_amount, total_paid, balance,
        guests!bookings_guest_id_fkey(first_name, last_name, phone),
        booking_units(unit_id, units(name))
      `)
      .eq('hotel_id', hotelId)
      .eq('check_in', today)
      .neq('status', 'cancelled')
      .neq('status', 'blocked');

    // Check-outs hoy
    const { data: checkouts } = await this.db
      .from('bookings')
      .select(`
        id, check_in, check_out, checked_out_at,
        guests!bookings_guest_id_fkey(first_name, last_name),
        booking_units(unit_id, units(name))
      `)
      .eq('hotel_id', hotelId)
      .eq('check_out', today)
      .neq('status', 'cancelled')
      .neq('status', 'blocked');

    // Unidades ocupadas hoy (para ocupación) — con detalle de huésped para tooltip
    const occupiedUnitIds = new Set();
    const occupiedDetail  = []; // [{ unitName, guestName }]
    (activeBookings ?? []).forEach(b => {
      const guestName = b.guests ? `${b.guests.first_name ?? ''} ${b.guests.last_name ?? ''}`.trim() : '—';
      (b.booking_units ?? []).forEach(bu => {
        occupiedUnitIds.add(bu.unit_id);
        occupiedDetail.push({
          unitName:  bu.units?.name ?? '—',
          guestName,
        });
      });
    });

    // Detectar recambios: misma unidad con check-out = hoy Y check-in = hoy.
    // Se listan con el huésped que sale y el que entra, no solo el nombre de la unidad.
    const recambios = [];
    if (checkins && checkouts) {
      const checkinByUnit  = new Map(); // unitId -> { unitName, guestName, bookingId }
      checkins.forEach(b => {
        const guestName = b.guests ? `${b.guests.first_name ?? ''} ${b.guests.last_name ?? ''}`.trim() : '—';
        (b.booking_units ?? []).forEach(bu => {
          checkinByUnit.set(bu.unit_id, { unitName: bu.units?.name ?? '—', guestName, bookingId: b.id });
        });
      });
      checkouts.forEach(b => {
        const guestName = b.guests ? `${b.guests.first_name ?? ''} ${b.guests.last_name ?? ''}`.trim() : '—';
        (b.booking_units ?? []).forEach(bu => {
          const incoming = checkinByUnit.get(bu.unit_id);
          if (incoming) {
            recambios.push({
              unitName:    bu.units?.name ?? incoming.unitName ?? '—',
              outGuest:    guestName,
              inGuest:     incoming.guestName,
            });
          }
        });
      });
    }

    // Revenue del mes actual — usar Date.UTC para evitar bug de timezone (UTC-3)
    const [_mYear, _mMonth] = today.split('-').map(Number);
    const monthStart = `${_mYear}-${String(_mMonth).padStart(2,'0')}-01`;
    const monthEnd = new Date(Date.UTC(_mYear, _mMonth, 0)).toISOString().slice(0,10);
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
    const _upDays2 = parseInt(localStorage.getItem('mila_upcoming_days') ?? '7');
    const next7 = new Date(today + 'T12:00:00');
    next7.setDate(next7.getDate() + _upDays2);
    const next7str = localDateISO(next7);
    const { data: upcoming } = await this.db
      .from('bookings')
      .select('check_in, check_out, guests!bookings_guest_id_fkey(first_name,last_name), booking_units(units(name,color))')
      .eq('hotel_id', hotelId)
      .neq('status', 'cancelled')
      .gt('check_in', today)
      .lte('check_in', next7str)
      .order('check_in', { ascending: true })
      .limit(20);

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
      occupiedDetail,
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
      .is('completed', false)
      .order('scheduled_date');
    return data ?? [];
  }

  // ── Render KPI cards ──────────────────────────────
  _renderKPIs(kpis, today) {
    // Check-ins (con contador animado + tooltip on-hover)
    const ciEl = document.getElementById('kpi-checkins-val');
    this._setKPI('kpi-checkins-val', kpis.checkins.length);
    this._animateCounter(ciEl, kpis.checkins.length);
    this._bindKpiTooltip('kpi-checkins', {
      emptyText: 'No hay ingresos programados para hoy.',
      lines: kpis.checkins.map(b => {
        const guest = b.guests ? `${b.guests.first_name ?? ''} ${b.guests.last_name ?? ''}`.trim() : '—';
        const unit  = b.booking_units?.[0]?.units?.name ?? '—';
        return `Departamento ${unit} — ${guest}`;
      }),
    });

    const coEl = document.getElementById('kpi-checkouts-val');
    this._setKPI('kpi-checkouts-val', kpis.checkouts.length);
    this._animateCounter(coEl, kpis.checkouts.length);
    this._bindKpiTooltip('kpi-checkouts', {
      emptyText: 'No hay egresos programados para hoy.',
      lines: kpis.checkouts.map(b => {
        const guest = b.guests ? `${b.guests.first_name ?? ''} ${b.guests.last_name ?? ''}`.trim() : '—';
        const unit  = b.booking_units?.[0]?.units?.name ?? '—';
        return `Departamento ${unit} — ${guest}`;
      }),
    });

    const rcEl = document.getElementById('kpi-recambios-val');
    this._setKPI('kpi-recambios-val', kpis.recambios.length);
    this._animateCounter(rcEl, kpis.recambios.length);
    this._bindKpiTooltip('kpi-recambios', {
      emptyText: 'No hay recambios programados para hoy.',
      blocks: kpis.recambios.map(r => ({
        title: `Departamento ${r.unitName}`,
        rows: [`Sale: ${r.outGuest}`, '↓', `Entra: ${r.inGuest}`],
      })),
    });

    const guEl = document.getElementById('kpi-guests-val');
    this._setKPI('kpi-guests-val', kpis.occupiedUnits);
    this._animateCounter(guEl, kpis.occupiedUnits);
    this._bindKpiTooltip('kpi-guests', {
      emptyText: 'No hay unidades ocupadas.',
      lines: (kpis.occupiedDetail ?? []).map(o => `Departamento ${o.unitName} — ${o.guestName}`),
    });

    // Nuevos widgets
    this._renderRevenueCard(kpis.revenue ?? {});
    this._renderUpcoming(kpis.upcoming  ?? []);
    this._renderPendingOps(kpis.pendingClean ?? 0);
  }

  // ── Tooltip on-hover para tarjetas KPI ─────────────
  // content: { emptyText, lines? } o { emptyText, blocks: [{title, rows}] } (para recambios)
  _bindKpiTooltip(cardId, content) {
    const card = document.getElementById(cardId);
    if (!card) return;

    // Evitar bind duplicado de listeners en cada render
    if (!card._kpiTooltipBound) {
      card.addEventListener('mouseenter', (e) => this._showKpiTooltip(card, e));
      card.addEventListener('mousemove',  (e) => this._moveKpiTooltip(e));
      card.addEventListener('mouseleave', ()  => this._hideKpiTooltip());
      card._kpiTooltipBound = true;
    }
    card._kpiTooltipContent = content;
  }

  _showKpiTooltip(card, e) {
    this._hideKpiTooltip();
    const content = card._kpiTooltipContent;
    if (!content) return;

    const tip = document.createElement('div');
    tip.className = 'cal-tooltip kpi-tooltip';

    let html;
    if (content.blocks?.length) {
      html = content.blocks.map(b => `
        <div class="kpi-tip-block">
          <div class="kpi-tip-title">${b.title}</div>
          ${b.rows.map(r => `<div class="kpi-tip-row">${r}</div>`).join('')}
        </div>`).join('<div class="kpi-tip-sep"></div>');
    } else if (content.lines?.length) {
      html = content.lines.map(l => `<div class="kpi-tip-row">${l}</div>`).join('');
    } else {
      html = `<div class="kpi-tip-empty">${content.emptyText}</div>`;
    }

    tip.innerHTML = html;
    document.body.appendChild(tip);
    this._kpiTooltip = tip;
    this._moveKpiTooltip(e);
  }

  _moveKpiTooltip(e) {
    if (!this._kpiTooltip) return;
    const tw = this._kpiTooltip.offsetWidth  || 220;
    const th = this._kpiTooltip.offsetHeight || 80;
    const x  = e.clientX + 16;
    const y  = e.clientY + 16;
    this._kpiTooltip.style.left = `${x + tw > window.innerWidth ? x - tw - 32 : x}px`;
    this._kpiTooltip.style.top  = `${y + th > window.innerHeight ? y - th - 24 : y}px`;
  }

  _hideKpiTooltip() {
    this._kpiTooltip?.remove();
    this._kpiTooltip = null;
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
    const _upDays = parseInt(localStorage.getItem('mila_upcoming_days') ?? '7');
    const sBar = `<div style="display:flex;gap:5px;margin-bottom:10px;align-items:center">
      <span style="font-size:.7rem;color:var(--color-text-3)">Próximas:</span>
      ${[7,14,28].map(d => `<button onclick="localStorage.setItem('mila_upcoming_days','${d}');window._dashboardInstance?.load?.()"
        style="font-size:.68rem;padding:2px 9px;border-radius:999px;cursor:pointer;
        border:1px solid var(--color-border);
        background:${d===_upDays?'var(--color-primary)':'transparent'};
        color:${d===_upDays?'white':'var(--color-text-3)'}">${d}d</button>`).join('')}
    </div>`;
    if (!bookings.length) {
      el.innerHTML = sBar + '<p class="empty-state-sm">Sin llegadas en los próximos ' + _upDays + ' días</p>';
      return;
    }
    const fmt = iso => new Date(iso+'T12:00:00').toLocaleDateString('es-AR',{weekday:'short',day:'numeric',month:'short'});
    el.innerHTML = sBar + bookings.map(b => {
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
      el.innerHTML = `
        <a href="#" onclick="window.milaNav?.('operations');return false;"
           style="display:flex;align-items:center;gap:8px;color:inherit;text-decoration:none">
          <span style="font-size:1.1rem">🧹</span>
          <span>${count} limpieza${count !== 1 ? 's' : ''} pendiente${count !== 1 ? 's' : ''} hoy</span>
        </a>`;
      el.style.display = 'flex';
      el.style.alignItems = 'center';
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

  // ── Render Dollar Widget — dólar oficial 3 fuentes ──
  _renderDollar(rates) {
    const fmt = n => n ? `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

    if (!rates) {
      const s = document.getElementById('dollar-status-badge');
      if (s) { s.textContent = 'Sin conexión'; s.style.background = '#fee2e2'; s.style.color = '#dc2626'; }
      return;
    }

    // Promedio oficial
    const mainVal = rates.oficial?.sell ?? null;
    const headerBadge = document.getElementById('dollar-badge-value');
    if (headerBadge) headerBadge.textContent = mainVal ? `$${Math.round(mainVal).toLocaleString('es-AR')}` : '—';

    // Widget principal en dashboard
    const el = document.getElementById('dollar-widget-body');
    if (!el) {
      // Fallback: actualizar campos individuales (compatibilidad)
      const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      setEl('dol-of-sell', fmt(rates.oficial?.sell));
      setEl('dol-of-buy',  fmt(rates.oficial?.buy));
      return;
    }

    const sources = rates.sourceData ?? [];
    const failed  = rates.failedSources ?? [];
    const isStale = rates.stale;
    const updTime = rates.updatedAt
      ? new Date(rates.updatedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '—';

    const sourceRows = [
      { key: 'BNA',          label: '🏦 Banco Nación' },
      { key: 'ambito',       label: '📰 Ámbito'       },
      { key: 'argentinadatos', label: '📊 Dólar Hoy'  },
    ].map(def => {
      const src  = sources.find(s => s.source === def.key);
      const fail = failed.includes(def.label.split(' ').slice(1).join(' ')) ||
                   failed.some(f => def.label.includes(f));
      return `
        <div class="dollar-source-row ${!src ? 'dollar-source-fail' : ''}">
          <span class="dollar-source-name">${def.label}</span>
          <span class="dollar-source-val ${!src ? 'text-muted' : ''}">
            ${src ? fmt(src.sell) : '<span title="Sin respuesta">⚠ —</span>'}
          </span>
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="dollar-main-val">${mainVal ? `$${Number(mainVal).toLocaleString('es-AR', {minimumFractionDigits:2})}` : '—'}</div>
      <div class="dollar-main-label">Dólar Oficial Venta · Promedio</div>
      <div class="dollar-sources-list">${sourceRows}</div>
      <div class="dollar-footer">
        <span class="dollar-src-count">${sources.length}/3 fuente${sources.length !== 1 ? 's' : ''}</span>
        ${isStale ? '<span class="dollar-stale-badge">⚠ Caché</span>' : '<span class="dollar-ok-badge">✓ Actualizado</span>'}
        <span class="dollar-update-time">🕐 ${updTime}</span>
      </div>
      ${failed.length ? `<div class="dollar-failed-notice">Sin respuesta: ${failed.join(', ')}</div>` : ''}
    `;

    // Actualizar badge de estado global
    const statusEl = document.getElementById('dollar-status-badge');
    if (statusEl) {
      statusEl.textContent = isStale ? '⚠ Caché' : `✓ ${sources.length} fuente${sources.length !== 1 ? 's' : ''}`;
      statusEl.style.background = isStale ? '#fef9c3' : '#f0fdf4';
      statusEl.style.color      = isStale ? '#a16207' : '#15803d';
    }
  }

  _animateValue(id, target, formatter) {
    const el = document.getElementById(id);
    if (!el || !target) { if (el) el.textContent = '—'; return; }
    el.textContent = formatter(target);
  }

  // ── Render Arrivals con acciones directas ─────────
  _renderArrivals(arrivals) {
    const container = document.getElementById('arrivals-list');
    if (!container) return;

    if (!arrivals.length) {
      container.innerHTML = `<p class="empty-state-sm">Sin llegadas hoy</p>`;
      return;
    }

    container.innerHTML = arrivals.map(b => {
      const guest    = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : 'Sin nombre';
      const unitNames= (b.booking_units ?? []).map(bu => bu.units?.name ?? '').join(', ');
      const isDone   = !!b.checked_in_at;
      return `
        <div class="dash-action-card ${isDone ? 'done' : ''}" id="arr-${b.id}">
          <div class="dac-left">
            <div class="dac-unit">${unitNames}</div>
            <div class="dac-guest">${guest}</div>
            ${isDone ? `<span class="dac-done-label">✓ Check-in registrado</span>` : ''}
          </div>
          ${!isDone ? `<button class="btn btn-primary btn-sm dac-btn"
              onclick="window._dashCheckIn('${b.id}', 'arr-${b.id}', '${guest}')">
              ✅ Check-in
          </button>` : `<span class="dac-done-badge">✓</span>`}
        </div>`;
    }).join('');
  }

  // ── Render Departures con acciones directas ────────
  _renderDepartures(departures) {
    const container = document.getElementById('departures-list');
    if (!container) return;

    if (!departures.length) {
      container.innerHTML = `<p class="empty-state-sm">Sin salidas hoy</p>`;
      return;
    }

    container.innerHTML = departures.map(b => {
      const guest    = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : 'Sin nombre';
      const unitNames= (b.booking_units ?? []).map(bu => bu.units?.name ?? '').join(', ');
      const isDone   = !!b.checked_out_at;
      return `
        <div class="dash-action-card ${isDone ? 'done' : ''}" id="dep-${b.id}">
          <div class="dac-left">
            <div class="dac-unit">${unitNames}</div>
            <div class="dac-guest">${guest}</div>
            ${isDone ? `<span class="dac-done-label">✓ Check-out registrado</span>` : ''}
          </div>
          ${!isDone ? `<button class="btn btn-outline btn-sm dac-btn"
              onclick="window._dashCheckOut('${b.id}', 'dep-${b.id}', '${guest}')">
              👋 Check-out
          </button>` : `<span class="dac-done-badge" style="background:var(--color-surface-2)">✓</span>`}
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