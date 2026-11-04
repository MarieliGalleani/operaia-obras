/*
 * OperaIA Obras — service worker do app de obra sem internet.
 *
 * - Telas (navegação): tenta a rede; sem sinal, abre a última versão guardada do app.
 * - Arquivos do app (/assets, com hash no nome) e fontes: guarda na primeira vez e usa a cópia.
 * - Fotos da obra (/api/media/obras, nome aleatório e imutável): guarda para ver sem sinal.
 * - Restante da API: não passa por aqui (o próprio app guarda os dados e a fila em IndexedDB).
 */
const VERSION = 'operaia-obras-v1'
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function cacheFirst(request) {
  const cache = await caches.open(VERSION)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone())
  return res
}

async function networkFirstPage(request) {
  const cache = await caches.open(VERSION)
  try {
    const res = await fetch(request)
    if (res.ok) cache.put('/', res.clone())
    return res
  } catch {
    return (await cache.match('/')) || Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin

  if (req.mode === 'navigate' && sameOrigin && !url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstPage(req))
    return
  }
  if (sameOrigin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/api/media/obras/'))) {
    event.respondWith(cacheFirst(req))
    return
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req))
  }
})
