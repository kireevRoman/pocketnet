const CACHE_NAME = 'pocketnet-v9';
const base = () => new URL('./', self.location).href;
const u = (p) => new URL(p, base()).href;
const urlsToCache = [
    u('index.html'),
    u('core.js'),
    u('ui.js'),
    u('bluetooth.js'),
    u('manifest.json'),
    u('lib/qrcode.min.js')
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', event => {
    const path = new URL(event.request.url).pathname;
    if (path.endsWith('/api/portal.bin') || path.endsWith('/api/delta.bin')) {
        event.respondWith(
            fetch(event.request).then((response) => {
                if (response && response.ok && response.status === 200) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                }
                return response;
            }).catch(() => caches.match(event.request))
        );
        return;
    }
    event.respondWith(
        caches.match(event.request).then(response => response || fetch(event.request))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        ))
    );
});
