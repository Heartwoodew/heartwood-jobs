// App-shell cache. Bump VERSION on every deploy so phones pick up the new files.
const VERSION = "callup-shell-v154-last-seen";
const SHELL = ["./", "index.html", "styles.css", "app.js", "org-settings.js", "firebase-config.js", "route-config.js", "features/quotes.js", "features/quote-revisions.js", "features/capacity.js", "features/suburb.js", "features/job-money.js", "features/job-documents.js", "features/job-email.js", "features/autofill.js", "features/job-window.js", "features/dispatch-times.js", "features/places.js", "maps-config.js", "features/route-order.js", "features/swms-sign.js", "features/cloud-storage.js", "features/cloud-retention.js", "features/photo-gallery.js", "features/photo-capture.js", "features/chat.js", "features/chat-ui.js", "features/push.js", "features/push-logic.js", "features/compliance.js", "features/servicing.js", "features/prestart.js", "features/timesheet.js", "features/live-location.js", "features/leave.js", "features/claims.js", "features/hours-export.js", "features/inbox-import.js", "features/inbound-forward.js", "features/company.js", "features/company-logo.js", "features/company-ui.js", "features/dashboard-banners.js", "features/company-exports.js", "features/referral.js", "features/receipts.js", "features/staff-invites.js", "features/trades.js", "features/industry-presets.js", "features/recurrence.js", "features/quote-public.js", "features/certificates.js", "features/packs/money.js", "features/packs/service-trades.js", "features/packs/landscaping.js", "features/packs/concreting.js", "features/packs/fencing.js", "features/packs/carpentry.js", "features/packs/tiling.js", "features/packs/plumbing.js", "features/packs/electrical.js", "features/packs/concrete-cutting.js", "features/packs/form.js", "features/pending-write.js", "features/offline.js", "features/boot-guard.js", "features/performance.js", "features/take5.js", "features/help.js", "features/tutorial-videos.js", "features/support-ticket.js", "features/desktop-install.js", "manifest.webmanifest", "icons/callup-wordmark.svg", "icons/apple-touch-icon-180.png",
  "icons/icon-192.png", "icons/icon-512.png", "vendor/pdf-lib.min.js"];
// The Firebase SDK files the page imports. Precached so the app still opens offline straight after an update,
// when the old cache (which held them) has just been deleted. Keep in step with the import URLs in app.js.
const SDK = ["app", "auth", "firestore", "storage", "functions", "messaging"].map(n => "https://www.gstatic.com/firebasejs/10.14.1/firebase-" + n + ".js");
self.addEventListener("install", e => {
  // The new cache is filled before this worker takes over, so a failed precache cannot delete the shell the phone is using.
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll([...SHELL, ...SDK]);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
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
  // SDK files are versioned, so cache first. Our shell is precached: a phone that already has it
// paints from that copy immediately, and a background fetch refreshes the cache for the next open.
  if (sdk) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const cp = res.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); return res; })));
  } else {
    // cache: "no-cache" revalidates with the server, so the 10-minute GitHub Pages HTTP cache can't serve a stale shell after a deploy.
    // A navigate-mode Request can't take an init, so navigations are rebuilt from the URL.
    e.respondWith((async () => {
      const cached = await caches.match(e.request, { ignoreSearch: true });
      const refresh = (async () => {
        const ctrl = new AbortController();
        const timer = cached ? setTimeout(() => ctrl.abort(), 4000) : null;
        const fresh = e.request.mode === "navigate"
          ? new Request(e.request.url, { cache: "no-cache", credentials: "same-origin", signal: ctrl.signal })
          : new Request(e.request, { cache: "no-cache", signal: ctrl.signal });
        try {
          const res = await fetch(fresh);
          if (timer) clearTimeout(timer);
          const cp = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, cp)).catch(() => {});
          return res;
        } catch {
          if (timer) clearTimeout(timer);
          return null;
        }
      })();
      if (cached) {
        e.waitUntil(refresh.then(() => {}, () => {}));
        return cached;
      }
      const res = await refresh;
      if (res) return res;
      // Only a page load falls back to the app shell. A missing script must fail as a script, not as HTML.
      if (e.request.mode === "navigate") {
        const shell = await caches.match("index.html");
        if (shell) return shell;
      }
      return Response.error();
    })());
  }
});
self.addEventListener("sync", event => {
  if (event.tag !== "callup-uploads") return;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) client.postMessage({ type: "callup-sync" });
  }));
});
// Background chat and job-list pushes. A visible page toasts instead, so this
// does not raise a second system notification while the app is on screen.
// This is the only service worker. app.js registers sw.js and passes that registration to getToken.
// A data-only payload does not show on iOS once the page is closed, so the sender includes a
// notification and this handler calls showNotification from that or from data.
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const data = payload && payload.data && typeof payload.data === "object" ? payload.data : {};
  const note = payload && payload.notification && typeof payload.notification === "object" ? payload.notification : {};
  const title = typeof data.title === "string" && data.title ? data.title : (typeof note.title === "string" ? note.title : "");
  const body = typeof data.body === "string" && data.body ? data.body : (typeof note.body === "string" ? note.body : "");
  const url = typeof data.url === "string" && data.url ? data.url : "./";
  const tag = typeof data.tag === "string" && data.tag ? data.tag : "callup";
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const visible = open.some(client => client.visibilityState === "visible");
    if (visible && title) {
      for (const client of open) client.postMessage({ type: "push-toast", title, body, url, threadId: data.threadId || "" });
      return;
    }
    const shownTitle = title || "CallUp";
    const shownBody = body || "Open CallUp";
    await self.registration.showNotification(shownTitle, {
      body: shownBody, tag, renotify: true, icon: "icons/icon-192.png", data: { url, title: shownTitle, body: shownBody },
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
