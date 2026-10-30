const CACHE='gocargo-cotizador-2026-v1.3-auth-gate-icon';
const ASSETS=['./','./index.html','./manifest.webmanifest','./assets/icon-cotizador-v3.svg','./assets/icon-cotizador-192-v3.png','./assets/icon-cotizador-512-v3.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('gocargo-cotizador-')&&k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(fetch(event.request).then(response=>{
   const u=new URL(event.request.url);
   if(response.ok && (u.pathname.endsWith('/cotizador/')||u.pathname.endsWith('/cotizador/index.html'))){
     const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));
   }
   return response;
 }).catch(()=>caches.match(event.request)));
});
