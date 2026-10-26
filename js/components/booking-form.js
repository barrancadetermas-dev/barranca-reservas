
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
import { queryWithOptionalColumns, multiUnitColumns } from '../utils/db-compat.js';
import { computeBookingPricing, validateDistribution, autoDistribute, guestsText, hasUnitPricing, distributionOf, cleanLabel, unitDisplayName, unitBalances } from '../services/booking-pricing.js';
import { genderSymbolHTML } from '../utils/gender.js';
import { specialChipsHTML } from '../services/special-dates.js';
import { promoLabel, paymentPercents, pctOf, fmtPct as fmtPctPay } from '../utils/booking-display.js';
import { SplitStayEditor } from './split-stay-editor.js';
import { findConflicts } from '../services/availability-service.js';
import { getSegments, isSplit, toBookingUnitRows, segmentsSubtotal, handoffs } from '../services/stay-segments.js';
import { escapeHtml } from '../services/voucher-template.js';
import { resolveGuestCounts } from '../utils/guest-count.js';
import { friendlyDbError } from '../utils/db-errors.js';
import { stayStatus, STAY_STATUS_LABELS } from '../services/checkin-service.js';
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
    this._splitEditor = null;   // editor de cambio de departamento (lazy)
    this._hadSegments = false;  // la reserva que se edita ya tenía tramos explícitos

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
      // Editar una reserva: guardar desde CUALQUIER paso, sin tener que llegar hasta el final
      if (e.target.closest('#btn-save-now')) {
        this._submit();
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
      // Cambio de departamento durante la estadía (una sola reserva, varios tramos)
      if (e.target.closest('#btn-split-stay')) {
        this._startSplitEditor();
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
      const BASE = 'id, first_name, last_name, dni, phone, email, locality, age, car_model, car_plate, nationality';
      const { data } = await queryWithOptionalColumns(
        sel => this.db.from('guests').select(sel).eq('id', guestId).single(),
        BASE + ', gender', BASE);
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
    set('f-gender',      g.gender);
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

  /** @param {{step?:number}} [opts]  step: abre directo en ese paso (edición rápida → 3 = Precios) */
  async openEdit(bookingId, opts = {}) {
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
        this._loadBookingForEdit(bookingId),
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
      ['firstname','lastname','dni','phone','email','locality','age','car','plate','nationality','gender'].forEach(f => {
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
      // Huéspedes y ajustes propios de cada depto (migration_multiunidad.sql). Reservas viejas: todo vacío.
      this._resetAdj();
      (b.booking_units ?? []).forEach(bu => {
        this._unitAdj[String(bu.unit_id)] = {
          free: bu.free_nights || 0, disc: parseFloat(bu.discount_pct) || 0, discMode: 'pct',
          surch: parseFloat(bu.surcharge_amount) || 0, surchMode: 'amt',
          adults: bu.adults ?? null, children: bu.children ?? null, label: bu.label ?? '' };
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

      // Reserva con cambio de departamento → abrir directamente en modo tramos
      this._hadSegments = isSplit(b);
      if (this._hadSegments) {
        this._startSplitEditor(getSegments(b).map(sg => ({
          unit_id: sg.unit_id, from: sg.from, to: sg.to, pricePerNight: sg.pricePerNight,
        })));
      }
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
      // Personas: se cargan TODAS las guardadas (ver utils/guest-count.js) y se refresca el
      // contador/total. Antes el contador quedaba en el "2" del _reset aunque hubiera 4.
      const gc = resolveGuestCounts(b);
      if (document.getElementById('f-adults'))   document.getElementById('f-adults').value   = gc.adults;
      if (document.getElementById('f-children')) document.getElementById('f-children').value = gc.children;
      this._updatePaxCap?.();

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
    // Edición rápida: salta directo al paso pedido (todo lo económico y las personas por depto están en el paso 3)
    if (opts.step && this._editingId) { await new Promise(r => setTimeout(r, 0)); this._goToStep(opts.step); }
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
    // Tramos: una reserva puede pasar de un depto a otro (sigue siendo UNA reserva)
    const segs       = getSegments(booking);
    const split      = isSplit(booking);
    const segPriced  = split && segs.every(sg => sg.pricePerNight != null);
    const unitNames  = split
      ? segs.map(sg => sg.unit?.name ?? '').filter(Boolean).join(' → ')
      : (booking.booking_units ?? []).map(bu => bu.units?.name ?? '').filter(Boolean).join(', ');
    const dmShort    = iso => iso.split('-').reverse().slice(0, 2).join('/');
    const srcCfg     = SOURCE_CONFIG?.[booking.source] ?? { label: booking.source ?? 'Directo', dot: '#64748b' };
    const badgeColor = srcCfg.dot ?? srcCfg.color ?? '#64748b';
    const statusLabels = { pending:'Sin seña', partial:'Con seña', paid:'Pagado',
                           cancelled:'Cancelada', blocked:'Bloqueada' };
    const hasBadExp  = booking.guests?.bad_experience;

    // Reservas de 2+ deptos: distribución de huéspedes y desglose económico POR UNIDAD
    const _bus = booking.booking_units ?? [];
    const _distDetail = (() => {
      const d = distributionOf(booking);
      return d.length ? `<div class="detail-stay"><div class="detail-label">👥 Distribución por unidad</div>${d.map(x => `
        <div class="detail-stay-row" style="--c:${escapeHtml(x.color ?? '#6366f1')}"><span class="detail-stay-dot"></span>
          <strong>${escapeHtml(x.label || x.name)}</strong>${x.label ? `<span class="detail-stay-n" style="opacity:.7">${escapeHtml(x.name)}</span>` : ''}<span class="detail-stay-n">${guestsText(x.adults, x.children)}</span></div>`).join('')}</div>` : '';
    })();
    const _unitDetail = (hasUnitPricing(booking) && _bus.length > 1 && !split) ? (() => {
      const P = computeBookingPricing({
        nights: booking.nights ?? 0,
        units: _bus.map(bu => ({ id: String(bu.unit_id), price: bu.price_per_night || 0, freeNights: bu.free_nights,
          disc: { mode: 'pct', value: bu.discount_pct }, surch: { mode: 'amt', value: bu.surcharge_amount } })),
        collective: { freeNights: booking.free_nights, disc: { mode: 'pct', value: booking.discount_pct }, surch: { mode: 'amt', value: booking.surcharge_amount } } });
      const nm = id => { const bu = _bus.find(b => String(b.unit_id) === id); return bu ? unitDisplayName(bu) : 'Depto'; };
      const row = (a, b, color) => `<div class="detail-breakdown-row"${color ? ` style="color:${color}"` : ''}><span>${a}</span><span>${b}</span></div>`;
      const rest = (booking.total_amount ?? 0) - P.total;
      return P.perUnit.map(u => row(`${escapeHtml(nm(u.id))} · ${booking.nights} × ${formatARS(u.price)}`, formatARS(u.gross))
        + (u.freeNights > 0 ? row(`&nbsp;&nbsp;🎁 ${u.freeNights} noche${u.freeNights === 1 ? '' : 's'} sin cargo`, `−${formatARS(u.freeAmt)}`, 'var(--color-success)') : '')
        + (u.discAmt > 0 ? row(`&nbsp;&nbsp;🏷️ Descuento ${fmtPct(u.discPct)}%`, `−${formatARS(u.discAmt)}`, 'var(--color-success)') : '')
        + (u.surchAmt > 0 ? row('&nbsp;&nbsp;➕ Recargo', `+${formatARS(u.surchAmt)}`, 'var(--color-warning)') : '')
        + row(`&nbsp;&nbsp;<strong>Neto ${escapeHtml(nm(u.id))}</strong>`, `<strong>${formatARS(u.net)}</strong>`)).join('')
        + (P.collectiveSurch > 0 ? row('Recargo (toda la reserva)', `+${formatARS(P.collectiveSurch)}`, 'var(--color-warning)') : '')
        + (booking.late_checkout && rest > 0.5 ? row('Late check-out', `+${formatARS(rest)}`) : '');
    })() : null;

    // Desglose financiero completo
    const nights        = booking.nights ?? 0;
    const pricePerNight = booking.price_per_night ?? 0;
    const discPct       = booking.discount_pct ?? 0;
    const surcharge     = booking.surcharge_amount ?? 0;
    const freeNights    = booking.free_nights ?? 0;
    const billable      = Math.max(0, nights - freeNights);
    const subtotal      = segPriced ? segmentsSubtotal(segs) : pricePerNight * billable;
    const discAmt       = Math.round(subtotal * (discPct / 100));
    const total         = booking.total_amount ?? Math.max(0, subtotal - discAmt + surcharge);
    const paymentRows   = (booking.payments ?? []).filter(p => Number(p.amount) !== 0);
    const totalPaid     = paymentRows.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const balance       = Math.max(0, total - totalPaid);

    // Botones check-in/out
    // Estado de ALOJAMIENTO (independiente del de pago): misma regla que Dashboard y lista
    const stay   = stayStatus(booking, toISODate(new Date()));
    const showCI = stay === 'pending_checkin';
    const showCO = stay === 'in_house';
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
          <div class="detail-guest-name">${escapeHtml(guest)}${genderSymbolHTML(booking.guests?.gender)}</div>
          <div class="detail-meta">
            <span class="chip" style="background:${badgeColor}20;color:${badgeColor}">■ ${srcCfg.label}</span>
            <span class="detail-unit">${escapeHtml(unitNames)}</span>
          </div>
        </div>
        <div class="detail-status">
          <span class="status-badge status-${booking.status}">${statusLabels[booking.status] ?? booking.status}</span>
          ${promoLabel(booking.nights, booking.free_nights) ? `<span class="promo-badge" title="${freeNights} noche${freeNights === 1 ? '' : 's'} sin cargo">🎁 PROMO ${promoLabel(booking.nights, booking.free_nights)}</span>` : ''}
          ${['pending_checkin','in_house','checked_out'].includes(stay)
            ? `<span class="stay-badge stay-${stay}" title="Estado de alojamiento">${STAY_STATUS_LABELS[stay]}</span>` : ''}
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
          ${(booking.pax || booking.adults) ? `<br><span style="font-size:.72rem;color:var(--color-text-3)">👥 ${(() => { const gc = resolveGuestCounts(booking); return `${gc.adults} adulto${gc.adults !== 1 ? 's' : ''}${gc.children ? ` + ${gc.children} menor${gc.children !== 1 ? 'es' : ''}` : ''}`; })()}</span>` : ''}
        </div>
        <div style="text-align:right">
          <span class="detail-label">Check-out</span>
          <strong>${booking.check_out}</strong>
          ${booking.checked_out_at ? `<span style="font-size:.65rem;color:var(--color-success);display:block">✓ Registrado</span>` : ''}
        </div>
      </div>
      ${(() => { const chips = specialChipsHTML(booking.check_in, booking.check_out, { mode: 'full' }); return chips ? `<div class="detail-specials">${chips}</div>` : ''; })()}
      ${_distDetail}
      ${split ? `
      <div class="detail-stay">
        <div class="detail-label">🔀 Alojamiento · cambio de departamento</div>
        ${segs.map(sg => `
          <div class="detail-stay-row" style="--c:${escapeHtml(sg.unit?.color ?? '#6366f1')}">
            <span class="detail-stay-dot"></span>
            <span class="detail-stay-dates">${dmShort(sg.from)} → ${dmShort(sg.to)}</span>
            <strong>${escapeHtml(sg.unit?.name ?? '—')}</strong>
            <span class="detail-stay-n">${sg.nights} noche${sg.nights === 1 ? '' : 's'}</span>
          </div>`).join('')}
      </div>` : ''}
      <div class="detail-breakdown">
        ${_unitDetail ?? ''}
        ${pricePerNight > 0 && !_unitDetail ? `
          ${segPriced ? segs.map(sg => `
          <div class="detail-breakdown-row">
            <span>${escapeHtml(sg.unit?.name ?? 'Depto')} · ${sg.nights} × ${formatARS(sg.pricePerNight)}</span>
            <span>${formatARS(sg.pricePerNight * sg.nights)}</span>
          </div>`).join('') : `
          <div class="detail-breakdown-row">
            <span>Precio por noche</span>
            <span>${formatARS(pricePerNight)}</span>
          </div>
          <div class="detail-breakdown-row">
            <span>Noches${freeNights > 0 ? ` (${nights} − ${freeNights} gratis)` : ` × ${nights}`}</span>
            <span>${billable} fact.</span>
          </div>`}
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
        ${(() => { const pp = paymentPercents(totalPaid, total);
          return `${totalPaid > 0 ? `<div class="detail-breakdown-row paid-row"><span>Pagado${pp ? ` <span class="pct-tag">${fmtPctPay(pp.paidPct, { tiny: pp.tiny })}</span>` : ''}</span><span>${formatARS(totalPaid)}</span></div>` : ''}
        <div class="detail-breakdown-row balance-row" style="color:${balance > 0 ? 'var(--color-warning)' : 'var(--color-success)'}">
          <span>${balance > 0 ? '⚠ Saldo pendiente' : '✓ Saldado'}${pp ? ` <span class="pct-tag">${balance > 0 ? 'resta ' + fmtPctPay(pp.restPct) : '100% abonado'}</span>` : ''}</span>
          <span style="font-size:1.05rem">${formatARS(Math.abs(balance))}</span>
        </div>`; })()}
      </div>
      ${booking.notes ? `<div class="detail-notes"><span class="detail-label">Notas</span><p>${escapeHtml(booking.notes)}</p></div>` : ''}
    `;

    // Reservas de 2+ deptos: cuánto corresponde, cuánto se pagó y cuánto falta en CADA depto
    if (_bus.length > 1) {
      const bal = unitBalances(booking, booking.payments ?? []);
      const nmOf = id => { const bu = _bus.find(b => String(b.unit_id) === id); return bu ? unitDisplayName(bu) : 'Depto'; };
      body.innerHTML += `<div class="detail-payments"><div class="detail-label" style="margin-bottom:8px">💰 Saldo por unidad</div>
        ${bal.map(u => `<div class="pay-row-detail" style="display:grid;grid-template-columns:1fr auto auto auto;gap:10px;align-items:center">
          <strong>${escapeHtml(nmOf(u.unitId))}</strong>
          <span style="font-size:.72rem;color:var(--color-text-3)">Corresponde ${formatARS(u.due)}</span>
          <span style="font-size:.72rem;color:var(--color-success)">Pagado ${formatARS(u.paid)}</span>
          <span style="font-weight:800;color:${u.balance > 0 ? 'var(--color-warning)' : 'var(--color-success)'}">${u.balance > 0 ? 'Saldo ' + formatARS(u.balance) : (u.over > 0 ? 'A favor ' + formatARS(u.over) : 'Pagado')}</span>
        </div>`).join('')}
        <div style="font-size:.66rem;color:var(--color-text-3);margin-top:4px">Los pagos generales (sin depto asignado) se reparten en proporción a lo que corresponde a cada depto.</div></div>`;
    }

    if (paymentRows.length) {
      const payHtml = paymentRows
        .map(p => {
          const pm    = PAYMENT_METHODS.find(m => m.value === p.method)?.label ?? p.method;
          const isNeg = p.amount < 0;
          return `<div class="pay-row-detail">
            <span>${isNeg ? '↩ Devolución' : pm}</span>
            <span style="font-size:.72rem;color:var(--color-text-3)">${p.payment_date ?? ''}</span>
            <span style="color:${isNeg?'var(--color-warning)':'var(--color-success)'};font-weight:600">${isNeg?'−':'+'}${formatARS(Math.abs(p.amount))}${(() => { const pc = pctOf(Math.abs(p.amount_ars ?? p.amount), total); return pc != null ? ` <span class="pct-tag" title="Porcentaje del total de la estadía">${isNeg ? '−' : ''}${fmtPctPay(pc)}</span>` : ''; })()}</span>
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
    this._hadSegments = false;
    this._splitEditor?.deactivate({ silent: true });
    this._setSplitUi(false);

    // Volver al modo de precio único (single unit) por defecto
    const singleWrap = document.getElementById('f-price-single-wrap');
    const multiWrap  = document.getElementById('f-price-multi-wrap');
    if (singleWrap) { singleWrap.classList.remove('hidden'); singleWrap.style.display = ''; }
    if (multiWrap)  { multiWrap.classList.add('hidden');     multiWrap.style.display  = 'none'; }

    ['f-firstname','f-lastname','f-dni','f-phone','f-email','f-notes',
     'f-locality','f-age','f-car','f-plate','f-nationality','f-gender',
     'f-price','f-discount','f-surcharge','f-free-nights','f-deposit',
     'f-checkin','f-checkout'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = ['f-discount','f-surcharge','f-free-nights','f-deposit'].includes(id) ? '0' : '';
    });
    this._resetAdj();
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
          // Con cambio de depto activo, los tramos siguen las fechas (solo cuando el rango está completo)
          if (start && end && this._isSplit()) this._splitEditor.setWindow(start, end);
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
  // encuentra una, ofrece el botón 🔀 que convierte ESTA reserva en una sola
  // reserva con dos tramos (cambio de departamento), sin duplicarla.
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
      ? `Una sola reserva: cambia a ${label(candidates[0])} para completar el pedido`
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

  // Sugerencia 🔀 → en lugar de armar 2 reservas, pasa esta MISMA reserva a
  // modo "cambio de departamento": la unidad A cubre la parte libre y la unidad B
  // el resto, con las fechas completas del pedido.
  _startSplitStay(unitAId, partial, unitBId, unitBName, missing) {
    const ci = document.getElementById('f-checkin')?.value;
    const co = document.getElementById('f-checkout')?.value;
    const price = parseFloat(document.getElementById('f-price')?.value) || 0;
    // A cubre [partial.from, partial.to); B cubre lo que falta (antes o después)
    const aFirst = partial.from === ci;
    const segs = aFirst
      ? [{ unit_id: String(unitAId), from: ci, to: partial.to, pricePerNight: price || null },
         { unit_id: String(unitBId), from: partial.to, to: co, pricePerNight: price || null }]
      : [{ unit_id: String(unitBId), from: ci, to: partial.from, pricePerNight: price || null },
         { unit_id: String(unitAId), from: partial.from, to: co, pricePerNight: price || null }];
    this._startSplitEditor(segs);
  }

  // ═══ Cambio de departamento durante la estadía (una sola reserva, varios tramos) ═══
  _split() {
    const structureEl = document.getElementById('split-stay-structure');
    const priceEl     = document.getElementById('split-stay-prices');
    if (!structureEl || !priceEl) return null;
    if (!this._splitEditor || this._splitEditor.structureEl !== structureEl) {
      this._splitEditor = new SplitStayEditor({
        structureEl, priceEl,
        getUnits: () => this.ctx?.units ?? [],
        checkConflicts: (segments) => findConflicts(this.db, segments, { excludeBookingId: this._editingId }),
        onChange: (segments, extra) => this._onSplitChange(segments, extra),
        toast: (m, t) => showToast(m, t ?? 'info'),
      });
    }
    return this._splitEditor;
  }

  _isSplit() { return !!this._splitEditor?.active; }

  /** Banner de error fijo dentro del formulario ('' lo oculta). */
  _showSubmitError(msg) {
    const el = document.getElementById('booking-form-error');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }

  /** Texto de departamentos de la reserva en curso (con fechas si hay cambio de depto). */
  _unitsText(sep = ', ') {
    const units = this.ctx?.units ?? [];
    if (this._isSplit()) {
      const dm = iso => iso.split('-').reverse().slice(0, 2).join('/');
      return this._splitEditor.getSegments().map(sg =>
        `${units.find(u => String(u.id) === sg.unit_id)?.name ?? 'Depto'} (${dm(sg.from)} → ${dm(sg.to)})`).join(' + ');
    }
    return units.filter(u => this._selectedUnitIds.has(String(u.id))).map(u => u.name).join(sep);
  }

  /** Muestra/oculta la interfaz según haya o no cambio de depto. */
  _setSplitUi(active) {
    const units = document.getElementById('units-selector');
    const btn   = document.getElementById('btn-split-stay');
    if (units) units.style.display = active ? 'none' : '';
    if (btn)   btn.style.display   = active ? 'none' : '';
    const sp = document.getElementById('split-stay-prices');
    if (sp) sp.style.display = active ? '' : 'none';
  }

  /** @param {Array|null} segments  tramos ya armados (sugerencia 🔀 o edición); si no, parte desde la unidad elegida */
  _startSplitEditor(segments = null) {
    const ed = this._split(); if (!ed) return;
    const ci = document.getElementById('f-checkin')?.value;
    const co = document.getElementById('f-checkout')?.value;
    if (!ci || !co || ci >= co) { showToast('Elegí primero las fechas de la estadía', 'warning'); return; }
    if (!segments) {
      if (this._selectedUnitIds.size === 0) { showToast('Elegí primero el departamento donde empieza la estadía', 'warning'); return; }
      if (this._selectedUnitIds.size > 1)   { showToast('Para cambiar de departamento dejá seleccionado uno solo (el de la primera parte)', 'warning'); return; }
    }
    const price = parseFloat(document.getElementById('f-price')?.value) || 0;
    const ok = ed.activate({ checkIn: ci, checkOut: co, segments, firstUnitId: [...this._selectedUnitIds][0], price });
    if (!ok) return;
    this._setSplitUi(true);
    this._updateBlockedDates();
    this._renderPerUnitPrices();
  }

  /** El editor avisó un cambio (tramos nuevos, precios, o salida del modo). */
  _onSplitChange(segments, extra = {}) {
    if (!segments?.length) {
      // Salida del modo: volver a un solo depto
      const first = extra.exitedTo ?? null;
      this._selectedUnitIds = new Set(first ? [String(first)] : []);
      this._unitPrices = {};
      this._resetAdj();
      this._setSplitUi(false);
      this._renderUnitSelector();
      this._renderPerUnitPrices();
      this._updateBlockedDates();
      this._renderUnitAvailability();
      this._updateBreakdown();
      return;
    }
    this._selectedUnitIds = new Set(segments.map(sg => sg.unit_id));
    this._unitPrices = {};
    this._resetAdj();
    segments.forEach(sg => { if (sg.pricePerNight) this._unitPrices[sg.unit_id] = sg.pricePerNight; });
    this._syncSplitPrice(segments);
    this._updatePaxCap?.();
    this._renderPaxSelector?.();
  }

  /**
   * f-price sigue siendo la fuente del resto del formulario (desglose, total):
   * en cambio de depto vale el promedio por noche de los tramos. Se redondea
   * HACIA ABAJO a centavos para que el total guardado nunca supere al cotizado.
   */
  _syncSplitPrice(segments) {
    const field = document.getElementById('f-price');
    if (!field) return;
    const nights = segments.reduce((n, sg) => n + sg.nights, 0);
    const priced = segments.every(sg => sg.pricePerNight > 0);
    if (!priced || !nights) { field.value = ''; this._updateBreakdown(); return; }
    const subtotal = segments.reduce((sum, sg) => sum + sg.pricePerNight * sg.nights, 0);
    field.value = String(Math.floor((subtotal / nights) * 100) / 100);
    this._updateBreakdown();
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
        if (this._isSplit()) return; // con cambio de depto, las unidades se eligen en el editor de tramos
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
  _renderPerUnitPrices() { this._renderPerUnitPricesCore(); this._renderUnitAdjustUI?.(); }

  _renderPerUnitPricesCore() {
    const singleWrap = document.getElementById('f-price-single-wrap');
    const multiWrap  = document.getElementById('f-price-multi-wrap');
    const rowsWrap   = document.getElementById('per-unit-price-rows');
    if (!singleWrap || !multiWrap || !rowsWrap) return;

    // Cambio de depto: el precio se carga por tramo (editor), no por unidad simultánea
    if (this._isSplit()) {
      singleWrap.classList.add('hidden');  singleWrap.style.display = 'none';
      multiWrap.classList.add('hidden');   multiWrap.style.display  = 'none';
      return;
    }

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
    if (this._isSplit()) return; // en cambio de depto f-price lo calcula _syncSplitPrice
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
      // Cambio de depto: el grupo entero está en UN depto a la vez → manda el más chico
      if (this._isSplit()) {
        const caps = [...this._selectedUnitIds]
          .map(uid => units.find(u => String(u.id) === String(uid))?.max_guests).filter(Boolean);
        return caps.length ? Math.min(...caps) : 99;
      }
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
    if (this._isSplit()) return; // el precio sale de los tramos
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
    if (!this._datePicker) return;
    // Cambio de depto: cada tramo tiene su unidad y sus fechas, así que no se
    // grisan días en el calendario; el editor avisa tramo por tramo si hay choque.
    if (this._isSplit()) { this._datePicker.setBlockedDates([]); return; }
    if (!this._selectedUnitIds.size) return;
    const unitIds = [...this._selectedUnitIds];
    const today   = toISODate(new Date());
    try {
      const SEL = (seg) => `id, check_in, check_out, booking_units(unit_id${seg ? ', segment_check_in, segment_check_out' : ''})`;
      const { data } = await queryWithOptionalColumns(
        sel => this.db
          .from('bookings')
          .select(sel)
          .eq('hotel_id', this.ctx.hotelId)
          .neq('status', 'cancelled')
          .gte('check_out', today),
        SEL(true), SEL(false));

      if (!data) return;
      const blocked = new Set();
      data.forEach(b => {
        if (this._editingId && b.id === this._editingId) return;
        // Solo las noches que la reserva realmente ocupa en las unidades elegidas
        getSegments(b).filter(seg => unitIds.includes(String(seg.unit_id))).forEach(seg => {
          let d = new Date(seg.from + 'T00:00:00');
          const end = new Date(seg.to + 'T00:00:00');
          while (d < end) { blocked.add(toISODate(d)); d.setDate(d.getDate() + 1); }
        });
      });
      this._datePicker.setBlockedDates([...blocked]);
    } catch (_) {}
  }

  // ── Navegación de pasos — LIBRE (sin validación forzada) ──
  _goToStep(step) {
    this._showSubmitError('');
    // El paso 2 usa dos columnas en pantallas anchas: el modal se ensancha solo en ese paso
    document.getElementById('modal-booking')?.classList.toggle('s2-wide', step === 2);
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
    // "Guardar cambios" directo: solo al EDITAR y en los pasos 1 a 3 (en el 4 el botón principal ya guarda)
    document.getElementById('btn-save-now')?.classList.toggle('hidden', !(this._editingId && this._currentStep < 4));
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
    if (this._isSplit()) {
      const sv = this._splitEditor.validate();
      if (!sv.ok) {
        const msg = sv.errors[0];
        if (!firstStep || (/precio/i.test(msg) ? 3 : 2) < firstStep.step) firstStep = { step: /precio/i.test(msg) ? 3 : 2, msg };
      }
    } else if (!price || price <= 0) fail('f-price', 3, 'Ingresá el precio por noche');
    if (!this._isSplit() && this._selectedUnitIds.size >= 2) {
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

  // ══════════════════════════════════════════════════════════════
  // Reservas de 2+ deptos: ajustes y huéspedes POR UNIDAD
  // Estado: lo colectivo (toda la reserva) en this._coll, lo de cada depto en this._unitAdj[uid].
  // Los campos f-free-nights / f-discount / f-surcharge muestran el valor de "a quién se aplica"
  // (toda la reserva o un depto) según el selector de alcance. El cálculo es único: booking-pricing.js
  // ══════════════════════════════════════════════════════════════
  _resetAdj() {
    this._coll = { free: 0, disc: 0, discMode: 'pct', surch: 0, surchMode: 'amt' };
    this._unitAdj = {};
    this._scope = { free: 'all', disc: 'all', surch: 'all' };
    this._scopeUnit = { free: null, disc: null, surch: null };
  }

  _isMulti() { return this._selectedUnitIds?.size >= 2 && !this._isSplit(); }

  /** Nombre para el huésped/voucher: nombre propio + nombre del depto ("Depto de los abuelos · 2AMB Planta Baja"). */
  _unitLabelFull(uid) {
    const base = this.ctx?.units?.find(u => String(u.id) === String(uid))?.name ?? 'Depto';
    const lbl = cleanLabel(this._unitAdj?.[String(uid)]?.label);
    return lbl ? `${lbl} · ${base}` : base;
  }

  _unitLabel(uid) {
    const u = this.ctx?.units?.find(x => String(x.id) === String(uid));
    const lbl = cleanLabel(this._unitAdj?.[String(uid)]?.label);   // nombre propio dentro de la reserva (ej.: "Depto de los abuelos")
    if (lbl) return `${lbl}${u?.sort_order != null ? ' (#' + u.sort_order + ')' : ''}`;
    return u ? `${u.name}${u.sort_order != null ? ' #' + u.sort_order : ''}` : 'Depto';
  }

  /** Objeto donde se guarda lo que muestra el campo de cada concepto (toda la reserva o un depto). */
  _adjTarget(concept) {
    if (!this._coll) this._resetAdj();
    const uid = this._scopeUnit[concept];
    if (this._isMulti() && this._scope[concept] === 'unit' && uid) return (this._unitAdj[uid] ??= {});
    return this._coll;
  }

  /** Lo escrito en los campos → estado (en el destino que corresponda a cada concepto). */
  _syncAdjFromDom() {
    if (this._adjLoading) return;
    if (!this._coll) this._resetAdj();
    const v = id => document.getElementById(id)?.value;
    Object.assign(this._adjTarget('free'),  { free: parseInt(v('f-free-nights')) || 0 });
    Object.assign(this._adjTarget('disc'),  { disc: parseFloat(v('f-discount')) || 0, discMode: v('f-discount-mode') || 'pct' });
    Object.assign(this._adjTarget('surch'), { surch: parseFloat(v('f-surcharge')) || 0, surchMode: v('f-surcharge-mode') || 'amt' });
  }

  /** Estado → campos (al cambiar el alcance o el depto elegido). */
  _loadAdjToDom(concept) {
    const t = this._adjTarget(concept);
    this._adjLoading = true;
    try {
      if (concept === 'free') document.getElementById('f-free-nights').value = t.free ?? 0;
      if (concept === 'disc') {
        (t.discMode === 'amt' ? window._discModeAmt : window._discModePct)?.();
        document.getElementById('f-discount').value = t.disc ?? 0;
      }
      if (concept === 'surch') {
        (t.surchMode === 'pct' ? window._surchModePct : window._surchModeAmt)?.();
        document.getElementById('f-surcharge').value = t.surch ?? 0;
      }
    } finally { this._adjLoading = false; }
  }

  /** Entradas del cálculo leídas del formulario + resultado de services/booking-pricing.js */
  _pricing() {
    this._syncAdjFromDom();
    const val = id => document.getElementById(id)?.value;
    const ci = val('f-checkin'), co = val('f-checkout');
    const nights = ci && co ? Math.max(0, Math.round((new Date(co) - new Date(ci)) / 86400000)) : 0;
    const price = parseFloat(val('f-price')) || 0;
    const multi = this._isMulti();
    const A = this._unitAdj ?? {};
    const units = multi
      ? [...this._selectedUnitIds].map(uid => ({
          id: String(uid), price: parseFloat(this._unitPrices[uid]) || 0, freeNights: A[uid]?.free || 0,
          disc:  { mode: A[uid]?.discMode  || 'pct', value: A[uid]?.disc  || 0 },
          surch: { mode: A[uid]?.surchMode || 'amt', value: A[uid]?.surch || 0 } }))
      : [{ id: 'all', price }];
    const c = this._coll;
    const lateChecked = document.getElementById('f-late-checkout')?.checked ?? false;
    const latePaid    = lateChecked && (document.getElementById('f-late-checkout-paid')?.checked ?? true);
    const lateAmt     = latePaid ? Math.round(parseFloat(val('f-late-checkout-amount')) || (price * 0.5)) : 0;
    const P = computeBookingPricing({
      nights, units, late: lateAmt,
      collective: { freeNights: c.free, disc: { mode: c.discMode, value: c.disc }, surch: { mode: c.surchMode, value: c.surch } } });
    return { P, nights, price, ci, co, lateChecked, latePaid, lateAmt };
  }

  /** Columnas por unidad que se guardan en booking_units (solo con 2+ deptos). */
  _unitRowExtras(uid, P, multi) {
    if (!multi) return { ...(this._lblOk ? { label: null } : {}), adults: null, children: null, free_nights: null, discount_pct: null, surcharge_amount: null };
    const a = this._unitAdj[uid] ?? {};
    const pu = P.perUnit.find(x => x.id === String(uid));
    return {
      ...(this._lblOk ? { label: cleanLabel(a.label) || null } : {}),
      adults: a.adults ?? null, children: a.children ?? null,
      free_nights: P.unitMode ? (a.free || 0) : 0,
      discount_pct: P.unitMode ? (pu?.unitDiscPct || 0) : 0,
      surcharge_amount: P.unitMode ? (pu?.surchAmt || 0) : 0 };
  }

  /** ¿La base ya tiene las columnas de migration_multiunidad.sql? (se consulta una vez) */
  async _multiUnitSupported() {
    if (this._muSupport === true && this._lblOk !== undefined) return true;
    try {
      const [a, b] = await Promise.all([
        this.db.from('booking_units').select('adults').limit(1),
        this.db.from('bookings').select('unit_pricing').limit(1)]);
      const ok = !a.error && !b.error;
      if (ok) this._muSupport = true;
      const l = await this.db.from('booking_units').select('label').limit(1);   // nombre propio del depto (migration_multiunidad_nombre.sql)
      this._lblOk = !l.error;
      return ok;
    } catch { return false; }
  }

  async _loadBookingForEdit(bookingId) {
    const run = sel => this.db.from('bookings').select(sel).eq('id', bookingId).single();
    const MU = await multiUnitColumns(this.db);
    return queryWithOptionalColumns(run,
      `*, guests!bookings_guest_id_fkey(*), booking_units(unit_id, price_per_night, segment_check_in, segment_check_out${MU})`,
      '*, guests!bookings_guest_id_fkey(*), booking_units(unit_id, price_per_night)');
  }

  // ── Distribución de huéspedes ──
  _distributionCheck() {
    const rows = [...this._selectedUnitIds].map(uid => ({
      id: String(uid), name: this._unitLabel(uid),
      adults: this._unitAdj[uid]?.adults ?? null, children: this._unitAdj[uid]?.children ?? null,
      maxGuests: this.ctx?.units?.find(x => String(x.id) === String(uid))?.max_guests ?? null }));
    return validateDistribution({
      adults: parseInt(document.getElementById('f-adults')?.value) || 0,
      children: parseInt(document.getElementById('f-children')?.value) || 0 }, rows);
  }
  /** [{name, text}] por depto, solo si hay distribución cargada (para voucher y resumen). */
  _distributionLines() {
    if (!this._isMulti() || !this._distributionCheck().loaded) return [];
    return [...this._selectedUnitIds].map(uid => ({
      name: this._unitLabel(uid), text: guestsText(this._unitAdj[uid]?.adults, this._unitAdj[uid]?.children) }));
  }
  _distributionHTML() {
    const d = this._distributionLines();
    return d.length ? `<div class="voucher-row-sm">👥 ${d.map(x => `${escapeHtml(x.name)}: ${escapeHtml(x.text)}`).join(' · ')}</div>` : '';
  }

  // ── UI: alcance de cada concepto + "Distribución por unidad" ──
  _renderUnitAdjustUI() {
    const scopeWrap = document.getElementById('unit-scope-wrap');
    const distWrap  = document.getElementById('unit-dist-wrap');
    if (!scopeWrap || !distWrap) return;
    if (!this._coll) this._resetAdj();
    const multi = this._isMulti();
    scopeWrap.style.display = multi ? '' : 'none';
    distWrap.style.display  = multi ? '' : 'none';
    const concepts = ['free', 'disc', 'surch'];
    const ids = multi ? [...this._selectedUnitIds].map(String) : [];
    // Un solo depto / cambio de depto: todo vuelve a "toda la reserva" (como siempre)
    concepts.forEach(c => {
      if (this._scope[c] === 'unit' && (!multi || !ids.includes(this._scopeUnit[c]))) {
        this._scope[c] = 'all'; this._scopeUnit[c] = null; this._loadAdjToDom(c);
      }
    });
    if (!multi) { document.querySelectorAll('.ms-inline').forEach(e => e.remove()); scopeWrap.innerHTML = ''; distWrap.innerHTML = ''; return; }

    // Alcance de cada concepto: control compacto DEBAJO de cada campo (Noches sin cargo · Descuento · Recargo)
    const hosts = { free: 'f-free-nights', disc: 'f-discount', surch: 'f-surcharge' };
    const names = { free: 'las noches sin cargo', disc: 'el descuento', surch: 'el recargo' };
    concepts.forEach(c => {
      const grp = document.getElementById(hosts[c])?.closest('.form-group');
      if (!grp) return;
      let host = grp.querySelector(`.ms-inline[data-concept="${c}"]`);
      if (!host) { host = document.createElement('div'); host.className = 'ms-inline'; host.dataset.concept = c; grp.appendChild(host); }
      const on = k => this._scope[c] === k ? 'on' : '';
      host.innerHTML = `
        <span class="ms-seg">
          <button type="button" data-scope="all"  class="${on('all')}"  title="Aplicar ${names[c]} a toda la reserva">Toda</button>
          <button type="button" data-scope="unit" class="${on('unit')}" title="Aplicar ${names[c]} a un solo depto">Un depto</button>
        </span>
        ${this._scope[c] === 'unit' ? `<select class="ms-unit">${ids.map(uid => `<option value="${uid}" ${this._scopeUnit[c] === uid ? 'selected' : ''}>${escapeHtml(this._unitLabel(uid))}</option>`).join('')}</select>` : ''}`;
      host.querySelectorAll('[data-scope]').forEach(btn => btn.addEventListener('click', () => {
        this._syncAdjFromDom();                       // guarda lo que se estaba editando
        this._scope[c] = btn.dataset.scope;
        this._scopeUnit[c] = btn.dataset.scope === 'unit' ? (this._scopeUnit[c] && ids.includes(this._scopeUnit[c]) ? this._scopeUnit[c] : ids[0]) : null;
        this._loadAdjToDom(c);
        this._renderUnitAdjustUI(); this._updateBreakdown();
      }));
      host.querySelector('.ms-unit')?.addEventListener('change', (e) => {
        this._syncAdjFromDom();
        this._scopeUnit[c] = e.target.value;
        this._loadAdjToDom(c);
        this._renderUnitAdjustUI(); this._updateBreakdown();
      });
    });
    scopeWrap.innerHTML = '<div class="ms-applied" id="ms-applied"></div>';

    distWrap.innerHTML = `
      <details class="ud" open>
        <summary>👥 Distribución por unidad <span class="ud-chips" id="ud-chips"></span></summary>
        <div class="ud-actions"><button type="button" id="ud-auto">Repartir automáticamente</button>
          <small>Opcional · para armar cada depto. La suma debe coincidir con el total de personas.</small></div>
        <div class="ud-t">
          <div class="ud-th"><span>Depto</span><span>Nombre en esta reserva</span><span>Ad.</span><span>Ni.</span><span>Cap.</span></div>
          ${ids.map(uid => {
            const u = this.ctx.units.find(x => String(x.id) === uid); const a = this._unitAdj[uid] ?? {};
            return `<div class="ud-tr" data-uid="${uid}">
              <b class="ud-name" data-uid="${uid}" style="--dot:${escapeHtml(u?.color ?? '#6366f1')}">${escapeHtml(this._unitLabel(uid))}</b>
              <input type="text" class="ud-lbl" data-uid="${uid}" maxlength="40" placeholder="${escapeHtml(u?.name ?? 'Opcional')}" value="${escapeHtml(a.label ?? '')}" title="Nombre para identificar este depto dentro de la reserva (ej.: Depto de los abuelos)">
              <input type="number" min="0" max="20" class="ud-in" data-uid="${uid}" data-f="adults" placeholder="—" value="${a.adults ?? ''}" title="Adultos">
              <input type="number" min="0" max="20" class="ud-in" data-uid="${uid}" data-f="children" placeholder="—" value="${a.children ?? ''}" title="Niños">
              <span class="ud-cap-pill empty" data-uid="${uid}">—</span></div>`; }).join('')}
        </div>
        <div id="ud-warn"></div>
        <div id="ud-table"></div>
      </details>`;
    distWrap.querySelectorAll('.ud-lbl').forEach(inp => inp.addEventListener('input', () => {
      (this._unitAdj[inp.dataset.uid] ??= {}).label = inp.value;
      this._refreshUnitNames();
    }));
    distWrap.querySelectorAll('.ud-in').forEach(inp => inp.addEventListener('input', () => {
      const a = (this._unitAdj[inp.dataset.uid] ??= {});
      a[inp.dataset.f] = inp.value === '' ? null : Math.max(0, parseInt(inp.value) || 0);
      this._refreshUnitDistStatus();
    }));
    document.getElementById('ud-auto')?.addEventListener('click', () => {
      const tot = { adults: parseInt(document.getElementById('f-adults')?.value) || 0, children: parseInt(document.getElementById('f-children')?.value) || 0 };
      autoDistribute(tot, ids.map(uid => ({ id: uid, maxGuests: this.ctx.units.find(x => String(x.id) === uid)?.max_guests ?? null })))
        .forEach(r => { const a = (this._unitAdj[r.id] ??= {}); a.adults = r.adults; a.children = r.children; });
      this._renderUnitAdjustUI();
    });
    this._refreshUnitDistStatus();
  }

  /** Refleja el nombre propio de cada depto en encabezados y selectores sin volver a dibujar (no pierde el foco). */
  _refreshUnitNames() {
    [...(this._selectedUnitIds ?? [])].map(String).forEach(uid => {
      const nm = this._unitLabel(uid);
      document.querySelectorAll(`.ud-name[data-uid="${uid}"]`).forEach(el => { el.textContent = nm; });
      document.querySelectorAll(`.ms-inline option[value="${uid}"]`).forEach(o => { o.textContent = nm; });
    });
    this._refreshUnitDistStatus();
  }

  /** Actualiza chips, avisos, capacidad y tabla por unidad sin volver a dibujar los campos. */
  _refreshUnitDistStatus() {
    if (!this._isMulti()) return;
    const q = s => document.getElementById(s);
    if (!q('ud-chips')) return;
    const fmt = n => formatARS(n);
    const { P } = this._pricing();
    const chk = this._distributionCheck();
    const totA = parseInt(q('f-adults')?.value) || 0, totC = parseInt(q('f-children')?.value) || 0;
    const chip = (ok, text) => `<span class="ud-chip ${ok ? 'ok' : 'warn'}">${text}</span>`;
    q('ud-chips').innerHTML = chk.loaded
      ? chip(chk.assignedAdults === totA, `Adultos ${chk.assignedAdults}/${totA}`) + chip(chk.assignedChildren === totC, `Niños ${chk.assignedChildren}/${totC}`)
      : '<span class="ud-chip">sin distribuir</span>';
    [...this._selectedUnitIds].map(String).forEach(uid => {
      const a = this._unitAdj[uid] ?? {};
      const u = this.ctx.units.find(x => String(x.id) === uid);
      const occ = (a.adults || 0) + (a.children || 0), cap = u?.max_guests ?? 0;
      const sum = document.querySelector(`.ud-sum[data-uid="${uid}"]`);
      if (sum) sum.textContent = (a.adults != null || a.children != null) ? `${guestsText(a.adults, a.children)}${cap ? ` · ${occ}/${cap}` : ''}` : 'sin distribuir';
      const pill = document.querySelector(`.ud-cap-pill[data-uid="${uid}"]`);
      if (pill) {
        pill.textContent = (a.adults != null || a.children != null) ? (cap ? `${occ}/${cap}` : String(occ)) : (cap ? `—/${cap}` : '—');
        pill.className = 'ud-cap-pill ' + ((a.adults == null && a.children == null) ? 'empty' : (cap && occ > cap ? 'bad' : ''));
      }
      const bar = document.querySelector(`.ud-capbar i[data-uid="${uid}"]`);
      if (bar) { bar.style.width = cap ? Math.min(100, occ / cap * 100) + '%' : '0'; bar.style.background = cap && occ > cap ? '#dc2626' : '#16a34a'; }
      const capt = document.querySelector(`.ud-capt[data-uid="${uid}"]`);
      if (capt) capt.textContent = cap ? `Capacidad del depto: ${cap} · ocupa ${occ}` : '';
      const pu = P.perUnit.find(x => x.id === uid);
      const tags = document.querySelector(`.ud-tags[data-uid="${uid}"]`);
      if (tags) {
        const own = [];
        if (a.free > 0) own.push(`🎁 ${a.free} noche${a.free !== 1 ? 's' : ''} sin cargo`);
        if (pu?.unitDiscPct > 0) own.push(`🏷️ Descuento ${fmtPct(pu.unitDiscPct)}%`);
        if (pu?.surchAmt > 0 && P.unitMode) own.push(`➕ Recargo ${fmt(pu.surchAmt)}`);
        tags.innerHTML = own.length ? own.map(t => `<span class="ud-tag">${t}</span>`).join('') + '<small>solo este depto</small>' : '<small>Sin ajustes propios</small>';
      }
    });
    q('ud-warn').innerHTML = chk.warnings.map(w => `<div class="ud-alert ${w.blocking ? 'bad' : 'warn'}">${w.blocking ? '⛔' : '⚠️'} ${escapeHtml(w.text)}</div>`).join('');
    // Resumen de lo aplicado
    const ap = q('ms-applied');
    if (ap) {
      const c = this._coll, items = [];
      if (c.free > 0)  items.push(`<span class="ud-tag">Toda la reserva · 🎁 ${c.free} sin cargo</span>`);
      if (c.disc > 0)  items.push(`<span class="ud-tag">Toda la reserva · 🏷️ ${c.discMode === 'amt' ? fmt(c.disc) : fmtPct(c.disc) + '%'}</span>`);
      if (c.surch > 0) items.push(`<span class="ud-tag">Toda la reserva · ➕ ${c.surchMode === 'pct' ? fmtPct(c.surch) + '%' : fmt(c.surch)}</span>`);
      [...this._selectedUnitIds].map(String).forEach(uid => {
        const a = this._unitAdj[uid] ?? {}, n = this._unitLabel(uid);
        if (a.free > 0)  items.push(`<span class="ud-tag">${escapeHtml(n)} · 🎁 ${a.free} sin cargo</span>`);
        if (a.disc > 0)  items.push(`<span class="ud-tag">${escapeHtml(n)} · 🏷️ ${a.discMode === 'amt' ? fmt(a.disc) : fmtPct(a.disc) + '%'}</span>`);
        if (a.surch > 0) items.push(`<span class="ud-tag">${escapeHtml(n)} · ➕ ${a.surchMode === 'pct' ? fmtPct(a.surch) + '%' : fmt(a.surch)}</span>`);
      });
      ap.innerHTML = items.length ? `<small>Aplicado:</small> ${items.join('')}` : '';
    }
    // Tabla por unidad (solo cuando hay ajustes propios de algún depto)
    const tbl = q('ud-table');
    if (tbl) tbl.innerHTML = P.unitMode ? `
      <table class="ud-table"><thead><tr><th>Depto</th><th>Subtotal</th><th>Sin cargo</th><th>Desc.</th><th>Recargo</th><th>Neto</th></tr></thead><tbody>
        ${P.perUnit.map(u => `<tr><td>${escapeHtml(this._unitLabel(u.id))}</td><td>${fmt(u.gross)}</td>
          <td>${u.freeAmt ? '−' + fmt(u.freeAmt) : '—'}</td><td>${u.discAmt ? '−' + fmt(u.discAmt) : '—'}</td>
          <td>${u.surchAmt ? '+' + fmt(u.surchAmt) : '—'}</td><td><b>${fmt(u.net)}</b></td></tr>`).join('')}
        ${P.collectiveSurch > 0 ? `<tr><td colspan="5">Recargo de toda la reserva</td><td>+${fmt(P.collectiveSurch)}</td></tr>` : ''}
        <tr class="tot"><td colspan="5">Total (sin late check-out ni pagos)</td><td>${fmt(P.total - P.late)}</td></tr>
      </tbody></table>` : '';
  }

  // ── Precio breakdown ──────────────────────────────
  _updateBreakdown() {
    const { P, nights, price, ci, co, lateChecked, latePaid, lateAmt } = this._pricing();
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

    if (!ci || !co || !price) {
      ['pb-nights','pb-subtotal','pb-discount','pb-surcharge','pb-total','pb-free-nights','pb-late-checkout']
        .forEach(id => set(id, '—'));
      this._refreshUnitDistStatus?.();
      return;
    }

    const freeAmt = P.freeAmt, discAmt = P.discAmt, surch = P.surchAmt;
    set('pb-nights',       `${nights} noche${nights !== 1 ? 's' : ''}${lateChecked ? ' + ½' : ''}`);
    set('pb-subtotal',     formatARS(P.subtotal));
    set('pb-free-nights',  freeAmt > 0 ? `−${formatARS(freeAmt)}` : '—');
    set('pb-discount',     discAmt > 0 ? (P.unitMode ? `−${formatARS(discAmt)}` : `−${formatARS(discAmt)} (${fmtPct(P.discPct)}%)`) : '—');
    set('pb-surcharge',    surch > 0 ? `+${formatARS(surch)}` : '—');
    set('pb-late-checkout', latePaid ? `+${formatARS(lateAmt)}` : lateChecked ? 'Sin cargo' : '—');
    set('pb-total',        formatARS(P.total));

    document.getElementById('pbr-free-nights')?.style.setProperty('display', freeAmt > 0 ? '' : 'none');
    document.getElementById('pbr-discount')?.style.setProperty('display',    discAmt > 0 ? '' : 'none');
    document.getElementById('pbr-surcharge')?.style.setProperty('display',   surch > 0 ? '' : 'none');
    document.getElementById('pbr-late-checkout')?.style.setProperty('display', lateChecked ? '' : 'none');

    this._cachedTotal = P.total;
    this._updatePaymentSummary();
    this._refreshUnitDistStatus?.();
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
        <span class="pay-pct" title="Porcentaje del total de la estadía que representa este pago"></span>
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

    // Porcentaje del total de la estadía: por cada pago y en el resumen (abonado / resta)
    document.querySelectorAll('.payment-row').forEach(row => {
      const raw  = parseFloat(row.querySelector('.pay-amount')?.value) || 0;
      const cur  = row.dataset?.currency ?? 'ARS';
      const rate = parseFloat(row.querySelector('.pay-rate')?.value) || 1;
      const amt  = (cur === 'USD' ? raw * rate : raw) * (row.querySelector('.pay-method')?.value === 'credit_card' ? 1.10 : 1);
      const pc   = amt > 0 ? pctOf(amt, total) : null;
      const tag  = row.querySelector('.pay-pct');
      if (tag) tag.textContent = pc != null ? fmtPctPay(pc, { tiny: pc < 1 }) : '';
    });
    const pp = paymentPercents(paid, total);
    set('ps-paid-pct',    pp ? (paid > 0 ? fmtPctPay(pp.paidPct, { tiny: pp.tiny }) : '0%') : '');
    set('ps-balance-pct', pp ? fmtPctPay(pp.restPct) : '');
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

    const SEARCH_BASE = 'id, first_name, last_name, dni, phone, email, bad_experience, tags, locality, age, car_model, car_plate, nationality';
    const { data } = await queryWithOptionalColumns(
      sel => this.db
        .from('guests')
        .select(sel)
        .eq('hotel_id', this.ctx.hotelId)
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,dni.ilike.%${q}%`)
        .limit(6),
      SEARCH_BASE + ', gender', SEARCH_BASE);

    if (!data?.length) { container.classList.add('hidden'); return; }

    container.innerHTML = data.map(g => {
      const isBad = g.bad_experience || (g.tags ?? []).includes('no_recomendar');
      const isVIP = (g.tags ?? []).includes('vip');
      return `<div class="guest-result-item ${isBad ? 'bad-exp' : ''}" data-id="${g.id}"
           data-fn="${g.first_name ?? ''}" data-ln="${g.last_name ?? ''}"
           data-dni="${g.dni ?? ''}" data-phone="${g.phone ?? ''}" data-email="${g.email ?? ''}"
           data-locality="${g.locality ?? ''}" data-age="${g.age ?? ''}" data-car="${g.car_model ?? ''}" data-plate="${g.car_plate ?? ''}"
           data-nationality="${g.nationality ?? ''}" data-gender="${g.gender ?? ''}">
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
        document.getElementById('f-gender').value      = item.dataset.gender ?? '';
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
    const unitNames = this._unitsText(', ');

    // Source
    const selectedChip = document.querySelector('#f-source-selector .src-chip.selected');
    const source = selectedChip?.dataset?.source ?? 'direct';

    // Nights & financials
    const { P, nights: nightsN } = this._pricing();   // cálculo único (incluye ajustes por unidad)
    const freeNights = P.unitMode ? 0 : P.collective.freeNights;
    const billable   = Math.max(0, nightsN - freeNights);
    const subtotal   = P.subtotal;
    const discPct    = P.discPct;
    const surcharge  = P.surchAmt;
    const discount   = P.discAmt;
    const lateAmtDisp = P.late;
    const total      = P.total;
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
                 // cambio de depto: precio del tramo × noches del tramo; simultáneos: × noches facturables
                 total: this._isSplit()
                   ? (parseFloat(this._unitPrices[uid]) || 0) * (this._splitEditor.getSegments().find(sg => sg.unit_id === String(uid))?.nights ?? 0)
                   : (P.unitMode ? (P.perUnit.find(x => x.id === String(uid))?.net ?? 0) : (parseFloat(this._unitPrices[uid]) || 0) * billable) };
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
        ${this._distributionHTML()}
      </div>

      ${perUnitHTML}

      <div class="voucher-section">
        <div class="voucher-section-title">💰 Finanzas</div>
        ${P.unitMode ? P.perUnit.map(u => `
          <div class="voucher-fin-row"><span>${escapeHtml(this._unitLabel(u.id))} · ${nightsN} × ${fmt(u.price)}</span><span>${fmt(u.gross)}</span></div>
          ${u.freeNights > 0 ? `<div class="voucher-fin-row voucher-disc"><span>&nbsp;&nbsp;Noches sin cargo (${u.freeNights})</span><span>−${fmt(u.freeAmt)}</span></div>` : ''}
          ${u.discAmt > 0 ? `<div class="voucher-fin-row voucher-disc"><span>&nbsp;&nbsp;Descuento ${fmtPct(u.discPct)}%</span><span>−${fmt(u.discAmt)}</span></div>` : ''}
          ${u.surchAmt > 0 ? `<div class="voucher-fin-row"><span>&nbsp;&nbsp;Recargo</span><span>+${fmt(u.surchAmt)}</span></div>` : ''}`).join('') + (P.collectiveSurch > 0 ? `<div class="voucher-fin-row"><span>Recargo (toda la reserva)</span><span>+${fmt(P.collectiveSurch)}</span></div>` : '') : `
        <div class="voucher-fin-row"><span>Precio por noche</span><span>${fmt(price)}</span></div>
        <div class="voucher-fin-row"><span>Noches facturadas (${billable})</span><span>${fmt(subtotal)}</span></div>
        ${discPct > 0   ? `<div class="voucher-fin-row voucher-disc"><span>Descuento ${fmtPct(discPct)}%</span><span>−${fmt(discount)}</span></div>` : ''}
        ${surcharge > 0 ? `<div class="voucher-fin-row"><span>Recargo</span><span>+${fmt(surcharge)}</span></div>` : ''}
        ${freeNights > 0 ? `<div class="voucher-fin-row voucher-disc"><span>Noches sin cargo (${freeNights})</span><span>✓</span></div>` : ''}`}
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
    const val = id => document.getElementById(id)?.value?.trim() ?? '';
    const fn = val('f-firstname'), ln = val('f-lastname');
    const ci = val('f-checkin'),   co = val('f-checkout');
    const price    = parseFloat(val('f-price')) || 0;
    const adults   = parseInt(val('f-adults'))   || 1;
    const children = parseInt(val('f-children')) || 0;

    const unitNames = this._unitsText(' / ');

    const { P, nights: nightsN } = this._pricing();   // cálculo único (incluye ajustes por unidad)
    const freeNights = P.unitMode ? 0 : P.collective.freeNights;
    const billable   = Math.max(0, nightsN - freeNights);
    const subtotal   = P.subtotal;
    const discPct    = P.discPct;
    const surcharge  = P.surchAmt;
    const discount   = P.discAmt;
    const lateAmt    = P.late;
    const total   = P.total;
    const paid    = Math.round(this._getTotalPaid());
    const balance = Math.max(0, total - paid);

    // Cambio de departamento: tramos para el voucher
    const unitLabel = uid => this._unitLabelFull(uid);
    const splitSegs = this._isSplit()
      ? this._splitEditor.getSegments().map(sg => ({
          unitName: unitLabel(sg.unit_id), from: sg.from, to: sg.to, nights: sg.nights, pricePerNight: sg.pricePerNight,
        }))
      : [];

    // Desglose (solo las líneas que aplican)
    const lines = [];
    if (P.unitMode && splitSegs.length <= 1) {
      // Reserva con ajustes por unidad: un bloque por depto, sin mezclar importes
      P.perUnit.forEach(u => {
        const nm = unitLabel(u.id);
        lines.push({ label: `${nm} · ${nightsN} noche${nightsN === 1 ? '' : 's'} × $\u00a0${Math.round(u.price).toLocaleString('es-AR')}`, value: u.gross, kind: 'sub' });
        if (u.freeNights > 0) lines.push({ label: `Noches sin cargo (${nm}): ${u.freeNights}`, value: -u.freeAmt, kind: 'disc' });
        if (u.discAmt > 0)    lines.push({ label: `Descuento ${fmtPct(u.discPct)}% (${nm})`, value: -u.discAmt, kind: 'disc' });
        if (u.surchAmt > 0)   lines.push({ label: `Recargo (${nm})`, value: u.surchAmt, kind: 'surcharge' });
      });
      if (P.collectiveSurch > 0) lines.push({ label: 'Recargo adicional (toda la reserva)', value: P.collectiveSurch, kind: 'surcharge' });
    } else {
      if (splitSegs.length > 1) {
        splitSegs.forEach(sg => lines.push({
          label: `${sg.unitName} · ${sg.nights} noche${sg.nights === 1 ? '' : 's'} × $\u00a0${Math.round(sg.pricePerNight).toLocaleString('es-AR')}`,
          value: sg.pricePerNight * sg.nights, kind: 'sub',
        }));
      } else if (price > 0) {
        lines.push({ label: 'Precio por noche', value: price, kind: 'sub' });
        lines.push({
          label: `Noches (${billable}${freeNights ? ` facturables de ${nightsN} — ${freeNights} sin cargo` : ''})`,
          value: subtotal, kind: 'sub',
        });
      }
      if (discount  > 0) lines.push({ label: `Descuento ${fmtPct(discPct)}%`, value: -discount, kind: 'disc' });
      if (surcharge > 0) lines.push({ label: 'Recargo adicional', value: surcharge, kind: 'surcharge' });
    }
    if (lateAmt   > 0) lines.push({ label: 'Late check-out', value: lateAmt, kind: 'surcharge' });

    const PAY_LABELS = { cash:'Efectivo', transfer:'Transferencia', mercadopago:'MercadoPago',
      naranjax:'Naranja X', uala:'Ualá', debit_card:'Tarjeta Débito',
      credit_card:'Tarjeta Crédito (+10%)', credit_note:'Nota de Crédito/Voucher' };
    const payments = [];
    document.querySelectorAll('.payment-row').forEach(row => {
      const amt  = parseFloat(row.querySelector('.pay-amount')?.value) || 0;
      if (amt <= 0) return;
      const meth = row.querySelector('.pay-method')?.value;
      const date = row.querySelector('.pay-date')?.value;
      payments.push({
        label:  PAY_LABELS[meth] ?? meth,
        amount: meth === 'credit_card' ? amt * 1.10 : amt,
        date:   date ? date.split('-').reverse().join('/') : '',
        note:   row.querySelector('.pay-note')?.value ?? '',
      });
    });

    const cfg = AppContext.config ?? {};
    import('../services/voucher-template.js').then(({ openVoucherWindow, paxLabel }) => {
      const win = openVoucherWindow({
        hotel: { address: cfg.hotel_address, email: cfg.hotel_email, phone: cfg.hotel_phone },
        guest: {
          fullName: [ln, fn].filter(Boolean).join(', ') || 'Huésped',
          dni: val('f-dni'), phone: val('f-phone'), email: val('f-email'),
          locality: val('f-locality'), age: val('f-age'),
          vehicle: [val('f-car'), val('f-plate')].filter(Boolean).join(' · '),
        },
        stay: {
          checkIn: ci, checkOut: co, nights: nightsN,
          checkInTime: cfg.checkin_time, checkOutTime: cfg.checkout_time,
          units: unitNames,
          segments: splitSegs,
          paxLabel: paxLabel({ adults, children }),
          distribution: this._distributionLines(),
          channel: document.querySelector('#f-source-selector .src-chip.selected span')?.textContent?.trim() ?? 'Directo',
        },
        money: { lines, total, paid, balance, payments },
        notes: val('f-notes'),
      });
      if (!win) showToast('Permití ventanas emergentes para descargar el voucher', 'warning');
    }).catch(err => {
      console.error('[Voucher]', err);
      showToast('No se pudo generar el voucher', 'error');
    });
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

    const unitNames = this._unitsText(', ');

    const nightsN  = ci && co ? Math.round((new Date(co) - new Date(ci)) / 86400000) : 0;
    const { P } = this._pricing();   // cálculo único (incluye ajustes por unidad)
    const freeNights = P.unitMode ? 0 : P.collective.freeNights;
    const discPct  = P.discPct;
    const surcharge= P.surchAmt;
    const billable = Math.max(0, nightsN - freeNights);
    const subtotal = P.subtotal;
    const discount = P.discAmt;
    const lateAmtDisp = P.late;
    const total    = P.total;
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
    const saveNowBtn = document.getElementById('btn-save-now');
    if (saveNowBtn) { saveNowBtn.disabled = true; saveNowBtn.textContent = 'Guardando...'; }
    if (btn)        { btn.disabled        = true; btn.textContent        = 'Guardando...'; }
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Guardando...'; }

    this._showSubmitError('');
    let _safetyTimer = setTimeout(() => {
      if (btn) { btn.disabled = false; btn.textContent = this._editingId ? 'Guardar cambios' : 'Confirmar reserva'; }
      showToast('La operación tardó demasiado. Verificá tu conexión.', 'error');
    }, 30000);

    try {
      const ci    = document.getElementById('f-checkin').value;
      const co    = document.getElementById('f-checkout').value;
      const price = parseFloat(document.getElementById('f-price').value) || 0;
      const _pr    = this._pricing();
      const P      = _pr.P;
      const freeN  = P.collective.freeNights;   // noches sin cargo COLECTIVAS (las de cada depto van en booking_units)
      const dep   = parseFloat(document.getElementById('f-deposit').value) || 0;
      const notes = document.getElementById('f-notes').value.trim().slice(0, 200);
      const source = document.querySelector('input[name="booking-source"]:checked')?.value ?? 'direct';

      let bookingId = this._editingId;

      // Cálculo único (services/booking-pricing.js): lo colectivo va a bookings, lo de cada depto a booking_units
      const nights   = P.nights;
      const disc     = P.collectiveDiscPct;     // descuento COLECTIVO (%)
      const surch    = P.collectiveSurch;       // recargo COLECTIVO ($)
      const lateAmtSave = P.late;
      const total    = P.total;
      const paid     = Math.round(this._getTotalPaid());
      const balance  = Math.max(0, total - paid);

      // ── Validar tramos y superposición de unidades ────────────
      // Tramos a ocupar: en cambio de depto, los del editor; si no, cada unidad
      // elegida durante toda la estadía. La verificación es la misma para ambos
      // (availability-service) y respeta los tramos de las OTRAS reservas.
      const splitActive = this._isSplit();
      if (splitActive) {
        const sv = this._splitEditor.validate();
        if (!sv.ok) {
          showToast('⚠️ ' + sv.errors[0], 'error');
          if (btn) { btn.disabled = false; btn.textContent = this._editingId ? 'Guardar cambios' : 'Confirmar reserva'; }
          clearTimeout(_safetyTimer);
          return;
        }
      }
      // ── Reservas de 2+ deptos: distribución de huéspedes y precios por unidad ──
      const multi = this._isMulti();
      const muOk  = await this._multiUnitSupported();
      const _abort = () => {
        if (btn) { btn.disabled = false; btn.textContent = this._editingId ? 'Guardar cambios' : 'Confirmar reserva'; }
        clearTimeout(_safetyTimer);
      };
      const dist = multi ? this._distributionCheck() : { loaded: false, warnings: [] };
      const _hasLabels = multi && [...this._selectedUnitIds].some(uid => cleanLabel(this._unitAdj[uid]?.label));
      if (_hasLabels && muOk && !this._lblOk) {
        showToast('⚠️ Para guardar el nombre de cada depto falta correr migration_multiunidad_nombre.sql en Supabase.', 'error', 7000);
        _abort(); return;
      }
      if (multi && (P.unitMode || dist.loaded) && !muOk) {
        showToast('⚠️ Para guardar ajustes u huéspedes por unidad falta correr la migración multiunidad (migration_multiunidad.sql).', 'error', 7000);
        _abort(); return;
      }
      if (dist.warnings.length &&
          !window.confirm('⚠️ ' + dist.warnings.map(w => w.text).join('\n') + '\n\n¿Guardar igual?')) {
        _abort(); return;
      }

      const wantedSegments = splitActive
        ? this._splitEditor.getSegments()
        : [...this._selectedUnitIds].map(uid => ({ unit_id: String(uid), from: ci, to: co }));
      if (wantedSegments.length && ci && co) {
        // Esta consulta tiene el resguardo de tiempo límite (_withTimeout): si por
        // conexión inestable se colgaba, el botón quedaba en "Guardando..." para siempre.
        const realConflicts = await this._withTimeout(
          findConflicts(this.db, wantedSegments, { excludeBookingId: this._editingId }),
          'validar disponibilidad'
        );
        if (realConflicts.length) {
          const c = realConflicts[0];
          const uName = this.ctx.units?.find(u => String(u.id) === c.unit_id)?.name ?? 'esa unidad';
          showToast(`⚠️ Superposición: "${c.guestName}" ya tiene ${uName} del ${c.from.split('-').reverse().slice(0,2).join('/')} al ${c.to.split('-').reverse().slice(0,2).join('/')}.`, 'error');
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
      // Género: solo se envía si hay un valor elegido. Así un huésped que llegó
      // precargado sin ese dato nunca pisa con "vacío" el género ya guardado.
      const genderValue = document.getElementById('f-gender')?.value || '';
      if (genderValue) guestPayload.gender = genderValue;

      // Si la base todavía no tiene guests.gender (migración sin aplicar), la
      // reserva se guarda igual, sin género, y se avisa una vez.
      const runGuestSave = (payload) => guestId
        ? this._withTimeout(this.db.from('guests').update(payload).eq('id', guestId), 'Actualizar huésped')
        : this._withTimeout(this.db.from('guests').insert(payload).select('id').single(), 'Crear huésped');
      let guestRes = await runGuestSave(guestPayload);
      if (guestRes.error && guestPayload.gender && /gender/i.test(guestRes.error.message ?? '')) {
        delete guestPayload.gender;
        showToast('⚠️ Falta aplicar la migración de género en la base: se guardó sin ese dato', 'warning', 6000);
        guestRes = await runGuestSave(guestPayload);
      }

      if (guestId) {
        if (guestRes.error) throw new Error('No fue posible actualizar el huesped: ' + guestRes.error.message);
      } else {
        const { data: newGuest, error: gErr } = guestRes;
        if (gErr) throw gErr;
        guestId = newGuest.id;
        this._selectedGuestId = guestId; // bug: antes solo se actualizaba la variable local,
        // así que cualquier cosa que mirara this._selectedGuestId DESPUÉS de guardar (como
        // el prefill de huésped de "Dividir estadía") quedaba vacía para huéspedes nuevos.
      }

      // ── Columnas CORE (siempre existen en la DB) ──────────────
      const lateCheckout = document.getElementById('f-late-checkout')?.checked ?? false;
      // Reservas con precios por unidad: la app manda el total y el trigger zz_booking_unit_pricing_total lo respeta
      const _unitPricingOn = !splitActive && multi && P.unitMode;
      const muFields = muOk ? { unit_pricing: _unitPricingOn, unit_pricing_total: _unitPricingOn ? total : null } : {};
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

      if (bookingId) {
        // UPDATE — intentar con free_nights primero
        let { error: upErr } = await this._withTimeout(this.db.from('bookings').update({
          ...corePayload, free_nights: freeN, ...muFields
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
        // Las unidades se actualizan más abajo (primero se guardan las nuevas y
        // recién después se borran las que sobran: si algo falla a mitad de
        // camino, la reserva no queda sin departamento).
        // NOTA: los pagos NO se borran acá — cada pago se maneja
        // individualmente más abajo (INSERT para nuevos, UPDATE para
        // existentes, DELETE solo para los que el usuario quitó del form).
      } else {
        // INSERT — intentar con free_nights primero
        let { data: newB, error: insErr } = await this._withTimeout(
          this.db.from('bookings').insert({ ...corePayload, free_nights: freeN, ...muFields }).select('id').single(),
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

      // ── Cantidad de personas ──
      // Antes este UPDATE estaba dentro de un try/catch vacío y además ignoraba el `error`
      // de la respuesta: si fallaba (permisos, red) la reserva quedaba con la cantidad por
      // defecto sin avisar. Ahora un fallo real corta el guardado con un mensaje claro.
      // Solo se tolera que la base aún no tenga adults/children (se guarda al menos pax).
      {
        let { error: paxErr } = await this._withTimeout(
          this.db.from('bookings').update({ pax, adults, children }).eq('id', bookingId),
          'Actualizar pasajeros'
        );
        if (paxErr && /adults|children/i.test(paxErr.message ?? '')) {
          ({ error: paxErr } = await this._withTimeout(
            this.db.from('bookings').update({ pax }).eq('id', bookingId), 'Actualizar pasajeros'));
        }
        if (paxErr) throw new Error('No se pudo guardar la cantidad de personas: ' + paxErr.message);
      }

      // Unidades / tramos de la reserva. Upsert (actualiza precio y tramos si cambiaron)
      // y después se borran las que ya no están.
      let unitRows;
      if (splitActive) {
        unitRows = toBookingUnitRows({ check_in: ci, check_out: co }, this._splitEditor.getSegments(), bookingId)
          .map(r => ({ ...r, ...(muOk ? { ...(this._lblOk ? { label: null } : {}), adults: null, children: null, free_nights: null, discount_pct: null, surcharge_amount: null } : {}) }));
      } else {
        const isMultiUnit = this._selectedUnitIds.size >= 2;
        unitRows = [...this._selectedUnitIds].map(uid => ({
          booking_id: bookingId,
          unit_id: uid,
          // Multi-unidad: precio individual cargado por el usuario.
          // Unidad única: el mismo precio general de la reserva.
          price_per_night: isMultiUnit ? (parseFloat(this._unitPrices[uid]) || 0) : price,
          // Si la reserva tenía cambio de depto y se volvió a un solo depto,
          // limpiar los tramos (NULL = toda la estadía).
          ...(this._hadSegments ? { segment_check_in: null, segment_check_out: null } : {}),
          // Huéspedes y ajustes propios del depto (migration_multiunidad.sql)
          ...(muOk ? this._unitRowExtras(uid, P, multi) : {}),
        }));
      }
      if (unitRows.length) {
        const { error: buErr } = await this._withTimeout(
          this.db.from('booking_units').upsert(unitRows, { onConflict: 'booking_id,unit_id' }),
          'Asignar unidades'
        );
        if (buErr) {
          if (/segment_check/i.test(buErr.message ?? '')) {
            throw new Error('Falta aplicar la migración de tramos en la base (migration_booking_segments.sql) para guardar un cambio de departamento.');
          }
          throw new Error('Error asignando unidades: ' + buErr.message);
        }
        if (this._editingId) {
          const keep = unitRows.map(r => r.unit_id);
          const { error: buCleanErr } = await this._withTimeout(
            this.db.from('booking_units').delete().eq('booking_id', bookingId).not('unit_id', 'in', `(${keep.join(',')})`),
            'Quitar unidades sobrantes'
          );
          if (buCleanErr) throw new Error('Error quitando unidades anteriores: ' + buCleanErr.message);
        }
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
        const unitNames = [...this._selectedUnitIds]
          .map(uid => this.ctx.units?.find(u => String(u.id) === String(uid))?.name)
          .filter(Boolean)
          .join(', ') || '—';
        Bus.emit(this._editingId ? EVENTS.BOOKING_UPDATED : EVENTS.BOOKING_CREATED, {
          bookingId, guestName, unitNames, checkIn: ci, checkOut: co, pax, total,
        });
      } catch (err) {
        console.warn('[BookingForm] no se pudo emitir el evento de reserva:', err?.message ?? err);
      }

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

    } catch (err) {
      console.error('[MILA] Booking save error:', err);
      // Mostrar el error real siempre — ayuda a diagnosticar
      // Mensaje claro y accionable: se muestra como aviso Y como banner fijo dentro del formulario
      // (el aviso desaparece solo; el banner queda hasta el próximo intento).
      const userMsg = friendlyDbError(err, { source: document.querySelector('input[name="booking-source"]:checked')?.value });
      this._showSubmitError(userMsg);
      showToast(`❌ ${userMsg}`, 'error', 7000);
    } finally {
      clearTimeout(_safetyTimer);
      this._submitting = false;
      if (saveNowBtn) { saveNowBtn.disabled = false; saveNowBtn.textContent = '💾 Guardar cambios'; }
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
