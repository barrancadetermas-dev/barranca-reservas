// ══════════════════════════════════════════════════
// config-panel.js — Panel de Configuración Administrativa
// Comisiones, recargos, impuestos, operación, reservas
// Todos los valores se guardan en tabla hotel_config
// ══════════════════════════════════════════════════

import { showToast, AppContext } from '../supabase-config.js';
import { can } from '../auth/permissions.js';
import { logAction } from '../services/audit-service.js';
import { AdminUsers } from '../services/admin-users.js';


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
        <button class="config-acc-header" data-acc="units">
          <span><span class="config-acc-icon">🏠</span> Departamentos / Unidades</span>
          <svg class="config-acc-chevron" style="transform:" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="config-acc-body" id="cfg-body-units">
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

    // ── Grupos con accordion — cerrados por defecto, estado en sessionStorage ──
    const ACC_KEY = 'mila_cfg_acc';
    const savedAcc = JSON.parse(sessionStorage.getItem(ACC_KEY) ?? 'null') ?? {};
    // Default: todo cerrado (sin OPEN_DEFAULT)
    const isOpen = (group) => savedAcc[group] === true;

    const groupsHTML = CONFIG_SCHEMA.map((group, gi) => {
      const accId  = `cfg-acc-${gi}`;
      const bodyId = `cfg-body-${gi}`;
      const open   = isOpen(group.group);
      return `
        <div class="config-group" id="${accId}">
          <button class="config-acc-header ${open ? 'open' : ''}" data-acc="${gi}">
            <span><span class="config-acc-icon">${group.icon}</span> ${group.group}</span>
            <svg class="config-acc-chevron" style="transform:${open ? 'rotate(180deg)' : ''}"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div class="config-acc-body ${open ? 'open' : ''}" id="${bodyId}">
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
        <button class="tab" id="cfg-tab-control">👤 Panel &amp; Equipo</button>
        <button class="tab" id="cfg-tab-users" style="display:none">👥 Usuarios</button>
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

        <!-- ── Tarjeta de perfil ── -->
        <div style="background:linear-gradient(135deg,#1e4db7 0%,#3b82f6 100%);border-radius:var(--r-xl);padding:24px;margin-bottom:16px;position:relative;overflow:hidden">
          <div style="position:absolute;top:-30px;right:-30px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.07)"></div>
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;position:relative">
            <div id="cfg-user-avatar" style="width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.2);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:900;flex-shrink:0;box-shadow:0 4px 12px rgba(0,0,0,.25);border:2px solid rgba(255,255,255,.4)">?</div>
            <div style="flex:1;min-width:0">
              <div id="cfg-user-email" style="font-weight:700;font-size:.95rem;color:#fff;opacity:.95">Cargando...</div>
              <div id="cfg-user-role" style="margin-top:5px">
                <span style="font-size:.68rem;background:rgba(255,255,255,.2);color:#fff;padding:2px 10px;border-radius:var(--r-full);font-weight:700">👑 Admin</span>
              </div>
            </div>
          </div>
          <!-- Nombre para mostrar -->
          <div style="position:relative">
            <label style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.7);display:block;margin-bottom:6px">Nombre para mostrar</label>
            <div style="display:flex;gap:8px">
              <input type="text" id="cfg-user-nombre" placeholder="Tu nombre..."
                style="flex:1;border:1px solid rgba(255,255,255,.3);border-radius:var(--r-md);padding:8px 12px;font-size:.85rem;background:rgba(255,255,255,.15);color:#fff;outline:none"
                onkeydown="if(event.key===\'Enter\')document.getElementById(\'cfg-nombre-save\').click()">
              <button id="cfg-nombre-save"
                style="background:#fff;color:#1e4db7;border:none;border-radius:var(--r-md);padding:8px 16px;font-size:.8rem;font-weight:800;cursor:pointer;white-space:nowrap">
                Guardar
              </button>
            </div>
            <div style="font-size:.65rem;color:rgba(255,255,255,.5);margin-top:5px">Aparece en el header y en todas las vistas</div>
          </div>
        </div>

        <!-- ── Acciones rápidas (2 columnas) ── -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">

          <!-- Sesión -->
          <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--r-xl);padding:16px">
            <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-3);margin-bottom:12px">Sesión</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <button class="btn btn-outline btn-sm" id="cfg-logout-btn" style="justify-content:flex-start;gap:8px">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Cerrar sesión
              </button>
              <button class="btn btn-outline btn-sm" id="cfg-notify-schema" style="justify-content:flex-start;gap:8px">
                🔄 Refrescar schema
              </button>
            </div>
          </div>

          <!-- Links externos -->
          <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--r-xl);padding:16px">
            <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-3);margin-bottom:12px">Administración</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <a href="https://supabase.com/dashboard/project/tuneeinpudlsezzmvaro/editor" target="_blank"
                 style="font-size:.78rem;color:var(--color-primary);display:flex;align-items:center;gap:6px;text-decoration:none;padding:3px 0">
                🗄️ SQL Editor
              </a>
              <a href="https://vercel.com/dashboard" target="_blank"
                 style="font-size:.78rem;color:var(--color-primary);display:flex;align-items:center;gap:6px;text-decoration:none;padding:3px 0">
                🚀 Vercel Dashboard
              </a>
              <a href="https://barranca-reservas.vercel.app" target="_blank"
                 style="font-size:.78rem;color:var(--color-primary);display:flex;align-items:center;gap:6px;text-decoration:none;padding:3px 0">
                🌐 App en producción
              </a>
            </div>
          </div>
        </div>

        <!-- ── KPIs del sistema ── -->
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--r-xl);padding:18px;margin-bottom:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-3)">📊 Estado del sistema</div>
            <button class="btn btn-ghost btn-sm" id="cfg-load-stats" style="font-size:.7rem">Actualizar</button>
          </div>
          <div id="cfg-sys-stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
            <div class="cfg-stat-card"><div class="cfg-stat-val" id="sys-stat-bookings">—</div><div class="cfg-stat-lbl">Reservas</div></div>
            <div class="cfg-stat-card"><div class="cfg-stat-val" id="sys-stat-guests">—</div><div class="cfg-stat-lbl">Huéspedes</div></div>
            <div class="cfg-stat-card"><div class="cfg-stat-val" id="sys-stat-revenue">—</div><div class="cfg-stat-lbl">Ingresos</div></div>
            <div class="cfg-stat-card"><div class="cfg-stat-val" id="sys-stat-cleaning">—</div><div class="cfg-stat-lbl">Limpiezas</div></div>
            <div class="cfg-stat-card"><div class="cfg-stat-val" id="sys-stat-maint">—</div><div class="cfg-stat-lbl">Mantenimiento</div></div>
            <div class="cfg-stat-card"><div class="cfg-stat-val" id="sys-stat-reminders">—</div><div class="cfg-stat-lbl">Recordatorios</div></div>
          </div>
        </div>

        <!-- ── Exportar datos ── -->
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--r-xl);padding:18px;margin-bottom:16px">
          <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-3);margin-bottom:12px">📤 Exportar datos</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:0">
            <button class="btn btn-outline btn-sm" id="cfg-exp-toggle-csv"
              style="gap:5px" onclick="var p=document.getElementById('cfg-exp-csv-panel');p.style.display=p.style.display==='none'?'':'none'">
              📋 CSV / Excel ▾
            </button>
            <button class="btn btn-outline btn-sm" id="cfg-exp-toggle-pdf"
              style="gap:5px;opacity:.55;cursor:default" title="Próximamente">
              📄 Reportes PDF <span style="font-size:.62rem;background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:4px;margin-left:3px">v0.2</span>
            </button>
          </div>
          <div id="cfg-exp-csv-panel" style="display:none;margin-top:10px;background:var(--color-surface-2);border-radius:var(--r-lg);padding:12px">
            <div style="font-size:.7rem;color:var(--color-text-3);margin-bottom:8px;font-weight:600">Elegí qué exportar:</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm" id="cfg-export-bookings">📅 Reservas</button>
              <button class="btn btn-outline btn-sm" id="cfg-export-guests">👤 Huéspedes</button>
            </div>
          </div>
        </div>

        <!-- ── MILA Info ── -->
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--r-xl);padding:18px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:.92rem;font-weight:800;color:var(--color-text)">MILA PMS</div>
              <div style="font-size:.72rem;color:var(--color-text-3);margin-top:2px">Sistema de gestión para complejos turísticos</div>
            </div>
            <span style="background:var(--color-primary);color:#fff;padding:3px 12px;border-radius:var(--r-full);font-size:.75rem;font-weight:800">V.01</span>
          </div>
        </div>

      </div>

      <!-- Usuarios tab -->
      <div id="cfg-pane-users" style="display:none">
        <div id="cfg-users-container"></div>
      </div>
    `;
  }

  _bindSave(container) {
    container.querySelector('#btn-save-config')?.addEventListener('click', () => this._save(container));

    // ── Nombre para mostrar — siempre funciona ──
    container.querySelector('#cfg-nombre-save')?.addEventListener('click', async () => {
      const btn    = container.querySelector('#cfg-nombre-save');
      const input  = container.querySelector('#cfg-user-nombre');
      const nombre = input?.value?.trim() ?? '';
      if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
      try {
        const { data: { session } } = await this.db.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) throw new Error('Sin sesión activa');

        // Upsert directo — maneja tanto INSERT como UPDATE
        const { error } = await this.db.from('user_profiles')
          .upsert({ id: uid, nombre: nombre || null }, { onConflict: 'id' });

        // Si falla el upsert (RLS), intentar UPDATE directo
        if (error) {
          const { error: updErr } = await this.db.from('user_profiles')
            .update({ nombre: nombre || null }).eq('id', uid);
          if (updErr) throw new Error('No se pudo guardar. Verificá permisos de base de datos.');
        }

        // Actualizar avatar en el panel
        const avatarEl = container.querySelector('#cfg-user-avatar');
        if (avatarEl) {
          const initial = nombre ? nombre[0].toUpperCase() : (session.user.email?.[0]?.toUpperCase() ?? 'A');
          avatarEl.textContent = initial;
        }
        // Actualizar toda la app
        if (window._applyUserDisplay) {
          window._applyUserDisplay({ nombre: nombre || null, email: session.user.email });
        }
        showToast('Nombre guardado ✓', 'success');
      } catch (err) {
        showToast('Error: ' + (err?.message ?? String(err)), 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
      }
    });

    // ── Tab switching ─────────────────────────────────
    const tabConfig  = container.querySelector('#cfg-tab-config');
    const tabControl = container.querySelector('#cfg-tab-control');
    const tabUsers   = container.querySelector('#cfg-tab-users');
    const paneConfig  = container.querySelector('#cfg-pane-config');
    const paneControl = container.querySelector('#cfg-pane-control');
    const paneUsers   = container.querySelector('#cfg-pane-users');

    const hideAll = () => {
      [tabConfig, tabControl, tabUsers].forEach(t => t?.classList.remove('active'));
      [paneConfig, paneControl, paneUsers].forEach(p => { if (p) p.style.display = 'none'; });
    };

    tabConfig?.addEventListener('click', () => {
      hideAll();
      tabConfig.classList.add('active');
      paneConfig.style.display = '';
    });

    tabControl?.addEventListener('click', async () => {
      hideAll();
      tabControl.classList.add('active');
      paneControl.style.display = '';
      if (paneUsers) paneUsers.style.display = '';
      try {
        const { data: { session } } = await this.db.auth.getSession();
        const user = session?.user;
        if (!user) return;

        // Email
        const emailEl = container.querySelector('#cfg-user-email');
        if (emailEl) emailEl.textContent = user.email ?? '—';

        // Rol desde hotel_users
        const { data: hu } = await this.db
          .from('hotel_users')
          .select('role')
          .eq('user_id', user.id)
          .eq('hotel_id', this.ctx.hotelId)
          .single();
        const roleEl = container.querySelector('#cfg-user-role');
        if (roleEl) {
          const roleMap = { admin: '👑 Administrador', staff: '👤 Staff', demo: '👁 Demo' };
          roleEl.textContent = roleMap[hu?.role ?? 'staff'] ?? hu?.role ?? '—';
        }

        // Avatar de iniciales
        const { data: profile } = await this.db
          .from('user_profiles')
          .select('nombre')
          .eq('id', user.id)
          .single();

        const avatarEl = container.querySelector('#cfg-user-avatar');
        if (avatarEl) {
          const displaySrc = profile?.nombre?.trim() || user.email || 'A';
          avatarEl.textContent = displaySrc[0].toUpperCase();
        }

        // Pre-llenar nombre guardado
        const nombreInput = container.querySelector('#cfg-user-nombre');
        if (nombreInput) nombreInput.value = profile?.nombre ?? '';


      } catch (err) {
        console.warn('[ConfigPanel] control tab load:', err?.message);
      }
    });

    // ── Cargar estadísticas del sistema ──────────────
    const loadSysStats = async () => {
      const btn = container.querySelector('#cfg-load-stats');
      if (btn) { btn.disabled = true; btn.textContent = '⟳ Cargando...'; }
      try {
        const [bkRes, gRes, payRes, clRes, mRes, rRes] = await Promise.all([
          this.db.from('bookings').select('id', { count:'exact', head:true }).eq('hotel_id', this.ctx.hotelId).neq('status','cancelled'),
          this.db.from('guests').select('id',   { count:'exact', head:true }).eq('hotel_id', this.ctx.hotelId),
          this.db.from('payments').select('amount').eq('hotel_id', this.ctx.hotelId),
          this.db.from('cleaning_tasks').select('id', { count:'exact', head:true }).eq('hotel_id', this.ctx.hotelId),
          this.db.from('maintenance_issues').select('id', { count:'exact', head:true }).eq('hotel_id', this.ctx.hotelId),
          this.db.from('reminders').select('id', { count:'exact', head:true }).eq('hotel_id', this.ctx.hotelId),
        ]);
        const totalRev = (payRes.data ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
        const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');
        const set = (id, v) => { const el = container.querySelector('[id="' + id + '"]'); if (el) el.textContent = v; };
        set('sys-stat-bookings',  bkRes.count ?? '—');
        set('sys-stat-guests',    gRes.count  ?? '—');
        set('sys-stat-revenue',   fmt(totalRev));
        set('sys-stat-cleaning',  clRes.count ?? '—');
        set('sys-stat-maint',     mRes.count  ?? '—');
        set('sys-stat-reminders', rRes.count  ?? '—');
      } catch (err) {
        showToast('Error: ' + (err?.message ?? err), 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Actualizar'; }
      }
    };
    container.querySelector('#cfg-load-stats')?.addEventListener('click', loadSysStats);
    // Auto-cargar stats al abrir la pestaña (no esperar click)
    loadSysStats();

    // ── Exportar CSV ──────────────────────────────────
    container.querySelector('#cfg-export-bookings')?.addEventListener('click', async () => {
      try {
        const { data } = await this.db.from('bookings')
          .select('id, status, check_in, check_out, guests(first_name,last_name), booking_units(units(name)), price_per_night, adults, children, source, created_at')
          .eq('hotel_id', this.ctx.hotelId)
          .order('check_in', { ascending: false });
        if (!data?.length) { showToast('Sin reservas para exportar', 'info'); return; }
        const rows = [['ID','Estado','Check-in','Check-out','Huésped','Unidad','Precio/noche','Adultos','Menores','Canal','Creado']];
        data.forEach(b => rows.push([
          b.id, b.status, b.check_in, b.check_out,
          (b.guests ? b.guests.first_name + ' ' + b.guests.last_name : '').trim(),
          b.booking_units?.[0]?.units?.name ?? '',
          b.price_per_night ?? 0, b.adults ?? 1, b.children ?? 0, b.source ?? '', b.created_at?.split('T')[0],
        ]));
        _downloadCSV(rows, 'reservas_mila.csv');
        showToast('✅ Reservas exportadas', 'success');
      } catch (err) { showToast('Error: ' + (err?.message ?? err), 'error'); }
    });

    container.querySelector('#cfg-export-guests')?.addEventListener('click', async () => {
      try {
        const { data } = await this.db.from('guests')
          .select('id, first_name, last_name, dni, email, phone, country, tags, created_at')
          .eq('hotel_id', this.ctx.hotelId)
          .order('last_name');
        if (!data?.length) { showToast('Sin huéspedes para exportar', 'info'); return; }
        const rows = [['ID','Nombre','Apellido','DNI','Email','Teléfono','País','Etiquetas','Creado']];
        data.forEach(g => rows.push([
          g.id, g.first_name ?? '', g.last_name ?? '', g.dni ?? '', g.email ?? '',
          g.phone ?? '', g.country ?? '', (g.tags ?? []).join(';'), g.created_at?.split('T')[0],
        ]));
        _downloadCSV(rows, 'huespedes_mila.csv');
        showToast('✅ Huéspedes exportados', 'success');
      } catch (err) { showToast('Error: ' + (err?.message ?? err), 'error'); }
    });

    // ── Logout ────────────────────────────────────────
    container.querySelector('#cfg-logout-btn')?.addEventListener('click', () => {
      if (confirm('¿Cerrar sesión?')) this.db.auth.signOut();
    });

    // ── Refresh Supabase schema cache ─────────────────
    container.querySelector('#cfg-notify-schema')?.addEventListener('click', async () => {
      const btn = container.querySelector('#cfg-notify-schema');
      btn.disabled = true;
      btn.textContent = '⟳ Actualizando schema...';
      try {
        const { data, error } = await this.db.rpc('reload_postgrest_schema');
        if (error) throw error;
        btn.textContent = '✅ Schema actualizado';
        btn.style.color        = '#16a34a';
        btn.style.borderColor  = '#16a34a';
        showToast('Schema de PostgREST recargado correctamente', 'success');
      } catch (err) {
        btn.textContent = '✗ Error al actualizar';
        btn.style.color       = 'var(--color-danger)';
        btn.style.borderColor = 'var(--color-danger)';
        showToast('Error: ' + (err?.message ?? err), 'error');
        console.error('[ConfigPanel] reload schema:', err);
      } finally {
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = '🔄 Refrescar schema Supabase';
          btn.style.color       = '';
          btn.style.borderColor = '';
        }, 3000);
      }
    });

    // ── Tab Usuarios ──────────────────────────────────
    tabUsers?.addEventListener('click', async () => {
      hideAll();
      tabUsers.classList.add('active');
      paneUsers.style.display = '';
      // Cargar solo la primera vez o si el contenedor está vacío
      const usersContainer = container.querySelector('#cfg-users-container');
      if (usersContainer && !usersContainer.dataset.loaded) {
        usersContainer.dataset.loaded = '1';
        const adminUsers = new AdminUsers(this.db, this.ctx);
        await adminUsers.load(usersContainer);
      }
    });

    // Accordion toggle
    const ACC_SESSION_KEY = 'mila_cfg_acc';
    container.querySelectorAll('.config-acc-header').forEach(btn => {
      btn.addEventListener('click', () => {
        const body    = btn.nextElementSibling;
        const chevron = btn.querySelector('.config-acc-chevron');
        const wasOpen = body.classList.contains('open');
        body.classList.toggle('open', !wasOpen);
        btn.classList.toggle('open', !wasOpen);
        if (chevron) chevron.style.transform = wasOpen ? '' : 'rotate(180deg)';
        // Persistir estado en sessionStorage para esta sesión
        const groupName = btn.querySelector('span > span:last-child, span')?.textContent?.replace(/^\S+\s/, '').trim();
        if (groupName) {
          const saved = JSON.parse(sessionStorage.getItem(ACC_SESSION_KEY) ?? '{}');
          saved[groupName] = !wasOpen;
          sessionStorage.setItem(ACC_SESSION_KEY, JSON.stringify(saved));
        }
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

      await logAction('UPDATE', 'config', this.ctx.hotelId, 'Configuración actualizada: ' + upserts.map(u => u.key).join(', '));
      showToast('Configuración guardada ✓', 'success');

    } catch (err) {
      console.error('[ConfigPanel] save error:', err);
      showToast('Error al guardar: ' + (err.message ?? err), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar configuración'; }
    }
  }


  static getNumber(key, defaultVal = 0) {
    return parseFloat(AppContext.config?.[key] ?? defaultVal) || defaultVal;
  }
}
