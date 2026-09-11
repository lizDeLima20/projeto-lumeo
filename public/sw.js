const SW_VERSION = "v11";
const SHELL_CACHE = `lumeo-shell-${SW_VERSION}`;
const ASSET_CACHE = `lumeo-assets-${SW_VERSION}`;
const RUNTIME_CACHE = `lumeo-runtime-${SW_VERSION}`;
const LOOKUP_CACHE = `lumeo-lookup-${SW_VERSION}`;
const LUMEO_CACHES = [SHELL_CACHE, ASSET_CACHE, RUNTIME_CACHE, LOOKUP_CACHE];
// Only what the shell needs to boot offline. The 890 KB source logo used to be precached
// here on every install; the sized icons below are a few KB each.
const APP_SHELL = ["/", "/index.html", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/favicon-48.png"];
const BOOK_FILE_PATTERN = /\.(pdf|epub|lima)$/i;
const ASSET_PATTERN = /\.(css|js|mjs|png|jpg|jpeg|svg|webp|ico|woff2?|ttf)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("lumeo-") && !LUMEO_CACHES.includes(key))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET") return;
  // OAuth callbacks must never receive the offline app shell or be cached.
  if (url.origin === self.location.origin && url.pathname === "/onedrive-auth.html") return;
  if (BOOK_FILE_PATTERN.test(url.pathname)) return;

  if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirst(request, SHELL_CACHE, "/index.html"));
    return;
  }

  if (url.origin === self.location.origin && ASSET_PATTERN.test(url.pathname)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (url.pathname.startsWith("/api/") || url.pathname.includes("/dictionary") || url.pathname.includes("/lookup")) {
    event.respondWith(networkFirst(request, LOOKUP_CACHE));
    return;
  }

  if (url.origin === self.location.origin) event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refreshing = fetch(request).then((response) => {
    if (response.ok) void cache.put(request, response.clone());
    return response;
  }).catch(() => undefined);
  return cached ?? await refreshing ?? new Response("Offline", { status: 503, statusText: "Offline" });
}
