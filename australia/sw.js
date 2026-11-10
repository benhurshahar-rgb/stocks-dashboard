// Minimal service worker so Chrome installs this launcher as a real app (no shortcut arrow).
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {});
