/**
 * MILA PMS — Calendar Events Fix
 * Reemplaza listeners rotos del calendario con event delegation robusto.
 *
 * Instrucciones de integración:
 *   1. Importar este módulo en calendar.js (o donde se inicializa el calendario).
 *   2. Llamar: initCalendarEvents({ onEmptyClick, onBookingClick })
 *
 * Los callbacks reciben la información necesaria para abrir el modal correcto.
 */

import { getBookingColors, isBookingPast } from '../utils/color-system.js';

// ─── Selector del contenedor del calendario ──────────────────────────────────
// Ajustar según el ID/clase real del proyecto
const CALENDAR_CONTAINER_SELECTOR = [
  '#calendar-container',
  '.calendar-wrapper',
  '.calendar-scroll-container',
  '[data-calendar]',
].join(', ');

// ─── Data attributes esperados ────────────────────────────────────────────────
// Asegurarse de que el HTML del calendario tenga estos atributos.
// Si el proyecto usa otros nombres, cambiarlos aquí (único lugar).
const ATTR = {
  date:      'data-date',       // En celdas de día: "2025-06-15"
  unitId:    'data-unit-id',    // En celdas y filas: ID de la unidad
  bookingId: 'data-booking-id', // En bloques de reserva
};

// ─── Inicialización ───────────────────────────────────────────────────────────

/**
 * Inicializa los eventos del calendario usando event delegation.
 * Es seguro llamar varias veces (elimina listeners anteriores).
 *
 * @param {object} opts
 * @param {function({date: string, unitId: string}): void} opts.onEmptyClick
 *   Callback cuando se hace click en celda vacía. Recibe { date, unitId }.
 *   Ejemplo: ({ date, unitId }) => openNewBookingModal({ date, unitId })
 *
 * @param {function({bookingId: string}): void} opts.onBookingClick
 *   Callback cuando se hace click en una reserva. Recibe { bookingId }.
 *   Ejemplo: ({ bookingId }) => openEditBookingModal(bookingId)
 */
export function initCalendarEvents({ onEmptyClick, onBookingClick } = {}) {
  const container = document.querySelector(CALENDAR_CONTAINER_SELECTOR);

  if (!container) {
    console.warn('[CalendarEvents] No se encontró el contenedor del calendario:', CALENDAR_CONTAINER_SELECTOR);
    return;
  }

  // Limpiar listeners anteriores clonando el nodo
  const fresh = container.cloneNode(true);
  container.parentNode.replaceChild(fresh, container);

  fresh.addEventListener('click', (e) => {
    // 1. ¿Se hizo click en una reserva existente?
    const bookingEl = e.target.closest(`[${ATTR.bookingId}]`);
    if (bookingEl) {
      e.stopPropagation();
      const bookingId = bookingEl.getAttribute(ATTR.bookingId);
      if (bookingId && onBookingClick) {
        onBookingClick({ bookingId });
      }
      return;
    }

    // 2. ¿Se hizo click en una celda de día (vacía)?
    const cellEl = e.target.closest(`[${ATTR.date}]`);
    if (cellEl) {
      const date   = cellEl.getAttribute(ATTR.date);
      const unitId = cellEl.getAttribute(ATTR.unitId)
        ?? cellEl.closest(`[${ATTR.unitId}]`)?.getAttribute(ATTR.unitId)
        ?? null;

      if (date && onEmptyClick) {
        onEmptyClick({ date, unitId });
      }
    }
  });

  console.info('[CalendarEvents] Listeners del calendario inicializados correctamente.');
  return fresh; // Retorna el nuevo contenedor por si se necesita referencia
}

// ─── Helpers para actualizar celdas sin re-renderizar todo ────────────────────

/**
 * Actualiza el color de todos los bloques de reserva en el DOM.
 * Llamar después de cambiar fechas o hacer checkout.
 * @param {object[]} bookings  Array de reservas actualizadas
 * @param {Date}     [today]
 */
export function refreshCalendarColors(bookings = [], today = new Date()) {
  const container = document.querySelector(CALENDAR_CONTAINER_SELECTOR);
  if (!container) return;

  const bookingMap = Object.fromEntries(bookings.map((b) => [String(b.id), b]));

  container.querySelectorAll(`[${ATTR.bookingId}]`).forEach((el) => {
    const id      = el.getAttribute(ATTR.bookingId);
    const booking = bookingMap[id];
    if (!booking) return;

    const colors = getBookingColors(booking, today);
    el.style.backgroundColor = colors.bg;
    el.style.color            = colors.text;
    el.style.borderColor      = colors.border;

    // Marca visual de reserva pasada
    if (isBookingPast(booking, today)) {
      el.setAttribute('data-past', 'true');
    } else {
      el.removeAttribute('data-past');
    }
  });
}

// ─── Event bus mínimo para coordinación entre módulos ─────────────────────────

const _handlers = {};

export const calendarBus = {
  /**
   * Suscribirse a un evento del calendario.
   * @param {'booking:created'|'booking:updated'|'booking:deleted'|'calendar:refresh'} event
   * @param {function} fn
   * @returns {function} unsuscribe
   */
  on(event, fn) {
    if (!_handlers[event]) _handlers[event] = new Set();
    _handlers[event].add(fn);
    return () => _handlers[event].delete(fn);
  },

  /**
   * Emitir un evento para todos los suscriptores.
   * @param {string} event
   * @param {*}      data
   */
  emit(event, data) {
    (_handlers[event] ?? new Set()).forEach((fn) => {
      try { fn(data); } catch (e) { console.error(`[calendarBus] ${event}:`, e); }
    });
  },
};

/*
 * ─── Ejemplo de uso en calendar.js ────────────────────────────────────────────
 *
 *  import { initCalendarEvents, calendarBus } from './calendar-events.js';
 *  import { openNewBookingModal, openEditBookingModal } from './booking-modal.js';
 *
 *  // Inicializar una vez, DESPUÉS de renderizar el calendario
 *  initCalendarEvents({
 *    onEmptyClick:   ({ date, unitId }) => openNewBookingModal({ date, unitId }),
 *    onBookingClick: ({ bookingId })    => openEditBookingModal(bookingId),
 *  });
 *
 *  // Escuchar cambios para re-renderizar
 *  calendarBus.on('booking:created', () => renderCalendar());
 *  calendarBus.on('booking:updated', () => renderCalendar());
 *  calendarBus.on('booking:deleted', () => renderCalendar());
 *
 *  // En booking-form.js, después de guardar exitosamente:
 *  calendarBus.emit('booking:created', newBooking);
 *
 * ──────────────────────────────────────────────────────────────────────────────
 */
