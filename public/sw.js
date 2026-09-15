/* NIGHTWATCH AI service worker.
 * Precache the app shell; network-first for API; cache-first for assets. */
const CACHE = 'nw-v3'
const SHELL = ['./', './manifest.webmanifest']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  // Keep in sync with API_PREFIXES in server/static-serve.mjs — all API JSON
  // is network-first; live data must never be served from the static cache.
  const isApi = /^\/(health|metrics|bitget|prices|news|research|desk|auth|session|push|positioning|book|marketintel|macro|signals|history|backtest|share|alerts|trading|copilot|vapid|paper|playbooks|leaderboard|assayer)(\/|$|\?)/.test(url.pathname)
  if (isApi) {
    // network-first, no cache for live data
    e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
    return
  }
  // HTML documents — network-first with cache fallback so deploys propagate;
  // hashed build assets stay cache-first (immutable by filename).
  if (e.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone()
        caches.open(CACHE).then(c => c.put(e.request, clone))
      }
      return res
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./'))))
    return
  }
  // static assets — cache-first
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok && e.request.method === 'GET' && url.origin === self.location.origin) {
      const clone = res.clone()
      caches.open(CACHE).then(c => c.put(e.request, clone))
    }
    return res
  }).catch(() => caches.match('./'))))
})

/* Web Push handler */
self.addEventListener('push', (e) => {
  let data = { title: 'NIGHTWATCH AI', body: 'New breaking news' }
  try { data = e.data.json() } catch { /* text fallback */ }
  const options = {
    body: data.body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'nw-news',
    data: data.url || './',
    renotify: true,
  }
  e.waitUntil(self.registration.showNotification(data.title, options))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus() }
    if (clients.openWindow) return clients.openWindow(e.notification.data || './')
  }))
})
