/**
 * MILA PMS — modals/modals.js
 * Sistema de modales con control de cierre por click exterior.
 * Reemplaza cualquier lógica de modal existente con este módulo centralizado.
 */

// Registry de listeners activos para poder limpiarlos
const _overlayListeners = new WeakMap();

/**
 * Abre un modal por su ID.
 * @param {string} modalId
 * @param {Object} opts
 * @param {boolean} [opts.closeOnOutsideClick=true] - false para Reserva/Gasto/Limpieza
 * @param {Function} [opts.onClose] - Callback al cerrar
 * @param {boolean} [opts.confirmOnClose=false] - Pedir confirmación al cerrar
 * @param {string} [opts.confirmMessage] - Mensaje de confirmación personalizado
 */
export function openModal(modalId, {
  closeOnOutsideClick = true,
  onClose             = null,
  confirmOnClose      = false,
  confirmMessage      = '¿Cerrar sin guardar? Se perderán los datos ingresados.',
} = {}) {
  const overlay = document.getElementById(modalId);
  if (!overlay) {
    console.warn(`openModal: No se encontró el elemento con id="${modalId}"`);
    return;
  }

  // Limpiar listener previo si existía
  const prevListener = _overlayListeners.get(overlay);
  if (prevListener) overlay.removeEventListener('click', prevListener);

  // Guardar config en el elemento para que closeModal pueda accederla
  overlay._modalConfig = { onClose, confirmOnClose, confirmMessage };

  // Activar
  overlay.classList.add('modal--active');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('body--modal-open'); // prevent scroll

  // Focus trap: enfocar primer input/button
  requestAnimationFrame(() => {
    const focusable = overlay.querySelector(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])'
    );
    focusable?.focus();
  });

  // ESC siempre disponible (con respeto a confirmación)
  const escHandler = (e) => {
    if (e.key === 'Escape') closeModal(modalId);
  };
  document.addEventListener('keydown', escHandler, { once: false });
  overlay._escHandler = escHandler;

  if (!closeOnOutsideClick) return;

  // Click fuera del modal panel
  const listener = (e) => {
    if (e.target === overlay) closeModal(modalId);
  };
  overlay.addEventListener('click', listener);
  _overlayListeners.set(overlay, listener);
}

/**
 * Cierra un modal por su ID.
 * @param {string} modalId
 * @param {boolean} [force=false] - Ignorar confirmación
 */
export function closeModal(modalId, force = false) {
  const overlay = document.getElementById(modalId);
  if (!overlay) return;

  const config = overlay._modalConfig ?? {};

  if (!force && config.confirmOnClose && formTieneContenido(`#${modalId} form`)) {
    if (!confirm(config.confirmMessage)) return;
  }

  overlay.classList.remove('modal--active');
  overlay.setAttribute('aria-hidden', 'true');

  // Limpiar listeners
  const listener = _overlayListeners.get(overlay);
  if (listener) {
    overlay.removeEventListener('click', listener);
    _overlayListeners.delete(overlay);
  }
  if (overlay._escHandler) {
    document.removeEventListener('keydown', overlay._escHandler);
    delete overlay._escHandler;
  }

  // Restaurar scroll si no hay otros modales abiertos
  const hayOtrosModales = document.querySelector('.modal--active');
  if (!hayOtrosModales) document.body.classList.remove('body--modal-open');

  if (typeof config.onClose === 'function') config.onClose();
}

/**
 * Cierra todos los modales activos.
 */
export function closeAllModals() {
  document.querySelectorAll('.modal--active').forEach(m => {
    closeModal(m.id, true);
  });
}

/**
 * Detecta si un form tiene contenido modificado.
 * @param {string} formSelector
 * @returns {boolean}
 */
export function formTieneContenido(formSelector) {
  const inputs = document.querySelectorAll(
    `${formSelector} input, ${formSelector} textarea, ${formSelector} select`
  );
  return [...inputs].some(el => {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
    return el.value.trim() !== '' && el.value !== (el.defaultValue ?? '');
  });
}

/**
 * Resetea todos los campos de un form.
 * @param {string} formSelector
 */
export function resetForm(formSelector) {
  const form = document.querySelector(formSelector);
  if (form) {
    form.reset();
    // Limpiar también custom components con clase .input-custom
    form.querySelectorAll('.input-custom').forEach(el => {
      el.textContent = '';
      el.dataset.value = '';
    });
  }
}

// ──────────────────────────────────────────────
// CONFIGURACIONES POR DEFECTO PARA MILA PMS
// ──────────────────────────────────────────────
/**
 * Abre modal de RESERVA (nunca cierra por click externo, pide confirmación)
 */
export function openModalReserva() {
  openModal('modal-reserva', {
    closeOnOutsideClick: false,
    confirmOnClose:      true,
    confirmMessage:      '¿Cerrar el formulario de reserva? Los datos ingresados se perderán.',
  });
}

/**
 * Abre modal de GASTO (nunca cierra por click externo)
 */
export function openModalGasto() {
  openModal('modal-gasto', {
    closeOnOutsideClick: false,
    confirmOnClose:      true,
    confirmMessage:      '¿Cancelar la carga del gasto?',
  });
}

/**
 * Abre modal de LIMPIEZA (nunca cierra por click externo)
 */
export function openModalLimpieza() {
  openModal('modal-limpieza', {
    closeOnOutsideClick: false,
    confirmOnClose:      false, // La limpieza tiene menos datos, no pide confirmación
  });
}
