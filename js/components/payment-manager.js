// ═══════════════════════════════════════════════════
// payment-manager.js — Gestión de pagos en reservas
// Extraído de booking-form.js para separación de responsabilidades
// Maneja: filas de pago, recargos tarjeta, resumen, totales
// ═══════════════════════════════════════════════════

import { formatARS, toISODate } from '../supabase-config.js';

export const PAYMENT_METHODS = [
  { value: 'cash',        label: 'Efectivo' },
  { value: 'transfer',    label: 'Transferencia' },
  { value: 'mercadopago', label: 'MercadoPago' },
  { value: 'naranjax',    label: 'Naranja X' },
  { value: 'uala',        label: 'Ualá' },
  { value: 'credit_card', label: 'Tarjeta de Crédito (+10%)' },
  { value: 'debit_card',  label: 'Tarjeta de Débito' },
  { value: 'credit_note', label: 'Nota de Crédito / Voucher' },
];

export class PaymentManager {
  /**
   * @param {object} opts
   * @param {string} opts.containerId   - ID del div donde se renderizan las filas
   * @param {string} opts.addBtnId      - ID del botón "Agregar pago"
   * @param {string} opts.summaryTotalId
   * @param {string} opts.summaryPaidId
   * @param {string} opts.summaryBalId
   * @param {Function} opts.getTotal    - Función que devuelve el total de la reserva
   */
  constructor({
    containerId   = 'payments-container',
    addBtnId      = 'btn-add-payment-row',
    summaryTotalId= 'ps-total',
    summaryPaidId = 'ps-paid',
    summaryBalId  = 'ps-balance',
    getTotal      = () => 0,
  } = {}) {
    this._containerId    = containerId;
    this._addBtnId       = addBtnId;
    this._summaryIds     = { total: summaryTotalId, paid: summaryPaidId, balance: summaryBalId };
    this._getTotal       = getTotal;
    this._rowCount       = 0;
    this._bind();
  }

  _bind() {
    document.getElementById(this._addBtnId)
      ?.addEventListener('click', () => this.addRow());
  }

  /** Añadir una fila de pago (vacía o preexistente). */
  addRow(existing = null) {
    const container = document.getElementById(this._containerId);
    if (!container) return;

    const rowId = `pay-row-${++this._rowCount}`;
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
      <input type="number" class="pay-amount form-control" placeholder="Monto $" min="0" step="100"
             value="${existing?.amount ?? ''}">
      <input type="date" class="pay-date form-control" value="${existing?.payment_date ?? today}">
      <button class="btn btn-icon btn-danger-icon pay-remove" title="Eliminar fila">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <div class="credit-surcharge-info hidden" id="${rowId}-cc" style="grid-column:1/-1;font-size:.75rem;color:var(--color-warning);padding:4px 0">
        +10% recargo tarjeta → total real: <strong id="${rowId}-cc-val">$0</strong>
      </div>`;

    row.querySelector('.pay-remove').addEventListener('click', () => {
      row.remove();
      this.updateSummary();
    });
    row.querySelector('.pay-method').addEventListener('change', () => {
      this._updateCCSurcharge(row);
      this.updateSummary();
    });
    row.querySelector('.pay-amount').addEventListener('input', () => {
      this._updateCCSurcharge(row);
      this.updateSummary();
    });

    container.appendChild(row);
    if (existing) this._updateCCSurcharge(row);

    // Focus en monto si es fila nueva
    if (!existing) setTimeout(() => row.querySelector('.pay-amount')?.focus(), 60);
    this.updateSummary();
    return row;
  }

  _updateCCSurcharge(row) {
    const method = row.querySelector('.pay-method').value;
    const amount = parseFloat(row.querySelector('.pay-amount').value) || 0;
    const isCc   = method === 'credit_card';
    const info   = row.querySelector(`[id$="-cc"]`);
    const val    = row.querySelector(`[id$="-cc-val"]`);
    if (info) info.classList.toggle('hidden', !isCc);
    if (val && isCc) val.textContent = formatARS(amount * 0.10);
  }

  /** Calcular total pagado (incluyendo recargos). */
  getTotalPaid() {
    let sum = 0;
    document.querySelectorAll('.payment-row').forEach(row => {
      const amt    = parseFloat(row.querySelector('.pay-amount')?.value) || 0;
      const method = row.querySelector('.pay-method')?.value;
      sum += method === 'credit_card' ? amt * 1.10 : amt;
    });
    return sum;
  }

  /** Recopilar filas de pago para guardar. */
  getRows() {
    const rows = [];
    document.querySelectorAll('.payment-row').forEach(row => {
      const amt  = parseFloat(row.querySelector('.pay-amount')?.value) || 0;
      const meth = row.querySelector('.pay-method')?.value;
      const date = row.querySelector('.pay-date')?.value;
      if (amt > 0) {
        rows.push({
          method:       meth,
          amount:       meth === 'credit_card' ? amt * 1.10 : amt,
          payment_date: date || toISODate(new Date()),
        });
      }
    });
    return rows;
  }

  /** Actualizar el resumen de totales/saldo. */
  updateSummary() {
    const total   = this._getTotal();
    const paid    = this.getTotalPaid();
    const balance = Math.max(0, total - paid);
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set(this._summaryIds.total,   formatARS(total));
    set(this._summaryIds.paid,    formatARS(paid));
    set(this._summaryIds.balance, formatARS(balance));

    // Visual cue
    const balEl = document.getElementById(this._summaryIds.balance);
    if (balEl) {
      balEl.style.color = balance <= 0 ? 'var(--color-success)' : 'var(--color-warning)';
    }
  }

  /** Limpiar todas las filas. */
  clear() {
    const c = document.getElementById(this._containerId);
    if (c) c.innerHTML = '';
    this._rowCount = 0;
    this.updateSummary();
  }
}
