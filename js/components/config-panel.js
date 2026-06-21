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
      <div class="tabs-bar" style="margin-bottom:20px">
        <button class="tab active" id="cfg-tab-config">⚙️ Configuración</button>
        <button class="tab" id="cfg-tab-control">👤 Panel de Control</button>
      </div>

      <!-- Configuración tab -->
      <div id="cfg-pane-config">
        <div class="section-header-row" style="margin-bottom:16px">
          <p style="font-size:.78rem;color:var(--color-text-3)">
            🔒 Solo administradores · Cambios se guardan en la base de datos
          </p>
          <button class="btn btn-primary" id="btn-save-config">💾 Guardar cambios</button>
        </div>
        <div class="config-groups">${groupsHTML}${unitsHTML}</div>
      </div>

      <!-- Panel de Control tab -->
      <div id="cfg-pane-control" style="display:none">
        <div id="cfg-user-card" class="config-group" style="margin-bottom:16px">
          <div style="padding:20px">
            <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
              <div id="cfg-user-avatar" style="width:48px;height:48px;border-radius:50%;background:var(--color-primary);color:white;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;flex-shrink:0">?</div>
              <div>
                <div id="cfg-user-email" style="font-weight:700;font-size:.95rem">Cargando...</div>
                <div id="cfg-user-role" style="font-size:.75rem;color:var(--color-text-3);margin-top:2px">Administrador</div>
              </div>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn btn-danger btn-sm" id="cfg-logout-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Cerrar Sesión
              </button>
            </div>
          </div>
        </div>

        <div class="config-group" style="padding:16px 20px;margin-bottom:16px">
          <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--color-text-3);margin-bottom:12px">⚠️ Zona de peligro</div>
          <p style="font-size:.8rem;color:var(--color-text-2);margin-bottom:10px">Estas acciones son irreversibles. Usá con precaución.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-outline btn-sm" id="cfg-notify-schema" style="color:var(--color-warning);border-color:var(--color-warning)">
              🔄 Refrescar schema Supabase
            </button>
          </div>
        </div>

        <div class="config-group" style="padding:16px 20px">
          <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--color-text-3);margin-bottom:12px">ℹ️ Información del sistema</div>
          <div style="font-size:.8rem;color:var(--color-text-2);line-height:1.7">
            <div>📦 Versión: MILA PMS v8</div>
            <div>🗄️ Supabase: <code style="font-size:.72rem">tuneeinpudlsezzmvaro</code></div>
            <div>🌐 App: <a href="https://barranca-reservas.vercel.app" target="_blank" style="color:var(--color-primary)">barranca-reservas.vercel.app</a></div>
          </div>
        </div>
      </div>
    `;
  }

  _bindSave(container) {
    container.querySelector('#btn-save-config')?.addEventListener('click', () => this._save(container));

    // ── Tab switching ─────────────────────────────────
    const tabConfig  = container.querySelector('#cfg-tab-config');
    const tabControl = container.querySelector('#cfg-tab-control');
    const paneConfig  = container.querySelector('#cfg-pane-config');
    const paneControl = container.querySelector('#cfg-pane-control');

    tabConfig?.addEventListener('click', () => {
      tabConfig.classList.add('active'); tabControl.classList.remove('active');
      paneConfig.style.display  = ''; paneControl.style.display = 'none';
    });

    tabControl?.addEventListener('click', async () => {
      tabControl.classList.add('active'); tabConfig.classList.remove('active');
      paneConfig.style.display = 'none'; paneControl.style.display = '';
      // Load user info
      try {
        const { data: { session } } = await this.db.auth.getSession();
        const user = session?.user;
        const emailEl  = container.querySelector('#cfg-user-email');
        const avatarEl = container.querySelector('#cfg-user-avatar');
        if (emailEl && user) emailEl.textContent = user.email ?? '—';
        if (avatarEl && user) avatarEl.textContent = (user.email ?? 'A')[0].toUpperCase();
      } catch (_) {}
    });

    // ── Logout from Panel de Control ─────────────────
    container.querySelector('#cfg-logout-btn')?.addEventListener('click', () => {
      if (confirm('¿Cerrar sesión?')) this.db.auth.signOut();
    });

    // ── Refresh Supabase schema cache ─────────────────
    container.querySelector('#cfg-notify-schema')?.addEventListener('click', () => {
      showToast('Ejecutá en Supabase SQL Editor: NOTIFY pgrst, \'reload schema\';', 'info');
    });

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
