import { isDemo } from "../auth/permissions.js";
// ═══════════════════════════════════════════════════
// dashboard.js — Panel de Hoy
// KPIs, Ocupación, Dólar, Llegadas, Recordatorios
// ═══════════════════════════════════════════════════

import { formatARS, formatDate, toISODate, showToast, localToday, localDateISO, AppContext } from '../supabase-config.js';
import { fetchDollarRates } from '../services/dollar-api.js';
import { recordDailyRateSnapshot, getUsdConversionRate } from '../services/usd-rate-history.js';
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
      // Modal de notas antes de confirmar check-out
      const notas = prompt(
        '👋 Check-out: ' + guest + '\n\n' +
        'Estado de la unidad (opcional):\n' +
        'Ej: "Dejar toallas extra", "Revisar canilla baño", "Todo OK"'
      );
      if (notas === null) return; // Canceló el prompt

      try {
        // 1. Registrar check-out
        const { error: bkErr } = await this.db.from('bookings')
          .update({ checked_out_at: new Date().toISOString() }).eq('id', bookingId);
        if (bkErr) throw bkErr;

        // 2. Obtener info de la reserva (unidad + fecha check-out)
        const { data: bk } = await this.db.from('bookings')
          .select('check_out, booking_units(unit_id, units(name))')
          .eq('id', bookingId).single();

        if (bk) {
          const unitId   = bk.booking_units?.[0]?.unit_id;
          const unitName = bk.booking_units?.[0]?.units?.name ?? '—';
          const today    = bk.check_out;

          // 3. Buscar si ya existe una tarea de limpieza para esa unidad hoy
          const { data: existing } = await this.db.from('cleaning_tasks')
            .select('id')
            .eq('unit_id', unitId)
            .eq('scheduled_date', today)
            .limit(1);

          const cleaningNote = notas.trim()
            ? '🧹 Check-out ' + guest + ': ' + notas.trim()
            : '🧹 Limpieza post check-out — ' + guest;

          if (existing?.length) {
            // Actualizar la tarea existente con las notas
            await this.db.from('cleaning_tasks')
              .update({ notes: cleaningNote, status: 'pending' })
              .eq('id', existing[0].id);
          } else if (unitId) {
            // Crear nueva tarea de limpieza
            await this.db.from('cleaning_tasks').insert({
              hotel_id:       this.ctx.hotelId,
              unit_id:        unitId,
              scheduled_date: today,
              status:         'pending',
              notes:          cleaningNote,
              priority:       'high',
            });
          }
        }

        // 4. Actualizar UI
        const row = document.getElementById(rowId);
        if (row) {
          const statusChip = row.querySelector('[style*="padding:1px"]');
          if (statusChip) {
            statusChip.textContent   = '✓ Check-out';
            statusChip.style.background = '#e0e7ff';
            statusChip.style.color      = '#3730a3';
          }
          const actionBtn = row.querySelector('.btn');
          if (actionBtn) actionBtn.remove();
        }

        document.dispatchEvent(new CustomEvent('show:toast', {
          detail: { msg: '👋 Check-out registrado' + (notas.trim() ? ' · Tarea de limpieza creada' : ''), type: 'success' }
        }));
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
    this._renderSkeleton(); // estaba definido pero nunca se llamaba
    try {
      const today = toISODate(new Date());
      const [kpis, extraStats, dineroStats, dollarRates, occForecast] = await Promise.all([
        this._fetchKPIs(today),
        this._fetchExtraStats(today),
        this._fetchDineroAsegurado(today),
        fetchDollarRates().catch(() => null),
        this._fetchOccupancyForecast(today),
      ]);
      this._renderKPIs(kpis, today);
      this._renderUpcoming(kpis.upcoming ?? kpis.arrivals ?? []);
      this._renderForecast(extraStats?.forecast ?? null);
      this._renderReservasMes(extraStats);
      this._renderDineroAsegurado(dineroStats);
      this._renderDollar(dollarRates);
      if (dollarRates?.oficial?.sell) {
        recordDailyRateSnapshot(this.db, this.ctx.hotelId, dollarRates.oficial.sell);
        this._renderUsdConversion();
      }
      this._renderOccupancyForecast(occForecast, today);
      this._renderRevPAR(extraStats);
      this._renderCobros(extraStats);
      this._renderOccupancyRing(kpis.occupiedUnits ?? 0, this.ctx.units?.length ?? 7);
      this._renderArrivals(kpis.arrivals ?? []);
      this._renderDepartures(kpis.checkouts ?? []);
      // Widget de Limpieza — estaba definido pero nunca se llamaba
      this._fetchTodayCleaningTasks(today).then(tasks => this._renderCleaningWidget(tasks));
      // Update header badge
      const buyEl = document.getElementById('dollar-badge-buy');
      const sellEl = document.getElementById('dollar-badge-value');
      if (dollarRates?.oficial) {
        const fmt = v => v ? `$${Math.round(v).toLocaleString('es-AR')}` : '—';
        if (buyEl)  buyEl.textContent  = fmt(dollarRates.oficial.buy);
        if (sellEl) sellEl.textContent = fmt(dollarRates.oficial.sell);
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      this._clearSkeleton();
    }
  }

  // ── Skeleton loader — no reemplaza el HTML, solo aplica clase CSS ──
  // ══════════════════════════════════════════════════
  // PERSONALIZACIÓN: toggle de cards
  // ══════════════════════════════════════════════════

  _renderSkeleton() {
    const grid = document.getElementById('kpi-grid');
    if (grid) grid.querySelectorAll('.kpi-card').forEach(c => c.classList.add('kpi-loading'));
    const cards = document.getElementById('dashboard-cards');
    if (cards) cards.querySelectorAll('.dash-card-uniform').forEach(c => c.classList.add('dash-card-loading'));
  }

  _clearSkeleton() {
    const grid = document.getElementById('kpi-grid');
    if (grid) grid.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('kpi-loading'));
    const cards = document.getElementById('dashboard-cards');
    if (cards) cards.querySelectorAll('.dash-card-uniform').forEach(c => c.classList.remove('dash-card-loading'));
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
    const gName = b => b.guests ? (b.guests.first_name ?? '') + ' ' + (b.guests.last_name ?? '') : null;
    const uName = b => b.booking_units?.[0]?.units?.name ?? null;
    const uColor= b => b.booking_units?.[0]?.units?.color ?? null;

    // Helper: set secondary text under KPI number
    const setSec = (id, html) => {
      const el = document.getElementById(id + '-sec');
      if (el) el.innerHTML = html || '';
    };

    // ── Check-ins ──
    const ciEl = document.getElementById('kpi-checkins-val');
    this._setKPI('kpi-checkins-val', kpis.checkins.length);
    this._animateCounter(ciEl, kpis.checkins.length);
    if (kpis.checkins.length === 1) {
      const b = kpis.checkins[0];
      const col = uColor(b) ?? 'var(--color-primary)';
      setSec('kpi-checkins',
        '<span style="display:inline-flex;align-items:center;gap:4px">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:' + col + ';flex-shrink:0"></span>' +
        '<span style="font-size:.68rem;color:var(--color-text-2);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px">' +
        (gName(b) || '—') + ' · ' + (uName(b) || '—') + '</span></span>');
    } else if (kpis.checkins.length > 1) {
      setSec('kpi-checkins', '<span style="font-size:.68rem;color:var(--color-text-3)">' + kpis.checkins.map(b => uName(b) ?? '—').join(' · ') + '</span>');
    } else {
      setSec('kpi-checkins', '<span style="font-size:.68rem;color:var(--color-text-3)">Sin llegadas hoy 😭</span>');
    }
    this._bindKpiTooltip('kpi-checkins', { emptyText: 'No hay ingresos para hoy.',
      lines: kpis.checkins.map(b => (uName(b) ?? '—') + ' — ' + (gName(b) || '—')) });

    // ── Check-outs ──
    const coEl = document.getElementById('kpi-checkouts-val');
    this._setKPI('kpi-checkouts-val', kpis.checkouts.length);
    this._animateCounter(coEl, kpis.checkouts.length);
    if (kpis.checkouts.length === 1) {
      const b = kpis.checkouts[0];
      const col = uColor(b) ?? '#f59e0b';
      setSec('kpi-checkouts',
        '<span style="display:inline-flex;align-items:center;gap:4px">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:' + col + ';flex-shrink:0"></span>' +
        '<span style="font-size:.68rem;color:var(--color-text-2);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px">' +
        (gName(b) || '—') + ' · ' + (uName(b) || '—') + '</span></span>');
    } else if (kpis.checkouts.length > 1) {
      setSec('kpi-checkouts', '<span style="font-size:.68rem;color:var(--color-text-3)">' + kpis.checkouts.map(b => uName(b) ?? '—').join(' · ') + '</span>');
    } else {
      setSec('kpi-checkouts', '<span style="font-size:.68rem;color:var(--color-text-3)">Sin salidas hoy 😭</span>');
    }
    this._bindKpiTooltip('kpi-checkouts', { emptyText: 'No hay egresos para hoy.',
      lines: kpis.checkouts.map(b => (uName(b) ?? '—') + ' — ' + (gName(b) || '—')) });

    // ── Recambios ──
    const rcEl = document.getElementById('kpi-recambios-val');
    this._setKPI('kpi-recambios-val', kpis.recambios.length);
    this._animateCounter(rcEl, kpis.recambios.length);
    if (kpis.recambios.length >= 1) {
      const r = kpis.recambios[0];
      setSec('kpi-recambios',
        '<span style="font-size:.66rem;color:var(--color-text-2)">' + r.unitName + '</span>' +
        '<br><span style="font-size:.63rem;color:var(--color-text-3)">' + r.outGuest + ' → ' + r.inGuest + '</span>');
    } else {
      setSec('kpi-recambios', '<span style="font-size:.68rem;color:var(--color-text-3)">Sin recambios 😭</span>');
    }
    this._bindKpiTooltip('kpi-recambios', { emptyText: 'No hay recambios para hoy.',
      blocks: kpis.recambios.map(r => ({ title: r.unitName, rows: ['Sale: ' + r.outGuest, '↓', 'Entra: ' + r.inGuest] })) });

    // ── Unidades alojadas ──
    const guEl = document.getElementById('kpi-guests-val');
    this._setKPI('kpi-guests-val', kpis.occupiedUnits);
    this._animateCounter(guEl, kpis.occupiedUnits);
    const occ = kpis.occupiedDetail ?? [];
    if (occ.length === 1) {
      setSec('kpi-guests',
        '<span style="font-size:.68rem;color:var(--color-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px">' +
        occ[0].unitName + ' · ' + occ[0].guestName + '</span>');
    } else if (occ.length > 1) {
      setSec('kpi-guests', '<span style="font-size:.68rem;color:var(--color-text-3)">' + occ.slice(0,3).map(o => o.unitName).join(' · ') + (occ.length > 3 ? '...' : '') + '</span>');
    } else {
      setSec('kpi-guests', '<span style="font-size:.68rem;color:var(--color-text-3)">Complejo libre 😭</span>');
    }
    this._bindKpiTooltip('kpi-guests', { emptyText: 'No hay unidades ocupadas.',
      lines: occ.map(o => o.unitName + ' — ' + o.guestName) });

    // Nuevos widgets
    const _totalUnits = this.ctx.units?.length || 7;
    this._applyKpiState('kpi-checkins',  kpis.checkins.length,  { total: _totalUnits });
    this._applyKpiState('kpi-checkouts', kpis.checkouts.length, { total: _totalUnits });
    this._applyKpiState('kpi-recambios', kpis.recambios.length, { total: _totalUnits });
    this._applyKpiState('kpi-guests',    kpis.occupiedUnits,    { total: _totalUnits });
    this._renderRevenueCard(kpis.revenue ?? {});
    this._renderUpcoming(kpis.upcoming  ?? []);
    // (El aviso de limpiezas pendientes ahora lo muestra la card
    // "Limpieza de hoy" — ver _renderCleaningWidget. Este badge suelto
    // quedaba flotando fuera de cualquier card y su link confundía con
    // Recordatorios, así que se dejó de usar.)
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
    const today   = localToday();

    // Badge dinámico basado en próxima llegada real
    let nextBadge = _upDays + 'd';
    if (bookings.length) {
      const dAway0 = Math.round((new Date(bookings[0].check_in+'T12:00:00') - new Date(today+'T12:00:00')) / 86400000);
      nextBadge = dAway0 === 0 ? 'hoy' : dAway0 === 1 ? 'mañana' : 'en ' + dAway0 + 'd';
    }

    const sBar = '<div style="display:flex;gap:5px;margin-bottom:12px;align-items:center">' +
      '<span style="font-size:.7rem;color:var(--color-text-3);margin-right:2px">Ver:</span>' +
      [7,14,28].map(d =>
        '<button onclick="localStorage.setItem(\'mila_upcoming_days\',\'' + d + '\');window._dashboardInstance?.load?.()" ' +
        'style="font-size:.68rem;padding:2px 10px;border-radius:999px;cursor:pointer;border:1px solid var(--color-border);' +
        'background:' + (d===_upDays ? 'var(--color-primary)' : 'transparent') + ';' +
        'color:' + (d===_upDays ? 'white' : 'var(--color-text-3)') + '">' + d + 'd</button>'
      ).join('') + '</div>';

    if (!bookings.length) {
      el.innerHTML = sBar + '<p class="empty-state-sm">Sin llegadas en los próximos ' + _upDays + ' días</p>';
      const hb = document.querySelector('.widget-upcoming .badge-today');
      if (hb) hb.textContent = _upDays + 'd';
      return;
    }

    const fmt = iso => new Date(iso+'T12:00:00').toLocaleDateString('es-AR',{weekday:'short',day:'numeric',month:'short'});

    const rows = bookings.map(b => {
      const guest  = b.guests ? (b.guests.first_name + ' ' + b.guests.last_name) : 'Sin nombre';
      const unit   = b.booking_units?.[0]?.units;
      const color  = unit?.color ?? '#6366f1';
      const nights = Math.round((new Date(b.check_out+'T12:00:00') - new Date(b.check_in+'T12:00:00')) / 86400000);
      const dAway  = Math.round((new Date(b.check_in+'T12:00:00') - new Date(today+'T12:00:00')) / 86400000);
      const dayLabel = dAway === 0
        ? '<span style="font-size:.65rem;padding:1px 6px;border-radius:3px;background:var(--state-green-bg);color:var(--state-green-txt);font-weight:700">HOY</span>'
        : dAway === 1
        ? '<span style="font-size:.65rem;padding:1px 6px;border-radius:3px;background:var(--state-yellow-bg);color:var(--state-yellow-txt);font-weight:700">MAÑANA</span>'
        : '<span style="font-size:.65rem;color:var(--color-text-3)">en ' + dAway + 'd</span>';
      return '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--color-border)">' +
        '<div style="width:3px;min-height:44px;border-radius:2px;background:' + color + ';flex-shrink:0;margin-top:2px"></div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">' +
            '<span style="font-size:.78rem;font-weight:700;color:var(--color-text)">' + fmt(b.check_in) + '</span>' +
            dayLabel +
          '</div>' +
          '<div style="font-size:.82rem;font-weight:600;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + guest + '</div>' +
          '<div style="font-size:.72rem;color:var(--color-text-3);margin-top:2px">' + (unit?.name ?? '—') + ' · ' + nights + ' noche' + (nights!==1?'s':'') + '</div>' +
        '</div></div>';
    }).join('');

    const headerBadge = document.querySelector('.widget-upcoming .badge-today');
    if (headerBadge) headerBadge.textContent = nextBadge;

    el.innerHTML = sBar + '<div style="max-height:260px;overflow-y:auto">' + rows + '</div>';
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

  // ── Escala única de estado (rojo/amarillo/verde) ──────────────
  // 0 = malo · 1 a 3 = medio · 4 a 7 (o más) = bueno.
  // Reemplaza los colores fijos kpi-blue/amber/rose/green por el
  // estado real de actividad de cada card.
  // Un solo emoji por card, en el texto secundario (no en el número).
  _applyKpiState(cardId, value, opts = {}) {
    const card = document.getElementById(cardId);
    if (!card) return;
    const total = opts.total ?? 7;
    const state = value <= 0 ? 'red' : value <= 3 ? 'yellow' : 'green';
    card.classList.remove('kpi-blue', 'kpi-amber', 'kpi-rose', 'kpi-green',
      'kpi-state-red', 'kpi-state-yellow', 'kpi-state-green');
    card.classList.add(`kpi-state-${state}`);

    // 😊 cuando está lleno/al tope — se agrega al texto secundario existente
    // (el caso 😭 de "sin actividad" ya viene escrito en ese mismo texto).
    if (state === 'green' && value >= total) {
      const secEl = document.getElementById(cardId + '-sec');
      if (secEl && secEl.innerHTML && !secEl.innerHTML.includes('😊') && !secEl.innerHTML.includes('😭')) {
        secEl.innerHTML += ' 😊';
      }
    }
  }

  // ── Render Occupancy Ring ─────────────────────────
  _renderOccupancyRing(occupied, total) {
    if (!total) return;
    const pct    = Math.round((occupied / total) * 100);
    const radius = 50;
    const circum = 2 * Math.PI * radius; // ≈ 314
    const offset = circum - (pct / 100) * circum;
    const stateColor = occupied <= 0 ? 'var(--state-red)' : occupied <= 3 ? 'var(--state-yellow)' : 'var(--state-green)';
    const stateTxt   = occupied <= 0 ? 'var(--state-red)' : occupied <= 3 ? 'var(--state-yellow-txt)' : 'var(--state-green-txt)';

    const circle = document.getElementById('occ-ring');
    if (circle) {
      circle.style.strokeDashoffset = offset;
      // Color según la escala única de estado (mismo criterio que los KPIs):
      // 0 ocupadas = rojo · 1 a 3 = amarillo · 4 a 7+ = verde.
      circle.style.stroke = stateColor;
    }
    // El "riel" de fondo también toma un tinte del mismo estado, en vez de
    // quedar siempre celeste/gris sin relación con la ocupación real.
    const track = document.getElementById('occ-ring-track');
    if (track) { track.style.stroke = stateColor; track.style.opacity = '.16'; }

    const pctEl = document.getElementById('occ-pct');
    const subEl = document.getElementById('occ-sub');
    // Escala de caras alineada con el mismo criterio de color: 0 ocupadas es
    // el peor caso (llorando fuerte, no "triste" — eso quedaba muy suave),
    // 1-3 es intermedio (cara neutral), completo es el mejor caso (contento).
    const face  = occupied <= 0 ? ' 😭' : occupied <= 3 ? ' 😐' : occupied >= total ? ' 😊' : '';
    if (pctEl) {
      pctEl.textContent = `${pct}%`;
      pctEl.style.fill = stateTxt;
    }
    if (subEl) subEl.textContent = `${occupied}/${total} uds${face}`;
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
    const mainVal = rates.oficial?.buy ?? null;
    const headerBadge = document.getElementById('dollar-badge-value');
    if (headerBadge) headerBadge.textContent = rates.oficial?.buy ? `$${Math.round(rates.oficial.buy).toLocaleString('es-AR')}` : '—';

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
            ${src ? fmt(src.buy) : '<span title="Sin respuesta">⚠ —</span>'}
          </span>
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="dollar-main-val">${mainVal ? `$${Number(mainVal).toLocaleString('es-AR', {minimumFractionDigits:2})}` : '—'}</div>
      <div class="dollar-main-label">Dólar Oficial Compra · Promedio</div>
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

  // Cotización que se usa como sugerencia al cargar pagos en USD: promedio
  // de los últimos 5 días registrados + el margen configurado en
  // Configuración → "Dólar — margen sobre cotización oficial".
  async _renderUsdConversion() {
    const el = document.getElementById('dollar-widget-body');
    if (!el) return;
    const marginPct = parseFloat(AppContext.config?.usd_margin_pct ?? 0) || 0;
    const conv = await getUsdConversionRate(this.db, this.ctx.hotelId, marginPct, 5);
    if (!conv.margined) return;
    document.getElementById('dollar-usd-conv-line')?.remove();
    el.insertAdjacentHTML('beforeend', `
      <div id="dollar-usd-conv-line" style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--color-border);font-size:.72rem;color:var(--color-text-3)">
        💵 Cotización sugerida para pagos USD: <strong style="color:var(--color-text)">$${conv.margined.toLocaleString('es-AR')}</strong>
        <span title="Promedio de los últimos ${conv.daysUsed} días registrados${marginPct ? ` + margen ${marginPct}%` : ''}">(prom. ${conv.daysUsed}d${marginPct ? ` +${marginPct}%` : ''})</span>
      </div>`);
  }

  _animateValue(id, target, formatter) {
    const el = document.getElementById(id);
    if (!el || !target) { if (el) el.textContent = '—'; return; }
    el.textContent = formatter(target);
  }

  // ── Render Arrivals con acciones directas ─────────
  // ══════════════════════════════════════════════════
  // COMPONENTE UNIFICADO: tarjeta de reserva
  // Usado en Llegadas, Salidas y Próximas
  // ══════════════════════════════════════════════════
  _bookingCard({ booking, mode }) {
    // mode: 'arrival' | 'departure' | 'upcoming'
    const b        = booking;
    const guest    = b.guests ? (b.guests.first_name + ' ' + b.guests.last_name) : 'Sin nombre';
    const unit     = b.booking_units?.[0]?.units;
    const color    = unit?.color ?? 'var(--color-primary)';
    const unitName = (b.booking_units ?? []).map(bu => bu.units?.name ?? '').filter(Boolean).join(', ') || '—';
    const nights   = Math.round((new Date(b.check_out+'T12:00:00') - new Date(b.check_in+'T12:00:00')) / 86400000);

    let statusChip = '';
    let actionBtn  = '';

    if (mode === 'arrival') {
      const done = !!b.checked_in_at;
      statusChip = done
        ? '<span style="font-size:.65rem;padding:1px 7px;border-radius:3px;background:var(--state-green-bg);color:var(--state-green-txt);font-weight:700">✓ Check-in</span>'
        : '<span style="font-size:.65rem;padding:1px 7px;border-radius:3px;background:var(--state-yellow-bg);color:var(--state-yellow-txt);font-weight:700">Pendiente</span>';
      actionBtn = !done
        ? '<button class="btn btn-primary btn-sm" style="flex-shrink:0;font-size:.72rem;padding:5px 10px" ' +
          'onclick="window._dashCheckIn(\'' + b.id + '\',\'arr-' + b.id + '\',\'' + guest.replace(/'/g,'&#39;') + '\')">✅ Check-in</button>'
        : '';
    } else if (mode === 'departure') {
      const done = !!b.checked_out_at;
      statusChip = done
        ? '<span style="font-size:.65rem;padding:1px 7px;border-radius:3px;background:var(--info-blue-bg);color:var(--info-blue-txt);font-weight:700">✓ Check-out</span>'
        : '<span style="font-size:.65rem;padding:1px 7px;border-radius:3px;background:var(--state-yellow-bg);color:var(--state-yellow-txt);font-weight:700">Pendiente</span>';
      actionBtn = !done
        ? '<button class="btn btn-outline btn-sm" style="flex-shrink:0;font-size:.72rem;padding:5px 10px" ' +
          'onclick="window._dashCheckOut(\'' + b.id + '\',\'dep-' + b.id + '\',\'' + guest.replace(/'/g,'&#39;') + '\')">👋 Check-out</button>'
        : '';
    }

    const idAttr = mode === 'arrival' ? ('arr-' + b.id) : mode === 'departure' ? ('dep-' + b.id) : '';

    return '<div id="' + idAttr + '" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--color-border)">' +
      '<div style="width:3px;min-height:44px;border-radius:2px;background:' + color + ';flex-shrink:0;align-self:stretch"></div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">' +
          '<span style="font-size:.72rem;font-weight:700;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + unitName + '</span>' +
          statusChip +
        '</div>' +
        '<div style="font-size:.82rem;font-weight:600;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + guest + '</div>' +
        '<div style="font-size:.72rem;color:var(--color-text-3);margin-top:1px">' + nights + ' noche' + (nights !== 1 ? 's' : '') + '</div>' +
      '</div>' +
      actionBtn +
    '</div>';
  }

  _renderArrivals(arrivals) {
    const container = document.getElementById('arrivals-list');
    if (!container) return;
    if (!arrivals.length) { container.innerHTML = '<p class="empty-state-sm">Sin llegadas hoy</p>'; return; }
    container.innerHTML = arrivals.map(b => this._bookingCard({ booking: b, mode: 'arrival' })).join('');
  }

  _renderDepartures(departures) {
    const container = document.getElementById('departures-list');
    if (!container) return;
    if (!departures.length) { container.innerHTML = '<p class="empty-state-sm">Sin salidas hoy</p>'; return; }
    container.innerHTML = departures.map(b => this._bookingCard({ booking: b, mode: 'departure' })).join('');
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
            <div class="forecast-bar-seg" style="width:${pctConf}%;background:var(--state-green)" title="Confirmado: ${fmt(confirmed)}"></div>
            <div class="forecast-bar-seg" style="width:${pctPart}%;background:var(--state-yellow)" title="Parcial: ${fmt(partial)}"></div>
            <div class="forecast-bar-seg" style="width:${pctPend}%;background:var(--color-border)" title="Pendiente: ${fmt(pending)}"></div>
          </div>
          <span class="forecast-bar-val">${fmt(confirmed + partial + pending)}</span>
        </div>

        <div class="forecast-bar-group">
          <div class="forecast-bar-label" style="color:var(--color-text-3)">${monthName} ${prevYear}</div>
          <div class="forecast-bar-track">
            <div class="forecast-bar-seg" style="width:${pctPrev}%;background:var(--color-border)"></div>
          </div>
          <span class="forecast-bar-val" style="color:var(--color-text-3)">${fmt(prevTotal)}</span>
        </div>

        <div class="forecast-legend">
          <span><span class="fleg-dot" style="background:var(--state-green)"></span>Confirmado ${fmt(confirmed)}</span>
          <span><span class="fleg-dot" style="background:var(--state-yellow)"></span>Parcial ${fmt(partial)}</span>
          <span><span class="fleg-dot" style="background:var(--color-border)"></span>Pendiente ${fmt(pending)}</span>
          ${yoyDelta !== null ? `<span style="margin-left:auto;font-weight:700;color:${yoyColor}">AaA ${yoySign}${yoyDelta}%</span>` : ''}
        </div>
      </div>`;
  }


  // ══════════════════════════════════════════════════
  // WIDGET LIMPIEZA DIARIA
  // ══════════════════════════════════════════════════
  async _fetchTodayCleaningTasks(today) {
    try {
      // NOTA: no se usa el embed units(...) — en algunos hoteles esa
      // relación no está en el schema cache de PostgREST y tira 400
      // (mismo bug que ya resolvimos en notification-service.js). Se
      // resuelve la unidad con AppContext.units, que ya está en memoria.
      const { data } = await this.db
        .from('cleaning_tasks')
        .select('id, title, status, unit_id, notes, scheduled_date')
        .eq('hotel_id', this.ctx.hotelId)
        .eq('scheduled_date', today)
        .order('status', { ascending: true });
      return (data ?? []).map(t => ({
        ...t,
        units: AppContext.units?.find(u => u.id === t.unit_id) ?? null,
      }));
    } catch { return []; }
  }

  _renderCleaningWidget(tasks) {
    const el = document.getElementById('dashboard-cleaning-widget');
    const revparCard = document.querySelector('[data-card-id="revpar"]');
    if (!el) return;

    // Sin tareas de limpieza hoy -> vuelve a mostrarse la card de RevPAR/ADR.
    if (!tasks.length) {
      el.style.setProperty('display', 'none', 'important');
      if (revparCard) revparCard.style.removeProperty('display');
      return;
    }

    // Con tareas hoy -> la card de Limpieza ocupa el mismo lugar/tamaño
    // que RevPAR/ADR, y esta última se oculta.
    // (.dash-card-uniform tiene "display:flex !important", por eso hay
    // que pisarlo también con !important — si no, quedaban las dos cards
    // visibles al mismo tiempo en vez de reemplazarse.)
    if (revparCard) revparCard.style.setProperty('display', 'none', 'important');
    el.style.setProperty('display', 'flex', 'important');

    const pending = tasks.filter(t => t.status !== 'completed');
    const state   = pending.length ? 'yellow' : 'green';
    const row = (t) => {
      const unit  = t.units;
      const color = unit?.color ?? '#6366f1';
      const done  = t.status === 'completed';
      return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--color-border);opacity:${done ? '.5' : '1'}">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
        <span style="font-size:.8rem;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${done ? 'text-decoration:line-through;color:var(--color-text-3)' : 'color:var(--color-text)'}">
          #${unit?.sort_order ?? '?'} · ${unit?.name ?? t.title ?? 'Limpieza'}
        </span>
        ${done
          ? `<span style="font-size:.68rem;color:var(--state-green-txt);font-weight:700;flex-shrink:0">✓</span>`
          : `<span style="font-size:.68rem;padding:2px 7px;border-radius:4px;background:var(--state-yellow-bg);color:var(--state-yellow-txt);font-weight:700;flex-shrink:0">Pendiente</span>`
        }
      </div>`;
    };
    el.innerHTML = `
      <div class="card-header">
        <h3>🧹 Limpieza de hoy</h3>
        <span style="font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--state-${state}-bg);color:var(--state-${state}-txt)">
          ${pending.length ? `${pending.length} pendiente${pending.length > 1 ? 's' : ''}` : '✓ Todo listo'}
        </span>
      </div>
      <div style="flex:1;overflow-y:auto">${tasks.map(row).join('')}</div>
      ${pending.length ? '<a href="#" onclick="window.milaNav&amp;&amp;window.milaNav(\'operations\');return false;" style="display:block;text-align:center;margin-top:8px;font-size:.75rem;color:var(--color-primary);font-weight:600;text-decoration:none">Ver en Operaciones →</a>' : ''}
    `;
  }

  // ══════════════════════════════════════════════════
  // EXTRA STATS — RevPAR, Cobros, Reservas del mes
  // ══════════════════════════════════════════════════
  async _fetchExtraStats(today) {
    try {
      const d    = new Date(today + 'T12:00:00');
      const year = d.getFullYear(), month = d.getMonth();
      const firstDay    = year + '-' + String(month+1).padStart(2,'0') + '-01';
      const lastDayObj  = new Date(year, month+1, 0);
      const lastDay     = year + '-' + String(month+1).padStart(2,'0') + '-' + String(lastDayObj.getDate()).padStart(2,'0');
      const daysInMonth = lastDayObj.getDate();

      // Previous month
      const prevD     = new Date(year, month - 1, 1);
      const prevFirst = prevD.getFullYear() + '-' + String(prevD.getMonth()+1).padStart(2,'0') + '-01';
      const prevLast  = new Date(prevD.getFullYear(), prevD.getMonth()+1, 0);
      const prevLastStr = prevD.getFullYear() + '-' + String(prevD.getMonth()+1).padStart(2,'0') + '-' + String(prevLast.getDate()).padStart(2,'0');

      const [bkRes, prevRes] = await Promise.all([
        this.db.from('bookings')
          .select('id, total_amount, total_paid, balance, nights, check_in, check_out, status')
          .eq('hotel_id', this.ctx.hotelId)
          .not('status', 'in', '(cancelled,blocked)')
          .gte('check_in', firstDay).lte('check_in', lastDay),
        this.db.from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('hotel_id', this.ctx.hotelId)
          .not('status', 'in', '(cancelled,blocked)')
          .gte('check_in', prevFirst).lte('check_in', prevLastStr),
      ]);

      const bks         = bkRes.data ?? [];
      const totalRev    = bks.reduce((s,b) => s + (b.total_amount ?? 0), 0);
      const totalPaid   = bks.reduce((s,b) => s + (b.total_paid  ?? 0), 0);
      const totalBal    = bks.reduce((s,b) => s + (b.balance     ?? 0), 0);
      const totalNights = bks.reduce((s,b) => s + (b.nights      ?? 0), 0);
      const units       = this.ctx.units?.length ?? 1;
      const avail       = units * daysInMonth;
      const revPAR      = avail > 0 ? totalRev / avail : 0;
      const adr         = totalNights > 0 ? totalRev / totalNights : 0;
      const occPct      = avail > 0 ? Math.min(100, Math.round(totalNights / avail * 100)) : 0;
      const prevCount   = prevRes.count ?? 0;

      return {
        revPAR, adr, occPct, totalNights,
        totalRev, totalPaid, totalBal,
        bkCount: bks.length, prevCount,
        ticket: bks.length > 0 ? totalRev / bks.length : 0,
      };
    } catch (err) {
      console.warn('[Dashboard] extraStats error:', err);
      return null;
    }
  }

  _renderRevPAR(stats) {
    if (!stats) return;
    const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
    const el  = document.getElementById('dash-revpar-val');
    if (el) el.textContent = fmt(stats.revPAR);
    const adrEl = document.getElementById('dash-adr-val');
    if (adrEl) adrEl.textContent = fmt(stats.adr);
    const occEl = document.getElementById('dash-occ-month-val');
    if (occEl) occEl.textContent = stats.occPct + '%';
    const nsEl  = document.getElementById('dash-nights-sold-val');
    if (nsEl)  nsEl.textContent  = stats.totalNights + ' noches';
  }

  _renderCobros(stats) {
    if (!stats) return;
    const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
    const valEl  = document.getElementById('dash-cobros-val');
    if (valEl) valEl.textContent = fmt(stats.totalBal);
    const badge  = document.getElementById('dash-cobros-badge');
    if (badge) badge.textContent = stats.bkCount + (stats.bkCount === 1 ? ' reserva' : ' reservas');
    const cobEl  = document.getElementById('dash-cobrado-val');
    if (cobEl) cobEl.textContent = fmt(stats.totalPaid);
    const totEl  = document.getElementById('dash-total-val');
    if (totEl) totEl.textContent = fmt(stats.totalRev);
    const fill   = document.getElementById('dash-cobros-bar-fill');
    if (fill && stats.totalRev > 0) {
      const cobPct = Math.min(100, Math.round(stats.totalPaid / stats.totalRev * 100));
      fill.style.width = cobPct + '%';
      // Estado financiero según % cobrado — misma escala roja/amarilla/verde
      const stateColor = cobPct < 30 ? 'var(--state-red)' : cobPct < 70 ? 'var(--state-yellow)' : 'var(--state-green)';
      fill.style.background = stateColor;
      if (cobEl) cobEl.style.color = stateColor;
    }
  }

  _renderReservasMes(stats) {
    if (!stats) return;
    const fmt   = n => '$' + Math.round(n).toLocaleString('es-AR');
    const valEl = document.getElementById('dash-rmes-val');
    if (valEl) valEl.textContent = stats.bkCount;
    const badge = document.getElementById('dash-rmes-badge');
    if (badge) badge.textContent = fmt(stats.totalRev);
    const vsEl  = document.getElementById('dash-rmes-vs');
    if (vsEl) {
      const diff = stats.bkCount - stats.prevCount;
      const sign = diff >= 0 ? '+' : '';
      vsEl.textContent  = sign + diff + ' vs mes ant.';
      vsEl.style.color  = diff >= 0 ? '#16a34a' : '#ef4444';
    }
    const tkEl = document.getElementById('dash-rmes-ticket');
    if (tkEl) tkEl.textContent = fmt(stats.ticket);
  }

  // ══════════════════════════════════════════════════
  // OCUPACIÓN PRÓXIMOS 7/14/28 DÍAS — reemplaza la card
  // "Próximo evento": un 0% hoy con llegadas a futuro
  // se entiende mejor con un mini-gráfico que anticipa
  // la curva de ocupación, no solo el dato puntual de hoy.
  // ══════════════════════════════════════════════════
  async _fetchOccupancyForecast(today) {
    const hotelId    = this.ctx.hotelId;
    const totalUnits = this.ctx.units?.length || 0;
    const HORIZON     = 28;
    const dayMs       = 24 * 60 * 60 * 1000;
    const start       = new Date(today + 'T12:00:00');
    const endISO      = toISODate(new Date(start.getTime() + (HORIZON - 1) * dayMs));

    try {
      const { data: bookings, error } = await this.db
        .from('bookings')
        .select('check_in, check_out, booking_units(unit_id)')
        .eq('hotel_id', hotelId)
        .not('status', 'in', '(cancelled,blocked)')
        .lt('check_in', endISO)
        .gt('check_out', today);
      if (error) throw error;

      // Por cada uno de los próximos 28 días, contar unidades distintas ocupadas
      const days = [];
      for (let i = 0; i < HORIZON; i++) {
        const d   = toISODate(new Date(start.getTime() + i * dayMs));
        const occ = new Set();
        (bookings ?? []).forEach(b => {
          if (b.check_in <= d && b.check_out > d) {
            (b.booking_units ?? []).forEach(bu => occ.add(bu.unit_id));
          }
        });
        days.push({ date: d, occupied: occ.size });
      }

      const pct = (n) => {
        const slice = days.slice(0, n);
        if (!slice.length || !totalUnits) return 0;
        const avg = slice.reduce((s, d) => s + d.occupied, 0) / slice.length;
        return Math.round((avg / totalUnits) * 100);
      };

      return { days, totalUnits, pct7: pct(7), pct14: pct(14), pct28: pct(28) };
    } catch (err) {
      console.warn('[Dashboard] _fetchOccupancyForecast:', err?.message ?? err);
      return { days: [], totalUnits, pct7: 0, pct14: 0, pct28: 0 };
    }
  }

  _renderOccupancyForecast(data, today) {
    const el = document.getElementById('dash-next-event');
    if (!el) return;
    const { days, pct7, pct14, pct28 } = data ?? {};

    if (!days?.length) {
      el.innerHTML = '<div style="padding:16px 0;text-align:center;color:var(--color-text-3);font-size:.82rem">📈 Sin datos de ocupación futura</div>';
      return;
    }

    const totalUnits = data.totalUnits || 1;
    const barW   = 6.4, gap = 1.5;
    const chartW = days.length * (barW + gap) - gap;
    const chartH = 92;
    // Degradé continuo rojo → amarillo → verde según % de ocupación:
    // 0% = rojo (baja), 50% = amarillo (media), 100% = verde (alta).
    const hexToRgb = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16));
    const rgbToHex = ([r,g,b]) => '#' + [r,g,b].map(n => Math.round(Math.max(0,Math.min(255,n))).toString(16).padStart(2,'0')).join('');
    const mix = (c1, c2, t) => rgbToHex(hexToRgb(c1).map((v,i) => v + (hexToRgb(c2)[i]-v)*t));
    const shade = (hex, amt) => rgbToHex(hexToRgb(hex).map(v => v + amt));
    const colorFor = pct => pct >= 50
      ? mix('#FACC15', '#22C55E', Math.min(1, (pct - 50) / 50))
      : mix('#EF4444', '#FACC15', Math.min(1, Math.max(0, pct) / 50));
    const refY = chartH - Math.round(chartH * 0.5); // línea de referencia al 50%

    let todayX = 0, todayPct = 0;
    const gradDefs = [];
    const bars = days.map((d, i) => {
      const pct = Math.round((d.occupied / totalUnits) * 100);
      // Piso más generoso que antes (4px) para que valores chicos (8-10%)
      // sigan siendo visibles como barra y no como una línea perdida.
      const h   = pct <= 0 ? 1.5 : Math.max(4, Math.round((pct / 100) * chartH));
      const x   = i * (barW + gap);
      const y   = chartH - h;
      const isToday = d.date === today;
      if (isToday) { todayX = x + barW / 2; todayPct = pct; }
      const fecha = new Date(d.date+'T12:00:00').toLocaleDateString('es-AR',{day:'numeric',month:'short'});
      const base  = colorFor(pct);
      const gid   = `occGrad${i}`;
      gradDefs.push(`<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${shade(base, 28)}"/><stop offset="100%" stop-color="${shade(base, -18)}"/></linearGradient>`);
      const ring  = isToday
        ? `<rect x="${x - 0.6}" y="${y - 0.6}" width="${barW + 1.2}" height="${h + 1.2}" rx="2" fill="none" stroke="var(--color-primary)" stroke-width="0.9"/>`
        : '';
      return `<g style="cursor:pointer">` +
             `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="1.6" fill="url(#${gid})" opacity="${isToday ? 1 : 0.92}"/>` +
             ring +
             `<title>${isToday ? 'Hoy' : fecha}: ${pct}% ocupado (${d.occupied}/${totalUnits})</title></g>`;
    }).join('');

    const lastDate = new Date(days[days.length - 1].date + 'T12:00:00')
      .toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });

    const statPill = (label, pct) => {
      const c = colorFor(pct);
      return `
        <div style="flex:1;text-align:center;padding:5px 2px;border-radius:9px;background:${c}1f">
          <div style="display:flex;align-items:center;justify-content:center;gap:4px">
            <span style="width:6px;height:6px;border-radius:50%;background:${c};flex-shrink:0"></span>
            <span style="font-size:.95rem;font-weight:800;color:var(--color-text)">${pct}%</span>
          </div>
          <div style="font-size:.6rem;color:var(--color-text-3);margin-top:1px">${label}</div>
        </div>`;
    };

    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px;height:100%;justify-content:center">
        <svg viewBox="0 0 ${chartW} ${chartH + 8}" width="100%" height="${chartH + 8}" style="display:block;overflow:visible">
          <defs>${gradDefs.join('')}</defs>
          <g transform="translate(0,8)">
            <line x1="0" y1="${refY}" x2="${chartW}" y2="${refY}" stroke="var(--color-border)" stroke-width="0.6" stroke-dasharray="2,2" />
            <text x="${chartW}" y="${refY - 1}" text-anchor="end" font-size="3.6" fill="var(--color-text-3)">50%</text>
            ${bars}
          </g>
          <line x1="${todayX}" y1="0" x2="${todayX}" y2="${chartH + 8 - Math.max(4, Math.round((todayPct/100)*chartH)) - 2}"
                stroke="var(--color-primary)" stroke-width="0.7" stroke-dasharray="1.5,1.5" opacity="0.55"/>
          <text x="${todayX}" y="6" text-anchor="middle" font-size="4.6" font-weight="700" fill="var(--color-primary)">HOY</text>
        </svg>
        <div style="display:flex;justify-content:space-between;font-size:.58rem;color:var(--color-text-3);padding:0 1px">
          <span>${new Date(days[0].date+'T12:00:00').toLocaleDateString('es-AR',{day:'numeric',month:'short'})}</span>
          <span>${lastDate}</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:5px">
          ${statPill('7 días', pct7)}
          ${statPill('14 días', pct14)}
          ${statPill('28 días', pct28)}
        </div>
        <div style="display:flex;align-items:center;gap:5px;margin-top:1px">
          <span style="font-size:.56rem;color:var(--color-text-3)">Baja</span>
          <div style="flex:1;height:4px;border-radius:2px;background:linear-gradient(90deg,#EF4444,#F59E0B,#22C55E)"></div>
          <span style="font-size:.56rem;color:var(--color-text-3)">Alta</span>
        </div>
      </div>`;
  }
  // ══════════════════════════════════════════════════
  // DINERO ASEGURADO — reservas futuras confirmadas
  // ══════════════════════════════════════════════════
  async _fetchDineroAsegurado(today) {
    try {
      const { data: bks, error } = await this.db
        .from('bookings')
        .select('id, total_amount, total_paid, status')
        .eq('hotel_id', this.ctx.hotelId)
        .gte('check_out', today)
        .not('status', 'in', '(cancelled,blocked)');

      if (error) throw error;
      const rows      = bks ?? [];
      const totalVend = rows.reduce((s,b) => s + (b.total_amount ?? 0), 0);
      const totalCobr = rows.reduce((s,b) => s + (b.total_paid  ?? 0), 0);
      const totalPend = rows.reduce((s,b) => s + Math.max(0, (b.total_amount ?? 0) - (b.total_paid ?? 0)), 0);
      return { totalVend, totalCobr, totalPend, count: rows.length };
    } catch (err) {
      console.warn('[Dashboard] _fetchDineroAsegurado:', err?.message ?? err);
      return { totalVend: 0, totalCobr: 0, totalPend: 0, count: 0 };
    }
  }

  _renderDineroAsegurado(s) {
    if (!s) return;
    const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
    const pct  = s.totalVend > 0 ? Math.min(100, Math.round(s.totalCobr / s.totalVend * 100)) : 0;
    const set  = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('dash-dinero-val',      fmt(s.totalVend));
    set('dash-dinero-cobrado',  fmt(s.totalCobr));
    set('dash-dinero-pendiente',fmt(s.totalPend));
    set('dash-dinero-count',    s.count + ' reserva' + (s.count !== 1 ? 's' : ''));
    set('dash-dinero-pct',      pct + '% cobrado');
    const fill = document.getElementById('dash-dinero-bar-fill');
    const stateColor = pct < 30 ? 'var(--state-red)' : pct < 70 ? 'var(--state-yellow)' : 'var(--state-green)';
    if (fill) { fill.style.width = pct + '%'; fill.style.background = stateColor; }
    const cobradoEl = document.getElementById('dash-dinero-cobrado');
    if (cobradoEl) cobradoEl.style.color = stateColor;
  }
}