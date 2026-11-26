const CACHE_NAME = "xyz-podcast-shell-v25";
const SHELL_ASSETS = [
  "/",
  "/css/app.css",
  "/js/app.js",
  "/js/api.js",
  "/js/storage.js",
  "/js/utils.js",
  "/js/xyzParser.js",
  "/js/freshness.js",
  "/js/overlayHistory.js",
  "/js/components/AppIcon.js",
  "/js/components/AboutDialog.js",
  "/js/components/EpisodeView.js",
  "/js/components/LibraryDrawer.js",
  "/js/components/PlayerBar.js",
  "/js/components/PlaylistDrawer.js",
  "/js/components/PodcastView.js",
  "/js/components/RankBoard.js",
  "/site.webmanifest",
  "/icon.svg",
  "/icon.png",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Only handle same-origin static assets; never cache /api/*, /__scheduled, or external origins
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/__scheduled"
  ) {
    return;
  }

  const isNavigation = req.mode === "navigate";

  // Network-first so deployments take effect immediately; safe per-type offline fallback
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const exact = await caches.match(req);
        if (exact) return exact;
        if (isNavigation) {
          const shell = await caches.match("/");
          if (shell) return shell;
        } else {
          // Match static JS/CSS across version query strings (?v=...) without returning HTML
          const ignoreQuery = await caches.match(url.pathname, { ignoreSearch: true });
          if (ignoreQuery) return ignoreQuery;
        }
        throw new Error("Network unavailable and asset is not cached");
      })
  );
});
