/*
 * Service worker do painel (PWA). De propósito, quase nada: não guarda páginas nem dados (tudo tem login
 * e muda o tempo todo). Só mostra a página "Sem conexão" quando a navegação falha por falta de rede.
 */
const CACHE = 'obd-offline-v1';
const OFFLINE = '/offline';
const SHELL = [OFFLINE, '/static/css/offline.css', '/assets/logos/eletroinfo.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
    return;
  }
  // Arquivos da própria página "Sem conexão".
  const url = new URL(request.url);
  if (url.origin === self.location.origin && SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then((hit) => hit || fetch(request)));
  }
});
