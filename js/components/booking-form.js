
// Formatea porcentaje: entero si es exacto, hasta 4 decimales si no
const fmtPct = (n) => {
  const v = parseFloat(n) || 0;
  if (v === 0) return '0';
  const r4 = Math.round(v * 10000) / 10000;
  return Number.isInteger(r4) ? String(r4) : r4.toFixed(4).replace(/\.?0+$/, '');
};

// ══════════════════════════════════════════════════
// booking-form.js v5.0 — MILA Sistema Inteligente
// • Navegación libre entre pestañas (sin validación forzada)
// • Canal de origen rediseñado (compacto, sin emojis)
// • Nota de Crédito / Voucher como método de pago
// • Validación solo al guardar
// ══════════════════════════════════════════════════

import { can, isDemo } from '../auth/permissions.js';
import { formatARS, toISODate, showToast, getUnitLabel, getUnitColor, getUnitChipHTML, SOURCE_CONFIG, AppContext, appendNote } from '../supabase-config.js';
import { logAction } from '../services/audit-service.js';
import { DateRangePicker } from './date-range-picker.js';
import { Bus, EVENTS } from '../services/event-bus.js';
import { cache } from '../services/supabase-cache.js';
import { Sound } from '../services/sound-service.js';
import { fetchDisponibilidad } from '../modules/mila-assistant/mila-data.js';
import { getUsdConversionRate } from '../services/usd-rate-history.js';
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
    this._totalSteps  = 5;
    this._editingId   = null;
    this._selectedGuestId = null;
    this._selectedUnitIds = new Set();
    this._unitPrices    = {}; // unitId -> precio/noche, solo cuando hay 2+ unidades
    this._editingCreatedAt = null; // fecha de creación de la reserva (solo en edición)
    this._editRequestSeq = 0; // guard contra condición de carrera: si openEdit() se llama
                               // dos veces rápido (doble clic, reapertura), solo la última gana
    this._datePicker   = null;
    this._payRowCount  = 0;
    this._priceSuggester = null; // lazy init
    this._suggestTimer   = null;
    this._cachedTotal = 0;
    this._currentDetailBookingId = null;

    this._bindEvents();
  }

  _withTimeout(promise, label = 'operación', ms = 15000) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${label} tardó demasiado. Revisá conexión/permisos e intentá nuevamente.`));
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
  }

  // ── Bind eventos globales del formulario ──────────
  // Usa event delegation en document para que funcione
  // aunque el modal HTML se inserte después del constructor.
  _bindEvents() {
    // ── Botones del modal — delegation ───────────────
    document.addEventListener('click', (e) => {
      if (e.target.closest('#booking-modal-close') || e.target.closest('#btn-booking-cancel')) {
        this.close();
        return;
      }
      if (e.target.closest('#btn-step-next')) {
        this._nextStep();
        return;
      }
      if (e.target.closest('#btn-step-back')) {
        this._prevStep();
        return;
      }
      if (e.target.closest('#btn-add-payment-row')) {
        this._addPaymentRow();
        return;
      }
      // Precio por unidad: copiar el precio de la primera unidad a todas
      if (e.target.closest('#btn-same-price-all')) {
        const unitIds = [...this._selectedUnitIds];
        if (unitIds.length) {
          const firstVal = this._unitPrices[unitIds[0]] || 0;
          unitIds.forEach(uid => { this._unitPrices[uid] = firstVal; });
          this._renderPerUnitPrices();
        }
        return;
      }
      // Voucher: confirmar reserva
      if (e.target.closest('#btn-voucher-confirm')) {
        if (this._submitting) return;
        this._submit();
        return;
      }
      // Step indicators
      const stepItem = e.target.closest('.step-item');
      if (stepItem) {
        const items = [...document.querySelectorAll('.step-item')];
        const idx   = items.indexOf(stepItem);
        if (idx >= 0) this._goToStep(idx + 1);
        return;
      }
    });

    // ── Inputs — delegation ──────────────────────────
    document.addEventListener('input', (e) => {
      if (['f-price','f-discount','f-surcharge','f-free-nights'].includes(e.target.id)) {
        this._updateBreakdown();
        return;
      }
      if (e.target.id === 'f-notes') {
        const counter = document.getElementById('notes-count');
        if (counter) counter.textContent = e.target.value.length;
        return;
      }
      if (e.target.id === 'guest-search') {
        clearTimeout(this._guestSearchTimer);
        this._guestSearchTimer = setTimeout(() => this._searchGuests(e.target.value.trim()), 300);
        return;
      }
    });

    // ── Late checkout: mostrar/ocultar opciones inline ──
    document.addEventListener('change', (e) => {
      if (e.target.id === 'f-late-checkout') {
        const show = e.target.checked;
        const paidWrap   = document.getElementById('f-lco-paid-wrap');
        const amountWrap = document.getElementById('f-lco-amount-wrap');
        if (paidWrap)   paidWrap.style.display   = show ? 'flex' : 'none';
        if (amountWrap) amountWrap.style.display  = 'none'; // se muestra solo si "se cobra" checked
        this._updateBreakdown();
      }
      if (e.target.id === 'f-late-checkout-paid') {
        const amountWrap = document.getElementById('f-lco-amount-wrap');
        if (amountWrap) amountWrap.style.display = e.target.checked ? 'flex' : 'none';
        // Precargar con ½ noche si no tiene valor
        if (e.target.checked) {
          const amtEl = document.getElementById('f-late-checkout-amount');
          if (amtEl && !amtEl.value) {
            const price = parseFloat(document.getElementById('f-price')?.value) || 0;
            amtEl.value = price > 0 ? Math.round(price * 0.5) : '';
          }
        }
        this._updateBreakdown();
      }
      if (e.target.id === 'f-late-checkout-amount') this._updateBreakdown();
    });
    document.addEventListener('input', (e) => {
      if (e.target.id === 'f-late-checkout-amount') this._updateBreakdown();
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
      this._renderPerUnitPrices();
    }
    if (prefill.checkIn || prefill.checkOut) {
      this._datePicker?.setValue(prefill.checkIn ?? null, prefill.checkOut ?? null);
      if (prefill.checkIn)  document.getElementById('f-checkin').value  = prefill.checkIn;
      if (prefill.checkOut) document.getElementById('f-checkout').value = prefill.checkOut;
      this._updateBreakdown();
    }
    // Recalcular fechas bloqueadas para la(s) unidad(es) recién precargada(s)
    // — si no se hace esto, el date-picker sigue con las fechas bloqueadas
    // de la reserva anterior (o ninguna) y puede rechazar el rango nuevo
    // por error, sin dejar re-seleccionar fechas ("Dividir estadía" Parte 2/2).
    if (prefill.unitId || prefill.checkIn || prefill.checkOut) this._updateBlockedDates();
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

    // Aclaración en notas (ej: reprogramación con nota de crédito) — el
    // equipo tiene que poder ver de un vistazo que esta reserva viene de
    // una reprogramación, sin tener que abrir el pago para saber.
    if (prefill.notes) {
      const notesEl = document.getElementById('f-notes');
      if (notesEl) {
        notesEl.value = prefill.notes;
        document.getElementById('notes-count').textContent = String(prefill.notes.length);
      }
    }

    // Nota de crédito precargada (reprogramación de una reserva cancelada) —
    // agrega directamente la fila de pago en paso 4 con método "Nota de
    // Crédito / Voucher" y el monto ya cargado.
    if (prefill.creditNote?.amount) {
      this._addPaymentRow({
        method:       'credit_note',
        amount:       prefill.creditNote.amount,
        payment_date: toISODate(new Date()),
      });
      this._updatePaymentSummary();
      // Si esta NC viene de una reprogramación inmediata, marcarla como
      // usada en la reserva de origen para que no se vuelva a ofrecer.
      if (prefill.creditNote.sourceBookingId) this._markCreditNoteUsed(prefill.creditNote.sourceBookingId);
    }

    // Precargar datos de huésped si viene desde la ficha
    if (prefill.prefillGuestId) {
      // Si ya se aplicó una NC en este mismo open() (reprogramación
      // inmediata), no volver a chequear/ofrecer NC abiertas — evita
      // duplicar la aplicación por una condición de carrera con el UPDATE
      // que la marca como usada.
      this._prefillGuestAsync(prefill.prefillGuestId, prefill.prefillGuest, !!prefill.creditNote?.amount);
    }

    document.getElementById('overlay-booking').classList.remove('hidden');

    // Historial de precios — se carga async en background
    if (prefill.unitId) this._loadPriceHistory(prefill.unitId);
  }

  // Precarga datos del huésped en los campos del formulario (step 2)
  async _prefillGuestAsync(guestId, guestData = null, skipCreditCheck = false) {
    let g = guestData;
    if (!g) {
      const { data } = await this.db.from('guests')
        .select('id, first_name, last_name, dni, phone, email, locality, age, car_model, car_plate, nationality')
        .eq('id', guestId).single();
      g = data;
    }
    if (!g) return;

    this._selectedGuestId = g.id;

    // Rellenar campos del paso 2
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    set('f-firstname', g.first_name);
    set('f-lastname',  g.last_name);
    set('f-dni',       g.dni);
    set('f-phone',     g.phone);
    set('f-email',     g.email);
    set('f-locality',  g.locality);
    set('f-age',       g.age);
    set('f-car',       g.car_model);
    set('f-plate',     g.car_plate);
    set('f-nationality', g.nationality);
    const details = document.getElementById('f-extra-details');
    if (details && (g.locality || g.age || g.car_model || g.car_plate || g.nationality)) details.open = true;

    // Ir al paso 2 directamente para que el usuario vea los datos pre-cargados
    this._goToStep(2);

    // Nota de crédito abierta de una reprogramación anterior
    if (!skipCreditCheck) this._checkOpenCreditNote(g.id).then(info => this._renderOpenCreditNoteAlert(info));
  }

  // ── Abrir para editar reserva existente ───────────
  // Abre directamente en el paso de pagos (paso 4)
  async openPayments(bookingId) {
    await this.openEdit(bookingId);
    // Esperar a que el form cargue y luego ir al paso 4
    setTimeout(() => {
      const steps = this.STEPS ?? [1,2,3,4,5];
      const payStep = 4;
      this._goToStep(payStep);
    }, 120);
  }

  // Abre en el paso de notas (paso 5 / último antes de resumen)
  async openNote(bookingId) {
    await this.openEdit(bookingId);
    setTimeout(() => {
      this._goToStep(5);
    }, 120);
  }

  async openEdit(bookingId) {
    // Guard de carrera: si esta función se vuelve a llamar antes de que esta
    // ejecución termine (doble clic, reapertura rápida), la llamada vieja se
    // aborta sola en cuanto la nueva toma el control — así nunca conviven
    // dos cargas escribiendo filas de pago sobre el mismo formulario.
    const myRequestId = ++this._editRequestSeq;

    document.getElementById('booking-modal-title').textContent = 'Editar Reserva';
    this._reset();
    // Setear editingId DESPUÉS de _reset (que lo limpia) y re-llamar
    // _goToStep(1) para que el botón muestre el texto correcto de edición.
    this._editingId = bookingId;
    this._updateNextBtnText();

    try {
      // IMPORTANTE: booking_units y payments se piden en consultas SEPARADAS.
      // Combinar dos relaciones "uno a muchos" en el mismo .select() puede hacer
      // que Postgres devuelva un producto cruzado (ej: 4 unidades × 1 pago =
      // el pago aparece 4 veces). Separarlas evita ese bug por completo.
      const [{ data: b, error }, { data: paymentsData }] = await Promise.all([
        this.db.from('bookings')
          .select('*, guests!bookings_guest_id_fkey(*), booking_units(unit_id, price_per_night)')
          .eq('id', bookingId).single(),
        this.db.from('payments').select('*').eq('booking_id', bookingId),
      ]);

      // Si mientras esperábamos la respuesta se abrió OTRA edición (más reciente),
      // esta ejecución quedó obsoleta — no tocar el DOM para no duplicar filas.
      if (myRequestId !== this._editRequestSeq) return;

      if (error) throw error;
      if (!b) { showToast('No se encontró la reserva', 'error'); return; }
      b.payments = paymentsData ?? [];
      this._editingCreatedAt = b.created_at ?? null;

      // Rellenar huésped
      const g = b.guests ?? {};
      this._selectedGuestId = g.id ?? null;
      ['firstname','lastname','dni','phone','email','locality','age','car','plate','nationality'].forEach(f => {
        const el = document.getElementById(`f-${f}`);
        const key = f === 'firstname' ? 'first_name' : f === 'lastname' ? 'last_name'
                  : f === 'car' ? 'car_model' : f === 'plate' ? 'car_plate' : f;
        if (el) el.value = g[key] ?? '';
      });
      const extraDetails = document.getElementById('f-extra-details');
      if (extraDetails && (g.locality || g.age || g.car_model || g.car_plate || g.nationality)) extraDetails.open = true;

      // Canal de origen
      const sourceContainer = document.getElementById('f-source-selector');
      if (sourceContainer) {
        sourceContainer.querySelectorAll('.src-chip').forEach(c => c.classList.remove('selected'));
        const chip = sourceContainer.querySelector(`.src-chip[data-source="${b.source ?? 'direct'}"]`);
        if (chip) { chip.classList.add('selected'); chip.querySelector('input').checked = true; }
      }

      // Unidades
      this._selectedUnitIds = new Set((b.booking_units ?? []).map(bu => String(bu.unit_id)));
      this._unitPrices = {};
      (b.booking_units ?? []).forEach(bu => {
        if (bu.price_per_night != null) this._unitPrices[String(bu.unit_id)] = bu.price_per_night;
      });
      // Reserva vieja con 2+ unidades pero sin precio individual guardado:
      // sugerir como punto de partida el precio total repartido en partes iguales
      if (this._selectedUnitIds.size >= 2 && Object.keys(this._unitPrices).length === 0) {
        const perUnitGuess = Math.round((b.price_per_night ?? 0) / this._selectedUnitIds.size) || '';
        this._selectedUnitIds.forEach(uid => { this._unitPrices[uid] = perUnitGuess; });
      }
      this._renderUnitSelector();
      this._renderPerUnitPrices();

      // Fechas
      if (this._datePicker && b.check_in && b.check_out) {
        this._datePicker.setValue(b.check_in, b.check_out);
      }
      if (b.check_in)  document.getElementById('f-checkin').value  = b.check_in;
      if (b.check_out) document.getElementById('f-checkout').value = b.check_out;

      const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
      setVal('f-price',       b.price_per_night ?? '');
      setVal('f-discount',    b.discount_pct    ?? 0);
      // Siempre restaurar en modo % al editar (el valor guardado es siempre %)
      if (document.getElementById('f-discount-mode')) {
        document.getElementById('f-discount-mode').value = 'pct';
        document.getElementById('disc-prefix') && (document.getElementById('disc-prefix').textContent = '%');
      }
      setVal('f-surcharge',   b.surcharge_amount ?? 0);
      // Siempre restaurar en modo $ al editar (el valor guardado en DB es siempre $)
      if (document.getElementById('f-surcharge-mode')) {
        document.getElementById('f-surcharge-mode').value = 'amt';
        document.getElementById('surch-prefix') && (document.getElementById('surch-prefix').textContent = '$');
      }
      setVal('f-free-nights', b.free_nights     ?? 0);
      const lateCbEl = document.getElementById('f-late-checkout');
      if (lateCbEl) {
        lateCbEl.checked = b.late_checkout ?? false;
        const paidWrap   = document.getElementById('f-lco-paid-wrap');
        const amountWrap = document.getElementById('f-lco-amount-wrap');
        if (paidWrap)   paidWrap.style.display   = lateCbEl.checked ? 'flex' : 'none';
        // Determinar si se cobró: total > noches × precio
        const expectedBase = (b.nights ?? 0) * (b.price_per_night ?? 0);
        const extraAmt = b.late_checkout ? Math.max(0, (b.total_amount ?? 0) - expectedBase) : 0;
        const paidCbEl = document.getElementById('f-late-checkout-paid');
        if (paidCbEl && b.late_checkout) {
          paidCbEl.checked = b.late_checkout_charged ?? true;
          if (amountWrap) amountWrap.style.display = paidCbEl.checked ? 'flex' : 'none';
          const amtEl = document.getElementById('f-late-checkout-amount');
          if (amtEl && extraAmt > 0) amtEl.value = extraAmt;
        }
      }
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

      this._updateNextBtnText();
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
    const discAmt       = Math.round(subtotal * (discPct / 100));
    const total         = booking.total_amount ?? Math.max(0, subtotal - discAmt + surcharge);
    const paymentRows   = (booking.payments ?? []).filter(p => Number(p.amount) !== 0);
    const totalPaid     = paymentRows.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const balance       = Math.max(0, total - totalPaid);

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
          ${discPct > 0 ? `<div class="detail-breakdown-row" style="color:var(--color-success)"><span>Descuento ${fmtPct(discPct)}%</span><span>−${formatARS(discAmt)}</span></div>` : ''}
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

    if (paymentRows.length) {
      const payHtml = paymentRows
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

  close(force = false) {
    if (!force && this._isDirty()) {
      if (!confirm('¿Salir sin guardar? Se perderán los datos ingresados.')) return;
    }
    document.getElementById('overlay-booking').classList.add('hidden');
    this._reset();
  }

  _isDirty() {
    if (this._editingId) return false;
    const vals = ['f-firstname','f-lastname','f-checkin','f-checkout','f-price']
      .map(id => document.getElementById(id)?.value?.trim() ?? '');
    return vals.some(v => v.length > 0) || !!this._selectedGuestId || (this._selectedUnitIds?.size > 0);
  }

  // ── Reset completo del form ───────────────────────
  _reset() {
    this._currentStep     = 1;
    this._editingId       = null;
    this._selectedGuestId = null;
    this._selectedUnitIds = new Set();
    this._unitPrices      = {};
    this._editingCreatedAt = null;
    this._payRowCount     = 0;
    this._cachedTotal     = 0;
    this._submitting      = false;
    this._removedPaymentIds = []; // pagos existentes que el usuario eliminó del form
    this._pendingSplitStay = null; // "Dividir estadía" — se cancela si no se llega a guardar

    // Volver al modo de precio único (single unit) por defecto
    const singleWrap = document.getElementById('f-price-single-wrap');
    const multiWrap  = document.getElementById('f-price-multi-wrap');
    if (singleWrap) { singleWrap.classList.remove('hidden'); singleWrap.style.display = ''; }
    if (multiWrap)  { multiWrap.classList.add('hidden');     multiWrap.style.display  = 'none'; }

    ['f-firstname','f-lastname','f-dni','f-phone','f-email','f-notes',
     'f-locality','f-age','f-car','f-plate','f-nationality',
     'f-price','f-discount','f-surcharge','f-free-nights','f-deposit',
     'f-checkin','f-checkout'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = ['f-discount','f-surcharge','f-free-nights','f-deposit'].includes(id) ? '0' : '';
    });
    const extraDetailsReset = document.getElementById('f-extra-details');
    if (extraDetailsReset) extraDetailsReset.open = false;

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
          this._renderUnitAvailability();
        }
      });
    }

    this._renderUnitSelector();
    this._renderUnitAvailability();
    this._updateBreakdown();
    this._goToStep(1);
  }

  // ── Disponibilidad por unidad, con sugerencia de rango parcial ──
  // Si al huésped le pide 5 noches y una unidad solo tiene 3 libres dentro
  // de ese rango, no se oculta la unidad: se muestra igual con un tag
  // informativo "3/5 noches" + el sub-rango exacto que sí está libre.
  // Reutiliza la misma lógica de mila-data.js (fetchDisponibilidad).
  async _renderUnitAvailability() {
    const container = document.getElementById('units-selector');
    if (!container) return;
    const ci = document.getElementById('f-checkin')?.value;
    const co = document.getElementById('f-checkout')?.value;
    // Sin rango de fechas válido todavía: no hay nada que anotar.
    if (!ci || !co || ci >= co) {
      container.querySelectorAll('.unit-avail-tag').forEach(el => el.remove());
      return;
    }

    const myRequestId = ++this._availRequestSeq || (this._availRequestSeq = 1);
    let list;
    try {
      list = await fetchDisponibilidad(ci, co);
    } catch { return; }
    if (myRequestId !== this._availRequestSeq) return; // llegó una respuesta vieja, descartar

    const byId = new Map(list.map(u => [String(u.id), u]));
    container.querySelectorAll('.unit-option[data-unit-id]').forEach(chip => {
      chip.querySelectorAll('.unit-avail-tag').forEach(el => el.remove());
      const info = byId.get(String(chip.dataset.unitId));
      if (!info) return;
      // Si la unidad está seleccionada, no hace falta mostrarle "disponible" —
      // ya la eligió. Solo avisamos si está ocupada o parcialmente libre,
      // que es la información accionable.
      const isSelected = chip.classList.contains('selected');
      let tagHTML = '';
      if (!info.available && !info.partial) {
        tagHTML = `<span class="unit-avail-tag unit-avail-busy">Ocupado</span>` +
          `<button type="button" class="unit-waitlist-link" data-unit-id="${chip.dataset.unitId}" title="Guardar este pedido en la lista de espera">+ Lista de espera</button>`;
      } else if (info.partial) {
        const fmtD = (s) => { const [y,m,d] = s.split('-'); return `${d}/${m}`; };
        tagHTML = `<span class="unit-avail-tag unit-avail-partial" title="Libre del ${fmtD(info.partial.from)} al ${fmtD(info.partial.to)}">${info.partial.nights}/${info.partial.ofNights} noches</span>`;
        // Buscar con qué otra unidad se podría completar el pedido —
        // "Dividir estadía": esta unidad cubre una parte, otra cubre el resto.
        this._suggestSplitStay(chip, ci, co, info.partial);
      } else if (info.available && !isSelected) {
        tagHTML = `<span class="unit-avail-tag unit-avail-free">Disponible</span>`;
      }
      const row2 = chip.querySelector('.unit-option-row2');
      if (tagHTML && row2) row2.insertAdjacentHTML('beforeend', tagHTML);
      row2?.querySelector('.unit-waitlist-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
        window.milaNav?.('waitlist');
        setTimeout(() => window._waitlistPanel?._openForm({ checkIn: ci, checkOut: co, unitId: e.currentTarget.dataset.unitId }), 150);
      });
    });
  }

  // ── Dividir estadía ────────────────────────────────
  // Si la unidad "A" solo cubre una parte del pedido (ej: pediste 5 noches,
  // tiene 3 libres), busca si OTRA unidad cubre las noches que faltan. Si
  // encuentra una, muestra un texto informativo — no arma nada solo, porque
  // hoy una reserva no soporta fechas distintas por unidad; el usuario
  // tendría que cargar 2 reservas separadas (una por unidad).
  async _suggestSplitStay(chip, ci, co, partial) {
    const missing = partial.from === ci
      ? { from: partial.to, to: co }
      : partial.to === co
        ? { from: ci, to: partial.from }
        : null; // hueco en el medio — caso raro, no lo resolvemos automático
    if (!missing || missing.from >= missing.to) return;

    const myRequestId = this._availRequestSeq;
    let missList;
    try { missList = await fetchDisponibilidad(missing.from, missing.to); } catch { return; }
    if (myRequestId !== this._availRequestSeq) return; // respuesta vieja, descartar

    const thisUnitId = String(chip.dataset.unitId);
    const candidates = missList.filter(u => String(u.id) !== thisUnitId && u.available);
    if (!candidates.length) return;

    const row2b = chip.querySelector('.unit-option-row2');
    if (!row2b || row2b.querySelector('.unit-split-hint, .unit-split-select')) return;

    // Solo el ícono al principio — el texto completo (nombre de la otra
    // unidad, fechas) va en el título/confirm, no compite por espacio en
    // la fila y evita el problema de contraste/legibilidad que tenía antes.
    const label = (c) => c.sort_order ? `#${c.sort_order} · ${c.name}` : c.name;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'unit-split-hint';
    btn.textContent = '🔀';
    btn.title = candidates.length === 1
      ? `Combinar con ${label(candidates[0])} para completar el pedido`
      : `${candidates.length} unidades pueden completar el pedido — tocá para elegir`;
    row2b.appendChild(btn);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (candidates.length === 1) {
        this._startSplitStay(chip.dataset.unitId, partial, candidates[0].id, label(candidates[0]), missing);
        return;
      }
      // Varias opciones — menú propio (no un <select> nativo, que queda
      // apretado y se renderiza mal en una fila angosta).
      document.querySelector('.unit-split-menu')?.remove();
      const menu = document.createElement('div');
      menu.className = 'unit-split-menu';
      menu.innerHTML = candidates.map(c => `
        <button type="button" data-id="${c.id}" data-name="${label(c)}">
          <span class="unit-split-dot" style="background:${c.color ?? '#6366f1'}"></span>${label(c)}
        </button>`).join('');
      chip.style.position = 'relative';
      chip.appendChild(menu);
      const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu); };
      menu.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const optBtn = ev.target.closest('button[data-id]');
        if (!optBtn) return;
        closeMenu();
        this._startSplitStay(chip.dataset.unitId, partial, optBtn.dataset.id, optBtn.dataset.name, missing);
      });
      setTimeout(() => document.addEventListener('click', closeMenu), 0);
    });
  }

  // Arma "Parte 1/2": deja esta reserva con solo la unidad A y el sub-rango
  // que sí cubre, guarda los datos de la Parte 2 pendiente (unidad B +
  // fechas restantes), para abrirla automáticamente apenas se guarde esta.
  _startSplitStay(unitAId, partial, unitBId, unitBName, missing) {
    const unitA = this.ctx?.units?.find(u => String(u.id) === String(unitAId));
    const unitAName = unitA ? (unitA.sort_order ? `#${unitA.sort_order} · ${unitA.name}` : unitA.name) : 'esta unidad';
    if (!confirm(`Dividir estadía:\n\n• Esta reserva → ${unitAName}, del ${partial.from} al ${partial.to}\n• Después de guardar, se abre automáticamente una 2ª reserva → ${unitBName}, del ${missing.from} al ${missing.to}\n\n¿Continuar?`)) return;

    // Dejar seleccionada SOLO la unidad A
    this._selectedUnitIds = new Set([String(unitAId)]);
    this._renderUnitSelector();
    this._renderPerUnitPrices();

    // Acotar las fechas al sub-rango que la unidad A sí cubre
    this._datePicker?.setValue(partial.from, partial.to);
    document.getElementById('f-checkin').value  = partial.from;
    document.getElementById('f-checkout').value = partial.to;
    this._updateBreakdown();
    this._updateBlockedDates();

    // Marcar en notas que esto es la Parte 1/2
    const notesEl = document.getElementById('f-notes');
    if (notesEl && !notesEl.value.includes('🔗 Parte 1/2')) {
      notesEl.value = appendNote(notesEl.value, `🔗 Parte 1/2 — estadía dividida con ${unitBName} del ${missing.from} al ${missing.to}`);
      document.getElementById('notes-count').textContent = String(notesEl.value.length);
    }

    this._pendingSplitStay = { unitBId, unitBName, unitAName, from: missing.from, to: missing.to };
    showToast(`Reserva 1/2 lista (${unitAName}) — al guardar se abre la 2ª (${unitBName})`, 'info');
  }


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
          <div class="unit-option-row1">
            <span style="width:12px;height:12px;border-radius:50%;
              background:${color};flex-shrink:0;display:inline-block"></span>
            <span class="unit-option-name">${u.name}</span>
            <input type="checkbox" ${selected ? 'checked' : ''} style="accent-color:${color};margin-left:auto">
          </div>
          <div class="unit-option-row2">
            ${u.max_guests ? `<span class="unit-option-detail">hasta ${u.max_guests} huéspedes</span>` : ''}
          </div>
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
        this._renderPerUnitPrices();
        this._triggerPriceSuggestion();
        this._renderUnitAvailability();
        // Update pax cap when unit changes
        this._updatePaxCap?.();
      });
    });

    // Render pax selector si hay contenedor
    this._renderPaxSelector();
  }

  // ── Precio por unidad — visible solo con 2+ departamentos seleccionados ──
  // El campo único "f-price" se mantiene como fuente de verdad para toda la
  // lógica existente (breakdown, validación, total): cuando hay 2+ unidades,
  // este método ESCRIBE la suma de los precios individuales dentro de f-price,
  // de modo que el resto del formulario sigue funcionando exactamente igual.
  _renderPerUnitPrices() {
    const singleWrap = document.getElementById('f-price-single-wrap');
    const multiWrap  = document.getElementById('f-price-multi-wrap');
    const rowsWrap   = document.getElementById('per-unit-price-rows');
    if (!singleWrap || !multiWrap || !rowsWrap) return;

    const unitIds = [...this._selectedUnitIds];

    if (unitIds.length < 2) {
      singleWrap.classList.remove('hidden');
      singleWrap.style.display = '';
      multiWrap.classList.add('hidden');
      multiWrap.style.display  = 'none';
      return;
    }

    singleWrap.classList.add('hidden');
    singleWrap.style.display = 'none';
    multiWrap.classList.remove('hidden');
    multiWrap.style.display  = '';

    const priceField   = document.getElementById('f-price');
    const currentTotal = parseFloat(priceField?.value) || 0;

    // Pre-cargar precio sugerido para unidades nuevas que todavía no tienen valor propio
    unitIds.forEach(uid => {
      if (this._unitPrices[uid] == null || this._unitPrices[uid] === '') {
        this._unitPrices[uid] = currentTotal > 0 ? currentTotal : '';
      }
    });
    // Limpiar precios de unidades que ya no están seleccionadas
    Object.keys(this._unitPrices).forEach(uid => {
      if (!this._selectedUnitIds.has(uid)) delete this._unitPrices[uid];
    });

    rowsWrap.style.display = 'grid';
    rowsWrap.style.gridTemplateColumns = 'repeat(2, 1fr)';
    rowsWrap.style.gap = '10px 12px';

    rowsWrap.innerHTML = unitIds.map(uid => {
      const u     = this.ctx.units.find(x => String(x.id) === String(uid));
      const name  = u?.name  ?? 'Unidad';
      const color = u?.color ?? '#6366f1';
      const val   = this._unitPrices[uid] ?? '';
      return `
        <div class="per-unit-price-row" data-unit-id="${uid}"
             style="display:flex;flex-direction:column;gap:5px;padding:8px 10px;
                    border:1px solid rgba(255,255,255,.1);border-radius:8px;
                    background:rgba(255,255,255,.03);min-width:0">
          <div style="display:flex;align-items:center;gap:6px;min-width:0">
            <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
            <span style="font-size:.78rem;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">${name}</span>
          </div>
          <input type="number" class="per-unit-price-input" min="0" step="500" placeholder="45000"
                 style="width:100%" value="${val}">
        </div>`;
    }).join('');

    rowsWrap.querySelectorAll('.per-unit-price-input').forEach(input => {
      input.addEventListener('input', () => {
        const row = input.closest('.per-unit-price-row');
        const uid = row?.dataset.unitId;
        if (!uid) return;
        this._unitPrices[uid] = parseFloat(input.value) || 0;
        this._recalcUnitPriceSum();
      });
    });

    this._recalcUnitPriceSum();
  }

  // ── Escribe la suma de precios por unidad en f-price (fuente de verdad) ──
  _recalcUnitPriceSum() {
    const priceField = document.getElementById('f-price');
    if (!priceField) return;
    const sum = Object.values(this._unitPrices).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    priceField.value = sum || '';
    this._updateBreakdown();
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

  // Precio sugerido tomado directo del Cuadro Tarifario (Configuración):
  // mes de la fecha de check-in × unidad seleccionada. Si hay varias
  // unidades, suma el precio de cada una. Ignora columnas especiales
  // (son por paquete de días, no por noche) — siempre usa el precio
  // mensual "de fondo" del depto.
  async _getTariffSuggestedPrice(unitIds, checkIn) {
    if (!unitIds?.length || !checkIn) return null;
    try {
      const { fetchMonthlyRates } = await import('../services/tariff-service.js');
      const [y, mo] = checkIn.split('-').map(Number);
      const rates = await fetchMonthlyRates(this.db, this.ctx.hotelId, [{ year: y, month: mo }]);
      let total = 0, found = 0;
      let promoActive = false, promoPay = null, promoFree = null;
      unitIds.forEach(uid => {
        const r = rates.find(x => String(x.unit_id) === String(uid) && x.year === y && x.month === mo);
        if (r?.price_per_night) { total += r.price_per_night; found++; }
        // Si cualquiera de las unidades seleccionadas tiene la promo activa
        // ese mes, la avisamos (no la sumamos al precio: son noches gratis,
        // no un ajuste de tarifa por noche).
        if (r?.promo_active) {
          promoActive = true;
          promoPay  = r.promo_pay  ?? promoPay;
          promoFree = r.promo_free ?? promoFree;
        }
      });
      if (!found) return null;
      return { price: total, promoActive, promoPay, promoFree };
    } catch { return null; }
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

    // Sugerencia rápida desde el Cuadro Tarifario (mes + depto)
    let tariffHTML = '';
    const tariff = await this._getTariffSuggestedPrice(unitIds, ci);
    if (tariff?.price) {
      // Auto-aplicar el precio tarifario si el campo está vacío o en 0
      // (solo en reservas nuevas, no al editar)
      const priceEl = document.getElementById('f-price');
      const currentPrice = parseFloat(priceEl?.value) || 0;
      if (!this._editingId && currentPrice === 0 && priceEl) {
        priceEl.value = Math.round(tariff.price);
        this._updateBreakdown();
      }
      const promoNote = tariff.promoActive
        ? `<div class="ps-promo-note" style="margin-top:6px;font-size:12.5px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:6px 8px">
             🎁 Promo activa este mes: paga ${tariff.promoPay ?? '?'} noches, ${tariff.promoFree ?? '?'} gratis. El precio de arriba es por noche y no la incluye — recordá aplicarla al calcular el total.
           </div>`
        : '';
      tariffHTML = `
        <div class="ps-box" style="margin-bottom:8px">
          <div class="ps-head">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span class="ps-badge">🏷️ Cuadro Tarifario</span>
              ${tariff.promoActive ? '<span class="ps-badge" style="background:#fde68a;color:#92400e">2+1 activa</span>' : ''}
            </div>
            <button class="ps-use" data-price="${tariff.price}">Usar este precio</button>
          </div>
          <div class="ps-main">
            <span class="ps-price">$${Math.round(tariff.price).toLocaleString('es-AR')}</span>
            <span class="ps-night">/noche</span>
          </div>
          ${promoNote}
        </div>`;
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
        container.innerHTML = tariffHTML;
        this._bindPriceSuggestionButtons(container);
        return;
      }
    }
    if (!this._priceSuggester) { container.innerHTML = tariffHTML; this._bindPriceSuggestionButtons(container); return; }

    container.innerHTML = tariffHTML + '<div class="ps-loading">⟳ Analizando historial...</div>';

    try {
      const currentPrice = parseFloat(document.getElementById('f-price')?.value) || 0;
      const result = await this._priceSuggester.suggest(unitIds, ci, co);
      container.innerHTML = tariffHTML + this._PriceSuggesterClass.renderPanel(result, currentPrice);
      this._bindPriceSuggestionButtons(container);
    } catch (err) {
      container.innerHTML = tariffHTML;
      this._bindPriceSuggestionButtons(container);
    }
  }

  _bindPriceSuggestionButtons(container) {
    container.querySelectorAll('.ps-use').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const price = parseFloat(e.target.dataset.price);
        if (!price) return;
        const priceEl = document.getElementById('f-price');
        if (priceEl) {
          priceEl.value = price;
          priceEl.dispatchEvent(new Event('input'));
          priceEl.style.borderColor = '#22c55e';
          priceEl.style.boxShadow = '0 0 0 2px #22c55e28';
          setTimeout(() => { priceEl.style.borderColor=''; priceEl.style.boxShadow=''; }, 1800);
        }
        showToast('Precio sugerido aplicado ✓', 'success');
      });
    });
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

    const backBtn  = document.getElementById('btn-step-back');
    const footer   = document.querySelector('.modal-footer');

    // En paso 5 (voucher): ocultar footer normal, mostrar acciones del voucher
    const onVoucher = step === 5;
    if (footer) footer.style.display = onVoucher ? 'none' : '';
    if (backBtn) backBtn.style.visibility = (step > 1 && !onVoucher) ? 'visible' : 'hidden';

    this._updateNextBtnText();

    if (step === 4) this._updatePaymentSummary();
    if (step === 5) this._renderVoucher();
  }

  // ── Texto del botón "next" según contexto ─────────
  _updateNextBtnText() {
    const btn = document.getElementById('btn-step-next');
    if (!btn) return;
    const step = this._currentStep;
    if (this._editingId) {
      btn.textContent = step >= 4 ? 'Guardar cambios ✓' : 'Continuar →';
    } else {
      btn.textContent = step === 4 ? 'Ver Resumen →' : 'Continuar →';
    }
  }

  // Continuar → siguiente paso O guardar
  _nextStep() {
    if (this._currentStep === 4) {
      if (!this._validateAll()) return;
      if (this._editingId) {
        // Modo edición: guardar directamente sin pasar por voucher
        this._submit();
        return;
      }
    }
    if (this._currentStep < this._totalSteps) {
      this._goToStep(this._currentStep + 1);
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
    if (this._selectedUnitIds.size >= 2) {
      const missing = [...this._selectedUnitIds].some(uid => !this._unitPrices[uid] || parseFloat(this._unitPrices[uid]) <= 0);
      if (missing) {
        const rowsEl = document.getElementById('per-unit-price-rows');
        if (rowsEl) rowsEl.classList.add('field-error');
        if (!firstStep || 3 < firstStep.step) firstStep = { step: 3, msg: 'Ingresá el precio de cada departamento' };
      }
    }

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
    const freeN_pre = parseInt(document.getElementById('f-free-nights').value) || 0;
    const nights_pre = (ci && co) ? Math.max(0, Math.round((new Date(co)-new Date(ci))/86400000)) : 0;
    const _subtotalForDisc = price * Math.max(0, nights_pre - freeN_pre);
    const _discMode0 = document.getElementById('f-discount-mode')?.value ?? 'pct';
    const _discRaw0  = parseFloat(document.getElementById('f-discount').value) || 0;
    const disc  = _discMode0 === 'amt'
      ? (_subtotalForDisc > 0 ? Math.min(100, _discRaw0 / _subtotalForDisc * 100) : 0)
      : _discRaw0;
    const _sModeA = document.getElementById('f-surcharge-mode')?.value ?? 'amt';
    const _sRawA  = parseFloat(document.getElementById('f-surcharge').value) || 0;
    const surch   = _sModeA === 'pct' ? Math.round(subtotal * _sRawA / 100) : _sRawA;
    const freeN = parseInt(document.getElementById('f-free-nights').value) || 0;
    const lateCheckout     = document.getElementById('f-late-checkout')?.checked ?? false;
    const lateCheckoutPaid = lateCheckout && (document.getElementById('f-late-checkout-paid')?.checked ?? true);
    const lateAmtCustom    = parseFloat(document.getElementById('f-late-checkout-amount')?.value) || (price * 0.5);

    if (!ci || !co || !price) {
      ['pb-nights','pb-subtotal','pb-discount','pb-surcharge','pb-total','pb-free-nights','pb-late-checkout']
        .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
      return;
    }

    const nights       = Math.round((new Date(co) - new Date(ci)) / 86400000);
    const billable     = Math.max(0, nights - freeN);
    const subtotal     = price * billable;
    const discAmt      = Math.round(subtotal * (disc / 100));
    const lateAmt      = lateCheckoutPaid ? lateAmtCustom : 0;
    const total        = Math.max(0, subtotal - discAmt + Math.round(surch) + lateAmt);

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('pb-nights',       `${nights} noche${nights !== 1 ? 's' : ''}${lateCheckout ? ' + ½' : ''}`);
    set('pb-subtotal',     formatARS(subtotal));
    set('pb-free-nights',  freeN > 0 ? `−${formatARS(price * freeN)}` : '—');
    set('pb-discount',     disc > 0 ? `−${formatARS(discAmt)} (${fmtPct(disc)}%)` : '—');
    set('pb-surcharge',    surch > 0 ? `+${formatARS(surch)}` : '—');
    set('pb-late-checkout', lateCheckoutPaid ? `+${formatARS(lateAmt)}` : lateCheckout ? 'Sin cargo' : '—');
    set('pb-total',        formatARS(total));

    document.getElementById('pbr-free-nights')?.style.setProperty('display', freeN > 0 ? '' : 'none');
    document.getElementById('pbr-discount')?.style.setProperty('display',    disc > 0 ? '' : 'none');
    document.getElementById('pbr-surcharge')?.style.setProperty('display',   surch > 0 ? '' : 'none');
    document.getElementById('pbr-late-checkout')?.style.setProperty('display', lateCheckout ? '' : 'none');

    this._cachedTotal = total;
    this._updatePaymentSummary();
  }

  // ── Manejo de pagos ───────────────────────────────
  _addPaymentRow(existing = null) {
    const rowId  = `pay-row-${++this._payRowCount}`;
    const today  = toISODate(new Date());
    const isFx   = existing?.currency === 'USD';
    const rate   = existing?.exchange_rate ?? '';
    const row    = document.createElement('div');
    row.className = 'payment-row';
    row.id = rowId;
    // CRÍTICO: guardar el ID del pago existente para distinguir UPDATE de INSERT al guardar
    row.dataset.paymentId = existing?.id ?? '';
    row.dataset.unitId    = existing?.unit_id ?? ''; // '' = General (toda la reserva)

    // Selector de unidad — solo si la reserva tiene 2+ departamentos
    const unitIds = [...this._selectedUnitIds];
    const showUnitSelector = unitIds.length >= 2;
    const unitChipsHtml = showUnitSelector ? `
      <div class="pay-unit-selector" style="display:flex;gap:5px;flex-wrap:wrap;margin-top:7px">
        <button type="button" class="pay-unit-chip ${!existing?.unit_id ? 'active' : ''}" data-unit-id=""
          style="font-size:.68rem;padding:3px 9px;border-radius:999px;cursor:pointer;border:1px solid var(--color-border);background:var(--color-surface-2);color:var(--color-text-2)">
          General
        </button>
        ${unitIds.map(uid => {
          const u = this.ctx.units.find(x => String(x.id) === String(uid));
          const isActive = String(existing?.unit_id ?? '') === String(uid);
          return `<button type="button" class="pay-unit-chip ${isActive ? 'active' : ''}" data-unit-id="${uid}"
            style="font-size:.68rem;padding:3px 9px;border-radius:999px;cursor:pointer;border:1px solid ${u?.color ?? 'var(--color-border)'};background:${isActive ? (u?.color ?? 'var(--color-primary)') : 'var(--color-surface-2)'};color:${isActive ? '#fff' : 'var(--color-text-2)'}">
            ${u?.name ?? ('#' + uid)}
          </button>`;
        }).join('')}
      </div>` : '';

    row.innerHTML = `
      <div class="pay-grid">
        <select class="pay-method form-control">
          ${PAYMENT_METHODS.map(m =>
            `<option value="${m.value}" ${existing?.method === m.value ? 'selected' : ''}>${m.label}</option>`
          ).join('')}
        </select>
        <div class="pay-currency-toggle" title="Cambiar moneda">
          <button type="button" class="pay-cur-btn ${!isFx ? 'active' : ''}" data-cur="ARS">$ARS</button>
          <button type="button" class="pay-cur-btn ${isFx ? 'active' : ''}"  data-cur="USD">USD</button>
        </div>
        <input type="number" class="pay-amount form-control" placeholder="Monto" min="0" step="100"
               value="${existing?.amount ?? ''}">
        <div class="pay-usd-rate ${!isFx ? 'hidden' : ''}">
          <span style="font-size:.7rem;color:var(--color-text-3)">Cotiz.</span>
          <input type="number" class="pay-rate form-control" placeholder="1480" min="0" step="1"
                 value="${rate}" style="width:80px">
          <span class="pay-ars-equiv" style="font-size:.72rem;color:var(--color-text-2)"></span>
        </div>
        <input type="date" class="pay-date form-control" value="${existing?.payment_date ?? today}">
        <button class="btn btn-icon btn-danger-icon pay-remove" title="Eliminar">×</button>
      </div>
      ${unitChipsHtml}
      <div class="credit-surcharge-info" style="display:none;font-size:.75rem;color:var(--color-warning);margin-top:4px">
        +10% recargo tarjeta: <span id="${rowId}-cc-surcharge">$0</span>
      </div>`;

    // Selector de unidad: clic en un chip
    row.querySelectorAll('.pay-unit-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const uid = chip.dataset.unitId;
        row.dataset.unitId = uid;
        row.querySelectorAll('.pay-unit-chip').forEach(c => {
          const active = c === chip;
          const u = this.ctx.units.find(x => String(x.id) === String(c.dataset.unitId));
          c.classList.toggle('active', active);
          c.style.background = active ? (c.dataset.unitId ? (u?.color ?? 'var(--color-primary)') : 'var(--color-primary)') : 'var(--color-surface-2)';
          c.style.color      = active ? '#fff' : 'var(--color-text-2)';
        });
        this._updatePaymentSummary();
      });
    });

    // Currency toggle
    row.querySelectorAll('.pay-cur-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cur = btn.dataset.cur;
        row.querySelectorAll('.pay-cur-btn').forEach(b => b.classList.toggle('active', b.dataset.cur === cur));
        row.querySelector('.pay-usd-rate').classList.toggle('hidden', cur !== 'USD');
        row.dataset.currency = cur;
        // Sugerir cotización (promedio 5 días + margen configurado) solo si
        // el usuario todavía no cargó una a mano en esta fila.
        const rateInput = row.querySelector('.pay-rate');
        if (cur === 'USD' && rateInput && !rateInput.value) {
          const marginPct = parseFloat(AppContext.config?.usd_margin_pct ?? 0) || 0;
          const conv = await getUsdConversionRate(this.db, this.ctx.hotelId, marginPct, 5);
          if (conv.margined) { rateInput.value = conv.margined; rateInput.placeholder = `${conv.margined} (sugerido)`; }
        }
        this._updateUsdEquiv(row);
        this._updatePaymentSummary();
      });
    });
    row.dataset.currency = isFx ? 'USD' : 'ARS';

    // Rate input → recalculate equiv
    row.querySelector('.pay-rate').addEventListener('input', () => this._updateUsdEquiv(row));

    row.querySelector('.pay-remove').addEventListener('click', () => {
      // Si el pago ya existía en la DB, marcarlo para eliminar al guardar
      if (row.dataset.paymentId) {
        this._removedPaymentIds = this._removedPaymentIds ?? [];
        this._removedPaymentIds.push(row.dataset.paymentId);
      }
      row.remove(); this._updatePaymentSummary();
    });
    row.querySelector('.pay-method').addEventListener('change', () => {
      this._updateCreditSurcharge(row); this._updatePaymentSummary();
    });
    row.querySelector('.pay-amount').addEventListener('input', () => {
      this._updateCreditSurcharge(row); this._updateUsdEquiv(row); this._updatePaymentSummary();
    });

    document.getElementById('payments-container').appendChild(row);
    if (existing) { this._updateCreditSurcharge(row); this._updateUsdEquiv(row); }
  }

  _updateUsdEquiv(row) {
    const cur    = row.dataset.currency;
    const equiv  = row.querySelector('.pay-ars-equiv');
    if (!equiv || cur !== 'USD') return;
    const usd    = parseFloat(row.querySelector('.pay-amount')?.value) || 0;
    const rate   = parseFloat(row.querySelector('.pay-rate')?.value)   || 0;
    if (usd && rate) {
      equiv.textContent = `= ${formatARS(usd * rate)}`;
    } else {
      equiv.textContent = rate ? `× ${formatARS(rate)}` : '';
    }
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
      const rawAmt = parseFloat(row.querySelector('.pay-amount')?.value) || 0;
      const cur    = row.dataset?.currency ?? 'ARS';
      const rate   = parseFloat(row.querySelector('.pay-rate')?.value) || 1;
      const amt    = cur === 'USD' ? rawAmt * rate : rawAmt;
      const isCc   = row.querySelector('.pay-method')?.value === 'credit_card';
      total += isCc ? amt * 1.10 : amt;
    });
    return total;
  }

  _updatePaymentSummary() {
    const total   = Math.round(this._cachedTotal ?? 0);
    const paid    = Math.round(this._getTotalPaid());
    const balance = total - paid;
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('ps-total',   formatARS(total));
    set('ps-paid',    formatARS(paid));
    set('ps-balance', formatARS(Math.max(0, balance)));
  }

  // ── Notas de crédito abiertas (reprogramaciones sin fecha nueva aún) ──
  // Busca reservas canceladas de este huésped con el tag 🔄NC:<monto> en
  // notas que todavía no se marcaron como usadas (✅NCUSED).
  async _checkOpenCreditNote(guestId) {
    if (!guestId) return null;
    try {
      const { data } = await this.db.from('bookings')
        .select('id, notes, check_in, check_out')
        .eq('guest_id', guestId)
        .eq('status', 'cancelled')
        .like('notes', '%🔄NC:%')
        .order('created_at', { ascending: false });
      const open = (data ?? []).find(b => !b.notes?.includes('✅NCUSED') && !b.notes?.includes('❌NCVOID'));
      if (!open) return null;
      const m = open.notes.match(/🔄NC:(\d+):(\d{4}-\d{2}-\d{2})/);
      if (!m) return null;
      return { bookingId: open.id, amount: parseInt(m[1], 10), dates: `${open.check_in} → ${open.check_out}` };
    } catch { return null; }
  }

  _renderOpenCreditNoteAlert(info) {
    const container = document.getElementById('bad-exp-booking-alert-container');
    if (!container || !info) return;
    document.getElementById('nc-open-alert')?.remove();
    container.insertAdjacentHTML('beforeend', `
      <div class="alert alert-info" id="nc-open-alert" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <span>🔄 <strong>Nota de crédito abierta</strong> por ${formatARS(info.amount)} (reserva ${info.dates} reprogramada).</span>
        <button type="button" class="btn btn-primary btn-sm" id="nc-open-apply-btn">Aplicar a esta reserva</button>
      </div>`);
    document.getElementById('nc-open-apply-btn')?.addEventListener('click', () => this._applyOpenCreditNote(info));
  }

  async _applyOpenCreditNote(info) {
    this._addPaymentRow({ method: 'credit_note', amount: info.amount, payment_date: toISODate(new Date()) });
    this._updatePaymentSummary();
    await this._markCreditNoteUsed(info.bookingId);
    document.getElementById('nc-open-alert')?.remove();
    showToast('Nota de crédito aplicada ✓', 'success');
  }

  async _markCreditNoteUsed(sourceBookingId) {
    try {
      const { data: orig } = await this.db.from('bookings').select('notes').eq('id', sourceBookingId).single();
      if (!orig || orig.notes?.includes('✅NCUSED')) return;
      await this.db.from('bookings')
        .update({ notes: appendNote(orig.notes, '✅NCUSED') })
        .eq('id', sourceBookingId);
    } catch (_) { /* no crítico */ }
  }

  // ── Búsqueda de huéspedes ─────────────────────────
  async _searchGuests(q) {
    const container = document.getElementById('guest-results');
    if (!container) return;
    if (q.length < 2) { container.classList.add('hidden'); return; }

    const { data } = await this.db
      .from('guests')
      .select('id, first_name, last_name, dni, phone, email, bad_experience, tags, locality, age, car_model, car_plate, nationality')
      .eq('hotel_id', this.ctx.hotelId)
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,dni.ilike.%${q}%`)
      .limit(6);

    if (!data?.length) { container.classList.add('hidden'); return; }

    container.innerHTML = data.map(g => {
      const isBad = g.bad_experience || (g.tags ?? []).includes('no_recomendar');
      const isVIP = (g.tags ?? []).includes('vip');
      return `<div class="guest-result-item ${isBad ? 'bad-exp' : ''}" data-id="${g.id}"
           data-fn="${g.first_name ?? ''}" data-ln="${g.last_name ?? ''}"
           data-dni="${g.dni ?? ''}" data-phone="${g.phone ?? ''}" data-email="${g.email ?? ''}"
           data-locality="${g.locality ?? ''}" data-age="${g.age ?? ''}" data-car="${g.car_model ?? ''}" data-plate="${g.car_plate ?? ''}"
           data-nationality="${g.nationality ?? ''}">
        ${isBad ? '⚠️ ' : isVIP ? '⭐ ' : ''}${g.first_name} ${g.last_name}
        ${g.dni ? `<span class="result-meta">${g.dni}</span>` : ''}
      </div>`;
    }).join('');

    container.querySelectorAll('.guest-result-item').forEach(item => {
      item.addEventListener('click', async () => {
        this._selectedGuestId = item.dataset.id;
        document.getElementById('f-firstname').value = item.dataset.fn;
        document.getElementById('f-lastname').value  = item.dataset.ln;
        document.getElementById('f-dni').value       = item.dataset.dni;
        document.getElementById('f-phone').value     = item.dataset.phone;
        document.getElementById('f-email').value     = item.dataset.email ?? '';
        document.getElementById('f-locality').value  = item.dataset.locality ?? '';
        document.getElementById('f-age').value       = item.dataset.age ?? '';
        document.getElementById('f-car').value       = item.dataset.car ?? '';
        document.getElementById('f-plate').value     = item.dataset.plate ?? '';
        document.getElementById('f-nationality').value = item.dataset.nationality ?? '';
        // Si ya hay algo cargado en "Datos adicionales", desplegar la sección
        // para que se vea sin tener que abrirla a mano.
        const details = document.getElementById('f-extra-details');
        if (details && (item.dataset.locality || item.dataset.age || item.dataset.car || item.dataset.plate || item.dataset.nationality)) details.open = true;
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
        // Nota de crédito abierta de una reprogramación anterior
        this._checkOpenCreditNote(item.dataset.id).then(info => this._renderOpenCreditNoteAlert(info));

        // ── Historial del huésped — badge + panel detallado ──
        const guestBadge = document.getElementById('guest-booking-history-badge');
        if (guestBadge) {
          guestBadge.textContent = '⟳ Cargando...';
          guestBadge.className = 'guest-history-badge loading';
          guestBadge.style.display = '';
          try {
            const { data: bkHist } = await this.db
              .from('bookings')
              .select('id,check_in,check_out,total_amount,total_paid,status,nights,booking_units(units(name,color))')
              .eq('guest_id', item.dataset.id)
              .not('status', 'in', '(cancelled,blocked)')
              .order('check_in', { ascending: false })
              .limit(10);
            const n = bkHist?.length ?? 0;
            const totalSpent  = (bkHist ?? []).reduce((s, b) => s + (b.total_paid  ?? 0), 0);
            const totalNights = (bkHist ?? []).reduce((s, b) => s + (b.nights ?? 0), 0);
            if (n === 0) {
              guestBadge.textContent = '🆕 Primera reserva — cliente nuevo';
              guestBadge.className   = 'guest-history-badge new';
            } else {
              guestBadge.innerHTML   = '🔄 Frecuente · ' + n + ' reserva' + (n !== 1 ? 's' : '') + ' · $' + Math.round(totalSpent).toLocaleString('es-AR') + ' total';
              guestBadge.className   = 'guest-history-badge returning';
            }
            // ── Panel de historial detallado ──
            let hPanel = document.getElementById('guest-history-panel');
            if (!hPanel) {
              hPanel = document.createElement('div');
              hPanel.id = 'guest-history-panel';
              hPanel.style.cssText = 'animation:fadeSlideIn .2s ease';
              guestBadge.after(hPanel);
            }
            if (n === 0) { hPanel.innerHTML = ''; return; }
            const fmtD   = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
            const fmtARS = v   => '$' + Math.round(v).toLocaleString('es-AR');
            const rows = (bkHist ?? []).slice(0, 5).map(b => {
              const u   = b.booking_units?.[0]?.units;
              const clr = u?.color ?? 'var(--color-primary)';
              const bal = Math.max(0, (b.total_amount ?? 0) - (b.total_paid ?? 0));
              return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--color-border)">' +
                '<div style="width:3px;height:32px;border-radius:2px;background:' + clr + ';flex-shrink:0"></div>' +
                '<div style="flex:1;min-width:0">' +
                  '<div style="font-size:.75rem;font-weight:700;color:var(--color-text)">' + fmtD(b.check_in) + ' → ' + fmtD(b.check_out) + '</div>' +
                  '<div style="font-size:.68rem;color:var(--color-text-3)">' + (u?.name ?? '—') + ' · ' + (b.nights ?? 0) + ' noches</div>' +
                '</div>' +
                '<div style="text-align:right;flex-shrink:0">' +
                  '<div style="font-size:.75rem;font-weight:700">' + fmtARS(b.total_paid ?? 0) + '</div>' +
                  (bal > 0 ? '<div style="font-size:.65rem;color:#ef4444">−' + fmtARS(bal) + '</div>' : '') +
                '</div>' +
              '</div>';
            }).join('');
            hPanel.innerHTML =
              '<div style="margin-top:10px;padding:12px 14px;border-radius:var(--r-lg);background:var(--color-surface-2);border:1px solid var(--color-border)">' +
                '<div style="display:flex;gap:20px;margin-bottom:10px;flex-wrap:wrap">' +
                  '<div><div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-3)">Reservas</div><div style="font-weight:800;font-size:.92rem">' + n + '</div></div>' +
                  '<div><div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-3)">Noches</div><div style="font-weight:800;font-size:.92rem">' + totalNights + '</div></div>' +
                  '<div><div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-3)">Total pagado</div><div style="font-weight:800;font-size:.92rem;color:var(--color-primary)">' + fmtARS(totalSpent) + '</div></div>' +
                  '<div><div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-3)">Ticket prom.</div><div style="font-weight:800;font-size:.92rem">' + fmtARS(n > 0 ? totalSpent / n : 0) + '</div></div>' +
                '</div>' +
                '<div style="font-size:.68rem;font-weight:700;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Últimas estadías</div>' +
                rows +
              '</div>';
          } catch (err) {
            guestBadge.textContent = '—';
            guestBadge.className   = 'guest-history-badge';
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
      const now      = new Date();
      const month    = now.getMonth() + 1;
      const monthPad = String(month).padStart(2, '0');

      // ── Query segura: via bookings (RLS ok) + filtro JS por unidad ──
      // Mes actual (mismo mes, cualquier año)
      const { data: monthData } = await this.db
        .from('bookings')
        .select('price_per_night, check_in, check_out')
        .eq('hotel_id', this.ctx.hotelId)
        .not('status', 'in', '(cancelled,blocked)')
        .gt('price_per_night', 0)
        .gte('check_in', `${now.getFullYear()}-${monthPad}-01`)
        .lte('check_in', `${now.getFullYear()}-${monthPad}-${String(new Date(now.getFullYear(), now.getMonth()+1, 0).getDate()).padStart(2,'0')}`)
        .order('check_in', { ascending: false })
        .limit(60);

      const prices = (monthData ?? [])
        
        .map(b => b.price_per_night)
        .filter(p => p > 0);

      if (!prices.length) {
        // Fallback: cualquier mes reciente para esta unidad
        const { data: anyData } = await this.db
          .from('bookings')
          .select('price_per_night, check_in')
          .eq('hotel_id', this.ctx.hotelId)
          .not('status', 'in', '(cancelled,blocked)')
          .gt('price_per_night', 0)
          .order('check_in', { ascending: false })
          .limit(50);

        const anyPrices = (anyData ?? [])
          
          .map(b => b.price_per_night)
          .filter(p => p > 0);

        if (!anyPrices.length) { hints.innerHTML = ''; return; }
        const anyAvg   = Math.round(anyPrices.reduce((a,b) => a+b,0) / anyPrices.length);
        const fmt      = n => '$' + Math.round(n).toLocaleString('es-AR');
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
  // ── Voucher — Paso 5 ─────────────────────────────
  _renderVoucher() {
    const el = document.getElementById('booking-voucher');
    if (!el) return;

    // Collect data from previous steps
    const fn     = document.getElementById('f-firstname')?.value?.trim() ?? '';
    const ln     = document.getElementById('f-lastname')?.value?.trim()  ?? '';
    const dni    = document.getElementById('f-dni')?.value?.trim()       ?? '';
    const phone  = document.getElementById('f-phone')?.value?.trim()     ?? '';
    const email  = document.getElementById('f-email')?.value?.trim()     ?? '';
    const locality = document.getElementById('f-locality')?.value?.trim() ?? '';
    const age      = document.getElementById('f-age')?.value?.trim()      ?? '';
    const car      = document.getElementById('f-car')?.value?.trim()      ?? '';
    const plate    = document.getElementById('f-plate')?.value?.trim()    ?? '';
    const ci     = document.getElementById('f-checkin')?.value  ?? '';
    const co     = document.getElementById('f-checkout')?.value ?? '';
    const price  = parseFloat(document.getElementById('f-price')?.value  ?? 0);
    const notes  = document.getElementById('f-notes')?.value?.trim() ?? '';
    const adults   = parseInt(document.getElementById('f-adults')?.value   ?? 1);
    const children = parseInt(document.getElementById('f-children')?.value ?? 0);

    // Units
    const unitNames = (this.ctx?.units ?? [])
      .filter(u => this._selectedUnitIds.has(String(u.id)))
      .map(u => u.name).join(', ');

    // Source
    const selectedChip = document.querySelector('#f-source-selector .src-chip.selected');
    const source = selectedChip?.dataset?.source ?? 'direct';

    // Nights & financials
    const nightsN    = ci && co ? Math.round((new Date(co) - new Date(ci)) / 86400000) : 0;
    const _discMode1 = document.getElementById('f-discount-mode')?.value ?? 'pct';
    const _discRaw1  = parseFloat(document.getElementById('f-discount')?.value ?? 0);
    const discPct    = _discMode1 === 'amt'
      ? (subtotal > 0 ? Math.min(100, _discRaw1 / subtotal * 100) : 0)
      : _discRaw1;
    const _sModeB    = document.getElementById('f-surcharge-mode')?.value ?? 'amt';
    const _sRawB     = parseFloat(document.getElementById('f-surcharge')?.value ?? 0);
    const surcharge  = _sModeB === 'pct' ? Math.round(subtotal * _sRawB / 100) : _sRawB;
    const freeNights = parseInt(document.getElementById('f-free-nights')?.value ?? 0);
    const billable   = Math.max(0, nightsN - freeNights);
    const subtotal   = billable * price;
    const discount   = Math.round(subtotal * discPct / 100);
    const total      = Math.round(subtotal - discount + surcharge);
    const paid       = Math.round(this._getTotalPaid());
    const balance    = total - paid;
    const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
    const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-AR', {weekday:'short',day:'numeric',month:'short'}) : '—';

    // Payment rows (con unidad asignada, si corresponde)
    const payRows = [];
    document.querySelectorAll('.payment-row').forEach(row => {
      const amt  = parseFloat(row.querySelector('.pay-amount')?.value) || 0;
      const meth = row.querySelector('.pay-method')?.value;
      const date = row.querySelector('.pay-date')?.value;
      const note = row.querySelector('.pay-note')?.value ?? '';
      const unitId = row.dataset.unitId || null;
      if (amt > 0) {
        const labels = { cash:'Efectivo', transfer:'Transferencia', mercadopago:'MercadoPago',
          naranjax:'Naranja X', uala:'Ualá', debit_card:'Tarjeta Débito',
          credit_card:'Tarjeta Crédito (+10%)', credit_note:'Nota de Crédito / Voucher' };
        payRows.push({ label: labels[meth] ?? meth, amount: meth === 'credit_card' ? amt * 1.10 : amt, date, note, unitId });
      }
    });

    // ── Desglose por departamento (solo si hay 2+ unidades con precio cargado) ──
    let perUnitHTML = '';
    let pendingCompactHTML = ''; // línea compacta "#1 (resta $X) | #5 (resta $Y)" bajo Saldo pendiente
    const multiUnitIds = [...this._selectedUnitIds];
    if (multiUnitIds.length >= 2 && Object.keys(this._unitPrices).length >= multiUnitIds.length) {
      const unitTotals = multiUnitIds.map(uid => {
        const u = this.ctx.units.find(x => String(x.id) === String(uid));
        return { uid, name: u?.name ?? '—', num: u?.sort_order ?? '?', color: u?.color ?? 'var(--color-primary)',
                 total: (parseFloat(this._unitPrices[uid]) || 0) * billable };
      });
      const sumTotals   = unitTotals.reduce((s,u) => s + u.total, 0) || 1;
      const generalPaid = payRows.filter(p => !p.unitId).reduce((s,p) => s + p.amount, 0);
      const hasGeneral  = generalPaid > 0;

      const unitBalances = unitTotals.map(u => {
        const directPaid   = payRows.filter(p => p.unitId === u.uid).reduce((s,p) => s + p.amount, 0);
        const generalShare = hasGeneral ? generalPaid * (u.total / sumTotals) : 0;
        const estPaid       = directPaid + generalShare;
        const estBal         = Math.max(0, u.total - estPaid);
        return { ...u, estBal };
      });

      perUnitHTML = `
        <div class="voucher-section">
          <div class="voucher-section-title">🏠 Por departamento</div>
          ${unitBalances.map(u => `
            <div class="voucher-fin-row">
              <span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${u.color};margin-right:6px"></span>#${u.num} · ${u.name}</span>
              <span>${fmt(u.total)}</span>
            </div>
            <div class="voucher-fin-row" style="font-size:.76rem;color:${u.estBal<=0 ? '#16a34a' : '#f59e0b'};margin-bottom:6px">
              <span style="padding-left:13px">${u.estBal<=0 ? '✓ Saldado' : 'Resta abonar'}</span>
              <span>${u.estBal<=0 ? '' : fmt(u.estBal)}</span>
            </div>`).join('')}
          ${hasGeneral ? `<div class="voucher-row-sm" style="margin-top:4px;font-style:italic">
            ℹ️ Incluye pagos generales repartidos proporcionalmente entre los departamentos
          </div>` : ''}
        </div>`;

      // Línea compacta para mostrar debajo de "Saldo pendiente"
      const pendingUnits = unitBalances.filter(u => u.estBal > 0);
      if (pendingUnits.length) {
        pendingCompactHTML = `
          <div class="voucher-row-sm" style="margin-top:4px">
            ${pendingUnits.map(u => `#${u.num} (resta ${fmt(u.estBal)})`).join(' &nbsp;|&nbsp; ')}
          </div>`;
      }
    }

    const statusText = paid <= 0 ? 'Sin seña' : balance <= 0 ? 'Pagado total' : 'Con seña';
    const statusColor = paid <= 0 ? '#f59e0b' : balance <= 0 ? '#16a34a' : '#fb7185';

    const emitidaStr = this._editingCreatedAt
      ? new Date(this._editingCreatedAt).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
      : '';

    el.innerHTML = `
      <div class="voucher-header">
        <div class="voucher-hotel">${this.ctx?.hotel?.name ?? 'Barranca de Termas'}</div>
        <div class="voucher-title">${this._editingId ? 'Actualización de Reserva' : 'Nueva Reserva'}</div>
        ${emitidaStr ? `<div style="font-size:.68rem;color:var(--color-text-3);margin-top:1px">Emitida ${emitidaStr}</div>` : ''}
        <span class="voucher-status-pill" style="background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}40">${statusText}</span>
      </div>

      <div class="voucher-section">
        <div class="voucher-section-title">👤 Huésped</div>
        <div class="voucher-row"><strong>${(fn + ' ' + ln).trim() || '—'}</strong></div>
        ${dni   ? `<div class="voucher-row-sm">DNI: ${dni}</div>` : ''}
        ${phone ? `<div class="voucher-row-sm">📱 ${phone}</div>` : ''}
        ${email ? `<div class="voucher-row-sm">✉️ ${email}</div>` : ''}
        ${locality ? `<div class="voucher-row-sm">📍 ${locality}</div>` : ''}
        ${age      ? `<div class="voucher-row-sm">${age} años</div>` : ''}
        ${car || plate ? `<div class="voucher-row-sm">🚗 ${[car, plate].filter(Boolean).join(' · ')}</div>` : ''}
      </div>

      <div class="voucher-section">
        <div class="voucher-section-title">🛏️ Estadía</div>
        <div class="voucher-dates-grid">
          <div><div class="voucher-label">CHECK-IN</div><div class="voucher-date-val">${fmtDate(ci)}</div></div>
          <div style="text-align:center;color:var(--color-text-3);font-size:1.2rem">→</div>
          <div><div class="voucher-label">CHECK-OUT</div><div class="voucher-date-val">${fmtDate(co)}</div></div>
        </div>
        <div class="voucher-row-sm" style="margin-top:6px">
          🌙 ${nightsN} noche${nightsN !== 1 ? 's' : ''}&nbsp;·&nbsp;
          👥 ${adults} adulto${adults !== 1 ? 's' : ''}${children ? ` + ${children} menor${children !== 1 ? 'es' : ''}` : ''}
        </div>
        <div class="voucher-row-sm">🏠 ${unitNames || '—'}</div>
      </div>

      ${perUnitHTML}

      <div class="voucher-section">
        <div class="voucher-section-title">💰 Finanzas</div>
        <div class="voucher-fin-row"><span>Precio por noche</span><span>${fmt(price)}</span></div>
        <div class="voucher-fin-row"><span>Noches facturadas (${billable})</span><span>${fmt(subtotal)}</span></div>
        ${discPct > 0   ? `<div class="voucher-fin-row voucher-disc"><span>Descuento ${fmtPct(discPct)}%</span><span>−${fmt(discount)}</span></div>` : ''}
        ${surcharge > 0 ? `<div class="voucher-fin-row"><span>Recargo</span><span>+${fmt(surcharge)}</span></div>` : ''}
        ${freeNights > 0 ? `<div class="voucher-fin-row voucher-disc"><span>Noches sin cargo (${freeNights})</span><span>✓</span></div>` : ''}
        <div class="voucher-fin-row voucher-total"><span><strong>TOTAL</strong></span><span><strong>${fmt(total)}</strong></span></div>
        ${payRows.map(p => {
          const dateFmt = p.date ? p.date.split('-').reverse().join('/') : '';
          const u = p.unitId ? this.ctx.units.find(x => String(x.id) === String(p.unitId)) : null;
          const unitTag = multiUnitIds.length >= 2 ? (u ? ' · #' + (u.sort_order ?? '?') : ' · General') : '';
          return `
          <div class="voucher-fin-row" style="font-size:.78rem;color:var(--color-text-2)">
            <span>↳ ${p.label}${dateFmt ? ' · ' + dateFmt : ''}${unitTag}${p.note ? ' · ' + p.note : ''}</span>
            <span>${fmt(p.amount)}</span>
          </div>`;
        }).join('')}
        <div class="voucher-fin-row" style="margin-top:6px">
          <span>Abonado</span><span style="color:#16a34a;font-weight:600">${fmt(paid)}</span>
        </div>
        <div class="voucher-fin-row ${balance > 0 ? 'voucher-saldo-pending' : 'voucher-saldo-ok'}">
          <span><strong>${balance > 0 ? '⚠️ Saldo pendiente' : '✅ Sin saldo'}</strong></span>
          <span><strong>${balance > 0 ? fmt(balance) : '—'}</strong></span>
        </div>
        ${pendingCompactHTML}
      </div>

      ${notes ? `<div class="voucher-section">
        <div class="voucher-section-title">📝 Observaciones</div>
        <div class="voucher-notes">${notes}</div>
      </div>` : ''}`;

    // Wire voucher action buttons
    // El guard _submitting en _submit() evita doble envío (no usar { once: true }
    // porque si el usuario vuelve al paso anterior el listener se pierde)
    document.getElementById('btn-voucher-pdf')?.addEventListener('click', () => this._exportVoucherPDF());
    document.getElementById('btn-voucher-whatsapp')?.addEventListener('click', () => this._sendVoucherToManager());
  }

  _exportVoucherPDF() {
    const fn   = document.getElementById('f-firstname')?.value?.trim() ?? '';
    const ln   = document.getElementById('f-lastname')?.value?.trim()  ?? '';
    const dni  = document.getElementById('f-dni')?.value?.trim()       ?? '';
    const phone= document.getElementById('f-phone')?.value?.trim()     ?? '';
    const email= document.getElementById('f-email')?.value?.trim()     ?? '';
    const ci   = document.getElementById('f-checkin')?.value  ?? '';
    const co   = document.getElementById('f-checkout')?.value ?? '';
    const price= parseFloat(document.getElementById('f-price')?.value ?? 0);
    const notes= document.getElementById('f-notes')?.value?.trim()     ?? '';
    const adults   = parseInt(document.getElementById('f-adults')?.value   ?? 1);
    const children = parseInt(document.getElementById('f-children')?.value ?? 0);

    const unitNames = (this.ctx?.units ?? [])
      .filter(u => this._selectedUnitIds.has(String(u.id)))
      .map(u => u.name).join(' / ');

    const nightsN    = ci && co ? Math.round((new Date(co) - new Date(ci)) / 86400000) : 0;
    const _discMode2 = document.getElementById('f-discount-mode')?.value ?? 'pct';
    const _discRaw2  = parseFloat(document.getElementById('f-discount')?.value ?? 0);
    const discPct    = _discMode2 === 'amt'
      ? (subtotal > 0 ? Math.min(100, _discRaw2 / subtotal * 100) : 0)
      : _discRaw2;
    const _sModeC    = document.getElementById('f-surcharge-mode')?.value ?? 'amt';
    const _sRawC     = parseFloat(document.getElementById('f-surcharge')?.value ?? 0);
    const surcharge  = _sModeC === 'pct' ? Math.round(subtotal * _sRawC / 100) : _sRawC;
    const freeNights = parseInt(document.getElementById('f-free-nights')?.value ?? 0);
    const billable   = Math.max(0, nightsN - freeNights);
    const subtotal   = billable * price;
    const discount   = Math.round(subtotal * discPct / 100);
    const total      = Math.round(subtotal - discount + surcharge);
    const paid       = Math.round(this._getTotalPaid());
    const balance    = Math.max(0, total - paid);

    const fmt  = n => '$\u00a0' + Math.round(n).toLocaleString('es-AR');
    const fmtD = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-AR', {weekday:'long', day:'numeric', month:'long', year:'numeric'}) : '—';
    const fmtDShort = d => d ? d.split('-').reverse().join('/') : '—';
    const now  = new Date().toLocaleDateString('es-AR', {day:'numeric',month:'long',year:'numeric'});

    const payRows = [];
    document.querySelectorAll('.payment-row').forEach(row => {
      const amt  = parseFloat(row.querySelector('.pay-amount')?.value) || 0;
      const meth = row.querySelector('.pay-method')?.value;
      const date = row.querySelector('.pay-date')?.value;
      const note = row.querySelector('.pay-note')?.value ?? '';
      if (amt > 0) {
        const labels = { cash:'Efectivo', transfer:'Transferencia', mercadopago:'MercadoPago',
          naranjax:'Naranja X', uala:'Ualá', debit_card:'Tarjeta Débito',
          credit_card:'Tarjeta Crédito (+10%)', credit_note:'Nota de Crédito/Voucher' };
        payRows.push({ label: labels[meth] ?? meth, amount: meth === 'credit_card' ? amt * 1.10 : amt, date: fmtDShort(date), note });
      }
    });

    const paxStr = `${adults} adulto${adults !== 1 ? 's' : ''}${children ? ` + ${children} menor${children !== 1 ? 'es' : ''}` : ''}`;
    const sourceChip = document.querySelector('#f-source-selector .src-chip.selected');
    const sourceLabel = sourceChip?.querySelector('span')?.textContent?.trim() ?? 'Directo';
    const statusText = paid <= 0 ? 'SIN SEÑA' : balance <= 0 ? 'PAGADO TOTAL' : 'CON SEÑA';
    const statusColor = paid <= 0 ? '#f59e0b' : balance <= 0 ? '#16a34a' : '#6366f1';

    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html lang="es"><head>
<meta charset="utf-8">
<title>Voucher — ${ln} ${fn}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inter',sans-serif; background:#f8fafc; color:#1e293b; padding:32px 24px; font-size:13px; }

  /* Header */
  .header { display:flex; align-items:center; justify-content:space-between; margin-bottom:28px; }
  .hotel-brand { display:flex; align-items:center; gap:12px; }
  .hotel-logo { width:44px; height:44px; border-radius:10px; background:linear-gradient(135deg,#6366f1,#8b5cf6); display:flex; align-items:center; justify-content:center; color:white; font-size:22px; }
  .hotel-name { font-size:16px; font-weight:700; color:#1e293b; }
  .hotel-sub  { font-size:11px; color:#64748b; margin-top:1px; }
  .voucher-label-badge { background:#6366f1; color:white; font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; padding:5px 14px; border-radius:20px; }
  .divider { height:1px; background:linear-gradient(to right,#6366f1,transparent); margin:0 0 24px; }

  /* Status bar */
  .status-bar { background:#f1f5f9; border-radius:10px; padding:12px 18px; display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; border-left:4px solid ${statusColor}; }
  .status-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.08em; color:#64748b; }
  .status-value { font-size:13px; font-weight:700; color:${statusColor}; letter-spacing:.06em; }
  .status-date  { font-size:11px; color:#94a3b8; }

  /* Sections */
  .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px; }
  .card { background:white; border:1px solid #e2e8f0; border-radius:10px; padding:16px 18px; }
  .card-title { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.1em; color:#6366f1; margin-bottom:12px; display:flex; align-items:center; gap:6px; }
  .field { margin-bottom:8px; }
  .field:last-child { margin-bottom:0; }
  .field-label { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.07em; color:#94a3b8; margin-bottom:2px; }
  .field-value { font-size:13px; font-weight:500; color:#1e293b; }
  .field-value.large { font-size:15px; font-weight:700; }

  /* Dates banner */
  .dates-banner { background:linear-gradient(135deg,#6366f1,#8b5cf6); color:white; border-radius:10px; padding:18px 20px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; }
  .dates-block { text-align:center; flex:1; }
  .dates-block-lbl { font-size:10px; font-weight:600; letter-spacing:.1em; opacity:.7; margin-bottom:4px; }
  .dates-block-val { font-size:14px; font-weight:700; }
  .dates-block-sub { font-size:11px; opacity:.75; margin-top:2px; }
  .dates-arrow { font-size:22px; opacity:.6; }
  .nights-pill { background:rgba(255,255,255,.2); border-radius:20px; padding:4px 14px; font-size:12px; font-weight:600; }

  /* Finance table */
  .finance-card { background:white; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; margin-bottom:20px; }
  .finance-row { display:flex; justify-content:space-between; align-items:center; padding:9px 18px; border-bottom:1px solid #f1f5f9; font-size:12px; }
  .finance-row:last-child { border-bottom:none; }
  .finance-row.subtotal { font-weight:500; }
  .finance-row.disc { color:#16a34a; }
  .finance-row.total { background:#f8fafc; font-size:14px; font-weight:700; color:#1e293b; padding:12px 18px; }
  .finance-row.payment-row-item { color:#64748b; font-size:11px; padding:6px 18px 6px 30px; background:#fafafa; }
  .finance-row.paid-row { color:#16a34a; font-weight:600; }
  .finance-row.balance-row { background:${balance > 0 ? '#fef3c7' : '#f0fdf4'}; color:${balance > 0 ? '#92400e' : '#14532d'}; font-weight:700; font-size:13px; padding:12px 18px; }

  /* Notes */
  .notes-card { background:#fafafa; border:1px dashed #cbd5e1; border-radius:10px; padding:14px 18px; margin-bottom:20px; }
  .notes-text  { font-size:12px; color:#475569; font-style:italic; line-height:1.5; }

  /* Footer */
  .footer { text-align:center; margin-top:24px; padding-top:16px; border-top:1px solid #e2e8f0; }
  .footer p { font-size:10px; color:#94a3b8; line-height:1.6; }
  .footer strong { color:#6366f1; }

  @media print {
    body { background:white; padding:16px; }
    .dates-banner { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .finance-row.balance-row, .finance-row.total { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
</style></head><body>

<div class="header">
  <div class="hotel-brand">
    <div class="hotel-logo">🏨</div>
    <div>
      <div class="hotel-name">Barranca de Termas</div>
      <div class="hotel-sub">Complejo de Apartamentos Turísticos</div>
    </div>
  </div>
  <div class="voucher-label-badge">Voucher de Reserva</div>
</div>
<div class="divider"></div>

<div class="status-bar">
  <div>
    <div class="status-label">Estado de pago</div>
    <div class="status-value">${statusText}</div>
  </div>
  <div style="text-align:right">
    <div class="status-label">Canal</div>
    <div style="font-size:12px;font-weight:600;color:#475569">${sourceLabel}</div>
  </div>
  <div style="text-align:right">
    <div class="status-label">Emitido</div>
    <div class="status-date">${now}</div>
  </div>
</div>
<div style="display:flex;gap:16px;font-size:11px;color:#64748b;margin-bottom:16px">
  <span>🕒 Check-in desde las <strong>${AppContext.config?.checkin_time ?? '14:00'}</strong></span>
  <span>🕒 Check-out hasta las <strong>${AppContext.config?.checkout_time ?? '10:00'}</strong></span>
</div>

<!-- Datos del Huésped + Unidad -->
<div class="grid-2">
  <div class="card">
    <div class="card-title">👤 Datos del Huésped</div>
    <div class="field">
      <div class="field-label">Nombre completo</div>
      <div class="field-value large">${(ln + ', ' + fn).trim().replace(/^, /,'') || '—'}</div>
    </div>
    ${dni   ? `<div class="field"><div class="field-label">DNI / Documento</div><div class="field-value">${dni}</div></div>` : ''}
    ${phone ? `<div class="field"><div class="field-label">Teléfono</div><div class="field-value">${phone}</div></div>` : ''}
    ${email ? `<div class="field"><div class="field-label">Email</div><div class="field-value">${email}</div></div>` : ''}
    ${locality ? `<div class="field"><div class="field-label">Localidad</div><div class="field-value">${locality}</div></div>` : ''}
    ${age      ? `<div class="field"><div class="field-label">Edad</div><div class="field-value">${age}</div></div>` : ''}
    ${(car || plate) ? `<div class="field"><div class="field-label">Vehículo</div><div class="field-value">${[car, plate].filter(Boolean).join(' · ')}</div></div>` : ''}
  </div>
  <div class="card">
    <div class="card-title">🏠 Alojamiento</div>
    <div class="field">
      <div class="field-label">Unidad / Departamento</div>
      <div class="field-value large">${unitNames || '—'}</div>
    </div>
    <div class="field">
      <div class="field-label">Huéspedes</div>
      <div class="field-value">${paxStr}</div>
    </div>
  </div>
</div>

<!-- Fechas -->
<div class="dates-banner">
  <div class="dates-block">
    <div class="dates-block-lbl">CHECK-IN</div>
    <div class="dates-block-val">${fmtDShort(ci)}</div>
    <div class="dates-block-sub">${fmtD(ci).split(',')[0] ?? ''}</div>
  </div>
  <div style="text-align:center">
    <div class="dates-arrow">→</div>
    <div class="nights-pill">${nightsN} noche${nightsN !== 1 ? 's' : ''}</div>
  </div>
  <div class="dates-block">
    <div class="dates-block-lbl">CHECK-OUT</div>
    <div class="dates-block-val">${fmtDShort(co)}</div>
    <div class="dates-block-sub">${fmtD(co).split(',')[0] ?? ''}</div>
  </div>
</div>

<!-- Liquidación -->
<div class="finance-card">
  <div class="finance-row subtotal">
    <span>Precio por noche</span><span>${fmt(price)}</span>
  </div>
  <div class="finance-row subtotal">
    <span>Noches (${billable}${freeNights ? ` facturables de ${nightsN}` : ''})</span><span>${fmt(subtotal)}</span>
  </div>
  ${discPct > 0    ? `<div class="finance-row disc"><span>Descuento ${fmtPct(discPct)}%</span><span>− ${fmt(discount)}</span></div>` : ''}
  ${surcharge > 0  ? `<div class="finance-row"><span>Recargo adicional</span><span>+ ${fmt(surcharge)}</span></div>` : ''}
  <div class="finance-row total">
    <span>TOTAL ESTADÍA</span><span>${fmt(total)}</span>
  </div>
  ${payRows.map(p => `
  <div class="finance-row payment-row-item">
    <span>↳ ${p.label}${p.date ? ' · ' + p.date : ''}${p.note ? ' · ' + p.note : ''}</span>
    <span>${fmt(p.amount)}</span>
  </div>`).join('')}
  ${paid > 0 ? `<div class="finance-row paid-row"><span>Total abonado</span><span>${fmt(paid)}</span></div>` : ''}
  <div class="finance-row balance-row">
    <span>${balance > 0 ? '⚠️ Saldo pendiente al check-in' : '✅ Sin saldo pendiente'}</span>
    <span>${balance > 0 ? fmt(balance) : '—'}</span>
  </div>
</div>

${notes ? `
<div class="notes-card">
  <div class="card-title" style="margin-bottom:8px">📝 Observaciones</div>
  <div class="notes-text">${notes}</div>
</div>` : ''}

<div class="footer">
  <p>Este documento es un comprobante interno de reserva generado por <strong>MILA PMS</strong>.<br>
  Barranca de Termas — Departamentos Turísticos · <em>Documento emitido el ${now}</em></p>
</div>

</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 500);
  }

  _sendVoucherToManager() {
    const fn      = document.getElementById('f-firstname')?.value?.trim() ?? '';
    const ln      = document.getElementById('f-lastname')?.value?.trim()  ?? '';
    const dni     = document.getElementById('f-dni')?.value?.trim()       ?? '';
    const phone   = document.getElementById('f-phone')?.value?.trim()     ?? '';
    const ci      = document.getElementById('f-checkin')?.value  ?? '';
    const co      = document.getElementById('f-checkout')?.value ?? '';
    const price   = parseFloat(document.getElementById('f-price')?.value ?? 0);
    const adults  = parseInt(document.getElementById('f-adults')?.value   ?? 1);
    const children= parseInt(document.getElementById('f-children')?.value ?? 0);
    const notes   = document.getElementById('f-notes')?.value?.trim() ?? '';

    const unitNames = (this.ctx?.units ?? [])
      .filter(u => this._selectedUnitIds.has(String(u.id)))
      .map(u => u.name).join(', ');

    const nightsN  = ci && co ? Math.round((new Date(co) - new Date(ci)) / 86400000) : 0;
    const _discMode3 = document.getElementById('f-discount-mode')?.value ?? 'pct';
    const _discRaw3  = parseFloat(document.getElementById('f-discount')?.value ?? 0);
    const discPct  = _discMode3 === 'amt'
      ? (subtotal > 0 ? Math.min(100, _discRaw3 / subtotal * 100) : 0)
      : _discRaw3;
    const _sModeD  = document.getElementById('f-surcharge-mode')?.value ?? 'amt';
    const _sRawD   = parseFloat(document.getElementById('f-surcharge')?.value ?? 0);
    const surcharge= _sModeD === 'pct' ? Math.round(subtotal * _sRawD / 100) : _sRawD;
    const freeNights = parseInt(document.getElementById('f-free-nights')?.value ?? 0);
    const billable = Math.max(0, nightsN - freeNights);
    const subtotal = billable * price;
    const discount = Math.round(subtotal * discPct / 100);
    const total    = Math.round(subtotal - discount + surcharge);
    const paid     = Math.round(this._getTotalPaid());
    const balance  = Math.max(0, total - paid);

    // Origen/canal
    const sourceChip = document.querySelector('#f-source-selector .src-chip.selected');
    const sourceLabel = sourceChip?.querySelector('span')?.textContent?.trim() ?? 'Directo';

    const paxStr = `${adults} adulto${adults !== 1 ? 's' : ''}${children ? ` + ${children} menor${children !== 1 ? 'es' : ''}` : ''}`;
    const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
    const fmtD = d => d ? d.split('-').reverse().join('/') : '—';

    // Exact format requested
    const text =
      `🏨 *Nueva Reserva*\n` +
      `*Apellido y Nombre:* ${ln} ${fn}\n` +
      `*DNI:* ${dni || '—'}\n` +
      `*Celular de contacto:* ${phone || '—'}\n` +
      `*Check-in:* ${fmtD(ci)}\n` +
      `*Check-out:* ${fmtD(co)} (${nightsN} noche${nightsN !== 1 ? 's' : ''})\n` +
      `*Tipo de departamento:* ${unitNames || '—'}\n` +
      `*Cantidad de personas:* ${paxStr}\n` +
      `*Saldo pendiente al ingreso:* ${fmt(balance)}\n\n` +
      `📝 *Nota y observaciones:* _${[sourceLabel, notes].filter(Boolean).join(' · ') || 'Sin observaciones'}_`;

    const MANAGER_PHONE = '5492236848043'; // +54 9 223 684-8043
    window.open(`https://wa.me/${MANAGER_PHONE}?text=${encodeURIComponent(text)}`, '_blank');
  }

  async _submit() {
    if (this._submitting) return; // guard contra doble click
    if (!this._validateAll()) return;

    // ── Guard offline ──────────────────────────────────────────
    // Si no hay conexión, no intentamos guardar — Supabase va a
    // fallar de todas formas y el formulario quedaría en estado
    // indefinido. Mejor avisar claramente y dejar el form abierto
    // para que el usuario lo guarde cuando vuelva la conexión.
    if (!navigator.onLine) {
      showToast('📵 Sin conexión — conectate a internet para guardar la reserva', 'warning');
      return;
    }
    // ──────────────────────────────────────────────────────────

    this._submitting = true;
    const btn = document.getElementById('btn-step-next');
    const confirmBtn = document.getElementById('btn-voucher-confirm');
    if (btn)        { btn.disabled        = true; btn.textContent        = 'Guardando...'; }
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Guardando...'; }

    let _safetyTimer = setTimeout(() => {
      if (btn) { btn.disabled = false; btn.textContent = this._editingId ? 'Guardar cambios' : 'Confirmar reserva'; }
      showToast('La operación tardó demasiado. Verificá tu conexión.', 'error');
    }, 30000);

    try {
      const ci    = document.getElementById('f-checkin').value;
      const co    = document.getElementById('f-checkout').value;
      const price = parseFloat(document.getElementById('f-price').value) || 0;
      const _discMode4 = document.getElementById('f-discount-mode')?.value ?? 'pct';
      const _discRaw4  = parseFloat(document.getElementById('f-discount').value) || 0;
      const disc  = _discMode4 === 'amt'
        ? (subtotal > 0 ? Math.min(100, _discRaw4 / subtotal * 100) : 0)
        : _discRaw4;
      const _sModeE = document.getElementById('f-surcharge-mode')?.value ?? 'amt';
      const _sRawE  = parseFloat(document.getElementById('f-surcharge').value) || 0;
      const surch   = _sModeE === 'pct' ? Math.round(subtotal * _sRawE / 100) : _sRawE;
      const freeN = parseInt(document.getElementById('f-free-nights').value) || 0;
      const dep   = parseFloat(document.getElementById('f-deposit').value) || 0;
      // 200 = mismo límite que el CHECK de la base (bookings_notes_check) —
      // recortar acá antes de mandarlo evita el rechazo silencioso de todo
      // el guardado si alguien escribió (o se le fue acumulando de vueltas
      // anteriores) una nota más larga que eso.
      const notes = document.getElementById('f-notes').value.trim().slice(0, 200);
      const source = document.querySelector('input[name="booking-source"]:checked')?.value ?? 'direct';

      const nights   = Math.round((new Date(co) - new Date(ci)) / 86400000);
      const billable = Math.max(0, nights - freeN);
      const subtotal = price * billable;
      // Redondear el descuento PRIMERO para que el total quede en pesos exactos.
      // Ej: $270.000 × 16,6668% = $45.000,36 → Math.round → $45.000
      // → total = $270.000 − $45.000 = $225.000 exacto (no $224.999).
      const discAmt  = Math.round(subtotal * (disc / 100));
      const total    = Math.max(0, subtotal - discAmt + Math.round(surch));
      const paid     = Math.round(this._getTotalPaid());
      const balance  = Math.max(0, total - paid);

      // ── Validar superposición de unidades ────────────
      const selectedUnits = [...this._selectedUnitIds];
      if (selectedUnits.length > 0 && ci && co) {
        // Esta consulta era la única del guardado que NO tenía el resguardo
        // de tiempo límite (_withTimeout) que sí tienen todas las demás —
        // si por algo se colgaba (conexión lenta/inestable, típico en
        // celular), el botón se quedaba en "Guardando..." para siempre,
        // porque el código nunca llegaba al finally que lo resetea.
        const { data: conflicts } = await this._withTimeout(
          this.db
            .from('booking_units')
            .select('unit_id, bookings!inner(id, check_in, check_out, status, guests!bookings_guest_id_fkey(first_name,last_name))')
            .in('unit_id', selectedUnits)
            .not('bookings.status', 'in', '(cancelled,blocked)')
            .lt('bookings.check_in', co)
            .gt('bookings.check_out', ci),
          'validar disponibilidad'
        );

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
        const { data: prev } = await this._withTimeout(
          this.db
            .from('bookings')
            .select('check_in,check_out,price_per_night,total_amount,status,source,notes')
            .eq('id', this._editingId).single(),
          'leer estado anterior'
        );
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
        locality:   document.getElementById('f-locality')?.value?.trim() || null,
        age:        parseInt(document.getElementById('f-age')?.value)   || null,
        car_model:  document.getElementById('f-car')?.value?.trim()   || null,
        car_plate:  document.getElementById('f-plate')?.value?.trim()?.toUpperCase() || null,
        nationality: document.getElementById('f-nationality')?.value || null,
      };

      if (guestId) {
        const { error: gUpErr } = await this._withTimeout(
          this.db.from('guests').update(guestPayload).eq('id', guestId),
          'Actualizar huésped'
        );
        if (gUpErr) throw new Error('No fue posible actualizar el huesped: ' + gUpErr.message);
      } else {
        const { data: newGuest, error: gErr } = await this._withTimeout(
          this.db.from('guests').insert(guestPayload).select('id').single(),
          'Crear huésped'
        );
        if (gErr) throw gErr;
        guestId = newGuest.id;
        this._selectedGuestId = guestId; // bug: antes solo se actualizaba la variable local,
        // así que cualquier cosa que mirara this._selectedGuestId DESPUÉS de guardar (como
        // el prefill de huésped de "Dividir estadía") quedaba vacía para huéspedes nuevos.
      }

      // ── Columnas CORE (siempre existen en la DB) ──────────────
      const lateCheckout = document.getElementById('f-late-checkout')?.checked ?? false;
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
        late_checkout:         lateCheckout,
        late_checkout_charged: lateCheckout ? (document.getElementById('f-late-checkout-paid')?.checked ?? true) : true,
      };

      // ── Columnas opcionales — se agregan en UPDATE separado ──────
      const pax      = (parseInt(document.getElementById('f-adults')?.value) || 1)
                     + (parseInt(document.getElementById('f-children')?.value) || 0);
      const adults   = parseInt(document.getElementById('f-adults')?.value)   || 1;
      const children = parseInt(document.getElementById('f-children')?.value) || 0;

      let bookingId = this._editingId;
      if (bookingId) {
        // UPDATE — intentar con free_nights primero
        let { error: upErr } = await this._withTimeout(this.db.from('bookings').update({
          ...corePayload, free_nights: freeN
        }).eq('id', bookingId), 'Actualizar reserva');
        if (upErr?.message?.includes('free_nights')) {
          // Columna no existe aún → guardar sin ella
          const { error: upErr2 } = await this._withTimeout(
            this.db.from('bookings').update(corePayload).eq('id', bookingId),
            'Actualizar reserva'
          );
          if (upErr2) throw new Error('No fue posible actualizar la reserva: ' + upErr2.message);
        } else if (upErr) {
          throw new Error('No fue posible actualizar la reserva: ' + upErr.message);
        }
        const { error: buDelErr } = await this._withTimeout(
          this.db.from('booking_units').delete().eq('booking_id', bookingId),
          'Limpiar unidades de la reserva'
        );
        if (buDelErr) throw new Error('Error limpiando unidades anteriores: ' + buDelErr.message);
        // NOTA: los pagos NO se borran acá — cada pago se maneja
        // individualmente más abajo (INSERT para nuevos, UPDATE para
        // existentes, DELETE solo para los que el usuario quitó del form).
      } else {
        // INSERT — intentar con free_nights primero
        let { data: newB, error: insErr } = await this._withTimeout(
          this.db.from('bookings').insert({ ...corePayload, free_nights: freeN }).select('id').single(),
          'Crear reserva'
        );
        if (insErr?.message?.includes('free_nights') || insErr?.message?.includes('does not exist')) {
          // Columna no existe → reintentar sin ella
          const { data: newB2, error: insErr2 } = await this._withTimeout(
            this.db.from('bookings').insert(corePayload).select('id').single(),
            'Crear reserva'
          );
          if (insErr2) throw new Error('No fue posible crear la reserva: ' + insErr2.message);
          newB = newB2;
        } else if (insErr) {
          throw new Error('No fue posible crear la reserva: ' + insErr.message);
        }
        bookingId = newB.id;
      }

      // ── Columnas opcionales (pax, comisiones) — silencioso si no existen ──
      try {
        await this._withTimeout(
          this.db.from('bookings').update({ pax, adults, children }).eq('id', bookingId),
          'Actualizar pasajeros'
        );
      } catch { /* columnas opcionales */ }

      // Insertar/actualizar unidades — upsert SIN ignoreDuplicates para que
      // actualice el precio si el usuario lo cambió en una edición.
      const isMultiUnit = this._selectedUnitIds.size >= 2;
      const unitRows = [...this._selectedUnitIds].map(uid => ({
        booking_id: bookingId,
        unit_id: uid,
        // Multi-unidad: precio individual cargado por el usuario.
        // Unidad única: el mismo precio general de la reserva.
        price_per_night: isMultiUnit ? (parseFloat(this._unitPrices[uid]) || 0) : price,
      }));
      if (unitRows.length) {
        const { error: buErr } = await this._withTimeout(
          this.db.from('booking_units').upsert(unitRows, { onConflict: 'booking_id,unit_id' }),
          'Asignar unidades'
        );
        if (buErr) throw new Error('Error asignando unidades: ' + buErr.message);
      }

      // Insertar/actualizar pagos (incluye notes del nuevo campo)
      // CRÍTICO: separar filas NUEVAS (sin paymentId) de filas EXISTENTES (con paymentId)
      // para evitar duplicar pagos ya guardados cada vez que se edita la reserva.
      const newPayRows    = [];
      const newPayRowEls  = []; // referencia paralela a newPayRows (mismo índice) para asignar el ID real después del insert
      const updatePayRows = [];
      document.querySelectorAll('.payment-row').forEach(row => {
        const rawAmt = parseFloat(row.querySelector('.pay-amount')?.value) || 0;
        const meth   = row.querySelector('.pay-method')?.value;
        const date   = row.querySelector('.pay-date')?.value;
        const note   = row.querySelector('.pay-note')?.value?.trim() || null;
        const existingId = row.dataset.paymentId || null;
        const unitId = row.dataset.unitId || null; // null = General
        const cur    = row.dataset?.currency ?? 'ARS';
        const rate   = parseFloat(row.querySelector('.pay-rate')?.value) || 1;
        if (rawAmt > 0) {
          const isCc = meth === 'credit_card';
          // amount_ars es la columna que el trigger de la base realmente
          // suma para calcular "cuánto se pagó" (total_paid) — antes acá
          // nunca se completaba (solo se mandaba "amount"), así que el
          // total pagado de CUALQUIER pago (no solo notas de crédito)
          // nunca se actualizaba de verdad, aunque el pago se guardara
          // bien en la tabla. De paso, esto también aplica la conversión
          // USD→ARS al guardar — antes esa conversión solo se usaba para
          // mostrar el resumen en pantalla, nunca llegaba a guardarse.
          const arsBase = cur === 'USD' ? rawAmt * rate : rawAmt;
          const arsFinal = Math.round(isCc ? arsBase * 1.10 : arsBase);
          const payload = {
            booking_id:    bookingId,
            hotel_id:      this.ctx.hotelId,
            method:        meth,
            amount:        Math.round(rawAmt),
            currency:      cur,
            exchange_rate: cur === 'USD' ? rate : null,
            amount_ars:    arsFinal,
            payment_date:  date || toISODate(new Date()),
            notes:         note,
            unit_id:       unitId,
          };
          if (existingId) {
            updatePayRows.push({ id: existingId, ...payload });
          } else {
            newPayRows.push(payload);
            newPayRowEls.push(row);
          }
        } else if (existingId) {
          // Monto vaciado a 0 en un pago existente → tratarlo como eliminado
          this._removedPaymentIds = this._removedPaymentIds ?? [];
          this._removedPaymentIds.push(existingId);
        }
      });

      // INSERT — solo pagos nuevos. Se pide .select('id') y el ID real se
      // escribe de inmediato en cada fila del DOM: así, si _submit() se
      // dispara de nuevo más adelante (doble clic, reapertura, etc.), esa
      // misma fila ya tiene paymentId y se va a ACTUALIZAR, nunca duplicar.
      const _payGuestName = `${document.getElementById('f-firstname')?.value?.trim() ?? ''} ${document.getElementById('f-lastname')?.value?.trim() ?? ''}`.trim() || 'Huésped';
      if (newPayRows.length) {
        const { data: insertedRows, error: pmErr } = await this._withTimeout(
          this.db.from('payments').insert(newPayRows).select('id'),
          'Registrar pago'
        );
        if (pmErr) throw new Error('Error registrando pago: ' + pmErr.message);
        (insertedRows ?? []).forEach((rec, i) => {
          if (newPayRowEls[i] && rec?.id) newPayRowEls[i].dataset.paymentId = rec.id;
        });
        newPayRows.forEach(p => {
          // Si es una reserva NUEVA, no emitir notificación de pago por separado —
          // la notificación de "Reserva creada" que viene inmediatamente después
          // ya comunica todo el evento. Emitir las 2 juntas parece spam repetido.
          // Solo emitir la notificación de pago si es un cobro sobre una reserva
          // que ya existía (edición, o pago registrado más tarde).
          if (this._editingId) {
            Bus.emit(EVENTS.PAYMENT_REGISTERED, {
              bookingId: p.booking_id, guestName: _payGuestName, amount: p.amount_ars ?? p.amount, method: p.method,
            });
          }
        });
      }

      // UPDATE — pagos existentes que el usuario modificó
      for (const p of updatePayRows) {
        const { id, ...fields } = p;
        const { error: upErr } = await this._withTimeout(
          this.db.from('payments').update(fields).eq('id', id),
          'Actualizar pago'
        );
        if (upErr) throw new Error('Error actualizando pago: ' + upErr.message);
        Bus.emit(EVENTS.PAYMENT_UPDATED, {
          bookingId: fields.booking_id, guestName: _payGuestName, amount: fields.amount_ars ?? fields.amount, method: fields.method,
        });
      }

      // DELETE — pagos que el usuario quitó del formulario
      if (this._removedPaymentIds?.length) {
        const { error: delErr } = await this._withTimeout(
          this.db.from('payments').delete().in('id', this._removedPaymentIds),
          'Eliminar pago'
        );
        if (delErr) console.warn('[BookingForm] Error eliminando pagos:', delErr.message);
        this._removedPaymentIds = [];
      }

      const payRows = [...newPayRows, ...updatePayRows]; // para el cálculo de totales abajo

      const persistedPaid = payRows.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const persistedBalance = Math.max(0, total - persistedPaid);
      const persistedStatus = persistedBalance <= 0 ? 'paid' : persistedPaid > 0 ? 'partial' : 'pending';
      const { error: totalsErr } = await this._withTimeout(this.db.from('bookings').update({
        total_paid: persistedPaid,
        balance: persistedBalance,
        status: persistedStatus,
      }).eq('id', bookingId), 'Recalcular saldo');
      if (totalsErr) throw new Error('Error recalculando saldo: ' + totalsErr.message);

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

      // El formulario no sabe nada de notificaciones — solo avisa que
      // "esto pasó" con los datos reales. El motor de eventos
      // (mila-event-notifications.js) es quien decide qué mostrar.
      try {
        const guestName = `${document.getElementById('f-firstname')?.value?.trim() ?? ''} ${document.getElementById('f-lastname')?.value?.trim() ?? ''}`.trim() || 'Huésped';
        const unitNames = selectedUnits
          .map(uid => this.ctx.units?.find(u => String(u.id) === String(uid))?.name)
          .filter(Boolean)
          .join(', ') || '—';
        Bus.emit(this._editingId ? EVENTS.BOOKING_UPDATED : EVENTS.BOOKING_CREATED, {
          bookingId, guestName, unitNames, checkIn: ci, checkOut: co, pax, total,
        });
      } catch (err) {
        console.warn('[BookingForm] no se pudo emitir el evento de reserva:', err?.message ?? err);
      }

      // Estadía dividida: si esta reserva era la "Parte 1/2", abrir ahora
      // automáticamente la "Parte 2/2" con la otra unidad y el resto de
      // las fechas, con el mismo huésped precargado.
      let _splitPart2 = null;
      if (this._pendingSplitStay && !this._editingId) {
        _splitPart2 = {
          unitId:  this._pendingSplitStay.unitBId,
          checkIn:  this._pendingSplitStay.from,
          checkOut: this._pendingSplitStay.to,
          prefillGuestId: this._selectedGuestId,
          notes: `🔗 Parte 2/2 — estadía dividida con ${this._pendingSplitStay.unitAName}`,
        };
      }
      this._pendingSplitStay = null;

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

      this.close(true); // force=true: guardado exitoso, no mostrar "¿Salir sin guardar?"
      document.dispatchEvent(new CustomEvent('booking:changed'));
      // Recargar la lista de reservas explícitamente desde el form
      // (el listener de booking:changed ya no lo hace para evitar duplicados)
      setTimeout(() => window._bookingList?.load?.(), 250);

      if (_splitPart2) {
        showToast('Abriendo la 2ª reserva de la estadía dividida…', 'info');
        setTimeout(() => this.open(_splitPart2), 400);
      }

    } catch (err) {
      console.error('[MILA] Booking save error:', err);
      // Mostrar el error real siempre — ayuda a diagnosticar
      const raw = err?.message ?? String(err) ?? 'Error desconocido';
      const userMsg = raw.includes('violates foreign key')
        ? 'ID de unidad o huésped inválido. Recargá la página.'
        : raw.includes('invalid input value for enum payment_method')
        ? 'Ese método de pago no existe todavía en la base de datos — correr migration_payment_method_enum.sql en Supabase.'
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
      this._submitting = false;
      if (btn) {
        btn.disabled    = false;
        this._updateNextBtnText();
      }
      if (confirmBtn) {
        confirmBtn.disabled    = false;
        confirmBtn.textContent = 'Confirmar reserva';
      }
    }
  }
}
