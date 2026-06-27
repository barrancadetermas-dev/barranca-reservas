// ═══════════════════════════════════════════════════
// sidebar-calendar.js — Mini calendario del sidebar
// ═══════════════════════════════════════════════════

import { AppContext, localToday, SOURCE_CONFIG, getBookingBarColor } from '../supabase-config.js';

export class SidebarCalendar {
  constructor(supabase) {
    this.db    = supabase;
    this._year  = null;
    this._month = null;
    this._data  = {};
    this._el    = null;
  }

  async init(container) {
    const today  = new Date();
    this._year   = today.getFullYear();
    this._month  = today.getMonth();
    this._el     = document.createElement('div');
    this._el.id  = 'sidebar-mini-cal';
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
    const to = `${y}-${String(m+1).padStart(2,'0')}-${lastDay}`;

    const { data, error } = await this.db
      .from('bookings')
      .select('check_in, check_out, source, balance, total_amount, status')
      .eq('hotel_id', AppContext.hotelId)
      .not('status', 'in', '(cancelled,blocked)')
      .lte('check_in', to)
      .gte('check_out', from);

    if (error) { console.warn('[SidebarCal] fetch error:', error.message); return; }

    this._data = {};
    if (!data?.length) return;

    for (const b of data) {
      // Obtener el color usando la misma lógica que el calendario principal
      const { color } = getBookingBarColor(b);

      const start = new Date(b.check_in  + 'T12:00:00');
      const end   = new Date(b.check_out + 'T12:00:00');

      const cur = new Date(Math.max(start.getTime(), new Date(from + 'T12:00:00').getTime()));
      const lim = new Date(Math.min(end.getTime(),   new Date(to   + 'T12:00:00').getTime()));

      // cur < lim: el día de checkout NO se marca (la unidad queda libre ese día)
      while (cur < lim) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
        if (!this._data[key]) this._data[key] = new Set();
        this._data[key].add(color);
        cur.setDate(cur.getDate() + 1);
      }
    }
  }

  _render() {
    if (!this._el) return;
    const y = this._year, m = this._month;
    const todayStr  = localToday();
    const firstDow  = new Date(y, m, 1).getDay(); // 0=dom
    const daysInMon = new Date(y, m+1, 0).getDate();
    const monthName = new Date(y, m, 1).toLocaleDateString('es-AR', { month: 'long' });

    // Build weeks starting Monday
    const offset = firstDow === 0 ? 6 : firstDow - 1;
    let cells = new Array(offset).fill(null);
    for (let d = 1; d <= daysInMon; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);

    this._el.innerHTML = `
      <div class="smc-header">
        <button class="smc-nav" id="smc-prev">‹</button>
        <span class="smc-title">${monthName} ${y}</span>
        <button class="smc-nav" id="smc-next">›</button>
      </div>
      <div class="smc-grid">
        <span class="smc-dow">L</span><span class="smc-dow">M</span><span class="smc-dow">X</span>
        <span class="smc-dow">J</span><span class="smc-dow">V</span><span class="smc-dow">S</span><span class="smc-dow">D</span>
        ${cells.map(d => {
          if (!d) return '<span class="smc-day smc-empty"></span>';
          const key = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const isToday = key === todayStr;
          const colors = this._data[key] ? [...this._data[key]] : [];
          return `<span class="smc-day${isToday?' smc-today':''}">
            <span class="smc-num">${d}</span>
            ${colors.length ? `<span class="smc-dots">${colors.slice(0,3).map(c =>
              `<span class="smc-dot" style="background:${c}"></span>`
            ).join('')}</span>` : ''}
          </span>`;
        }).join('')}
      </div>`;

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

  async refresh() {
    await this._fetchData();
    this._render();
  }
}
