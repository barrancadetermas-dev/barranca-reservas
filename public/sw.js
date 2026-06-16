// ═══════════════════════════════════════════════════
// sw.js v5.0 — MILA Sistema Inteligente para Alojamientos
// Cache-first para assets estáticos
// Network-first para Supabase API
// Offline fallback con offline.html
// ═══════════════════════════════════════════════════

const CACHE_NAME  = 'mila-pms-v1';
const SHELL_CACHE = 'mila-shell-v1';
const OFFLINE_URL = '/offline.html';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/supabase-config.js',
  '/js/auth/permissions.js',
  '/js/services/mock-data.js',
  '/js/services/export-service.js',
  '/js/services/dollar-api.js',
  '/js/services/whatsapp-service.js',
  '/js/services/config-service.js',
  '/js/components/dashboard.js',
  '/js/components/calendar.js',
  '/js/components/booking-form.js',
  '/js/components/booking-list.js',
  '/js/components/statistics.js',
  '/js/components/guests.js',
  '/js/components/operations.js',
  '/js/components/config-panel.js',
  '/js/components/audit-panel.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS.filter(u =>
        !u.startsWith('http') || u.includes('fonts.googleapis'))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()) // no bloquear instalación si falla algún asset
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== SHELL_CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (url.hostname.includes('supabase.co') || url.hostname.includes('esm.sh')) {
    e.respondWith(networkFirst(e.request)); return;
  }
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(cacheFirst(e.request, CACHE_NAME)); return;
  }
  if (url.hostname.includes('dolarapi.com') || url.hostname.includes('bluelytics.com')) {
    e.respondWith(networkFirst(e.request, CACHE_NAME)); return;
  }
  if (e.request.mode === 'navigate' || url.pathname.match(/\.(css|js|html)$/)) {
    e.respondWith(cacheFirst(e.request, SHELL_CACHE)); return;
  }
  e.respondWith(networkFirst(e.request));
});

async function cacheFirst(request, cacheName = CACHE_NAME) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) { const c = await caches.open(cacheName); c.put(request, response.clone()); }
    return response;
  } catch { return offlineFallback(request); }
}

async function networkFirst(request, cacheName = CACHE_NAME) {
  try {
    const response = await fetch(request);
    if (response.ok && cacheName) { const c = await caches.open(cacheName); c.put(request, response.clone()); }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineFallback(request);
  }
}

async function offlineFallback(request) {
  if (request.mode === 'navigate') {
    return caches.match(OFFLINE_URL) || caches.match('/index.html');
  }
  return new Response(JSON.stringify({ error: 'offline' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } });
}

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-bookings') {
    e.waitUntil(self.clients.matchAll().then(cs =>
      cs.forEach(c => c.postMessage({ type: 'SYNC_COMPLETE', message: 'Conexión restaurada' }))
    ));
  }
});
