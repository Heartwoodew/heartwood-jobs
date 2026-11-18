// App-shell cache. Bump VERSION on every deploy so phones pick up the new files.
const VERSION = "callup-shell-v130-emailcompress";
const SHELL = ["./", "index.html", "styles.css", "app.js", "org-settings.js", "firebase-config.js", "route-config.js", "features/quotes.js", "features/quote-revisions.js", "features/capacity.js", "features/job-money.js", "features/job-documents.js", "features/job-email.js", "features/job-window.js", "features/dispatch-times.js", "features/places.js", "maps-config.js", "features/route-order.js", "features/swms-sign.js", "features/cloud-storage.js", "features/cloud-retention.js", "features/photo-gallery.js", "features/photo-capture.js", "features/chat.js", "features/chat-ui.js", "features/push.js", "features/push-logic.js", "features/compliance.js", "features/servicing.js", "features/prestart.js", "features/timesheet.js", "features/live-location.js", "features/leave.js", "features/claims.js", "features/hours-export.js", "features/inbox-import.js", "features/company.js", "features/company-logo.js", "features/company-ui.js", "features/company-exports.js", "features/referral.js", "features/receipts.js", "features/staff-invites.js", "features/trades.js", "features/packs/money.js", "features/packs/landscaping.js", "features/packs/concreting.js", "features/packs/fencing.js", "features/packs/carpentry.js", "features/packs/tiling.js", "features/packs/plumbing.js", "features/packs/electrical.js", "features/packs/concrete-cutting.js", "features/packs/form.js", "features/pending-write.js", "features/performance.js", "features/take5.js", "features/help.js", "manifest.webmanifest", "icons/callup-wordmark.svg", "icons/apple-touch-icon-180.png",
  "icons/icon-192.png", "icons/icon-512.png", "vendor/pdf-lib.min.js"];
// The Firebase SDK files the page imports. Precached so the app still opens offline straight after an update,
// when the old cache (which held them) has just been deleted. Keep in step with the import URLs in app.js.
const SDK = ["app", "auth", "firestore", "storage", "messaging"].map(n => "https://www.gstatic.com/firebasejs/10.14.1/firebase-" + n + ".js");
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
// Background chat and job-list pushes. A visible page toasts instead, so this
// does not raise a second system notification while the app is on screen.
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const data = payload && payload.data ? payload.data : payload;
  const title = data && typeof data.title === "string" ? data.title : "";
  const body = data && typeof data.body === "string" ? data.body : "";
  if (!title) return;
  const url = data && typeof data.url === "string" ? data.url : "./";
  const tag = data && typeof data.tag === "string" ? data.tag : "callup";
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (open.some(client => client.visibilityState === "visible")) {
      for (const client of open) client.postMessage({ type: "push-toast", title, body, url, threadId: data.threadId || "" });
      return;
    }
    await self.registration.showNotification(title, {
      body, tag, renotify: true, icon: "icons/icon-192.png", data: { url, title, body },
    });
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of open) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        client.postMessage({ type: "push-open", url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
