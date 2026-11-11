const CACHE_NAME='safe-mandate-offline-v1';
const OFFLINE_URL='/offline.html';

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll([OFFLINE_URL,'/icons/safe-mandate.svg'])).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  // Never persist navigation, API, guardian-token, or transaction responses.
  if(request.mode==='navigate'){
    event.respondWith(fetch(request,{cache:'no-store'}).catch(()=>caches.match(OFFLINE_URL)));
    return;
  }
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/guardian/')||url.pathname.startsWith('/app/')){
    event.respondWith(fetch(request,{cache:'no-store'}));
    return;
  }
  // The only offline cache is the generic offline screen and its app icon.
});
