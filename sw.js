// BaranTrack service worker — safe caching.
// - Navigations (HTML): network-first, so a new deploy ALWAYS shows immediately;
//   falls back to the cached page only when offline.
// - Same-origin static assets: cache-first (fast, offline-capable).
// - Netlify Functions and cross-origin requests: never cached (always live data).
const CACHE = 'barantrack-v1';
const ASSETS = ['/', '/index.html', '/icon.svg', '/manifest.json', '/vendor/zxing.min.js'];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS).catch(function(){}); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== location.origin) return;          // APIs/CDN -> straight to network
  if (url.pathname.indexOf('/.netlify/') === 0) return; // functions -> never cache

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function(res){
        caches.open(CACHE).then(function(c){ c.put('/index.html', res.clone()); });
        return res;
      }).catch(function(){
        return caches.match('/index.html').then(function(r){ return r || caches.match('/'); });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function(cached){
      return cached || fetch(req).then(function(res){
        if (res && res.status === 200) {
          var clone = res.clone();
          caches.open(CACHE).then(function(c){ c.put(req, clone); });
        }
        return res;
      }).catch(function(){ return cached; });
    })
  );
});
