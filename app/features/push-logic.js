// Pure notification decisions. No Firebase and no DOM.
// The browser module wires the Enable button, tokens and toasts.

export const VAPID_PLACEHOLDER = "REPLACE_WITH_WEB_PUSH_CERTIFICATE";

export const PUSH_ORIGINS = Object.freeze([
  "https://jobs.heartwoodew.com",
  "https://app.callupapp.com.au",
  "https://callupapp.web.app",
]);

const THREAD_RE = /^job_[A-Za-z0-9_-]{1,200}$/;

export function vapidReady(key) {
  const value = String(key || "").trim();
  return value.length >= 20 && value !== VAPID_PLACEHOLDER;
}

export const IOS_HOME_STEPS = "Add CallUp to your Home Screen first. In Safari, tap Share, then Add to Home Screen, then open CallUp from the icon.";

export function isIosDevice({ userAgent = "", platform = "", maxTouchPoints = 0 } = {}) {
  const ua = String(userAgent || "");
  return /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && Number(maxTouchPoints) > 1);
}

// navigator.standalone is false in an iOS Safari tab and true only from the Home Screen icon.
// On iOS that flag wins. A display-mode match by itself can be wrong in a tab, and web push is then refused.
export function iosOpenedFromHomeScreen({ navigatorStandalone, displayMode = false } = {}) {
  if (navigatorStandalone === true) return true;
  if (navigatorStandalone === false) return false;
  return displayMode === true;
}

export function iosPushHint({
  userAgent = "", platform = "", maxTouchPoints = 0, standalone = false, notification = true, pushManager = true,
} = {}) {
  if (!isIosDevice({ userAgent, platform, maxTouchPoints })) return "";
  const installed = standalone === true && notification !== false && pushManager !== false;
  if (installed) return "";
  return IOS_HOME_STEPS;
}

export function pushEnableError(err) {
  const raw = String((err && (err.code || err.message)) || "not-enabled");
  if (/permission-denied|unauthorized/i.test(raw)) return "You can't enable notifications on this login.";
  const detail = raw.replace(/^FirebaseError:\s*/i, "").replace(/^messaging\//, "").slice(0, 160);
  if (!detail || detail === "not-enabled") return "Couldn't turn on notifications.";
  return "Couldn't turn on notifications. " + detail;
}

// A saved push token is background. Everything else is the open page (chat listener and foreground toasts).
export function pushDeliveryStatus({ iosHint = "", permission = "", subscribed = false } = {}) {
  if (subscribed === true && !iosHint) return { mode: "background", label: "Background notifications on", steps: "" };
  let steps = String(iosHint || "");
  if (!steps && permission === "denied") {
    steps = "Notifications are blocked on this phone. On Android, allow notifications. On iPhone, add CallUp to the Home Screen, open it from the icon, then allow notifications.";
  } else if (!steps) {
    steps = "On iPhone, add CallUp to the Home Screen and open it from the icon, then turn on notifications. On Android, allow notifications.";
  }
  return {
    mode: "in-app",
    label: "In-app alerts only — notifications arrive only while CallUp is open",
    steps,
  };
}

export function shouldToast({ visibility, viewingThread, threadId } = {}) {
  if (visibility !== "visible") return false;
  if (viewingThread && threadId && viewingThread === threadId) return false;
  return true;
}

export function pushTargetFromUrl(href) {
  let params;
  try {
    params = new URL(String(href || ""), "https://jobs.heartwoodew.com").searchParams;
  } catch {
    return null;
  }
  const ticket = params.get("ticket") || "";
  if (/^[A-Za-z0-9]{16,28}$/.test(ticket)) return { kind: "ticket", ticketId: ticket };
  if (params.get("jobs") === "today" || params.get("open") === "today") return { kind: "today" };
  if (params.get("open") === "timesheet") return { kind: "timesheet" };
  const prestart = params.get("prestart");
  if (prestart) {
    const assetId = prestart === "1" ? "" : prestart;
    if (assetId && !/^[A-Za-z0-9_-]{1,80}$/.test(assetId)) return null;
    const prestartKind = params.get("kind") || "";
    if (prestartKind && !/^[a-z0-9-]{1,40}$/.test(prestartKind)) return null;
    const day = params.get("day") || "";
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const jobId = params.get("psjob") || "";
    if (jobId && !/^[A-Za-z0-9_-]{1,200}$/.test(jobId)) return null;
    return { kind: "prestart", assetId, prestartKind, day, jobId };
  }
  const thread = params.get("chat") || (params.get("open") === "chat" ? params.get("thread") || "" : "");
  if (thread === "staff" || THREAD_RE.test(thread)) return { kind: "chat", thread };
  return null;
}

export async function tokenDocId(token) {
  const data = new TextEncoder().encode(String(token || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function deliveryBlock(model) {
  const delivery = pushDeliveryStatus({
    iosHint: model.iosHint, permission: model.permission, subscribed: model.enabled === true,
  });
  const steps = delivery.steps ? ` ${esc(delivery.steps)}` : "";
  return `<p class="push-status" data-push-status="${esc(delivery.mode)}"><b>${esc(delivery.label)}</b>${steps}</p>`;
}

export function notifyPanelHtml(model = {}) {
  const hint = model.iosHint ? `<p class="push-ios">${esc(model.iosHint)}</p>` : "";
  const enable = model.enabled || model.iosHint
    ? ""
    : `<button type="button" class="sm-btn primary push-enable">Turn on notifications</button>`;
  const off = model.enabled ? `<button type="button" class="sm-btn push-off">Turn off notifications on this phone</button>` : "";
  const note = model.emulator
    ? `<p class="sub">Notifications are off in the emulator. Use the installed phone app.</p>`
    : (!model.vapidReady ? `<p class="sub">Notifications need the Web Push certificate in the app config before this phone can subscribe.</p>` : "");
  return `<section class="pad push-panel" data-push-panel>
    <h3>Notifications</h3>
    <p class="sub">Pings this phone for chat, and a morning list of your jobs.</p>
    ${deliveryBlock(model)}
    ${enable}
    ${hint}
    <label class="ck"><input type="checkbox" data-mute-chat ${model.muteChat ? "checked" : ""}> Mute chat notifications</label>
    <label class="ck"><input type="checkbox" data-mute-daily ${model.muteDaily ? "checked" : ""}> Mute daily job list</label>
    ${off}
    ${note}
  </section>`;
}

export function pushBannerHtml(model = {}) {
  if (!model || model.enabled || model.dismissed) return "";
  const delivery = pushDeliveryStatus({ iosHint: model.iosHint, permission: model.permission, subscribed: false });
  if (model.iosHint) {
    return `<section class="push-banner" data-push-banner><p class="push-ios">${esc(delivery.label)}</p><p>${esc(model.iosHint)}</p></section>`;
  }
  return `<section class="push-banner" data-push-banner>
    <p><b>${esc(delivery.label)}</b> ${esc(delivery.steps)}</p>
    <button type="button" class="sm-btn primary push-enable">Turn on notifications</button>
    <button type="button" class="sm-btn push-later">Not now</button>
  </section>`;
}
