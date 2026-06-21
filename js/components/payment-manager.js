// ═══════════════════════════════════════════════════
// payment-manager.js v2 — Fila de pago 4 columnas
// Método | Monto | Fecha | Nota (con contador)
// ═══════════════════════════════════════════════════

import { formatARS, toISODate } from '../supabase-config.js';

export const PAYMENT_METHODS = [
  { value: 'cash',        label: 'Efectivo' },
  { value: 'transfer',    label: 'Transferencia' },
  { value: 'mercadopago', label: 'MercadoPago' },
  { value: 'naranjax',    label: 'Naranja X' },
  { value: 'uala',        label: 'Ualá' },
  { value: 'debit_card',  label: 'Tarjeta Débito' },
  { value: 'credit_card', label: 'Tarjeta Crédito (+10%)' },
  { value: 'credit_note', label: 'Nota de Crédito / Voucher' },
];

const MAX_NOTE  = 150;
const WARN_AT   = 100;

export class PaymentManager {
  constructor({
    containerId    = 'payments-container',
    addBtnId       = 'btn-add-payment-row',
    summaryTotalId = 'ps-total',
    summaryPaidId  = 'ps-paid',
    summaryBalId   = 'ps-balance',
    getTotal       = () => 0,
  } = {}) {
    this._containerId = containerId;
    this._addBtnId    = addBtnId;
    this._summaryIds  = { total: summaryTotalId, paid: summaryPaidId, balance: summaryBalId };
    this._getTotal    = getTotal;
    this._rowCount    = 0;
    this._bind();
  }

  _bind() {
    document.getElementById(this._addBtnId)
      ?.addEventListener('click', () => this.addRow());
  }

  addRow(existing = null) {
    const container = document.getElementById(this._containerId);
    if (!container) return;

    const rowId = `pay-row-${++this._rowCount}`;
    const today = toISODate(new Date());
    const row   = document.createElement('div');
    row.className = 'payment-row';
    row.id        = rowId;

    row.innerHTML = `
      <div class="pay-grid">

        <!-- Col 1: Método -->
        <select class="pay-method">
          ${PAYMENT_METHODS.map(m =>
            `<option value="${m.value}"${existing?.method === m.value ? ' selected' : ''}>${m.label}</option>`
          ).join('')}
        </select>

        <!-- Col 2: Monto -->
        <input type="number" class="pay-amount" placeholder="Monto" min="0" step="100"
               value="${existing?.amount ?? ''}" inputmode="numeric">

        <!-- Col 3: Fecha -->
        <input type="date" class="pay-date" value="${existing?.payment_date ?? today}">

        <!-- Col 4: Nota -->
        <div class="pay-note-wrap">
          <input type="text" class="pay-note" placeholder="Nota / comprobante"
                 maxlength="${MAX_NOTE}" value="${existing?.notes ?? ''}">
          <span class="pay-note-counter"></span>
        </div>

        <!-- Eliminar -->
        <button type="button" class="pay-remove" title="Eliminar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <!-- Aviso +10% tarjeta -->
        <div class="pay-cc-info hidden">
          +10% recargo → total real: <strong class="pay-cc-val"></strong>
        </div>

      </div>`;

    // Nota counter
    const noteInput = row.querySelector('.pay-note');
    const counter   = row.querySelector('.pay-note-counter');
    const updateCounter = () => {
      const used = noteInput.value.length;
      const left = MAX_NOTE - used;
      if (used >= WARN_AT) {
        counter.textContent = `Restan ${left} caracteres disponibles`;
        counter.classList.add('warn');
      } else {
        counter.textContent = `${used}/${MAX_NOTE}`;
        counter.classList.remove('warn');
      }
    };
    noteInput.addEventListener('input', updateCounter);
    updateCounter();

    // Eliminar fila
    row.querySelector('.pay-remove').addEventListener('click', () => {
      row.remove();
      this.updateSummary();
    });

    // Recargo tarjeta + resumen
    const updateCC = () => {
      const method = row.querySelector('.pay-method').value;
      const amount = parseFloat(row.querySelector('.pay-amount').value) || 0;
      const isCc   = method === 'credit_card';
      const info   = row.querySelector('.pay-cc-info');
      const val    = row.querySelector('.pay-cc-val');
      if (info) info.classList.toggle('hidden', !isCc);
      if (val && isCc) val.textContent = formatARS(amount * 1.10);
    };

    row.querySelector('.pay-method').addEventListener('change', () => { updateCC(); this.updateSummary(); });
    row.querySelector('.pay-amount').addEventListener('input',  () => { updateCC(); this.updateSummary(); });

    container.appendChild(row);
    if (existing) updateCC();
    if (!existing) setTimeout(() => row.querySelector('.pay-amount')?.focus(), 60);
    this.updateSummary();
    return row;
  }

  getTotalPaid() {
    let sum = 0;
    document.querySelectorAll('.payment-row').forEach(row => {
      const amt  = parseFloat(row.querySelector('.pay-amount')?.value) || 0;
      const meth = row.querySelector('.pay-method')?.value;
      sum += meth === 'credit_card' ? amt * 1.10 : amt;
    });
    return sum;
  }

  getRows() {
    const rows = [];
    document.querySelectorAll('.payment-row').forEach(row => {
      const amt  = parseFloat(row.querySelector('.pay-amount')?.value) || 0;
      const meth = row.querySelector('.pay-method')?.value;
      const date = row.querySelector('.pay-date')?.value;
      const note = row.querySelector('.pay-note')?.value?.trim() || null;
      if (amt > 0) {
        rows.push({
          method:       meth,
          amount:       meth === 'credit_card' ? amt * 1.10 : amt,
          payment_date: date || toISODate(new Date()),
          notes:        note,
        });
      }
    });
    return rows;
  }

  updateSummary() {
    const total   = this._getTotal();
    const paid    = this.getTotalPaid();
    const balance = total - paid;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set(this._summaryIds.total,   formatARS(total));
    set(this._summaryIds.paid,    formatARS(paid));
    set(this._summaryIds.balance, formatARS(Math.abs(balance)));

    const balEl  = document.getElementById(this._summaryIds.balance);
    const balRow = balEl?.closest('.ps-row-balance');
    if (balEl)  balEl.style.color  = balance <= 0 ? 'var(--color-success, #16a34a)' : 'inherit';
    if (balRow) balRow.dataset.sign = balance < 0 ? 'over' : balance === 0 ? 'paid' : 'pending';
  }

  clear() {
    const c = document.getElementById(this._containerId);
    if (c) c.innerHTML = '';
    this._rowCount = 0;
    this.updateSummary();
  }
}
