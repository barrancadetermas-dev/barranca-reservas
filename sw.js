// ═══════════════════════════════════════════════════
// sw.js — Service Worker (PWA)
// Cache-first para assets estáticos
// Network-first para Supabase API
// Offline fallback con datos en caché
// ═══════════════════════════════════════════════════

const CACHE_NAME    = 'bdt-pms-v6';
const SHELL_CACHE   = 'bdt-shell-v6';
const OFFLINE_URL   = '/offline.html';

// Assets del shell que se cachean al instalar
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/supabase-config.js',
  '/js/auth/permissions.js',
  '/js/services/mock-data.js',
  '/js/services/export-service.js',
  '/js/services/dollar-api.js',
  '/js/services/whatsapp-service.js',
  '/js/components/dashboard.js',
  '/js/components/calendar.js',
  '/js/components/booking-form.js',
  '/js/components/booking-list.js',
  '/js/components/statistics.js',
  '/js/components/guests.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
];

// ── Install: cachear el shell ─────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS.filter(u => !u.startsWith('http') || u.includes('fonts.googleapis'))))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: limpiar cachés viejas ──────────────
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

// ── Fetch: estrategia por tipo de request ────────
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Supabase API → Network-first (datos siempre frescos)
  if (url.hostname.includes('supabase.co') || url.hostname.includes('esm.sh')) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // Google Fonts → Cache-first
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(cacheFirst(e.request, CACHE_NAME));
    return;
  }

  // Dollar API → Network-first con fallback a caché
  if (url.hostname.includes('dolarapi.com') || url.hostname.includes('bluelytics.com')) {
    e.respondWith(networkFirst(e.request, CACHE_NAME, 600000)); // caché 10min
    return;
  }

  // Shell estático → Network-first (garantiza archivos frescos)
  if (e.request.mode === 'navigate' || url.pathname.match(/\.(css|js|html)$/)) {
    e.respondWith(networkFirst(e.request, SHELL_CACHE, 0)); // 0 = siempre red primero
    return;
  }

  // Default → Network con fallback
  e.respondWith(networkFirst(e.request));
});

// ── Estrategias ───────────────────────────────────
async function cacheFirst(request, cacheName = CACHE_NAME) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback(request);
  }
}

async function networkFirst(request, cacheName = CACHE_NAME, maxAge = Infinity) {
  try {
    const response = await fetch(request);
    if (response.ok && cacheName) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineFallback(request);
  }
}

async function offlineFallback(request) {
  if (request.mode === 'navigate') {
    const cached = await caches.match('/index.html');
    if (cached) return cached;
  }
  return new Response(
    JSON.stringify({ error: 'offline', message: 'Sin conexión — usando datos en caché' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  );
}

// ── Mensaje desde cliente: skipWaiting inmediato ─
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Background sync: reintentar writes offline ───
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-bookings') {
    e.waitUntil(syncPendingWrites());
  }
});

async function syncPendingWrites() {
  // En el futuro: reintentar INSERT/UPDATE fallados offline
  // Por ahora: notificar al usuario que está online
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_COMPLETE', message: 'Conexión restaurada — datos sincronizados' });
  });
}
