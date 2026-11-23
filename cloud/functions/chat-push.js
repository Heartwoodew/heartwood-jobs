// Who receives a chat push, and which device tokens are dead.
// Pure: no firebase-admin import. push-schedule.js wires Firestore and FCM.
// A token is stored per user and tagged with companyId. A person only
// hears a chat when that company matches and the chat rules would let
// them open the thread. The sender is never included.

export const ALEX_UID = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
export const PATRICK_UID = "R7t41e54Ykcdk9WPdVZnDd697iI2";
export const HEARTWOOD_COMPANY = "heartwood";
export const PUSH_BODY_MAX = 100;

export const PUSH_ORIGINS = Object.freeze([
  "https://jobs.heartwoodew.com",
  "https://app.callupapp.com.au",
  "https://callupapp.web.app",
]);

const STALE_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

const THREAD_RE = /^job_[A-Za-z0-9_-]{1,200}$/;

export function userCompany(profile, uid) {
  const company = profile && typeof profile.companyId === "string" ? profile.companyId.trim() : "";
  if (company) return company;
  const tenant = profile && typeof profile.tenantId === "string" ? profile.tenantId.trim() : "";
  if (tenant) return tenant;
  if (profile || uid === ALEX_UID || uid === PATRICK_UID) return HEARTWOOD_COMPANY;
  return "";
}

export function jobCompany(job) {
  if (!job || typeof job !== "object") return "";
  const company = typeof job.companyId === "string" ? job.companyId.trim() : "";
  if (company) return company;
  const tenant = typeof job.tenantId === "string" ? job.tenantId.trim() : "";
  if (tenant) return tenant;
  return HEARTWOOD_COMPANY;
}

function customerOk(profile, job) {
  const ids = profile && Array.isArray(profile.customerIds)
    ? profile.customerIds.filter(x => typeof x === "string" && x.trim())
    : [];
  if (!profile || !ids.length) return true;
  return typeof job.client === "string" && ids.includes(job.client);
}

export function threadJobId(threadId) {
  if (typeof threadId !== "string" || !THREAD_RE.test(threadId)) return "";
  return threadId.slice(4);
}

// Suburb or street, never a price. Dollar amounts are stripped so a stray
// figure in an address cannot ride along in the notification.
export function jobPlace(job) {
  const scrub = value => String(value || "").replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, "").replace(/\s+/g, " ").trim();
  const suburb = scrub(job && job.suburb);
  if (suburb) return suburb.slice(0, 40);
  const address = scrub(job && job.address);
  if (!address) return "";
  const parts = address.split(",").map(part => part.trim()).filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  const cleaned = last.replace(/\b(QLD|NSW|VIC|SA|WA|TAS|NT|ACT|Australia)\b/gi, "").replace(/\b\d{4}\b/g, "").trim();
  return (cleaned || parts[0] || address).slice(0, 40);
}

export function truncatePush(text, max = PUSH_BODY_MAX) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  const limit = Math.max(1, max);
  if (flat.length <= limit) return flat;
  return flat.slice(0, limit - 1).trimEnd() + "…";
}

// Same visibility as the chat rules: staff is every member of that company.
// A job thread is an admin, or someone on assigned, with customer scope.
// Alex and Patrick can see every Heartwood job chat.
export function canReceiveChat({ uid, profile, tenantId, threadId, job }) {
  const company = userCompany(profile, uid);
  if (!uid || !company || company !== tenantId) return false;
  if (threadId === "staff") return true;
  const jobId = threadJobId(threadId);
  if (!jobId || !job) return false;
  if (job.id && job.id !== jobId) return false;
  if (jobCompany(job) !== tenantId) return false;
  if (tenantId === HEARTWOOD_COMPANY && (uid === ALEX_UID || uid === PATRICK_UID)) return true;
  if (!customerOk(profile, job)) return false;
  if (profile && profile.role === "admin") return true;
  return Array.isArray(job.assigned) && job.assigned.includes(uid);
}

export function selectChatRecipients({ tenantId, threadId, senderUid, job, people }) {
  const out = [];
  for (const person of people || []) {
    if (!person || !person.uid || person.uid === senderUid) continue;
    if (person.muteChat === true) continue;
    if (!canReceiveChat({
      uid: person.uid,
      profile: person.profile || null,
      tenantId,
      threadId,
      job,
    })) continue;
    for (const token of person.tokens || []) {
      if (!token || token.companyId !== tenantId) continue;
      if (typeof token.token !== "string" || token.token.length < 20) continue;
      out.push({
        uid: person.uid,
        tokenId: token.id,
        token: token.token,
        origin: typeof token.origin === "string" ? token.origin : "",
      });
    }
  }
  return out;
}

export function chatOpenUrl(origin, threadId, companyId) {
  const fallback = companyId === HEARTWOOD_COMPANY
    ? "https://jobs.heartwoodew.com"
    : "https://app.callupapp.com.au";
  const base = PUSH_ORIGINS.includes(origin) ? origin : fallback;
  return base + "/app/?chat=" + encodeURIComponent(String(threadId || ""));
}

export function chatNameFor(threadId, job) {
  if (threadId === "staff") return "Team chat";
  const place = jobPlace(job);
  return place || "Job chat";
}

// Title is the sender and the chat name. Body is the message text, cut to
// about 100 characters. A photo with no text says "Sent a photo". Chat text
// is sent as written: no price fields are added.
export function chatPushContent({ tenantId, threadId, message, job, origin }) {
  const name = String((message && message.senderName) || "Staff").trim().slice(0, 80) || "Staff";
  const text = String((message && message.text) || "");
  const photo = !!(message && message.photoPath);
  const flat = text.replace(/\s+/g, " ").trim();
  const body = !flat && photo ? "Sent a photo" : truncatePush(flat || "New message");
  const title = truncatePush(name + " · " + chatNameFor(threadId, job), 120);
  const url = chatOpenUrl(origin, threadId, tenantId);
  const tag = "chat-" + String(threadId || "staff");
  return {
    title,
    body,
    url,
    data: {
      kind: "chat",
      title,
      body,
      threadId: String(threadId || ""),
      companyId: String(tenantId || ""),
      url,
      tag,
    },
  };
}

function pushIconUrl(pageUrl) {
  try {
    const u = new URL(String(pageUrl || ""));
    if (u.protocol !== "https:") return "";
    return u.origin + "/app/icons/icon-192.png";
  } catch {
    return "";
  }
}

// Web push on iOS is dropped when the payload is data-only and the page is closed.
// notification (and webpush.notification) is what the phone shows. data stays for the service worker.
export function fcmMessage(target, content) {
  const data = (content && content.data) || {};
  const title = String(data.title || (content && content.title) || "CallUp").slice(0, 120);
  const body = String(data.body || (content && content.body) || "").slice(0, 180);
  const link = String((content && content.url) || data.url || "");
  const icon = pushIconUrl(link);
  const webNotification = { title, body };
  if (icon) webNotification.icon = icon;
  return {
    token: target.token,
    data,
    notification: { title, body },
    webpush: {
      headers: { Urgency: "high" },
      notification: webNotification,
      fcmOptions: link ? { link } : {},
    },
  };
}

export function isStaleTokenError(error) {
  const code = String((error && error.code) || error || "");
  return STALE_CODES.has(code);
}

export function staleTargets(responses, targets) {
  const drop = [];
  (responses || []).forEach((row, i) => {
    if (!row || row.success !== false || !targets[i]) return;
    if (isStaleTokenError(row.error)) drop.push(targets[i]);
  });
  return drop;
}

export async function dispatchChatPush({ tenantId, threadId, message, loadJob, loadPeople, sendEach, deleteToken }) {
  const senderUid = message && message.senderUid;
  if (!tenantId || !threadId || !senderUid) return { sent: 0, dropped: 0, skipped: "empty" };
  if (threadId !== "staff" && !threadJobId(threadId)) return { sent: 0, dropped: 0, skipped: "thread" };
  let job = null;
  if (threadId !== "staff") {
    job = await loadJob(threadJobId(threadId));
    if (!job) return { sent: 0, dropped: 0, skipped: "job" };
  }
  const people = await loadPeople(tenantId);
  const targets = selectChatRecipients({ tenantId, threadId, senderUid, job, people });
  if (!targets.length) return { sent: 0, dropped: 0, skipped: "none" };
  const messages = targets.map(target => fcmMessage(target, chatPushContent({
    tenantId, threadId, message, job, origin: target.origin,
  })));
  let responses = [];
  try {
    const result = await sendEach(messages);
    responses = (result && result.responses) || [];
  } catch (err) {
    return { sent: 0, dropped: 0, skipped: "send", error: String((err && err.code) || "send-failed") };
  }
  const drop = staleTargets(responses, targets);
  for (const target of drop) {
    try { await deleteToken(target); } catch { /* next send will try again */ }
  }
  const failed = responses.filter(row => row && row.success === false).length;
  return { sent: Math.max(0, targets.length - failed), dropped: drop.length, skipped: "" };
}
