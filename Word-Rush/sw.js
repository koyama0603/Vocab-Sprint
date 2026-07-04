const CACHE_PREFIX = "word-rush-assets-";
const META_CACHE = "word-rush-meta";

async function deleteWordRushCaches() {
  const names = await caches.keys();
  await Promise.all(names
    .filter((name) => name === META_CACHE || name.startsWith(CACHE_PREFIX))
    .map((name) => caches.delete(name)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(deleteWordRushCaches());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await deleteWordRushCaches();
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
