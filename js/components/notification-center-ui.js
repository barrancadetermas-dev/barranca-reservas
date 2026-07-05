// ═══════════════════════════════════════════════════
// notification-center-ui.js — Campana 🔔, contador y
// panel lateral del Centro de Notificaciones.
//
// Este archivo SOLO se encarga de pintar y de reaccionar
// a lo que ya expone notification-center.js — no conoce
// reservas, huéspedes, ni ningún otro módulo de MILA.
// Completamente desacoplado: si mañana se saca este
// archivo, nada más de la app se rompe (solo desaparece
// la campana).
// ═══════════════════════════════════════════════════

import {
  CATEGORIES, getNotifications, getUnreadCount, markAllRead,
  clearAll, getCategoryPrefs, setCategoryEnabled, onNotificationsChanged,
} from '../services/notification-center.js';

let _panelOpen = false;

function _fmtWhen(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Hoy · ${time}`;
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Ayer · ${time}`;
  return `${d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })} · ${time}`;
}

function _renderBadge() {
  const badge = document.getElementById('notifcenter-badge');
  if (!badge) return;
  const count = getUnreadCount();
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.style.display = count > 0 ? '' : 'none';
}

function _renderList() {
  const list = document.getElementById('notifcenter-list');
  if (!list) return;
  const notifs = getNotifications();
  if (!notifs.length) {
    list.innerHTML = `<div class="notifcenter-empty">🔕 Sin notificaciones todavía</div>`;
    return;
  }
  list.innerHTML = notifs.map(n => `
    <div class="notifcenter-item ${n.read ? '' : 'unread'}" style="${n.color ? `--notif-accent:${n.color}` : ''}">
      <div class="notifcenter-item-icon">${n.icon}</div>
      <div class="notifcenter-item-body">
        <div class="notifcenter-item-title">${n.title}</div>
        ${n.message ? `<div class="notifcenter-item-msg">${n.message}</div>` : ''}
        <div class="notifcenter-item-time">${_fmtWhen(n.createdAt)}</div>
      </div>
    </div>`).join('');
}

function _renderCategoryToggles() {
  const wrap = document.getElementById('notifcenter-categories');
  if (!wrap) return;
  const prefs = getCategoryPrefs();
  wrap.innerHTML = Object.entries(CATEGORIES).map(([key, cat]) => `
    <label class="notifcenter-cat-row ${cat.togglable === false ? 'locked' : ''}">
      <span>${cat.label}</span>
      <span class="notifcenter-toggle">
        <input type="checkbox" data-cat="${key}" ${prefs[key] !== false ? 'checked' : ''} ${cat.togglable === false ? 'disabled' : ''}>
        <span class="notifcenter-toggle-slider"></span>
      </span>
    </label>`).join('');

  wrap.querySelectorAll('input[data-cat]').forEach(input => {
    input.addEventListener('change', () => setCategoryEnabled(input.dataset.cat, input.checked));
  });
}

function _renderAll() {
  _renderBadge();
  _renderList();
  _renderCategoryToggles();
}

function _openPanel() {
  const panel = document.getElementById('notifcenter-panel');
  const overlay = document.getElementById('notifcenter-overlay');
  if (!panel) return;
  _renderAll();
  panel.classList.add('open');
  overlay?.classList.add('open');
  _panelOpen = true;
  markAllRead();
  setTimeout(_renderBadge, 300); // se lee al abrir, el badge baja a 0 con una mini demora
}
function _closePanel() {
  const panel = document.getElementById('notifcenter-panel');
  const overlay = document.getElementById('notifcenter-overlay');
  panel?.classList.remove('open');
  overlay?.classList.remove('open');
  _panelOpen = false;
}

function _buildDom() {
  // Botón de la campana — se inserta en el header, al lado de lo que ya
  // exista ahí (no reemplaza nada).
  const headerRight = document.querySelector('.header-right');
  if (headerRight && !document.getElementById('notifcenter-bell-btn')) {
    const bellWrap = document.createElement('div');
    bellWrap.className = 'notifcenter-bell-wrap';
    bellWrap.innerHTML = `
      <button id="notifcenter-bell-btn" class="notifcenter-bell-btn" title="Notificaciones" aria-label="Notificaciones">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="19" height="19">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        <span id="notifcenter-badge" class="notifcenter-badge" style="display:none">0</span>
      </button>`;
    // Se inserta como PRIMER hijo de header-right, para que quede visible
    // y no dependa de dónde estén los otros elementos.
    headerRight.insertBefore(bellWrap, headerRight.firstChild);
    document.getElementById('notifcenter-bell-btn')?.addEventListener('click', () => {
      _panelOpen ? _closePanel() : _openPanel();
    });
  }

  // Panel lateral + overlay — se agregan una sola vez al body.
  if (!document.getElementById('notifcenter-panel')) {
    const overlay = document.createElement('div');
    overlay.id = 'notifcenter-overlay';
    overlay.className = 'notifcenter-overlay';
    overlay.addEventListener('click', _closePanel);
    document.body.appendChild(overlay);

    const panel = document.createElement('div');
    panel.id = 'notifcenter-panel';
    panel.className = 'notifcenter-panel';
    panel.innerHTML = `
      <div class="notifcenter-panel-header">
        <h3>🔔 Notificaciones</h3>
        <button id="notifcenter-close-btn" class="notifcenter-close-btn" aria-label="Cerrar">✕</button>
      </div>
      <div class="notifcenter-panel-actions">
        <button id="notifcenter-clear-btn" class="notifcenter-clear-btn">🗑️ Borrar historial</button>
      </div>
      <div id="notifcenter-categories" class="notifcenter-categories"></div>
      <div class="notifcenter-list-title">Historial</div>
      <div id="notifcenter-list" class="notifcenter-list"></div>
    `;
    document.body.appendChild(panel);

    document.getElementById('notifcenter-close-btn')?.addEventListener('click', _closePanel);
    document.getElementById('notifcenter-clear-btn')?.addEventListener('click', () => {
      if (confirm('¿Borrar todo el historial de notificaciones? No se puede deshacer.')) clearAll();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _panelOpen) _closePanel(); });
  }
}

/** Llamar una vez al iniciar la app. */
export function initNotificationCenterUI() {
  _buildDom();
  _renderBadge();
  onNotificationsChanged(() => {
    _renderBadge();
    if (_panelOpen) { _renderList(); _renderCategoryToggles(); }
  });
}
