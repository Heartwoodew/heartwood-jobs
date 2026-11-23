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

export function iosPushHint({ userAgent = "", platform = "", maxTouchPoints = 0, standalone = false } = {}) {
  const ua = String(userAgent || "");
  const iOS = /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
  if (!iOS || standalone) return "";
  return "Add to Home Screen to get notifications";
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
  if (model.iosHint) return `<section class="push-banner" data-push-banner><p class="push-ios">${esc(model.iosHint)}</p></section>`;
  return `<section class="push-banner" data-push-banner>
    <p>Chat messages need to ping this phone.</p>
    <button type="button" class="sm-btn primary push-enable">Turn on notifications</button>
    <button type="button" class="sm-btn push-later">Not now</button>
  </section>`;
}
