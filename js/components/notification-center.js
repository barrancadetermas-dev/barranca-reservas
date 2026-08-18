// ═══════════════════════════════════════════════════
// notification-center.js — Centro de Notificaciones
// Módulo genérico y desacoplado: cualquier parte de la
// app (o una futura API externa — clima, dólar, fútbol,
// feriados) puede generar una notificación llamando a
// addNotification({...}). Este archivo no sabe nada de
// reservas, huéspedes, ni de ningún otro módulo — solo
// sabe guardar, mostrar, y avisar que hay algo nuevo.
// ═══════════════════════════════════════════════════

const STORAGE_KEY   = 'mila_notifications_v1';
const CATEGORY_KEY  = 'mila_notif_categories_v1';
const MAX_STORED    = 200; // no crecer para siempre en localStorage
const TOAST_MS      = 10000;

// Categorías disponibles — el usuario las prende/apaga desde el panel.
// "sistema" no se puede apagar (avisos internos de la propia app).
export const CATEGORIES = {
  reservas: { label: '🏠 Reservas', togglable: true },
  clima:    { label: '🌤️ Clima',    togglable: true },
  economia: { label: '💵 Economía', togglable: true },
  sistema:  { label: '⚙️ Sistema',  togglable: false },
};

let _listeners = []; // callbacks livianos para refrescar la UI (badge/panel)

function _loadAll() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []; }
  catch { return []; }
}
function _saveAll(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_STORED))); }
  catch (err) { console.warn('[NotifCenter] no se pudo guardar el historial:', err?.message ?? err); }
}
function _loadCategoryPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(CATEGORY_KEY)) ?? {};
    const merged = {};
    Object.keys(CATEGORIES).forEach(key => { merged[key] = saved[key] ?? true; }); // todas prendidas por default
    return merged;
  } catch {
    const all = {};
    Object.keys(CATEGORIES).forEach(key => { all[key] = true; });
    return all;
  }
}
function _saveCategoryPrefs(prefs) {
  try { localStorage.setItem(CATEGORY_KEY, JSON.stringify(prefs)); } catch {}
}

let _categoryPrefs = _loadCategoryPrefs();

function _notifyListeners() {
  _listeners.forEach(fn => { try { fn(); } catch {} });
}

/** Cualquier módulo se puede suscribir para refrescar su UI (badge, panel, etc.) */
export function onNotificationsChanged(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(f => f !== fn); };
}

// ── La función genérica central — todo pasa por acá ──
// type:       identificador libre ('booking_created', 'weather', 'dollar', ...)
// title:      título corto
// message:    cuerpo del mensaje
// icon:       emoji o ícono (opcional, default según category)
// color:      color de acento (opcional)
// persistent: si se guarda en el historial (default true) — false = solo
//             toast fugaz, no queda guardada (para avisos sin importancia)
// data:       cualquier dato extra asociado (ej: bookingId) — opcional
// category:   una de CATEGORIES (default 'sistema')
export function addNotification({ type = 'generic', title, message = '', icon, color, persistent = true, data = null, category = 'sistema', skipToast = false }) {
  const catInfo = CATEGORIES[category] ?? CATEGORIES.sistema;

  // Dedup: si ya existe una notificación del mismo tipo con el mismo título
  // en los últimos 3 segundos, la ignoramos — evita duplicados cuando el
  // mismo evento se dispara múltiples veces seguidas (doble recarga, etc.)
  const all = _loadAll();
  const cutoff = Date.now() - 3000;
  const isDupe = all.some(n =>
    n.type === type &&
    n.title === title &&
    new Date(n.createdAt).getTime() > cutoff
  );
  if (isDupe) return null;

  const notif = {
    id:        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type, title, message,
    icon:      icon ?? catInfo.label.split(' ')[0],
    color:     color ?? null,
    category,
    data,
    read:      false,
    createdAt: new Date().toISOString(),
  };

  if (persistent) {
    all.unshift(notif);
    _saveAll(all);
  }

  // Si la categoría está apagada (o el interruptor maestro), no se
  // muestra el toast ni se cuenta en el badge — pero si era persistente,
  // igual quedó guardada en el historial por si se prende más adelante.
  if (_categoryPrefs[category] === false || !_masterEnabled) return notif;

  // skipToast: para cuando ya estás mirando el panel de Avisos (ej: se
  // refresca el clima al abrirlo) — no tiene sentido un toast flotante
  // encima del panel que ya tenés abierto; alcanza con que aparezca en
  // la lista. En mobile esto además evitaba un lío real: el toast
  // quedaba tapando al panel, y al intentar cerrarlo el toque se le
  // escapaba al fondo y cerraba el panel de atrás sin querer.
  if (!skipToast) _showToast(notif);
  _notifyListeners();
  return notif;
}

export function getNotifications() {
  return _loadAll().filter(n => _categoryPrefs[n.category] !== false);
}
export function getUnreadCount() {
  if (!_masterEnabled) return 0;
  return getNotifications().filter(n => !n.read).length;
}
export function markAllRead() {
  const all = _loadAll().map(n => ({ ...n, read: true }));
  _saveAll(all);
  _notifyListeners();
}
export function clearAll() {
  _saveAll([]);
  _notifyListeners();
}
export function deleteNotification(id) {
  const all = _loadAll().filter(n => n.id !== id);
  _saveAll(all);
  _notifyListeners();
}
export function getCategoryPrefs() { return { ..._categoryPrefs }; }
export function setCategoryEnabled(category, enabled) {
  if (CATEGORIES[category]?.togglable === false) return; // "sistema" no se puede apagar
  _categoryPrefs[category] = enabled;
  _saveCategoryPrefs(_categoryPrefs);
  _notifyListeners();
}

// ── Interruptor maestro — silencia/habilita TODO de una sola vez ──
const MASTER_KEY = 'mila_notif_master_v1';
let _masterEnabled = (() => {
  try { return localStorage.getItem(MASTER_KEY) !== 'false'; } catch { return true; }
})();
export function isMasterEnabled() { return _masterEnabled; }
export function setMasterEnabled(enabled) {
  _masterEnabled = enabled;
  try { localStorage.setItem(MASTER_KEY, String(enabled)); } catch {}
  _notifyListeners();
}

// ══════════════════════════════════════════════════
// TOAST — arriba a la derecha, con barra de progreso
// ══════════════════════════════════════════════════
function _ensureToastContainer() {
  let el = document.getElementById('notifcenter-toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'notifcenter-toast-container';
    document.body.appendChild(el);
  }
  return el;
}

function _showToast(notif) {
  // Mismo criterio que la campana/panel: en mobile esto se deja afuera
  // por ahora (se veía borroso y con problemas de toque). El aviso
  // igual queda guardado en el historial para cuando lo mires desde PC.
  if (window.innerWidth < 768) return;

  const container = _ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = 'notifcenter-toast';
  toast.innerHTML = `
    <div class="notifcenter-toast-icon">${notif.icon}</div>
    <div class="notifcenter-toast-body">
      <div class="notifcenter-toast-title">${notif.title}</div>
      ${notif.message ? `<div class="notifcenter-toast-msg">${notif.message}</div>` : ''}
    </div>
    <button class="notifcenter-toast-close" aria-label="Cerrar" title="Cerrar">✕</button>
    <div class="notifcenter-toast-progress"><div class="notifcenter-toast-progress-fill"></div></div>
  `;
  if (notif.color) toast.style.setProperty('--notif-accent', notif.color);
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('in'));

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    toast.classList.remove('in');
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 250);
  };

  const fill = toast.querySelector('.notifcenter-toast-progress-fill');
  if (fill) {
    fill.style.transition = `width ${TOAST_MS}ms linear`;
    requestAnimationFrame(() => { fill.style.width = '0%'; });
  }
  const timer = setTimeout(remove, TOAST_MS);
  toast.querySelector('.notifcenter-toast-close')?.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}
