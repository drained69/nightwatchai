/* NIGHTWATCH AI service worker.
 * Cache-first ONLY for content-hashed build assets (/assets/*); network-first
 * with offline fallback for the HTML shell; everything else — every API route
 * and any dev module — goes straight to the network, untouched.
 *
 * The previous worker cached anything outside a hard-coded API prefix list,
 * cache-first and forever. /nightwatch was missing from that list, so browsers
 * kept showing the first Alpha of the Day brief, status and email on/off state
 * they ever loaded (keyed by URL alone, across accounts). Allow-listing what
 * MAY be cached removes that whole class of bug for future routes too.
 *
 * Bumping CACHE makes `activate` delete every older cache, including nw-v3
 * with its stale per-user API responses.
 */
const CACHE = 'nw-v4'
const SHELL = ['./', './manifest.webmanifest']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // HTML documents — network-first with cache fallback so deploys propagate.
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) {
        const clone = res.clone()
        caches.open(CACHE).then(c => c.put(req, clone))
      }
      return res
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./'))))
    return
  }
  // Hashed build assets — immutable by filename, so cache-first is safe.
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) {
        const clone = res.clone()
        caches.open(CACHE).then(c => c.put(req, clone))
      }
      return res
    })))
  }
  // Anything else (API JSON, icons, dev modules): default network handling.
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
