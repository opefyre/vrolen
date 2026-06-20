/* VROL-421 — Minimal native service worker for the Vrolen app shell.
 *
 * Strategy:
 *   - Precache the app shell on install (index.html only — Vite-hashed
 *     bundles get cached lazily by the fetch handler on first hit, which
 *     handles every deployment without us baking the asset list at build).
 *   - Fetch handler:
 *       * Navigation requests → network-first, fall back to cached index.html.
 *       * Same-origin static assets → stale-while-revalidate.
 *       * Cross-origin requests → bypass (let the browser handle).
 *   - On activate, sweep old caches.
 */

const CACHE_VERSION = "vrolen-v1";
const APP_SHELL = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: network-first with index.html fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/index.html").then((r) => r ?? new Response("Offline", { status: 503 })),
      ),
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(req).then((cached) => {
        const networkFetch = fetch(req)
          .then((res) => {
            // Only cache successful, basic-type responses.
            if (res && res.status === 200 && res.type === "basic") {
              cache.put(req, res.clone());
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      }),
    ),
  );
});
