/**
 * MILA PMS — components/PaymentForm.js
 * Formulario de registro de señas y pagos.
 * Tabla: payments — el trigger sync_booking_balance actualiza bookings automáticamente.
 */

import { safeInsert, preOperationCheck } from '../lib/supabase-debug.js';
import { formatCurrency } from '../utils/calculos.js';

const PAYMENT_TYPES = [
  { value: 'deposit', label: '🟡 Seña / Depósito' },
  { value: 'balance', label: '✅ Saldo final'      },
  { value: 'refund',  label: '🔴 Reembolso'        },
];

const PAYMENT_METHODS = [
  { value: 'cash',         label: '💵 Efectivo'       },
  { value: 'transfer',     label: '🏦 Transferencia'   },
  { value: 'card',         label: '💳 Tarjeta'         },
  { value: 'mercadopago',  label: '💙 MercadoPago'     },
  { value: 'other',        label: '📦 Otro'            },
];

/**
 * Renderiza el modal de registro de pago.
 * @param {string} containerId  - ID del elemento donde inyectar el HTML
 * @param {Object} booking      - Objeto booking con id, total_amount, total_paid, balance
 * @param {Object} supabase     - Cliente Supabase
 * @param {Function} onSuccess  - Callback tras pago exitoso
 */
export function renderPaymentModal(containerId, booking, supabase, onSuccess) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const balance = Number(booking.balance ?? 0);
  const totalAmount = Number(booking.total_amount ?? 0);
  const totalPaid = Number(booking.total_paid ?? 0);

  container.innerHTML = `
    <div class="modal-overlay" id="modal-payment" aria-hidden="true" role="dialog">
      <div class="modal-panel modal-panel--sm">

        <div class="modal-header">
          <h2 class="modal-title">💳 Registrar Pago</h2>
          <button type="button" class="modal-close-btn" id="btn-close-payment" aria-label="Cerrar">✕</button>
        </div>

        <!-- Resumen de saldo actual -->
        <div class="payment-summary">
          <div class="payment-summary__item">
            <span>Total reserva</span>
            <strong>${formatCurrency(totalAmount)}</strong>
          </div>
          <div class="payment-summary__item">
            <span>Ya pagado</span>
            <strong class="text-green">${formatCurrency(totalPaid)}</strong>
          </div>
          <div class="payment-summary__item payment-summary__item--balance">
            <span>Saldo pendiente</span>
            <strong class="${balance > 0 ? 'text-red' : 'text-green'}">${formatCurrency(balance)}</strong>
          </div>
        </div>

        <div class="modal-body">
          <form id="form-payment" novalidate>

            <!-- Monto -->
            <div class="form-group">
              <label for="payment-amount" class="form-label">Monto *</label>
              <div class="input-prefix-wrap">
                <span class="input-prefix">$</span>
                <input
                  type="number"
                  id="payment-amount"
                  name="amount"
                  class="form-input input-prefix-inner"
                  placeholder="${balance > 0 ? balance : '0'}"
                  min="1"
                  step="0.01"
                  required
                >
              </div>
              <button type="button" class="btn-link" id="btn-fill-balance">
                Completar saldo pendiente (${formatCurrency(balance)})
              </button>
            </div>

            <!-- Tipo de pago -->
            <div class="form-group">
              <label for="payment-type" class="form-label">Tipo de pago *</label>
              <select id="payment-type" name="payment_type" class="form-input" required>
                ${PAYMENT_TYPES.map(t =>
                  `<option value="${t.value}">${t.label}</option>`
                ).join('')}
              </select>
            </div>

            <!-- Método de pago -->
            <div class="form-group">
              <label for="payment-method" class="form-label">Método *</label>
              <select id="payment-method" name="payment_method" class="form-input" required>
                ${PAYMENT_METHODS.map(m =>
                  `<option value="${m.value}">${m.label}</option>`
                ).join('')}
              </select>
            </div>

            <!-- Fecha -->
            <div class="form-group">
              <label for="payment-date" class="form-label">Fecha</label>
              <input
                type="date"
                id="payment-date"
                name="payment_date"
                class="form-input"
                value="${new Date().toISOString().slice(0, 10)}"
              >
            </div>

            <!-- Notas -->
            <div class="form-group">
              <label for="payment-notes" class="form-label">Notas</label>
              <input
                type="text"
                id="payment-notes"
                name="notes"
                class="form-input"
                placeholder="Ej: seña por transferencia Banco Macro"
                maxlength="200"
              >
            </div>

            <!-- Error display -->
            <div id="payment-error" class="form-error" style="display:none"></div>

          </form>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn--secondary" id="btn-cancel-payment">Cancelar</button>
          <button type="button" class="btn btn--primary" id="btn-submit-payment">
            <span id="btn-submit-text">Registrar pago</span>
            <span id="btn-submit-spinner" style="display:none">⏳ Guardando…</span>
          </button>
        </div>

      </div>
    </div>
  `;

  // ── Event listeners ───────────────────────────────────────────

  // Completar con saldo pendiente
  document.getElementById('btn-fill-balance')?.addEventListener('click', () => {
    document.getElementById('payment-amount').value = balance > 0 ? balance : '';
    // Si es el saldo completo, auto-seleccionar tipo "balance"
    if (balance > 0) {
      document.getElementById('payment-type').value = 'balance';
    }
  });

  // Cerrar
  const closeFn = () => {
    document.getElementById('modal-payment')?.classList.remove('modal--active');
    document.getElementById('modal-payment')?.setAttribute('aria-hidden', 'true');
  };
  document.getElementById('btn-close-payment')?.addEventListener('click', closeFn);
  document.getElementById('btn-cancel-payment')?.addEventListener('click', closeFn);

  // Submit
  document.getElementById('btn-submit-payment')?.addEventListener('click', async () => {
    await handlePaymentSubmit(booking.id, supabase, onSuccess);
  });

  // Abrir el modal
  const modal = document.getElementById('modal-payment');
  modal.classList.add('modal--active');
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('payment-amount')?.focus();
}

/**
 * Maneja el submit del formulario de pago.
 */
async function handlePaymentSubmit(bookingId, supabase, onSuccess) {
  const errorEl  = document.getElementById('payment-error');
  const btnText  = document.getElementById('btn-submit-text');
  const btnSpinner = document.getElementById('btn-submit-spinner');

  // Leer valores
  const amount        = parseFloat(document.getElementById('payment-amount')?.value);
  const paymentType   = document.getElementById('payment-type')?.value;
  const paymentMethod = document.getElementById('payment-method')?.value;
  const paymentDate   = document.getElementById('payment-date')?.value;
  const notes         = document.getElementById('payment-notes')?.value?.trim();

  // Validación
  errorEl.style.display = 'none';
  if (!amount || amount <= 0) {
    showError(errorEl, 'Ingresá un monto válido mayor a 0.');
    return;
  }
  if (!paymentType) {
    showError(errorEl, 'Seleccioná el tipo de pago.');
    return;
  }

  // UI: loading
  btnText.style.display    = 'none';
  btnSpinner.style.display = 'inline';

  const ctx = await preOperationCheck(supabase);
  if (!ctx.ok) {
    showError(errorEl, 'Sin sesión activa. Recargá la página.');
    resetBtn(btnText, btnSpinner);
    return;
  }

  const payload = {
    booking_id:     bookingId,
    amount:         amount,
    payment_type:   paymentType,
    payment_method: paymentMethod,
    payment_date:   paymentDate || new Date().toISOString().slice(0, 10),
    notes:          notes || null,
  };

  const { error } = await safeInsert(supabase, 'payments', payload, 'PaymentForm');

  if (error) {
    showError(errorEl, `Error al guardar: ${error.message}`);
    resetBtn(btnText, btnSpinner);
    return;
  }

  // Éxito
  document.getElementById('modal-payment')?.classList.remove('modal--active');
  if (typeof onSuccess === 'function') onSuccess();
}

function showError(el, msg) {
  el.textContent  = msg;
  el.style.display = 'block';
}

function resetBtn(btnText, btnSpinner) {
  btnText.style.display    = 'inline';
  btnSpinner.style.display = 'none';
}
