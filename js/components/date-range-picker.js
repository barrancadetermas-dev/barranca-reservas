// ═══════════════════════════════════════════════════
// date-range-picker.js v1.0 — Selector visual de fechas
// Reemplaza los <input type="date"> del formulario
// Muestra disponibilidad por unidad seleccionada
// ═══════════════════════════════════════════════════

const DAY_NAMES   = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];
const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

export class DateRangePicker {
  constructor(container, options = {}) {
    this._container    = typeof container === 'string'
      ? document.getElementById(container) : container;
    this._onChange     = options.onChange ?? (() => {});
    this._blockedDates = new Set(options.blockedDates ?? []); // Set of 'YYYY-MM-DD'
    this._startDate    = null;
    this._endDate      = null;
    this._hovering     = null;
    this._selecting    = false; // true = eligiendo check-out
    const now          = new Date();
    this._year         = now.getFullYear();
    this._month        = now.getMonth();
    this._render();
  }

  // ── API pública ───────────────────────────────────
  setValue(start, end) {
    this._startDate = start || null;
    this._endDate   = end   || null;
    this._render();
  }

  getValue() {
    return { checkIn: this._startDate, checkOut: this._endDate };
  }

  setBlockedDates(dates) {
    this._blockedDates = new Set(dates);
    this._render();
  }

  clear() {
    this._startDate = null;
    this._endDate   = null;
    this._selecting = false;
    this._hovering  = null;
    this._render();
    this._onChange(null, null);
  }

  // ── Render ────────────────────────────────────────
  _render() {
    if (!this._container) return;
    this._container.innerHTML = `
      <div class="drp-wrapper">
        <div class="drp-header">
          <button class="drp-nav-btn" id="drp-prev">‹</button>
          <div class="drp-months-container">
            ${this._renderMonth(this._year, this._month)}
            ${this._renderMonth(
              this._month === 11 ? this._year + 1 : this._year,
              this._month === 11 ? 0 : this._month + 1
            )}
          </div>
          <button class="drp-nav-btn" id="drp-next">›</button>
        </div>
        <div class="drp-footer">
          ${this._startDate && this._endDate ? `
            <span class="drp-summary">
              📅 ${this._fmtDisplay(this._startDate)} → ${this._fmtDisplay(this._endDate)}
              · ${this._nightsBetween(this._startDate, this._endDate)} noches
            </span>
            <button class="drp-clear-btn" id="drp-clear">✕ Limpiar</button>
          ` : `
            <span class="drp-hint">
              ${!this._startDate ? '👆 Seleccioná la fecha de ingreso' :
                !this._endDate  ? '👆 Ahora seleccioná la fecha de salida' : ''}
            </span>
          `}
        </div>
      </div>`;

    this._container.querySelector('#drp-prev')?.addEventListener('click', () => {
      this._month--;
      if (this._month < 0) { this._month = 11; this._year--; }
      this._render();
    });
    this._container.querySelector('#drp-next')?.addEventListener('click', () => {
      this._month++;
      if (this._month > 11) { this._month = 0; this._year++; }
      this._render();
    });
    this._container.querySelector('#drp-clear')?.addEventListener('click', () => this.clear());

    this._container.querySelectorAll('.drp-day[data-date]').forEach(el => {
      el.addEventListener('click',      () => this._handleDayClick(el.dataset.date));
      el.addEventListener('mouseenter', () => { this._hovering = el.dataset.date; this._render(); });
      el.addEventListener('mouseleave', () => { this._hovering = null; this._render(); });
    });
  }

  _renderMonth(year, month) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay    = new Date(year, month, 1).getDay(); // 0=Dom
    const startOffset = (firstDay + 6) % 7; // adjust to Mon-start
    const today       = new Date().toISOString().split('T')[0];

    let html = `
      <div class="drp-month">
        <div class="drp-month-title">${MONTH_NAMES[month]} ${year}</div>
        <div class="drp-day-headers">
          ${DAY_NAMES.map(d => `<div class="drp-day-name">${d}</div>`).join('')}
        </div>
        <div class="drp-days">
          ${Array.from({ length: startOffset }, () => '<div class="drp-day drp-day-empty"></div>').join('')}`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr  = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isPast   = dateStr < today;
      const isToday  = dateStr === today;
      const isBlocked = this._blockedDates.has(dateStr);
      const isStart  = dateStr === this._startDate;
      const isEnd    = dateStr === this._endDate;
      const hover    = this._startDate && !this._endDate && this._hovering && this._hovering > this._startDate;
      const inRange  = this._startDate && this._endDate
        ? dateStr > this._startDate && dateStr < this._endDate
        : hover && this._hovering
          ? dateStr > this._startDate && dateStr <= this._hovering
          : false;

      const classes = [
        'drp-day',
        isPast    ? 'drp-past'    : '',
        isToday   ? 'drp-today'   : '',
        isBlocked ? 'drp-blocked' : '',
        isStart   ? 'drp-start'   : '',
        isEnd     ? 'drp-end'     : '',
        inRange   ? 'drp-in-range': '',
        (!isPast && !isBlocked) ? 'drp-available' : '',
      ].filter(Boolean).join(' ');

      html += `<div class="${classes}" data-date="${dateStr}" title="${isBlocked ? '🔴 Ocupado' : ''}">
        <span>${d}</span>
        ${isBlocked ? '<div class="drp-blocked-dot"></div>' : ''}
      </div>`;
    }

    html += '</div></div>';
    return html;
  }

  // ── Lógica de selección ───────────────────────────
  _handleDayClick(dateStr) {
    const today = new Date().toISOString().split('T')[0];
    if (dateStr < today) return; // no permitir fechas pasadas

    if (!this._startDate || (this._startDate && this._endDate)) {
      // Empezar nueva selección
      this._startDate = dateStr;
      this._endDate   = null;
      this._selecting = true;
    } else {
      // Seleccionar check-out
      if (dateStr <= this._startDate) {
        // Si clickea antes del start, resetear
        this._startDate = dateStr;
        this._endDate   = null;
        return this._render();
      }
      // Validar que no haya fechas bloqueadas en el rango
      const blocked = this._hasBlockedInRange(this._startDate, dateStr);
      if (blocked) {
        this._showRangeError();
        return;
      }
      this._endDate   = dateStr;
      this._selecting = false;
      this._onChange(this._startDate, this._endDate);
    }
    this._render();
  }

  _hasBlockedInRange(start, end) {
    for (const blocked of this._blockedDates) {
      if (blocked > start && blocked < end) return true;
    }
    return false;
  }

  _showRangeError() {
    const hint = this._container.querySelector('.drp-hint');
    if (hint) {
      hint.textContent = '⚠️ Hay fechas ocupadas en ese rango. Seleccioná otro período.';
      hint.style.color = '#DC2626';
      setTimeout(() => { hint.textContent = ''; hint.style.color = ''; }, 3000);
    }
  }

  // ── Helpers ───────────────────────────────────────
  _nightsBetween(start, end) {
    const d1 = new Date(start + 'T12:00:00');
    const d2 = new Date(end   + 'T12:00:00');
    return Math.round((d2 - d1) / 86400000);
  }

  _fmtDisplay(d) {
    if (!d) return '—';
    return new Date(d + 'T12:00:00').toLocaleDateString('es-AR', {
      day: '2-digit', month: 'short',
    });
  }
}
