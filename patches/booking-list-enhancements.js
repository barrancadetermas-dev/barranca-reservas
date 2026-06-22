/**
 * MILA PMS — patches/booking-list-enhancements.js
 *
 * 1. Orden por defecto: check_in ASC (más próximas primero)
 * 2. Tabs de ordenamiento: 5 opciones
 * 3. Saldo correcto: lee booking.balance (no total_amount)
 * 4. Botón "Abonó total" en lista y detalle
 * 5. Tooltip con saldo real
 */

import { formatCurrency } from '../utils/calculos.js';

// ── SORT ─────────────────────────────────────────────────────────

export const SORT_OPTIONS = [
  { value: 'checkin_asc',  label: '📅 Más próximas' },
  { value: 'checkin_desc', label: '📅 Más lejanas'  },
  { value: 'unit_asc',     label: '🏠 Departamento' },
  { value: 'amount_asc',   label: '💰 Menor monto'  },
  { value: 'amount_desc',  label: '💰 Mayor monto'  },
];

export function sortBookings(bookings, key = 'checkin_asc') {
  const b = [...bookings];
  switch (key) {
    case 'checkin_asc':  return b.sort((a,b) => new Date(a.check_in)      - new Date(b.check_in));
    case 'checkin_desc': return b.sort((a,b) => new Date(b.check_in)      - new Date(a.check_in));
    case 'unit_asc':     return b.sort((a,b) => (a.unit_name??'').localeCompare(b.unit_name??'','es'));
    case 'amount_asc':   return b.sort((a,b) => +a.total_amount - +b.total_amount);
    case 'amount_desc':  return b.sort((a,b) => +b.total_amount - +a.total_amount);
    default:             return b;
  }
}

/**
 * Inyecta las tabs de ordenamiento en un contenedor.
 * @param {HTMLElement} el        - Donde insertar las tabs
 * @param {Function}    onChange  - callback(sortKey)
 * @param {string}      current   - key inicial
 */
export function renderSortTabs(el, onChange, current = 'checkin_asc') {
  const wrap = document.createElement('div');
  wrap.className = 'booking-sort-wrap';
  wrap.innerHTML = `
    <span class="sort-label">Ordenar:</span>
    <div class="sort-tabs">
      ${SORT_OPTIONS.map(o => `
        <button type="button"
          class="sort-tab ${o.value === current ? 'sort-tab--active' : ''}"
          data-sort="${o.value}">${o.label}</button>
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
  el.prepend(wrap);
}

// ── SALDO ────────────────────────────────────────────────────────

/**
 * Saldo real de un booking.
 * Siempre lee booking.balance (calculado por recalculate_booking_totals).
 */
export function getBookingSaldo(booking) {
  const saldo  = Math.max(0, Number(booking.balance ?? 0));
  const isPaid = saldo <= 0;
  return { saldo, isPaid };
}

/** HTML para la columna "Saldo" en la lista */
export function renderSaldoHTML(booking) {
  const { saldo, isPaid } = getBookingSaldo(booking);
  if (isPaid) return `<span class="badge badge--green">✓ Pagado</span>`;
  return `Saldo: <strong class="text-red">${formatCurrency(saldo)}</strong>`;
}

/** HTML para el tooltip del calendario */
export function renderTooltipSaldo(booking) {
  const total  = Number(booking.total_amount ?? 0);
  const paid   = Number(booking.total_paid   ?? 0);
  const { saldo, isPaid } = getBookingSaldo(booking);
  return `
    <div class="tooltip-financials">
      <div class="tooltip-row">
        <span>Total</span><strong>${formatCurrency(total)}</strong>
      </div>
      ${paid > 0 ? `
      <div class="tooltip-row text-green">
        <span>Pagado</span><strong>${formatCurrency(paid)}</strong>
      </div>` : ''}
      <div class="tooltip-row ${isPaid ? 'text-green' : 'text-red'}">
        <span>Saldo</span>
        <strong>${isPaid ? '✓ Pagado' : formatCurrency(saldo)}</strong>
      </div>
    </div>
  `;
}

// ── BOTÓN "ABONÓ TOTAL" ──────────────────────────────────────────

const PAYMENT_METHODS = [
  { value: 'cash',        label: '💵 Efectivo'      },
  { value: 'transfer',    label: '🏦 Transferencia'  },
  { value: 'card',        label: '💳 Tarjeta'        },
  { value: 'mercadopago', label: '💙 MercadoPago'    },
];

/**
 * Registra pago total del saldo restante.
 * El trigger recalculate_booking_totals actualiza balance→0 y status→'paid'.
 */
export async function marcarPagadoTotal(booking, supabase, method = 'cash') {
  const { saldo, isPaid } = getBookingSaldo(booking);
  if (isPaid) return true;

  const { error } = await supabase
    .from('payments')
    .insert({
      booking_id:     booking.id,
      hotel_id:       booking.hotel_id,
      amount:         saldo,
      currency:       'ARS',
      payment_type:   'balance',
      method:         method,
      payment_date:   new Date().toISOString().slice(0, 10),
      notes:          'Pago total registrado',
    });

  if (error) {
    console.error('marcarPagadoTotal error:', error.message, error);
    return false;
  }
  return true;
}

/**
 * Renderiza el botón "Abonó total" en un contenedor.
 *
 * @param {HTMLElement} el
 * @param {Object}      booking
 * @param {Object}      supabase
 * @param {Function}    onSuccess  - callback tras pago exitoso
 */
export function renderPaidInFullButton(el, booking, supabase, onSuccess) {
  const { saldo, isPaid } = getBookingSaldo(booking);

  if (isPaid) {
    el.innerHTML = `<span class="badge badge--green">✓ Pagado en su totalidad</span>`;
    return;
  }

  el.innerHTML = `
    <div class="paid-full-wrap">
      <select class="form-input form-input--sm" id="pif-method">
        ${PAYMENT_METHODS.map(m =>
          `<option value="${m.value}">${m.label}</option>`
        ).join('')}
      </select>
      <button type="button" class="btn btn--success btn--sm" id="pif-btn">
        ✅ Abonó total (${formatCurrency(saldo)})
      </button>
    </div>
  `;

  el.querySelector('#pif-btn').addEventListener('click', async () => {
    const method = el.querySelector('#pif-method').value;
    if (!confirm(`¿Registrar pago total de ${formatCurrency(saldo)} en ${method}?`)) return;

    const btn = el.querySelector('#pif-btn');
    btn.disabled    = true;
    btn.textContent = '⏳ Registrando…';

    const ok = await marcarPagadoTotal(booking, supabase, method);
    if (ok) {
      el.innerHTML = `<span class="badge badge--green">✓ Pagado en su totalidad</span>`;
      if (typeof onSuccess === 'function') onSuccess();
    } else {
      btn.disabled    = false;
      btn.textContent = `✅ Abonó total (${formatCurrency(saldo)})`;
      alert('Error al registrar pago. Ver consola.');
    }
  });
}

// ── INTEGRACIÓN RÁPIDA ───────────────────────────────────────────
/*
import {
  sortBookings, renderSortTabs,
  renderSaldoHTML, renderTooltipSaldo,
  renderPaidInFullButton
} from './patches/booking-list-enhancements.js';

// Al renderizar la lista:
let sortKey = 'checkin_asc';

function renderList(bookings) {
  const sorted = sortBookings(bookings, sortKey);

  // Tabs de orden (solo la primera vez o al re-renderizar el header)
  renderSortTabs(document.getElementById('list-header'), key => {
    sortKey = key;
    renderList(bookings);
  }, sortKey);

  sorted.forEach(booking => {
    // Saldo correcto en cada fila:
    row.querySelector('.col-saldo').innerHTML = renderSaldoHTML(booking);

    // Botón "Abonó total" en el modal de detalle:
    renderPaidInFullButton(
      document.getElementById('btn-paid-container'),
      booking, supabase,
      () => recargarLista()
    );
  });
}

// En el tooltip del calendario:
tooltipEl.querySelector('.tooltip-financials-wrap').innerHTML = renderTooltipSaldo(booking);
*/
