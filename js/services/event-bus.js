// ═══════════════════════════════════════════════════
// event-bus.js — Bus de eventos centralizado MILA
// Reemplaza: document.dispatchEvent + window globals
// Tipado, error-safe, con unsubscribe automático
// ═══════════════════════════════════════════════════

class EventBus {
  constructor() {
    this._listeners = new Map();
    this._history   = [];      // últimos 50 eventos para debug
    this._debug     = false;
  }

  /**
   * Suscribirse a un evento.
   * @returns {Function} unsubscribe — llama para cancelar
   */
  on(event, handler, { once = false } = {}) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    const wrapper = once
      ? (...args) => { handler(...args); this.off(event, wrapper); }
      : handler;
    wrapper._original = handler;
    this._listeners.get(event).add(wrapper);
    return () => this.off(event, wrapper);
  }

  /** Suscripción de una sola vez */
  once(event, handler) {
    return this.on(event, handler, { once: true });
  }

  /** Cancelar suscripción */
  off(event, handler) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      if (fn === handler || fn._original === handler) { set.delete(fn); break; }
    }
  }

  /** Emitir evento con payload */
  emit(event, data) {
    if (this._debug) {
      console.log(`[Bus] ${event}`, data);
      this._history.push({ event, data, ts: Date.now() });
      if (this._history.length > 50) this._history.shift();
    }
    const set = this._listeners.get(event);
    if (!set?.size) return;
    for (const fn of set) {
      try { fn(data); }
      catch (err) { console.error(`[EventBus] Error en handler de "${event}":`, err); }
    }
  }

  /** Puente: escucha DOM events y los re-emite en el bus (ignora eventos ya bridgeados) */
  bridgeFromDOM(...events) {
    events.forEach(ev => {
      document.addEventListener(ev, (e) => {
        if (e._fromBridge) return; // evitar loop DOM→Bus→DOM→Bus→...
        this.emit(ev, e.detail ?? e);
      });
    });
  }

  /** Puente inverso: emite en DOM cuando el bus emite (marca el evento para no re-procesar) */
  bridgeToDOM(...events) {
    events.forEach(ev => {
      this.on(ev, (data) => {
        const ce = new CustomEvent(ev, { detail: data });
        ce._fromBridge = true; // marca para que bridgeFromDOM lo ignore
        document.dispatchEvent(ce);
      });
    });
  }

  /** Reiniciar todos los listeners (útil en destroyApp) */
  reset() {
    this._listeners.clear();
    this._history = [];
  }
}

export const Bus = new EventBus();

// ── Catálogo de eventos — fuente de verdad ─────────
export const EVENTS = Object.freeze({
  // Reservas
  BOOKING_CHANGED:     'booking:changed',
  BOOKING_CREATED:     'booking:created',     // { bookingId, guestName, unitNames, checkIn, checkOut, pax, total }
  BOOKING_UPDATED:     'booking:updated',     // { bookingId, guestName, unitNames, checkIn, checkOut }
  BOOKING_DELETED:     'booking:deleted',     // { bookingId, guestName, unitNames, checkIn, checkOut }
  BOOKING_CANCELLED:   'booking:cancelled',    // { hotelId, checkIn, checkOut, unitIds } — libera capacidad, dispara chequeo de lista de espera
  BOOKING_FULLY_PAID:  'booking:fullypaid',
  BOOKING_DRAG_DONE:   'booking:drag_done',   // { bookingId, oldCI, newCI }

  // Pagos
  PAYMENT_CHANGED:     'payment:changed',
  PAYMENT_REGISTERED:  'payment:registered',  // { bookingId, guestName, amount, method }
  PAYMENT_UPDATED:     'payment:updated',     // { bookingId, guestName, amount, method }

  // Check-in / Check-out / Unidades
  CHECKIN_DONE:        'stay:checkin_done',        // { bookingId, guestName, unitName }
  CHECKOUT_DONE:       'stay:checkout_done',        // { bookingId, guestName, unitName }
  UNIT_FREED:          'unit:freed',                // { unitName, guestName }

  // Bloqueos
  BLOCK_CREATED:       'block:created',       // { unitName, checkIn, checkOut, reason }
  BLOCK_DELETED:       'block:deleted',       // { unitName, checkIn, checkOut }

  // Disponibilidad
  AVAILABILITY_CHANGED: 'availability:changed', // { unitName, checkIn, checkOut }

  // Navegación
  SECTION_CHANGED:     'section:changed',      // { section }

  // UI
  TOAST:               'show:toast',           // { msg, type }
  REMINDER_BADGE:      'reminders:badge',      // { count }

  // Calendario
  CAL_PULSE_BAR:       'calendar:pulse_bar',   // { bookingId }
  CAL_RELOAD:          'calendar:reload',

  // Offline / sync
  SYNC_QUEUED:         'sync:queued',          // { action, payload }
  SYNC_DONE:           'sync:done',
});

// Compatibilidad con código DOM legacy existente
// Los eventos que ya existían como CustomEvents del DOM siguen funcionando
Bus.bridgeFromDOM(
  EVENTS.BOOKING_CHANGED,
  EVENTS.BOOKING_FULLY_PAID,
  EVENTS.PAYMENT_CHANGED,
  EVENTS.REMINDER_BADGE,
  EVENTS.TOAST,
);
Bus.bridgeToDOM(
  EVENTS.BOOKING_CHANGED,
  EVENTS.TOAST,
);
