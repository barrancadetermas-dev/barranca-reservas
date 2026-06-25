// ═══════════════════════════════════════════════════
// calendar.js v4.1 — MILA Sistema Inteligente
// • Fix mobile: grid columns fijos + scroll horizontal
// • Fix click en barras (independiente del drag)
// • Fix colores desaturados en vista mes (reservas pasadas)
// • Drag & Drop de reservas (fechas + unidad)
// • Leyendas como Accordion con estado persistente
// ═══════════════════════════════════════════════════

import {
  toISODate, getBookingBarColor, getUnitLabel, getUnitColor,
  getUnitChipHTML, getSourceBadgeHTML, SOURCE_CONFIG, UNIT_CATALOG,
  showToast, formatARS, formatDate, AppContext
} from '../supabase-config.js';
import { can } from '../auth/permissions.js';
import { getHolidaysForYear, isWeekend } from '../services/arg-holidays.js';
import { logAction } from '../services/audit-service.js';
import { cachedQuery, cache } from '../services/supabase-cache.js';
import { Bus, EVENTS } from '../services/event-bus.js';

const DAY_NAMES   = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const STATUS_LABELS = {
  pending:   'Sin seña',
  partial:   'Con seña',
  paid:      'Pagado',
  blocked:   'Bloqueo',
  cancelled: 'Cancelado',
};

export class Calendar {
  constructor(supabase, ctx, bookingForm) {
    this.db          = supabase;
    this.ctx         = ctx;
    this.bookingForm = bookingForm;
    const now        = new Date();
    this.year        = now.getFullYear();
    this.month       = now.getMonth();
    this._drag       = { active: false, startDay: null, unitId: null, moved: false };
    this._tooltip    = null;
    this._ghost      = this._createGhost();
    this._view       = 'month';
    this._weekStart  = this._getWeekStart(new Date());
    this._barDrag    = { active: false, booking: null, unitId: null, startX: 0, moved: false };

    this._dragAbort  = null;
    this._dragBound  = false;

    window._calInstance = this;
    this._setupControls();
    this._setupContextMenu();
    this._setupDocumentEvents();

    this._pendingPulse = new Set();

    Bus.on(EVENTS.CAL_PULSE_BAR, ({ bookingId }) => {
      this._pendingPulse.add(bookingId);
    });

    Bus.on(EVENTS.CAL_RELOAD, () => this.load());
  }

  // ── Carga del calendario ──────────────────────────
  async load() {
    if (this._isLoading) return;
    this._isLoading = true;

    document.getElementById('cal-month-title').textContent =
      `${MONTH_NAMES[this.month]} ${this.year}`;
    try {
      const [bookings, reminders] = await Promise.all([
        this._fetchBookings(),
        this._fetchReminders().catch(err => {
          console.warn('[Calendar] reminders fetch failed (ignorado):', err?.message ?? err);
          return [];
        }),
      ]);
      this._lastRenderedBookings = bookings;

      const cellMap     = this._buildCellMap(bookings);
      const reminderMap = this._buildReminderMap(reminders);
      this._render(cellMap, reminderMap);
      this._renderAccordionLegend();
      if (!this._dragBound) {
        const grid = document.getElementById('calendar-grid');
        if (grid) {
          this._setupDragSelection(grid);
          this._setupBarDrag(grid);
          this._dragBound = true;
        }
      }
    } catch (err) {
      console.error('Calendar load error:', err);
      if (!err?.message?.includes('call stack')) {
        showToast('Error al cargar el calendario', 'error');
      }
    } finally {
      this._isLoading = false;
    }
  }

  // ── Fetch reservas ───────────────────────────────
  async _fetchBookings() {
    const firstDay = `${this.year}-${String(this.month+1).padStart(2,'0')}-01`;
    const lastDay  = toISODate(new Date(this.year, this.month+1, 0));
    const params   = { hotelId: this.ctx.hotelId, firstDay, lastDay };

    return cachedQuery(this.db, 'bookings', params, () =>
      this.db.from('bookings').select(`
        id, check_in, check_out, status, source, is_blocked, block_reason,
        total_amount, total_paid, balance, nights, pax, adults, children, notes,
        price_per_night,
        guests!bookings_guest_id_fkey(first_name, last_name, bad_experience, tags),
        booking_units(unit_id, units(name, sort_order, color, max_guests))
      `)
      .eq('hotel_id', this.ctx.hotelId)
      .neq('status', 'cancelled')
      .lte('check_in', lastDay)
      .gt('check_out', firstDay)
    );
  }

  // ── Fetch recordatorios ───────────────────────────
  async _fetchReminders() {
    const firstDay = `${this.year}-${String(this.month+1).padStart(2,'0')}-01`;
    const lastDay  = toISODate(new Date(this.year, this.month+1, 0));
    const { data, error } = await this.db
      .from('reminders')
      .select('*, units(name, sort_order)')
      .eq('hotel_id', this.ctx.hotelId)
      .gte('scheduled_date', firstDay)
      .lte('scheduled_date', lastDay)
      .is('completed', false);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  // ── Mapa de celdas ────────────────────────────────
  _buildCellMap(bookings) {
    const daysInMonth = new Date(this.year, this.month+1, 0).getDate();
    const map = {};
    this.ctx.units.forEach(u => {
      map[u.id] = {};
      for (let d = 1; d <= daysInMonth; d++) map[u.id][d] = [];
    });
    bookings.forEach(b => {
      const ci = new Date(b.check_in  + 'T12:00:00');
      const co = new Date(b.check_out + 'T12:00:00');
      (b.booking_units ?? []).forEach(({ unit_id }) => {
        if (!map[unit_id]) return;
        for (let d = 1; d <= daysInMonth; d++) {
          const cell = new Date(this.year, this.month, d, 12, 0, 0);
          if (cell >= ci && cell < co) {
            map[unit_id][d].push({ ...b, _cellType: this._getCellType(ci, co, cell) });
          }
        }
      });
    });
    return map;
  }

  _getCellType(ci, co, cell) {
    const sd = (a,b) => a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
    const endDay = new Date(co); endDay.setDate(endDay.getDate()-1);
    if (sd(cell, ci))     return 'start';
    if (sd(cell, endDay)) return 'end';
    return 'middle';
  }

  _buildReminderMap(reminders) {
    const map = {};
    reminders.forEach(r => {
      if (!map[r.scheduled_date]) map[r.scheduled_date] = [];
      map[r.scheduled_date].push(r);
    });
    return map;
  }

  // ── Renderizado del grid ──────────────────────────
  _render(cellMap, reminderMap) {
    const grid        = document.getElementById('calendar-grid');
    const daysInMonth = new Date(this.year, this.month+1, 0).getDate();
    const today       = new Date();
    const todayDay    = today.getDate();
    const todayMonth  = today.getMonth();
    const todayYear   = today.getFullYear();
    const todayISO    = today.toISOString().split('T')[0];
    const holidays    = getHolidaysForYear(this.year);

    // ── FIX MOBILE: ancho fijo por celda + scroll horizontal ──
    const cellW = window.innerWidth <= 768 ? 32 : 38;
    grid.style.gridTemplateColumns = `160px repeat(${daysInMonth}, ${cellW}px)`;
    grid.style.minWidth = `${160 + daysInMonth * cellW}px`;
    grid.style.width    = 'max-content';

    // Forzar scroll en el contenedor padre
    const gridParent = grid.parentElement;
    if (gridParent) {
      gridParent.style.overflowX          = 'auto';
      gridParent.style.webkitOverflowScrolling = 'touch';
      gridParent.style.width              = '100%';
    }

    grid.classList.add('month-grid');
    grid.classList.remove('week-grid');
    grid.innerHTML = '';

    const corner = document.createElement('div');
    corner.className = 'cal-unit-label-header';
    corner.textContent = 'Departamento';
    grid.appendChild(corner);

    for (let d = 1; d <= daysInMonth; d++) {
      const date      = new Date(this.year, this.month, d);
      const isToday   = d===todayDay && this.month===todayMonth && this.year===todayYear;
      const dateISO   = `${this.year}-${String(this.month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const hasRem    = !!reminderMap[dateISO];
      const dayOfWeek = date.getDay();
      const isWknd    = dayOfWeek === 0 || dayOfWeek === 6;
      const isPastDay = dateISO < todayISO;
      const holiday   = holidays?.get ? holidays.get(dateISO) : null;
      const isHoliday = !!holiday && holiday.type !== 'vacation';

      const dh = document.createElement('div');
      let dhCls = 'cal-day-header';
      if (isToday)              dhCls += ' today';
      if (isWknd)               dhCls += ' weekend';
      if (isPastDay && !isToday) dhCls += ' past-header';
      if (isHoliday)            dhCls += ` holiday holiday-${holiday.type}`;
      dh.className = dhCls;
      dh.title = holiday?.label ?? '';
      dh.innerHTML = `${d}<span class="day-name">${DAY_NAMES[date.getDay()]}</span>
        ${hasRem ? `<div style="width:4px;height:4px;border-radius:50%;background:var(--color-warning);margin:2px auto 0"></div>` : ''}
        ${isToday ? `<div style="width:4px;height:4px;border-radius:50%;background:var(--color-primary);margin:1px auto 0"></div>` : ''}`;
      grid.appendChild(dh);
    }

    this.ctx.units.forEach(unit => {
      const unitColor = getUnitColor(unit);
      const unitLabel = getUnitLabel(unit);

      const label = document.createElement('div');
      label.className = 'cal-unit-label';
      label.style.setProperty('--unit-color', unitColor);
      label.style.borderLeftColor = unitColor;
      const hasNotes = !!unit.internal_notes;
      label.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px">
          <span class="cal-unit-dot" style="background-color:${unitColor}"></span>
          <span style="font-size:.82rem;font-weight:700;color:var(--color-text)">${unitLabel}</span>
          ${hasNotes ? `<span title="${unit.internal_notes}" style="cursor:help;font-size:.85rem" onclick="window._calInstance._showUnitNote(event,'${unit.internal_notes?.replace(/'/g,"\\'") ?? ''}')">📝</span>` : ''}
          ${can('manageUnitNotes') ? `<button class="btn btn-ghost btn-xs" style="padding:1px 4px;font-size:.65rem;opacity:.5" onclick="window._calInstance.editUnitNotes('${unit.id}','${(unit.internal_notes??'').replace(/'/g,"\\'")}')">✏️</button>` : ''}
        </div>
        <span class="unit-floor" style="padding-left:16px">Hasta ${unit.max_guests} pers.</span>`;
      grid.appendChild(label);

      for (let d = 1; d <= daysInMonth; d++) {
        const dateISO  = `${this.year}-${String(this.month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isToday  = d===todayDay && this.month===todayMonth && this.year===todayYear;
        const bookings = cellMap[unit.id]?.[d] ?? [];
        const rems     = reminderMap[dateISO] ?? [];

        const cellHoliday = holidays.get(dateISO);
        const cellIsWknd  = new Date(dateISO + 'T12:00:00').getDay() % 6 === 0;
        const cellIsPast  = dateISO < todayISO;

        const cell = document.createElement('div');
        let cellCls = 'cal-cell';
        if (isToday)           cellCls += ' today-col';
        if (cellIsWknd)        cellCls += ' weekend-col';
        if (cellIsPast)        cellCls += ' past-col';
        if (cellHoliday?.type === 'fixed' || cellHoliday?.type === 'movable') cellCls += ' holiday-col';
        if (cellHoliday?.type === 'vacation') cellCls += ' vacation-col';
        if (cellHoliday?.type === 'bridge')   cellCls += ' bridge-col';
        cell.className      = cellCls;
        cell.dataset.day    = d;
        cell.dataset.unitId = unit.id;
        cell.dataset.date   = dateISO;
        if (cellHoliday) cell.title = cellHoliday.label;

        if (bookings.length === 0) {
          this._bindEmptyCell(cell, unit.id, d, dateISO);
        } else if (bookings.length === 1) {
          this._renderSingleBar(cell, bookings[0], todayISO);
        } else {
          const co = bookings.find(b => b._cellType === 'end');
          const ci = bookings.find(b => b._cellType === 'start');
          if (co && ci) this._renderSplitCell(cell, co, ci, todayISO);
          else this._renderSingleBar(cell, bookings[0], todayISO);
        }

        rems.forEach(r => {
          if (r.unit_id && r.unit_id !== unit.id) return;
          const dot = document.createElement('div');
          dot.className = 'cal-reminder-dot';
          dot.innerHTML = `<div class="tooltip">🔔 ${r.title}${r.units ? ` · #${r.units.sort_order} ${r.units.name}` : ''}</div>`;
          cell.appendChild(dot);
        });

        grid.appendChild(cell);
      }
    });
  }

  // ── Helper: avatar de iniciales ───────────────────
  static _guestAvatar(guest, size = 18) {
    if (!guest) return '';
    const fn = guest.first_name ?? '';
    const ln = guest.last_name  ?? '';
    if (!fn && !ln) return '';
    const initials = ((fn[0] ?? '') + (ln[0] ?? '')).toUpperCase();
    const str   = (fn + ln).toLowerCase();
    let hash    = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const hue   = Math.abs(hash) % 360;
    return `<span class="bar-avatar" style="
      display:inline-flex;align-items:center;justify-content:center;
      width:${size}px;height:${size}px;min-width:${size}px;border-radius:50%;
      background:hsl(${hue},55%,88%);color:hsl(${hue},55%,28%);
      font-size:${Math.max(8, Math.round(size*0.44))}px;font-weight:800;
      flex-shrink:0;line-height:1;margin-right:5px;
    ">${initials}</span>`;
  }

  // ── Barra única con avatar ────────────────────────
  _renderSingleBar(cell, booking, todayISO) {
    if (booking._cellType !== 'start' && booking._cellType !== 'solo') return;

    const { color, textColor } = getBookingBarColor(booking);
    const firstName = booking.guests?.first_name ?? '';
    const lastName  = booking.guests?.last_name  ?? '';
    const blockText = booking.block_reason ?? 'Bloqueo';
    const guestFull = booking.guests ? `${lastName} ${firstName}`.trim() : blockText;
    const isBlock   = booking.status === 'blocked' || booking.is_blocked;

    // ── FIX COLORES PASADOS: versión desaturada para checkout anterior a hoy ──
    const isPast = booking.check_out <= todayISO;

    const ci = new Date(booking.check_in  + 'T12:00:00');
    const co = new Date(booking.check_out + 'T12:00:00');
    const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();

    const startDay = Math.max(ci.getDate(), 1);
    const endDay   = Math.min(co.getDate() - 1, daysInMonth);
    const coMonth  = co.getMonth();
    const coYear   = co.getFullYear();
    const isCoNextMonth = (coYear > this.year) || (coYear === this.year && coMonth > this.month);
    const lastDay  = isCoNextMonth ? daysInMonth : endDay;
    const nights   = Math.max(1, lastDay - startDay + 1);

    const bar = document.createElement('div');
    bar.className = 'bar bar-span';

    if (this._pendingPulse.has(booking.id)) {
      bar.classList.add('bar-new-bounce');
      this._pendingPulse.delete(booking.id);
      setTimeout(() => bar.classList.remove('bar-new-bounce'), 1200);
    }

    bar.style.cssText = `
      background: ${color};
      position: absolute; top: 6px; bottom: 6px; left: 4px;
      width: calc(${nights} * 100% - 8px);
      z-index: 3; border-radius: 6px;
      display: flex; align-items: center; padding: 0 8px;
      overflow: hidden; white-space: nowrap;
      cursor: grab; transition: filter .15s, transform .15s, box-shadow .15s;
      ${isPast ? 'filter: grayscale(52%) opacity(.62);' : ''}
    `;
    bar.dataset.bookingId = booking.id;

    const avatar = !isBlock ? Calendar._guestAvatar(booking.guests, 16) : '';

    bar.innerHTML = `
      ${avatar}
      <span style="color:${textColor};font-size:.68rem;font-weight:700;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0">
        ${guestFull}
      </span>`;
    bar.title = `${guestFull} | ${booking.check_in} → ${booking.check_out}`;

    bar.addEventListener('mouseenter', (e) => {
      if (!this._barDrag.active) {
        if (!isPast) {
          bar.style.filter    = 'brightness(1.12)';
          bar.style.transform = 'scaleY(1.05)';
        }
        bar.style.boxShadow = '0 2px 8px rgba(0,0,0,.25)';
      }
      this._showTooltip(booking, e);
    });
    bar.addEventListener('mousemove',  (e) => this._moveTooltip(e));
    bar.addEventListener('mouseleave', () => {
      bar.style.filter    = isPast ? 'grayscale(52%) opacity(.62)' : '';
      bar.style.transform = '';
      bar.style.boxShadow = '';
      this._hideTooltip();
    });

    // ── FIX CLICK: handler explícito independiente del drag ──
    bar.addEventListener('click', (e) => {
      if (this._barDrag.moved) return;
      e.stopPropagation();
      this._openDetailById(booking.id);
    });

    cell.appendChild(bar);
  }

  // ── Celda dividida (RECAMBIO) ─────────────────────
  _renderSplitCell(cell, coBooking, ciBooking, todayISO) {
    const todayStr  = todayISO ?? new Date().toISOString().split('T')[0];
    const coColor   = getBookingBarColor(coBooking).color;
    const ciColor   = getBookingBarColor(ciBooking).color;
    const coIsPast  = coBooking.check_out <= todayStr;
    const ciIsPast  = ciBooking.check_out <= todayStr;

    const left = document.createElement('div');
    left.className = 'bar bar-split-left';
    left.style.background = coColor;
    if (coIsPast) left.style.filter = 'grayscale(52%) opacity(.62)';
    left.dataset.bookingId = coBooking.id;
    left.title = `Sale: ${coBooking.guests?.first_name ?? ''} ${coBooking.guests?.last_name ?? ''}`;
    left.addEventListener('mouseenter', (e) => this._showTooltip(coBooking, e));
    left.addEventListener('mousemove',  (e) => this._moveTooltip(e));
    left.addEventListener('mouseleave', ()  => this._hideTooltip());
    left.addEventListener('click', (e) => { e.stopPropagation(); this._openDetailById(coBooking.id); });

    const right = document.createElement('div');
    right.className = 'bar bar-split-right';
    right.style.background = ciColor;
    if (ciIsPast) right.style.filter = 'grayscale(52%) opacity(.62)';
    right.dataset.bookingId = ciBooking.id;
    right.title = `Entra: ${ciBooking.guests?.first_name ?? ''} ${ciBooking.guests?.last_name ?? ''}`;
    right.addEventListener('mouseenter', (e) => this._showTooltip(ciBooking, e));
    right.addEventListener('mousemove',  (e) => this._moveTooltip(e));
    right.addEventListener('mouseleave', ()  => this._hideTooltip());
    right.addEventListener('click', (e) => { e.stopPropagation(); this._openDetailById(ciBooking.id); });

    cell.appendChild(left);
    cell.appendChild(right);
    cell.style.background = 'rgba(251,113,133,.04)';
  }

  // ── Celda vacía ───────────────────────────────────
  _bindEmptyCell(cell, unitId, day, dateISO) {
    cell.addEventListener('click', (e) => {
      if (this._drag.moved) return;
      this.bookingForm.open({ unitId, checkIn: dateISO });
    });
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._ctxTarget = { unitId, day, dateISO };
      this._showContextMenu(e.clientX, e.clientY);
    });
  }

  // ── ACCORDION LEGEND ─────────────────────────────
  _renderAccordionLegend() {
    const container = document.getElementById('cal-legend-container');
    if (!container) return;

    const STATUS_ITEMS = [
      { color: '#EAB308', label: 'Sin seña (directo)' },
      { color: '#DC2626', label: 'Con seña / depósito' },
      { color: '#16A34A', label: 'Pagado' },
      { color: '#374151', label: 'Bloqueo / No disponible' },
    ];

    const CHANNEL_ITEMS = Object.entries(SOURCE_CONFIG)
      .filter(([k]) => k !== 'direct')
      .map(([, cfg]) => ({ color: cfg.dot ?? cfg.color ?? '#64748b', label: cfg.label }));

    const UNIT_ITEMS = this.ctx.units.map(u => ({
      color: getUnitColor(u), label: getUnitLabel(u),
    }));

    const CAL_ITEMS = [
      { color: 'rgba(99,102,241,.15)', border: '#6366f1', label: 'Fin de semana' },
      { color: 'rgba(239,68,68,.12)',  border: '#ef4444', label: 'Feriado nacional' },
      { color: 'rgba(168,85,247,.10)', border: '#a855f7', label: 'Puente turístico' },
      { color: 'rgba(20,184,166,.10)', border: '#14b8a6', label: 'Vacaciones invierno' },
    ];

    const savedState = JSON.parse(localStorage.getItem('mila_legend_state') ?? 'null') ?? {
      status: true, channels: false, units: false, calendar: false
    };

    const section = (key, title, items, isUnit = false) => {
      const open = savedState[key];
      return `
        <div class="legend-accordion">
          <button class="legend-acc-header ${open ? 'open' : ''}"
                  onclick="window._calInstance._legendToggle('${key}')">
            <span class="legend-acc-title">${title}</span>
            <svg class="legend-acc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" width="14" height="14">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div class="legend-acc-body ${open ? 'open' : ''}">
            ${items.map(i => `
              <div class="legend-item">
                ${isUnit
                  ? `<div class="legend-swatch-circle" style="background:${i.color}"></div><span style="color:${i.color};font-weight:700">${i.label}</span>`
                  : i.border
                    ? `<div class="legend-swatch" style="background:${i.color};border:1px solid ${i.border}"></div><span>${i.label}</span>`
                    : `<div class="legend-swatch" style="background:${i.color}"></div><span>${i.label}</span>`
                }
              </div>`).join('')}
          </div>
        </div>`;
    };

    container.innerHTML = `
      <div class="legend-accordion-wrapper">
        ${section('status',   '📊 Estado',        STATUS_ITEMS)}
        ${section('channels', '🔗 Canales',        CHANNEL_ITEMS)}
        ${section('units',    '🛏️ Departamentos', UNIT_ITEMS, true)}
        ${section('calendar', '📅 Calendario',     CAL_ITEMS)}
      </div>`;

    window._calInstance._legendToggle = this._legendToggle.bind(this);
  }

  _legendToggle(key) {
    const saved = JSON.parse(localStorage.getItem('mila_legend_state') ?? 'null') ?? {
      status: true, channels: false, units: false, calendar: false
    };
    saved[key] = !saved[key];
    localStorage.setItem('mila_legend_state', JSON.stringify(saved));
    this._renderAccordionLegend();
  }

  // ── Drag selection (crear reserva o bloqueo) ────────
  _setupDragSelection(grid) {
    let startUnit = null, startDate = null, endDate = null;
    let isBlocking = false;

    const onMouseDown = (e) => {
      if (e.target.closest('.bar')) return;
      const cell = e.target.closest('.cal-cell');
      if (!cell) return;
      isBlocking = e.shiftKey;
      startUnit  = cell.dataset.unitId;
      startDate  = cell.dataset.date;
      this._drag = { active: true, unitId: startUnit, startDay: parseInt(cell.dataset.day), moved: false, blocking: isBlocking };
      cell.classList.add(isBlocking ? 'blocking' : 'selecting');
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!this._drag.active) return;
      const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.cal-cell');
      if (!cell || cell.dataset.unitId !== startUnit) return;
      this._drag.moved = true;
      endDate = cell.dataset.date;

      if (startDate && endDate) {
        const d1 = new Date(Math.min(new Date(startDate), new Date(endDate)));
        const d2 = new Date(Math.max(new Date(startDate), new Date(endDate)));
        const nights = Math.round((d2-d1)/86400000)+1;
        const modeLabel = isBlocking ? '🔒 Bloquear:' : '';
        this._ghost.textContent = `${modeLabel} ${d1.toLocaleDateString('es-AR',{day:'2-digit',month:'short'})} → ${d2.toLocaleDateString('es-AR',{day:'2-digit',month:'short'})} · ${nights} día${nights!==1?'s':''}`;
        this._ghost.style.left  = `${e.clientX}px`;
        this._ghost.style.top   = `${e.clientY}px`;
        this._ghost.style.borderLeft = isBlocking ? '3px solid #ef4444' : '3px solid var(--color-primary)';
        this._ghost.classList.remove('hidden');
      }

      grid.querySelectorAll('.cal-cell.selecting, .cal-cell.blocking').forEach(c => c.classList.remove('selecting','blocking'));
      const sd = this._drag.startDay, ed = parseInt(cell.dataset.day);
      const [mn, mx] = [Math.min(sd,ed), Math.max(sd,ed)];
      grid.querySelectorAll(`.cal-cell[data-unit-id="${startUnit}"]`).forEach(c => {
        if (parseInt(c.dataset.day) >= mn && parseInt(c.dataset.day) <= mx) c.classList.add(isBlocking ? 'blocking' : 'selecting');
      });
    };

    const onMouseUp = async () => {
      if (!this._drag.active) return;
      const hadDrag  = this._drag.moved;
      const wasBlock = this._drag.blocking;
      grid.querySelectorAll('.cal-cell.selecting, .cal-cell.blocking').forEach(c => c.classList.remove('selecting','blocking'));
      this._drag.active = false;
      this._ghost.classList.add('hidden');
      this._ghost.style.borderLeft = '';

      if (hadDrag && startDate && endDate) {
        const dates = [startDate, endDate].sort();
        const last  = new Date(dates[1]+'T12:00:00');
        last.setDate(last.getDate()+1);

        if (wasBlock) {
          const reason = prompt('Motivo del bloqueo (mantenimiento, uso propio, reparación...):', 'Mantenimiento');
          if (reason !== null) {
            await this._blockRange(startUnit, dates[0], toISODate(last), reason.trim() || 'Bloqueo');
          }
        } else {
          this.bookingForm.open({ unitId: startUnit, checkIn: dates[0], checkOut: toISODate(last) });
        }
      }
      startUnit = null; startDate = null; endDate = null; isBlocking = false;
    };

    if (this._selectionAbort) this._selectionAbort.abort();
    this._selectionAbort = new AbortController();
    const sig = this._selectionAbort.signal;

    grid.addEventListener('mousedown', onMouseDown, { signal: sig });
    document.addEventListener('mousemove', onMouseMove, { signal: sig });
    document.addEventListener('mouseup', onMouseUp, { signal: sig });
  }

  // ── Bloquear rango de fechas ──────────────────────
  async _blockRange(unitId, checkIn, checkOut, reason) {
    const unit     = this.ctx.units.find(u => u.id === unitId);
    const unitName = unit?.name ?? 'unidad';
    try {
      const { data: bk, error } = await this.db.from('bookings').insert({
        hotel_id:        this.ctx.hotelId,
        check_in:        checkIn,
        check_out:       checkOut,
        status:          'blocked',
        is_blocked:      true,
        block_reason:    reason,
        price_per_night: 0,
      }).select('id').single();

      if (error) throw error;
      if (!bk?.id) throw new Error('No se obtuvo ID del bloqueo');

      const { error: buErr } = await this.db
        .from('booking_units')
        .insert({ booking_id: bk.id, unit_id: unitId });
      if (buErr) throw buErr;

      showToast(`🔒 ${unitName} bloqueado — ${checkIn} → ${checkOut}`, 'success');
      cache.invalidate('bookings');
      await this.load();
    } catch (err) {
      console.error('[Calendar] blockRange error:', err);
      showToast('Error al crear el bloqueo: ' + (err?.message ?? String(err)), 'error');
    }
  }

  // ── Controles de navegación ───────────────────────
  _setupControls() {
    document.getElementById('cal-prev')?.addEventListener('click', () => {
      if (this._view === 'week') {
        this._weekStart.setDate(this._weekStart.getDate() - 7);
      } else {
        this.month--; if (this.month<0) { this.month=11; this.year--; }
      }
      this.load();
    });
    document.getElementById('cal-next')?.addEventListener('click', () => {
      if (this._view === 'week') {
        this._weekStart.setDate(this._weekStart.getDate() + 7);
      } else {
        this.month++; if (this.month>11) { this.month=0; this.year++; }
      }
      this.load();
    });
    document.getElementById('cal-today')?.addEventListener('click', () => {
      const n = new Date();
      this.month = n.getMonth(); this.year = n.getFullYear();
      this._weekStart = this._getWeekStart(n);
      this.load();
    });

    this.setupViewToggle();
  }

  // ── Context Menu ──────────────────────────────────
  _ctxTarget = {};

  _setupContextMenu() {
    document.getElementById('ctx-new-booking')?.addEventListener('click', () => {
      this.bookingForm.open({ unitId: this._ctxTarget.unitId, checkIn: this._ctxTarget.dateISO });
      this._hideContextMenu();
    });
    document.getElementById('ctx-block')?.addEventListener('click', async () => {
      await this._blockDay(this._ctxTarget.unitId, this._ctxTarget.dateISO);
      this._hideContextMenu();
    });
  }

  _showContextMenu(x, y) {
    const m = document.getElementById('ctx-menu');
    if (!m) return;
    m.classList.remove('hidden');
    m.style.left = `${x}px`; m.style.top = `${y}px`;
  }
  _hideContextMenu() { document.getElementById('ctx-menu')?.classList.add('hidden'); }

  _setupDocumentEvents() {
    document.addEventListener('click', () => this._hideContextMenu());
    document.addEventListener('booking:changed', () => {
      if (document.getElementById('section-calendar').classList.contains('active')) this.load();
    });
  }

  // ── Abrir detalle ─────────────────────────────────
  async _openDetailById(bookingId) {
    if (!bookingId) return;
    try {
      // Abrir directamente el formulario de edición (no el panel de solo lectura)
      await this.bookingForm.openEdit(bookingId);
    } catch (err) {
      console.error('[Calendar] Error al abrir reserva:', err);
      showToast('Error al cargar la reserva', 'error');
    }
  }

  // ── Bloquear día ──────────────────────────────────
  async _blockDay(unitId, dateISO) {
    const reason = prompt('Motivo del bloqueo (mantenimiento, reparación, uso propio, etc.):');
    if (!reason) return;
    const next = new Date(dateISO+'T12:00:00'); next.setDate(next.getDate()+1);
    const { data: bk, error } = await this.db.from('bookings').insert({
      hotel_id: this.ctx.hotelId, check_in: dateISO, check_out: toISODate(next),
      status: 'blocked', is_blocked: true, block_reason: reason, price_per_night: 0,
    }).select('id').single();
    if (error) { showToast('Error al bloquear', 'error'); return; }
    if (bk) await this.db.from('booking_units').insert({ booking_id: bk.id, unit_id: unitId });
    showToast('Día bloqueado ✓', 'success');
    this.load();
  }

  // ── Ghost ─────────────────────────────────────────
  _createGhost() {
    let g = document.getElementById('cal-drag-ghost');
    if (!g) {
      g = document.createElement('div');
      g.className = 'drag-ghost hidden';
      g.id = 'cal-drag-ghost';
      document.body.appendChild(g);
    }
    return g;
  }

  // ── Tooltip enriquecido ───────────────────────────
  _showTooltip(booking, e) {
    this._hideTooltip();
    const guest     = booking.guests ? `${booking.guests.first_name} ${booking.guests.last_name}` : (booking.block_reason ?? 'Bloqueo');
    const { label } = getBookingBarColor(booking);
    const source    = booking.source ?? 'direct';
    const srcCfg    = SOURCE_CONFIG[source] ?? {};
    const units     = (booking.booking_units ?? []).map(bu => {
      const u = bu.units ?? {};
      return `#${u.sort_order ?? '?'} · ${u.name ?? '?'}`;
    }).join(', ');
    const balance   = (booking.balance ?? 0);
    const hasBadExp = booking.guests?.bad_experience;

    const tip = document.createElement('div');
    tip.className = 'cal-tooltip';
    tip.innerHTML = `
      <div class="ct-guest">${guest}${hasBadExp ? ' <span style="color:#EF4444">⚠️</span>' : ''}</div>
      <div class="ct-unit">🛏️ ${units || '—'}</div>
      <div class="ct-dates" style="margin-top:6px">📅 ${booking.check_in} → ${booking.check_out}</div>
      <div class="ct-nights">🌙 ${booking.nights ?? '?'} noches${booking.pax ? ` · 👥 ${booking.adults ?? booking.pax} adultos${booking.children ? ` + ${booking.children} menores` : ''}` : ''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <span style="padding:2px 8px;border-radius:99px;font-size:.7rem;font-weight:700;
          background:${getBookingBarColor(booking).color}22;color:${getBookingBarColor(booking).color};
          border:1px solid ${getBookingBarColor(booking).color}40">${label}</span>
        ${source !== 'direct' && source !== 'blocked' ? `<span style="padding:2px 8px;border-radius:99px;font-size:.7rem;font-weight:700;
          background:${srcCfg.color??''}22;color:${srcCfg.color??'#64748B'};border:1px solid ${srcCfg.color??''}40">
          ${srcCfg.emoji??''} ${srcCfg.label??''}</span>` : ''}
      </div>
      ${booking.total_amount ? `
        <div style="border-top:1px solid rgba(255,255,255,.08);padding-top:8px;margin-top:8px;display:flex;justify-content:space-between;gap:12px">
          <div><div style="font-size:.7rem;color:#64748B">Total</div><div style="font-weight:700;color:#F8FAFC">${formatARS(booking.total_amount)}</div></div>
          <div style="text-align:right">
            <div style="font-size:.7rem;color:#64748B">Saldo</div>
            <div style="font-weight:700;color:${balance>0?'#EAB308':'#34D399'}">${balance>0?formatARS(balance):'✓ Saldado'}</div>
          </div>
        </div>` : ''}
    `;
    document.body.appendChild(tip);
    this._tooltip = tip;
    this._moveTooltip(e);
  }

  _moveTooltip(e) {
    if (!this._tooltip) return;
    const tw = this._tooltip.offsetWidth  || 220;
    const th = this._tooltip.offsetHeight || 140;
    const x  = e.clientX + 18;
    const y  = e.clientY - 10;
    this._tooltip.style.left = `${x+tw>window.innerWidth ? x-tw-36 : x}px`;
    this._tooltip.style.top  = `${y+th>window.innerHeight ? y-th : y}px`;
  }

  _hideTooltip() { this._tooltip?.remove(); this._tooltip = null; }

  // ── Vista Lista ───────────────────────────────────
  _renderListView(bookings) {
    const grid      = document.getElementById('calendar-grid');
    const today     = new Date().toISOString().split('T')[0];
    const container = document.getElementById('cal-legend-container');
    if (container) container.innerHTML = '';

    grid.style.gridTemplateColumns = '1fr';
    grid.style.minWidth = 'auto';
    grid.style.width    = 'auto';

    const seen = new Set();
    const unique = bookings.filter(b => {
      if (seen.has(b.id)) return false;
      seen.add(b.id); return true;
    }).sort((a, b) => a.check_in.localeCompare(b.check_in));

    if (!unique.length) {
      grid.innerHTML = `<div class="empty-state" style="padding:40px">
        <span class="empty-state-icon">📅</span>
        <p>Sin reservas en ${MONTH_NAMES[this.month]} ${this.year}.</p>
      </div>`;
      return;
    }

    grid.innerHTML = unique.map(b => {
      const { color, label } = getBookingBarColor(b);
      const guest   = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : (b.block_reason ?? 'Bloqueo');
      const units   = (b.booking_units ?? []).map(bu => getUnitLabel(bu.units ?? {})).join(', ');
      const isToday = b.check_in === today || (b.check_in < today && b.check_out > today);
      const balance = b.balance ?? 0;

      return `
        <div class="list-booking-row" data-id="${b.id}" style="display:flex;align-items:stretch;border:1px solid var(--color-border);
          border-radius:var(--r-lg);background:var(--color-surface);
          box-shadow:var(--sh-xs);margin-bottom:8px;overflow:hidden;cursor:pointer;
          ${isToday ? 'border-color:var(--color-primary);box-shadow:0 0 0 2px var(--color-primary-t)' : ''}">
          <div style="width:5px;background:${color};flex-shrink:0"></div>
          <div style="flex:1;padding:12px 14px;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
              <span style="font-weight:700;font-size:.92rem;color:var(--color-text)">${guest}</span>
              <span style="padding:2px 8px;border-radius:99px;font-size:.68rem;font-weight:700;
                background:${color}18;color:${color};border:1px solid ${color}35">${label}</span>
              ${isToday ? `<span style="padding:2px 8px;border-radius:99px;font-size:.68rem;font-weight:700;background:var(--color-primary-l);color:var(--color-primary)">HOY</span>` : ''}
            </div>
            <div style="font-size:.78rem;color:var(--color-text-2)">
              📅 ${formatDate(b.check_in)} → ${formatDate(b.check_out)} · 🌙 ${b.nights ?? '?'} noches
            </div>
            <div style="margin-top:5px;font-size:.75rem;color:var(--color-text-3)">${units}</div>
          </div>
          <div style="padding:12px 14px;text-align:right;flex-shrink:0;display:flex;flex-direction:column;justify-content:center">
            <div style="font-weight:700;font-size:.9rem">${formatARS(b.total_amount)}</div>
            <div style="font-size:.72rem;margin-top:3px;color:${balance > 0 ? 'var(--color-warning)' : 'var(--color-success)'};font-weight:600">
              ${balance > 0 ? `Saldo: ${formatARS(balance)}` : '✓ Saldado'}
            </div>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.list-booking-row[data-id]').forEach(row => {
      row.addEventListener('click', () => this._openDetailById(row.dataset.id));
    });
  }

  // ── Notas de unidad ───────────────────────────────
  _showUnitNote(e, note) {
    e.stopPropagation();
    const tip = document.createElement('div');
    tip.style.cssText = `position:fixed;z-index:999;background:var(--color-text);color:white;
      padding:8px 14px;border-radius:var(--r-md);font-size:.78rem;max-width:280px;
      box-shadow:var(--sh-lg);top:${e.clientY+10}px;left:${e.clientX}px`;
    tip.textContent = `📝 ${note}`;
    document.body.appendChild(tip);
    setTimeout(() => tip.remove(), 3000);
    document.addEventListener('click', () => tip.remove(), { once: true });
  }

  editUnitNotes(unitId, currentNotes) {
    const newNote = prompt('Notas internas de la unidad (solo visible para el equipo):', currentNotes);
    if (newNote === null) return;
    this.db.from('units').update({ internal_notes: newNote.trim() || null }).eq('id', unitId)
      .then(async ({ error }) => {
        if (error) { showToast('Error al guardar nota', 'error'); return; }
        showToast('Nota guardada ✓', 'success');
        const unit = AppContext.units.find(u => u.id === unitId);
        if (unit) unit.internal_notes = newNote.trim() || null;
        this.load();
      });
  }

  // ── Setup toggle Disponibilidad ─────────────────
  setupViewToggle() {
    let _availMode = false;
    const availBtn = document.getElementById('cal-avail-toggle');
    if (!availBtn) return;

    // ── Crear panel de filtro de disponibilidad ──
    const filterPanel = document.createElement('div');
    filterPanel.id = 'avail-filter-panel';
    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrowStr = (() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toISOString().split('T')[0]; })();
    filterPanel.style.cssText = `
      display:none;flex-direction:column;
      background:var(--color-surface-2,#f8f9fa);border:1px solid var(--color-border,#e5e7eb);
      border-radius:10px;overflow:hidden;margin-top:8px;
      font-size:.78rem;color:var(--color-text);
    `;
    filterPanel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:nowrap;overflow-x:auto;padding:8px 14px">
        <span style="font-weight:600;font-size:.72rem;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.05em;white-space:nowrap">🔍 Disponibilidad</span>
        <span style="font-size:.72rem;color:var(--color-text-3);white-space:nowrap">Check-in</span>
        <input type="date" id="avail-checkin" value="${todayStr}"
          style="border:1px solid var(--color-border,#e5e7eb);border-radius:6px;padding:3px 6px;font-size:.75rem;background:var(--color-surface);color:var(--color-text);min-width:0">
        <span style="font-size:.72rem;color:var(--color-text-3);white-space:nowrap">Check-out</span>
        <input type="date" id="avail-checkout" value="${tomorrowStr}"
          style="border:1px solid var(--color-border,#e5e7eb);border-radius:6px;padding:3px 6px;font-size:.75rem;background:var(--color-surface);color:var(--color-text);min-width:0">
        <span style="font-size:.72rem;color:var(--color-text-3);white-space:nowrap">Pers.</span>
        <input type="number" id="avail-guests" min="1" max="20" value="2"
          style="width:48px;border:1px solid var(--color-border,#e5e7eb);border-radius:6px;padding:3px 6px;font-size:.75rem;background:var(--color-surface);color:var(--color-text)">
        <button id="avail-search-btn"
          style="padding:4px 11px;border-radius:6px;border:none;background:var(--color-primary,#6366f1);color:#fff;font-size:.75rem;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0">
          Ver disponibles
        </button>
      </div>
      <div id="avail-results" style="display:none;width:100%;padding:6px 14px 8px;border-top:1px solid var(--color-border,#e5e7eb);margin-top:0"></div>
    `;

    // Insertar panel entre toolbar y cal-wrapper
    const calWrapper = document.querySelector('.cal-wrapper') ?? availBtn.closest('.cal-toolbar')?.nextElementSibling;
    if (calWrapper) calWrapper.insertAdjacentElement('beforebegin', filterPanel);
    else availBtn.parentNode.appendChild(filterPanel);

    // ── Aplicar marcas de % al calendario ──
    const _applyPercentBadges = () => {
      const grid = document.getElementById('calendar-grid');
      if (!grid) return;
      const daysInMonth = new Date(this.year, this.month+1, 0).getDate();
      const totalUnits  = this.ctx.units.length || 1;
      const bookings    = this._lastRenderedBookings ?? [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${this.year}-${String(this.month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const occupiedUnits = new Set();
        bookings.forEach(b => {
          if (b.status === 'cancelled') return;
          if (b.check_in <= dateStr && b.check_out > dateStr) {
            (b.booking_units ?? []).forEach(bu => occupiedUnits.add(bu.unit_id));
          }
        });
        const cells = grid.querySelectorAll(`.cal-cell[data-date="${dateStr}"]`);
        cells.forEach(c => {
          const uid = c.dataset.unitId;
          if (!occupiedUnits.has(uid)) c.classList.add('avail-free');
        });
        const free = totalUnits - occupiedUnits.size;
        const pct  = Math.round((free / totalUnits) * 100);
        const hdrs = grid.querySelectorAll('.cal-day-header');
        const hdr  = hdrs[d - 1];
        if (hdr && !hdr.querySelector('.avail-pct')) {
          const badge = document.createElement('div');
          badge.className = 'avail-pct';
          badge.textContent = `${pct}%`;
          badge.style.cssText = `font-size:.55rem;font-weight:700;color:${pct > 60 ? '#16a34a' : pct > 30 ? '#f59e0b' : '#ef4444'};line-height:1`;
          hdr.appendChild(badge);
        }
      }
    };

    const _clearPercentBadges = () => {
      const grid = document.getElementById('calendar-grid');
      if (!grid) return;
      grid.querySelectorAll('.avail-free').forEach(c => c.classList.remove('avail-free'));
      grid.querySelectorAll('.avail-pct').forEach(el => el.remove());
    };

    // ── Buscar unidades disponibles para rango + personas ──
    // ── Resaltar rango en el calendario ──
    const _highlightRange = (ci, co) => {
      const grid = document.getElementById('calendar-grid');
      if (!grid) return;
      grid.querySelectorAll('.cal-cell.avail-range').forEach(c => c.classList.remove('avail-range','avail-range-start','avail-range-end'));
      if (!ci || !co) return;
      grid.querySelectorAll('.cal-cell[data-date]').forEach(c => {
        const d = c.dataset.date;
        if (d >= ci && d < co) {
          c.classList.add('avail-range');
          if (d === ci)  c.classList.add('avail-range-start');
          // last day before co
          const next = new Date(d); next.setDate(next.getDate()+1);
          const nextStr = next.toISOString().split('T')[0];
          if (nextStr === co) c.classList.add('avail-range-end');
        }
      });
    };

    const _clearRangeHighlight = () => {
      const grid = document.getElementById('calendar-grid');
      if (!grid) return;
      grid.querySelectorAll('.cal-cell.avail-range').forEach(c => c.classList.remove('avail-range','avail-range-start','avail-range-end'));
    };

    const _searchAvailability = () => {
      const ci      = document.getElementById('avail-checkin')?.value;
      const co      = document.getElementById('avail-checkout')?.value;
      const guests  = parseInt(document.getElementById('avail-guests')?.value ?? '2', 10);
      const results = document.getElementById('avail-results');
      if (!ci || !co || !results) return;
      if (ci >= co) {
        results.innerHTML = `<span style="color:#ef4444;font-size:.76rem">⚠️ El check-out debe ser posterior al check-in.</span>`;
        _clearRangeHighlight();
        return;
      }
      _highlightRange(ci, co);
      const bookings = this._lastRenderedBookings ?? [];
      // Unidades ocupadas en CUALQUIER día del rango ci..co (excluyendo co, ya que ese día es salida)
      const occupiedIds = new Set();
      bookings.forEach(b => {
        if (b.status === 'cancelled') return;
        // Solapa si check_in < co y check_out > ci
        if (b.check_in < co && b.check_out > ci) {
          (b.booking_units ?? []).forEach(bu => occupiedIds.add(bu.unit_id));
        }
      });
      const available = this.ctx.units.filter(u => !occupiedIds.has(u.id) && (u.max_guests ?? 0) >= guests);
      const occupied  = this.ctx.units.filter(u => occupiedIds.has(u.id));
      const tooSmall  = this.ctx.units.filter(u => !occupiedIds.has(u.id) && (u.max_guests ?? 0) < guests);

      if (!available.length) {
        results.style.display = 'block';
        results.innerHTML = `<span style="color:#ef4444;font-size:.76rem">😔 Sin unidades disponibles para ${guests} personas en esas fechas.</span>`;
        return;
      }
      const chip = u => {
        const color = u.color ?? 'var(--color-primary)';
        return `<span title="#${u.sort_order} · ${u.name} (hasta ${u.max_guests} pers.)"
          style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:4px;
          background:${color}20;border:1px solid ${color}55;font-size:.74rem;font-weight:700;color:var(--color-text);cursor:default">
          <span style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0"></span>#${u.sort_order}
        </span>`;
      };
      const fmt = s => s.split('-').reverse().join('/');
      results.style.display = 'block';
      results.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:.72rem;font-weight:600;color:#16a34a;white-space:nowrap">
            ✅ ${available.length} disponible${available.length > 1 ? 's' : ''} · ${fmt(ci)} → ${fmt(co)} · ${guests} pers.
          </span>
          ${available.map(chip).join('')}
          ${tooSmall.length ? tooSmall.map(u => `<span title="#${u.sort_order} · ${u.name} — capacidad insuficiente (max. ${u.max_guests})"
            style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:4px;
            background:#f3f4f6;border:1px solid #d1d5db;font-size:.74rem;font-weight:700;color:#9ca3af;cursor:default;text-decoration:line-through">
            <span style="width:7px;height:7px;border-radius:50%;background:#d1d5db;flex-shrink:0"></span>#${u.sort_order}
          </span>`).join('') : ''}
          ${occupied.length ? occupied.map(u => `<span title="#${u.sort_order} · ${u.name} — ocupada"
            style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:4px;
            background:#fee2e255;border:1px solid #fca5a5;font-size:.74rem;font-weight:700;color:#ef4444;cursor:default">
            <span style="width:7px;height:7px;border-radius:50%;background:#ef4444;flex-shrink:0"></span>#${u.sort_order}
          </span>`).join('') : ''}
        </div>`;
    };

    // ── Toggle principal ──
    availBtn.addEventListener('click', () => {
      _availMode = !_availMode;
      availBtn.textContent = _availMode ? '✕ Ocultar disponibilidad' : '👁 Disponibilidad';
      availBtn.classList.toggle('active', _availMode);
      filterPanel.style.display = _availMode ? 'flex' : 'none';
      if (_availMode) {
        _applyPercentBadges();
      } else {
        _clearPercentBadges();
        _clearRangeHighlight();
        const results = document.getElementById('avail-results');
        if (results) { results.innerHTML = ''; results.style.display = 'none'; }
      }
    });

    // ── Botón buscar ──
    filterPanel.querySelector('#avail-search-btn')?.addEventListener('click', _searchAvailability);

    // Buscar también al pulsar Enter en los inputs de fecha/personas
    filterPanel.querySelectorAll('input').forEach(inp =>
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') _searchAvailability(); })
    );
  }

  // ── Vista Semanal ─────────────────────────────────
  _getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = (day === 0) ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0,0,0,0);
    return d;
  }

  _renderWeekView(bookings) {
    const grid = document.getElementById('calendar-grid');
    if (!this._weekStart) this._weekStart = this._getWeekStart(new Date());

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(this._weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });

    const today = new Date().toISOString().split('T')[0];
    grid.style.gridTemplateColumns = `160px repeat(7, 1fr)`;
    grid.style.minWidth = '600px';
    grid.style.width    = 'max-content';
    grid.classList.add('week-grid');
    grid.classList.remove('month-grid');
    grid.innerHTML = '';

    const corner = document.createElement('div');
    corner.className = 'cal-unit-label-header';
    const weekStr = `${days[0].toLocaleDateString('es-AR',{day:'2-digit',month:'short'})} — ${days[6].toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'})}`;
    corner.innerHTML = `<span style="font-size:.72rem;color:var(--color-text-3)">${weekStr}</span>`;
    grid.appendChild(corner);

    const weekHolidays = getHolidaysForYear(days[0].getFullYear());

    days.forEach(d => {
      const iso      = d.toISOString().split('T')[0];
      const isToday  = iso === today;
      const dow      = d.getDay();
      const isWknd   = dow === 0 || dow === 6;
      const isPast   = iso < today && !isToday;
      const holiday  = weekHolidays.get(iso);
      const isHoliday = !!holiday && holiday.type !== 'vacation';

      const dh = document.createElement('div');
      let dhCls = 'cal-day-header';
      if (isToday)   dhCls += ' today';
      if (isWknd)    dhCls += ' weekend';
      if (isPast)    dhCls += ' past-header';
      if (isHoliday) dhCls += ` holiday holiday-${holiday.type}`;
      dh.className = dhCls;
      dh.title = holiday?.label ?? '';
      dh.innerHTML = `
        <span class="dh-num ${isToday ? 'today-num' : ''}">${d.getDate()}</span>
        <span class="day-name">${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getDay()]}</span>
        ${holiday ? '<span class="dh-dot"></span>' : ''}`;
      grid.appendChild(dh);
    });

    this.ctx.units.forEach(unit => {
      const unitColor = getUnitColor(unit);
      const unitLabel = getUnitLabel(unit);
      const label = document.createElement('div');
      label.className = 'cal-unit-label';
      label.style.setProperty('--unit-color', unitColor);
      label.style.borderLeftColor = unitColor;
      label.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px">
          <span class="cal-unit-dot" style="background-color:${unitColor}"></span>
          <span style="font-size:.82rem;font-weight:700">${unitLabel}</span>
        </div>`;
      grid.appendChild(label);

      days.forEach(d => {
        const iso = d.toISOString().split('T')[0];
        const isToday = iso === today;
        const dayBookings = bookings.filter(b =>
          b.check_in <= iso && b.check_out > iso &&
          (b.booking_units ?? []).some(bu => bu.unit_id === unit.id)
        );
        const cell = document.createElement('div');
        const wcDow    = d.getDay();
        const wcIsWknd = wcDow === 0 || wcDow === 6;
        const wcIsPast = iso < today && !isToday;
        let wcCls = 'cal-cell week-cell';
        if (isToday)   wcCls += ' today-col week-today';
        if (wcIsWknd)  wcCls += ' weekend-col';
        if (wcIsPast)  wcCls += ' past-col';
        cell.className = wcCls;
        cell.dataset.date   = iso;
        cell.dataset.unitId = unit.id;

        if (dayBookings.length === 0) {
          this._bindEmptyCell(cell, unit.id, d.getDate(), iso);
        } else {
          const b = dayBookings[0];
          const { color, textColor } = getBookingBarColor(b);
          const guest   = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : (b.block_reason ?? 'Bloqueo');
          const isStart = b.check_in === iso;
          const barStyle = wcIsPast
            ? `background:${color};filter:grayscale(52%) opacity(.62);`
            : `background:${color};`;
          cell.innerHTML = `
            <div class="week-bar" style="${barStyle}border-radius:${isStart?'6px 0 0 6px':'0'}" data-id="${b.id}">
              ${isStart ? `<span style="color:${textColor};font-size:.68rem;font-weight:700;
                overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:${wcIsPast?'.75':'1'}">${guest}</span>` : ''}
            </div>`;
          cell.addEventListener('mouseenter', (e) => this._showTooltip(b, e));
          cell.addEventListener('mousemove',  (e) => this._moveTooltip(e));
          cell.addEventListener('mouseleave', ()  => this._hideTooltip());
          cell.addEventListener('click', (e) => {
            e.stopPropagation();
            this._openDetailById(b.id);
          });
        }
        grid.appendChild(cell);
      });
    });

    this._renderAccordionLegend();
    document.getElementById('cal-month-title').textContent = weekStr;
  }

  // ══════════════════════════════════════════════════
  // DRAG & DROP DE RESERVAS
  // ══════════════════════════════════════════════════
  _setupBarDrag(grid) {
    if (this._barDragAbort) this._barDragAbort.abort();
    this._barDragAbort = new AbortController();
    const sig = this._barDragAbort.signal;

    let _ghost     = this._ghost;
    let _dragState = null;

    const resetDrag = () => {
      _ghost.classList.add('hidden');
      _dragState = null;
      document.querySelectorAll('.cal-cell.drop-target, .cal-cell.drop-conflict').forEach(c => {
        c.classList.remove('drop-target', 'drop-conflict');
      });
      this._barDrag = { active: false, booking: null, unitId: null, startX: 0, moved: false };
    };

    const onMouseMove = (e) => {
      if (!_dragState || !this._barDrag.active) return;
      const dx = Math.abs(e.clientX - _dragState.startX);
      const dy = Math.abs(e.clientY - _dragState.startY);
      if (dx > 8 || dy > 8) _dragState.moved = true;
      if (!_dragState.moved) return;

      const daysInMonth  = new Date(this.year, this.month+1, 0).getDate();
      const gridContent  = grid.getBoundingClientRect();
      const labelWidth   = 160;
      const cellWidth    = (gridContent.width - labelWidth) / daysInMonth;
      const daysDiff     = Math.round((e.clientX - _dragState.startX) / cellWidth);

      const b     = _dragState.booking;
      const newCI = this._addDays(b.check_in,  daysDiff);
      const newCO = this._addDays(b.check_out, daysDiff);

      const underCell    = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.cal-cell');
      const targetUnitId = underCell?.dataset.unitId ?? _dragState.sourceUnitId;
      _dragState.targetUnitId = targetUnitId;
      _dragState.daysDiff     = daysDiff;

      _ghost.textContent = `${newCI} → ${newCO}${targetUnitId !== _dragState.sourceUnitId ? ' · cambio de depto.' : ''}`;
      _ghost.style.left  = `${e.clientX + 16}px`;
      _ghost.style.top   = `${e.clientY - 24}px`;
      _ghost.classList.remove('hidden');

      document.querySelectorAll('.cal-cell.drop-target,.cal-cell.drop-conflict').forEach(c => {
        c.classList.remove('drop-target','drop-conflict');
      });
      if (underCell && daysDiff !== 0) underCell.classList.add('drop-target');
    };

    const onMouseUp = async (e) => {
      if (!this._barDrag.active) return;
      const state = { ..._dragState };
      resetDrag();
      this._barDrag.active = false;

      if (!state) return;

      if (!state.moved) {
        if (state.booking) await this._openDetailById(state.booking.id);
        return;
      }

      const { booking, sourceUnitId, daysDiff } = state;
      if (!booking || daysDiff === 0) return;

      const newCI        = this._addDays(booking.check_in,  daysDiff);
      const newCO        = this._addDays(booking.check_out, daysDiff);
      const targetUnitId = state.targetUnitId ?? sourceUnitId;
      const today        = new Date().toISOString().split('T')[0];
      const unitChanged  = targetUnitId !== sourceUnitId;

      // Modal de confirmación personalizado (evita cambios accidentales por drag)
      const confirmed = await this._confirmDragChange({
        guestName:  booking.guest_name ?? (booking.guests ? `${booking.guests.first_name ?? ''} ${booking.guests.last_name ?? ''}`.trim() : 'Reserva'),
        oldCI:      booking.check_in,
        oldCO:      booking.check_out,
        newCI,
        newCO,
        unitChanged,
        isPast:     newCI < today,
      });
      if (!confirmed) { this.load(); return; }

      const { data: conflicts } = await this.db
        .from('booking_units')
        .select('unit_id, bookings!inner(id, check_in, check_out, status)')
        .eq('unit_id', targetUnitId)
        .neq('bookings.status', 'cancelled')
        .neq('bookings.id', booking.id)
        .lt('bookings.check_in', newCO)
        .gt('bookings.check_out', newCI);

      if (conflicts?.length) {
        showToast('⚠️ Conflicto: hay otra reserva en esas fechas', 'error');
        this.load();
        return;
      }

      const { error } = await this.db.from('bookings')
        .update({ check_in: newCI, check_out: newCO }).eq('id', booking.id);
      if (error) { showToast('Error al mover la reserva', 'error'); return; }

      if (targetUnitId !== sourceUnitId) {
        await this.db.from('booking_units')
          .update({ unit_id: targetUnitId })
          .eq('booking_id', booking.id)
          .eq('unit_id', sourceUnitId);
      }

      await logAction('UPDATE', 'booking', booking.id,
        `Drag: ${booking.check_in}→${newCI}, unidad: ${sourceUnitId}→${targetUnitId}`);

      this._animateDragBar(booking.id, newCI);
      cache.invalidate('bookings');
      Bus.emit(EVENTS.BOOKING_DRAG_DONE, { bookingId: booking.id, oldCI: booking.check_in, newCI });
      showToast(`✓ Reserva movida a ${newCI} → ${newCO}`, 'success');
      // NO dispatch booking:changed aquí — evita el loop Bus↔DOM del bridge bidireccional.
      // this.load() recarga el calendario directamente.
      this.load();
    };

    grid.addEventListener('mousedown', (e) => {
      const bar = e.target.closest('.bar[data-booking-id]');
      if (!bar) return;
      e.preventDefault();
      e.stopPropagation();

      const bookingId = bar.dataset.bookingId;
      const cell      = bar.closest('.cal-cell');
      const unitId    = cell?.dataset.unitId ?? null;

      _dragState = {
        booking:      null,
        sourceUnitId: unitId,
        targetUnitId: unitId,
        startX:       e.clientX,
        startY:       e.clientY,
        daysDiff:     0,
        moved:        false,
      };
      this._barDrag = { active: true, booking: null, unitId, startX: e.clientX, moved: false };

      const found = (this._lastRenderedBookings ?? []).find(b => b.id === bookingId);
      if (found) {
        _dragState.booking    = found;
        this._barDrag.booking = found;
      } else {
        this.db.from('bookings')
          .select('id,check_in,check_out,nights,guests(first_name,last_name),booking_units(unit_id)')
          .eq('id', bookingId).single()
          .then(({ data }) => {
            if (data && _dragState) {
              _dragState.booking    = data;
              this._barDrag.booking = data;
            }
          });
      }

      document.addEventListener('mousemove', onMouseMove, { signal: sig });
      document.addEventListener('mouseup', onMouseUp, { once: true });
    }, { signal: sig });

    // Touch support
    grid.addEventListener('touchstart', (e) => {
      const bar = e.target.closest('.bar[data-booking-id]');
      if (!bar) return;
      const t         = e.touches[0];
      const bookingId = bar.dataset.bookingId;
      const cell      = bar.closest('.cal-cell');

      _dragState = {
        booking: (this._lastRenderedBookings ?? []).find(b => b.id === bookingId) ?? null,
        sourceUnitId: cell?.dataset.unitId ?? null,
        startX: t.clientX, startY: t.clientY, daysDiff: 0, moved: false,
      };
      this._barDrag = { active: true, booking: _dragState.booking, unitId: cell?.dataset.unitId, startX: t.clientX, moved: false };

      const onTouchMove = (te) => {
        const touch = te.touches[0];
        onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
      };
      const onTouchEnd = (te) => {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        onMouseUp({ clientX: te.changedTouches[0].clientX });
      };
      document.addEventListener('touchmove', onTouchMove, { passive: false, signal: sig });
      document.addEventListener('touchend', onTouchEnd, { signal: sig });
    }, { passive: false, signal: sig });
  }

  _animateDragBar(bookingId, newCI) {
    const bar = document.querySelector(`.bar[data-booking-id="${bookingId}"]`);
    if (!bar) return;
    bar.style.transition = 'opacity .25s, transform .25s';
    bar.style.opacity    = '0';
    bar.style.transform  = 'scaleX(0.8)';
    this._pendingPulse.add(bookingId);
  }

  // ── Modal de confirmación para drag ─────────────────────────────
  _confirmDragChange({ guestName, oldCI, oldCO, newCI, newCO, unitChanged, isPast }) {
    return new Promise(resolve => {
      // Eliminar cualquier modal previo
      document.getElementById('drag-confirm-overlay')?.remove();

      const fmt = iso => {
        const [y,m,d] = iso.split('-');
        return `${d}/${m}/${y}`;
      };

      const overlay = document.createElement('div');
      overlay.id = 'drag-confirm-overlay';
      overlay.style.cssText = `
        position:fixed;inset:0;z-index:9999;
        background:rgba(0,0,0,.45);
        display:flex;align-items:center;justify-content:center;
        padding:16px;
      `;

      const pastHtml = isPast
        ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:8px 12px;font-size:.8rem;color:#92400e;margin-bottom:12px;">
             ⚠️ La nueva fecha de ingreso es en el pasado.
           </div>`
        : '';

      const unitHtml = unitChanged
        ? `<div style="font-size:.8rem;color:#6366f1;margin-top:6px;font-weight:600;">📦 Cambia de departamento</div>`
        : '';

      overlay.innerHTML = `
        <div style="
          background:var(--color-background-primary,#fff);
          border-radius:16px;
          box-shadow:0 20px 60px rgba(0,0,0,.25);
          padding:24px;
          max-width:380px;
          width:100%;
        ">
          <div style="font-size:1rem;font-weight:700;color:var(--color-text,#111);margin-bottom:4px;">
            ✏️ Confirmar cambio de fechas
          </div>
          <div style="font-size:.8rem;color:var(--color-text-secondary,#666);margin-bottom:16px;">
            ${guestName}
          </div>
          ${pastHtml}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
            <div style="background:var(--color-background-secondary,#f8f9fa);border-radius:10px;padding:10px 12px;">
              <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-tertiary,#999);margin-bottom:4px;">Antes</div>
              <div style="font-size:.82rem;font-weight:600;color:var(--color-text,#111);">📅 ${fmt(oldCI)} → ${fmt(oldCO)}</div>
            </div>
            <div style="background:#ede9fe;border-radius:10px;padding:10px 12px;">
              <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#7c3aed;margin-bottom:4px;">Nuevo</div>
              <div style="font-size:.82rem;font-weight:600;color:#5b21b6;">📅 ${fmt(newCI)} → ${fmt(newCO)}</div>
            </div>
          </div>
          ${unitHtml}
          <div style="display:flex;gap:10px;margin-top:18px;">
            <button id="drag-cancel-btn" style="
              flex:1;padding:10px;border-radius:10px;
              border:1.5px solid var(--color-border-secondary,#e2e8f0);
              background:transparent;cursor:pointer;
              font-size:.85rem;font-weight:600;color:var(--color-text,#111);
            ">Cancelar</button>
            <button id="drag-confirm-btn" style="
              flex:1;padding:10px;border-radius:10px;
              border:none;background:#6366f1;color:#fff;cursor:pointer;
              font-size:.85rem;font-weight:700;
            ">Confirmar cambio</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const cleanup = (result) => {
        overlay.remove();
        resolve(result);
      };

      document.getElementById('drag-confirm-btn').addEventListener('click', () => cleanup(true));
      document.getElementById('drag-cancel-btn').addEventListener('click', () => cleanup(false));
      overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });
    });
  }

    _addDays(isoDate, n) {
    const d = new Date(isoDate + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
  }
}
