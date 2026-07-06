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
  clearAll, deleteNotification, getCategoryPrefs, setCategoryEnabled, onNotificationsChanged,
  isMasterEnabled, setMasterEnabled,
} from '../services/notification-center.js';
import { checkTodayWeather, getWeatherLocations, getLocationPrefs, setLocationEnabled } from '../services/weather-notifications.js';

// Colores pastel de fondo por categoría, para distinguir de un vistazo
// en el historial (ej: economía verde, clima amarillo).
const CATEGORY_BG = {
  reservas:      'rgba(59,130,246,.07)',  // celeste apenas
  deportes:      'rgba(249,115,22,.07)',  // naranja apenas
  deportes_vivo: 'rgba(239,68,68,.07)',   // rojo apenas
  f1:            'rgba(14,165,233,.07)',  // celeste F1 apenas
  f1_vivo:       'rgba(239,68,68,.07)',   // rojo apenas
  clima:         'rgba(234,179,8,.07)',   // amarillo apenas
  economia:      'rgba(34,197,94,.07)',   // verde apenas
  feriados:      'rgba(168,85,247,.07)',  // lila apenas
  rio:           'rgba(20,184,166,.07)',  // turquesa apenas
  noticias:      'rgba(99,102,241,.07)',  // índigo apenas
  sistema:       'rgba(107,114,128,.07)', // gris apenas
};
const CATEGORY_BG_DARK = {
  reservas:      'rgba(96,165,250,.09)',
  deportes:      'rgba(251,146,60,.09)',
  deportes_vivo: 'rgba(248,113,113,.09)',
  f1:            'rgba(56,189,248,.09)',
  f1_vivo:       'rgba(248,113,113,.09)',
  clima:         'rgba(250,204,21,.09)',
  economia:      'rgba(74,222,128,.09)',
  feriados:      'rgba(196,181,253,.09)',
  rio:           'rgba(45,212,191,.09)',
  noticias:      'rgba(129,140,248,.09)',
  sistema:       'rgba(148,163,184,.09)',
};

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
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const bgMap = isDark ? CATEGORY_BG_DARK : CATEGORY_BG;
  list.innerHTML = notifs.map(n => {
    const catBg = bgMap[n.category] ?? (isDark ? CATEGORY_BG_DARK.sistema : CATEGORY_BG.sistema);
    return `
    <div class="notifcenter-item ${n.read ? '' : 'unread'}" style="${n.color ? `--notif-accent:${n.color};` : ''}background:${catBg}">
      <div class="notifcenter-item-icon">${n.icon}</div>
      <div class="notifcenter-item-body">
        <div class="notifcenter-item-title">${n.title}</div>
        ${n.message ? `<div class="notifcenter-item-msg">${n.message}</div>` : ''}
        <div class="notifcenter-item-time">${_fmtWhen(n.createdAt)}</div>
      </div>
      <button class="notifcenter-item-delete" data-id="${n.id}" title="Eliminar" aria-label="Eliminar notificación">✕</button>
    </div>`;
  }).join('');

  list.querySelectorAll('.notifcenter-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNotification(btn.dataset.id);
    });
  });
}

// Orden explícito — lo esencial de MILA arriba, después lo técnico,
// después las fuentes externas agrupadas por tema.
const CATEGORY_ORDER = ['reservas', 'sistema', 'clima', 'rio', 'economia', 'feriados', 'noticias', 'deportes', 'f1'];

function _renderCategoryToggles() {
  const wrap = document.getElementById('notifcenter-categories');
  if (!wrap) return;
  const prefs = getCategoryPrefs();
  const masterOn = isMasterEnabled();

  const masterToggle = document.getElementById('notifcenter-master-toggle');
  if (masterToggle) masterToggle.checked = masterOn;

  wrap.innerHTML = CATEGORY_ORDER
    .map(key => [key, CATEGORIES[key]])
    .filter(([, cat]) => cat && !cat.hidden)
    .map(([key, cat]) => {
      const catOn = prefs[key] !== false;
      const rowOff = !masterOn || !catOn; // gris+tachado si está apagada individualmente O por el maestro
      const liveOn = cat.liveKey ? prefs[cat.liveKey] !== false : false;
      const liveHtml = cat.liveKey ? `
        <label class="notifcenter-live-check" title="Avisos en vivo (goles, posición en pista, etc.)">
          <input type="checkbox" data-cat="${cat.liveKey}" ${liveOn ? 'checked' : ''} ${!masterOn || !catOn ? 'disabled' : ''}>
          <span>🔴 en vivo</span>
        </label>` : '';
      const climaLocationsHtml = key === 'clima' ? _renderClimaLocationRow(masterOn, catOn) : '';
      return `
      <div class="notifcenter-cat-row ${cat.togglable === false ? 'locked' : ''} ${rowOff ? 'off' : ''}">
        <span class="notifcenter-cat-label">${cat.label}</span>
        <div style="display:flex;align-items:center;gap:10px">
          ${liveHtml}
          <label class="notifcenter-toggle">
            <input type="checkbox" data-cat="${key}" ${catOn ? 'checked' : ''} ${cat.togglable === false || !masterOn ? 'disabled' : ''}>
            <span class="notifcenter-toggle-slider"></span>
          </label>
        </div>
      </div>${climaLocationsHtml}`;
    }).join('');

  wrap.querySelectorAll('input[data-cat]').forEach(input => {
    input.addEventListener('change', () => setCategoryEnabled(input.dataset.cat, input.checked));
  });
  wrap.querySelectorAll('input[data-loc]').forEach(input => {
    input.addEventListener('change', () => setLocationEnabled(input.dataset.loc, input.checked));
  });
}

// Fila chica debajo de "Clima" para elegir qué ubicación(es) querés
// recibir — útil si estás viajando y solo te interesa la de donde estás.
function _renderClimaLocationRow(masterOn, catOn) {
  const locs = getWeatherLocations();
  const prefs = getLocationPrefs();
  const disabled = !masterOn || !catOn;
  const items = locs.map(loc => `
    <label class="notifcenter-live-check" title="${loc.label}">
      <input type="checkbox" data-loc="${loc.key}" ${prefs[loc.key] !== false ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span>📍 ${loc.label.split('|')[0].trim()}</span>
    </label>`).join('');
  return `<div class="notifcenter-subrow ${disabled ? 'off' : ''}">${items}</div>`;
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
  checkTodayWeather(true, true); // clima siempre fresco al abrir Avisos, sin toast flotante (ya estás mirando el panel)
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
      <button id="notifcenter-bell-btn" class="header-icon-btn" title="Avisos" aria-label="Avisos"
        style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border:none;background:transparent;border-radius:8px;color:var(--color-text-2,#94a3b8);cursor:pointer;flex-shrink:0;position:relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <path d="M3 11l18-5v12L3 13v-2z"/>
          <path d="M11.6 16.8a2 2 0 11-3.2 2.4"/>
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
    panel.addEventListener('click', (e) => e.stopPropagation()); // resguardo — ningún toque adentro del panel debe poder "escaparse" y cerrarlo
    panel.innerHTML = `
      <div class="notifcenter-panel-header">
        <h3>✈️ Avisos</h3>
        <div style="display:flex;align-items:center;gap:10px">
          <label class="notifcenter-toggle" title="Silenciar/habilitar todas">
            <input type="checkbox" id="notifcenter-master-toggle">
            <span class="notifcenter-toggle-slider"></span>
          </label>
          <button id="notifcenter-close-btn" class="notifcenter-close-btn" aria-label="Cerrar">✕</button>
        </div>
      </div>
      <div class="notifcenter-panel-actions">
        <button id="notifcenter-clear-btn" class="notifcenter-clear-btn">🗑️ Borrar historial</button>
      </div>
      <div id="notifcenter-categories" class="notifcenter-categories"></div>
      <div class="notifcenter-list-title">Historial</div>
      <div id="notifcenter-list" class="notifcenter-list"></div>
    `;
    document.body.appendChild(panel);

    document.getElementById('notifcenter-master-toggle')?.addEventListener('change', (e) => {
      setMasterEnabled(e.target.checked);
      _renderCategoryToggles();
      _renderBadge();
    });

    document.getElementById('notifcenter-close-btn')?.addEventListener('click', _closePanel);
    document.getElementById('notifcenter-clear-btn')?.addEventListener('click', () => {
      if (confirm('¿Borrar todo el historial de notificaciones? No se puede deshacer.')) clearAll();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _panelOpen) _closePanel(); });
  }
}

/** Llamar una vez al iniciar la app. */
export function initNotificationCenterUI() {
  // Por ahora, esta función solo anda bien en PC — en el celular seguía
  // viéndose borroso incluso después de sacar el efecto de vidrio
  // esmerilado, así que se deja completamente afuera en mobile hasta
  // resolverlo bien (no tiene sentido mostrar algo que se ve mal).
  // Los chequeos de fondo (clima, deportes, etc.) siguen corriendo igual
  // en mobile — solo no se arma la campana ni el panel ni los toasts.
  if (window.innerWidth < 768) return;

  _buildDom();
  _renderBadge();
  onNotificationsChanged(() => {
    _renderBadge();
    if (_panelOpen) { _renderList(); _renderCategoryToggles(); }
  });
}
