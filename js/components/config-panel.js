// ══════════════════════════════════════════════════
// config-panel.js — Panel de Configuración Administrativa
// Comisiones, recargos, impuestos, operación, reservas
// Todos los valores se guardan en tabla hotel_config
// ══════════════════════════════════════════════════

import { showToast, AppContext, formatDate } from '../supabase-config.js';
import { can } from '../auth/permissions.js';
import { logAction } from '../services/audit-service.js';
import { AdminUsers } from '../services/admin-users.js';
import { fetchMonthlyRates, fetchCustomColumns, upsertMonthlyRate, upsertCustomColumn,
         deleteCustomColumn, upsertCustomPrice, MONTH_NAMES } from '../services/tariff-service.js';
import { DateRangePicker } from './date-range-picker.js';
import { getPrefs, setPref } from '../services/accessibility.js';


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
    group: 'Horarios de check-in / check-out',
    icon: '🕒',
    fields: [
      { key: 'checkin_time',  label: 'Hora de check-in',  default: '14:00', type: 'time' },
      { key: 'checkout_time', label: 'Hora de check-out', default: '10:00', type: 'time' },
    ],
  },
  {
    group: 'Política de cancelación',
    icon: '❌',
    fields: [
      { key: 'cancel_free_days', label: 'Días antes del check-in para cancelar sin cargo', default: 3,  type: 'number', min: 0, max: 90, step: 1 },
      { key: 'cancel_penalty_pct', label: 'Retención si cancela fuera de ese plazo',       default: 30, type: 'number', min: 0, max: 100, step: 5 },
    ],
  },
  {
    group: 'Dólar — margen sobre cotización oficial (%)',
    icon: '💵',
    fields: [
      { key: 'usd_margin_pct', label: 'Margen aplicado a pagos en USD', default: 0, type: 'number', min: -20, max: 20, step: 0.5, unit: '%' },
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

  // Formatea un número para mostrar en los inputs del Cuadro Tarifario:
  // separador de miles con punto y sufijo ".-" al final (ej: 580.000.-)
  _fmtTariffPrice(n) {
    if (n === '' || n === null || n === undefined || isNaN(n)) return '';
    return Math.round(n).toLocaleString('es-AR') + '.-';
  }

  // Quita el formato para dejar solo los dígitos editables (sin puntos ni .-)
  _rawTariffPrice(val) {
    if (!val) return '';
    return String(val).replace(/\.-$/, '').replace(/\./g, '').trim();
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
                <div style="margin-top:6px">
                  <input type="text" class="unit-rategroup-input" data-unit-id="${u.id}"
                         value="${u.rate_group ?? ''}" placeholder="Grupo tarifario"
                         title="Unidades con el mismo texto se muestran juntas en el Cuadro Tarifario, aunque no tengan precio cargado. Dejar vacío para que se agrupen solo si comparten un precio real."
                         style="width:100%;box-sizing:border-box;font-size:.68rem;padding:4px 6px;
                                border:1px solid var(--color-border);border-radius:5px;
                                background:var(--color-surface);color:var(--color-text)">
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
                      ${f.unit ? `<span class="cfg-unit">${f.unit}</span>` : (f.type === 'number' && f.max === 100 ? '<span class="cfg-unit">%</span>' : '')}
                    </div>
                  </div>`;
              }).join('')}
            </div>
          </div>
        </div>`;
    }).join('');

    // ── Cuadro Tarifario ───────────────────────────────
    const tariffHTML = `
      <div class="config-group" id="cfg-acc-tariffs">
        <button class="config-acc-header" data-acc="tariffs">
          <span><span class="config-acc-icon">🏷️</span> Cuadro Tarifario</span>
          <svg class="config-acc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="config-acc-body" id="cfg-body-tariffs">
          <div id="cfg-tariff-content" style="padding:4px 2px;font-size:.82rem;color:var(--color-text-3)">
            Expandí para cargar el cuadro tarifario...
          </div>
        </div>
      </div>`;

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
        <div class="config-groups">${tariffHTML}${groupsHTML}${unitsHTML}</div>
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
                onkeydown="if(event.key==='Enter')document.getElementById('cfg-nombre-save').click()">
              <button id="cfg-nombre-save"
                style="background:#fff;color:#1e4db7;border:none;border-radius:var(--r-md);padding:8px 16px;font-size:.8rem;font-weight:800;cursor:pointer;white-space:nowrap">
                Guardar
              </button>
            </div>
            <div id="cfg-nombre-status" style="font-size:.65rem;color:rgba(255,255,255,.5);margin-top:5px">Aparece en el header y en todas las vistas</div>
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
            <button class="btn btn-outline btn-sm" id="cfg-exp-toggle-pdf" style="gap:5px">
              📄 Reportes PDF
            </button>
          </div>
          <div id="cfg-exp-csv-panel" style="display:none;margin-top:10px;background:var(--color-surface-2);border-radius:var(--r-lg);padding:12px">
            <div style="font-size:.7rem;color:var(--color-text-3);margin-bottom:8px;font-weight:600">Elegí qué exportar:</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm" id="cfg-export-bookings">📅 Reservas</button>
              <button class="btn btn-outline btn-sm" id="cfg-export-guests">👤 Huéspedes</button>
            </div>
            <div style="border-top:1px solid var(--color-border);margin:10px 0 8px"></div>
            <div style="font-size:.7rem;color:var(--color-text-3);margin-bottom:8px;font-weight:600">Backup completo (copia de seguridad):</div>
            <button class="btn btn-outline btn-sm" id="cfg-export-full-backup" style="gap:5px">
              💾 Descargar todo mi negocio
            </button>
            <div style="font-size:.66rem;color:var(--color-text-3);margin-top:6px">Un solo Excel con 3 hojas: Reservas, Huéspedes y Gastos — completo, sin filtros de fecha.</div>
          </div>
        </div>

        <!-- ── Limpieza de huéspedes inactivos ── -->
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--r-xl);padding:18px;margin-top:16px">
          <div class="card-header" style="margin-bottom:10px">
            <h3>🧹 Limpieza de huéspedes inactivos</h3>
          </div>
          <div style="font-size:.78rem;color:var(--color-text-3);margin-bottom:12px">
            Busca huéspedes sin ninguna visita reciente — se mira la <strong>última</strong> reserva de cada uno,
            no la primera. Si volvió hace poco, no aparece acá aunque su primera visita haya sido hace años.
            Sus reservas históricas <strong>no se borran</strong> (quedan intactas para tus estadísticas), solo se
            desvincula el huésped.
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <label style="font-size:.8rem;color:var(--color-text-2)">Años sin visitas:</label>
            <input type="number" id="cfg-inactive-years" value="5" min="1" max="20" style="width:70px;padding:6px 8px;border:1px solid var(--color-border);border-radius:var(--r-sm);background:var(--color-surface);color:var(--color-text)">
            <button class="btn btn-outline btn-sm" id="cfg-find-inactive">🔍 Buscar candidatos</button>
          </div>
          <div id="cfg-inactive-results" style="margin-top:14px"></div>
        </div>

        <!-- ── Accesibilidad ── -->
        <div class="config-group" id="cfg-acc-a11y">
          <button class="config-acc-header" data-acc="a11y">
            <span><span class="config-acc-icon">♿</span> Accesibilidad</span>
            <svg class="config-acc-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="config-acc-body" id="cfg-body-a11y">
          <div style="font-size:.78rem;color:var(--color-text-3);margin-bottom:6px;margin-top:10px">
            Activá lo que necesites — queda guardado y se aplica solo cada vez que entrás, en cualquier
            dispositivo.
          </div>

          <div class="a11y-panel-row">
            <div class="a11y-panel-label">
              <span>Aa</span>
              <div>Tamaño de letra<small>Agranda todo el texto de la app, parejo</small></div>
            </div>
            <div class="a11y-font-controls">
              <button type="button" class="a11y-font-btn" id="a11y-font-minus">−</button>
              <span class="a11y-font-value" id="a11y-font-value">100%</span>
              <button type="button" class="a11y-font-btn" id="a11y-font-plus">+</button>
            </div>
          </div>

          <div class="a11y-panel-row">
            <div class="a11y-panel-label">
              <span>🌓</span>
              <div>Alto contraste<small>Colores al máximo, para leer mejor</small></div>
            </div>
            <label class="a11y-toggle">
              <input type="checkbox" id="a11y-toggle-highContrast">
              <span class="a11y-toggle-slider"></span>
            </label>
          </div>

          <div class="a11y-panel-row">
            <div class="a11y-panel-label">
              <span>🎨</span>
              <div>Modo daltónico<small>Suma símbolos (✓ ◐ ✕) además del color rojo/amarillo/verde</small></div>
            </div>
            <label class="a11y-toggle">
              <input type="checkbox" id="a11y-toggle-colorblind">
              <span class="a11y-toggle-slider"></span>
            </label>
          </div>

          <div class="a11y-panel-row">
            <div class="a11y-panel-label">
              <span>🔍</span>
              <div>Lupa flotante<small>Sigue el cursor y amplía 2x lo que hay debajo</small></div>
            </div>
            <label class="a11y-toggle">
              <input type="checkbox" id="a11y-toggle-magnifier">
              <span class="a11y-toggle-slider"></span>
            </label>
          </div>

          <div class="a11y-panel-row">
            <div class="a11y-panel-label">
              <span>🔊</span>
              <div>Narración por voz<small>Seleccioná cualquier texto y aparece un botón para escucharlo</small></div>
            </div>
            <label class="a11y-toggle">
              <input type="checkbox" id="a11y-toggle-narration">
              <span class="a11y-toggle-slider"></span>
            </label>
          </div>

          <div class="a11y-panel-row">
            <div class="a11y-panel-label">
              <span>🎬</span>
              <div>Reducir animaciones<small>Apaga transiciones y efectos de movimiento</small></div>
            </div>
            <label class="a11y-toggle">
              <input type="checkbox" id="a11y-toggle-reduceMotion">
              <span class="a11y-toggle-slider"></span>
            </label>
          </div>

          <div class="a11y-panel-row">
            <div class="a11y-panel-label">
              <span>⌨️</span>
              <div>Resaltar foco de teclado<small>Contorno bien visible al navegar con Tab</small></div>
            </div>
            <label class="a11y-toggle">
              <input type="checkbox" id="a11y-toggle-focusVisible">
              <span class="a11y-toggle-slider"></span>
            </label>
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

    // ── Nombre para mostrar ──
    container.querySelector('#cfg-nombre-save')?.addEventListener('click', async () => {
      const btn    = container.querySelector('#cfg-nombre-save');
      const input  = container.querySelector('#cfg-user-nombre');
      const status = container.querySelector('#cfg-nombre-status');
      const nombre = input?.value?.trim() ?? '';
      if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
      try {
        const { data: { session } } = await this.db.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) throw new Error('Sin sesión activa');

        const { error } = await this.db.from('user_profiles')
          .upsert({ id: uid, nombre: nombre || null }, { onConflict: 'id' });

        if (error) {
          const { error: updErr } = await this.db.from('user_profiles')
            .update({ nombre: nombre || null }).eq('id', uid);
          if (updErr) {
            if (updErr.message?.includes('nombre') || updErr.code === '42703') {
              if (status) status.innerHTML = '⚠️ Ejecutá en Supabase SQL Editor: <code style="font-size:.68rem">ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS nombre TEXT; NOTIFY pgrst, \'reload schema\';</code>';
              showToast('⚠️ Columna "nombre" no existe aún — ver instrucción abajo', 'warning');
              return;
            }
            throw new Error('No se pudo guardar: ' + (updErr.message ?? ''));
          }
        }

        const avatarEl = container.querySelector('#cfg-user-avatar');
        if (avatarEl) {
          const initial = nombre ? nombre[0].toUpperCase() : (session.user.email?.[0]?.toUpperCase() ?? 'A');
          avatarEl.textContent = initial;
        }
        if (window._applyUserDisplay) {
          window._applyUserDisplay({ nombre: nombre || null, email: session.user.email });
        }
        if (status) status.textContent = 'Aparece en el header y en todas las vistas';
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

    // ── Exportar datos — con dropdown de rango ──────────
    container.querySelector('#cfg-export-bookings')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const { showExportDropdown, exportBookingsExcel, exportBookingsCSV, exportBookingsPDF } =
        await import('../services/export-service.js');

      // Mismo select que booking-list con FK hint explícito (evita $0 por ambigüedad PostgREST)
      const { data: allBookings, error: bErr } = await this.db.from('bookings')
        .select(`id, check_in, check_out, nights, status, source,
          total_amount, total_paid, balance, price_per_night,
          notes, is_blocked, block_reason,
          guests!bookings_guest_id_fkey(id, first_name, last_name, dni, phone, email),
          booking_units(unit_id, units(name, sort_order, color))`)
        .eq('hotel_id', this.ctx.hotelId)
        .not('status', 'in', '(blocked)')
        .order('check_in', { ascending: false });

      if (bErr) { showToast('Error: ' + bErr.message, 'error'); return; }
      if (!allBookings?.length) { showToast('Sin reservas para exportar', 'info'); return; }

      showExportDropdown({
        anchorEl: btn,
        type: 'bookings',
        data: allBookings,
        onExport: ({ fmt: f, data, from, to }) => {
          const range = from && to ? from.split('-').reverse().join('/') + ' → ' + to.split('-').reverse().join('/') : '';
          if (f === 'excel') exportBookingsExcel(data, 'reservas', range);
          else if (f === 'pdf') exportBookingsPDF(data, range);
          else exportBookingsCSV(data);
        },
      });
    });

    container.querySelector('#cfg-export-guests')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const { showExportDropdown, exportBookingsExcel, exportBookingsCSV, exportBookingsPDF } =
        await import('../services/export-service.js');

      const { data: allBookings, error: gErr } = await this.db.from('bookings')
        .select(`id, check_in, check_out, nights, status, source,
          total_amount, total_paid, balance, price_per_night,
          notes, is_blocked, block_reason,
          guests!bookings_guest_id_fkey(id, first_name, last_name, dni, phone, email),
          booking_units(unit_id, units(name, sort_order, color))`)
        .eq('hotel_id', this.ctx.hotelId)
        .not('status', 'in', '(blocked,cancelled)')
        .not('guest_id', 'is', null)
        .order('check_in', { ascending: false });

      if (gErr) { showToast('Error: ' + gErr.message, 'error'); return; }
      if (!allBookings?.length) { showToast('Sin huéspedes para exportar', 'info'); return; }

      showExportDropdown({
        anchorEl: btn,
        type: 'guests',
        data: allBookings,
        onExport: ({ fmt: f, data, from, to }) => {
          const range = from && to ? from.split('-').reverse().join('/') + ' → ' + to.split('-').reverse().join('/') : '';
          if (f === 'excel') exportBookingsExcel(data, 'huespedes', range);
          else if (f === 'pdf') exportBookingsPDF(data, range);
          else exportBookingsCSV(data);
        },
      });
    });

    // ── Backup completo: Reservas + Huéspedes + Gastos en un solo Excel ──
    container.querySelector('#cfg-export-full-backup')?.addEventListener('click', async () => {
      const { exportFullBackup } = await import('../services/export-service.js');
      await exportFullBackup(this.db, this.ctx.hotelId);
    });

    // ── Limpieza de huéspedes inactivos ──
    container.querySelector('#cfg-find-inactive')?.addEventListener('click', () => this._findInactiveGuests(container));

    // ── Accesibilidad ──
    this._bindAccessibilityPanel(container);

    // ── Reportes PDF ──────────────────────────────────
    container.querySelector('#cfg-exp-toggle-pdf')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      this._showStatsPDFDropdown(btn);
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
    let _tariffLoaded = false;
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
        // Cuadro Tarifario: cargar datos la primera vez que se expande
        if (btn.dataset.acc === 'tariffs' && !wasOpen && !_tariffLoaded) {
          _tariffLoaded = true;
          this._loadTariffEditor();
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

    // Grupo tarifario: guardar al perder foco (debounce simple con blur, no input)
    container.querySelectorAll('.unit-rategroup-input').forEach(input => {
      input.addEventListener('change', async (e) => {
        const unitId = input.dataset.unitId;
        const rate_group = e.target.value.trim() || null;
        try {
          await this.db.from('units').update({ rate_group }).eq('id', unitId);
          const unit = this.ctx.units.find(u => u.id === unitId);
          if (unit) unit.rate_group = rate_group;
          showToast('Grupo tarifario actualizado ✓', 'success');
        } catch { showToast('Error al guardar grupo tarifario', 'error'); }
      });
    });
  }

  // ── Limpieza de huéspedes inactivos ──────────────
  // Se mira la reserva MÁS RECIENTE de cada huésped, no la primera — si
  // volvió hace poco, no es candidato aunque haya venido por primera vez
  // hace muchos años. Borrar al huésped no borra sus reservas viejas: la
  // FK bookings.guest_id es ON DELETE SET NULL, así que las estadísticas
  // históricas quedan intactas, solo se pierde el vínculo al huésped.
  async _findInactiveGuests(container) {
    const rawYears = parseInt(container.querySelector('#cfg-inactive-years')?.value);
    const years = Number.isFinite(rawYears) ? rawYears : 5; // antes "|| 5" pisaba el 0 (falsy en JS) por el default
    const resultsEl = container.querySelector('#cfg-inactive-results');
    if (!resultsEl) return;
    resultsEl.innerHTML = `<div style="padding:12px;text-align:center;color:var(--color-text-3)">⟳ Buscando...</div>`;

    try {
      const { data: guests, error } = await this.db.from('guests')
        .select('id, first_name, last_name, dni, bookings!bookings_guest_id_fkey(id, check_in)')
        .eq('hotel_id', this.ctx.hotelId);
      if (error) throw error;

      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - years);
      const cutoffISO = cutoff.toISOString().slice(0, 10);

      const candidates = (guests ?? [])
        .map(g => {
          const dates = (g.bookings ?? []).map(b => b.check_in).filter(Boolean).sort();
          const lastVisit = dates[dates.length - 1] ?? null;
          return { ...g, lastVisit, bookingCount: g.bookings?.length ?? 0 };
        })
        .filter(g => g.lastVisit && g.lastVisit < cutoffISO) // sin reservas = no se toca, no es "inactivo", nunca vino
        .sort((a, b) => a.lastVisit.localeCompare(b.lastVisit));

      if (!candidates.length) {
        resultsEl.innerHTML = `<div style="padding:12px;color:var(--color-text-3);font-size:.82rem">✓ No hay huéspedes sin visitas hace más de ${years} años.</div>`;
        return;
      }

      resultsEl.innerHTML = `
        <div style="font-size:.8rem;font-weight:600;margin-bottom:8px">
          ${candidates.length} huésped${candidates.length !== 1 ? 'es' : ''} sin visitas en los últimos ${years} años:
        </div>
        <div style="max-height:280px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--r-md);padding:6px">
          ${candidates.map(g => `
            <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:.8rem;cursor:pointer;border-radius:6px" onmouseover="this.style.background='var(--color-surface-2)'" onmouseout="this.style.background='transparent'">
              <input type="checkbox" class="cfg-inactive-check" value="${g.id}" checked style="accent-color:var(--color-primary)">
              <span style="flex:1">${g.first_name ?? ''} ${g.last_name ?? ''}${g.dni ? ` · ${g.dni}` : ''}</span>
              <span style="color:var(--color-text-3)">última visita: ${formatDate(g.lastVisit)} (${g.bookingCount} reserva${g.bookingCount !== 1 ? 's' : ''})</span>
            </label>`).join('')}
        </div>
        <div style="margin-top:10px;padding:10px;background:var(--state-yellow-bg);border-radius:var(--r-md);font-size:.72rem;color:var(--state-yellow-txt)">
          ⚠️ Se borra el huésped, no sus reservas — quedan en la base para no afectar tus estadísticas de años anteriores. Esta acción no se puede deshacer.
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-outline btn-sm" id="cfg-inactive-backup-first">💾 Descargar backup antes</button>
          <button class="btn btn-primary btn-sm" id="cfg-inactive-delete" style="background:var(--state-red);border-color:var(--state-red)">🗑️ Eliminar seleccionados</button>
        </div>`;

      resultsEl.querySelector('#cfg-inactive-backup-first')?.addEventListener('click', async () => {
        const { exportFullBackup } = await import('../services/export-service.js');
        await exportFullBackup(this.db, this.ctx.hotelId);
      });
      resultsEl.querySelector('#cfg-inactive-delete')?.addEventListener('click', () => this._deleteInactiveGuests(resultsEl));
    } catch (err) {
      resultsEl.innerHTML = `<div style="padding:12px;color:var(--state-red-txt)">Error: ${err.message ?? err}</div>`;
    }
  }

  async _deleteInactiveGuests(resultsEl) {
    const ids = [...resultsEl.querySelectorAll('.cfg-inactive-check:checked')].map(c => c.value);
    if (!ids.length) { showToast('No seleccionaste ningún huésped', 'warning'); return; }
    if (!confirm(`¿Eliminar ${ids.length} huésped${ids.length !== 1 ? 'es' : ''}? Sus reservas históricas quedan intactas. Esta acción no se puede deshacer.`)) return;

    const btn = resultsEl.querySelector('#cfg-inactive-delete');
    if (btn) { btn.disabled = true; btn.textContent = 'Eliminando...'; }
    try {
      const { error } = await this.db.from('guests').delete().in('id', ids);
      if (error) throw error;
      await logAction('DELETE', 'guest', null, `Limpieza de huéspedes inactivos: ${ids.length} eliminados`);
      showToast(`✓ ${ids.length} huésped${ids.length !== 1 ? 'es' : ''} eliminado${ids.length !== 1 ? 's' : ''}`, 'success');
      resultsEl.innerHTML = '';
    } catch (err) {
      showToast('Error al eliminar: ' + (err.message ?? err), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🗑️ Eliminar seleccionados'; }
    }
  }

  // ── Accesibilidad ──────────────────────────────────
  // Refleja el estado guardado en cada control al abrir la pantalla, y
  // guarda apenas se toca cada uno (no hace falta apretar "Guardar" acá,
  // cada control se guarda solo — son cosas que uno quiere ver aplicadas
  // al toque, no después de un paso extra).
  _bindAccessibilityPanel(container) {
    const prefs = getPrefs();

    // Tamaño de letra
    const fontValueEl = container.querySelector('#a11y-font-value');
    const renderFontValue = () => {
      const current = parseFloat(getPrefs().fontScale) || 1;
      if (fontValueEl) fontValueEl.textContent = `${Math.round(current * 100)}%`;
    };
    renderFontValue();
    container.querySelector('#a11y-font-minus')?.addEventListener('click', () => {
      const next = Math.max(0.8, (parseFloat(getPrefs().fontScale) || 1) - 0.1);
      setPref('fontScale', next.toFixed(2));
      renderFontValue();
    });
    container.querySelector('#a11y-font-plus')?.addEventListener('click', () => {
      const next = Math.min(1.6, (parseFloat(getPrefs().fontScale) || 1) + 0.1);
      setPref('fontScale', next.toFixed(2));
      renderFontValue();
    });

    // Los 6 interruptores — mismo patrón para todos
    const toggles = ['highContrast', 'colorblind', 'magnifier', 'narration', 'reduceMotion', 'focusVisible'];
    toggles.forEach(name => {
      const el = container.querySelector(`#a11y-toggle-${name}`);
      if (!el) return;
      el.checked = !!prefs[name];
      el.addEventListener('change', () => setPref(name, el.checked));
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

  static getString(key, defaultVal = '') {
    return AppContext.config?.[key] ?? defaultVal;
  }

  // ══════════════════════════════════════════════════
  // REPORTES PDF — dropdown con rango + departamentos
  // ══════════════════════════════════════════════════
  _showStatsPDFDropdown(anchorEl) {
    document.getElementById('_mila-stats-pdf-dd')?.remove();

    const now   = new Date();
    const y     = now.getFullYear();
    const mo    = String(now.getMonth() + 1).padStart(2, '0');
    const first = y + '-' + mo + '-01';
    const lastD = new Date(y, now.getMonth() + 1, 0);
    const lastS = y + '-' + mo + '-' + String(lastD.getDate()).padStart(2, '0');
    const units = AppContext?.units ?? [];

    const checkboxes = units.map(u =>
      '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;padding:4px 0">' +
        '<input type="checkbox" value="' + u.id + '" checked ' +
          'style="width:14px;height:14px;accent-color:' + (u.color || '#1A3A90') + ';cursor:pointer">' +
        '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + (u.color || '#1A3A90') + ';flex-shrink:0"></span>' +
        '<span style="font-size:.76rem;font-weight:600;color:' + (u.color || '#1A3A90') + '">' + u.name + '</span>' +
      '</label>'
    ).join('');

    const dd = document.createElement('div');
    dd.id = '_mila-stats-pdf-dd';
    const rect = anchorEl.getBoundingClientRect();
    dd.style.cssText = 'position:fixed;z-index:9999;background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:14px 16px;box-shadow:0 8px 32px rgba(0,0,0,.14);width:280px;font-family:system-ui,sans-serif';
    dd.innerHTML =
      '<div style="font-size:.8rem;font-weight:700;color:var(--color-text);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--color-border)">📄 Reporte PDF de Estadísticas</div>' +
      '<label style="display:block;font-size:.68rem;font-weight:600;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Período</label>' +
      '<div style="display:flex;gap:6px;align-items:center;margin-bottom:12px">' +
        '<input type="date" id="_spdf-from" value="' + first + '" style="flex:1;padding:5px 8px;border:1px solid var(--color-border);border-radius:7px;font-size:.75rem;color:var(--color-text);background:var(--color-surface);min-width:0">' +
        '<span style="color:var(--color-text-3);font-size:.8rem">&#8594;</span>' +
        '<input type="date" id="_spdf-to" value="' + lastS + '" style="flex:1;padding:5px 8px;border:1px solid var(--color-border);border-radius:7px;font-size:.75rem;color:var(--color-text);background:var(--color-surface);min-width:0">' +
      '</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
        '<label style="font-size:.68rem;font-weight:600;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.05em">Departamentos</label>' +
        '<button onclick="document.querySelectorAll(\'#_mila-stats-pdf-dd input[type=checkbox]\').forEach(x=>x.checked=!x.checked)" style="font-size:.65rem;color:var(--color-primary);background:none;border:none;cursor:pointer;text-decoration:underline">invertir</button>' +
      '</div>' +
      '<div id="_spdf-units-wrap" style="max-height:140px;overflow-y:auto;border:1px solid var(--color-border);border-radius:7px;padding:6px 10px;margin-bottom:12px;background:var(--color-surface-2)">' +
        checkboxes +
      '</div>' +
      '<button id="_spdf-gen" style="width:100%;padding:9px;border-radius:8px;border:none;background:#1A3A90;color:#fff;font-size:.8rem;font-weight:700;cursor:pointer">Generar PDF</button>';

    dd.style.top  = (rect.bottom + 6) + 'px';
    dd.style.left = Math.max(8, rect.right - 280) + 'px';
    document.body.appendChild(dd);
    requestAnimationFrame(() => {
      const r = dd.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 12) dd.style.top = (rect.top - r.height - 6) + 'px';
    });

    const close = () => { dd.remove(); document.removeEventListener('mousedown', outside); };
    const outside = ev => { if (!dd.contains(ev.target) && ev.target !== anchorEl) close(); };
    setTimeout(() => document.addEventListener('mousedown', outside), 0);

    document.getElementById('_spdf-gen').addEventListener('click', async () => {
      const from    = document.getElementById('_spdf-from')?.value ?? '';
      const to      = document.getElementById('_spdf-to')?.value   ?? '';
      const checked = [...dd.querySelectorAll('input[type=checkbox]:checked')].map(x => x.value);
      close();
      await this._generateStatsPDF({ from, to, unitIds: checked });
    });
  }

  async _generateStatsPDF({ from, to, unitIds }) {
    if (!from || !to) { showToast('Selecciona un rango de fechas', 'warning'); return; }

    showToast('\u23f3 Generando reporte...', 'info');
    try {
      // Fetch reservas que solapan el período
      const { data: bookings, error: bErr } = await this.db.from('bookings')
        .select('id,check_in,check_out,nights,total_amount,total_paid,balance,price_per_night,status,source,booking_units(unit_id)')
        .eq('hotel_id', this.ctx.hotelId)
        .neq('status', 'cancelled').neq('status', 'blocked')
        .lte('check_in', to).gt('check_out', from);
      if (bErr) throw bErr;

      // Fetch gastos del período
      const { data: expenses } = await this.db.from('expenses')
        .select('id,category,description,amount,paid,due_date')
        .eq('hotel_id', this.ctx.hotelId)
        .or('due_date.is.null,and(due_date.gte.' + from + ',due_date.lte.' + to + ')');

      // Unidades seleccionadas (preservar orden original)
      const allUnits = AppContext?.units ?? [];
      const filtered = unitIds.length > 0 ? allUnits.filter(u => unitIds.includes(u.id)) : allUnits;
      const daysTotal = Math.max(1, Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000) + 1);

      // Computar stats por unidad
      const statsMap = {};
      filtered.forEach(u => { statsMap[u.id] = { unit: u, nightsOcc: 0, revenue: 0, cobrado: 0, bookingCount: 0, bkIds: new Set() }; });

      (bookings ?? []).forEach(b => {
        (b.booking_units ?? []).forEach(({ unit_id }) => {
          if (!statsMap[unit_id]) return;
          const ci  = new Date(Math.max(+new Date(b.check_in + 'T00:00:00'), +new Date(from + 'T00:00:00')));
          const co  = new Date(Math.min(+new Date(b.check_out + 'T00:00:00'), +new Date(to + 'T23:59:59')));
          const n   = Math.max(0, Math.round((co - ci) / 86400000));
          if (n === 0) return;
          const tot = Math.max(1, Math.round((+new Date(b.check_out + 'T00:00:00') - +new Date(b.check_in + 'T00:00:00')) / 86400000));
          const frac = n / tot;
          // Usar total_amount; fallback a price_per_night * nights totales si es null/0
          const baseAmt = (b.total_amount && b.total_amount > 0) ? b.total_amount : ((b.price_per_night ?? 0) * tot);
          const paidAmt = (b.total_paid && b.total_paid > 0) ? b.total_paid : 0;
          statsMap[unit_id].nightsOcc    += n;
          statsMap[unit_id].revenue      += baseAmt * frac;
          statsMap[unit_id].cobrado      += paidAmt * frac;
          if (!statsMap[unit_id].bkIds.has(b.id)) {
            statsMap[unit_id].bookingCount++;
            statsMap[unit_id].bkIds.add(b.id);
          }
        });
      });

      const stats      = Object.values(statsMap).sort((a, b) => b.revenue - a.revenue);
      const totalRev   = stats.reduce((s, u) => s + u.revenue, 0);
      const totalCobr  = stats.reduce((s, u) => s + u.cobrado, 0);
      const totalNights= stats.reduce((s, u) => s + u.nightsOcc, 0);
      const totalBks   = stats.reduce((s, u) => s + u.bookingCount, 0);
      const expList    = expenses ?? [];
      const totalExpPaid = expList.filter(e => e.paid).reduce((s, e) => s + e.amount, 0);
      const totalExpAll  = expList.reduce((s, e) => s + e.amount, 0);
      const netResult  = totalRev - totalExpPaid;
      const pctCobr    = totalRev > 0 ? Math.round(totalCobr / totalRev * 100) : 0;

      const fmtM  = n => '$' + Math.round(n ?? 0).toLocaleString('es-AR');
      const fmtD  = s => s ? s.split('-').reverse().join('/') : '';
      const range = fmtD(from) + ' \u2192 ' + fmtD(to);
      const genDate = new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' });
      const depsLabel = unitIds.length > 0 && unitIds.length < allUnits.length
        ? filtered.map(u => u.name).join(' · ')
        : 'Todos los departamentos';

      // SVG: barras de ingresos por unidad
      const maxRev = Math.max(...stats.map(s => s.revenue), 1);
      const barH = 18; const barGap = 8; const svgH = stats.length * (barH + barGap) + 10;
      const svgBars = stats.map((s, i) => {
        const barW = Math.max(2, Math.round(s.revenue / maxRev * 360));
        const occW = Math.max(2, Math.round(s.nightsOcc / daysTotal * 100 * 3.6));
        const y = i * (barH + barGap);
        const color = s.unit.color || '#1A3A90';
        return '<g transform="translate(0,' + y + ')">' +
          '<text x="0" y="13" style="font-size:10px;font-weight:700;fill:' + color + '">' + s.unit.name + '</text>' +
          '<rect x="130" y="4" width="360" height="10" rx="5" fill="#f1f5f9"/>' +
          '<rect x="130" y="4" width="' + barW + '" height="10" rx="5" fill="' + color + '"/>' +
          '<text x="498" y="13" style="font-size:9px;font-weight:700;fill:' + color + '">' + fmtM(s.revenue) + '</text>' +
          '</g>';
      }).join('');

      // SVG: barra de ocupación por unidad
      const occBars = stats.map((s, i) => {
        const occ   = Math.min(100, Math.round(s.nightsOcc / daysTotal * 100));
        const occW2 = Math.max(2, Math.round(occ / 100 * 360));
        const color = s.unit.color || '#1A3A90';
        const y = i * (barH + barGap);
        return '<g transform="translate(0,' + y + ')">' +
          '<text x="0" y="13" style="font-size:10px;font-weight:700;fill:' + color + '">' + s.unit.name + '</text>' +
          '<rect x="130" y="4" width="360" height="10" rx="5" fill="#f1f5f9"/>' +
          '<rect x="130" y="4" width="' + occW2 + '" height="10" rx="5" fill="' + color + '"/>' +
          '<text x="498" y="13" style="font-size:10px;font-weight:800;fill:' + color + '">' + occ + '%</text>' +
          '</g>';
      }).join('');

      // Gastos por categoría
      const expCat = {};
      expList.forEach(e => {
        if (!expCat[e.category]) expCat[e.category] = { total: 0, paid: 0 };
        expCat[e.category].total += e.amount;
        if (e.paid) expCat[e.category].paid += e.amount;
      });
      const maxExp = Math.max(...Object.values(expCat).map(v => v.total), 1);
      const expBars = Object.entries(expCat).map(([cat, v], i) => {
        const bW = Math.max(2, Math.round(v.total / maxExp * 360));
        const y  = i * (barH + barGap);
        return '<g transform="translate(0,' + y + ')">' +
          '<text x="0" y="13" style="font-size:10px;font-weight:600;fill:#475569;text-transform:capitalize">' + cat + '</text>' +
          '<rect x="130" y="4" width="360" height="10" rx="5" fill="#f1f5f9"/>' +
          '<rect x="130" y="4" width="' + bW + '" height="10" rx="5" fill="#ef4444"/>' +
          '<text x="498" y="13" style="font-size:9px;font-weight:700;fill:#ef4444">' + fmtM(v.total) + '</text>' +
          '</g>';
      }).join('');
      const expSvgH = Math.max(20, Object.keys(expCat).length * (barH + barGap) + 10);

      // Tabla detalle de unidades
      const unitRows = stats.map((s, i) => {
        const occ   = Math.min(100, Math.round(s.nightsOcc / daysTotal * 100));
        const color = s.unit.color || '#1A3A90';
        const pend  = s.revenue - s.cobrado;
        return '<tr style="background:' + (i % 2 === 0 ? '#fff' : '#f8fafc') + '">' +
          '<td><div style="display:flex;align-items:center;gap:7px">' +
            '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0"></span>' +
            '<span style="color:' + color + ';font-weight:700">' + s.unit.name + '</span>' +
          '</div></td>' +
          '<td style="text-align:center">' + s.bookingCount + '</td>' +
          '<td style="text-align:center">' + s.nightsOcc + '</td>' +
          '<td style="text-align:center;font-weight:700;color:' + color + '">' + occ + '%</td>' +
          '<td style="text-align:right;color:#16a34a;font-weight:600">' + fmtM(s.cobrado) + '</td>' +
          '<td style="text-align:right;color:#f59e0b">' + fmtM(pend) + '</td>' +
          '<td style="text-align:right;font-weight:800;color:#1A3A90">' + fmtM(s.revenue) + '</td>' +
          '</tr>';
      }).join('');

      const expRows = Object.entries(expCat).map(([cat, v], i) =>
        '<tr style="background:' + (i % 2 === 0 ? '#fff' : '#f8fafc') + '">' +
          '<td style="text-transform:capitalize;color:#475569">' + cat + '</td>' +
          '<td style="text-align:right;color:#16a34a">' + fmtM(v.paid) + '</td>' +
          '<td style="text-align:right;color:#f59e0b">' + fmtM(v.total - v.paid) + '</td>' +
          '<td style="text-align:right;font-weight:700">' + fmtM(v.total) + '</td>' +
          '</tr>'
      ).join('') || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:14px">Sin gastos en el período</td></tr>';

      const resColor = netResult >= 0 ? '#15803d' : '#dc2626';
      const resBg    = netResult >= 0 ? '#f0fdf4' : '#fef2f2';
      const resBord  = netResult >= 0 ? '#bbf7d0' : '#fecaca';

      const w = window.open('', '_blank');
      if (!w) { showToast('Permití ventanas emergentes para exportar', 'warning'); return; }

      w.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>MILA \xb7 Estadisticas ' + range + '</title><style>' +
        '*{box-sizing:border-box;margin:0;padding:0}' +
        'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1e293b;background:#fff;padding:24px 28px;font-size:12px}' +
        '.hdr{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:3px solid #1A3A90;padding-bottom:12px;margin-bottom:16px}' +
        '.logo{display:flex;align-items:center;gap:10px}' +
        '.logo-box{width:36px;height:36px;border-radius:8px;background:#1A3A90;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:17px;flex-shrink:0}' +
        '.logo-nm{font-size:15px;font-weight:800;color:#1A3A90}.logo-sb{font-size:9px;color:#64748b;margin-top:1px}' +
        '.meta{text-align:right;font-size:10px;color:#64748b;line-height:1.7}' +
        '.meta b{color:#1e293b;font-size:11px}' +
        '.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}' +
        '.kpi{border-radius:9px;padding:10px 12px;border-left:3px solid}' +
        '.kpi-l{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:3px}' +
        '.kpi-v{font-size:15px;font-weight:800}' +
        '.kpi-s{font-size:9px;color:#64748b;margin-top:2px}' +
        '.kpis2{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px}' +
        '.sec{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#1A3A90;margin:16px 0 8px;padding-bottom:4px;border-bottom:2px solid #ddeaff;display:flex;align-items:center;gap:6px}' +
        '.chart-box{background:#f8fafc;border-radius:10px;padding:14px 16px;margin-bottom:14px}' +
        '.chart-title{font-size:10px;font-weight:700;color:#475569;margin-bottom:10px}' +
        'table{width:100%;border-collapse:collapse}' +
        'thead tr{background:#1A3A90;color:#fff}' +
        'th{padding:7px 9px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}' +
        'td{padding:6px 9px;border-bottom:1px solid #f1f5f9;vertical-align:middle;font-size:11px}' +
        'tfoot tr{background:#eef2ff}' +
        'tfoot td{padding:7px 9px;border-top:2px solid #1A3A90;font-weight:800}' +
        '.result{margin-top:16px;background:' + resBg + ';border:2px solid ' + resBord + ';border-radius:12px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center}' +
        '.result-l{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:' + resColor + '}' +
        '.result-v{font-size:20px;font-weight:900;color:' + resColor + '}' +
        '.print-btn{margin-top:18px;padding:8px 20px;background:#1A3A90;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer}' +
        '@media print{.no-print{display:none}body{padding:12px}@page{margin:1.2cm;size:A4}}' +
      '</style></head><body>' +

      '<div class="hdr"><div class="logo"><div class="logo-box">M</div><div><div class="logo-nm">MILA</div><div class="logo-sb">Sistema Inteligente para Alojamientos</div></div></div>' +
      '<div class="meta"><div><b>Reporte de Estad\xedsticas</b></div><div>' + range + '</div><div>' + depsLabel + '</div><div>Generado: ' + genDate + '</div></div></div>' +

      '<div class="kpis">' +
        '<div class="kpi" style="background:#eff6ff;border-color:#1A3A90"><div class="kpi-l">Reservas</div><div class="kpi-v" style="color:#1A3A90">' + totalBks + '</div><div class="kpi-s">' + filtered.length + ' departamento' + (filtered.length !== 1 ? 's' : '') + '</div></div>' +
        '<div class="kpi" style="background:#eff6ff;border-color:#1A3A90"><div class="kpi-l">Noches vendidas</div><div class="kpi-v" style="color:#1A3A90">' + totalNights + '</div><div class="kpi-s">de ' + (daysTotal * filtered.length) + ' posibles</div></div>' +
        '<div class="kpi" style="background:#eff6ff;border-color:#1A3A90"><div class="kpi-l">Ingresos totales</div><div class="kpi-v" style="color:#1A3A90">' + fmtM(totalRev) + '</div><div class="kpi-s">bruto del per\xedodo</div></div>' +
      '</div>' +
      '<div class="kpis2">' +
        '<div class="kpi" style="background:#f0fdf4;border-color:#16a34a"><div class="kpi-l">Cobrado</div><div class="kpi-v" style="color:#16a34a">' + fmtM(totalCobr) + '</div><div class="kpi-s">' + pctCobr + '% del total</div></div>' +
        '<div class="kpi" style="background:#fef2f2;border-color:#ef4444"><div class="kpi-l">Gastos pagados</div><div class="kpi-v" style="color:#ef4444">' + fmtM(totalExpPaid) + '</div><div class="kpi-s">de ' + fmtM(totalExpAll) + ' comprometidos</div></div>' +
        '<div class="kpi" style="background:' + resBg + ';border-color:' + resColor + '"><div class="kpi-l">Resultado neto</div><div class="kpi-v" style="color:' + resColor + '">' + fmtM(netResult) + '</div><div class="kpi-s">' + (netResult >= 0 ? 'Positivo ✓' : 'Negativo ⚠') + '</div></div>' +
      '</div>' +

      '<div class="chart-box">' +
        '<div class="chart-title">\u2192 Ingresos por departamento</div>' +
        '<svg width="100%" viewBox="0 0 580 ' + svgH + '" xmlns="http://www.w3.org/2000/svg">' + svgBars + '</svg>' +
      '</div>' +

      '<div class="chart-box">' +
        '<div class="chart-title">\u2192 Ocupaci\xf3n por departamento (' + daysTotal + ' d\xedas del per\xedodo)</div>' +
        '<svg width="100%" viewBox="0 0 580 ' + svgH + '" xmlns="http://www.w3.org/2000/svg">' + occBars + '</svg>' +
      '</div>' +

      '<div class="sec">Detalle por departamento</div>' +
      '<table><thead><tr><th>Departamento</th><th style="text-align:center">Reservas</th><th style="text-align:center">Noches</th><th style="text-align:center">Ocupaci\xf3n</th><th style="text-align:right">Cobrado</th><th style="text-align:right">Pendiente</th><th style="text-align:right">Total facturado</th></tr></thead>' +
      '<tbody>' + unitRows + '</tbody>' +
      '<tfoot><tr><td>TOTAL</td><td style="text-align:center">' + totalBks + '</td><td style="text-align:center">' + totalNights + '</td><td style="text-align:center">\u2014</td><td style="text-align:right;color:#16a34a">' + fmtM(totalCobr) + '</td><td style="text-align:right;color:#f59e0b">' + fmtM(totalRev - totalCobr) + '</td><td style="text-align:right;color:#1A3A90">' + fmtM(totalRev) + '</td></tr></tfoot>' +
      '</table>' +

      (expList.length > 0 ?
        '<div class="chart-box" style="margin-top:16px">' +
          '<div class="chart-title">\u2192 Distribuci\xf3n de gastos por categor\xeda</div>' +
          '<svg width="100%" viewBox="0 0 580 ' + expSvgH + '" xmlns="http://www.w3.org/2000/svg">' + expBars + '</svg>' +
        '</div>' +
        '<div class="sec">Gastos operativos</div>' +
        '<table><thead><tr><th>Categor\xeda</th><th style="text-align:right">Pagado</th><th style="text-align:right">Pendiente</th><th style="text-align:right">Total</th></tr></thead>' +
        '<tbody>' + expRows + '</tbody>' +
        '<tfoot><tr><td>TOTAL</td><td style="text-align:right;color:#16a34a">' + fmtM(totalExpPaid) + '</td><td style="text-align:right;color:#f59e0b">' + fmtM(totalExpAll - totalExpPaid) + '</td><td style="text-align:right">' + fmtM(totalExpAll) + '</td></tr></tfoot></table>'
      : '') +

      '<div class="result"><div class="result-l">' + (netResult >= 0 ? '\u2705 Resultado neto del per\xedodo' : '\u26a0\ufe0f Resultado neto del per\xedodo') + '</div><div class="result-v">' + fmtM(netResult) + '</div></div>' +
      '<div class="no-print"><button class="print-btn" onclick="window.print()">\u{1F5A8} Imprimir / Guardar PDF</button></div>' +
      '</body></html>');
      w.document.close();

    } catch (err) {
      console.error('[StatsPDF]', err);
      showToast('Error: ' + (err.message || err), 'error');
    }
  }

  // ══════════════════════════════════════════════════
  // CUADRO TARIFARIO — editor en Configuración
  // ══════════════════════════════════════════════════
  async _loadTariffEditor() {
    const el = document.getElementById('cfg-tariff-content');
    if (!el) return;
    el.innerHTML = '<div style="padding:8px 0;color:var(--color-text-3)">⏳ Cargando...</div>';

    const now = new Date();
    // Próximos 3 meses (incluye el actual) — suficiente para precargar tarifas con anticipación
    this._tariffMonths = [0,1,2,3,4,5].map(i => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });

    await this._renderTariffEditorBody();
  }

  async _renderTariffEditorBody() {
    const el = document.getElementById('cfg-tariff-content');
    if (!el) return;

    const [rates, customCols] = await Promise.all([
      fetchMonthlyRates(this.db, this.ctx.hotelId, this._tariffMonths),
      fetchCustomColumns(this.db, this.ctx.hotelId, null, null),
    ]);

    const units = (this.ctx.units ?? []).slice().sort((a,b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const rateMap = new Map();
    rates.forEach(r => rateMap.set(`${r.unit_id}|${r.year}|${r.month}`, r));
    customCols.forEach(c => {
      c._priceMap = new Map((c.tariff_custom_prices ?? []).map(p => [p.unit_id, p]));
    });
    this._tariffCustomColsCache = customCols;

    // ── Armar la lista de columnas (meses + personalizadas intercaladas por fecha) ──
    const bucketOf = (c) => {
      if (!c.date_from) return -1; // siempre visible → al final
      const [y, mo] = c.date_from.split('-').map(Number);
      return this._tariffMonths.findIndex(m => m.year === y && m.month === mo);
    };
    const columns = [];
    this._tariffMonths.forEach((m, idx) => {
      columns.push({ type: 'month', m });
      customCols.filter(c => bucketOf(c) === idx).forEach(c => columns.push({ type: 'custom', c }));
    });
    customCols.filter(c => bucketOf(c) === -1).forEach(c => columns.push({ type: 'custom', c }));

    // ── Estado de promo por mes: la promo siempre aplica a TODOS los deptos juntos ──
    const promoByMonth = new Map(); // key `${year}-${month}` -> { active, pay, free }
    this._tariffMonths.forEach(m => {
      const key = `${m.year}-${m.month}`;
      let active = false, pay = '', free = '';
      units.forEach(u => {
        const r = rateMap.get(`${u.id}|${m.year}|${m.month}`);
        if (r?.promo_active) { active = true; pay = r.promo_pay ?? ''; free = r.promo_free ?? ''; }
      });
      promoByMonth.set(key, { active, pay, free });
    });

    const colHeaders = columns.map(col => {
      if (col.type === 'month') {
        const m = col.m;
        const promo = promoByMonth.get(`${m.year}-${m.month}`);
        const promoTitle = promo.active && promo.pay && promo.free
          ? `Promo activa para todos los deptos: ${promo.pay}+${promo.free} (clic para editar o desactivar)`
          : 'Activar promo tipo "2+1" para todos los deptos de este mes';
        return `
          <th style="text-align:center;padding:6px 8px;font-size:.66rem;color:var(--color-text-3);text-transform:uppercase">
            <div style="display:flex;align-items:center;justify-content:center;gap:4px">
              <span>${MONTH_NAMES[m.month-1]} ${m.year}</span>
              <button class="tariff-promo-month-btn" data-year="${m.year}" data-month="${m.month}"
                data-on="${promo.active ? '1':'0'}" data-pay="${promo.pay}" data-free="${promo.free}"
                title="${promoTitle}" style="background:none;border:none;cursor:pointer;font-size:.85rem;padding:2px;opacity:${promo.active ? '1':'.35'}">🏷️</button>
            </div>
          </th>`;
      }
      const c = col.c;
      const vig = c.date_from && c.date_to
        ? `${c.date_from.split('-').reverse().join('/')} → ${c.date_to.split('-').reverse().join('/')}`
        : 'Siempre visible';
      return `
        <th style="text-align:center;padding:6px 8px;font-size:.66rem;color:var(--color-text-3);text-transform:uppercase;background:rgba(99,102,241,.06);border-radius:8px 8px 0 0">
          <div style="display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap">
            <span title="${vig}${c.note ? ' · ' + c.note : ''}">📅 ${c.title}</span>
            <button class="tariff-custom-edit" data-id="${c.id}" title="Editar nombre/fechas" style="background:none;border:none;cursor:pointer;font-size:.75rem;padding:0;opacity:.6">✏️</button>
            <button class="tariff-custom-del" data-id="${c.id}" title="Eliminar columna" style="background:none;border:none;cursor:pointer;font-size:.75rem;padding:0;opacity:.6">🗑️</button>
          </div>
        </th>`;
    }).join('');

    const rows = units.map(u => {
      const cells = columns.map(col => {
        if (col.type === 'month') {
          const m = col.m;
          const r = rateMap.get(`${u.id}|${m.year}|${m.month}`);
          const price = r?.price_per_night ?? '';
          return `
            <td style="padding:5px 6px;text-align:right">
              <div style="position:relative;display:inline-block">
                <span style="position:absolute;left:7px;top:50%;transform:translateY(-50%);font-size:.74rem;color:var(--color-text-3);pointer-events:none">$</span>
                <input type="text" inputmode="decimal" class="tariff-price-input" data-unit="${u.id}" data-year="${m.year}" data-month="${m.month}"
                  value="${this._fmtTariffPrice(price)}" placeholder="—" style="width:104px;padding:4px 6px 4px 18px;font-size:.78rem;text-align:right;border:1px solid var(--color-border);border-radius:6px;background:var(--color-surface)">
              </div>
            </td>`;
        }
        const c = col.c;
        const p = c._priceMap.get(u.id);
        return `
          <td style="padding:5px 6px;text-align:center;background:rgba(99,102,241,.04)">
            <div style="position:relative;display:inline-block">
              <span style="position:absolute;left:7px;top:50%;transform:translateY(-50%);font-size:.74rem;color:var(--color-text-3);pointer-events:none">$</span>
              <input type="text" inputmode="decimal" class="tariff-custom-price-input" data-col="${c.id}" data-unit="${u.id}"
                value="${this._fmtTariffPrice(p?.price)}" placeholder="—" style="width:96px;padding:4px 6px 4px 18px;font-size:.78rem;text-align:center;border:1px solid var(--color-border);border-radius:6px;background:var(--color-surface)">
            </div>
          </td>`;
      }).join('');
      return `
        <tr>
          <td style="padding:5px 8px;font-size:.78rem;white-space:nowrap">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${u.color ?? 'var(--color-primary)'};margin-right:6px"></span>${u.name}
          </td>
          ${cells}
        </tr>`;
    }).join('');

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span style="font-size:.7rem;color:var(--color-text-3)">Los precios se guardan automáticamente al salir del campo. El 🏷️ junto a cada mes activa/desactiva una promo tipo "2+1" para todos los departamentos de ese mes.</span>
        <button class="btn btn-outline btn-sm" id="btn-add-tariff-custom" style="flex-shrink:0;margin-left:10px">+ Agregar columna</button>
      </div>
      <div style="overflow-x:auto;margin-bottom:8px">
        <table style="border-collapse:collapse;width:auto">
          <thead><tr>
            <th style="text-align:left;padding:6px 16px 6px 8px;font-size:.66rem;color:var(--color-text-3);text-transform:uppercase">Departamento</th>
            ${colHeaders}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    this._bindTariffEditorEvents(units);
  }

  _bindTariffEditorEvents(units) {
    const el = document.getElementById('cfg-tariff-content');
    if (!el) return;

    // Guardar precio al salir del campo, y replicarlo automáticamente a las
    // demás unidades que comparten el mismo "Grupo tarifario" (ver columna
    // de Departamentos/Unidades), para no tener que cargar el mismo valor
    // a mano en cada una.
    el.querySelectorAll('.tariff-price-input').forEach(input => {
      // Al enfocar, mostrar el número en crudo (sin puntos ni .-) para editar fácil
      input.addEventListener('focus', () => {
        input.value = this._rawTariffPrice(input.value);
        input.select();
      });

      input.addEventListener('blur', async () => {
        const { unit, year, month } = input.dataset;
        const raw = this._rawTariffPrice(input.value);
        const price = parseFloat(raw);

        if (raw === '' || isNaN(price) || price <= 0) {
          input.value = '';
          return;
        }
        input.value = this._fmtTariffPrice(price); // reformatear siempre

        const sourceUnit = units.find(u => String(u.id) === String(unit));
        const rg = sourceUnit?.rate_group?.trim();
        const siblings = rg ? units.filter(u => u.id !== sourceUnit.id && u.rate_group?.trim() === rg) : [];
        const targets = [sourceUnit, ...siblings].filter(Boolean);

        const results = await Promise.all(targets.map(u =>
          upsertMonthlyRate(this.db, this.ctx.hotelId, u.id, parseInt(year), parseInt(month), { price_per_night: price })
        ));
        const err = results.find(r => r.error);
        if (err) { showToast('Error al guardar: ' + err.error.message, 'error'); return; }

        // Reflejar el valor en los inputs de las unidades hermanas sin recargar toda la tabla
        siblings.forEach(u => {
          const sib = el.querySelector(`.tariff-price-input[data-unit="${u.id}"][data-year="${year}"][data-month="${month}"]`);
          if (sib) sib.value = this._fmtTariffPrice(price);
        });

        showToast(siblings.length ? `Tarifa guardada ✓ (replicada a ${siblings.length} depto${siblings.length===1?'':'s'} del mismo grupo)` : 'Tarifa guardada ✓', 'success');
        await logAction('UPDATE', 'unit_monthly_rates', unit, `Tarifa ${month}/${year}: $${price}`);
      });
    });

    // Promo (🏷️ junto al mes) — aplica/quita a TODOS los deptos de ese mes
    el.querySelectorAll('.tariff-promo-month-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { year, month } = btn.dataset;
        const isOn = btn.dataset.on === '1';
        if (isOn) {
          if (!confirm('¿Desactivar la promo para todos los deptos en este mes?')) return;
          await Promise.all(units.map(u =>
            upsertMonthlyRate(this.db, this.ctx.hotelId, u.id, parseInt(year), parseInt(month), { promo_active: false })
          ));
          showToast('Promo desactivada', 'success');
        } else {
          const pay  = prompt('Promo tipo "paga X, gratis Y" — ¿Cuántas noches se pagan? (ej: 2)', '2');
          if (!pay) return;
          const free = prompt('¿Cuántas noches son gratis? (ej: 1)', '1');
          if (!free) return;
          const results = await Promise.all(units.map(u =>
            upsertMonthlyRate(this.db, this.ctx.hotelId, u.id, parseInt(year), parseInt(month), {
              promo_active: true, promo_pay: parseInt(pay), promo_free: parseInt(free),
            })
          ));
          const err = results.find(r => r.error);
          if (err) { showToast('Error: ' + err.error.message, 'error'); return; }
          showToast('Promo activada para todos los deptos ✓', 'success');
        }
        await this._renderTariffEditorBody();
      });
    });

    // Agregar columna personalizada
    document.getElementById('btn-add-tariff-custom')?.addEventListener('click', () => {
      this._openTariffCustomModal(units);
    });

    // Editar columna personalizada (nombre/fechas/nota)
    el.querySelectorAll('.tariff-custom-edit').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const customCols = this._tariffCustomColsCache ?? [];
        const col = customCols.find(c => String(c.id) === String(id));
        this._openTariffCustomModal(units, col);
      });
    });

    // Guardar precio de columna personalizada al salir del campo
    el.querySelectorAll('.tariff-custom-price-input').forEach(input => {
      input.addEventListener('focus', () => {
        input.value = this._rawTariffPrice(input.value);
        input.select();
      });

      input.addEventListener('blur', async () => {
        const { col, unit } = input.dataset;
        const raw = this._rawTariffPrice(input.value);
        const price = parseFloat(raw);

        if (raw === '' || isNaN(price) || price <= 0) {
          input.value = '';
          return;
        }
        input.value = this._fmtTariffPrice(price);

        const { error } = await upsertCustomPrice(this.db, col, unit, { price });
        if (error) { showToast('Error al guardar: ' + error.message, 'error'); return; }
        showToast('Precio guardado ✓', 'success');
      });
    });

    // Eliminar columna personalizada
    el.querySelectorAll('.tariff-custom-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('¿Eliminar esta columna personalizada? Se borran también sus precios cargados.')) return;
        const { error } = await deleteCustomColumn(this.db, btn.dataset.id);
        if (error) { showToast('Error: ' + error.message, 'error'); return; }
        showToast('Columna eliminada', 'success');
        await this._renderTariffEditorBody();
      });
    });
  }

  // ── Modal: crear/editar columna personalizada con selector de fechas real ──
  _openTariffCustomModal(units, existingCol = null) {
    const overlay   = document.getElementById('overlay-tariff-custom');
    const titleEl   = document.getElementById('tariff-custom-title');
    const noteEl    = document.getElementById('tariff-custom-note');
    const useDateEl = document.getElementById('tariff-custom-use-dates');
    const datesWrap = document.getElementById('tariff-custom-dates-wrap');
    if (!overlay) return;

    const isEdit = !!existingCol;
    const modalTitleEl = document.getElementById('tariff-custom-modal-title');
    if (modalTitleEl) modalTitleEl.textContent = isEdit ? 'Editar columna' : 'Nueva columna personalizada';
    const confirmBtn = document.getElementById('tariff-custom-confirm');
    if (confirmBtn) confirmBtn.textContent = isEdit ? 'Guardar cambios' : 'Crear columna';

    titleEl.value = isEdit ? (existingCol.title ?? '') : '';
    noteEl.value  = isEdit ? (existingCol.note ?? '') : '';
    useDateEl.checked = isEdit ? !!(existingCol.date_from && existingCol.date_to) : true;
    datesWrap.style.display = useDateEl.checked ? '' : 'none';
    overlay.classList.remove('hidden');

    let picker = this._tariffDrp;
    if (!picker) {
      picker = new DateRangePicker('tariff-custom-drp', { onChange: () => {} });
      this._tariffDrp = picker;
    } else {
      picker.clear();
    }
    if (isEdit && existingCol.date_from && existingCol.date_to) {
      picker.setValue?.(existingCol.date_from, existingCol.date_to);
    }

    useDateEl.onchange = () => {
      datesWrap.style.display = useDateEl.checked ? '' : 'none';
    };

    const close = () => overlay.classList.add('hidden');
    document.getElementById('tariff-custom-close').onclick  = close;
    document.getElementById('tariff-custom-cancel').onclick = close;

    document.getElementById('tariff-custom-confirm').onclick = async () => {
      const title = titleEl.value.trim();
      if (!title) { showToast('Ingresá un título', 'warning'); return; }
      const note  = noteEl.value.trim();

      let dateFrom = null, dateTo = null;
      if (useDateEl.checked) {
        const { checkIn, checkOut } = picker.getValue();
        if (!checkIn || !checkOut) { showToast('Seleccioná el rango de fechas en el calendario', 'warning'); return; }
        dateFrom = checkIn;
        dateTo   = checkOut;
      }

      const payload = isEdit
        ? { id: existingCol.id, title, note: note || null, date_from: dateFrom, date_to: dateTo, position: existingCol.position ?? 999, active: true }
        : { title, note: note || null, date_from: dateFrom, date_to: dateTo, position: 999, active: true };

      const { data, error } = await upsertCustomColumn(this.db, this.ctx.hotelId, payload).select().single();
      if (error) { showToast('Error: ' + error.message, 'error'); return; }

      close();
      showToast(isEdit ? 'Columna actualizada ✓' : 'Columna creada ✓ — cargá el precio por unidad en la tabla', 'success');
      await this._renderTariffEditorBody();
    };
  }
}
