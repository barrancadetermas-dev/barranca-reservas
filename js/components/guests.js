// ═══════════════════════════════════════════════════
// guests.js — CRM de Huéspedes
// Ficha única, historial cronológico, antecedentes,
// buscador inteligente (nombre / teléfono / email)
// ═══════════════════════════════════════════════════

import { formatARS, formatDate, showToast, getUnitChipHTML, getUnitLabel } from '../supabase-config.js';

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
        <div class="search-bar" style="margin-bottom:0" id="guests-search-bar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            width="17" height="17" class="search-icon">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" id="guests-search-input" class="search-input"
            placeholder="Nombre, teléfono, email...">
          <kbd style="padding:2px 8px;background:var(--color-surface-2);border-radius:4px;
            font-size:.7rem;color:var(--color-text-3);border:1px solid var(--color-border)">⌘K</kbd>
        </div>
      </div>

      <div style="display:flex;gap:5px;margin:6px 0 4px;align-items:center">
        <span style="font-size:.7rem;color:var(--color-text-3)">Mostrar:</span>
        ${[25,50,100].map(n => `<button onclick="window._guestsCRM?._setLimit(${n})"
          id="bl-limit-${n}" style="font-size:.68rem;padding:2px 9px;border-radius:999px;cursor:pointer;
          border:1px solid var(--color-border);background:var(--color-surface-2);color:var(--color-text-2)">${n}</button>`).join('')}
      </div>
      <div id="guests-results-area">
        <div style="padding:16px;text-align:center;color:var(--color-text-3)">⟳ Cargando...</div>
      </div>
    `;

    const input = document.getElementById('guests-search-input');
    input?.addEventListener('input', (e) => {
      clearTimeout(this._searchTimer);
      const q = e.target.value.trim();
      if (q.length === 0) { this._loadAll(); return; }
      if (q.length < 2) return;
      this._searchTimer = setTimeout(() => this._search(q), 280);
    });

    this._guestLimit = parseInt(localStorage.getItem('mila_guest_limit') ?? '25');
    this._loadAll();
  }

  _updateLimitButtons(n) {
    [25,50,100].forEach(x => {
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

  async _loadAll() {
    const area = document.getElementById('guests-results-area');
    if (!area) return;
    const limit = this._guestLimit ?? 25;
    area.innerHTML = `<div style="padding:16px;text-align:center;color:var(--color-text-3)">⟳ Cargando...</div>`;
    const { data: guests } = await this.db
      .from('guests')
      .select(`id, first_name, last_name, phone, email, dni, nationality, tags, bad_experience, created_at,
        bookings!bookings_guest_id_fkey(id, total_paid, check_in, status)`)
      .eq('hotel_id', this.ctx.hotelId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!guests?.length) {
      area.innerHTML = '<div class="empty-state"><span class="empty-state-icon">👤</span><p>Sin huéspedes aún.</p></div>';
      return;
    }
    guests.forEach(g => {
      const bks = (g.bookings ?? []).filter(b => b.status !== 'blocked' && b.status !== 'cancelled');
      g.total_bookings = bks.length;
      g.total_spent    = bks.reduce((s, b) => s + (b.total_paid ?? 0), 0);
      g.last_checkin   = bks.sort((a,b) => b.check_in.localeCompare(a.check_in))[0]?.check_in ?? null;
    });
    area.innerHTML = guests.map(g => this._renderGuestCard(g)).join('');
    area.querySelectorAll('.guest-card').forEach(card =>
      card.addEventListener('click', () => this._openProfile(card.dataset.guestId)));
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
      .select(`id, first_name, last_name, phone, email, dni, nationality, tags, bad_experience, created_at,
        bookings!bookings_guest_id_fkey(id, total_paid, check_in, status)`)
      .eq('hotel_id', this.ctx.hotelId)
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%,dni.ilike.%${query}%`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (guests) guests.forEach(g => {
      const bks = (g.bookings ?? []).filter(b => b.status !== 'blocked' && b.status !== 'cancelled');
      g.total_bookings = bks.length;
      g.total_spent    = bks.reduce((s, b) => s + (b.total_paid ?? 0), 0);
      g.last_checkin   = bks.sort((a,b) => b.check_in.localeCompare(a.check_in))[0]?.check_in ?? null;
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

    area.innerHTML = guests.map(g => this._renderGuestCard(g)).join('');

    area.querySelectorAll('.guest-search-result').forEach(card => {
      card.addEventListener('click', () => this._openProfile(card.dataset.guestId));
    });
  }

  _renderGuestCard(g) {
    const initials = `${g.first_name?.[0] ?? ''}${g.last_name?.[0] ?? ''}`.toUpperCase();
    const lastVisit = g.last_checkin
      ? `Última visita: ${formatDate(g.last_checkin)}`
      : 'Sin reservas registradas';
    const badExpHtml = g.bad_experience
      ? `<span class="bad-exp-badge">⚠️ Antecedente de mala experiencia</span>`
      : '';

    return `
      <div class="guest-search-result" data-guest-id="${g.id}">
        <div class="guest-avatar-lg" style="${g.bad_experience ? 'background:linear-gradient(135deg,#EF4444,#DC2626)' : ''}">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-weight:700;font-size:.92rem;color:var(--color-text)">${g.first_name} ${g.last_name}</span>
            ${badExpHtml}
          </div>
          <div class="guest-meta-row" style="margin-top:4px">
            ${g.phone ? `<span class="guest-meta-item">📱 ${g.phone}</span>` : ''}
            ${g.email ? `<span class="guest-meta-item">✉️ ${g.email}</span>` : ''}
            ${g.dni   ? `<span class="guest-meta-item">🪪 ${g.dni}</span>` : ''}
            ${g.nationality && g.nationality !== 'Argentina' ? `<span class="guest-meta-item">🌍 ${g.nationality}</span>` : ''}
          </div>
          <div style="font-size:.75rem;color:var(--color-text-3);margin-top:4px">${lastVisit}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:1.1rem;font-weight:800;color:var(--color-text)">${g.total_bookings ?? 0}</div>
          <div style="font-size:.7rem;color:var(--color-text-3)">estadías</div>
          <div style="font-size:.82rem;font-weight:700;color:var(--color-success);margin-top:4px">
            ${formatARS(g.total_spent ?? 0)}
          </div>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"
          style="color:var(--color-text-3);flex-shrink:0">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>`;
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
      const [{ data: guest, error: gErr }, { data: guestBookings }] = await Promise.all([
        this.db.from('guests').select('*').eq('id', guestId).single(),
        this.db.from('bookings')
          .select(`id, check_in, check_out, nights, status,
            total_amount, total_paid, balance, notes, price_per_night,
            booking_units(units(name, sort_order, color, max_guests)),
            payments(amount, method, payment_date)`)
          .eq('guest_id', guestId)
          .eq('hotel_id', this.ctx.hotelId)
          .order('check_in', { ascending: false }),
      ]);
      if (gErr || !guest) { showToast('Huésped no encontrado', 'error'); return; }
      guest.bookings = guestBookings ?? [];
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
          <span style="padding:3px 10px;border-radius:99px;font-size:.72rem;font-weight:600;
            background:${sbg};color:${stxt}">${STATUS_LABELS[b.status] ?? b.status}</span>
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
      toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        const inp = toggle.querySelector('input');
        if (inp) inp.checked = toggle.classList.contains('active');
      });
    });
    // Guardar tags — Supabase devuelve {error}, no tira excepción
    document.getElementById('btn-save-tags')?.addEventListener('click', async () => {
      const tags = [...document.querySelectorAll('.tag-toggle.active')].map(t => t.dataset.tag);
      const btn  = document.getElementById('btn-save-tags');
      if (btn) btn.textContent = 'Guardando...';
      const { error } = await this.db.from('guests').update({ tags }).eq('id', guest.id);
      if (btn) btn.textContent = 'Guardar etiquetas';
      if (error) { showToast('Error al guardar: ' + error.message, 'error'); return; }
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
}
