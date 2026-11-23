// Opt-in phone notifications. Notification.requestPermission runs only from
// the Turn on button. Foreground messages toast in the app. The service
// worker shows the system notification when the app is in the background.

import { doc, setDoc, getDocs, collection, deleteDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  PUSH_ORIGINS, iosOpenedFromHomeScreen, iosPushHint, notifyPanelHtml, pushBannerHtml, pushEnableError, pushTargetFromUrl, shouldToast, tokenDocId, vapidReady,
} from "./push-logic.js";

export { notifyPanelHtml, pushBannerHtml, pushTargetFromUrl, shouldToast, tokenDocId, vapidReady };

const state = { muteChat: false, muteDaily: false, enabled: false, dismissed: false };
let deps = null;
let prefsUnsub = null;
let pending = null;
let messagingBound = false;
let onSwMessage = null;

export function pushModel() {
  return {
    muteChat: state.muteChat === true,
    muteDaily: state.muteDaily === true,
    enabled: state.enabled === true,
    dismissed: state.dismissed === true,
    iosHint: browserIosHint(),
    permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    vapidReady: vapidReady(deps && deps.vapidKey),
    emulator: !!(deps && deps.emulator),
  };
}

export function browserIosHint() {
  if (typeof navigator === "undefined") return "";
  const displayMode = typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches;
  const standalone = iosOpenedFromHomeScreen({
    navigatorStandalone: navigator.standalone,
    displayMode,
  });
  return iosPushHint({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    standalone,
    notification: typeof Notification !== "undefined",
    pushManager: typeof PushManager !== "undefined",
  });
}

function visibleThread() {
  if (typeof document === "undefined" || !document.querySelectorAll) return "";
  const logs = document.querySelectorAll(".chat-log[data-thread]");
  for (const log of logs) {
    if (log.closest && log.closest("[hidden]")) continue;
    if (log.getClientRects && log.getClientRects().length) return log.dataset.thread || "";
  }
  return "";
}

function toastText(title, body) {
  const head = String(title || "CallUp");
  const text = String(body || "");
  return text ? head + " — " + text : head;
}

let lastToast = "";
let lastToastAt = 0;
function showToast(title, body, threadId) {
  if (!deps || !deps.toast) return;
  if (!shouldToast({
    visibility: typeof document !== "undefined" ? document.visibilityState : "visible",
    viewingThread: visibleThread(),
    threadId: threadId || "",
  })) return;
  const text = toastText(title, body);
  const now = Date.now();
  if (text === lastToast && now - lastToastAt < 2500) return;
  lastToast = text;
  lastToastAt = now;
  deps.toast(text);
}

function paint() {
  if (typeof document === "undefined") return;
  const model = pushModel();
  document.querySelectorAll("[data-push-banner]").forEach(el => { el.hidden = model.enabled || model.dismissed; });
  document.querySelectorAll("[data-mute-chat]").forEach(el => { el.checked = model.muteChat; });
  document.querySelectorAll("[data-mute-daily]").forEach(el => { el.checked = model.muteDaily; });
  document.querySelectorAll(".push-enable").forEach(el => { el.hidden = model.enabled || !!model.iosHint; });
  document.querySelectorAll(".push-off").forEach(el => { el.hidden = !model.enabled; });
}

function dismissKey() {
  const uid = deps && deps.getUid && deps.getUid();
  return uid ? "hwPushLater:" + uid : "";
}

function readDismissed() {
  const key = dismissKey();
  if (!key || typeof localStorage === "undefined") return false;
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}

async function writePrefs(next) {
  const uid = deps && deps.getUid && deps.getUid();
  if (!deps || !uid) return;
  const muteChat = next.muteChat === true;
  const muteDaily = next.muteDaily === true;
  await setDoc(doc(deps.db, "users", uid, "chatSettings", "prefs"), { muteChat, muteDaily });
  state.muteChat = muteChat;
  state.muteDaily = muteDaily;
  paint();
}

async function deleteOwnTokens() {
  const uid = deps.getUid();
  const companyId = deps.getCompanyId();
  const snap = await getDocs(collection(deps.db, "users", uid, "fcmTokens"));
  await Promise.all(snap.docs.filter(d => (d.data() || {}).companyId === companyId).map(d => deleteDoc(d.ref)));
}

async function bindMessaging(messaging) {
  if (messagingBound) return;
  const { onMessage } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js");
  onMessage(messaging, payload => {
    const data = (payload && payload.data) || {};
    showToast(data.title, data.body, data.threadId || "");
  });
  messagingBound = true;
}

async function saveToken() {
  const { getMessaging, getToken, isSupported } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js");
  if (!(await isSupported())) throw new Error("This phone can't subscribe to background notifications.");
  const reg = await navigator.serviceWorker.ready;
  const messaging = getMessaging(deps.app);
  const token = await getToken(messaging, { vapidKey: deps.vapidKey, serviceWorkerRegistration: reg });
  if (!token) return "";
  const id = await tokenDocId(token);
  await setDoc(doc(deps.db, "users", deps.getUid(), "fcmTokens", id), {
    token,
    companyId: deps.getCompanyId(),
    origin: location.origin,
    platform: "web",
    updatedAt: serverTimestamp(),
  });
  await bindMessaging(messaging);
  return token;
}

async function refreshGrantedToken() {
  if (!deps || deps.emulator || !vapidReady(deps.vapidKey)) return;
  if (browserIosHint()) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (!navigator.serviceWorker) return;
  if (!PUSH_ORIGINS.includes(location.origin)) return;
  try {
    const token = await saveToken();
    if (token) state.enabled = true;
    paint();
  } catch { /* stay quiet; the app still works offline */ }
}

function onEnableClick(button) {
  const hint = browserIosHint();
  if (hint) {
    if (deps && deps.toast) deps.toast(hint);
    return;
  }
  if (!deps) return;
  if (typeof Notification === "undefined" || typeof Notification.requestPermission !== "function" || !navigator.serviceWorker) {
    deps.toast("This phone can't show notifications.");
    return;
  }
  // iOS only shows the permission prompt when this call is on the tap itself, not after an await.
  let pending;
  try {
    pending = Notification.requestPermission();
  } catch (err) {
    pending = Promise.reject(err);
  }
  enableNotifications(button, pending);
}

async function enableNotifications(button, permissionPromise) {
  if (!deps) return;
  if (deps.emulator) {
    deps.toast("Notifications work on the installed phone app, not in the emulator.");
    return;
  }
  const hint = browserIosHint();
  if (hint) {
    deps.toast(hint);
    return;
  }
  if (!vapidReady(deps.vapidKey)) {
    deps.toast("Add the Web Push certificate in the app config first.");
    return;
  }
  if (!PUSH_ORIGINS.includes(location.origin)) {
    deps.toast("Notifications are only available on the CallUp website.");
    return;
  }
  if (typeof Notification === "undefined" || !navigator.serviceWorker) {
    deps.toast("This phone can't show notifications.");
    return;
  }
  if (button) button.disabled = true;
  try {
    const perm = permissionPromise ? await permissionPromise : await Notification.requestPermission();
    if (perm !== "granted") {
      deps.toast(perm === "denied" ? "Notifications are blocked on this phone." : "Notifications stay off until you allow them.");
      paint();
      return;
    }
    const token = await saveToken();
    if (!token) {
      deps.toast("Couldn't turn on notifications. No push token was saved for this phone.");
      return;
    }
    await writePrefs({ muteChat: state.muteChat === true, muteDaily: state.muteDaily === true });
    state.enabled = true;
    paint();
    deps.toast("Notifications are on for this phone.");
  } catch (err) {
    deps.toast(pushEnableError(err));
  } finally {
    if (button) button.disabled = false;
  }
}

function bindRoot(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll(".push-enable").forEach(button => {
    if (button.dataset.bound === "1") return;
    button.dataset.bound = "1";
    button.addEventListener("click", () => onEnableClick(button));
  });
  root.querySelectorAll(".push-later").forEach(button => {
    if (button.dataset.bound === "1") return;
    button.dataset.bound = "1";
    button.addEventListener("click", () => {
      state.dismissed = true;
      const key = dismissKey();
      try { if (key) localStorage.setItem(key, "1"); } catch { /* private mode */ }
      paint();
      if (deps && deps.rerender) deps.rerender();
    });
  });
  root.querySelectorAll("[data-mute-chat]").forEach(box => {
    if (box.dataset.bound === "1") return;
    box.dataset.bound = "1";
    box.addEventListener("change", () => {
      writePrefs({ muteChat: box.checked, muteDaily: state.muteDaily === true }).catch(() => deps && deps.toast("Couldn't save that setting."));
    });
  });
  root.querySelectorAll("[data-mute-daily]").forEach(box => {
    if (box.dataset.bound === "1") return;
    box.dataset.bound = "1";
    box.addEventListener("change", () => {
      writePrefs({ muteChat: state.muteChat === true, muteDaily: box.checked }).catch(() => deps && deps.toast("Couldn't save that setting."));
    });
  });
  root.querySelectorAll(".push-off").forEach(button => {
    if (button.dataset.bound === "1") return;
    button.dataset.bound = "1";
    button.addEventListener("click", () => {
      deleteOwnTokens()
        .then(() => { state.enabled = false; paint(); deps && deps.toast("Notifications are off on this phone."); })
        .catch(() => deps && deps.toast("Couldn't turn notifications off."));
    });
  });
}

export function installPush(next) {
  deps = next || null;
  return {
    model: pushModel,
    panelHtml: () => notifyPanelHtml(pushModel()),
    bannerHtml: () => pushBannerHtml(pushModel()),
    start() {
      state.dismissed = readDismissed();
      pending = pushTargetFromUrl(typeof location !== "undefined" ? location.href : "") || pending;
      if (!deps || !deps.getUid || !deps.getUid()) return;
      if (prefsUnsub) return;
      prefsUnsub = onSnapshot(doc(deps.db, "users", deps.getUid(), "chatSettings", "prefs"), snap => {
        const data = snap && typeof snap.exists === "function" && snap.exists() ? (snap.data() || {}) : {};
        state.muteChat = data.muteChat === true;
        state.muteDaily = data.muteDaily === true;
        paint();
      }, () => {});
      if (typeof navigator !== "undefined" && navigator.serviceWorker && !onSwMessage) {
        onSwMessage = event => {
          const data = event && event.data;
          if (!data || !deps) return;
          if (data.type === "push-toast") showToast(data.title, data.body, data.threadId || "");
          if (data.type === "push-open" && data.url) {
            pending = pushTargetFromUrl(data.url) || pending;
            if (deps.rerender) deps.rerender();
          }
        };
        navigator.serviceWorker.addEventListener("message", onSwMessage);
      }
      refreshGrantedToken();
    },
    stop() {
      if (prefsUnsub) {
        try { prefsUnsub(); } catch { /* already stopped */ }
        prefsUnsub = null;
      }
      if (onSwMessage && typeof navigator !== "undefined" && navigator.serviceWorker) {
        navigator.serviceWorker.removeEventListener("message", onSwMessage);
      }
      onSwMessage = null;
      state.muteChat = false;
      state.muteDaily = false;
      state.enabled = false;
      state.dismissed = false;
    },
    mount(root) { bindRoot(root); paint(); },
    settle() {
      if (!pending || !deps || !deps.open) return;
      if (deps.open(pending)) pending = null;
    },
  };
}
