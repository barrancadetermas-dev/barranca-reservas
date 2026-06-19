const SW_VERSION  = '7.0.0';
const CACHE_APP    = `mila-app-${SW_VERSION}`;
const CACHE_STATIC = `mila-static-${SW_VERSION}`;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_APP)
      .then(c => c.add('/offline.html'))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all([
      ...keys.filter(k => k.startsWith('mila-') && k !== CACHE_APP && k !== CACHE_STATIC)
             .map(k => caches.delete(k)),
      self.clients.claim()
    ]))
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('dolarapi.com') ||
      url.hostname.includes('ambito.com') ||
      url.hostname.includes('bluelytics.com')) {
    return; // network only — no cache
  }
  if (url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('fonts.googleapis.com')) {
    e.respondWith(cacheFirst(e.request, CACHE_STATIC)); return;
  }
  // JS, CSS, HTML → siempre busca la versión nueva primero
  e.respondWith(networkFirst(e.request, CACHE_APP));
});

async function networkFirst(req, cache) {
  try {
    const r = await fetch(req);
    if (r.ok) (await caches.open(cache)).put(req, r.clone());
    return r;
  } catch {
    return (await caches.match(req)) ||
      (req.mode === 'navigate' ? caches.match('/offline.html') : new Response('', {status:503}));
  }
}
async function cacheFirst(req, cache) {
  return (await caches.match(req)) || networkFirst(req, cache);
}

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
