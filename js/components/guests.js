// ═══════════════════════════════════════════════════
// guests.js — CRM de Huéspedes
// Ficha única, historial cronológico, antecedentes,
// buscador inteligente (nombre / teléfono / email)
// ═══════════════════════════════════════════════════

import { formatARS, formatDate, showToast, getUnitChipHTML, getUnitLabel } from '../supabase-config.js';

// Escapa texto para insertarlo seguro dentro de atributos/HTML (el modal de
// edición inyecta valores de huésped directamente en el markup).
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

const STATUS_LABELS = {
  pending:   'Sin seña',
  partial:   'Señada',
  paid:      'Abonada',
  cancelled: 'Cancelada',
  blocked:   'Bloqueada',
};
const STATUS_COLORS = {
  pending:  ['#FFFBEB','#92400E'],
  partial:  ['#FFF1F2','#9F1239'],
  paid:     ['#F0FDF4','#14532D'],
  cancelled:['#F1F5F9','#475569'],
};

export class GuestsCRM {
  constructor(supabase, ctx, bookingForm) {
    this.db          = supabase;
    this.ctx         = ctx;
    this.bookingForm = bookingForm;
    this._currentGuest = null;
    this._searchTimer  = null;
  }

  // ── Entrada pública ──────────────────────────────
  async load() {
    this._renderSearchView();
  }

  // ══════════════════════════════════════════════════
  // VISTA PRINCIPAL: BUSCADOR
  // ══════════════════════════════════════════════════
  _renderSearchView() {
    const container = document.getElementById('guests-container');
    if (!container) return;

    container.innerHTML = `
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <h3>Buscador de Huéspedes</h3>
          <span style="font-size:.78rem;color:var(--color-text-3)">Buscá por nombre, teléfono o email</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <div class="search-bar" style="margin-bottom:0;flex:1;min-width:200px" id="guests-search-bar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              width="17" height="17" class="search-icon">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="text" id="guests-search-input" class="search-input"
              placeholder="Nombre, teléfono, email...">
          </div>
          <div class="bl-sort-wrap" style="display:flex;align-items:center;gap:8px">
            <span class="bl-sort-label" style="font-size:.78rem;color:var(--color-text-3);white-space:nowrap">Ordenar:</span>
            <select id="guests-sort-select" class="filter-select"
              style="font-size:.78rem;padding:4px 8px;border:1px solid var(--color-border);
                     border-radius:var(--r-md);background:var(--color-surface);color:var(--color-text);cursor:pointer">
              <option value="recent">🕐 Más recientes</option>
              <option value="name_az">🔤 Nombre A→Z</option>
              <option value="name_za">🔤 Nombre Z→A</option>
              <option value="last_az">🔤 Apellido A→Z</option>
              <option value="last_za">🔤 Apellido Z→A</option>
              <option value="spent_desc">💰 Mayor gasto</option>
              <option value="spent_asc">💰 Menor gasto</option>
              <option value="bookings_desc">📅 Más reservas</option>
              <option value="next_stay">✈️ Próxima estadía</option>
              <option value="last_stay">📆 Última estadía</option>
              <option value="credit_note">🔄 Nota de crédito abierta</option>
            </select>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:5px;margin:6px 0 4px;align-items:center;flex-wrap:wrap">
        <span style="font-size:.7rem;color:var(--color-text-3)">Mostrar:</span>
        ${[10,25,50,100].map(n => `<button onclick="window._guestsCRM?._setLimit(${n})"
          id="bl-limit-${n}" style="font-size:.68rem;padding:2px 9px;border-radius:999px;cursor:pointer;
          border:1px solid var(--color-border);background:var(--color-surface-2);color:var(--color-text-2)">${n}</button>`).join('')}
        <span style="font-size:.7rem;color:var(--color-text-3);margin-left:8px" id="bl-total-label"></span>
        <button id="btn-export-guests" class="btn btn-outline btn-sm" style="margin-left:auto;gap:5px;font-size:.72rem">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Exportar ▾
        </button>
      </div>
      <div id="guests-results-area">
        <div style="padding:16px;text-align:center;color:var(--color-text-3)">⟳ Cargando...</div>
      </div>
      <div id="guests-destacados-area"></div>
    `;

    const input = document.getElementById('guests-search-input');
    input?.addEventListener('input', (e) => {
      clearTimeout(this._searchTimer);
      const q = e.target.value.trim();
      if (q.length === 0) { this._loadAll(); return; }
      if (q.length < 2) return;
      this._searchTimer = setTimeout(() => this._search(q), 280);
    });

    // Botón Exportar huéspedes
    document.getElementById('btn-export-guests')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      import('../services/export-service.js').then(({ showExportDropdown, exportBookingsExcel, exportBookingsCSV, exportBookingsPDF }) => {
        showExportDropdown({
          anchorEl: btn,
          type: 'guests',
          data: this._allGuestsData ?? [],
          onExport: ({ fmt: f, data, from, to }) => {
            const range = from && to ? `${from.split('-').reverse().join('/')} → ${to.split('-').reverse().join('/')}` : '';
            if (f === 'excel') exportBookingsExcel(data, 'huespedes', range);
            else if (f === 'pdf') exportBookingsPDF(data, range);
            else exportBookingsCSV(data);
          },
        });
      }).catch(err => console.error('[Export guests]', err));
    });

    // Sort selector
    const sortSel = document.getElementById('guests-sort-select');
    if (sortSel) {
      sortSel.value = localStorage.getItem('mila_guest_sort') ?? 'recent';
      sortSel.addEventListener('change', () => {
        localStorage.setItem('mila_guest_sort', sortSel.value);
        const q = document.getElementById('guests-search-input')?.value.trim();
        if (q && q.length >= 2) this._search(q);
        else this._loadAll();
      });
    }

    this._guestLimit = parseInt(localStorage.getItem('mila_guest_limit') ?? '10');
    this._loadAll();
    this._loadDestacados();
  }

  _updateLimitButtons(n) {
    [10,25,50,100].forEach(x => {
      const btn = document.getElementById(`bl-limit-${x}`);
      if (btn) {
        btn.style.background  = x===n ? 'var(--color-primary)'   : 'var(--color-surface-2)';
        btn.style.color       = x===n ? 'white'                  : 'var(--color-text-2)';
        btn.style.borderColor = x===n ? 'var(--color-primary)'   : 'var(--color-border)';
      }
    });
  }

  _setLimit(n) {
    this._guestLimit = n;
    localStorage.setItem('mila_guest_limit', n);
    this._updateLimitButtons(n);
    const q = document.getElementById('guests-search-input')?.value.trim();
    if (q && q.length >= 2) this._search(q); else this._loadAll();
  }

  // ── Ordenar array de huéspedes según selector ──
  // Nota de crédito abierta (reprogramación sin fecha nueva todavía) —
  // usa el mismo tag 🔄NC:<monto>:<fecha ISO> que booking-list.js.
  _attachOpenCreditNote(g) {
    const ncBooking = (g.bookings ?? []).find(b =>
      b.status === 'cancelled' && b.notes?.includes('🔄NC:') &&
      !b.notes?.includes('✅NCUSED') && !b.notes?.includes('❌NCVOID'));
    if (!ncBooking) return;
    const m = ncBooking.notes.match(/🔄NC:(\d+):(\d{4}-\d{2}-\d{2})/);
    if (!m) return;
    const ageDays = Math.round((Date.now() - new Date(m[2] + 'T00:00:00')) / 86400000);
    g.open_credit_note = { amount: parseInt(m[1], 10), ageDays, stale: ageDays >= 90, bookingId: ncBooking.id };
  }

  _sortGuests(guests) {
    const sort = localStorage.getItem('mila_guest_sort') ?? 'recent';
    const today = new Date().toISOString().slice(0,10);
    const copy  = [...guests];
    const cmp = {
      recent:       (a,b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''),
      name_az:      (a,b) => (a.first_name ?? '').localeCompare(b.first_name ?? ''),
      name_za:      (a,b) => (b.first_name ?? '').localeCompare(a.first_name ?? ''),
      last_az:      (a,b) => (a.last_name ?? '').localeCompare(b.last_name ?? ''),
      last_za:      (a,b) => (b.last_name ?? '').localeCompare(a.last_name ?? ''),
      spent_desc:   (a,b) => (b.total_spent ?? 0) - (a.total_spent ?? 0),
      spent_asc:    (a,b) => (a.total_spent ?? 0) - (b.total_spent ?? 0),
      bookings_desc:(a,b) => (b.total_bookings ?? 0) - (a.total_bookings ?? 0),
      next_stay:    (a,b) => {
        // próxima estadía futura
        const fa = (a.bookings ?? []).filter(bk => bk.check_in >= today).sort((x,y) => x.check_in.localeCompare(y.check_in))[0]?.check_in ?? '9999';
        const fb = (b.bookings ?? []).filter(bk => bk.check_in >= today).sort((x,y) => x.check_in.localeCompare(y.check_in))[0]?.check_in ?? '9999';
        return fa.localeCompare(fb);
      },
      last_stay:    (a,b) => (b.last_checkin ?? '').localeCompare(a.last_checkin ?? ''),
      credit_note:  (a,b) => {
        if (!!b.open_credit_note - !!a.open_credit_note !== 0) return !!b.open_credit_note - !!a.open_credit_note;
        return (b.open_credit_note?.ageDays ?? 0) - (a.open_credit_note?.ageDays ?? 0);
      },
    };
    return copy.sort(cmp[sort] ?? cmp.recent);
  }

  async _loadAll() {
    const area = document.getElementById('guests-results-area');
    if (!area) return;
    const limit = this._guestLimit ?? 25;
    area.innerHTML = `<div style="padding:16px;text-align:center;color:var(--color-text-3)">⟳ Cargando...</div>`;
    const { data: guests } = await this.db
      .from('guests')
      .select(`id, first_name, last_name, phone, email, dni, nationality, tags, bad_experience, created_at, locality, age, car_model, car_plate,
        bookings!bookings_guest_id_fkey(id, total_paid, check_in, check_out, status, notes,
          booking_units(units(name, color))),
        guest_notes!guest_notes_guest_id_fkey(body, category, created_at)`)
      .eq('hotel_id', this.ctx.hotelId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!guests?.length) {
      area.innerHTML = '<div class="empty-state"><span class="empty-state-icon">👤</span><p>Sin huéspedes aún.</p></div>';
      return;
    }
    this._allGuestsData = guests; // cache para exportar
    guests.forEach(g => {
      const bks = (g.bookings ?? []).filter(b => b.status !== 'blocked' && b.status !== 'cancelled');
      g.total_bookings = bks.length;
      g.total_spent    = bks.reduce((s, b) => s + (b.total_paid ?? 0), 0);
      const sorted     = bks.sort((a,b) => b.check_in.localeCompare(a.check_in));
      g.last_checkin   = sorted[0]?.check_in ?? null;
      g.last_checkout  = sorted[0]?.check_out ?? null;
      // TODAS las unidades de la última reserva (no solo la primera) — fix bug "1 unidad" cuando son 4
      g.last_units     = (sorted[0]?.booking_units ?? []).map(bu => bu.units).filter(Boolean);
      g.last_unit      = g.last_units[0] ?? null; // compat con código que use last_unit singular
      g.prev_units     = [...new Set(sorted.slice(1,4).flatMap(b => (b.booking_units ?? []).map(bu => bu.units?.name)).filter(Boolean))];
      // Nota más reciente
      const allNotes   = (g.guest_notes ?? []).sort((a,b) => b.created_at.localeCompare(a.created_at));
      g.latest_note    = allNotes[0]?.body ?? null;
      this._attachOpenCreditNote(g);
    });
    const sorted = this._sortGuests(guests);
    area.innerHTML = sorted.map(g => this._renderGuestCard(g)).join('');
    area.querySelectorAll('.guest-row-item').forEach(card =>
      card.addEventListener('click', () => this._openProfile(card.dataset.guestId)));
    const lbl = document.getElementById('bl-total-label');
    if (lbl) lbl.textContent = guests.length >= limit ? `Mostrando los últimos ${limit}` : `${guests.length} huéspedes`;
    this._updateLimitButtons(limit);
  }

  // ══════════════════════════════════════════════════
  // BÚSQUEDA INTELIGENTE
  // ══════════════════════════════════════════════════
  async _search(query) {
    const area = document.getElementById('guests-results-area');
    if (!area) return;

    area.innerHTML = `
      <div class="skeleton-box" style="height:72px;margin-bottom:8px"></div>
      <div class="skeleton-box" style="height:72px;margin-bottom:8px"></div>
      <div class="skeleton-box" style="height:72px"></div>`;

    const { data: guests, error } = await this.db
      .from('guests')
      .select(`id, first_name, last_name, phone, email, dni, nationality, tags, bad_experience, created_at, locality, age, car_model, car_plate,
        bookings!bookings_guest_id_fkey(id, total_paid, check_in, check_out, status, notes,
          booking_units(units(name, color))),
        guest_notes!guest_notes_guest_id_fkey(body, category, created_at)`)
      .eq('hotel_id', this.ctx.hotelId)
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%,dni.ilike.%${query}%`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (guests) guests.forEach(g => {
      const bks = (g.bookings ?? []).filter(b => b.status !== 'blocked' && b.status !== 'cancelled');
      g.total_bookings = bks.length;
      g.total_spent    = bks.reduce((s, b) => s + (b.total_paid ?? 0), 0);
      const sorted2    = bks.sort((a,b) => b.check_in.localeCompare(a.check_in));
      g.last_checkin   = sorted2[0]?.check_in ?? null;
      g.last_checkout  = sorted2[0]?.check_out ?? null;
      g.last_units     = (sorted2[0]?.booking_units ?? []).map(bu => bu.units).filter(Boolean);
      g.last_unit      = g.last_units[0] ?? null;
      g.prev_units     = [...new Set(sorted2.slice(1,4).flatMap(b => (b.booking_units ?? []).map(bu => bu.units?.name)).filter(Boolean))];
      const allNotes   = (g.guest_notes ?? []).sort((a,b) => b.created_at.localeCompare(a.created_at));
      g.latest_note    = allNotes[0]?.body ?? null;
      this._attachOpenCreditNote(g);
    });

    if (error) { showToast('Error al buscar huéspedes', 'error'); return; }

    if (!guests?.length) {
      area.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">🔍</span>
          <p>Sin resultados para "<strong>${query}</strong>".</p>
        </div>`;
      return;
    }

    area.innerHTML = this._sortGuests(guests).map(g => this._renderGuestCard(g)).join('');

    area.querySelectorAll('.guest-row-item,.guest-search-result').forEach(card => {
      card.addEventListener('click', () => this._openProfile(card.dataset.guestId));
    });
  }

  _renderGuestCard(g) {
    const initials   = `${g.first_name?.[0] ?? ''}${g.last_name?.[0] ?? ''}`.toUpperCase();
    const tagsBadge  = (g.tags?.length)
      ? g.tags.slice(0,2).map(t => ({vip:'👑',frecuente:'🔄',empresa:'🏢',referido:'👥',sin_cargo:'🎁'}[t] ?? '🏷️')).join(' ')
      : '';

    // ── Datos última visita ──
    const lastCI    = g.last_checkin  ? formatDate(g.last_checkin)  : null;
    const lastCO    = g.last_checkout ? formatDate(g.last_checkout) : null;
    const lastUnits = g.last_units?.length ? g.last_units : (g.last_unit ? [g.last_unit] : []);

    // Chips de depto — TODOS los de la última reserva (fix: antes solo mostraba 1 aunque hubiera 4)
    const unitChip = lastUnits.map(u =>
      `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:.62rem;
          font-weight:700;color:#fff;background:${u.color ?? 'var(--color-primary)'};margin-right:2px">${u.name}</span>`
    ).join('');

    // ── Contacto ──
    const contactLine = [
      g.phone ? '📱 ' + g.phone : null,
      g.email ? g.email         : null,
      g.dni   ? 'DNI ' + g.dni  : null,
    ].filter(Boolean).join('  ·  ');

    // ── Nota más reciente (truncada a 80 chars) ──
    const noteText = g.latest_note
      ? (g.latest_note.length > 80 ? g.latest_note.slice(0, 80) + '…' : g.latest_note)
      : null;

    // ── Tooltip: estructura nueva ──
    const fullName = `${g.first_name} ${g.last_name}`;
    const tipParts = [
      '👤 ' + fullName,
      g.dni         ? '🪪  DNI ' + g.dni      : null,
      g.phone       ? '📱  ' + g.phone         : null,
      g.email       ? '✉️   ' + g.email        : null,
      // separador antes de estadía (solo si hay datos de estadía)
      lastCI ? '' : null,
      lastCI ? '📅 Última entrada: ' + lastCI + (lastCO ? ' → ' + lastCO : '') : null,
      lastUnits.length      ? '🏠 Depto: ' + lastUnits.map(u => u.name).join(', ') : null,
      g.total_bookings > 0 ? '🔢 ' + g.total_bookings + ' estadía' + (g.total_bookings > 1 ? 's' : '') : null,
      g.total_spent  ? '💰 ' + formatARS(g.total_spent) + ' total abonado' : null,
      // separador antes de nota (solo si hay nota)
      g.latest_note || g.bad_experience || g.tags?.length ? '' : null,
      g.latest_note ? '📝 ' + g.latest_note : null,
      g.tags?.length ? '🏷️  ' + g.tags.join(', ') : null,
      g.bad_experience ? '⚠️  Mala experiencia registrada' : null,
    ].filter(v => v !== null).join('\n');

    return `
      <div class="guest-row-item" data-guest-id="${g.id}"
        title="${tipParts}"
        style="display:flex;align-items:flex-start;gap:10px;padding:9px 10px;
          border-bottom:1px solid var(--color-border);cursor:pointer;
          transition:background .12s;border-radius:6px"
        onmouseenter="this.style.background='var(--color-surface-2)'"
        onmouseleave="this.style.background=''">

        <!-- Avatar -->
        <div style="width:34px;height:34px;border-radius:50%;flex-shrink:0;margin-top:1px;
          display:flex;align-items:center;justify-content:center;
          font-size:.73rem;font-weight:700;color:#fff;
          background:${g.bad_experience ? 'linear-gradient(135deg,#EF4444,#DC2626)' : 'var(--color-primary)'}">` + initials + `</div>

        <!-- Bloque info -->
        <div style="flex:1;min-width:0;overflow:hidden">

          <!-- SECCIÓN 1: datos del huésped -->
          <div style="margin-bottom:5px">
            <!-- Nombre + badges -->
            <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">
              <span style="font-weight:600;font-size:.85rem;color:var(--color-text);
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px">
                ${g.first_name} ${g.last_name}</span>
              ${g.bad_experience ? '<span style="font-size:.6rem;color:#EF4444" title="Mala experiencia">⚠️</span>' : ''}
              ${tagsBadge ? `<span style="font-size:.68rem">${tagsBadge}</span>` : ''}
              ${g.open_credit_note ? (g.open_credit_note.stale
                  ? `<span style="font-size:.62rem;font-weight:700;padding:1px 7px;border-radius:999px;background:var(--state-red-bg);color:var(--state-red-txt)" title="Nota de crédito de ${formatARS(g.open_credit_note.amount)} sin usar hace ${g.open_credit_note.ageDays} días">⚠️ NC vieja</span>`
                  : `<span style="font-size:.62rem;font-weight:700;padding:1px 7px;border-radius:999px;background:rgba(124,58,237,.1);color:#7c3aed" title="Nota de crédito abierta de ${formatARS(g.open_credit_note.amount)}">🔄 NC ${formatARS(g.open_credit_note.amount)}</span>`
                ) : ''}
            </div>
            <!-- Contacto -->
            ${contactLine ? `<div style="font-size:.71rem;color:var(--color-text-3);
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${contactLine}</div>` : ''}
            <!-- Datos adicionales (registro): localidad, edad, auto, patente -->
            ${(g.locality || g.age || g.car_model || g.car_plate) ? `<div style="font-size:.68rem;color:var(--color-text-3);
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px">
              ${[g.locality ? '📍 ' + g.locality : null, g.age ? g.age + ' años' : null,
                 g.car_model ? '🚗 ' + g.car_model : null, g.car_plate ? g.car_plate : null]
                 .filter(Boolean).join('  ·  ')}</div>` : ''}
          </div>

          <!-- SEPARADOR + SECCIÓN 2: última visita -->
          ${lastCI ? `
          <div style="border-top:1px dashed var(--color-border);margin:5px 0 4px"></div>
          <div style="font-size:.68rem;color:var(--color-text-3);display:flex;align-items:center;gap:5px;flex-wrap:wrap">
            <span style="font-size:.6rem;font-weight:600;text-transform:uppercase;
              letter-spacing:.05em;color:var(--color-text-3);opacity:.6">Última visita</span>
            ${unitChip}
            <span>${lastCI}${lastCO ? ' → ' + lastCO : ''}</span>
            ${g.prev_units?.length ? `<span style="opacity:.5">· también: ${g.prev_units.join(', ')}</span>` : ''}
          </div>` : ''}

          <!-- SECCIÓN 3: nota más reciente -->
          ${noteText ? `
          <div style="margin-top:4px;font-size:.69rem;color:var(--color-text-2);
            font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
            padding:3px 6px;background:var(--color-surface-2);border-radius:4px;
            border-left:2px solid var(--color-primary)">
            📝 ${noteText}
          </div>` : ''}

        </div>

        <!-- Estadías + total (columna derecha) -->
        <div style="text-align:right;flex-shrink:0;min-width:50px;padding-top:1px">
          <div style="font-size:.8rem;font-weight:700;color:var(--color-text)">
            ${g.total_bookings ?? 0}
            <span style="font-weight:400;font-size:.65rem;color:var(--color-text-3)">est.</span>
          </div>
          ${g.total_spent ? `<div style="font-size:.68rem;color:var(--color-success);
            font-weight:600;white-space:nowrap">${formatARS(g.total_spent)}</div>` : ''}
        </div>

        <!-- Botón editar -->
        <button class="btn-edit-guest"
          onclick="event.stopPropagation();window._guestsCRM?._openEditModal('${g.id}')"
          style="flex-shrink:0;width:26px;height:26px;border-radius:6px;border:none;
            background:transparent;cursor:pointer;color:var(--color-text-3);font-size:.82rem;
            display:flex;align-items:center;justify-content:center;opacity:.3;transition:all .15s;
            margin-top:1px"
          onmouseenter="this.style.opacity='1';this.style.background='var(--color-primary-l)';this.style.color='var(--color-primary)'"
          onmouseleave="this.style.opacity='.3';this.style.background='transparent';this.style.color='var(--color-text-3)'"
          title="Editar datos">✏️</button>

        <!-- Botón borrar -->
        <button class="btn-delete-guest"
          onclick="event.stopPropagation();window._guestsCRM?._confirmDelete('${g.id}','${g.first_name} ${g.last_name}')"
          style="flex-shrink:0;width:26px;height:26px;border-radius:6px;border:none;
            background:transparent;cursor:pointer;color:var(--color-text-3);font-size:.82rem;
            display:flex;align-items:center;justify-content:center;opacity:.3;transition:all .15s;
            margin-top:1px"
          onmouseenter="this.style.opacity='1';this.style.background='#FEE2E2';this.style.color='#DC2626'"
          onmouseleave="this.style.opacity='.3';this.style.background='transparent';this.style.color='var(--color-text-3)'"
          title="Eliminar huésped">🗑️</button>

        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"
          style="color:var(--color-text-3);flex-shrink:0;margin-top:5px">
          <polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
  }


  async _confirmDelete(guestId, name) {
    if (!confirm(`¿Eliminar a ${name} del registro?\n\nSi tiene reservas asociadas no se podrá eliminar.`)) return;
    try {
      const { error } = await this.db.from('guests').delete().eq('id', guestId);
      if (error) {
        showToast('No se puede eliminar: ' + (error.message.includes('foreign') ? 'tiene reservas asociadas.' : error.message), 'error');
        return;
      }
      showToast(`${name} eliminado ✓`, 'success');
      const row = document.querySelector(`.guest-row-item[data-guest-id="${guestId}"]`);
      if (row) row.remove();
    } catch (err) {
      showToast('Error al eliminar: ' + err.message, 'error');
    }
  }

  // ── Editar datos del huésped (modal liviano) ──────
  async _openEditModal(guestId) {
    const { data: g, error } = await this.db.from('guests')
      .select('id, first_name, last_name, dni, phone, email, locality, age, car_model, car_plate')
      .eq('id', guestId).single();
    if (error || !g) { showToast('No se pudo cargar el huésped', 'error'); return; }

    document.getElementById('guest-edit-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'guest-edit-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
      <div class="card" style="width:100%;max-width:420px;max-height:90vh;overflow-y:auto">
        <div class="card-title" style="margin-bottom:14px">✏️ Editar datos — ${esc(g.first_name)} ${esc(g.last_name)}</div>
        <div class="form-grid-2">
          <div class="form-group"><label>Nombre</label><input type="text" id="ge-fn" value="${esc(g.first_name ?? '')}"></div>
          <div class="form-group"><label>Apellido</label><input type="text" id="ge-ln" value="${esc(g.last_name ?? '')}"></div>
        </div>
        <div class="form-grid-2">
          <div class="form-group"><label>DNI</label><input type="text" id="ge-dni" value="${esc(g.dni ?? '')}"></div>
          <div class="form-group"><label>Teléfono</label><input type="text" id="ge-phone" value="${esc(g.phone ?? '')}"></div>
        </div>
        <div class="form-group"><label>Email</label><input type="email" id="ge-email" value="${esc(g.email ?? '')}"></div>
        <div class="form-grid-2" style="margin-top:8px">
          <div class="form-group"><label>Localidad</label><input type="text" id="ge-locality" value="${esc(g.locality ?? '')}" placeholder="Ej: Rosario, Santa Fe"></div>
          <div class="form-group"><label>Edad</label><input type="number" id="ge-age" min="0" max="120" value="${g.age ?? ''}"></div>
        </div>
        <div class="form-grid-2">
          <div class="form-group"><label>Auto</label><input type="text" id="ge-car" value="${esc(g.car_model ?? '')}" placeholder="Ej: VW Gol gris"></div>
          <div class="form-group"><label>Patente</label><input type="text" id="ge-plate" value="${esc(g.car_plate ?? '')}" style="text-transform:uppercase">
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-outline" id="ge-cancel">Cancelar</button>
          <button class="btn btn-primary" id="ge-save">💾 Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#ge-cancel').addEventListener('click', close);
    overlay.querySelector('#ge-save').addEventListener('click', () => this._saveGuestEdit(guestId, close));
  }

  async _saveGuestEdit(guestId, close) {
    const val = (id) => document.getElementById(id)?.value?.trim() || null;
    const payload = {
      first_name: val('ge-fn'),
      last_name:  val('ge-ln'),
      dni:        val('ge-dni'),
      phone:      val('ge-phone'),
      email:      val('ge-email'),
      locality:   val('ge-locality'),
      age:        parseInt(document.getElementById('ge-age')?.value) || null,
      car_model:  val('ge-car'),
      car_plate:  val('ge-plate')?.toUpperCase() ?? null,
    };
    if (!payload.first_name || !payload.last_name) { showToast('Nombre y apellido son obligatorios', 'warning'); return; }
    try {
      const { error } = await this.db.from('guests').update(payload).eq('id', guestId);
      if (error) throw error;
      showToast('Datos actualizados ✓', 'success');
      close();
      await this._loadAll();
    } catch (err) {
      showToast('Error al guardar: ' + (err.message ?? err), 'error');
    }
  }

  // ── Descargar voucher PDF de una estadía específica ──
  async _downloadVoucher(bookingId) {
    const guest   = this._currentGuest;
    const booking = guest?.bookings?.find(b => b.id === bookingId);
    if (!guest || !booking) { showToast('No se encontró la reserva', 'error'); return; }
    try {
      const { exportGuestVoucher } = await import('../services/export-service.js');
      exportGuestVoucher(guest, booking);
    } catch (err) {
      console.error('[Voucher]', err);
      showToast('Error al generar el voucher', 'error');
    }
  }

  // ══════════════════════════════════════════════════
  // PERFIL COMPLETO DEL HUÉSPED
  // ══════════════════════════════════════════════════
  async _openProfile(guestId) {
    // Abrir en el overlay de detalle
    const overlay = document.getElementById('overlay-guest-profile');
    const body    = document.getElementById('guest-profile-body');
    if (!overlay || !body) return;

    body.innerHTML = `
      <div class="skeleton-box" style="height:180px;margin-bottom:20px"></div>
      <div class="skeleton-box" style="height:60px;margin-bottom:10px"></div>
      <div class="skeleton-box" style="height:60px;margin-bottom:10px"></div>
      <div class="skeleton-box" style="height:60px"></div>`;
    overlay.classList.remove('hidden');

    try {
      // booking_units y payments se piden por separado: combinar ambas
      // relaciones "uno a muchos" en el mismo select puede duplicar pagos
      // cuando una reserva tiene varias unidades (producto cruzado en PostgREST).
      const [{ data: guest, error: gErr }, { data: guestBookings }] = await Promise.all([
        this.db.from('guests').select('*').eq('id', guestId).single(),
        this.db.from('bookings')
          .select(`id, check_in, check_out, nights, status, source, adults, children,
            total_amount, total_paid, balance, notes, price_per_night,
            booking_units(units(name, sort_order, color, max_guests))`)
          .eq('guest_id', guestId)
          .eq('hotel_id', this.ctx.hotelId)
          .order('check_in', { ascending: false }),
      ]);
      if (gErr || !guest) { showToast('Huésped no encontrado', 'error'); return; }

      const bookings = guestBookings ?? [];
      const bookingIds = bookings.map(b => b.id);
      if (bookingIds.length) {
        const { data: paymentsData } = await this.db.from('payments')
          .select('booking_id, amount, method, payment_date')
          .in('booking_id', bookingIds);
        const paymentsByBooking = {};
        (paymentsData ?? []).forEach(p => {
          (paymentsByBooking[p.booking_id] ??= []).push(p);
        });
        bookings.forEach(b => { b.payments = paymentsByBooking[b.id] ?? []; });
      }

      guest.bookings = bookings;
      this._currentGuest = guest;
      body.innerHTML = this._buildProfileHTML(guest);
      await this._loadGuestNotes(guest.id, body);
      this._bindProfileActions(guest);
    } catch (err) {
      console.error('Guest profile error:', err);
      showToast('Error al cargar el perfil', 'error');
    }
  }

  _buildProfileHTML(g) {
    const bookings = (g.bookings ?? [])
      .filter(b => b.status !== 'blocked')
      .sort((a, b) => b.check_in.localeCompare(a.check_in));

    const totalSpent = bookings.reduce((s, b) => s + (b.total_paid ?? 0), 0);
    const avgNights  = bookings.length
      ? (bookings.reduce((s, b) => s + (b.nights ?? 0), 0) / bookings.length).toFixed(1)
      : 0;
    const lastVisit  = bookings[0]?.check_in ?? null;
    const initials   = `${g.first_name?.[0] ?? ''}${g.last_name?.[0] ?? ''}`.toUpperCase();

    return `
      <!-- ── HEADER OSCURO ── -->
      <div class="guest-profile-header">
        <div style="display:flex;align-items:center;gap:16px;position:relative;z-index:1">
          <div class="guest-avatar-lg" style="width:60px;height:60px;font-size:1.4rem;
            flex-shrink:0;${g.bad_experience ? 'background:linear-gradient(135deg,#EF4444,#DC2626)' : ''}">
            ${initials}
          </div>
          <div>
            <div style="font-size:1.3rem;font-weight:800;color:#F8FAFC">
              ${g.first_name} ${g.last_name}
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">
              ${g.phone       ? `<span style="font-size:.8rem;color:#94A3B8">📱 ${g.phone}</span>` : ''}
              ${g.email       ? `<span style="font-size:.8rem;color:#94A3B8">✉️ ${g.email}</span>` : ''}
              ${g.dni         ? `<span style="font-size:.8rem;color:#94A3B8">🪪 ${g.dni}</span>` : ''}
              ${g.nationality && g.nationality !== 'Argentina' ? `<span style="font-size:.8rem;color:#94A3B8">🌍 ${g.nationality}</span>` : ''}
            </div>
          </div>
          ${g.bad_experience ? `<div class="bad-exp-badge" style="margin-left:auto;font-size:.8rem;padding:4px 12px">
            ⚠️ Mala experiencia registrada
          </div>` : ''}
        </div>
        <div class="guest-profile-stats">
          ${[
            [bookings.length, 'Total estadías'],
            [formatARS(totalSpent), 'Total facturado'],
            [`${avgNights}`, 'Noches promedio'],
            [lastVisit ? formatDate(lastVisit) : '—', 'Última visita'],
          ].map(([val, lbl]) => `
            <div class="gps-item">
              <span class="gps-val">${val}</span>
              <span class="gps-lbl">${lbl}</span>
            </div>`).join('')}
        </div>
      </div>

      <!-- ── DATOS DE CONTACTO ── -->
      <div style="margin-bottom:14px;padding:14px 16px;background:var(--color-surface-2);border-radius:var(--r-xl)">
        <div style="font-size:.65rem;font-weight:700;color:var(--color-text-3);letter-spacing:.06em;margin-bottom:10px">DATOS DE CONTACTO</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><label style="font-size:.7rem;color:var(--color-text-3);display:block;margin-bottom:3px">Teléfono</label>
            <input id="gp-phone" class="form-input" style="font-size:.82rem" value="${g.phone ?? ''}" placeholder="+54..."></div>
          <div><label style="font-size:.7rem;color:var(--color-text-3);display:block;margin-bottom:3px">DNI / Pasaporte</label>
            <input id="gp-dni" class="form-input" style="font-size:.82rem" value="${g.dni ?? ''}" placeholder="12345678"></div>
          <div><label style="font-size:.7rem;color:var(--color-text-3);display:block;margin-bottom:3px">Email</label>
            <input id="gp-email" class="form-input" style="font-size:.82rem" value="${g.email ?? ''}" placeholder="email@..."></div>
          <div><label style="font-size:.7rem;color:var(--color-text-3);display:block;margin-bottom:3px">🌍 Nacionalidad</label>
            <select id="gp-nationality" class="form-input" style="font-size:.82rem">
              ${['Argentina','Uruguay','Brasil','Paraguay','Chile','Bolivia','Perú','Colombia','Venezuela','Ecuador','España','México','EE.UU.','Otro']
                .map(n => `<option value="${n}" ${(g.nationality ?? 'Argentina') === n ? 'selected' : ''}>${n}</option>`).join('')}
            </select></div>
          <div><label style="font-size:.7rem;color:var(--color-text-3);display:block;margin-bottom:3px">📍 Localidad</label>
            <input id="gp-locality" class="form-input" style="font-size:.82rem" value="${g.locality ?? ''}" placeholder="Ej: Rosario, Santa Fe"></div>
          <div><label style="font-size:.7rem;color:var(--color-text-3);display:block;margin-bottom:3px">Edad</label>
            <input id="gp-age" type="number" min="0" max="120" class="form-input" style="font-size:.82rem" value="${g.age ?? ''}"></div>
          <div><label style="font-size:.7rem;color:var(--color-text-3);display:block;margin-bottom:3px">🚗 Auto</label>
            <input id="gp-car" class="form-input" style="font-size:.82rem" value="${g.car_model ?? ''}" placeholder="Ej: VW Gol gris"></div>
          <div><label style="font-size:.7rem;color:var(--color-text-3);display:block;margin-bottom:3px">Patente</label>
            <input id="gp-plate" class="form-input" style="font-size:.82rem;text-transform:uppercase" value="${g.car_plate ?? ''}" placeholder="AB123CD"></div>
        </div>
        <button id="btn-save-contact" class="btn btn-outline btn-sm" style="margin-top:10px;font-size:.76rem">💾 Guardar datos</button>
      </div>

      <!-- ── ETIQUETAS DEL HUÉSPED ── -->
      <div class="guest-tags-editor" style="margin-bottom:16px;padding:14px 16px;background:var(--color-surface-2);border-radius:12px;border:1px solid var(--color-border)">
        <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-3);margin-bottom:10px">Etiquetas</div>
        <div class="guest-tags-row" style="margin-bottom:10px">
          ${this._buildTagBadges(g.tags ?? [])}
          ${g.bad_experience ? '<span class="gtag gtag-bad">⚠️ Mala experiencia</span>' : ''}
        </div>
        <div class="tag-checkboxes" style="display:flex;flex-wrap:wrap;gap:8px">
          ${[
            ['vip',        '👑 VIP / Preferencial'],
            ['frecuente',  '🔄 Huésped frecuente'],
            ['empresa',    '🏢 Cliente empresa'],
            ['referido',   '👥 Referido'],
            ['sin_cargo',  '🎁 Estadía sin cargo'],
          ].map(([key, label]) => `
            <label class="tag-toggle ${(g.tags??[]).includes(key) ? 'active' : ''}" data-tag="${key}">
              <input type="checkbox" style="display:none" ${(g.tags??[]).includes(key) ? 'checked' : ''}>
              ${label}
            </label>`).join('')}
        </div>
        <button class="btn btn-outline btn-sm" id="btn-save-tags" style="margin-top:12px">Guardar etiquetas</button>
      </div>

      <!-- ── ANTECEDENTE DE MALA EXPERIENCIA ── -->
      <div id="bad-exp-section" style="margin-bottom:20px">
        ${this._buildBadExpSection(g)}
      </div>

      <!-- ── HISTORIAL CRONOLÓGICO ── -->
      <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
        <h4 style="font-size:.82rem;font-weight:600;color:var(--color-text-3);
          text-transform:uppercase;letter-spacing:.06em">
          Historial de Estadías (${bookings.length})
        </h4>
        <button class="btn btn-primary btn-sm" onclick="window._guestsCRM?.openBookingForGuest('${g.id}')">
          + Nueva Reserva
        </button>
      </div>

      ${!bookings.length ? `<div class="empty-state"><span class="empty-state-icon">📅</span>
        <p>Sin estadías registradas.</p></div>` :
        bookings.map(b => this._buildStayCard(b, g.bad_experience_booking_id)).join('')
      }
    `;
  }

  _buildTagBadges(tags) {
    const MAP = {
      vip:          ['👑 VIP',            'gtag-vip'],
      frecuente:    ['🔄 Frecuente',      'gtag-frecuente'],
      empresa:      ['🏢 Empresa',        'gtag-empresa'],
      referido:     ['👥 Referido',       'gtag-referido'],
      sin_cargo:    ['🎁 Sin cargo',      'gtag-sincargo'],
      no_recomendar:['⚠️ Mala exp.',      'gtag-bad'],   // legacy
    };
    if (!tags?.length) return '<span style="font-size:.75rem;color:var(--color-text-3)">Sin etiquetas</span>';
    return tags.map(t => {
      const [label, cls] = MAP[t] ?? [t, ''];
      return `<span class="gtag ${cls}">${label}</span>`;
    }).join('');
  }

  _buildBadExpSection(g) {
    if (g.bad_experience) {
      return `
        <div class="bad-exp-warning">
          <div class="bad-exp-warning-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div style="flex:1">
            <div style="font-weight:700;color:var(--color-danger);font-size:.9rem;margin-bottom:4px">
              Antecedente de Mala Experiencia
            </div>
            <div id="bad-exp-note-display" style="font-size:.82rem;color:var(--color-text-2)">
              ${g.bad_experience_note ?? 'Sin observaciones registradas.'}
            </div>
            ${g.bad_experience_at ? `<div style="font-size:.72rem;color:var(--color-text-3);margin-top:4px">
              Registrado: ${new Date(g.bad_experience_at).toLocaleDateString('es-AR')}
            </div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
            <button class="btn btn-outline btn-xs" id="btn-edit-bad-exp">✏️ Editar</button>
            <button class="btn btn-danger btn-xs" id="btn-clear-bad-exp">✕ Quitar</button>
          </div>
        </div>

        <!-- Editor de observación (oculto por defecto) -->
        <div id="bad-exp-editor" class="hidden" style="margin-top:10px">
          <div class="bad-exp-form">
            <div class="form-group">
              <label>Observación</label>
              <textarea id="bad-exp-note-input" rows="3"
                placeholder="Describe el motivo de la mala experiencia...">${g.bad_experience_note ?? ''}</textarea>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
              <button class="btn btn-outline btn-sm" id="btn-cancel-bad-exp-edit">Cancelar</button>
              <button class="btn btn-primary btn-sm" id="btn-save-bad-exp">Guardar</button>
            </div>
          </div>
        </div>`;
    }

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:12px 16px;background:var(--color-surface-2);border-radius:var(--r-lg);
        border:1px solid var(--color-border)">
        <span style="font-size:.82rem;color:var(--color-text-3)">Sin antecedentes de mala experiencia</span>
        <button class="btn btn-outline btn-sm" id="btn-mark-bad-exp" style="color:var(--color-danger);border-color:rgba(239,68,68,.3)">
          ⚠️ Marcar mala experiencia
        </button>
      </div>

      <!-- Form para nueva mala experiencia (oculto) -->
      <div id="bad-exp-new-form" class="hidden" style="margin-top:10px">
        <div class="bad-exp-form">
          <div style="font-weight:600;color:var(--color-danger);margin-bottom:10px;font-size:.875rem">
            ⚠️ Registrar mala experiencia
          </div>
          <div class="form-group">
            <label>Observación / Motivo <span class="req">*</span></label>
            <textarea id="bad-exp-note-input" rows="3"
              placeholder="Ej: No respetó las normas de convivencia, dejó el departamento en mal estado..."></textarea>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
            <button class="btn btn-outline btn-sm" id="btn-cancel-bad-exp-new">Cancelar</button>
            <button class="btn btn-danger btn-sm" id="btn-confirm-bad-exp">Confirmar</button>
          </div>
        </div>
      </div>`;
  }

  _buildStayCard(b, badExpBookingId) {
    const unitChips  = (b.booking_units ?? []).map(bu => getUnitChipHTML(bu.units ?? {}, 'sm')).join(' ');
    const maxGuests  = (b.booking_units ?? [])[0]?.units?.max_guests ?? '?';
    const [sbg, stxt] = STATUS_COLORS[b.status] ?? ['#F1F5F9','#475569'];
    const isBadExpStay = b.id === badExpBookingId;

    return `
      <div class="stay-history-item" id="stay-${b.id}">
        <div class="stay-header">
          <div>
            <span class="stay-dates">📅 ${formatDate(b.check_in)} → ${formatDate(b.check_out)}</span>
            ${isBadExpStay ? `<span class="bad-exp-badge" style="margin-left:8px;font-size:.68rem">⚠️ Mala experiencia</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <button class="btn btn-outline btn-sm" style="font-size:.68rem;padding:3px 8px;gap:4px"
              onclick="window._guestsCRM?._downloadVoucher('${b.id}')" title="Descargar voucher PDF">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Voucher
            </button>
            <span style="padding:3px 10px;border-radius:99px;font-size:.72rem;font-weight:600;
              background:${sbg};color:${stxt}">${STATUS_LABELS[b.status] ?? b.status}</span>
          </div>
        </div>
        <!-- Identificación de departamento con chips de color -->
        <div style="margin-bottom:10px">${unitChips}</div>
        <div class="stay-details-grid">
          <div class="stay-detail"><strong>🌙 ${b.nights ?? '—'} noches</strong>Duración</div>
          <div class="stay-detail"><strong>👥 Hasta ${maxGuests} pers.</strong>Capacidad</div>
          <div class="stay-detail"><strong>${formatARS(b.price_per_night)}/noche</strong>Precio</div>
          <div class="stay-detail"><strong>${formatARS(b.total_amount)}</strong>Total</div>
          <div class="stay-detail"><strong style="color:var(--color-success)">${formatARS(b.total_paid ?? 0)}</strong>Abonado</div>
          <div class="stay-detail">
            <strong style="color:${(b.balance ?? 0) > 0 ? 'var(--color-warning)' : 'var(--color-success)'}">
              ${(b.balance ?? 0) > 0 ? formatARS(b.balance) : '✓ Saldado'}
            </strong>Saldo
          </div>
        </div>
        ${b.notes ? `
          <div style="margin-top:10px;padding:8px 12px;background:var(--color-surface-2);
            border-radius:var(--r-sm);font-size:.78rem;color:var(--color-text-2)">
            💬 ${b.notes}
          </div>` : ''}
      </div>`;
  }

  // ══════════════════════════════════════════════════
  // ACCIONES: MALA EXPERIENCIA
  // ══════════════════════════════════════════════════
  _bindProfileActions(guest) {
    document.querySelectorAll('.tag-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        // Evitar doble disparo: label click → browser clicks hidden input → bubbles back
        if (e.target.tagName === 'INPUT') return;
        e.preventDefault();
        toggle.classList.toggle('active');
        const inp = toggle.querySelector('input');
        if (inp) inp.checked = toggle.classList.contains('active');
      });
    });
    // Guardar tags
    document.getElementById('btn-save-tags')?.addEventListener('click', async () => {
      const tags   = [...document.querySelectorAll('.tag-toggle.active')].map(t => t.dataset.tag);
      const btn    = document.getElementById('btn-save-tags');
      const guestId = guest?.id;
      console.log('[Tags] Guardando tags:', tags, '→ guest.id:', guestId);
      if (!guestId) { showToast('Error: no se encontró el ID del huésped', 'error'); return; }
      if (btn) { btn.textContent = 'Guardando...'; btn.disabled = true; }
      const { data, error, count, status, statusText } = await this.db.from('guests')
        .update({ tags, updated_at: new Date().toISOString() })
        .eq('id', guestId)
        .select('id, tags');
      console.log('[Tags] Respuesta Supabase → status:', status, statusText, '| data:', data, '| error:', error);
      if (btn) { btn.textContent = 'Guardar etiquetas'; btn.disabled = false; }
      if (error) {
        console.error('[Tags] Error Supabase:', error);
        showToast('Error: ' + error.message, 'error');
        return;
      }
      if (!data?.length) {
        showToast('Sin permiso para modificar este huésped (RLS)', 'error');
        return;
      }
      const badgesEl = document.querySelector('.guest-tags-row');
      if (badgesEl) badgesEl.innerHTML = window._guestsCRM._buildTagBadges(tags);
      showToast('Etiquetas guardadas ✓', 'success');
    });
    // Mala experiencia
    document.getElementById('btn-mark-bad-exp')?.addEventListener('click', () =>
      document.getElementById('bad-exp-new-form')?.classList.remove('hidden'));
    document.getElementById('btn-cancel-bad-exp-new')?.addEventListener('click', () =>
      document.getElementById('bad-exp-new-form')?.classList.add('hidden'));
    document.getElementById('btn-confirm-bad-exp')?.addEventListener('click', async () => {
      const note = document.getElementById('bad-exp-note-input')?.value.trim();
      if (!note) { showToast('Escribí el motivo', 'warning'); return; }
      await this._markBadExperience(guest.id, note);
    });
    document.getElementById('btn-edit-bad-exp')?.addEventListener('click', () =>
      document.getElementById('bad-exp-editor')?.classList.remove('hidden'));
    document.getElementById('btn-cancel-bad-exp-edit')?.addEventListener('click', () =>
      document.getElementById('bad-exp-editor')?.classList.add('hidden'));
    document.getElementById('btn-save-bad-exp')?.addEventListener('click', async () => {
      const note = document.getElementById('bad-exp-note-input')?.value.trim();
      await this._markBadExperience(guest.id, note);
    });
    document.getElementById('btn-clear-bad-exp')?.addEventListener('click', async () => {
      if (!confirm('¿Eliminar el antecedente de mala experiencia?')) return;
      await this._clearBadExperience(guest.id);
    });
    // Guardar datos de contacto + nacionalidad
    document.getElementById('btn-save-contact')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-save-contact');
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
      const updates = {
        phone:       document.getElementById('gp-phone')?.value.trim()  || null,
        dni:         document.getElementById('gp-dni')?.value.trim()    || null,
        email:       document.getElementById('gp-email')?.value.trim()  || null,
        nationality: document.getElementById('gp-nationality')?.value   || 'Argentina',
        locality:    document.getElementById('gp-locality')?.value.trim() || null,
        age:         parseInt(document.getElementById('gp-age')?.value)   || null,
        car_model:   document.getElementById('gp-car')?.value.trim()    || null,
        car_plate:   document.getElementById('gp-plate')?.value.trim()?.toUpperCase() || null,
      };
      const { error } = await this.db.from('guests').update(updates).eq('id', guest.id);
      if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar datos'; }
      if (error) { showToast('Error: ' + error.message, 'error'); return; }
      showToast('Datos guardados ✓', 'success');
    });
    // Nueva reserva
    document.getElementById('guest-new-booking-btn')?.addEventListener('click', () =>
      this.openBookingForGuest(guest.id, guest));
    window._guestsCRM = this;
  }

  _bindProfileActions_orig(guest) {
    // Marcar nueva mala experiencia
    document.getElementById('btn-mark-bad-exp')?.addEventListener('click', () => {
      document.getElementById('bad-exp-new-form')?.classList.remove('hidden');
    });
    document.getElementById('btn-cancel-bad-exp-new')?.addEventListener('click', () => {
      document.getElementById('bad-exp-new-form')?.classList.add('hidden');
    });
    document.getElementById('btn-confirm-bad-exp')?.addEventListener('click', async () => {
      const note = document.getElementById('bad-exp-note-input')?.value.trim();
      if (!note) { showToast('Escribí el motivo de la mala experiencia', 'warning'); return; }
      await this._markBadExperience(guest.id, note);
    });

    // Editar observación existente
    document.getElementById('btn-edit-bad-exp')?.addEventListener('click', () => {
      document.getElementById('bad-exp-editor')?.classList.remove('hidden');
    });
    document.getElementById('btn-cancel-bad-exp-edit')?.addEventListener('click', () => {
      document.getElementById('bad-exp-editor')?.classList.add('hidden');
    });
    document.getElementById('btn-save-bad-exp')?.addEventListener('click', async () => {
      const note = document.getElementById('bad-exp-note-input')?.value.trim();
      await this._markBadExperience(guest.id, note);
    });

    // Quitar mala experiencia
    document.getElementById('btn-clear-bad-exp')?.addEventListener('click', async () => {
      if (!confirm('¿Eliminar el antecedente de mala experiencia de este huésped?')) return;
      await this._clearBadExperience(guest.id);
    });

    // Nueva reserva para este huésped
    window._guestsCRM = this;
  }

  async _markBadExperience(guestId, note) {
    const { error } = await this.db.from('guests').update({
      bad_experience:            true,
      bad_experience_note:       note,
      bad_experience_at:         new Date().toISOString(),
    }).eq('id', guestId);

    if (error) { showToast('Error al registrar', 'error'); return; }
    showToast('Antecedente registrado', 'warning');
    await this._openProfile(guestId);
  }

  async _clearBadExperience(guestId) {
    const { error } = await this.db.from('guests').update({
      bad_experience:            false,
      bad_experience_note:       null,
      bad_experience_at:         null,
      bad_experience_booking_id: null,
    }).eq('id', guestId);

    if (error) { showToast('Error al eliminar', 'error'); return; }
    showToast('Antecedente eliminado', 'success');
    await this._openProfile(guestId);
  }

  // ══════════════════════════════════════════════════
  // NOTAS INTERNAS DEL HUÉSPED
  // ══════════════════════════════════════════════════
  async _loadGuestNotes(guestId, body) {
    // Crear contenedor de notas si no existe
    let notesSection = body.querySelector('#guest-notes-section');
    if (!notesSection) {
      notesSection = document.createElement('div');
      notesSection.id = 'guest-notes-section';
      body.appendChild(notesSection);
    }

    notesSection.innerHTML = `<div style="margin-top:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h4 style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-3)">
          📝 Notas internas del equipo
        </h4>
        <button class="btn btn-outline btn-xs" id="btn-add-guest-note">+ Agregar nota</button>
      </div>
      <div id="guest-notes-list"><div style="font-size:.8rem;color:var(--color-text-3);padding:8px 0">Cargando...</div></div>
      <div id="guest-note-form" style="display:none;margin-top:12px">
        ${this._noteFormHTML()}
      </div>
    </div>`;

    // Cargar notas
    try {
      const { data: notes } = await this.db
        .from('guest_notes')
        .select('*')
        .eq('guest_id', guestId)
        .eq('hotel_id', this.ctx.hotelId)
        .order('created_at', { ascending: false });

      this._renderNotesList(notesSection, notes ?? [], guestId);
    } catch {
      notesSection.querySelector('#guest-notes-list').innerHTML =
        '<div style="font-size:.8rem;color:var(--color-text-3)">Tabla no creada aún — ejecutá la migración</div>';
    }

    // Bind: abrir formulario
    notesSection.querySelector('#btn-add-guest-note')?.addEventListener('click', () => {
      const form = notesSection.querySelector('#guest-note-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
      if (form.style.display === 'block') form.querySelector('textarea')?.focus();
    });

    // Bind: guardar nota
    notesSection.querySelector('#btn-save-guest-note')?.addEventListener('click', async () => {
      const body_text = notesSection.querySelector('#note-body')?.value.trim();
      const category  = notesSection.querySelector('#note-category')?.value;
      if (!body_text) { showToast('Escribí algo antes de guardar', 'warning'); return; }

      try {
        const { data: me } = await this.db.auth.getUser();
        await this.db.from('guest_notes').insert({
          hotel_id:    this.ctx.hotelId,
          guest_id:    guestId,
          author_id:   me?.user?.id ?? null,
          author_name: me?.user?.email?.split('@')[0] ?? 'Staff',
          body:        body_text,
          category,
        });
        showToast('Nota guardada ✓', 'success');
        notesSection.querySelector('#note-body').value = '';
        notesSection.querySelector('#guest-note-form').style.display = 'none';
        await this._loadGuestNotes(guestId, document.getElementById('guest-profile-body'));
      } catch (err) {
        showToast('Error al guardar nota', 'error');
      }
    });

    // Bind: cancelar
    notesSection.querySelector('#btn-cancel-guest-note')?.addEventListener('click', () => {
      notesSection.querySelector('#guest-note-form').style.display = 'none';
    });
  }

  _noteFormHTML() {
    const CATS = [
      { value: 'general',     label: '💬 General' },
      { value: 'preferencia', label: '⭐ Preferencia' },
      { value: 'pedido',      label: '📋 Pedido especial' },
      { value: 'positivo',    label: '👍 Comentario positivo' },
      { value: 'incidente',   label: '⚠️ Incidente' },
    ];
    return `
      <div style="background:var(--color-surface-2);border-radius:var(--r-lg);padding:14px;border:1px solid var(--color-border)">
        <select id="note-category" class="form-control" style="margin-bottom:10px;font-size:.8rem">
          ${CATS.map(c => `<option value="${c.value}">${c.label}</option>`).join('')}
        </select>
        <textarea id="note-body" rows="3" class="form-control"
          placeholder="Ej: Prefiere habitación alejada del ascensor. Viaja siempre con su perro pequeño..."
          style="font-size:.82rem;resize:vertical"></textarea>
        <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end">
          <button class="btn btn-outline btn-sm" id="btn-cancel-guest-note">Cancelar</button>
          <button class="btn btn-primary btn-sm" id="btn-save-guest-note">Guardar nota</button>
        </div>
      </div>`;
  }

  _renderNotesList(section, notes, guestId) {
    const ICONS = { general:'💬', preferencia:'⭐', pedido:'📋', positivo:'👍', incidente:'⚠️' };
    const list  = section.querySelector('#guest-notes-list');
    if (!list) return;

    if (!notes.length) {
      list.innerHTML = `<div style="font-size:.8rem;color:var(--color-text-3);padding:6px 0;font-style:italic">
        Sin notas todavía. Agregá preferencias, pedidos especiales o cualquier observación útil para el equipo.
      </div>`;
      return;
    }

    list.innerHTML = notes.map(n => {
      const icon = ICONS[n.category] ?? '💬';
      const date = new Date(n.created_at).toLocaleDateString('es-AR',
        { day:'2-digit', month:'short', year:'numeric' });
      return `<div class="guest-note-card" data-note-id="${n.id}">
        <div class="gnc-header">
          <span class="gnc-icon">${icon}</span>
          <span class="gnc-author">${n.author_name ?? 'Staff'}</span>
          <span class="gnc-date">${date}</span>
          <button class="gnc-delete btn btn-ghost btn-xs" data-id="${n.id}" title="Eliminar nota">🗑️</button>
        </div>
        <div class="gnc-body">${n.body}</div>
      </div>`;
    }).join('');

    // Bind delete
    list.querySelectorAll('.gnc-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('¿Eliminar esta nota?')) return;
        try {
          await this.db.from('guest_notes').delete().eq('id', btn.dataset.id);
          btn.closest('.guest-note-card').remove();
          showToast('Nota eliminada', 'success');
        } catch { showToast('Error al eliminar', 'error'); }
      });
    });
  }

  openBookingForGuest(guestId, guestData = null) {
    document.getElementById('overlay-guest-profile')?.classList.add('hidden');
    this.bookingForm.open({ prefillGuestId: guestId, prefillGuest: guestData });
  }

  // ══════════════════════════════════════════════════
  // ALERTA EN FORMULARIO DE RESERVA
  // ══════════════════════════════════════════════════
  static async checkGuestAlert(supabase, guestId) {
    const { data: guest } = await supabase
      .from('guests')
      .select('id, first_name, last_name, bad_experience, bad_experience_note')
      .eq('id', guestId)
      .single();

    return guest?.bad_experience ? guest : null;
  }

  static renderBadExpAlert(guest) {
    return `
      <div class="bad-exp-warning" id="bad-exp-booking-alert">
        <div class="bad-exp-warning-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div>
          <div style="font-weight:700;color:var(--color-danger);font-size:.875rem">
            ⚠️ ${guest.first_name} ${guest.last_name} tiene antecedentes de mala experiencia
          </div>
          ${guest.bad_experience_note ? `
            <div style="font-size:.78rem;color:var(--color-text-2);margin-top:4px">
              ${guest.bad_experience_note}
            </div>` : ''}
          <div style="font-size:.75rem;color:var(--color-text-3);margin-top:6px">
            Revisá el historial antes de confirmar esta reserva.
          </div>
        </div>
      </div>`;
  }

  // ══════════════════════════════════════════════════
  // SECCIÓN DESTACADOS
  // ══════════════════════════════════════════════════
  async _loadDestacados() {
    const area = document.getElementById('guests-destacados-area');
    if (!area) return;
    area.innerHTML = '<div style="padding:16px;text-align:center;color:var(--color-text-3)">\u23f3 Cargando destacados...</div>';

    try {
      const today = new Date().toISOString().slice(0,10);
      const thisYear = new Date().getFullYear();
      const yearStart = `${thisYear}-01-01`;

      const { data: guests } = await this.db
        .from('guests')
        .select(`id, first_name, last_name, created_at,
          bookings!bookings_guest_id_fkey(
            id, total_paid, check_in, check_out, status, nights,
            booking_units(unit_id, units(name, color, sort_order))
          )`)
        .eq('hotel_id', this.ctx.hotelId);

      if (!guests?.length) { area.innerHTML = ''; return; }

      // Enriquecer cada huesped
      const enriched = guests.map(g => {
        const bks    = (g.bookings ?? []).filter(b => b.status !== 'blocked' && b.status !== 'cancelled');
        const paid   = bks.reduce((s,b) => s + (b.total_paid ?? 0), 0);
        const nights = bks.reduce((s,b) => s + (b.nights ?? 0), 0);

        // Unidades distintas usadas por este huesped en TODAS sus reservas
        // CRITICO: deduplicar por unit_id, NO por nombre — varias unidades pueden
        // compartir el mismo nombre (ej: #4 y #5 ambas "2AMB P. Baja") y eso
        // colapsaba el conteo (mostraba 2 en vez de 4 unidades reales)
        const unitMap = new Map(); // unit_id -> {name, color}
        bks.forEach(b => {
          (b.booking_units ?? []).forEach(bu => {
            if (bu.unit_id) unitMap.set(bu.unit_id, { name: bu.units?.name ?? '—', color: bu.units?.color });
          });
        });
        const distinctUnits = [...unitMap.values()]; // array de {name,color}

        // Proxima estadia (la mas cercana en el futuro)
        const futureBks = bks.filter(b => b.check_in >= today).sort((a,b) => a.check_in.localeCompare(b.check_in));
        const nextBk    = futureBks[0] ?? null;
        // Reserva mas lejana en el futuro (para el card nuevo)
        const farthestBk = futureBks[futureBks.length - 1] ?? null;

        // Reservas/ingresos de este anio
        const thisYearBks  = bks.filter(b => (b.check_in ?? '') >= yearStart);
        const thisYearPaid = thisYearBks.reduce((s,b) => s + (b.total_paid ?? 0), 0);

        return {
          ...g, bks, paid, nights, distinctUnits, nextBk, farthestBk, thisYearPaid,
        };
      });

      const fmt      = n => '$' + Math.round(n).toLocaleString('es-AR');
      // Fechas check_in/check_out: string "YYYY-MM-DD" (sin hora) -> usar mediodia para evitar timezone shift
      const fmtDate   = iso => iso ? new Date(iso+'T12:00:00').toLocaleDateString('es-AR',{day:'numeric',month:'short'}) : '\u2014';
      // created_at: timestamp completo de Supabase -> parsear directo, SIN agregar T12:00:00
      const fmtTimestamp = iso => {
        if (!iso) return '\u2014';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '\u2014';
        return d.toLocaleDateString('es-AR', { day:'numeric', month:'short' });
      };
      const name = g => g.first_name + ' ' + g.last_name;

      // Calcular destacados
      const byPaid     = [...enriched].sort((a,b) => b.paid - a.paid);
      const byNights   = [...enriched].sort((a,b) => b.nights - a.nights);
      const byBookings = [...enriched].sort((a,b) => b.bks.length - a.bks.length);
      const byYear     = [...enriched].sort((a,b) => b.thisYearPaid - a.thisYearPaid);
      const byRecent   = [...enriched].sort((a,b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
      const withNext   = enriched.filter(g => g.nextBk).sort((a,b) => a.nextBk.check_in.localeCompare(b.nextBk.check_in));
      // Reserva mas lejana entre TODOS los huespedes: tomar el que tenga el farthestBk con check_in mas alto
      const withFarthest = enriched.filter(g => g.farthestBk).sort((a,b) => a.farthestBk.check_in.localeCompare(b.farthestBk.check_in));
      const farthestGuest = withFarthest[withFarthest.length - 1] ?? null;

      // Linea de unidades: si tiene mas de 1 unidad distinta, mostrar emojis repetidos + texto;
      // si tiene exactamente 1, mostrar como antes (casita + nombre)
      const unitsLine = g => {
        if (!g || !g.distinctUnits?.length) return '';
        const n = g.distinctUnits.length;
        if (n === 1) {
          return '<div style="font-size:.63rem;color:var(--color-text-3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">\ud83c\udfe0 ' + g.distinctUnits[0].name + '</div>';
        }
        const houses = '\ud83c\udfe0'.repeat(Math.min(n, 6));
        return '<div style="font-size:.63rem;color:var(--color-text-3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
          houses + ' ' + n + ' unidades reservadas</div>';
      };

      const card = (emoji, title, g, stat, sub) => {
        if (!g) return '';
        return '<div style="padding:10px 12px;border-radius:var(--r-lg);border:1px solid var(--color-border);' +
          'background:var(--color-surface);display:flex;flex-direction:column;gap:3px;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">' +
            '<span style="font-size:1rem">' + emoji + '</span>' +
            '<span style="font-size:.6rem;text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-3);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + title + '</span>' +
          '</div>' +
          '<div style="font-size:.78rem;font-weight:700;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + name(g) + '</div>' +
          '<div style="font-size:.78rem;font-weight:800;color:var(--color-primary);margin-top:2px">' + stat + '</div>' +
          '<div style="font-size:.65rem;color:var(--color-text-3)">' + sub + '</div>' +
          unitsLine(g) +
        '</div>';
      };

      const avg = g => (g && g.bks && g.bks.length) ? fmt(g.paid / g.bks.length) : '\u2014';

      area.innerHTML =
        '<div style="margin-top:28px">' +
          '<h3 style="font-size:.92rem;font-weight:700;color:var(--color-text);margin-bottom:14px;display:flex;align-items:center;gap:6px">' +
            '\ud83c\udfc6 Destacados' +
            '<span style="font-size:.72rem;font-weight:400;color:var(--color-text-3);margin-left:4px">\u00b7 basado en historial total</span>' +
          '</h3>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">' +
            card('\ud83d\udcb0', 'Mayor ingreso historico',  byPaid[0],     fmt(byPaid[0]?.paid ?? 0),    'Ticket prom: ' + avg(byPaid[0])) +
            card('\ud83d\udcc5', 'Mas estadias acumuladas', byNights[0],   (byNights[0]?.nights ?? 0) + ' noches', byNights[0]?.bks.length + ' reservas') +
            card('\ud83d\udd04', 'Mas reservas',            byBookings[0], byBookings[0]?.bks.length + ' reservas', fmt(byBookings[0]?.paid ?? 0) + ' total') +
            card('\u2b50', 'Mejor cliente del anio',   byYear[0],     fmt(byYear[0]?.thisYearPaid ?? 0), 'Solo en ' + thisYear) +
            card('\ud83c\udd95', 'Ultimo registrado',        byRecent[0],  fmtTimestamp(byRecent[0]?.created_at), byRecent[0]?.bks.length + ' reservas') +
            (withNext[0] ? card('\u2708\ufe0f', 'Proximo en ingresar', withNext[0], fmtDate(withNext[0]?.nextBk?.check_in), (withNext[0]?.nextBk?.booking_units?.[0]?.units?.name ?? '\u2014')) : '') +
            (farthestGuest ? card('\ud83d\udcc6', 'Reserva mas lejana', farthestGuest, fmtDate(farthestGuest?.farthestBk?.check_in), (farthestGuest?.farthestBk?.booking_units?.[0]?.units?.name ?? '\u2014')) : '') +
          '</div>' +
        '</div>';

    } catch (err) {
      console.warn('[GuestsCRM] Destacados error:', err);
      area.innerHTML = '';
    }
  }
}
