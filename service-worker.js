/* ---------------- CONFIG ---------------- */
const CACHE_NAME = "moviedrift-cache-v3"; // increment version
const TMDB_CACHE = "tmdb-cache-v1";       // cache for TMDB API
const TMDB_QUEUE = [];                    // in-memory queue for incremental updates

/* ---------------- INSTALL ---------------- */
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([
      "./",
      "./index.html",
      "./img/logo.png",
      "./offline.html" // optional fallback page
    ]);
    self.skipWaiting();
  })());
});

/* ---------------- ACTIVATE ---------------- */
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key !== CACHE_NAME && key !== TMDB_CACHE)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

/* ---------------- MESSAGE HANDLER ---------------- */
self.addEventListener("message", event => {
  if (!event.data) return;

  switch (event.data.type) {
    case "SKIP_WAITING":
      self.skipWaiting();
      break;
    case "QUEUE_TMDB":
      if (event.data.urls?.length) {
        TMDB_QUEUE.push(...event.data.urls);
        processQueue();
      }
      break;
  }
});

/* ---------------- TMDB QUEUE PROCESSING ---------------- */
let isProcessing = false;

async function processQueue() {
  if (isProcessing || TMDB_QUEUE.length === 0) return;
  isProcessing = true;

  while (TMDB_QUEUE.length > 0) {
    const url = TMDB_QUEUE.shift();
    try {
      const response = await fetch(url);
      // Allow successful or cross-origin opaque responses
      if (response.ok || response.status === 0) {
        const clone = response.clone();
        const cache = await caches.open(TMDB_CACHE);
        await cache.put(url, clone);

        // Notify clients
        const clientsList = await self.clients.matchAll();
        clientsList.forEach(client =>
          client.postMessage({ type: "NEW_TMDB_ITEM", url })
        );
      }
    } catch (err) {
      console.warn("Failed to update TMDB item:", url, err);
    }
  }

  isProcessing = false;
}

/* ---------------- FETCH HANDLER ---------------- */
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Guard: ONLY handle standard HTTP/HTTPS protocols and GET requests
  if (!url.protocol.startsWith("http") || event.request.method !== "GET") {
    return;
  }

  event.respondWith((async () => {
    // --- 1. TMDB API: network-first, fallback cache ---
    if (url.hostname.includes("api.themoviedb.org")) {
      try {
        const response = await fetch(event.request);
        if (response.ok || response.status === 0) {
          const clone = response.clone();
          const cache = await caches.open(TMDB_CACHE);
          await cache.put(event.request, clone);
        }
        return response;
      } catch {
        const cached = await caches.match(event.request);
        return cached || new Response(JSON.stringify({ error: "TMDB offline" }), {
          headers: { "Content-Type": "application/json" },
          status: 503
        });
      }
    }

    // --- 2. Navigation requests: network-first, fallback offline page ---
    if (event.request.mode === "navigate") {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const clone = response.clone();
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, clone);
        }
        return response;
      } catch {
        return (await caches.match(event.request)) || (await caches.match("./offline.html"));
      }
    }

    // --- 3. Static assets: cache-first, fallback network ---
    const cached = await caches.match(event.request);
    if (cached) return cached;

    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const clone = response.clone();
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, clone);
      }
      return response;
    } catch {
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});