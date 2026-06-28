// ═══════════════════════════════════════════════════
// MILA PMS — Service Worker v2
// Estrategia: Network First con fallback offline
// ═══════════════════════════════════════════════════

const CACHE_NAME  = 'mila-v2';
const OFFLINE_URL = '/offline.html';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/css/styles.css',
  '/css/calendar-v5.css',
  '/css/mobile-fixes.css',
  '/icons/icon-192.png',
  '/icons/apple-touch-icon.png',
];

// ── Instalar: cachear assets críticos ──
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activar: limpiar caches viejos ──
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Network First ──
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // No interceptar requests de Supabase (API)
  if (url.hostname.includes('supabase.co')) return;
  if (request.method !== 'GET') return;

  // HTML: Network First con fallback offline
  if (request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // CSS/JS/Imágenes: Stale While Revalidate
  e.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(request);
      const fetchPromise = fetch(request).then(res => {
        if (res.ok) cache.put(request, res.clone());
        return res;
      }).catch(() => null);
      return cached ?? fetchPromise;
    })
  );
});
