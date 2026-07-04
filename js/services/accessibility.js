// ═══════════════════════════════════════════════════
// accessibility.js — Panel de accesibilidad de MILA
// Todo lo que activás desde Configuración → Accesibilidad
// vive acá: tamaño de letra, alto contraste, daltonismo,
// reducir animaciones, resaltar foco de teclado, lupa
// flotante y narración por voz.
//
// Las preferencias se guardan en hotel_config (mismo
// esquema clave/valor que comisiones/horarios/etc.) para
// que se apliquen solas la próxima vez que entrés, sin
// tener que volver a tocar nada.
// ═══════════════════════════════════════════════════

import { AppContext } from '../supabase-config.js';

const KEYS = {
  fontScale:     'a11y_font_scale',
  highContrast:  'a11y_high_contrast',
  colorblind:    'a11y_colorblind',
  magnifier:     'a11y_magnifier',
  narration:     'a11y_narration',
  reduceMotion:  'a11y_reduce_motion',
  focusVisible:  'a11y_focus_visible',
};

const DEFAULTS = {
  fontScale:    1,
  highContrast: false,
  colorblind:   false,
  magnifier:    false,
  narration:    false,
  reduceMotion: false,
  focusVisible: false,
};

let _db = null;
let _hotelId = null;

// ── Lectura de preferencias actuales (desde AppContext.config, ya cargado
// al iniciar la app — no hace falta pedirle nada nuevo a la base acá) ──
export function getPrefs() {
  const cfg = AppContext.config ?? {};
  // Si nunca tocaste este interruptor (la clave no existe todavía en la
  // base), y tu sistema operativo o navegador ya tiene "reducir
  // movimiento" activado, arranca prendido acá también — es un valor
  // inicial más cómodo, no una obligación: lo podés apagar vos cuando
  // quieras y a partir de ahí queda como vos lo dejes.
  let reduceMotionDefault = DEFAULTS.reduceMotion;
  if (cfg[KEYS.reduceMotion] === undefined) {
    try { reduceMotionDefault = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { /* matchMedia no disponible, seguir con el default normal */ }
  }
  return {
    fontScale:    parseFloat(cfg[KEYS.fontScale]) || DEFAULTS.fontScale,
    highContrast: cfg[KEYS.highContrast] === 'true',
    colorblind:   cfg[KEYS.colorblind]   === 'true',
    magnifier:    cfg[KEYS.magnifier]    === 'true',
    narration:    cfg[KEYS.narration]    === 'true',
    reduceMotion: cfg[KEYS.reduceMotion] === undefined ? reduceMotionDefault : cfg[KEYS.reduceMotion] === 'true',
    focusVisible: cfg[KEYS.focusVisible] === 'true',
  };
}

// ── Guardar UNA preferencia (se llama al tocar cada control) ──
export async function setPref(name, value) {
  const key = KEYS[name];
  if (!key) return;
  // Aplicar SIEMPRE de una, incluso si todavía no está lista la conexión
  // a la base (_db/_hotelId) — antes, si esas 2 cosas no estaban listas,
  // toda la función se cortaba acá mismo y ni siquiera llegaba a prender
  // la lupa/lo que fuera: se guardaba (o no) PERO tampoco se aplicaba
  // nada visualmente, quedando como si el interruptor no hiciera nada.
  AppContext.config[key] = String(value);
  applyAll();
  if (!_db || !_hotelId) {
    console.warn('[Accesibilidad] preferencia aplicada pero no guardada todavía (conexión no lista):', name);
    return;
  }
  try {
    await _db.from('hotel_config').upsert(
      { hotel_id: _hotelId, key, value: String(value), updated_at: new Date().toISOString() },
      { onConflict: 'hotel_id,key' }
    );
  } catch (err) {
    console.warn('[Accesibilidad] no se pudo guardar la preferencia:', err?.message ?? err);
  }
}

// ── Aplicar TODAS las preferencias guardadas (se llama al iniciar la app) ──
export function applyAll() {
  const p = getPrefs();
  const html = document.documentElement;

  // Tamaño de letra — escala el font-size raíz, así todo lo que está en
  // rem (la gran mayoría de la app) escala parejo, sin romper layouts.
  // Base 15px porque es la que ya usa styles.css (html{font-size:15px}) —
  // si usara 16px acá, "100%" en realidad cambiaría el tamaño un poco
  // incluso sin tocar nada.
  html.style.fontSize = `${15 * p.fontScale}px`;

  html.classList.toggle('a11y-high-contrast', p.highContrast);
  html.classList.toggle('a11y-colorblind',    p.colorblind);
  html.classList.toggle('a11y-reduce-motion', p.reduceMotion);
  html.classList.toggle('a11y-focus-visible', p.focusVisible);

  if (p.magnifier) enableMagnifier(); else disableMagnifier();
  if (p.narration) enableNarration(); else disableNarration();
}

// ── Inicialización — llamar una vez al arrancar la app, después de que
// AppContext.config ya esté cargado (loadHotelContext) ──
export function initAccessibility(supabase, hotelId) {
  _db = supabase;
  _hotelId = hotelId;
  applyAll();
}

// ══════════════════════════════════════════════════
// LUPA FLOTANTE
// Sigue el cursor por toda la pantalla y muestra una
// versión ampliada (2x) de lo que hay debajo. No es una
// captura de pantalla (no hay librería externa de por
// medio) — es un clon real del contenido, agrandado con
// CSS y desplazado para que el punto bajo el cursor quede
// centrado en la lupa. Para que no se vea "viejo" con
// pantallas muy dinámicas (el calendario, por ejemplo),
// se re-clona cada medio segundo mientras está activa —
// no en cada movimiento del mouse, porque clonar todo el
// body en cada frame sería demasiado pesado.
// ══════════════════════════════════════════════════
const LENS_SIZE = 190;
const ZOOM = 2;
let _lensEl = null;
let _lensCloneEl = null;
let _lensMoveHandler = null;
let _lensCloneInterval = null;
let _lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

function _refreshLensClone() {
  if (!_lensCloneEl) return;
  // Clonar el body entero, salvo la lupa misma (para no clonarse a sí misma)
  const bodyClone = document.body.cloneNode(true);
  bodyClone.querySelectorAll('#a11y-magnifier-lens, script').forEach(el => el.remove());
  // El clon no necesita id (es solo para mirar, no interactúa con nada) —
  // sacarlos evita tener 2 elementos con el mismo id en el documento a la
  // vez, que podría confundir a cualquier document.getElementById() que
  // se ejecute mientras la lupa está prendida.
  bodyClone.removeAttribute('id');
  bodyClone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  bodyClone.style.cssText = 'margin:0;pointer-events:none;';

  // CRÍTICO: el contenedor de la lupa (#a11y-magnifier-clone) es chiquito
  // y no tiene ancho/alto propio — sin esto, todo lo que dentro de la
  // página use medidas relativas al ancho de pantalla (100%, 100vw, etc.)
  // colapsa a 0 al clonarse ahí adentro, y la lupa queda en blanco (no
  // porque el clon esté vacío, sino porque su contenido "se aplasta").
  // Fijamos el mismo ancho/alto real de la página para que todo se
  // renderice con las proporciones correctas antes de escalarlo.
  _lensCloneEl.style.width  = `${document.documentElement.scrollWidth}px`;
  _lensCloneEl.style.height = `${document.documentElement.scrollHeight}px`;

  _lensCloneEl.innerHTML = '';
  _lensCloneEl.appendChild(bodyClone);
  _positionLensClone(_lastMouse.x, _lastMouse.y);
}

function _positionLensClone(x, y) {
  if (!_lensEl || !_lensCloneEl) return;
  _lensEl.style.left = `${x - LENS_SIZE / 2}px`;
  _lensEl.style.top  = `${y - LENS_SIZE / 2}px`;
  // El clon representa el <body> entero SIN scroll aplicado (arranca
  // siempre desde arriba de todo) — pero el cursor (x,y) es relativo a lo
  // que se ve en pantalla, que en esta app se desplaza adentro de
  // .main-content (el body en sí no se mueve). Sin sumar ese scroll acá,
  // la lupa mostraba una parte distinta de la página a medida que
  // navegabas — como si "estuviera corrida". Sumamos el scroll de
  // CUALQUIER contenedor que se haya desplazado (no solo .main-content
  // por si el menú lateral u otra zona también scrollea).
  let scrollX = window.scrollX, scrollY = window.scrollY;
  const mainContent = document.querySelector('.main-content');
  if (mainContent) { scrollX += mainContent.scrollLeft; scrollY += mainContent.scrollTop; }
  const offsetX = -(x + scrollX) * ZOOM + LENS_SIZE / 2;
  const offsetY = -(y + scrollY) * ZOOM + LENS_SIZE / 2;
  _lensCloneEl.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${ZOOM})`;
}

export function enableMagnifier() {
  if (_lensEl) return; // ya está activa
  _lensEl = document.createElement('div');
  _lensEl.id = 'a11y-magnifier-lens';

  _lensCloneEl = document.createElement('div');
  _lensCloneEl.id = 'a11y-magnifier-clone';
  _lensEl.appendChild(_lensCloneEl);
  document.body.appendChild(_lensEl);

  // ── Celular/tablet (touch): no hay "cursor" que la lupa pueda seguir
  // solo, y si la sigue en cada touchmove le pisa el scroll normal de la
  // página. Por eso en touch la lupa se agarra y arrastra a mano (como
  // un objeto real) en vez de seguir el dedo sola. En computadora (mouse)
  // sigue el cursor automáticamente, que es lo esperable ahí.
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  if (isTouch) {
    _lensEl.classList.add('a11y-magnifier-draggable');
    // Arranca centrada en pantalla, visible de entrada
    _lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    let dragging = false;
    const onTouchStart = (e) => {
      dragging = true;
      const t = e.touches[0];
      _lastMouse = { x: t.clientX, y: t.clientY };
      _positionLensClone(t.clientX, t.clientY);
      e.preventDefault();
    };
    const onTouchMove = (e) => {
      if (!dragging) return;
      const t = e.touches[0];
      _lastMouse = { x: t.clientX, y: t.clientY };
      _positionLensClone(t.clientX, t.clientY);
      e.preventDefault();
    };
    const onTouchEnd = () => { dragging = false; };

    _lensEl.addEventListener('touchstart', onTouchStart, { passive: false });
    _lensEl.addEventListener('touchmove', onTouchMove, { passive: false });
    _lensEl.addEventListener('touchend', onTouchEnd, { passive: true });
    _lensMoveHandler = () => {
      _lensEl.removeEventListener('touchstart', onTouchStart);
      _lensEl.removeEventListener('touchmove', onTouchMove);
      _lensEl.removeEventListener('touchend', onTouchEnd);
    };
  } else {
    const onMouseMove = (e) => {
      _lastMouse = { x: e.clientX, y: e.clientY };
      _positionLensClone(e.clientX, e.clientY);
    };
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    _lensMoveHandler = () => document.removeEventListener('mousemove', onMouseMove);
  }

  _refreshLensClone();
  _lensCloneInterval = setInterval(_refreshLensClone, 500);
}

export function disableMagnifier() {
  if (_lensMoveHandler) _lensMoveHandler(); // saca los listeners que correspondan (mouse o touch)
  if (_lensCloneInterval) clearInterval(_lensCloneInterval);
  _lensMoveHandler = null;
  _lensCloneInterval = null;
  _lensEl?.remove();
  _lensEl = null;
  _lensCloneEl = null;
}

// ══════════════════════════════════════════════════
// NARRACIÓN POR VOZ
// Al seleccionar texto en cualquier parte de la app,
// aparece un botón flotante "🔊 Escuchar" al lado de la
// selección. Usa la síntesis de voz del navegador — no
// depende de ningún servicio externo.
// ══════════════════════════════════════════════════
let _narrationBtn = null;
let _selectionHandler = null;
let _selectionChangeHandler = null;

let _currentUtterance = null; // referencia viva — algunos navegadores cortan la voz si se pierde antes de tiempo

function _showNarrationButton(text, x, y) {
  _hideNarrationButton();
  const btn = document.createElement('button');
  btn.id = 'a11y-narration-btn';
  btn.type = 'button';
  btn.textContent = '🔊 Escuchar';
  btn.style.left = `${x}px`;
  btn.style.top  = `${y}px`;
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // no perder la selección al tocar
  btn.addEventListener('click', () => {
    try {
      if (!('speechSynthesis' in window)) {
        console.warn('[Accesibilidad] este navegador no tiene síntesis de voz');
        return;
      }
      window.speechSynthesis.cancel();
      _currentUtterance = new SpeechSynthesisUtterance(text);
      _currentUtterance.lang = 'es-AR';
      _currentUtterance.rate = 1;
      window.speechSynthesis.speak(_currentUtterance);
    } catch (err) {
      console.warn('[Accesibilidad] narración no disponible:', err?.message ?? err);
    }
    _hideNarrationButton();
  });
  document.body.appendChild(btn);
  _narrationBtn = btn;
}

function _hideNarrationButton() {
  _narrationBtn?.remove();
  _narrationBtn = null;
}

export function enableNarration() {
  if (_selectionHandler) return; // ya está activa
  _selectionHandler = (e) => {
    // Si el evento vino del propio botón "Escuchar" (tocarlo/soltarlo
    // también dispara mouseup/touchend en el documento), no lo
    // reprocesamos — si no, el botón se borraba a sí mismo antes de que
    // le llegara a funcionar su propio click, y por eso "no hacía nada"
    // al tocarlo.
    if (e?.target && _narrationBtn && _narrationBtn.contains(e.target)) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.length < 2) { _hideNarrationButton(); return; }
    try {
      const range = sel.getRangeAt(0);
      const rect  = range.getBoundingClientRect();
      _showNarrationButton(text, rect.left + rect.width / 2 - 55, rect.bottom + 8);
    } catch { /* selección sin rango válido, ignorar */ }
  };
  document.addEventListener('mouseup', _selectionHandler);
  // En celular, la selección de texto se hace con el dedo (mantener
  // presionado) — "mouseup" no siempre llega en ese caso según el
  // navegador. "touchend" + "selectionchange" (con un pequeño debounce,
  // porque selectionchange dispara muy seguido) cubren ese caso.
  document.addEventListener('touchend', _selectionHandler, { passive: true });
  let debounceTimer = null;
  _selectionChangeHandler = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(_selectionHandler, 250);
  };
  document.addEventListener('selectionchange', _selectionChangeHandler);
}

export function disableNarration() {
  if (_selectionHandler) {
    document.removeEventListener('mouseup', _selectionHandler);
    document.removeEventListener('touchend', _selectionHandler);
  }
  if (_selectionChangeHandler) document.removeEventListener('selectionchange', _selectionChangeHandler);
  _selectionHandler = null;
  _selectionChangeHandler = null;
  _hideNarrationButton();
  try { window.speechSynthesis.cancel(); } catch {}
}
