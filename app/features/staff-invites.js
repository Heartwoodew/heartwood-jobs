// CallUp Base staff invites.
// An admin invites an operator or a supervisor. The invitee sets a password.
// The role on users/{uid} is copied from the invite by the accept function.
// This module does not grant admin, does not write Firestore, and does not send email.

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITE_ROLES = Object.freeze(["operator", "supervisor"]);
export const INVITE_LINK_ORIGIN = "https://jobs.heartwoodew.com/app";
// Where the app lives. Heartwood stays on jobs.heartwoodew.com (GitHub Pages). Every other company uses the CallUp
// address on Firebase Hosting (site "callupapp"). Until app.callupapp.com.au is connected, CallUp links use callupapp.web.app.
export const HEARTWOOD_APP_ORIGIN = "https://jobs.heartwoodew.com";
export const CALLUP_APP_ORIGIN = "https://app.callupapp.com.au";
export const CALLUP_FALLBACK_ORIGIN = "https://callupapp.web.app";
// Flip to true once app.callupapp.com.au shows "Connected" in Firebase Hosting (DNS + certificate done).
export const CALLUP_DOMAIN_LIVE = true;  // app.callupapp.com.au connected 10 Nov 2026
export const CALLUP_ORIGINS = Object.freeze([CALLUP_APP_ORIGIN, CALLUP_FALLBACK_ORIGIN]);
export const HEARTWOOD_TENANT = "heartwood";
const ALEX_UID = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const PATRICK_UID = "R7t41e54Ykcdk9WPdVZnDd697iI2";

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/;
const TENANT_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function normalizeInviteEmail(email) {
  const s = String(email ?? "").trim().toLowerCase();
  if (!s || s.length > 120 || !EMAIL_RE.test(s)) return "";
  return s;
}

export function tokenOk(token) {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function passwordOk(password) {
  return typeof password === "string" && password.length >= 8 && password.length <= 128;
}

export function newInviteToken(fill) {
  const bytes = new Uint8Array(32);
  if (typeof fill === "function") fill(bytes);
  else globalThis.crypto.getRandomValues(bytes);
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// Origin to use in links for a company. currentOrigin (location.origin) wins when it is already a CallUp address.
export function appOriginFor(companyId, currentOrigin = "", domainLive = CALLUP_DOMAIN_LIVE) {
  const id = String(companyId || HEARTWOOD_TENANT);
  if (id === HEARTWOOD_TENANT) return HEARTWOOD_APP_ORIGIN;
  const cur = String(currentOrigin || "").replace(/\/$/, "");
  if (CALLUP_ORIGINS.includes(cur)) return cur;
  return domainLive === true || domainLive === "true" ? CALLUP_APP_ORIGIN : CALLUP_FALLBACK_ORIGIN;
}

export function inviteLink(token, origin = HEARTWOOD_APP_ORIGIN) {
  const base = String(origin || HEARTWOOD_APP_ORIGIN).replace(/\/$/, "");
  return base + "/app?invite=" + encodeURIComponent(String(token || ""));
}

export function inviteTime(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  return null;
}

export function displayStatus(invite, now) {
  if (!invite || (invite.status !== "pending" && invite.status !== "accepted" && invite.status !== "cancelled")) return "invalid";
  if (invite.status !== "pending") return invite.status;
  const exp = inviteTime(invite.expiresAt);
  const at = inviteTime(now) || new Date();
  if (!exp || exp.getTime() <= at.getTime()) return "expired";
  return "pending";
}

export function roleLabel(role) {
  return role === "supervisor" ? "Supervisor" : role === "operator" ? "Operator" : "";
}

export function canManageInvites(membership) {
  return !!(membership && membership.ok && (membership.rulesAdmin || membership.role === "supervisor"));
}

// Rules-admins (Alex, Patrick, or profile role admin) and supervisors may invite.
// Operators cannot. The invited role is still only operator or supervisor.
export function inviterMayInvite({ uid, profile } = {}) {
  if (uid === ALEX_UID || uid === PATRICK_UID) return true;
  const role = profile && profile.role;
  return role === "admin" || role === "supervisor";
}

export function pendingInviteForEmail(invites, email) {
  const clean = normalizeInviteEmail(email);
  if (!clean) return null;
  return (invites || []).find(row => row && row.email === clean && row.status === "pending") || null;
}

export function buildInviteDraft({ name, email, role, createdBy, now, token, tenantId } = {}) {
  const rawName = String(name ?? "");
  if (/[\n\r\t<>]/.test(rawName)) return { ok: false, reason: "name" };
  const cleanName = rawName.trim().replace(/ +/g, " ");
  const cleanEmail = normalizeInviteEmail(email);
  const cleanRole = INVITE_ROLES.includes(role) ? role : "";
  const cleanTenant = typeof tenantId === "string" && TENANT_RE.test(tenantId) ? tenantId : "";
  const when = now instanceof Date ? now : new Date(now || Date.now());
  if (!cleanName || cleanName.length > 80 || /[\n\r\t<>]/.test(cleanName)) return { ok: false, reason: "name" };
  if (!cleanEmail) return { ok: false, reason: "email" };
  if (!cleanRole) return { ok: false, reason: "role" };
  if (!tokenOk(token)) return { ok: false, reason: "token" };
  if (!cleanTenant) return { ok: false, reason: "tenant" };
  if (!createdBy || typeof createdBy !== "string" || createdBy.length > 128) return { ok: false, reason: "createdBy" };
  if (Number.isNaN(when.getTime())) return { ok: false, reason: "now" };
  const expiresAt = new Date(when.getTime() + INVITE_TTL_MS);
  return {
    ok: true,
    invite: {
      name: cleanName,
      email: cleanEmail,
      role: cleanRole,
      status: "pending",
      createdBy,
      createdAt: when,
      expiresAt,
      token,
      tenantId: cleanTenant,
      ...(cleanTenant !== HEARTWOOD_TENANT ? { companyId: cleanTenant } : {}),
    },
  };
}

// Profile written by the accept function. Role comes only from the invite.
// Heartwood gets companyId "heartwood" (no tenantId) so admins' company-scoped staff list finds them.
export function profileFromInvite(invite) {
  if (!invite || !INVITE_ROLES.includes(invite.role)) return null;
  const name = String(invite.name || "").trim();
  const email = normalizeInviteEmail(invite.email);
  if (!name || name.length > 80 || !email) return null;
  const profile = { name, role: invite.role, email };
  const companyId = typeof invite.companyId === "string" && invite.companyId ? invite.companyId : invite.tenantId;
  if (typeof companyId === "string" && companyId && companyId !== HEARTWOOD_TENANT) {
    if (!TENANT_RE.test(companyId)) return null;
    profile.tenantId = companyId;
    profile.companyId = companyId;
  } else {
    profile.companyId = HEARTWOOD_TENANT;
  }
  return profile;
}

export function inviteFailureText(code) {
  const map = {
    name: "Enter the person's name.",
    email: "Enter a valid email address.",
    role: "Choose operator or supervisor.",
    "already-pending": "This email already has a pending invite. Resend or cancel it.",
    "weak-password": "Use a password of at least 8 characters.",
    "email-in-use": "That email already has a login. Ask an admin to cancel this invite.",
    expired: "This invite has expired. Ask an admin to resend it.",
    accepted: "This invite has already been used.",
    cancelled: "This invite was cancelled.",
    invalid: "This invite link is not valid.",
    unavailable: "Invites aren't working on the server right now. Ask your admin to try again later.",
    offline: "Couldn't reach CallUp. Check your internet connection and try again.",
    busy: "Too many tries. Wait a minute and try again.",
    "server-error": "Something went wrong on our side. Try again in a minute, or ask your admin to resend the invite.",
    mismatch: "Those passwords don't match.",
    "permission-denied": "That invite could not be saved.",
  };
  return map[code] || "That didn't work. Try again.";
}

function formatWhen(value) {
  const d = inviteTime(value);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Brisbane",
  }).format(d);
}

function statusLabel(status) {
  if (status === "pending") return "Pending";
  if (status === "accepted") return "Accepted";
  if (status === "expired") return "Expired";
  if (status === "cancelled") return "Cancelled";
  return "Invite";
}

export function staffViewHtml(invites, { now = new Date(), error = "", origin = HEARTWOOD_APP_ORIGIN } = {}) {
  const rows = (invites || []).map(row => ({ ...row, viewStatus: displayStatus(row, now) }));
  const rank = { pending: 0, expired: 1, accepted: 2, cancelled: 3, invalid: 4 };
  rows.sort((a, b) => (rank[a.viewStatus] ?? 9) - (rank[b.viewStatus] ?? 9) || String(a.email).localeCompare(String(b.email)));
  const cards = rows.filter(row => row.viewStatus !== "invalid").map(row => {
    const actions = row.viewStatus === "pending" || row.viewStatus === "expired";
    const link = actions ? inviteLink(row.token, origin) : "";
    return `<article class="inviterow" data-invite-status="${esc(row.viewStatus)}">
      <div>
        <b>${esc(row.name)}</b>
        <div class="sub">${esc(row.email)} · ${esc(roleLabel(row.role) || row.role)}</div>
        <div class="sub">${esc(statusLabel(row.viewStatus))}${row.viewStatus === "pending" || row.viewStatus === "expired" ? " · " + esc(formatWhen(row.expiresAt)) : ""}</div>
        ${link ? `<p class="invite-link">${esc(link)}</p>` : ""}
      </div>
      ${actions ? `<div class="inviteacts">
        <button type="button" data-invite-copy="${esc(link)}">Copy link</button>
        <button type="button" data-invite-resend="${esc(row.id)}">Resend</button>
        <button type="button" data-invite-cancel="${esc(row.id)}">Cancel</button>
      </div>` : ""}
    </article>`;
  }).join("");
  return `<div class="sm-head"><h1>Staff</h1></div>
    <p class="sub invite-note">Invite an operator or a supervisor. They set their own password from the link. Admin is not a role you can give here. ${origin !== HEARTWOOD_APP_ORIGIN ? "CallUp emails them the link when invite email is on for your company; you can always copy the link below and send it yourself." : "Mail is not sent from this screen."}</p>
    <form id="invitef" class="card invitef" autocomplete="off">
      <h2>Invite staff</h2>
      <label>Name<input name="name" required maxlength="80" autocomplete="name"></label>
      <label>Email<input name="email" type="email" required maxlength="120" autocomplete="off" inputmode="email"></label>
      <label>Role<select name="role">
        <option value="operator">Operator</option>
        <option value="supervisor">Supervisor</option>
      </select></label>
      <button class="primary" type="submit">Send invite</button>
      <p id="inviteerr" class="err">${esc(error ? inviteFailureText(error) : "")}</p>
    </form>
    <div class="invitelist">${cards || `<p class="muted">No invites yet.</p>`}</div>`;
}

export function acceptScreenModel(preview, now = new Date()) {
  const profile = profileFromInvite(preview);
  if (!profile) return { ok: false, reason: "invalid" };
  // A preview call already checked the expiry. It has no expiresAt to re-check.
  if (preview.ok === true && !preview.expiresAt) {
    return { ok: true, name: profile.name, email: profile.email, role: profile.role };
  }
  const status = displayStatus(preview, now);
  if (status !== "pending") {
    return { ok: false, reason: status === "invalid" ? "invalid" : status, name: profile.name, email: profile.email, role: profile.role };
  }
  return { ok: true, name: profile.name, email: profile.email, role: profile.role };
}

export function acceptLoadingHtml() {
  return `<form class="card login" id="acceptf"><h2>Staff invite</h2><p class="muted">Checking this invite…</p></form>`;
}

export function acceptViewHtml(model) {
  if (!model || !model.ok) {
    const reason = model && model.reason;
    return `<form class="card login" id="acceptf">
      <h2>Staff invite</h2>
      <p>${esc(inviteFailureText(reason))}</p>
      ${model && model.email ? `<p class="sub">${esc(model.name || "")}${model.name ? " · " : ""}${esc(model.email)}</p>` : ""}
    </form>`;
  }
  return `<form class="card login" id="acceptf" autocomplete="off">
    <h2>Set your password</h2>
    <p class="invite-who"><b>${esc(model.name)}</b><br>${esc(model.email)}</p>
    <p class="sub">You will join as ${esc(roleLabel(model.role))}. This login cannot be an admin.</p>
    <label>Password<input name="p" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label>
    <label>Confirm password<input name="p2" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label>
    <button class="big primary" type="submit">Create login</button>
    <p id="aceerr" class="err"></p>
  </form>`;
}

// Neutral sender for every company other than Heartwood; replies go to that company's own email.
export const CALLUP_INVITE_FROM = "CallUp <noreply@callupapp.com.au>";

export function inviteEmailConfig(env = {}) {
  return {
    enabled: env.INVITE_EMAIL_ENABLED === "true",
    // "resend" sends through Resend's API with the RESEND_API_KEY secret. Anything else keeps the old
    // Trigger Email extension plan (a mail/ document). Nothing is sent unless enabled is true.
    provider: env.INVITE_EMAIL_PROVIDER === "extension" ? "extension" : "resend",
    from: env.INVITE_EMAIL_FROM || "Heartwood Jobs <jobs@heartwoodew.com>",
    replyTo: env.INVITE_EMAIL_REPLY_TO || "alex@heartwoodew.com",
    neutralFrom: env.INVITE_EMAIL_NEUTRAL_FROM || CALLUP_INVITE_FROM,
    domainLive: env.CALLUP_DOMAIN_LIVE === "true" || CALLUP_DOMAIN_LIVE,
    // Heartwood invites stay held (link shown to the admin, as today) unless this is also "true".
    heartwood: env.INVITE_EMAIL_HEARTWOOD === "true",
    // Optional comma list of allowed recipient prefixes, e.g. "callup932+" during testing. Others are held.
    allowTo: String(env.INVITE_EMAIL_ALLOW_TO || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean),
  };
}

// Why an enabled config still holds this invite: "" means it may be sent.
export function inviteHoldReason(invite, config = {}) {
  const profile = profileFromInvite(invite);
  if (!profile) return "invalid";
  const companyId = profile.companyId || HEARTWOOD_TENANT;
  if (companyId === HEARTWOOD_TENANT && config.heartwood !== true) return "heartwood-held";
  const to = String(profile.email || "").toLowerCase();
  const allow = Array.isArray(config.allowTo) ? config.allowTo : [];
  if (allow.length && !allow.some(p => to.startsWith(p))) return "recipient-not-allowed";
  return "";
}

// Resend can only send from a verified domain (callupapp.com.au), so Heartwood invites sent through Resend keep the
// Heartwood name and reply-to but use the CallUp address.
export const HEARTWOOD_RESEND_FROM = "Heartwood Jobs <noreply@callupapp.com.au>";
export const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function resendPayload(message) {
  if (!message) return null;
  const body = { from: message.from, to: [message.to], subject: message.subject, text: message.text };
  if (message.replyTo) body.reply_to = message.replyTo;
  return body;
}

// One POST to Resend. fetchImpl and apiKey are injected so tests never touch the network.
export async function sendViaResend({ apiKey, payload, fetchImpl, idempotencyKey = "" }) {
  if (!apiKey || !String(apiKey).startsWith("re_")) return { ok: false, reason: "no-api-key" };
  if (!payload || typeof fetchImpl !== "function") return { ok: false, reason: "invalid" };
  const headers = { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = String(idempotencyKey).slice(0, 256);
  const res = await fetchImpl(RESEND_ENDPOINT, { method: "POST", headers, body: JSON.stringify(payload) });
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) return { ok: false, reason: "resend-" + res.status, error: String((data && (data.message || data.name)) || "").slice(0, 200) };
  return { ok: true, id: String((data && data.id) || "") };
}

export function buildInviteEmail(invite, config = {}) {
  const profile = profileFromInvite(invite);
  if (!profile || !tokenOk(invite.token)) return null;
  const companyId = profile.companyId || HEARTWOOD_TENANT;
  const link = inviteLink(invite.token, config.appOrigin || appOriginFor(companyId, "", config.domainLive));
  const role = roleLabel(profile.role).toLowerCase();
  const companyName = typeof config.companyName === "string" ? config.companyName.trim() : "";
  const heartwood = !companyName || companyName === "Heartwood" || companyName === "Heartwood Earthworx" || companyName === "Heartwood Jobs";
  const place = heartwood ? "Heartwood Jobs" : companyName;
  const text = [
    `Hello ${profile.name},`,
    "",
    `You have been invited to ${place} as ${role === "supervisor" ? "a supervisor" : "an operator"}.`,
    "Open this link and set your own password:",
    link,
    "",
    "The link expires in 7 days. If you were not expecting it, you can ignore this email.",
  ].join("\n");
  return {
    to: profile.email,
    from: heartwood
      ? (config.enabled === true && config.provider === "resend" ? HEARTWOOD_RESEND_FROM : (config.from || inviteEmailConfig().from))
      : (config.neutralFrom || CALLUP_INVITE_FROM),
    replyTo: heartwood ? (config.replyTo || "alex@heartwoodew.com") : (config.companyEmail || ""),
    subject: heartwood ? "You're invited to Heartwood Jobs" : `You're invited to ${companyName}`,
    text,
    link,
  };
}

// sent is always false here. Nothing in this function opens a socket.
// Enabled mode only describes the Firestore document the Trigger Email extension would send.
export function planInviteDelivery(invite, config = inviteEmailConfig()) {
  const message = buildInviteEmail(invite, config);
  if (!message) return { ok: false, sent: false, reason: "invalid" };
  const hold = config.enabled === true ? inviteHoldReason(invite, config) : "email-disabled";
  if (hold) {
    return {
      ok: true,
      sent: false,
      reason: hold,
      collection: "inviteMail",
      doc: {
        to: message.to,
        subject: message.subject,
        text: message.text,
        link: message.link,
        delivery: "held",
      },
    };
  }
  if (config.provider === "resend") {
    return {
      ok: true,
      sent: false,
      reason: "send-via-resend",
      collection: "inviteMail",
      resend: resendPayload(message),
      doc: { to: message.to, subject: message.subject, link: message.link, delivery: "resend" },
    };
  }
  return {
    ok: true,
    sent: false,
    reason: "queued-for-extension",
    collection: "mail",
    doc: {
      to: message.to,
      from: message.from,
      replyTo: message.replyTo,
      message: { subject: message.subject, text: message.text },
    },
  };
}

export function shouldQueueInviteEmail(before, after) {
  if (!after || after.status !== "pending") return false;
  if (!profileFromInvite(after) || !tokenOk(after.token)) return false;
  if (!before) return true;
  return before.token !== after.token;
}

export async function queueInviteEmail(invite, deps = {}) {
  const env = deps.env || {};
  if (env.NODE_TEST_CONTEXT && env.INVITE_EMAIL_ENABLED === "true" && deps.allowLiveMail === true) {
    throw new Error("refusing live invite email under test");
  }
  // deps.company ({ name, email }) is passed for companies other than Heartwood: neutral CallUp sender, reply-to the company.
  const company = deps.company && typeof deps.company === "object" ? deps.company : null;
  const plan = planInviteDelivery(invite, {
    ...inviteEmailConfig(env),
    ...(company ? { companyName: String(company.name || "").trim() || "your company", companyEmail: String(company.email || "").trim() } : {}),
  });
  if (!plan.ok) return plan;
  if ((plan.collection === "mail" || plan.resend) && deps.allowLiveMail !== true) {
    return { ...plan, ok: false, sent: false, reason: "live-mail-not-allowed", written: false };
  }
  if (plan.resend) {
    // Live send. Only reached when INVITE_EMAIL_ENABLED is "true" and the caller allows live mail.
    if (typeof deps.sendResend !== "function") return { ...plan, ok: false, sent: false, reason: "no-sender", written: false };
    const result = await deps.sendResend(plan.resend);
    const doc = { ...plan.doc, delivery: result && result.ok ? "sent" : "failed", providerId: (result && result.id) || "", error: (result && (result.reason || result.error)) || "" };
    if (typeof deps.writeMail === "function") await deps.writeMail("inviteMail", doc);
    return { ...plan, doc, sent: !!(result && result.ok), reason: result && result.ok ? "sent" : ((result && result.reason) || "failed"), written: typeof deps.writeMail === "function" };
  }
  if (typeof deps.writeMail === "function") {
    await deps.writeMail(plan.collection, plan.doc);
    return { ...plan, written: true };
  }
  return { ...plan, written: false };
}

export async function previewStaffInvite(input, deps) {
  const token = String(input?.token || "").trim();
  const now = deps.now();
  if (!tokenOk(token)) return { ok: false, reason: "invalid" };
  const rows = await deps.findByToken(token);
  if (!rows || rows.length !== 1) return { ok: false, reason: "invalid" };
  const model = acceptScreenModel(rows[0], now);
  if (!model.ok && model.reason === "invalid") return { ok: false, reason: "invalid" };
  return {
    ok: model.ok,
    reason: model.reason,
    name: model.name,
    email: model.email,
    role: model.role,
    status: model.ok ? "pending" : model.reason,
  };
}

export async function acceptStaffInvite(input, deps) {
  const now = deps.now();
  const token = String(input?.token || "").trim();
  if (!tokenOk(token)) return { ok: false, reason: "invalid" };
  if (!passwordOk(input?.password)) return { ok: false, reason: "weak-password" };
  const rows = await deps.findByToken(token);
  if (!rows || rows.length !== 1) return { ok: false, reason: "invalid" };
  const invite = rows[0];
  const status = displayStatus(invite, now);
  if (status !== "pending") return { ok: false, reason: status === "invalid" ? "invalid" : status };
  const profile = profileFromInvite(invite);
  if (!profile) return { ok: false, reason: "invalid" };
  const inviter = typeof deps.getInviter === "function" ? await deps.getInviter(invite.createdBy) : { uid: invite.createdBy, profile: null };
  if (!inviterMayInvite(inviter || { uid: invite.createdBy, profile: null })) return { ok: false, reason: "invalid" };
  const existing = await deps.getUserByEmail(profile.email);
  if (existing) return { ok: false, reason: "email-in-use" };
  const user = await deps.createUser({ email: profile.email, password: input.password, displayName: profile.name });
  try {
    await deps.setProfile(user.uid, profile);
    const claimed = await deps.claimInvite(invite.id, user.uid, now);
    if (!claimed || !claimed.ok) {
      await deps.deleteProfile(user.uid);
      await deps.deleteUser(user.uid);
      return { ok: false, reason: (claimed && claimed.reason) || "invalid" };
    }
  } catch (err) {
    await deps.deleteProfile(user.uid);
    await deps.deleteUser(user.uid);
    throw err;
  }
  return { ok: true, uid: user.uid, email: profile.email, role: profile.role, name: profile.name };
}
