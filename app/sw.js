// App-shell cache. Bump VERSION on every deploy so phones pick up the new files.
const VERSION = "hw-shell-v12";
const SHELL = ["./", "index.html", "styles.css", "app.js", "firebase-config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Firestore/Auth API traffic is never cached here (the SDK has its own offline cache).
  if (u.hostname.endsWith("googleapis.com") || u.port === "8080" || u.port === "9099") return;
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
