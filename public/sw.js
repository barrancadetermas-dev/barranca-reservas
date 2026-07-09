// ═══════════════════════════════════════════════════
// MILA PMS — Service Worker v12
// Estrategia: Network First con fallback a APP CACHE
// Offline → sirve el index.html cacheado (no offline.html)
// así la app funciona con los datos de IndexedDB.
// ═══════════════════════════════════════════════════

const CACHE_NAME  = 'mila-v12';
const APP_SHELL   = '/index.html'; // lo que servimos offline

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-192-maskable.png',
  '/icon-512.png',
  '/icon-512-maskable.png',
  '/apple-touch-icon.png',
  '/favicon-32.png',
];

// ── Instalar: cachear assets críticos ──
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] install error:', err))
  );
});

// ── Activar: limpiar caches viejos ──
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function safePut(request, response) {
  caches.open(CACHE_NAME)
    .then(c => c.put(request, response))
    .catch(err => console.warn('[SW] cache put failed:', err));
}

// ── Fetch ──
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // No interceptar otros orígenes (Supabase, APIs, etc.)
  if (url.origin !== self.location.origin) return;
  if (request.method !== 'GET') return;

  // ── HTML: Network First, fallback al APP SHELL cacheado ──
  // Cuando no hay conexión, servimos index.html desde cache
  // para que la app arranque con los datos de IndexedDB.
  if (request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(request)
        .then(res => {
          const toCache = res.clone();
          safePut(request, toCache);
          return res;
        })
        .catch(async () => {
          // 1. Intentar el recurso exacto desde cache
          const cached = await caches.match(request);
          if (cached) return cached;
          // 2. Fallback al app shell (index.html) — la app carga offline
          const shell = await caches.match(APP_SHELL);
          if (shell) return shell;
          // 3. Último recurso: página offline
          return caches.match('/offline.html');
        })
    );
    return;
  }

  // ── JS/CSS: Network First, fallback cache ──
  // Importante: si el JS no está cacheado y no hay red, la app
  // no puede arrancar. Por eso pre-cacheamos en el install.
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const toCache = res.clone();
            safePut(request, toCache);
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // ── Imágenes / iconos: Cache First ──
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request)
        .then(res => {
          if (res.ok) {
            const toCache = res.clone();
            safePut(request, toCache);
          }
          return res;
        })
        .catch(() => cached || new Response('', { status: 504, statusText: 'Offline' }));
    })
  );
});
