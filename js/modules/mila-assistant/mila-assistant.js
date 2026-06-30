// ══════════════════════════════════════════════════
// mila-assistant.js — "🤖 Preguntale a MILA"
// Módulo 100% independiente. No modifica calendario,
// reservas, disponibilidad, estadísticas ni navegación
// existentes. Reutiliza la lógica del sistema a través
// de mila-data.js (mismas consultas, mismos criterios).
// ══════════════════════════════════════════════════
import { AppContext, formatARS, localToday } from '../../supabase-config.js';
import * as MilaData from './mila-data.js';

let ctx = null;       // { can, isDemo, showToast, getBookingOpener }
let rootEl = null;
let bodyEl = null;
let isMobile = () => window.matchMedia('(max-width: 860px)').matches;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const fmtDate = (iso) => { if (!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };

// ── Definición de las 8 consultas rápidas ──────────
const QUERIES = [
  { id: 'checkinout',  icon: '🛎️', title: 'Check-ins / Check-outs', sub: 'Ver movimientos en una fecha' },
  { id: 'reservas',    icon: '📋', title: 'Reservas',                sub: 'Ver reservas activas en una fecha' },
  { id: 'disponib',    icon: '🏠', title: 'Disponibilidad',          sub: 'Ver departamentos disponibles' },
  { id: 'facturacion', icon: '💲', title: 'Facturación',             sub: 'Ver facturación en un período' },
  { id: 'ocupacion',   icon: '📈', title: 'Ocupación',               sub: 'Ver ocupación en un período' },
  { id: 'precios',     icon: '🏷️', title: 'Precios',                 sub: 'Consultar precios por fecha' },
  { id: 'pagos',       icon: '💰', title: 'Pagos pendientes',        sub: 'Ver pagos que faltan cobrar' },
  { id: 'bloqueos',    icon: '🔒', title: 'Bloqueos',                sub: 'Ver bloqueos en un período' },
];

export function initMilaAssistant(options = {}) {
  ctx = options;
  if (rootEl) return; // ya inicializado
  injectMarkup();
  bindEvents();
}

function injectMarkup() {
  rootEl = document.createElement('div');
  rootEl.id = 'mila-assist-root';
  rootEl.innerHTML = `
    <button id="mila-fab" class="mila-fab" aria-label="Preguntale a MILA" title="Preguntale a MILA">
      <span class="mila-fab-emoji">🤖</span>
    </button>
    <div id="mila-overlay" class="mila-overlay" hidden></div>
    <div id="mila-panel" class="mila-panel" hidden role="dialog" aria-label="Preguntale a MILA">
      <header class="mila-header">
        <div class="mila-header-left">
          <span class="mila-header-emoji">🤖</span>
          <div>
            <div class="mila-header-title">MILA <span class="mila-beta">BETA</span></div>
            <div class="mila-header-sub">Asistente inteligente</div>
          </div>
        </div>
        <button id="mila-close" class="mila-close-btn" aria-label="Cerrar">✕</button>
      </header>
      <div id="mila-body" class="mila-body"></div>
    </div>
  `;
  document.body.appendChild(rootEl);
  bodyEl = rootEl.querySelector('#mila-body');
  renderList();
}

function bindEvents() {
  rootEl.querySelector('#mila-fab').addEventListener('click', openPanel);
  rootEl.querySelector('#mila-close').addEventListener('click', closePanel);
  rootEl.querySelector('#mila-overlay').addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !rootEl.querySelector('#mila-panel').hidden) closePanel();
  });
}

function openPanel() {
  rootEl.querySelector('#mila-panel').hidden = false;
  if (!isMobile()) rootEl.querySelector('#mila-overlay').hidden = false;
  document.body.classList.add('mila-open');
  renderList();
}
function closePanel() {
  rootEl.querySelector('#mila-panel').hidden = true;
  rootEl.querySelector('#mila-overlay').hidden = true;
  document.body.classList.remove('mila-open');
}

// ── Vista: lista de consultas rápidas ──────────────
function renderList() {
  const todayISO = localToday();
  bodyEl.innerHTML = `
    <div class="mila-section-label">Consultas rápidas</div>
    <div class="mila-rows">
      ${QUERIES.map(q => rowTemplate(q, todayISO)).join('')}
    </div>
    <div class="mila-soon-card">
      <div class="mila-soon-icon">✨</div>
      <div>
        <div class="mila-soon-title">Próximamente</div>
        <div class="mila-soon-text">Escribí o hablá con MILA AI. Muy pronto vas a poder realizar consultas en lenguaje natural utilizando Inteligencia Artificial.</div>
        <div class="mila-soon-input-row">
          <input type="text" class="mila-soon-input" placeholder="Escribí tu consulta..." disabled>
          <button class="mila-soon-mic" disabled>🎙️</button>
        </div>
      </div>
    </div>
  `;
  wireRowEvents();
}

function rowTemplate(q, todayISO) {
  const units = (AppContext.units ?? []).slice().sort((a,b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  let controls = '';
  switch (q.id) {
    case 'checkinout':
    case 'reservas':
    case 'bloqueos':
      controls = `<input type="date" class="mila-input mila-date" value="${todayISO}">`;
      break;
    case 'disponib':
    case 'facturacion':
    case 'ocupacion':
      controls = `
        <input type="date" class="mila-input mila-date-from" value="${todayISO}">
        <input type="date" class="mila-input mila-date-to" value="${todayISO}">`;
      break;
    case 'precios':
      controls = `
        <select class="mila-input mila-unit-select">
          ${units.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}
        </select>
        <input type="date" class="mila-input mila-date-from" value="${todayISO}">
        <input type="date" class="mila-input mila-date-to" value="${todayISO}">`;
      break;
    case 'pagos':
      controls = '';
      break;
  }
  return `
    <div class="mila-row" data-query="${q.id}">
      <div class="mila-row-main">
        <span class="mila-row-icon">${q.icon}</span>
        <div class="mila-row-text">
          <div class="mila-row-title">${q.title}</div>
          <div class="mila-row-sub">${q.sub}</div>
        </div>
      </div>
      <div class="mila-row-controls">${controls}</div>
      <button class="mila-row-btn" data-action="consultar" data-query="${q.id}">Consultar</button>
    </div>`;
}

function wireRowEvents() {
  bodyEl.querySelectorAll('.mila-row-btn').forEach(btn => {
    btn.addEventListener('click', () => runQuery(btn.dataset.query, btn.closest('.mila-row')));
  });
}

// ── Ejecutar consulta y mostrar resultados ─────────
async function runQuery(queryId, rowEl) {
  const btn = rowEl.querySelector('.mila-row-btn');
  const prevLabel = btn.textContent;
  btn.disabled = true; btn.textContent = '...';
  try {
    const date     = rowEl.querySelector('.mila-date')?.value;
    const dateFrom = rowEl.querySelector('.mila-date-from')?.value;
    const dateTo   = rowEl.querySelector('.mila-date-to')?.value;
    const unitId   = rowEl.querySelector('.mila-unit-select')?.value;

    switch (queryId) {
      case 'checkinout': {
        const data = await MilaData.fetchCheckInsOuts(date);
        renderResults('🛎️ Check-ins / Check-outs', `${fmtDate(date)}`, checkInOutHTML(data));
        break;
      }
      case 'reservas': {
        const data = await MilaData.fetchReservasByDate(date);
        renderResults('📋 Reservas', `${fmtDate(date)}`, reservasHTML(data));
        break;
      }
      case 'disponib': {
        if (dateFrom >= dateTo) { ctx.showToast?.('⚠️ La fecha de salida debe ser posterior al ingreso', 'warning'); break; }
        const data = await MilaData.fetchDisponibilidad(dateFrom, dateTo);
        renderResults('🏠 Disponibilidad', `${fmtDate(dateFrom)} → ${fmtDate(dateTo)}`, disponibilidadHTML(data));
        break;
      }
      case 'facturacion': {
        const data = await MilaData.fetchFacturacion(dateFrom, dateTo);
        renderResults('💲 Facturación', `${fmtDate(dateFrom)} → ${fmtDate(dateTo)}`, facturacionHTML(data));
        break;
      }
      case 'ocupacion': {
        const data = await MilaData.fetchOcupacion(dateFrom, dateTo);
        renderResults('📈 Ocupación', `${fmtDate(dateFrom)} → ${fmtDate(dateTo)}`, ocupacionHTML(data));
        break;
      }
      case 'precios': {
        if (!unitId) break;
        if (dateFrom >= dateTo) { ctx.showToast?.('⚠️ La fecha de salida debe ser posterior al ingreso', 'warning'); break; }
        const data = await MilaData.fetchPrecios(unitId, dateFrom, dateTo);
        renderResults('🏷️ Precios', `${fmtDate(dateFrom)} → ${fmtDate(dateTo)}`, preciosHTML(data));
        break;
      }
      case 'pagos': {
        const data = await MilaData.fetchPagosPendientes();
        renderResults('💰 Pagos pendientes', '', pagosHTML(data));
        break;
      }
      case 'bloqueos': {
        const data = await MilaData.fetchBloqueos(date);
        renderResults('🔒 Bloqueos', `${fmtDate(date)}`, bloqueosHTML(data));
        break;
      }
    }
  } catch (err) {
    console.error('[MILA Assistant]', err);
    ctx.showToast?.('Error al consultar', 'error');
  } finally {
    btn.disabled = false; btn.textContent = prevLabel;
  }
}

// ── Vista de resultados ────────────────────────────
function renderResults(title, subtitle, contentHTML) {
  bodyEl.innerHTML = `
    <button class="mila-back-btn" id="mila-back">← Volver a consultas</button>
    <div class="mila-results-title">${title}</div>
    ${subtitle ? `<div class="mila-results-sub">${subtitle}</div>` : ''}
    <div class="mila-results-content">${contentHTML}</div>
  `;
  bodyEl.querySelector('#mila-back').addEventListener('click', renderList);
  bodyEl.querySelectorAll('[data-open-booking]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.openBooking;
      const opener = ctx.getBookingOpener?.();
      if (opener?.openEdit) { closePanel(); opener.openEdit(id); }
      else ctx.showToast?.('No se pudo abrir la reserva', 'warning');
    });
  });
}

function emptyState(msg) {
  return `<div class="mila-empty">✓ ${msg}</div>`;
}

function bookingCard({ id, title, lines, badge }) {
  return `
    <div class="mila-card">
      <div class="mila-card-head">
        <span class="mila-card-title">${title}</span>
        ${badge ? `<span class="mila-badge-pill">${badge}</span>` : ''}
      </div>
      ${lines.map(l => `<div class="mila-card-line">${l}</div>`).join('')}
      ${id ? `<button class="mila-card-btn" data-open-booking="${id}">Ver Reserva</button>` : ''}
    </div>`;
}

function checkInOutHTML(data) {
  const ins  = data.checkins.map(b  => bookingCard({ id: b.id, title: esc(b.guest), lines: [`🏠 ${esc(b.unit)}`], badge: 'Check-in' })).join('');
  const outs = data.checkouts.map(b => bookingCard({ id: b.id, title: esc(b.guest), lines: [`🏠 ${esc(b.unit)}`], badge: 'Check-out' })).join('');
  if (!ins && !outs) return emptyState('Sin movimientos en esa fecha');
  return `
    ${data.checkins.length ? `<div class="mila-group-label">Check-ins (${data.checkins.length})</div>${ins}` : ''}
    ${data.checkouts.length ? `<div class="mila-group-label">Check-outs (${data.checkouts.length})</div>${outs}` : ''}
  `;
}

function reservasHTML(list) {
  if (!list.length) return emptyState('Sin reservas activas en esa fecha');
  return list.map(b => bookingCard({
    id: b.id, title: esc(b.guest),
    lines: [
      `🏠 ${esc(b.unit)}`,
      `📅 ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`,
      b.balance > 0 ? `💸 Saldo: ${formatARS(b.balance)}` : `✅ Pagado`,
    ],
    badge: b.status,
  })).join('');
}

function disponibilidadHTML(list) {
  if (!list.length) return emptyState('No hay departamentos configurados');
  return `<div class="mila-avail-grid">${list.map(u => `
    <div class="mila-avail-item ${u.available ? 'is-free' : 'is-busy'}">
      <span>${esc(u.name)}</span>
      <span class="mila-avail-tag">${u.available ? 'Disponible' : 'Ocupado'}</span>
    </div>`).join('')}</div>`;
}

function facturacionHTML(d) {
  return `
    <div class="mila-stat-grid">
      <div class="mila-stat"><div class="mila-stat-label">Monto Total</div><div class="mila-stat-value">${formatARS(d.total)}</div></div>
      <div class="mila-stat"><div class="mila-stat-label">Cobrado</div><div class="mila-stat-value">${formatARS(d.cobrado)}</div></div>
      <div class="mila-stat"><div class="mila-stat-label">Reservas</div><div class="mila-stat-value">${d.count}</div></div>
      <div class="mila-stat"><div class="mila-stat-label">Promedio</div><div class="mila-stat-value">${formatARS(d.promedio)}</div></div>
    </div>`;
}

function ocupacionHTML(d) {
  return `
    <div class="mila-occ-circle">
      <div class="mila-occ-pct">${d.pct}%</div>
      <div class="mila-occ-label">Ocupación</div>
    </div>
    <div class="mila-stat-grid">
      <div class="mila-stat"><div class="mila-stat-label">Noches ocupadas</div><div class="mila-stat-value">${d.occupiedNights}</div></div>
      <div class="mila-stat"><div class="mila-stat-label">Noches disponibles</div><div class="mila-stat-value">${d.totalUnitNights}</div></div>
    </div>`;
}

function preciosHTML(d) {
  if (!d) return emptyState('Departamento no encontrado');
  return `
    <div class="mila-stat-grid">
      <div class="mila-stat"><div class="mila-stat-label">Departamento</div><div class="mila-stat-value">${esc(d.unitName)}</div></div>
      <div class="mila-stat"><div class="mila-stat-label">Noches</div><div class="mila-stat-value">${d.nights}</div></div>
      <div class="mila-stat mila-stat-wide"><div class="mila-stat-label">Total estimado</div><div class="mila-stat-value">${formatARS(d.total)}</div></div>
    </div>
    ${d.missing ? `<div class="mila-warn-note">⚠️ Algunos días del período no tienen tarifa cargada en el Cuadro Tarifario.</div>` : ''}
  `;
}

function pagosHTML(list) {
  if (!list.length) return emptyState('No hay pagos pendientes');
  return list.map(b => bookingCard({
    id: b.id, title: esc(b.guest),
    lines: [`🏠 ${esc(b.unit)}`, `📅 ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`],
    badge: formatARS(b.balance),
  })).join('');
}

function bloqueosHTML(list) {
  if (!list.length) return emptyState('Sin bloqueos en esa fecha');
  return list.map(b => bookingCard({
    id: b.id, title: esc(b.unit),
    lines: [`📅 ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`, `📝 ${esc(b.reason)}`],
    badge: 'Bloqueado',
  })).join('');
}
