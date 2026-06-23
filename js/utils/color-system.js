/**
 * MILA PMS — Color System
 * Fuente única de verdad para colores de reservas.
 *
 * Importar en CUALQUIER módulo que necesite colores de reserva:
 *   import { getBookingColors, getLegendItems, STATUS_CONFIG } from './utils/color-system.js';
 *
 * NUNCA hardcodear colores de reserva en otro archivo.
 * NUNCA duplicar esta lógica en CSS (usar CSS variables generadas aquí).
 */

// ─── Paleta de estados ───────────────────────────────────────────────────────

/**
 * Configuración completa de cada estado de reserva.
 * active = reserva vigente/futura
 * past   = reserva con checkout anterior a hoy (versión desaturada del mismo color)
 */
export const STATUS_CONFIG = {
  paid: {
    label:   'Pago completo',
    emoji:   '🟢',
    active:  { bg: '#22c55e', text: '#ffffff', border: '#16a34a' },
    past:    { bg: '#a8d5b5', text: '#ffffff', border: '#7ab58a' },
  },
  deposit: {
    label:   'Con seña',
    emoji:   '🔴',
    active:  { bg: '#ef4444', text: '#ffffff', border: '#dc2626' },
    past:    { bg: '#d4a8a8', text: '#ffffff', border: '#b87878' },
  },
  pending: {
    label:   'Sin depósito',
    emoji:   '🟡',
    active:  { bg: '#eab308', text: '#1a1a1a', border: '#ca8a04' },
    past:    { bg: '#d4c47a', text: '#555555', border: '#b5a44c' },
  },
  airbnb: {
    label:   'Airbnb',
    emoji:   '🟠',
    active:  { bg: '#f97316', text: '#ffffff', border: '#ea580c' },
    past:    { bg: '#d4a87a', text: '#ffffff', border: '#b87e52' },
  },
  booking: {
    label:   'Booking.com',
    emoji:   '🔵',
    active:  { bg: '#3b82f6', text: '#ffffff', border: '#2563eb' },
    past:    { bg: '#a8b8d4', text: '#ffffff', border: '#7890b5' },
  },
  credit_note: {
    label:   'Nota de crédito',
    emoji:   '🟣',
    active:  { bg: '#a855f7', text: '#ffffff', border: '#9333ea' },
    past:    { bg: '#c4a8d4', text: '#ffffff', border: '#a07ab5' },
  },
  block: {
    label:   'Bloqueo',
    emoji:   '⚫',
    active:  { bg: '#374151', text: '#ffffff', border: '#1f2937' },
    past:    { bg: '#9ca3af', text: '#ffffff', border: '#6b7280' },
  },
};

// ─── Lógica de estado ────────────────────────────────────────────────────────

/**
 * Determina el estado de una reserva.
 * @param {object} booking
 * @returns {keyof STATUS_CONFIG}
 */
export function getBookingStatus(booking) {
  if (!booking) return 'pending';

  const type    = (booking.booking_type || booking.type || '').toLowerCase();
  const channel = (booking.channel || booking.source || '').toLowerCase();

  if (type === 'block')       return 'block';
  if (type === 'credit_note') return 'credit_note';
  if (channel === 'airbnb')   return 'airbnb';
  if (channel === 'booking')  return 'booking';

  // Calcular estado de pago
  const paid  = parseFloat(booking.total_paid  ?? booking.amount_paid ?? 0) || 0;
  const total = parseFloat(booking.total_amount ?? booking.total       ?? 0) || 0;

  if (total > 0 && paid >= total) return 'paid';
  if (paid > 0)                   return 'deposit';
  return 'pending';
}

/**
 * Determina si una reserva es "pasada" (checkout anterior a hoy).
 * @param {object} booking
 * @param {Date}   [today]
 * @returns {boolean}
 */
export function isBookingPast(booking, today = new Date()) {
  const raw      = booking.check_out_date ?? booking.checkout_date ?? booking.end_date;
  if (!raw) return false;
  const checkout = new Date(raw);
  const todayNorm = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const checkoutNorm = new Date(checkout.getFullYear(), checkout.getMonth(), checkout.getDate());
  return checkoutNorm < todayNorm;
}

/**
 * Retorna los colores correctos (activo vs pasado) para una reserva.
 * @param {object} booking
 * @param {Date}   [today]
 * @returns {{ bg: string, text: string, border: string }}
 */
export function getBookingColors(booking, today = new Date()) {
  const status = getBookingStatus(booking);
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return isBookingPast(booking, today) ? config.past : config.active;
}

/**
 * Aplica estilos de color directamente a un elemento DOM.
 * @param {HTMLElement} el
 * @param {object}      booking
 * @param {Date}        [today]
 */
export function applyBookingColors(el, booking, today = new Date()) {
  const colors = getBookingColors(booking, today);
  el.style.backgroundColor = colors.bg;
  el.style.color            = colors.text;
  el.style.borderColor      = colors.border;
}

// ─── Leyenda ─────────────────────────────────────────────────────────────────

/**
 * Retorna los ítems de la leyenda del calendario.
 * Usar ESTE array para renderizar la leyenda — nunca hardcodear.
 * @returns {Array<{key: string, label: string, emoji: string, color: string, borderColor: string}>}
 */
export function getLegendItems() {
  return Object.entries(STATUS_CONFIG).map(([key, cfg]) => ({
    key,
    label:       cfg.label,
    emoji:       cfg.emoji,
    color:       cfg.active.bg,
    borderColor: cfg.active.border,
  }));
}

/**
 * Renderiza la leyenda del calendario en un contenedor existente.
 * @param {HTMLElement} container  El elemento donde insertar la leyenda.
 */
export function renderLegend(container) {
  if (!container) return;
  const items  = getLegendItems();
  container.innerHTML = items.map((item) => `
    <div class="legend-item" data-status="${item.key}">
      <span class="legend-dot"
            style="background:${item.color}; border: 1px solid ${item.borderColor};">
      </span>
      <span class="legend-label">${item.label}</span>
    </div>
  `).join('');
}

// ─── CSS Variables helpers ────────────────────────────────────────────────────

/**
 * Inyecta variables CSS en :root con los colores de cada estado.
 * Llamar una sola vez al iniciar la app.
 * Permite usar var(--color-paid-bg), var(--color-paid-text), etc. en CSS.
 */
export function injectCSSVariables() {
  const vars = [];
  for (const [key, cfg] of Object.entries(STATUS_CONFIG)) {
    vars.push(
      `--color-${key}-bg:       ${cfg.active.bg};`,
      `--color-${key}-text:     ${cfg.active.text};`,
      `--color-${key}-border:   ${cfg.active.border};`,
      `--color-${key}-past-bg:  ${cfg.past.bg};`,
      `--color-${key}-past-text:${cfg.past.text};`,
    );
  }
  const style = document.createElement('style');
  style.id    = 'mila-color-vars';
  style.textContent = `:root {\n  ${vars.join('\n  ')}\n}`;
  document.head.appendChild(style);
}

// ─── Clase de estado para atributos data-* ───────────────────────────────────

/**
 * Retorna el string de clase CSS para un estado de reserva.
 * Útil para aplicar clases como "booking-status--paid", "booking-status--past".
 * @param {object}  booking
 * @param {Date}    [today]
 * @returns {string}  p.ej. "booking-status--paid" o "booking-status--paid booking-status--past"
 */
export function getStatusClass(booking, today = new Date()) {
  const status = getBookingStatus(booking);
  const past   = isBookingPast(booking, today);
  return [`booking-status--${status}`, past ? 'booking-status--past' : ''].filter(Boolean).join(' ');
}
