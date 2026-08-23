/**
 * Service worker (tasks 5a, 3j).
 *
 * Two jobs, and deliberately no more:
 *
 *   1. Cache the app shell so it launches offline.
 *   2. Wake on the Background Sync event and tell any open client to flush its outbox.
 *
 * NOTE on the division of labour: the worker does NOT itself commit to GitHub. Doing so would
 * mean duplicating the merge algorithm, the serializer, and the token handling here, and — worse
 * — giving the token to a second context. Instead it wakes a client, which already holds all of
 * that. When no client is open the sync is re-registered so it fires again later, which costs
 * one wake-up and keeps exactly one implementation of the write path.
 */

const CACHE = "bookmarks-shell-v1";
const SYNC_TAG = "bookmarks-flush";

self.addEventListener("install", (event) => {
  // The shell is small; precaching only the entry point keeps this honest, and the rest is
  // filled in on first fetch.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["./", "./index.html"]))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never cache the API. Stale bookmark data served from a cache would be far worse than an
  // offline error, because the app would commit on top of it.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      // Navigations: network first so a deploy is picked up, cache as the offline fallback.
      if (request.mode === "navigate") {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put("./index.html", response.clone());
          return response;
        } catch {
          const cached = await caches.match("./index.html");
          return cached ?? Response.error();
        }
      }

      // Assets are content-hashed by Vite, so cache-first is safe and fast.
      const cached = await caches.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});

/**
 * Background Sync (task 3j).
 *
 * Chrome on Android fires this when connectivity returns, even with the app closed — which is
 * the case that matters: a bookmark shared on the Underground must still reach GitHub after the
 * user has put the phone away (§6.2).
 */
self.addEventListener("sync", (event) => {
  if (event.tag !== SYNC_TAG) return;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      if (clients.length > 0) {
        for (const client of clients) client.postMessage({ type: "flush-outbox" });
        return;
      }

      // No window to do the work. Re-registering makes the browser fire this again later
      // rather than dropping the queued changes on the floor.
      try {
        await self.registration.sync.register(SYNC_TAG);
      } catch {
        // Nothing further we can do; the outbox is durable and will flush on next open.
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "skip-waiting") self.skipWaiting();
});
