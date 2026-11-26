// Phone error log. A signed-in person can record a short failure for their own company.
// An admin reads the latest ones in Settings. The record has no prices, tokens, or GPS.

export const CLIENT_ERROR_SESSION_MAX = 20;
export const CLIENT_ERROR_MESSAGE_MAX = 500;
export const CLIENT_ERROR_STACK_MAX = 2048;
export const CLIENT_ERROR_FIELDS = Object.freeze([
  "createdAt", "uid", "role", "appVersion", "swVersion", "screen", "message", "stack", "userAgent", "online",
]);

const URL_QUERY = /(https?:\/\/[^\s?#]+)(\?[^\s#]*)/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const SECRET = /\b(?:bearer|token|password|secret|api[_-]?key|authorization)\b\s*[:=]?\s*\S+/gi;
const GPS = /\b(?:lat(?:itude)?|lng|lon(?:gitude)?)\b\s*[:=]?\s*-?\d+(?:\.\d+)?/gi;
const COORD_PAIR = /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g;
const MONEY = /(?:\$|aud\s*)\d[\d,]*(?:\.\d{1,2})?/gi;

export function scrubClientText(value, max, { keepLines = false } = {}) {
  let text = String(value ?? "").replace(/\u0000/g, "");
  text = text.replace(URL_QUERY, "$1");
  text = text.replace(JWT, "[redacted]");
  text = text.replace(SECRET, "[redacted]");
  text = text.replace(GPS, "[location]");
  text = text.replace(COORD_PAIR, "[location]");
  text = text.replace(MONEY, "[amount]");
  if (keepLines) text = text.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  else text = text.replace(/[\t ]*\n[\t ]*/g, " ").replace(/[ \t]{2,}/g, " ").trim();
  return text.slice(0, max);
}

export function clientErrorText(err) {
  if (err == null) return "";
  if (typeof err === "string" || typeof err === "number") return String(err);
  if (typeof err === "object") return String(err.message || err.code || "");
  return "";
}

// The live rules do not have clientErrors yet. A denied write must not be reported again.
export function clientErrorWriteDenied(err) {
  const code = String(err && err.code || "");
  const text = clientErrorText(err);
  return code === "permission-denied" || code === "permission_denied"
    || /permission-denied|PERMISSION_DENIED|Missing or insufficient permissions/.test(text);
}

export function clientErrorWorthSending(message) {
  const text = String(message || "");
  if (!text) return false;
  return !( /clientErrors/.test(text) && /permission-denied|PERMISSION_DENIED/.test(text) );
}

export function clientErrorScreen(loc, view) {
  const path = String((loc && loc.pathname) || "");
  const route = String(view || "").replace(/[\r\n]/g, " ").trim();
  return (path + (route ? " " + route : "")).replace(/\s+/g, " ").trim().slice(0, 120);
}

export function createClientErrorGate(max = CLIENT_ERROR_SESSION_MAX) {
  const seen = new Set();
  let sent = 0;
  return {
    get sent() { return sent; },
    accept(message) {
      const key = String(message || "");
      if (!key || seen.has(key) || sent >= max) return false;
      seen.add(key);
      sent += 1;
      return true;
    },
  };
}

// companyId chooses the collection. It is not stored on the document.
export function clientErrorPayload(input, gate) {
  const uid = String(input.uid || "").trim();
  const companyId = String(input.companyId || "").trim();
  if (!uid || !companyId) return null;
  const message = scrubClientText(input.message, CLIENT_ERROR_MESSAGE_MAX);
  if (!message || !gate || !gate.accept(message)) return null;
  return {
    companyId,
    data: {
      uid,
      role: scrubClientText(input.role, 40),
      appVersion: scrubClientText(input.appVersion, 80),
      swVersion: scrubClientText(input.swVersion, 80),
      screen: scrubClientText(input.screen, 120),
      message,
      stack: scrubClientText(input.stack, CLIENT_ERROR_STACK_MAX, { keepLines: true }),
      userAgent: scrubClientText(input.userAgent, 300),
      online: input.online === true,
    },
  };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function clientErrorWhen(value) {
  try {
    const date = value && typeof value.toDate === "function" ? value.toDate()
      : value && typeof value.seconds === "number" ? new Date(value.seconds * 1000)
      : value instanceof Date ? value : null;
    if (!date || Number.isNaN(date.getTime())) return "Waiting to sync";
    return date.toLocaleString("en-AU", { hour12: false, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function clientErrorsHtml(rows, state) {
  const head = `<section class="pad" id="clienterrors"><h3>Phone errors</h3>`;
  // Hidden until a read succeeds. A denied read (rules not deployed yet) shows nothing.
  if (state === "hidden" || state === "loading" || !state) return "";
  if (state === "error") return `${head}<p class="sub">Couldn't load phone errors.</p></section>`;
  const list = (rows || []).slice(0, 100);
  if (!list.length) return `${head}<p class="sub">No phone errors yet.</p></section>`;
  const items = list.map(row => {
    const online = row.online === true ? "Online" : "Offline";
    return `<li><b>${esc(clientErrorWhen(row.createdAt))}</b> · ${esc(row.role || "staff")} · ${esc(online)}<br><span class="sub">${esc(row.screen || "")}</span><p>${esc(row.message || "")}</p>${row.stack ? `<pre>${esc(row.stack)}</pre>` : ""}</li>`;
  }).join("");
  return `${head}<p class="sub">Latest ${list.length} from this company. Only an admin can see these.</p><ul class="client-errors">${items}</ul></section>`;
}
