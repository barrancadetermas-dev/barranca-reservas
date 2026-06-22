// ═══════════════════════════════════════════════════
// sw.js v8.2.0 — MILA Service Worker
// HTML siempre de red, assets cacheados, offline queue
// ═══════════════════════════════════════════════════

const V  = '8.2.0';
const CA = `mila-app-${V}`;

self.addEventListener('install', e => {
  // Tomar control inmediatamente sin esperar cierre de tabs
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith('mila-') && k !== CA)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);

  // 1. Supabase, APIs externas → network only, sin interceptar
  if (
    u.hostname.includes('supabase.co') ||
    u.hostname.includes('dolarapi')    ||
    u.hostname.includes('ambito')      ||
    u.hostname.includes('bluelytics')  ||
    u.hostname.includes('esm.sh')      ||
    u.hostname.includes('resend.com')
  ) {
    if (e.request.method !== 'GET') {
      e.respondWith(networkWithOfflineQueue(e.request));
    }
    return;
  }

  // 2. HTML / navegación → SIEMPRE de red, nunca cacheado
  if (e.request.mode === 'navigate' || u.pathname.endsWith('.html') || u.pathname === '/') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/offline.html'))
    );
    return;
  }

  // 3. Google fonts → cache first
  if (u.hostname.includes('gstatic') || u.hostname.includes('googleapis')) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // 4. Assets estáticos (JS, CSS, imágenes) → network first, fallback cache
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
    return cached || new Response('', { status: 503 });
  }
}

async function cacheFirst(req) {
  return (await caches.match(req)) || networkFirst(req);
}

// ── Cola offline para mutaciones POST a Supabase ──
async function networkWithOfflineQueue(req) {
  try {
    const res = await fetch(req.clone());
    notifyClients({ type: 'ONLINE' });
    return res;
  } catch {
    const body = await req.clone().text().catch(() => '');
    notifyClients({
      type: 'QUEUE_ACTION',
      payload: { url: req.url, method: req.method, body, ts: Date.now() }
    });
    notifyClients({ type: 'OFFLINE' });
    return new Response(JSON.stringify({ error: 'offline', queued: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'SYNC_QUEUE')   syncQueue(e.data.queue);
});

self.addEventListener('sync', e => {
  if (e.tag === 'mila-sync') e.waitUntil(notifyClients({ type: 'TRIGGER_SYNC' }));
});

async function syncQueue(queue) {
  if (!queue?.length) return;
  const results = await Promise.allSettled(
    queue.map(item => fetch(item.url, { method: item.method, body: item.body || undefined }))
  );
  const ok = results.filter(r => r.status === 'fulfilled' && r.value?.ok).length;
  notifyClients({ type: 'SYNC_DONE', succeeded: ok, total: queue.length });
}

async function notifyClients(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(c => {
    try { c.postMessage(msg); } catch { /* cliente cerrado */ }
  });
}
