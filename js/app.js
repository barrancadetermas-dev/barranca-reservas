import { generateVoucherText, openWhatsAppVoucher, openManagerTemplate } from './services/whatsapp-service.js';
import { Bus, EVENTS } from './services/event-bus.js';
import { cache } from './services/supabase-cache.js';
import { Sound } from './services/sound-service.js';
import { NotificationService } from './services/notification-service.js';
// ═══════════════════════════════════════════════════
// app.js v5.0 — MILA Sistema Inteligente para Alojamientos
// + Roles (admin/staff/demo) + Demo banner
// + Audit log + Check-in/out + Cancel modal
// + Error boundaries + PWA + Módulo Operaciones
// + Panel de Configuración + Indicador de Conexión
// ═══════════════════════════════════════════════════

import { supabase, loadHotelContext, AppContext, showToast, toISODate, formatARS, localToday, localDateISO } from './supabase-config.js';
import { SidebarCalendar } from './components/sidebar-calendar.js';
import { can, isDemo, getRoleLabel, ROLE_PERMISSIONS } from './auth/permissions.js';
import { logAction } from './services/audit-service.js';
import { Dashboard }    from './components/dashboard.js';
import { Calendar }     from './components/calendar.js';
import { BookingForm }  from './components/booking-form.js';
import { BookingList }  from './components/booking-list.js';
import { Statistics }   from './components/statistics.js';
import { GuestsCRM }    from './components/guests.js';
import { fetchDollarRates, startDollarAutoRefresh, formatDollarBadge, formatDollarHeaderLabel, getOfficialAverageRate } from './services/dollar-api.js';
import { ConfigPanel }    from './components/config-panel.js';
import { AuditPanel }     from './components/audit-panel.js';
import { OperationsModule } from './components/operations.js';

let dashboard   = null;
let calendar    = null;
let bookingForm = null;
let notifService = null;
let bookingList = null;
let statistics  = null;
let guestsCRM   = null;
let configPanel = null;
let auditPanel  = null;
let operations  = null;
let currentSection = 'dashboard';
let _initializedUserId = null; // evita que initApp() corra más de una vez para el mismo usuario

// ══════════════════════════════════════════════════
// PWA
// ══════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(reg => {
      console.log('[PWA] Service Worker registrado');
      // Forzar activación inmediata del SW nuevo si hay uno esperando
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        newSW?.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            newSW.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    })
    .catch(e => console.warn('[PWA] SW error:', e));
  // Recargar cuando el nuevo SW tome control
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) { refreshing = true; window.location.reload(); }
  });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'SYNC_COMPLETE') showToast(e.data.message, 'success');
  });
}

// ══════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════
async function boot() {
  initDarkMode();
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    _initializedUserId = session.user.id;
    await initApp(session.user);
  } else {
    showLogin();
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      if (_initializedUserId === session.user.id) return; // evento SIGNED_IN duplicado — ya inicializado
      _initializedUserId = session.user.id;
      await initApp(session.user);
    }
    if (event === 'SIGNED_OUT') {
      _initializedUserId = null;
      destroyApp();
      showLogin();
    }
  });
}

// ══════════════════════════════════════════════════
// DARK MODE
// ══════════════════════════════════════════════════
function initDarkMode() {
  const saved = localStorage.getItem('pms-theme') ?? 'light';
  applyDarkMode(saved);
}
// ══════════════════════════════════════════════════
// HELPER: Aplicar nombre y avatar de forma unificada
// Llámalo cada vez que cambie el nombre del usuario
// ══════════════════════════════════════════════════
export function _applyUserDisplay({ nombre, email } = {}) {
  const displayName = nombre?.trim() || email?.split('@')[0] || 'Admin';
  const initial     = displayName[0].toUpperCase();
  document.querySelectorAll('#user-avatar').forEach(el => { el.textContent = initial; });
  document.querySelectorAll('#user-name').forEach(el => { el.textContent = displayName; });
  window._currentUserDisplay = { displayName, initial, nombre: nombre ?? null, email: email ?? null };
}
// Exponer globalmente para config-panel y otros módulos
if (typeof window !== 'undefined') window._applyUserDisplay = _applyUserDisplay;

function applyDarkMode(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('pms-theme', theme);
  // Actualizar botones del panel de tema si están en el DOM
  const lightBtn = document.getElementById('theme-mode-light');
  const darkBtn  = document.getElementById('theme-mode-dark');
  if (lightBtn) lightBtn.style.fontWeight = theme === 'light' ? '800' : '600';
  if (darkBtn)  darkBtn.style.fontWeight  = theme === 'dark'  ? '800' : '600';
}

// ══════════════════════════════════════════════════
// LOGIN / LOGOUT
// ══════════════════════════════════════════════════
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
}
function hideLogin() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btnText  = document.getElementById('login-btn-text');
  const spinner  = document.getElementById('login-btn-spinner');
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');

  if (!email || !password) {
    errEl.textContent = 'Ingresá tu email y contraseña.';
    errEl.classList.remove('hidden');
    return;
  }

  btnText?.classList.add('hidden');
  spinner?.classList.remove('hidden');
  errEl?.classList.add('hidden');
  if (btn) btn.disabled = true;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      const msgs = {
        'Invalid login credentials': 'Email o contraseña incorrectos.',
        'Email not confirmed':       'Confirmá tu email antes de ingresar.',
        'Too many requests':         'Demasiados intentos. Esperá un momento.',
      };
      const msg = msgs[error.message] ?? `Error: ${error.message}`;
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
      errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    // Si no hay error, onAuthStateChange dispara initApp automáticamente
  } catch (ex) {
    errEl.textContent = 'Error de conexión. Verificá tu internet.';
    errEl.classList.remove('hidden');
  } finally {
    btnText?.classList.remove('hidden');
    spinner?.classList.add('hidden');
    if (btn) btn.disabled = false;
  }
});

document.getElementById('toggle-password')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const input   = document.getElementById('login-password');
  const btn     = document.getElementById('toggle-password');
  const isShown = input.type === 'text';
  input.type    = isShown ? 'password' : 'text';
  // Actualizar ícono: ojo abierto / cerrado
  btn.innerHTML = isShown
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
       </svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
       </svg>`;
  // Mantener foco en el campo
  input.focus();
});

document.getElementById('logout-btn').addEventListener('click', () => supabase.auth.signOut());

// ══════════════════════════════════════════════════
// INIT APP
// ══════════════════════════════════════════════════
async function initApp(user) {
  try {
    await loadHotelContext();
    AppContext.user = user;

    // ── Cargar rol del usuario ──
    const { data: hotelUser } = await supabase
      .from('hotel_users')
      .select('role')
      .eq('hotel_id', AppContext.hotelId)
      .eq('user_id', user.id)
      .single();

    AppContext.role    = hotelUser?.role ?? 'staff';
    AppContext.IS_DEMO = AppContext.role === 'demo';

    hideLogin();
    updateHeaderDate();

    // ── UI usuario — carga inicial con email, luego reemplaza con perfil ──
    const emailFallback = user.email?.split('@')[0] ?? 'Admin';
    const metaName      = user.user_metadata?.name ?? emailFallback;
    _applyUserDisplay({ nombre: metaName, email: user.email });

    document.getElementById('user-role-badge').textContent = getRoleLabel(AppContext.role);

    // Cargar perfil desde user_profiles (nombre guardado tiene prioridad máxima)
    supabase.from('user_profiles').select('nombre').eq('id', user.id).single()
      .then(({ data }) => {
        _applyUserDisplay({ nombre: data?.nombre || metaName, email: user.email });
      }).catch(() => {});

    // ── Demo banner ──
    if (AppContext.IS_DEMO) setupDemoBanner();

    // ── Componentes — cada uno en su propio try/catch para no bloquear los demás ──
    const tryInit = (name, fn) => { try { return fn(); } catch(e) { console.error(`[MILA] Error init ${name}:`, e); return null; } };

    bookingForm = tryInit('BookingForm', () => new BookingForm(supabase, AppContext));
    window._bookingFormInstance = bookingForm;
    dashboard   = tryInit('Dashboard',  () => new Dashboard(supabase, AppContext, bookingForm));
    calendar    = tryInit('Calendar',   () => new Calendar(supabase, AppContext, bookingForm));
    bookingList = tryInit('BookingList',() => new BookingList(supabase, AppContext, bookingForm));
    statistics  = tryInit('Statistics', () => new Statistics(supabase, AppContext));
    guestsCRM   = tryInit('GuestsCRM',  () => new GuestsCRM(supabase, AppContext, bookingForm));
    configPanel = tryInit('ConfigPanel',() => new ConfigPanel(supabase, AppContext));
    auditPanel  = tryInit('AuditPanel', () => new AuditPanel(supabase, AppContext));
    operations  = tryInit('Operations', () => new OperationsModule(supabase, AppContext));
    window._guestsCRM    = guestsCRM;
    window._statsInstance = statistics;
    window._operations   = operations;

    // ── Nav: mostrar/ocultar secciones por rol ──
    setupNavByRole();

    // Restaurar última sección visitada
    let _startSection = 'dashboard';
    try {
      const _saved = localStorage.getItem('mila_last_section');
      if (_saved && ['dashboard','calendar','bookings','statistics','guests','reminders','operations','audit','config'].includes(_saved)) {
        _startSection = _saved;
      }
    } catch {}
    await navigateTo(_startSection);

    loadDollarBadge();
    updateOperationsBadge();
    setupRealtime();
    setupNavigation();
    setupGlobalShortcuts();
    setupCommandPalette();

    // ── Bottom nav (mobile) ────────────────────────
    document.querySelectorAll('.bnav-item[data-section]').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.section));
    });
    document.getElementById('bnav-fab')?.addEventListener('click', () => {
      if (isDemo()) return showDemoAction(() => bookingForm.open());
      bookingForm.open(); // mobile: abre formulario directo, sin calculadora
    });

    // ── Disponibilidad mobile (lupa en bottom nav) ──
    document.getElementById('bnav-search')?.addEventListener('click', () => {
      openMobileAvailPanel();
    });

    // ── Setup modales — cada uno aislado ──
    const trySetup = (name, fn) => { try { fn(); } catch(e) { console.error(`[MILA] Error setup ${name}:`, e); } };
    trySetup('connectivity',  setupConnectivityIndicator);
    trySetup('calculator',    setupCalculator);
    trySetup('reminder',      setupReminderModal);
    trySetup('expense',       setupExpenseModal);
    trySetup('guestProfile',  setupGuestProfileModal);
    trySetup('whatsapp',      setupWhatsAppModal);
    trySetup('cancelBooking', setupCancelBookingModal);
    trySetup('checkInOut',    setupCheckInOutModal);
    trySetup('detail',        setupDetailModal);
    trySetup('modalCleanup',  _ensureModalCleanup);
    trySetup('sound',         setupSoundButton);
    trySetup('theme',         setupThemeSystem);
    notifService = new NotificationService(supabase);
    trySetup('realNotif',     () => setupRealNotifications(notifService));

    // Mini calendario sidebar
    const sidebarCalContainer = document.getElementById('sidebar-cal-container');
    if (sidebarCalContainer) {
      window._sidebarCal = new SidebarCalendar(supabase);
      window._sidebarCal.init(sidebarCalContainer).catch(console.error);
    }
    // Emitir sonido de login — defer until first user interaction (iOS Safari requires it)
    let _loginSoundPlayed = false;
    const playLoginSound = () => {
      if (_loginSoundPlayed) return;
      _loginSoundPlayed = true;
      Sound?.login?.();
      document.removeEventListener('click',     playLoginSound);
      document.removeEventListener('touchstart', playLoginSound);
    };
    if (document.hasFocus() && !navigator.userAgent.match(/Mobi|Android|iPhone|iPad/i)) {
      setTimeout(playLoginSound, 300);
    } else {
      document.addEventListener('click',     playLoginSound, { once: true });
      document.addEventListener('touchstart', playLoginSound, { once: true, passive: true });
    }

    document.addEventListener('reminders:badge', (e) => updateReminderBadge(e.detail.count));
    document.addEventListener('booking:fullypaid', () => { launchConfetti(); Sound?.newBooking(); });
    document.addEventListener('show:toast', (e) => showToast(e.detail.msg, e.detail.type));

    // ── Recargar la sección activa cuando cambia una reserva (debounced) ──
    document.addEventListener('booking:changed', () => {
      // SIEMPRE invalidar cache antes de recargar — evita mostrar datos viejos
      cache.invalidate('bookings', 'reminders', 'payments');
      debouncedCalendarLoad(300);
      window._sidebarCal?.refresh().catch(console.error);
    });

    // "Nueva Reserva" → abre calculadora primero como paso 0
    document.getElementById('btn-new-booking')?.addEventListener('click', () => {
      if (isDemo()) return showDemoAction(() => bookingForm.open());
      const overlay = document.getElementById('overlay-calculator');
      if (overlay) {
        const title = overlay.querySelector('.calc-title');
        if (title) title.innerHTML = '📊 Paso 1 — Calculá el precio';
        const createBtn = document.getElementById('calc-create-booking');
        if (createBtn) createBtn.textContent = 'Continuar con la reserva →';
        // Usar el botón de calculadora para abrir → mantiene calc-active sincronizado
        const calcBtn = document.getElementById('btn-calculator');
        if (calcBtn && !calcBtn.classList.contains('calc-active')) calcBtn.click();
        else {
          overlay.style.display = 'flex';
          overlay.classList.remove('hidden');
          document.getElementById('calc-price')?.focus();
        }
      } else {
        bookingForm.open();
      }
    });

    // Restaurar título original cuando el botón de calculadora del header lo abre
    document.getElementById('btn-calculator')?.addEventListener('mousedown', () => {
      const title = document.querySelector('.calc-title');
      if (title) title.innerHTML = '🧮 Calculadora de estadía';
      const createBtn = document.getElementById('calc-create-booking');
      if (createBtn) createBtn.textContent = 'Crear reserva con estos datos →';
    });
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      const sb = document.getElementById('sidebar');
      if (window.innerWidth < 768 && sb.classList.contains('open') &&
          !sb.contains(e.target) && e.target.id !== 'sidebar-toggle') {
        sb.classList.remove('open');
      }
    });

  } catch (err) {
    console.error('[App] initApp error:', err);
    showErrorBoundary('app', err.message, boot);
  }
}

function destroyApp() {
  dashboard = calendar = bookingForm = bookingList = statistics = guestsCRM = null;
  configPanel = auditPanel = operations = null;
}

// ══════════════════════════════════════════════════
// DEMO BANNER
// ══════════════════════════════════════════════════
function setupDemoBanner() {
  const banner = document.getElementById('demo-banner');
  if (!banner) return;
  banner.classList.remove('hidden');
  document.getElementById('app-shell').classList.add('has-demo-banner');
  banner.querySelector('#demo-banner-close')?.addEventListener('click', () => {
    supabase.auth.signOut();
  });
}

export function showDemoAction(simulateFn) {
  simulateFn?.(); // ejecutar igual visualmente
  showToast('🎭 Modo Demo · Simulado — en modo real esto se guardaría', 'warning');
}

// ══════════════════════════════════════════════════
// NAV POR ROL
// ══════════════════════════════════════════════════
function setupNavByRole() {
  const auditNav  = document.querySelector('.nav-item[data-section="audit"]');
  const configNav = document.querySelector('.nav-item[data-section="config"]');
  const statsNav  = document.querySelector('.nav-item[data-section="statistics"]');

  if (auditNav)  auditNav.style.display  = can('viewAuditLog')          ? '' : 'none';
  if (configNav) configNav.style.display = can('manageSeasonPricing')   ? '' : 'none';
  if (statsNav && !can('viewStats') && !isDemo()) statsNav.style.opacity = '.5';
}

// ══════════════════════════════════════════════════
// NAVEGACIÓN
// ══════════════════════════════════════════════════
const SECTION_META = {
  dashboard:  { title: 'Dashboard',                  icon: '🏠', sub: 'Panel de Hoy · Resumen operativo diario' },
  calendar:   { title: 'Calendario de Ocupación',    icon: '📅', sub: 'Panel de Reservas · Drag & Drop · SHIFT+arrastre para bloquear' },
  bookings:   { title: 'Reservas',                   icon: '📋', sub: 'Planilla de Reservas · Gestión completa' },
  statistics: { title: 'Estadísticas',               icon: '📊', sub: 'Panel de Rendimiento · Ingresos · Ocupación · ADR · RevPAR' },
  reminders:  { title: 'Recordatorios',              icon: '🔔', sub: 'Agenda de Tareas · Mantenimiento programado' },
  guests:     { title: 'Huéspedes',                  icon: '👥', sub: 'CRM · Historial · Notas · Antecedentes' },
  operations: { title: 'Operaciones',                icon: '🔧', sub: 'Panel Operativo · Limpieza · Mantenimiento' },
  audit:      { title: 'Auditoría',                  icon: '📜', sub: 'Registro del Sistema · Historial de acciones' },
  config:     { title: 'Configuración',              icon: '⚙️', sub: 'Panel de Administración · Comisiones · Tarifas · Departamentos' },
};
const SECTION_TITLES = Object.fromEntries(Object.entries(SECTION_META).map(([k,v]) => [k, v.title]));

function setupNavigation() {
  document.querySelectorAll('.nav-item[data-section]').forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      await navigateTo(link.dataset.section);
      document.getElementById('sidebar').classList.remove('open');
    });
  });
}

export async function navigateTo(section) {
  // Gate por rol
  if (section === 'statistics' && !can('viewStats') && !isDemo()) {
    showToast('🔒 Sin acceso a estadísticas', 'warning');
    return;
  }
  if (section === 'audit' && !can('viewAuditLog')) {
    showToast('🔒 Solo administradores', 'warning');
    return;
  }

  currentSection = section;
  try { localStorage.setItem('mila_last_section', section); } catch {}
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.section === section));
  document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
  document.getElementById(`section-${section}`)?.classList.add('active');
  document.getElementById('header-title').textContent = SECTION_META[section]?.title ?? section;
  const subEl = document.getElementById('header-sub');
  if (subEl) subEl.textContent = SECTION_META[section]?.sub ?? '';

  Sound?.click();
  updateHeaderDate();

  try {
    switch (section) {
      case 'dashboard':   await dashboard?.load(); break;
      case 'calendar':    await calendar?.load(); break;
      case 'bookings':    await bookingList?.load(); break;
      case 'statistics':  statistics?.init(); break;
      case 'reminders':   await loadRemindersSection(); break;
      case 'guests':      await guestsCRM?.load(); break;
      case 'operations':  await operations?.load(); break;
      case 'audit':       await auditPanel?.load(); break;
      case 'config':      await configPanel?.load(); break;
    }
  } catch (err) {
    showErrorBoundary(`section-${section}`, err.message, () => navigateTo(section));
  }
}
// Exponer globalmente para onclick inline en templates HTML
if (typeof window !== 'undefined') window.milaNav = navigateTo;

function updateHeaderDate() {
  const dateStr = new Date().toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  // Keep the legacy element working if it exists
  const dateEl = document.getElementById('header-date');
  if (dateEl) dateEl.textContent = dateStr;
}

// ══════════════════════════════════════════════════
// ERROR BOUNDARY
// ══════════════════════════════════════════════════
function showErrorBoundary(containerId, message, retryFn) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="error-state">
      <span class="error-icon">⚠️</span>
      <p class="error-msg">${message ?? 'Error inesperado'}</p>
      <button class="btn btn-outline btn-sm" id="retry-${containerId}">🔄 Reintentar</button>
    </div>`;
  document.getElementById(`retry-${containerId}`)?.addEventListener('click', () => retryFn?.());
}

// ══════════════════════════════════════════════════
// AUDIT LOG — implementado en js/services/audit-service.js
// Exportado aquí para que otros módulos que hacen import('../app.js') lo encuentren
export { logAction } from './services/audit-service.js';

// audit delegado a AuditPanel en audit-panel.js

// ══════════════════════════════════════════════════
// SEASON PRICING (Configuración)
// ══════════════════════════════════════════════════
async function loadSeasonPricing() {
  const container = document.getElementById('section-config');
  if (!container) return;

  const { data: seasons } = await supabase
    .from('season_pricing')
    .select('*, units(name, sort_order)')
    .eq('hotel_id', AppContext.hotelId)
    .order('start_date');

  const { data: commissions } = await supabase
    .from('channel_commissions')
    .select('*')
    .eq('hotel_id', AppContext.hotelId);

  const fmtDate = (d) => d ? new Date(d+'T12:00:00').toLocaleDateString('es-AR', {day:'2-digit',month:'short',year:'numeric'}) : '—';

  container.innerHTML = `
    <div style="display:grid;gap:24px">
      <!-- Comisiones -->
      <div class="card">
        <div class="card-header">
          <h3>Comisiones por Canal</h3>
          <span style="font-size:.78rem;color:var(--color-text-3)">Se descuentan del ingreso neto en el P&L</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          ${(commissions ?? []).map(c => `
            <div style="display:flex;align-items:center;justify-content:space-between;
              padding:12px 16px;border:1px solid var(--color-border);border-radius:var(--r-lg)">
              <div>
                <div style="font-weight:700;font-size:.9rem">${c.channel === 'booking' ? '🟦 Booking.com' : '🟧 Airbnb'}</div>
                <div style="font-size:.75rem;color:var(--color-text-3)">Comisión sobre ingreso bruto</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <input type="number" value="${c.commission_pct}" min="0" max="50" step="0.5"
                  style="width:70px;padding:6px 10px;border:1px solid var(--color-border);
                  border-radius:var(--r-md);font-size:.875rem;text-align:center"
                  onchange="window.updateCommission('${c.id}', this.value)">
                <span style="font-size:.875rem;color:var(--color-text-2)">%</span>
              </div>
            </div>`).join('')}
        </div>
      </div>

      <!-- Tarifas por temporada -->
      <div class="card">
        <div class="card-header">
          <h3>Tarifas por Temporada</h3>
          ${can('manageSeasonPricing') ? `<button class="btn btn-primary btn-sm" onclick="window.openSeasonForm()">+ Nueva tarifa</button>` : ''}
        </div>
        ${!seasons?.length ? `<p class="empty-state-sm">Sin tarifas especiales configuradas.</p>` :
          seasons.map(s => `
            <div style="display:flex;align-items:center;gap:14px;padding:12px 16px;
              border:1px solid var(--color-border);border-radius:var(--r-lg);margin-bottom:8px">
              <div style="flex:1">
                <div style="font-weight:700;font-size:.9rem">${s.name}</div>
                <div style="font-size:.75rem;color:var(--color-text-3);margin-top:2px">
                  ${fmtDate(s.start_date)} → ${fmtDate(s.end_date)} ·
                  ${s.units ? `#${s.units.sort_order} ${s.units.name}` : 'Todas las unidades'}
                </div>
              </div>
              <div style="font-size:1.1rem;font-weight:800;color:var(--color-text)">
                $${s.price_per_night.toLocaleString('es-AR')}<span style="font-size:.72rem;font-weight:400;color:var(--color-text-3)">/noche</span>
              </div>
              ${can('manageSeasonPricing') ? `
                <button class="btn btn-ghost btn-xs" onclick="window.deleteSeasonPricing('${s.id}')">🗑️</button>` : ''}
            </div>`).join('')}
      </div>
    </div>`;

  window.updateCommission = async (id, pct) => {
    if (!can('manageSeasonPricing')) { showToast('🔒 Sin permiso', 'warning'); return; }
    const { error } = await supabase.from('channel_commissions').update({ commission_pct: parseFloat(pct) }).eq('id', id);
    if (error) showToast('Error al actualizar', 'error');
    else showToast('Comisión actualizada ✓', 'success');
  };
  window.deleteSeasonPricing = async (id) => {
    if (!confirm('¿Eliminar esta tarifa de temporada?')) return;
    await supabase.from('season_pricing').delete().eq('id', id);
    showToast('Tarifa eliminada', 'success');
    loadSeasonPricing();
  };
  window.openSeasonForm = () => {
    document.getElementById('overlay-season')?.classList.remove('hidden');
    document.getElementById('season-unit').innerHTML =
      '<option value="">Todas las unidades</option>' +
      AppContext.units.map(u => `<option value="${u.id}">#${u.sort_order} · ${u.name}</option>`).join('');
  };
}

// ══════════════════════════════════════════════════
// CANCEL BOOKING MODAL
// ══════════════════════════════════════════════════
function setupCancelBookingModal() {
  document.getElementById('cancel-modal-close')?.addEventListener('click', closeCancelModal);
  document.getElementById('overlay-cancel-booking')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCancelModal();
  });
  document.getElementById('cancel-refund-option')?.addEventListener('change', (e) => {
    document.getElementById('cancel-refund-input')?.classList.toggle('hidden', e.target.value !== 'partial');
  });
  document.getElementById('btn-confirm-cancel')?.addEventListener('click', confirmCancelBooking);
}

export function openCancelModal(bookingId, totalPaid) {
  if (!can('cancelBooking')) { showToast('🔒 Sin permiso para cancelar', 'warning'); return; }
  if (isDemo()) { showDemoAction(() => showToast('Reserva cancelada (simulado)', 'success')); return; }
  const overlay = document.getElementById('overlay-cancel-booking');
  if (!overlay) return;
  overlay.dataset.bookingId = bookingId;
  overlay.dataset.totalPaid = totalPaid;
  document.getElementById('cancel-paid-display').textContent = formatARS(totalPaid);
  document.getElementById('cancel-refund-option').value = totalPaid > 0 ? 'retain' : 'none';
  document.getElementById('cancel-refund-input')?.classList.add('hidden');
  overlay.style.display = 'flex';
}

function closeCancelModal() {
  document.getElementById('overlay-cancel-booking')?.classList.add('hidden');
}

async function confirmCancelBooking() {
  const overlay   = document.getElementById('overlay-cancel-booking');
  const bookingId = overlay?.dataset.bookingId;
  const totalPaid = parseFloat(overlay?.dataset.totalPaid ?? 0);
  if (!bookingId) return;

  const option   = document.getElementById('cancel-refund-option').value;
  let refundAmt  = 0;
  if (option === 'full')    refundAmt = totalPaid;
  if (option === 'partial') refundAmt = parseFloat(document.getElementById('cancel-refund-amount').value) || 0;

  const note = document.getElementById('cancel-note').value.trim();

  const { error } = await supabase.from('bookings').update({
    status:         'cancelled',
    cancelled_at:   new Date().toISOString(),
    cancel_note:    note || null,
    refund_amount:  refundAmt,
  }).eq('id', bookingId);

  if (error) { showToast('Error al cancelar', 'error'); return; }

  // Registrar devolución como pago negativo
  if (refundAmt > 0) {
    await supabase.from('payments').insert({
      booking_id: bookingId,
      hotel_id:   AppContext.hotelId,
      amount:     -refundAmt,
      amount_ars: -refundAmt,
      currency:   'ARS',
      method:     'transfer',
      notes:      `Devolución por cancelación${note ? ': ' + note : ''}`,
    });
  }

  await logAction('CANCEL', 'booking', bookingId,
    `Reserva cancelada. Devolución: ${formatARS(refundAmt)}. Motivo: ${note || 'Sin motivo indicado'}`);

  showToast('Reserva cancelada' + (refundAmt > 0 ? ` · Devolución: ${formatARS(refundAmt)}` : ''), 'success');
  closeCancelModal();
  document.getElementById('overlay-detail')?.classList.add('hidden');
  document.dispatchEvent(new CustomEvent('booking:changed'));
}

// ══════════════════════════════════════════════════
// CHECK-IN / CHECK-OUT
// ══════════════════════════════════════════════════
function setupCheckInOutModal() {} // mantenido por compatibilidad

// ── Wiring completo del modal de detalle de reserva ──
function setupDetailModal() {
  const closeDetail = () => {
    document.getElementById('overlay-detail')?.classList.add('hidden');
  };

  // Cerrar
  document.getElementById('detail-close')?.addEventListener('click', closeDetail);
  document.getElementById('overlay-detail')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDetail();
  });

  // Helper: obtener reserva completa del modal activo
  const getDetailBooking = async () => {
    const id = bookingForm?._currentDetailBookingId;
    if (!id) return null;
    const { data } = await supabase
      .from('bookings')
      .select('*, guests!bookings_guest_id_fkey(*), booking_units(unit_id, units(name,sort_order,color,max_guests)), payments(*)')
      .eq('id', id).single();
    return data;
  };

  // Voucher WhatsApp
  document.getElementById('detail-whatsapp')?.addEventListener('click', async () => {
    const b = await getDetailBooking();
    if (b) openWhatsAppVoucher(b, AppContext);
  });

  // Mensaje para encargada
  document.getElementById('detail-manager-msg')?.addEventListener('click', async () => {
    const b = await getDetailBooking();
    if (b) openManagerTemplate(b, AppContext);
  });

  // Copiar link directo
  document.getElementById('detail-copy-link')?.addEventListener('click', () => {
    const id = bookingForm?._currentDetailBookingId;
    if (!id) return;
    const url = `${location.origin}${location.pathname}?booking=${id}`;
    navigator.clipboard?.writeText(url).then(() => showToast('Link copiado ✓', 'success'))
      .catch(() => showToast('No se pudo copiar', 'error'));
  });

  // Duplicar reserva
  document.getElementById('detail-duplicate-btn')?.addEventListener('click', async () => {
    if (isDemo()) { showDemoAction(null); return; }
    const b = await getDetailBooking();
    if (!b) return;
    closeDetail();
    const unitId = (b.booking_units ?? [])[0]?.unit_id;
    bookingForm?.open({ unitId, source: b.source });
  });

  // Editar
  document.getElementById('detail-btn-edit')?.addEventListener('click', async () => {
    if (isDemo()) { showDemoAction(null); return; }
    const b = await getDetailBooking();
    if (!b) return;
    closeDetail();
    bookingForm?.openEdit(b.id);
  });

  // Cancelar reserva
  document.getElementById('detail-btn-cancel-booking')?.addEventListener('click', () => {
    const id = bookingForm?._currentDetailBookingId;
    if (!id) return;
    const paid = parseFloat(document.querySelector('#detail-body .text-success')?.textContent?.replace(/[^0-9]/g, '') ?? 0);
    // Obtener total_paid de la reserva en memoria si disponible
    getDetailBooking().then(b => {
      if (b) openCancelModal(b.id, b.total_paid ?? 0);
    });
  });

  // Eliminar
  document.getElementById('detail-btn-delete')?.addEventListener('click', async () => {
    if (!can('deleteBooking')) { showToast('🔒 Sin permiso para eliminar', 'warning'); return; }
    if (isDemo()) { showDemoAction(null); return; }
    const id = bookingForm?._currentDetailBookingId;
    if (!id) { showToast('No se pudo identificar la reserva', 'error'); return; }
    if (!confirm('¿Eliminar esta reserva?\nEsta acción no se puede deshacer.')) return;

    const btn = document.getElementById('detail-btn-delete');
    if (btn) { btn.disabled = true; btn.textContent = 'Eliminando...'; }
    try {
      const { error } = await supabase.from('bookings').delete().eq('id', id);
      if (error) throw error;
      closeDetail();
      showToast('Reserva eliminada ✓', 'success');
      await logAction('DELETE', 'booking', id, 'Eliminada desde detalle');
      document.dispatchEvent(new CustomEvent('booking:changed'));
    } catch (err) {
      console.error('[detail-delete] error:', err);
      showToast('Error al eliminar: ' + (err.message ?? 'desconocido'), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Eliminar'; }
    }
  });

  // Check-in
  document.getElementById('detail-checkin-btn')?.addEventListener('click', async () => {
    const id = bookingForm?._currentDetailBookingId;
    if (id) { await markCheckIn(id); closeDetail(); }
  });

  // Check-out
  document.getElementById('detail-checkout-btn')?.addEventListener('click', async () => {
    const id = bookingForm?._currentDetailBookingId;
    if (id) { await markCheckOut(id); closeDetail(); }
  });
}

export async function markCheckIn(bookingId) {
  if (!can('checkInOut')) { showToast('🔒 Sin permiso', 'warning'); return; }
  if (isDemo()) { showDemoAction(null); return; }
  const { error } = await supabase.from('bookings')
    .update({ checked_in_at: new Date().toISOString() }).eq('id', bookingId);
  if (error) { showToast('Error al registrar check-in', 'error'); Sound?.error(); return; }
  await logAction('CHECKIN', 'booking', bookingId, 'Check-in registrado');
  showToast('✅ Check-in registrado', 'success');
  Sound?.checkIn();
  document.dispatchEvent(new CustomEvent('booking:changed'));

  // ── Ofrecer WhatsApp de bienvenida ──────────────────
  try {
    const { data: booking } = await supabase
      .from('bookings')
      .select('guests!bookings_guest_id_fkey(first_name,last_name,phone), booking_units(units(name,sort_order))')
      .eq('id', bookingId).single();

    const phone = booking?.guests?.phone?.replace(/\D/g, '');
    if (phone) {
      const guestName = `${booking.guests.first_name} ${booking.guests.last_name}`.trim();
      const unitName  = (booking.booking_units ?? [])[0]?.units?.name ?? 'su departamento';
      const config    = AppContext.config ?? {};
      const wifi      = config.wifi_name     ? `📶 WiFi: *${config.wifi_name}* · Clave: *${config.wifi_pass ?? '—'}*` : '';
      const checkIn   = config.checkin_hour  ?? '14:00';
      const checkOut  = config.checkout_hour ?? '10:00';

      const welcomeMsg = [
        `¡Hola *${guestName}*! 👋`,
        `Bienvenido/a a *Barranca de Termas*. Tu *${unitName}* ya está listo.`,
        wifi,
        `📋 Check-out: *${checkOut} hs*`,
        `Cualquier consulta, estamos a tu disposición. ¡Que disfrutes la estadía! 🌿`,
      ].filter(Boolean).join('\n\n');

      // Mostrar toast con acción WhatsApp
      const toastCont = document.getElementById('toast-container');
      if (toastCont) {
        const waTip = document.createElement('div');
        waTip.className = 'toast toast-show';
        waTip.style.cssText = 'background:#f0fdf4;border-left:3px solid #22c55e;display:flex;align-items:center;gap:10px;max-width:360px';
        waTip.innerHTML = `
          <span style="font-size:1.2rem">💬</span>
          <span style="flex:1;font-size:.82rem;color:#14532d">¿Enviar bienvenida por WhatsApp a ${guestName.split(' ')[0]}?</span>
          <a href="https://wa.me/${phone}?text=${encodeURIComponent(welcomeMsg)}" target="_blank" rel="noopener"
             style="background:#22c55e;color:white;border:none;border-radius:6px;padding:5px 12px;
                    font-size:.78rem;font-weight:700;cursor:pointer;text-decoration:none;white-space:nowrap"
             onclick="this.closest('.toast')?.remove()">
            Enviar ↗
          </a>
          <button style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1rem;padding:0 2px"
                  onclick="this.closest('.toast')?.remove()">✕</button>`;
        toastCont.appendChild(waTip);
        setTimeout(() => waTip.classList.remove('toast-show'), 12000);
        setTimeout(() => waTip.remove(), 12500);
      }
    }
  } catch { /* WhatsApp es opcional */ }
}

export async function markCheckOut(bookingId) {
  if (!can('checkInOut')) { showToast('🔒 Sin permiso', 'warning'); return; }
  if (isDemo()) { showDemoAction(null); return; }
  const { error } = await supabase.from('bookings')
    .update({ checked_out_at: new Date().toISOString() }).eq('id', bookingId);
  if (error) { showToast('Error al registrar check-out', 'error'); Sound?.error(); return; }
  await logAction('CHECKOUT', 'booking', bookingId, 'Check-out registrado');
  showToast('👋 Check-out registrado', 'success');
  Sound?.checkOut();
  try {
    const { data: booking } = await supabase
      .from('bookings')
      .select('*, guests!bookings_guest_id_fkey(first_name,last_name), booking_units(unit_id,units(name))')
      .eq('id', bookingId).single();
    if (booking) {
      const { OperationsModule } = await import('./components/operations.js');
      await OperationsModule.createCheckoutCleaningTask(supabase, AppContext, booking);
    }
  } catch (_) { /* operaciones opcional */ }
  document.dispatchEvent(new CustomEvent('booking:changed'));
}

// Exponer globalmente para handlers inline
window.markCheckIn  = markCheckIn;
window.openManagerTemplate = (booking) => openManagerTemplate(booking, AppContext);
window.markCheckOut = markCheckOut;
window.openCancelModal = openCancelModal;

// ══════════════════════════════════════════════════
// DOLLAR BADGE
// ══════════════════════════════════════════════════
function _updateDollarUI(rates) {
  if (!rates) return;

  // Badge del header: SIEMPRE el promedio oficial (Compra y Venta), nunca una fuente sola.
  const badgeEl = document.getElementById('dollar-badge-value');
  if (badgeEl && rates.oficial?.sell) {
    badgeEl.textContent = `$${Math.round(rates.oficial.sell).toLocaleString('es-AR')}`;
  }
  const badgeBuyEl = document.getElementById('dollar-badge-buy');
  if (badgeBuyEl && rates.oficial?.buy) {
    badgeBuyEl.textContent = `$${Math.round(rates.oficial.buy).toLocaleString('es-AR')}`;
  }
  const badgeWrap = document.getElementById('dollar-header-badge');
  if (badgeWrap) {
    badgeWrap.title = formatDollarHeaderLabel(rates);
  }

  // El widget del dashboard se actualiza via dashboard._renderDollar()
  // Solo actualizar campos legacy si existen
  const setEl = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = val; };
  const fmt   = v => v ? `$${Math.round(v).toLocaleString('es-AR')}` : '—';

  // Campos individuales por fuente (oficial venta únicamente)
  const sources = rates.sourceData ?? [];
  const bna     = sources.find(s => s.source === 'BNA');
  const ambito  = sources.find(s => s.source === 'ambito');
  const argdat  = sources.find(s => s.source === 'argentinadatos');

  setEl('dol-of-sell',         fmt(rates.oficial?.sell));
  setEl('dol-of-buy',          fmt(rates.oficial?.buy));
  setEl('dol-ambito-sell',     fmt(ambito?.sell));
  setEl('dol-dolarapi-sell',   fmt(bna?.sell));          // legacy campo
  setEl('dol-bluelytics-sell', fmt(argdat?.sell));       // legacy campo
  setEl('dol-source-count',     String(sources.length || '—'));
  setEl('dol-source-status',    rates.failedSources?.length ? 'Parcial' : 'OK');

  // Timestamp
  const updEl = document.getElementById('dollar-updated-at');
  if (updEl) {
    const t = rates.updatedAt ? new Date(rates.updatedAt).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—';
    updEl.textContent = `${rates.sources?.length ?? 0} fuentes · ${t}`;
  }

  // Estado
  const statusEl = document.getElementById('dollar-status-badge');
  if (statusEl) {
    statusEl.textContent = rates.stale ? '⚠ Caché' : '✓ Actualizado';
  }
  // Actualizar widget del dashboard (nuevo formato)
  window._dashboardInstance?._renderDollar(rates);
}

async function loadDollarBadge() {
  try {
    const rates = await fetchDollarRates();
    _updateDollarUI(rates);
    // Auto-refresh cada 5 minutos
    startDollarAutoRefresh((newRates) => _updateDollarUI(newRates));
  } catch { /* silencioso */ }
}

// ══════════════════════════════════════════════════
// REALTIME + PULSE
// ══════════════════════════════════════════════════
let _realtimeChannel = null;
// Debounced reload — evita múltiples recargas simultáneas
let _calLoadTimer = null;
function debouncedCalendarLoad(delay = 300) {
  clearTimeout(_calLoadTimer);
  _calLoadTimer = setTimeout(() => {
    // Invalidar cache SIEMPRE — garantiza datos frescos desde Supabase
    cache.invalidate('bookings', 'reminders', 'payments');
    // Recargar la sección activa (y componentes secundarios)
    if (currentSection === 'calendar')    { calendar?.load(); }
    if (currentSection === 'dashboard')   { dashboard?.load(); }
    if (currentSection === 'bookings')    { bookingList?.load(); }
    if (currentSection === 'statistics')  { statistics?.loadUnits?.(); statistics?.loadPL?.(); }
    if (currentSection === 'operations')  { operations?.load?.(); }
    if (currentSection === 'guests')      { guestsCRM?.load?.(); }
    // El sidebar mini-calendar siempre se actualiza
    window._sidebarCal?.refresh().catch(() => {});
  }, delay);
}

function setupRealtime() {
  if (!AppContext.hotelId || isDemo()) return;
  if (_realtimeChannel) {
    supabase.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
  _realtimeChannel = supabase
    .channel('pms-main')
    .on('postgres_changes', { event:'*', schema:'public', table:'bookings',          filter:`hotel_id=eq.${AppContext.hotelId}` }, handleBookingChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'payments',          filter:`hotel_id=eq.${AppContext.hotelId}` }, handlePaymentChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'expenses',          filter:`hotel_id=eq.${AppContext.hotelId}` }, handleExpenseChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'cleaning_tasks',    filter:`hotel_id=eq.${AppContext.hotelId}` }, handleOperationsChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'maintenance_issues',filter:`hotel_id=eq.${AppContext.hotelId}` }, handleOperationsChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'reminders',         filter:`hotel_id=eq.${AppContext.hotelId}` }, handleReminderChange)
    .subscribe();
}

function handleBookingChange(payload) {
  const { eventType, new: newRecord, old: oldRecord } = payload;

  // Invalidar cache para que el próximo load traiga datos frescos
  cache.invalidate('bookings', 'reminders');

  // Emitir en el bus con información granular
  // NOTA: bridgeToDOM en event-bus.js ya propaga esto al DOM automáticamente.
  // NO llamar dispatchEvent acá o se arma un loop Bus→DOM→Bus→DOM→ stack overflow.
  Bus.emit(EVENTS.BOOKING_CHANGED, payload);

  // Actualización granular de la barra en el calendario
  if (newRecord?.id) {
    const bar = document.querySelector(`.bar[data-booking-id="${newRecord.id}"]`);

    if (eventType === 'INSERT') {
      // Nueva reserva → pulsar al cargar
      Bus.emit(EVENTS.CAL_PULSE_BAR, { bookingId: newRecord.id });
    }

    if (eventType === 'UPDATE' && bar) {
      // Pulso en la barra existente sin full-reload
      bar.classList.add('bar-realtime-pulse');
      setTimeout(() => bar?.classList.remove('bar-realtime-pulse'), 1600);

      // Si cambió el estado, actualizar color sin reload
      if (oldRecord?.status !== newRecord.status) {
        debouncedCalendarLoad(300);
      }
    }

    if (eventType === 'DELETE' && oldRecord?.id) {
      // Desvanecer la barra eliminada
      const delBar = document.querySelector(`.bar[data-booking-id="${oldRecord.id}"]`);
      if (delBar) {
        delBar.style.transition = 'opacity .3s, transform .3s';
        delBar.style.opacity = '0';
        delBar.style.transform = 'scaleY(0)';
        setTimeout(() => debouncedCalendarLoad(400), 350);
        return; // evitar el reload duplicado
      }
    }
  }

  if (newRecord?.status === 'paid' && oldRecord?.status !== 'paid') {
    document.dispatchEvent(new CustomEvent('booking:fullypaid'));
  }

  debouncedCalendarLoad(500);
}

function handlePaymentChange(payload) {
  document.dispatchEvent(new CustomEvent('payment:changed', { detail: payload }));
  if (currentSection === 'bookings')  bookingList?.load();
  if (currentSection === 'dashboard') dashboard?.load();
}

function handleExpenseChange(payload) {
  cache.invalidate('expenses');
  document.dispatchEvent(new CustomEvent('expense:changed', { detail: payload }));
  if (currentSection === 'operations') operations?.load?.();
  // statistics.loadExpenses() fue eliminado — gastos ahora viven en Operaciones
  if (currentSection === 'statistics' && statistics?._tab === 'pl') statistics?.loadPL?.();
}

function handleOperationsChange(payload) {
  cache.invalidate('cleaning_tasks', 'maintenance_issues');
  document.dispatchEvent(new CustomEvent('operations:changed', { detail: payload }));
  if (currentSection === 'operations') operations?.load?.();
  if (currentSection === 'dashboard')  dashboard?.load?.();
  updateOperationsBadge();
}

function handleReminderChange(payload) {
  cache.invalidate('reminders');
  document.dispatchEvent(new CustomEvent('reminder:changed', { detail: payload }));
  if (currentSection === 'reminders' || currentSection === 'operations') loadSection('operations');
  if (currentSection === 'dashboard') dashboard?.load?.();
}

// ══════════════════════════════════════════════════
// CONFETTI
// ══════════════════════════════════════════════════
export function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  canvas.style.display = 'block';
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const ctx    = canvas.getContext('2d');
  const colors = ['#6366F1','#34D399','#F59E0B','#FB7185','#8B5CF6','#06B6D4'];
  const parts  = Array.from({length:90}, () => ({
    x: Math.random()*canvas.width, y: -20 - Math.random()*120,
    vx:(Math.random()-.5)*5, vy:2.5+Math.random()*4,
    color:colors[Math.floor(Math.random()*colors.length)],
    size:5+Math.random()*7, rotation:Math.random()*360,
    rotSpeed:(Math.random()-.5)*12, opacity:1,
  }));
  let frame;
  const animate = () => {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    let alive = false;
    parts.forEach(p => {
      p.x+=p.vx; p.y+=p.vy; p.vy+=.12; p.rotation+=p.rotSpeed;
      if (p.y > canvas.height-40) p.opacity = Math.max(0, p.opacity-.04);
      if (p.y < canvas.height+30 && p.opacity > 0) {
        alive = true;
        ctx.save(); ctx.globalAlpha=p.opacity;
        ctx.translate(p.x,p.y); ctx.rotate(p.rotation*Math.PI/180);
        ctx.fillStyle=p.color; ctx.fillRect(-p.size/2,-p.size/4,p.size,p.size/2);
        ctx.restore();
      }
    });
    if (alive) frame = requestAnimationFrame(animate);
    else { canvas.style.display='none'; ctx.clearRect(0,0,canvas.width,canvas.height); }
  };
  frame = requestAnimationFrame(animate);
  setTimeout(() => { cancelAnimationFrame(frame); canvas.style.display='none'; }, 4500);
}

// ══════════════════════════════════════════════════
// COMMAND PALETTE
// ══════════════════════════════════════════════════
function setupGlobalShortcuts() {
  const noField = () => !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key==='k') { e.preventDefault(); toggleCommandPalette(); return; }
    // Ctrl+N → Nueva Reserva (paso 0: calculadora)
    if (mod && !e.shiftKey && e.key==='n' && noField()) {
      e.preventDefault(); document.getElementById('btn-new-booking')?.click(); return;
    }
    // Ctrl+F → Buscar huésped
    if (mod && !e.shiftKey && e.key==='f' && noField()) {
      e.preventDefault();
      navigateTo('guests').then(() => {
        // ID correcto: guests-search-input (en guests.js) o guest-search (en HTML estático)
        setTimeout(() => {
          const el = document.getElementById('guests-search-input')
                  ?? document.getElementById('guest-search');
          el?.focus();
          el?.select();
        }, 200);
      });
      return;
    }
    // Ctrl+D → Panel de hoy
    if (mod && !e.shiftKey && e.key==='d' && noField()) {
      e.preventDefault(); navigateTo('dashboard'); return;
    }
    // Ctrl+Shift+C → Calendario
    if (mod && e.shiftKey && (e.key==='C'||e.key==='c') && noField()) {
      e.preventDefault(); navigateTo('calendar'); return;
    }
    if (e.key === 'Escape') {
      if (!document.getElementById('cmd-overlay')?.classList.contains('hidden')) { closeCommandPalette(); return; }
      const dynamicModals = [...document.body.querySelectorAll('.modal-overlay')]
        .filter(m => !m.id && !m.classList.contains('hidden'));
      if (dynamicModals.length) { dynamicModals[dynamicModals.length - 1].remove(); return; }
      const MODAL_ORDER = ['overlay-whatsapp','overlay-guest-profile','overlay-season',
        'overlay-cancel-booking','overlay-calculator','overlay-detail',
        'overlay-booking','overlay-reminder','overlay-expense'];
      for (const id of MODAL_ORDER) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
      }
      return;
    }
    if ((e.key==='ArrowLeft'||e.key==='ArrowRight') && noField() &&
        !document.querySelector('.modal-overlay:not(.hidden)')) {
      if (currentSection==='calendar') {
        document.getElementById(e.key==='ArrowLeft'?'cal-prev':'cal-next')?.click();
        e.preventDefault();
      }
    }
  });
}

// ── Gestión centralizada de modales ──────────────────
// Asegura que siempre se pueda cerrar cualquier modal
function _ensureModalCleanup() {
  // El formulario de reserva no se cierra al tocar afuera: evita perder datos cargados.
  document.getElementById('overlay-booking')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      e.preventDefault();
    }
  });
}

function setupCommandPalette() {
  const overlay = document.getElementById('cmd-overlay');
  const input   = document.getElementById('cmd-input');
  if (!overlay || !input) return;
  overlay.addEventListener('click', (e) => { if (e.target===overlay) closeCommandPalette(); });
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t=setTimeout(()=>renderCommandResults(input.value.trim()),180); });
  input.addEventListener('keydown', (e) => {
    const items  = document.querySelectorAll('.cmd-item');
    const active = document.querySelector('.cmd-item.cmd-active');
    const idx    = active ? Array.from(items).indexOf(active) : -1;
    if (e.key==='ArrowDown') { e.preventDefault(); const n=items[idx+1]??items[0]; items.forEach(i=>i.classList.remove('cmd-active')); n?.classList.add('cmd-active'); n?.scrollIntoView({block:'nearest'}); }
    if (e.key==='ArrowUp')   { e.preventDefault(); const p=items[idx-1]??items[items.length-1]; items.forEach(i=>i.classList.remove('cmd-active')); p?.classList.add('cmd-active'); p?.scrollIntoView({block:'nearest'}); }
    if (e.key==='Enter')     { e.preventDefault(); (active??items[0])?.click(); }
  });
}
function toggleCommandPalette() { document.getElementById('cmd-overlay')?.classList.contains('hidden') ? openCommandPalette() : closeCommandPalette(); }
function openCommandPalette() { const o=document.getElementById('cmd-overlay'),i=document.getElementById('cmd-input'); o?.classList.remove('hidden'); i?.focus(); renderCommandResults(''); }
function closeCommandPalette() { document.getElementById('cmd-overlay')?.classList.add('hidden'); if(document.getElementById('cmd-input')) document.getElementById('cmd-input').value=''; }

async function renderCommandResults(query) {
  const container = document.getElementById('cmd-results');
  if (!container) return;
  const q = query.toLowerCase();
  const NAV = [
    {label:'Panel de Hoy',section:'dashboard',icon:'🏠'},
    {label:'Calendario',section:'calendar',icon:'📅'},
    {label:'Reservas',section:'bookings',icon:'📋'},
    ...(can('viewStats')||isDemo() ? [{label:'Estadísticas',section:'statistics',icon:'📊'}] : []),
    {label:'Huéspedes / CRM',section:'guests',icon:'👤'},
    {label:'Recordatorios',section:'reminders',icon:'🔔'},
    ...(can('viewAuditLog') ? [{label:'Auditoría',section:'audit',icon:'🔍'}] : []),
    ...(can('manageSeasonPricing') ? [{label:'Configuración',section:'config',icon:'⚙️'}] : []),
  ];
  const ACTIONS = [{label:'Nueva Reserva',action:'new-booking',icon:'➕',hint:'⌘N'}];
  const filteredNav = NAV.filter(i=>!q||i.label.toLowerCase().includes(q));
  const filteredAct = ACTIONS.filter(i=>!q||i.label.toLowerCase().includes(q));
  let bkResults = [];
  if (q.length>=2 && AppContext.hotelId && !isDemo()) {
    const {data} = await supabase.from('bookings').select('id,check_in,check_out,guests(first_name,last_name)').eq('hotel_id',AppContext.hotelId).neq('status','cancelled').or(`guests.first_name.ilike.%${q}%,guests.last_name.ilike.%${q}%`).limit(4);
    bkResults = data??[];
  }
  let html='';
  if (filteredAct.length) { html+=`<div class="cmd-section-label">Acciones</div>`; html+=filteredAct.map(a=>`<div class="cmd-item" data-action="${a.action}"><span class="cmd-item-icon">${a.icon}</span><span>${a.label}</span>${a.hint?`<span class="cmd-item-hint">${a.hint}</span>`:''}</div>`).join(''); }
  if (filteredNav.length) { html+=`<div class="cmd-section-label">Secciones</div>`; html+=filteredNav.map(n=>`<div class="cmd-item" data-section="${n.section}"><span class="cmd-item-icon">${n.icon}</span><span>Ir a ${n.label}</span></div>`).join(''); }
  if (bkResults.length) { html+=`<div class="cmd-section-label">Reservas</div>`; html+=bkResults.map(b=>`<div class="cmd-item" data-booking-id="${b.id}"><span class="cmd-item-icon">🛏️</span><span>${b.guests?.first_name??''} ${b.guests?.last_name??''}</span><span class="cmd-item-hint">${b.check_in}→${b.check_out}</span></div>`).join(''); }
  if (!html) html=`<div class="cmd-empty">Sin resultados para "<strong>${query}</strong>".</div>`;
  container.innerHTML=html;
  container.querySelectorAll('.cmd-item[data-section]').forEach(el=>el.addEventListener('click',()=>{closeCommandPalette();navigateTo(el.dataset.section);}));
  container.querySelectorAll('.cmd-item[data-action]').forEach(el=>el.addEventListener('click',()=>{closeCommandPalette();if(el.dataset.action==='new-booking')bookingForm?.open();}));
  container.querySelectorAll('.cmd-item[data-booking-id]').forEach(el=>el.addEventListener('click',async()=>{closeCommandPalette();await navigateTo('bookings');const {data:b}=await supabase.from('bookings').select('*,guests(*),booking_units(unit_id,units(name,sort_order,color,max_guests)),payments(*)').eq('id',el.dataset.bookingId).single();if(b)bookingForm?.openDetail(b);}));
}

// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════
// REMINDER BADGE + SECTION
// ══════════════════════════════════════════════════
export function updateReminderBadge(count) {
  const badge = document.getElementById('nav-badge-reminders');
  if (!badge) return;
  if (count > 0) { badge.textContent=count; badge.style.display='inline'; badge.classList.add('nav-badge-pulse'); }
  else { badge.style.display='none'; badge.classList.remove('nav-badge-pulse'); }
}

async function updateOperationsBadge() {
  const opsBadge = document.getElementById('nav-badge-operations');
  if (!opsBadge || !AppContext.hotelId) return;
  try {
    const today = toISODate(new Date());

    // cleaning_tasks — siempre existe
    let cleanCount = 0;
    try {
      const { count } = await supabase.from('cleaning_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('hotel_id', AppContext.hotelId)
        .eq('status', 'pending')
        .eq('scheduled_date', today);
      cleanCount = count ?? 0;
    } catch { /* tabla no disponible */ }

    // maintenance_issues — puede no existir o tener RLS sin configurar
    let maintCount = 0;
    try {
      const { count } = await supabase.from('maintenance_issues')
        .select('id', { count: 'exact', head: true })
        .eq('hotel_id', AppContext.hotelId)
        .neq('status', 'resolved');
      maintCount = count ?? 0;
    } catch { /* tabla no disponible o sin RLS */ }

    const n = cleanCount + maintCount;
    if (n > 0) {
      opsBadge.textContent   = n;
      opsBadge.style.display = 'inline';
      opsBadge.style.background = n >= 3 ? '#ef4444' : '#f59e0b';
    } else {
      opsBadge.style.display = 'none';
    }
  } catch { /* silencioso */ }
}

async function loadRemindersSection() {
  const container = document.getElementById('reminders-full-list');
  if (!container) return;

  container.innerHTML = '<div class="loading-state">Cargando...</div>';

  // ── Agregar botón "+ Nuevo" si no está ───────────────────────────
  const section = container.closest('#section-reminders') ?? container.parentElement;
  if (section && !document.getElementById('reminders-header-bar')) {
    const bar = document.createElement('div');
    bar.id = 'reminders-header-bar';
    bar.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:14px';
    bar.innerHTML = `<button class="btn btn-primary" id="btn-add-reminder-main">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Nuevo Recordatorio
    </button>`;
    section.insertBefore(bar, container);
    document.getElementById('btn-add-reminder-main')?.addEventListener('click', () => {
      // Reset modal to create mode
      const overlay = document.getElementById('overlay-reminder');
      const titleEl = overlay?.querySelector('.modal-title');
      if (titleEl) titleEl.textContent = 'Nuevo Recordatorio';
      document.getElementById('r-title')?.value && (document.getElementById('r-title').value = '');
      document.getElementById('r-date')?.value  && (document.getElementById('r-date').value  = toISODate(new Date()));
      document.getElementById('r-desc')?.value  && (document.getElementById('r-desc').value  = '');
      populateReminderUnitSelect();
      overlay?.classList.remove('hidden');
    });
  }

  const { data: reminders, error } = await supabase
    .from('reminders')
    .select('*, units(name)')
    .eq('hotel_id', AppContext.hotelId)
    .order('scheduled_date');

  if (error) {
    const msg = error.message?.includes('completed')
      ? 'Ejecutá <strong>migration_complete_v8.sql</strong> para añadir la columna <code>completed</code>.'
      : error.message ?? 'Error desconocido';
    container.innerHTML = `
      <div class="error-state" style="padding:32px;text-align:center">
        <div style="font-size:2rem;margin-bottom:12px">🗄️</div>
        <p style="font-weight:700">Error al cargar recordatorios</p>
        <p style="font-size:.82rem;color:var(--color-text-3);margin:6px auto 0;max-width:340px">${msg}</p>
      </div>`;
    return;
  }

  if (!reminders?.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon">🔔</span>
        <p>Sin recordatorios.</p>
        <p style="font-size:.78rem;color:var(--color-text-3)">
          Usá el botón "+ Nuevo Recordatorio" para crear uno.
        </p>
      </div>`;
    return;
  }

  const today = toISODate(new Date());
  container.innerHTML = reminders.map(r => {
    const isToday = r.scheduled_date === today;
    const isPast  = r.scheduled_date < today && !r.completed;
    const dotColor = r.completed ? '#94a3b8'
                   : isToday    ? '#f59e0b'
                   : isPast     ? '#ef4444'
                   :              'var(--color-primary)';
    const fmtD = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-AR', {weekday:'short',day:'numeric',month:'short'}) : '—';
    return `
      <div class="reminder-card ${r.completed ? 'reminder-done' : ''} ${isPast ? 'reminder-overdue' : ''}" data-id="${r.id}">
        <div class="reminder-dot" style="background:${dotColor}"></div>
        <div class="reminder-body">
          <div class="reminder-title ${r.completed ? 'line-through' : ''}">${r.title}</div>
          <div class="reminder-meta">
            📅 ${fmtD(r.scheduled_date)}
            ${r.units?.name ? ` · 🏠 ${r.units.name}` : ' · General'}
            ${r.description ? ` · ${r.description}` : ''}
          </div>
        </div>
        <div class="reminder-actions">
          <label class="reminder-check" title="${r.completed ? 'Marcar pendiente' : 'Marcar completado'}">
            <input type="checkbox" ${r.completed ? 'checked' : ''} onchange="window.toggleReminder('${r.id}',this.checked)">
            <span class="reminder-check-icon">${r.completed ? '✅' : '⬜'}</span>
          </label>
          <button class="btn btn-ghost btn-xs reminder-edit-btn" data-id="${r.id}"
                  data-title="${r.title.replace(/"/g,'&quot;')}"
                  data-date="${r.scheduled_date}"
                  data-desc="${(r.description ?? '').replace(/"/g,'&quot;')}"
                  data-unit="${r.unit_id ?? ''}"
                  title="Editar">✏️</button>
          <button class="btn btn-ghost btn-xs reminder-del-btn" data-id="${r.id}" title="Eliminar">🗑️</button>
        </div>
      </div>`;
  }).join('');

  // ── Event delegation — data-bound para no duplicar listener ──
  if (!container.dataset.reminderBound) {
    container.dataset.reminderBound = '1';
    container.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('.reminder-edit-btn');
      const delBtn  = e.target.closest('.reminder-del-btn');
      const checkLbl = e.target.closest('.reminder-check');

      if (editBtn) {
        const { id } = editBtn.dataset;
        const titleEl = document.getElementById('r-title');
        const dateEl  = document.getElementById('r-date');
        const descEl  = document.getElementById('r-desc');
        const unitEl  = document.getElementById('r-unit');
        if (titleEl) titleEl.value = editBtn.dataset.title;
        if (dateEl)  dateEl.value  = editBtn.dataset.date;
        if (descEl)  descEl.value  = editBtn.dataset.desc;
        populateReminderUnitSelect();
        setTimeout(() => { if (unitEl) unitEl.value = editBtn.dataset.unit; }, 60);

        const overlay    = document.getElementById('overlay-reminder');
        const saveBtn    = document.getElementById('reminder-save');
        const modalTitle = overlay?.querySelector('.modal-title');
        if (modalTitle) modalTitle.textContent = 'Editar Recordatorio';
        overlay?.classList.remove('hidden');

        const handleSave = async () => {
          const title = titleEl?.value.trim();
          const date  = dateEl?.value;
          if (!title || !date) { showToast('Título y fecha obligatorios', 'warning'); return; }
          const { error } = await supabase.from('reminders')
            .update({ title, description: descEl?.value.trim() || null, scheduled_date: date, unit_id: unitEl?.value || null })
            .eq('id', id);
          if (error) { showToast('Error: ' + error.message, 'error'); return; }
          showToast('Recordatorio actualizado ✓', 'success');
          overlay?.classList.add('hidden');
          if (modalTitle) modalTitle.textContent = 'Nuevo Recordatorio';
          saveBtn?.removeEventListener('click', handleSave);
          container.dataset.reminderBound = ''; // reset so listener re-attaches
          await loadRemindersSection();
        };
        saveBtn?.removeEventListener('click', window._reminderSaveHandler);
        saveBtn?.addEventListener('click', handleSave);
        window._reminderSaveHandler = handleSave;
      }

      if (delBtn && !delBtn.disabled) {
        if (!confirm('¿Eliminar este recordatorio?')) return;
        delBtn.disabled = true;
        const { error } = await supabase.from('reminders').delete().eq('id', delBtn.dataset.id);
        if (error) { showToast('Error: ' + error.message, 'error'); delBtn.disabled = false; return; }
        showToast('Eliminado', 'success');
        container.dataset.reminderBound = '';
        await loadRemindersSection();
      }
    });
  }

  updateReminderBadge(reminders.filter(r => !r.completed && r.scheduled_date <= today).length);
}

window.toggleReminder = async (id, completed) => {
  const { error } = await supabase.from('reminders').update({ completed }).eq('id', id);
  if (error) { showToast('Error: ' + error.message,'error'); return; }
  const card = document.querySelector(`.reminder-card[data-id="${id}"]`);
  if (card) {
    card.classList.toggle('reminder-done', completed);
    const title = card.querySelector('.reminder-title');
    if (title) title.classList.toggle('line-through', completed);
    const icon = card.querySelector('.reminder-check-icon');
    if (icon) icon.textContent = completed ? '✅' : '⬜';
  }
  const remaining = document.querySelectorAll('.reminder-card:not(.reminder-done)').length;
  updateReminderBadge(remaining);
  document.dispatchEvent(new CustomEvent('reminders:badge', { detail: { count: remaining } }));
};

// ══════════════════════════════════════════════════
// MODALES (reminders, expenses, guest profile, season)
// ══════════════════════════════════════════════════
function setupReminderModal() {
  const open=()=>{
    // Reset form
    const titleEl = document.getElementById('r-title');
    const dateEl  = document.getElementById('r-date');
    const descEl  = document.getElementById('r-desc');
    if (titleEl) titleEl.value = '';
    if (descEl)  descEl.value  = '';
    if (dateEl)  dateEl.value  = localToday();
    populateReminderUnitSelect();
    document.getElementById('overlay-reminder').classList.remove('hidden');
    // Focus the title field for better UX
    setTimeout(() => titleEl?.focus(), 100);
  };
  const close=()=>document.getElementById('overlay-reminder').classList.add('hidden');
  document.getElementById('btn-add-reminder')?.addEventListener('click',open);
  document.getElementById('btn-add-reminder-main')?.addEventListener('click',open);
  document.getElementById('reminder-close')?.addEventListener('click',close);
  document.getElementById('reminder-cancel')?.addEventListener('click',close);
  document.getElementById('overlay-reminder').addEventListener('click',(e)=>{if(e.target===e.currentTarget)close();});
  document.getElementById('reminder-save')?.addEventListener('click',async()=>{
    const title=document.getElementById('r-title').value.trim(),date=document.getElementById('r-date').value;
    if(!title||!date){showToast('Título y fecha obligatorios','warning');return;}
    if(isDemo()){showDemoAction(null);close();return;}
    const{error}=await supabase.from('reminders').insert({hotel_id:AppContext.hotelId,title,description:document.getElementById('r-desc').value.trim()||null,scheduled_date:date,unit_id:document.getElementById('r-unit').value||null});
    if(error){showToast('Error al guardar','error');return;}
    showToast('Recordatorio guardado ✓','success');close();
    ['r-title','r-desc','r-date'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    if(currentSection==='reminders')await loadRemindersSection();
    if(currentSection==='dashboard')await dashboard?.load();
  });
}
function populateReminderUnitSelect(){
  const container = document.getElementById('r-unit-container');
  const sel = document.getElementById('r-unit');
  if (!sel) return;

  const units = AppContext.units ?? [];

  // Reset
  sel.innerHTML = '<option value="">General (todo el hotel)</option>';

  if (!units.length) {
    // Units might still be loading — show a placeholder
    const opt = document.createElement('option');
    opt.value = ''; opt.disabled = true;
    opt.textContent = '(Cargando unidades...)';
    sel.appendChild(opt);
    // Retry once in 1 second
    setTimeout(() => {
      const retryUnits = AppContext.units ?? [];
      sel.innerHTML = '<option value="">General (todo el hotel)</option>';
      retryUnits.forEach(u => {
        const o = document.createElement('option');
        o.value = u.id;
        o.textContent = `#${u.sort_order ?? ''} · ${u.name}`;
        sel.appendChild(o);
      });
    }, 1000);
    return;
  }

  units.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = `#${u.sort_order ?? ''} · ${u.name}`;
    sel.appendChild(opt);
  });
}

function setupExpenseModal() {
  const close=()=>document.getElementById('overlay-expense').classList.add('hidden');
  document.getElementById('expense-close')?.addEventListener('click',close);
  document.getElementById('expense-cancel')?.addEventListener('click',close);
  document.getElementById('overlay-expense')?.addEventListener('click',(e)=>{if(e.target===e.currentTarget)close();});
  document.getElementById('expense-save')?.addEventListener('click',async()=>{
    if(!can('manageExpenses')){showToast('🔒 Sin permiso','warning');return;}
    if(isDemo()){showDemoAction(null);close();return;}
    const editingId=document.getElementById('expense-editing-id').value;
    const desc=document.getElementById('expense-desc').value.trim(),amount=parseFloat(document.getElementById('expense-amount').value);
    if(!desc||isNaN(amount)||amount<=0){showToast('Descripción y monto obligatorios','warning');return;}
    const payload={hotel_id:AppContext.hotelId,category:document.getElementById('expense-category').value,description:desc,amount,due_date:document.getElementById('expense-due').value||null};
    const{error}=editingId?await supabase.from('expenses').update(payload).eq('id',editingId):await supabase.from('expenses').insert(payload);
    if(error){showToast('Error al guardar','error');return;}
    showToast(editingId?'Gasto actualizado ✓':'Gasto registrado ✓','success');close();
    document.getElementById('expense-editing-id').value='';
    if(currentSection==='statistics')statistics?.loadExpenses?.();
  });
}

// ── WhatsApp Manager Template Modal ──────────────────
function setupWhatsAppModal() {
  const close = () => document.getElementById('overlay-whatsapp')?.classList.add('hidden');
  document.getElementById('wa-modal-close')?.addEventListener('click', close);
  document.getElementById('wa-close-btn')?.addEventListener('click', close);
  document.getElementById('overlay-whatsapp')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });
  document.getElementById('wa-copy-btn')?.addEventListener('click', () => {
    const ta = document.getElementById('wa-template-text');
    if (!ta) return;
    ta.select();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(ta.value).then(() => {
        const btn = document.getElementById('wa-copy-btn');
        if (btn) { btn.textContent = '✓ Copiado!'; setTimeout(() => btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copiar', 2000); }
        showToast('Texto copiado al portapapeles ✓', 'success');
      });
    } else {
      document.execCommand('copy');
      showToast('Texto copiado ✓', 'success');
    }
  });
}

function setupGuestProfileModal() {
  const close=()=>document.getElementById('overlay-guest-profile')?.classList.add('hidden');
  document.getElementById('guest-profile-close')?.addEventListener('click',close);
  document.getElementById('overlay-guest-profile')?.addEventListener('click',(e)=>{if(e.target===e.currentTarget)close();});
  document.getElementById('guest-new-booking-btn')?.addEventListener('click',()=>{close();bookingForm?.open();});
}

// Season pricing modal setup
document.getElementById('season-save')?.addEventListener('click', async () => {
  if (!can('manageSeasonPricing')) { showToast('🔒 Sin permiso', 'warning'); return; }
  const name  = document.getElementById('season-name').value.trim();
  const start = document.getElementById('season-start').value;
  const end   = document.getElementById('season-end').value;
  const price = parseFloat(document.getElementById('season-price').value);
  const unit  = document.getElementById('season-unit').value;
  if (!name || !start || !end || isNaN(price)) { showToast('Completá todos los campos', 'warning'); return; }
  const { error } = await supabase.from('season_pricing').insert({
    hotel_id: AppContext.hotelId, name, start_date: start, end_date: end,
    price_per_night: price, unit_id: unit || null,
  });
  if (error) { showToast('Error al guardar', 'error'); return; }
  showToast('Tarifa de temporada creada ✓', 'success');
  document.getElementById('overlay-season')?.classList.add('hidden');
  loadSeasonPricing();
});
document.getElementById('season-cancel')?.addEventListener('click', () => document.getElementById('overlay-season')?.classList.add('hidden'));
document.getElementById('season-close')?.addEventListener('click',  () => document.getElementById('overlay-season')?.classList.add('hidden'));

// ══════════════════════════════════════════════════
// INDICADOR DE CONECTIVIDAD (Realtime + Online)
// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════
// SONIDO
// ══════════════════════════════════════════════════
function setupSoundButton() {
  const btn     = document.getElementById('btn-sound');
  const iconOn  = document.getElementById('sound-icon-on');
  const iconOff = document.getElementById('sound-icon-off');
  if (!btn) return;

  const updateIcon = (muted) => {
    if (iconOn)  iconOn.style.display  = muted ? 'none' : '';
    if (iconOff) iconOff.style.display = muted ? ''     : 'none';
    btn.title = muted ? 'Sonidos silenciados — clic para activar' : 'Sonidos activos — clic para silenciar';
    btn.classList.toggle('icon-muted', muted);
  };

  updateIcon(Sound.muted);
  btn.addEventListener('click', () => {
    const muted = Sound.toggleMute();
    updateIcon(muted);
    if (!muted) setTimeout(() => Sound.success(), 80);
  });

  // Sonido en apertura/cierre de modales dinámicos (body children)
  const observer = new MutationObserver((muts) => {
    muts.forEach(m => {
      m.addedNodes.forEach(n => { if (n.classList?.contains('modal-overlay')) Sound?.modalOpen(); });
      m.removedNodes.forEach(n => { if (n.classList?.contains('modal-overlay')) Sound?.modalClose(); });
    });
  });
  observer.observe(document.body, { childList: true });

  // Sonido en modales estáticos (overlay-booking, overlay-detail, etc.)
  document.querySelectorAll('.modal-overlay').forEach(el => {
    new MutationObserver(() => {
      const isOpen = !el.classList.contains('hidden');
      if (isOpen) Sound?.modalOpen(); else Sound?.modalClose();
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
  });
}

// ══════════════════════════════════════════════════
// TEMAS DE COLOR
// ══════════════════════════════════════════════════
const THEMES = {
  // ── Orden cromático: rojo · verde · azul · azul oscuro (MILA oficial) · violeta · rosa ──
  red:    { primary:'#DC2626', primaryH:'#B91C1C', primaryL:'#FEE2E2', primaryT:'rgba(220,38,38,.12)',    sidebarBg:'#3B0A0A', sidebarActive:'#7F1D1D', sidebarAccent:'#FCA5A5' },
  green:  { primary:'#16A34A', primaryH:'#15803D', primaryL:'#DCFCE7', primaryT:'rgba(22,163,74,.12)',    sidebarBg:'#052E16', sidebarActive:'#14532D', sidebarAccent:'#86EFAC' },
  blue:   { primary:'#1E4DB7', primaryH:'#1A3A90', primaryL:'#DDEAFF', primaryT:'rgba(30,77,183,.12)',    sidebarBg:'#0D1F42', sidebarActive:'#1A3472', sidebarAccent:'#60A5FA' },
  navy:   { primary:'#1A3A90', primaryH:'#0D2A6E', primaryL:'#DDEAFF', primaryT:'rgba(26,58,144,.12)',    sidebarBg:'#050F24', sidebarActive:'#0D1F42', sidebarAccent:'#60A5FA' },
  violet: { primary:'#7C3AED', primaryH:'#6D28D9', primaryL:'#EDE9FE', primaryT:'rgba(124,58,237,.12)',   sidebarBg:'#1A0B35', sidebarActive:'#2E1065', sidebarAccent:'#C4B5FD' },
  rose:   { primary:'#DB2777', primaryH:'#BE185D', primaryL:'#FCE7F3', primaryT:'rgba(219,39,119,.12)',   sidebarBg:'#350B1F', sidebarActive:'#6B1A3B', sidebarAccent:'#FBCFE8' },
};

function setupThemeSystem() {
  const btn = document.getElementById('btn-theme');
  if (!btn) { console.warn('[Theme] btn-theme not found'); return; }

  const panel = document.getElementById('theme-panel');
  if (panel && panel.parentElement !== document.body) {
    document.body.appendChild(panel);
  }

  // Apply saved theme immediately
  const saved = localStorage.getItem('mila_theme') ?? 'navy';
  applyTheme(saved);
  markActiveSwatch(saved);

  // Apply saved dark mode
  const savedMode = localStorage.getItem('pms-theme') ?? 'light';
  applyDarkMode(savedMode);
  _updateModeButtons(savedMode);

  // Expose globally for inline onclick
  window._setDarkMode = (mode) => {
    applyDarkMode(mode);
    _updateModeButtons(mode);
  };

  function _updateModeButtons(mode) {
    const lightBtn = document.getElementById('theme-mode-light');
    const darkBtn  = document.getElementById('theme-mode-dark');
    if (!lightBtn || !darkBtn) return;
    const active = 'border-color:var(--color-primary);background:var(--color-primary-l);color:var(--color-primary)';
    const inactive= 'border-color:var(--color-border);background:var(--color-surface-2);color:var(--color-text-2)';
    lightBtn.style.cssText = lightBtn.style.cssText.replace(/border-color:[^;]+;background:[^;]+;color:[^;]+/, '') + (mode === 'light' ? active : inactive);
    darkBtn.style.cssText  = darkBtn.style.cssText.replace(/border-color:[^;]+;background:[^;]+;color:[^;]+/, '')  + (mode === 'dark'  ? active : inactive);
  }

  let open = false;

  const show = () => {
    if (!panel) return;
    const rect = btn.getBoundingClientRect();
    panel.style.top    = `${rect.bottom + 8}px`;
    panel.style.right  = `${window.innerWidth - rect.right}px`;
    panel.style.left   = 'auto';
    panel.style.display = 'block';
    open = true;
  };

  const hide = () => {
    if (panel) panel.style.display = 'none';
    open = false;
  };

  hide();

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    open ? hide() : show();
  });

  document.addEventListener('click', (e) => {
    if (open && e.target !== btn && !e.target.closest('#theme-panel')) hide();
  });

  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = sw.dataset.theme;
      if (!t) return;
      applyTheme(t);
      markActiveSwatch(t);
      localStorage.setItem('mila_theme', t);
      hide();
      Sound?.success?.();
    });
  });

  // Mode buttons (Día / Noche) — stopPropagation so panel doesn't close
  document.getElementById('theme-mode-light')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window._setDarkMode('light');
  });
  document.getElementById('theme-mode-dark')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window._setDarkMode('dark');
  });

  // ── Pantalla completa ──────────────────────────────────────
  const fsBtn      = document.getElementById('btn-fullscreen');
  const fsExpand   = document.getElementById('fs-icon-expand');
  const fsCompress = document.getElementById('fs-icon-compress');
  const fsLabel    = document.getElementById('fs-label');

  const _syncFsIcon = () => {
    const isFs = !!document.fullscreenElement;
    if (fsExpand)   fsExpand.style.display   = isFs ? 'none' : '';
    if (fsCompress) fsCompress.style.display = isFs ? ''     : 'none';
    if (fsLabel)    fsLabel.textContent = isFs ? 'Salir de pantalla completa' : 'Pantalla completa';
    if (fsBtn) {
      const active = 'border-color:var(--color-primary);background:var(--color-primary-l);color:var(--color-primary)';
      const reset  = 'border-color:var(--color-border);background:var(--color-surface-2);color:var(--color-text-2)';
      fsBtn.style.cssText = fsBtn.style.cssText.replace(/border-color:[^;]+;background:[^;]+;color:[^;]+/, '') + (isFs ? active : reset);
    }
  };

  fsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  });

  document.addEventListener('fullscreenchange', _syncFsIcon);
  _syncFsIcon(); // estado inicial
}

function applyTheme(name) {
  const t = THEMES[name] ?? THEMES.blue;
  const r = document.documentElement.style;
  r.setProperty('--color-primary',   t.primary);
  r.setProperty('--color-primary-h', t.primaryH);
  r.setProperty('--color-primary-l', t.primaryL);
  r.setProperty('--color-primary-t', t.primaryT);
  r.setProperty('--sidebar-bg',      t.sidebarBg);
  r.setProperty('--sidebar-active',  t.sidebarActive);
  r.setProperty('--sidebar-accent',  t.sidebarAccent);
  document.body.dataset.colorTheme = name;
}
function markActiveSwatch(name) {
  document.querySelectorAll('.theme-swatch').forEach(sw => {
    const isActive = sw.dataset.theme === name;
    sw.classList.toggle('active', isActive);
    sw.style.border = isActive ? '3px solid white' : '3px solid transparent';
    sw.style.boxShadow = isActive ? `0 0 0 2px ${sw.style.background}` : 'none';
    sw.style.transform = isActive ? 'scale(1.1)' : '';
  });
}

// ══════════════════════════════════════════════════
// NOTIFICACIONES REALES
// ══════════════════════════════════════════════════
async function setupRealNotifications(notifSvc) {
  let _firstLoad = true;
  let _prevHighIds = new Set();
  const refresh = async () => {
    const notifs = await notifSvc.refresh();
    const count  = notifs.length;
    const badge  = document.getElementById('notif-badge');
    const list   = document.getElementById('notif-list');

    if (badge) {
      badge.style.display = count > 0 ? '' : 'none';
      badge.textContent   = count > 9 ? '9+' : String(count);
      badge.style.background = notifs.some(n => n.priority === 'high') ? '#ef4444' : '#f97316';
    }
    if (list) {
      list.innerHTML = count ? notifs.map(n => `
        <div class="notif-item notif-${n.priority}" data-booking-id="${n.bookingId ?? ''}">
          <span class="notif-item-icon">${n.icon}</span>
          <div class="notif-item-body">
            <div class="notif-item-title">${n.title}</div>
            <div class="notif-item-sub">${n.body}</div>
          </div>
          ${n.action ? `<button class="notif-action-btn btn btn-primary btn-xs"
              data-booking-id="${n.bookingId}" data-action="${n.action}">
              ${n.action === 'checkin' ? '✅ CI' : '👋 CO'}
            </button>` : ''}
        </div>`).join('')
        : `<p class="empty-state-sm" style="padding:20px">Sin notificaciones pendientes ✓</p>`;

      list.querySelectorAll('.notif-action-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const bId = btn.dataset.bookingId;
          try {
            if (btn.dataset.action === 'checkin')  { await markCheckIn(bId);  Sound?.checkIn(); }
            if (btn.dataset.action === 'checkout') { await markCheckOut(bId); Sound?.checkOut(); }
            btn.textContent = '✓'; btn.disabled = true;
            setTimeout(refresh, 600);
          } catch (err) { showToast('Error: ' + err.message, 'error'); }
        });
      });
    }
    // Alerta sonora solo si aparecen notificaciones urgentes NUEVAS (no en el load inicial)
    if (!_firstLoad) {
      const highIds = new Set(notifs.filter(n => n.priority === 'high').map(n => n.bookingId ?? n.title));
      const hasNew  = [...highIds].some(id => !_prevHighIds.has(id));
      if (hasNew) Sound?.alert();
      _prevHighIds = highIds;
    } else {
      _prevHighIds = new Set(notifs.filter(n => n.priority === 'high').map(n => n.bookingId ?? n.title));
      _firstLoad = false;
    }
  };

  await refresh();
  setInterval(refresh, 5 * 60 * 1000);
  document.addEventListener('booking:changed', () => setTimeout(refresh, 1200));
}

// ══════════════════════════════════════════════════════
// DISPONIBILIDAD MOBILE — panel standalone (bottom sheet)
// ══════════════════════════════════════════════════════
function openMobileAvailPanel() {
  const existing = document.getElementById('mobile-avail-overlay');
  if (existing) { existing.remove(); return; }

  const today    = new Date();
  const fmtDate  = d => d.toISOString().split('T')[0];
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

  // Obtener unidades del contexto (AppContext importado en este módulo)
  const units = AppContext?.units ?? [];

  const overlay = document.createElement('div');
  overlay.id = 'mobile-avail-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:2000;
    background:rgba(0,0,0,.45);
    display:flex;align-items:flex-end;
  `;

  overlay.innerHTML = `
    <div id="mobile-avail-sheet" style="
      width:100%;max-height:85dvh;overflow-y:auto;
      background:var(--color-surface);
      border-radius:20px 20px 0 0;
      padding:0 0 env(safe-area-inset-bottom,12px);
      box-shadow:0 -8px 32px rgba(0,0,0,.18);
      animation:slideUpSheet .22s cubic-bezier(.34,1.2,.64,1);
    ">
      <!-- Handle -->
      <div style="display:flex;justify-content:center;padding:10px 0 4px">
        <div style="width:36px;height:4px;border-radius:2px;background:var(--color-border-2)"></div>
      </div>
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 20px 14px">
        <span style="font-size:1rem;font-weight:700;color:var(--color-text)">🔍 Disponibilidad</span>
        <button id="mobile-avail-close" style="border:none;background:none;font-size:1.3rem;color:var(--color-text-3);cursor:pointer;padding:4px 8px">✕</button>
      </div>
      <!-- Inputs -->
      <div style="padding:0 16px 16px;display:flex;flex-direction:column;gap:12px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:.72rem;font-weight:600;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:5px">Check-in</label>
            <input type="date" id="mavail-checkin" value="${fmtDate(today)}"
              style="width:100%;border:1px solid var(--color-border);border-radius:10px;padding:10px 12px;font-size:15px;background:var(--color-surface-2);color:var(--color-text);box-sizing:border-box">
          </div>
          <div>
            <label style="font-size:.72rem;font-weight:600;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:5px">Check-out</label>
            <input type="date" id="mavail-checkout" value="${fmtDate(tomorrow)}"
              style="width:100%;border:1px solid var(--color-border);border-radius:10px;padding:10px 12px;font-size:15px;background:var(--color-surface-2);color:var(--color-text);box-sizing:border-box">
          </div>
        </div>
        <div>
          <label style="font-size:.72rem;font-weight:600;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:5px">Personas</label>
          <input type="number" id="mavail-guests" min="1" max="20" value="2"
            style="width:100%;border:1px solid var(--color-border);border-radius:10px;padding:10px 12px;font-size:15px;background:var(--color-surface-2);color:var(--color-text);box-sizing:border-box">
        </div>
        <button id="mavail-search-btn"
          style="width:100%;padding:13px;border-radius:12px;border:none;background:var(--color-primary);color:#fff;font-size:.9rem;font-weight:700;cursor:pointer;letter-spacing:.02em">
          Ver disponibilidad
        </button>
        <!-- Resultados -->
        <div id="mavail-results" style="display:none"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#mobile-avail-close').addEventListener('click', close);

  const doSearch = async () => {
    const ci      = document.getElementById('mavail-checkin')?.value;
    const co      = document.getElementById('mavail-checkout')?.value;
    const guests  = parseInt(document.getElementById('mavail-guests')?.value ?? '2', 10);
    const results = document.getElementById('mavail-results');
    const btn     = document.getElementById('mavail-search-btn');
    if (!results) return;

    if (!ci || !co || ci >= co) {
      results.style.display = 'block';
      results.innerHTML = '<div style="color:#ef4444;font-size:.85rem;padding:10px 0">⚠️ Check-out debe ser posterior al check-in.</div>';
      return;
    }

    // Loading
    results.style.display = 'block';
    results.innerHTML = '<div style="text-align:center;padding:16px;color:var(--color-text-3);font-size:.85rem">Buscando...</div>';
    if (btn) { btn.disabled = true; btn.textContent = 'Buscando...'; }

    try {
      // Query directo a Supabase — no depende del calendario cargado
      const hotelId = AppContext.hotelId;
      let bookings = [];
      if (hotelId) {
        const { data } = await supabase
          .from('bookings')
          .select('id,check_in,check_out,status,booking_units(unit_id)')
          .eq('hotel_id', hotelId)
          .neq('status', 'cancelled')
          .lte('check_in', co)
          .gt('check_out', ci);
        bookings = data ?? [];
      } else {
        bookings = window._calInstance?._lastRenderedBookings ?? [];
      }

      const occupiedIds = new Set();
      bookings.forEach(b => {
        if (b.status === 'cancelled') return;
        if (b.check_in < co && b.check_out > ci) {
          (b.booking_units ?? []).forEach(bu => occupiedIds.add(bu.unit_id));
        }
      });

      const available = units.filter(u => !occupiedIds.has(u.id) && (u.max_guests ?? 0) >= guests);
      const occupied  = units.filter(u => occupiedIds.has(u.id));
      const tooSmall  = units.filter(u => !occupiedIds.has(u.id) && (u.max_guests ?? 0) < guests);

      const fmt    = s => s.split('-').reverse().join('/');
      const nights = Math.round((new Date(co) - new Date(ci)) / 86400000);

      const unitCard = (u, state) => {
        const color  = u.color ?? 'var(--color-primary)';
        const lbl    = { ok: '', occupied: '✕ Ocupado', small: 'Max ' + u.max_guests + ' pers.' };
        const bg     = { ok: color + '18', occupied: '#fee2e2', small: '#f3f4f6' };
        const brd    = { ok: color + '55', occupied: '#fca5a5', small: '#d1d5db' };
        const clr    = { ok: 'var(--color-text)', occupied: '#ef4444', small: '#9ca3af' };
        return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:' + bg[state] + ';border:1px solid ' + brd[state] + ';opacity:' + (state === 'ok' ? 1 : .65) + '">'
          + '<span style="width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0"></span>'
          + '<span style="flex:1;font-size:.84rem;font-weight:600;color:' + clr[state] + '">' + u.name + '</span>'
          + '<span style="font-size:.72rem;color:' + clr[state] + '">' + lbl[state] + '</span>'
          + '</div>';
      };

      if (!available.length) {
        results.innerHTML = '<div style="text-align:center;padding:16px 0;color:#ef4444;font-weight:600">😔 Sin disponibilidad para ' + guests + ' personas</div>'
          + '<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">'
          + occupied.map(u => unitCard(u,'occupied')).join('')
          + tooSmall.map(u => unitCard(u,'small')).join('')
          + '</div>';
      } else {
        results.innerHTML = '<div style="padding:10px 0 12px;color:#16a34a;font-weight:700;font-size:.9rem">✅ ' + available.length + ' disponible' + (available.length !== 1 ? 's' : '') + ' · ' + fmt(ci) + ' → ' + fmt(co) + ' · ' + nights + ' noche' + (nights !== 1 ? 's' : '') + '</div>'
          + '<div style="display:flex;flex-direction:column;gap:6px">'
          + available.map(u => unitCard(u,'ok')).join('')
          + occupied.map(u => unitCard(u,'occupied')).join('')
          + tooSmall.map(u => unitCard(u,'small')).join('')
          + '</div>';
      }
    } catch(err) {
      results.innerHTML = '<div style="color:#ef4444;font-size:.82rem;padding:8px 0">❌ Error: ' + err.message + '</div>';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Ver disponibilidad'; }
    }
  };

  document.getElementById('mavail-search-btn').addEventListener('click', doSearch);
  ['mavail-checkin','mavail-checkout','mavail-guests'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  });
  document.getElementById('mavail-checkin').focus();
}

function setupCalculator() {
  const overlay = document.getElementById('overlay-calculator');
  if (!overlay) return;

  const btn = document.getElementById('btn-calculator');

  // Toggle highlight on btn when open
  const setOpen = (open) => {
    if (open) {
      overlay.style.display = 'flex';
      overlay.classList.remove('hidden');   // el handler global de ESC agrega 'hidden' — siempre limpiar
      btn?.classList.add('calc-active');
      _calcUpdate();
      document.getElementById('calc-price')?.focus();
    } else {
      overlay.style.display = 'none';
      overlay.classList.remove('hidden');   // consistencia: solo usamos style.display
      btn?.classList.remove('calc-active');
    }
  };

  // Insert mode tabs into calc header
  const calcHeader = overlay.querySelector('.calc-header');
  if (calcHeader && !calcHeader.querySelector('.calc-mode-tabs')) {
    const tabs = document.createElement('div');
    tabs.className = 'calc-mode-tabs';
    tabs.innerHTML = `
      <button class="calc-tab active" data-mode="stay">📅 Estadía</button>
      <button class="calc-tab" data-mode="normal">🔢 Normal</button>`;
    calcHeader.appendChild(tabs);

    const stayBody   = overlay.querySelector('.calc-body');
    const normalBody = document.createElement('div');
    normalBody.className = 'calc-body calc-normal-body';
    normalBody.style.display = 'none';
    normalBody.innerHTML = `
      <div id="calc-norm-display" style="font-size:1.6rem;font-weight:700;text-align:right;
        padding:10px 12px;background:var(--color-surface-2);border-radius:var(--r-md);
        border:1px solid var(--color-border);min-height:52px;word-break:break-all;color:var(--color-text)">0</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px">
        ${['C','±','%','÷','7','8','9','×','4','5','6','−','1','2','3','+','0','.','='].map(k => `<button class="calc-norm-btn${k==='='?' calc-norm-eq':k==='0'?' calc-norm-zero':''}"
          data-key="${k}" style="${k==='='?'background:var(--color-primary);color:white;':''}">${k||''}</button>`).join('')}
      </div>`;
    stayBody.parentNode.insertBefore(normalBody, stayBody.nextSibling);

    // Bind normal calculator
    let _normExpr = '', _normDisplay = '0', _normHasResult = false;
    const normDisp = () => {
      const el = document.getElementById('calc-norm-display');
      if (el) el.textContent = _normDisplay;
    };
    normalBody.querySelectorAll('.calc-norm-btn').forEach(b => {
      b.addEventListener('click', () => {
        const k = b.dataset.key;
        if (!k) return;
        if (k === 'C') { _normExpr = ''; _normDisplay = '0'; _normHasResult = false; }
        else if (k === '=') {
          try {
            const safe = _normExpr.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');
            if (!/^[\d+\-*/%.()\s]+$/.test(safe)) throw new Error('Invalid expression');
            const result = Function(`"use strict"; return (${safe})`)();
            if (!Number.isFinite(result)) throw new Error('Invalid result');
            _normDisplay = String(parseFloat(result.toFixed(10)));
            _normExpr = _normDisplay;
            _normHasResult = true;
          } catch { _normDisplay = 'Error'; _normExpr = ''; }
        } else if (k === '±') {
          _normDisplay = _normDisplay.startsWith('-') ? _normDisplay.slice(1) : '-' + _normDisplay;
          _normExpr = _normDisplay;
        } else if (k === '%') {
          const v = parseFloat(_normDisplay) / 100;
          _normDisplay = String(v);
          _normExpr = _normDisplay;
        } else {
          if (_normHasResult && !/[+\-×÷]/.test(k)) { _normExpr = ''; _normDisplay = '0'; }
          _normHasResult = false;
          if (k === '.' && _normDisplay.includes('.')) return;
          if (['+','-','×','÷'].includes(k)) {
            _normExpr = _normExpr || _normDisplay;
            _normDisplay = k;
            _normExpr += k;
          } else {
            if (_normDisplay === '0' || ['+','-','×','÷'].includes(_normDisplay)) _normDisplay = '';
            _normDisplay += k;
            const hasOp = /[+\-×÷]/.test(_normExpr);
            if (hasOp) {
              _normExpr = _normExpr.replace(/[0-9.]+$/, '') + _normDisplay;
            } else {
              _normExpr = _normDisplay;
            }
          }
        }
        normDisp();
      });
    });

    // ── Teclado para calculadora normal ──────────────
    document.addEventListener('keydown', function calcKB(e) {
      if (overlay.style.display !== 'flex') return;
      if (normalBody.style.display === 'none') return;
      const MAP = {
        '0':'0','1':'1','2':'2','3':'3','4':'4',
        '5':'5','6':'6','7':'7','8':'8','9':'9',
        '.':'.', ',':'.', 'Enter':'=', '=':'=',
        '+':'+', '-':'-', '*':'×', '/':'÷', '%':'%',
      };
      if (e.key === 'Escape') { setOpen(false); e.preventDefault(); return; }
      if (e.key === 'Backspace') {
        e.preventDefault();
        const d = document.getElementById('calc-norm-display');
        if (d) {
          const cur = d.textContent;
          if (cur === 'Error' || cur === '0') {
            normalBody.querySelector('[data-key="C"]')?.click();
          } else {
            d.textContent = cur.length > 1 ? cur.slice(0,-1) : '0';
          }
        }
        return;
      }
      const mapped = MAP[e.key];
      if (!mapped) return;
      e.preventDefault();
      [...normalBody.querySelectorAll('.calc-norm-btn')].find(b => b.dataset.key === mapped)?.click();
    });

    // Tab switching
    tabs.querySelectorAll('.calc-tab').forEach(t => {
      t.addEventListener('click', () => {
        tabs.querySelectorAll('.calc-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        if (t.dataset.mode === 'normal') {
          stayBody.style.display = 'none';
          normalBody.style.display = '';
        } else {
          stayBody.style.display = '';
          normalBody.style.display = 'none';
        }
      });
    });
  }

  // Open / close
  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    // Usar la clase como fuente de verdad (btn-new-booking no la agrega)
    const isOpen = btn.classList.contains('calc-active');
    setOpen(!isOpen);
  });

  const close = () => setOpen(false);
  document.getElementById('calc-close')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) close();
  });

  // Stepper noches
  document.getElementById('calc-nights-minus')?.addEventListener('click', () => {
    const el = document.getElementById('calc-nights');
    if (el && parseInt(el.value) > 1) { el.value = parseInt(el.value) - 1; _calcUpdate(); }
  });
  document.getElementById('calc-nights-plus')?.addEventListener('click', () => {
    const el = document.getElementById('calc-nights');
    if (el) { el.value = Math.min(90, parseInt(el.value) + 1); _calcUpdate(); }
  });

  // Inputs → recalcular
  ['calc-price','calc-channel','calc-discount-range'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', _calcUpdate);
    document.getElementById(id)?.addEventListener('change', _calcUpdate);
  });

  // Descuento label
  document.getElementById('calc-discount-range')?.addEventListener('input', (e) => {
    const lbl = document.getElementById('calc-discount-label');
    if (lbl) lbl.textContent = e.target.value + '%';
  });

  // Precio en USD — usa SIEMPRE el dólar oficial promedio (fuente única de verdad)
  document.getElementById('calc-use-dollar')?.addEventListener('click', () => {
    const { buy } = getOfficialAverageRate();
    if (!buy) { showToast('No hay cotización disponible', 'warning'); return; }
    const priceEl = document.getElementById('calc-price');
    if (priceEl) {
      const usdAmount = prompt(`Dólar oficial promedio compra: $${Math.round(buy).toLocaleString('es-AR')}\n¿Cuántos dólares por noche?`, '50');
      if (!usdAmount) return;
      priceEl.value = Math.round(parseFloat(usdAmount) * buy);
      _calcUpdate();
    }
  });

  // Crear reserva con estos datos — paso 0 del formulario
  document.getElementById('calc-create-booking')?.addEventListener('click', () => {
    const price   = parseFloat(document.getElementById('calc-price')?.value) || 0;
    const nights  = parseInt(document.getElementById('calc-nights')?.value) || 1;
    const chanVal = document.getElementById('calc-channel')?.value ?? 'direct:0';
    const source  = chanVal.split(':')[0];
    const discPct = parseFloat(document.getElementById('calc-discount-range')?.value) || 0;
    if (!price) { showToast('Ingresá un precio primero', 'warning'); return; }
    close(); // cierra calculadora

    // Calcular checkout sugerido
    const today = new Date();
    const co    = new Date(today);
    co.setDate(co.getDate() + nights);
    const checkIn  = toISODate(today);
    const checkOut = toISODate(co);

    bookingForm.open({
      price,
      source,
      discountPct: discPct,
      checkIn,
      checkOut,
    });
  });

  function _calcUpdate() {
    const price    = parseFloat(document.getElementById('calc-price')?.value) || 0;
    const nights   = parseInt(document.getElementById('calc-nights')?.value) || 1;
    const discPct  = parseFloat(document.getElementById('calc-discount-range')?.value) || 0;
    const chanVal  = document.getElementById('calc-channel')?.value ?? 'direct:0';
    const commPct  = parseFloat(chanVal.split(':')[1]) || 0;

    if (!price) {
      ['cr-subtotal','cr-disc','cr-comm','cr-total','cr-net','cr-usd'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = '—';
      });
      return;
    }

    const subtotal  = price * nights;
    const discAmt   = subtotal * (discPct / 100);
    const total     = subtotal - discAmt;
    const commAmt   = total * (commPct / 100);
    const net       = total - commAmt;

    // USD equivalente — usa dólar oficial promedio COMPRA (fuente única de verdad)
    const { buy: officialBuy } = getOfficialAverageRate();
    const usdEq = officialBuy > 0 ? (total / officialBuy).toFixed(0) : null;

    const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

    set('cr-subtotal', `${fmt(price)} × ${nights} noche${nights !== 1 ? 's' : ''} = ${fmt(subtotal)}`);

    const discRow = document.getElementById('cr-disc-row');
    if (discRow) discRow.style.display = discPct > 0 ? '' : 'none';
    set('cr-disc-label', `Descuento ${discPct}%`);
    set('cr-disc', `−${fmt(discAmt)}`);

    const commRow = document.getElementById('cr-comm-row');
    if (commRow) commRow.style.display = commPct > 0 ? '' : 'none';
    set('cr-comm-label', `Comisión canal ${commPct}%`);
    set('cr-comm', `−${fmt(commAmt)}`);

    set('cr-total', fmt(total));

    const netRow = document.getElementById('cr-net-row');
    if (netRow) netRow.style.display = commPct > 0 ? '' : 'none';
    set('cr-net', fmt(net));

    const usdRow = document.getElementById('cr-usd-row');
    if (usdRow) usdRow.style.display = usdEq ? '' : 'none';
    set('cr-usd', usdEq ? `≈ USD ${parseInt(usdEq).toLocaleString('es-AR')}` : '—');
  }

  // Calcular al abrir
  _calcUpdate();
}

function setupConnectivityIndicator() {
  const dot   = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  if (!dot || !label) return;

  let _offlineQueue = JSON.parse(localStorage.getItem('mila_offline_queue') ?? '[]');

  function setStatus(status) {
    const states = {
      connected:    { text: 'Conectado',    cls: 'conn-ok'   },
      reconnecting: { text: 'Reconectando', cls: 'conn-warn' },
      disconnected: { text: 'Sin conexión', cls: 'conn-err'  },
      syncing:      { text: 'Sincronizando',cls: 'conn-warn' },
    };
    const s = states[status] ?? states.connected;
    dot.className     = `conn-dot ${s.cls}`;
    label.textContent = s.text;
    label.className   = `conn-label ${s.cls}`;
  }

  setStatus(navigator.onLine ? 'connected' : 'disconnected');
  window.addEventListener('online',  () => {
    setStatus('connected');
    _syncOfflineQueue();
  });
  window.addEventListener('offline', () => {
    setStatus('disconnected');
    showToast('⚠️ Sin conexión — las acciones se guardarán para sincronizar', 'warning');
  });

  supabase.realtime?.on?.('connect',    () => setStatus('connected'));
  supabase.realtime?.on?.('reconnect',  () => setStatus('connected'));
  supabase.realtime?.on?.('disconnect', () => setStatus(navigator.onLine ? 'reconnecting' : 'disconnected'));

  // Escuchar mensajes del Service Worker
  navigator.serviceWorker?.addEventListener('message', (e) => {
    const { type, payload, succeeded, total } = e.data ?? {};
    if (type === 'OFFLINE') {
      setStatus('disconnected');
      showToast('📵 Sin conexión — acción en cola', 'warning');
    }
    if (type === 'ONLINE')  setStatus('connected');
    if (type === 'QUEUE_ACTION' && payload) {
      _offlineQueue.push(payload);
      localStorage.setItem('mila_offline_queue', JSON.stringify(_offlineQueue));
      const queueBadge = document.getElementById('conn-queue-badge');
      if (queueBadge) { queueBadge.textContent = _offlineQueue.length; queueBadge.style.display = ''; }
    }
    if (type === 'SYNC_DONE') {
      _offlineQueue = [];
      localStorage.removeItem('mila_offline_queue');
      const queueBadge = document.getElementById('conn-queue-badge');
      if (queueBadge) queueBadge.style.display = 'none';
      setStatus('connected');
      if (succeeded > 0) showToast(`✅ ${succeeded} acción${succeeded!==1?'es':''} sincronizada${succeeded!==1?'s':''} ✓`, 'success');
    }
  });

  // Sync al recuperar conexión
  async function _syncOfflineQueue() {
    if (!_offlineQueue.length) return;
    setStatus('syncing');
    const sw = await navigator.serviceWorker?.ready;
    sw?.active?.postMessage({ type: 'SYNC_QUEUE', queue: _offlineQueue });
  }

  // Iniciar sync si hay cola pendiente al cargar
  if (_offlineQueue.length && navigator.onLine) {
    setTimeout(_syncOfflineQueue, 2000);
  }
}


// ══════════════════════════════════════════════════
// START — manejo de URL params especiales
// ══════════════════════════════════════════════════
(async () => {
  const params = new URLSearchParams(window.location.search);
  // ?demo=true → auto-login con usuario demo
  if (params.get('demo') === 'true') {
    const demoEmail = import.meta.env.VITE_DEMO_EMAIL ?? 'demo@milasistema.com';
    const demoPass  = import.meta.env.VITE_DEMO_PASS  ?? 'MILAdemo2025!';
    const { error } = await supabase.auth.signInWithPassword({ email: demoEmail, password: demoPass });
    if (error) console.warn('[MILA] Demo login failed:', error.message);
    else {
      // Limpiar el param de la URL sin recargar
      const url = new URL(window.location.href);
      url.searchParams.delete('demo');
      window.history.replaceState({}, '', url.toString());
    }
  }
  // ?booking=ID → abrir detalle al cargar
  if (params.get('booking')) {
    window._pendingDetailId = params.get('booking');
    const url = new URL(window.location.href);
    url.searchParams.delete('booking');
    window.history.replaceState({}, '', url.toString());
  }
  // ?section=calendar → ir a esa sección al arrancar
  if (params.get('section')) {
    window._pendingSection = params.get('section');
  }
  boot();
})();
