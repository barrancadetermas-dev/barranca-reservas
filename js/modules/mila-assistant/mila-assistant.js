// ══════════════════════════════════════════════════
// mila-assistant.js — "🤖 Preguntale a MILA"
// Módulo 100% independiente, vive en su propio tab de
// sidebar (#section-mila). No modifica calendario,
// reservas, disponibilidad, estadísticas ni navegación
// existentes. Reutiliza la lógica del sistema a través
// de mila-data.js (mismas consultas, mismos criterios).
// ══════════════════════════════════════════════════
import { AppContext, formatARS, localToday, localDateISO } from '../../supabase-config.js';
import { Sound } from '../../services/sound-service.js';
import * as MilaData from './mila-data.js';

let ctx = null;       // { can, isDemo, showToast, getBookingOpener }
let bodyEl = null;
let answerEl = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const fmtDate  = (iso) => { if (!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };
const MES_CORTO = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const fmtShort = (iso) => { if (!iso) return '—'; const [, m, d] = iso.split('-').map(Number); return `${d} ${MES_CORTO[m-1]}`; };
const addDays = (iso, n) => localDateISO(new Date(new Date(iso + 'T12:00:00').getTime() + n * 86400000));
const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

// ── Íconos SVG (en vez de emoji — render consistente entre OS/navegadores) ──
const ICON_PATHS = {
  checkinout:  '<polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/>',
  reservas:    '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 2h6a1 1 0 011 1v2H8V3a1 1 0 011-1z"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="15" y2="15"/>',
  disponib:    '<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 001 1h12a1 1 0 001-1V9.5"/>',
  facturacion: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
  ocupacion:   '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  precios:     '<path d="M20.59 13.41L11 22.99 1 13l10-10h9c.55 0 1 .45 1 1v9.41z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  pagos:       '<rect x="1.5" y="5" width="21" height="14" rx="2"/><line x1="1.5" y1="10" x2="22.5" y2="10"/>',
  bloqueos:    '<rect x="3.5" y="11" width="17" height="10" rx="2"/><path d="M7 11V7.5a5 5 0 0110 0V11"/>',
  brand:       '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="13.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="13.5" r="1.3" fill="currentColor" stroke="none"/><path d="M2 12.5h2"/><path d="M20 12.5h2"/>',
  suitcase:    '<rect x="3" y="9" width="18" height="12" rx="2.5"/><path d="M8 9V6.5A1.5 1.5 0 019.5 5h5A1.5 1.5 0 0116 6.5V9"/><path d="M3 14h18"/><path d="M10 14v1.6"/><path d="M14 14v1.6"/>',
  bulb:        '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 00-3.6 10.8c.5.4.8 1 .8 1.6V16h5.6v-.6c0-.6.3-1.2.8-1.6A6 6 0 0012 3z"/>',
  send:        '<line x1="11" y1="13" x2="21" y2="3"/><path d="M21 3l-7 18-3.5-7.5L3 10z"/>',
};
const TIPS = [
  'Podés consultar reservas usando solo una fecha.',
  'Tocá cualquier campo y la respuesta se actualiza sola, sin botones extra.',
  'En "Disponibilidad" solo necesitás definir el ingreso — la salida se ajusta sola a 1 noche.',
  'Desde el voucher de una reserva podés verla completa con un solo toque.',
  'Podés limpiar una respuesta con la ✕ y volver a las consultas rápidas.',
];
const pickTip = () => TIPS[Math.floor(Math.random() * TIPS.length)];
const iconSVG = (id, size = 16) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}">${ICON_PATHS[id]}</svg>`;

// type: 'date' (1 fecha) | 'range' (ingreso/salida, 1 noche por defecto) |
// 'period' (desde/hasta libre) | 'preset' (dropdown de período) |
// 'unit-range' (depto + rango) | 'none' (sin campos)
const QUERIES = [
  { id: 'checkinout',  color: 'cyan',   title: 'Check-ins / Check-outs', sub: 'Ver movimientos en una fecha',  type: 'date' },
  { id: 'reservas',    color: 'blue',   title: 'Reservas',                sub: 'Ver reservas en una fecha',     type: 'date' },
  { id: 'disponib',    color: 'green',  title: 'Disponibilidad',          sub: 'Ver departamentos disponibles', type: 'range' },
  { id: 'facturacion', color: 'orange', title: 'Facturación',             sub: 'Ver facturación en un período', type: 'period' },
  { id: 'ocupacion',   color: 'purple', title: 'Ocupación',               sub: 'Ver ocupación en un período',   type: 'preset' },
  { id: 'precios',     color: 'pink',   title: 'Precios',                 sub: 'Consultar precios por fecha',   type: 'unit-range' },
  { id: 'pagos',       color: 'amber',  title: 'Pagos pendientes',        sub: 'Ver pagos que faltan cobrar',   type: 'none' },
  { id: 'bloqueos',    color: 'indigo', title: 'Bloqueos',                sub: 'Ver bloqueos en una fecha',     type: 'date' },
];

const PRESETS = {
  this_month: () => { const d = new Date(), y = d.getFullYear(), m = d.getMonth(); return { label: 'Este mes',          from: localDateISO(new Date(y, m, 1)),     to: localDateISO(new Date(y, m + 1, 0)) }; },
  last_month: () => { const d = new Date(), y = d.getFullYear(), m = d.getMonth(); return { label: 'Mes pasado',        from: localDateISO(new Date(y, m - 1, 1)), to: localDateISO(new Date(y, m, 0)) }; },
  next_30:    () => { const today = localToday(); return { label: 'Próximos 30 días', from: today, to: addDays(today, 30) }; },
};

// Estado de los campos por fila (en memoria, no persiste entre sesiones)
const fieldState = {};
let lastQueryId = null;

export function initMilaAssistant(options = {}) {
  ctx = options;
  bodyEl = document.getElementById('mila-container');
  if (!bodyEl || bodyEl.dataset.milaInit) return; // ya inicializado o sección inexistente
  bodyEl.dataset.milaInit = '1';
  renderPage();
}

function initState(q, todayISO) {
  if (fieldState[q.id]) return fieldState[q.id];
  const s = {};
  if (q.type === 'date')       s.date = todayISO;
  if (q.type === 'range')      { s.from = todayISO; s.to = addDays(todayISO, 1); s.toEdited = false; }
  if (q.type === 'period')     { const d = new Date(); s.from = localDateISO(new Date(d.getFullYear(), d.getMonth(), 1)); s.to = todayISO; }
  if (q.type === 'unit-range') { s.unitId = (AppContext.units ?? [])[0]?.id ?? ''; s.from = todayISO; s.to = addDays(todayISO, 1); s.toEdited = false; }
  if (q.type === 'preset')     s.preset = 'this_month';
  fieldState[q.id] = s;
  return s;
}

// ── Página completa: hero + 2 columnas (preguntas | respuesta dinámica) ──
function renderPage() {
  const todayISO = localToday();
  bodyEl.innerHTML = `
    <div class="mila-page">
      <div class="mila-deco" aria-hidden="true">
        <span class="mila-deco-blob mila-deco-blob-1"></span>
        <span class="mila-deco-blob mila-deco-blob-2"></span>
        <span class="mila-deco-spark mila-deco-spark-1">✦</span>
        <span class="mila-deco-spark mila-deco-spark-2">✧</span>
        <span class="mila-deco-spark mila-deco-spark-3">✦</span>
      </div>

      <div class="mila-hero">
        <div class="mila-hero-text">
          <div class="mila-hero-greet">👋 Hola, soy Mila</div>
          <div class="mila-hero-question">¿Qué te gustaría consultar hoy?</div>
        </div>
        <span class="mila-hero-bot">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="34" height="34">${ICON_PATHS.brand}</svg>
        </span>
      </div>

      <div class="mila-grid">
        <div class="mila-left">
          <div class="mila-section-label"><span class="mila-live-dot"></span>Consultas rápidas <span class="mila-beta">BETA</span></div>
          <div class="mila-rows">
            ${QUERIES.map((q, i) => rowTemplate(q, todayISO, i)).join('')}
          </div>

          ${tipCardHTML()}

          <div class="mila-soon-card">
            <span class="mila-soon-bot">✨</span>
            <div class="mila-soon-body">
              <div class="mila-soon-title">Próximamente</div>
              <div class="mila-soon-text">Escribí o hablá con MILA AI. Muy pronto vas a poder realizar consultas en lenguaje natural utilizando Inteligencia Artificial.</div>
              <div class="mila-soon-input-row">
                <input type="text" class="mila-soon-input" placeholder="Escribí tu consulta..." disabled>
                <button class="mila-soon-mic" disabled title="Próximamente">🎙️</button>
                <button class="mila-soon-send" disabled title="Próximamente">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">${ICON_PATHS.send}</svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="mila-connector" aria-hidden="true">
          <span class="mila-connector-dot"></span>
          <span class="mila-connector-dot"></span>
          <span class="mila-connector-dot"></span>
          <svg class="mila-connector-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>
        </div>

        <div class="mila-right">
          <div class="mila-quickstats" id="mila-quickstats">${quickStatsSkeleton()}</div>
          <div class="mila-answer" id="mila-answer">${answerPlaceholder()}</div>
        </div>
      </div>
    </div>
  `;
  answerEl = bodyEl.querySelector('#mila-answer');
  bodyEl.querySelectorAll('.mila-row').forEach(rowEl => attachRow(rowEl, todayISO));
  loadQuickStats(todayISO);
}

// ── Tip de Mila — tarjeta lateral con un consejo aleatorio por apertura ──
function tipCardHTML() {
  return `
    <div class="mila-tip-card">
      <span class="mila-tip-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">${ICON_PATHS.bulb}</svg></span>
      <div>
        <div class="mila-tip-title">Tip de Mila</div>
        <div class="mila-tip-text">${esc(pickTip())}</div>
      </div>
    </div>`;
}

// ── Resumen rápido (lateral derecho) — esqueleto mientras carga ──
const QUICKSTAT_DEFS = [
  { key: 'checkins',  icon: 'checkinout', label: 'Check-ins hoy' },
  { key: 'checkouts', icon: 'checkinout', label: 'Check-outs hoy' },
  { key: 'disponibles', icon: 'disponib', label: 'Disponibles hoy' },
  { key: 'ocupacion', icon: 'ocupacion', label: 'Ocupación del mes' },
];
function quickStatsSkeleton() {
  return QUICKSTAT_DEFS.map(s => `
    <div class="mila-qstat" data-stat="${s.key}">
      <span class="mila-qstat-icon">${iconSVG(s.icon, 13)}</span>
      <div class="mila-qstat-value mila-qstat-loading">···</div>
      <div class="mila-qstat-label">${s.label}</div>
    </div>`).join('');
}
async function loadQuickStats(todayISO) {
  try {
    const { from, to } = PRESETS.this_month();
    const [movs, disp, occ] = await Promise.all([
      MilaData.fetchCheckInsOuts(todayISO),
      MilaData.fetchDisponibilidad(todayISO, addDays(todayISO, 1)),
      MilaData.fetchOcupacion(from, to),
    ]);
    const values = {
      checkins: movs.checkins.length,
      checkouts: movs.checkouts.length,
      disponibles: disp.filter(u => u.available).length,
      ocupacion: `${occ.pct}%`,
    };
    const wrap = document.getElementById('mila-quickstats');
    if (!wrap) return;
    Object.entries(values).forEach(([key, val]) => {
      const el = wrap.querySelector(`[data-stat="${key}"] .mila-qstat-value`);
      if (el) { el.textContent = val; el.classList.remove('mila-qstat-loading'); }
    });
  } catch (err) {
    console.error('[MILA Assistant] quickstats', err);
  }
}

function answerPlaceholder() {
  return `
    <div class="mila-answer-empty">
      <span class="mila-answer-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="34" height="34">${ICON_PATHS.brand}</svg></span>
      <div class="mila-answer-empty-title">Elegí una consulta</div>
      <div class="mila-answer-empty-text">Las respuestas van a aparecer acá al instante, sin cambiar de pantalla.</div>
    </div>`;
}

const colorClass = (c) => `mila-ic-${c}`;

function pillHTML(field, label, value) {
  const text = value ? fmtShort(value) : label;
  return `<button type="button" class="mila-pill mila-date-pill" data-field="${field}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    <span>${esc(text)}</span>
    <input type="date" class="mila-pill-input" value="${value || ''}" tabindex="-1">
  </button>`;
}

function rowTemplate(q, todayISO, idx = null) {
  const s = initState(q, todayISO);
  let controls = '';
  switch (q.type) {
    case 'date':
      controls = pillHTML('date', 'Elegir fecha', s.date);
      break;
    case 'range':
      controls = pillHTML('from', 'Ingreso', s.from) + pillHTML('to', 'Salida', s.to);
      break;
    case 'period':
      controls = pillHTML('from', 'Desde', s.from) + pillHTML('to', 'Hasta', s.to);
      break;
    case 'unit-range': {
      const units = (AppContext.units ?? []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      controls = `
        <select class="mila-pill mila-select" data-field="unitId">
          ${units.map(u => `<option value="${u.id}" ${u.id === s.unitId ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select>
        ${pillHTML('from', 'Ingreso', s.from)}${pillHTML('to', 'Salida', s.to)}`;
      break;
    }
    case 'preset':
      controls = `
        <select class="mila-pill mila-select" data-field="preset">
          ${Object.entries(PRESETS).map(([k, fn]) => `<option value="${k}" ${k === s.preset ? 'selected' : ''}>${fn().label}</option>`).join('')}
        </select>`;
      break;
    case 'none':
      controls = `<span class="mila-chevron">›</span>`;
      break;
  }
  const isActive = lastQueryId === q.id ? ' is-active' : '';
  const enterCls = idx !== null ? ' mila-row-enter' : '';
  const styleAttr = idx !== null ? ` style="--i:${idx}"` : '';
  return `
    <div class="mila-row${isActive}${enterCls}" data-query="${q.id}" tabindex="0" role="button"${styleAttr}>
      <span class="mila-row-icon ${colorClass(q.color)}">${iconSVG(q.id)}</span>
      <div class="mila-row-text">
        <div class="mila-row-title">${q.title}</div>
        <div class="mila-row-sub">${q.sub}</div>
      </div>
      <div class="mila-row-controls">${controls}</div>
    </div>`;
}

// Conecta los eventos de una fila (pills, selects, click general). Se usa
// tanto en el render inicial como al re-pintar una fila tras elegir fecha.
function attachRow(rowEl, todayISO) {
  const queryId = rowEl.dataset.query;
  const q = QUERIES.find(x => x.id === queryId);
  const s = fieldState[queryId];

  rowEl.querySelectorAll('.mila-date-pill[data-field]').forEach(pill => {
    const field = pill.dataset.field;
    const input = pill.querySelector('.mila-pill-input');
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      if (input.showPicker) { try { input.showPicker(); return; } catch { /* fallback abajo */ } }
      input.focus(); input.click();
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', (e) => {
      e.stopPropagation();
      const val = input.value;
      if (!val) return;
      s[field] = val;
      // 1 noche por defecto: si todavía no se tocó "Salida", sigue a "Ingreso"
      if (field === 'from' && (q.type === 'range' || q.type === 'unit-range') && !s.toEdited) s.to = addDays(val, 1);
      if (field === 'to') s.toEdited = true;
      Sound?.click?.();
      const fresh = document.createElement('div');
      fresh.innerHTML = rowTemplate(q, todayISO).trim();
      const newRow = fresh.firstElementChild;
      rowEl.replaceWith(newRow);
      attachRow(newRow, todayISO);
      runQuery(queryId); // ── auto-ejecuta al cambiar cualquier valor ──
    });
  });

  rowEl.querySelectorAll('.mila-select').forEach(sel => {
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      s[sel.dataset.field] = sel.value;
      Sound?.click?.();
      runQuery(queryId); // ── auto-ejecuta al cambiar el desplegable ──
    });
  });

  // Click en cualquier otra parte de la fila → ejecutar la consulta con los valores actuales
  rowEl.addEventListener('click', () => { Sound?.click?.(); runQuery(queryId); });
  rowEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') runQuery(queryId); });
}

function markActiveRow(queryId) {
  lastQueryId = queryId;
  bodyEl.querySelectorAll('.mila-row').forEach(r => r.classList.toggle('is-active', r.dataset.query === queryId));
}

function showLoading(q) {
  answerEl.innerHTML = `
    <div class="mila-answer-head">
      <div class="mila-answer-head-left">
        <span class="mila-answer-icon ${colorClass(q.color)}">${iconSVG(q.id)}</span>
        <div class="mila-answer-title">${esc(q.title)}</div>
      </div>
    </div>
    <div class="mila-answer-loading">
      <span class="mila-dot"></span><span class="mila-dot"></span><span class="mila-dot"></span>
    </div>`;
}

// ── Ejecutar consulta y actualizar la respuesta (misma pantalla, sin navegar) ──
async function runQuery(queryId) {
  const q = QUERIES.find(x => x.id === queryId);
  const s = fieldState[queryId];
  markActiveRow(queryId);
  showLoading(q);
  try {
    switch (queryId) {
      case 'checkinout': {
        const data = await MilaData.fetchCheckInsOuts(s.date);
        renderAnswer(q, fmtDate(s.date), checkInOutHTML(data));
        break;
      }
      case 'reservas': {
        const data = await MilaData.fetchReservasByDate(s.date);
        renderAnswer(q, fmtDate(s.date), reservasHTML(data));
        break;
      }
      case 'disponib': {
        if (s.from >= s.to) { renderAnswer(q, '', emptyState('⚠️ La fecha de salida debe ser posterior al ingreso')); return; }
        const data = await MilaData.fetchDisponibilidad(s.from, s.to);
        renderAnswer(q, `${fmtDate(s.from)} → ${fmtDate(s.to)}`, disponibilidadHTML(data));
        break;
      }
      case 'facturacion': {
        const data = await MilaData.fetchFacturacion(s.from, s.to);
        renderAnswer(q, `${fmtDate(s.from)} → ${fmtDate(s.to)}`, facturacionHTML(data));
        break;
      }
      case 'ocupacion': {
        const { label, from, to } = PRESETS[s.preset]();
        const data = await MilaData.fetchOcupacion(from, to);
        renderAnswer(q, label, ocupacionHTML(data));
        break;
      }
      case 'precios': {
        if (!s.unitId) return;
        if (s.from >= s.to) { renderAnswer(q, '', emptyState('⚠️ La fecha de salida debe ser posterior al ingreso')); return; }
        const data = await MilaData.fetchPrecios(s.unitId, s.from, s.to);
        renderAnswer(q, `${fmtDate(s.from)} → ${fmtDate(s.to)}`, preciosHTML(data));
        break;
      }
      case 'pagos': {
        const data = await MilaData.fetchPagosPendientes();
        renderAnswer(q, '', pagosHTML(data));
        break;
      }
      case 'bloqueos': {
        const data = await MilaData.fetchBloqueos(s.date);
        renderAnswer(q, fmtDate(s.date), bloqueosHTML(data));
        break;
      }
    }
  } catch (err) {
    console.error('[MILA Assistant]', err);
    renderAnswer(q, '', emptyState('Ocurrió un error al consultar. Probá de nuevo.'));
  }
}

// ── Pinta la respuesta en el panel derecho (o debajo, en mobile) ──
function renderAnswer(q, subtitle, contentHTML) {
  Sound?.success?.();
  answerEl.classList.remove('mila-answer-pop');
  answerEl.innerHTML = `
    <div class="mila-answer-head">
      <div class="mila-answer-head-left">
        <span class="mila-answer-icon ${colorClass(q.color)}">${iconSVG(q.id)}</span>
        <div>
          <div class="mila-answer-title">${esc(q.title)}</div>
          ${subtitle ? `<div class="mila-answer-sub">${subtitle}</div>` : ''}
        </div>
      </div>
      <button class="mila-answer-clear" id="mila-answer-clear" aria-label="Cerrar respuesta">✕</button>
    </div>
    <div class="mila-answer-body">${contentHTML}</div>
  `;
  void answerEl.offsetWidth; // forzar reflow para reiniciar la animación
  answerEl.classList.add('mila-answer-pop');
  answerEl.querySelector('#mila-answer-clear').addEventListener('click', () => {
    Sound?.click?.();
    lastQueryId = null;
    bodyEl.querySelectorAll('.mila-row').forEach(r => r.classList.remove('is-active'));
    answerEl.innerHTML = answerPlaceholder();
  });
  answerEl.querySelectorAll('[data-pick-date]').forEach(b => {
    b.addEventListener('click', () => {
      Sound?.click?.();
      const row = bodyEl.querySelector(`.mila-row[data-query="${b.dataset.pickDate}"]`);
      const pill = row?.querySelector('.mila-date-pill');
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      pill?.classList.add('mila-pill-flash');
      setTimeout(() => pill?.classList.remove('mila-pill-flash'), 900);
      const input = pill?.querySelector('.mila-pill-input');
      if (input?.showPicker) { try { input.showPicker(); } catch { /* noop */ } }
    });
  });
  answerEl.querySelectorAll('[data-open-booking]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.openBooking;
      const opener = ctx.getBookingOpener?.();
      if (opener?.openEdit) {
        // Abre directamente el Voucher (paso 5 del formulario), no el formulario de edición
        opener.openEdit(id).then(() => opener._goToStep?.(5));
      } else {
        ctx.showToast?.('No se pudo abrir la reserva', 'warning');
      }
    });
  });
  if (isMobile()) answerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function emptyState(msg) { return `<div class="mila-empty">${msg}</div>`; }

function richEmptyState(queryId, title, text) {
  return `
    <div class="mila-empty-rich">
      <span class="mila-empty-illust"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="46" height="46">${ICON_PATHS.suitcase}</svg></span>
      <div class="mila-empty-rich-title">${esc(title)}</div>
      <div class="mila-empty-rich-text">${esc(text)}</div>
      <button class="mila-empty-rich-btn" data-pick-date="${queryId}">Elegir otra fecha</button>
    </div>`;
}

function bookingCard({ id, title, lines, badge }) {
  return `
    <div class="mila-card">
      <div class="mila-card-head">
        <span class="mila-card-title">${title}</span>
        ${badge ? `<span class="mila-badge-pill">${badge}</span>` : ''}
      </div>
      ${lines.map(l => `<div class="mila-card-line">${l}</div>`).join('')}
      ${id ? `<button class="mila-card-btn" data-open-booking="${id}">Ver Voucher</button>` : ''}
    </div>`;
}

function checkInOutHTML(data) {
  const ins  = data.checkins.map(b  => bookingCard({ id: b.id, title: esc(b.guest), lines: [`🏠 ${esc(b.unit)}`], badge: 'Check-in' })).join('');
  const outs = data.checkouts.map(b => bookingCard({ id: b.id, title: esc(b.guest), lines: [`🏠 ${esc(b.unit)}`], badge: 'Check-out' })).join('');
  if (!ins && !outs) return richEmptyState('checkinout', 'No encontramos movimientos para esa fecha.', 'Probá con otra fecha o realizá otra consulta.');
  return `
    ${data.checkins.length ? `<div class="mila-group-label">Check-ins (${data.checkins.length})</div>${ins}` : ''}
    ${data.checkouts.length ? `<div class="mila-group-label">Check-outs (${data.checkouts.length})</div>${outs}` : ''}
  `;
}

function reservasHTML(list) {
  if (!list.length) return richEmptyState('reservas', 'No encontramos reservas para esa fecha.', 'Probá con otra fecha o realizá otra consulta.');
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
  if (!list.length) return emptyState('✓ No hay pagos pendientes');
  return list.map(b => bookingCard({
    id: b.id, title: esc(b.guest),
    lines: [`🏠 ${esc(b.unit)}`, `📅 ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`],
    badge: formatARS(b.balance),
  })).join('');
}

function bloqueosHTML(list) {
  if (!list.length) return richEmptyState('bloqueos', 'No encontramos bloqueos para esa fecha.', 'Probá con otra fecha o realizá otra consulta.');
  return list.map(b => bookingCard({
    id: b.id, title: esc(b.unit),
    lines: [`📅 ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`, `📝 ${esc(b.reason)}`],
    badge: 'Bloqueado',
  })).join('');
}
