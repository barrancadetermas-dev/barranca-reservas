const V='7.0.1',CA=`mila-app-${V}`,CS=`mila-static-${V}`;
self.addEventListener('install',e=>{e.waitUntil(caches.open(CA).then(c=>c.add('/offline.html').catch(()=>{})).then(()=>self.skipWaiting()).catch(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all([...k.filter(x=>x.startsWith('mila-')&&x!==CA&&x!==CS).map(x=>caches.delete(x)),self.clients.claim()])));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.hostname.includes('supabase.co')||u.hostname.includes('dolarapi')||u.hostname.includes('ambito')||u.hostname.includes('bluelytics')||u.hostname.includes('esm.sh'))return;if(u.hostname.includes('gstatic')||u.hostname.includes('googleapis')){e.respondWith(cf(e.request));return;}e.respondWith(nf(e.request));});
async function nf(r){try{const x=await fetch(r);if(x.ok)(await caches.open(CA)).put(r,x.clone());return x;}catch{return(await caches.match(r))||(r.mode==='navigate'?caches.match('/offline.html'):new Response('',{status:503}));}}
async function cf(r){return(await caches.match(r))||nf(r);}
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();});
