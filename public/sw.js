// App-shell pass-through. Never caches /api/ — stale family data is worse
// than an error. Static files already revalidate cheaply via ETags, so this
// worker exists mainly to make the app installable; offline caching can grow
// here later without touching the API rule.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  // No respondWith: the network (and the browser's normal HTTP cache) answers.
});
