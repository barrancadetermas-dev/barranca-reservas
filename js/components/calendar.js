// ═══════════════════════════════════════════════════
// calendar.js v3.0 — Calendario Interactivo
// Sistema de colores por prioridad (estado + origen)
// Leyenda dual: estados/origen + departamentos
// Tooltips enriquecidos · Identificación unificada
// ═══════════════════════════════════════════════════

import {
  toISODate, getBookingBarColor, getUnitLabel, getUnitColor,
  getUnitChipHTML, getSourceBadgeHTML, SOURCE_CONFIG, UNIT_CATALOG,
  showToast, formatARS, formatDate, AppContext
} from '../supabase-config.js';
import { can } from '../auth/permissions.js';
import { getHolidaysForYear, isWeekend } from '../services/arg-holidays.js';
import { logAction } from '../services/audit-service.js';

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
    this._dragBound  = false;
    this._tooltip    = null;
    this._ghost      = this._createGhost();
    this._view       = 'month'; // 'month' | 'week' | 'list'
    this._weekStart  = this._getWeekStart(new Date()); // para vista semanal
    this._barDrag    = { active: false, booking: null, unitId: null, startX: 0, moved: false };

    window._calInstance = this;
    this._setupControls();
    this._setupContextMenu();
    this._setupDocumentEvents();
  }

  // ── Carga del calendario ──────────────────────────
  async load() {
    document.getElementById('cal-month-title').textContent =
      `${MONTH_NAMES[this.month]} ${this.year}`;
    try {
      const [bookings, reminders] = await Promise.all([
        this._fetchBookings(), this._fetchReminders()
      ]);
      this._lastRenderedBookings = bookings; // para drag & drop

      if (this._view === 'list') {
        this._renderListView(bookings);
      } else if (this._view === 'week') {
        this._renderWeekView(bookings);
      } else {
        const cellMap     = this._buildCellMap(bookings);
        const reminderMap = this._buildReminderMap(reminders);
        this._render(cellMap, reminderMap);
        this._renderDualLegend();
        if (!this._dragBound) {
          const grid = document.getElementById('calendar-grid');
          if (grid) { this._setupDragSelection(grid); this._setupBarDrag(grid); this._dragBound = true; }
        }
      }
    } catch (err) {
      console.error('Calendar load error:', err);
      showToast('Error al cargar el calendario', 'error');
    }
  }

  // ── Fetch reservas ────────────────────────────────
  async _fetchBookings() {
    const firstDay = `${this.year}-${String(this.month+1).padStart(2,'0')}-01`;
    const lastDay  = toISODate(new Date(this.year, this.month+1, 0));
    const { data, error } = await this.db
      .from('bookings')
      .select(`
        id, check_in, check_out, status, source, is_blocked, block_reason,
        total_amount, total_paid, balance, nights, pax, adults, children, notes,
        guests!bookings_guest_id_fkey(first_name, last_name, bad_experience, tags),
        booking_units(unit_id, units(name, sort_order, color, max_guests))
      `)
      .eq('hotel_id', this.ctx.hotelId)
      .neq('status', 'cancelled')
      .lte('check_in',  lastDay)
      .gt('check_out',  firstDay);
    if (error) throw error;
    return data ?? [];
  }

  // ── Fetch recordatorios ───────────────────────────
  async _fetchReminders() {
    const firstDay = `${this.year}-${String(this.month+1).padStart(2,'0')}-01`;
    const lastDay  = toISODate(new Date(this.year, this.month+1, 0));
    const { data } = await this.db
      .from('reminders')
      .select('*, units(name, sort_order)')
      .eq('hotel_id', this.ctx.hotelId)
      .gte('scheduled_date', firstDay)
      .lte('scheduled_date', lastDay)
      .eq('completed', false);
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
          // Usar mediodía para evitar desfases por zona horaria (Argentina UTC-3)
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
    // Precargar feriados del año actual (con cache)
    const holidays    = getHolidaysForYear(this.year);

    grid.style.gridTemplateColumns = `160px repeat(${daysInMonth}, minmax(30px, 1fr))`;
    grid.classList.add('month-grid');
    grid.classList.remove('week-grid');
    grid.innerHTML = '';

    // ── Encabezados ──
    const corner = document.createElement('div');
    corner.className = 'cal-unit-label-header';
    corner.textContent = 'Departamento';
    grid.appendChild(corner);

    for (let d = 1; d <= daysInMonth; d++) {
      const date    = new Date(this.year, this.month, d);
      const isToday = d===todayDay && this.month===todayMonth && this.year===todayYear;
      const dateISO = `${this.year}-${String(this.month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const hasRem  = !!reminderMap[dateISO];
      const dayOfWeek2 = date.getDay();
      const isWknd2    = dayOfWeek2 === 0 || dayOfWeek2 === 6;
      const isPastDay2 = dateISO < new Date().toISOString().split('T')[0];
      const holiday2   = holidays?.get ? holidays.get(dateISO) : null;
      const isHoliday2 = !!holiday2 && holiday2.type !== 'vacation';

      const dh = document.createElement('div');
      let dhCls2 = 'cal-day-header';
      if (isToday)   dhCls2 += ' today';
      if (isWknd2)   dhCls2 += ' weekend';
      if (isPastDay2 && !isToday) dhCls2 += ' past-header';
      if (isHoliday2) dhCls2 += ` holiday holiday-${holiday2.type}`;
      dh.className = dhCls2;
      dh.title = holiday2?.label ?? '';
      dh.innerHTML = `${d}<span class="day-name">${DAY_NAMES[date.getDay()]}</span>
        ${hasRem?`<div style="width:4px;height:4px;border-radius:50%;background:var(--color-warning);margin:2px auto 0"></div>`:''}
        ${isToday?`<div style="width:4px;height:4px;border-radius:50%;background:var(--color-primary);margin:1px auto 0"></div>`:''}`;
      grid.appendChild(dh);
    }

    // ── Filas de unidades ──
    this.ctx.units.forEach(unit => {
      const unitColor = getUnitColor(unit);
      const unitLabel = getUnitLabel(unit);

      // Label con identificación completa + notas
      const label = document.createElement('div');
      label.className = 'cal-unit-label';
      label.style.setProperty('--unit-color', unitColor);
      const hasNotes = !!unit.internal_notes;
      label.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px">
          <span style="width:10px;height:10px;border-radius:50%;background:${unitColor};flex-shrink:0"></span>
          <span style="font-size:.82rem;font-weight:700;color:var(--color-text)">${unitLabel}</span>
          ${hasNotes ? `<span title="${unit.internal_notes}" style="cursor:help;font-size:.85rem" onclick="window._calInstance._showUnitNote(event,'${unit.internal_notes?.replace(/'/g,"\\'") ?? ''}')">📝</span>` : ''}
          ${can('manageUnitNotes') ? `<button class="btn btn-ghost btn-xs" style="padding:1px 4px;font-size:.65rem;opacity:.5" onclick="window._calInstance.editUnitNotes('${unit.id}','${(unit.internal_notes??'').replace(/'/g,"\\'")}')">✏️</button>` : ''}
        </div>
        <span class="unit-floor" style="padding-left:16px">Hasta ${unit.max_guests} pers.</span>`;
      grid.appendChild(label);

      // Celdas de días
      for (let d = 1; d <= daysInMonth; d++) {
        const dateISO  = `${this.year}-${String(this.month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isToday  = d===todayDay && this.month===todayMonth && this.year===todayYear;
        const bookings = cellMap[unit.id]?.[d] ?? [];
        const rems     = reminderMap[dateISO] ?? [];

        const cellHoliday = holidays.get(dateISO);
        const cellIsWknd  = new Date(dateISO + 'T12:00:00').getDay() % 6 === 0;
        const cellIsPast  = dateISO < new Date().toISOString().split('T')[0];

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
          this._renderSingleBar(cell, bookings[0]);
        } else {
          const co = bookings.find(b => b._cellType === 'end');
          const ci = bookings.find(b => b._cellType === 'start');
          if (co && ci) this._renderSplitCell(cell, co, ci);
          else this._renderSingleBar(cell, bookings[0]);
        }

        // Recordatorios
        rems.forEach(r => {
          const dot = document.createElement('div');
          dot.className = 'cal-reminder-dot';
          dot.innerHTML = `<div class="tooltip">🔔 ${r.title}${r.units?` · #${r.units.sort_order} ${r.units.name}`:''}</div>`;
          cell.appendChild(dot);
        });

        grid.appendChild(cell);
      }
    });
  }

  // ── Barra única — cubre todas las noches con un solo elemento ──
  _renderSingleBar(cell, booking) {
    // Solo la celda de INICIO coloca la barra; el resto la ignoran
    // (salvo el recambio split que lo maneja _renderSplitCell)
    if (booking._cellType !== 'start' && booking._cellType !== 'solo') return;

    const { color, textColor } = getBookingBarColor(booking);
    const firstName = booking.guests?.first_name ?? '';
    const lastName  = booking.guests?.last_name  ?? '';
    const blockText = booking.block_reason ?? 'Bloqueo';
    const guestFull = booking.guests ? `${lastName} ${firstName}`.trim() : blockText;

    // Calcular cuántos días cubre dentro de este mes
    const ci = new Date(booking.check_in  + 'T12:00:00');
    const co = new Date(booking.check_out + 'T12:00:00');
    const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();

    // Primer día visible de la barra en este mes
    const startDay = Math.max(ci.getDate(), 1);
    // Último día visible: checkout es el día de salida, la barra llega hasta co-1
    const endDay   = Math.min(co.getDate() - 1, daysInMonth);
    // Si checkout cae en otro mes, la barra llega hasta fin de mes
    const coMonth  = co.getMonth();
    const coYear   = co.getFullYear();
    const isCoNextMonth = (coYear > this.year) || (coYear === this.year && coMonth > this.month);
    const lastDay  = isCoNextMonth ? daysInMonth : endDay;

    const nights = Math.max(1, lastDay - startDay + 1);

    const bar = document.createElement('div');
    bar.className = 'bar bar-span';
    bar.style.cssText = `
      background: ${color};
      position: absolute;
      top: 6px; bottom: 6px;
      left: 4px;
      width: calc(${nights} * 100% - 8px);
      z-index: 3;
      border-radius: 6px;
      display: flex; align-items: center;
      padding: 0 10px;
      overflow: hidden; white-space: nowrap;
      cursor: pointer;
      transition: filter .15s, transform .15s;
    `;
    bar.dataset.bookingId = booking.id;

    bar.innerHTML = `<span style="color:${textColor};font-size:.7rem;font-weight:700;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0">${guestFull}</span>`;

    bar.title = `${guestFull} | ${booking.check_in} → ${booking.check_out}`;

    bar.addEventListener('mouseenter', (e) => { bar.style.filter='brightness(1.12)'; bar.style.transform='scaleY(1.05)'; this._showTooltip(booking, e); });
    bar.addEventListener('mousemove',  (e) => this._moveTooltip(e));
    bar.addEventListener('mouseleave', ()  => { bar.style.filter=''; bar.style.transform=''; this._hideTooltip(); });
    bar.addEventListener('click', (e) => { e.stopPropagation(); this._openBookingDetail(booking.id); });
    bar.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this._openBookingDetail(booking.id); });

    cell.appendChild(bar);
  }

  // ── Celda dividida (RECAMBIO) ─────────────────────
  _renderSplitCell(cell, coBooking, ciBooking) {
    const coColor = getBookingBarColor(coBooking).color;
    const ciColor = getBookingBarColor(ciBooking).color;

    const left = document.createElement('div');
    left.className = 'bar bar-split-left';
    left.style.background = coColor;
    left.dataset.bookingId = coBooking.id;
    left.title = `Sale: ${coBooking.guests?.first_name ?? ''} ${coBooking.guests?.last_name ?? ''}`;
    left.addEventListener('mouseenter', (e) => this._showTooltip(coBooking, e));
    left.addEventListener('mousemove',  (e) => this._moveTooltip(e));
    left.addEventListener('mouseleave', ()  => this._hideTooltip());
    left.addEventListener('click', (e) => { e.stopPropagation(); this._openBookingDetail(coBooking.id); });

    const right = document.createElement('div');
    right.className = 'bar bar-split-right';
    right.style.background = ciColor;
    right.dataset.bookingId = ciBooking.id;
    right.title = `Entra: ${ciBooking.guests?.first_name ?? ''} ${ciBooking.guests?.last_name ?? ''}`;
    right.addEventListener('mouseenter', (e) => this._showTooltip(ciBooking, e));
    right.addEventListener('mousemove',  (e) => this._moveTooltip(e));
    right.addEventListener('mouseleave', ()  => this._hideTooltip());
    right.addEventListener('click', (e) => { e.stopPropagation(); this._openBookingDetail(ciBooking.id); });

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

  // ── LEYENDA DUAL ──────────────────────────────────
  _renderDualLegend() {
    const container = document.getElementById('cal-legend-container');
    if (!container) return;

    // Sección 1: Estados base
    const statusItems = [
      { color: '#EAB308', label: 'Sin seña (directo)' },
      { color: '#DC2626', label: 'Con seña / depósito' },
      { color: '#16A34A', label: 'Pagado' },
      { color: '#374151', label: 'Bloqueo / No disponible' },
    ];

    // Sección 2: Canales de reserva (todos desde SOURCE_CONFIG)
    const channelItems = Object.entries(SOURCE_CONFIG)
      .filter(([k]) => k !== 'direct')
      .map(([, cfg]) => ({ color: cfg.dot ?? cfg.color ?? '#64748b', label: cfg.label }));

    // Sección 2: Departamentos
    const unitItems = this.ctx.units.map(u => ({
      color: getUnitColor(u),
      label: getUnitLabel(u),
    }));

    container.innerHTML = `
      <div class="cal-legend-wrapper">
        <div class="cal-legend-section">
          <div class="cal-legend-title">Estado</div>
          ${statusItems.map(i => `
            <div class="legend-item">
              <div class="legend-swatch" style="background:${i.color}"></div>
              <span>${i.label}</span>
            </div>`).join('')}
        </div>
        <div class="cal-legend-section">
          <div class="cal-legend-title">Canales</div>
          ${channelItems.map(i => `
            <div class="legend-item">
              <div class="legend-swatch" style="background:${i.color}"></div>
              <span>${i.label}</span>
            </div>`).join('')}
        </div>
        <div class="cal-legend-section">
          <div class="cal-legend-title">Departamentos</div>
          ${unitItems.map(i => `
            <div class="legend-item">
              <div class="legend-swatch-circle" style="background:${i.color}"></div>
              <span style="color:${i.color};font-weight:700">${i.label}</span>
            </div>`).join('')}
        </div>
        <div class="cal-legend-section">
          <div class="cal-legend-title">Calendario</div>
          <div class="legend-item"><div class="legend-swatch" style="background:rgba(99,102,241,.15);border:1px solid #6366f1"></div><span>Fin de semana</span></div>
          <div class="legend-item"><div class="legend-swatch" style="background:rgba(239,68,68,.12);border:1px solid #ef4444"></div><span>Feriado nacional</span></div>
          <div class="legend-item"><div class="legend-swatch" style="background:rgba(168,85,247,.10);border:1px solid #a855f7"></div><span>Puente turístico*</span></div>
          <div class="legend-item"><div class="legend-swatch" style="background:rgba(20,184,166,.10);border:1px solid #14b8a6"></div><span>Vacaciones invierno</span></div>
        </div>
      </div>`;
  }

  // ── Drag selection ────────────────────────────────
  _setupDragSelection(grid) {
    let startUnit = null, startDate = null, endDate = null;

    grid.addEventListener('mousedown', (e) => {
      const cell = e.target.closest('.cal-cell');
      if (!cell || cell.querySelectorAll('.bar').length > 0) return;
      startUnit  = cell.dataset.unitId;
      startDate  = cell.dataset.date;
      this._drag = { active: true, unitId: startUnit, startDay: parseInt(cell.dataset.day), moved: false };
      cell.classList.add('selecting');
      e.preventDefault();
    });

    grid.addEventListener('mousemove', (e) => {
      if (!this._drag.active) return;
      const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.cal-cell');
      if (!cell || cell.dataset.unitId !== startUnit) return;
      this._drag.moved = true;
      endDate = cell.dataset.date;

      if (startDate && endDate) {
        const d1 = new Date(Math.min(new Date(startDate), new Date(endDate)));
        const d2 = new Date(Math.max(new Date(startDate), new Date(endDate)));
        const nights = Math.round((d2-d1)/86400000)+1;
        this._ghost.textContent = `${d1.toLocaleDateString('es-AR',{day:'2-digit',month:'short'})} → ${d2.toLocaleDateString('es-AR',{day:'2-digit',month:'short'})} · ${nights} noche${nights!==1?'s':''}`;
        this._ghost.style.left = `${e.clientX}px`;
        this._ghost.style.top  = `${e.clientY}px`;
        this._ghost.classList.remove('hidden');
      }

      grid.querySelectorAll('.cal-cell.selecting').forEach(c => c.classList.remove('selecting'));
      const sd = this._drag.startDay, ed = parseInt(cell.dataset.day);
      const [mn, mx] = [Math.min(sd,ed), Math.max(sd,ed)];
      grid.querySelectorAll(`.cal-cell[data-unit-id="${startUnit}"]`).forEach(c => {
        if (parseInt(c.dataset.day) >= mn && parseInt(c.dataset.day) <= mx) c.classList.add('selecting');
      });
    });

    grid.addEventListener('mouseup', () => {
      if (!this._drag.active) return;
      const hadDrag = this._drag.moved;
      grid.querySelectorAll('.cal-cell.selecting').forEach(c => c.classList.remove('selecting'));
      this._drag.active = false;
      this._ghost.classList.add('hidden');

      if (hadDrag && startDate && endDate) {
        const dates = [startDate, endDate].sort();
        const last  = new Date(dates[1]+'T12:00:00');
        last.setDate(last.getDate()+1);
        this.bookingForm.open({ unitId: startUnit, checkIn: dates[0], checkOut: toISODate(last) });
      }
      startUnit = null; startDate = null; endDate = null;
    });
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

    // ── Ocultar / mostrar días pasados ──
    this._hidePast = false;
    document.getElementById('cal-hide-past-btn')?.addEventListener('click', () => {
      this._hidePast = !this._hidePast;
      const grid = document.getElementById('calendar-grid');
      const btn  = document.getElementById('cal-hide-past-btn');
      if (this._hidePast) {
        grid?.classList.add('cal-hide-past');
        if (btn) { btn.textContent = '▶ Mostrar pasados'; btn.classList.add('btn-primary'); btn.classList.remove('btn-outline'); }
      } else {
        grid?.classList.remove('cal-hide-past');
        if (btn) { btn.textContent = '◀ Ocultar pasados'; btn.classList.remove('btn-primary'); btn.classList.add('btn-outline'); }
      }
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
  async _openBookingDetail(bookingId) {
    const { data: booking } = await this.db
      .from('bookings')
      .select('*, guests!bookings_guest_id_fkey(*), booking_units(unit_id, units(name,sort_order,color,max_guests)), payments(*)')
      .eq('id', bookingId).single();
    if (booking) this.bookingForm.openDetail(booking);
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
    const g = document.createElement('div');
    g.className = 'drag-ghost hidden'; g.id = 'cal-drag-ghost';
    document.body.appendChild(g);
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

  // ── Vista Lista — mobile-friendly (#17) ──────────
  _renderListView(bookings) {
    const grid      = document.getElementById('calendar-grid');
    const today     = new Date().toISOString().split('T')[0];
    const container = document.getElementById('cal-legend-container');
    if (container) container.innerHTML = '';

    grid.style.gridTemplateColumns = '1fr';
    grid.style.minWidth = 'auto';

    // Deduplicar y ordenar por check-in
    const seen = new Set();
    const unique = bookings.filter(b => {
      if (seen.has(b.id)) return false;
      seen.add(b.id); return true;
    }).sort((a, b) => a.check_in.localeCompare(b.check_in));

    if (!unique.length) {
      grid.innerHTML = `<div class="empty-state" style="padding:40px">
        <span class="empty-state-icon">📅</span>
        <p>Sin reservas en ${MONTH_NAMES[this.month]} ${this.year}.</p>
        <p style="font-size:.8rem;color:var(--color-text-3);margin-top:8px">
          Usá ← → para navegar entre meses.
        </p>
      </div>`;
      this._renderDualLegend();
      return;
    }

    grid.innerHTML = unique.map(b => {
      const { color, label } = getBookingBarColor(b);
      const guest   = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : (b.block_reason ?? 'Bloqueo');
      const units   = (b.booking_units ?? []).map(bu => getUnitLabel(bu.units ?? {})).join(', ');
      const isToday = b.check_in === today || (b.check_in < today && b.check_out > today);
      const balance = b.balance ?? 0;

      return `
        <div style="display:flex;align-items:stretch;border:1px solid var(--color-border);
          border-radius:var(--r-lg);background:var(--color-surface);
          box-shadow:var(--sh-xs);margin-bottom:8px;overflow:hidden;
          ${isToday ? 'border-color:var(--color-primary);box-shadow:0 0 0 2px var(--color-primary-t)' : ''}
          cursor:pointer"
          onclick="window._calInstance._openDetailById('${b.id}')">
          <!-- Franja de color -->
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

    // Bind click events en la lista
    grid.querySelectorAll('.list-booking-row[data-id]').forEach(row => {
      row.addEventListener('click', () => this._openDetailById(row.dataset.id));
    });

    // Renderizar leyenda también en vista lista
    this._renderDualLegend();
  }

  async _openDetailById(bookingId) {
    const { data: booking } = await this.db
      .from('bookings')
      .select('*, guests!bookings_guest_id_fkey(*), booking_units(unit_id, units(name,sort_order,color,max_guests)), payments(*)')
      .eq('id', bookingId).single();
    if (booking) this.bookingForm.openDetail(booking);
  }

  // ── Notas de unidad (#16) ─────────────────────────
  _showUnitNote(e, note) {
    e.stopPropagation();
    // Mostrar como tooltip temporal
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
    if (newNote === null) return; // cancelado
    this.db.from('units').update({ internal_notes: newNote.trim() || null }).eq('id', unitId)
      .then(async ({ error }) => {
        if (error) { showToast('Error al guardar nota', 'error'); return; }
        showToast('Nota guardada ✓', 'success');
        // Actualizar en AppContext
        const unit = AppContext.units.find(u => u.id === unitId);
        if (unit) unit.internal_notes = newNote.trim() || null;
        this.load();
      });
  }

  // ── Setup toggle Mes/Lista ─────────────────────────
  setupViewToggle() {
    document.getElementById('cal-view-toggle')?.addEventListener('click', () => {
      const views = ['month', 'week', 'list'];
      const idx   = views.indexOf(this._view);
      this._view  = views[(idx + 1) % views.length];
      const labels = { month: '☰ Lista', week: '📅 Mes', list: '📆 Semana' };
      const btn = document.getElementById('cal-view-toggle');
      if (btn) btn.textContent = labels[this._view];
      this._dragBound = false;
      if (this._view !== 'week') {
        const now = new Date(); this.month = now.getMonth(); this.year = now.getFullYear();
      }
      this.load();
    });
  }

  // ── Vista Semanal (#11) ───────────────────────────
  _getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = (day === 0) ? -6 : 1 - day; // adjust to Monday
    d.setDate(d.getDate() + diff);
    d.setHours(0,0,0,0);
    return d;
  }

  _renderWeekView(bookings) {
    const grid    = document.getElementById('calendar-grid');
    const legend  = document.getElementById('cal-legend-container');
    // (no limpiar leyenda — se re-renderiza al final)
    if (!this._weekStart) this._weekStart = this._getWeekStart(new Date());

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(this._weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });

    const today = new Date().toISOString().split('T')[0];
    grid.style.gridTemplateColumns = `160px repeat(7, 1fr)`;
    grid.style.minWidth = '600px';
    grid.classList.add('week-grid');
    grid.classList.remove('month-grid');
    grid.innerHTML = '';

    // Header días
    const corner = document.createElement('div');
    corner.className = 'cal-unit-label-header';
    const weekStr = `${days[0].toLocaleDateString('es-AR',{day:'2-digit',month:'short'})} — ${days[6].toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'})}`;
    corner.innerHTML = `<span style="font-size:.72rem;color:var(--color-text-3)">${weekStr}</span>`;
    grid.appendChild(corner);

    // Cargar feriados para el año de la semana
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
      dh.innerHTML = `<span class="dh-num">${d.getDate()}</span>
        <span class="day-name">${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getDay()]}</span>
        ${holiday ? '<span class="dh-dot"></span>' : ''}`;
      grid.appendChild(dh);
    });

    // Filas por unidad
    this.ctx.units.forEach(unit => {
      const unitColor = getUnitColor(unit);
      const unitLabel = getUnitLabel(unit);
      const label = document.createElement('div');
      label.className = 'cal-unit-label';
      label.style.setProperty('--unit-color', unitColor);
      label.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px">
          <span style="width:10px;height:10px;border-radius:50%;background:${unitColor};flex-shrink:0"></span>
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
        const wcDow   = d.getDay();
        const wcIsWknd = wcDow === 0 || wcDow === 6;
        const wcIsPast = iso < today && !isToday;
        let wcCls = 'cal-cell week-cell';
        if (isToday)   wcCls += ' today-col';
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
          const guest = b.guests ? `${b.guests.first_name} ${b.guests.last_name}` : (b.block_reason ?? 'Bloqueo');
          const isStart = b.check_in  === iso;
          const isEnd   = new Date(b.check_out + 'T12:00:00').setDate(new Date(b.check_out + 'T12:00:00').getDate() - 1) === d.setHours(12,0,0,0);
          cell.innerHTML = `
            <div style="background:${color};border-radius:${isStart?'6px 0 0 6px':'0'};
              height:32px;display:flex;align-items:center;padding:0 6px;cursor:pointer"
              onclick="window._calInstance._openDetailById('${b.id}')">
              ${isStart ? `<span style="color:${textColor};font-size:.68rem;font-weight:700;
                overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${guest}</span>` : ''}
            </div>`;
          cell.addEventListener('mouseenter', (e) => this._showTooltip(b, e));
          cell.addEventListener('mousemove',  (e) => this._moveTooltip(e));
          cell.addEventListener('mouseleave', ()  => this._hideTooltip());
        }
        grid.appendChild(cell);
      });
    });

    // Leyenda también en vista semana
    this._renderDualLegend();
    // Navegación semana en controles existentes
    document.getElementById('cal-month-title').textContent = weekStr;
  }

  // ── Drag & Drop de reservas (#13) ─────────────────
  _setupBarDrag(grid) {
    // Manejamos el drag a nivel de documento para no perder el mouse
    const onMouseMove = (e) => {
      if (!this._barDrag.active) return;
      const dx = Math.abs(e.clientX - this._barDrag.startX);
      if (dx > 8) this._barDrag.moved = true;
      if (!this._barDrag.moved) return;

      // Calcular desplazamiento en días
      const dayWidth = grid.offsetWidth / new Date(this.year, this.month+1, 0).getDate();
      const daysDiff = Math.round((e.clientX - this._barDrag.startX) / dayWidth);
      const b        = this._barDrag.booking;
      const newCI    = this._addDays(b.check_in, daysDiff);
      const newCO    = this._addDays(b.check_out, daysDiff);

      // Actualizar ghost
      this._ghost.textContent = `${newCI} → ${newCO}`;
      this._ghost.style.left  = `${e.clientX + 16}px`;
      this._ghost.style.top   = `${e.clientY - 20}px`;
      this._ghost.classList.remove('hidden');
    };

    const onMouseUp = async (e) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      this._ghost.classList.add('hidden');

      if (!this._barDrag.active) return;

      // Capturar TODO antes de resetear el estado
      const { moved, booking, unitId, startX } = { ...this._barDrag };
      this._barDrag = { active: false, booking: null, unitId: null, startX: 0, moved: false };

      if (!moved || !booking) {
        if (booking) await this._openDetailById(booking.id);
        return;
      }

      const dayWidth = grid.offsetWidth / new Date(this.year, this.month+1, 0).getDate();
      const daysDiff = Math.round((e.clientX - startX) / dayWidth);   // usar startX capturado
      if (daysDiff === 0) return;

      const newCI = this._addDays(booking.check_in,  daysDiff);
      const newCO = this._addDays(booking.check_out, daysDiff);
      const today = new Date().toISOString().split('T')[0];

      if (newCI < today && !confirm(`La nueva fecha (${newCI}) es en el pasado. ¿Continuar?`)) return;

      const resolvedUnitId = unitId ?? booking.booking_units?.[0]?.unit_id;

      const { data: conflicts } = await this.db
        .from('booking_units')
        .select('unit_id, bookings!inner(id, check_in, check_out, status)')
        .eq('unit_id', resolvedUnitId)
        .neq('bookings.status', 'cancelled')
        .neq('bookings.id', booking.id)
        .lt('bookings.check_in', newCO)
        .gt('bookings.check_out', newCI);

      if (conflicts?.length) {
        showToast('⚠️ Conflicto: hay otra reserva en esas fechas', 'error');
        this.load(); // re-render para deshacer el ghost visual
        return;
      }

      const { error } = await this.db.from('bookings')
        .update({ check_in: newCI, check_out: newCO }).eq('id', booking.id);

      if (error) { showToast('Error al mover la reserva', 'error'); return; }
      showToast(`✓ Movida a ${newCI} → ${newCO}`, 'success');
      logAction('UPDATE','booking',booking.id,
        `Fechas movidas ${daysDiff>0?'+':''}${daysDiff}d: ${booking.check_in}→${newCI}`);
      this.load();
    };

    // ── Mouse + Touch drag en barras ──────────────────
    const startDrag = (clientX, bar, e) => {
      const cell = bar.closest('.cal-cell');
      e?.preventDefault();
      bar.style.cursor = 'grabbing';

      this._barDrag = {
        active: true, booking: null,
        unitId: cell?.dataset.unitId ?? null,
        startX: clientX, moved: false,
      };
      const bookingId = bar.dataset.bookingId;
      this._lastRenderedBookings?.forEach(b => { if (b.id === bookingId) this._barDrag.booking = b; });
      if (!this._barDrag.booking) {
        this.db.from('bookings').select('id,check_in,check_out,nights,guests(first_name,last_name),booking_units(unit_id)')
          .eq('id', bookingId).single()
          .then(({ data }) => { if (data) this._barDrag.booking = data; });
      }
    };

    grid.addEventListener('touchstart', (e) => {
      const bar = e.target.closest('.bar');
      if (!bar || !bar.dataset.bookingId) return;
      startDrag(e.touches[0].clientX, bar, e);
      const onTouchMove = (te) => {
        if (!this._barDrag.active) return;
        const dx = Math.abs(te.touches[0].clientX - this._barDrag.startX);
        if (dx > 8) this._barDrag.moved = true;
        if (!this._barDrag.moved) return;
        const dayWidth = grid.offsetWidth / new Date(this.year, this.month+1, 0).getDate();
        const daysDiff = Math.round((te.touches[0].clientX - this._barDrag.startX) / dayWidth);
        const b = this._barDrag.booking;
        if (b) {
          this._ghost.textContent = `${this._addDays(b.check_in, daysDiff)} → ${this._addDays(b.check_out, daysDiff)}`;
          this._ghost.style.left = `${te.touches[0].clientX + 12}px`;
          this._ghost.style.top  = `${te.touches[0].clientY - 40}px`;
          this._ghost.classList.remove('hidden');
        }
      };
      const onTouchEnd = (te) => {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        this._ghost.classList.add('hidden');
        onMouseUp({ clientX: te.changedTouches[0].clientX });
      };
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
    }, { passive: false });

    // Interceptar mousedown en barras — diferenciando drag vs click
    grid.addEventListener('mousedown', (e) => {
      const bar = e.target.closest('.bar');
      if (!bar || !bar.dataset.bookingId) return;
      const cell = bar.closest('.cal-cell');
      e.preventDefault();

      this._barDrag = {
        active:    true,
        booking:   null,
        unitId:    cell?.dataset.unitId ?? null,
        startX:    e.clientX,
        moved:     false,
      };

      // Cargar el booking del bar
      const bookingId = bar.dataset.bookingId;
      // Buscar en el cellMap en memoria
      this._lastRenderedBookings?.forEach(b => {
        if (b.id === bookingId) this._barDrag.booking = b;
      });
      if (!this._barDrag.booking) {
        this.db.from('bookings').select('id,check_in,check_out,nights,guests(first_name,last_name),booking_units(unit_id)')
          .eq('id', bookingId).single()
          .then(({ data }) => { if (data) this._barDrag.booking = data; });
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup',   onMouseUp);
    });
  }

  _addDays(isoDate, n) {
    const d = new Date(isoDate + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
  }
}
