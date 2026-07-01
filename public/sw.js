// ═══════════════════════════════════════════════════
// MILA PMS — Service Worker v7
// Estrategia: Network First con fallback offline
// FIX: clone() debe llamarse SÍNCRONAMENTE al recibir
// la respuesta, nunca dentro de un .then() posterior,
// porque para entonces el body ya puede estar consumido
// (causaba "Response body is already used").
// ═══════════════════════════════════════════════════

const CACHE_NAME  = 'mila-v7';
const OFFLINE_URL = '/offline.html';

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

// Guarda una respuesta en cache de forma segura, sin romper
// el flujo principal si algo falla (cuota llena, etc.)
function safePut(request, response) {
  caches.open(CACHE_NAME)
    .then(c => c.put(request, response))
    .catch(err => console.warn('[SW] cache put failed:', err));
}

// ── Fetch: Network First para todo ──
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // No interceptar otros orígenes (Supabase, etc.)
  if (url.origin !== self.location.origin) return;
  if (request.method !== 'GET') return;

  // HTML: Network First, fallback offline
  if (request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(request)
        .then(res => {
          // Clonar INMEDIATAMENTE, antes de devolver la respuesta original
          const toCache = res.clone();
          safePut(request, toCache);
          return res;
        })
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // JS/CSS: Network First (evita servir código viejo tras deploy)
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

  // Imágenes / iconos: Cache First (no cambian)
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok) {
          const toCache = res.clone();
          safePut(request, toCache);
        }
        return res;
      });
    })
  );
});
