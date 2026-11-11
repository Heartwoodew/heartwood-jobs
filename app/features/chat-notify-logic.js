// Pure chat-alert decisions. No Firebase and no DOM.
// The browser module wires sound, tokens and the Enable button.

export const PUSH_ORIGINS = Object.freeze([
  "https://jobs.heartwoodew.com",
  "https://app.callupapp.com.au",
  "https://callupapp.web.app",
]);

export function messageToast(message) {
  const name = String((message && message.senderName) || "Staff").trim() || "Staff";
  const text = String((message && message.text) || "").replace(/\s+/g, " ").trim();
  const preview = text || (message && message.photoPath ? "Photo" : "New message");
  return (name + ": " + preview).slice(0, 120);
}

export function incomingPing({ message, myUid, threadId, appVisible, viewingThreadId, soundEnabled }) {
  if (!message || !message.id || !message.senderUid || message.senderUid === myUid) return { play: false, toast: "" };
  if (!appVisible) return { play: false, toast: "" };
  if (viewingThreadId && viewingThreadId === threadId) return { play: false, toast: "" };
  return { play: soundEnabled !== false, toast: messageToast(message) };
}

export function takeIncoming({ messages, myUid, threadId, appVisible, viewingThreadId, soundEnabled, seen, booted }) {
  const next = new Set(seen || []);
  const alerts = [];
  for (const message of messages || []) {
    if (!message || !message.id || next.has(message.id)) continue;
    next.add(message.id);
    if (!booted) continue;
    const decision = incomingPing({ message, myUid, threadId, appVisible, viewingThreadId, soundEnabled });
    if (decision.toast) alerts.push(decision);
  }
  return { seen: next, booted: true, alerts };
}

export function headKey(head) {
  if (!head) return "";
  const at = head.lastAt;
  let ms = "";
  if (at && typeof at.toMillis === "function") ms = String(at.toMillis());
  else if (at && typeof at.seconds === "number") ms = String(at.seconds * 1000);
  else if (typeof at === "number") ms = String(at);
  return String(head.lastSenderUid || "") + ":" + ms + ":" + String(head.preview || "");
}

export function takeHead({ head, myUid, threadId, appVisible, viewingThreadId, soundEnabled, messagesOwned, previous, booted }) {
  const key = headKey(head);
  if (!booted || messagesOwned || !head || !key || key === previous) {
    return { previous: key, booted: true, alerts: [] };
  }
  if (!head.lastSenderUid || head.lastSenderUid === myUid) {
    return { previous: key, booted: true, alerts: [] };
  }
  const decision = incomingPing({
    message: {
      id: key,
      senderUid: head.lastSenderUid,
      senderName: head.lastSenderName,
      text: head.preview,
    },
    myUid,
    threadId,
    appVisible,
    viewingThreadId,
    soundEnabled,
  });
  return { previous: key, booted: true, alerts: decision.toast ? [decision] : [] };
}

export function iosPushHint({ userAgent = "", platform = "", maxTouchPoints = 0, standalone = false } = {}) {
  const ua = String(userAgent || "");
  const iOS = /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
  if (!iOS || standalone) return "";
  return "On iPhone, add CallUp to your Home Screen first. Chat notifications need that, and iOS 16.4 or later.";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function chatAlertsHtml(model = {}, { open = false } = {}) {
  const sound = model.sound !== false;
  const push = model.push === true;
  const hint = model.iosHint ? `<p class="chat-ios">${esc(model.iosHint)}</p>` : "";
  const note = model.emulator
    ? `<p class="sub">Notifications are off in the emulator. Use the installed phone app.</p>`
    : (!model.vapidReady ? `<p class="sub">Notifications need the Web Push key in the app config before this phone can subscribe.</p>` : "");
  const body = `<h3>Chat alerts</h3>
    <label class="ck"><input type="checkbox" data-chat-sound ${sound ? "checked" : ""}> Ping sound when the app is open</label>
    <label class="ck"><input type="checkbox" data-chat-push ${push ? "checked" : ""} ${push ? "" : "disabled"}> Notifications when the app is closed</label>
    <button type="button" class="chat-enable primary" ${push ? "hidden" : ""} ${(!model.vapidReady || model.emulator) ? "disabled" : ""}>Enable chat notifications</button>
    ${hint}${note}
    <p class="chat-alerts-err" data-chat-alerts-err></p>`;
  if (open) return `<section class="chat-alerts card" data-chat-alerts>${body}</section>`;
  return `<details class="chat-alerts" data-chat-alerts><summary>Chat alerts</summary>${body}</details>`;
}

export async function tokenDocId(token) {
  const data = new TextEncoder().encode(String(token || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function readChatParam(search) {
  const raw = String(search || "");
  const q = raw.startsWith("?") ? raw.slice(1) : raw;
  const thread = new URLSearchParams(q).get("chat") || "";
  if (thread === "staff" || /^job_[A-Za-z0-9_-]{1,200}$/.test(thread)) return thread;
  return "";
}
