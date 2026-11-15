// Admin password reset. The callable checks company admin on the server, mints a reset
// link with the Admin SDK, and emails it the same way inviteEmailWorker sends invites.
// The link is never returned to the caller and is not written on the audit document.
import {
  CALLUP_INVITE_FROM,
  HEARTWOOD_RESEND_FROM,
  HEARTWOOD_TENANT,
  appOriginFor,
  inviteEmailConfig,
  resendPayload,
} from "./shared/staff-invites.js";

export const ALEX_UID = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
export const PATRICK_UID = "R7t41e54Ykcdk9WPdVZnDd697iI2";
export const RESET_LIMIT = 3;
export const RESET_WINDOW_MS = 60 * 60 * 1000;

export function companyIdOf(profile, uid) {
  if (!profile) return uid === ALEX_UID || uid === PATRICK_UID ? HEARTWOOD_TENANT : "";
  const company = typeof profile.companyId === "string" ? profile.companyId.trim() : "";
  if (company) return company;
  const tenant = typeof profile.tenantId === "string" ? profile.tenantId.trim() : "";
  return tenant || HEARTWOOD_TENANT;
}

// Caller admin: CallUp company profile role admin, or a Heartwood admin
// (Alex, Patrick, or role admin plus a heartwoodAdmins grant). A users doc
// with role admin and no grant is not a Heartwood admin.
export function isCompanyAdmin({ uid, profile, heartwoodGrant = false } = {}) {
  const companyId = companyIdOf(profile, uid);
  if (!uid || !companyId) return { ok: false, companyId: "" };
  if (companyId === HEARTWOOD_TENANT) {
    if (uid === ALEX_UID || uid === PATRICK_UID) return { ok: true, companyId };
    if (profile && profile.role === "admin" && heartwoodGrant === true) return { ok: true, companyId };
    return { ok: false, companyId };
  }
  if (profile && profile.role === "admin") return { ok: true, companyId };
  return { ok: false, companyId };
}

export function googleOnlyAccount(user) {
  const ids = (user && user.providerData || []).map(p => p && p.providerId).filter(Boolean);
  return ids.includes("google.com") && !ids.includes("password");
}

export function rateDecision(stamps, now, max = RESET_LIMIT, windowMs = RESET_WINDOW_MS) {
  const at = now instanceof Date ? now.getTime() : Number(now);
  const recent = (Array.isArray(stamps) ? stamps : [])
    .map(Number)
    .filter(t => Number.isFinite(t) && t <= at && at - t < windowMs);
  if (recent.length >= max) return { ok: false, stamps: recent };
  return { ok: true, stamps: [...recent, at] };
}

export function resetMailAllowed(email, env) {
  const config = inviteEmailConfig(env || {});
  if (config.enabled !== true) return { ok: false, reason: "not-sent", config };
  const to = String(email || "").toLowerCase();
  const allow = Array.isArray(config.allowTo) ? config.allowTo : [];
  if (allow.length && !allow.some(p => to.startsWith(p))) return { ok: false, reason: "not-sent", config };
  return { ok: true, config };
}

export function buildPasswordResetEmail({ name, email, link, companyId, companyName, companyEmail, config = {} } = {}) {
  const id = companyId || HEARTWOOD_TENANT;
  const cleanName = String(name || "there").replace(/[\n\r\t<>]/g, " ").trim().slice(0, 80) || "there";
  const placeName = typeof companyName === "string" ? companyName.trim() : "";
  const heartwood = id === HEARTWOOD_TENANT
    && (!placeName || placeName === "Heartwood" || placeName === "Heartwood Earthworx" || placeName === "Heartwood Jobs");
  const place = heartwood ? "Heartwood Jobs" : (placeName || "CallUp");
  const enabled = config.enabled === true;
  const provider = config.provider || "resend";
  const text = [
    `Hello ${cleanName},`,
    "",
    `An admin at ${place} asked CallUp to email you a link to choose a new password.`,
    "Open this link and choose a new password:",
    String(link || ""),
    "",
    "If you were not expecting it, you can ignore this email. Your password stays the same until you open the link.",
  ].join("\n");
  return {
    to: String(email || "").trim(),
    from: heartwood
      ? (enabled && provider === "resend" ? HEARTWOOD_RESEND_FROM : (config.from || "Heartwood Jobs <jobs@heartwoodew.com>"))
      : (config.neutralFrom || CALLUP_INVITE_FROM),
    replyTo: heartwood ? (config.replyTo || "alex@heartwoodew.com") : String(companyEmail || ""),
    subject: heartwood ? "Reset your Heartwood Jobs password" : `Reset your ${place} password`,
    text,
  };
}

// Same gate as invite mail: nothing is sent unless INVITE_EMAIL_ENABLED is "true"
// and the caller sets allowLiveMail. Heartwood resets are sent when that flag is on
// (there is no copy-link fallback, because the admin must not see the link).
// The audit document never includes the link.
export async function queuePasswordResetEmail({ name, email, link, companyId, company, env, allowLiveMail, sendResend, writeMail, idempotencyKey } = {}) {
  if (env && env.NODE_TEST_CONTEXT && env.INVITE_EMAIL_ENABLED === "true" && allowLiveMail === true) {
    throw new Error("refusing live password reset email under test");
  }
  const gate = resetMailAllowed(email, env);
  const message = buildPasswordResetEmail({
    name,
    email,
    link,
    companyId,
    companyName: company && typeof company === "object" ? String(company.name || "").trim() : "",
    companyEmail: company && typeof company === "object" ? String(company.email || "").trim() : "",
    config: gate.config,
  });
  const audit = {
    to: message.to,
    subject: message.subject,
    kind: "password-reset",
    companyId: companyId || HEARTWOOD_TENANT,
    delivery: "held",
  };
  if (!message.to || !link) return { ok: false, sent: false, reason: "not-sent" };
  if (!gate.ok || allowLiveMail !== true) {
    if (typeof writeMail === "function") await writeMail("inviteMail", { ...audit, reason: gate.reason || "live-mail-not-allowed" });
    return { ok: false, sent: false, reason: "not-sent" };
  }
  if (gate.config.provider === "resend") {
    if (typeof sendResend !== "function") return { ok: false, sent: false, reason: "not-sent" };
    const result = await sendResend(resendPayload(message), idempotencyKey);
    const doc = {
      ...audit,
      delivery: result && result.ok ? "sent" : "failed",
      providerId: (result && result.id) || "",
      error: String((result && (result.error || result.reason)) || "").slice(0, 200),
    };
    if (typeof writeMail === "function") await writeMail("inviteMail", doc);
    return { ok: !!(result && result.ok), sent: !!(result && result.ok), reason: result && result.ok ? "sent" : "not-sent" };
  }
  if (typeof writeMail === "function") {
    await writeMail("mail", {
      to: message.to,
      from: message.from,
      replyTo: message.replyTo || "",
      message: { subject: message.subject, text: message.text },
    });
    await writeMail("inviteMail", { ...audit, delivery: "queued" });
  }
  return { ok: true, sent: true, reason: "queued-for-extension" };
}

export function resetFailureText(reason) {
  if (reason === "unauthenticated") return "Sign in to reset a password.";
  if (reason === "self") return "Use Forgot password on the sign-in screen to reset your own password.";
  if (reason === "rate-limited") return "Too many reset emails for that person. Wait an hour and try again.";
  if (reason === "not-sent") return "Couldn't email that reset link. Try again in a minute.";
  return "You can't reset that password.";
}

function finish(result) {
  if (result && result.ok) return { ok: true };
  return { ok: false, reason: (result && result.reason) || "not-sent" };
}

// deps.getUser(uid) -> { profile, heartwoodGrant }
// deps.getAuthUser(uid) -> { email, displayName, providerData } or null
// deps.generateLink(email, actionCodeSettings) -> link string. Not returned.
// deps.claimRate({ uid, companyId, now }) -> { ok }
// deps.getCompany(companyId) -> { name, email } or null
export async function adminSendPasswordReset({ callerUid, targetUid } = {}, deps = {}) {
  const caller = String(callerUid || "");
  const target = String(targetUid || "").trim();
  if (!caller) return finish({ ok: false, reason: "unauthenticated" });
  if (!target || target.length > 128 || /[^\w-]/.test(target)) return finish({ ok: false, reason: "permission-denied" });
  if (target === caller) return finish({ ok: false, reason: "self" });

  const callerUser = typeof deps.getUser === "function" ? await deps.getUser(caller) : null;
  const callerAdmin = isCompanyAdmin({
    uid: caller,
    profile: callerUser && callerUser.profile,
    heartwoodGrant: !!(callerUser && callerUser.heartwoodGrant),
  });
  if (!callerAdmin.ok) return finish({ ok: false, reason: "permission-denied" });

  const targetUser = typeof deps.getUser === "function" ? await deps.getUser(target) : null;
  const targetCompany = companyIdOf(targetUser && targetUser.profile, target);
  const known = !!(targetUser && targetUser.profile) || target === ALEX_UID;
  if (!known || !targetCompany || targetCompany !== callerAdmin.companyId) {
    return finish({ ok: false, reason: "permission-denied" });
  }

  let authUser = null;
  try {
    authUser = typeof deps.getAuthUser === "function" ? await deps.getAuthUser(target) : null;
  } catch {
    return finish({ ok: false, reason: "not-sent" });
  }
  const email = authUser && String(authUser.email || "").trim();
  if (!email) return finish({ ok: false, reason: "permission-denied" });
  if (googleOnlyAccount(authUser)) return finish({ ok: false, reason: "google-only" });
  const hasPassword = (authUser.providerData || []).some(p => p && p.providerId === "password");
  if (!hasPassword) return finish({ ok: false, reason: "not-sent" });

  const env = deps.env || {};
  if (!resetMailAllowed(email, env).ok || deps.allowLiveMail !== true) return finish({ ok: false, reason: "not-sent" });

  const now = typeof deps.now === "function" ? deps.now() : new Date();
  let claimed = { ok: false };
  try {
    claimed = typeof deps.claimRate === "function" ? await deps.claimRate({ uid: target, companyId: targetCompany, now }) : { ok: false };
  } catch {
    return finish({ ok: false, reason: "not-sent" });
  }
  if (!claimed || !claimed.ok) return finish({ ok: false, reason: "rate-limited" });

  const continueUrl = appOriginFor(targetCompany) + "/app/";
  let link = "";
  try {
    link = await deps.generateLink(email, { url: continueUrl, handleCodeInApp: false });
  } catch {
    return finish({ ok: false, reason: "not-sent" });
  }
  if (typeof link !== "string" || !link.startsWith("https://")) return finish({ ok: false, reason: "not-sent" });

  let company = null;
  if (targetCompany !== HEARTWOOD_TENANT && typeof deps.getCompany === "function") {
    try { company = await deps.getCompany(targetCompany); } catch { company = null; }
  }
  const name = (targetUser && targetUser.profile && targetUser.profile.name) || (authUser && authUser.displayName) || "there";
  let queued;
  try {
    queued = await queuePasswordResetEmail({
      name,
      email,
      link,
      companyId: targetCompany,
      company,
      env,
      allowLiveMail: true,
      sendResend: deps.sendResend,
      writeMail: deps.writeMail,
      idempotencyKey: `pwreset-${target}-${now instanceof Date ? now.getTime() : Number(now)}`,
    });
  } catch {
    return finish({ ok: false, reason: "not-sent" });
  }
  if (!queued || !queued.sent) return finish({ ok: false, reason: "not-sent" });
  return finish({ ok: true });
}
