import { isDemo } from "../auth/permissions.js";
// ═══════════════════════════════════════════════════
// dashboard.js — Panel de Hoy
// KPIs, Ocupación, Dólar, Llegadas, Recordatorios
// ═══════════════════════════════════════════════════

import { formatARS, formatDate, toISODate, showToast, localToday, localDateISO, AppContext, appendNote } from '../supabase-config.js';
import { fetchDollarRates } from '../services/dollar-api.js';
import { recordDailyRateSnapshot, getUsdConversionRate } from '../services/usd-rate-history.js';
import { Bus, EVENTS } from '../services/event-bus.js';
import { logAction } from '../services/audit-service.js';
// ↑ Sin import de app.js — evita dependencia circular.
// El badge se actualiza via CustomEvent que app.js escucha.

// Envoltorio de tiempo límite — mismo criterio que ya usamos en
// booking-form.js y audit-service.js. Sin esto, si una consulta puntual
// se cuelga, la acción se queda esperando para siempre sin avisar nada.
function _withTimeout(promise, label = 'operación', ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} tardó demasiado — revisá tu conexión`)), ms)),
  ]);
}

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
        Bus.emit(EVENTS.CHECKIN_DONE, { bookingId, guestName: guest, unitName: '' });
      } catch (e) {
        document.dispatchEvent(new CustomEvent('show:toast', { detail: { msg: 'Error: ' + e.message, type: 'error' } }));
      }
    };

    // "No vino" — el huésped no llegó y se cancela la reserva desde acá
    // mismo, sin tener que ir a Reservas. Ofrece nota de crédito con la
    // misma lógica que "Reprogramar" (retención opcional, no automática).
    const _noShowInProgress = new Set(); // bookingIds con el flujo "No vino" corriendo — evita duplicar la nota si se toca 2 veces seguidas
    window._dashNoShow = async (bookingId, rowId, guest) => {
      if (_noShowInProgress.has(bookingId)) return; // ya está corriendo para esta reserva, ignorar el segundo click
      _noShowInProgress.add(bookingId);
      try {
        const { data: b } = await _withTimeout(
          this.db.from('bookings')
            .select('check_in, notes, total_paid, status, booking_units(unit_id)')
            .eq('id', bookingId).single(),
          'buscar la reserva'
        );
        if (!b) { showToast('No se encontró la reserva', 'error'); return; }
        if (b.status === 'cancelled') {
          showToast(`Esta reserva ya estaba cancelada — no hay nada más que hacer acá. Si necesitás corregir la nota de crédito, hacelo desde Reservas.`, 'warning');
          await this.load?.();
          return;
        }

        const paid = Math.round(b.total_paid ?? 0);
        const freeDays   = parseFloat(AppContext.config?.cancel_free_days   ?? 3)  || 0;
        const penaltyPct = parseFloat(AppContext.config?.cancel_penalty_pct ?? 30) || 0;
        const daysToGo   = Math.round((new Date(b.check_in + 'T00:00:00') - new Date()) / 86400000);
        const wouldPenalize = paid > 0 && daysToGo < freeDays;

        let applyPenalty = false;
        if (wouldPenalize) {
          const suggestedRetained = Math.round(paid * (penaltyPct / 100));
          applyPenalty = confirm(
            `${guest} no vino — según la política de cancelación correspondería retener ${penaltyPct}% (${formatARS(suggestedRetained)}).\n\n` +
            `Aceptar → retener y dar crédito de ${formatARS(paid - suggestedRetained)}.\n` +
            `Cancelar → dar el 100% de crédito igual, sin retener nada (${formatARS(paid)}).`
          );
        }
        const credit = applyPenalty ? Math.round(paid * (1 - penaltyPct / 100)) : paid;

        const confirmMsg = paid <= 0
          ? `¿Marcar como "No vino" y cancelar la reserva de ${guest}?\n\nNo tenía pagos, no hay nota de crédito que generar.`
          : `¿Marcar como "No vino" y cancelar la reserva de ${guest}?\n\nQueda una Nota de Crédito por ${formatARS(credit)}${applyPenalty ? ` (se retienen ${formatARS(paid - credit)})` : ''}.`;
        if (!confirm(confirmMsg)) return;

        const today = new Date().toLocaleDateString('es-AR');
        const todayISO = new Date().toISOString().slice(0, 10);
        const cancelNote = credit > 0
          ? `🔄NC:${credit}:${todayISO} — No vino, nota de crédito por ${formatARS(credit)} (${today})`
          : `❌ No vino (${today})`;

        // .select() al final del update — así la respuesta nos dice
        // explícitamente qué fila(s) se modificaron. Si viniera vacío sin
        // error (ej: una política de permisos bloqueando el cambio en
        // silencio), lo detectamos acá en vez de festejar un éxito falso.
        const { data: updated, error } = await _withTimeout(
          this.db.from('bookings')
            .update({ status: 'cancelled', notes: appendNote(b.notes, cancelNote) })
            .eq('id', bookingId)
            .select('id'),
          'cancelar la reserva'
        );
        if (error) throw error;
        if (!updated?.length) {
          throw new Error('La reserva no se modificó — probablemente un permiso de la base de datos lo está bloqueando en silencio. Revisá las políticas de RLS de la tabla "bookings" para UPDATE.');
        }

        await logAction('CANCEL', 'booking', bookingId, `No vino: ${guest}${credit > 0 ? ` — NC ${formatARS(credit)}` : ''}`);
        Bus.emit(EVENTS.BOOKING_CANCELLED, {
          hotelId: this.ctx.hotelId,
          checkIn: b.check_in,
          checkOut: b.check_in, // no llegó a ocupar ninguna noche
          unitIds: (b.booking_units ?? []).map(bu => bu.unit_id),
        });

        showToast(`❌ ${guest} marcado como "No vino"${credit > 0 ? ` — NC ${formatARS(credit)}` : ''}`, 'info');
        document.dispatchEvent(new CustomEvent('booking:changed'));
        await this.load?.(); // recarga y vuelve a pintar la fila tachada/gris, no se borra
      } catch (err) {
        showToast('Error: ' + (err?.message ?? err), 'error');
      } finally {
        _noShowInProgress.delete(bookingId); // pase lo que pase, liberar — así un próximo click sí puede volver a intentarlo
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

          Bus.emit(EVENTS.CHECKOUT_DONE, { bookingId, guestName: guest, unitName });
          Bus.emit(EVENTS.UNIT_FREED, { unitName, guestName: guest });
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
      const [kpis, extraStats, dineroStats, dollarRates, occForecast, recHoy] = await Promise.all([
        this._fetchKPIs(today),
        this._fetchExtraStats(today),
        this._fetchDineroAsegurado(today),
        fetchDollarRates().catch(() => null),
        this._fetchOccupancyForecast(today),
        this._fetchRecaudacionHoy(today),
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
      this._renderRecaudacionHoy(recHoy);
      this._renderOccupancyRing(kpis.occupiedUnits ?? 0, this.ctx.units?.length ?? 7);
      this._renderArrivals(kpis.arrivals ?? []);
      this._renderDepartures(kpis.checkouts ?? []);
      // _renderStayingNow ya no inyecta en el grid — el widget de Estado
      // de unidades (#dash-unit-map-card, slot 4) cubre esa información.
      this._renderUnitMapWidget(kpis.activeBookings ?? [], kpis.arrivals ?? [], kpis.checkouts ?? [], today);
      this._renderDailyNote(today);
      // Widget de Limpieza — estaba definido pero nunca se llamaba
      this._fetchTodayCleaningTasks(today).then(tasks => this._renderCleaningWidget(tasks));
      // Recordatorio automático de saldo pendiente antes del check-in —
      // una vez por día (no en cada carga del dashboard) para no pegarle
      // de más a la base ni generar recordatorios duplicados el mismo día.
      this._autoCreateBalanceReminders(today);
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
        id, check_in, check_out, status, guest_id, checked_in_at, checked_out_at, pax, nights, total_amount, total_paid, balance,
        guests!bookings_guest_id_fkey(first_name, last_name),
        booking_units!inner(unit_id, units!inner(name, color, sort_order))
      `)
      .eq('hotel_id', hotelId)
      .neq('status', 'cancelled')
      .neq('status', 'blocked')
      .lte('check_in',  today)
      .gt('check_out', today);

    // Check-ins hoy — incluye canceladas (así una reserva marcada
    // "No vino" sigue viéndose tachada en gris, en vez de desaparecer
    // como si nunca hubiera existido)
    const { data: checkins } = await this.db
      .from('bookings')
      .select(`
        id, check_in, check_out, checked_in_at, total_amount, total_paid, balance, status, notes, pax,
        guests!bookings_guest_id_fkey(first_name, last_name, phone),
        booking_units(unit_id, units(name, color, sort_order))
      `)
      .eq('hotel_id', hotelId)
      .eq('check_in', today)
      .neq('status', 'blocked');

    // Check-outs hoy
    const { data: checkouts } = await this.db
      .from('bookings')
      .select(`
        id, check_in, check_out, checked_out_at, total_amount, total_paid, balance, pax,
        guests!bookings_guest_id_fkey(first_name, last_name),
        booking_units(unit_id, units(name, color, sort_order))
      `)
      .eq('hotel_id', hotelId)
      .eq('check_out', today)
      .neq('status', 'cancelled')
      .neq('status', 'blocked');

    // Unidades ocupadas hoy (para ocupación) — con detalle de huésped para tooltip
    // OJO: "ocupado" acá significa que el huésped REALMENTE está en el
    // complejo (apretó check-in), no solo que la fecha de hoy cae dentro
    // del rango de la reserva. Si el check-in es hoy pero todavía no se
    // registró, no cuenta como ocupado — recién cuenta cuando se hace el
    // check-in real. Las reservas que ya venían de días anteriores se
    // consideran ocupadas igual (asumimos que su check-in ya se hizo en
    // su momento; no volvemos a exigirlo retroactivamente).
    const occupiedUnitIds = new Set();
    const occupiedDetail  = []; // [{ unitName, guestName }]
    (activeBookings ?? []).forEach(b => {
      const arrivingToday = b.check_in === today;
      if (arrivingToday && !b.checked_in_at) return; // llega hoy pero no hizo check-in todavía
      if (b.checked_out_at) return; // ya se fue (salida anticipada), no cuenta como ocupado
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
      checkins.filter(b => b.status !== 'cancelled').forEach(b => {
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
      .select('check_in, check_out, total_amount, source, guests!bookings_guest_id_fkey(first_name,last_name), booking_units(units(name,color))')
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
      activeBookings: activeBookings ?? [],
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
    // El contador de arriba NO debe sumar canceladas ("No vino") — pero la
    // lista de abajo (_renderArrivals) sí las muestra, tachadas en gris.
    const activeCheckins = kpis.checkins.filter(b => b.status !== 'cancelled');
    const ciEl = document.getElementById('kpi-checkins-val');
    this._setKPI('kpi-checkins-val', activeCheckins.length);
    this._animateCounter(ciEl, activeCheckins.length);
    if (activeCheckins.length === 1) {
      const b = activeCheckins[0];
      const col = uColor(b) ?? 'var(--color-primary)';
      setSec('kpi-checkins',
        '<span style="display:inline-flex;align-items:center;gap:4px">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:' + col + ';flex-shrink:0"></span>' +
        '<span style="font-size:.68rem;color:var(--color-text-2);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px">' +
        (gName(b) || '—') + ' · ' + (uName(b) || '—') + '</span></span>');
    } else if (activeCheckins.length > 1) {
      setSec('kpi-checkins', '<span style="font-size:.68rem;color:var(--color-text-3)">' + activeCheckins.map(b => uName(b) ?? '—').join(' · ') + '</span>');
    } else {
      setSec('kpi-checkins', '<span style="font-size:.68rem;color:var(--color-text-3)">Sin llegadas hoy 😭</span>');
    }
    this._bindKpiTooltip('kpi-checkins', { emptyText: 'No hay ingresos para hoy.',
      lines: activeCheckins.map(b => (uName(b) ?? '—') + ' — ' + (gName(b) || '—')) });

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
    this._applyKpiState('kpi-checkins',  activeCheckins.length,  { total: _totalUnits });
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
      const units  = (b.booking_units ?? []).map(bu => bu?.units).filter(Boolean);
      const nights = Math.round((new Date(b.check_out+'T12:00:00') - new Date(b.check_in+'T12:00:00')) / 86400000);
      const dAway  = Math.round((new Date(b.check_in+'T12:00:00') - new Date(today+'T12:00:00')) / 86400000);
      const dayLabel = dAway === 0
        ? '<span style="font-size:.65rem;padding:1px 6px;border-radius:3px;background:var(--state-green-bg);color:var(--state-green-txt);font-weight:700">HOY</span>'
        : dAway === 1
        ? '<span style="font-size:.65rem;padding:1px 6px;border-radius:3px;background:var(--state-yellow-bg);color:var(--state-yellow-txt);font-weight:700">MAÑANA</span>'
        : '<span style="font-size:.65rem;color:var(--color-text-3)">en ' + dAway + 'd</span>';

      // Avatar + barra de color
      const nameParts2 = guest.trim().split(' ').filter(Boolean);
      const initials2  = (nameParts2.length >= 2
        ? nameParts2[0][0] + nameParts2[nameParts2.length-1][0]
        : (nameParts2[0]??'S').slice(0,2)).toUpperCase();
      const colors2 = units.map(u => u?.color ?? '#6366f1');
      let avBg2, avCol2;
      if (colors2.length === 0)      { avBg2='var(--color-surface-2)'; avCol2='var(--color-text-3)'; }
      else if (colors2.length === 1) { avBg2=colors2[0]+'33'; avCol2=colors2[0]; }
      else if (colors2.length === 2) { avBg2='linear-gradient(135deg,'+colors2[0]+'44 50%,'+colors2[1]+'44 50%)'; avCol2='var(--color-text)'; }
      else { const s=Math.round(360/colors2.length); avBg2='conic-gradient('+colors2.map((c,i)=>c+'44 '+(i*s)+'deg '+((i+1)*s)+'deg').join(',')+')'; avCol2='var(--color-text)'; }
      const upAvatar = '<div style="width:36px;height:36px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;background:'+avBg2+';color:'+avCol2+'">'+initials2+'</div>';
      const bh2 = Math.max(10, Math.round(36/Math.max(units.length,1)));
      const upBars = colors2.length > 0
        ? '<div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0;justify-content:center">'
            + colors2.map(col => '<div style="width:3px;height:'+bh2+'px;border-radius:2px;background:'+col+';"></div>').join('')
            + '</div>'
        : '<div style="width:3px;min-height:36px;border-radius:2px;background:#6366f1;flex-shrink:0"></div>';

      const unitNames = units.map(u => u?.name).filter(Boolean).join(' + ') || '—';
      const SRC_ICONS = { 'booking.com':'🔵', 'airbnb':'🔴', 'directo':'🟢', 'whatsapp':'💬', 'instagram':'📸', 'referido':'👥' };
      const srcIcon   = SRC_ICONS[(b.source ?? '').toLowerCase()] ?? '';

      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--color-border)">' +
        upBars + upAvatar +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">' +
            '<span style="font-size:.78rem;font-weight:700;color:var(--color-text)">' + fmt(b.check_in) + '</span>' +
            dayLabel +
            (srcIcon ? '<span style="font-size:.72rem" title="' + (b.source ?? '') + '">' + srcIcon + '</span>' : '') +
          '</div>' +
          '<div style="font-size:.82rem;font-weight:600;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + guest + '</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:1px">' +
            '<span style="font-size:.7rem;color:var(--color-text-3)">' + unitNames + ' · ' + nights + ' noche' + (nights!==1?'s':'') + '</span>' +
            (b.total_amount > 0 ? '<span style="font-size:.7rem;font-weight:700;color:var(--color-text-2)">$' + Math.round(b.total_amount).toLocaleString('es-AR') + '</span>' : '') +
          '</div>' +
        '</div></div>';
    }).join('');

    const countLine = '<div style="font-size:.78rem;font-weight:700;color:var(--color-text);margin-bottom:8px">' +
      bookings.length + ' llegada' + (bookings.length !== 1 ? 's' : '') + ' en los próximos ' + _upDays + ' días</div>';

    const headerBadge = document.querySelector('.widget-upcoming .badge-today');
    if (headerBadge) headerBadge.textContent = nextBadge;

    el.innerHTML = sBar + countLine + '<div style="max-height:230px;overflow-y:auto">' + rows + '</div>';
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

    // Variación día a día — compara el registro de hoy contra el de ayer
    // en el historial que ya se guarda para el promedio de 5 días.
    const hist = conv.history ?? [];
    if (hist.length >= 2) {
      const todayEntry = hist[hist.length - 1];
      const prevEntry  = hist[hist.length - 2];
      if (todayEntry?.sell && prevEntry?.sell) {
        const diffPct = Math.round(((todayEntry.sell - prevEntry.sell) / prevEntry.sell) * 1000) / 10;
        const up = diffPct > 0;
        const flat = diffPct === 0;
        const color = flat ? 'var(--color-text-3)' : up ? 'var(--state-red-txt)' : 'var(--state-green-txt)';
        const arrow = flat ? '=' : up ? '▲' : '▼';
        document.getElementById('dollar-day-delta')?.remove();
        const mainValEl = document.querySelector('.dollar-main-val');
        if (mainValEl) mainValEl.insertAdjacentHTML('afterend',
          `<div id="dollar-day-delta" style="font-size:.72rem;font-weight:700;color:${color};margin-top:-4px;margin-bottom:4px" title="vs. ayer (${prevEntry.date})">${arrow} ${Math.abs(diffPct)}% vs. ayer</div>`);
      }
    }

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
  // ── Chip de estado de pago: 🟢 saldado · 🔴 parcial · 🟡 sin pagos ──
  // Nuevo (aditivo): usa total_amount/total_paid si están presentes en la
  // query; si faltan, devuelve '' y la card se ve exactamente igual que antes.
  static _payStatusChip(b) {
    const total = b?.total_amount ?? null;
    const paid  = b?.total_paid   ?? null;
    if (total === null || total <= 0 || paid === null) return '';
    if (paid >= total) {
      return '<span title="Saldado" style="font-size:.6rem;font-weight:700;padding:1px 6px;border-radius:999px;background:var(--state-green-bg,#f0fdf4);color:var(--state-green-txt,#16a34a);white-space:nowrap">🟢 Saldado</span>';
    }
    if (paid > 0) {
      const resta = total - paid;
      return '<span title="Pago parcial — resta $' + Math.round(resta).toLocaleString('es-AR') + '" style="font-size:.6rem;font-weight:700;padding:1px 6px;border-radius:999px;background:#fef2f2;color:#dc2626;white-space:nowrap">🔴 Resta $' + Math.round(resta).toLocaleString('es-AR') + '</span>';
    }
    return '<span title="Sin pagos registrados" style="font-size:.6rem;font-weight:700;padding:1px 6px;border-radius:999px;background:var(--state-yellow-bg,#fefce8);color:var(--state-yellow-txt,#ca8a04);white-space:nowrap">🟡 Sin pagos</span>';
  }

  _bookingCard({ booking, mode }) {
    // mode: 'arrival' | 'departure' | 'upcoming'
    const b        = booking;
    const guest    = b.guests ? (b.guests.first_name + ' ' + b.guests.last_name) : 'Sin nombre';
    const units    = (b.booking_units ?? []).map(bu => bu?.units).filter(Boolean);
    const unitName = units.map(u => u?.name ?? '').filter(Boolean).join(' + ') || '—';
    const nights   = Math.round((new Date(b.check_out+'T12:00:00') - new Date(b.check_in+'T12:00:00')) / 86400000);
    const isCancelled = b.status === 'cancelled';

    // Iniciales del huésped
    const nameParts = guest.trim().split(' ').filter(Boolean);
    const initials  = (nameParts.length >= 2
      ? nameParts[0][0] + nameParts[nameParts.length - 1][0]
      : (nameParts[0] ?? 'S').slice(0, 2)).toUpperCase();

    const colors = units.map(u => u?.color ?? '#6366f1');
    let avatarBg, avatarColor;
    if (isCancelled || colors.length === 0) {
      avatarBg = 'var(--color-surface-2)'; avatarColor = 'var(--color-text-3)';
    } else if (colors.length === 1) {
      avatarBg = colors[0] + '33'; avatarColor = colors[0];
    } else if (colors.length === 2) {
      avatarBg = 'linear-gradient(135deg,'+colors[0]+'44 50%,'+colors[1]+'44 50%)'; avatarColor = 'var(--color-text)';
    } else {
      const step = Math.round(360/colors.length);
      avatarBg = 'conic-gradient('+colors.map((col,i)=>col+'44 '+(i*step)+'deg '+((i+1)*step)+'deg').join(',')+')';
      avatarColor = 'var(--color-text)';
    }
    const avatar = '<div style="width:38px;height:38px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;background:'+avatarBg+';color:'+avatarColor+'">'+initials+'</div>';

    // Barras de color: una por unidad, apiladas verticalmente
    const barH2 = Math.max(10, Math.round(38 / Math.max(units.length, 1)));
    const colorBars = isCancelled
      ? '<div style="width:3px;min-height:38px;border-radius:2px;background:var(--color-text-3);flex-shrink:0"></div>'
      : units.length > 0
        ? '<div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0;justify-content:center">'
            + units.map(u => '<div style="width:3px;height:'+barH2+'px;border-radius:2px;background:'+(u?.color??'#6366f1')+'"></div>').join('')
            + '</div>'
        : '<div style="width:3px;min-height:38px;border-radius:2px;background:#6366f1;flex-shrink:0"></div>';

    let statusChip = '';
    let actionBtn  = '';

    // Cancelada ("No vino" / reprogramada) — se sigue mostrando, tachada y
    // en gris, para que quede claro que existió pero no se concretó. No
    // tiene botones de acción (ya está resuelta).
    if (isCancelled) {
      const ncMatch = b.notes?.match(/🔄NC:(\d+):/);
      const ncAmount = ncMatch ? parseInt(ncMatch[1]) : 0;
      const ncUsed = b.notes?.includes('✅NCUSED');
      statusChip = ncAmount > 0
        ? `<span style="font-size:.65rem;padding:1px 7px;border-radius:3px;background:var(--color-surface-2);color:var(--color-text-3);font-weight:700">${ncUsed ? '✓ NC usada' : '🔄 NC abierta'}</span>`
        : '<span style="font-size:.65rem;padding:1px 7px;border-radius:3px;background:var(--color-surface-2);color:var(--color-text-3);font-weight:700">❌ No vino</span>';

      const idAttr = mode === 'arrival' ? ('arr-' + b.id) : mode === 'departure' ? ('dep-' + b.id) : '';
      return '<div id="' + idAttr + '" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--color-border);opacity:.55">' +
        avatar +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">' +
            '<span style="font-size:.72rem;font-weight:700;color:var(--color-text-3);text-decoration:line-through;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + unitName + '</span>' +
            statusChip +
          '</div>' +
          '<div style="font-size:.82rem;font-weight:600;color:var(--color-text-3);text-decoration:line-through;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + guest + '</div>' +
          '<div style="font-size:.72rem;color:var(--color-text-3)">' + nights + ' noche' + (nights !== 1 ? 's' : '') + (ncAmount > 0 ? ' · NC ' + formatARS(ncAmount) : '') + '</div>' +
        '</div>' +
      '</div>';
    }

    if (mode === 'arrival') {
      const done = !!b.checked_in_at;
      statusChip = done
        ? '<span style="font-size:.65rem;padding:1px 7px;border-radius:3px;background:var(--state-green-bg);color:var(--state-green-txt);font-weight:700">✓ Check-in</span>'
        : '<span style="font-size:.65rem;padding:1px 7px;border-radius:3px;background:var(--state-yellow-bg);color:var(--state-yellow-txt);font-weight:700">Pendiente</span>';
      // Data attributes para evitar que apostrofos en el nombre rompan el JS
      // (ej: "D'Ostin" con apostrofo dentro de un onclick='...' string literal)
      actionBtn = !done
        ? '<div style="display:flex;gap:5px;flex-shrink:0">' +
          '<button class="btn btn-primary btn-sm" style="font-size:.72rem;padding:5px 10px" ' +
          'data-action="checkin" data-bid="' + b.id + '" data-row="arr-' + b.id + '" data-guest="' + guest.replace(/"/g,'&quot;') + '">✅ Check-in</button>' +
          '<button class="btn btn-primary btn-sm" title="No vino / Cancelar" aria-label="No vino / Cancelar" style="font-size:.72rem;padding:5px 10px" ' +
          'data-action="noshow" data-bid="' + b.id + '" data-row="arr-' + b.id + '" data-guest="' + guest.replace(/"/g,'&quot;') + '">❌</button>' +
          '</div>'
        : '';
    } else if (mode === 'departure') {
      const done = !!b.checked_out_at;
      statusChip = done
        ? '<span style="font-size:.65rem;padding:1px 7px;border-radius:3px;background:var(--info-blue-bg);color:var(--info-blue-txt);font-weight:700">✓ Check-out</span>'
        : '<span style="font-size:.65rem;padding:1px 7px;border-radius:3px;background:var(--state-yellow-bg);color:var(--state-yellow-txt);font-weight:700">Pendiente</span>';
      // data-action evita el bug del apostrofo en nombres como D'Ostin
      actionBtn = !done
        ? '<button class="btn btn-outline btn-sm" style="flex-shrink:0;font-size:.72rem;padding:5px 10px" ' +
          'data-action="checkout" data-bid="' + b.id + '" data-row="dep-' + b.id + '" data-guest="' + guest.replace(/"/g,'&quot;') + '">👋 Check-out</button>'
        : '';
    }

    const idAttr = mode === 'arrival' ? ('arr-' + b.id) : mode === 'departure' ? ('dep-' + b.id) : '';

    return '<div id="' + idAttr + '" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--color-border)">' +
      colorBars + avatar +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:5px;margin-bottom:2px;flex-wrap:wrap">' +
          '<span style="font-size:.7rem;font-weight:600;color:var(--color-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px">' + unitName + '</span>' +
          statusChip +
        '</div>' +
        '<div style="font-size:.82rem;font-weight:600;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + guest + '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:1px;gap:6px;flex-wrap:wrap">' +
          '<span style="font-size:.7rem;color:var(--color-text-3)">' + nights + ' noche' + (nights !== 1 ? 's' : '') +
            (b.pax ? ' · 👥 ' + b.pax : '') + '</span>' +
          '<span style="display:flex;align-items:center;gap:5px">' +
            Dashboard._payStatusChip(b) +
            (b.total_amount > 0 ? '<span style="font-size:.72rem;font-weight:700;color:var(--color-text-2)">$' + Math.round(b.total_amount).toLocaleString('es-AR') + '</span>' : '') +
          '</span>' +
        '</div>' +
      '</div>' +
      actionBtn +
    '</div>';
  }

  _renderArrivals(arrivals) {
    const container = document.getElementById('arrivals-list');
    if (!container) return;
    if (!arrivals.length) { container.innerHTML = '<p class="empty-state-sm">Sin llegadas hoy</p>'; return; }
    container.innerHTML = arrivals.map(b => this._bookingCard({ booking: b, mode: 'arrival' })).join('');

    // Delegación: maneja checkin y noshow via data-action para evitar
    // que apostrofos en nombres (D'Ostin) rompan el onclick JS.
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, bid, row, guest } = btn.dataset;
      if (action === 'checkin') window._dashCheckIn(bid, row, guest);
      if (action === 'noshow')  window._dashNoShow(bid, row, guest);
    });
  }

  _renderDepartures(departures) {
    const container = document.getElementById('departures-list');
    if (!container) return;
    if (!departures.length) { container.innerHTML = '<p class="empty-state-sm">Sin salidas hoy</p>'; return; }
    container.innerHTML = departures.map(b => this._bookingCard({ booking: b, mode: 'departure' })).join('');

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, bid, row, guest } = btn.dataset;
      if (action === 'checkout') window._dashCheckOut(bid, row, guest);
    });
  }

  // ── NUEVO: "Alojados ahora" — card inyectada entre Llegadas y Salidas ──
  // Aditivo: crea su propio contenedor si no existe; no toca el HTML estático
  // ni las cards existentes. Lista reservas con check-in hecho y sin check-out.
  _renderStayingNow(activeBookings, today) {
    try {
      const arrivalsCard = document.querySelector('[data-card-id="arrivals"]');
      if (!arrivalsCard) return;

      // Alojado = ya está adentro: check-in registrado (o empezó antes de hoy)
      // y todavía no hizo check-out.
      const staying = (activeBookings ?? []).filter(b => {
        if (b.checked_out_at) return false;
        const arrivingToday = b.check_in === today;
        if (arrivingToday && !b.checked_in_at) return false;
        return true;
      });

      let card = document.getElementById('dash-staying-card');
      if (!staying.length) { if (card) card.remove(); return; }

      if (!card) {
        card = document.createElement('div');
        card.className = 'card dash-card-uniform';
        card.id = 'dash-staying-card';
        card.dataset.cardId = 'staying-now';
        arrivalsCard.insertAdjacentElement('afterend', card);
      }

      const fmtD = s => { const [,m,d] = (s??'').split('-'); return d && m ? d+'/'+m : s; };
      const rows = staying.map(b => {
        const guest = b.guests ? ((b.guests.first_name??'')+' '+(b.guests.last_name??'')).trim() : 'Sin nombre';
        const units = (b.booking_units ?? []).map(bu => bu?.units).filter(Boolean);
        const uNames = units.map(u => u?.name).filter(Boolean).join(' + ') || '—';
        const color  = units[0]?.color ?? '#6366f1';
        const nights = b.nights ?? Math.round((new Date(b.check_out+'T12:00:00') - new Date(b.check_in+'T12:00:00'))/86400000);
        const leavesToday = b.check_out === today;
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--color-border)">'
          + '<span style="width:8px;height:8px;border-radius:50%;background:'+color+';flex-shrink:0"></span>'
          + '<div style="flex:1;min-width:0">'
          +   '<div style="font-size:.8rem;font-weight:600;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+guest+'</div>'
          +   '<div style="font-size:.68rem;color:var(--color-text-3)">'
          +     uNames+' · '+fmtD(b.check_in)+' → '+fmtD(b.check_out)+' · '+nights+'n'
          +     (b.pax ? ' · 👥 '+b.pax : '')
          +   '</div>'
          + '</div>'
          + (leavesToday
              ? '<span style="font-size:.6rem;font-weight:700;padding:1px 7px;border-radius:4px;background:var(--info-blue-bg,#eff6ff);color:var(--info-blue-txt,#2563eb);white-space:nowrap;flex-shrink:0">Sale hoy</span>'
              : '<span style="font-size:.6rem;font-weight:700;padding:1px 7px;border-radius:4px;background:var(--state-green-bg,#f0fdf4);color:var(--state-green-txt,#16a34a);white-space:nowrap;flex-shrink:0">Alojado</span>')
          + '</div>';
      }).join('');

      card.innerHTML =
        '<div class="card-header"><h3>🛏️ Alojados ahora</h3>'
        + '<span style="font-size:.65rem;font-weight:700;padding:2px 8px;border-radius:4px;background:var(--color-surface-2);color:var(--color-text-2)">'+staying.length+'</span></div>'
        + '<div style="flex:1;overflow-y:auto;max-height:220px">'+rows+'</div>';
    } catch (err) { console.warn('[Dashboard] staying-now:', err); }
  }

  // ── NUEVO: Widget "Mapa de unidades ahora" ───────────────────────────────
  // Grilla de los deptos coloreada por estado. Click abre la reserva.
  // Aditivo: crea su propio contenedor; si falla no afecta ningún otro bloque.
  _renderUnitMapWidget(activeBookings, arrivals, departures, today) {
    try {
      const card = document.getElementById('dash-unit-map-card');
      if (!card || !this.ctx.units?.length) return;

      const units = [...(this.ctx.units ?? [])].sort((a,b) => (a.sort_order??99)-(b.sort_order??99));
      const nCols = Math.min(units.length, 4);

      // Mapear bookings activos por unit_id (reservas que ocupan hoy)
      const byUnit = {};
      [...activeBookings, ...arrivals, ...departures].forEach(b => {
        (b.booking_units ?? []).forEach(bu => {
          const uid = String(bu.unit_id ?? bu.id ?? '');
          if (!byUnit[uid]) byUnit[uid] = b;
        });
      });

      // ── Lógica de color por estado/canal ──────────────────────────────────
      // Prioridad: canal externo (Booking/Airbnb/etc) > pagado > seña > sin depósito > libre
      const PLATFORM_SOURCES = new Set(['booking','airbnb','expedia','despegar','walkin','company','referral','family']);
      const SOURCE_COLORS = {
        booking:  { color:'#1D4ED8', label:'Booking',   icon:'B' },
        airbnb:   { color:'#EA580C', label:'Airbnb',    icon:'A' },
        expedia:  { color:'#DC2626', label:'Expedia',   icon:'E' },
        despegar: { color:'#059669', label:'Despegar',  icon:'D' },
        walkin:   { color:'#0891B2', label:'Espontáneo',icon:'W' },
        family:   { color:'#7C3AED', label:'Familia',   icon:'F' },
        company:  { color:'#0F766E', label:'Empresa',   icon:'C' },
        referral: { color:'#B45309', label:'Referido',  icon:'R' },
      };

      const getTileState = (bk, unitColor) => {
        if (!bk) {
          // Libre: tinte casi imperceptible del color del propio depto
          const uc = unitColor ?? '#94a3b8';
          return { color: uc, bg: uc + '0a', border: uc + '20', txt: uc, label:'Libre', empty:true };
        }
        const src = bk.source ?? 'direct';
        const st  = bk.status ?? 'pending';

        // Canal externo — color del canal, fondo muy sutil
        if (PLATFORM_SOURCES.has(src) && SOURCE_COLORS[src]) {
          const sc = SOURCE_COLORS[src];
          return { color: sc.color, bg: sc.color + '0d', border: sc.color + '30', txt: sc.color, label: sc.label, icon: sc.icon, source: true };
        }
        // Pagado — verde muy sutil
        if (st === 'paid')    return { color:'#16a34a', bg:'#f0fdf4', border:'#16a34a28', txt:'#15803d', label:'Pagado',      paid:true    };
        // Con seña — rojo muy sutil
        if (st === 'partial') return { color:'#dc2626', bg:'#fef2f2', border:'#dc262628', txt:'#991b1b', label:'Con seña',    partial:true };
        // Sin depósito — ámbar muy sutil
        return                       { color:'#d97706', bg:'#fffbeb', border:'#d9770628', txt:'#92400e', label:'Sin depósito', nopay:true   };
      };

      const tiles = units.map(u => {
        const uid    = String(u.id);
        const bk     = byUnit[uid];
        const state  = getTileState(bk, u.color ?? '#94a3b8');
        const fName  = bk?.guests?.first_name ?? '';
        const nights = bk ? (bk.nights ?? Math.round((new Date(bk.check_out+'T12:00:00')-new Date(bk.check_in+'T12:00:00'))/86400000)) : 0;
        const gShort = fName ? fName.split(' ')[0].slice(0,10) : '';
        const isCI   = bk && bk.check_in === today;
        const isCO   = bk && bk.check_out === today;
        // Solo número: "#1", "#2"…
        const uNum   = '#' + (u.sort_order ?? '?');
        // Tipo corto debajo del número
        const uType  = (u.name ?? '')
          .replace(/\d+AMB\s*/,'').replace('Planta Baja','P. Baja').replace('Planta Alta','P. Alta')
          .replace(/Duplex/i,'Duplex');

        return '<div'
          +' data-unit-map-bid="'+(bk?.id ?? '')+'"'
          +' data-unit-map-uid="'+uid+'"'
          +' title="'+u.name+(gShort ? ' · '+gShort : '')+(bk ? ' · '+bk.check_in+' → '+bk.check_out : ' · click para nueva reserva')+'"'
          +' style="border-radius:8px;padding:8px 7px 7px;cursor:pointer;user-select:none;'
          +'overflow:hidden;min-width:0;box-sizing:border-box;'
          +'background:'+state.bg+';border:1.5px solid '+(state.border ?? state.color+'28')+';'
          +'display:flex;flex-direction:column;gap:1px;'
          +'transition:transform .12s,box-shadow .12s"'
          +' onmouseover="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 4px 12px rgba(0,0,0,.1)\'"'
          +' onmouseout="this.style.transform=\'\';this.style.boxShadow=\'\'">'
          // Fila 1: número + badge (solo si ocupado)
          +'<div style="display:flex;align-items:center;justify-content:space-between;gap:2px;min-width:0">'
          +'<span style="font-size:.7rem;font-weight:800;color:'+state.color+'">' + uNum + '</span>'
          +(bk ? '<span style="font-size:.46rem;font-weight:700;padding:1px 4px;border-radius:3px;'
            +'background:'+state.color+';color:#fff;white-space:nowrap;flex-shrink:0;line-height:1.5">'
            +(isCI ? 'Entra' : isCO ? 'Sale' : state.label)+'</span>' : '')
          +'</div>'
          // Fila 2: tipo de unidad (siempre) o nombre huésped (si ocupado)
          +(bk
            ? '<div style="font-size:.62rem;font-weight:600;color:'+state.txt+';'
              +'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">'+(gShort||'—')+'</div>'
              +'<div style="font-size:.54rem;color:'+state.txt+';opacity:.7;white-space:nowrap">'+nights+'n'+(bk.pax ? ' · 👥'+bk.pax : '')+'</div>'
            : '<div style="font-size:.6rem;color:'+state.color+';opacity:.5;margin-top:2px">'+uType+'</div>')
          +'</div>';
      }).join('');

      const total = units.length;
      const occ   = Object.keys(byUnit).length;
      const pct   = total > 0 ? Math.round(occ/total*100) : 0;

      card.innerHTML =
        `<div class="card-header" style="margin-bottom:10px">
          <h3>🏘️ Estado de unidades</h3>
          <span style="font-size:.7rem;font-weight:700;color:var(--color-text-3)">
            ${occ}/${total} ocupadas · ${pct}%
          </span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px">${tiles}</div>`;

      // ── Click handlers ──────────────────────────────────────────────────────
      card.querySelectorAll('[data-unit-map-bid]').forEach(tile => {
        tile.addEventListener('click', () => {
          const bid = tile.dataset.unitMapBid;
          const uid = tile.dataset.unitMapUid;
          if (bid) {
            // Tiene reserva → editar
            if (window._bookingFormInstance?.openEdit) window._bookingFormInstance.openEdit(bid);
          } else {
            // Libre → nueva reserva con unidad + fecha de hoy pre-cargadas
            if (window._bookingFormInstance?.open) {
              window._bookingFormInstance.open({ unitId: uid, checkIn: today });
            }
          }
        });
      });

    } catch(err) { console.warn('[Dashboard] unit-map:', err); }
  }

  // tabla daily_notes (una nota por hotel+fecha). Si la tabla no existe
  // todavía, el bloque muestra el aviso y no rompe nada más.
  async _renderDailyNote(today) {
    try {
      const grid = document.getElementById('dashboard-cards');
      if (!grid) return;

      let card = document.getElementById('dash-daily-note-card');
      if (!card) {
        card = document.createElement('div');
        card.className = 'card';
        card.id = 'dash-daily-note-card';
        card.dataset.cardId = 'daily-note';
        card.style.gridColumn = '1 / -1';
        grid.insertAdjacentElement('beforeend', card);
      }

      card.innerHTML =
        '<div class="card-header" style="margin-bottom:8px"><h3>📝 Notas del día</h3>'
        + '<span id="dash-note-status" style="font-size:.65rem;color:var(--color-text-3)"></span></div>'
        + '<textarea id="dash-note-input" rows="2" placeholder="Avisos para el turno: llaves, pedidos especiales, pendientes…"'
        + ' style="width:100%;border:1px solid var(--color-border);border-radius:8px;padding:10px 12px;font-size:.82rem;'
        + 'font-family:inherit;background:var(--color-surface);color:var(--color-text);resize:vertical;box-sizing:border-box"></textarea>';

      const input  = card.querySelector('#dash-note-input');
      const status = card.querySelector('#dash-note-status');

      // Cargar nota existente de hoy
      try {
        const { data } = await this.db.from('daily_notes')
          .select('note').eq('hotel_id', this.ctx.hotelId).eq('note_date', today).maybeSingle();
        if (data?.note) input.value = data.note;
      } catch { if (status) status.textContent = '(tabla daily_notes pendiente de crear)'; }

      // Guardado con debounce al escribir
      let t = null;
      input.addEventListener('input', () => {
        clearTimeout(t);
        if (status) status.textContent = 'Escribiendo…';
        t = setTimeout(async () => {
          try {
            const { error } = await this.db.from('daily_notes').upsert(
              { hotel_id: this.ctx.hotelId, note_date: today, note: input.value },
              { onConflict: 'hotel_id,note_date' }
            );
            if (status) status.textContent = error ? '⚠ No se pudo guardar' : '✓ Guardado';
          } catch { if (status) status.textContent = '⚠ No se pudo guardar'; }
        }, 700);
      });
    } catch (err) { console.warn('[Dashboard] daily-note:', err); }
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
  // ── Recordatorio automático: saldo pendiente antes del check-in ──
  // Corre una vez por día (localStorage). Busca reservas que hacen
  // check-in hoy o mañana con saldo > 0, y si todavía no existe un
  // recordatorio automático para esa reserva puntual, lo crea. El
  // marcador 🔔AUTOBAL:<id> en la descripción es lo que evita duplicarlo
  // si el dashboard se recarga varias veces en el mismo día.
  async _autoCreateBalanceReminders(today) {
    try {
      if (localStorage.getItem('mila_autobal_lastrun') === today) return;

      const tomorrow = toISODate(new Date(new Date(today + 'T12:00:00').getTime() + 86400000));
      const { data: bookings } = await this.db
        .from('bookings')
        .select('id, check_in, balance, guests(first_name, last_name), booking_units(unit_id)')
        .eq('hotel_id', this.ctx.hotelId)
        .not('status', 'in', '(cancelled,blocked)')
        .in('check_in', [today, tomorrow])
        .gt('balance', 0);

      if (!bookings?.length) { localStorage.setItem('mila_autobal_lastrun', today); return; }

      const { data: existing } = await this.db
        .from('reminders')
        .select('description')
        .eq('hotel_id', this.ctx.hotelId)
        .eq('scheduled_date', today)
        .like('description', '%🔔AUTOBAL:%');

      const alreadyCovered = new Set(
        (existing ?? []).map(r => r.description?.match(/🔔AUTOBAL:([a-f0-9-]+)/)?.[1]).filter(Boolean)
      );

      const toCreate = bookings.filter(b => !alreadyCovered.has(String(b.id)));
      if (!toCreate.length) { localStorage.setItem('mila_autobal_lastrun', today); return; }

      const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
      const rows = toCreate.map(b => {
        const guest = b.guests ? `${b.guests.first_name ?? ''} ${b.guests.last_name ?? ''}`.trim() : 'Huésped';
        const when  = b.check_in === today ? 'hoy' : 'mañana';
        return {
          hotel_id:       this.ctx.hotelId,
          title:          `💸 Saldo pendiente — check-in ${when}`,
          description:    `${guest} debe ${fmt(b.balance)} 🔔AUTOBAL:${b.id}`,
          scheduled_date: today,
          unit_ids:       (b.booking_units ?? []).map(bu => bu.unit_id),
          is_note:        false,
        };
      });

      await this.db.from('reminders').insert(rows);
      localStorage.setItem('mila_autobal_lastrun', today);
    } catch (err) {
      console.warn('[Dashboard] autoCreateBalanceReminders:', err?.message ?? err);
      // No marcar lastrun si falló — que reintente la próxima carga.
    }
  }

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
    const revparCard = document.querySelector('[data-card-id="rmes"]');
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
          : `<button data-quick-clean-id="${t.id}" style="font-size:.68rem;padding:2px 8px;border-radius:4px;background:var(--state-yellow-bg);color:var(--state-yellow-txt);font-weight:700;flex-shrink:0;border:none;cursor:pointer" title="Marcar como lista">✓ Listo</button>`
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

    el.querySelectorAll('[data-quick-clean-id]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const id = btn.dataset.quickCleanId;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await this.db.from('cleaning_tasks').update({ status: 'completed' }).eq('id', id);
          const updated = tasks.map(t => t.id === id ? { ...t, status: 'completed' } : t);
          this._renderCleaningWidget(updated);
          document.dispatchEvent(new CustomEvent('booking:changed')); // refresca campana/operaciones
        } catch (err) {
          showToast('Error al marcar como lista: ' + (err?.message ?? err), 'error');
          btn.disabled = false;
          btn.textContent = '✓ Listo';
        }
      });
    });
  }

  // ══════════════════════════════════════════════════
  async _fetchRecaudacionHoy(today) {
    try {
      const { data } = await this.db.from('payments')
        .select('amount, amount_ars, method, booking_id')
        .eq('hotel_id', this.ctx.hotelId)
        .eq('payment_date', today);
      return data ?? [];
    } catch { return []; }
  }

  _renderRecaudacionHoy(payments) {
    const total = payments.reduce((s, p) => s + (p.amount_ars ?? p.amount ?? 0), 0);
    const count = payments.length;
    const el    = document.getElementById('dash-rec-hoy-val');
    const sub   = document.getElementById('dash-rec-hoy-sub');
    const cnt   = document.getElementById('dash-rec-hoy-count');
    if (el)  el.textContent  = total > 0 ? formatARS(total) : '$0';
    if (sub) sub.textContent = count > 0 ? `En ${count} pago${count !== 1 ? 's' : ''} registrado${count !== 1 ? 's' : ''} hoy` : 'Sin pagos registrados hoy';
    if (cnt) cnt.textContent = count;

    // NUEVO (aditivo): chips con desglose por método de cobro, debajo del
    // subtítulo. Crea su propio contenedor; si no hay pagos, lo limpia.
    try {
      if (!sub) return;
      let chipsEl = document.getElementById('dash-rec-hoy-methods');
      if (!chipsEl) {
        chipsEl = document.createElement('div');
        chipsEl.id = 'dash-rec-hoy-methods';
        chipsEl.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;margin-top:2px;margin-bottom:4px';
        sub.insertAdjacentElement('afterend', chipsEl);
      }
      if (!payments.length) { chipsEl.innerHTML = ''; return; }

      const byMethod = {};
      payments.forEach(p => {
        const m = (p.method ?? 'otro').toLowerCase();
        byMethod[m] = (byMethod[m] ?? 0) + (p.amount_ars ?? p.amount ?? 0);
      });
      const METHOD_CFG = {
        transferencia: { icon: '🟩', label: 'Transferencia', bg: '#f0fdf4', txt: '#16a34a' },
        efectivo:      { icon: '🟨', label: 'Efectivo',      bg: '#fefce8', txt: '#ca8a04' },
        qr:            { icon: '🟦', label: 'QR',            bg: '#eff6ff', txt: '#2563eb' },
        debito:        { icon: '💳', label: 'Débito',        bg: '#faf5ff', txt: '#7c3aed' },
        tarjeta:       { icon: '💳', label: 'Tarjeta',       bg: '#faf5ff', txt: '#7c3aed' },
        usd:           { icon: '💵', label: 'USD',           bg: '#f0fdf4', txt: '#15803d' },
      };
      chipsEl.innerHTML = Object.entries(byMethod)
        .sort((a,b) => b[1]-a[1])
        .map(([m, amt]) => {
          const cfg = METHOD_CFG[m] ?? { icon: '💰', label: m.charAt(0).toUpperCase()+m.slice(1), bg: 'var(--color-surface-2)', txt: 'var(--color-text-2)' };
          return '<span style="font-size:.62rem;font-weight:700;padding:2px 7px;border-radius:4px;background:'+cfg.bg+';color:'+cfg.txt+';white-space:nowrap">'
            + cfg.icon + ' ' + cfg.label + ' $' + Math.round(amt).toLocaleString('es-AR') + '</span>';
        }).join('');
    } catch (err) { console.warn('[Dashboard] rec-methods:', err); }
  }

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

      const [bkRes, prevRes, cancelledNCRes] = await Promise.all([
        this.db.from('bookings')
          .select('id, total_amount, total_paid, balance, nights, check_in, check_out, status')
          .eq('hotel_id', this.ctx.hotelId)
          .not('status', 'in', '(cancelled,blocked)')
          .gte('check_in', firstDay).lte('check_in', lastDay),
        this.db.from('bookings')
          .select('id, total_amount')
          .eq('hotel_id', this.ctx.hotelId)
          .not('status', 'in', '(cancelled,blocked)')
          .gte('check_in', prevFirst).lte('check_in', prevLastStr),
        this.db.from('bookings')
          .select('id, total_paid, notes')
          .eq('hotel_id', this.ctx.hotelId)
          .eq('status', 'cancelled')
          .gt('total_paid', 0)
          .gte('check_in', firstDay).lte('check_in', lastDay),
      ]);

      const bks         = bkRes.data ?? [];
      // Reservas canceladas este mes con Nota de Crédito ABIERTA — la
      // seña que ya cobraron sigue siendo plata real, cuenta como
      // "cobrado" y como parte de lo "facturado" (ajustado a lo que
      // efectivamente se cobró, no el monto original completo). No suma
      // a noches/ocupación/ticket promedio — eso sigue siendo solo de
      // reservas activas, como corresponde.
      const cancelledOpenNC = (cancelledNCRes.data ?? []).filter(b =>
        b.notes?.includes('🔄NC:') && !b.notes?.includes('✅NCUSED') && !b.notes?.includes('❌NCVOID')
      );
      const ncCollected = cancelledOpenNC.reduce((s,b) => s + (b.total_paid ?? 0), 0);

      const totalRev    = bks.reduce((s,b) => s + (b.total_amount ?? 0), 0) + ncCollected;
      const totalPaid   = bks.reduce((s,b) => s + (b.total_paid  ?? 0), 0) + ncCollected;
      const totalBal    = bks.reduce((s,b) => s + (b.balance     ?? 0), 0);
      const totalNights = bks.reduce((s,b) => s + (b.nights      ?? 0), 0);
      const units       = this.ctx.units?.length ?? 1;
      const avail       = units * daysInMonth;
      const revPAR      = avail > 0 ? totalRev / avail : 0;
      const adr         = totalNights > 0 ? totalRev / totalNights : 0;
      const occPct      = avail > 0 ? Math.min(100, Math.round(totalNights / avail * 100)) : 0;
      const prevBks     = prevRes.data ?? [];
      const prevCount   = prevBks.length;
      const prevRev     = prevBks.reduce((s,b) => s + (b.total_amount ?? 0), 0);

      return {
        revPAR, adr, occPct, totalNights,
        totalRev, totalPaid, totalBal,
        bkCount: bks.length, prevCount,
        ticket: bks.length > 0 ? totalRev / bks.length : 0,
        prevTicket: prevCount > 0 ? prevRev / prevCount : 0,
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
    const monthLabel = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    const subtitleEl = document.getElementById('dash-cobros-subtitle');
    if (subtitleEl) subtitleEl.textContent = `${monthLabel.charAt(0).toUpperCase()}${monthLabel.slice(1)} · mes completo`;
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
      const pctEl = document.getElementById('dash-cobros-pct');
      if (pctEl) pctEl.textContent = cobPct + '% cobrado';
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
    const tkVsEl = document.getElementById('dash-rmes-ticket-vs');
    if (tkVsEl) {
      if (stats.prevTicket > 0) {
        const diffPct = Math.round(((stats.ticket - stats.prevTicket) / stats.prevTicket) * 100);
        const sign = diffPct >= 0 ? '+' : '';
        tkVsEl.textContent = `${sign}${diffPct}% vs ${fmt(stats.prevTicket)} mes ant.`;
        tkVsEl.style.color = diffPct >= 0 ? '#16a34a' : '#ef4444';
      } else {
        tkVsEl.textContent = '';
      }
    }
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
      const prevStart    = new Date(start.getTime() - HORIZON * dayMs);
      const prevEndISO   = toISODate(new Date(prevStart.getTime() + (HORIZON - 1) * dayMs));
      const prevStartISO = toISODate(prevStart);

      // Antes esto era secuencial (esperaba la consulta actual, y RECIÉN
      // ahí arrancaba la de comparación) — con eso, este fetch por sí solo
      // tardaba el doble, y como corre en paralelo con el resto del
      // dashboard, terminaba siendo el más lento de los 5 y frenando toda
      // la carga del Panel de Hoy. Ahora las 2 consultas van juntas.
      const [{ data: bookings, error }, { data: prevBookings }] = await Promise.all([
        this.db.from('bookings')
          .select('check_in, check_out, booking_units(unit_id)')
          .eq('hotel_id', hotelId)
          .not('status', 'in', '(cancelled,blocked)')
          .lt('check_in', endISO)
          .gt('check_out', today),
        this.db.from('bookings')
          .select('check_in, check_out, booking_units(unit_id)')
          .eq('hotel_id', hotelId)
          .not('status', 'in', '(cancelled,blocked)')
          .lt('check_in', prevEndISO)
          .gt('check_out', prevStartISO),
      ]);
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

      const result = { days, totalUnits, pct7: pct(7), pct14: pct(14), pct28: pct(28) };

      try {
        const prevDays = [];
        for (let i = 0; i < HORIZON; i++) {
          const d   = toISODate(new Date(prevStart.getTime() + i * dayMs));
          const occ = new Set();
          (prevBookings ?? []).forEach(b => {
            if (b.check_in <= d && b.check_out > d) (b.booking_units ?? []).forEach(bu => occ.add(bu.unit_id));
          });
          prevDays.push({ date: d, occupied: occ.size });
        }
        const prevPct = (n) => {
          const slice = prevDays.slice(0, n);
          if (!slice.length || !totalUnits) return 0;
          return Math.round((slice.reduce((s, d) => s + d.occupied, 0) / slice.length / totalUnits) * 100);
        };
        result.prevPct7  = prevPct(7);
        result.prevPct14 = prevPct(14);
        result.prevPct28 = prevPct(28);
      } catch (_) { /* comparación es un plus, no crítica */ }

      return result;
    } catch (err) {
      console.warn('[Dashboard] _fetchOccupancyForecast:', err?.message ?? err);
      return { days: [], totalUnits, pct7: 0, pct14: 0, pct28: 0 };
    }
  }

  _renderOccupancyForecast(data, today) {
    const el = document.getElementById('dash-next-event');
    if (!el) return;
    const { days, pct7, pct14, pct28, prevPct7, prevPct14, prevPct28 } = data ?? {};

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

    const statPill = (label, pct, prevPct) => {
      const c = colorFor(pct);
      const hasComparison = prevPct !== undefined && prevPct !== null;
      const delta = hasComparison ? pct - prevPct : null;
      const deltaColor = delta > 0 ? 'var(--state-green-txt)' : delta < 0 ? 'var(--state-red-txt)' : 'var(--color-text-3)';
      const deltaTxt = delta === null ? '' : delta === 0 ? '=' : (delta > 0 ? '▲+' : '▼') + Math.abs(delta) + 'pp';
      return `
        <div style="flex:1;text-align:center;padding:5px 2px;border-radius:9px;background:${c}1f">
          <div style="display:flex;align-items:center;justify-content:center;gap:4px">
            <span style="width:6px;height:6px;border-radius:50%;background:${c};flex-shrink:0"></span>
            <span style="font-size:.95rem;font-weight:800;color:var(--color-text)">${pct}%</span>
          </div>
          <div style="font-size:.6rem;color:var(--color-text-3);margin-top:1px">${label}</div>
          ${hasComparison ? `<div style="font-size:.58rem;font-weight:700;color:${deltaColor}" title="vs. hace 4 semanas: ${prevPct}%">${deltaTxt}</div>` : ''}
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
          ${statPill('7 días', pct7, prevPct7)}
          ${statPill('14 días', pct14, prevPct14)}
          ${statPill('28 días', pct28, prevPct28)}
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
      const [activeRes, cancelledRes] = await Promise.all([
        this.db.from('bookings')
          .select('id, total_amount, total_paid, status')
          .eq('hotel_id', this.ctx.hotelId)
          .gte('check_out', today)
          .not('status', 'in', '(cancelled,blocked)'),
        this.db.from('bookings')
          .select('id, total_paid, notes')
          .eq('hotel_id', this.ctx.hotelId)
          .eq('status', 'cancelled')
          .gt('total_paid', 0),
      ]);
      if (activeRes.error) throw activeRes.error;

      const activeRows = activeRes.data ?? [];
      // Una reserva cancelada con Nota de Crédito ABIERTA (no usada, no
      // anulada) sigue teniendo plata real cobrada — esa seña entró al
      // complejo y no se le devuelve a nadie. Cuenta como "cobrado" y
      // como parte de lo "facturado", pero el resto del monto original
      // (lo que nunca se llegó a cobrar) no cuenta para nada — no hay
      // saldo pendiente de una reserva cancelada.
      const cancelledOpenNC = (cancelledRes.data ?? []).filter(b =>
        b.notes?.includes('🔄NC:') && !b.notes?.includes('✅NCUSED') && !b.notes?.includes('❌NCVOID')
      );

      const totalVend = activeRows.reduce((s,b) => s + (b.total_amount ?? 0), 0)
                       + cancelledOpenNC.reduce((s,b) => s + (b.total_paid ?? 0), 0);
      const totalCobr = activeRows.reduce((s,b) => s + (b.total_paid  ?? 0), 0)
                       + cancelledOpenNC.reduce((s,b) => s + (b.total_paid ?? 0), 0);
      const totalPend = activeRows.reduce((s,b) => s + Math.max(0, (b.total_amount ?? 0) - (b.total_paid ?? 0)), 0);
      return { totalVend, totalCobr, totalPend, count: activeRows.length };
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