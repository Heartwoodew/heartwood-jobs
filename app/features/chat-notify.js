// Browser wiring for the chat ping and the notification opt-in.
// Notification.requestPermission runs only from the Enable button.

import { doc, setDoc, getDocs, collection, deleteDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  chatAlertsHtml, incomingPing, iosPushHint, PUSH_ORIGINS, readChatParam, readJobsParam, takeHead, takeIncoming, tokenDocId,
} from "./chat-notify-logic.js";

export { chatAlertsHtml, incomingPing, iosPushHint, readChatParam, readJobsParam, takeHead, takeIncoming, tokenDocId };

const slots = new Map();
const alertState = { sound: true, push: false, dailyJobs: true };
let deps = null;
let prefsUnsub = null;
let audio = null;
let primed = false;

export function alertsModel() {
  return {
    sound: alertState.sound !== false,
    push: alertState.push === true,
    dailyJobs: alertState.dailyJobs !== false,
    iosHint: browserIosHint(),
    vapidReady: !!(deps && deps.vapidKey),
    emulator: !!(deps && deps.emulator),
  };
}

export function browserIosHint() {
  if (typeof navigator === "undefined") return "";
  const standalone = navigator.standalone === true
    || (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);
  return iosPushHint({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    standalone,
  });
}

export function visibleChatThread(root) {
  if (!root || !root.querySelectorAll) return "";
  const logs = root.querySelectorAll(".chat-log[data-thread]");
  for (const log of logs) {
    if (log.closest && log.closest("[hidden]")) continue;
    if (log.getClientRects && log.getClientRects().length) return log.dataset.thread || "";
  }
  return "";
}

function soundOn() {
  return alertState.sound !== false;
}

function showAlerts(alerts) {
  if (!deps || !alerts || !alerts.length) return;
  const last = alerts.filter(a => a.toast).pop();
  if (!last) return;
  deps.toast(last.toast);
  if (alerts.some(a => a.play)) playPing();
}

function slotFor(threadId) {
  if (!slots.has(threadId)) slots.set(threadId, { seen: new Set(), booted: false, previous: "", headBooted: false });
  return slots.get(threadId);
}

export function noteMessages(threadId, messages, myUid) {
  const slot = slotFor(threadId);
  const result = takeIncoming({
    messages,
    myUid,
    threadId,
    appVisible: typeof document !== "undefined" && document.visibilityState === "visible",
    viewingThreadId: typeof document !== "undefined" ? visibleChatThread(document) : "",
    soundEnabled: soundOn(),
    seen: slot.seen,
    booted: slot.booted,
  });
  slot.seen = result.seen;
  slot.booted = result.booted;
  showAlerts(result.alerts);
}

export function noteHead(threadId, head, myUid, messagesOwned) {
  const slot = slotFor(threadId);
  const result = takeHead({
    head,
    myUid,
    threadId,
    appVisible: typeof document !== "undefined" && document.visibilityState === "visible",
    viewingThreadId: typeof document !== "undefined" ? visibleChatThread(document) : "",
    soundEnabled: soundOn(),
    messagesOwned: !!messagesOwned,
    previous: slot.previous,
    booted: slot.headBooted,
  });
  slot.previous = result.previous;
  slot.headBooted = result.booted;
  showAlerts(result.alerts);
}

export function resetChatAlerts() {
  slots.clear();
  if (prefsUnsub) {
    try { prefsUnsub(); } catch { /* already stopped */ }
    prefsUnsub = null;
  }
  alertState.sound = true;
  alertState.push = false;
  alertState.dailyJobs = true;
}

function audioEl() {
  if (audio || typeof Audio === "undefined") return audio;
  try {
    audio = new Audio(new URL("../sounds/chat-ping.wav", import.meta.url).href);
    audio.preload = "auto";
  } catch { audio = null; }
  return audio;
}

export function bindPingUnlock(target) {
  if (!target || target.__chatPingUnlock) return;
  target.__chatPingUnlock = true;
  const prime = () => {
    if (primed) return;
    const a = audioEl();
    if (!a) return;
    const prev = a.volume;
    a.volume = 0;
    const played = a.play();
    if (played && typeof played.then === "function") {
      played.then(() => {
        a.pause();
        a.currentTime = 0;
        a.volume = prev || 1;
        primed = true;
      }).catch(() => { a.volume = prev || 1; });
    }
  };
  target.addEventListener("pointerdown", prime, { capture: true });
  target.addEventListener("keydown", prime, { capture: true });
}

export function playPing() {
  const a = audioEl();
  if (!a) return;
  try {
    a.pause();
    a.currentTime = 0;
    a.volume = 1;
    const played = a.play();
    if (played && typeof played.catch === "function") played.catch(() => {});
  } catch { /* autoplay still locked */ }
}

function paintAlerts() {
  if (typeof document === "undefined") return;
  document.querySelectorAll("[data-chat-alerts]").forEach(el => {
    const sound = el.querySelector("[data-chat-sound]");
    const push = el.querySelector("[data-chat-push]");
    const button = el.querySelector(".chat-enable");
    if (sound) sound.checked = alertState.sound !== false;
    if (push) {
      push.checked = alertState.push === true;
      push.disabled = alertState.push !== true;
    }
    if (button) button.hidden = alertState.push === true;
    const daily = el.querySelector("[data-daily-jobs]");
    if (daily) {
      daily.checked = alertState.dailyJobs !== false;
      daily.disabled = alertState.push !== true;
    }
  });
}

async function writePrefs(next) {
  const uid = deps && deps.getUid && deps.getUid();
  if (!deps || !uid) return;
  const sound = next.sound !== false;
  const push = next.push === true;
  const dailyJobs = next.dailyJobs !== false;
  await setDoc(doc(deps.db, "users", uid, "chatSettings", "prefs"), { sound, push, dailyJobs });
  alertState.sound = sound;
  alertState.push = push;
  alertState.dailyJobs = dailyJobs;
  paintAlerts();
}

async function deleteOwnTokens() {
  const uid = deps.getUid();
  const companyId = deps.getCompanyId();
  const snap = await getDocs(collection(deps.db, "users", uid, "fcmTokens"));
  await Promise.all(snap.docs.filter(d => (d.data() || {}).companyId === companyId).map(d => deleteDoc(d.ref)));
}

async function enableChatNotifications(button) {
  if (!deps) return;
  if (deps.emulator) {
    deps.toast("Notifications work on the installed phone app, not in the emulator.");
    return;
  }
  if (!deps.vapidKey) {
    deps.toast("Chat notifications need the Web Push key in the app config.");
    return;
  }
  if (!PUSH_ORIGINS.includes(location.origin)) {
    deps.toast("Chat notifications are only available on the CallUp website.");
    return;
  }
  if (typeof Notification === "undefined" || !navigator.serviceWorker) {
    deps.toast("This phone can't show chat notifications.");
    return;
  }
  if (button) button.disabled = true;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      deps.toast("Notifications stay off until you allow them in the phone settings.");
      return;
    }
    const { getMessaging, getToken, isSupported } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js");
    if (!(await isSupported())) {
      deps.toast("This browser can't show chat notifications.");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(deps.app), { vapidKey: deps.vapidKey, serviceWorkerRegistration: reg });
    if (!token) {
      deps.toast("Couldn't turn on notifications.");
      return;
    }
    const id = await tokenDocId(token);
    await setDoc(doc(deps.db, "users", deps.getUid(), "fcmTokens", id), {
      token,
      companyId: deps.getCompanyId(),
      origin: location.origin,
      platform: "web",
      updatedAt: serverTimestamp(),
    });
    await writePrefs({ sound: alertState.sound !== false, push: true, dailyJobs: alertState.dailyJobs !== false });
    deps.toast("Chat notifications are on for this phone.");
  } catch (err) {
    const code = (err && (err.code || err.message)) || "not-enabled";
    deps.toast(/permission-denied|unauthorized/i.test(String(code)) ? "You can't enable notifications on this login." : "Couldn't turn on notifications.");
  } finally {
    if (button) button.disabled = !deps.vapidKey || !!deps.emulator;
  }
}

export function bindChatAlerts(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll("[data-chat-alerts]").forEach(el => {
    if (el.dataset.bound === "1") return;
    el.dataset.bound = "1";
    const sound = el.querySelector("[data-chat-sound]");
    const push = el.querySelector("[data-chat-push]");
    const button = el.querySelector(".chat-enable");
    if (sound) sound.addEventListener("change", () => {
      writePrefs({ sound: sound.checked, push: alertState.push === true, dailyJobs: alertState.dailyJobs !== false }).catch(() => deps && deps.toast("Couldn't save that setting."));
    });
    if (push) push.addEventListener("change", () => {
      if (push.checked) return;
      writePrefs({ sound: alertState.sound !== false, push: false, dailyJobs: alertState.dailyJobs !== false })
        .then(() => deleteOwnTokens())
        .then(() => deps && deps.toast("Notifications are off on this phone."))
        .catch(() => deps && deps.toast("Couldn't turn notifications off."));
    });
    const daily = el.querySelector("[data-daily-jobs]");
    if (daily) daily.addEventListener("change", () => {
      if (alertState.push !== true) return;
      writePrefs({ sound: alertState.sound !== false, push: true, dailyJobs: daily.checked }).catch(() => deps && deps.toast("Couldn't save that setting."));
    });
    if (button) button.addEventListener("click", () => enableChatNotifications(button));
  });
}

export function installChatAlerts(next) {
  deps = next || null;
}

export function startChatAlerts() {
  if (!deps || !deps.getUid || !deps.getUid()) return;
  if (prefsUnsub) return;
  prefsUnsub = onSnapshot(doc(deps.db, "users", deps.getUid(), "chatSettings", "prefs"), snap => {
    const data = snap.exists() ? (snap.data() || {}) : {};
    alertState.sound = data.sound !== false;
    alertState.push = data.push === true;
    alertState.dailyJobs = data.dailyJobs !== false;
    paintAlerts();
  }, () => {});
}

export function stopChatAlerts() {
  resetChatAlerts();
}
