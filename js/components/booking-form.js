// ══════════════════════════════════════════════════
// booking-form.js v5.0 — MILA Sistema Inteligente
// • Navegación libre entre pestañas (sin validación forzada)
// • Canal de origen rediseñado (compacto, sin emojis)
// • Nota de Crédito / Voucher como método de pago
// • Validación solo al guardar
// ══════════════════════════════════════════════════

import { can, isDemo } from '../auth/permissions.js';
import { formatARS, toISODate, showToast, getUnitLabel, getUnitColor, getUnitChipHTML, SOURCE_CONFIG } from '../supabase-config.js';
import { logAction } from '../services/audit-service.js';
import { DateRangePicker } from './date-range-picker.js';
import { getChannelCommission } from '../services/config-service.js';
// PriceSuggester se carga lazy en _runPriceSuggestion()

const PAYMENT_METHODS = [
  { value: 'cash',        label: 'Efectivo' },
  { value: 'transfer',    label: 'Transferencia' },
  { value: 'mercadopago', label: 'MercadoPago' },
  { value: 'naranjax',    label: 'Naranja X' },
  { value: 'uala',        label: 'Ualá' },
  { value: 'credit_card', label: 'Tarjeta de Crédito (+10%)' },
  { value: 'debit_card',  label: 'Tarjeta de Débito' },
  { value: 'credit_note', label: 'Nota de Crédito / Voucher' },
];

// Canales de origen disponibles (en orden visual)
const SOURCE_OPTIONS = [
  { value: 'direct',   label: 'Directo',    color: '#64748B' },
  { value: 'walkin',   label: 'Espontáneo', color: '#0891B2' },
  { value: 'booking',  label: 'Booking',    color: '#1D4ED8' },
  { value: 'airbnb',   label: 'Airbnb',     color: '#EA580C' },
  { value: 'family',   label: 'Familia',    color: '#7C3AED' },
  { value: 'company',  label: 'Empresa',    color: '#0F766E' },
  { value: 'referral', label: 'Referido',   color: '#B45309' },
  { value: 'despegar', label: 'Despegar',   color: '#059669' },
  { value: 'expedia',  label: 'Expedia',    color: '#DC2626' },
];

export class BookingForm {
  constructor(supabase, ctx) {
    this.db  = supabase;
    this.ctx = ctx;
    this._currentStep = 1;
    this._totalSteps  = 4;
    this._editingId   = null;
    this._selectedGuestId = null;
    this._selectedUnitIds = new Set();
    this._datePicker   = null;
    this._payRowCount  = 0;
    this._priceSuggester = null; // lazy init
    this._suggestTimer   = null;
    this._cachedTotal = 0;
    this._currentDetailBookingId = null;

    this._bindEvents();
  }

  // ── Bind eventos globales del formulario ──────────
  _bindEvents() {
    document.getElementById('booking-modal-close')?.addEventListener('click', () => this.close());
    document.getElementById('btn-booking-cancel')?.addEventListener('click',  () => this.close());
    document.getElementById('btn-step-next')?.addEventListener('click', () => this._nextStep());
    document.getElementById('btn-step-back')?.addEventListener('click', () => this._prevStep());
    document.getElementById('btn-add-payment-row')?.addEventListener('click', () => this._addPaymentRow());

    // Precio/descuento → recalcular breakdown
    ['f-price','f-discount','f-surcharge','f-free-nights'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => this._updateBreakdown());
    });

    // Notas counter
    document.getElementById('f-notes')?.addEventListener('input', e => {
      document.getElementById('notes-count').textContent = e.target.value.length;
    });

    // Búsqueda de huéspedes
    let guestSearchTimer;
    document.getElementById('guest-search')?.addEventListener('input', e => {
      clearTimeout(guestSearchTimer);
      guestSearchTimer = setTimeout(() => this._searchGuests(e.target.value.trim()), 300);
    });

    // ── Contadores de personas ───────────────────────
    this._bindPaxCounters();

    // Navegación libre: clic en step indicator
    document.querySelectorAll('.step-item').forEach((el, i) => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => this._goToStep(i + 1));
    });

    // Inicializar selector de canal de origen (compacto)
    this._renderSourceSelector();
  }

  // ── Renderizar selector de canal (compacto, sin emojis) ──
  // ── Contadores de adultos / menores ──────────────
  _bindPaxCounters() {
    const updateTotal = () => {
      const adults   = parseInt(document.getElementById('f-adults')?.value  ?? '1') || 1;
      const children = parseInt(document.getElementById('f-children')?.value ?? '0') || 0;
      const total    = adults + children;
      const hiddenEl = document.getElementById('f-pax');
      const totalNum = document.getElementById('pax-total-num');
      const totalLbl = document.getElementById('pax-total-label');
      if (hiddenEl)  hiddenEl.value      = total;
      if (totalNum)  totalNum.textContent = total;
      const lbl = document.getElementById('pax-total-display');
      if (lbl) {
        const span = lbl.querySelector('.pax-total-label');
        if (span) span.textContent = total === 1 ? 'persona en total' : 'personas en total';
      }
    };

    const makeCounter = (minusId, plusId, inputId, min = 0, max = 20) => {
      const minus = document.getElementById(minusId);
      const plus  = document.getElementById(plusId);
      const input = document.getElementById(inputId);
      if (!minus || !plus || !input) return;
      minus.addEventListener('click', (e) => {
        e.preventDefault();
        const v = parseInt(input.value) || 0;
        if (v > min) { input.value = v - 1; updateTotal(); }
      });
      plus.addEventListener('click', (e) => {
        e.preventDefault();
        const v = parseInt(input.value) || 0;
        if (v < max) { input.value = v + 1; updateTotal(); }
      });
    };

    makeCounter('adults-minus',   'adults-plus',   'f-adults',   1, 20);
    makeCounter('children-minus', 'children-plus', 'f-children', 0, 20);
    updateTotal();
  }

  _renderSourceSelector(value = 'direct') {
    const container = document.getElementById('f-source-selector');
    if (!container) return;

    // Si ya tiene src-chips del HTML estático, solo re-bind los eventos
    const existing = container.querySelectorAll('.src-chip');
    if (existing.length === 0) {
      // Renderizar desde JS
      container.innerHTML = SOURCE_OPTIONS.map(s => `
        <label class="src-chip" data-source="${s.value}" style="--src-color:${s.color}">
          <input type="radio" name="booking-source" value="${s.value}"
                 ${s.value === value ? 'checked' : ''} style="display:none">
          <span class="src-dot" style="background:${s.color}"></span>
          <span class="src-label">${s.label}</span>
        </label>`).join('');
    }

    // Bind eventos en todos los chips (HTML estático o generados)
    const allChips = container.querySelectorAll('.src-chip[data-source]');
    allChips.forEach(chip => {
      // Limpiar eventos anteriores clonando el nodo
      const fresh = chip.cloneNode(true);
      chip.replaceWith(fresh);
    });

    container.querySelectorAll('.src-chip[data-source]').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        container.querySelectorAll('.src-chip').forEach(c => {
          c.classList.remove('selected');
          const inp = c.querySelector('input');
          if (inp) inp.checked = false;
        });
        chip.classList.add('selected');
        const inp = chip.querySelector('input');
        if (inp) inp.checked = true;
      });
    });

    // Set default selection
    const defaultChip = container.querySelector(`.src-chip[data-source="${value}"]`);
    if (defaultChip) {
      defaultChip.classList.add('selected');
      const inp = defaultChip.querySelector('input');
      if (inp) inp.checked = true;
    }
  }

  // ── Abrir para nueva reserva ──────────────────────
  open(prefill = {}) {
    this._editingId = null;
    this._reset();
    document.getElementById('booking-modal-title').textContent = 'Nueva Reserva';
    document.getElementById('btn-step-next').textContent = 'Continuar →';

    if (prefill.unitId) {
      this._selectedUnitIds.add(prefill.unitId);
      this._renderUnitSelector();
    }
    if (prefill.checkIn || prefill.checkOut) {
      this._datePicker?.setValue(prefill.checkIn ?? null, prefill.checkOut ?? null);
      if (prefill.checkIn)  document.getElementById('f-checkin').value  = prefill.checkIn;
      if (prefill.checkOut) document.getElementById('f-checkout').value = prefill.checkOut;
      this._updateBreakdown();
    }

    document.getElementById('overlay-booking').classList.remove('hidden');
  }

  // ── Abrir para editar reserva existente ───────────
  async openEdit(bookingId) {
    document.getElementById('booking-modal-title').textContent = 'Editar Reserva';
    this._reset();
    this._editingId = bookingId;

    try {
      const { data: b } = await this.db
        .from('bookings')
        .select('*, guests(*), booking_units(unit_id), payments(*)')
        .eq('id', bookingId).single();

      if (!b) { showToast('No se encontró la reserva', 'error'); return; }

      // Rellenar huésped
      const g = b.guests ?? {};
      this._selectedGuestId = g.id ?? null;
      ['firstname','lastname','dni','phone','email'].forEach(f => {
        const el = document.getElementById(`f-${f}`);
        if (el) el.value = g[f === 'firstname' ? 'first_name' : f === 'lastname' ? 'last_name' : f] ?? '';
      });

      // Canal de origen
      const sourceContainer = document.getElementById('f-source-selector');
      if (sourceContainer) {
        sourceContainer.querySelectorAll('.src-chip').forEach(c => c.classList.remove('selected'));
        const chip = sourceContainer.querySelector(`.src-chip[data-source="${b.source ?? 'direct'}"]`);
        if (chip) { chip.classList.add('selected'); chip.querySelector('input').checked = true; }
      }

      // Unidades
      this._selectedUnitIds = new Set((b.booking_units ?? []).map(bu => bu.unit_id));
      this._renderUnitSelector();

      // Fechas
      if (this._datePicker && b.check_in && b.check_out) {
        this._datePicker.setValue(b.check_in, b.check_out);
      }
      if (b.check_in)  document.getElementById('f-checkin').value  = b.check_in;
      if (b.check_out) document.getElementById('f-checkout').value = b.check_out;

      // Pre-fill pax
      const adultsEd   = document.getElementById('f-adults');
      const childrenEd = document.getElementById('f-children');
      if (adultsEd)   adultsEd.value   = b.adults   ?? b.pax ?? '1';
      if (childrenEd) childrenEd.value = b.children ?? '0';
      // Trigger total update
      const paxEvt = document.getElementById('f-adults');
      if (paxEvt) paxEvt.dispatchEvent(new Event('input'));
      this._bindPaxCounters();

      const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
      setVal('f-price',       b.price_per_night ?? '');
      setVal('f-discount',    b.discount_pct    ?? 0);
      setVal('f-surcharge',   b.surcharge_amount ?? 0);
      setVal('f-free-nights', b.free_nights     ?? 0);
      setVal('f-deposit',     b.deposit_amount  ?? 0);
      setVal('f-notes',       b.notes           ?? '');
      document.getElementById('notes-count').textContent = (b.notes ?? '').length;

      this._updateBreakdown();
      this._updateBlockedDates();

      // Pagos existentes
      (b.payments ?? []).forEach(p => this._addPaymentRow(p));
      this._updatePaymentSummary();

      document.getElementById('btn-step-next').textContent = 'Guardar cambios';
      document.getElementById('overlay-booking').classList.remove('hidden');
    } catch (err) {
      console.error('[BookingForm] openEdit error:', err);
      showToast('Error al cargar reserva', 'error');
    }
  }

  // ── openDetail ────────────────────────────────────
  openDetail(booking) {
    this._currentDetailBookingId = booking.id;
    const overlay = document.getElementById('overlay-detail');
    const body    = document.getElementById('detail-body');
    if (!overlay || !body) return;

    const guest    = booking.guests
      ? `${booking.guests.first_name ?? ''} ${booking.guests.last_name ?? ''}`.trim()
      : 'Sin nombre';
    const unitNames = (booking.booking_units ?? [])
      .map(bu => bu.units?.name ?? '').filter(Boolean).join(', ');
    const srcCfg   = SOURCE_CONFIG?.[booking.source] ?? { label: booking.source ?? 'Directo', dot: '#64748b' };
    const badgeColor = srcCfg.dot ?? srcCfg.color ?? '#64748b';

    const statusLabels = { pending:'Sin seña', partial:'Con seña', paid:'Pagado',
                           cancelled:'Cancelada', blocked:'Bloqueada' };

    body.innerHTML = `
      <div class="detail-header-row">
        <div>
          <div class="detail-guest-name">${guest}</div>
          <div class="detail-meta">
            <span class="chip" style="background:${badgeColor}20;color:${badgeColor}">■ ${srcCfg.label}</span>
            <span class="detail-unit">${unitNames}</span>
          </div>
        </div>
        <div class="detail-status">
          <span class="status-badge status-${booking.status}">${statusLabels[booking.status] ?? booking.status}</span>
        </div>
      </div>
      <div class="detail-dates">
        <div><span class="detail-label">Check-in</span><strong>${booking.check_in}</strong></div>
        <div class="detail-nights">${booking.nights ?? '—'} noches</div>
        <div><span class="detail-label">Check-out</span><strong>${booking.check_out}</strong></div>
      </div>
      ${(booking.pax || booking.adults) ? `
      <div class="detail-pax">
        <span class="detail-label">Personas</span>
        <div class="detail-pax-badges">
          ${booking.adults ? `<span class="pax-badge">🧑 ${booking.adults} adulto${booking.adults !== 1 ? 's' : ''}</span>` : ''}
          ${booking.children ? `<span class="pax-badge">🧒 ${booking.children} menor${booking.children !== 1 ? 'es' : ''}</span>` : ''}
          <span class="pax-badge pax-total">👥 ${booking.pax ?? ((booking.adults??0)+(booking.children??0))} en total</span>
        </div>
      </div>` : ''}
      <div class="detail-financials">
        <div><span class="detail-label">Total</span><strong>${formatARS(booking.total_amount)}</strong></div>
        <div><span class="detail-label">Abonado</span><strong class="text-success">${formatARS(booking.total_paid ?? 0)}</strong></div>
        <div><span class="detail-label">Saldo</span><strong class="${(booking.balance ?? 0) > 0 ? 'text-warning' : 'text-success'}">${formatARS(booking.balance ?? 0)}</strong></div>
      </div>
      ${booking.notes ? `<div class="detail-notes"><span class="detail-label">Notas</span><p>${booking.notes}</p></div>` : ''}
    `;

    // Pagos en el detalle
    if (booking.payments?.length) {
      const payHtml = booking.payments.map(p => {
        const pm = PAYMENT_METHODS.find(m => m.value === p.method)?.label ?? p.method;
        return `<div class="pay-row-detail"><span>${pm}</span><span>${p.payment_date ?? ''}</span><span class="text-success">${formatARS(p.amount)}</span></div>`;
      }).join('');
      body.innerHTML += `<div class="detail-payments"><div class="detail-label" style="margin-bottom:6px">Pagos</div>${payHtml}</div>`;
    }

    // ── Timeline de cambios (audit_log) ──────────────
    this._loadBookingTimeline(booking.id, body);

    overlay.classList.remove('hidden');

    // ── Bindear botones del footer del detalle ─────────
    // Cerrar
    document.getElementById('detail-close')?.addEventListener('click', () => {
      overlay.classList.add('hidden');
    });
    // Editar
    document.getElementById('detail-edit')?.addEventListener('click', () => {
      overlay.classList.add('hidden');
      this.openEdit(booking.id);
    });
    // WhatsApp voucher (al huésped)
    document.getElementById('detail-whatsapp')?.addEventListener('click', () => {
      import('../services/whatsapp-service.js').then(mod => {
        mod.openWhatsAppVoucher(booking, this.ctx);
      });
    });
    // Mensaje para la encargada
    document.getElementById('detail-manager-msg')?.addEventListener('click', () => {
      import('../services/whatsapp-service.js').then(mod => {
        mod.openManagerTemplate(booking, this.ctx);
      });
    });
    // Copiar link de reserva al portapapeles
    document.getElementById('detail-copy-link')?.addEventListener('click', () => {
      const url = `${window.location.origin}${window.location.pathname}?booking=${booking.id}`;
      navigator.clipboard?.writeText(url).then(() => showToast('Link copiado ✓', 'success'));
    });
    // Clic fuera del modal → cerrar
    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.add('hidden'); };
  }

  async _loadBookingTimeline(bookingId, body) {
    try {
      const { data: logs } = await this.db
        .from('audit_log')
        .select('action, description, user_email, created_at, meta')
        .eq('hotel_id', this.ctx.hotelId)
        .eq('entity_type', 'booking')
        .eq('entity_id',   bookingId)
        .order('created_at', { ascending: true })
        .limit(20);

      if (!logs?.length) return;

      const COLORS = {
        booking_created: '#22c55e',
        booking_updated: '#3b82f6',
        payment_added:   '#22c55e',
        payment_deleted: '#ef4444',
        checkout:        '#8b5cf6',
        checkin:         '#0ea5e9',
        booking_cancelled: '#ef4444',
      };

      const LABELS = {
        booking_created:   'Reserva creada',
        booking_updated:   'Reserva editada',
        payment_added:     'Pago registrado',
        payment_deleted:   'Pago eliminado',
        checkout:          'Check-out',
        checkin:           'Check-in',
        booking_cancelled: 'Cancelada',
      };

      const timelineHTML = `
        <div class="detail-timeline" style="margin-top:16px">
          <div class="detail-label" style="margin-bottom:8px">Historial de cambios</div>
          <div class="tl-list">
            ${logs.map(log => {
              const color = COLORS[log.action] ?? '#64748b';
              const label = LABELS[log.action] ?? log.action;
              const dt    = log.created_at
                ? new Date(log.created_at).toLocaleString('es-AR', {
                    day:'2-digit',month:'2-digit',year:'2-digit',
                    hour:'2-digit',minute:'2-digit'
                  })
                : '—';
              const user = log.user_email?.split('@')[0] ?? 'Sistema';
              return `
                <div class="tl-row">
                  <div class="tl-dot-wrap">
                    <div class="tl-dot" style="background:${color}"></div>
                  </div>
                  <div class="tl-content">
                    <div class="tl-action">${label}</div>
                    <div class="tl-meta">${user} · ${dt}</div>
                    ${log.description ? `<div class="tl-desc">${log.description}</div>` : ''}
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>`;

      body?.insertAdjacentHTML('beforeend', timelineHTML);
    } catch { /* audit_log opcional */ }
  }

  close() {
    document.getElementById('overlay-booking').classList.add('hidden');
    this._reset();
  }

  // ── Reset completo del form ───────────────────────
  _reset() {
    this._currentStep     = 1;
    this._editingId       = null;
    this._selectedGuestId = null;
    this._selectedUnitIds = new Set();
    this._payRowCount     = 0;
    this._cachedTotal     = 0;

    // Reset pax counters
    const adultsEl   = document.getElementById('f-adults');
    const childrenEl = document.getElementById('f-children');
    const paxEl      = document.getElementById('f-pax');
    const paxNum     = document.getElementById('pax-total-num');
    const paxLabel   = document.getElementById('pax-total-display');
    if (adultsEl)   adultsEl.value   = '1';
    if (childrenEl) childrenEl.value = '0';
    if (paxEl)      paxEl.value      = '1';
    if (paxNum)     paxNum.textContent = '1';
    if (paxLabel) {
      const s = paxLabel.querySelector('.pax-total-label');
      if (s) s.textContent = 'persona en total';
    }

    ['f-firstname','f-lastname','f-dni','f-phone','f-email','f-notes',
     'f-price','f-discount','f-surcharge','f-free-nights','f-deposit',
     'f-checkin','f-checkout'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = ['f-discount','f-surcharge','f-free-nights','f-deposit'].includes(id) ? '0' : '';
    });

    document.getElementById('notes-count').textContent  = '0';
    document.getElementById('guest-search').value       = '';
    document.getElementById('guest-results')?.classList.add('hidden');
    const badAlert = document.getElementById('bad-exp-booking-alert-container');
    if (badAlert) badAlert.innerHTML = '';
    document.getElementById('payments-container').innerHTML = '';

    // Source → direct
    this._renderSourceSelector();

    // Date picker
    const dpContainer = document.getElementById('f-date-picker');
    if (dpContainer) {
      this._datePicker = new DateRangePicker(dpContainer, {
        onChange: (start, end) => {
          document.getElementById('f-checkin').value  = start ?? '';
          document.getElementById('f-checkout').value = end   ?? '';
          this._updateBreakdown();
          this._updateBlockedDates();
          this._triggerPriceSuggestion();
        }
      });
    }

    this._renderUnitSelector();
    this._updateBreakdown();
    this._goToStep(1);
  }

  // ── Renderizar selector de unidades ──────────────
  _renderUnitSelector() {
    const container = document.getElementById('units-selector');
    if (!container) return;
    if (!this.ctx.units?.length) {
      container.innerHTML = '<p style="font-size:.8rem;color:var(--color-text-3);padding:8px">Sin unidades configuradas.</p>';
      return;
    }
    container.innerHTML = this.ctx.units.map(u => {
      const selected = this._selectedUnitIds.has(u.id);
      const color    = u.color ?? '#6366f1';
      return `
        <label class="unit-option ${selected ? 'selected' : ''}"
               data-unit-id="${u.id}" style="cursor:pointer">
          <span style="width:12px;height:12px;border-radius:50%;
            background:${color};flex-shrink:0;display:inline-block"></span>
          <span class="unit-option-name">${u.name}</span>
          ${u.max_guests ? `<span class="unit-option-detail">hasta ${u.max_guests} huéspedes</span>` : ''}
          <input type="checkbox" ${selected ? 'checked' : ''} style="accent-color:${color};margin-left:auto">
        </label>`;
    }).join('');

    container.querySelectorAll('.unit-option[data-unit-id]').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        const uid = chip.dataset.unitId;
        const cb  = chip.querySelector('input[type="checkbox"]');
        if (this._selectedUnitIds.has(uid)) {
          this._selectedUnitIds.delete(uid);
          chip.classList.remove('selected');
          if (cb) cb.checked = false;
        } else {
          this._selectedUnitIds.add(uid);
          chip.classList.add('selected');
          if (cb) cb.checked = true;
        }
        this._updateBlockedDates();
        this._updateBreakdown();
        this._triggerPriceSuggestion();
        // Pre-cargar precio con ADR del mes actual si el campo está vacío
        if (!document.getElementById('f-price')?.value) {
          this._prefillPrice([...this._selectedUnitIds]);
        }
      });
    });
  }

  // ── Sugeridor de precio dinámico ─────────────────
  async _prefillPrice(unitIds) {
    if (!unitIds.length) return;
    const priceEl = document.getElementById('f-price');
    if (!priceEl || priceEl.value) return; // ya tiene precio, no sobreescribir
    try {
      const today    = new Date();
      const month    = today.getMonth();
      const year     = today.getFullYear();
      const firstDay = `${year}-${String(month+1).padStart(2,'0')}-01`;
      const { data } = await this.db
        .from('bookings')
        .select('price_per_night, booking_units(unit_id)')
        .eq('hotel_id', this.ctx.hotelId)
        .not('status','in','(cancelled,blocked)')
        .gte('check_in', firstDay)
        .gt('price_per_night', 0);

      const relevant = (data ?? []).filter(b =>
        (b.booking_units ?? []).some(bu => unitIds.includes(bu.unit_id)) &&
        b.price_per_night > 0
      );

      if (!relevant.length) return;

      const adr = Math.round(
        relevant.reduce((s, b) => s + b.price_per_night, 0) / relevant.length / 1000
      ) * 1000; // redondear al millar

      if (adr > 0) {
        priceEl.value = adr;
        priceEl.dispatchEvent(new Event('input'));
        // Highlight sutil para avisar que fue pre-cargado
        priceEl.style.borderColor = '#22c55e';
        priceEl.style.boxShadow   = '0 0 0 3px rgba(34,197,94,.15)';
        setTimeout(() => {
          priceEl.style.borderColor = '';
          priceEl.style.boxShadow   = '';
        }, 2500);
      }
    } catch (_) {}
  }

  _triggerPriceSuggestion() {
    clearTimeout(this._suggestTimer);
    this._suggestTimer = setTimeout(() => this._runPriceSuggestion(), 500);
  }

  async _runPriceSuggestion() {
    const ci       = document.getElementById('f-checkin')?.value;
    const co       = document.getElementById('f-checkout')?.value;
    const unitIds  = [...this._selectedUnitIds];
    const container = document.getElementById('price-suggestion-container');
    if (!container) return;

    if (!ci || !co || !unitIds.length) {
      container.innerHTML = '';
      return;
    }

    // Lazy load PriceSuggester
    if (!this._priceSuggester) {
      try {
        const mod = await import('../services/price-suggester.js');
        if (mod?.PriceSuggester) {
          this._priceSuggester = new mod.PriceSuggester(this.db, this.ctx);
          this._PriceSuggesterClass = mod.PriceSuggester;
        }
      } catch(e) {
        container.innerHTML = '';
        return;
      }
    }
    if (!this._priceSuggester) return;

    container.innerHTML = '<div class="ps-loading">⟳ Analizando historial...</div>';

    try {
      const currentPrice = parseFloat(document.getElementById('f-price')?.value) || 0;
      const result = await this._priceSuggester.suggest(unitIds, ci, co);
      container.innerHTML = this._PriceSuggesterClass.renderPanel(result, currentPrice);

      // Bind "Usar este precio" button
      container.querySelector('.ps-use')?.addEventListener('click', (e) => {
        const price = parseFloat(e.target.dataset.price);
        if (!price) return;
        const priceEl = document.getElementById('f-price');
        if (priceEl) {
          priceEl.value = price;
          priceEl.dispatchEvent(new Event('input'));
          // Brief highlight
          priceEl.style.borderColor = '#22c55e';
          priceEl.style.boxShadow = '0 0 0 2px #22c55e28';
          setTimeout(() => { priceEl.style.borderColor=''; priceEl.style.boxShadow=''; }, 1800);
        }
        showToast('Precio sugerido aplicado ✓', 'success');
      });
    } catch (err) {
      container.innerHTML = '';
    }
  }

  // ── Calcular fechas bloqueadas para el picker ─────
  async _updateBlockedDates() {
    if (!this._datePicker || !this._selectedUnitIds.size) return;
    const unitIds = [...this._selectedUnitIds];
    const today   = toISODate(new Date());
    try {
      const { data } = await this.db
        .from('bookings')
        .select('id, check_in, check_out, booking_units(unit_id)')
        .eq('hotel_id', this.ctx.hotelId)
        .neq('status', 'cancelled')
        .gte('check_out', today);

      if (!data) return;
      const blocked = new Set();
      data.forEach(b => {
        if (this._editingId && b.id === this._editingId) return;
        const units = (b.booking_units ?? []).map(bu => bu.unit_id);
        if (!units.some(uid => unitIds.includes(uid))) return;
        let d = new Date(b.check_in + 'T00:00:00');
        const end = new Date(b.check_out + 'T00:00:00');
        while (d < end) { blocked.add(toISODate(d)); d.setDate(d.getDate() + 1); }
      });
      this._datePicker.setBlockedDates([...blocked]);
    } catch (_) {}
  }

  // ── Navegación de pasos — LIBRE (sin validación forzada) ──
  _goToStep(step) {
    this._currentStep = step;

    document.querySelectorAll('.step-content').forEach((el, i) => {
      el.classList.toggle('active',  i + 1 === step);
      el.classList.toggle('hidden',  i + 1 !== step);
    });

    document.querySelectorAll('.step-item').forEach((el, i) => {
      el.classList.toggle('active',    i + 1 === step);
      el.classList.toggle('completed', i + 1 < step);
    });

    const backBtn = document.getElementById('btn-step-back');
    const nextBtn = document.getElementById('btn-step-next');
    if (backBtn) backBtn.style.visibility = step > 1 ? 'visible' : 'hidden';
    if (nextBtn) nextBtn.textContent = step === this._totalSteps
      ? (this._editingId ? 'Guardar cambios' : 'Confirmar reserva')
      : 'Continuar →';

    if (step === 4) this._updatePaymentSummary();
  }

  // Continuar → siguiente paso O guardar (sin validación hasta guardar)
  _nextStep() {
    if (this._currentStep < this._totalSteps) {
      this._goToStep(this._currentStep + 1);
    } else {
      this._submit();
    }
  }

  _prevStep() {
    if (this._currentStep > 1) this._goToStep(this._currentStep - 1);
  }

  // ── Validación completa — solo al guardar ─────────
  _validateAll() {
    const fn    = document.getElementById('f-firstname').value.trim();
    const ln    = document.getElementById('f-lastname').value.trim();
    const ci    = document.getElementById('f-checkin').value;
    const co    = document.getElementById('f-checkout').value;
    const price = parseFloat(document.getElementById('f-price').value);

    if (!fn || !ln) {
      showToast('Ingresá nombre y apellido del huésped', 'warning');
      this._goToStep(1); return false;
    }
    if (!this._selectedUnitIds.size) {
      showToast('Seleccioná al menos una unidad', 'warning');
      this._goToStep(2); return false;
    }
    if (!ci || !co) {
      showToast('Seleccioná las fechas de estadía', 'warning');
      this._goToStep(2); return false;
    }
    if (ci >= co) {
      showToast('El check-out debe ser posterior al check-in', 'warning');
      this._goToStep(2); return false;
    }
    if (!price || price <= 0) {
      showToast('Ingresá el precio por noche', 'warning');
      this._goToStep(3); return false;
    }

    // ── Verificar solapamiento de reservas ───────────
    const overlapMsg = await this._checkOverlap(ci, co, [...this._selectedUnitIds]);
    if (overlapMsg) {
      showToast(overlapMsg, 'error');
      this._goToStep(2); return false;
    }

    return true;
  }

  // ── Verificar reservas superpuestas ──────────────
  async _checkOverlap(checkIn, checkOut, unitIds) {
    if (!unitIds.length) return null;
    try {
      const { data } = await this.db
        .from('bookings')
        .select('id, check_in, check_out, guests!bookings_guest_id_fkey(first_name,last_name), booking_units(unit_id,units(name,sort_order))')
        .eq('hotel_id', this.ctx.hotelId)
        .neq('status', 'cancelled')
        .not('status', 'eq', 'blocked')
        .lt('check_in', checkOut)
        .gt('check_out', checkIn);

      if (!data?.length) return null;

      // Filtrar solo las que comparten unidad con esta reserva
      const conflicts = data.filter(b => {
        if (this._editingId && b.id === this._editingId) return false; // permitir editar la misma
        const bUnitIds = (b.booking_units ?? []).map(bu => bu.unit_id);
        return bUnitIds.some(uid => unitIds.includes(uid));
      });

      if (!conflicts.length) return null;

      const first = conflicts[0];
      const unit  = (first.booking_units ?? [])[0]?.units;
      const guest = first.guests
        ? `${first.guests.first_name} ${first.guests.last_name}`
        : 'Bloqueo';
      const unitName = unit ? `${unit.name}` : 'una unidad';

      return `⚠️ ${unitName} ya está reservada del ${first.check_in} al ${first.check_out} (${guest})`;
    } catch {
      return null; // Si falla la query, no bloquear el guardado
    }
  }

  // ── Precio breakdown con comisión de canal ──────────
  _updateBreakdown() {
    const ci    = document.getElementById('f-checkin').value;
    const co    = document.getElementById('f-checkout').value;
    const price = parseFloat(document.getElementById('f-price').value) || 0;
    const disc  = parseFloat(document.getElementById('f-discount').value) || 0;
    const surch = parseFloat(document.getElementById('f-surcharge').value) || 0;
    const freeN = parseInt(document.getElementById('f-free-nights').value) || 0;

    // Canal de origen actualmente seleccionado
    const source = document.querySelector('input[name="booking-source"]:checked')?.value ?? 'direct';

    const set     = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const show    = (id, show) => document.getElementById(id)?.style.setProperty('display', show ? '' : 'none');

    if (!ci || !co || !price) {
      ['pb-nights','pb-subtotal','pb-discount','pb-surcharge','pb-total',
       'pb-free-nights','pb-commission','pb-net']
        .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
      show('pbr-commission', false);
      show('pbr-net', false);
      return;
    }

    const nights   = Math.round((new Date(co) - new Date(ci)) / 86400000);
    const billable = Math.max(0, nights - freeN);
    const subtotal = price * billable;
    const discAmt  = subtotal * (disc / 100);
    const total    = Math.max(0, subtotal - discAmt + surch);

    // Comisión del canal (desde AppContext.config vía config-service)
    const commPct  = getChannelCommission(source);   // 0 si no hay comisión
    const commAmt  = total * (commPct / 100);
    const netAmt   = total - commAmt;

    // Nombres de canales con comisión
    const CHANNEL_NAMES = {
      booking:'Booking.com', airbnb:'Airbnb',
      despegar:'Despegar', expedia:'Expedia',
    };

    set('pb-nights',      `${nights} noche${nights !== 1 ? 's' : ''}`);
    set('pb-subtotal',    formatARS(subtotal));
    set('pb-free-nights', freeN > 0 ? `−${formatARS(price * freeN)}` : '—');
    set('pb-discount',    disc  > 0 ? `−${formatARS(discAmt)} (${disc}%)` : '—');
    set('pb-surcharge',   surch > 0 ? `+${formatARS(surch)}` : '—');
    set('pb-total',       formatARS(total));

    show('pbr-free-nights', freeN > 0);
    show('pbr-discount',    disc  > 0);
    show('pbr-surcharge',   surch > 0);

    // Mostrar comisión solo si el canal la tiene
    if (commPct > 0) {
      const label = document.getElementById('pb-commission-label');
      if (label) label.textContent = `Comisión ${CHANNEL_NAMES[source] ?? source} (${commPct}%)`;
      set('pb-commission', `−${formatARS(commAmt)}`);
      set('pb-net', formatARS(netAmt));
      show('pbr-commission', true);
      show('pbr-net', true);
    } else {
      show('pbr-commission', false);
      show('pbr-net', false);
    }

    // Guardar para submit
    this._cachedTotal      = total;
    this._cachedCommPct    = commPct;
    this._cachedCommAmt    = commAmt;
    this._cachedNetAmt     = netAmt;

    this._updatePaymentSummary();
  }

  // ── Manejo de pagos ───────────────────────────────
  _addPaymentRow(existing = null) {
    const rowId = `pay-row-${++this._payRowCount}`;
    const today = toISODate(new Date());
    const row   = document.createElement('div');
    row.className = 'payment-row';
    row.id = rowId;
    row.innerHTML = `
      <select class="pay-method form-control">
        ${PAYMENT_METHODS.map(m =>
          `<option value="${m.value}" ${existing?.method === m.value ? 'selected' : ''}>${m.label}</option>`
        ).join('')}
      </select>
      <input type="number" class="pay-amount form-control" placeholder="Monto" min="0" step="100"
             value="${existing?.amount ?? ''}">
      <input type="date" class="pay-date form-control" value="${existing?.payment_date ?? today}">
      <button class="btn btn-icon btn-danger-icon pay-remove" title="Eliminar">×</button>
      <div class="credit-surcharge-info" style="display:none;grid-column:1/-1;font-size:.75rem;color:var(--color-warning)">
        +10% recargo tarjeta: <span id="${rowId}-cc-surcharge">$0</span>
      </div>
    `;

    row.querySelector('.pay-remove').addEventListener('click', () => {
      row.remove(); this._updatePaymentSummary();
    });
    row.querySelector('.pay-method').addEventListener('change', () => {
      this._updateCreditSurcharge(row); this._updatePaymentSummary();
    });
    row.querySelector('.pay-amount').addEventListener('input', () => {
      this._updateCreditSurcharge(row); this._updatePaymentSummary();
    });

    document.getElementById('payments-container').appendChild(row);
    if (existing) this._updateCreditSurcharge(row);
  }

  _updateCreditSurcharge(row) {
    const method = row.querySelector('.pay-method').value;
    const amount = parseFloat(row.querySelector('.pay-amount').value) || 0;
    const isCc   = method === 'credit_card';
    const ccInfo = row.querySelector('.credit-surcharge-info');
    const ccSpan = row.querySelector(`#${row.id}-cc-surcharge`);
    if (ccInfo) ccInfo.style.display = isCc ? 'block' : 'none';
    if (ccSpan) ccSpan.textContent = formatARS(isCc ? amount * 0.10 : 0);
  }

  _getTotalPaid() {
    let total = 0;
    document.querySelectorAll('.payment-row').forEach(row => {
      const amt  = parseFloat(row.querySelector('.pay-amount')?.value) || 0;
      const meth = row.querySelector('.pay-method')?.value;
      // Nota de crédito puede ser negativa (descuento) o positiva (abono)
      total += meth === 'credit_card' ? amt * 1.10 : amt;
    });
    return total;
  }

  _updatePaymentSummary() {
    const total   = this._cachedTotal ?? 0;
    const paid    = this._getTotalPaid();
    const balance = total - paid;
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('ps-total',   formatARS(total));
    set('ps-paid',    formatARS(paid));
    set('ps-balance', formatARS(Math.max(0, balance)));
  }

  // ── Búsqueda de huéspedes ─────────────────────────
  async _searchGuests(q) {
    const container = document.getElementById('guest-results');
    const searchEl  = document.getElementById('guest-search');
    if (!container) return;
    if (q.length < 2) { container.classList.add('hidden'); return; }

    // Typing indicator
    const existingSpinner = searchEl?.parentElement?.querySelector('.guest-searching');
    if (!existingSpinner && searchEl) {
      const spinner = document.createElement('div');
      spinner.className = 'guest-searching';
      searchEl.parentElement?.appendChild(spinner);
    }

    const { data } = await this.db
      .from('guests')
      .select('id, first_name, last_name, dni, phone, bad_experience, tags')
      .eq('hotel_id', this.ctx.hotelId)
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,dni.ilike.%${q}%`)
      .limit(6);

    if (!data?.length) { container.classList.add('hidden'); return; }

    // Remove spinner
    searchEl?.parentElement?.querySelector('.guest-searching')?.remove();

    container.innerHTML = data.map(g => {
      const isBad = g.bad_experience || (g.tags ?? []).includes('no_recomendar');
      const isVIP = (g.tags ?? []).includes('vip');
      return `<div class="guest-result-item ${isBad ? 'bad-exp' : ''}" data-id="${g.id}"
           data-fn="${g.first_name ?? ''}" data-ln="${g.last_name ?? ''}"
           data-dni="${g.dni ?? ''}" data-phone="${g.phone ?? ''}">
        ${isBad ? '⚠️ ' : isVIP ? '⭐ ' : ''}${g.first_name} ${g.last_name}
        ${g.dni ? `<span class="result-meta">${g.dni}</span>` : ''}
      </div>`;
    }).join('');

    container.querySelectorAll('.guest-result-item').forEach(item => {
      item.addEventListener('click', () => {
        this._selectedGuestId = item.dataset.id;
        document.getElementById('f-firstname').value = item.dataset.fn;
        document.getElementById('f-lastname').value  = item.dataset.ln;
        document.getElementById('f-dni').value       = item.dataset.dni;
        document.getElementById('f-phone').value     = item.dataset.phone;
        document.getElementById('guest-search').value = '';
        container.classList.add('hidden');

        const guest = data.find(g => g.id === item.dataset.id);
        const alertContainer = document.getElementById('bad-exp-booking-alert-container');
        if (alertContainer) {
          if (guest?.bad_experience || (guest?.tags ?? []).includes('no_recomendar')) {
            alertContainer.innerHTML = `<div class="alert alert-warning">⚠️ <strong>Atención:</strong> este huésped tiene antecedentes de mala experiencia previa.</div>`;
          } else if ((guest?.tags ?? []).includes('vip')) {
            alertContainer.innerHTML = `<div class="alert alert-info">⭐ <strong>Huésped VIP</strong> — Dar atención preferencial.</div>`;
          } else {
            alertContainer.innerHTML = '';
          }
        }
      });
    });

    container.classList.remove('hidden');
  }

  // ── Submit ────────────────────────────────────────
  async _submit() {
    // Validación completa al guardar
    if (!this._validateAll()) return;

    const btn = document.getElementById('btn-step-next');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
      const ci    = document.getElementById('f-checkin').value;
      const co    = document.getElementById('f-checkout').value;
      const price = parseFloat(document.getElementById('f-price').value) || 0;
      const disc  = parseFloat(document.getElementById('f-discount').value) || 0;
      const surch = parseFloat(document.getElementById('f-surcharge').value) || 0;
      const freeN = parseInt(document.getElementById('f-free-nights').value) || 0;
      const dep   = parseFloat(document.getElementById('f-deposit').value) || 0;
      const notes = document.getElementById('f-notes').value.trim();
      const source = document.querySelector('input[name="booking-source"]:checked')?.value ?? 'direct';

      const nights   = Math.round((new Date(co) - new Date(ci)) / 86400000);
      const billable = Math.max(0, nights - freeN);
      const subtotal = price * billable;
      const discAmt  = subtotal * (disc / 100);
      const total    = Math.max(0, subtotal - discAmt + surch);
      const paid     = this._getTotalPaid();
      const balance  = total - paid;

      // Upsert huésped
      let guestId = this._selectedGuestId;
      const guestPayload = {
        hotel_id:   this.ctx.hotelId,
        first_name: document.getElementById('f-firstname').value.trim(),
        last_name:  document.getElementById('f-lastname').value.trim(),
        dni:        document.getElementById('f-dni').value.trim()   || null,
        phone:      document.getElementById('f-phone').value.trim() || null,
        email:      document.getElementById('f-email').value.trim() || null,
      };

      if (guestId) {
        await this.db.from('guests').update(guestPayload).eq('id', guestId);
      } else {
        const { data: newGuest, error: gErr } = await this.db
          .from('guests').insert(guestPayload).select('id').single();
        if (gErr) throw gErr;
        guestId = newGuest.id;
      }

      const adults   = parseInt(document.getElementById('f-adults')?.value   ?? '1') || 1;
      const children = parseInt(document.getElementById('f-children')?.value ?? '0') || 0;
      const pax      = adults + children;

      const bookingPayload = {
        hotel_id:         this.ctx.hotelId,
        guest_id:         guestId,
        check_in:         ci,
        check_out:        co,
        nights,
        source,
        pax,
        adults,
        children,
        price_per_night:  price,
        discount_pct:     disc,
        surcharge_amount: surch,
        free_nights:      freeN,
        deposit_amount:   dep,
        total_amount:     total,
        total_paid:       paid,
        balance,
        notes:            notes || null,
        commission_pct:   this._cachedCommPct  ?? 0,
        commission_amount:this._cachedCommAmt  ?? 0,
        net_amount:       this._cachedNetAmt   ?? total,
        status:           balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'pending',
      };

      let bookingId = this._editingId;
      if (bookingId) {
        const { error } = await this.db.from('bookings').update(bookingPayload).eq('id', bookingId);
        if (error) throw error;
        await this.db.from('booking_units').delete().eq('booking_id', bookingId);
        await this.db.from('payments').delete().eq('booking_id', bookingId);
      } else {
        const { data: newB, error } = await this.db
          .from('bookings').insert(bookingPayload).select('id').single();
        if (error) throw error;
        bookingId = newB.id;
      }

      // Insertar unidades
      const unitRows = [...this._selectedUnitIds].map(uid => ({
        booking_id: bookingId, unit_id: uid, hotel_id: this.ctx.hotelId,
      }));
      if (unitRows.length) await this.db.from('booking_units').insert(unitRows);

      // Insertar pagos
      const payRows = [];
      document.querySelectorAll('.payment-row').forEach(row => {
        const amt  = parseFloat(row.querySelector('.pay-amount')?.value) || 0;
        const meth = row.querySelector('.pay-method')?.value;
        const date = row.querySelector('.pay-date')?.value;
        if (amt > 0) {
          const isCc = meth === 'credit_card';
          payRows.push({
            booking_id:   bookingId,
            hotel_id:     this.ctx.hotelId,
            method:       meth,
            amount:       isCc ? amt * 1.10 : amt,
            payment_date: date || toISODate(new Date()),
          });
        }
      });
      if (payRows.length) await this.db.from('payments').insert(payRows);

      await logAction(this.db, this.ctx, bookingId ? 'booking_updated' : 'booking_created', { bookingId });

      showToast(this._editingId ? 'Reserva actualizada ✓' : 'Reserva creada ✓', 'success');

      // Disparar confetti si pagó todo
      if (balance <= 0 && paid > 0) {
        document.dispatchEvent(new CustomEvent('booking:fullypaid'));
      }

      this.close();
      document.dispatchEvent(new CustomEvent('booking:changed'));

    } catch (err) {
      console.error('[BookingForm] submit error:', err);
      showToast('Error al guardar: ' + (err.message ?? err), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = this._editingId ? 'Guardar cambios' : 'Confirmar reserva';
      }
    }
  }
}
