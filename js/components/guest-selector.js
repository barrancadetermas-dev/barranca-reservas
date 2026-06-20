// ═══════════════════════════════════════════════════
// guest-selector.js — Componente de búsqueda de huéspedes
// Extraído de booking-form.js para reutilización
// ═══════════════════════════════════════════════════

export class GuestSelector {
  /**
   * @param {object} opts
   * @param {Function} opts.supabase  - Instancia de Supabase
   * @param {object}   opts.ctx       - AppContext
   * @param {string}   opts.searchId  - ID del input de búsqueda
   * @param {string}   opts.resultsId - ID del contenedor de resultados
   * @param {Function} opts.onSelect  - Callback cuando se selecciona un huésped
   */
  constructor({ supabase, ctx, searchId = 'guest-search', resultsId = 'guest-results', onSelect }) {
    this.db          = supabase;
    this.ctx         = ctx;
    this._searchId   = searchId;
    this._resultsId  = resultsId;
    this._onSelect   = onSelect ?? (() => {});
    this._timer      = null;
    this._selected   = null;
    this._lastQuery  = '';
    this._bind();
  }

  _bind() {
    const input = document.getElementById(this._searchId);
    if (!input) return;

    // Remove existing listeners by cloning
    const fresh = input.cloneNode(true);
    input.replaceWith(fresh);

    fresh.addEventListener('input', (e) => {
      clearTimeout(this._timer);
      const q = e.target.value.trim();
      if (q === this._lastQuery) return;
      this._lastQuery = q;
      this._timer = setTimeout(() => this._search(q), 280);
    });

    fresh.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._hideResults();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const items = document.querySelectorAll('.guest-result-item');
        items[0]?.focus();
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest(`#${this._searchId}`) &&
          !e.target.closest(`#${this._resultsId}`)) {
        this._hideResults();
      }
    }, { capture: true });
  }

  async _search(q) {
    const container = document.getElementById(this._resultsId);
    if (!container) return;
    if (q.length < 2) { this._hideResults(); return; }

    // Optimistic loading state
    container.innerHTML = `<div class="guest-search-loading">
      <div class="skeleton-line" style="width:60%"></div>
      <div class="skeleton-line" style="width:40%;margin-top:6px"></div>
    </div>`;
    container.classList.remove('hidden');

    try {
      const { data } = await this.db
        .from('guests')
        .select('id, first_name, last_name, dni, phone, email, bad_experience, tags')
        .eq('hotel_id', this.ctx.hotelId)
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,dni.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(8);

      if (!data?.length) {
        container.innerHTML = `<div class="guest-result-empty">
          Sin resultados para "<strong>${q}</strong>"
          <div style="font-size:.72rem;margin-top:4px;color:var(--color-text-3)">Completá los datos para crear uno nuevo</div>
        </div>`;
        return;
      }

      container.innerHTML = data.map(g => {
        const isBad = g.bad_experience || (g.tags ?? []).includes('no_recomendar');
        const isVIP = (g.tags ?? []).includes('vip');
        const badge = isBad ? '⚠️' : isVIP ? '⭐' : '';
        const initials = this._initials(g);
        const { bg, color } = this._color(g);
        return `<div class="guest-result-item ${isBad ? 'bad-exp' : ''}" data-id="${g.id}"
            data-fn="${g.first_name ?? ''}" data-ln="${g.last_name ?? ''}"
            data-dni="${g.dni ?? ''}" data-phone="${g.phone ?? ''}" data-email="${g.email ?? ''}"
            tabindex="0" role="option">
          <div class="gri-avatar" style="background:${bg};color:${color}">${initials}</div>
          <div class="gri-info">
            <div class="gri-name">${badge} ${g.first_name} ${g.last_name}</div>
            <div class="gri-meta">${[g.dni, g.phone].filter(Boolean).join(' · ')}</div>
          </div>
          ${isBad ? '<div class="gri-badge bad">Antecedente</div>' : isVIP ? '<div class="gri-badge vip">VIP</div>' : ''}
        </div>`;
      }).join('');

      // Bind
      container.querySelectorAll('.guest-result-item').forEach(item => {
        const select = () => {
          const guest = data.find(g => g.id === item.dataset.id);
          this._selected = guest;
          document.getElementById(this._searchId).value = '';
          this._hideResults();
          this._onSelect(guest, {
            id:    item.dataset.id,
            fn:    item.dataset.fn,
            ln:    item.dataset.ln,
            dni:   item.dataset.dni,
            phone: item.dataset.phone,
            email: item.dataset.email,
          });
        };
        item.addEventListener('click', select);
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') select();
          if (e.key === 'ArrowDown') { e.preventDefault(); item.nextElementSibling?.focus(); }
          if (e.key === 'ArrowUp')   { e.preventDefault(); item.previousElementSibling?.focus(); }
        });
      });
    } catch {
      this._hideResults();
    }
  }

  _hideResults() {
    const c = document.getElementById(this._resultsId);
    if (c) { c.innerHTML = ''; c.classList.add('hidden'); }
    this._lastQuery = '';
  }

  reset() {
    this._selected   = null;
    this._lastQuery  = '';
    const inp = document.getElementById(this._searchId);
    if (inp) inp.value = '';
    this._hideResults();
  }

  get selectedId() { return this._selected?.id ?? null; }

  _initials(g) {
    return ((g.first_name?.[0] ?? '') + (g.last_name?.[0] ?? '')).toUpperCase() || '?';
  }
  _color(g) {
    const str  = ((g.first_name ?? '') + (g.last_name ?? '')).toLowerCase();
    let hash   = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const hue  = Math.abs(hash) % 360;
    return { bg: `hsl(${hue},55%,88%)`, color: `hsl(${hue},55%,32%)` };
  }
}
