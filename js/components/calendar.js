// ═══════════════════════════════════════════════════
// calendar.js v5.0 — MILA Sistema Inteligente
// • Vista continua: 6 días anteriores + HOY + futuros
// • Drag & Drop profesional con ghost completo
// • Resize de reservas desde el borde derecho
// • Animaciones fluidas · Auto-scroll · Caché inteligente
// ═══════════════════════════════════════════════════

import {
  toISODate, getBookingBarColor, getUnitLabel, getUnitColor,
  getUnitChipHTML, getSourceBadgeHTML, SOURCE_CONFIG, UNIT_CATALOG,
  showToast, formatARS, formatDate, AppContext, localToday, localDateISO
} from '../supabase-config.js';
import { can } from '../auth/permissions.js';
import { getHolidaysForYear, isWeekend } from '../services/arg-holidays.js';
import { logAction } from '../services/audit-service.js';
import { cachedQuery, cache } from '../services/supabase-cache.js';
import { Bus, EVENTS } from '../services/event-bus.js';

const DAY_NAMES   = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MONTH_SHORT = ['Ene','Feb','Mar','Abr','May','Jun',
                     'Jul','Ago','Sep','Oct','Nov','Dic'];

// ── Días previos a HOY que siempre se muestran ──
const PAST_OFFSET = 6;
// ── Ancho mínimo de columna (px) ──
const CELL_W_DESK = 38;
const CELL_W_MOB  = 32;
// ── Ancho de la columna de etiquetas de unidad ──
const LABEL_W = 160;

export class Calendar {
  constructor(supabase, ctx, bookingForm) {
    this.db          = supabase;
    this.ctx         = ctx;
    this.bookingForm = bookingForm;

    // ── Vista continua ──────────────────────────
    this._windowStart  = this._addDays(localToday(), -PAST_OFFSET);
    this._visibleDays  = 30; // se recalcula en load()
    this._dateRange    = []; // array de ISO strings visibles

    // ── Estado interno ───────────────────────────
    this._drag         = { active: false, moved: false };
    this._barDrag      = { active: false };
    this._resizeActive = false;
    this._tooltip      = null;
    this._textGhost    = this._createTextGhost();
    this._floatInfo    = this._createFloatInfo();
    this._pendingPulse = new Set();
    this._isLoading    = false;

    // ── AbortControllers para event listeners ────
    this._selectionAbort = null;
    this._barDragAbort   = null;

    window._calInstance = this;
    this._setupControls();
    this._setupContextMenu();
    this._setupDocumentEvents();

    Bus.on(EVENTS.CAL_PULSE_BAR, ({ bookingId }) => this._pendingPulse.add(bookingId));
    Bus.on(EVENTS.CAL_RELOAD,    () => this.load());
  }

  // ══════════════════════════════════════════════════
  // CARGA PRINCIPAL
  // ══════════════════════════════════════════════════
  async load() {
    if (this._isLoading) return;
    this._isLoading = true;
    try {
      this._visibleDays = this._computeVisibleDays();
      const lastISO     = this._addDays(this._windowStart, this._visibleDays - 1);
      this._dateRange   = this._buildDateRange(this._windowStart, this._visibleDays);
      this._updateTitle();

      const [bookings, reminders] = await Promise.all([
        this._fetchBookings(this._windowStart, lastISO),
        this._fetchReminders(this._windowStart, lastISO).catch(err => {
          console.warn('[Calendar] reminders fetch failed:', err?.message ?? err);
          return [];
        }),
      ]);

      this._lastRenderedBookings = bookings;
      const cellMap     = this._buildCellMap(bookings);
      const reminderMap = this._buildReminderMap(reminders);
      this._render(cellMap, reminderMap);

    // ── 5. Barra de resumen superior ──
    this._renderSummaryBar(bookings);

      // ── 6. Heatmap por fila (muy sutil) ──
      this._applyHeatmap(bookings);

      // Bindear eventos de drag/resize una vez por sesión de grid
      if (!this._barDragAbort) {
        const grid = document.getElementById('calendar-grid');
        if (grid) {
          this._setupDragSelection(grid);
          this._setupBarDragAndResize(grid);
        }
      }
    } catch (err) {
      console.error('[Calendar] load error:', err);
      showToast('Error al cargar el calendario', 'error');
    } finally {
      this._isLoading = false;
    }
  }

  // ── Número de columnas visibles ──────────────────
  _computeVisibleDays() {
    const wrapper = document.querySelector('.cal-wrapper');
    const w       = wrapper ? wrapper.clientWidth : Math.max(window.innerWidth - 280, 400);
    const isMob   = window.innerWidth <= 768;
    const cellW   = isMob ? CELL_W_MOB : CELL_W_DESK;
    return Math.max(14, Math.min(120, Math.floor((w - LABEL_W) / cellW)));
  }

  // ── Actualizar título ────────────────────────────
  _updateTitle() {
    const first = this._dateRange[0];
    const last  = this._dateRange[this._dateRange.length - 1] ?? first;
    const fmt = (iso) => {
      const d = new Date(iso + 'T12:00:00');
      return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
    };
    const el = document.getElementById('cal-month-title');
    if (el) el.textContent = `${fmt(first)} – ${fmt(last)}`;

    // Mostrar / ocultar botón "Hoy"
    const todayBtn = document.getElementById('cal-today');
    if (todayBtn) {
      const today   = localToday();
      const visible = first <= today && today <= last;
      todayBtn.style.display = visible ? 'none' : '';
    }
  }

  // ══════════════════════════════════════════════════
  // DATA FETCHING
  // ══════════════════════════════════════════════════
  async _fetchBookings(firstDay, lastDay) {
    const params = { hotelId: this.ctx.hotelId, firstDay, lastDay };
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

  async _fetchReminders(firstDay, lastDay) {
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

  // ══════════════════════════════════════════════════
  // PROCESAMIENTO DE DATOS
  // ══════════════════════════════════════════════════
  _buildDateRange(start, count) {
    return Array.from({ length: count }, (_, i) => this._addDays(start, i));
  }

  _buildCellMap(bookings) {
    const map = {};
    this.ctx.units.forEach(u => {
      map[u.id] = {};
      this._dateRange.forEach(iso => { map[u.id][iso] = []; });
    });

    bookings.forEach(b => {
      const ci = b.check_in;
      const co = b.check_out;
      (b.booking_units ?? []).forEach(({ unit_id }) => {
        if (!map[unit_id]) return;
        this._dateRange.forEach(iso => {
          if (iso >= ci && iso < co) {
            map[unit_id][iso].push({
              ...b,
              _cellType: this._getCellType(ci, co, iso),
            });
          }
        });
      });
    });
    return map;
  }

  _getCellType(ci, co, iso) {
    const windowStart   = this._windowStart;
    const lastOccupied  = this._addDays(co, -1);
    // "start" si es el día de check-in O si el check-in es antes de la ventana
    // y este es el primer día visible de esta reserva
    const isVisualStart = (iso === ci) || (ci < windowStart && iso === windowStart);
    const isVisualEnd   = iso === lastOccupied;
    if (isVisualStart && isVisualEnd) return 'solo';
    if (isVisualStart) return 'start';
    if (isVisualEnd)   return 'end';
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

  // ══════════════════════════════════════════════════
  // RENDERIZADO PRINCIPAL
  // ══════════════════════════════════════════════════
  _render(cellMap, reminderMap) {
    const grid    = document.getElementById('calendar-grid');
    const today   = localToday();
    const isMob   = window.innerWidth <= 768;
    const cellW   = isMob ? CELL_W_MOB : CELL_W_DESK;
    const N       = this._visibleDays;

    grid.style.gridTemplateColumns = `${LABEL_W}px repeat(${N}, minmax(${cellW}px, 1fr))`;
    grid.style.minWidth = `${LABEL_W + N * cellW}px`;
    grid.style.width    = '100%';
    grid.classList.add('month-grid');
    grid.classList.remove('week-grid');
    grid.innerHTML = '';

    // ── Wrapper scroll ────────────────────────────
    const parent = grid.parentElement;
    if (parent) {
      parent.style.overflowX = 'auto';
      parent.style.webkitOverflowScrolling = 'touch';
      parent.style.width = '100%';
    }

    // ── Encabezado: esquina ───────────────────────
    const corner = document.createElement('div');
    corner.className = 'cal-unit-label-header';
    corner.textContent = 'Departamento';
    grid.appendChild(corner);

    // ── Encabezado: columnas de días ──────────────
    const holidays = getHolidaysForYear(new Date().getFullYear());
    // También cargar el año siguiente si el rango lo cruza
    const lastDate   = new Date(this._dateRange[N-1] + 'T12:00:00');
    const nextYHols  = lastDate.getFullYear() !== new Date().getFullYear()
      ? getHolidaysForYear(lastDate.getFullYear()) : null;

    this._dateRange.forEach((iso, colIdx) => {
      const date      = new Date(iso + 'T12:00:00');
      const dayOfMon  = date.getDate();
      const dow       = date.getDay();
      const isToday   = iso === today;
      const isPast    = iso < today;
      const isWknd    = dow === 0 || dow === 6;
      const hasRem    = !!reminderMap[iso];
      const holMap    = nextYHols && date.getFullYear() === lastDate.getFullYear() ? nextYHols : holidays;
      const holiday   = holMap?.get ? holMap.get(iso) : null;
      const isHoliday = !!holiday && holiday.type !== 'vacation';
      // Mostrar etiqueta de mes cuando es el primero del mes o el primer día visible
      const showMonth = dayOfMon === 1 || colIdx === 0;

      const dh = document.createElement('div');
      let cls = 'cal-day-header';
      if (isToday)              cls += ' today';
      if (isWknd)               cls += ' weekend';
      if (isPast && !isToday)   cls += ' past-header';
      if (isHoliday)            cls += ` holiday holiday-${holiday.type}`;
      dh.className = cls;
      dh.dataset.date = iso;
      dh.title = holiday?.label ?? '';

      dh.innerHTML = (showMonth ? '<span class="dh-month' + (dayOfMon === 1 && colIdx !== 0 ? ' dh-month-new' : '') + '">' + MONTH_SHORT[date.getMonth()] + '</span>' : '') +
        '<span class="dh-num">' + dayOfMon + '</span>' +
        (isToday ? '<span class="dh-hoy">HOY</span>' : '<span class="day-name">' + DAY_NAMES[dow] + '</span>') +
        (hasRem  ? '<div class="dh-rem-dot"></div>' : '') +
        (isToday ? '<div class="dh-today-dot"></div>' : '');
      grid.appendChild(dh);
    });

    // ── Filas de unidades ─────────────────────────
    this.ctx.units.forEach((unit, rowIdx) => {
      const unitColor  = getUnitColor(unit);
      const unitLabel  = getUnitLabel(unit);
      const rowParity  = rowIdx % 2 === 0 ? 'even' : 'odd';
      const hasNotes   = !!unit.internal_notes;

      // Label
      const label = document.createElement('div');
      label.className = 'cal-unit-label';
      label.dataset.rowParity = rowParity;
      label.style.setProperty('--unit-color', unitColor);
      label.style.borderLeftColor = unitColor;
      const _notes    = unit.internal_notes ?? '';
      const _notesSafe = _notes.replace(/[']/g, '&#39;');
      const _notesSpan = hasNotes
        ? '<span title="' + _notes.replace(/"/g, '&quot;') + '" style="cursor:help;font-size:.85rem" onclick="window._calInstance._showUnitNote(event,\'' + _notesSafe + '\')">\u{1F4DD}</span>'
        : '';
      const _editBtn = can('manageUnitNotes')
        ? '<button class="btn btn-ghost btn-xs" style="padding:1px 4px;font-size:.65rem;opacity:.5" onclick="window._calInstance.editUnitNotes(\'' + unit.id + '\',\'' + _notesSafe + '\')">\u270f\ufe0f</button>'
        : '';
      label.innerHTML =
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span class="cal-unit-dot" style="background-color:' + unitColor + '"></span>' +
          '<span style="font-size:.82rem;font-weight:700;color:var(--color-text)">' + unitLabel + '</span>' +
          _notesSpan + _editBtn +
        '</div>' +
        '<span class="unit-floor" style="padding-left:16px">Hasta ' + unit.max_guests + ' pers.</span>';
      grid.appendChild(label);

      // Celdas
      this._dateRange.forEach((iso) => {
        const isToday  = iso === today;
        const isPast   = iso < today;
        const date     = new Date(iso + 'T12:00:00');
        const isWknd   = date.getDay() === 0 || date.getDay() === 6;
        const holMap   = nextYHols && date.getFullYear() === lastDate.getFullYear() ? nextYHols : holidays;
        const cellHol  = holMap?.get ? holMap.get(iso) : null;
        const bookings = cellMap[unit.id]?.[iso] ?? [];
        const rems     = reminderMap[iso] ?? [];

        const cell = document.createElement('div');
        let cellCls = 'cal-cell';
        if (isToday)  cellCls += ' today-col';
        if (isWknd)   cellCls += ' weekend-col';
        if (isPast)   cellCls += ' past-col';
        if (cellHol?.type === 'fixed' || cellHol?.type === 'movable') cellCls += ' holiday-col';
        if (cellHol?.type === 'vacation') cellCls += ' vacation-col';
        if (cellHol?.type === 'bridge')   cellCls += ' bridge-col';
        cell.className      = cellCls;
        cell.dataset.date   = iso;
        cell.dataset.unitId = unit.id;
        cell.dataset.rowParity = rowParity;
        if (cellHol) cell.title = cellHol.label;

        if (bookings.length === 0) {
          this._bindEmptyCell(cell, unit.id, iso);
        } else if (bookings.length === 1) {
          this._renderBar(cell, bookings[0], today);
        } else {
          const co = bookings.find(b => b._cellType === 'end');
          const ci = bookings.find(b => b._cellType === 'start' || b._cellType === 'solo');
          if (co && ci) this._renderSplitCell(cell, co, ci, today);
          else this._renderBar(cell, bookings[0], today);
        }

        rems.forEach(r => {
          if (r.unit_id && r.unit_id !== unit.id) return;
          const dot = document.createElement('div');
          dot.className = 'cal-reminder-dot';
          dot.innerHTML = `<div class="tooltip">🔔 ${r.title}${r.units ? ` · #${r.units.sort_order} ${r.units.name}` : ''}</div>`;
          cell.appendChild(dot);
        });

        grid.appendChild(cell);
      });
    });
  }

  // ══════════════════════════════════════════════════
  // RENDERIZADO DE BARRAS
  // ══════════════════════════════════════════════════
  _renderBar(cell, booking, todayISO) {
    if (booking._cellType !== 'start' && booking._cellType !== 'solo') return;

    const { color, textColor } = getBookingBarColor(booking);
    const ci        = booking.check_in;
    const co        = booking.check_out;
    const winStart  = this._windowStart;
    const winEndExcl= this._addDays(winStart, this._visibleDays);

    // Fecha de inicio visual (puede ser windowStart si el check-in es anterior)
    const visStart  = ci < winStart ? winStart : ci;
    // Fecha de fin visual (puede ser windowEnd si el check-out supera la vista)
    const visEnd    = co > winEndExcl ? winEndExcl : co;
    const span      = Math.max(1, this._dayDiff(visStart, visEnd));

    const truncLeft  = ci < winStart;        // empezó antes de la vista
    const truncRight = co > winEndExcl;      // termina después de la vista
    const isPast     = co <= todayISO;

    const left  = truncLeft  ? 0 : 4;
    const rightM= truncRight ? 0 : 4;
    const width = `calc(${span} * 100% - ${left + rightM}px)`;
    const borderR = truncRight ? 0 : 6;
    const borderL = truncLeft  ? 0 : 6;

    const firstName = booking.guests?.first_name ?? '';
    const lastName  = booking.guests?.last_name  ?? '';
    const isBlock   = booking.status === 'blocked' || booking.is_blocked;
    const guestFull = isBlock
      ? (booking.block_reason ?? 'Bloqueo')
      : `${lastName} ${firstName}`.trim();

    const bar = document.createElement('div');
    bar.className = 'bar bar-span';

    if (this._pendingPulse.has(booking.id)) {
      bar.classList.add('bar-new-bounce');
      this._pendingPulse.delete(booking.id);
      setTimeout(() => bar.classList.remove('bar-new-bounce'), 1200);
    }

    bar.style.cssText = `
      background:${color};
      position:absolute;top:6px;bottom:6px;
      left:${left}px;
      width:${width};
      z-index:3;
      border-radius:${borderL}px ${borderR}px ${borderR}px ${borderL}px;
      display:flex;align-items:center;padding:0 8px;
      overflow:hidden;white-space:nowrap;
      cursor:grab;
      transition:filter .15s,transform .15s,box-shadow .15s;
      ${isPast ? 'filter:grayscale(52%) opacity(.62);' : ''}
    `;
    bar.dataset.bookingId = booking.id;
    bar.draggable = false;
    bar.addEventListener('dragstart', e => e.preventDefault());

    const source  = booking.source ?? 'direct';
    const srcCfg  = SOURCE_CONFIG[source] ?? {}; // eslint-disable-line no-unused-vars
    const CANAL_ABBR = { airbnb:'AB', booking:'BK', despegar:'DS', expedia:'EX', walkin:'WI', company:'CO', family:'FM', referral:'RF' };
    const canalAbbr  = CANAL_ABBR[source];
    // Usar concatenación en vez de template literal anidado (Rollup/Vite lo rechaza)
    const canalChip  = (!isBlock && canalAbbr)
      ? '<span style="display:inline-flex;align-items:center;justify-content:center;' +
        'padding:0 4px;border-radius:3px;font-size:.6rem;font-weight:800;line-height:1.5;' +
        'flex-shrink:0;margin-right:4px;letter-spacing:.02em;' +
        'background:rgba(255,255,255,.25);color:' + textColor + '">' + canalAbbr + '</span>'
      : '';

    const avatar = !isBlock ? Calendar._guestAvatar(booking.guests, 16) : '';
    const nameStyle = 'color:' + textColor + ';font-size:.68rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0';
    bar.innerHTML = avatar + canalChip + '<span style="' + nameStyle + '">' + guestFull + '</span>';

    // ── Resize handle (solo si la barra no está truncada a la derecha) ──
    if (!truncRight) {
      const handle = document.createElement('div');
      handle.className = 'bar-resize-handle';
      handle.title = 'Arrastrar para cambiar fecha de salida';
      bar.appendChild(handle);
    }

    // ── Hover effects ──
    bar.addEventListener('mouseenter', (e) => {
      if (!this._barDrag.active && !this._resizeActive) {
        if (!isPast) {
          bar.style.filter    = 'brightness(1.12)';
          bar.style.transform = 'scaleY(1.06)';
        }
        bar.style.boxShadow = '0 2px 10px rgba(0,0,0,.28)';
        this._showTooltip(booking, e);
      }
    });
    bar.addEventListener('mousemove', (e) => {
      if (!this._barDrag.active) this._moveTooltip(e);
    });
    bar.addEventListener('mouseleave', () => {
      bar.style.filter    = isPast ? 'grayscale(52%) opacity(.62)' : '';
      bar.style.transform = '';
      bar.style.boxShadow = '';
      this._hideTooltip();
    });
    bar.addEventListener('click', (e) => {
      if (this._barDrag.moved) return;
      e.stopPropagation();
      this._openDetailById(booking.id);
    });

    cell.appendChild(bar);
  }

  // ── Celda dividida (check-out + check-in el mismo día) ──
  _renderSplitCell(cell, coBooking, ciBooking, todayISO) {
    const coColor  = getBookingBarColor(coBooking).color;
    const ciColor  = getBookingBarColor(ciBooking).color;
    const coIsPast = coBooking.check_out <= todayISO;
    const ciIsPast = ciBooking.check_out <= todayISO;

    const left = document.createElement('div');
    left.className = 'bar bar-split-left';
    left.style.background = coColor;
    if (coIsPast) left.style.filter = 'grayscale(52%) opacity(.62)';
    left.dataset.bookingId = coBooking.id;
    left.addEventListener('mouseenter', (e) => this._showTooltip(coBooking, e));
    left.addEventListener('mousemove',  (e) => this._moveTooltip(e));
    left.addEventListener('mouseleave', ()  => this._hideTooltip());
    left.addEventListener('click', (e) => { e.stopPropagation(); this._openDetailById(coBooking.id); });

    const right = document.createElement('div');
    right.className = 'bar bar-split-right';
    right.style.background = ciColor;
    if (ciIsPast) right.style.filter = 'grayscale(52%) opacity(.62)';
    right.dataset.bookingId = ciBooking.id;
    right.addEventListener('mouseenter', (e) => this._showTooltip(ciBooking, e));
    right.addEventListener('mousemove',  (e) => this._moveTooltip(e));
    right.addEventListener('mouseleave', ()  => this._hideTooltip());
    right.addEventListener('click', (e) => { e.stopPropagation(); this._openDetailById(ciBooking.id); });

    cell.appendChild(left);
    cell.appendChild(right);
    cell.style.background = 'rgba(251,113,133,.04)';
  }

  // ── Celda vacía (click abre formulario) ──────────
  _bindEmptyCell(cell, unitId, dateISO) {
    // Hint visual: "+" al hover
    cell.classList.add('cal-cell-empty');

    cell.addEventListener('click', (e) => {
      // Ignorar si venía de un drag (barra o selección)
      if (this._drag?.moved || this._barDrag?.moved) return;
      if (e.target.closest('.bar,.bar-resize-handle,.ctx-menu')) return;
      // No abrir en celdas pasadas
      if (dateISO < localToday()) return;

      // Pre-llenar: check-in en la fecha, check-out al día siguiente
      const checkOut = this._addDays(dateISO, 1);

      // Navegar a sección calendario si no estamos ahí (mobile)
      if (window.milaNav) window.milaNav('calendar');

      this.bookingForm.open({ unitId, checkIn: dateISO, checkOut });
    });

    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._ctxTarget = { unitId, dateISO };
      this._showContextMenu(e.clientX, e.clientY);
    });
  }

  // ── Avatar de iniciales ──────────────────────────
  static _guestAvatar(guest, size = 18) {
    if (!guest) return '';
    const fn = guest.first_name ?? '';
    const ln = guest.last_name  ?? '';
    if (!fn && !ln) return '';
    const initials = ((fn[0] ?? '') + (ln[0] ?? '')).toUpperCase();
    const str  = (fn + ln).toLowerCase();
    let hash   = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const hue  = Math.abs(hash) % 360;
    return `<span class="bar-avatar" style="
      display:inline-flex;align-items:center;justify-content:center;
      width:${size}px;height:${size}px;min-width:${size}px;border-radius:50%;
      background:hsl(${hue},55%,88%);color:hsl(${hue},55%,28%);
      font-size:${Math.max(8, Math.round(size*.44))}px;font-weight:800;
      flex-shrink:0;line-height:1;margin-right:5px;
    ">${initials}</span>`;
  }

  // ══════════════════════════════════════════════════
  // TOOLTIP
  // ══════════════════════════════════════════════════
  _showTooltip(booking, e) {
    this._hideTooltip();
    const guest   = booking.guests
      ? `${booking.guests.first_name} ${booking.guests.last_name}`
      : (booking.block_reason ?? 'Bloqueo');
    const { label } = getBookingBarColor(booking);
    const source    = booking.source ?? 'direct';
    const srcCfg    = SOURCE_CONFIG[source] ?? {};
    const units     = (booking.booking_units ?? []).map(bu => {
      const u = bu.units ?? {};
      return `#${u.sort_order ?? '?'} · ${u.name ?? '?'}`;
    }).join(', ');
    const hasBadExp     = booking.guests?.bad_experience;
    const totalAmount   = booking.total_amount ?? 0;
    const totalPaid     = booking.total_paid   ?? 0;
    const balance       = booking.balance      ?? (totalAmount - totalPaid);
    const saldado       = balance <= 0;

    const payRow = totalAmount > 0 ? `
      <div style="border-top:1px solid rgba(255,255,255,.1);padding-top:9px;margin-top:9px">
        <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:5px">
          <div>
            <div style="font-size:.65rem;color:#64748B;text-transform:uppercase;letter-spacing:.04em">Total</div>
            <div style="font-weight:700;color:#F8FAFC;font-size:.88rem">${formatARS(totalAmount)}</div>
          </div>
          ${totalPaid > 0 ? `<div>
            <div style="font-size:.65rem;color:#64748B;text-transform:uppercase;letter-spacing:.04em">Señas</div>
            <div style="font-weight:600;color:#A78BFA;font-size:.85rem">${formatARS(totalPaid)}</div>
          </div>` : ''}
          <div style="text-align:right">
            <div style="font-size:.65rem;color:#64748B;text-transform:uppercase;letter-spacing:.04em">Saldo</div>
            <div style="font-weight:700;font-size:.88rem;color:${saldado ? '#34D399' : '#EAB308'}">
              ${saldado ? '✓ Saldado' : formatARS(balance)}
            </div>
          </div>
        </div>
      </div>` : '';

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
        ${source !== 'direct' && source !== 'blocked' ? '<span style="padding:2px 8px;border-radius:99px;font-size:.7rem;font-weight:700;background:' + (srcCfg.color??'') + '22;color:' + (srcCfg.color??'#64748B') + ';border:1px solid ' + (srcCfg.color??'') + '40">' + (srcCfg.emoji??'') + ' ' + (srcCfg.label??'') + '</span>' : ''}
      </div>
      ${payRow}
      ${booking.notes ? '<div style="margin-top:8px;font-size:.7rem;color:#94A3B8;font-style:italic;border-top:1px solid rgba(255,255,255,.07);padding-top:7px">📝 ' + booking.notes.slice(0,80) + (booking.notes.length>80?'…':'') + '</div>' : ''}
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
    this._tooltip.style.left = `${x + tw > window.innerWidth  ? x - tw - 36 : x}px`;
    this._tooltip.style.top  = `${y + th > window.innerHeight ? y - th       : y}px`;
  }

  _hideTooltip() { this._tooltip?.remove(); this._tooltip = null; }

  // ══════════════════════════════════════════════════
  // NAVEGACIÓN CONTINUA
  // ══════════════════════════════════════════════════
  _setupControls() {
    document.getElementById('cal-prev')?.addEventListener('click', () => {
      this._windowStart = this._addDays(this._windowStart, -this._visibleDays);
      cache.invalidate('bookings');
      this.load();
    });
    document.getElementById('cal-next')?.addEventListener('click', () => {
      this._windowStart = this._addDays(this._windowStart, +this._visibleDays);
      cache.invalidate('bookings');
      this.load();
    });
    document.getElementById('cal-today')?.addEventListener('click', () => {
      this._windowStart = this._addDays(localToday(), -PAST_OFFSET);
      cache.invalidate('bookings');
      this.load();
    });

    // ── 4. Mini-calendario → navega el calendario principal ──
    this._bindMiniCalSync();

    // ── Búsqueda de huéspedes en el calendario ──
    this._setupCalSearch();

    this.setupViewToggle();
  }

  // Sincroniza clicks en el mini-cal con el calendario principal
  // ── Búsqueda de huéspedes en el calendario ──────────
  _setupCalSearch() {
    const input   = document.getElementById('cal-search-input');
    const clearBtn= document.getElementById('cal-search-clear');
    if (!input) return;

    let _searchTimer = null;
    const doSearch = (q) => {
      q = q.trim().toLowerCase();
      // Limpiar resaltado previo
      document.querySelectorAll('.bar.cal-search-match,.bar.cal-search-dim').forEach(b => {
        b.classList.remove('cal-search-match','cal-search-dim');
      });
      if (!q) { if (clearBtn) clearBtn.style.display='none'; return; }
      if (clearBtn) clearBtn.style.display='';

      let found = null;
      document.querySelectorAll('.bar[data-booking-id]').forEach(bar => {
        const bid = bar.dataset.bookingId;
        const booking = this._lastRenderedBookings?.find(b => b.id === bid);
        if (!booking) { bar.classList.add('cal-search-dim'); return; }
        const g    = booking.guests;
        const name = ((g?.first_name ?? '') + ' ' + (g?.last_name ?? '')).toLowerCase();
        const unit = (booking.booking_units?.[0]?.units?.name ?? '').toLowerCase();
        if (name.includes(q) || unit.includes(q)) {
          bar.classList.add('cal-search-match');
          if (!found) found = bar;
        } else {
          bar.classList.add('cal-search-dim');
        }
      });

      // Scroll a la primera barra encontrada
      if (found) {
        found.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    };

    input.addEventListener('input', (e) => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => doSearch(e.target.value), 250);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value=''; doSearch(''); input.blur(); }
    });
    clearBtn?.addEventListener('click', () => { input.value=''; doSearch(''); input.focus(); });
  }

  _bindMiniCalSync() {
    this._bindMiniCalDays();
    // Disconnect previous observer before creating a new one
    if (this._miniCalObs) { this._miniCalObs.disconnect(); this._miniCalObs = null; }
    const target = document.getElementById('sidebar-cal-container');
    if (target) {
      this._miniCalObs = new MutationObserver(() => this._bindMiniCalDays());
      this._miniCalObs.observe(target, { childList: true, subtree: true });
    }
  }

  _bindMiniCalDays() {
    const days = document.querySelectorAll('#sidebar-mini-cal .smc-day:not(.smc-empty)');
    days.forEach(cell => {      if (cell.dataset.calBound) return;
      cell.dataset.calBound = '1';
      cell.addEventListener('click', () => {
        // Extraer año/mes del título del mini-cal
        const titleEl = document.querySelector('#sidebar-mini-cal .smc-title');
        if (!titleEl) return;
        // Título es "junio 2026" (es-AR locale)
        const titleText = titleEl.textContent ?? '';
        const yearMatch = titleText.match(/\d{4}/);
        if (!yearMatch) return;
        const year  = parseInt(yearMatch[0]);
        // Month: find by month name in title
        const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        const monthIdx = MONTHS_ES.findIndex(m => titleText.toLowerCase().includes(m));
        if (monthIdx < 0) return;

        const day = parseInt(cell.querySelector('.smc-num')?.textContent ?? '1');
        const isoDate = year + '-' + String(monthIdx + 1).padStart(2,'0') + '-' + String(day).padStart(2,'0');

        // Resaltar el día seleccionado en el mini-cal
        document.querySelectorAll('#sidebar-mini-cal .smc-day').forEach(d => d.classList.remove('smc-selected'));
        cell.classList.add('smc-selected');

        // Navegar el calendario principal a esa fecha (centrada)
        this._windowStart = this._addDays(isoDate, -PAST_OFFSET);
        cache.invalidate('bookings');
        this.load();
      });
    });
  }

  // ══════════════════════════════════════════════════
  // CONTEXT MENU
  // ══════════════════════════════════════════════════
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
    m.style.left = `${x}px`;
    m.style.top  = `${y}px`;
  }
  _hideContextMenu() { document.getElementById('ctx-menu')?.classList.add('hidden'); }

  _setupDocumentEvents() {
    document.addEventListener('click', () => this._hideContextMenu());
    document.addEventListener('booking:changed', () => {
      if (document.getElementById('section-calendar')?.classList.contains('active')) {
        cache.invalidate('bookings');
        this.load();
      }
    });
  }

  // ══════════════════════════════════════════════════
  // DRAG SELECTION (crear reserva / bloqueo)
  // ══════════════════════════════════════════════════
  _setupDragSelection(grid) {
    if (this._selectionAbort) this._selectionAbort.abort();
    this._selectionAbort = new AbortController();
    const sig = this._selectionAbort.signal;

    let startUnit = null, startDate = null, endDate = null, isBlocking = false;

    const onMouseDown = (e) => {
      if (e.target.closest('.bar')) return;
      const cell = e.target.closest('.cal-cell');
      if (!cell) return;
      isBlocking = e.shiftKey;
      startUnit  = cell.dataset.unitId;
      startDate  = cell.dataset.date;
      this._drag = { active: true, unitId: startUnit, moved: false, blocking: isBlocking };
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
        const d1 = new Date(Math.min(+new Date(startDate+'T12:00:00'), +new Date(endDate+'T12:00:00')));
        const d2 = new Date(Math.max(+new Date(startDate+'T12:00:00'), +new Date(endDate+'T12:00:00')));
        const nights = Math.round((d2 - d1) / 86400000) + 1;
        const label  = isBlocking ? '🔒 Bloquear: ' : '';
        this._textGhost.textContent = `${label}${d1.toLocaleDateString('es-AR',{day:'2-digit',month:'short'})} → ${d2.toLocaleDateString('es-AR',{day:'2-digit',month:'short'})} · ${nights} noche${nights!==1?'s':''}`;
        this._textGhost.style.left        = `${e.clientX}px`;
        this._textGhost.style.top         = `${e.clientY}px`;
        this._textGhost.style.borderLeft  = isBlocking ? '3px solid #ef4444' : '3px solid var(--color-primary)';
        this._textGhost.classList.remove('hidden');
      }

      grid.querySelectorAll('.cal-cell.selecting,.cal-cell.blocking')
        .forEach(c => c.classList.remove('selecting','blocking'));
      const startD = startDate, endD = cell.dataset.date;
      const [mn, mx] = [startD, endD].sort();
      grid.querySelectorAll(`.cal-cell[data-unit-id="${startUnit}"]`).forEach(c => {
        if (c.dataset.date >= mn && c.dataset.date <= mx) c.classList.add(isBlocking ? 'blocking' : 'selecting');
      });
    };

    const onMouseUp = async () => {
      if (!this._drag.active) return;
      const hadDrag  = this._drag.moved;
      const wasBlock = this._drag.blocking;
      grid.querySelectorAll('.cal-cell.selecting,.cal-cell.blocking').forEach(c => c.classList.remove('selecting','blocking'));
      this._drag = { active: false, moved: false };
      this._textGhost.classList.add('hidden');

      if (hadDrag && startDate && endDate) {
        const [d1, d2] = [startDate, endDate].sort();
        const last = new Date(d2 + 'T12:00:00');
        last.setDate(last.getDate() + 1);

        if (wasBlock) {
          const reason = prompt('Motivo del bloqueo (mantenimiento, uso propio, reparación...):', 'Mantenimiento');
          if (reason !== null) await this._blockRange(startUnit, d1, toISODate(last), reason.trim() || 'Bloqueo');
        } else {
          this.bookingForm.open({ unitId: startUnit, checkIn: d1, checkOut: toISODate(last) });
        }
      }
      startUnit = null; startDate = null; endDate = null; isBlocking = false;
    };

    grid.addEventListener('mousedown', onMouseDown, { signal: sig });
    document.addEventListener('mousemove', onMouseMove, { signal: sig });
    document.addEventListener('mouseup', onMouseUp, { signal: sig });
  }

  // ── Bloquear rango ──────────────────────────────
  async _blockRange(unitId, checkIn, checkOut, reason) {
    const unit = this.ctx.units.find(u => u.id === unitId);
    const name = unit?.name ?? 'unidad';
    try {
      const { data: bk, error } = await this.db.from('bookings').insert({
        hotel_id: this.ctx.hotelId, check_in: checkIn, check_out: checkOut,
        status: 'blocked', is_blocked: true, block_reason: reason, price_per_night: 0,
      }).select('id').single();
      if (error) throw error;
      if (!bk?.id) throw new Error('No ID');
      const { error: buErr } = await this.db.from('booking_units').insert({ booking_id: bk.id, unit_id: unitId });
      if (buErr) throw buErr;
      await this._createMaintenanceForBlock(bk.id, unitId, checkIn, checkOut, reason);
      showToast(`🔒 ${name} bloqueado — ${checkIn} → ${checkOut}`, 'success');
      cache.invalidate('bookings');
      await this.load();
    } catch (err) {
      console.error('[Calendar] blockRange:', err);
      showToast('Error al crear el bloqueo: ' + (err?.message ?? String(err)), 'error');
    }
  }

  // ══════════════════════════════════════════════════
  // DRAG & DROP DE BARRAS + RESIZE (event delegation)
  // ══════════════════════════════════════════════════
  _setupBarDragAndResize(grid) {
    if (this._barDragAbort) this._barDragAbort.abort();
    this._barDragAbort = new AbortController();
    const sig = this._barDragAbort.signal;

    // ────────────────────────────────────────────────
    // RESIZE
    // ────────────────────────────────────────────────
    grid.addEventListener('mousedown', (e) => {
      const handle = e.target.closest('.bar-resize-handle');
      if (!handle) return;
      e.preventDefault();
      e.stopPropagation();

      const bar       = handle.closest('.bar[data-booking-id]');
      if (!bar) return;
      const bookingId = bar.dataset.bookingId;
      const booking   = (this._lastRenderedBookings ?? []).find(b => b.id === bookingId);
      if (!booking) return;

      this._resizeActive = true;
      this._hideTooltip();
      this._startResize(e, booking, bar, grid, sig);
    }, { signal: sig });

    // ────────────────────────────────────────────────
    // DRAG & DROP
    // ────────────────────────────────────────────────
    let _dragState  = null;
    let _barGhost   = null;
    let _autoScroll = null;
    let _ghostInitFn= null;  // función de creación diferida del ghost

    const getCellWidth = () => {
      const firstCell = grid.querySelector('.cal-cell[data-date]');
      return firstCell ? firstCell.getBoundingClientRect().width : CELL_W_DESK;
    };

    const resetDrag = () => {
      if (_barGhost) { _barGhost.remove(); _barGhost = null; }
      if (_autoScroll) { _autoScroll.stop(); _autoScroll = null; }
      _ghostInitFn = null;
      this._floatInfo.classList.add('hidden');
      this._clearDropHighlights(grid);
      _dragState = null;
      this._barDrag = { active: false, moved: false };
    };

    const onMouseMove = (e) => {
      if (!_dragState || !this._barDrag.active) return;
      const dx = Math.abs(e.clientX - _dragState.startX);
      const dy = Math.abs(e.clientY - _dragState.startY);
      if (dx < 6 && dy < 6) return;
      _dragState.moved = true;
      this._barDrag.moved = true;

      // Crear ghost solo al primer movimiento real (evita fantasma en header)
      if (_ghostInitFn) { _ghostInitFn(); _ghostInitFn = null; }

      const cellWidth = getCellWidth();
      const daysDiff  = Math.round((e.clientX - _dragState.startX) / cellWidth);
      _dragState.daysDiff = daysDiff;

      const b     = _dragState.booking;
      if (!b) return;

      const newCI = this._addDays(b.check_in,  daysDiff);
      const newCO = this._addDays(b.check_out, daysDiff);

      // Move ghost
      if (_barGhost) {
        _barGhost.style.left = `${_dragState.ghostOrigLeft + (e.clientX - _dragState.startX)}px`;
        _barGhost.style.top  = `${e.clientY - _dragState.ghostH / 2}px`;
      }

      // Detectar unidad destino
      const underCell    = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.cal-cell');
      const targetUnitId = underCell?.dataset.unitId ?? _dragState.sourceUnitId;
      _dragState.targetUnitId = targetUnitId;

      // Validación local contra reservas cargadas
      const hasConflict = (this._lastRenderedBookings ?? []).some(other => {
        if (other.id === b.id || other.status === 'cancelled') return false;
        if (!(other.booking_units ?? []).some(bu => bu.unit_id === targetUnitId)) return false;
        return other.check_in < newCO && other.check_out > newCI;
      });

      // Highlights
      this._clearDropHighlights(grid);
      const cls = hasConflict ? 'drop-conflict' : 'drop-target';
      grid.querySelectorAll(`.cal-cell[data-unit-id="${targetUnitId}"][data-date]`).forEach(c => {
        if (c.dataset.date >= newCI && c.dataset.date < newCO) c.classList.add(cls);
      });

      // Float info
      const unitName = this.ctx.units.find(u => u.id === targetUnitId)?.name ?? '';
      const gName = b.guests ? `${b.guests.first_name ?? ''} ${b.guests.last_name ?? ''}`.trim() : (b.block_reason ?? 'Bloqueo');
      this._floatInfo.innerHTML = `
        <div class="fi-guest">${gName}</div>
        <div class="fi-unit">🛏️ ${unitName}</div>
        <div class="fi-dates">📅 ${this._fmtShort(newCI)} → ${this._fmtShort(newCO)}</div>
        <div class="fi-nights">🌙 ${b.nights ?? Math.round(this._dayDiff(b.check_in, b.check_out))} noches</div>
        ${hasConflict ? '<div class="fi-conflict">⚠️ Conflicto detectado</div>' : ''}
      `;
      this._floatInfo.className = `cal-drag-float-info${hasConflict ? ' conflict' : ''}`;
      this._floatInfo.style.left = `${e.clientX + 20}px`;
      this._floatInfo.style.top  = `${e.clientY - 60}px`;

      if (_autoScroll) _autoScroll.update(e.clientX, e.clientY);
    };

    const onMouseUp = async (e) => {
      if (!this._barDrag.active) return;
      const state  = _dragState ? { ..._dragState } : null;
      const moved  = this._barDrag.moved;

      // Restaurar opacidad de la barra original
      const origBar = state?.bookingId
        ? grid.querySelector(`.bar[data-booking-id="${state.bookingId}"]`)
        : null;
      if (origBar) origBar.style.opacity = '';

      resetDrag();
      if (!state) return;

      if (!moved) {
        if (state.booking) await this._openDetailById(state.booking.id);
        return;
      }

      const { booking, sourceUnitId, daysDiff } = state;
      if (!booking || daysDiff === 0 && state.targetUnitId === sourceUnitId) {
        this.load(); return;
      }

      const newCI        = this._addDays(booking.check_in,  daysDiff);
      const newCO        = this._addDays(booking.check_out, daysDiff);
      const targetUnitId = state.targetUnitId ?? sourceUnitId;
      const unitChanged  = targetUnitId !== sourceUnitId;
      const today        = localToday();

      const srcUnit = this.ctx.units.find(u => u.id === sourceUnitId);
      const tgtUnit = this.ctx.units.find(u => u.id === targetUnitId);

      const confirmed = await this._confirmDragChange({
        guestName:   booking.guests ? `${booking.guests.first_name ?? ''} ${booking.guests.last_name ?? ''}`.trim() : (booking.block_reason ?? 'Reserva'),
        srcUnitName: srcUnit?.name ?? '',
        tgtUnitName: tgtUnit?.name ?? '',
        oldCI:       booking.check_in,
        oldCO:       booking.check_out,
        newCI,
        newCO,
        nights:      booking.nights ?? this._dayDiff(booking.check_in, booking.check_out),
        unitChanged,
        isPast:      newCI < today,
      });
      if (!confirmed) { this.load(); return; }

      // Validación final en Supabase
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
        this.load(); return;
      }

      const { error } = await this.db.from('bookings')
        .update({ check_in: newCI, check_out: newCO }).eq('id', booking.id);
      if (error) { showToast('Error al mover la reserva', 'error'); return; }

      if (unitChanged) {
        await this.db.from('booking_units')
          .update({ unit_id: targetUnitId })
          .eq('booking_id', booking.id)
          .eq('unit_id', sourceUnitId);
      }

      await logAction('UPDATE', 'booking', booking.id,
        `Drag: ${booking.check_in}→${newCI}, unidad: ${sourceUnitId}→${targetUnitId}`);

      this._pendingPulse.add(booking.id);
      cache.invalidate('bookings');
      Bus.emit(EVENTS.BOOKING_DRAG_DONE, { bookingId: booking.id, oldCI: booking.check_in, newCI });
      showToast(`✓ Reserva movida a ${this._fmtShort(newCI)} → ${this._fmtShort(newCO)}`, 'success');
      this.load();
    };

    // ── Mousedown en barra (no en handle de resize) ──
    grid.addEventListener('mousedown', (e) => {
      if (e.target.closest('.bar-resize-handle')) return;
      const bar = e.target.closest('.bar[data-booking-id]');
      if (!bar) return;
      e.preventDefault();
      e.stopPropagation();

      const bookingId    = bar.dataset.bookingId;
      const cell         = bar.closest('.cal-cell');
      const sourceUnitId = cell?.dataset.unitId ?? null;
      const booking      = (this._lastRenderedBookings ?? []).find(b => b.id === bookingId) ?? null;

      // Medir la barra para el ghost
      const barRect = bar.getBoundingClientRect();

      _dragState = {
        booking,
        bookingId,
        sourceUnitId,
        targetUnitId: sourceUnitId,
        startX: e.clientX,
        startY: e.clientY,
        daysDiff: 0,
        moved: false,
        ghostOrigLeft: barRect.left,
        ghostH: barRect.height,
      };
      this._barDrag = { active: true, moved: false };

      // Si no tenemos los datos aún, buscar
      if (!booking) {
        this.db.from('bookings')
          .select('id,check_in,check_out,nights,guests(first_name,last_name),booking_units(unit_id)')
          .eq('id', bookingId).single()
          .then(({ data }) => { if (data && _dragState) _dragState.booking = data; });
      }

      // Ghost diferido — se crea al primer movimiento real
      _ghostInitFn = () => {
        _barGhost = bar.cloneNode(true);
        _barGhost.setAttribute('draggable', 'false');
        _barGhost.querySelectorAll('[draggable]').forEach(el => el.removeAttribute('draggable'));
        _barGhost.style.cssText = `
          position:fixed;
          left:${barRect.left}px;top:${barRect.top}px;
          width:${barRect.width}px;height:${barRect.height}px;
          z-index:9999;pointer-events:none;
          opacity:.88;transform:scale(1.04) translateZ(0);
          box-shadow:0 12px 40px rgba(0,0,0,.30),0 4px 12px rgba(0,0,0,.18);
          border-radius:6px;cursor:grabbing;transition:none;
        `;
        document.body.appendChild(_barGhost);
        bar.style.opacity = '0.3';
      };

      // Auto-scroll
      _autoScroll = this._makeAutoScroll();

      document.addEventListener('mousemove', onMouseMove, { signal: sig });
      document.addEventListener('mouseup', onMouseUp, { once: true });
    }, { signal: sig });

    // ── Touch support ──
    grid.addEventListener('touchstart', (e) => {
      if (e.target.closest('.bar-resize-handle')) return;
      const bar = e.target.closest('.bar[data-booking-id]');
      if (!bar) return;
      const t         = e.touches[0];
      const bookingId = bar.dataset.bookingId;
      const cell      = bar.closest('.cal-cell');
      const booking   = (this._lastRenderedBookings ?? []).find(b => b.id === bookingId) ?? null;
      const barRect   = bar.getBoundingClientRect();

      _dragState = {
        booking, bookingId,
        sourceUnitId: cell?.dataset.unitId ?? null,
        targetUnitId: cell?.dataset.unitId ?? null,
        startX: t.clientX, startY: t.clientY,
        daysDiff: 0, moved: false,
        ghostOrigLeft: barRect.left,
        ghostH: barRect.height,
      };
      this._barDrag = { active: true, moved: false };

      // Ghost diferido para touch también
      _ghostInitFn = () => {
        _barGhost = bar.cloneNode(true);
        _barGhost.setAttribute('draggable', 'false');
        _barGhost.style.cssText = `
          position:fixed;left:${barRect.left}px;top:${barRect.top}px;
          width:${barRect.width}px;height:${barRect.height}px;
          z-index:9999;pointer-events:none;opacity:.88;
          transform:scale(1.04);border-radius:6px;
          box-shadow:0 12px 40px rgba(0,0,0,.3);transition:none;
        `;
        document.body.appendChild(_barGhost);
        bar.style.opacity = '0.3';
      };
      _autoScroll = this._makeAutoScroll();

      const onTM = (te) => {
        te.preventDefault(); // evita que la página scrollee durante el drag
        const touch = te.touches[0];
        onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
      };
      const onTE = (te) => {
        document.removeEventListener('touchmove', onTM);
        document.removeEventListener('touchend', onTE);
        onMouseUp({ clientX: te.changedTouches[0].clientX });
      };
      document.addEventListener('touchmove', onTM, { passive: false, signal: sig });
      document.addEventListener('touchend', onTE, { signal: sig });
    }, { passive: false, signal: sig });

    // ── Touch resize — longpress en handle ──────────
    grid.addEventListener('touchstart', (e) => {
      const handle = e.target.closest('.bar-resize-handle');
      if (!handle) return;
      e.preventDefault();
      e.stopPropagation();

      const bar       = handle.closest('.bar[data-booking-id]');
      if (!bar) return;
      const bookingId = bar.dataset.bookingId;
      const booking   = (this._lastRenderedBookings ?? []).find(b => b.id === bookingId);
      if (!booking) return;

      const t = e.touches[0];

      // Feedback visual inmediato
      handle.style.background = 'rgba(99,102,241,.6)';

      const onTouchMove = (te) => {
        te.preventDefault();
        this._startResize(te.touches[0], booking, bar, grid, sig);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchCancel);
      };
      const onTouchCancel = () => {
        handle.style.background = '';
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchCancel);
      };

      document.addEventListener('touchmove', onTouchMove, { passive: false, signal: sig });
      document.addEventListener('touchend', onTouchCancel, { signal: sig });
    }, { passive: false, signal: sig });
  } // end _setupBarDragAndResize

  // ── Limpiar highlights de drop ──────────────────
  _clearDropHighlights(grid) {
    grid.querySelectorAll('.drop-target,.drop-conflict').forEach(c =>
      c.classList.remove('drop-target', 'drop-conflict')
    );
  }

  // ── Auto scroll horizontal ───────────────────────
  _makeAutoScroll() {
    const wrapper = document.querySelector('.cal-wrapper');
    if (!wrapper) return { update: ()=>{}, stop: ()=>{} };
    let px = 0, py = 0, rafId;
    const tick = () => {
      const rect  = wrapper.getBoundingClientRect();
      const edge  = 80;
      const speed = 8;
      if (px < rect.left + edge)   wrapper.scrollLeft -= speed;
      else if (px > rect.right - edge) wrapper.scrollLeft += speed;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return {
      update: (x, y) => { px = x; py = y; },
      stop: () => cancelAnimationFrame(rafId),
    };
  }

  // ══════════════════════════════════════════════════
  // RESIZE DE RESERVAS
  // ══════════════════════════════════════════════════
  _startResize(e, booking, bar, grid, sig) {
    const origCO     = booking.check_out;
    const origWidth  = bar.getBoundingClientRect().width;
    const origWidthStyle = bar.style.width;
    const startX     = e.clientX;
    let currentCO    = origCO;
    let lastDaysDiff = 0;

    const getCellWidth = () => {
      const firstCell = grid.querySelector('.cal-cell[data-date]');
      return firstCell ? firstCell.getBoundingClientRect().width : CELL_W_DESK;
    };

    const onMove = (ev) => {
      const cellWidth = getCellWidth();
      const deltaX    = ev.clientX - startX;
      const daysDiff  = Math.round(deltaX / cellWidth);
      if (daysDiff === lastDaysDiff) return;
      lastDaysDiff = daysDiff;

      const nights     = this._dayDiff(booking.check_in, origCO);
      const newNights  = Math.max(1, nights + daysDiff);
      currentCO = this._addDays(booking.check_in, newNights);

      // Actualizar ancho visual de la barra
      const newWidth = Math.max(origWidth + daysDiff * cellWidth, cellWidth - 4);
      bar.style.width = `${newWidth}px`;

      // Validar localmente
      const hasConflict = (this._lastRenderedBookings ?? []).some(other => {
        if (other.id === booking.id || other.status === 'cancelled') return false;
        const srcUnitId = (booking.booking_units ?? [])[0]?.unit_id;
        if (!(other.booking_units ?? []).some(bu => bu.unit_id === srcUnitId)) return false;
        return other.check_in < currentCO && other.check_out > booking.check_in;
      });

      bar.classList.toggle('resize-conflict', hasConflict);
      bar.classList.toggle('resize-valid',    !hasConflict);

      // Mostrar float info
      this._floatInfo.innerHTML = `
        <div class="fi-guest" style="font-size:.72rem;font-weight:600">Redimensionar reserva</div>
        <div class="fi-dates">📅 ${this._fmtShort(booking.check_in)} → ${this._fmtShort(currentCO)}</div>
        <div class="fi-nights">🌙 ${newNights} noche${newNights!==1?'s':''}</div>
        ${hasConflict ? '<div class="fi-conflict">⚠️ Conflicto</div>' : ''}
      `;
      this._floatInfo.className = `cal-drag-float-info${hasConflict ? ' conflict' : ''}`;
      this._floatInfo.style.left = `${ev.clientX + 16}px`;
      this._floatInfo.style.top  = `${ev.clientY - 60}px`;
    };

    const onUp = async () => {
      document.removeEventListener('mousemove', onMove);
      this._resizeActive = false;
      bar.classList.remove('resize-conflict', 'resize-valid');
      this._floatInfo.classList.add('hidden');

      if (currentCO === origCO) {
        bar.style.width = origWidthStyle;
        return;
      }

      const confirmed = await this._confirmResizeChange({
        guestName: booking.guests ? `${booking.guests.first_name ?? ''} ${booking.guests.last_name ?? ''}`.trim() : (booking.block_reason ?? 'Reserva'),
        oldCI: booking.check_in, oldCO: origCO,
        newCI: booking.check_in, newCO: currentCO,
        oldNights: this._dayDiff(booking.check_in, origCO),
        newNights: this._dayDiff(booking.check_in, currentCO),
      });

      if (!confirmed) {
        // Animar regreso al tamaño original
        bar.style.transition = 'width .3s cubic-bezier(.4,0,.2,1)';
        bar.style.width = origWidthStyle;
        setTimeout(() => { bar.style.transition = ''; }, 350);
        return;
      }

      // Validación final
      const srcUnitId = (booking.booking_units ?? [])[0]?.unit_id;
      const { data: conflicts } = await this.db
        .from('booking_units')
        .select('unit_id, bookings!inner(id, check_in, check_out, status)')
        .eq('unit_id', srcUnitId)
        .neq('bookings.status', 'cancelled')
        .neq('bookings.id', booking.id)
        .lt('bookings.check_in', currentCO)
        .gt('bookings.check_out', booking.check_in);

      if (conflicts?.length) {
        showToast('⚠️ Conflicto: hay otra reserva en esas fechas', 'error');
        bar.style.width = origWidthStyle;
        this.load(); return;
      }

      const newNights = this._dayDiff(booking.check_in, currentCO);
      const { error } = await this.db.from('bookings')
        .update({ check_out: currentCO, nights: newNights }).eq('id', booking.id);
      if (error) {
        showToast('Error al cambiar la fecha de salida', 'error');
        bar.style.width = origWidthStyle;
        return;
      }

      await logAction('UPDATE', 'booking', booking.id,
        `Resize: check_out ${origCO}→${currentCO}`);

      this._pendingPulse.add(booking.id);
      cache.invalidate('bookings');
      showToast(`✓ Fecha de salida actualizada: ${this._fmtShort(currentCO)}`, 'success');
      this.load();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });

    // Soporte touch (cuando se llama desde touchstart del handle)
    const onTM2 = (te) => { te.preventDefault(); onMove({ clientX: te.touches[0].clientX, clientY: te.touches[0].clientY }); };
    const onTE2 = ()   => { document.removeEventListener('touchmove', onTM2); onUp(); };
    document.addEventListener('touchmove', onTM2, { passive: false });
    document.addEventListener('touchend',  onTE2, { once: true });
  }

  // ══════════════════════════════════════════════════
  // MODALES DE CONFIRMACIÓN
  // ══════════════════════════════════════════════════
  _confirmDragChange({ guestName, srcUnitName, tgtUnitName, oldCI, oldCO, newCI, newCO, nights, unitChanged, isPast }) {
    return new Promise(resolve => {
      document.getElementById('drag-confirm-overlay')?.remove();

      const fmt = iso => {
        const [y,m,d] = iso.split('-');
        return `${d}/${m}/${y}`;
      };

      const overlay = document.createElement('div');
      overlay.id = 'drag-confirm-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;animation:overlayIn .15s ease;';

      overlay.innerHTML = `
        <div style="background:var(--color-background-primary,#fff);border-radius:16px;
          box-shadow:0 20px 60px rgba(0,0,0,.28);padding:24px;max-width:400px;width:100%;
          animation:modalIn .18s cubic-bezier(.4,0,.2,1)">
          <div style="font-size:1rem;font-weight:700;color:var(--color-text,#111);margin-bottom:4px">
            ✏️ Confirmar movimiento
          </div>
          <div style="font-size:.82rem;color:var(--color-text-secondary,#666);margin-bottom:16px">${guestName}</div>
          ${isPast ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:8px 12px;font-size:.8rem;color:#92400e;margin-bottom:12px">
            ⚠️ La nueva fecha de ingreso es en el pasado.
          </div>` : ''}
          ${unitChanged ? `<div style="background:#ede9fe;border:1px solid #c4b5fd;border-radius:8px;padding:8px 12px;font-size:.8rem;color:#5b21b6;margin-bottom:12px;font-weight:600">
            🔄 Cambio de departamento: <strong>${srcUnitName}</strong> → <strong>${tgtUnitName}</strong>
          </div>` : ''}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
            <div style="background:var(--color-background-secondary,#f8f9fa);border-radius:10px;padding:10px 12px">
              <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-tertiary,#999);margin-bottom:4px">Antes</div>
              <div style="font-size:.82rem;font-weight:600;color:var(--color-text,#111)">📅 ${fmt(oldCI)} → ${fmt(oldCO)}</div>
              <div style="font-size:.72rem;color:var(--color-text-3,#999);margin-top:3px">🌙 ${nights} noches</div>
            </div>
            <div style="background:#ede9fe;border-radius:10px;padding:10px 12px">
              <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#7c3aed;margin-bottom:4px">Nuevo</div>
              <div style="font-size:.82rem;font-weight:600;color:#5b21b6">📅 ${fmt(newCI)} → ${fmt(newCO)}</div>
              <div style="font-size:.72rem;color:#7c3aed;margin-top:3px">🌙 ${nights} noches</div>
            </div>
          </div>
          <div style="display:flex;gap:10px">
            <button id="dc-cancel" style="flex:1;padding:10px;border-radius:10px;border:1.5px solid var(--color-border-secondary,#e2e8f0);background:transparent;cursor:pointer;font-size:.85rem;font-weight:600;color:var(--color-text,#111)">Cancelar</button>
            <button id="dc-confirm" style="flex:1;padding:10px;border-radius:10px;border:none;background:#6366f1;color:#fff;cursor:pointer;font-size:.85rem;font-weight:700">Confirmar movimiento</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const cleanup = (result) => { overlay.remove(); resolve(result); };
      document.getElementById('dc-confirm').addEventListener('click', () => cleanup(true));
      document.getElementById('dc-cancel').addEventListener('click',  () => cleanup(false));
      overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });
      const onEsc = (e) => { if (e.key === 'Escape') { cleanup(false); document.removeEventListener('keydown', onEsc); } };
      document.addEventListener('keydown', onEsc);
      setTimeout(() => document.getElementById('dc-confirm')?.focus(), 50);
    });
  }

  _confirmResizeChange({ guestName, oldCI, oldCO, newCI, newCO, oldNights, newNights }) {
    return new Promise(resolve => {
      document.getElementById('resize-confirm-overlay')?.remove();

      const fmt = iso => {
        const [y,m,d] = iso.split('-');
        return `${d}/${m}/${y}`;
      };
      const bigger = newNights > oldNights;

      const overlay = document.createElement('div');
      overlay.id = 'resize-confirm-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;animation:overlayIn .15s ease;';

      overlay.innerHTML = `
        <div style="background:var(--color-background-primary,#fff);border-radius:16px;
          box-shadow:0 20px 60px rgba(0,0,0,.28);padding:24px;max-width:380px;width:100%;
          animation:modalIn .18s cubic-bezier(.4,0,.2,1)">
          <div style="font-size:1rem;font-weight:700;color:var(--color-text,#111);margin-bottom:4px">
            ↔️ Confirmar cambio de duración
          </div>
          <div style="font-size:.82rem;color:var(--color-text-secondary,#666);margin-bottom:16px">${guestName}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
            <div style="background:var(--color-background-secondary,#f8f9fa);border-radius:10px;padding:10px 12px">
              <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-tertiary,#999);margin-bottom:4px">Antes</div>
              <div style="font-size:.82rem;font-weight:600;color:var(--color-text,#111)">📅 ${fmt(oldCI)} → ${fmt(oldCO)}</div>
              <div style="font-size:.72rem;color:var(--color-text-3,#999);margin-top:3px">🌙 ${oldNights} noches</div>
            </div>
            <div style="background:${bigger ? '#dcfce7' : '#fef9c3'};border-radius:10px;padding:10px 12px">
              <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${bigger ? '#15803d' : '#a16207'};margin-bottom:4px">Nuevo</div>
              <div style="font-size:.82rem;font-weight:600;color:${bigger ? '#166534' : '#854d0e'}">📅 ${fmt(newCI)} → ${fmt(newCO)}</div>
              <div style="font-size:.72rem;color:${bigger ? '#16a34a' : '#ca8a04'};margin-top:3px">🌙 ${newNights} noches ${bigger ? '▲' : '▼'}</div>
            </div>
          </div>
          <div style="display:flex;gap:10px">
            <button id="rc-cancel"  style="flex:1;padding:10px;border-radius:10px;border:1.5px solid var(--color-border-secondary,#e2e8f0);background:transparent;cursor:pointer;font-size:.85rem;font-weight:600;color:var(--color-text,#111)">Cancelar</button>
            <button id="rc-confirm" style="flex:1;padding:10px;border-radius:10px;border:none;background:#6366f1;color:#fff;cursor:pointer;font-size:.85rem;font-weight:700">Confirmar</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const cleanup = (result) => { overlay.remove(); resolve(result); };
      document.getElementById('rc-confirm').addEventListener('click', () => cleanup(true));
      document.getElementById('rc-cancel').addEventListener('click',  () => cleanup(false));
      overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });
      const onEsc = (e) => { if (e.key === 'Escape') { cleanup(false); document.removeEventListener('keydown', onEsc); } };
      document.addEventListener('keydown', onEsc);
      setTimeout(() => document.getElementById('rc-confirm')?.focus(), 50);
    });
  }

  // ══════════════════════════════════════════════════
  // DISPONIBILIDAD
  // ══════════════════════════════════════════════════
  setupViewToggle() {
    let _availMode = false;
    const availBtn = document.getElementById('cal-avail-toggle');
    if (!availBtn) return;

    const filterPanel = document.createElement('div');
    filterPanel.id = 'avail-filter-panel';
    const todayStr    = localToday();
    const tomorrowStr = this._addDays(todayStr, 1);
    filterPanel.style.cssText = 'display:none;flex-direction:column;background:var(--color-surface-2,#f8f9fa);border:1px solid var(--color-border,#e5e7eb);border-radius:10px;overflow:hidden;margin-top:8px;font-size:.78rem;color:var(--color-text);';
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

    const calWrapper = document.querySelector('.cal-wrapper') ?? availBtn.closest('.cal-toolbar')?.nextElementSibling;
    if (calWrapper) calWrapper.insertAdjacentElement('beforebegin', filterPanel);
    else availBtn.parentNode.appendChild(filterPanel);

    // ── Badges de disponibilidad % ──
    const _applyPercentBadges = () => {
      const grid = document.getElementById('calendar-grid');
      if (!grid) return;
      const totalUnits = this.ctx.units.length || 1;
      const bookings   = this._lastRenderedBookings ?? [];
      const dateRange  = this._dateRange ?? [];

      const occupancyMap = new Map();
      dateRange.forEach(iso => occupancyMap.set(iso, new Set()));
      bookings.forEach(b => {
        if (b.status === 'cancelled') return;
        dateRange.forEach(iso => {
          if (b.check_in <= iso && b.check_out > iso) {
            (b.booking_units ?? []).forEach(bu => occupancyMap.get(iso)?.add(bu.unit_id));
          }
        });
      });

      // Aplicar clases a celdas
      grid.querySelectorAll('.cal-cell[data-date]').forEach(c => {
        const occ = occupancyMap.get(c.dataset.date) ?? new Set();
        if (occ.has(c.dataset.unitId)) c.classList.add('avail-occupied');
        else c.classList.add('avail-free');
      });

      // Badges en headers
      grid.querySelectorAll('.cal-day-header[data-date]').forEach(hdr => {
        const iso  = hdr.dataset.date;
        const occ  = occupancyMap.get(iso) ?? new Set();
        const free = totalUnits - occ.size;
        const pct  = Math.round((free / totalUnits) * 100);
        if (!hdr.querySelector('.avail-pct')) {
          const badge = document.createElement('div');
          badge.className = 'avail-pct';
          badge.textContent = `${pct}%`;
          badge.style.cssText = `font-size:.55rem;font-weight:700;line-height:1;color:${pct > 60 ? '#16a34a' : pct > 30 ? '#f59e0b' : '#ef4444'}`;
          hdr.appendChild(badge);
        }
      });
    };

    const _clearPercentBadges = () => {
      const grid = document.getElementById('calendar-grid');
      if (!grid) return;
      grid.querySelectorAll('.avail-free,.avail-occupied').forEach(c => c.classList.remove('avail-free','avail-occupied'));
      grid.querySelectorAll('.avail-pct').forEach(el => el.remove());
    };

    const _highlightRange = (ci, co) => {
      const grid = document.getElementById('calendar-grid');
      if (!grid) return;
      grid.querySelectorAll('.cal-cell.avail-range').forEach(c => c.classList.remove('avail-range','avail-range-start','avail-range-end'));
      if (!ci || !co) return;
      grid.querySelectorAll('.cal-cell[data-date]').forEach(c => {
        const d = c.dataset.date;
        if (d >= ci && d < co) {
          c.classList.add('avail-range');
          if (d === ci) c.classList.add('avail-range-start');
          const next = new Date(d + 'T12:00:00');
          next.setDate(next.getDate() + 1);
          if (toISODate(next) === co) c.classList.add('avail-range-end');
        }
      });
    };

    const _clearRangeHighlight = () => {
      document.getElementById('calendar-grid')
        ?.querySelectorAll('.cal-cell.avail-range,.cal-cell.avail-conflict')
        .forEach(c => c.classList.remove('avail-range','avail-range-start','avail-range-end','avail-conflict'));
    };

    const _markConflictCells = (occupiedUnitIds, ci, co) => {
      const grid = document.getElementById('calendar-grid');
      if (!grid) return;
      let d = ci;
      while (d < co) {
        occupiedUnitIds.forEach(uid => {
          const cell = grid.querySelector(`.cal-cell[data-unit-id="${uid}"][data-date="${d}"]`);
          if (cell) cell.classList.add('avail-conflict');
        });
        d = this._addDays(d, 1);
      }
    };

    const _searchAvailability = () => {
      const ci     = document.getElementById('avail-checkin')?.value;
      const co     = document.getElementById('avail-checkout')?.value;
      const guests = parseInt(document.getElementById('avail-guests')?.value ?? '2', 10);
      const results= document.getElementById('avail-results');
      if (!ci || !co || !results) return;
      if (ci >= co) {
        results.innerHTML = `<span style="color:#ef4444;font-size:.76rem">⚠️ El check-out debe ser posterior al check-in.</span>`;
        _clearRangeHighlight(); return;
      }
      _highlightRange(ci, co);
      const bookings    = this._lastRenderedBookings ?? [];
      const occupiedIds = new Set();
      bookings.forEach(b => {
        if (b.status === 'cancelled') return;
        if (b.check_in < co && b.check_out > ci) {
          (b.booking_units ?? []).forEach(bu => occupiedIds.add(bu.unit_id));
        }
      });
      // Marcar celdas de unidades ocupadas en rojo dentro del rango buscado
      _markConflictCells(occupiedIds, ci, co);
      const available = this.ctx.units.filter(u => !occupiedIds.has(u.id) && (u.max_guests ?? 0) >= guests);
      const occupied  = this.ctx.units.filter(u => occupiedIds.has(u.id));
      const tooSmall  = this.ctx.units.filter(u => !occupiedIds.has(u.id) && (u.max_guests ?? 0) < guests);
      const fmt = s => s.split('-').reverse().join('/');
      const chip = u => {
        const color = u.color ?? 'var(--color-primary)';
        return `<span title="#${u.sort_order} · ${u.name} (hasta ${u.max_guests} pers.)"
          style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:4px;
          background:${color}20;border:1px solid ${color}55;font-size:.74rem;font-weight:700;color:var(--color-text);cursor:default">
          <span style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0"></span>#${u.sort_order}
        </span>`;
      };

      if (!available.length) {
        results.style.display = 'block';
        results.innerHTML = `<span style="color:#ef4444;font-size:.76rem">😔 Sin unidades disponibles para ${guests} personas en esas fechas.</span>`;
        return;
      }
      results.style.display = 'block';
      results.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:.72rem;font-weight:600;color:#16a34a;white-space:nowrap">
            ✅ ${available.length} disponible${available.length > 1 ? 's' : ''} · ${fmt(ci)} → ${fmt(co)} · ${guests} pers.
          </span>
          ${available.map(chip).join('')}
          ${tooSmall.map(u => '<span title="#' + u.sort_order + ' · ' + u.name + ' — capacidad insuficiente (max. ' + u.max_guests + ')" style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:4px;background:#f3f4f6;border:1px solid #d1d5db;font-size:.74rem;font-weight:700;color:#9ca3af;cursor:default;text-decoration:line-through"><span style="width:7px;height:7px;border-radius:50%;background:#d1d5db;flex-shrink:0"></span>#' + u.sort_order + '</span>').join('')}
          ${occupied.map(u => '<span title="#' + u.sort_order + ' · ' + u.name + ' — ocupada" style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:4px;background:#fee2e255;border:1px solid #fca5a5;font-size:.74rem;font-weight:700;color:#ef4444;cursor:default"><span style="width:7px;height:7px;border-radius:50%;background:#ef4444;flex-shrink:0"></span>#' + u.sort_order + '</span>').join('')}
        </div>`;
    };

    availBtn.addEventListener('click', () => {
      _availMode = !_availMode;
      availBtn.textContent = _availMode ? '✕ Ocultar disponibilidad' : '👁 Disponibilidad';
      availBtn.classList.toggle('active', _availMode);
      filterPanel.style.display = _availMode ? 'flex' : 'none';
      if (_availMode) _applyPercentBadges();
      else {
        _clearPercentBadges();
        _clearRangeHighlight();
        const results = document.getElementById('avail-results');
        if (results) { results.innerHTML = ''; results.style.display = 'none'; }
      }
    });

    filterPanel.querySelector('#avail-search-btn')?.addEventListener('click', _searchAvailability);
    filterPanel.querySelectorAll('input').forEach(inp =>
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') _searchAvailability(); })
    );
  }

  // ══════════════════════════════════════════════════
  // VISTA LISTA
  // ══════════════════════════════════════════════════
  _renderListView() {
    const grid    = document.getElementById('calendar-grid');
    const today   = localToday();
    const seen    = new Set();
    const unique  = (this._lastRenderedBookings ?? []).filter(b => {
      if (seen.has(b.id)) return false;
      seen.add(b.id); return true;
    }).sort((a, b) => a.check_in.localeCompare(b.check_in));

    grid.style.gridTemplateColumns = '1fr';
    grid.style.minWidth = 'auto';
    grid.style.width    = 'auto';

    if (!unique.length) {
      grid.innerHTML = `<div class="empty-state" style="padding:40px">
        <span class="empty-state-icon">📅</span>
        <p>Sin reservas en el rango visible.</p>
      </div>`;
      return;
    }

    grid.innerHTML = unique.map(b => {
      const { color, label } = getBookingBarColor(b);
      const guest   = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : (b.block_reason ?? 'Bloqueo');
      const units   = (b.booking_units ?? []).map(bu => getUnitLabel(bu.units ?? {})).join(', ');
      const isNow   = b.check_in <= today && b.check_out > today;
      const balance = b.balance ?? 0;
      return `
        <div class="list-booking-row" data-id="${b.id}" style="display:flex;align-items:stretch;border:1px solid var(--color-border);
          border-radius:var(--r-lg);background:var(--color-surface);box-shadow:var(--sh-xs);margin-bottom:8px;overflow:hidden;cursor:pointer;
          ${isNow ? 'border-color:var(--color-primary);box-shadow:0 0 0 2px var(--color-primary-t)' : ''}">
          <div style="width:5px;background:${color};flex-shrink:0"></div>
          <div style="flex:1;padding:12px 14px;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
              <span style="font-weight:700;font-size:.92rem;color:var(--color-text)">${guest}</span>
              <span style="padding:2px 8px;border-radius:99px;font-size:.68rem;font-weight:700;background:${color}18;color:${color};border:1px solid ${color}35">${label}</span>
              ${isNow ? `<span style="padding:2px 8px;border-radius:99px;font-size:.68rem;font-weight:700;background:var(--color-primary-l);color:var(--color-primary)">HOY</span>` : ''}
            </div>
            <div style="font-size:.78rem;color:var(--color-text-2)">📅 ${formatDate(b.check_in)} → ${formatDate(b.check_out)} · 🌙 ${b.nights ?? '?'} noches</div>
            <div style="margin-top:5px;font-size:.75rem;color:var(--color-text-3)">${units}</div>
          </div>
          <div style="padding:12px 14px;text-align:right;flex-shrink:0;display:flex;flex-direction:column;justify-content:center">
            <div style="font-weight:700;font-size:.9rem">${formatARS(b.total_amount)}</div>
            <div style="font-size:.72rem;margin-top:3px;color:${balance>0?'var(--color-warning)':'var(--color-success)'};font-weight:600">
              ${balance > 0 ? `Saldo: ${formatARS(balance)}` : '✓ Saldado'}
            </div>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.list-booking-row[data-id]').forEach(row =>
      row.addEventListener('click', () => this._openDetailById(row.dataset.id))
    );
  }

  // ══════════════════════════════════════════════════
  // ACCIONES SOBRE RESERVAS
  // ══════════════════════════════════════════════════
  async _openDetailById(bookingId) {
    if (!bookingId) return;
    try {
      // Primero chequear en caché renderizada (evita round-trip a DB)
      const found = this._lastRenderedBookings?.find(b => b.id === bookingId);
      if (found && (found.status === 'blocked' || found.is_blocked)) {
        await this._openBlockModal(bookingId, found);
        return;
      }
      // Si no está en caché, consultar DB
      const { data: bk } = await this.db.from('bookings')
        .select('id, status, is_blocked, block_reason, check_in, check_out, booking_units(unit_id)')
        .eq('id', bookingId).single();
      if (bk && (bk.status === 'blocked' || bk.is_blocked)) {
        await this._openBlockModal(bookingId, bk);
        return;
      }
      await this.bookingForm.openEdit(bookingId);
    } catch (err) {
      console.error('[Calendar] _openDetailById:', err);
      showToast('Error al cargar la reserva', 'error');
    }
  }

  // ── Modal exclusivo para editar/eliminar bloqueos ──
  async _openBlockModal(bookingId, bookingData) {
    const existing = document.getElementById('overlay-block-modal');
    if (existing) existing.remove();

    const unitId   = bookingData.booking_units?.[0]?.unit_id ?? null;
    const unitObj  = this.ctx.units?.find(u => u.id === unitId);
    const unitName = unitObj ? `#${unitObj.sort_order} · ${unitObj.name}` : 'Sin unidad';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'overlay-block-modal';
    modal.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header" style="background:#fef2f2;border-bottom:1px solid #fecaca;">
          <h3 class="modal-title" style="color:#dc2626;">🔒 Bloqueo de Calendario</h3>
          <button class="modal-close" id="block-modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label style="font-size:.75rem;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.05em;">Unidad</label>
            <div style="font-weight:600;color:var(--color-text-1);padding:8px 0;">${unitName}</div>
          </div>
          <div class="form-grid-2">
            <div class="form-group">
              <label>Fecha inicio</label>
              <input type="date" id="block-checkin" value="${bookingData.check_in ?? ''}">
            </div>
            <div class="form-group">
              <label>Fecha fin</label>
              <input type="date" id="block-checkout" value="${bookingData.check_out ?? ''}">
            </div>
          </div>
          <div class="form-group">
            <label>Motivo / Nota</label>
            <input type="text" id="block-reason" value="${bookingData.block_reason ?? ''}" placeholder="Mantenimiento, uso propio, reparación...">
          </div>
        </div>
        <div class="modal-footer" style="flex-wrap:wrap;gap:8px;">
          <button class="btn btn-outline" id="block-delete-btn"
                  style="color:#dc2626;border-color:#fecaca;margin-right:auto;">🗑️ Eliminar</button>
          <button class="btn btn-outline" id="block-cancel-btn">Cancelar</button>
          <button class="btn btn-primary" id="block-save-btn">Guardar cambios</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.style.zIndex = '210';

    const close = () => {
      modal.remove();
      if (escHandler) document.removeEventListener('keydown', escHandler);
    };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
    modal.querySelector('#block-modal-close').onclick = close;
    modal.querySelector('#block-cancel-btn').onclick  = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    setTimeout(() => modal.querySelector('#block-reason')?.focus(), 80);

    // ── Guardar cambios ──
    modal.querySelector('#block-save-btn').addEventListener('click', async () => {
      const newCI     = modal.querySelector('#block-checkin').value;
      const newCO     = modal.querySelector('#block-checkout').value;
      const newReason = modal.querySelector('#block-reason').value.trim() || 'Bloqueo';
      if (!newCI || !newCO || newCI >= newCO) {
        showToast('Las fechas son inválidas', 'warning'); return;
      }
      const saveBtn = modal.querySelector('#block-save-btn');
      saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';
      try {
        const { error } = await this.db.from('bookings')
          .update({ check_in: newCI, check_out: newCO, block_reason: newReason })
          .eq('id', bookingId);
        if (error) throw error;
        // Sincronizar maintenance_issue asociado
        const { data: mi } = await this.db.from('maintenance_issues')
          .select('id').eq('booking_id', bookingId).maybeSingle();
        if (mi?.id) {
          await this.db.from('maintenance_issues')
            .update({ title: newReason, description: `Bloqueo: ${newCI} → ${newCO}` })
            .eq('id', mi.id);
        }
        showToast('Bloqueo actualizado ✓', 'success');
        cache.invalidate('bookings');
        close();
        await this.load();
      } catch (err) {
        console.error('[Calendar] Error al actualizar bloqueo:', err);
        showToast('Error al guardar: ' + (err?.message ?? String(err)), 'error');
        saveBtn.disabled = false; saveBtn.textContent = 'Guardar cambios';
      }
    });

    // ── Eliminar bloqueo ──
    modal.querySelector('#block-delete-btn').addEventListener('click', async () => {
      if (!confirm('¿Eliminar este bloqueo del calendario?')) return;
      const delBtn = modal.querySelector('#block-delete-btn');
      delBtn.disabled = true; delBtn.textContent = '⏳ Eliminando...';
      try {
        await this.db.from('maintenance_issues').delete().eq('booking_id', bookingId);
        const { error } = await this.db.from('bookings').delete().eq('id', bookingId);
        if (error) throw error;
        showToast('Bloqueo eliminado ✓', 'success');
        cache.invalidate('bookings');
        close();
        await this.load();
      } catch (err) {
        console.error('[Calendar] Error al eliminar bloqueo:', err);
        showToast('Error al eliminar: ' + (err?.message ?? String(err)), 'error');
        delBtn.disabled = false; delBtn.textContent = '🗑️ Eliminar';
      }
    });
  }

  // ── Bloquear día individual ──
  async _blockDay(unitId, dateISO) {
    const reason = prompt('Motivo del bloqueo (mantenimiento, reparación, uso propio, etc.):');
    if (!reason) return;
    const next = new Date(dateISO + 'T12:00:00');
    next.setDate(next.getDate() + 1);
    const checkOut = toISODate(next);
    try {
      const { data: bk, error } = await this.db.from('bookings').insert({
        hotel_id: this.ctx.hotelId, check_in: dateISO, check_out: checkOut,
        status: 'blocked', is_blocked: true, block_reason: reason, price_per_night: 0,
      }).select('id').single();
      if (error) throw error;
      if (bk?.id) {
        await this.db.from('booking_units').insert({ booking_id: bk.id, unit_id: unitId });
        await this._createMaintenanceForBlock(bk.id, unitId, dateISO, checkOut, reason);
      }
      showToast('Día bloqueado ✓', 'success');
      cache.invalidate('bookings');
      this.load();
    } catch (err) {
      console.error('[Calendar] _blockDay error:', err);
      showToast('Error al bloquear: ' + (err?.message ?? String(err)), 'error');
    }
  }

  // ── Crear maintenance_issue sincronizado con bloqueo ──
  async _createMaintenanceForBlock(bookingId, unitId, checkIn, checkOut, reason) {
    try {
      await this.db.from('maintenance_issues').insert({
        hotel_id:    this.ctx.hotelId,
        unit_id:     unitId,
        booking_id:  bookingId,
        title:       reason || 'Bloqueo',
        description: `Bloqueo: ${checkIn} → ${checkOut}`,
        category:    'Bloqueo calendario',
        priority:    'medium',
        status:      'pending',
      });
    } catch (err) {
      // No crítico: el bloqueo fue creado, solo loguear
      console.warn('[Calendar] No se pudo crear maintenance_issue:', err?.message ?? err);
    }
  }

  // ══════════════════════════════════════════════════
  // NOTAS DE UNIDAD
  // ══════════════════════════════════════════════════
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

  // ══════════════════════════════════════════════════
  // ELEMENTOS DE UI PERSISTENTES
  // ══════════════════════════════════════════════════
  _createTextGhost() {
    let g = document.getElementById('cal-drag-ghost');
    if (!g) {
      g = document.createElement('div');
      g.className = 'drag-ghost hidden';
      g.id = 'cal-drag-ghost';
      document.body.appendChild(g);
    }
    return g;
  }

  _createFloatInfo() {
    let el = document.getElementById('cal-drag-float-info');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cal-drag-float-info';
      el.className = 'cal-drag-float-info hidden';
      document.body.appendChild(el);
    }
    return el;
  }

  // ══════════════════════════════════════════════════
  // UTILIDADES DE FECHA
  // ══════════════════════════════════════════════════
  _addDays(isoDate, n) {
    const d = new Date(isoDate + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return localDateISO(d);
  }

  _dayDiff(isoA, isoB) {
    return Math.round((+new Date(isoB + 'T12:00:00') - +new Date(isoA + 'T12:00:00')) / 86400000);
  }

  _fmtShort(iso) {
    if (!iso) return '';
    const [,m,d] = iso.split('-');
    return `${parseInt(d)} ${MONTH_SHORT[parseInt(m)-1]}`;
  }
  // ══════════════════════════════════════════════════
  // 5. BARRA DE RESUMEN SUPERIOR
  // ══════════════════════════════════════════════════
  _renderSummaryBar(bookings) {
    // Crear solo una vez; en navegaciones subsiguientes solo actualizar el contenido
    let bar = document.getElementById('cal-summary-bar');
    if (!bar) {
      const toolbar = document.querySelector('.cal-toolbar');
      if (!toolbar) return;
      bar = document.createElement('div');
      bar.id = 'cal-summary-bar';
      toolbar.after(bar);
    }

    const today       = localToday();
    const totalUnits  = this.ctx.units?.length ?? 0;
    const occupied    = new Set();
    const checkins    = [];
    const checkouts   = [];
    const blocks      = [];

    bookings.forEach(b => {
      if (b.status === 'blocked' || b.is_blocked) {
        if (b.check_in <= today && b.check_out > today) blocks.push(b);
        return;
      }
      if (b.check_in <= today && b.check_out > today) {
        (b.booking_units ?? []).forEach(bu => occupied.add(bu.unit_id));
      }
      if (b.check_in === today) checkins.push(b);
      if (b.check_out === today) checkouts.push(b);
    });

    const occCount   = occupied.size;
    const freeCount  = Math.max(0, totalUnits - occCount - blocks.length);
    const occPct     = totalUnits > 0 ? Math.round(occCount / totalUnits * 100) : 0;

    const kpi = (icon, val, lbl, color) =>
      '<div class="cal-kpi">' +
        '<span class="cal-kpi-icon">' + icon + '</span>' +
        '<span class="cal-kpi-val" style="color:' + (color || 'var(--color-text)') + '">' + val + '</span>' +
        '<span class="cal-kpi-lbl">' + lbl + '</span>' +
      '</div>';

    bar.innerHTML =
      kpi('🏠', occCount, 'ocupadas', occCount > 0 ? '#f59e0b' : 'var(--color-text)') +
      kpi('✅', freeCount, 'disponibles', freeCount > 0 ? '#16a34a' : '#ef4444') +
      kpi('→', checkins.length, 'check-ins hoy', checkins.length > 0 ? 'var(--color-primary)' : 'var(--color-text)') +
      kpi('←', checkouts.length, 'check-outs hoy', checkouts.length > 0 ? '#7c3aed' : 'var(--color-text)') +
      (blocks.length ? kpi('🔒', blocks.length, 'bloqueados', '#94a3b8') : '') +
      kpi('📊', occPct + '%', 'ocupación', occPct >= 80 ? '#ef4444' : occPct >= 50 ? '#f59e0b' : '#16a34a');
  }

  // ══════════════════════════════════════════════════
  // 6. HEATMAP: fondo muy sutil por nivel de ocupación
  // ══════════════════════════════════════════════════
  _applyHeatmap(bookings) {
    const grid  = document.getElementById('calendar-grid');
    if (!grid) return;

    const today   = localToday();
    const future  = this._dateRange.filter(d => d >= today);
    if (!future.length) return;

    // Para cada unidad, calcular % de ocupación futura y colorear las celdas de esa fila
    this.ctx.units?.forEach(unit => {
      const cells = grid.querySelectorAll(`.cal-cell[data-unit-id="${unit.id}"]`);
      if (!cells.length) return;

      const occupied = future.filter(d =>
        bookings.some(b =>
          !b.is_blocked && b.status !== 'blocked' && b.status !== 'cancelled' &&
          (b.booking_units ?? []).some(bu => bu.unit_id === unit.id) &&
          b.check_in <= d && b.check_out > d
        )
      ).length;

      const pct = future.length > 0 ? occupied / future.length : 0;
      const heat = pct >= .85 ? 'full' : pct >= .55 ? 'high' : pct >= .30 ? 'medium' : pct > 0 ? 'low' : '';

      // Aplicar solo a celdas futuras vacías (no sobreescribir celdas con reserva)
      cells.forEach(cell => {
        const cellDate = cell.dataset.date;
        if (!cellDate || cellDate < today) return;
        if (heat && !cell.querySelector('.bar')) {
          cell.dataset.heat = heat;
        } else {
          delete cell.dataset.heat;
        }
      });
    });
  }
}