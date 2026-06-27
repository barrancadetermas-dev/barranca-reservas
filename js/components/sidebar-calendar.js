// ═══════════════════════════════════════════════════
// sidebar-calendar.js — Mini calendario del sidebar
// Muestra el mes actual con puntos de color por día
// según el tipo/estado de reservas
// ═══════════════════════════════════════════════════

import { AppContext, localToday } from '../supabase-config.js';

const DOTS = {
  family:    { color: '#a855f7', label: 'Familia' },   // violeta
  airbnb:    { color: '#f97316', label: 'Airbnb' },    // naranja
  booking:   { color: '#06b6d4', label: 'Booking' },   // celeste
  unpaid:    { color: '#eab308', label: 'Sin depósito' }, // amarillo
  paid:      { color: '#22c55e', label: 'Pagada' },    // verde
  default:   { color: '#ef4444', label: 'Reservada' }, // rojo
};

export class SidebarCalendar {
  constructor(supabase) {
    this.db      = supabase;
    this._year   = null;
    this._month  = null;
    this._data   = {}; // { 'YYYY-MM-DD': [dot, dot, ...] }
    this._el     = null;
  }

  async init(container) {
    const today = new Date();
    this._year  = today.getFullYear();
    this._month = today.getMonth();

    this._el = document.createElement('div');
    this._el.id = 'sidebar-mini-cal';
    this._el.className = 'sidebar-mini-cal';
    container.appendChild(this._el);

    await this._fetchData();
    this._render();
  }

  async _fetchData() {
    if (!AppContext.hotelId) return;
    const y = this._year, m = this._month;
    const from = `${y}-${String(m+1).padStart(2,'0')}-01`;
    const lastDay = new Date(y, m+1, 0).getDate();
    const to   = `${y}-${String(m+1).padStart(2,'0')}-${lastDay}`;

    const { data } = await this.db
      .from('bookings')
      .select('check_in, check_out, source, payment_status, deposit_paid, guest_type, status')
      .eq('hotel_id', AppContext.hotelId)
      .not('status', 'in', '(cancelled,blocked)')
      .lte('check_in', to)
      .gte('check_out', from);

    this._data = {};
    if (!data) return;

    for (const b of data) {
      // Iterar cada día de la reserva dentro del mes
      const start = new Date(b.check_in  + 'T12:00:00');
      const end   = new Date(b.check_out + 'T12:00:00');
      const cur   = new Date(Math.max(start, new Date(from + 'T12:00:00')));
      const lim   = new Date(Math.min(end,   new Date(to   + 'T12:00:00')));

      while (cur <= lim) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
        if (!this._data[key]) this._data[key] = new Set();

        // Determinar tipo de punto (prioridad: familia > airbnb > booking > sin depósito > pagada > default)
        const src = (b.source || '').toLowerCase();
        const isFamily  = (b.guest_type || '').toLowerCase().includes('famil');
        const isAirbnb  = src.includes('airbnb');
        const isBooking = src.includes('booking');
        const isPaid    = b.payment_status === 'paid' || b.payment_status === 'confirmed';
        const hasDeposit = b.deposit_paid;

        if (isFamily)       this._data[key].add('family');
        else if (isAirbnb)  this._data[key].add('airbnb');
        else if (isBooking) this._data[key].add('booking');
        else if (!hasDeposit && !isPaid) this._data[key].add('unpaid');
        else if (isPaid)    this._data[key].add('paid');
        else                this._data[key].add('default');

        cur.setDate(cur.getDate() + 1);
      }
    }
  }

  _render() {
    if (!this._el) return;
    const y = this._year, m = this._month;
    const today     = localToday();
    const firstDay  = new Date(y, m, 1).getDay(); // 0=dom
    const daysInMonth = new Date(y, m+1, 0).getDate();
    const monthName = new Date(y, m, 1).toLocaleDateString('es-AR', { month: 'long' });

    const weeks = [];
    let week = new Array(firstDay === 0 ? 6 : firstDay - 1).fill(null); // start Monday
    for (let d = 1; d <= daysInMonth; d++) {
      week.push(d);
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length) {
      while (week.length < 7) week.push(null);
      weeks.push(week);
    }

    this._el.innerHTML = `
      <div class="smc-header">
        <button class="smc-nav" id="smc-prev">‹</button>
        <span class="smc-title">${monthName} ${y}</span>
        <button class="smc-nav" id="smc-next">›</button>
      </div>
      <div class="smc-grid">
        <span class="smc-dow">L</span><span class="smc-dow">M</span><span class="smc-dow">X</span>
        <span class="smc-dow">J</span><span class="smc-dow">V</span><span class="smc-dow">S</span><span class="smc-dow">D</span>
        ${weeks.map(wk => wk.map(d => {
          if (!d) return '<span class="smc-day smc-empty"></span>';
          const key = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const isToday = key === today;
          const dots = this._data[key] ? [...this._data[key]] : [];
          return `<span class="smc-day${isToday?' smc-today':''}" title="${key}">
            <span class="smc-num">${d}</span>
            ${dots.length ? `<span class="smc-dots">${dots.slice(0,3).map(t=>`<span class="smc-dot" style="background:${DOTS[t]?.color??'#ef4444'}"></span>`).join('')}</span>` : ''}
          </span>`;
        }).join('')).join('')}
      </div>
      <div class="smc-legend">
        ${Object.entries(DOTS).map(([,v])=>`<span class="smc-leg-item"><span class="smc-dot" style="background:${v.color}"></span><span>${v.label}</span></span>`).join('')}
      </div>`;

    // Nav buttons
    this._el.querySelector('#smc-prev')?.addEventListener('click', () => this._navigate(-1));
    this._el.querySelector('#smc-next')?.addEventListener('click', () => this._navigate(1));
  }

  async _navigate(dir) {
    this._month += dir;
    if (this._month < 0)  { this._month = 11; this._year--; }
    if (this._month > 11) { this._month = 0;  this._year++; }
    this._el.innerHTML = '<div class="smc-loading">···</div>';
    await this._fetchData();
    this._render();
  }

  // Refrescar cuando cambian reservas
  async refresh() {
    await this._fetchData();
    this._render();
  }
}
