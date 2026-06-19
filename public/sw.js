// ═══════════════════════════════════════════════════
// sw.js v7.0 — MILA Sistema Inteligente
// ESTRATEGIA CORRECTA:
//   - index.html + JS/CSS  → network-first (siempre busca la versión más nueva)
//   - Fonts / íconos       → cache-first   (no cambian)
//   - Supabase / APIs      → network-only  (nunca cachear datos)
//   - Offline              → fallback a offline.html
// ═══════════════════════════════════════════════════

// ⚠️ IMPORTANTE: Cada vez que deploys, incrementá este número.
// Eso fuerza al browser a instalar el nuevo SW y limpiar el caché viejo.
const SW_VERSION  = '7.0.0';

const CACHE_STATIC = `mila-static-${SW_VERSION}`;   // fonts e íconos
const CACHE_APP    = `mila-app-${SW_VERSION}`;       // shell de la app
const OFFLINE_URL  = '/offline.html';

// Assets que se pre-cachean al instalar (solo los que nunca cambian)
const PRECACHE_ASSETS = [
  '/offline.html',
  '/manifest.json',
];

// ── INSTALL ────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_APP)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())  // activar inmediatamente sin esperar tab cerrado
      .catch(() => self.skipWaiting())
  );
});

// ── ACTIVATE ───────────────────────────────────────
// Elimina TODOS los cachés viejos (cualquier versión anterior)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(allKeys => {
      const oldKeys = allKeys.filter(k =>
        k.startsWith('mila-') &&
        k !== CACHE_STATIC &&
        k !== CACHE_APP
      );
      return Promise.all([
        ...oldKeys.map(k => caches.delete(k)),
        self.clients.claim(),  // tomar control de todos los tabs abiertos
      ]);
    })
  );
});

// ── FETCH ──────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // 1. Supabase, APIs externas → SOLO RED (nunca cachear datos)
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('dolarapi.com') ||
    url.hostname.includes('ambito.com') ||
    url.hostname.includes('bluelytics.com') ||
    url.hostname.includes('esm.sh') ||
    url.hostname.includes('resend.com')
  ) {
    e.respondWith(networkOnly(request));
    return;
  }

  // 2. Fonts de Google → cache-first (no cambian nunca)
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    e.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // 3. index.html + JS + CSS → network-first
  //    Siempre intenta la versión más nueva. Cae al caché solo si no hay red.
  if (
    request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css')
  ) {
    e.respondWith(networkFirst(request, CACHE_APP));
    return;
  }

  // 4. Imágenes, íconos, manifests → cache-first
  if (url.pathname.match(/\.(png|ico|svg|webp|json)$/)) {
    e.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // 5. Todo lo demás → network-first
  e.respondWith(networkFirst(request, CACHE_APP));
});

// ── ESTRATEGIAS ─────────────────────────────────────

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(
      JSON.stringify({ error: 'sin conexión', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok && cacheName) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Sin red → buscar en caché
    const cached = await caches.match(request);
    if (cached) return cached;
    // Si es navegación → mostrar página offline
    if (request.mode === 'navigate') {
      return caches.match(OFFLINE_URL) ||
        new Response('<h1>Sin conexión</h1>', {
          headers: { 'Content-Type': 'text/html' }
        });
    }
    return new Response('offline', { status: 503 });
  }
}

async function cacheFirst(request, cacheName) {
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
    return new Response('offline', { status: 503 });
  }
}

// ── MENSAJES DESDE LA APP ───────────────────────────
self.addEventListener('message', (e) => {
  // La app puede pedir al SW que se actualice
  if (e.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // La app puede pedir limpiar el caché manualmente
  if (e.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => {
      e.source?.postMessage({ type: 'CACHE_CLEARED' });
    });
  }
});

// ── BACKGROUND SYNC ─────────────────────────────────
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-bookings') {
    e.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({
          type: 'SYNC_COMPLETE',
          message: 'Conexión restaurada — datos sincronizados'
        }))
      )
    );
  }
});
