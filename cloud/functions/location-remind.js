// Ask one staff login to turn location sharing on.
// Pure: no firebase-admin import. index.js wires Firestore and FCM.
// An admin or supervisor of the same company may send one reminder per person
// each 30 minutes. A manager cannot. The push opens the clock-on screen.
// The same sentence is stored on users/{uid}/locationNotices/current so the
// person sees it the next time they open CallUp, even with no push token.
import { HEARTWOOD_TENANT, appOriginFor } from "./shared/staff-invites.js";
import { PUSH_ORIGINS, fcmMessage, staleTargets } from "./chat-push.js";

export const ALEX_UID = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
export const PATRICK_UID = "R7t41e54Ykcdk9WPdVZnDd697iI2";
export const REMIND_WINDOW_MS = 30 * 60 * 1000;
export const REMIND_TITLE = "Turn on location sharing";
export const REMIND_BODY = "Please turn on location sharing — clock on in CallUp, allow location, and keep CallUp open on site.";
export const REMIND_SENT = "Reminder sent";
export const REMIND_NO_DEVICE = "No device registered — ask them to open CallUp";
export const REMIND_RATE = "A reminder was sent in the last 30 minutes.";
export const REMIND_SHARING = "They're already sharing location.";
export const REMIND_DENIED = "You can't send that reminder.";
export const REMIND_SIGN_IN = "Sign in to send a reminder.";

const UID_RE = /^[A-Za-z0-9]{1,128}$/;

export function companyIdOf(profile, uid) {
  if (!profile) return uid === ALEX_UID || uid === PATRICK_UID ? HEARTWOOD_TENANT : "";
  const company = typeof profile.companyId === "string" ? profile.companyId.trim() : "";
  if (company) return company;
  const tenant = typeof profile.tenantId === "string" ? profile.tenantId.trim() : "";
  return tenant || HEARTWOOD_TENANT;
}

// Admin or supervisor of that company. A manager is not included.
// Heartwood admin: Alex, Patrick, or role admin plus a heartwoodAdmins grant.
export function canSendLocationReminder({ uid, profile, heartwoodGrant = false } = {}) {
  const companyId = companyIdOf(profile, uid);
  if (!uid || !companyId) return { ok: false, companyId: "" };
  const role = profile && profile.role;
  if (role === "supervisor") return { ok: true, companyId };
  if (companyId === HEARTWOOD_TENANT) {
    if (uid === ALEX_UID || uid === PATRICK_UID) return { ok: true, companyId };
    if (role === "admin" && heartwoodGrant === true) return { ok: true, companyId };
    return { ok: false, companyId };
  }
  if (role === "admin") return { ok: true, companyId };
  return { ok: false, companyId };
}

export function isSharingLocation(doc, companyId, uid) {
  if (!doc || typeof doc !== "object") return false;
  if (doc.uid && doc.uid !== uid) return false;
  if (doc.companyId && doc.companyId !== companyId) return false;
  return doc.clockedOn === true && doc.sharing === "gps";
}

// One reminder per person. Exactly 30 minutes after the last one is allowed.
export function remindRateOk(prevAt, now, windowMs = REMIND_WINDOW_MS) {
  const at = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(at)) return { ok: false, at: 0 };
  const prev = typeof prevAt === "number" ? prevAt : Number(prevAt);
  if (Number.isFinite(prev) && prev <= at && at - prev < windowMs) return { ok: false, at: prev };
  return { ok: true, at };
}

export function locationOpenUrl(origin, companyId) {
  const clean = String(origin || "").replace(/\/$/, "");
  const base = PUSH_ORIGINS.includes(clean) ? clean : appOriginFor(companyId);
  return String(base).replace(/\/$/, "") + "/app/?open=timesheet";
}

export function reminderNotice(companyId, sentAtMs) {
  return {
    companyId: String(companyId || ""),
    kind: "location-sharing",
    title: REMIND_TITLE,
    body: REMIND_BODY,
    sentAtMs: Number(sentAtMs) || 0,
  };
}

export function reminderPushes(tokens, { uid, companyId } = {}) {
  const out = [];
  for (const row of tokens || []) {
    if (!row || row.companyId !== companyId) continue;
    if (typeof row.token !== "string" || row.token.length < 20 || row.token.length > 4096) continue;
    const url = locationOpenUrl(row.origin, companyId);
    const target = { uid, tokenId: String(row.id || ""), token: row.token };
    out.push({
      target,
      message: fcmMessage(target, {
        url,
        data: {
          kind: "location",
          title: REMIND_TITLE,
          body: REMIND_BODY,
          url,
          companyId: String(companyId || ""),
          tag: "location-remind",
        },
      }),
    });
  }
  return out;
}

function finish(ok, reason, message, extra = {}) {
  return { ok, reason: reason || "", message, ...extra };
}

// deps.getUser(uid) -> { profile, heartwoodGrant }
// deps.getLive(companyId, uid) -> live location fields or null
// deps.claimNotice({ uid, companyId, now }) -> { ok, at }
// deps.loadTokens(uid) -> [{ id, token, companyId, origin }]
// deps.sendEach(messages) -> { responses }
// deps.deleteToken({ uid, tokenId })
export async function remindLocationSharing({ callerUid, targetUid } = {}, deps = {}) {
  const caller = String(callerUid || "");
  const target = String(targetUid || "").trim();
  if (!caller) return finish(false, "unauthenticated", REMIND_SIGN_IN);
  if (!UID_RE.test(target)) return finish(false, "permission-denied", REMIND_DENIED);

  const callerUser = typeof deps.getUser === "function" ? await deps.getUser(caller) : null;
  const allowed = canSendLocationReminder({
    uid: caller,
    profile: callerUser && callerUser.profile,
    heartwoodGrant: !!(callerUser && callerUser.heartwoodGrant),
  });
  if (!allowed.ok) return finish(false, "permission-denied", REMIND_DENIED);

  const targetUser = typeof deps.getUser === "function" ? await deps.getUser(target) : null;
  const targetCompany = companyIdOf(targetUser && targetUser.profile, target);
  const known = !!(targetUser && targetUser.profile) || target === ALEX_UID || target === PATRICK_UID;
  if (!known || !targetCompany || targetCompany !== allowed.companyId) {
    return finish(false, "permission-denied", REMIND_DENIED);
  }

  let live = null;
  try {
    live = typeof deps.getLive === "function" ? await deps.getLive(targetCompany, target) : null;
  } catch {
    return finish(false, "permission-denied", REMIND_DENIED);
  }
  if (isSharingLocation(live, targetCompany, target)) return finish(false, "already-sharing", REMIND_SHARING);

  const now = typeof deps.now === "function" ? deps.now() : new Date();
  let claimed = { ok: false };
  try {
    claimed = typeof deps.claimNotice === "function"
      ? await deps.claimNotice({ uid: target, companyId: targetCompany, now })
      : { ok: false };
  } catch {
    return finish(false, "permission-denied", REMIND_DENIED);
  }
  if (!claimed || !claimed.ok) return finish(false, "rate-limited", REMIND_RATE);

  const tokens = typeof deps.loadTokens === "function" ? await deps.loadTokens(target) : [];
  const pushes = reminderPushes(tokens, { uid: target, companyId: targetCompany });
  if (!pushes.length) return finish(true, "", REMIND_NO_DEVICE, { sent: 0 });

  let responses = [];
  try {
    const result = typeof deps.sendEach === "function" ? await deps.sendEach(pushes.map(row => row.message)) : { responses: [] };
    responses = (result && result.responses) || [];
  } catch {
    return finish(true, "", REMIND_SENT, { sent: 0 });
  }
  const drop = staleTargets(responses, pushes.map(row => row.target));
  for (const token of drop) {
    try {
      if (typeof deps.deleteToken === "function") await deps.deleteToken(token);
    } catch { /* the next reminder tries again */ }
  }
  const sent = responses.filter(row => row && row.success !== false).length;
  if (sent === 0 && drop.length === pushes.length) return finish(true, "", REMIND_NO_DEVICE, { sent: 0, dropped: drop.length });
  return finish(true, "", REMIND_SENT, { sent, dropped: drop.length });
}
