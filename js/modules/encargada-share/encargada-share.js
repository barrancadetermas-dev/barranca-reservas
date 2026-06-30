// ═══════════════════════════════════════════════════
// encargada-share.js — Modal independiente
// "Compartir con Encargada" desde la lista de reservas
// No modifica booking-list.js ni ninguna otra lógica
// ═══════════════════════════════════════════════════
import {
  generateEncargadaPDF,
  generateEncargadaWhatsApp,
  openWhatsAppManager,
  MANAGER_PHONE,
} from './encargada-content.js';
import { showToast } from '../../supabase-config.js';
import { isDemo } from '../../auth/permissions.js';

let _initialized = false;
let _modalEl = null;
let _pending = null; // { bookings, rangeLabel }

export function initEncargadaShare() {
  if (_initialized) return;
  _initialized = true;
  _injectModal();
}

// ── Punto de entrada público ─────────────────────────
// Llamar desde el botón "Compartir con Encargada" en booking-list
export function openEncargadaShare(bookings, rangeLabel) {
  if (isDemo()) { showToast('🎭 No disponible en modo demo', 'warning'); return; }
  const valid = (bookings ?? []).filter(b => b.status !== 'cancelled' && b.status !== 'blocked');
  if (!valid.length) { showToast('Sin reservas para compartir', 'warning'); return; }

  _pending = { bookings: valid, rangeLabel: rangeLabel ?? '' };
  _modalEl.querySelector('#enc-count').textContent = `${valid.length} reserva${valid.length !== 1 ? 's' : ''}`;
  _modalEl.querySelector('#enc-range').textContent = rangeLabel ?? '';
  _modalEl.querySelector('#enc-include-amounts').checked = true;
  _modalEl.querySelector('#enc-wa-text').value = '';
  _modalEl.querySelector('#enc-preview-section').style.display = 'none';
  _modalEl.classList.remove('hidden');
}

export function closeEncargadaShare() {
  _modalEl?.classList.add('hidden');
  _pending = null;
}

// ── Inyección del modal ──────────────────────────────
function _injectModal() {
  const el = document.createElement('div');
  el.id = 'overlay-encargada';
  el.className = 'modal-overlay hidden';
  el.innerHTML = `
    <div class="modal" id="modal-encargada" style="max-width:500px;max-height:90vh;overflow-y:auto">
      <div class="modal-header">
        <h3 class="modal-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="vertical-align:-3px;margin-right:6px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          Compartir con Encargada
        </h3>
        <button class="modal-close" id="enc-close-x">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body" style="gap:14px">

        <!-- Info del rango -->
        <div class="enc-share-info">
          <span id="enc-count" class="enc-share-count"></span>
          <span id="enc-range" class="enc-share-range"></span>
        </div>

        <!-- Opción de importes -->
        <div class="enc-option-row">
          <label class="enc-check-label">
            <input type="checkbox" id="enc-include-amounts" checked>
            <span class="enc-check-text">☑ Incluir importes a cobrar</span>
          </label>
          <p class="enc-check-hint">Si está desactivado, no se muestra ningún dato económico.</p>
        </div>

        <!-- Destinatario -->
        <div class="enc-dest-row">
          <label class="form-label" style="font-size:.78rem;margin-bottom:4px">
            📱 Número de WhatsApp de la encargada
          </label>
          <input
            type="tel"
            id="enc-wa-phone"
            class="form-input"
            value="${MANAGER_PHONE}"
            placeholder="+54 9 3447 44-8135"
            style="font-size:.85rem"
          >
          <p style="font-size:.7rem;color:var(--color-text-3);margin-top:3px">Número predeterminado. Podés modificarlo antes de enviar.</p>
        </div>

        <!-- Vista previa del mensaje (oculta al inicio) -->
        <div id="enc-preview-section" style="display:none">
          <label class="form-label" style="font-size:.78rem;margin-bottom:4px">
            Mensaje generado
            <button id="enc-copy-btn" class="btn btn-outline btn-sm" style="float:right;font-size:.7rem;padding:3px 8px">
              📋 Copiar
            </button>
          </label>
          <textarea
            id="enc-wa-text"
            rows="10"
            class="wa-textarea"
            readonly
            style="font-size:.72rem;font-family:monospace;width:100%;resize:vertical"
          ></textarea>
        </div>

        <!-- Aviso WhatsApp -->
        <div class="enc-wa-notice">
          <strong>ℹ️ Sobre el PDF:</strong> WhatsApp Web no permite adjuntar archivos automáticamente.
          El PDF se abrirá en una nueva pestaña para que lo descargues (Ctrl+P o Guardar como PDF).
          Luego sólo tenés que adjuntarlo manualmente al chat.
        </div>
      </div>
      <div class="modal-footer" style="justify-content:flex-end;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline" id="enc-close-btn">Cerrar</button>
        <button class="btn btn-outline" id="enc-gen-wa-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          Generar mensaje
        </button>
        <button class="btn btn-outline" id="enc-gen-pdf-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Generar PDF
        </button>
        <button class="btn btn-primary" id="enc-send-wa-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Enviar por WhatsApp
        </button>
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

  _modalEl.querySelector('#enc-gen-pdf-btn').addEventListener('click', () => {
    if (!_pending) return;
    const includeAmounts = _modalEl.querySelector('#enc-include-amounts').checked;
    const ok = generateEncargadaPDF(_pending.bookings, _pending.rangeLabel, includeAmounts);
    if (!ok) showToast('Permitir ventanas emergentes para generar el PDF', 'warning');
    else showToast('✓ PDF abierto en nueva pestaña — guardalo con Ctrl+P → Guardar como PDF', 'success');
  });

  _modalEl.querySelector('#enc-gen-wa-btn').addEventListener('click', () => {
    if (!_pending) return;
    const includeAmounts = _modalEl.querySelector('#enc-include-amounts').checked;
    const text = generateEncargadaWhatsApp(_pending.bookings, _pending.rangeLabel, includeAmounts);
    const textarea = _modalEl.querySelector('#enc-wa-text');
    textarea.value = text;
    const section = _modalEl.querySelector('#enc-preview-section');
    section.style.display = 'block';
    setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    showToast('✓ Mensaje generado', 'success');
  });

  _modalEl.querySelector('#enc-copy-btn').addEventListener('click', () => {
    const textarea = _modalEl.querySelector('#enc-wa-text');
    if (!textarea.value) return;
    navigator.clipboard?.writeText(textarea.value)
      .then(() => showToast('✓ Copiado al portapapeles', 'success'))
      .catch(() => {
        textarea.select();
        document.execCommand('copy');
        showToast('✓ Copiado', 'success');
      });
  });

  _modalEl.querySelector('#enc-send-wa-btn').addEventListener('click', () => {
    if (!_pending) return;
    const includeAmounts = _modalEl.querySelector('#enc-include-amounts').checked;
    const phone = _modalEl.querySelector('#enc-wa-phone').value.trim();
    // Generar el texto si no está ya generado
    let text = _modalEl.querySelector('#enc-wa-text').value;
    if (!text) {
      text = generateEncargadaWhatsApp(_pending.bookings, _pending.rangeLabel, includeAmounts);
      _modalEl.querySelector('#enc-wa-text').value = text;
      _modalEl.querySelector('#enc-preview-section').style.display = 'block';
    }
    const cleaned = phone.replace(/\D/g, '');
    const url = `https://wa.me/${cleaned}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    showToast('✓ Abriendo WhatsApp…', 'success');
  });

  // Checkbox cambia → limpiar la vista previa para que se regenere
  _modalEl.querySelector('#enc-include-amounts').addEventListener('change', () => {
    _modalEl.querySelector('#enc-wa-text').value = '';
    _modalEl.querySelector('#enc-preview-section').style.display = 'none';
  });
}
