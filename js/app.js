// ═══════════════════════════════════════════════════
// app.js v5.0 — MILA Sistema Inteligente para Alojamientos
// + Roles (admin/staff/demo) + Demo banner
// + Audit log + Check-in/out + Cancel modal
// + Error boundaries + PWA + Módulo Operaciones
// + Panel de Configuración + Indicador de Conexión
// ═══════════════════════════════════════════════════

import { supabase, loadHotelContext, AppContext, showToast, toISODate, formatARS } from './supabase-config.js';
import { can, isDemo, getRoleLabel, ROLE_PERMISSIONS } from './auth/permissions.js';
import { logAction } from './services/audit-service.js';
import { Dashboard }    from './components/dashboard.js';
import { Calendar }     from './components/calendar.js';
import { BookingForm }  from './components/booking-form.js';
import { BookingList }  from './components/booking-list.js';
import { Statistics }   from './components/statistics.js';
import { GuestsCRM }    from './components/guests.js';
import { fetchDollarRates } from './services/dollar-api.js';
import { ConfigPanel }    from './components/config-panel.js';
import { AuditPanel }     from './components/audit-panel.js';
import { OperationsModule } from './components/operations.js';

let dashboard   = null;
let calendar    = null;
let bookingForm = null;
let bookingList = null;
let statistics  = null;
let guestsCRM   = null;
let configPanel = null;
let auditPanel  = null;
let operations  = null;
let currentSection = 'dashboard';

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
  if (session) await initApp(session.user);
  else showLogin();

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN'  && session) await initApp(session.user);
    if (event === 'SIGNED_OUT') { destroyApp(); showLogin(); }
  });
}

// ══════════════════════════════════════════════════
// DARK MODE
// ══════════════════════════════════════════════════
function initDarkMode() {
  const saved = localStorage.getItem('pms-theme') ??
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(saved);
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('pms-theme', theme);
  document.getElementById('dark-icon-sun')?.classList.toggle('hidden',  theme === 'dark');
  document.getElementById('dark-icon-moon')?.classList.toggle('hidden', theme !== 'dark');
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

  btnText.classList.add('hidden');
  spinner.classList.remove('hidden');
  errEl.classList.add('hidden');

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  btnText.classList.remove('hidden');
  spinner.classList.add('hidden');

  if (error) {
    errEl.textContent = 'Credenciales incorrectas. Verificá tu email y contraseña.';
    errEl.classList.remove('hidden');
  }
});

document.getElementById('toggle-password')?.addEventListener('click', () => {
  const i = document.getElementById('login-password');
  i.type  = i.type === 'password' ? 'text' : 'password';
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

    // ── UI usuario ──
    const initials = (user.email ?? 'A')[0].toUpperCase();
    document.getElementById('user-avatar').textContent  = initials;
    document.getElementById('user-name').textContent    =
      user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'Admin';
    document.getElementById('user-role-badge').textContent = getRoleLabel(AppContext.role);

    // ── Demo banner ──
    if (AppContext.IS_DEMO) setupDemoBanner();

    // ── Componentes ──
    bookingForm = new BookingForm(supabase, AppContext);
    window._bookingFormInstance = bookingForm;
    dashboard   = new Dashboard(supabase, AppContext, bookingForm);
    calendar    = new Calendar(supabase, AppContext, bookingForm);
    bookingList = new BookingList(supabase, AppContext, bookingForm);
    statistics  = new Statistics(supabase, AppContext);
    guestsCRM   = new GuestsCRM(supabase, AppContext, bookingForm);
    configPanel = new ConfigPanel(supabase, AppContext);
    auditPanel  = new AuditPanel(supabase, AppContext);
    operations  = new OperationsModule(supabase, AppContext);
    window._guestsCRM   = guestsCRM;
    window._statsInstance = statistics;
    window._operations  = operations;

    // ── Nav: mostrar/ocultar secciones por rol ──
    setupNavByRole();

    await navigateTo('dashboard');

    loadDollarBadge();
    setupRealtime();
    setupNavigation();
    setupGlobalShortcuts();
    setupCommandPalette();
    setupDarkModeToggle();
    setupConnectivityIndicator();
    setupReminderModal();
    setupExpenseModal();
    setupGuestProfileModal();
    setupCancelBookingModal();
    setupCheckInOutModal();

    document.addEventListener('reminders:badge', (e) => updateReminderBadge(e.detail.count));
    document.addEventListener('booking:fullypaid', () => launchConfetti());
    document.addEventListener('show:toast', (e) => showToast(e.detail.msg, e.detail.type));

    document.getElementById('btn-new-booking').addEventListener('click', () => {
      if (isDemo()) return showDemoAction(() => bookingForm.open());
      bookingForm.open();
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
  // Admin-only: Auditoría, Config
  const auditNav    = document.querySelector('.nav-item[data-section="audit"]');
  const configNav   = document.querySelector('.nav-item[data-section="config"]');
  const statsNav    = document.querySelector('.nav-item[data-section="statistics"]');
  const expenseNav  = document.querySelector('#section-statistics .tab[data-tab="expenses"]');

  if (auditNav)   auditNav.style.display    = can('viewAuditLog')   ? '' : 'none';
  if (configNav)  configNav.style.display   = can('manageSeasonPricing') ? '' : 'none';
  if (statsNav && !can('viewStats') && !isDemo()) statsNav.style.opacity = '.5';
}

// ══════════════════════════════════════════════════
// NAVEGACIÓN
// ══════════════════════════════════════════════════
const SECTION_TITLES = {
  dashboard:   'Panel de Hoy',
  calendar:    'Calendario de Ocupación',
  bookings:    'Reservas',
  statistics:  'Estadísticas',
  reminders:   'Recordatorios',
  guests:      'Huéspedes / CRM',
  operations:  'Operaciones',
  audit:       'Registro de Auditoría',
  config:      'Configuración',
};

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
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.section === section));
  document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
  document.getElementById(`section-${section}`)?.classList.add('active');
  document.getElementById('header-title').textContent = SECTION_TITLES[section] ?? section;
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

function updateHeaderDate() {
  document.getElementById('header-date').textContent =
    new Date().toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
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
  overlay.classList.remove('hidden');
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
function setupCheckInOutModal() {}

export async function markCheckIn(bookingId) {
  if (!can('checkInOut')) { showToast('🔒 Sin permiso', 'warning'); return; }
  if (isDemo()) { showDemoAction(null); return; }
  const { error } = await supabase.from('bookings')
    .update({ checked_in_at: new Date().toISOString() }).eq('id', bookingId);
  if (error) { showToast('Error al registrar check-in', 'error'); return; }
  await logAction('CHECKIN', 'booking', bookingId, 'Check-in registrado');
  showToast('✅ Check-in registrado', 'success');
  document.dispatchEvent(new CustomEvent('booking:changed'));
}

export async function markCheckOut(bookingId) {
  if (!can('checkInOut')) { showToast('🔒 Sin permiso', 'warning'); return; }
  if (isDemo()) { showDemoAction(null); return; }
  const { error } = await supabase.from('bookings')
    .update({ checked_out_at: new Date().toISOString() }).eq('id', bookingId);
  if (error) { showToast('Error al registrar check-out', 'error'); return; }
  await logAction('CHECKOUT', 'booking', bookingId, 'Check-out registrado');
  showToast('👋 Check-out registrado', 'success');
  document.dispatchEvent(new CustomEvent('booking:changed'));
}

// Exponer globalmente para handlers inline
window.markCheckIn  = markCheckIn;
window.markCheckOut = markCheckOut;
window.openCancelModal = openCancelModal;

// ══════════════════════════════════════════════════
// DOLLAR BADGE
// ══════════════════════════════════════════════════
async function loadDollarBadge() {
  try {
    const rates = await fetchDollarRates();
    if (rates?.oficial?.sell) {
      document.getElementById('dollar-badge-value').textContent =
        `$${rates.oficial.sell.toLocaleString('es-AR')}`;
    }
  } catch { /* silencioso */ }
}

// ══════════════════════════════════════════════════
// REALTIME + PULSE
// ══════════════════════════════════════════════════
let _realtimeChannel = null;
function setupRealtime() {
  if (!AppContext.hotelId || isDemo()) return;
  // Evitar doble subscribe si initApp corre más de una vez
  if (_realtimeChannel) {
    supabase.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
  _realtimeChannel = supabase
    .channel('pms-bookings')
    .on('postgres_changes', { event:'*', schema:'public', table:'bookings', filter:`hotel_id=eq.${AppContext.hotelId}` }, handleBookingChange)
    .on('postgres_changes', { event:'*', schema:'public', table:'payments', filter:`hotel_id=eq.${AppContext.hotelId}` }, handlePaymentChange)
    .subscribe();
}

function handleBookingChange(payload) {
  document.dispatchEvent(new CustomEvent('booking:changed', { detail: payload }));
  if (payload.new?.id) {
    const bar = document.querySelector(`[data-booking-id="${payload.new.id}"]`);
    bar?.classList.add('bar-realtime-pulse');
    setTimeout(() => bar?.classList.remove('bar-realtime-pulse'), 1600);
  }
  if (payload.new?.status === 'paid' && payload.old?.status !== 'paid') {
    document.dispatchEvent(new CustomEvent('booking:fullypaid'));
  }
  if (currentSection === 'calendar')   calendar?.load();
  if (currentSection === 'dashboard')  dashboard?.load();
  if (currentSection === 'bookings')   bookingList?.load();
}

function handlePaymentChange(payload) {
  document.dispatchEvent(new CustomEvent('payment:changed', { detail: payload }));
  if (currentSection === 'bookings')  bookingList?.load();
  if (currentSection === 'dashboard') dashboard?.load();
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
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey||e.metaKey) && e.key==='k') { e.preventDefault(); toggleCommandPalette(); }
    if (e.key==='Escape') closeCommandPalette();
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
// DARK MODE TOGGLE
// ══════════════════════════════════════════════════
function setupDarkModeToggle() {
  document.getElementById('dark-mode-toggle')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme')?? 'light';
    applyTheme(cur==='dark'?'light':'dark');
  });
}

// ══════════════════════════════════════════════════
// REMINDER BADGE + SECTION
// ══════════════════════════════════════════════════
export function updateReminderBadge(count) {
  const badge = document.getElementById('nav-badge-reminders');
  if (!badge) return;
  if (count > 0) { badge.textContent=count; badge.style.display='inline'; badge.classList.add('nav-badge-pulse'); }
  else { badge.style.display='none'; badge.classList.remove('nav-badge-pulse'); }
}

async function loadRemindersSection() {
  const {data:reminders}=await supabase.from('reminders').select('*,units(name)').eq('hotel_id',AppContext.hotelId).order('scheduled_date');
  const container=document.getElementById('reminders-full-list');
  if(!container)return;
  if(!reminders?.length){container.innerHTML=`<div class="empty-state"><span class="empty-state-icon">🔔</span><p>Sin recordatorios.</p></div>`;return;}
  const today=toISODate(new Date());
  container.innerHTML=reminders.map(r=>{
    const isToday=r.scheduled_date===today,isPast=r.scheduled_date<today;
    return `<div class="expense-row ${r.completed?'paid':''}" id="reminder-row-${r.id}">
      <div class="expense-category-dot" style="background:${isToday?'var(--color-warning)':isPast?'var(--color-danger)':'var(--color-primary)'}"></div>
      <div class="expense-info"><div class="expense-desc">${r.title}</div>
      <div class="expense-meta">${r.scheduled_date} ${r.units?`· ${r.units.name}`:'· General'}${r.description?` · ${r.description}`:''}</div></div>
      <label class="expense-paid-toggle"><input type="checkbox" ${r.completed?'checked':''} onchange="window.toggleReminder('${r.id}',this.checked)"></label>
      <button class="btn btn-ghost btn-xs" onclick="window.deleteReminder('${r.id}')">🗑️</button>
    </div>`;
  }).join('');
  updateReminderBadge(reminders.filter(r=>!r.completed&&r.scheduled_date<=today).length);
}

window.toggleReminder=(async(id,c)=>{await supabase.from('reminders').update({completed:c}).eq('id',id);document.getElementById(`reminder-row-${id}`)?.classList.toggle('paid',c);});
window.deleteReminder=(async(id)=>{if(!confirm('¿Eliminar?'))return;await supabase.from('reminders').delete().eq('id',id);document.getElementById(`reminder-row-${id}`)?.remove();showToast('Eliminado','success');});

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
    if (dateEl)  dateEl.value  = new Date().toISOString().split('T')[0];
    populateReminderUnitSelect();
    document.getElementById('overlay-reminder').classList.remove('hidden');
    // Focus the title field for better UX
    setTimeout(() => titleEl?.focus(), 100);
  };
  const close=()=>document.getElementById('overlay-reminder').classList.add('hidden');
  document.getElementById('btn-add-reminder')?.addEventListener('click',open);
  document.getElementById('btn-add-reminder-main')?.addEventListener('click',open);
  document.getElementById('reminder-close').addEventListener('click',close);
  document.getElementById('reminder-cancel').addEventListener('click',close);
  document.getElementById('overlay-reminder').addEventListener('click',(e)=>{if(e.target===e.currentTarget)close();});
  document.getElementById('reminder-save').addEventListener('click',async()=>{
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
  document.getElementById('expense-save').addEventListener('click',async()=>{
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
    if(currentSection==='statistics')statistics?.loadExpenses();
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
function setupConnectivityIndicator() {
  const dot   = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  if (!dot || !label) return;

  function setStatus(status) {
    const states = {
      connected:     { text: 'Conectado',     cls: 'conn-ok'   },
      reconnecting:  { text: 'Reconectando',  cls: 'conn-warn' },
      disconnected:  { text: 'Sin conexión',  cls: 'conn-err'  },
    };
    const s = states[status] ?? states.connected;
    dot.className   = `conn-dot ${s.cls}`;
    label.textContent = s.text;
    label.className = `conn-label ${s.cls}`;
  }

  // Estado inicial
  setStatus(navigator.onLine ? 'connected' : 'disconnected');

  // Escuchar eventos browser
  window.addEventListener('online',  () => setStatus('connected'));
  window.addEventListener('offline', () => setStatus('disconnected'));

  // Escuchar estado del canal Realtime de Supabase
  supabase.realtime.on('connect',    () => setStatus('connected'));
  supabase.realtime.on('reconnect',  () => setStatus('connected'));
  supabase.realtime.on('disconnect', () => setStatus(navigator.onLine ? 'reconnecting' : 'disconnected'));
}


// ══════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════
boot();
