/* Mentor AI Paper Lab: cached app shell for installation and reopening.
   Real-time FYERS and Claude API requests are NEVER cached. */
const CACHE = 'mentor-ai-paper-lab-shell-v3';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon.svg',
  './icons/mentor-ai-192.png', './icons/mentor-ai-512.png', './icons/apple-touch-icon-180.png'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE.map(path => new URL(path, self.registration.scope).toString()))));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('mentor-ai-paper-lab-shell-') && key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/.netlify/')) return;
  // Always try network first so GitHub Pages updates take precedence.
  event.respondWith(fetch(req).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(req, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(req)) || (req.mode === 'navigate'
    ? caches.match(new URL('./index.html', self.registration.scope).toString())
    : Response.error())));
});
