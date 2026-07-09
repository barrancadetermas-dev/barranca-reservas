// ═══════════════════════════════════════════════════════════════
// MILA PMS — Offline Sync Manager
// Muestra el banner offline, detecta reconexión y procesa la
// cola de escrituras pendientes (Fase 2).
// ═══════════════════════════════════════════════════════════════

import { getPendingOps, markDone, markFailed, cleanDone, snapshotAge } from './offline-store.js';

let _db        = null;  // referencia a supabase
let _onSynced  = null;  // callback cuando termina el sync
let _banner    = null;
let _initialized = false;

// ── INIT ───────────────────────────────────────────────────────

export function initOfflineSync(supabase, { onSynced } = {}) {
  if (_initialized) return;
  _initialized = true;
  _db       = supabase;
  _onSynced = onSynced;

  _createBanner();
  _updateBanner();

  window.addEventListener('online',  _handleOnline);
  window.addEventListener('offline', _updateBanner);
}

// ── BANNER ─────────────────────────────────────────────────────

function _createBanner() {
  if (document.getElementById('offline-banner')) return;
  const b = document.createElement('div');
  b.id = 'offline-banner';
  b.style.cssText = [
    'display:none;position:fixed;top:0;left:0;right:0;z-index:99999',
    'padding:6px 14px;font-size:.75rem;font-weight:600',
    'display:none;align-items:center;gap:8px;justify-content:center',
  ].join(';');
  b.innerHTML = `
    <span id="offline-icon">📶</span>
    <span id="offline-text"></span>
    <button id="offline-sync-btn" style="display:none;margin-left:8px;padding:2px 10px;
      border-radius:999px;border:1px solid currentColor;background:transparent;
      cursor:pointer;font-size:.72rem;font-weight:700">
      ↑ Subir cambios
    </button>`;
  document.body.appendChild(b);
  _banner = b;

  document.getElementById('offline-sync-btn')?.addEventListener('click', () => {
    _processQueue();
  });
}

async function _updateBanner() {
  if (!_banner) return;
  const isOnline = navigator.onLine;
  const pending  = (await getPendingOps()).length;

  if (isOnline && !pending) {
    _banner.style.display = 'none';
    return;
  }

  _banner.style.display = 'flex';

  if (!isOnline) {
    const age = await snapshotAge('bookings');
    _banner.style.background = '#92400e';
    _banner.style.color      = '#FEF3C7';
    document.getElementById('offline-icon').textContent = '📵';
    document.getElementById('offline-text').textContent =
      age ? `Sin conexión — mostrando datos de ${age}` : 'Sin conexión — datos en caché';
    document.getElementById('offline-sync-btn').style.display = 'none';
  } else if (pending > 0) {
    _banner.style.background = '#1e40af';
    _banner.style.color      = '#DBEAFE';
    document.getElementById('offline-icon').textContent = '☁️';
    document.getElementById('offline-text').textContent =
      `${pending} cambio${pending > 1 ? 's' : ''} pendiente${pending > 1 ? 's' : ''} de subir`;
    document.getElementById('offline-sync-btn').style.display = 'inline-block';
  }
}

// ── RECONEXIÓN ─────────────────────────────────────────────────

async function _handleOnline() {
  _updateBanner();
  const pending = await getPendingOps();
  if (!pending.length) return;

  // Pequeña demora para que la conexión se estabilice
  setTimeout(async () => {
    const count = pending.length;
    const confirmed = confirm(
      `📶 Conexión recuperada.\n\nHay ${count} cambio${count > 1 ? 's' : ''} pendiente${count > 1 ? 's' : ''} sin subir.\n\n¿Subir ahora?`
    );
    if (confirmed) await _processQueue();
  }, 1500);
}

// ── PROCESAMIENTO DE COLA (Fase 2) ─────────────────────────────

export async function _processQueue() {
  if (!_db) return;
  const ops = await getPendingOps();
  if (!ops.length) { _updateBanner(); return; }

  let ok = 0, fail = 0;

  for (const op of ops) {
    try {
      if      (op.action === 'insert') await _doInsert(op);
      else if (op.action === 'update') await _doUpdate(op);
      else if (op.action === 'delete') await _doDelete(op);
      await markDone(op.id);
      ok++;
    } catch (err) {
      await markFailed(op.id, err.message);
      fail++;
      console.error('[Offline] sync error:', op, err);
    }
  }

  await cleanDone();
  await _updateBanner();

  if (ok > 0) {
    const { showToast } = await import('../supabase-config.js');
    showToast(`✅ ${ok} cambio${ok > 1 ? 's' : ''} sincronizado${ok > 1 ? 's' : ''}${fail > 0 ? ` · ${fail} fallido${fail > 1 ? 's' : ''}` : ''}`, fail > 0 ? 'warning' : 'success');
    _onSynced?.();
  } else if (fail > 0) {
    const { showToast } = await import('../supabase-config.js');
    showToast(`⚠️ ${fail} cambio${fail > 1 ? 's' : ''} no se pudo${fail > 1 ? 'ron' : ''} sincronizar — revisá la conexión`, 'error');
  }
}

async function _doInsert({ table, payload }) {
  const { error } = await _db.from(table).insert(payload);
  if (error) throw new Error(error.message);
}

async function _doUpdate({ table, payload, recordId }) {
  const { error } = await _db.from(table).update(payload).eq('id', recordId);
  if (error) throw new Error(error.message);
}

async function _doDelete({ table, recordId }) {
  const { error } = await _db.from(table).delete().eq('id', recordId);
  if (error) throw new Error(error.message);
}

// ── API PÚBLICA ────────────────────────────────────────────────

/** Fuerza una actualización visual del banner (llamar tras guardar en cola) */
export { _updateBanner as refreshOfflineBanner };
