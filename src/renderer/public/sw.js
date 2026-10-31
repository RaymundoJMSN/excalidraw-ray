// Service worker do PWA (só no build web). /api nunca passa por cache: as cenas vêm sempre do servidor.
// Assets com hash e fontes: cache-first. Páginas: rede primeiro, cache se offline (abre o app sem rede).
const CACHE = 'ray-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req)
      if (hit) return hit
      const r = await fetch(req)
      if (r.ok) c.put(req, r.clone())
      return r
    }))
    return
  }
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(CACHE)
      try {
        const r = await fetch(req)
        if (r.ok) c.put('/index.html', r.clone())
        return r
      } catch {
        return (await c.match('/index.html')) ?? Response.error()
      }
    })())
  }
})
