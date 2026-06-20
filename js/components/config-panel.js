// ══════════════════════════════════════════════════
// config-panel.js — Panel de Configuración Administrativa
// Comisiones, recargos, impuestos, operación, reservas
// Todos los valores se guardan en tabla hotel_config
// ══════════════════════════════════════════════════

import { showToast, AppContext } from '../supabase-config.js';
import { can } from '../auth/permissions.js';
import { logAction } from '../services/audit-service.js';

// Definición completa de la configuración
const CONFIG_SCHEMA = [
  {
    group: 'Comisiones por canal (%)',
    icon: '💱',
    fields: [
      { key: 'commission_booking',  label: 'Booking.com',  default: 15, type: 'number', min: 0, max: 100, step: 0.5 },
      { key: 'commission_airbnb',   label: 'Airbnb',       default: 18, type: 'number', min: 0, max: 100, step: 0.5 },
      { key: 'commission_despegar', label: 'Despegar',     default: 12, type: 'number', min: 0, max: 100, step: 0.5 },
      { key: 'commission_expedia',  label: 'Expedia',      default: 15, type: 'number', min: 0, max: 100, step: 0.5 },
    ],
  },
  {
    group: 'Recargos por forma de pago (%)',
    icon: '💳',
    fields: [
      { key: 'surcharge_credit_card', label: 'Tarjeta de Crédito', default: 10, type: 'number', min: 0, max: 50, step: 0.5 },
      { key: 'surcharge_debit_card',  label: 'Tarjeta de Débito',  default: 0,  type: 'number', min: 0, max: 50, step: 0.5 },
      { key: 'surcharge_transfer',    label: 'Transferencia',       default: 0,  type: 'number', min: 0, max: 50, step: 0.5 },
      { key: 'surcharge_mercadopago', label: 'MercadoPago',         default: 0,  type: 'number', min: 0, max: 50, step: 0.5 },
    ],
  },
  {
    group: 'Impuestos (%)',
    icon: '📋',
    fields: [
      { key: 'tax_iva',     label: 'IVA',              default: 21,  type: 'number', min: 0, max: 100, step: 0.5 },
      { key: 'tax_turismo', label: 'Tasa turística',   default: 0,   type: 'number', min: 0, max: 100, step: 0.5 },
    ],
  },
  {
    group: 'Operación',
    icon: '🏨',
    fields: [
      { key: 'checkin_hour',  label: 'Hora estándar de check-in',  default: '14:00', type: 'time' },
      { key: 'checkout_hour', label: 'Hora estándar de check-out', default: '10:00', type: 'time' },
      { key: 'wifi_name',     label: 'Nombre de la red WiFi',       default: '',      type: 'text' },
      { key: 'wifi_pass',     label: 'Contraseña WiFi',             default: '',      type: 'text' },
    ],
  },
  {
    group: 'Reservas',
    icon: '📅',
    fields: [
      { key: 'min_advance_pct',   label: 'Anticipo mínimo requerido (%)', default: 30, type: 'number', min: 0, max: 100, step: 5 },
      { key: 'provisional_days',  label: 'Días máximos reserva provisional', default: 7, type: 'number', min: 1, max: 60, step: 1 },
    ],
  },
];

export class ConfigPanel {
  constructor(supabase, ctx) {
    this.db  = supabase;
    this.ctx = ctx;
    this._values = {}; // valores actuales desde DB
  }

  async load() {
    const container = document.getElementById('config-container');
    if (!container) return;

    if (!can('manageSeasonPricing')) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">🔒</span>
          <p>Solo los administradores pueden acceder a la configuración.</p>
        </div>`;
      return;
    }

    // Cargar valores desde DB
    try {
      const { data } = await this.db
        .from('hotel_config')
        .select('*')
        .eq('hotel_id', this.ctx.hotelId);
      (data ?? []).forEach(row => { this._values[row.key] = row.value; });
    } catch (_) { /* tabla puede no existir aún */ }

    container.innerHTML = this._renderPanel();
    this._bindSave(container);
  }

  _getValue(key, defaultVal) {
    return this._values[key] ?? AppContext.config?.[key] ?? defaultVal;
  }

  _renderPanel() {
    // ── Unidades ─────────────────────────────────────
    const unitsHTML = `
      <div class="config-group" id="cfg-acc-units">
        <button class="config-acc-header open" data-acc="units">
          <span><span class="config-acc-icon">🏠</span> Departamentos / Unidades</span>
          <svg class="config-acc-chevron" style="transform:rotate(180deg)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="config-acc-body open" id="cfg-body-units">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
            ${(this.ctx.units ?? []).map(u => `
              <div style="padding:10px 12px;border:1px solid var(--color-border);
                border-radius:var(--r-lg);background:var(--color-surface-2)">
                <div style="display:flex;align-items:center;gap:8px">
                  <input type="color" class="unit-color-input" data-unit-id="${u.id}"
                         value="${u.color || '#6366F1'}"
                         style="width:26px;height:26px;border:none;border-radius:5px;
                                cursor:pointer;padding:2px;background:none;flex-shrink:0">
                  <div style="min-width:0">
                    <div style="font-size:.76rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.name}</div>
                    <div style="font-size:.63rem;color:var(--color-text-3)">#${u.sort_order ?? '?'} · ${u.max_guests ?? '?'} pers.</div>
                  </div>
                </div>
              </div>`).join('') || '<div style="padding:8px;color:var(--color-text-3);font-size:.8rem">Sin unidades configuradas.</div>'}
          </div>
        </div>
      </div>`;

    // ── Grupos con accordion ──────────────────────────
    const OPEN_DEFAULT = new Set(['Comisiones por canal (%)', 'Operación', 'Reservas']);

    const groupsHTML = CONFIG_SCHEMA.map((group, gi) => {
      const accId  = `cfg-acc-${gi}`;
      const bodyId = `cfg-body-${gi}`;
      const isOpen = OPEN_DEFAULT.has(group.group);
      return `
        <div class="config-group" id="${accId}">
          <button class="config-acc-header ${isOpen ? 'open' : ''}" data-acc="${gi}">
            <span><span class="config-acc-icon">${group.icon}</span> ${group.group}</span>
            <svg class="config-acc-chevron" style="transform:${isOpen ? 'rotate(180deg)' : ''}"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div class="config-acc-body ${isOpen ? 'open' : ''}" id="${bodyId}">
            <div class="config-fields">
              ${group.fields.map(f => {
                const val = this._getValue(f.key, f.default);
                const inputAttrs = f.type === 'number'
                  ? `type="number" min="${f.min}" max="${f.max}" step="${f.step}" value="${val}"`
                  : `type="${f.type}" value="${val}"`;
                return `
                  <div class="config-field">
                    <label for="cfg-${f.key}">${f.label}</label>
                    <div style="display:flex;align-items:center;gap:4px">
                      <input id="cfg-${f.key}" class="config-input" ${inputAttrs}
                             data-key="${f.key}" data-default="${f.default}">
                      ${f.type === 'number' && f.max === 100 ? '<span class="cfg-unit">%</span>' : ''}
                    </div>
                  </div>`;
              }).join('')}
            </div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="section-header-row" style="margin-bottom:20px">
        <div>
          <h3>Configuración del Sistema</h3>
          <p style="font-size:.78rem;color:var(--color-text-3);margin-top:3px">
            🔒 Solo administradores · Cambios se guardan en la base de datos
          </p>
        </div>
        <button class="btn btn-primary" id="btn-save-config">
          💾 Guardar cambios
        </button>
      </div>
      <div class="config-groups">${groupsHTML}${unitsHTML}</div>
    `;
  }

  _bindSave(container) {
    container.querySelector('#btn-save-config')?.addEventListener('click', () => this._save(container));

    // Accordion toggle
    container.querySelectorAll('.config-acc-header').forEach(btn => {
      btn.addEventListener('click', () => {
        const body    = btn.nextElementSibling;
        const chevron = btn.querySelector('.config-acc-chevron');
        const isOpen  = body.classList.contains('open');
        body.classList.toggle('open', !isOpen);
        btn.classList.toggle('open', !isOpen);
        if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
      });
    });

    // Live preview al cambiar color
    container.querySelectorAll('.unit-color-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const preview = input.closest('.config-field').querySelector('.unit-color-preview');
        if (preview) preview.style.background = e.target.value;
      });
      // Guardar al perder foco
      input.addEventListener('change', async (e) => {
        const unitId = input.dataset.unitId;
        const color  = e.target.value;
        try {
          await this.db.from('units').update({ color }).eq('id', unitId);
          // Update local context
          const unit = this.ctx.units.find(u => u.id === unitId);
          if (unit) unit.color = color;
          showToast('Color actualizado ✓', 'success');
        } catch { showToast('Error al guardar color', 'error'); }
      });
    });
  }

  async _save(container) {
    const btn = container.querySelector('#btn-save-config');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    try {
      const inputs = container.querySelectorAll('.config-input[data-key]');
      const upserts = [];

      inputs.forEach(input => {
        const key   = input.dataset.key;
        const value = input.value;
        upserts.push({
          hotel_id:    this.ctx.hotelId,
          key,
          value,
          updated_at:  new Date().toISOString(),
          updated_by:  this.ctx.user?.email ?? 'admin',
        });
        // Actualizar AppContext
        AppContext.config[key] = value;
        this._values[key] = value;
      });

      const { error } = await this.db
        .from('hotel_config')
        .upsert(upserts, { onConflict: 'hotel_id,key' });

      if (error) throw error;

      await logAction('UPDATE', 'config', this.ctx.hotelId, `Configuración actualizada: ${upserts.map(u => u.key).join(', ')}`);
      showToast('Configuración guardada ✓', 'success');

    } catch (err) {
      console.error('[ConfigPanel] save error:', err);
      showToast('Error al guardar: ' + (err.message ?? err), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar configuración'; }
    }
  }

  // Helper público para obtener un valor de config
  static get(key, defaultVal = null) {
    return AppContext.config?.[key] ?? defaultVal;
  }

  static getNumber(key, defaultVal = 0) {
    return parseFloat(AppContext.config?.[key] ?? defaultVal) || defaultVal;
  }
}
