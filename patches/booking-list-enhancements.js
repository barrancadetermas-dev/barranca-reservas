/**
 * MILA PMS — patches/booking-list-enhancements.js
 *
 * Mejoras para la lista de reservas:
 * 1. Orden por defecto: check_in ASC (más próximas primero)
 * 2. Selector de ordenamiento con 5 opciones
 * 3. Agrupación por departamento
 * 4. Botón "Abonó total" en cada fila y en el detalle
 * 5. Corrección del saldo mostrado (lee booking.balance, no total_amount)
 */

import { safeInsert } from '../lib/supabase-debug.js';
import { formatCurrency } from '../utils/calculos.js';

// ── 1. OPCIONES DE ORDENAMIENTO ──────────────────────────────────

export const SORT_OPTIONS = [
  { value: 'checkin_asc',    label: '📅 Más próximas primero'  },
  { value: 'checkin_desc',   label: '📅 Más lejanas primero'   },
  { value: 'unit_asc',       label: '🏠 Por departamento'      },
  { value: 'amount_asc',     label: '💰 Menor monto primero'   },
  { value: 'amount_desc',    label: '💰 Mayor monto primero'   },
];

/**
 * Renderiza el selector de ordenamiento sobre la lista.
 * @param {HTMLElement} container  - Donde inyectar el selector
 * @param {Function}    onChange   - Callback con el valor seleccionado
 * @param {string}      [current]  - Valor inicial
 */
export function renderSortSelector(container, onChange, current = 'checkin_asc') {
  const wrap = document.createElement('div');
  wrap.className = 'booking-sort-wrap';
  wrap.innerHTML = `
    <label class="sort-label">Ordenar:</label>
    <div class="sort-tabs">
      ${SORT_OPTIONS.map(o => `
        <button
          type="button"
          class="sort-tab ${o.value === current ? 'sort-tab--active' : ''}"
          data-sort="${o.value}"
        >${o.label}</button>
      `).join('')}
    </div>
  `;

  wrap.querySelectorAll('.sort-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.sort-tab').forEach(b => b.classList.remove('sort-tab--active'));
      btn.classList.add('sort-tab--active');
      onChange(btn.dataset.sort);
    });
  });

  // Insertar antes del primer hijo del container
  container.prepend(wrap);
}

// ── 2. FUNCIÓN DE ORDENAMIENTO ───────────────────────────────────

/**
 * Ordena un array de bookings según la opción elegida.
 * @param {Array}  bookings
 * @param {string} sortKey
 * @returns {Array}
 */
export function sortBookings(bookings, sortKey = 'checkin_asc') {
  const sorted = [...bookings];

  switch (sortKey) {
    case 'checkin_asc':
      return sorted.sort((a, b) => new Date(a.check_in) - new Date(b.check_in));

    case 'checkin_desc':
      return sorted.sort((a, b) => new Date(b.check_in) - new Date(a.check_in));

    case 'unit_asc':
      // Agrupa por unit_id / unit_name
      return sorted.sort((a, b) => {
        const ua = a.unit_name ?? a.unit_id ?? '';
        const ub = b.unit_name ?? b.unit_id ?? '';
        return ua.localeCompare(ub, 'es');
      });

    case 'amount_asc':
      return sorted.sort((a, b) =>
        Number(a.total_amount ?? 0) - Number(b.total_amount ?? 0)
      );

    case 'amount_desc':
      return sorted.sort((a, b) =>
        Number(b.total_amount ?? 0) - Number(a.total_amount ?? 0)
      );

    default:
      return sorted;
  }
}

// ── 3. SALDO CORRECTO ────────────────────────────────────────────

/**
 * Devuelve el saldo a mostrar de un booking.
 * SIEMPRE leer booking.balance (actualizado por el trigger).
 * NUNCA mostrar total_amount como saldo.
 *
 * @param {Object} booking
 * @returns {{ saldo: number, isPaid: boolean }}
 */
export function getBookingSaldo(booking) {
  const saldo  = Math.max(0, Number(booking.balance ?? booking.total_amount ?? 0));
  const isPaid = saldo <= 0;
  return { saldo, isPaid };
}

/**
 * Texto de saldo para mostrar en la fila de la lista.
 * @param {Object} booking
 * @returns {string}
 */
export function renderSaldoText(booking) {
  const { saldo, isPaid } = getBookingSaldo(booking);
  if (isPaid) return `<span class="text-green">✓ Pagado</span>`;
  return `Saldo: <span class="text-red">${formatCurrency(saldo)}</span>`;
}

/**
 * Texto para el tooltip del calendario.
 * @param {Object} booking
 * @returns {string}  HTML
 */
export function renderTooltipSaldo(booking) {
  const total  = Number(booking.total_amount ?? 0);
  const { saldo, isPaid } = getBookingSaldo(booking);

  return `
    <div class="tooltip-financials">
      <div class="tooltip-row">
        <span>Total</span>
        <strong>${formatCurrency(total)}</strong>
      </div>
      <div class="tooltip-row ${isPaid ? 'text-green' : 'text-red'}">
        <span>Saldo</span>
        <strong>${isPaid ? '✓ Pagado' : formatCurrency(saldo)}</strong>
      </div>
    </div>
  `;
}

// ── 4. BOTÓN "ABONÓ TOTAL" ───────────────────────────────────────

/**
 * Registra el pago completo del saldo restante.
 * El trigger sync_booking_balance actualiza bookings.balance = 0 automáticamente.
 *
 * @param {Object} booking
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} [paymentMethod]
 * @returns {Promise<boolean>}
 */
export async function marcarPagadoTotal(booking, supabase, paymentMethod = 'cash') {
  const { saldo, isPaid } = getBookingSaldo(booking);

  if (isPaid) {
    console.log('Booking ya está pagado:', booking.id);
    return true;
  }

  const { error } = await safeInsert(supabase, 'payments', {
    booking_id:     booking.id,
    amount:         saldo,
    payment_type:   'balance',
    payment_method: paymentMethod,
    payment_date:   new Date().toISOString().slice(0, 10),
    notes:          'Pago total registrado',
  }, 'Abonó total');

  if (error) return false;

  // El trigger actualiza bookings automáticamente.
  // Solo hay que refrescar la UI.
  return true;
}

/**
 * Renderiza el botón "Abonó total" en un elemento.
 * Al hacer clic: pide confirmación, registra pago, llama onSuccess.
 *
 * @param {HTMLElement} container
 * @param {Object}      booking
 * @param {Object}      supabase
 * @param {Function}    onSuccess
 */
export function renderPaidInFullButton(container, booking, supabase, onSuccess) {
  const { saldo, isPaid } = getBookingSaldo(booking);

  if (isPaid) {
    container.innerHTML = `<span class="badge badge--green">✓ Pagado en su totalidad</span>`;
    return;
  }

  // Selector de método de pago
  const methods = [
    { value: 'cash',        label: 'Efectivo'     },
    { value: 'transfer',    label: 'Transferencia' },
    { value: 'card',        label: 'Tarjeta'       },
    { value: 'mercadopago', label: 'MercadoPago'   },
  ];

  container.innerHTML = `
    <div class="paid-full-wrap">
      <select class="form-input form-input--sm" id="paid-method-select">
        ${methods.map(m => `<option value="${m.value}">${m.label}</option>`).join('')}
      </select>
      <button type="button" class="btn btn--success btn--sm" id="btn-paid-full">
        ✅ Abonó total (${formatCurrency(saldo)})
      </button>
    </div>
  `;

  container.querySelector('#btn-paid-full').addEventListener('click', async () => {
    const method = container.querySelector('#paid-method-select')?.value ?? 'cash';

    if (!confirm(`¿Registrar pago total de ${formatCurrency(saldo)} (${method})?`)) return;

    const btn = container.querySelector('#btn-paid-full');
    btn.disabled    = true;
    btn.textContent = '⏳ Registrando…';

    const ok = await marcarPagadoTotal(booking, supabase, method);

    if (ok) {
      container.innerHTML = `<span class="badge badge--green">✓ Pagado en su totalidad</span>`;
      if (typeof onSuccess === 'function') onSuccess();
    } else {
      btn.disabled    = false;
      btn.textContent = `✅ Abonó total (${formatCurrency(saldo)})`;
      alert('Error al registrar el pago. Ver consola.');
    }
  });
}

// ── 5. INTEGRACIÓN EN LISTA ──────────────────────────────────────
/*
CÓMO INTEGRAR EN TU BOOKINGLIST EXISTENTE:

import {
  sortBookings, renderSortSelector, renderSaldoText,
  renderPaidInFullButton
} from './patches/booking-list-enhancements.js';

// En la función que carga y renderiza la lista:
async function renderBookingList(bookings) {
  // ① Orden por defecto: más próximas primero
  let sortKey = 'checkin_asc';
  let sorted  = sortBookings(bookings, sortKey);

  // ② Inyectar selector de orden
  renderSortSelector(
    document.getElementById('booking-list-header'),
    (newKey) => {
      sortKey = newKey;
      sorted  = sortBookings(bookings, newKey);
      renderRows(sorted);
    },
    sortKey
  );

  renderRows(sorted);
}

function renderRows(bookings) {
  bookings.forEach(b => {
    // ③ Saldo correcto (lee balance, no total_amount)
    const saldoHtml = renderSaldoText(b);
    row.querySelector('.booking-saldo').innerHTML = saldoHtml;

    // ④ Botón "Abonó total" en la fila
    renderPaidInFullButton(
      row.querySelector('.btn-paid-wrap'),
      b,
      supabase,
      () => recargarLista()
    );
  });
}
*/
