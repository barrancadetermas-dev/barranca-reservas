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
import { Bus, EVENTS } from '../services/event-bus.js';
import { cache } from '../services/supabase-cache.js';
import { Sound } from '../services/sound-service.js';
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
// Generado dinámicamente desde SOURCE_CONFIG — única fuente de verdad
const SOURCE_OPTIONS = Object.entries(SOURCE_CONFIG).map(([value, cfg]) => ({
  value,
  label: cfg.label,
  color: cfg.dot ?? cfg.color ?? '#64748B',
}));

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

    // Navegación libre: clic en step indicator
    document.querySelectorAll('.step-item').forEach((el, i) => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => this._goToStep(i + 1));
    });

    // Inicializar selector de canal de origen (compacto)
    this._renderSourceSelector();
  }

  // ── Renderizar selector de canal (compacto, sin emojis) ──
  _renderSourceSelector(value = 'direct') {
    const container = document.getElementById('f-source-selector');
    if (!container) return;

    // Siempre regenerar desde SOURCE_OPTIONS (única fuente de verdad)
    container.innerHTML = SOURCE_OPTIONS.map(s => `
      <label class="src-chip" data-source="${s.value}" style="--src-color:${s.color}">
        <input type="radio" name="booking-source" value="${s.value}"
               ${s.value === value ? 'checked' : ''} style="display:none">
        <span class="src-dot" style="background:${s.color}"></span>
        <span class="src-label">${s.label}</span>
      </label>`).join('');

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
      this._selectedUnitIds.add(String(prefill.unitId));
      this._renderUnitSelector();
    }
    if (prefill.checkIn || prefill.checkOut) {
      this._datePicker?.setValue(prefill.checkIn ?? null, prefill.checkOut ?? null);
      if (prefill.checkIn)  document.getElementById('f-checkin').value  = prefill.checkIn;
      if (prefill.checkOut) document.getElementById('f-checkout').value = prefill.checkOut;
      this._updateBreakdown();
    }
    // Precarga desde calculadora (paso 0)
    if (prefill.price) {
      const priceEl = document.getElementById('f-price');
      if (priceEl) priceEl.value = prefill.price;
      this._updateBreakdown();
    }
    if (prefill.source) {
      const container = document.getElementById('f-source-selector');
      if (container) {
        container.querySelectorAll('.src-chip').forEach(c => c.classList.remove('selected'));
        const chip = container.querySelector(`.src-chip[data-source="${prefill.source}"]`);
        if (chip) {
          chip.classList.add('selected');
          const inp = chip.querySelector('input');
          if (inp) inp.checked = true;
        }
      }
    }
    if (prefill.discountPct !== undefined) {
      const discEl = document.getElementById('f-discount');
      if (discEl) discEl.value = prefill.discountPct;
    }

    document.getElementById('overlay-booking').classList.remove('hidden');

    // Historial de precios — se carga async en background
    if (prefill.unitId) this._loadPriceHistory(prefill.unitId);
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
      this._selectedUnitIds = new Set((b.booking_units ?? []).map(bu => String(bu.unit_id)));
      this._renderUnitSelector();

      // Fechas
      if (this._datePicker && b.check_in && b.check_out) {
        this._datePicker.setValue(b.check_in, b.check_out);
      }
      if (b.check_in)  document.getElementById('f-checkin').value  = b.check_in;
      if (b.check_out) document.getElementById('f-checkout').value = b.check_out;

      const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
      setVal('f-price',       b.price_per_night ?? '');
      setVal('f-discount',    b.discount_pct    ?? 0);
      setVal('f-surcharge',   b.surcharge_amount ?? 0);
      setVal('f-free-nights', b.free_nights     ?? 0);
      setVal('f-deposit',     b.deposit_amount  ?? 0);
      setVal('f-notes',       b.notes           ?? '');
      document.getElementById('notes-count').textContent = (b.notes ?? '').length;
      // Pax
      if (document.getElementById('f-adults'))   document.getElementById('f-adults').value   = b.adults   ?? b.pax ?? 2;
      if (document.getElementById('f-children')) document.getElementById('f-children').value = b.children ?? 0;

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
    if (!booking?.id) return;
    this._currentDetailBookingId = booking.id;
    const overlay = document.getElementById('overlay-detail');
    const body    = document.getElementById('detail-body');
    if (!overlay || !body) return;

    const guest      = booking.guests
      ? `${booking.guests.first_name ?? ''} ${booking.guests.last_name ?? ''}`.trim()
      : 'Sin nombre';
    const unitNames  = (booking.booking_units ?? [])
      .map(bu => bu.units?.name ?? '').filter(Boolean).join(', ');
    const srcCfg     = SOURCE_CONFIG?.[booking.source] ?? { label: booking.source ?? 'Directo', dot: '#64748b' };
    const badgeColor = srcCfg.dot ?? srcCfg.color ?? '#64748b';
    const statusLabels = { pending:'Sin seña', partial:'Con seña', paid:'Pagado',
                           cancelled:'Cancelada', blocked:'Bloqueada' };
    const hasBadExp  = booking.guests?.bad_experience;

    // Desglose financiero completo
    const nights        = booking.nights ?? 0;
    const pricePerNight = booking.price_per_night ?? 0;
    const discPct       = booking.discount_pct ?? 0;
    const surcharge     = booking.surcharge_amount ?? 0;
    const freeNights    = booking.free_nights ?? 0;
    const billable      = Math.max(0, nights - freeNights);
    const subtotal      = pricePerNight * billable;
    const discAmt       = subtotal * (discPct / 100);
    const total         = booking.total_amount ?? Math.max(0, subtotal - discAmt + surcharge);
    const totalPaid     = booking.total_paid ?? 0;
    const balance       = booking.balance ?? (total - totalPaid);

    // Botones check-in/out
    const now   = new Date();
    const ciDate = new Date(booking.check_in + 'T12:00:00');
    const showCI = !booking.checked_in_at  && ciDate <= now && booking.status !== 'cancelled';
    const showCO = !!booking.checked_in_at && !booking.checked_out_at && booking.status !== 'cancelled';
    const ciBtn = document.getElementById('detail-checkin-btn');
    const coBtn = document.getElementById('detail-checkout-btn');
    if (ciBtn) ciBtn.style.display = showCI ? '' : 'none';
    if (coBtn) coBtn.style.display = showCO ? '' : 'none';

    body.innerHTML = `
      ${hasBadExp ? `<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:var(--r-md);padding:8px 12px;font-size:.78rem;color:#dc2626">
        ⚠️ <strong>Atención:</strong> Huésped con antecedentes de mala experiencia.
      </div>` : ''}
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
        <div>
          <span class="detail-label">Check-in</span>
          <strong>${booking.check_in}</strong>
          ${booking.checked_in_at ? `<span style="font-size:.65rem;color:var(--color-success);display:block">✓ Registrado</span>` : ''}
        </div>
        <div class="detail-nights">
          ${nights} noche${nights !== 1 ? 's' : ''}
          ${(booking.pax || booking.adults) ? `<br><span style="font-size:.72rem;color:var(--color-text-3)">👥 ${booking.adults ?? booking.pax ?? 1} adulto${(booking.adults ?? 1) !== 1 ? 's' : ''}${booking.children ? ` + ${booking.children} menor${booking.children !== 1 ? 'es' : ''}` : ''}</span>` : ''}
        </div>
        <div style="text-align:right">
          <span class="detail-label">Check-out</span>
          <strong>${booking.check_out}</strong>
          ${booking.checked_out_at ? `<span style="font-size:.65rem;color:var(--color-success);display:block">✓ Registrado</span>` : ''}
        </div>
      </div>
      <div class="detail-breakdown">
        ${pricePerNight > 0 ? `
          <div class="detail-breakdown-row">
            <span>Precio por noche</span>
            <span>${formatARS(pricePerNight)}</span>
          </div>
          <div class="detail-breakdown-row">
            <span>Noches${freeNights > 0 ? ` (${nights} − ${freeNights} gratis)` : ` × ${nights}`}</span>
            <span>${billable} fact.</span>
          </div>
          <div class="detail-breakdown-row">
            <span>Subtotal</span>
            <span>${formatARS(subtotal)}</span>
          </div>
          ${discPct > 0 ? `<div class="detail-breakdown-row" style="color:var(--color-success)"><span>Descuento ${discPct}%</span><span>−${formatARS(discAmt)}</span></div>` : ''}
          ${surcharge > 0 ? `<div class="detail-breakdown-row" style="color:var(--color-warning)"><span>Recargo / extra</span><span>+${formatARS(surcharge)}</span></div>` : ''}
        ` : ''}
        <div class="detail-breakdown-row total-row">
          <span>Total</span>
          <span>${formatARS(total)}</span>
        </div>
        ${totalPaid > 0 ? `<div class="detail-breakdown-row paid-row"><span>Pagado</span><span>${formatARS(totalPaid)}</span></div>` : ''}
        <div class="detail-breakdown-row balance-row" style="color:${balance > 0 ? 'var(--color-warning)' : 'var(--color-success)'}">
          <span>${balance > 0 ? '⚠ Saldo pendiente' : '✓ Saldado'}</span>
          <span style="font-size:1.05rem">${formatARS(Math.abs(balance))}</span>
        </div>
      </div>
      ${booking.notes ? `<div class="detail-notes"><span class="detail-label">Notas</span><p>${booking.notes}</p></div>` : ''}
    `;

    if (booking.payments?.length) {
      const payHtml = booking.payments
        .filter(p => p.amount !== 0)
        .map(p => {
          const pm    = PAYMENT_METHODS.find(m => m.value === p.method)?.label ?? p.method;
          const isNeg = p.amount < 0;
          return `<div class="pay-row-detail">
            <span>${isNeg ? '↩ Devolución' : pm}</span>
            <span style="font-size:.72rem;color:var(--color-text-3)">${p.payment_date ?? ''}</span>
            <span style="color:${isNeg?'var(--color-warning)':'var(--color-success)'};font-weight:600">${isNeg?'−':'+'}${formatARS(Math.abs(p.amount))}</span>
          </div>`;
        }).join('');
      body.innerHTML += `<div class="detail-payments"><div class="detail-label" style="margin-bottom:8px">Historial de Pagos</div>${payHtml}</div>`;
    }

    overlay.classList.remove('hidden');
    requestAnimationFrame(() => document.getElementById('detail-close')?.focus());
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

    ['f-firstname','f-lastname','f-dni','f-phone','f-email','f-notes',
     'f-price','f-discount','f-surcharge','f-free-nights','f-deposit',
     'f-checkin','f-checkout'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = ['f-discount','f-surcharge','f-free-nights','f-deposit'].includes(id) ? '0' : '';
    });

    document.getElementById('notes-count').textContent  = '0';
    document.getElementById('guest-search').value       = '';
    // Reset pax
    const adultsEl = document.getElementById('f-adults');
    if (adultsEl) adultsEl.value = '2';
    const childEl = document.getElementById('f-children');
    if (childEl) childEl.value = '0';
    const paxNumEl = document.getElementById('pax-total-num');
    if (paxNumEl) paxNumEl.textContent = '2';
    const paxLblEl = document.getElementById('pax-total-label');
    if (paxLblEl) paxLblEl.textContent = 'personas en total';
    const paxHidEl = document.getElementById('f-pax');
    if (paxHidEl) paxHidEl.value = '2';
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
      const selected = this._selectedUnitIds.has(String(u.id));
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
        const uid = String(chip.dataset.unitId);
        const cb  = chip.querySelector('input[type="checkbox"]');
        if (this._selectedUnitIds.has(uid)) {
          this._selectedUnitIds.delete(uid);
          chip.classList.remove('selected');
          if (cb) cb.checked = false;
        } else {
          this._selectedUnitIds.add(uid);
          chip.classList.add('selected');
          if (cb) cb.checked = true;
          // Cargar historial de precio para la unidad seleccionada
          this._loadPriceHistory(uid);
        }
        this._updateBlockedDates();
        this._updateBreakdown();
        this._triggerPriceSuggestion();
        // Update pax cap when unit changes
        this._updatePaxCap?.();
      });
    });

    // Render pax selector si hay contenedor
    this._renderPaxSelector();
  }

  // ── Selector de cantidad de personas ─────────────
  _renderPaxSelector() {
    const getMaxPax = () => {
      // Capacidad máxima = suma de max_guests de unidades seleccionadas
      // (permite multi-unidad: ej. 2 deptos para 8 personas)
      if (!this._selectedUnitIds?.size) return 99;
      const units = this.ctx?.units ?? [];
      let total = 0;
      this._selectedUnitIds.forEach(uid => {
        const u = units.find(u => String(u.id) === String(uid));
        if (u?.max_guests) total += u.max_guests;
      });
      return total > 0 ? total : 99;
    };

    const updateTotal = () => {
      const adults   = parseInt(document.getElementById('f-adults')?.value   ?? '1');
      const children = parseInt(document.getElementById('f-children')?.value ?? '0');
      const total    = adults + children;
      const maxPax   = getMaxPax();
      const numEl    = document.getElementById('pax-total-num');
      const lblEl    = document.getElementById('pax-total-label');
      const paxHid   = document.getElementById('f-pax');
      const capHint  = document.getElementById('pax-cap-hint');
      if (numEl) numEl.textContent = total;
      if (lblEl) lblEl.textContent = total === 1 ? 'persona en total' : 'personas en total';
      if (paxHid) paxHid.value = total;
      if (capHint && maxPax < 99) {
        const over = total > maxPax;
        capHint.textContent = over
          ? `⚠️ Excede el máximo (${maxPax})`
          : `máx. ${maxPax}`;
        capHint.style.color = over ? '#ef4444' : '';
      }
    };

    const bind = (btnId, inputId, delta) => {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      const fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', (e) => {
        e.preventDefault();
        const inp      = document.getElementById(inputId);
        if (!inp) return;
        const min      = parseInt(inp.min ?? '0');
        const maxPax   = getMaxPax();
        const isAdults = inputId === 'f-adults';
        const other    = isAdults
          ? parseInt(document.getElementById('f-children')?.value ?? '0')
          : parseInt(document.getElementById('f-adults')?.value   ?? '1');
        const cur      = parseInt(inp.value ?? '0');
        const next     = Math.max(min, cur + delta);
        // Enforce total cap
        if (delta > 0 && (next + other) > maxPax) {
          const capHint = document.getElementById('pax-cap-hint');
          if (capHint) {
            capHint.textContent = `⚠️ Máximo ${maxPax} huéspedes`;
            capHint.style.color = '#ef4444';
            setTimeout(() => { capHint.textContent = `máx. ${maxPax}`; capHint.style.color = ''; }, 1500);
          }
          return;
        }
        inp.value = next;
        updateTotal();
      });
    };

    bind('adults-minus',   'f-adults',   -1);
    bind('adults-plus',    'f-adults',   +1);
    bind('children-minus', 'f-children', -1);
    bind('children-plus',  'f-children', +1);
    updateTotal();

    // Re-run when unit selection changes to update cap
    this._updatePaxCap = updateTotal;
  }

  // ── Sugeridor de precio dinámico ─────────────────
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
    // Clear previous errors
    document.querySelectorAll('.field-error').forEach(el => {
      el.classList.remove('field-error');
    });

    const fn    = document.getElementById('f-firstname').value.trim();
    const ln    = document.getElementById('f-lastname').value.trim();
    const ci    = document.getElementById('f-checkin').value;
    const co    = document.getElementById('f-checkout').value;
    const price = parseFloat(document.getElementById('f-price').value);

    // Collect all errors, navigate to first failing step
    let firstStep = null;
    const fail = (id, stepNum, msg) => {
      const el = document.getElementById(id);
      if (el) { el.classList.add('field-error'); el.focus?.(); }
      if (!firstStep || stepNum < firstStep.step) {
        firstStep = { step: stepNum, msg };
      }
    };

    if (!fn) fail('f-firstname', 1, 'Nombre requerido');
    if (!ln) fail('f-lastname',  1, 'Apellido requerido');
    if (!this._selectedUnitIds.size) {
      // Units selector — highlight the container
      const sel = document.getElementById('units-selector');
      if (sel) sel.classList.add('field-error');
      if (!firstStep || 2 < firstStep.step) firstStep = { step: 2, msg: 'Seleccioná al menos una unidad' };
    }
    if (!ci) fail('f-date-picker', 2, 'Seleccioná fechas de estadía');
    if (!co) fail('f-date-picker', 2, 'Seleccioná fechas de estadía');
    if (ci && co && ci >= co) {
      fail('f-date-picker', 2, 'El check-out debe ser posterior al check-in');
    }
    if (!price || price <= 0) fail('f-price', 3, 'Ingresá el precio por noche');

    if (firstStep) {
      this._goToStep(firstStep.step);
      showToast(firstStep.msg, 'warning');
      Sound?.error?.();
      return false;
    }
    return true;
  }

  // ── Precio breakdown ──────────────────────────────
  _updateBreakdown() {
    const ci    = document.getElementById('f-checkin').value;
    const co    = document.getElementById('f-checkout').value;
    const price = parseFloat(document.getElementById('f-price').value) || 0;
    const disc  = parseFloat(document.getElementById('f-discount').value) || 0;
    const surch = parseFloat(document.getElementById('f-surcharge').value) || 0;
    const freeN = parseInt(document.getElementById('f-free-nights').value) || 0;

    if (!ci || !co || !price) {
      ['pb-nights','pb-subtotal','pb-discount','pb-surcharge','pb-total','pb-free-nights']
        .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
      return;
    }

    const nights   = Math.round((new Date(co) - new Date(ci)) / 86400000);
    const billable = Math.max(0, nights - freeN);
    const subtotal = price * billable;
    const discAmt  = subtotal * (disc / 100);
    const total    = Math.max(0, subtotal - discAmt + surch);

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('pb-nights',     `${nights} noche${nights !== 1 ? 's' : ''}`);
    set('pb-subtotal',   formatARS(subtotal));
    set('pb-free-nights', freeN > 0 ? `−${formatARS(price * freeN)}` : '—');
    set('pb-discount',   disc > 0 ? `−${formatARS(discAmt)} (${disc}%)` : '—');
    set('pb-surcharge',  surch > 0 ? `+${formatARS(surch)}` : '—');
    set('pb-total',      formatARS(total));

    document.getElementById('pbr-free-nights')?.style.setProperty('display', freeN > 0 ? '' : 'none');
    document.getElementById('pbr-discount')?.style.setProperty('display',    disc > 0 ? '' : 'none');
    document.getElementById('pbr-surcharge')?.style.setProperty('display',   surch > 0 ? '' : 'none');

    this._cachedTotal = total;
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
    if (!container) return;
    if (q.length < 2) { container.classList.add('hidden'); return; }

    const { data } = await this.db
      .from('guests')
      .select('id, first_name, last_name, dni, phone, bad_experience, tags')
      .eq('hotel_id', this.ctx.hotelId)
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,dni.ilike.%${q}%`)
      .limit(6);

    if (!data?.length) { container.classList.add('hidden'); return; }

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

  // ── Historial de precios por unidad y mes ─────────
  async _loadPriceHistory(unitId) {
    if (!unitId) return;
    const hints = document.getElementById('price-history-hint');
    if (!hints) return;
    hints.innerHTML = '<span style="font-size:.72rem;color:var(--color-text-3)">⟳ Buscando historial...</span>';

    try {
      const now   = new Date();
      const month = now.getMonth() + 1;  // mes actual
      const monthPad = String(month).padStart(2, '0');
      // Buscar reservas de esta unidad en el mismo mes (cualquier año)
      const { data } = await this.db
        .from('booking_units')
        .select('bookings!inner(price_per_night, check_in, check_out, status)')
        .eq('unit_id', unitId)
        .not('bookings.status', 'in', '(cancelled,blocked)')
        .gt('bookings.price_per_night', 0)
        .like('bookings.check_in', `%-${monthPad}-%`)
        .limit(30);

      const prices = (data ?? [])
        .map(bu => bu.bookings?.price_per_night)
        .filter(p => p > 0);

      if (!prices.length) {
        // Fallback: buscar precio de cualquier mes reciente para esta unidad
        const { data: anyData } = await this.db
          .from('booking_units')
          .select('bookings!inner(price_per_night, check_in, status)')
          .eq('unit_id', unitId)
          .not('bookings.status', 'in', '(cancelled,blocked)')
          .gt('bookings.price_per_night', 0)
          .order('bookings.check_in', { ascending: false })
          .limit(5);
        const anyPrices = (anyData ?? []).map(bu => bu.bookings?.price_per_night).filter(p => p > 0);
        if (!anyPrices.length) { hints.innerHTML = ''; return; }
        const anyAvg = Math.round(anyPrices.reduce((a,b) => a+b,0) / anyPrices.length);
        const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
        const unitName = this.ctx.units.find(u => u.id === unitId)?.name ?? 'esta unidad';
        hints.innerHTML = `<span style="font-size:.72rem;color:var(--color-primary)">
          💡 Último precio registrado en <strong>${unitName}</strong>: <strong>${fmt(anyAvg)}</strong>/noche
        </span>`;
        return;
      }

      const avg      = Math.round(prices.reduce((a,b) => a+b,0) / prices.length);
      const min      = Math.min(...prices);
      const max      = Math.max(...prices);
      const fmt      = n => '$' + Math.round(n).toLocaleString('es-AR');
      const MONTHS   = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
      const unitName = this.ctx.units.find(u => u.id === unitId)?.name ?? 'esta unidad';

      hints.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;
          padding:6px 10px;background:var(--color-surface-2);
          border-radius:var(--r-md);border-left:3px solid var(--color-primary)">
          <span style="font-size:.72rem;color:var(--color-text-2)">
            💡 <strong>${unitName}</strong> en <strong>${MONTHS[month-1]}</strong>
            (${prices.length} reserva${prices.length!==1?'s':''} históricas):
            prom. <strong style="color:var(--color-primary)">${fmt(avg)}</strong>/noche
            ${min !== max ? `· rango ${fmt(min)}–${fmt(max)}` : ''}
          </span>
          <button style="font-size:.68rem;padding:2px 8px;border:1px solid var(--color-primary);
            border-radius:var(--r-sm);background:transparent;color:var(--color-primary);
            cursor:pointer" onclick="(function(){
              var el=document.getElementById('f-price');
              if(el){el.value=${avg};el.dispatchEvent(new Event('input',{bubbles:true}));}
            })()">
            Usar ${fmt(avg)}
          </button>
        </div>`;
    } catch { hints.innerHTML = ''; }
  }

  // ── Submit ────────────────────────────────────────
  async _submit() {
    if (!this._validateAll()) return;

    const btn = document.getElementById('btn-step-next');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    let _safetyTimer = setTimeout(() => {
      if (btn) { btn.disabled = false; btn.textContent = this._editingId ? 'Guardar cambios' : 'Confirmar reserva'; }
      showToast('La operación tardó demasiado. Verificá tu conexión.', 'error');
    }, 30000);

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

      // ── Validar superposición de unidades ────────────
      const selectedUnits = [...this._selectedUnitIds];
      if (selectedUnits.length > 0 && ci && co) {
        const { data: conflicts } = await this.db
          .from('booking_units')
          .select('unit_id, bookings!inner(id, check_in, check_out, status, guests!bookings_guest_id_fkey(first_name,last_name))')
          .in('unit_id', selectedUnits)
          .not('bookings.status', 'in', '(cancelled,blocked)')
          .lt('bookings.check_in', co)
          .gt('bookings.check_out', ci);

        const realConflicts = (conflicts ?? []).filter(c =>
          !this._editingId || c.bookings?.id !== this._editingId
        );
        if (realConflicts.length) {
          const g = realConflicts[0].bookings?.guests;
          const name = g ? `${g.first_name} ${g.last_name}` : 'otro huésped';
          showToast(`⚠️ Superposición: "${name}" ya tiene esa unidad en esas fechas.`, 'error');
          if (btn) { btn.disabled = false; btn.textContent = this._editingId ? 'Guardar cambios' : 'Confirmar reserva'; }
          clearTimeout(_safetyTimer);
          return;
        }
      }

      // ── Capturar estado ANTES (para audit log) ────────
      let bookingBefore = null;
      if (this._editingId) {
        const { data: prev } = await this.db
          .from('bookings')
          .select('check_in,check_out,price_per_night,total_amount,status,source,notes')
          .eq('id', this._editingId).single();
        bookingBefore = prev;
      }

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

      // ── Columnas CORE (siempre existen en la DB) ──────────────
      const corePayload = {
        hotel_id:         this.ctx.hotelId,
        guest_id:         guestId,
        check_in:         ci,
        check_out:        co,
        // nights: GENERATED ALWAYS AS en PostgreSQL — nunca insertar
        source,
        price_per_night:  price,
        discount_pct:     disc,
        surcharge_amount: surch,
        total_amount:     total,
        total_paid:       paid,
        balance,
        notes:            notes || null,
        status:           balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'pending',
      };

      // ── Columnas opcionales — se agregan en UPDATE separado ──────
      const pax      = (parseInt(document.getElementById('f-adults')?.value) || 1)
                     + (parseInt(document.getElementById('f-children')?.value) || 0);
      const adults   = parseInt(document.getElementById('f-adults')?.value)   || 1;
      const children = parseInt(document.getElementById('f-children')?.value) || 0;

      let bookingId = this._editingId;
      if (bookingId) {
        // UPDATE — intentar con free_nights primero
        let { error: upErr } = await this.db.from('bookings').update({
          ...corePayload, free_nights: freeN
        }).eq('id', bookingId);
        if (upErr?.message?.includes('free_nights')) {
          // Columna no existe aún → guardar sin ella
          const { error: upErr2 } = await this.db.from('bookings').update(corePayload).eq('id', bookingId);
          if (upErr2) throw new Error('No fue posible actualizar la reserva: ' + upErr2.message);
        } else if (upErr) {
          throw new Error('No fue posible actualizar la reserva: ' + upErr.message);
        }
        await this.db.from('booking_units').delete().eq('booking_id', bookingId);
        await this.db.from('payments').delete().eq('booking_id', bookingId);
      } else {
        // INSERT — intentar con free_nights primero
        let { data: newB, error: insErr } = await this.db
          .from('bookings').insert({ ...corePayload, free_nights: freeN })
          .select('id').single();
        if (insErr?.message?.includes('free_nights') || insErr?.message?.includes('does not exist')) {
          // Columna no existe → reintentar sin ella
          const { data: newB2, error: insErr2 } = await this.db
            .from('bookings').insert(corePayload).select('id').single();
          if (insErr2) throw new Error('No fue posible crear la reserva: ' + insErr2.message);
          newB = newB2;
        } else if (insErr) {
          throw new Error('No fue posible crear la reserva: ' + insErr.message);
        }
        bookingId = newB.id;
      }

      // ── Columnas opcionales (pax, comisiones) — silencioso si no existen ──
      try {
        await this.db.from('bookings').update({ pax, adults, children }).eq('id', bookingId);
      } catch { /* columnas opcionales */ }

      // Insertar unidades — sin hotel_id (no existe en booking_units)
      const unitRows = [...this._selectedUnitIds].map(uid => ({
        booking_id: bookingId, unit_id: uid,
      }));
      if (unitRows.length) {
        const { error: buErr } = await this.db.from('booking_units').insert(unitRows);
        if (buErr) throw new Error('Error asignando unidades: ' + buErr.message);
      }

      // Insertar pagos (incluye notes del nuevo campo)
      const payRows = [];
      document.querySelectorAll('.payment-row').forEach(row => {
        const amt  = parseFloat(row.querySelector('.pay-amount')?.value) || 0;
        const meth = row.querySelector('.pay-method')?.value;
        const date = row.querySelector('.pay-date')?.value;
        const note = row.querySelector('.pay-note')?.value?.trim() || null;
        if (amt > 0) {
          const isCc = meth === 'credit_card';
          payRows.push({
            booking_id:   bookingId,
            hotel_id:     this.ctx.hotelId,
            method:       meth,
            amount:       isCc ? amt * 1.10 : amt,
            // payment_date añadido en migration_complete_v8.sql
            // Si la columna no existe todavía, se ignora el error de schema
            payment_date: date || toISODate(new Date()),
            notes:        note,
          });
        }
      });
      if (payRows.length) {
        const { error: pmErr } = await this.db.from('payments').insert(payRows);
        if (pmErr) throw new Error('Error registrando pago: ' + pmErr.message);
      }

      const _logVerb    = this._editingId ? 'UPDATE' : 'CREATE';
      const _logSummary = this._editingId
        ? `Actualizada: ${ci} → ${co}, $${price}/noche, total $${total}`
        : `Creada: ${ci} → ${co}, $${price}/noche, total $${total}`;
      const _changes = bookingBefore ? {
        before: bookingBefore,
        after:  { check_in: ci, check_out: co, price_per_night: price, total_amount: total, status: balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'pending', source, notes: notes || null },
      } : null;
      await logAction(_logVerb, 'booking', String(bookingId), _logSummary, _changes);

      showToast(this._editingId ? 'Reserva actualizada ✓' : 'Reserva creada ✓', 'success');
      Sound?.[this._editingId ? 'success' : 'newBooking']?.();

      // Email de confirmación — solo en creación nueva (no edición)
      if (!this._editingId) {
        const guestEmail = document.getElementById('f-email')?.value?.trim();
        // Invocar async sin bloquear el UI
        this.db.functions?.invoke?.('booking-confirmation', {
          body: { bookingId: String(bookingId) },
        }).catch((err) => console.warn('[BookingForm] confirmation email:', err));
      }

      // Invalidar cache para que el calendario traiga datos frescos
      cache.invalidate('bookings');

      // Micro-animación: pulso en la barra nueva/editada
      Bus.emit(EVENTS.CAL_PULSE_BAR, { bookingId: String(bookingId) });

      if (balance <= 0 && paid > 0) {
        document.dispatchEvent(new CustomEvent('booking:fullypaid'));
      }

      this.close();
      document.dispatchEvent(new CustomEvent('booking:changed'));

    } catch (err) {
      console.error('[MILA] Booking save error:', err);
      // Mostrar el error real siempre — ayuda a diagnosticar
      const raw = err?.message ?? String(err) ?? 'Error desconocido';
      const userMsg = raw.includes('violates foreign key')
        ? 'ID de unidad o huésped inválido. Recargá la página.'
        : raw.includes('violates not-null')
        ? 'Falta un campo requerido en la base de datos.'
        : raw.includes('duplicate')
        ? 'Ya existe una reserva con esos datos.'
        : raw.includes('permission') || raw.includes('policy')
        ? 'Sin permisos. Verificá las políticas RLS en Supabase.'
        : raw;
      showToast(`❌ ${userMsg}`, 'error');
    } finally {
      clearTimeout(_safetyTimer);
      if (btn) {
        btn.disabled   = false;
        btn.textContent = this._editingId ? 'Guardar cambios' : 'Confirmar reserva';
      }
    }
  }
}
