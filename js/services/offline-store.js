// ═══════════════════════════════════════════════════════════════
// MILA PMS — Offline Store
// Fase 1: guarda bookings, units y guests en IndexedDB para
//         lectura sin conexión.
// Fase 2: cola de operaciones pendientes que se suben cuando
//         vuelve la conexión.
// ═══════════════════════════════════════════════════════════════

const DB_NAME    = 'mila-offline';
const DB_VERSION = 2;

// Abre (o crea) la base IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // Snapshots de datos para lectura offline
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots'); // key = nombre de tabla
      }
      // Cola de escrituras pendientes
      if (!db.objectStoreNames.contains('queue')) {
        const qs = db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
        qs.createIndex('status', 'status');
      }
    };
    req.onsuccess  = () => resolve(req.result);
    req.onerror    = () => reject(req.error);
  });
}

// ── SNAPSHOTS (Fase 1) ─────────────────────────────────────────

/** Guarda un snapshot de cualquier colección */
export async function saveSnapshot(key, data) {
  try {
    const db = await openDB();
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put({ data, savedAt: Date.now() }, key);
    return new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror    = rej;
    });
  } catch (err) {
    console.warn('[Offline] saveSnapshot error:', err);
  }
}

/** Lee un snapshot guardado */
export async function loadSnapshot(key) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx  = db.transaction('snapshots', 'readonly');
      const req = tx.objectStore('snapshots').get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Timestamp del último snapshot guardado */
export async function snapshotAge(key) {
  const snap = await loadSnapshot(key);
  if (!snap?.savedAt) return null;
  const mins = Math.round((Date.now() - snap.savedAt) / 60000);
  return mins < 60 ? `hace ${mins} min` : `hace ${Math.round(mins/60)}h`;
}

// ── COLA DE ESCRITURAS (Fase 2) ────────────────────────────────

/**
 * Agrega una operación a la cola offline.
 * @param {object} op — { table, action: 'insert'|'update'|'delete', payload, recordId? }
 */
export async function enqueue(op) {
  try {
    const db = await openDB();
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').add({
      ...op,
      status:    'pending',
      createdAt: Date.now(),
    });
    return new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror    = rej;
    });
  } catch (err) {
    console.warn('[Offline] enqueue error:', err);
  }
}

/** Lista todas las operaciones pendientes */
export async function getPendingOps() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx   = db.transaction('queue', 'readonly');
      const req  = tx.objectStore('queue').getAll();
      req.onsuccess = () => resolve((req.result ?? []).filter(op => op.status === 'pending'));
      req.onerror   = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/** Marca una operación como procesada */
export async function markDone(id) {
  try {
    const db = await openDB();
    const tx = db.transaction('queue', 'readwrite');
    const store = tx.objectStore('queue');
    const req   = store.get(id);
    req.onsuccess = () => {
      const op = req.result;
      if (op) { op.status = 'done'; store.put(op); }
    };
  } catch (err) {
    console.warn('[Offline] markDone error:', err);
  }
}

/** Marca una operación como fallida con mensaje de error */
export async function markFailed(id, errMsg) {
  try {
    const db = await openDB();
    const tx = db.transaction('queue', 'readwrite');
    const store = tx.objectStore('queue');
    const req   = store.get(id);
    req.onsuccess = () => {
      const op = req.result;
      if (op) { op.status = 'failed'; op.error = errMsg; store.put(op); }
    };
  } catch {}
}

/** Borra operaciones ya procesadas (limpieza periódica) */
export async function cleanDone() {
  try {
    const db = await openDB();
    const all = await new Promise((resolve) => {
      const tx  = db.transaction('queue', 'readonly');
      const req = tx.objectStore('queue').getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror   = () => resolve([]);
    });
    const toDelete = all.filter(op => op.status === 'done');
    if (!toDelete.length) return;
    const tx2 = db.transaction('queue', 'readwrite');
    toDelete.forEach(op => tx2.objectStore('queue').delete(op.id));
  } catch {}
}
