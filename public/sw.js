// ═══════════════════════════════════════════════════
// sw.js v8.0 — MILA Service Worker
// • Cache de assets estáticos
// • Cola offline para actions de Supabase
// • Indicador de estado real al cliente
// ═══════════════════════════════════════════════════

const V  = '8.0.0';
const CA = `mila-app-${V}`;
const CS = `mila-static-${V}`;
const OFFLINE_QUEUE_KEY = 'mila_offline_queue';

// ── Install ──────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CA)
      .then(c => c.add('/offline.html').catch(() => {}))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all([
        ...keys.filter(k => k.startsWith('mila-') && k !== CA && k !== CS).map(k => caches.delete(k)),
        self.clients.claim(),
      ])
    )
  );
});

// ── Fetch ─────────────────────────────────────────
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);

  // Supabase / APIs externas — network only, pero cola si offline
  if (u.hostname.includes('supabase.co')) {
    if (e.request.method !== 'GET') {
      e.respondWith(networkWithOfflineQueue(e.request));
    }
    // GETs a Supabase pasan siempre (no cachear datos de negocio)
    return;
  }

  // APIs de cotización dollar — network only
  if (u.hostname.includes('dolarapi') || u.hostname.includes('ambito') ||
      u.hostname.includes('bluelytics') || u.hostname.includes('esm.sh')) {
    return; // sin manejo → browser normal
  }

  // Google fonts — cache first
  if (u.hostname.includes('gstatic') || u.hostname.includes('googleapis')) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // Assets del app — network first con fallback a cache
  e.respondWith(networkFirst(e.request));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CA);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      // Notificar al cliente que está offline
      notifyClients({ type: 'OFFLINE' });
      return caches.match('/offline.html');
    }
    return new Response('', { status: 503 });
  }
}

async function cacheFirst(req) {
  return (await caches.match(req)) || networkFirst(req);
}

// ── Cola offline para mutaciones a Supabase ────────
async function networkWithOfflineQueue(req) {
  try {
    const res = await fetch(req.clone());
    if (res.ok) notifyClients({ type: 'ONLINE' });
    return res;
  } catch {
    // Guardar en cola para reintentar cuando haya conexión
    const body = await req.clone().text().catch(() => '');
    const queued = {
      url:     req.url,
      method:  req.method,
      headers: Object.fromEntries(req.headers.entries()),
      body,
      ts:      Date.now(),
    };
    // Comunicar al cliente para que persista en localStorage
    notifyClients({ type: 'QUEUE_ACTION', payload: queued });
    notifyClients({ type: 'OFFLINE' });
    // Devolver respuesta de error suave (no crash)
    return new Response(JSON.stringify({ error: 'offline', queued: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── Mensajes desde el cliente ──────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'SYNC_QUEUE')  syncQueue(e.data.queue);
  if (e.data?.type === 'PING')        e.ports[0]?.postMessage({ type: 'PONG' });
});

// ── Background Sync ───────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'mila-sync') {
    e.waitUntil(notifyClients({ type: 'TRIGGER_SYNC' }));
  }
});

async function syncQueue(queue) {
  if (!queue?.length) return;
  const results = await Promise.allSettled(
    queue.map(item => fetch(item.url, {
      method:  item.method,
      headers: item.headers,
      body:    item.body || undefined,
    }))
  );
  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
  notifyClients({ type: 'SYNC_DONE', succeeded, total: queue.length });
}

async function notifyClients(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(c => c.postMessage(msg));
}
