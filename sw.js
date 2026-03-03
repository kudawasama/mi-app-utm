self.addEventListener('install', event => {
    event.waitUntil(
        caches.open('utm-finanzas-v1').then(cache => {
            // Allow them down softly if they are not cached, it just falls back to network
            return cache.addAll([
                './index.html',
                './index.css',
                './app.js',
                './manifest.json'
            ]);
        })
    );
    self.skipWaiting();
});

self.addEventListener('fetch', event => {
    if (event.request.url.includes('mindicador.cl')) {
        // Para la API no guardamos en cache eterno, usa la red
        event.respondWith(
            fetch(event.request).catch(() => caches.match(event.request))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});
