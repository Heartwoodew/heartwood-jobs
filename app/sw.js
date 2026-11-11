// App-shell cache. Bump VERSION on every deploy so phones pick up the new files.
const VERSION = "callup-shell-v87-offline";
const SHELL = ["./", "index.html", "styles.css", "app.js", "org-settings.js", "firebase-config.js", "route-config.js", "features/quotes.js", "features/route-order.js", "features/swms-sign.js", "features/cloud-storage.js", "features/cloud-retention.js", "features/photo-gallery.js", "features/chat.js", "features/chat-ui.js", "features/compliance.js", "features/servicing.js", "features/prestart.js", "features/timesheet.js", "features/leave.js", "features/claims.js", "features/hours-export.js", "features/inbox-import.js", "features/company.js", "features/company-ui.js", "features/company-exports.js", "features/staff-invites.js", "features/pending-write.js", "manifest.webmanifest", "icons/callup-wordmark.svg", "icons/apple-touch-icon-180.png",
  "icons/icon-192.png", "icons/icon-512.png", "vendor/pdf-lib.min.js"];
// The Firebase SDK files the page imports. Precached so the app still opens offline straight after an update,
// when the old cache (which held them) has just been deleted. Keep in step with the import URLs in app.js.
const SDK = ["app", "auth", "firestore", "storage"].map(n => "https://www.gstatic.com/firebasejs/10.14.1/firebase-" + n + ".js");
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll([...SHELL, ...SDK]))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // A spreadsheet download is a blob: URL. Its origin matches this page, so it would otherwise be fetched here and the file would never save.
  if (u.protocol === "blob:") return;
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
    // cache: "no-cache" revalidates with the server, so the 10-minute GitHub Pages HTTP cache can't serve a stale shell after a deploy.
    // A navigate-mode Request can't take an init, so navigations are rebuilt from the URL.
    const fresh = e.request.mode === "navigate"
      ? new Request(e.request.url, { cache: "no-cache", credentials: "same-origin" })
      : new Request(e.request, { cache: "no-cache" });
    e.respondWith(fetch(fresh).then(res => {
      const cp = res.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); return res;
    }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r
      // Only a page load falls back to the app shell. A missing script must fail as a script, not as HTML.
      || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
  }
});
