// ══════════════════════════════════════════════════
// config-panel.js — Panel de Configuración Administrativa
// Comisiones, recargos, impuestos, operación, reservas
// Todos los valores se guardan en tabla hotel_config
// ══════════════════════════════════════════════════

import { showToast, AppContext } from '../supabase-config.js';
import { can } from '../auth/permissions.js';
import { logAction } from '../services/audit-service.js';
import { AdminUsers } from './admin-users.js';

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
        <button class="tab" id="cfg-tab-users">👥 Usuarios</button>
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

        <!-- User card -->
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--r-xl);padding:20px 24px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px">
            <div id="cfg-user-avatar"
              style="width:52px;height:52px;border-radius:50%;
                     background:linear-gradient(135deg,var(--color-primary),var(--color-primary-hover));
                     color:white;display:flex;align-items:center;justify-content:center;
                     font-size:22px;font-weight:700;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.18)">?</div>
            <div style="min-width:0;flex:1">
              <div id="cfg-user-email"
                style="font-weight:700;font-size:1rem;color:var(--color-text);
                       white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Cargando...</div>
              <div id="cfg-user-role"
                style="font-size:.73rem;margin-top:4px;display:inline-flex;align-items:center;gap:4px;
                       background:var(--color-primary-light);color:var(--color-primary);
                       padding:2px 10px;border-radius:var(--r-full);font-weight:600">
                👑 Administrador
              </div>
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-danger btn-sm" id="cfg-logout-btn" style="display:flex;align-items:center;gap:6px">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
                <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Cerrar Sesión
            </button>
          </div>
        </div>

        <!-- System stats -->
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--r-xl);padding:16px 20px;margin-bottom:16px">
          <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--color-text-3);margin-bottom:14px">📊 Estadísticas del Sistema</div>
          <div id="cfg-sys-stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
            <div class="cfg-stat-card"><div class="cfg-stat-val" id="sys-stat-bookings">—</div><div class="cfg-stat-lbl">Reservas totales</div></div>
            <div class="cfg-stat-card"><div class="cfg-stat-val" id="sys-stat-guests">—</div><div class="cfg-stat-lbl">Huéspedes</div></div>
            <div class="cfg-stat-card"><div class="cfg-stat-val" id="sys-stat-revenue">—</div><div class="cfg-stat-lbl">Ingresos totales</div></div>
            <div class="cfg-stat-card"><div class="cfg-stat-val" id="sys-stat-cleaning">—</div><div class="cfg-stat-lbl">Tareas limpieza</div></div>
            <div class="cfg-stat-card"><div class="cfg-stat-val" id="sys-stat-maint">—</div><div class="cfg-stat-lbl">Incidencias mant.</div></div>
            <div class="cfg-stat-card"><div class="cfg-stat-val" id="sys-stat-reminders">—</div><div class="cfg-stat-lbl">Recordatorios</div></div>
          </div>
          <button class="btn btn-outline btn-sm" id="cfg-load-stats" style="margin-top:12px;font-size:.78rem">
            🔄 Cargar estadísticas
          </button>
        </div>

        <!-- Quick export -->
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--r-xl);padding:16px 20px;margin-bottom:16px">
          <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--color-text-3);margin-bottom:10px">📤 Exportar Datos</div>
          <p style="font-size:.8rem;color:var(--color-text-2);margin-bottom:12px">Exportá reservas y huéspedes como CSV para backup o análisis externo.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-outline btn-sm" id="cfg-export-bookings">📋 Exportar Reservas (CSV)</button>
            <button class="btn btn-outline btn-sm" id="cfg-export-guests">👤 Exportar Huéspedes (CSV)</button>
          </div>
        </div>

        <!-- Quick links -->
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--r-xl);padding:16px 20px;margin-bottom:16px">
          <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--color-text-3);margin-bottom:10px">🔗 Accesos Rápidos</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <a href="https://supabase.com/dashboard/project/tuneeinpudlsezzmvaro/editor" target="_blank"
               class="btn btn-outline btn-sm" style="justify-content:flex-start;gap:8px;text-decoration:none">
              🗄️ SQL Editor — Supabase
            </a>
            <a href="https://supabase.com/dashboard/project/tuneeinpudlsezzmvaro/auth/users" target="_blank"
               class="btn btn-outline btn-sm" style="justify-content:flex-start;gap:8px;text-decoration:none">
              👥 Gestión de Usuarios — Supabase
            </a>
            <a href="https://vercel.com/dashboard" target="_blank"
               class="btn btn-outline btn-sm" style="justify-content:flex-start;gap:8px;text-decoration:none">
              🚀 Vercel Dashboard
            </a>
          </div>
        </div>

        <!-- Danger zone -->
        <div style="background:var(--color-surface);border:1px solid #fde68a;border-radius:var(--r-xl);padding:16px 20px;margin-bottom:16px">
          <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#b45309;margin-bottom:8px">⚠️ Zona de peligro</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-outline btn-sm" id="cfg-notify-schema"
              style="color:#b45309;border-color:#fbbf24;font-size:.78rem">
              🔄 Refrescar schema Supabase
            </button>
          </div>
        </div>

        <!-- Changelog -->
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--r-xl);padding:16px 20px;margin-bottom:16px">
          <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--color-text-3);margin-bottom:12px">📋 Changelog — MILA PMS v8</div>
          <div style="font-size:.78rem;color:var(--color-text-2);line-height:1.6">
            ${[
              ['v8.4','Jun 2026','Panel de Control con stats + exports + links rápidos'],
              ['v8.3','Jun 2026','Indicador cliente nuevo/frecuente · USD en pagos · Stats desde 2026'],
              ['v8.2','Jun 2026','10 temas de color · Recordatorios CRUD · Auto-limpieza en checkout'],
              ['v8.1','Jun 2026','Paso 5 Voucher · PDF profesional · WhatsApp encargada'],
              ['v8.0','Jun 2026','Operaciones (Limpieza + Mantenimiento) · Event delegation · Flags mejorados'],
              ['v7.x','May 2026','Calendario drag-drop · Bloqueos · Estadísticas SVG · Export Excel'],
              ['v6.x','May 2026','Dashboard KPIs · Dólar widget · Notificaciones realtime · Auditoría'],
            ].map(([v,d,txt]) => `
              <div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--color-border)">
                <span style="background:var(--color-primary-light);color:var(--color-primary);
                             padding:1px 8px;border-radius:var(--r-full);font-size:.68rem;
                             font-weight:700;flex-shrink:0;height:fit-content">${v}</span>
                <div><span style="color:var(--color-text-3);font-size:.7rem">${d} ·</span> ${txt}</div>
              </div>`).join('')}
          </div>
        </div>

        <!-- System info -->
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--r-xl);padding:16px 20px">
          <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--color-text-3);margin-bottom:12px">ℹ️ Información del sistema</div>
          <div style="font-size:.82rem;color:var(--color-text-2);line-height:1.9">
            <div>📦 <span style="color:var(--color-text-3)">Versión:</span> <strong>MILA PMS v8.4</strong></div>
            <div>🗄️ <span style="color:var(--color-text-3)">Supabase:</span> <code style="font-size:.72rem;background:var(--color-surface-2);padding:1px 6px;border-radius:4px">tuneeinpudlsezzmvaro</code></div>
            <div>🌐 <span style="color:var(--color-text-3)">App:</span> <a href="https://barranca-reservas.vercel.app" target="_blank" style="color:var(--color-primary);text-decoration:none">barranca-reservas.vercel.app ↗</a></div>
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

        // Avatar desde user_profiles
        const { data: profile } = await this.db
          .from('user_profiles')
          .select('avatar_id, avatar_color, nombre')
          .eq('id', user.id)
          .single();

        this._currentUserId      = user.id;
        this._currentAvatarId    = profile?.avatar_id    ?? 1;
        this._currentAvatarColor = profile?.avatar_color ?? '#6366f1';

        const avatarEl = container.querySelector('#cfg-user-avatar');
        if (avatarEl) {
          avatarEl.innerHTML = this._renderAvatarEl(
            this._currentAvatarId,
            this._currentAvatarColor
          );
          // Lápiz de edición
          avatarEl.style.position = 'relative';
          avatarEl.style.cursor   = 'pointer';
          avatarEl.title          = 'Cambiar avatar';
          avatarEl.addEventListener('click', () => {
            this._openAvatarSelector(container, user.id);
          });
        }
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

      await logAction('UPDATE', 'config', this.ctx.hotelId, 'Configuración actualizada: ' + upserts.map(u => u.key).join(', '));
      showToast('Configuración guardada ✓', 'success');

    } catch (err) {
      console.error('[ConfigPanel] save error:', err);
      showToast('Error al guardar: ' + (err.message ?? err), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar configuración'; }
    }
  }

  // ── Avatar helpers ────────────────────────────────

  // Los 8 avatares: emoji + etiqueta
  static AVATARS = [
    { id: 1, emoji: '😊', label: 'Sonrisa'   },
    { id: 2, emoji: '🏡', label: 'Casa'       },
    { id: 3, emoji: '⭐', label: 'Estrella'   },
    { id: 4, emoji: '🌴', label: 'Palmera'    },
    { id: 5, emoji: '🔑', label: 'Llave'      },
    { id: 6, emoji: '☀️', label: 'Sol'         },
    { id: 7, emoji: '🌙', label: 'Luna'        },
    { id: 8, emoji: '🎯', label: 'Target'     },
  ];

  _renderAvatarEl(avatarId, avatarColor) {
    const av     = ConfigPanel.AVATARS.find(a => a.id === avatarId) ?? ConfigPanel.AVATARS[0];
    const pencil = `
      <div style="
        position:absolute;bottom:0;right:0;
        width:20px;height:20px;border-radius:50%;
        background:#3b82f6;border:2px solid var(--color-bg,#0f172a);
        display:flex;align-items:center;justify-content:center;font-size:9px;
      ">✏️</div>`;
    return `
      <div style="
        width:52px;height:52px;border-radius:50%;
        background:${avatarColor};
        display:flex;align-items:center;justify-content:center;
        font-size:26px;position:relative;user-select:none;
      ">
        ${av.emoji}
        ${pencil}
      </div>`;
  }

  _openAvatarSelector(container, userId) {
    const existing = document.getElementById('overlay-avatar-selector');
    if (existing) existing.remove();

    const COLORS = [
      '#6366f1','#3b82f6','#22c55e','#f59e0b',
      '#ef4444','#a855f7','#14b8a6','#f97316',
    ];

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'overlay-avatar-selector';
    modal.style.zIndex = '300';
    modal.innerHTML = `
      <div class="modal" style="max-width:360px">
        <div class="modal-header">
          <h3 class="modal-title">Elegir avatar</h3>
          <button class="modal-close" id="av-close">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:.78rem;color:var(--color-text-3);margin-bottom:14px">
            Seleccioná un ícono y un color.
          </p>

          <!-- Ícono -->
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;
                      letter-spacing:.06em;color:var(--color-text-3);margin-bottom:8px">Ícono</div>
          <div id="av-icon-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:18px">
            ${ConfigPanel.AVATARS.map(a => `
              <button class="av-icon-btn" data-id="${a.id}" type="button"
                style="padding:10px;border-radius:var(--r-lg);border:2px solid
                       ${a.id === this._currentAvatarId ? 'var(--color-primary)' : 'var(--color-border)'};
                       background:${a.id === this._currentAvatarId ? 'var(--color-primary-light)' : 'var(--color-surface-2)'};
                       font-size:22px;cursor:pointer;transition:border-color .15s,background .15s"
                title="${a.label}">
                ${a.emoji}
              </button>`).join('')}
          </div>

          <!-- Color -->
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;
                      letter-spacing:.06em;color:var(--color-text-3);margin-bottom:8px">Color de fondo</div>
          <div id="av-color-grid" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px">
            ${COLORS.map(c => `
              <button class="av-color-btn" data-color="${c}" type="button"
                style="width:32px;height:32px;border-radius:50%;background:${c};cursor:pointer;
                       border:3px solid ${c === this._currentAvatarColor ? '#fff' : 'transparent'};
                       outline:${c === this._currentAvatarColor ? '2px solid var(--color-primary)' : 'none'};
                       transition:outline .15s,border .15s">
              </button>`).join('')}
          </div>

          <!-- Preview -->
          <div id="av-preview" style="margin-top:18px;display:flex;align-items:center;gap:12px">
            <div id="av-preview-icon" style="
              width:52px;height:52px;border-radius:50%;
              background:${this._currentAvatarColor};
              display:flex;align-items:center;justify-content:center;font-size:26px;
            ">${ConfigPanel.AVATARS.find(a => a.id === this._currentAvatarId)?.emoji ?? '😊'}</div>
            <span style="font-size:.82rem;color:var(--color-text-2)">Vista previa</span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="av-cancel">Cancelar</button>
          <button class="btn btn-primary" id="av-save">Guardar avatar</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    let selectedId    = this._currentAvatarId;
    let selectedColor = this._currentAvatarColor;

    const previewIcon = modal.querySelector('#av-preview-icon');
    const updatePreview = () => {
      const av = ConfigPanel.AVATARS.find(a => a.id === selectedId) ?? ConfigPanel.AVATARS[0];
      previewIcon.style.background = selectedColor;
      previewIcon.textContent      = av.emoji;
    };

    // Icon selection
    modal.querySelectorAll('.av-icon-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedId = parseInt(btn.dataset.id);
        modal.querySelectorAll('.av-icon-btn').forEach(b => {
          b.style.borderColor = 'var(--color-border)';
          b.style.background  = 'var(--color-surface-2)';
        });
        btn.style.borderColor = 'var(--color-primary)';
        btn.style.background  = 'var(--color-primary-light)';
        updatePreview();
      });
    });

    // Color selection
    modal.querySelectorAll('.av-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedColor = btn.dataset.color;
        modal.querySelectorAll('.av-color-btn').forEach(b => {
          b.style.border  = '3px solid transparent';
          b.style.outline = 'none';
        });
        btn.style.border  = '3px solid #fff';
        btn.style.outline = '2px solid var(--color-primary)';
        updatePreview();
      });
    });

    const close = () => modal.remove();
    modal.querySelector('#av-close').onclick  = close;
    modal.querySelector('#av-cancel').onclick = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    modal.querySelector('#av-save').addEventListener('click', async () => {
      const saveBtn = modal.querySelector('#av-save');
      saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';
      try {
        const { error } = await this.db
          .from('user_profiles')
          .update({
            avatar_id:      selectedId,
            avatar_color:   selectedColor,
            actualizado_en: new Date().toISOString(),
          })
          .eq('id', userId);
        if (error) throw error;

        // Actualizar estado local
        this._currentAvatarId    = selectedId;
        this._currentAvatarColor = selectedColor;

        // Actualizar el avatar en el panel de control sin recargar
        const avatarEl = container.querySelector('#cfg-user-avatar');
        if (avatarEl) {
          avatarEl.innerHTML = this._renderAvatarEl(selectedId, selectedColor);
        }

        // Actualizar avatar en el header/nav si existe
        document.querySelectorAll('.user-avatar-display').forEach(el => {
          el.innerHTML = this._renderAvatarEl(selectedId, selectedColor);
        });

        showToast('Avatar actualizado ✓', 'success');
        close();
      } catch (err) {
        console.error('[ConfigPanel] avatar save:', err);
        showToast('Error: ' + (err?.message ?? err), 'error');
        saveBtn.disabled = false; saveBtn.textContent = 'Guardar avatar';
      }
    });
  }

  // ── Helpers estáticos ─────────────────────────────
  static get(key, defaultVal = null) {
    return AppContext.config?.[key] ?? defaultVal;
  }

  static getNumber(key, defaultVal = 0) {
    return parseFloat(AppContext.config?.[key] ?? defaultVal) || defaultVal;
  }
}
