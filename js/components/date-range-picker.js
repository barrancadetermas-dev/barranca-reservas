// ═══════════════════════════════════════════════════
// date-range-picker.js v2.0 — FIX
// • Hover via CSS class — sin re-render en mouseenter
// • Re-render solo cuando cambian start/end dates
// • Soporte touch para mobile
// ═══════════════════════════════════════════════════

const DAY_NAMES   = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];
const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

export class DateRangePicker {
  constructor(container, options = {}) {
    this._container    = typeof container === 'string'
      ? document.getElementById(container) : container;
    this._onChange     = options.onChange ?? (() => {});
    this._blockedDates = new Set(options.blockedDates ?? []);
    this._startDate    = null;
    this._endDate      = null;
    this._hoverDate    = null;
    const now          = new Date();
    this._year         = now.getFullYear();
    this._month        = now.getMonth();
    if (this._container) this._render();
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
    this._hoverDate = null;
    this._render();
    this._onChange(null, null);
  }

  // ── Render completo — solo al cambiar datos ───────
  _render() {
    if (!this._container) return;

    const nextM = this._month === 11 ? 0  : this._month + 1;
    const nextY = this._month === 11 ? this._year + 1 : this._year;

    this._container.innerHTML = `
      <div class="drp-wrapper">
        <div class="drp-header">
          <button class="drp-nav-btn" id="drp-prev" type="button" aria-label="Mes anterior">‹</button>
          <div class="drp-months-container">
            ${this._renderMonthHTML(this._year, this._month)}
            ${this._renderMonthHTML(nextY, nextM)}
          </div>
          <button class="drp-nav-btn" id="drp-next" type="button" aria-label="Mes siguiente">›</button>
        </div>
        <div class="drp-footer">
          ${this._startDate && this._endDate
            ? `<span class="drp-summary">
                 📅 ${this._fmt(this._startDate)} → ${this._fmt(this._endDate)}
                 · ${this._nights(this._startDate, this._endDate)} noches
               </span>
               <button class="drp-clear-btn" id="drp-clear" type="button">✕ Limpiar</button>`
            : `<span class="drp-hint" id="drp-hint">
                 ${!this._startDate ? '👆 Seleccioná la fecha de ingreso'
                   : '👆 Ahora seleccioná la fecha de salida'}
               </span>`}
        </div>
      </div>`;

    // ── Bind navegación ───────────────────────────────
    this._container.querySelector('#drp-prev').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this._month === 0) { this._month = 11; this._year--; }
      else this._month--;
      this._render();
    });
    this._container.querySelector('#drp-next').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this._month === 11) { this._month = 0; this._year++; }
      else this._month++;
      this._render();
    });
    this._container.querySelector('#drp-clear')?.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.clear();
    });

    // ── Bind días — hover via CSS, click dispara re-render ──
    this._container.querySelectorAll('.drp-day[data-date]').forEach(el => {
      // Click
      el.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (el.classList.contains('drp-blocked')) return;
        this._handleClick(el.dataset.date);
      });

      // Touch support
      el.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (el.classList.contains('drp-blocked')) return;
        this._handleClick(el.dataset.date);
      }, { passive: false });

      // Hover: solo actualiza clase CSS — sin re-render
      el.addEventListener('mouseenter', () => {
        if (!this._startDate || this._endDate) return;
        this._hoverDate = el.dataset.date;
        this._updateRangeHighlight();
      });
    });

    this._container.addEventListener('mouseleave', () => {
      this._hoverDate = null;
      this._updateRangeHighlight();
    });
  }

  // ── Render HTML de un mes ─────────────────────────
  _renderMonthHTML(year, month) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDow    = new Date(year, month, 1).getDay();
    const startOffset = (firstDow + 6) % 7; // lunes = 0
    const today       = new Date().toISOString().split('T')[0];

    let cells = Array.from({ length: startOffset }, () =>
      '<div class="drp-day drp-day-empty"></div>').join('');

    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isPast    = ds < today;
      const isToday   = ds === today;
      const isBlocked = this._blockedDates.has(ds);
      const isStart   = ds === this._startDate;
      const isEnd     = ds === this._endDate;
      const inRange   = this._startDate && this._endDate
        ? ds > this._startDate && ds < this._endDate
        : false;

      const cls = [
        'drp-day',
        isPast    ? 'drp-past'      : '',
        isToday   ? 'drp-today'     : '',
        isBlocked ? 'drp-blocked'   : '',
        isStart   ? 'drp-start'     : '',
        isEnd     ? 'drp-end'       : '',
        inRange   ? 'drp-in-range'  : '',
        !isBlocked ? 'drp-available' : '',
      ].filter(Boolean).join(' ');

      cells += `<div class="${cls}" data-date="${ds}" title="${isBlocked ? '🔴 Ocupado' : ds}">
        <span>${d}</span>
        ${isBlocked ? '<div class="drp-blocked-dot"></div>' : ''}
      </div>`;
    }

    return `
      <div class="drp-month">
        <div class="drp-month-title">${MONTH_NAMES[month]} ${year}</div>
        <div class="drp-day-headers">
          ${DAY_NAMES.map(n => `<div class="drp-day-name">${n}</div>`).join('')}
        </div>
        <div class="drp-days" data-year="${year}" data-month="${month}">${cells}</div>
      </div>`;
  }

  // ── Highlight de rango hover — sin re-render ──────
  _updateRangeHighlight() {
    if (!this._container) return;
    const hover = this._hoverDate;

    this._container.querySelectorAll('.drp-day[data-date]').forEach(el => {
      const ds = el.dataset.date;
      if (!this._startDate || this._endDate) {
        el.classList.remove('drp-hover-range', 'drp-hover-end');
        return;
      }
      if (hover && hover > this._startDate) {
        const inHover = ds > this._startDate && ds < hover;
        const isHoverEnd = ds === hover;
        el.classList.toggle('drp-hover-range', inHover);
        el.classList.toggle('drp-hover-end', isHoverEnd && !el.classList.contains('drp-blocked'));
      } else {
        el.classList.remove('drp-hover-range', 'drp-hover-end');
      }
    });
  }

  // ── Lógica de click ───────────────────────────────
  _handleClick(ds) {
    if (!this._startDate || (this._startDate && this._endDate)) {
      // Iniciar nueva selección
      this._startDate = ds;
      this._endDate   = null;
      this._hoverDate = null;
      this._render();
      return;
    }

    // Segunda fecha (checkout)
    if (ds <= this._startDate) {
      // Clic antes del start → resetear
      this._startDate = ds;
      this._endDate   = null;
      this._render();
      return;
    }

    if (this._hasBlockedInRange(this._startDate, ds)) {
      const hint = this._container.querySelector('#drp-hint');
      if (hint) {
        hint.textContent = '⚠️ Hay fechas ocupadas en ese rango. Elegí otro período.';
        hint.style.color = '#DC2626';
        setTimeout(() => {
          if (hint) { hint.textContent = '👆 Seleccioná la fecha de ingreso'; hint.style.color = ''; }
        }, 3000);
      }
      return;
    }

    this._endDate   = ds;
    this._hoverDate = null;
    this._render();
    this._onChange(this._startDate, this._endDate);
  }

  _hasBlockedInRange(start, end) {
    for (const b of this._blockedDates) {
      if (b > start && b < end) return true;
    }
    return false;
  }

  _nights(start, end) {
    return Math.round((new Date(end + 'T12:00:00') - new Date(start + 'T12:00:00')) / 86400000);
  }

  _fmt(d) {
    if (!d) return '—';
    return new Date(d + 'T12:00:00').toLocaleDateString('es-AR', { day:'2-digit', month:'short' });
  }
}
