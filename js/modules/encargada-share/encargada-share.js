// ═══════════════════════════════════════════════════
// encargada-share.js — Modal independiente
// "Compartir con Encargada" desde la lista de reservas
// No modifica booking-list.js ni ninguna otra lógica
// ═══════════════════════════════════════════════════
import {
  generateEncargadaPDF,
  generateEncargadaWhatsApp,
  MANAGER_PHONE,
} from './encargada-content.js';
import { showToast, localToday } from '../../supabase-config.js';
import { isDemo } from '../../auth/permissions.js';

let _initialized = false;
let _modalEl = null;
let _allBookings = []; // todas las reservas sin filtrar (para poder re-filtrar dentro del modal)

// Lee el radio realmente tildado — antes esto se leía de un <input> con
// id="enc-filter-type" que en realidad era el radio "Hoy" reutilizado como
// variable de estado (bug: al tildar otro radio, ese primero nunca se
// "destildaba" internamente, así que el filtro por rango no aplicaba bien).
function _getFilterType() {
  return _modalEl.querySelector('input[name="enc-filter-type"]:checked')?.value ?? 'created_today';
}
function _setFilterType(value) {
  const radio = _modalEl.querySelector(`input[name="enc-filter-type"][value="${value}"]`);
  if (radio) radio.checked = true;
}

export function initEncargadaShare() {
  if (_initialized) return;
  _initialized = true;
  _injectModal();
}

// ── Punto de entrada público ─────────────────────────
export function openEncargadaShare(bookings) {
  if (isDemo()) { showToast('🎭 No disponible en modo demo', 'warning'); return; }
  _allBookings = (bookings ?? []).filter(b => b.status !== 'cancelled' && b.status !== 'blocked');
  if (!_allBookings.length) { showToast('Sin reservas cargadas. Asegurate de que la lista esté visible.', 'warning'); return; }

  // Valores por defecto: "Creadas hoy"
  const today = localToday();
  _setFilterType('created_today');
  _modalEl.querySelector('#enc-from').value = today;
  _modalEl.querySelector('#enc-to').value = today;
  _modalEl.querySelector('#enc-include-amounts').checked = true;
  _modalEl.querySelector('#enc-wa-text').value = '';
  _modalEl.querySelector('#enc-preview-section').style.display = 'none';
  _updateFilterUI();
  _updateCount();
  // Mostrar el último envío registrado
  const lastSend = localStorage.getItem('mila_encargada_last_send') ?? '';
  _updateLastSendBadge(lastSend);
  _modalEl.classList.remove('hidden');
}

export function closeEncargadaShare() {
  _modalEl?.classList.add('hidden');
}

// ── Filtro aplicado ──────────────────────────────────
function _applyFilter() {
  const type = _getFilterType();
  const from = _modalEl.querySelector('#enc-from').value;
  const to   = _modalEl.querySelector('#enc-to').value;
  const today = localToday();

  return _allBookings.filter(b => {
    if (type === 'created_today') {
      const d = (b.created_at ?? '').slice(0, 10);
      return d === today;
    }
    if (type === 'created_range') {
      const d = (b.created_at ?? '').slice(0, 10);
      return (!from || d >= from) && (!to || d <= to);
    }
    if (type === 'checkin_range') {
      const ci = b.check_in ?? '';
      return (!from || ci >= from) && (!to || ci <= to);
    }
    if (type === 'checkout_range') {
      const co = b.check_out ?? '';
      return (!from || co >= from) && (!to || co <= to);
    }
    return true; // 'all'
  });
}

function _updateCount() {
  const filtered = _applyFilter();
  const count = filtered.length;
  const el = _modalEl.querySelector('#enc-count-badge');
  el.textContent = `${count} reserva${count !== 1 ? 's' : ''}`;
  el.style.color  = count > 0 ? 'var(--color-primary)' : 'var(--color-danger)';
  return filtered;
}

function _rangeLabel() {
  const type = _getFilterType();
  const from = _modalEl.querySelector('#enc-from').value;
  const to   = _modalEl.querySelector('#enc-to').value;
  const fd = (s) => s ? s.split('-').reverse().join('/') : '';
  if (type === 'created_today') return `Creadas hoy (${fd(localToday())})`;
  if (type === 'created_range') return `Creadas ${fd(from)}${to && to !== from ? ' → ' + fd(to) : ''}`;
  if (type === 'checkin_range') return `Check-in ${fd(from)}${to && to !== from ? ' → ' + fd(to) : ''}`;
  if (type === 'checkout_range') return `Check-out ${fd(from)}${to && to !== from ? ' → ' + fd(to) : ''}`;
  return 'Todas las reservas';
}

function _updateFilterUI() {
  const type     = _getFilterType();
  const rangeRow = _modalEl.querySelector('#enc-range-row');
  const fromLbl  = _modalEl.querySelector('#enc-from-label');
  const toLbl    = _modalEl.querySelector('#enc-to-label');
  const today    = localToday();

  if (type === 'created_today' || type === 'all') {
    rangeRow.style.display = 'none';
  } else {
    rangeRow.style.display = 'grid';
    // Prellenar fechas según el tipo si están vacías
    if (!_modalEl.querySelector('#enc-from').value) {
      _modalEl.querySelector('#enc-from').value = today;
      _modalEl.querySelector('#enc-to').value   = today;
    }
    if (type === 'created_range')  { fromLbl.textContent = 'Desde (creación)';  toLbl.textContent = 'Hasta (creación)'; }
    if (type === 'checkin_range')  { fromLbl.textContent = 'Check-in desde';    toLbl.textContent = 'Check-in hasta'; }
    if (type === 'checkout_range') { fromLbl.textContent = 'Check-out desde';   toLbl.textContent = 'Check-out hasta'; }
  }
  // Limpiar vista previa al cambiar filtro
  _modalEl.querySelector('#enc-wa-text').value = '';
  _modalEl.querySelector('#enc-preview-section').style.display = 'none';
}

// ── Inyección del modal ──────────────────────────────
function _injectModal() {
  const el = document.createElement('div');
  el.id = 'overlay-encargada';
  el.className = 'modal-overlay hidden';
  el.innerHTML = `
    <div class="modal" id="modal-encargada" style="max-width:500px;max-height:92vh;overflow-y:auto">
      <div class="modal-header">
        <h3 class="modal-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="vertical-align:-3px;margin-right:6px"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Compartir con Encargada
        </h3>
        <button class="modal-close" id="enc-close-x">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="modal-body" style="gap:16px">

        <!-- 1. Filtro: ¿qué reservas mandar? -->
        <div class="enc-section">
          <div class="enc-section-title">📋 ¿Qué reservas querés compartir?</div>

          <div class="enc-filter-chips" id="enc-filter-chips">
            <label class="enc-chip">
              <input type="radio" name="enc-filter-type" value="created_today" checked>
              <span>🕐 Hoy</span>
            </label>
            <label class="enc-chip">
              <input type="radio" name="enc-filter-type" value="created_range">
              <span>📅 Rango</span>
            </label>
            <label class="enc-chip">
              <input type="radio" name="enc-filter-type" value="checkin_range">
              <span>🏠 Check-in</span>
            </label>
            <label class="enc-chip">
              <input type="radio" name="enc-filter-type" value="checkout_range">
              <span>🚪 Check-out</span>
            </label>
            <label class="enc-chip">
              <input type="radio" name="enc-filter-type" value="all">
              <span>📦 Todas</span>
            </label>
          </div>

          <!-- Selector de rango (oculto cuando no aplica) -->
          <div id="enc-range-row" style="display:none;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
            <div>
              <label id="enc-from-label" style="font-size:.7rem;color:var(--color-text-3);display:block;margin-bottom:3px">Desde</label>
              <input type="date" id="enc-from" class="form-input" style="font-size:.82rem">
            </div>
            <div>
              <label id="enc-to-label" style="font-size:.7rem;color:var(--color-text-3);display:block;margin-bottom:3px">Hasta</label>
              <input type="date" id="enc-to" class="form-input" style="font-size:.82rem">
            </div>
          </div>

          <!-- Resultado del filtro -->
          <div class="enc-count-row">
            <span id="enc-count-badge" class="enc-count-badge">—</span>
            <span style="font-size:.74rem;color:var(--color-text-3)">seleccionadas con el filtro</span>
          </div>
        </div>

        <!-- 2. Opción importes -->
        <div class="enc-section">
          <div class="enc-section-title">💰 Modo de envío</div>
          <label class="enc-check-label">
            <input type="checkbox" id="enc-include-amounts" checked>
            <span class="enc-check-text">Incluir importe a cobrar al ingreso</span>
          </label>
          <p class="enc-check-hint">
            ✅ <strong>Activado</strong> → la encargada recibe el pago y ve el monto pendiente.<br>
            🧹 <strong>Desactivado</strong> → modo <em>solo limpieza</em>: muestra el día que tiene que ir a limpiar (check-out), sin ningún dato económico.
          </p>
        </div>

        <!-- 3. Destinatario -->
        <div class="enc-section">
          <div class="enc-section-title">📱 Destinatario</div>
          <input type="tel" id="enc-wa-phone" class="form-input" value="${MANAGER_PHONE}" style="font-size:.85rem">
          <p style="font-size:.7rem;color:var(--color-text-3);margin-top:3px">Número de WhatsApp predeterminado. Podés modificarlo antes de enviar.</p>
        </div>

        <div id="enc-preview-section" style="display:none">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <div>
              <span style="font-size:.78rem;font-weight:700;color:var(--color-text)">Mensaje generado</span>
              <span style="font-size:.7rem;color:#0284c7;margin-left:8px">✏️ Podés editar antes de enviar</span>
            </div>
            <button id="enc-copy-btn" class="btn btn-outline btn-sm" style="font-size:.7rem;padding:3px 8px">📋 Copiar</button>
          </div>
          <textarea id="enc-wa-text" rows="14" class="wa-textarea"
            style="font-size:.72rem;font-family:monospace;width:100%;resize:vertical;
                   border:1.5px solid var(--color-border);border-radius:8px;padding:10px 12px;
                   background:var(--color-surface);color:var(--color-text);line-height:1.7;
                   transition:border-color .15s"
            onfocus="this.style.borderColor='var(--color-primary)'"
            onblur="this.style.borderColor='var(--color-border)'"></textarea>
        </div>

        <!-- 5. Aviso sobre PDF -->
        <div class="enc-wa-notice">
          <strong>ℹ️ PDF:</strong> WhatsApp Web no permite adjuntar archivos automáticamente.
          El PDF se abre en nueva pestaña → guardarlo con Ctrl+P → "Guardar como PDF" → adjuntarlo al chat.
        </div>

      </div>

      <div class="modal-footer" style="justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
        <div id="enc-last-send" style="font-size:.7rem;color:var(--color-text-3);display:none"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline" id="enc-close-btn">Cerrar</button>
        <button class="btn btn-outline" id="enc-gen-pdf-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Generar PDF
        </button>
        <button class="btn btn-outline" id="enc-gen-wa-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          Ver mensaje
        </button>
        <button class="btn btn-primary" id="enc-send-wa-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Abrir WhatsApp
        </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  _modalEl = el;
  _bindEvents();
}

function _bindEvents() {
  _modalEl.querySelector('#enc-close-x').addEventListener('click', closeEncargadaShare);
  _modalEl.querySelector('#enc-close-btn').addEventListener('click', closeEncargadaShare);
  _modalEl.addEventListener('click', (e) => { if (e.target === _modalEl) closeEncargadaShare(); });

  // Chips de filtro — usan radio buttons; escuchar change en el fieldset padre
  _modalEl.querySelector('#enc-filter-chips').addEventListener('change', () => {
    // Sincronizar el select oculto (compatibilidad con _updateFilterUI)
    _updateFilterUI();
    _updateCount();
  });

  // Rango de fechas
  _modalEl.querySelectorAll('#enc-from, #enc-to').forEach(input => {
    input.addEventListener('change', () => _updateCount());
  });

  // Checkbox importes → limpiar preview
  _modalEl.querySelector('#enc-include-amounts').addEventListener('change', () => {
    _modalEl.querySelector('#enc-wa-text').value = '';
    _modalEl.querySelector('#enc-preview-section').style.display = 'none';
  });

  // PDF
  _modalEl.querySelector('#enc-gen-pdf-btn').addEventListener('click', () => {
    const filtered = _applyFilter();
    if (!filtered.length) { showToast('No hay reservas con ese filtro', 'warning'); return; }
    const includeAmounts = _modalEl.querySelector('#enc-include-amounts').checked;
    const ok = generateEncargadaPDF(filtered, _rangeLabel(), includeAmounts);
    if (!ok) showToast('Habilitá ventanas emergentes para generar el PDF', 'warning');
    else showToast(`✓ PDF abierto (${filtered.length} reservas) — usá Ctrl+P para guardar`, 'success');
  });

  // Ver mensaje
  _modalEl.querySelector('#enc-gen-wa-btn').addEventListener('click', () => {
    const filtered = _applyFilter();
    if (!filtered.length) { showToast('No hay reservas con ese filtro', 'warning'); return; }
    const includeAmounts = _modalEl.querySelector('#enc-include-amounts').checked;
    const text = generateEncargadaWhatsApp(filtered, _rangeLabel(), includeAmounts);
    const textarea = _modalEl.querySelector('#enc-wa-text');
    textarea.value = text;
    // Modo limpieza → editable para agregar notas por depto
    textarea.readOnly = false;
    if (!includeAmounts) {
      textarea.style.border = '1.5px solid var(--color-primary)';
      textarea.title = 'Podés editar este texto — completá las líneas NOTA: antes de enviar';
    } else {
      textarea.style.border = '';
    }
    const hint = _modalEl.querySelector('#enc-editable-hint');
    if (hint) hint.style.display = includeAmounts ? 'none' : 'inline';
    const section = _modalEl.querySelector('#enc-preview-section');
    section.style.display = 'block';
    setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    showToast(includeAmounts
      ? `✓ Mensaje generado (${filtered.length} reservas)`
      : `✓ Generado · Completá las líneas NOTA: antes de enviar`, 'success');
  });

  // Copiar
  _modalEl.querySelector('#enc-copy-btn').addEventListener('click', () => {
    const text = _modalEl.querySelector('#enc-wa-text').value;
    if (!text) return;
    navigator.clipboard?.writeText(text)
      .then(() => showToast('✓ Copiado', 'success'))
      .catch(() => {
        _modalEl.querySelector('#enc-wa-text').select();
        document.execCommand('copy');
        showToast('✓ Copiado', 'success');
      });
  });

  // Abrir WhatsApp
  _modalEl.querySelector('#enc-send-wa-btn').addEventListener('click', () => {
    const filtered = _applyFilter();
    if (!filtered.length) { showToast('No hay reservas con ese filtro', 'warning'); return; }
    const includeAmounts = _modalEl.querySelector('#enc-include-amounts').checked;
    let text = _modalEl.querySelector('#enc-wa-text').value;
    if (!text) {
      text = generateEncargadaWhatsApp(filtered, _rangeLabel(), includeAmounts);
      _modalEl.querySelector('#enc-wa-text').value = text;
      _modalEl.querySelector('#enc-preview-section').style.display = 'block';
    }
    const phone = _modalEl.querySelector('#enc-wa-phone').value.trim().replace(/\D/g, '');
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');

    // Registrar el último envío en localStorage para no mandar dos veces sin querer
    const now = new Date();
    const label = now.toLocaleDateString('es-AR', { weekday:'short', day:'2-digit', month:'2-digit' })
      + ' ' + now.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
    localStorage.setItem('mila_encargada_last_send', label);
    _updateLastSendBadge(label);
    showToast('✓ Abriendo WhatsApp…', 'success');
  });
}

function _updateLastSendBadge(label) {
  const badge = _modalEl?.querySelector('#enc-last-send');
  if (!badge) return;
  badge.textContent = label ? `Último envío: ${label}` : '';
  badge.style.display = label ? 'block' : 'none';
}
