// App-shell cache. Bump VERSION on every deploy so phones pick up the new files.
const VERSION = "callup-shell-v87-daily-jobs";
const SHELL = ["./", "index.html", "styles.css", "app.js", "org-settings.js", "firebase-config.js", "route-config.js", "features/quotes.js", "features/route-order.js", "features/swms-sign.js", "features/cloud-storage.js", "features/cloud-retention.js", "features/photo-gallery.js", "features/chat.js", "features/chat-ui.js", "features/chat-notify.js", "features/chat-notify-logic.js", "features/compliance.js", "features/servicing.js", "features/prestart.js", "features/timesheet.js", "features/leave.js", "features/claims.js", "features/hours-export.js", "features/inbox-import.js", "features/company.js", "features/company-ui.js", "features/company-exports.js", "manifest.webmanifest", "icons/callup-wordmark.svg", "icons/apple-touch-icon-180.png",
  "icons/icon-192.png", "icons/icon-512.png", "sounds/chat-ping.wav", "vendor/pdf-lib.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL))); self.skipWaiting(); });
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
    }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match("index.html"))));
  }
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  const data = event.notification.data || {};
  const nested = data.FCM_MSG && data.FCM_MSG.data ? data.FCM_MSG.data : {};
  const thread = data.threadId || nested.threadId || "";
  const view = data.view || nested.view || "";
  const linked = data.url || nested.url || (data.FCM_MSG && data.FCM_MSG.fcmOptions && data.FCM_MSG.fcmOptions.link) || "";
  const url = linked || (view === "today"
    ? new URL("./?jobs=today", self.registration.scope).href
    : (thread ? new URL("./?chat=" + encodeURIComponent(thread), self.registration.scope).href : self.registration.scope));
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const message = view === "today" ? { type: "open-today" } : { type: "open-chat", threadId: thread };
    for (const client of all) {
      if (client.url && client.url.startsWith(self.registration.scope) && "focus" in client) {
        await client.focus();
        client.postMessage(message);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

// Public web config. Same project as firebase-config.js. The Web Push key stays in the page.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBFtHi3ms9hqOq48k_nW3k_ThCvQqXrn-Q",
  authDomain: "heartwood-9f37f.firebaseapp.com",
  projectId: "heartwood-9f37f",
  storageBucket: "heartwood-9f37f.firebasestorage.app",
  messagingSenderId: "414325106644",
  appId: "1:414325106644:web:0163e3ccfe965dd6fa9841",
};
try {
  importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
  firebase.initializeApp(FIREBASE_CONFIG);
  firebase.messaging().onBackgroundMessage(payload => {
    if (payload && payload.notification) return;
    const data = (payload && payload.data) || {};
    const title = data.title || "New chat message";
    return self.registration.showNotification(title, {
      body: data.body || "",
      icon: "icons/icon-192.png",
      tag: data.threadId ? "chat-" + data.threadId : "chat",
      renotify: true,
      data,
    });
  });
} catch (e) { /* cache still works if messaging can't load */ }
