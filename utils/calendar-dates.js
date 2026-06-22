/**
 * MILA PMS — utils/calendar-dates.js
 * Lógica de fechas para calendario: permitir pasadas + estilo gris.
 */

// ──────────────────────────────────────────────
// VALIDACIÓN DE FECHAS (sin bloqueo de pasadas)
// ──────────────────────────────────────────────
/**
 * Valida el rango checkin–checkout.
 * Ya NO bloquea fechas pasadas; solo genera advertencias visuales.
 *
 * @param {Date|string} checkin
 * @param {Date|string} checkout
 * @returns {{ errors: string[], advertencias: string[], valido: boolean }}
 */
export function validarRangoFechas(checkin, checkout) {
  const ci  = checkin  instanceof Date ? checkin  : new Date(checkin);
  const co  = checkout instanceof Date ? checkout : new Date(checkout);
  const hoy = startOfDay(new Date());

  const errors       = [];
  const advertencias = [];

  if (isNaN(ci.getTime()))  errors.push('Fecha de ingreso inválida.');
  if (isNaN(co.getTime()))  errors.push('Fecha de salida inválida.');

  if (errors.length) return { errors, advertencias, valido: false };

  if (co <= ci)  errors.push('La fecha de salida debe ser posterior al ingreso.');

  const noches = diffDias(ci, co);
  if (noches > 365) errors.push('La reserva no puede superar 365 noches.');
  if (noches < 1)   errors.push('Mínimo 1 noche de estadía.');

  // Advertencias NO bloqueantes
  if (ci < hoy) advertencias.push('⚠️ Estás creando una reserva en una fecha pasada.');
  if (co < hoy) advertencias.push('⚠️ La fecha de salida también es pasada.');

  return {
    errors,
    advertencias,
    valido:  errors.length === 0,
    noches,
  };
}

// ──────────────────────────────────────────────
// CLASES CSS PARA CELDA DE CALENDARIO
// ──────────────────────────────────────────────
/**
 * Devuelve el conjunto de clases CSS para una celda de día del calendario.
 *
 * @param {Date}   fecha
 * @param {Array}  reservasDelDia  - reservas que ocurren en este día
 * @param {Date}   [referencia]    - fecha de "hoy" (inyectable para tests)
 * @returns {string[]}
 */
export function clasesParaDia(fecha, reservasDelDia = [], referencia = new Date()) {
  const hoy    = startOfDay(referencia);
  const dia    = startOfDay(fecha);
  const esPast = dia < hoy;
  const esHoy  = dia.getTime() === hoy.getTime();
  const esFut  = dia > hoy;

  return [
    'calendar-day',
    esPast && !esHoy ? 'day--past'     : null,
    esHoy            ? 'day--today'    : null,
    esFut            ? 'day--future'   : null,
    reservasDelDia.length > 0 ? 'day--occupied' : 'day--free',
  ].filter(Boolean);
}

/**
 * Crea y devuelve un elemento <div> completo para una celda del calendario.
 *
 * @param {Date}  fecha
 * @param {Array} reservasDelDia
 * @param {Object} opts
 * @param {Function} [opts.onDayClick]   - callback(fecha, reservas)
 * @param {Date}     [opts.hoy]          - override de "hoy"
 * @returns {HTMLDivElement}
 */
export function crearCeldaDia(fecha, reservasDelDia = [], opts = {}) {
  const { onDayClick = null, hoy = new Date() } = opts;

  const cell = document.createElement('div');
  cell.className  = clasesParaDia(fecha, reservasDelDia, hoy).join(' ');
  cell.dataset.fecha = toISODate(fecha);
  cell.setAttribute('role', 'gridcell');
  cell.setAttribute('aria-label', formatFechaLabel(fecha));

  // Número del día
  const num = document.createElement('span');
  num.className   = 'day-number';
  num.textContent = fecha.getDate();
  cell.appendChild(num);

  // Chips de reservas (máx 3 visibles)
  const visible = reservasDelDia.slice(0, 3);
  visible.forEach(r => {
    const chip = document.createElement('div');
    chip.className   = 'booking-chip';
    chip.textContent = r.huesped_nombre ?? 'Reserva';
    chip.style.setProperty('--chip-color', r.color ?? '#4F46E5');
    cell.appendChild(chip);
  });

  if (reservasDelDia.length > 3) {
    const more = document.createElement('div');
    more.className   = 'day-more';
    more.textContent = `+${reservasDelDia.length - 3}`;
    cell.appendChild(more);
  }

  if (onDayClick) {
    cell.addEventListener('click', () => onDayClick(fecha, reservasDelDia));
    cell.style.cursor = 'pointer';
  }

  return cell;
}

// ──────────────────────────────────────────────
// HELPERS DE FECHA
// ──────────────────────────────────────────────
export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function diffDias(desde, hasta) {
  return Math.round((startOfDay(hasta) - startOfDay(desde)) / 86_400_000);
}

export function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

export function formatFechaLabel(date) {
  return date.toLocaleDateString('es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

/**
 * Configuración para deshabilitar bloqueo en inputs tipo date.
 * Devuelve los atributos a aplicar (o eliminar) del input.
 *
 * ANTES (eliminar del HTML):
 *   <input type="date" min="2025-06-22">
 *
 * DESPUÉS: sin atributo `min`, o con min muy bajo.
 *
 * @returns {{ min: string }}
 */
export function getDateInputConfig() {
  return {
    min: '2000-01-01', // Permite fechas desde el año 2000 en adelante
    // NO establecer max para no bloquear fechas futuras
  };
}

/**
 * Aplica la config al input de fecha y muestra advertencia si la fecha es pasada.
 * @param {HTMLInputElement} inputEl
 * @param {HTMLElement}      [warningEl]  - Elemento donde mostrar advertencia
 */
export function configurarInputFecha(inputEl, warningEl = null) {
  const { min } = getDateInputConfig();
  inputEl.min = min;
  inputEl.removeAttribute('max'); // por si estaba seteado

  inputEl.addEventListener('change', () => {
    const val = new Date(inputEl.value + 'T00:00:00');
    const hoy = startOfDay(new Date());

    if (warningEl) {
      if (val < hoy) {
        warningEl.textContent = '⚠️ Esta fecha es pasada. La reserva se registrará igualmente.';
        warningEl.style.display = 'block';
      } else {
        warningEl.textContent = '';
        warningEl.style.display = 'none';
      }
    }
  });
}
