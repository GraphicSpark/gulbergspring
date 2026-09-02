// Minimal service worker. Its only job is to exist so Chrome treats the app as
// an installable PWA and honours the manifest's `share_target`. No caching -
// every request goes straight to the network (the app must always be fresh).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
