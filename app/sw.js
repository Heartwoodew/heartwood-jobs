// App-shell cache. Bump VERSION on every deploy so phones pick up the new files.
const VERSION = "callup-shell-v68-staff";
const SHELL = ["./", "index.html", "styles.css", "app.js", "org-settings.js", "firebase-config.js", "route-config.js", "features/quotes.js", "features/route-order.js", "features/swms-sign.js", "features/cloud-storage.js", "features/cloud-retention.js", "features/photo-gallery.js", "features/chat.js", "features/chat-ui.js", "features/helper.js", "features/helper-ui.js", "features/compliance.js", "features/servicing.js", "features/prestart.js", "features/timesheet.js", "features/leave.js", "manifest.webmanifest", "icons/callup-wordmark.svg", "icons/apple-touch-icon-180.png",
  "icons/icon-192.png", "icons/icon-512.png", "vendor/pdf-lib.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Firestore/Auth API traffic is never cached here (the SDK has its own offline cache).
  if (u.hostname.endsWith("googleapis.com") || u.port === "8080" || u.port === "9099" || u.port === "9199") return;
  const sameOrigin = u.origin === location.origin;
  const sdk = u.hostname === "www.gstatic.com" && u.pathname.startsWith("/firebasejs/");
  if (!sameOrigin && !sdk) return;
  // Network first for our own files (fresh after deploy), cache fallback when offline; SDK is versioned so cache first.
  if (sdk) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const cp = res.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); return res; })));
  } else {
    e.respondWith(fetch(e.request).then(res => {
      const cp = res.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); return res;
    }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match("index.html"))));
  }
});
