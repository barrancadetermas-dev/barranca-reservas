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
import { fetchMonthlyRates, fetchCustomColumns, monthsInRange, buildTariffGrid, groupRowsByPrice, getSuggestedNightlyPrices } from '../services/tariff-service.js';
import { createQuote, updateQuote, markQuoteConverted, fetchOverlappingQuotes, fetchOverlappingBookings, fetchAvailableUnitsForNight } from '../services/quote-service.js';

const DAY_NAMES   = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MONTH_SHORT = ['Ene','Feb','Mar','Abr','May','Jun',
                     'Jul','Ago','Sep','Oct','Nov','Dic'];

// ── Días previos a HOY que siempre se muestran ──
const PAST_OFFSET = 3;    // desktop: 3 días antes de hoy
// ── Ancho mínimo de columna (px) ──
const CELL_W_DESK = 38;
const CELL_W_MOB  = 32;
// ── Ancho de la columna de labels (dinámico — ver _measureLabelW) ──
const LABEL_W_MIN     = 90;
const LABEL_W_MAX     = 200;
const LABEL_W_MIN_MOB = 80;
const LABEL_W_MAX_MOB = 140;
// ── Días pasados visibles en mobile ──
const PAST_OFFSET_MOB = 1; // mobile: solo 1 día antes de hoy

export class Calendar {
  constructor(supabase, ctx, bookingForm) {
    this.db          = supabase;
    this.ctx         = ctx;
    this.bookingForm = bookingForm;

    // ── Vista continua ──────────────────────────
    const isMobInit    = window.innerWidth <= 768;
    this._windowStart  = this._addDays(localToday(), -(isMobInit ? PAST_OFFSET_MOB : PAST_OFFSET));
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
    this._rangeAnnotations = JSON.parse(localStorage.getItem('cal_range_annot') ?? '[]');
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

      const [bookings, reminders, cancelledNC, earlyDepartures] = await Promise.all([
        this._fetchBookings(this._windowStart, lastISO),
        this._fetchReminders(this._windowStart, lastISO).catch(err => {
          console.warn('[Calendar] reminders fetch failed:', err?.message ?? err);
          return [];
        }),
        this._fetchCancelledWithOpenNC(this._windowStart, lastISO).catch(err => {
          console.warn('[Calendar] cancelledNC fetch failed:', err?.message ?? err);
          return [];
        }),
        this._fetchEarlyDepartures(this._windowStart, lastISO).catch(err => {
          console.warn('[Calendar] earlyDepartures fetch failed:', err?.message ?? err);
          return [];
        }),
      ]);

      // Guardar snapshot para uso offline
      if (navigator.onLine && bookings?.length) {
        try {
          const { saveSnapshot } = await import('../services/offline-store.js');
          await saveSnapshot('bookings', bookings);
          await saveSnapshot('bookings-range', { start: this._windowStart, end: lastISO });
        } catch {}
      }

      this._lastRenderedBookings = bookings;
      const cellMap     = this._buildCellMap(bookings);
      const reminderMap = this._buildReminderMap(reminders);
      const ncPendingDays = this._buildNcPendingDays(bookings, cancelledNC);
      const earlyDepartureDays = this._buildEarlyDepartureDays(bookings, earlyDepartures);
      this._render(cellMap, reminderMap, ncPendingDays, earlyDepartureDays);

      // ── 5. Períodos etiquetados (se renderizan sobre los headers) ──
      this._renderPeriods();

      // ── 6. Barra de resumen superior ──
      this._renderRangeAnnotations();
      this._renderSummaryBar(bookings);

      // ── 6. Heatmap por fila (muy sutil) ──
      this._applyHeatmap(bookings);

      // ── 7. Mini agenda debajo del calendario ──
      this._renderMiniAgenda(bookings);

      // ── 7b. Cuadro tarifario (solo PC) ──
      if (window.innerWidth > 768) this._renderTariffTable();

      // Bindear eventos de drag/resize una vez por sesión de grid
      if (!this._periodModeReady) {
          this._periodModeReady = true;
          this._setupPeriodMode();
        }
      if (!this._barDragAbort) {
        const grid = document.getElementById('calendar-grid');
        if (grid) {
          this._setupDragSelection(grid);
          this._setupRangeSelector(grid);
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
    const labelW  = this._measureLabelW(isMob);
    const natural = Math.max(14, Math.min(120, Math.floor((w - labelW) / cellW)));
    // Desktop: limitar a 35 días (3 atrás + hoy + 31 adelante) solo cuando
    // la pantalla mostraría más — en pantallas chicas el natural ya es menor.
    // Mobile: sin cambios, usa el natural.
    const MAX_DESK = PAST_OFFSET + 32; // 3 + 32 = 35
    return isMob ? natural : Math.min(natural, MAX_DESK);
  }

  // ── Actualizar título ────────────────────────────
  _updateTitle() {
    const first = this._dateRange[0];
    const last  = this._dateRange[this._dateRange.length - 1] ?? first;
    const dF    = new Date(first + 'T12:00:00');
    const dL    = new Date(last  + 'T12:00:00');
    const el    = document.getElementById('cal-month-title');

    if (el) {
      // Si el rango está en el mismo mes: "Junio 2026"
      // Si cruza meses: "Jun – Jul 2026" o "Dic 2025 – Ene 2026"
      const MONTHS_FULL  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      const MONTHS_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      if (dF.getMonth() === dL.getMonth() && dF.getFullYear() === dL.getFullYear()) {
        el.textContent = MONTHS_FULL[dF.getMonth()] + ' ' + dF.getFullYear();
      } else if (dF.getFullYear() === dL.getFullYear()) {
        el.textContent = MONTHS_SHORT[dF.getMonth()] + ' – ' + MONTHS_SHORT[dL.getMonth()] + ' ' + dF.getFullYear();
      } else {
        el.textContent = MONTHS_SHORT[dF.getMonth()] + ' ' + dF.getFullYear() + ' – ' + MONTHS_SHORT[dL.getMonth()] + ' ' + dL.getFullYear();
      }
    }

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
    // Si no hay conexión, intentar con el snapshot guardado
    if (!navigator.onLine) {
      try {
        const { loadSnapshot } = await import('../services/offline-store.js');
        const snap = await loadSnapshot('bookings');
        if (snap?.data?.length) {
          console.info('[Calendar] Offline — usando snapshot guardado');
          // Filtrar por rango visible
          return snap.data.filter(b =>
            b.check_in <= lastDay && b.check_out > firstDay
          );
        }
      } catch {}
      return [];
    }

    const params = { hotelId: this.ctx.hotelId, firstDay, lastDay };
    const selectFull = `
        id, check_in, check_out, status, source, is_blocked, block_reason,
        late_checkout, late_checkout_charged, free_nights, discount_pct, surcharge_amount,
        total_amount, total_paid, balance, nights, pax,
        adults, children, notes, price_per_night, created_at,
        checked_in_at, checked_out_at,
        guests!bookings_guest_id_fkey(first_name, last_name, bad_experience, tags),
        booking_units(unit_id, price_per_night, segment_check_in, segment_check_out, units(name, sort_order, color, max_guests))
      `;
    // Fallback si todavía no se corrió la migración de "estadía dividida"
    // (columnas segment_check_in/segment_check_out) — sin esto, el
    // calendario entero dejaba de renderizar ante cualquier error de la
    // consulta principal.
    const selectBasic = `
        id, check_in, check_out, status, source, is_blocked, block_reason,
        late_checkout, late_checkout_charged, free_nights, discount_pct, surcharge_amount,
        total_amount, total_paid, balance, nights, pax,
        adults, children, notes, price_per_night, created_at,
        checked_in_at, checked_out_at,
        guests!bookings_guest_id_fkey(first_name, last_name, bad_experience, tags),
        booking_units(unit_id, price_per_night, units(name, sort_order, color, max_guests))
      `;
    let bookings;
    try {
      bookings = await cachedQuery(this.db, 'bookings', params, () =>
        this.db.from('bookings').select(selectFull)
          .eq('hotel_id', this.ctx.hotelId)
          .neq('status', 'cancelled')
          .lte('check_in', lastDay)
          .gt('check_out', firstDay)
      );
    } catch (err) {
      console.warn('[Calendar] Falta correr migration_quick_quotes.sql (segment_check_in/out) — usando consulta sin estadía dividida:', err?.message ?? err);
      bookings = await cachedQuery(this.db, 'bookings', params, () =>
        this.db.from('bookings').select(selectBasic)
          .eq('hotel_id', this.ctx.hotelId)
          .neq('status', 'cancelled')
          .lte('check_in', lastDay)
          .gt('check_out', firstDay)
      );
    }

    // Pagos en consulta SEPARADA — evita el bug de duplicación por Cartesian
    // join (booking_units × payments) y permite el desglose real por unidad.
    const ids = (bookings ?? []).map(b => b.id);
    if (ids.length) {
      const payParams = { hotelId: this.ctx.hotelId, ids: ids.slice().sort().join(',') };
      const payments = await cachedQuery(this.db, 'payments_for_bookings', payParams, () =>
        this.db.from('payments').select('booking_id, amount, unit_id').in('booking_id', ids)
      );
      const byBooking = {};
      (payments ?? []).forEach(p => { (byBooking[p.booking_id] ??= []).push(p); });
      bookings.forEach(b => { b.payments = byBooking[b.id] ?? []; });
    }

    return bookings;
  }

  // Reservas canceladas ("No vino" / Reprogramar) que dejaron una Nota de
  // Crédito todavía sin usar ni anular — mismo tag 🔄NC:<monto>:<fecha>
  // que usan guests.js y mila-data.js.
  // Para cada unidad, TODAS las fechas de checkout (pasadas y futuras) —
  // antes solo se traían las <= hoy, entonces si una unidad tenía una
  // reserva FUTURA con checkout antes de la celda que estás mirando, se
  // ignoraba y el tooltip mostraba el último checkout REAL (a veces 40+
  // días atrás) en vez del más cercano a esa celda puntual. Ahora se
  // guardan todas, y en el momento de pintar cada celda se busca la más
  // reciente anterior a ESA celda específica (ver _render).
  async _fetchLastCheckoutByUnit() {
    const { data, error } = await this.db
      .from('bookings')
      .select('check_out, booking_units(unit_id)')
      .eq('hotel_id', this.ctx.hotelId)
      .not('status', 'in', '(cancelled,blocked)');
    if (error) { console.warn('[Calendar] lastCheckoutByUnit error:', error.message); return new Map(); }

    const byUnit = new Map(); // unitId -> [fechas de checkout, sin ordenar todavía]
    (data ?? []).forEach(b => {
      (b.booking_units ?? []).forEach(bu => {
        if (!byUnit.has(bu.unit_id)) byUnit.set(bu.unit_id, []);
        byUnit.get(bu.unit_id).push(b.check_out);
      });
    });
    byUnit.forEach(dates => dates.sort());
    return byUnit;
  }

  // Busca, dentro de la lista de checkouts de una unidad, el más reciente
  // que sea ANTERIOR a la fecha de la celda puntual que se está pintando
  // (no simplemente "el último de todos" ni "el último hasta hoy").
  _lastCheckoutBefore(dates, iso) {
    let last = null;
    for (const d of dates) {
      if (d < iso) last = d; else break; // dates ya viene ordenado, se puede cortar apenas se pasa
    }
    return last;
  }

  async _fetchCancelledWithOpenNC(firstDay, lastDay) {
    // Antes filtraba por notas ('%🔄NC:%') directo en la consulta — daba
    // 0 resultados siempre, aunque la reserva sí tuviera el tag guardado.
    // Probablemente un problema de cómo el emoji se codifica en el filtro
    // LIKE de PostgREST. Se saca ese filtro de la consulta y se hace en
    // JS después de traer los datos — mismo patrón que ya funciona bien
    // en fetchNotasCreditoAbiertas() (mila-data.js).
    const { data, error } = await this.db
      .from('bookings')
      .select('id, check_in, check_out, notes, booking_units(unit_id), guests!bookings_guest_id_fkey(first_name, last_name)')
      .eq('hotel_id', this.ctx.hotelId)
      .eq('status', 'cancelled')
      .lte('check_in', lastDay)
      .gt('check_out', firstDay);
    if (error) { console.warn('[Calendar] cancelledNC fetch error:', error.message); return []; }
    return (data ?? []).filter(b =>
      b.notes?.includes('🔄NC:') && !b.notes?.includes('✅NCUSED') && !b.notes?.includes('❌NCVOID')
    );
  }

  // Para cada unidad+día que pertenecía a una reserva cancelada con NC
  // abierta, revisa si una reserva ACTIVA ya "pisó" ese día en esa misma
  // unidad. Si nadie lo pisó todavía, esa noche queda marcada como
  // "pendiente de NC" (se pinta marrón) — apenas alguien reserva esas
  // fechas, deja de marcarse solo, porque ya hay una reserva real ahí.
  _buildNcPendingDays(activeBookings, cancelledNC) {
    const pending = new Map(); // `${unitId}|${iso}` -> nombre del huésped
    cancelledNC.forEach(cb => {
      const unitIds = (cb.booking_units ?? []).map(bu => bu.unit_id);
      const guestName = cb.guests ? `${cb.guests.first_name ?? ''} ${cb.guests.last_name ?? ''}`.trim() : '';
      for (let d = cb.check_in; d < cb.check_out; d = this._addDays(d, 1)) {
        unitIds.forEach(unitId => {
          const covered = activeBookings.some(b =>
            b.check_in <= d && b.check_out > d &&
            (b.booking_units ?? []).some(bu => bu.unit_id === unitId)
          );
          if (!covered) pending.set(`${unitId}|${d}`, guestName);
        });
      }
    });
    return pending;
  }

  // Reservas ACTIVAS (no canceladas) que tuvieron una salida anticipada
  // — se detectan por el tag 🚪ANTICIPADO:<fecha original> en las notas.
  // Mismo criterio que con las notas de crédito: no se filtra por texto
  // en la consulta a la base (el emoji dio problemas antes), se trae un
  // rango amplio y se filtra acá en JS.
  async _fetchEarlyDepartures(firstDay, lastDay) {
    const { data, error } = await this.db
      .from('bookings')
      .select('id, check_out, notes, booking_units(unit_id), guests!bookings_guest_id_fkey(first_name, last_name)')
      .eq('hotel_id', this.ctx.hotelId)
      .not('status', 'in', '(cancelled,blocked)')
      .lte('check_out', lastDay);
    if (error) { console.warn('[Calendar] earlyDepartures fetch error:', error.message); return []; }
    return (data ?? [])
      .map(b => {
        const m = b.notes?.match(/🚪ANTICIPADO:(\d{4}-\d{2}-\d{2})/);
        return m ? { ...b, originalCheckOut: m[1] } : null;
      })
      .filter(b => b && b.originalCheckOut > firstDay);
  }

  // Para cada unidad+día entre la salida REAL (ya acortada) y la fecha
  // ORIGINAL de salida, revisa si una reserva ACTIVA ya "pisó" ese día —
  // igual que con las notas de crédito, si nadie lo pisó todavía, esa
  // noche queda marcada como "de salida anticipada" (se pinta gris con
  // puerta 🚪) y se puede volver a reservar por encima sin problema.
  _buildEarlyDepartureDays(activeBookings, earlyDepartures) {
    const pending = new Map(); // `${unitId}|${iso}` -> nombre del huésped
    earlyDepartures.forEach(eb => {
      const unitIds = (eb.booking_units ?? []).map(bu => bu.unit_id);
      const guestName = eb.guests ? `${eb.guests.first_name ?? ''} ${eb.guests.last_name ?? ''}`.trim() : '';
      for (let d = eb.check_out; d < eb.originalCheckOut; d = this._addDays(d, 1)) {
        unitIds.forEach(unitId => {
          const covered = activeBookings.some(b =>
            b.id !== eb.id && b.check_in <= d && b.check_out > d &&
            (b.booking_units ?? []).some(bu => bu.unit_id === unitId)
          );
          if (!covered) pending.set(`${unitId}|${d}`, guestName);
        });
      }
    });
    return pending;
  }

  async _fetchReminders(firstDay, lastDay) {
    const { data, error } = await this.db
      .from('reminders')
      .select('*')
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
      (b.booking_units ?? []).forEach(({ unit_id, segment_check_in, segment_check_out }) => {
        if (!map[unit_id]) return;
        // Estadía dividida entre 2 unidades: esta unidad puntual solo
        // ocupa SU tramo (segment_check_in/out), no la reserva completa.
        // Si no tiene tramo propio, cubre la reserva completa (de siempre).
        const uCi = segment_check_in  ?? ci;
        const uCo = segment_check_out ?? co;
        this._dateRange.forEach(iso => {
          if (iso >= uCi && iso < uCo) {
            map[unit_id][iso].push({
              ...b,
              check_in: uCi, check_out: uCo, // para que _renderBar dibuje solo este tramo
              _isSplitSegment: !!(segment_check_in || segment_check_out),
              _cellType: this._getCellType(uCi, uCo, iso),
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
  _render(cellMap, reminderMap, ncPendingDays = new Map(), earlyDepartureDays = new Map()) {
    const grid    = document.getElementById('calendar-grid');
    const today   = localToday();
    const isMob   = window.innerWidth <= 768;
    const cellW   = isMob ? CELL_W_MOB : CELL_W_DESK;
    const labelW  = this._measureLabelW(isMob);
    const N       = this._visibleDays;

    grid.style.gridTemplateColumns = `${labelW}px repeat(${N}, minmax(${cellW}px, 1fr))`;
    grid.style.minWidth = `${labelW + N * cellW}px`;
    grid.style.width    = '100%';
    grid.classList.add('month-grid');
    grid.classList.remove('week-grid');
    grid.innerHTML = '';

    // ── Variables CSS del calendario desde config ─────
    const _hexRgba = (hex, pct) => {
      const h = (hex ?? '#888').replace('#','');
      const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
      return `rgba(${r},${g},${b},${parseFloat(pct??0)/100})`;
    };
    const cfg = AppContext.config ?? {};
    const _set = (k,v) => document.documentElement.style.setProperty(k,v);
    _set('--cal-weekend-bg',         _hexRgba(cfg.cal_weekend_color  ?? '#7c8ba3', cfg.cal_weekend_opacity  ?? 8));
    _set('--cal-weekend-num-color',  cfg.cal_weekend_num_color  ?? '#64748b');
    _set('--cal-weekend-text-color', cfg.cal_weekend_text_color ?? '#94a3b8');
    _set('--cal-holiday-bg',         _hexRgba(cfg.cal_holiday_color  ?? '#ef4444', cfg.cal_holiday_opacity  ?? 5));
    _set('--cal-holiday-num-color',  cfg.cal_holiday_num_color  ?? '#dc2626');
    const _wdOp = parseFloat(cfg.cal_weekday_opacity ?? 0);
    if (_wdOp > 0) _set('--cal-weekday-bg', _hexRgba(cfg.cal_weekday_color ?? '#f8fafc', _wdOp));
    else document.documentElement.style.removeProperty('--cal-weekday-bg');
    _set('--cal-weekday-num-color',  cfg.cal_weekday_num_color  ?? '#1e293b');
    _set('--cal-weekday-text-color', cfg.cal_weekday_text_color ?? '#64748b');

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
    corner.textContent = 'Unidad';
    // Corner: sticky solo en eje horizontal (izquierda), scrollea vertical con el contenido
    corner.style.setProperty('position', 'sticky',  'important');
    corner.style.setProperty('left',     '0',        'important');
    // sin top:0 — no queremos sticky vertical
    corner.style.setProperty('z-index',  '200',      'important');
    corner.style.setProperty('background', 'var(--color-surface-2)', 'important');
    corner.style.setProperty('width',    '100%',     'important');
    corner.style.setProperty('min-width','0',        'important');
    corner.style.setProperty('max-width','100%',     'important');
    corner.style.setProperty('overflow', 'hidden',   'important');
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
      // Notas generales (sin depto) del día — se marcan UNA sola vez acá
      // arriba, con el emoji elegido, en vez de repetirse en cada fila de
      // unidad (eso queda solo para tareas operativas generales).
      const generalNotes = (reminderMap[iso] ?? []).filter(r => r.is_note && !(r.unit_ids?.length));
      const hasTaskRem = (reminderMap[iso] ?? []).some(r => !(r.is_note && !(r.unit_ids?.length)));
      const holMap    = nextYHols && date.getFullYear() === lastDate.getFullYear() ? nextYHols : holidays;
      const holiday   = holMap?.get ? holMap.get(iso) : null;
      const isHoliday = !!holiday && holiday.type !== 'vacation';
      // Mostrar etiqueta de mes cuando es el primero del mes o el primer día visible
      const showMonth = dayOfMon === 1 || colIdx === 0;

      const dh = document.createElement('div');
      let cls = 'cal-day-header';
      if (isToday)                       cls += ' today';
      if (isWknd)                        cls += ' weekend';
      if (dow === 6)                       cls += ' weekend-sat';
      if (dow === 0)                       cls += ' weekend-sun';
      if (isPast && !isToday)            cls += ' past-header';
      if (isHoliday)                     cls += ` holiday holiday-${holiday.type}`;
      if (dayOfMon === 1 && colIdx > 0)  cls += ' month-boundary';
      dh.className = cls;
      dh.dataset.date = iso;
      dh.title = holiday?.label ?? '';
      // z-index bajo inline — siempre DETRÁS de la columna sticky de departamentos
      // Sin sticky vertical — los headers de día scrollean junto con el contenido
      dh.style.setProperty('position', 'relative', 'important');
      dh.style.setProperty('z-index',  '1',        'important');

      dh.innerHTML = (showMonth ? '<span class="dh-month' + (dayOfMon === 1 && colIdx !== 0 ? ' dh-month-new' : '') + '">' + MONTH_SHORT[date.getMonth()] + '</span>' : '') +
        '<span class="dh-num">' + dayOfMon + '</span>' +
        (isToday ? '<span class="dh-hoy">HOY</span>' : '<span class="day-name">' + DAY_NAMES[dow] + '</span>') +
        (generalNotes.length
          ? '<div class="dh-note-icons" title="' + generalNotes.map(n => n.title).join(', ').replace(/"/g,'&quot;') + '">' +
              generalNotes.slice(0, 3).map(n => '<span>' + (n.icon || '📌') + '</span>').join('') +
            '</div>'
          : '') +
        (hasTaskRem ? '<div class="dh-rem-dot"></div>' : '') +
        (isToday ? '<div class="dh-today-dot"></div>' : '');
      grid.appendChild(dh);
    });

    // ── Mapa de huecos por unidad ─────────────────────────────────────
    // Para cada unidad, ordenamos sus reservas por fecha y calculamos los
    // huecos entre checkout de una y checkin de la siguiente. Para cada
    // día dentro de ese hueco, guardamos el tamaño del hueco (en noches)
    // → así cada celda vacía sabe si está dentro de un hueco y cuán chico
    // es, sin recalcular nada durante el loop de celdas (sería muy lento).
    const gapMap = new Map();
    const recambioSet = new Map();
    // lateCheckoutMap: día de checkout de reservas con late_checkout=true
    // Key: `${unitId}|${checkoutDate}` → { booking, color }
    const lateCheckoutMap = new Map();

    this.ctx.units.forEach(unit => {
      const unitBks = (this._lastRenderedBookings ?? [])
        .filter(b => !b.is_blocked && b.status !== 'cancelled' && b.status !== 'blocked'
                  && (b.booking_units ?? []).some(bu => bu.unit_id === unit.id))
        .sort((a, b) => a.check_in < b.check_in ? -1 : 1);

      // Late checkout map — el día de salida queda "medio ocupado"
      unitBks.forEach(bk => {
        if (bk.late_checkout) {
          const barColor = getBookingBarColor(bk).color;
          lateCheckoutMap.set(`${unit.id}|${bk.check_out}`, { booking: bk, color: barColor });
        }
      });

      for (let i = 0; i < unitBks.length - 1; i++) {
        const co = unitBks[i].check_out;
        const ci = unitBks[i + 1].check_in;
        if (ci === co) {
          const outGuest = unitBks[i].guests ? `${unitBks[i].guests.first_name ?? ''} ${unitBks[i].guests.last_name ?? ''}`.trim() : '—';
          const inGuest  = unitBks[i+1].guests ? `${unitBks[i+1].guests.first_name ?? ''} ${unitBks[i+1].guests.last_name ?? ''}`.trim() : '—';
          recambioSet.set(`${unit.id}|${ci}`, { outGuest, inGuest, unitName: unit.name ?? `#${unit.unit_number}` });
        } else if (ci > co) {
          const gap = Math.round((new Date(ci + 'T12:00:00') - new Date(co + 'T12:00:00')) / 86400000);
          for (let d = co; d < ci; d = this._addDays(d, 1)) {
            gapMap.set(`${unit.id}|${d}`, gap);
          }
        }
      }
    });

    this._lateCheckoutMap = lateCheckoutMap; // para que _renderBar pueda consultarlo

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
      label.style.setProperty('--unit-color',  unitColor);
      label.style.setProperty('border-left-color', unitColor, 'important');
      // setProperty con 'important' — siempre encima de headers de días
      label.style.setProperty('position',   'sticky',  'important');
      label.style.setProperty('left',       '0',       'important');
      label.style.setProperty('z-index',    '200',     'important');
      label.style.setProperty('background',
        `linear-gradient(${unitColor}22, ${unitColor}22) 0 0 / 100% calc(100% - 3px) no-repeat,
         var(--color-surface) bottom / 100% 3px no-repeat`,
        'important');
      // Ancho controlado por grid template — nunca mayor al labelW calculado
      label.style.setProperty('width',      '100%',    'important');
      label.style.setProperty('min-width',  '0',       'important');
      label.style.setProperty('max-width',  '100%',    'important');
      label.style.setProperty('overflow',   'hidden',  'important');
      const _notes     = unit.internal_notes ?? '';
      const _notesSafe  = _notes.replace(/[']/g, '&#39;');
      const _notesSpan  = hasNotes
        ? '<span title="' + _notes.replace(/"/g,'&quot;') + '" style="cursor:help;font-size:.85rem" onclick="window._calInstance._showUnitNote(event,\'' + _notesSafe + '\')">\u{1F4DD}</span>'
        : '';
      // Lapiz => renombrar departamento por sesion (localStorage)
      const _editBtn = can('manageUnitNotes')
        ? '<button class="btn btn-ghost btn-xs" data-unit-id="' + unit.id + '" title="Renombrar (solo tu sesion)" style="padding:1px 2px;font-size:.6rem;opacity:.5;flex-shrink:0;line-height:1" onclick="event.stopPropagation();window._calInstance.editUnitDisplayName(\'' + unit.id + '\')">\u270f\ufe0f</button>'
        : '';
      // Nombre: localStorage primero, luego unit.name
      const _unitNum  = unit.sort_order ?? unit.number ?? '';
      const _unitName = this._getUnitDisplayName(unit)
        .replace('Planta Baja','P. Baja').replace('Planta Alta','P. Alta');
      label.dataset.unitId = unit.id;

      // % de días visibles ocupados para esta unidad
      const occupiedDays = this._dateRange.filter(iso => (cellMap[unit.id]?.[iso]?.length ?? 0) > 0).length;
      const totalDays    = this._dateRange.length || 1;
      const occPct       = Math.round(occupiedDays / totalDays * 100);
      const occColor     = occPct >= 80 ? '#ef4444' : occPct >= 50 ? '#f59e0b' : '#16a34a';

      label.innerHTML =
        '<div style="display:flex;align-items:center;gap:3px">' +
          '<span class="cal-unit-dot" style="background-color:' + unitColor + ';width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-right:1px"></span>' +
          '<span class="cal-unit-name" style="font-size:.78rem;font-weight:700;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0">' + _unitName + '</span>' +
          _notesSpan + _editBtn +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:4px;padding-left:12px;margin-top:2px">' +
          '<span style="font-size:.63rem;color:var(--color-text-3)"><span style="color:var(--color-text-3);font-weight:600;opacity:.7">#' + _unitNum + '</span> · Hasta ' + unit.max_guests + ' pers.</span>' +
          '<span style="flex:1"></span>' +
          '<span style="font-size:.6rem;font-weight:700;color:' + occColor + '">' + occPct + '%</span>' +
        '</div>' +
        '<div style="margin:3px 0 1px 12px;height:2px;background:var(--color-border);border-radius:1px;overflow:hidden">' +
          '<div style="height:100%;background:' + occColor + ';border-radius:1px;width:' + occPct + '%;transition:width .5s"></div>' +
        '</div>';
      grid.appendChild(label);

      // Celdas
      this._dateRange.forEach((iso, colIdx) => {
        const isToday  = iso === today;
        const isPast   = iso < today;
        const date     = new Date(iso + 'T12:00:00');
        const dayOfMon = date.getDate();
        const isWknd   = date.getDay() === 0 || date.getDay() === 6;
        const holMap   = nextYHols && date.getFullYear() === lastDate.getFullYear() ? nextYHols : holidays;
        const cellHol  = holMap?.get ? holMap.get(iso) : null;
        const bookings = cellMap[unit.id]?.[iso] ?? [];
        const rems     = reminderMap[iso] ?? [];

        const cell = document.createElement('div');
        let cellCls = 'cal-cell';
        if (isToday)  cellCls += ' today-col';
        if (isWknd)   cellCls += ' weekend-col';
        if (date.getDay() === 6) cellCls += ' weekend-sat';
        if (date.getDay() === 0) cellCls += ' weekend-sun';
        if (isPast)   cellCls += ' past-col';
        if (dayOfMon === 1 && colIdx > 0) cellCls += ' month-boundary';
        if (cellHol?.type === 'fixed' || cellHol?.type === 'movable') cellCls += ' holiday-col';
        if (cellHol?.type === 'vacation') cellCls += ' vacation-col';
        if (cellHol?.type === 'bridge')   cellCls += ' bridge-col';
        cell.className      = cellCls;
        cell.dataset.date   = iso;
        cell.dataset.unitId = unit.id;
        cell.dataset.rowParity = rowParity;
        if (cellHol) cell.title = cellHol.label;

        if (bookings.length === 0) {
          // Noche que pertenecía a una reserva cancelada con Nota de
          // Crédito todavía sin usar, y que nadie volvió a reservar — se
          // muestra como una barra más (mismo peso visual que una reserva
          // real), en gris apagado, para que se note de un vistazo sin
          // tener que pasar el mouse. Apenas otra reserva ocupe este día,
          // deja de calcularse como pendiente (se lo "pisa" la reserva
          // nueva, como corresponde).
          if (ncPendingDays.has(`${unit.id}|${iso}`)) {
            const guestName = ncPendingDays.get(`${unit.id}|${iso}`);
            // Solo renderizar en la celda START del rango NC — evita ícono por celda.
            const prevIso = this._addDays(iso, -1);
            const isNcStart = !ncPendingDays.has(`${unit.id}|${prevIso}`)
              || ncPendingDays.get(`${unit.id}|${prevIso}`) !== guestName;
            if (isNcStart) {
              // Contar días NC consecutivos (ncPendingDays es un Map — cellMap es un
              // objeto plano, no tiene .get(); intentar llamarlo lanzaba un TypeError
              // que cortaba el render al llegar al primer rango NC).
              let ncSpan = 1;
              let nxt = this._addDays(iso, 1);
              while (ncPendingDays.has(`${unit.id}|${nxt}`)
                     && ncPendingDays.get(`${unit.id}|${nxt}`) === guestName) {
                ncSpan++;
                nxt = this._addDays(nxt, 1);
              }
              this._renderNcRangeBar(cell, guestName, null, ncSpan);
            }
            cell.title = `🗓️ Noche de reprogramación${guestName ? ` de ${guestName}` : ''} sin usar — todavía se puede reservar`;
          } else if (earlyDepartureDays.has(`${unit.id}|${iso}`)) {
            const guestName = earlyDepartureDays.get(`${unit.id}|${iso}`);
            this._renderEarlyDepartureBar(cell, guestName);
            cell.title = `🚪 Noche libre por salida anticipada${guestName ? ` de ${guestName}` : ''} — todavía se puede reservar`;
          } else {
            // Tooltip simple: número de unidad + fecha completa legible
            const d = new Date(iso + 'T12:00:00');
            const dayNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
            const dayLabel = `${dayNames[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`;
            const simpleMsg = `#${_unitNum} — ${dayLabel}`;
            cell.title = cell.title ? `${cell.title} · ${simpleMsg}` : simpleMsg;

            // Mapa de calor: tinte muy tenue solo en celdas vacías a futuro,
            // para dar noción de demanda esperada sin competir visualmente
            // con las barras de reserva.
            const gapSize   = gapMap.get(`${unit.id}|${iso}`) ?? null;
            const heatColor = this._heatmapColor(iso, today, !!cellHol && cellHol.type !== 'vacation', cellHol?.type, gapSize);
            if (heatColor) cell.style.setProperty('background-color', heatColor, 'important');
          }
          this._bindEmptyCell(cell, unit.id, iso);
        } else if (bookings.length === 1) {
          const isRecambio = recambioSet.has(`${unit.id}|${iso}`);
          this._renderBar(cell, bookings[0], today, isRecambio);
        } else {
          const co = bookings.find(b => b._cellType === 'end');
          const ci = bookings.find(b => b._cellType === 'start' || b._cellType === 'solo');
          if (co && ci) {
            const isRecambio = recambioSet.has(`${unit.id}|${iso}`);
            this._renderSplitCell(cell, co, ci, today, isRecambio);
          } else this._renderBar(cell, bookings[0], today);
        }

        rems.forEach(r => {
          // unit_ids es el campo nuevo (array, permite varios deptos o
          // ninguno = todo el complejo). unit_id es el campo viejo — se
          // deja como fallback por si hay recordatorios de antes de la
          // migración que todavía no se migraron.
          const ids = (r.unit_ids?.length ? r.unit_ids : (r.unit_id ? [r.unit_id] : [])).map(String);
          // Nota general (sin depto): ya se marcó una vez en el encabezado
          // del día — no repetir en cada fila.
          if (r.is_note && !ids.length) return;
          if (ids.length && !ids.includes(String(unit.id))) return;
          const dot = document.createElement('div');
          dot.className = 'cal-reminder-dot';
          const unitNames = ids
            .map(id => this.ctx.units?.find(u => String(u.id) === id))
            .filter(Boolean)
            .map(u => `#${u.sort_order} ${u.name}`)
            .join(', ');
          dot.innerHTML = `<div class="tooltip">🔔 ${r.title}${unitNames ? ` · ${unitNames}` : ''}</div>`;
          cell.appendChild(dot);
        });

        grid.appendChild(cell);
      });
    });

    // Reset scroll al inicio del window DESPUÉS del paint completo
    // (doble rAF garantiza que el browser terminó layout + paint)
    const _wrapper = document.querySelector('.cal-wrapper');
    if (_wrapper) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          _wrapper.scrollLeft = 0;
        });
      });
    }
  }

  // ══════════════════════════════════════════════════
  // RENDERIZADO DE BARRAS
  // ══════════════════════════════════════════════════
  // Barra "fantasma" para una noche que perteneció a una reserva cancelada
  // con Nota de Crédito sin usar — mismo peso visual que una barra real
  // (se nota de un vistazo, sin pasar el mouse), pero en marrón apagado y
  // con rayas, para que se distinga claramente de una ocupación real.
  // ── Mapa de calor de demanda para celdas vacías ────────────────────
  // Puntaje 0-10 basado en 3 factores combinados:
  //   1. Urgencia temporal (cuántos días faltan — más urgente = más caliente)
  //   2. Día de semana (viernes/sábado = más demanda)
  //   3. Temporada (verano, invierno, Semana Santa, fines de semana largos)
  //
  // El resultado se traduce a un tinte de fondo MUY tenue que no compite
  // visualmente con las barras de reserva — solo se ve en celdas vacías.
  _heatmapColor(iso, today, isHoliday, holidayType, gapSize = null) {
    if (iso < today) return null; // días pasados: sin tinte

    // ── Factor 1: urgencia temporal ──
    const daysAhead = Math.round((new Date(iso + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000);
    let score = 0;
    if      (daysAhead <= 3)  score += 5;
    else if (daysAhead <= 7)  score += 4;
    else if (daysAhead <= 14) score += 3;
    else if (daysAhead <= 30) score += 2;
    // más de 30 días → 0

    // ── Factor 2: día de semana ──
    const dow = new Date(iso + 'T12:00:00').getDay();
    if (dow === 5 || dow === 6) score += 2; // viernes/sábado
    else if (dow === 0)         score += 1; // domingo

    // ── Factor 3: temporada alta argentina ──
    const [y, m, d] = iso.split('-').map(Number);
    const md = m * 100 + d;
    const isVerano   = md >= 1215 || md <= 228;
    const isInvierno = m === 7;
    const isSemSanta = isHoliday && holidayType === 'movable';
    if (isVerano)              score += 3;
    else if (isInvierno)       score += 2;
    if (isSemSanta)            score += 3;
    else if (isHoliday)        score += 1;

    // ── Factor 4: tamaño del hueco ──
    // Un hueco de 1-2 noches entre reservas es el más difícil de llenar
    // y el que más duele dejar vacío — sube el score considerablemente.
    // Un hueco de 3-4 noches también suma, pero menos.
    // Sin hueco (celda aislada sin contexto de reservas antes/después):
    // no suma nada extra — el score base ya contempla temporada y urgencia.
    if (gapSize !== null) {
      if      (gapSize <= 2) score += 5; // hueco crítico: 1-2 noches
      else if (gapSize <= 4) score += 3; // hueco pequeño: 3-4 noches
      else if (gapSize <= 7) score += 1; // hueco mediano: hasta 1 semana
      // hueco grande (8+) → no suma extra, ya tiene urgencia temporal propia
    }

    // ── Score → color tenue ──
    // Escala máxima teórica ~14 (5+2+3+3+5). Se mapea en 4 niveles.
    const s = Math.min(score, 14);
    if      (s >= 10) return 'rgba(239,68,68,.11)';   // rojo — urgente
    else if (s >= 7)  return 'rgba(249,115,22,.09)';  // naranja
    else if (s >= 4)  return 'rgba(234,179,8,.07)';   // amarillo
    else if (s >= 2)  return 'rgba(34,197,94,.05)';   // verde tenue
    return null;
  }

  _renderLateCheckoutTriangle(cell, booking, color) {
    // Media barra — ocupa la mitad izquierda de la celda, mismo estilo
    // que las barras de reserva (mismo color, mismo border-radius, mismo
    // posicionamiento). Visualmente es la continuación de la reserva que
    // termina al mediodía en vez de a la noche.
    const half = document.createElement('div');
    // La media barra continúa exactamente donde terminó la barra anterior
    // (sin margen izquierdo, sin borde izquierdo redondeado) y se cierra
    // con borde redondeado a la derecha — visualmente parece una barra
    // que se corta al mediodía.
    half.style.cssText = `
      position:absolute;top:6px;bottom:6px;left:0;width:55%;
      background:${color};
      border-radius:0 6px 6px 0;
      opacity:0.9;z-index:2;pointer-events:none;
      display:flex;align-items:center;justify-content:flex-end;
      padding-right:5px;box-sizing:border-box;
    `;
    half.innerHTML = '<span style="font-size:1rem;line-height:1;flex-shrink:0">🌅</span>';
    cell.appendChild(half);
  }

  _renderNcPendingBar(cell, guestName) {
    const bar = document.createElement('div');
    bar.className = 'nc-pending-bar';
    bar.style.cssText = `
      position:absolute;top:6px;bottom:6px;left:4px;right:4px;
      border-radius:6px;
      background:repeating-linear-gradient(135deg,
        rgba(148,163,184,.35), rgba(148,163,184,.35) 6px,
        rgba(148,163,184,.18) 6px, rgba(148,163,184,.18) 12px);
      border:1px dashed rgba(148,163,184,.45);
      z-index:2;
      display:flex;align-items:center;justify-content:center;
      font-size:.9rem;pointer-events:none;
    `;
    bar.innerHTML = '<span style="opacity:.8">🗓️</span>';
    cell.appendChild(bar);
  }

  // Renderiza el rango completo de NC como una barra que abarca todas las
  // celdas — en vez de un ícono por celda individual.
  // Recibe la primera celda DOM y el span (cantidad de días) del rango.
  // Usa calc() igual que _renderBar — evita depender de offsetWidth (0 antes del paint).
  _renderNcRangeBar(firstCell, guestName, ncAmount, span = 1) {
    if (!firstCell) return;

    const bar = document.createElement('div');
    bar.className = 'nc-pending-bar nc-range-bar';

    bar.style.cssText = `
      position:absolute;top:6px;bottom:6px;
      left:4px;width:calc(${span} * 100% - 8px);
      border-radius:6px;
      background:repeating-linear-gradient(135deg,
        rgba(148,163,184,.32), rgba(148,163,184,.32) 6px,
        rgba(148,163,184,.14) 6px, rgba(148,163,184,.14) 12px);
      border:1px dashed rgba(148,163,184,.5);
      z-index:2;
      display:flex;align-items:center;padding:0 8px;gap:5px;
      overflow:hidden;white-space:nowrap;pointer-events:none;
    `;
    bar.innerHTML = '<span style="font-size:.8rem;opacity:.8;flex-shrink:0">🗓️</span>'
      + '<span style="font-size:.65rem;font-weight:600;color:rgba(100,116,139,.85);overflow:hidden;text-overflow:ellipsis">'
      + (guestName ? guestName : 'NC pendiente')
      + (ncAmount ? ' · $' + Math.round(ncAmount).toLocaleString('es-AR') : '')
      + '</span>';
    firstCell.appendChild(bar);
  }

  // Misma idea y mismo gris que la barra de nota de crédito sin usar —
  // el usuario pidió específicamente el mismo estilo, solo cambia el
  // ícono (puerta en vez de flechitas) para distinguir el motivo.
  _renderEarlyDepartureBar(cell, guestName) {
    const bar = document.createElement('div');
    bar.className = 'early-departure-bar';
    bar.style.cssText = `
      position:absolute;top:6px;bottom:6px;left:4px;right:4px;
      border-radius:6px;
      background:repeating-linear-gradient(135deg,
        rgba(148,163,184,.35), rgba(148,163,184,.35) 6px,
        rgba(148,163,184,.18) 6px, rgba(148,163,184,.18) 12px);
      border:1px dashed rgba(148,163,184,.45);
      z-index:2;
      display:flex;align-items:center;justify-content:center;
      font-size:.9rem;pointer-events:none;
    `;
    bar.innerHTML = '<span style="opacity:.7">🚪</span>';
    cell.appendChild(bar);
  }

  _renderBar(cell, booking, todayISO, isRecambio = false) {
    if (booking._cellType !== 'start' && booking._cellType !== 'solo') return;

    const { color, textColor } = getBookingBarColor(booking);

    // ── Degradés proporcionales — toda la barra como un solo bloque ──
    // · Noches sin cargo  → amarillo  (noche gratis)
    // · Descuento %       → naranja   (pagó menos)
    // · Recargo           → color más oscuro (pagó extra)
    //   · Recargo chico   → ligeramente más oscuro
    //   · Recargo grande  → bordó/verde oscuro según color base
    const freeN       = booking.free_nights    ?? 0;
    const discPct     = booking.discount_pct   ?? 0;
    const surcharge   = booking.surcharge_amount ?? 0;
    const total       = booking.total_amount   ?? 0;
    const totalN      = booking.nights         ?? 1;
    const isPaid      = booking.status === 'paid';
    const orange      = '#F97316';
    const yellow      = '#EF9F27';

    // Degradés solo aplican si la reserva NO está saldada.
    // Pagada = precio consumado, no hay info accionable que mostrar.
    const applyGradient = !isPaid;

    // Función que oscurece un color hex por un factor (0=negro, 1=original)
    const darken = (hex, factor) => {
      const h = hex.replace('#','');
      const r = Math.round(parseInt(h.slice(0,2),16) * factor);
      const g = Math.round(parseInt(h.slice(2,4),16) * factor);
      const b = Math.round(parseInt(h.slice(4,6),16) * factor);
      return `rgb(${r},${g},${b})`;
    };

    // Degradés proporcionales — aplican para TODAS las reservas.
    // El color base ya es semántico: verde=pagado, rojo=señado, ámbar=sin seña.
    // La punta de color indica el tipo de precio especial.
    // Prioridad: noches sin cargo > descuento > recargo
    let barBg = color;

    // Gradiente con transición muy leve (4 pp): cada sección ocupa casi
    // una celda entera pero con un suave paso de color en el límite.
    const T = 4; // puntos de transición
    if (freeN > 0 && totalN > 0) {
      const p = Math.round(((totalN - freeN) / totalN) * 100);
      barBg = `linear-gradient(to right, ${color} 0%, ${color} ${p-T}%, ${yellow} ${p+T}%, ${yellow} 100%)`;

    } else if (discPct > 0 && surcharge > 0 && total > 0) {
      const surchargeRatio = Math.min(surcharge / total, 0.6);
      const p          = Math.round(Math.max(55, 100 - surchargeRatio * 80));
      const darkFactor = Math.max(0.35, 0.75 - surchargeRatio * 0.8);
      const dk = darken(color, darkFactor);
      barBg = `linear-gradient(to right, ${color} 0%, ${color} ${p-T}%, ${dk} ${p+T}%, ${dk} 100%)`;

    } else if (discPct > 0) {
      const p = Math.round(100 - discPct);
      barBg = `linear-gradient(to right, ${color} 0%, ${color} ${p-T}%, ${orange} ${p+T}%, ${orange} 100%)`;

    } else if (surcharge > 0 && total > 0) {
      const surchargeRatio = Math.min(surcharge / total, 0.6);
      const p          = Math.round(Math.max(55, 100 - surchargeRatio * 80));
      const darkFactor = Math.max(0.35, 0.75 - surchargeRatio * 0.8);
      const darkColor  = darken(color, darkFactor);
      barBg = `linear-gradient(to right, ${color} 0%, ${color} ${p-T}%, ${darkColor} ${p+T}%, ${darkColor} 100%)`;
    }

    // Bloqueos: rayitas diagonales sutiles (igual al card en la tab Reservas)
    if (booking.status === 'blocked' || booking.is_blocked) {
      barBg = `repeating-linear-gradient(135deg,
        transparent 0px, transparent 5px,
        rgba(255,255,255,.18) 5px, rgba(255,255,255,.18) 6px
      ), ${color}`;
    }

    const ci        = booking.check_in;
    const co        = booking.check_out;
    const winStart  = this._windowStart;
    const winEndExcl= this._addDays(winStart, this._visibleDays);

    // ── Degradé de progreso para reservas en curso ─────────────────────────
    // En curso = check_in <= hoy < check_out
    // Días pasados → oscuros; hoy → color pleno; días futuros → fantasma (13%)
    const isInProgress = co > todayISO && ci <= todayISO;
    if (isInProgress) {
      const msDay     = 86400000;
      const visStart2 = ci < winStart ? winStart : ci;
      const visEnd2   = co > winEndExcl ? winEndExcl : co;
      const span2     = Math.max(1, Math.round(
        (new Date(visEnd2+'T00:00:00') - new Date(visStart2+'T00:00:00')) / msDay
      ));
      const passedDays = Math.max(0, Math.round(
        (new Date(todayISO+'T00:00:00') - new Date(visStart2+'T00:00:00')) / msDay
      ));
      const passedPct  = Math.round((passedDays / span2) * 100);
      const todayPct   = Math.round(((passedDays + 1) / span2) * 100);
      const darkStart  = darken(color, 0.15);
      const lighten    = (hex, f) => {
        const h = hex.replace('#','');
        const r = Math.min(255, Math.round(parseInt(h.slice(0,2),16) + (255-parseInt(h.slice(0,2),16))*f));
        const g = Math.min(255, Math.round(parseInt(h.slice(2,4),16) + (255-parseInt(h.slice(2,4),16))*f));
        const b = Math.min(255, Math.round(parseInt(h.slice(4,6),16) + (255-parseInt(h.slice(4,6),16))*f));
        return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
      };
      // Días futuros: heredan el indicador de precio si lo hay
      let futureColor;
      if (freeN > 0 && totalN > 0) {
        futureColor = yellow;                    // noche gratis → amarillo
      } else if (discPct > 0) {
        futureColor = orange;                    // descuento → naranja
      } else if (surcharge > 0 && total > 0) {
        futureColor = darken(color, 0.75);       // recargo → verde más oscuro
      } else {
        futureColor = lighten(color, 0.30);      // normal → apenas más claro
      }
      if (span2 > 1) {
        // Opción 3: overlay oscuro en pasado, corte nítido en hoy
        // El corte nítido actúa como marcador de "dónde estamos ahora"
        const darkPast = darken(color, 0.42);
        if (passedDays === 0) {
          // Arrancó hoy: sin porción pasada — mantener el gradiente de precio ya calculado.
          // No sobreescribir barBg: si tiene descuento/noche gratis, se preserva.
        } else {
          // Tiene días pasados: oscurecer pasado, luego el gradiente de precio en el futuro.
          // Si barBg tenía gradiente (descuento→naranja), reemplazamos la porción pasada
          // con darkPast y dejamos el color base en la sección actual+futura.
          barBg = 'linear-gradient(to right, '
            + darkPast + ' 0%, '
            + darkPast + ' ' + passedPct + '%, '
            + color    + ' ' + passedPct + '%, '
            + color    + ' 100%)';
        }
      }
    }

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

    // ¿Esta barra arranca en un día con late checkout de otra reserva en la misma unidad?
    // Si es así, empieza desde el 65% de la celda (donde termina el late checkout).
    const unitId = (booking.booking_units ?? [])[0]?.unit_id ?? '';
    const lateCoKey = `${unitId}|${ci}`;
    const startsAfterLate = !truncLeft && (this._lateCheckoutMap?.has(lateCoKey) ?? false);
    const leftStyle = startsAfterLate ? 'calc(66% + 2px)' : `${left}px`;
    const widthReduceForLate = startsAfterLate ? ' - 66%' : '';

    // Ancho INTERACTIVO: solo celdas reales de la reserva (sin extensión late checkout)
    // La extensión late checkout se agrega como overlay visual sin pointer-events.
    const widthInteractive = `calc(${span} * 100%${widthReduceForLate} - ${left + rightM}px)`;
    const borderR = truncRight ? 0 : 6;
    const borderL = truncLeft  ? 0 : 6;

    const firstName = booking.guests?.first_name ?? '';
    const lastName  = booking.guests?.last_name  ?? '';
    const isBlock   = booking.status === 'blocked' || booking.is_blocked;
    const guestFull = isBlock
      ? (booking.block_reason ?? 'Bloqueo')
      : `${lastName} ${firstName}`.trim();

    const bar = document.createElement('div');
    bar.className = 'bar bar-span' + (isPast ? ' past-bar' : '');

    if (this._pendingPulse.has(booking.id)) {
      bar.classList.add('bar-new-bounce');
      this._pendingPulse.delete(booking.id);
      setTimeout(() => bar.classList.remove('bar-new-bounce'), 1200);
    }

    bar.style.cssText = `
      background:${barBg};
      position:absolute;top:6px;bottom:6px;
      left:${leftStyle};
      width:${widthInteractive};
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

    // ── Marcador de hoy: línea azul en el corte pasado/futuro ──────────────
    if (isInProgress && !isPast) {
      const msDay3 = 86400000;
      const _vs3 = ci < winStart ? winStart : ci;
      const _span3 = Math.max(1, Math.round(
        (new Date((co > winEndExcl ? winEndExcl : co)+'T00:00:00') - new Date(_vs3+'T00:00:00')) / msDay3
      ));
      const _passed3 = Math.max(0, Math.round(
        (new Date(todayISO+'T00:00:00') - new Date(_vs3+'T00:00:00')) / msDay3
      ));
      if (_passed3 > 0 && _span3 > 1) {
        const cutPct = Math.round((_passed3 / _span3) * 100);
        const marker = document.createElement('div');
        marker.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;background:rgba(255,255,255,.7);'
          + 'left:' + cutPct + '%;z-index:4;pointer-events:none;border-radius:1px';
        bar.appendChild(marker);
      }
    }

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

    // Estadía dividida (booking-form.js → "Dividir estadía"): la reserva
    // quedó marcada en notas con "🔗 Parte 1/2" o "🔗 Parte 2/2" — se
    // muestra el mismo ícono acá para identificarla de un vistazo en el
    // calendario, sin tener que abrir la reserva.
    const splitMatch = !isBlock && booking.notes?.match(/🔗 Parte (\d)\/(\d)/);
    const splitChip = splitMatch
      ? '<span title="Estadía dividida — Parte ' + splitMatch[1] + '/' + splitMatch[2] + '" ' +
        'style="display:inline-flex;align-items:center;justify-content:center;' +
        'padding:0 3px;border-radius:3px;font-size:.62rem;line-height:1.5;' +
        'flex-shrink:0;margin-right:4px;background:rgba(255,255,255,.25);color:' + textColor + '">🔗</span>'
      : '';

    const unitColors = (booking.booking_units ?? [])
      .map(bu => bu?.units?.color ?? bu?.color).filter(Boolean);
    const isSolo      = booking._cellType === 'solo';
    const calInitials = (
      ((booking.guests?.first_name ?? '')[0] ?? '') +
      ((booking.guests?.last_name  ?? '')[0] ?? '')
    ).toUpperCase() || '?';

    // Avatar con colores de unidad, siempre visible sobre la barra:
    // · 0 unidades  → blanco semitransparente
    // · 1 unidad    → fondo blanco + texto en color de la unidad
    // · 2+ unidades → fondo con los colores de cada unidad (full opacity) + texto blanco
    let avBg, avColor;
    if (unitColors.length === 0) {
      avBg = 'rgba(255,255,255,.7)'; avColor = textColor;
    } else if (unitColors.length === 1) {
      avBg = 'rgba(255,255,255,.88)'; avColor = unitColors[0];
    } else if (unitColors.length === 2) {
      avBg = 'linear-gradient(135deg,' + unitColors[0] + ' 50%,' + unitColors[1] + ' 50%)';
      avColor = '#fff';
    } else {
      const step = Math.round(360 / unitColors.length);
      avBg = 'conic-gradient(' + unitColors.map((c,i) => c + ' ' + (i*step) + 'deg ' + ((i+1)*step) + 'deg').join(',') + ')';
      avColor = '#fff';
    }

    const avSize  = isSolo ? 22 : 15;
    const avStyle = 'width:' + avSize + 'px;height:' + avSize + 'px;border-radius:50%;'
      + 'display:inline-flex;align-items:center;justify-content:center;'
      + 'font-size:' + Math.max(7, Math.round(avSize * .44)) + 'px;font-weight:800;'
      + 'background:' + avBg + ';color:' + avColor + ';'
      + 'flex-shrink:0;line-height:1;' + (isSolo ? '' : 'margin-right:4px;');
    const avatar = !isBlock
      ? '<span style="' + avStyle + '">' + calInitials + '</span>'
      : '';

    const nameStyle = 'color:' + textColor + ';font-size:.75rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0';
    const lateChip  = !isSolo && booking.late_checkout
      ? '<span title="🌅 Late check-out" style="flex-shrink:0;font-size:.65rem;margin-left:3px">🌅</span>'
      : '';

    if (isSolo) {
      bar.style.cssText += ';display:flex;align-items:center;justify-content:center;padding:0 1px';
      bar.innerHTML = avatar;
    } else {
      bar.innerHTML = avatar + canalChip + splitChip + '<span style="' + nameStyle + '">' + guestFull + '</span>' + lateChip;
    }

    // 🔄 Recambio: al centro superior de la celda, entre las dos barras
    if (isRecambio) {
      const badge = document.createElement('div');
      badge.title = '🔄 Recambio — sale un huésped y entra otro el mismo día';
      badge.style.cssText = 'position:absolute;top:1px;left:0;right:0;z-index:10;' +
        'font-size:1rem;line-height:1;pointer-events:none;text-align:center;' +
        'filter:drop-shadow(0 0 2px rgba(0,0,0,.25))';
      badge.textContent = '🔄';
      cell.appendChild(badge);
    }

    // ── Resize handles — derecha (checkout) y ahora también izquierda (check-in) ──
    if (!truncRight) {
      const handle = document.createElement('div');
      handle.className = 'bar-resize-handle';
      handle.title = 'Arrastrar para cambiar fecha de salida';
      bar.appendChild(handle);
    }
    if (!truncLeft) {
      const handleL = document.createElement('div');
      handleL.className = 'bar-resize-handle-left';
      handleL.title = 'Arrastrar para cambiar fecha de ingreso';
      bar.appendChild(handleL);
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

    // ── Touch tap: mostrar tooltip en mobile ──
    bar.addEventListener('touchstart', (e) => {
      this._touchStartX = e.touches[0].clientX;
      this._touchStartY = e.touches[0].clientY;
      this._touchMoved  = false;
    }, { passive: true });
    bar.addEventListener('touchmove', () => {
      this._touchMoved = true;
    }, { passive: true });
    bar.addEventListener('touchend', (e) => {
      if (this._touchMoved) return; // fue un drag, no un tap
      e.preventDefault();
      const touch = e.changedTouches[0];
      // Mostrar tooltip en posición del tap
      const fakeEvent = { clientX: touch.clientX, clientY: touch.clientY };
      this._showTooltip(booking, fakeEvent);
      // Auto-cerrar después de 3 segundos
      clearTimeout(this._tooltipTouchTimer);
      this._tooltipTouchTimer = setTimeout(() => this._hideTooltip(), 3000);
    });

    bar.addEventListener('click', (e) => {
      if (this._barDrag.moved) return;
      e.stopPropagation();
      this._openBarPopover(booking.id, bar, e);
    });

    bar.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._ctxTarget = { bookingId: booking.id };
      this._showContextMenu(e.clientX, e.clientY, true);
    });

    cell.appendChild(bar);

    // Extensión visual late checkout: overlay sin pointer-events que
    // "continúa" la barra 67% hacia el día de salida. No captura clicks.
    if (booking.late_checkout && !truncRight) {
      const ext = document.createElement('div');
      const isFree  = booking.late_checkout_charged === false;
      const isPaidB = booking.status === 'paid';
      const yellow  = '#EF9F27';
      // Si está pagada: la extensión es el mismo color verde (no amarillo)
      // Solo aplica amarillo si es gratis Y no está pagada
      const extBaseColor = (!isPaidB && freeN > 0) ? yellow : color;
      const extBg   = (!isPaidB && isFree)
        ? `linear-gradient(to right, ${extBaseColor} 0%, ${extBaseColor} 20%, ${yellow} 100%)`
        : extBaseColor;
      ext.style.cssText = `
        position:absolute;top:6px;bottom:6px;
        left:${leftStyle};
        width:calc(${span} * 100% + 65%${widthReduceForLate} - ${left + rightM}px);
        background:${extBg};
        border-radius:${borderL}px 6px 6px ${borderL}px;
        opacity:${isPast ? 0.4 : 0.9};
        z-index:2;pointer-events:none;
        display:flex;align-items:center;
        padding-left:8px;padding-right:6px;box-sizing:border-box;overflow:hidden;
      `;
      ext.innerHTML = Calendar._guestAvatar(booking.guests, 16) +
        '<span style="font-size:.75rem;font-weight:700;color:' + textColor + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0">' +
        guestFull + '</span>';
      cell.appendChild(ext);
    }
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
    left.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      this._ctxTarget = { bookingId: coBooking.id };
      this._showContextMenu(e.clientX, e.clientY, true);
    });

    const right = document.createElement('div');
    right.className = 'bar bar-split-right';
    right.style.background = ciColor;
    if (ciIsPast) right.style.filter = 'grayscale(52%) opacity(.62)';
    right.dataset.bookingId = ciBooking.id;
    right.addEventListener('mouseenter', (e) => this._showTooltip(ciBooking, e));
    right.addEventListener('mousemove',  (e) => this._moveTooltip(e));
    right.addEventListener('mouseleave', ()  => this._hideTooltip());
    right.addEventListener('click', (e) => { e.stopPropagation(); this._openDetailById(ciBooking.id); });
    right.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      this._ctxTarget = { bookingId: ciBooking.id };
      this._showContextMenu(e.clientX, e.clientY, true);
    });

    cell.appendChild(left);
    cell.appendChild(right);
    cell.style.background = 'rgba(251,113,133,.04)';
  }

  // ── Celda vacía (click abre formulario) ──────────
  _bindEmptyCell(cell, unitId, dateISO) {
    // Hint visual: "+" al hover
    cell.classList.add('cal-cell-empty');

    cell.addEventListener('click', async (e) => {
      // Ignorar si venía de un drag (barra o selección)
      if (this._drag?.moved || this._barDrag?.moved) return;
      if (e.target.closest('.bar,.bar-resize-handle,.ctx-menu')) return;
      // No abrir en celdas pasadas
      if (dateISO < localToday()) return;

      // Pre-llenar: check-in en la fecha, check-out al día siguiente
      const checkOut = this._addDays(dateISO, 1);

      // Chequear períodos con condición (soft) en la fecha clickeada
      const softPeriods = this._getSoftPeriods(dateISO, dateISO);
      if (softPeriods.length && !(await this._confirmSoftPeriods(softPeriods))) return;

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
  static _guestAvatar(guest, size = 18, colors = []) {
    if (!guest) return '';
    const fn = guest.first_name ?? '';
    const ln = guest.last_name  ?? '';
    if (!fn && !ln) return '';
    const initials = ((fn[0] ?? '') + (ln[0] ?? '')).toUpperCase();

    // Si vienen colores de unidad, usarlos; sino fallback hash
    let bg, color;
    if (colors && colors.length === 1) {
      bg    = colors[0] + '55';
      color = colors[0];
    } else if (colors && colors.length === 2) {
      bg    = 'linear-gradient(135deg,' + colors[0] + '55 50%,' + colors[1] + '55 50%)';
      color = '#fff';
    } else if (colors && colors.length >= 3) {
      const step = Math.round(360 / colors.length);
      bg    = 'conic-gradient(' + colors.map((c, i) => c + '55 ' + (i*step) + 'deg ' + ((i+1)*step) + 'deg').join(',') + ')';
      color = '#fff';
    } else {
      const str  = (fn + ln).toLowerCase();
      let hash   = 0;
      for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
      const hue  = Math.abs(hash) % 360;
      bg    = 'hsl(' + hue + ',55%,88%)';
      color = 'hsl(' + hue + ',55%,28%)';
    }

    return '<span class="bar-avatar" style="'
      + 'display:inline-flex;align-items:center;justify-content:center;'
      + 'width:' + size + 'px;height:' + size + 'px;min-width:' + size + 'px;border-radius:50%;'
      + 'background:' + bg + ';color:' + color + ';'
      + 'font-size:' + Math.max(8, Math.round(size*.44)) + 'px;font-weight:800;'
      + 'flex-shrink:0;line-height:1;margin-right:5px;'
      + '">' + initials + '</span>';
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
    const bUnits        = booking.booking_units ?? [];

    // Si hay 2+ unidades CON precio individual cargado, mostrar el desglose
    // por departamento. Usa los pagos REALES etiquetados por unidad
    // (payments.unit_id) cuando existen; solo la porción "General" (sin
    // unidad asignada) se reparte proporcionalmente al precio de cada una.
    const bPayments = booking.payments ?? [];
    const hasPerUnitPrices = bUnits.length >= 2 && bUnits.every(bu => bu.price_per_night != null && bu.price_per_night > 0);
    const nightsCount = booking.nights ?? 0;

    let perUnitRows = '';
    if (hasPerUnitPrices) {
      const unitTotals = bUnits.map(bu => ({
        uid:   bu.unit_id,
        name:  bu.units?.name ?? '—',
        color: bu.units?.color ?? '#94A3B8',
        total: (bu.price_per_night ?? 0) * nightsCount,
      }));
      const sumTotals   = unitTotals.reduce((s,u) => s + u.total, 0) || 1;
      const generalPaid = bPayments.filter(p => !p.unit_id).reduce((s,p) => s + (p.amount ?? 0), 0);
      const hasAnyPaid  = totalPaid > 0;
      perUnitRows = `
        <div style="border-top:1px solid rgba(255,255,255,.1);padding-top:9px;margin-top:9px">
          <div style="font-size:.62rem;color:#64748B;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Por departamento</div>
          ${unitTotals.map(u => {
            const directPaid   = bPayments.filter(p => p.unit_id === u.uid).reduce((s,p) => s + (p.amount ?? 0), 0);
            const generalShare = generalPaid * (u.total / sumTotals);
            const estPaid = directPaid + generalShare;
            const estBal  = Math.max(0, u.total - estPaid);
            return `
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
              <span style="width:7px;height:7px;border-radius:50%;background:${u.color};flex-shrink:0"></span>
              <span style="font-size:.72rem;color:#CBD5E1;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.name}</span>
              <span style="font-size:.74rem;font-weight:700;color:#F8FAFC">${formatARS(u.total)}</span>
              ${hasAnyPaid ? `<span style="font-size:.66rem;color:${estBal<=0?'#34D399':'#EAB308'}">${estBal<=0?'✓':formatARS(estBal)}</span>` : ''}
            </div>`;
          }).join('')}
          ${generalPaid > 0 ? `<div style="font-size:.6rem;color:#64748B;font-style:italic;margin-top:2px">Incluye pagos generales repartidos proporcionalmente</div>` : ''}
        </div>`;
    }

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
        ${perUnitRows}
      </div>` : '';

    const tip = document.createElement('div');
    tip.className = 'cal-tooltip';
    const emitidaStr = booking.created_at
      ? new Date(booking.created_at).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
      : '';
    tip.innerHTML = `
      <div class="ct-guest">${guest}${hasBadExp ? ' <span style="color:#EF4444">⚠️</span>' : ''}</div>
      ${emitidaStr ? `<div style="font-size:.62rem;color:#64748B;margin-top:1px">Emitida ${emitidaStr}</div>` : ''}
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
      // Recompute visibleDays BEFORE shifting so prev/next stay symmetric
      this._visibleDays = this._computeVisibleDays();
      this._windowStart = this._addDays(this._windowStart, -this._visibleDays);
      cache.invalidate('bookings');
      this.load();
    });
    document.getElementById('cal-next')?.addEventListener('click', () => {
      // Recompute visibleDays BEFORE shifting so prev/next stay symmetric
      this._visibleDays = this._computeVisibleDays();
      this._windowStart = this._addDays(this._windowStart, +this._visibleDays);
      cache.invalidate('bookings');
      this.load();
    });
    document.getElementById('cal-today')?.addEventListener('click', () => {
      const isMob = window.innerWidth <= 768;
      this._windowStart = this._addDays(localToday(), -(isMob ? PAST_OFFSET_MOB : PAST_OFFSET));
      cache.invalidate('bookings');
      this.load();
    });
    document.getElementById('cal-goto-today')?.addEventListener('click', () => {
      const isMob = window.innerWidth <= 768;
      this._windowStart = this._addDays(localToday(), -(isMob ? PAST_OFFSET_MOB : PAST_OFFSET));
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

        // Navegar a la sección Calendario si no está activa
        if (typeof window.milaNav === 'function') {
          window.milaNav('calendar');
        }

        // Navegar el calendario principal a esa fecha (centrada)
        this._windowStart = this._addDays(isoDate, -PAST_OFFSET);
        cache.invalidate('bookings');
        // Pequeño delay para que la sección se active primero si hubo navegación
        setTimeout(() => this.load(), 50);
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
    document.getElementById('ctx-edit-booking')?.addEventListener('click', () => {
      if (this._ctxTarget.bookingId) this.bookingForm.openEdit(this._ctxTarget.bookingId);
      this._hideContextMenu();
    });
    document.getElementById('ctx-delete-booking')?.addEventListener('click', async () => {
      const id = this._ctxTarget.bookingId;
      this._hideContextMenu();
      if (id) await this._deleteBookingFromCalendar(id);
    });
  }

  // ── Eliminar reserva desde el menú contextual del calendario ──
  async _deleteBookingFromCalendar(id) {
    if (!can('deleteBooking')) {
      showToast('🔒 Sin permiso para eliminar reservas', 'warning');
      return;
    }
    const booking = (this._lastRenderedBookings ?? []).find(b => b.id === id);
    const guest   = booking?.guests ? `${booking.guests.first_name} ${booking.guests.last_name}` : 'esta reserva';
    const dates   = booking ? ` (${booking.check_in} → ${booking.check_out})` : '';

    if (!confirm(`¿Eliminar la reserva de ${guest}${dates}?\n\nEsta acción no se puede deshacer.`)) return;

    try {
      const { error } = await this.db.from('bookings').delete().eq('id', id);
      if (error) throw error;
      showToast('Reserva eliminada ✓', 'success');
      await logAction('DELETE', 'booking', id, `Eliminada desde calendario: ${guest}${dates}`);
      if (booking) {
        const unitNames = (booking.booking_units ?? [])
          .map(bu => bu.units?.name).filter(Boolean).join(', ') || '—';
        Bus.emit(EVENTS.BOOKING_DELETED, {
          bookingId: id, guestName: guest, unitNames,
          checkIn: booking.check_in, checkOut: booking.check_out,
        });
      }
      cache.invalidate('bookings');
      this.load();
    } catch (err) {
      console.error('[Calendar] delete error:', err);
      showToast('Error al eliminar: ' + (err.message ?? err), 'error');
    }
  }

  // ── Mostrar el set correcto de opciones: celda vacía vs. reserva existente ──
  _showContextMenu(x, y, isBooking = false) {
    const m = document.getElementById('ctx-menu');
    if (!m) return;

    document.getElementById('ctx-new-booking')?.classList.toggle('hidden', isBooking);
    document.getElementById('ctx-block')?.classList.toggle('hidden', isBooking);
    document.getElementById('ctx-edit-booking')?.classList.toggle('hidden', !isBooking || !can('editBooking'));
    document.getElementById('ctx-delete-booking')?.classList.toggle('hidden', !isBooking || !can('deleteBooking'));

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
// ═══════════════════════════════════════════════════════════════════════════
  // RANGE SELECTOR — selección de rango de fechas para anotar períodos
  // ═══════════════════════════════════════════════════════════════════════════

  _saveRangeAnnotations() {
    localStorage.setItem('cal_range_annot', JSON.stringify(this._rangeAnnotations));
  }

  _renderRangeAnnotations() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    // Limpiar overlays previos
    grid.querySelectorAll('.range-annot-overlay').forEach(el => el.remove());

    for (const ann of this._rangeAnnotations) {
      this._dateRange.forEach(iso => {
        if (iso < ann.start || iso > ann.end) return;
        // Buscar todas las celdas de este día (todas las unidades)
        grid.querySelectorAll(`.cal-cell[data-date="${iso}"]`).forEach(cell => {
          const el = document.createElement('div');
          el.className = 'range-annot-overlay';
          el.dataset.annId = ann.id;
          const isFirst = iso === ann.start || iso === this._dateRange[0];
          const isLast  = iso === ann.end;
          el.style.cssText = `
            position:absolute;top:0;left:0;right:0;height:4px;
            background:${ann.color};opacity:.75;
            border-radius:${isFirst ? '3px' : '0'} ${isLast ? '3px' : '0'} ${isLast ? '3px' : '0'} ${isFirst ? '3px' : '0'};
            pointer-events:none;z-index:5;
          `;
          if (isFirst) {
            const lbl = document.createElement('div');
            lbl.className = 'range-annot-label';
            lbl.style.cssText = `
              position:absolute;top:4px;left:2px;font-size:.58rem;font-weight:700;
              color:${ann.color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
              max-width:calc(100% - 4px);z-index:6;pointer-events:none;
              text-shadow:0 0 4px white,0 0 4px white;
              line-height:1.1;
            `;
            lbl.textContent = ann.label + (ann.minNights ? ` (min ${ann.minNights}n)` : '');
            cell.appendChild(lbl);
          }
          cell.appendChild(el);
        });
      });
    }
  }

  _setupRangeSelector(grid) {
    if (this._rangeAbort) this._rangeAbort.abort();
    this._rangeAbort = new AbortController();
    const sig = this._rangeAbort.signal;

    let selecting = false;
    let startDate = null;
    let endDate   = null;

    // ── Activar selección solo con Shift ──────────────────────────────────
    const highlight = (from, to) => {
      const [a, b] = from <= to ? [from, to] : [to, from];
      grid.querySelectorAll('.cal-cell[data-date]').forEach(c => {
        const d = c.dataset.date;
        c.classList.toggle('range-selecting', d >= a && d <= b);
      });
    };

    const clear = () => {
      grid.querySelectorAll('.range-selecting').forEach(c => c.classList.remove('range-selecting'));
    };

    grid.addEventListener('mousedown', e => {
      if (!e.shiftKey) return;
      const cell = e.target.closest('.cal-cell[data-date]');
      if (!cell) return;
      e.preventDefault();
      selecting = true;
      startDate = cell.dataset.date;
      endDate   = startDate;
      highlight(startDate, endDate);
    }, { signal: sig });

    grid.addEventListener('mousemove', e => {
      if (!selecting) return;
      const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.cal-cell[data-date]');
      if (!cell) return;
      endDate = cell.dataset.date;
      highlight(startDate, endDate);
    }, { signal: sig });

    document.addEventListener('mouseup', e => {
      if (!selecting) return;
      selecting = false;
      clear();
      if (!startDate || !endDate) return;
      const [from, to] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
      this._openRangeAnnotModal(from, to);
      startDate = endDate = null;
    }, { signal: sig });
  }

  _openRangeAnnotModal(from, to) {
    document.getElementById('range-annot-modal')?.remove();

    const COLORS = ['#f59e0b','#3b82f6','#10b981','#ef4444','#8b5cf6','#ec4899','#06b6d4','#f97316'];
    let chosenColor = COLORS[0];

    const fmt = iso => {
      const [y,m,d] = iso.split('-');
      return `${d}/${m}/${y}`;
    };
    const nights = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;

    const modal = document.createElement('div');
    modal.id = 'range-annot-modal';
    modal.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,.45);backdrop-filter:blur(3px);
    `;

    modal.innerHTML = `
      <div style="background:var(--color-surface);border-radius:16px;padding:24px;
                  width:min(420px,92vw);box-shadow:0 20px 60px rgba(0,0,0,.25);
                  border:1px solid var(--color-border)">
        <div style="font-size:1rem;font-weight:700;color:var(--color-text);margin-bottom:4px">
          📌 Etiquetar período
        </div>
        <div style="font-size:.78rem;color:var(--color-text-3);margin-bottom:16px">
          ${fmt(from)} → ${fmt(to)} · ${nights} ${nights === 1 ? 'día' : 'días'}
        </div>

        <label style="font-size:.75rem;font-weight:600;color:var(--color-text-2);display:block;margin-bottom:4px">
          Nombre del período
        </label>
        <input id="ram-label" type="text" placeholder="Ej: Finde largo, Temporada alta…"
          style="width:100%;padding:8px 10px;border:1.5px solid var(--color-border);border-radius:8px;
                 font-size:.85rem;background:var(--color-surface-2);color:var(--color-text);
                 outline:none;box-sizing:border-box;margin-bottom:12px">

        <label style="font-size:.75rem;font-weight:600;color:var(--color-text-2);display:block;margin-bottom:6px">
          Color
        </label>
        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px" id="ram-colors">
          ${COLORS.map((c,i) => `
            <div data-color="${c}" style="width:24px;height:24px;border-radius:50%;background:${c};
                 cursor:pointer;border:${i===0?'3px solid #1e293b':'2px solid transparent'};
                 box-sizing:border-box;transition:border .15s"></div>
          `).join('')}
        </div>

        <label style="font-size:.75rem;font-weight:600;color:var(--color-text-2);display:block;margin-bottom:4px">
          Mínimo de noches <span style="font-weight:400;opacity:.6">(opcional)</span>
        </label>
        <input id="ram-minnights" type="number" min="1" max="30" placeholder="Ej: 3"
          style="width:100%;padding:8px 10px;border:1.5px solid var(--color-border);border-radius:8px;
                 font-size:.85rem;background:var(--color-surface-2);color:var(--color-text);
                 outline:none;box-sizing:border-box;margin-bottom:20px">

        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="ram-cancel" style="padding:8px 18px;border-radius:8px;border:1.5px solid var(--color-border);
            background:transparent;color:var(--color-text-2);font-size:.82rem;cursor:pointer">
            Cancelar
          </button>
          <button id="ram-save" style="padding:8px 20px;border-radius:8px;border:none;
            background:#3b82f6;color:#fff;font-size:.82rem;font-weight:600;cursor:pointer">
            Guardar
          </button>
        </div>

        ${this._rangeAnnotations.length > 0 ? `
          <div style="margin-top:18px;border-top:1px solid var(--color-border);padding-top:14px">
            <div style="font-size:.72rem;font-weight:600;color:var(--color-text-3);margin-bottom:8px">
              PERÍODOS GUARDADOS
            </div>
            <div id="ram-list" style="display:flex;flex-direction:column;gap:5px">
              ${this._rangeAnnotations.map(a => `
                <div style="display:flex;align-items:center;gap:8px;font-size:.75rem;color:var(--color-text-2)">
                  <div style="width:10px;height:10px;border-radius:50%;background:${a.color};flex-shrink:0"></div>
                  <span style="flex:1">${a.label} · ${fmt(a.start)} → ${fmt(a.end)}${a.minNights ? ' · min ' + a.minNights + 'n' : ''}</span>
                  <button data-del-id="${a.id}" style="border:none;background:none;color:#ef4444;cursor:pointer;font-size:.75rem;padding:0 2px">✕</button>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>`;

    document.body.appendChild(modal);
    document.getElementById('ram-label').focus();

    // Color picker
    modal.querySelectorAll('[data-color]').forEach(dot => {
      dot.addEventListener('click', () => {
        chosenColor = dot.dataset.color;
        modal.querySelectorAll('[data-color]').forEach(d =>
          d.style.border = d.dataset.color === chosenColor ? '3px solid #1e293b' : '2px solid transparent');
      });
    });

    // Delete existing
    modal.querySelectorAll('[data-del-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._rangeAnnotations = this._rangeAnnotations.filter(a => a.id !== btn.dataset.delId);
        this._saveRangeAnnotations();
        this._renderRangeAnnotations();
        modal.remove();
      });
    });

    document.getElementById('ram-cancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    document.getElementById('ram-save').addEventListener('click', () => {
      const label = document.getElementById('ram-label').value.trim();
      if (!label) { document.getElementById('ram-label').focus(); return; }
      const minN = parseInt(document.getElementById('ram-minnights').value) || 0;
      this._rangeAnnotations.push({
        id:         Date.now().toString(36),
        start:      from,
        end:        to,
        label,
        color:      chosenColor,
        minNights:  minN || null,
      });
      this._saveRangeAnnotations();
      this._renderRangeAnnotations();
      modal.remove();
      showToast('Período guardado ✓', 'success');
    });
  }

  _setupDragSelection(grid) {
    if (this._selectionAbort) this._selectionAbort.abort();
    this._selectionAbort = new AbortController();
    const sig = this._selectionAbort.signal;

    let startUnit = null, startDate = null, endDate = null, isBlocking = false;
    let lastClientX = 0, lastClientY = 0;

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
      lastClientX = e.clientX; lastClientY = e.clientY;

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
          if (reason !== null) {
            const reasonTxt = reason.trim() || 'Bloqueo';
            // Ofrecer bloqueo multi-unidad
            const allUnits  = this.ctx.units ?? [];
            let targetUnits = [startUnit];
            if (allUnits.length > 1) {
              const blockAll = confirm(
                '¿Bloquear SOLO esta unidad?\n\n' +
                'OK = solo esta unidad\n' +
                'Cancelar = elegir cuáles bloquear'
              );
              if (!blockAll) {
                // Mostrar selector de unidades
                const unitNames = allUnits.map((u, i) => (i+1) + '. ' + u.name).join('\n');
                const sel = prompt(
                  'Ingresá los NÚMEROS de las unidades a bloquear separados por coma:\n\n' +
                  unitNames + '\n\nEj: 1,2,3 o dejar vacío para TODAS',
                  ''
                );
                if (sel === null) { /* cancelado */ }
                else if (sel.trim() === '') {
                  targetUnits = allUnits.map(u => u.id);
                } else {
                  const nums = sel.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= allUnits.length);
                  targetUnits = nums.map(n => allUnits[n-1]?.id).filter(Boolean);
                }
              }
            }
            // Bloquear todas las unidades seleccionadas
            for (const uid of targetUnits) {
              await this._blockRange(uid, d1, toISODate(last), reasonTxt);
            }
          }
        } else {
          // Chequear si hay períodos con condición (soft) en el rango seleccionado
          const softPeriods2 = this._getSoftPeriods(d1, d2);
          if (softPeriods2.length && !(await this._confirmSoftPeriods(softPeriods2))) {
            startUnit = null; startDate = null; endDate = null; isBlocking = false; return;
          }
          this._showRangeActionPopover(lastClientX, lastClientY, {
            unitId: startUnit, checkIn: d1, checkOut: toISODate(last),
          });
        }
      }
      startUnit = null; startDate = null; endDate = null; isBlocking = false;
    };

    grid.addEventListener('mousedown', onMouseDown, { signal: sig });
    document.addEventListener('mousemove', onMouseMove, { signal: sig });
    document.addEventListener('mouseup', onMouseUp, { signal: sig });
  }

  // ══════════════════════════════════════════════════
  // COTIZACIÓN RÁPIDA — mini planilla desde el calendario
  // ══════════════════════════════════════════════════

  // Al soltar el drag sobre un rango libre: menú chiquito "Reservar / Cotizar"
  // pegado al mouse, en vez de saltar directo al form de reserva.
  _showRangeActionPopover(x, y, { unitId, checkIn, checkOut }) {
    document.getElementById('cal-range-popover')?.remove();

    const unit = this.ctx.units?.find(u => u.id === unitId);
    const nights = Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
    const fmtD = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });

    const pop = document.createElement('div');
    pop.id = 'cal-range-popover';
    const PAD = 10;
    const left = Math.min(x + PAD, window.innerWidth - 210);
    const top  = Math.min(y + PAD, window.innerHeight - 130);
    pop.style.cssText = `position:fixed;left:${left}px;top:${top}px;z-index:3200;
      background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;
      box-shadow:0 12px 32px rgba(0,0,0,.25);padding:10px;width:200px;font-family:inherit`;
    pop.innerHTML = `
      <div style="font-size:.72rem;color:var(--color-text-3);margin-bottom:8px;line-height:1.3">
        ${unit ? unit.name + ' · ' : ''}${fmtD(checkIn)} → ${fmtD(checkOut)}<br>
        <strong style="color:var(--color-text)">${nights} noche${nights !== 1 ? 's' : ''}</strong>
      </div>
      <button id="rap-quote" style="width:100%;text-align:left;display:flex;align-items:center;gap:8px;
        padding:8px 10px;margin-bottom:6px;border:none;border-radius:8px;background:var(--color-surface-2);
        color:var(--color-text);font-size:.82rem;font-weight:600;cursor:pointer">
        🧮 Cotizar
      </button>
      <button id="rap-book" style="width:100%;text-align:left;display:flex;align-items:center;gap:8px;
        padding:8px 10px;border:none;border-radius:8px;background:var(--color-primary);
        color:#fff;font-size:.82rem;font-weight:600;cursor:pointer">
        🛏️ Reservar
      </button>`;
    document.body.appendChild(pop);

    const close = () => pop.remove();
    pop.querySelector('#rap-quote').addEventListener('click', () => {
      close();
      this._openQuickQuote({ unitId, checkIn, checkOut });
    });
    pop.querySelector('#rap-book').addEventListener('click', () => {
      close();
      this.bookingForm.open({ unitId, checkIn, checkOut });
    });

    setTimeout(() => {
      document.addEventListener('click', function onDoc(e) {
        if (!pop.contains(e.target)) { close(); document.removeEventListener('click', onDoc); }
      });
    }, 0);
  }

  // Panel principal — mini planilla de cotización (tipo Excel rápido)
  async _openQuickQuote({ unitId, checkIn, checkOut }, existingQuote = null) {
    document.getElementById('cal-quote-overlay')?.remove();

    const unit = this.ctx.units?.find(u => u.id === unitId);
    const fmtD = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });

    // ── Reservas REALES que se superponen — no se pueden cotizar/reservar ──
    const overlappingBookings = await fetchOverlappingBookings(this.db, this.ctx.hotelId, unitId, checkIn, checkOut);
    const occupiedDates = new Set(); // fechas (noches) tomadas por una reserva real
    overlappingBookings.forEach(b => {
      let d = new Date(b.check_in + 'T12:00:00');
      const end = new Date(b.check_out + 'T12:00:00');
      while (d < end) { occupiedDates.add(toISODate(d)); d.setDate(d.getDate() + 1); }
    });
    let bookingWarning = '';
    if (overlappingBookings.length) {
      const rows = overlappingBookings.map(b => {
        const g = b.guests ? `${b.guests.first_name ?? ''} ${b.guests.last_name ?? ''}`.trim() : 'Sin nombre';
        return `<div>🔒 <strong>${g || 'Sin nombre'}</strong> · ${this._fmtShort(b.check_in)} → ${this._fmtShort(b.check_out)}</div>`;
      }).join('');
      bookingWarning = `<div style="font-size:.72rem;background:#ef444418;color:#b91c1c;border:1px solid #ef444450;
        border-radius:8px;padding:7px 10px;margin-bottom:10px;line-height:1.6">
        ⛔ Hay ${overlappingBookings.length} reserva${overlappingBookings.length !== 1 ? 's' : ''} ya confirmada${overlappingBookings.length !== 1 ? 's' : ''} en parte de este rango — esas noches quedan bloqueadas:
        ${rows}
      </div>`;
    }

    // Precio sugerido por noche: misma fuente que el Cuadro Tarifario
    // (tarifa mensual + columnas personalizadas de fin de semana largo / temporada).
    let nightsData;
    if (existingQuote) {
      nightsData = existingQuote.nights_detail.map(n => ({ ...n }));
    } else {
      const suggested = await getSuggestedNightlyPrices(this.db, this.ctx.hotelId, unitId, checkIn, checkOut);
      nightsData = suggested.map(n => ({ date: n.date, price: n.price ?? 0, free: false, source: n.source, label: n.label }));
    }
    nightsData.forEach(n => { n.occupied = occupiedDates.has(n.date); if (n.occupied) n.free = false; });

    // Sugerencia: tramo contiguo más largo de noches libres dentro del rango,
    // para cuando algo bloquea completar la estadía tal cual se pidió.
    let suggestionHtml = '';
    if (nightsData.some(n => n.occupied)) {
      let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
      nightsData.forEach((n, i) => {
        if (!n.occupied) {
          if (curLen === 0) curStart = i;
          curLen++;
          if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
        } else { curLen = 0; }
      });
      if (bestLen > 0) {
        const startDate = nightsData[bestStart].date;
        const lastNightDate = new Date(nightsData[bestStart + bestLen - 1].date + 'T12:00:00');
        lastNightDate.setDate(lastNightDate.getDate() + 1); // checkout = día después de la última noche libre
        suggestionHtml = ` <span style="color:var(--color-text-3)">· Sugerencia: (${this._fmtShort(startDate)} al ${this._fmtShort(toISODate(lastNightDate))}) ${bestLen} noche${bestLen !== 1 ? 's' : ''}</span>`;
      }
    }

    // Avisar si ya había otra cotización abierta sobre las mismas fechas
    let overlapWarning = '';
    if (!existingQuote) {
      const overlaps = await fetchOverlappingQuotes(this.db, this.ctx.hotelId, unitId, checkIn, checkOut);
      if (overlaps.length) {
        overlapWarning = `<div style="font-size:.72rem;background:#f59e0b18;color:#b45309;border:1px solid #f59e0b40;
          border-radius:8px;padding:7px 10px;margin-bottom:10px">
          ⚠️ Ya hay ${overlaps.length} cotización${overlaps.length !== 1 ? 'es' : ''} sin convertir para fechas superpuestas.
        </div>`;
      }
    }

    let discountMode  = existingQuote?.discount_mode  ?? 'pct';
    let discountValue = existingQuote?.discount_value  ?? 0;
    let surchargeMode  = existingQuote?.surcharge_mode ?? 'pct';
    let surchargeValue = existingQuote?.surcharge_value ?? 0;
    let lateCheckout       = existingQuote?.late_checkout ?? false;
    let lateCheckoutPaid   = existingQuote?.late_checkout_paid ?? true;
    let lateCheckoutAmount = existingQuote?.late_checkout_amount ?? '';
    let guestName = existingQuote?.guest_name ?? '';
    let adults    = existingQuote?.adults   ?? 2;
    let children  = existingQuote?.children ?? 0;
    let quoteNotes = existingQuote?.notes ?? '';

    const ov = document.createElement('div');
    ov.id = 'cal-quote-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3300;display:flex;align-items:center;justify-content:center;padding:14px';
    ov.innerHTML = `
      <div id="cal-quote-modal" style="background:var(--color-surface);border-radius:16px;padding:20px;
        width:640px;max-width:96vw;max-height:92vh;overflow-y:auto;box-shadow:0 24px 70px rgba(0,0,0,.4)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="font-weight:800;font-size:1.02rem">🧮 Cotización rápida</div>
          <button id="cq-close" style="border:none;background:none;font-size:1.2rem;cursor:pointer;color:var(--color-text-3);line-height:1">✕</button>
        </div>
        <div style="font-size:.78rem;color:var(--color-text-3);margin-bottom:12px">
          ${unit?.name ?? 'Unidad'} · ${fmtD(checkIn)} → ${fmtD(checkOut)}
        </div>
        ${bookingWarning}
        ${overlapWarning}

        <div style="display:flex;gap:8px;margin-bottom:12px">
          <input id="cq-guest" type="text" placeholder="Nombre del huésped (opcional)" value="${guestName.replace(/"/g,'&quot;')}"
            style="flex:2;min-width:0;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--color-border);
            background:var(--color-surface-2);color:var(--color-text);font-size:.82rem">
          <input id="cq-adults" type="number" min="1" step="1" value="${adults}" title="Adultos"
            style="flex:0 0 56px;box-sizing:border-box;padding:8px 4px;border-radius:8px;border:1px solid var(--color-border);
            background:var(--color-surface-2);color:var(--color-text);font-size:.82rem;text-align:center">
          <span style="font-size:.68rem;color:var(--color-text-3);align-self:center">ad.</span>
          <input id="cq-children" type="number" min="0" step="1" value="${children}" title="Niños"
            style="flex:0 0 56px;box-sizing:border-box;padding:8px 4px;border-radius:8px;border:1px solid var(--color-border);
            background:var(--color-surface-2);color:var(--color-text);font-size:.82rem;text-align:center">
          <span style="font-size:.68rem;color:var(--color-text-3);align-self:center">niños</span>
        </div>

        <div style="font-size:.7rem;font-weight:700;color:var(--color-text-3);margin-bottom:6px">
          PRECIO POR NOCHE · tocá una celda para editarla
        </div>
        <div id="cq-grid" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px"></div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:8px;margin-bottom:14px">
          <div style="background:var(--color-surface-2);border-radius:10px;padding:8px 10px">
            <div style="font-size:.68rem;color:var(--color-text-3);margin-bottom:4px;font-weight:600">DESCUENTO</div>
            <div style="display:flex;gap:5px">
              <input id="cq-disc-val" type="number" min="0" step="any" value="${discountValue || ''}" placeholder="0"
                style="min-width:0;flex:1 1 auto;padding:5px 6px;border-radius:6px;border:1px solid var(--color-border);
                background:var(--color-surface);color:var(--color-text);font-size:.82rem">
              <select id="cq-disc-mode" style="flex:0 0 46px;width:46px;padding:5px 2px;border-radius:6px;
                border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);font-size:.78rem">
                <option value="pct" ${discountMode === 'pct' ? 'selected' : ''}>%</option>
                <option value="amt" ${discountMode === 'amt' ? 'selected' : ''}>$</option>
              </select>
            </div>
          </div>
          <div style="background:var(--color-surface-2);border-radius:10px;padding:8px 10px">
            <div style="font-size:.68rem;color:var(--color-text-3);margin-bottom:4px;font-weight:600">RECARGO</div>
            <div style="display:flex;gap:5px">
              <input id="cq-surc-val" type="number" min="0" step="any" value="${surchargeValue || ''}" placeholder="0"
                style="min-width:0;flex:1 1 auto;padding:5px 6px;border-radius:6px;border:1px solid var(--color-border);
                background:var(--color-surface);color:var(--color-text);font-size:.82rem">
              <select id="cq-surc-mode" style="flex:0 0 46px;width:46px;padding:5px 2px;border-radius:6px;
                border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);font-size:.78rem">
                <option value="pct" ${surchargeMode === 'pct' ? 'selected' : ''}>%</option>
                <option value="amt" ${surchargeMode === 'amt' ? 'selected' : ''}>$</option>
              </select>
            </div>
          </div>
          <div style="background:var(--color-surface-2);border-radius:10px;padding:8px 10px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:.68rem;font-weight:600;color:var(--color-text-3)">🌅 LATE CHECK-OUT</span>
              <input type="checkbox" id="cq-lco" ${lateCheckout ? 'checked' : ''}
                style="width:14px;height:14px;cursor:pointer;margin:0;accent-color:var(--color-primary)">
            </div>
            <div id="cq-lco-opts" style="display:${lateCheckout ? 'flex' : 'none'};align-items:center;gap:6px;
              border:1px solid var(--color-border);border-radius:6px;background:var(--color-surface);padding:4px 6px;height:20px">
              <label style="display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;white-space:nowrap;flex-shrink:0">
                <input type="checkbox" id="cq-lco-paid" ${lateCheckoutPaid ? 'checked' : ''} style="width:12px;height:12px;cursor:pointer;margin:0">
                <span id="cq-lco-paid-label" style="font-size:.68rem;color:var(--color-text-2);white-space:nowrap">${lateCheckoutPaid ? '✅ Se cobra' : '🎁 Sin cargo'}</span>
              </label>
              <input id="cq-lco-amount" type="number" min="0" step="500" value="${lateCheckoutAmount || ''}"
                placeholder="½ noche" ${lateCheckoutPaid ? '' : 'disabled'}
                style="flex:1;min-width:0;border:none;background:transparent;color:var(--color-text);
                font-size:.78rem;font-weight:600;padding:0;${lateCheckoutPaid ? '' : 'opacity:.5'}">
            </div>
            <div id="cq-lco-hint" style="display:${lateCheckout ? 'none' : 'flex'};align-items:center;height:20px;
              padding:4px 6px;font-size:.66rem;color:var(--color-text-3);opacity:.6">Tocá el switch para activar</div>
          </div>
        </div>

        <textarea id="cq-notes" placeholder="Notas (ej: condición especial, forma de pago acordada...)"
          style="width:100%;box-sizing:border-box;min-height:44px;padding:8px 10px;border-radius:8px;
          border:1px solid var(--color-border);background:var(--color-surface-2);color:var(--color-text);
          font-size:.78rem;resize:vertical;margin-bottom:14px">${quoteNotes}</textarea>

        <div style="border-top:1px solid var(--color-border);padding-top:12px;display:flex;
          align-items:center;justify-content:space-between;margin-bottom:16px">
          <div id="cq-summary-nights" style="font-size:.82rem;color:var(--color-text-2)"></div>
          <div id="cq-summary-total" style="font-size:1.15rem;font-weight:800;color:var(--color-text)"></div>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          <button id="cq-cancel" style="padding:9px 16px;border-radius:9px;border:1px solid var(--color-border);
            background:none;color:var(--color-text-2);font-size:.82rem;cursor:pointer;font-weight:600">Cancelar</button>
          <button id="cq-save" style="padding:9px 16px;border-radius:9px;border:1px solid var(--color-border);
            background:var(--color-surface-2);color:var(--color-text);font-size:.82rem;cursor:pointer;font-weight:700">
            💾 Guardar cotización</button>
          <button id="cq-convert" style="padding:9px 18px;border-radius:9px;border:none;
            background:var(--color-primary);color:#fff;font-size:.82rem;cursor:pointer;font-weight:800">
            ✓ Convertir en reserva</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    // "🔀 Completar estadía en otra unidad" — para una noche puntual
    // bloqueada. Busca unidades disponibles ESA noche con capacidad
    // suficiente para adultos+niños (misma lógica de disponibilidad que
    // ya usa "Dividir estadía" en el form de reserva).
    const openAltUnitPicker = async (n, cell) => {
      document.getElementById('cal-altunit-popover')?.remove();

      const adultsN   = parseInt(document.getElementById('cq-adults')?.value)   || 1;
      const childrenN = parseInt(document.getElementById('cq-children')?.value) || 0;
      const totalPax  = adultsN + childrenN;
      const nextDate  = toISODate(new Date(new Date(n.date + 'T12:00:00').getTime() + 86400000));

      const pop = document.createElement('div');
      pop.id = 'cal-altunit-popover';
      const rect = cell.getBoundingClientRect();
      pop.style.cssText = `position:fixed;left:${Math.min(rect.left, window.innerWidth - 230)}px;
        top:${rect.bottom + 6}px;z-index:3400;background:var(--color-surface);border:1px solid var(--color-border);
        border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.3);padding:8px;width:220px;font-family:inherit`;
      pop.innerHTML = `<div style="font-size:.68rem;color:var(--color-text-3);padding:4px 6px">Buscando unidades libres…</div>`;
      document.body.appendChild(pop);
      const closePop = () => pop.remove();
      setTimeout(() => document.addEventListener('click', function onDoc(e) {
        if (!pop.contains(e.target)) { closePop(); document.removeEventListener('click', onDoc); }
      }), 0);

      let list = [];
      try { list = await fetchAvailableUnitsForNight(this.db, this.ctx.hotelId, this.ctx.units, n.date, unitId); } catch { /* red/servicio caído */ }
      if (!document.body.contains(pop)) return; // se cerró mientras esperaba

      const candidates = list.filter(u => (u.max_guests ?? 99) >= totalPax);

      if (!candidates.length) {
        pop.innerHTML = `<div style="font-size:.72rem;color:var(--color-text-2);padding:4px 6px;line-height:1.4">
          No hay otra unidad libre esa noche con capacidad para ${totalPax} pasajero${totalPax !== 1 ? 's' : ''}.
        </div>`;
        return;
      }

      pop.innerHTML = `<div style="font-size:.66rem;font-weight:700;color:var(--color-text-3);padding:2px 6px 6px">
        ${this._fmtShort(n.date)} · ${totalPax} pasajero${totalPax !== 1 ? 's' : ''} — elegí unidad</div>` +
        candidates.map(c => `<button type="button" data-alt-id="${c.id}" style="display:flex;align-items:center;justify-content:space-between;
            width:100%;text-align:left;padding:6px 8px;border:none;border-radius:7px;background:var(--color-surface-2);
            color:var(--color-text);font-size:.78rem;font-weight:600;cursor:pointer;margin-bottom:4px">
            <span>${c.sort_order ? `#${c.sort_order} · ` : ''}${c.name}</span>
            <span style="font-size:.66rem;color:var(--color-text-3);font-weight:500">👥 ${c.max_guests ?? '—'}</span>
          </button>`).join('');

      pop.querySelectorAll('[data-alt-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const altUnitId = btn.dataset.altId;
          closePop();
          let price = 0;
          try {
            const suggested = await getSuggestedNightlyPrices(this.db, this.ctx.hotelId, altUnitId, n.date, nextDate);
            price = suggested?.[0]?.price ?? 0;
          } catch { /* si falla, el usuario la carga a mano */ }
          n.altUnitId = altUnitId;
          n.occupied  = false;
          n.free      = false;
          n.price     = price;
          const idx = nightsData.findIndex(x => x.date === n.date);
          const fresh = renderCell(n);
          grid.replaceChild(fresh, grid.children[idx]);
          recalc();
          showToast('Noche completada con otra unidad — revisá el precio sugerido', 'success');
        });
      });
    };

    // ── Render de la planilla (una celda por noche) ──
    const grid = document.getElementById('cq-grid');
    const renderCell = (n) => {
      const d = new Date(n.date + 'T12:00:00');
      const wknd = isWeekend(n.date);
      const dayLbl = d.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '');
      const dateLbl = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
      const cell = document.createElement('div');
      cell.className = 'cq-cell';
      cell.dataset.date = n.date;
      cell.style.cssText = `min-width:78px;flex:1 0 78px;border:1px solid var(--color-border);
        border-radius:9px;padding:6px 7px;background:${n.occupied ? '#ef444414' : n.free ? '#22c55e12' : wknd ? 'var(--color-surface-2)' : 'var(--color-surface)'};
        ${n.occupied ? 'border-color:#ef444460' : wknd && !n.free ? 'border-color:#f59e0b55' : ''}`;
      if (n.occupied) {
        cell.innerHTML = `
          <div style="font-size:.62rem;color:var(--color-text-3);display:flex;justify-content:space-between">
            <span style="text-transform:capitalize">${dayLbl}</span><span>${dateLbl}</span>
          </div>
          <div style="margin-top:8px;text-align:center;font-size:.66rem;font-weight:700;color:#b91c1c">🔒 Ocupada</div>
          <button type="button" data-alt-unit-btn
            style="width:100%;margin-top:5px;padding:3px 2px;border-radius:6px;border:1px dashed #ef444460;
            background:none;color:#b91c1c;font-size:.6rem;font-weight:700;cursor:pointer">🔀 Otra unidad</button>`;
        cell.querySelector('[data-alt-unit-btn]').addEventListener('click', (e) => {
          e.stopPropagation();
          openAltUnitPicker(n, cell);
        });
        return cell;
      }
      if (n.altUnitId) {
        const altUnit = this.ctx.units?.find(u => u.id === n.altUnitId);
        cell.style.borderColor = '#8b5cf660';
        cell.innerHTML = `
          <div style="font-size:.62rem;color:var(--color-text-3);display:flex;justify-content:space-between">
            <span style="text-transform:capitalize">${dayLbl}</span><span>${dateLbl}</span>
          </div>
          <div style="font-size:.56rem;color:#8b5cf6;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
            display:flex;align-items:center;justify-content:space-between">
            <span>🔀 ${altUnit?.name ?? 'Otra unidad'}</span>
            <span data-undo-alt style="cursor:pointer;font-weight:800" title="Deshacer">✕</span>
          </div>
        <input type="number" min="0" step="any" value="${n.free ? 0 : n.price}" ${n.free ? 'disabled' : ''}
          data-price-input
          style="width:100%;box-sizing:border-box;margin-top:3px;padding:3px 4px;border-radius:6px;
          border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);
          font-size:.82rem;font-weight:700;${n.free ? 'opacity:.5' : ''}">
        <label style="display:flex;align-items:center;gap:4px;margin-top:4px;font-size:.6rem;color:var(--color-text-3);cursor:pointer">
          <input type="checkbox" data-free-toggle ${n.free ? 'checked' : ''} style="margin:0"> sin cargo
        </label>`;
        cell.querySelector('[data-undo-alt]').addEventListener('click', (e) => {
          e.stopPropagation();
          n.altUnitId = null;
          n.occupied  = true; // vuelve a estar bloqueada por la reserva real
          n.free = false;
          const idx = nightsData.findIndex(x => x.date === n.date);
          const fresh = renderCell(n);
          grid.replaceChild(fresh, grid.children[idx]);
          recalc();
        });
        return cell;
      }
      cell.innerHTML = `
        <div style="font-size:.62rem;color:var(--color-text-3);display:flex;justify-content:space-between">
          <span style="text-transform:capitalize">${dayLbl}</span><span>${dateLbl}</span>
        </div>
        ${n.label ? `<div style="font-size:.56rem;color:#f59e0b;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.label}</div>` : ''}
        <input type="number" min="0" step="any" value="${n.free ? 0 : n.price}" ${n.free ? 'disabled' : ''}
          data-price-input
          style="width:100%;box-sizing:border-box;margin-top:3px;padding:3px 4px;border-radius:6px;
          border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);
          font-size:.82rem;font-weight:700;${n.free ? 'opacity:.5' : ''}">
        <label style="display:flex;align-items:center;gap:4px;margin-top:4px;font-size:.6rem;color:var(--color-text-3);cursor:pointer">
          <input type="checkbox" data-free-toggle ${n.free ? 'checked' : ''} style="margin:0"> sin cargo
        </label>`;
      return cell;
    };

    grid.innerHTML = '';
    nightsData.forEach(n => grid.appendChild(renderCell(n)));

    const recalc = () => {
      let subtotal = 0, chargedNights = 0;
      grid.querySelectorAll('.cq-cell').forEach(cell => {
        const date  = cell.dataset.date;
        const n     = nightsData.find(x => x.date === date);
        if (n.occupied) return; // noche bloqueada por reserva real — no entra en el cálculo
        const free  = cell.querySelector('[data-free-toggle]').checked;
        const input = cell.querySelector('[data-price-input]');
        n.free  = free;
        n.price = free ? 0 : (parseFloat(input.value) || 0);
        input.disabled = free;
        input.style.opacity = free ? '.5' : '1';
        cell.style.background = free ? '#22c55e12' : (isWeekend(date) ? 'var(--color-surface-2)' : 'var(--color-surface)');
        if (!free) { subtotal += n.price; chargedNights++; }
      });

      const discMode = document.getElementById('cq-disc-mode').value;
      const discRaw  = parseFloat(document.getElementById('cq-disc-val').value) || 0;
      const discAmt  = discMode === 'pct' ? Math.round(subtotal * discRaw / 100) : discRaw;

      const surcMode = document.getElementById('cq-surc-mode').value;
      const surcRaw  = parseFloat(document.getElementById('cq-surc-val').value) || 0;
      const surcAmt  = surcMode === 'pct' ? Math.round(subtotal * surcRaw / 100) : surcRaw;

      const lcoOn    = document.getElementById('cq-lco').checked;
      const lcoPaid  = lcoOn && document.getElementById('cq-lco-paid').checked;
      const avgNight = chargedNights > 0 ? subtotal / chargedNights : 0;
      const lcoAmt   = lcoPaid ? (parseFloat(document.getElementById('cq-lco-amount').value) || Math.round(avgNight * 0.5)) : 0;

      const total = Math.max(0, subtotal - discAmt + surcAmt + lcoAmt);
      const freeCount = nightsData.filter(n => n.free).length;
      const occCount  = nightsData.filter(n => n.occupied).length;
      const altCount  = nightsData.filter(n => n.altUnitId).length;

      document.getElementById('cq-summary-nights').innerHTML =
        `${nightsData.length} noche${nightsData.length !== 1 ? 's' : ''}` +
        (occCount  ? ` <span style="color:#ef4444">· ${occCount} ocupada${occCount !== 1 ? 's' : ''}</span>${suggestionHtml}` : '') +
        (altCount  ? ` <span style="color:#8b5cf6">· ${altCount} en otra unidad</span>` : '') +
        (freeCount ? ` <span style="color:#22c55e">· ${freeCount} sin cargo</span>` : '') +
        (discAmt ? ` <span style="color:#ef4444">· −${formatARS(discAmt)}</span>` : '') +
        (surcAmt ? ` <span style="color:#f59e0b">· +${formatARS(surcAmt)}</span>` : '') +
        (lcoOn ? ` <span style="color:#8b5cf6">· 🌅 ${lcoPaid ? '+' + formatARS(lcoAmt) : 'sin cargo'}</span>` : '');
      document.getElementById('cq-summary-total').textContent = `TOTAL ${formatARS(total)}`;

      const convertBtn = document.getElementById('cq-convert');
      if (convertBtn) {
        convertBtn.disabled = occCount > 0;
        convertBtn.style.opacity = occCount > 0 ? '.5' : '1';
        convertBtn.style.cursor  = occCount > 0 ? 'not-allowed' : 'pointer';
        convertBtn.title = occCount > 0 ? 'Hay noches ocupadas por otra reserva — no se puede convertir' : '';
      }

      return { subtotal, discAmt, surcAmt, lcoOn, lcoPaid, lcoAmt, total, discMode, discRaw, surcMode, surcRaw };
    };

    grid.addEventListener('input', recalc);
    grid.addEventListener('change', recalc);
    document.getElementById('cq-disc-val').addEventListener('input', recalc);
    document.getElementById('cq-disc-mode').addEventListener('change', recalc);
    document.getElementById('cq-surc-val').addEventListener('input', recalc);
    document.getElementById('cq-surc-mode').addEventListener('change', recalc);

    // Late check-out: mismo patrón que el form de reserva — el checkbox
    // principal muestra "¿Se cobra?", que a su vez muestra el monto.
    const lcoBox   = document.getElementById('cq-lco');
    const lcoOpts  = document.getElementById('cq-lco-opts');
    const lcoHint  = document.getElementById('cq-lco-hint');
    const lcoPaidCb = document.getElementById('cq-lco-paid');
    const lcoAmtEl = document.getElementById('cq-lco-amount');
    const lcoPaidLabel = document.getElementById('cq-lco-paid-label');
    lcoBox.addEventListener('change', () => {
      lcoOpts.style.display = lcoBox.checked ? 'flex' : 'none';
      lcoHint.style.display = lcoBox.checked ? 'none' : 'flex';
      recalc();
    });
    lcoPaidCb.addEventListener('change', () => {
      lcoAmtEl.disabled = !lcoPaidCb.checked;
      lcoAmtEl.style.opacity = lcoPaidCb.checked ? '1' : '.5';
      lcoPaidLabel.textContent = lcoPaidCb.checked ? '✅ Se cobra' : '🎁 Sin cargo';
      recalc();
    });
    lcoAmtEl.addEventListener('input', recalc);

    recalc();

    const close = () => ov.remove();
    document.getElementById('cq-close').addEventListener('click', close);
    document.getElementById('cq-cancel').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });

    const buildPayload = () => {
      const calc = recalc();
      return {
        hotel_id:        this.ctx.hotelId,
        unit_id:         unitId,
        check_in:        checkIn,
        check_out:       checkOut,
        nights_detail:   nightsData.map(n => ({ date: n.date, price: n.price, free: !!n.free, occupied: !!n.occupied, altUnitId: n.altUnitId ?? null })),
        discount_mode:   calc.discRaw ? calc.discMode : null,
        discount_value:  calc.discRaw || 0,
        surcharge_mode:  calc.surcRaw ? calc.surcMode : null,
        surcharge_value: calc.surcRaw || 0,
        late_checkout:        calc.lcoOn,
        late_checkout_paid:   calc.lcoOn ? calc.lcoPaid : null,
        late_checkout_amount: calc.lcoOn && calc.lcoPaid ? calc.lcoAmt : null,
        subtotal:        calc.subtotal,
        total:            calc.total,
        guest_name:       document.getElementById('cq-guest').value.trim() || null,
        adults:           parseInt(document.getElementById('cq-adults')?.value)   || 2,
        children:         parseInt(document.getElementById('cq-children')?.value) || 0,
        notes:            document.getElementById('cq-notes').value.trim() || null,
        created_by:       AppContext.user?.id ?? null,
      };
    };

    document.getElementById('cq-save').addEventListener('click', async () => {
      const payload = buildPayload();
      const btn = document.getElementById('cq-save');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        const { data, error } = existingQuote
          ? await updateQuote(this.db, existingQuote.id, payload)
          : await createQuote(this.db, payload);
        if (error) throw error;
        showToast('Cotización guardada ✓', 'success');
        close();
      } catch (err) {
        showToast('Error al guardar la cotización', 'error');
        btn.disabled = false; btn.textContent = '💾 Guardar cotización';
      }
    });

    document.getElementById('cq-convert').addEventListener('click', async () => {
      const payload = buildPayload();
      if (nightsData.some(n => n.occupied)) {
        showToast('Hay noches ocupadas por otra reserva en este rango — no se puede convertir', 'error');
        return;
      }
      if (!payload.total || payload.nights_detail.every(n => n.free)) {
        if (!confirm('El total es $0 — ¿convertir en reserva de todas formas?')) return;
      }

      const hasSplit = payload.nights_detail.some(n => n.altUnitId);
      if (hasSplit && !payload.guest_name) {
        showToast('Para dividir la estadía entre 2 unidades, cargá el nombre del huésped', 'error');
        return;
      }

      // Guardar (o actualizar) la cotización primero, para no perder el
      // detalle noche a noche aunque la reserva quede con precio promedio.
      const { data: savedQuote, error } = existingQuote
        ? await updateQuote(this.db, existingQuote.id, payload)
        : await createQuote(this.db, payload);
      if (error) { showToast('Error al guardar la cotización', 'error'); return; }

      if (hasSplit) {
        close();
        await this._createSplitBooking(payload, savedQuote.id, unitId, checkIn, checkOut);
        return;
      }

      const billableNights = payload.nights_detail.filter(n => !n.free).length;
      const freeCount      = payload.nights_detail.length - billableNights;

      // IMPORTANTE — "noche sin cargo" es una noche de estadía BONIFICADA,
      // no una noche extra a cobrar. El form de reserva ya tiene su propio
      // campo nativo `f-free-nights` (cantidad de noches) que resta del
      // total facturable: billable = noches_totales − noches_sin_cargo.
      // Antes acá promediábamos el total ya neto de todo entre TODAS las
      // noches, y como el form multiplica precio × noches_totales (sin
      // saber de la noche gratis), esa noche terminaba cobrándose igual.
      // Ahora: el precio que mandamos es el promedio de las noches PAGAS
      // únicamente, y la cantidad de noches sin cargo se traslada tal
      // cual al campo nativo — así el form la resta correctamente y las
      // fechas de check-in/check-out no se tocan (sigue siendo la misma
      // estadía completa, solo que 1 noche queda bonificada).
      const avgPrice = billableNights > 0 ? Math.round(payload.subtotal / billableNights) : 0;

      // El form de reserva sólo admite un precio único por noche —
      // el desglose exacto (que puede variar por noche, ej. finde largo)
      // queda además en las notas para no perder el detalle cotizado.
      const detailLines = payload.nights_detail
        .map(n => `${this._fmtShort(n.date)}: ${n.free ? 'sin cargo' : formatARS(n.price)}`)
        .join(' · ');
      const notesForBooking = [
        '🧮 Cotización aplicada:',
        detailLines,
        `TOTAL cotizado: ${formatARS(payload.total)}`,
        payload.notes ? `Notas: ${payload.notes}` : '',
      ].filter(Boolean).join('\n');

      close();

      const unsub = Bus.on(EVENTS.BOOKING_CREATED, ({ bookingId }) => {
        markQuoteConverted(this.db, savedQuote.id, bookingId);
        unsub();
      });

      this.bookingForm.open({
        unitId, checkIn, checkOut,
        price: avgPrice,
        notes: notesForBooking,
      });

      const setAndFire = (id, val, evt = 'input') => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = val;
        el.dispatchEvent(new Event(evt, { bubbles: true }));
      };

      if (payload.guest_name) {
        const [fn, ...rest] = payload.guest_name.split(' ');
        const fnEl = document.getElementById('f-firstname');
        const lnEl = document.getElementById('f-lastname');
        if (fnEl) fnEl.value = fn;
        if (lnEl) lnEl.value = rest.join(' ');
      }

      // ── Noches sin cargo: dato que se traslada explícitamente ──
      if (freeCount > 0) setAndFire('f-free-nights', freeCount);

      // ── Descuento / recargo: van a sus propios campos nativos,
      //    ya NO se mezclan dentro del precio promedio ──
      if (payload.discount_value) {
        const modeEl = document.getElementById('f-discount-mode');
        if (modeEl) modeEl.value = payload.discount_mode;
        setAndFire('f-discount', payload.discount_value);
      }
      if (payload.surcharge_value) {
        const modeEl = document.getElementById('f-surcharge-mode');
        if (modeEl) modeEl.value = payload.surcharge_mode;
        setAndFire('f-surcharge', payload.surcharge_value);
      }

      // Trasladar el Late Check-out tal cual quedó cotizado — mismos
      // campos y misma lógica que ya usa el form de reserva.
      if (payload.late_checkout) {
        const lcoEl = document.getElementById('f-late-checkout');
        if (lcoEl) {
          lcoEl.checked = true;
          lcoEl.dispatchEvent(new Event('change', { bubbles: true }));
          const paidEl = document.getElementById('f-late-checkout-paid');
          if (paidEl) {
            paidEl.checked = !!payload.late_checkout_paid;
            paidEl.dispatchEvent(new Event('change', { bubbles: true }));
            if (payload.late_checkout_paid && payload.late_checkout_amount) {
              const amtEl = document.getElementById('f-late-checkout-amount');
              if (amtEl) { amtEl.value = payload.late_checkout_amount; amtEl.dispatchEvent(new Event('input', { bubbles: true })); }
            }
          }
        }
      }

      if (freeCount > 0) {
        showToast(`Reserva precargada: ${freeCount} noche${freeCount !== 1 ? 's' : ''} sin cargo aplicada${freeCount !== 1 ? 's' : ''} — no se cobra${freeCount !== 1 ? 'n' : ''}`, 'info');
      }
    });
  }

  // ══════════════════════════════════════════════════
  // ESTADÍA DIVIDIDA — 1 sola reserva, 2 unidades por tramos de fecha.
  // Camino aislado (no toca booking-form.js): mismo huésped, misma
  // estadía total, mismo descuento/recargo/late-checkout — solo cambia
  // qué unidad cubre cada noche. Se llama únicamente cuando alguna noche
  // de la Cotización Rápida quedó resuelta con "🔀 Completar en otra unidad".
  // ══════════════════════════════════════════════════
  async _createSplitBooking(payload, quoteId, primaryUnitId, checkIn, checkOut) {
    showToast('Creando reserva dividida…', 'info');
    try {
      const billableNights = payload.nights_detail.filter(n => !n.free).length;
      const freeCount      = payload.nights_detail.length - billableNights;
      const avgPrice       = billableNights > 0 ? Math.round(payload.subtotal / billableNights) : 0;

      // Mismas conversiones %/$ que usa booking-form.js al guardar, para
      // que el trigger de la base (recalculate_booking_totals) calcule
      // exactamente lo mismo que ya calculó esta planilla.
      const discPct = payload.discount_mode === 'amt'
        ? (payload.subtotal > 0 ? Math.min(100, (payload.discount_value / payload.subtotal) * 100) : 0)
        : (payload.discount_value || 0);
      const surchAmt = payload.surcharge_mode === 'pct'
        ? Math.round(payload.subtotal * (payload.surcharge_value || 0) / 100)
        : (payload.surcharge_value || 0);
      const discAmt  = Math.round(payload.subtotal * (discPct / 100));
      const lateAmt  = (payload.late_checkout && payload.late_checkout_paid)
        ? Math.round(payload.late_checkout_amount || avgPrice * 0.5) : 0;
      const total    = Math.max(0, payload.subtotal - discAmt + surchAmt + lateAmt);

      // ── Agrupar noches por unidad (primaria + cada unidad alternativa) ──
      const segmentFor = (dates) => {
        const sorted = dates.slice().sort();
        const to = new Date(sorted[sorted.length - 1] + 'T12:00:00');
        to.setDate(to.getDate() + 1);
        return { from: sorted[0], to: toISODate(to) };
      };
      // Precio real de ESA unidad (promedio de sus propias noches pagas) —
      // más preciso que repartir el promedio general entre las 2 unidades,
      // y consistente con cómo el resto de la app ya usa booking_units.price_per_night
      // para el desglose "por departamento" (tooltips, finanzas, estadísticas).
      const avgPriceFor = (dates) => {
        const nights = payload.nights_detail.filter(n => dates.includes(n.date) && !n.free);
        if (!nights.length) return 0;
        return Math.round(nights.reduce((s, n) => s + n.price, 0) / nights.length);
      };
      const primaryDates = payload.nights_detail.filter(n => !n.altUnitId).map(n => n.date);
      const altGroups = new Map();
      payload.nights_detail.forEach(n => {
        if (!n.altUnitId) return;
        if (!altGroups.has(n.altUnitId)) altGroups.set(n.altUnitId, []);
        altGroups.get(n.altUnitId).push(n.date);
      });
      const unitLabel = (id) => this.ctx.units?.find(u => u.id === id)?.name ?? 'Unidad';

      const unitSegments = [];
      if (primaryDates.length) {
        unitSegments.push({ unit_id: primaryUnitId, price_per_night: avgPriceFor(primaryDates), ...segmentFor(primaryDates) });
      }
      altGroups.forEach((dates, altId) => {
        unitSegments.push({ unit_id: altId, price_per_night: avgPriceFor(dates), ...segmentFor(dates) });
      });

      // ── Huésped: la Cotización Rápida solo pide el nombre — se crea
      //    un huésped mínimo, editable después desde la reserva ──────
      const [fn, ...rest] = payload.guest_name.trim().split(' ');
      const { data: newGuest, error: gErr } = await this.db.from('guests').insert({
        hotel_id: this.ctx.hotelId, first_name: fn || 'Huésped', last_name: rest.join(' ') || '',
      }).select('id').single();
      if (gErr) throw new Error('No fue posible crear el huésped: ' + gErr.message);

      const detailLines = payload.nights_detail
        .map(n => `${this._fmtShort(n.date)}: ${n.free ? 'sin cargo' : formatARS(n.price)}${n.altUnitId ? ` (${unitLabel(n.altUnitId)})` : ''}`)
        .join(' · ');
      const segmentLines = unitSegments
        .map(s => `${unitLabel(s.unit_id)}: ${this._fmtShort(s.from)} → ${this._fmtShort(s.to)}`)
        .join(' · ');
      const notesForBooking = [
        '🔀 Estadía dividida entre 2 unidades:',
        segmentLines,
        '🧮 Cotización aplicada:',
        detailLines,
        `TOTAL cotizado: ${formatARS(payload.total)}`,
        payload.notes ? `Notas: ${payload.notes}` : '',
      ].filter(Boolean).join('\n');

      const corePayload = {
        hotel_id: this.ctx.hotelId,
        guest_id: newGuest.id,
        check_in: checkIn,
        check_out: checkOut,
        source: 'direct',
        price_per_night: avgPrice,
        discount_pct: discPct,
        surcharge_amount: surchAmt,
        total_amount: total,
        total_paid: 0,
        balance: total,
        notes: notesForBooking,
        status: 'pending',
        late_checkout: !!payload.late_checkout,
        late_checkout_charged: payload.late_checkout ? !!payload.late_checkout_paid : true,
      };

      let { data: newB, error: insErr } = await this.db.from('bookings')
        .insert({ ...corePayload, free_nights: freeCount }).select('id').single();
      if (insErr?.message?.includes('free_nights') || insErr?.message?.includes('does not exist')) {
        const retry = await this.db.from('bookings').insert(corePayload).select('id').single();
        newB = retry.data; insErr = retry.error;
      }
      if (insErr) throw new Error('No fue posible crear la reserva: ' + insErr.message);

      try {
        await this.db.from('bookings').update({
          pax: (payload.adults || 2) + (payload.children || 0),
          adults: payload.adults || 2, children: payload.children || 0,
        }).eq('id', newB.id);
      } catch { /* columnas opcionales, silencioso */ }

      let { error: buErr } = await this.db.from('booking_units').insert(
        unitSegments.map(s => ({
          booking_id: newB.id, unit_id: s.unit_id, price_per_night: s.price_per_night,
          segment_check_in: s.from, segment_check_out: s.to,
        }))
      );
      if (buErr?.message?.includes('segment_check_in') || buErr?.message?.includes('does not exist')) {
        // Migración de "estadía dividida" no corrida todavía en esta base —
        // reintentamos sin los tramos para no dejar la reserva sin unidades
        // asignadas (huérfana). Igual quedan las 2 unidades en la reserva,
        // solo que sin el corte de fechas — ver notas de la reserva.
        console.warn('[SplitBooking] Falta correr migration_quick_quotes.sql — guardando sin tramos de fecha');
        const retry = await this.db.from('booking_units').insert(
          unitSegments.map(s => ({ booking_id: newB.id, unit_id: s.unit_id, price_per_night: s.price_per_night }))
        );
        buErr = retry.error;
      }
      if (buErr) throw new Error('Reserva creada, pero falló asignar las unidades: ' + buErr.message);

      await markQuoteConverted(this.db, quoteId, newB.id);
      cache?.invalidate?.('bookings');

      Bus.emit(EVENTS.BOOKING_CREATED, {
        bookingId: newB.id, guestName: payload.guest_name,
        unitNames: unitSegments.map(s => unitLabel(s.unit_id)),
        checkIn, checkOut, pax: (payload.adults || 2) + (payload.children || 0), total,
      });

      showToast(`✓ Reserva dividida creada: ${segmentLines}`, 'success');
      document.dispatchEvent(new CustomEvent('booking:changed'));

      // Ofrecer completar datos (teléfono, DNI, seña) sin forzarlo —
      // abrir para editar es seguro: el guardado de booking-form.js ya
      // preserva los tramos de fecha si no se cambian las unidades.
      setTimeout(() => {
        if (confirm('Reserva dividida creada ✓\n\n¿Abrir para completar datos del huésped o cargar una seña?')) {
          this.bookingForm.openEdit(newB.id);
        }
      }, 300);
    } catch (err) {
      console.error('[SplitBooking]', err);
      showToast(err.message || 'Error creando la reserva dividida', 'error');
    }
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
      Bus.emit(EVENTS.BLOCK_CREATED, { unitName: name, checkIn, checkOut, reason });
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
    // RESIZE — borde izquierdo (fecha de ingreso)
    // Antes solo se podía arrastrar el borde derecho (checkout) — no había
    // forma de estirar/acortar el check-in con drag, había que editar la
    // reserva a mano para eso.
    // ────────────────────────────────────────────────
    grid.addEventListener('mousedown', (e) => {
      const handle = e.target.closest('.bar-resize-handle-left');
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
      this._startResizeLeft(e, booking, bar, grid, sig);
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
      this._barDrag = { active: false, moved: false, _wasActive: false };
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
        // Marcar como "fue un click, el bar.click lo maneja — no doble apertura"
        // No llamamos _openDetailById acá; el click event del bar lo hace con popover.
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

      // Validación final en Supabase — excluir cancelled Y blocked para que
      // mover un bloqueo no choque consigo mismo ni con otros bloqueos
      const { data: conflicts } = await this.db
        .from('booking_units')
        .select('unit_id, bookings!inner(id, check_in, check_out, status, is_blocked)')
        .eq('unit_id', targetUnitId)
        .neq('bookings.status', 'cancelled')
        .neq('bookings.status', 'blocked')
        .neq('bookings.id', booking.id)
        .lt('bookings.check_in', newCO)
        .gt('bookings.check_out', newCI);

      if (conflicts?.length) {
        showToast('⚠️ Conflicto: hay otra reserva en esas fechas', 'error');
        this.load(); return;
      }

      if (!navigator.onLine) { showToast('📵 Sin conexión — el cambio no se guardó', 'warning'); this.load(); return; }
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
      const _dragUnitName = this.ctx.units?.find(u => u.id === targetUnitId)?.name ?? '';
      Bus.emit(EVENTS.AVAILABILITY_CHANGED, { unitName: _dragUnitName, checkIn: newCI, checkOut: newCO });
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
        // ── Quitar la clase .bar para que el CSS !important no sobreescriba top/bottom ──
        _barGhost.className = 'bar-drag-ghost';
        _barGhost.style.cssText = [
          'position:fixed',
          'left:' + barRect.left + 'px',
          'top:' + barRect.top + 'px',
          'width:' + barRect.width + 'px',
          'height:' + barRect.height + 'px',
          'z-index:9999',
          'pointer-events:none',
          'opacity:.88',
          'transform:scale(1.04) translateZ(0)',
          'box-shadow:0 12px 40px rgba(0,0,0,.30),0 4px 12px rgba(0,0,0,.18)',
          'border-radius:6px',
          'cursor:grabbing',
          'transition:none',
          'background:inherit',
          'display:flex',
          'align-items:center',
          'padding:0 8px',
          'overflow:hidden',
        ].join(';');
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
        _barGhost.className = 'bar-drag-ghost';
        _barGhost.style.cssText = [
          'position:fixed',
          'left:' + barRect.left + 'px',
          'top:' + barRect.top + 'px',
          'width:' + barRect.width + 'px',
          'height:' + barRect.height + 'px',
          'z-index:9999',
          'pointer-events:none',
          'opacity:.88',
          'transform:scale(1.04)',
          'border-radius:6px',
          'box-shadow:0 12px 40px rgba(0,0,0,.3)',
          'transition:none',
          'display:flex',
          'align-items:center',
          'padding:0 8px',
        ].join(';');
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
      if (!navigator.onLine) { showToast('📵 Sin conexión — el cambio no se guardó', 'warning'); this.load(); return; }
      const { error } = await this.db.from('bookings')
        .update({ check_out: currentCO }).eq('id', booking.id);
      if (error) {
        showToast('Error al cambiar la fecha de salida', 'error');
        bar.style.width = origWidthStyle;
        return;
      }

      await logAction('UPDATE', 'booking', booking.id,
        `Resize: check_out ${origCO}→${currentCO}`);

      // Si el checkout se acortó (currentCO < origCO), las noches entre
      // currentCO y origCO quedaron libres sin que la reserva se haya
      // cancelado — dispara el mismo chequeo de lista de espera que una
      // cancelación, por si alguien estaba esperando justo esas fechas.
      if (currentCO < origCO) {
        Bus.emit(EVENTS.BOOKING_CANCELLED, {
          hotelId: this.ctx.hotelId,
          checkIn: currentCO,
          checkOut: origCO,
          unitIds: (booking.booking_units ?? []).map(bu => bu.unit_id),
        });
      }

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
  // RESIZE DE RESERVAS — borde izquierdo (check-in)
  // Mismo mecanismo que _startResize, espejado: acá se mueve check_in en
  // vez de check_out. El chequeo de conflicto usa la misma matemática con
  // límites excluyentes, así que un check-out ajeno el mismo día que tu
  // nuevo check-in (recambio) tampoco bloquea acá.
  // ══════════════════════════════════════════════════
  _startResizeLeft(e, booking, bar, grid, sig) {
    const origCI     = booking.check_in;
    const origLeft    = parseFloat(bar.style.left) || 0;
    const origWidth  = bar.getBoundingClientRect().width;
    const origWidthStyle = bar.style.width;
    const origLeftStyle  = bar.style.left;
    const startX     = e.clientX;
    let currentCI    = origCI;
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

      const nights    = this._dayDiff(origCI, booking.check_out);
      const newNights = Math.max(1, nights - daysDiff);
      currentCI = this._addDays(booking.check_out, -newNights);

      // Actualizar posición/ancho visual de la barra (el borde izquierdo
      // se mueve, el derecho queda fijo — al revés que el resize normal)
      const newWidth = Math.max(origWidth - daysDiff * cellWidth, cellWidth - 4);
      bar.style.width = `${newWidth}px`;
      bar.style.left  = `${origLeft + daysDiff * cellWidth}px`;

      // Validar localmente — mismo criterio exclusivo en los bordes que
      // el resize derecho: un check_out ajeno == tu nuevo check_in no cuenta.
      const hasConflict = (this._lastRenderedBookings ?? []).some(other => {
        if (other.id === booking.id || other.status === 'cancelled') return false;
        const srcUnitId = (booking.booking_units ?? [])[0]?.unit_id;
        if (!(other.booking_units ?? []).some(bu => bu.unit_id === srcUnitId)) return false;
        return other.check_in < booking.check_out && other.check_out > currentCI;
      });

      bar.classList.toggle('resize-conflict', hasConflict);
      bar.classList.toggle('resize-valid',    !hasConflict);

      this._floatInfo.innerHTML = `
        <div class="fi-guest" style="font-size:.72rem;font-weight:600">Redimensionar reserva</div>
        <div class="fi-dates">📅 ${this._fmtShort(currentCI)} → ${this._fmtShort(booking.check_out)}</div>
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

      if (currentCI === origCI) {
        bar.style.width = origWidthStyle;
        bar.style.left  = origLeftStyle;
        return;
      }

      const confirmed = await this._confirmResizeChange({
        guestName: booking.guests ? `${booking.guests.first_name ?? ''} ${booking.guests.last_name ?? ''}`.trim() : (booking.block_reason ?? 'Reserva'),
        oldCI: origCI, oldCO: booking.check_out,
        newCI: currentCI, newCO: booking.check_out,
        oldNights: this._dayDiff(origCI, booking.check_out),
        newNights: this._dayDiff(currentCI, booking.check_out),
      });

      if (!confirmed) {
        bar.style.transition = 'width .3s cubic-bezier(.4,0,.2,1), left .3s cubic-bezier(.4,0,.2,1)';
        bar.style.width = origWidthStyle;
        bar.style.left  = origLeftStyle;
        setTimeout(() => { bar.style.transition = ''; }, 350);
        return;
      }

      // Validación final — mismos límites excluyentes que el resize derecho
      const srcUnitId = (booking.booking_units ?? [])[0]?.unit_id;
      const { data: conflicts } = await this.db
        .from('booking_units')
        .select('unit_id, bookings!inner(id, check_in, check_out, status)')
        .eq('unit_id', srcUnitId)
        .neq('bookings.status', 'cancelled')
        .neq('bookings.id', booking.id)
        .lt('bookings.check_in', booking.check_out)
        .gt('bookings.check_out', currentCI);

      if (conflicts?.length) {
        showToast('⚠️ Conflicto: hay otra reserva en esas fechas', 'error');
        bar.style.width = origWidthStyle;
        bar.style.left  = origLeftStyle;
        this.load(); return;
      }

      const newNights = this._dayDiff(currentCI, booking.check_out);
      if (!navigator.onLine) { showToast('📵 Sin conexión — el cambio no se guardó', 'warning'); this.load(); return; }
      const { error } = await this.db.from('bookings')
        .update({ check_in: currentCI }).eq('id', booking.id);
      if (error) {
        showToast('Error al cambiar la fecha de ingreso', 'error');
        bar.style.width = origWidthStyle;
        bar.style.left  = origLeftStyle;
        return;
      }

      await logAction('UPDATE', 'booking', booking.id,
        `Resize: check_in ${origCI}→${currentCI}`);

      // Si el check-in se movió para más adelante (currentCI > origCI),
      // las primeras noches quedaron libres sin cancelar la reserva —
      // mismo chequeo de lista de espera que en una cancelación.
      if (currentCI > origCI) {
        Bus.emit(EVENTS.BOOKING_CANCELLED, {
          hotelId: this.ctx.hotelId,
          checkIn: origCI,
          checkOut: currentCI,
          unitIds: (booking.booking_units ?? []).map(bu => bu.unit_id),
        });
      }

      this._pendingPulse.add(booking.id);
      cache.invalidate('bookings');
      showToast(`✓ Fecha de ingreso actualizada: ${this._fmtShort(currentCI)}`, 'success');
      this.load();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });

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
    const availBtn = document.getElementById('cal-avail-toggle');
    if (!availBtn) return;

    // ── Guard de idempotencia ──────────────────────────
    // Si esta función llega a ejecutarse más de una vez (doble init,
    // re-render del toolbar, etc.) evitamos crear un segundo panel y un
    // segundo listener sobre el mismo botón: eso era lo que hacía que el
    // bloque de "Disponibilidad" apareciera duplicado en pantalla.
    if (availBtn.dataset.availBound === '1') return;
    availBtn.dataset.availBound = '1';

    let _availMode = false;

    const filterPanel = document.createElement('div');
    filterPanel.id = 'avail-filter-panel';
    const todayStr    = localToday();
    const tomorrowStr = this._addDays(todayStr, 1);
    filterPanel.className = 'avail-filter-panel';
    filterPanel.style.display = 'none';
    filterPanel.innerHTML = `
      <div class="avail-panel-row">
        <span class="avail-panel-label">🔍 Disponibilidad</span>
        <span class="avail-sep">Check-in</span>
        <input type="date" id="avail-checkin" value="${todayStr}" class="avail-input">
        <span class="avail-sep">Check-out</span>
        <input type="date" id="avail-checkout" value="${tomorrowStr}" class="avail-input">
        <span class="avail-sep">Personas</span>
        <input type="number" id="avail-guests" min="1" max="20" value="2" class="avail-input avail-input-num">
        <button id="avail-search-btn" class="avail-search-btn">Ver disponibles →</button>
        <div id="avail-results" class="avail-results-inline"></div>
      </div>
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
        return '<span class="avail-chip" style="background:' + color + '20;border:1px solid ' + color + '55;color:var(--color-text)" title="#' + u.sort_order + ' · ' + u.name + ' (hasta ' + u.max_guests + ' pers.)">' +
               '<span class="avail-chip-dot" style="background:' + color + '"></span>#' + u.sort_order + '</span>';
      };

      if (!available.length) {
        results.style.display = 'block';
        results.style.display = 'contents';
        results.innerHTML = '<span class="avail-sep avail-result-sep">│</span><span style="color:#ef4444;font-size:.76rem;white-space:nowrap">😔 Sin disponibilidad para ' + guests + ' pers.</span>';
        return;
      }
      results.style.display = 'contents';
      results.innerHTML =
        '<span class="avail-sep avail-result-sep">│</span>' +
        '<span class="avail-result-ok">✅ ' + available.length + ' disponible' + (available.length > 1 ? 's' : '') + '</span>' +
        '<span class="avail-result-info">' + fmt(ci) + ' → ' + fmt(co) + ' · ' + guests + ' pers.</span>' +
        available.map(chip).join('') +
        tooSmall.map(u => '<span class="avail-chip avail-chip-small" title="#' + u.sort_order + ' · ' + u.name + ' — max. ' + u.max_guests + ' pers."><span class="avail-chip-dot avail-chip-dot-gray"></span>#' + u.sort_order + '</span>').join('') +
        occupied.map(u => '<span class="avail-chip avail-chip-occ" title="#' + u.sort_order + ' · ' + u.name + ' — ocupada"><span class="avail-chip-dot avail-chip-dot-red"></span>#' + u.sort_order + '</span>').join('');
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
  async _openBarPopover(bookingId, anchorEl, evt) {
    document.getElementById('cal-bar-popover')?.remove();
    if (!bookingId) return;

    let bk = this._lastRenderedBookings?.find(b => b.id === bookingId);
    if (!bk || !bk.guests) {
      const { data } = await this.db.from('bookings')
        .select(`id, check_in, check_out, nights, status, source, total_amount, total_paid, balance,
                 price_per_night, discount_pct, notes,
                 guests!bookings_guest_id_fkey(first_name, last_name, phone, age, car_model, car_plate, pax),
                 booking_units(unit_id, units(name, sort_order, color))`)
        .eq('id', bookingId).single();
      if (data) bk = data;
    }
    if (!bk) return;
    if (bk.status === 'blocked' || bk.is_blocked) { this._openDetailById(bookingId); return; }

    const g       = bk.guests ?? {};
    const guest   = ((g.first_name??'') + ' ' + (g.last_name??'')).trim() || '—';
    const initials= ((g.first_name?.[0]??'') + (g.last_name?.[0]??'')).toUpperCase() || '?';
    const units   = bk.booking_units ?? [];
    const unit0   = units[0]?.units;
    const color   = unit0?.color ?? '#6366f1';
    const uLabel  = units.map(u => '#' + u.units?.sort_order + ' · ' + u.units?.name).filter(Boolean).join(' / ') || '—';
    const nights  = bk.nights ?? Math.round((new Date(bk.check_out) - new Date(bk.check_in)) / 86400000);
    const pax     = g.pax ?? '';
    const phone   = g.phone ?? '';
    const car     = [g.car_model, g.car_plate].filter(Boolean).join(' · ');
    const age     = g.age ? g.age + ' años' : '';
    const total   = bk.total_amount ?? 0;
    const paid    = bk.total_paid   ?? 0;
    const balance = Math.max(0, bk.balance ?? (total - paid));
    const saldado = balance <= 0;
    const fmt     = n => '$' + Math.round(n).toLocaleString('es-AR');
    const fmtD    = s => s ? new Date(s+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'}) : '—';

    const STATUS_LABEL = {paid:'Saldado',partial:'Señada',pending:'Sin seña',confirmed:'Confirmada',cancelled:'Cancelada'};
    const STATUS_COLOR = {paid:'#16a34a',partial:'#dc2626',pending:'#d97706',confirmed:'#2563eb',cancelled:'#6b7280'};
    const STATUS_BG    = {paid:'#f0fdf4',partial:'#fef2f2',pending:'#fffbeb',confirmed:'#eff6ff',cancelled:'#f8fafc'};
    const stLabel = STATUS_LABEL[bk.status] ?? bk.status;
    const stColor = STATUS_COLOR[bk.status] ?? '#6b7280';
    const stBg    = STATUS_BG[bk.status]    ?? '#f1f5f9';

    // Bloque financiero
    const finBlock = saldado
      ? `<div style="grid-column:span 2">
           <div style="font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-3);margin-bottom:3px">Total pagado</div>
           <div style="font-size:14px;font-weight:700;color:#16a34a">${fmt(total)}</div>
           <div style="font-size:9px;color:var(--color-text-3);margin-top:2px">${paid > 0 ? fmt(paid > balance ? paid - balance : paid) + ' seña + resto saldo' : 'pago completo'}</div>
         </div>
         <div style="border-left:0.5px solid var(--color-border);padding-left:8px;display:flex;flex-direction:column;align-items:center;justify-content:center">
           <div style="font-size:22px">✅</div>
         </div>`
      : `<div>
           <div style="font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-3);margin-bottom:3px">Total</div>
           <div style="font-size:13px;font-weight:700;color:var(--color-text)">${fmt(total)}</div>
           <div style="font-size:9px;color:var(--color-text-3)">${Math.round(bk.price_per_night ?? 0).toLocaleString('es-AR')}/noche</div>
         </div>
         <div style="border-left:0.5px solid var(--color-border);padding-left:8px">
           <div style="font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#d97706;margin-bottom:3px">Seña cobrada</div>
           <div style="font-size:13px;font-weight:700;color:#d97706">${paid > 0 ? fmt(paid) : '—'}</div>
           <div style="font-size:9px;color:var(--color-text-3)">${paid > 0 ? '' : 'sin señar'}</div>
         </div>
         <div style="border-left:0.5px solid var(--color-border);padding-left:8px">
           <div style="font-size:8.5px;text-transform:uppercase;letter-spacing:.04em;color:#dc2626;margin-bottom:3px">Pendiente</div>
           <div style="font-size:13px;font-weight:700;color:#dc2626">${fmt(balance)}</div>
           <div style="font-size:9px;color:var(--color-text-3)">al ingreso</div>
         </div>`;

    const pop = document.createElement('div');
    pop.id = 'cal-bar-popover';
    pop.style.cssText = 'position:fixed;z-index:9999;background:var(--color-surface);'
      + 'border:0.5px solid var(--color-border);border-radius:14px;'
      + 'box-shadow:0 8px 32px rgba(0,0,0,.2);width:284px;overflow:hidden';

    pop.innerHTML =
      // ── Header ──────────────────────────────────────────────────────────
      '<div style="padding:12px 14px 10px;border-bottom:0.5px solid var(--color-border);display:flex;align-items:center;gap:10px">'
      + '<div style="width:36px;height:36px;border-radius:50%;background:'+color+'22;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:'+color+';flex-shrink:0">'+initials+'</div>'
      + '<div style="flex:1;min-width:0">'
      +   '<div style="font-size:13px;font-weight:600;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+guest+'</div>'
      +   '<div style="display:flex;align-items:center;gap:5px;margin-top:3px;flex-wrap:wrap">'
      +     '<span style="width:7px;height:7px;border-radius:2px;background:'+color+';flex-shrink:0"></span>'
      +     '<span style="font-size:10px;color:var(--color-text-2)">'+uLabel+'</span>'
      +     '<span style="font-size:9px;font-weight:600;padding:2px 7px;border-radius:999px;background:'+stBg+';color:'+stColor+';margin-left:2px">'+(saldado?'✓ ':'')+stLabel+'</span>'
      +   '</div>'
      + '</div>'
      + '<button id="pop-close" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--color-text-3);padding:0;line-height:1;flex-shrink:0">✕</button>'
      + '</div>'

      // ── Body ────────────────────────────────────────────────────────────
      + '<div style="padding:10px 14px;display:flex;flex-direction:column;gap:7px">'
      + '<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--color-text)">'
      +   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="flex-shrink:0;color:var(--color-text-3)"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
      +   '<span>'+fmtD(bk.check_in)+' → '+fmtD(bk.check_out)+' &nbsp;·&nbsp; <strong>'+nights+' noche'+(nights!==1?'s':'')+'</strong>'+(pax?' · 👥 '+pax:'')+'</span>'
      + '</div>'
      + (phone ? '<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--color-text)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="flex-shrink:0;color:var(--color-text-3)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.77 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span>'+phone+(age?' · '+age:'')+'</span></div>' : '')
      + (car   ? '<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--color-text)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="flex-shrink:0;color:var(--color-text-3)"><path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l3-3h8l3 3h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></svg><span>'+car+'</span></div>' : '')

      // Nota inline (estilo burbuja amarilla si existe)
      + (bk.notes ? '<div style="background:#fffde7;border:1px solid #f9a825;border-radius:8px;padding:7px 10px;display:flex;align-items:flex-start;gap:6px;margin-top:2px">'
          + '<span style="font-size:12px;flex-shrink:0">📝</span>'
          + '<span style="font-size:10.5px;color:#5d4037;font-style:italic">' + (bk.notes.replace(/🔄NC:[^·\n]*/g,'').replace(/✅NCUSED/g,'').replace(/·\s*$/,'').trim() || '') + '</span>'
          + '</div>' : '')

      // Bloque financiero 3 columnas
      + '<div style="background:var(--color-surface-2);border-radius:10px;padding:10px 12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:2px">'+finBlock+'</div>'
      + '</div>'

      // ── Footer 2 filas ──────────────────────────────────────────────────
      + '<div style="padding:8px 14px 11px;border-top:0.5px solid var(--color-border)">'
      + '<div style="display:flex;gap:6px;margin-bottom:6px">'
      +   '<button data-pop-action="edit"   style="flex:1;font-size:10.5px;font-weight:600;padding:7px 0;border-radius:8px;cursor:pointer;border:none;background:var(--color-primary);color:#fff">✏️ Editar reserva</button>'
      +   '<button data-pop-action="wa"     style="width:36px;font-size:14px;padding:7px 0;border-radius:8px;cursor:pointer;border:0.5px solid var(--color-border);background:var(--color-surface-2)">💬</button>'
      +   '<button data-pop-action="delete" style="width:36px;font-size:14px;padding:7px 0;border-radius:8px;cursor:pointer;border:0.5px solid #fecaca;background:#fef2f2">🗑</button>'
      + '</div>'
      + '<div style="display:flex;gap:5px">'
      +   '<button data-pop-action="dates" style="flex:1;font-size:10px;font-weight:500;padding:7px 0;border-radius:8px;cursor:pointer;border:0.5px solid var(--color-border);background:var(--color-surface-2);color:var(--color-text-2)">📅 Fechas</button>'
      +   '<button data-pop-action="pay"   style="flex:1;font-size:10px;font-weight:500;padding:7px 0;border-radius:8px;cursor:pointer;border:0.5px solid var(--color-border);background:var(--color-surface-2);color:var(--color-text-2)"'+(saldado?' disabled style="opacity:.45;cursor:default"':'')+'>💰 Cobrar</button>'
      +   '<button data-pop-action="note"  style="width:36px;font-size:14px;padding:7px 0;border-radius:8px;cursor:pointer;border:0.5px solid '+(bk.notes?'#f9a825':'var(--color-border)')+';background:'+(bk.notes?'#fffde7':'var(--color-surface-2)')+'" title="'+(bk.notes?'Ver/editar nota':'Agregar nota')+'">📝</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(pop);

    const r = anchorEl.getBoundingClientRect();
    const pw = 284; const ph = pop.offsetHeight || 300;
    let px = r.left + r.width / 2 - pw / 2;
    let py = r.bottom + 8;
    if (py + ph > window.innerHeight - 10) py = r.top - ph - 8;
    if (px + pw > window.innerWidth - 10)  px = window.innerWidth - pw - 10;
    if (px < 10) px = 10;
    pop.style.left = px + 'px'; pop.style.top = py + 'px';

    const close = () => {
      pop.remove();
      document.removeEventListener('click',   outsideH, true);
      document.removeEventListener('keydown', escH);
    };
    const outsideH = (e) => { if (!pop.contains(e.target)) close(); };
    const escH     = (e) => { if (e.key === 'Escape') close(); };
    setTimeout(() => {
      document.addEventListener('click',   outsideH, true);
      document.addEventListener('keydown', escH);
    }, 0);

    pop.querySelector('#pop-close').addEventListener('click', close);
    pop.querySelectorAll('[data-pop-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        close();
        const action = btn.dataset.popAction;
        if (action === 'edit')   { this.bookingForm?.openEdit?.(bookingId)     ?? this._openDetailById(bookingId); }
        if (action === 'dates')  { this.bookingForm?.openEdit?.(bookingId).then?.(() => setTimeout(()=>this.bookingForm._goToStep(2),120)) ?? this._openDetailById(bookingId); }
        if (action === 'pay')    { this.bookingForm?.openPayments?.(bookingId) ?? this._openDetailById(bookingId); }
        if (action === 'note')   { this.bookingForm?.openNote?.(bookingId)     ?? this._openDetailById(bookingId); }
        if (action === 'wa')     { const p = (g.phone||'').replace(/\D/g,''); if (p) window.open('https://wa.me/'+p,'_blank'); }
        if (action === 'delete') {
          if (!confirm('¿Eliminar la reserva de '+guest+'?')) return;
          const { error } = await this.db.from('bookings').delete().eq('id', bookingId);
          if (error) { showToast('Error al eliminar','error'); return; }
          showToast('Reserva eliminada ✓','success'); this.load();
        }
      });
    });
  }
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
        Bus.emit(EVENTS.BLOCK_DELETED, { unitName, checkIn: bookingData.check_in, checkOut: bookingData.check_out });
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
      const _blockedUnitName = this.ctx.units?.find(u => u.id === unitId)?.name ?? 'unidad';
      Bus.emit(EVENTS.BLOCK_CREATED, { unitName: _blockedUnitName, checkIn: dateISO, checkOut, reason });
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

  // ── Nombre de display: localStorage primero, luego unit.name ──
  _getUnitDisplayName(unit) {
    return localStorage.getItem('mila_unit_name_' + unit.id) || unit.name || ('Unidad ' + (unit.sort_order ?? ''));
  }

  // ── Mide el texto más largo de todos los departamentos para calcular LABEL_W ──
  _measureLabelW(isMob) {
    const units = AppContext?.units ?? [];

    // Intentar medir con canvas offscreen; fallback a estimación si no disponible
    let maxPx = 0;
    try {
      const canvas = document.createElement('canvas');
      const ctx    = canvas.getContext?.('2d');
      if (ctx) {
        ctx.font = isMob ? '700 11px system-ui' : '700 12px system-ui';
        // Medir cada nombre (con abreviaciones aplicadas)
        units.forEach(u => {
          const name = this._getUnitDisplayName(u)
            .replace('Planta Baja', 'P. Baja').replace('Planta Alta', 'P. Alta');
          const w = ctx.measureText(name).width;
          if (w > maxPx) maxPx = w;
        });
        // También considerar el texto del header "Unidad"
        const headerW = ctx.measureText('Unidad').width;
        if (headerW > maxPx) maxPx = headerW;
      }
    } catch (_) {
      // Canvas no disponible — estimación por longitud de caracteres
    }

    // Fallback: 7px por carácter si canvas no funcionó
    if (maxPx === 0 && units.length > 0) {
      const longestName = units.reduce((max, u) => {
        const name = this._getUnitDisplayName(u);
        return name.length > max.length ? name : max;
      }, '');
      maxPx = longestName.length * (isMob ? 6.5 : 7);
    }

    // dot(8) + gap(4) + texto + padding(16) + lápiz(18) = ~46 desktop, ~38 mobile
    const total = Math.ceil(maxPx) + (isMob ? 38 : 46);
    const min = isMob ? LABEL_W_MIN_MOB : LABEL_W_MIN;
    const max = isMob ? LABEL_W_MAX_MOB : LABEL_W_MAX;
    return Math.max(min, Math.min(max, total));
  }

  // ── Edición inline del nombre del departamento (por sesión) ──
  editUnitDisplayName(unitId) {
    const unit = AppContext?.units?.find(u => u.id === unitId);
    if (!unit) return;

    // Buscar el span del nombre dentro del label del departamento
    const allLabels = document.querySelectorAll('.cal-unit-label');
    let targetSpan  = null;
    let targetLabel = null;
    allLabels.forEach(lbl => {
      // Identificar la fila por data-unit o por el onclick del lápiz
      const pencil = lbl.querySelector('button[onclick*="' + unitId + '"]');
      if (pencil) {
        targetLabel = lbl;
        targetSpan  = lbl.querySelector('span[style*="font-size:.78rem"]')
                   ?? lbl.querySelector('span[style*="font-weight:700"]');
      }
    });
    if (!targetSpan) return;

    const currentName = this._getUnitDisplayName(unit)
      .replace('Planta Baja','P. Baja').replace('Planta Alta','P. Alta');

    // Reemplazar span por input inline
    const input = document.createElement('input');
    input.type  = 'text';
    input.value = currentName;
    input.style.cssText = 'font-size:.78rem;font-weight:700;color:var(--color-text);'
      + 'border:1px solid var(--color-primary);border-radius:4px;padding:1px 5px;'
      + 'width:100%;min-width:60px;max-width:140px;background:var(--color-surface);'
      + 'outline:none;box-shadow:0 0 0 2px var(--color-primary-t)';

    targetSpan.replaceWith(input);
    input.focus();
    input.select();

    const save = () => {
      const val = input.value.trim();
      if (val && val !== unit.name) {
        localStorage.setItem('mila_unit_name_' + unitId, val);
      } else if (!val || val === unit.name) {
        localStorage.removeItem('mila_unit_name_' + unitId);
      }
      showToast('Nombre actualizado ✓', 'success');
      this.load(); // re-render con nuevo ancho
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { this.load(); } // cancelar
    });
    input.addEventListener('blur', save, { once: true });
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

  // ══════════════════════════════════════════════════════════════════════════
  // PERÍODOS ETIQUETADOS — selección de rango, almacenamiento y rendering
  // ══════════════════════════════════════════════════════════════════════════

  _periodsKey() {
    return `mila_cal_periods_${this.ctx.hotelId ?? 'default'}`;
  }

  _loadPeriods() {
    try { return JSON.parse(localStorage.getItem(this._periodsKey()) ?? '[]'); }
    catch { return []; }
  }

  _savePeriods(periods) {
    localStorage.setItem(this._periodsKey(), JSON.stringify(periods));
  }

  // Renderiza bandas de color sobre los headers de día para cada período guardado
  _renderPeriods() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    // Limpiar elementos de período previos
    grid.querySelectorAll('.cal-period-bg,.cal-period-label,.cal-period-dot,.cal-period-overlay,.cal-period-band').forEach(el => el.remove());
    grid.querySelectorAll('[data-period-id]').forEach(cell => {
      delete cell.dataset.periodId;
      cell.style.boxShadow = '';
      cell.style.outline = '';
      cell.style.outlineOffset = '';
    });

    const periods = this._loadPeriods();
    if (!periods.length) return;

    // Para cada período, insertar un overlay dentro de CADA celda que caiga
    // dentro del rango (headers de día + celdas de unidad).
    // El overlay se inserta como primer hijo → queda por detrás de las barras
    // de reserva (z-index 2+). pointer-events:none excepto en el header del
    // primer día visible, donde permite click para abrir el modal de edición.
    periods.forEach(p => {
      // Los bloqueos reales (type='block') los renderiza la barra de Supabase; no duplicar
      if (p.type === 'block') return;

      const pStart = p.check_in;
      const pEnd   = p.check_out; // EXCLUSIVO
      const isSoft = p.type === 'soft';
      const isMob  = window.innerWidth <= 768;
      const hex    = p.color; // ej '#6366f1'

      // Convertir #RRGGBB a rgba() — Safari mobile no soporta #RRGGBBAA
      const r = parseInt(hex.slice(1,3),16);
      const g = parseInt(hex.slice(3,5),16);
      const b = parseInt(hex.slice(5,7),16);
      const bgRgba  = isMob
        ? `rgba(${r},${g},${b},.22)`   // mobile: 22% opacidad
        : `rgba(${r},${g},${b},.06)`;  // desktop: 6% opacidad
      const brdRgba = isMob
        ? `rgba(${r},${g},${b},.55)`
        : `rgba(${r},${g},${b},.28)`;
      const brdRgbaE = `rgba(${r},${g},${b},.75)`;
      const hatchRgba = `rgba(${r},${g},${b},.12)`;
      const brdW    = isMob ? '2px' : '1px';

      const inRange  = iso => iso >= pStart && iso < pEnd;
      const allDates = this._dateRange.filter(inRange);
      if (!allDates.length) return;

      const visFirst = allDates[0];
      const visLast  = allDates[allDates.length - 1];
      const span     = allDates.length;

      // ── 1. Fondo en CADA celda ───────────────────────────────────────────
      grid.querySelectorAll('[data-date]').forEach(cell => {
        const iso = cell.dataset.date;
        if (!inRange(iso)) return;

        const isFirst = iso === visFirst;
        const isLast  = iso === visLast;
        cell.dataset.periodId = p.id;

        // Método 1: div hijo (funciona en todos los browsers modernos)
        const bg = document.createElement('div');
        bg.className = 'cal-period-bg';
        bg.dataset.periodId = p.id;
        const parts = [
          'position:absolute',
          'inset:0',
          `background:${bgRgba}`,
        ];
        if (isSoft) parts.push(
          `background-image:repeating-linear-gradient(-45deg,transparent 0,transparent 5px,${hatchRgba} 5px,${hatchRgba} 6px)`
        );
        parts.push(
          `border-top:${brdW} solid ${brdRgba}`,
          `border-bottom:${brdW} solid ${brdRgba}`,
          isFirst ? `border-left:2px solid ${brdRgbaE}` : 'border-left:none',
          isLast  ? `border-right:2px solid ${brdRgbaE}` : 'border-right:none',
          'pointer-events:none',
          'z-index:1',
          'box-sizing:border-box'
        );
        bg.style.cssText = parts.join(';');
        cell.insertBefore(bg, cell.firstChild);

        // Método 2: box-shadow inset — funciona en TODOS los browsers/mobile
        // sin depender de position, overflow, z-index ni pseudo-elementos.
        // Pinta el fondo de la celda desde adentro.
        const shadow = `inset 0 0 0 9999px ${bgRgba}`;
        const prevShadow = cell.style.boxShadow;
        cell.style.boxShadow = prevShadow && prevShadow !== 'none'
          ? prevShadow + ', ' + shadow
          : shadow;
        // Bordes via outline (no afecta layout, visible en mobile)
        cell.style.outline = `1px solid ${brdRgba}`;
        cell.style.outlineOffset = '-1px';
      });

      // ── 2. Puntos en header del primer y último día ──────────────────────
      [visFirst, visLast].forEach((iso, idx) => {
        const hdr = grid.querySelector(`.cal-day-header[data-date="${iso}"]`);
        if (!hdr) return;
        const dot = document.createElement('span');
        dot.className = 'cal-period-dot';
        dot.dataset.periodId = p.id;
        dot.style.cssText = [
          'position:absolute',
          'bottom:2px',
          idx === 0 ? 'left:3px' : 'right:3px',
          'width:5px',
          'height:5px',
          'border-radius:50%',
          `background:rgba(${r},${g},${b},.8)`,
          'pointer-events:none',
          'z-index:2',
        ].join(';');
        hdr.appendChild(dot);
      });

      // ── 3. Etiqueta por fila, solo si no hay reserva en el rango ─────────
      const cellMap = this._buildCellMap(this._lastRenderedBookings ?? []);

      (this.ctx.units ?? []).forEach(unit => {
        const hasBooking = allDates.some(iso =>
          (cellMap[unit.id]?.[iso]?.length ?? 0) > 0
        );
        if (hasBooking) return;

        const firstCell = grid.querySelector(
          `.cal-cell[data-unit-id="${unit.id}"][data-date="${visFirst}"]`
        );
        if (!firstCell) return;


        const prefix   = isSoft ? '[!] ' : '';
        const minN     = p.min_nights ? ('🌙' + p.min_nights + ' ') : '';
        const labelTxt = prefix + minN + p.label + (p.note ? '  ·  ' + p.note : '');
        const tipTxt   = p.label
          + (p.min_nights ? ' · mín. ' + p.min_nights + ' noches' : '')
          + (p.note ? '\n' + p.note : '')
          + '\nClic para editar';

        const lbl = document.createElement('div');
        lbl.className = 'cal-period-label';
        lbl.dataset.periodId = p.id;
        lbl.textContent = labelTxt;
        lbl.title = tipTxt;
        lbl.style.cssText = [
          'position:absolute',
          'bottom:3px',
          'left:2px',
          `width:calc(${span} * 100% - 4px)`,
          'height:12px',
          'overflow:hidden',
          'white-space:nowrap',
          'text-overflow:ellipsis',
          'font-size:.52rem',
          'font-weight:600',
          `color:${bgRgba.replace(/[\d.]+\)$/, '.6)')}`,
          'pointer-events:auto',
          'cursor:pointer',
          'z-index:2',
          'line-height:12px',
          'padding:0 3px',
        ].join(';');
        lbl.addEventListener('click', e => {
          e.stopPropagation();
          this._openPeriodModal(p.check_in, p.check_out, p);
        });
        firstCell.appendChild(lbl);
      });
    });

  }

  // Modal para crear/editar período
  // Devuelve un mensaje de advertencia si algún período 'soft' se superpone con el rango dado.
  // Retorna null si no hay ninguno.
  _getSoftPeriods(fromISO, toISO) {
    return this._loadPeriods().filter(p =>
      p.type === 'soft' &&
      p.check_in <= toISO &&
      p.check_out >= fromISO
    );
  }

  // Muestra un modal de advertencia para períodos con condición.
  // Devuelve una Promise<boolean> — true si el usuario confirma continuar.
  _confirmSoftPeriods(periods) {
    return new Promise(resolve => {
      const existing = document.getElementById('soft-warn-overlay');
      if (existing) existing.remove();

      const lines = periods.map(p => {
        const parts = [];
        if (p.min_nights) parts.push(`<span style="font-weight:700">Mínimo ${p.min_nights} noches</span>`);
        if (p.note) parts.push(p.note);
        return `<div style="padding:8px 10px;border-left:3px solid ${p.color};margin-bottom:6px;border-radius:0 6px 6px 0;background:${p.color}14">
          <div style="font-weight:700;font-size:.85rem;color:var(--color-text)">${p.label}</div>
          ${parts.length ? '<div style="font-size:.78rem;color:var(--color-text-2);margin-top:2px">' + parts.join(' · ') + '</div>' : ''}
        </div>`;
      }).join('');

      const ov = document.createElement('div');
      ov.id = 'soft-warn-overlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';
      ov.innerHTML = `
        <div style="background:var(--color-surface);border-radius:14px;padding:22px;width:340px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.35)">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
            <span style="font-size:1.4rem">⚠️</span>
            <div>
              <div style="font-weight:700;font-size:.95rem">Período con condición</div>
              <div style="font-size:.75rem;color:var(--color-text-3)">Estas fechas tienen restricciones activas</div>
            </div>
          </div>
          ${lines}
          <div style="font-size:.8rem;color:var(--color-text-2);margin:12px 0 16px;padding:8px 10px;border-radius:8px;background:var(--color-surface-2)">
            ¿Querés continuar de todas formas y crear la reserva?
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="sw-cancel" style="padding:8px 18px;border-radius:8px;border:1px solid var(--color-border);background:none;font-size:.85rem;cursor:pointer;font-weight:500">Cancelar</button>
            <button id="sw-confirm" style="padding:8px 18px;border-radius:8px;border:none;background:#f97316;color:#fff;font-size:.85rem;cursor:pointer;font-weight:700">Continuar igual</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      const cleanup = (result) => { ov.remove(); resolve(result); };
      ov.querySelector('#sw-cancel').addEventListener('click', () => cleanup(false));
      ov.querySelector('#sw-confirm').addEventListener('click', () => cleanup(true));
      ov.addEventListener('click', e => { if (e.target === ov) cleanup(false); });
    });
  }

  _openPeriodModal(dateFrom, dateTo, existing = null, dragUnitId = null) {
    const id = existing?.id ?? ('p_' + Date.now());
    document.getElementById('cal-period-overlay')?.remove();

    // Tipo: 'visual' | 'soft' | 'block'
    // 'block' delega en _blockRange (Supabase), los otros son solo localStorage.
    // Si el período existente es tipo 'block' ya tiene booking_id guardado.
    const COLORS = [
      { label: 'Índigo',     value: '#6366f1' },
      { label: 'Violeta',    value: '#a855f7' },
      { label: 'Rosado',     value: '#ec4899' },
      { label: 'Magenta',    value: '#d946ef' },
      { label: 'Rojo',       value: '#ef4444' },
      { label: 'Naranja',    value: '#f97316' },
      { label: 'Amarillo',   value: '#eab308' },
      { label: 'Lima',       value: '#84cc16' },
      { label: 'Verde',      value: '#22c55e' },
      { label: 'Esmeralda',  value: '#10b981' },
      { label: 'Celeste',    value: '#0ea5e9' },
      { label: 'Azul',       value: '#3b82f6' },
    ];

    let selType  = existing?.type ?? 'visual';
    let selColor = existing?.color ?? COLORS[0].value;

    // Estilos reutilizables
    const inputSt = 'margin-top:4px;width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:8px;font-size:.85rem;background:var(--color-surface-2);box-sizing:border-box;color:var(--color-text)';
    const inputSmSt = 'margin-top:4px;width:100%;padding:7px 8px;border:1px solid var(--color-border);border-radius:8px;font-size:.8rem;background:var(--color-surface-2);color:var(--color-text)';

    const TYPE_DEF = {
      visual: { emoji: '🏷️', label: 'Solo visual', desc: 'Capa de color informativa. No afecta disponibilidad.', border: '#6366f1' },
      soft:   { emoji: '⚠️', label: 'Condición',   desc: 'Pide confirmación al crear una reserva en estas fechas.', border: '#f97316' },
      block:  { emoji: '🔒', label: 'Bloqueo',     desc: 'Bloqueo real. La unidad no aparece disponible.', border: '#ef4444' },
    };

    const ov = document.createElement('div');
    ov.id = 'cal-period-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;display:flex;align-items:center;justify-content:center';

    const renderTypeChip = (type) => {
      const t = TYPE_DEF[type];
      const active = selType === type;
      const brd = active ? `2px solid ${t.border}` : '1px solid var(--color-border)';
      const bg  = active ? `${t.border}14` : 'transparent';
      const col = active ? t.border : 'var(--color-text-3)';
      return `<button data-type="${type}" style="flex:1;border:${brd};border-radius:10px;padding:8px 6px;background:${bg};cursor:pointer;text-align:center;transition:all .15s">
        <div style="font-size:1.1rem;margin-bottom:2px">${t.emoji}</div>
        <div style="font-size:.72rem;font-weight:700;color:${col};line-height:1.2">${t.label}</div>
      </button>`;
    };

    const buildInner = () => {
      const t = TYPE_DEF[selType];
      const isBlock = selType === 'block';
      // Para bloqueo: selector de unidad (cuando es nuevo) o info de unidad (cuando edita)
      // Checkboxes de unidades — la que inició el drag viene pre-marcada; todas si es header
      const allUnits = this.ctx.units ?? [];
      const unitCheckboxes = allUnits.map(u => {
        const checked = !dragUnitId || u.id === dragUnitId ? 'checked' : '';
        return `<label style="display:flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer;padding:3px 0">
          <input type="checkbox" data-uid="${u.id}" ${checked} style="width:14px;height:14px;cursor:pointer"> ${u.name}
        </label>`;
      }).join('');
      const unitField = isBlock && !existing ? `
        <div style="font-size:.8rem;font-weight:600;color:var(--color-text-2);margin-bottom:2px">Unidades a bloquear</div>
        <div id="pm-units" style="border:1px solid var(--color-border);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;background:var(--color-surface-2)">
          ${unitCheckboxes}
        </div>` : '';
      // Para bloqueo existente: no hay nada que editar aquí, el modal de bloqueo de Supabase lo maneja
      const blockEditNotice = '';
      // Selector de color — solo para visual y soft; bloqueo usa el rojo fijo
      const colorField = !isBlock ? `
        <div style="font-size:.8rem;font-weight:600;color:var(--color-text-2)">Color
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px" id="pm-colors">
            ${COLORS.map(c => `<button data-color="${c.value}" title="${c.label}"
              style="width:20px;height:20px;border-radius:50%;background:${c.value};border:${c.value===selColor?'2.5px solid #fff':'1.5px solid transparent'};box-shadow:${c.value===selColor?'0 0 0 2px '+c.value:'none'};cursor:pointer;transition:all .15s;flex-shrink:0"></button>`).join('')}
          </div>
        </div>` : '';
      // Min nights: no aplica para bloqueo
      const minNField = !isBlock ? `
        <label style="font-size:.8rem;font-weight:600;color:var(--color-text-2)">Mínimo de noches <span style="font-weight:400;color:var(--color-text-3)">(opcional)</span>
          <input id="pm-minnights" type="number" min="1" max="30" placeholder="Ej: 2"
            value="${existing?.min_nights ?? ''}" style="${inputSmSt}">
        </label>` : '';

      return `
      <div style="background:var(--color-surface);border-radius:16px;padding:24px;width:360px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <h3 style="margin:0;font-size:1rem;font-weight:700">${existing ? 'Editar' : 'Nuevo'} período</h3>
          <button id="pm-close" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--color-text-3)">✕</button>
        </div>

        <div style="display:flex;gap:7px;margin-bottom:14px" id="pm-type-row">
          ${Object.keys(TYPE_DEF).map(renderTypeChip).join('')}
        </div>
        <div style="font-size:.72rem;color:var(--color-text-3);margin:-8px 0 14px;text-align:center">${t.desc}</div>

        <div style="display:flex;flex-direction:column;gap:11px">
          <label style="font-size:.8rem;font-weight:600;color:var(--color-text-2)">${isBlock ? 'Motivo' : 'Nombre'}
            <input id="pm-label" type="text" placeholder="${isBlock ? 'Mantenimiento, uso propio…' : 'Ej: Finde largo, Semana Santa…'}"
              value="${existing?.label ?? ''}" style="${inputSt}">
          </label>

          <div style="display:flex;gap:8px">
            <label style="font-size:.8rem;font-weight:600;color:var(--color-text-2);flex:1">Desde
              <input id="pm-from" type="date" value="${dateFrom}" style="${inputSmSt}">
            </label>
            <label style="font-size:.8rem;font-weight:600;color:var(--color-text-2);flex:1">Hasta
              <input id="pm-to" type="date" value="${dateTo}" style="${inputSmSt}">
            </label>
          </div>

          ${unitField}
          ${blockEditNotice}
          ${minNField}

          <label style="font-size:.8rem;font-weight:600;color:var(--color-text-2)">${isBlock ? 'Nota interna' : 'Condición / nota'} <span style="font-weight:400;color:var(--color-text-3)">(opcional)</span>
            <input id="pm-note" type="text" placeholder="${isBlock ? 'Observación interna del bloqueo…' : 'Ej: Mínimo 3 noches, tarifa especial…'}"
              value="${existing?.note ?? ''}" style="${inputSt}">
          </label>

          ${colorField}
        </div>

        <div style="display:flex;gap:8px;margin-top:18px;${existing ? 'justify-content:space-between' : ''}">
          ${existing ? `<button id="pm-delete" style="padding:8px 14px;border-radius:8px;border:1px solid #ef4444;background:none;color:#ef4444;font-size:.82rem;cursor:pointer">Eliminar</button>` : ''}
          <div style="display:flex;gap:8px;margin-left:auto">
            <button id="pm-cancel" style="padding:8px 16px;border-radius:8px;border:1px solid var(--color-border);background:none;font-size:.85rem;cursor:pointer">Cancelar</button>
            <button id="pm-save" style="padding:8px 20px;border-radius:8px;border:none;background:var(--color-primary);color:#fff;font-weight:600;font-size:.85rem;cursor:pointer">Guardar</button>
          </div>
        </div>
      </div>`;
    };

    ov.innerHTML = buildInner();
    document.body.appendChild(ov);

    // Rebind internals after (re)render
    const rebind = () => {
      // Type chips
      ov.querySelectorAll('[data-type]').forEach(btn => {
        btn.addEventListener('click', () => {
          selType = btn.dataset.type;
          // Preserve values across re-render
          const lbl  = ov.querySelector('#pm-label')?.value ?? '';
          const frm  = ov.querySelector('#pm-from')?.value ?? dateFrom;
          const too  = ov.querySelector('#pm-to')?.value ?? dateTo;
          const note = ov.querySelector('#pm-note')?.value ?? '';
          const mn   = ov.querySelector('#pm-minnights')?.value ?? '';
          const inner = document.createElement('div');
          inner.innerHTML = buildInner();
          const newInner = inner.firstElementChild;
          ov.replaceChild(newInner, ov.firstElementChild);
          ov.querySelector('#pm-label').value = lbl;
          ov.querySelector('#pm-from').value  = frm;
          ov.querySelector('#pm-to').value    = too;
          ov.querySelector('#pm-note').value  = note;
          if (ov.querySelector('#pm-minnights')) ov.querySelector('#pm-minnights').value = mn;
          rebind();
        });
      });
      // Color picker
      ov.querySelectorAll('#pm-colors button').forEach(btn => {
        btn.addEventListener('click', () => {
          selColor = btn.dataset.color;
          ov.querySelectorAll('#pm-colors button').forEach(b => {
            b.style.border     = b.dataset.color === selColor ? '3px solid #fff' : '2px solid transparent';
            b.style.boxShadow  = b.dataset.color === selColor ? '0 0 0 2px ' + b.dataset.color : 'none';
          });
        });
      });
      // Close / cancel
      ov.querySelector('#pm-close')?.addEventListener('click', close);
      ov.querySelector('#pm-cancel')?.addEventListener('click', close);
      // Save
      ov.querySelector('#pm-save')?.addEventListener('click', () => doSave());
      // Delete
      ov.querySelector('#pm-delete')?.addEventListener('click', () => doDelete());
    };

    const close = () => ov.remove();
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    rebind();
    setTimeout(() => ov.querySelector('#pm-label')?.focus(), 50);

    const doSave = async () => {
      const label = ov.querySelector('#pm-label').value.trim();
      if (!label) { ov.querySelector('#pm-label').focus(); return; }
      const from = ov.querySelector('#pm-from').value;
      const to   = ov.querySelector('#pm-to').value;
      if (!from || !to || from > to) { showToast('Las fechas son inválidas', 'warning'); return; }
      const note = ov.querySelector('#pm-note').value.trim();
      const mn   = parseInt(ov.querySelector('#pm-minnights')?.value) || null;

      // check_out para bloqueo = to + 1 día (el sistema guarda el día de salida, no la última noche)
      const toDate = new Date(to + 'T12:00:00');
      toDate.setDate(toDate.getDate() + 1);
      const checkOut = toDate.toISOString().slice(0, 10);

      if (selType === 'block') {
        // ── Bloqueo real: crear en Supabase ──
        if (existing?.booking_id) {
          // Bloqueo ya en Supabase: abrir su modal nativo directamente
          close();
          await this.bookingForm?.openEdit(existing.booking_id);
          return;
        }
        // Leer unidades seleccionadas en los checkboxes
        const checkedBoxes = [...(ov.querySelectorAll('#pm-units input[type=checkbox]:checked'))];
        const targetUnitIds = checkedBoxes.map(cb => cb.dataset.uid).filter(Boolean);
        if (!targetUnitIds.length) { showToast('Seleccioná al menos una unidad', 'warning'); return; }
        const saveBtn = ov.querySelector('#pm-save');
        saveBtn.disabled = true; saveBtn.textContent = 'Bloqueando…';
        close();
        for (const uid of targetUnitIds) {
          await this._blockRange(uid, from, checkOut, label);
        }
        return;
      }

      // ── Visual o Soft: solo localStorage (guardan check_out = último día inclusive) ──
      const periods = this._loadPeriods().filter(p => p.id !== id);
      periods.push({ id, label, color: selColor, check_in: from, check_out: to, type: selType, min_nights: mn, note });
      periods.sort((a, b) => a.check_in.localeCompare(b.check_in));
      this._savePeriods(periods);
      close();
      this._renderPeriods();
      showToast('Período guardado ✓', 'success');
    };

    const doDelete = () => {
      if (existing?.type === 'block' && existing?.booking_id) {
        showToast('Para eliminar este bloqueo, hacé clic en su barra en el calendario', 'info');
        return;
      }
      if (!confirm('¿Eliminar este período?')) return;
      this._savePeriods(this._loadPeriods().filter(p => p.id !== id));
      close();
      this._renderPeriods();
    };
  }

  // Configura el modo de selección de período (arrastre sobre las celdas)
  _setupPeriodMode() {
    const btn  = document.getElementById('cal-period-btn');
    const grid = document.getElementById('calendar-grid');
    if (!btn || !grid) return;

    let periodDrag = null;

    btn.addEventListener('click', () => {
      const active = grid.classList.toggle('period-mode');
      btn.classList.toggle('active', active);
      btn.title = active ? 'Clic para salir del modo etiqueta' : 'Etiquetar período / mínimo de noches';
    });

    // Drag en las celdas del header (o en las celdas normales)
    grid.addEventListener('mousedown', e => {
      if (!grid.classList.contains('period-mode')) return;
      const cell = e.target.closest('.cal-day-header[data-date], .cal-cell[data-date]');
      if (!cell) return;
      e.preventDefault();
      const row = cell.closest('[data-unit-id]');
      periodDrag = { start: cell.dataset.date, end: cell.dataset.date, unitId: row?.dataset?.unitId ?? null };
      this._highlightPeriodDrag(grid, periodDrag.start, periodDrag.end);
    });

    grid.addEventListener('mousemove', e => {
      if (!periodDrag) return;
      const cell = e.target.closest('.cal-day-header[data-date], .cal-cell[data-date]');
      if (!cell) return;
      periodDrag.end = cell.dataset.date;
      this._highlightPeriodDrag(grid, periodDrag.start, periodDrag.end);
    });

    const finishDrag = () => {
      if (!periodDrag) return;
      const from = periodDrag.start < periodDrag.end ? periodDrag.start : periodDrag.end;
      const to   = periodDrag.start < periodDrag.end ? periodDrag.end   : periodDrag.start;
      const periodUnitId = periodDrag.unitId;
      grid.querySelectorAll('.period-selecting').forEach(c => c.classList.remove('period-selecting'));
      periodDrag = null;
      // Salir del modo y abrir modal
      grid.classList.remove('period-mode');
      document.getElementById('cal-period-btn')?.classList.remove('active');
      this._openPeriodModal(from, to, null, periodUnitId);
    };
    grid.addEventListener('mouseup', finishDrag);
    document.addEventListener('mouseup', () => {
      if (periodDrag) finishDrag();
    });
  }

  _highlightPeriodDrag(grid, from, to) {
    const mn = from < to ? from : to;
    const mx = from < to ? to   : from;
    grid.querySelectorAll('[data-date]').forEach(c => {
      c.classList.toggle('period-selecting', c.dataset.date >= mn && c.dataset.date <= mx);
    });
  }

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
  // ══════════════════════════════════════════════════
  // MINI AGENDA — Ayuda memoria debajo del calendario
  // Lista compacta de próximas reservas
  // ══════════════════════════════════════════════════
  // ══════════════════════════════════════════════════
  // CUADRO TARIFARIO — solo lectura, debajo de la agenda (PC)
  // ══════════════════════════════════════════════════
  async _renderTariffTable() {
    const wrap = document.getElementById('cal-tariff-wrap');
    if (!wrap) return;

    try {
      const lastIdx = this._dateRange.length - 1;
      const rangeFrom = this._dateRange[0];
      const rangeTo   = this._dateRange[lastIdx];
      const months    = monthsInRange(rangeFrom, rangeTo);

      const [rates, customCols] = await Promise.all([
        fetchMonthlyRates(this.db, this.ctx.hotelId, months),
        fetchCustomColumns(this.db, this.ctx.hotelId, rangeFrom, rangeTo),
      ]);

      const units = (AppContext.units ?? []).slice().sort((a,b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const { columns, rows } = buildTariffGrid({ units, rates, customCols, months });
      const groups = groupRowsByPrice(rows);

      const fmt = n => n == null ? '—' : '$' + Math.round(n).toLocaleString('es-AR');

      if (!columns.length) {
        wrap.innerHTML = `<div class="cal-agenda-title">Cuadro tarifario</div>
          <div style="font-size:.74rem;color:var(--color-text-3);padding:6px 2px">
            Sin tarifas cargadas. Configurálas en <strong>Configuración → Cuadro Tarifario</strong>.
          </div>`;
        return;
      }

      // Ancho de la columna de departamento: ahora muestra solo números (#1, #2 | #3...)
      // así que un ancho fijo chico alcanza — mucho más compacto que el nombre completo.
      let deptColW = 70;
      try {
        const canvas = document.createElement('canvas');
        const ctx2   = canvas.getContext('2d');
        ctx2.font    = '700 12px system-ui';
        let maxPx = 0;
        groups.forEach(g => {
          const label = g.units.map(u => '#' + (u.sort_order ?? '?')).join(' | ');
          const w = ctx2.measureText(label).width;
          if (w > maxPx) maxPx = w;
        });
        deptColW = Math.max(50, Math.min(120, Math.ceil(maxPx) + 24));
      } catch (_) {}

      const COL_W_MIN = 70; // ancho mínimo legible por columna

      // ── Encaje al ancho de N cards de "Próximas reservas" ──
      // Mide el ancho real de una card de agenda ya renderizada y ajusta el
      // total de columnas de mes/especiales para que el cuadro termine
      // alineado con el borde derecho de 2, 3 o 4 cards (lo que más se acerque).
      let COL_W = 88;
      const numCols = columns.length;
      const cardEl = document.querySelector('.cal-agenda-slot');
      const cardW  = cardEl?.getBoundingClientRect().width;
      if (cardW && numCols > 0) {
        const cardGap = 8; // gap real entre cards (.cal-agenda-wrap usa grid gap:8px)
        const naturalTotal = deptColW + numCols * COL_W_MIN;
        // Ancho de N cards juntas (incluye los gaps internos entre ellas)
        const widthForN = n => n * cardW + (n - 1) * cardGap;
        let bestN = 2;
        for (let n = 2; n <= 7; n++) {
          if (widthForN(n) >= naturalTotal) { bestN = n; break; }
          bestN = n; // si ninguna alcanza, usar la más grande disponible (7)
        }
        const targetTotal = widthForN(bestN);
        const colsAvailable = Math.max(0, targetTotal - deptColW);
        COL_W = Math.max(COL_W_MIN, Math.min(140, Math.floor(colsAvailable / numCols)));
      }

      const headerHTML = `
        <tr>
          <th style="text-align:center;padding:6px 10px;font-size:.66rem;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.04em;font-weight:700;width:${deptColW}px;min-width:${deptColW}px">Depto</th>
          ${columns.map(col => col.type === 'month'
            ? `<th style="text-align:right;padding:6px 8px;font-size:.66rem;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.04em;font-weight:700;width:${COL_W}px;min-width:${COL_W}px">${col.label}</th>`
            : `<th style="text-align:right;padding:6px 8px;font-size:.62rem;color:#D97706;text-transform:uppercase;letter-spacing:.03em;font-weight:700;width:${COL_W}px;min-width:${COL_W}px" title="${col.note ?? ''}">📅 ${col.label}</th>`
          ).join('')}
        </tr>`;

      const bodyHTML = groups.map((g, i) => {
        const cellsHTML = g.cells.map(cell => {
          if (cell.type === 'month') {
            const promoTag = cell.promoActive && cell.promoPay && cell.promoFree
              ? `<span style="font-size:.56rem;background:#FEF3C7;color:#92400E;padding:0 3px;border-radius:3px;margin-left:3px">${cell.promoPay}+${cell.promoFree}</span>`
              : '';
            const promoTitle = cell.promoActive && cell.promoPay && cell.promoFree && cell.price != null
              ? ` title="PROMO ${cell.promoPay}+${cell.promoFree} (${fmt(cell.price)}) = ${fmt(cell.price * cell.promoPay)} — pagás ${cell.promoPay} noche${cell.promoPay === 1 ? '' : 's'}, ${cell.promoFree} gratis"`
              : '';
            return `<td${promoTitle} style="text-align:right;padding:5px 8px;font-size:.74rem;color:var(--color-text);white-space:nowrap;${cell.promoActive ? 'cursor:help' : ''}">${fmt(cell.price)}${promoTag}</td>`;
          }
          const sub = cell.nights ? `<span style="font-size:.58rem;color:var(--color-text-3)"> /${cell.nights}n</span>` : '';
          return `<td style="text-align:right;padding:5px 8px;font-size:.74rem;font-weight:600;color:var(--color-text);white-space:nowrap">${fmt(cell.price)}${sub}</td>`;
        }).join('');
        // Etiqueta compacta: "#1" o "#2 | #3" si comparten precio — con puntos de color de cada unidad
        // Cada unidad muestra su propio puntito de color pegado a su número
        // (ej: "●#2 | ●#3"), en vez de agrupar todos los puntos al inicio.
        const numsLabel = g.units.map(u =>
          `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${u.color ?? 'var(--color-primary)'};margin-right:3px;vertical-align:middle"></span>#${u.sort_order ?? '?'}`
        ).join(' <span style="color:var(--color-text-3)">|</span> ');
        return `<tr style="background:${i % 2 === 0 ? 'transparent' : 'var(--color-surface-2)'}">
          <td style="padding:5px 10px;font-size:.74rem;font-weight:700;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center" title="${g.units.map(u=>u.name).join(', ')}">
            ${numsLabel}
          </td>
          ${cellsHTML}
        </tr>`;
      }).join('');

      wrap.innerHTML = `
        <div class="cal-agenda-title">Cuadro tarifario</div>
        <div style="max-height:170px;overflow:auto;border:1px solid var(--color-border);border-radius:8px;display:inline-block;max-width:100%">
          <table style="border-collapse:collapse;table-layout:fixed">
            <thead style="position:sticky;top:0;background:var(--color-surface);z-index:1">${headerHTML}</thead>
            <tbody>${bodyHTML}</tbody>
          </table>
        </div>`;
    } catch (err) {
      console.warn('[Calendar] _renderTariffTable:', err.message);
      wrap.innerHTML = '';
    }
  }


  _renderMiniAgenda(bookings) {
    const el = document.getElementById('cal-mini-agenda-list');
    if (!el) return;

    const today = localToday();
    const DAYS  = ['dom','lun','mar','mié','jue','vie','sáb'];
    const MONTHS= ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

    // Mobile: máx 6 cards; Desktop: máx 7
    const SLOTS = window.innerWidth <= 768 ? 6 : 7;

    // Ventana de búsqueda: desde el inicio visible del calendario
    // (o hoy si ya pasó) hasta el fin de la vista actual.
    // Antes era fijo "hoy + 30 días", lo que ocultaba reservas cuando el
    // usuario navegaba a un período futuro más lejano.
    const winStart = this._windowStart > today ? this._windowStart : today;
    const winEnd   = this._addDays(this._windowStart, this._visibleDays ?? 35);

    // DEBUG temporal — quitar cuando esté confirmado
    console.group('[MiniAgenda] debug');
    console.log('_windowStart:', this._windowStart, '| today:', today, '| _visibleDays:', this._visibleDays);
    console.log('winStart:', winStart, '| winEnd:', winEnd);
    console.log('bookings recibidos:', bookings.length);
    const allNonCancelled = bookings.filter(b => !b.is_blocked && b.status !== 'blocked' && b.status !== 'cancelled');
    console.log('no bloqueados/cancelados:', allNonCancelled.length, allNonCancelled.map(b => `${b.check_in} [${b.status}]`));
    const inRange = allNonCancelled.filter(b => b.check_in >= winStart && b.check_in <= winEnd);
    console.log('en rango fecha:', inRange.length, inRange.map(b => b.check_in));
    console.groupEnd();

    const upcoming = bookings
      .filter(b => !b.is_blocked && b.status !== 'blocked' && b.status !== 'cancelled'
                && b.check_in >= winStart && b.check_in <= winEnd)
      .sort((a, b) => a.check_in.localeCompare(b.check_in))
      .slice(0, SLOTS);
    const cards = [];

    for (let i = 0; i < SLOTS; i++) {
      const b = upcoming[i];
      if (!b) {
        cards.push(
          '<div class="cal-agenda-slot cal-agenda-slot--empty">' +
            '<span class="cal-agenda-empty-text">Sin reserva&nbsp;😢</span>' +
          '</div>'
        );
        continue;
      }
      const fn    = b.guests?.first_name ?? '';
      const ln    = b.guests?.last_name  ?? '';
      const guest = fn ? (fn + (ln ? ' ' + ln : '')) : '—';
      const bUnits = b.booking_units ?? [];
      const unit   = bUnits[0]?.units;
      const nights = Math.round((new Date(b.check_out+'T12:00:00') - new Date(b.check_in+'T12:00:00')) / 86400000);
      const d     = new Date(b.check_in+'T12:00:00');
      const days  = Math.round((d - new Date(today+'T12:00:00')) / 86400000);
      const dStr  = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
      const nStr  = nights + ' noche' + (nights !== 1 ? 's' : '');
      const daysLabel = days === 0 ? 'hoy' : days === 1 ? 'mañana' : 'en ' + days + ' día' + (days !== 1 ? 's' : '');

      // ── Barra lateral: 1 color sólido, o segmentada si hay múltiples unidades ──
      let barHTML;
      let unitLabel;
      if (bUnits.length > 1) {
        const segH = (100 / bUnits.length).toFixed(2);
        barHTML = '<div class="cal-agenda-slot-bar cal-agenda-slot-bar--multi">' +
          bUnits.map(bu => `<div style="height:${segH}%;background:${bu.units?.color ?? 'var(--color-primary)'}"></div>`).join('') +
          '</div>';
        const numbers = bUnits
          .map(bu => bu.units?.sort_order)
          .filter(n => n != null)
          .sort((a,b) => a-b)
          .map(n => '#' + n)
          .join(' ');
        unitLabel = bUnits.length + ' unidades' + (numbers ? ' (' + numbers + ')' : '') + ' · ' + nStr;
      } else {
        const color = unit?.color ?? 'var(--color-primary)';
        barHTML = '<div class="cal-agenda-slot-bar" style="background:' + color + '"></div>';
        unitLabel = (unit?.name ?? '—') + ' · ' + nStr;
      }

      // Avatar con colores de unidad
      const uColors   = bUnits.map(bu => bu.units?.color).filter(Boolean);
      const nameParts = (fn + ' ' + ln).trim().split(' ').filter(Boolean);
      const initials  = ((nameParts[0]?.[0] ?? '') + (nameParts[nameParts.length-1]?.[0] ?? '')).toUpperCase() || '?';
      let avBg, avColor;
      if      (uColors.length === 0) { avBg='var(--color-surface-2)'; avColor='var(--color-text-3)'; }
      else if (uColors.length === 1) { avBg=uColors[0]+'33'; avColor=uColors[0]; }
      else if (uColors.length === 2) { avBg='linear-gradient(135deg,'+uColors[0]+'44 50%,'+uColors[1]+'44 50%)'; avColor='var(--color-text)'; }
      else { const step=Math.round(360/uColors.length); avBg='conic-gradient('+uColors.map((col,i)=>col+'44 '+(i*step)+'deg '+((i+1)*step)+'deg').join(',')+')'; avColor='var(--color-text)'; }

      const SRC_MAP   = {'booking.com':'🔵','airbnb':'🔴','directo':'🟢','whatsapp':'💬','instagram':'📸','referido':'👥'};
      const srcIcon   = SRC_MAP[(b.source ?? '').toLowerCase()] ?? '';
      const amtStr    = b.total_amount > 0 ? '$' + Math.round(b.total_amount / 1000) + 'k' : '';
      const isToday2  = days === 0;

      // Barra lateral segmentada (estructura original del CSS)
      const barTopInner = bUnits.length > 1
        ? '<div class="cal-agenda-slot-bar cal-agenda-slot-bar--multi">'
            + bUnits.map(bu => '<div style="flex:1;background:' + (bu.units?.color ?? 'var(--color-primary)') + '"></div>').join('')
            + '</div>'
        : '<div class="cal-agenda-slot-bar" style="background:' + (uColors[0] ?? 'var(--color-primary)') + '"></div>';

      const todayPill = isToday2
        ? '<span style="font-size:.6rem;font-weight:700;padding:1px 6px;border-radius:99px;background:#f0fdf4;color:#16a34a;white-space:nowrap">HOY</span>'
        : '<span class="cal-agenda-slot-days">' + daysLabel + '</span>';

      cards.push(
        '<div class="cal-agenda-slot" data-booking-id="' + b.id + '" style="cursor:pointer' + (isToday2 ? ';border-color:var(--color-primary);border-width:1.5px' : '') + '">' +
          barTopInner +
          '<div class="cal-agenda-slot-body">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:3px;margin-bottom:4px">' +
              '<span class="cal-agenda-slot-date">' + dStr + '</span>' +
              todayPill +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px">' +
              '<div style="width:26px;height:26px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;background:' + avBg + ';color:' + avColor + '">' + initials + '</div>' +
              '<span class="cal-agenda-slot-guest" style="flex:1;min-width:0">' + guest + '</span>' +
              (srcIcon ? '<span style="font-size:11px;flex-shrink:0">' + srcIcon + '</span>' : '') +
            '</div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;padding-top:3px;border-top:0.5px solid var(--color-border)">' +
              '<span class="cal-agenda-slot-unit" style="flex:1;min-width:0">' + unitLabel + '</span>' +
              (amtStr ? '<span style="font-size:.58rem;font-weight:600;color:var(--color-text-2);flex-shrink:0;margin-left:3px">' + amtStr + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    el.innerHTML = cards.join('');

    // Click en card de agenda → abre popover igual que las barras del calendario
    el.addEventListener('click', (e) => {
      const card = e.target.closest('[data-booking-id]');
      if (!card?.dataset.bookingId) return;
      // Usar el card como ancla del popover
      this._openBarPopover(card.dataset.bookingId, card, e);
    }, { capture: false });
  }
}