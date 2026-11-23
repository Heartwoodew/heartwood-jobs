// CallUp Base staff invites.
// An admin invites a labourer, operator, supervisor, manager or (CallUp companies) admin. The invitee sets a password.
// The role on users/{uid} is copied from the invite by the accept function.
// A manager invites up to manager. Only an admin invites an admin.
// This module does not grant admin, does not write Firestore, and does not send email.

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITE_ROLES = Object.freeze(["labourer", "operator", "supervisor", "manager", "admin"]);
// Crew roles: same app access (assigned jobs, own timesheet/leave/receipts, prestarts and fleet meter); no dollar amounts.
export const CREW_ROLES = Object.freeze(["labourer", "operator"]);
// Dollar amounts: supervisor, manager and admin. Crew still see the amount on their own receipts and claims.
export const MONEY_ROLES = Object.freeze(["supervisor", "manager", "admin"]);
// Company quote rates: manager and admin. Supervisors use the rates and do not save them.
export const RATE_ROLES = Object.freeze(["manager", "admin"]);
// Company billing, plan and company settings stay admin-only.
export const COMPANY_SETTINGS_ROLES = Object.freeze(["admin"]);
// Supervisors keep their invite powers (labourer, operator, supervisor) but never create a manager or an admin.
export const SUPERVISOR_INVITE_ROLES = Object.freeze(["labourer", "operator", "supervisor"]);
export const MANAGER_INVITE_ROLES = Object.freeze(["labourer", "operator", "supervisor", "manager"]);
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
  return { labourer: "Labourer", operator: "Operator", supervisor: "Supervisor", manager: "Manager", admin: "Admin" }[role] || "";
}

export function seesMoney(role) {
  return MONEY_ROLES.includes(role);
}

export function editsCompanyRates(role) {
  return RATE_ROLES.includes(role);
}

export function editsCompanySettings(role) {
  return role === "admin";
}

export function canManageInvites(membership) {
  return !!(membership && membership.ok && (membership.rulesAdmin || membership.role === "supervisor" || membership.role === "manager"));
}

// Send password reset on the Staff tab is the admin shell only.
// A Heartwood manager is given that shell because they can list staff; their profile role stays manager, so they do not see it.
// A supervisor never does. Patrick's profile role is operator, and he is still an admin of Heartwood.
export function canSendPasswordReset(person) {
  if (!person || person.role !== "admin") return false;
  const profileRole = (person.cloudProfile && person.cloudProfile.role) || person.staffRole || "";
  return profileRole !== "manager" && profileRole !== "supervisor";
}

// Staff roster: admins and supervisors. A manager does not get the button.
// A rules-admin whose profile role is operator (Patrick) still counts as admin.
export function canRemindLocation(person) {
  if (!person) return false;
  const profileRole = (person.cloudProfile && person.cloudProfile.role) || person.staffRole || "";
  if (profileRole === "manager" || profileRole === "labourer") return false;
  if (profileRole === "supervisor" || profileRole === "admin") return true;
  return person.role === "admin" || person.role === "supervisor";
}

export function rosterShareState(doc) {
  const sharing = !!(doc && doc.clockedOn === true && doc.sharing === "gps");
  return { sharing, text: sharing ? "Sharing location" : "Not sharing" };
}

export const GOOGLE_ONLY_RESET = "This person signs in with Google, so there's no password to reset.";
export const PASSWORD_RESET_NEUTRAL = "If that email has a CallUp login, a reset link is on its way.";

// Success and an unknown address share one sentence, so the screen does not reveal whether the login exists.
export function forgotPasswordMessage(code) {
  if (code === "empty") return "Enter the email you sign in with.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/too-many-requests") return "Too many tries. Wait a few minutes and try again.";
  if (code === "auth/network-request-failed") return "No connection. Check your signal and try again.";
  if (code === "auth/user-not-found" || code === "sent" || !code) return PASSWORD_RESET_NEUTRAL;
  return "Couldn't send that just now. Try again in a minute.";
}

// Admins invite every level. Managers invite up to manager. Supervisors invite labourer/operator/supervisor. Crew nobody.
// Heartwood admin = Alex, Patrick, or an accepted Heartwood admin (heartwoodAdmin: grant in heartwoodAdmins/{uid}).
// CallUp company admin = profile role admin. A manager never invites or changes an admin.
export function invitableRoles({ uid, profile, tenantId, heartwoodAdmin = false } = {}) {
  const role = profile && profile.role;
  const admin = uid === ALEX_UID || uid === PATRICK_UID
    || (tenantId === HEARTWOOD_TENANT ? heartwoodAdmin === true && role === "admin" : role === "admin");
  if (admin) return INVITE_ROLES;
  if (role === "manager") return MANAGER_INVITE_ROLES;
  return role === "supervisor" ? SUPERVISOR_INVITE_ROLES : [];
}
export function inviterMayInvite({ uid, profile, heartwoodAdmin = false } = {}, role = "", tenantId = HEARTWOOD_TENANT) {
  const roles = invitableRoles({ uid, profile, tenantId, heartwoodAdmin });
  return role ? roles.includes(role) : roles.length > 0;
}

export function pendingInviteForEmail(invites, email) {
  const clean = normalizeInviteEmail(email);
  if (!clean) return null;
  return (invites || []).find(row => row && row.email === clean && row.status === "pending") || null;
}

function cleanJobTitle(value) {
  const raw = String(value ?? "");
  if (!raw.trim()) return "";
  if (/[\n\r\t<>]/.test(raw)) return null;
  const s = raw.trim().replace(/ +/g, " ");
  if (!s || s.length > 80) return null;
  return s;
}

export function buildInviteDraft({ name, email, role, createdBy, now, token, tenantId, jobTitle, jobTitleId } = {}) {
  const rawName = String(name ?? "");
  if (/[\n\r\t<>]/.test(rawName)) return { ok: false, reason: "name" };
  const cleanName = rawName.trim().replace(/ +/g, " ");
  const cleanEmail = normalizeInviteEmail(email);
  const cleanRole = INVITE_ROLES.includes(role) ? role : "";
  const cleanTenant = typeof tenantId === "string" && TENANT_RE.test(tenantId) ? tenantId : "";
  const title = cleanJobTitle(jobTitle);
  const titleId = String(jobTitleId || "").replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 60);
  const when = now instanceof Date ? now : new Date(now || Date.now());
  if (!cleanName || cleanName.length > 80 || /[\n\r\t<>]/.test(cleanName)) return { ok: false, reason: "name" };
  if (!cleanEmail) return { ok: false, reason: "email" };
  if (!cleanRole) return { ok: false, reason: "role" };
  if (title === null) return { ok: false, reason: "jobTitle" };
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
      ...(title ? { jobTitle: title } : {}),
      ...(title && titleId ? { jobTitleId: titleId } : {}),
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
  const title = cleanJobTitle(invite.jobTitle);
  if (title) profile.jobTitle = title;
  const titleId = String(invite.jobTitleId || "").replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 60);
  if (title && titleId) profile.jobTitleId = titleId;
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
    role: "Choose labourer, operator, supervisor, manager or admin. Only an admin can invite an admin.",
    jobTitle: "Check the job title.",
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

// A missing company id is Heartwood, including records that only carry tenantId.
function rosterCompanyId(row) {
  if (!row || typeof row !== "object") return HEARTWOOD_TENANT;
  const company = typeof row.companyId === "string" ? row.companyId.trim() : "";
  if (company) return company;
  const tenant = typeof row.tenantId === "string" ? row.tenantId.trim() : "";
  return tenant || HEARTWOOD_TENANT;
}

function rosterTags(row) {
  const list = [];
  if (row && Array.isArray(row.skills)) list.push(...row.skills);
  if (row && Array.isArray(row.tags)) list.push(...row.tags);
  const out = [];
  for (const raw of list.slice(0, 24)) {
    const s = String(raw ?? "").trim().replace(/ +/g, " ").slice(0, 40);
    if (!s || /[\n\r\t<>]/.test(s)) continue;
    if (out.some(x => x.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

function rosterTitle(value) {
  const title = cleanJobTitle(value);
  return title || "";
}

// Stored status is pending / accepted / cancelled. Expiry is computed. "sent" is the email
// delivery word for an invite that is still open. A stored "expired" is the same as a lapsed pending invite.
function rosterInviteStatus(invite, now) {
  if (!invite) return "invalid";
  if (invite.status === "sent") return displayStatus({ ...invite, status: "pending" }, now);
  if (invite.status === "expired") return "expired";
  return displayStatus(invite, now);
}

function rosterSentAt(invite) {
  return invite ? (invite.resentAt || invite.createdAt || null) : null;
}

function betterOpenInvite(a, b, now) {
  const rank = row => {
    const view = rosterInviteStatus(row, now);
    if (view === "pending") return 0;
    if (view === "expired") return 1;
    if (view === "accepted") return 2;
    return 9;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb ? a : b;
  const ta = inviteTime(rosterSentAt(a)) || new Date(0);
  const tb = inviteTime(rosterSentAt(b)) || new Date(0);
  return ta >= tb ? a : b;
}

function findRoot(parent, i) {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

// One row per person. Logins (users/{uid}, including a login with no invite) and invites
// (pending, sent, accepted, expired) are merged. The same uid, or the same email ignoring case, is one person.
// A login wins over an open invite: the row is Active and the invite is not listed again.
// Cancelled invites with no login are left out. Pass companyId to drop every other company.
export function mergeStaffRoster(logins, invites, { now = new Date(), companyId = "" } = {}) {
  const want = String(companyId || "").trim();
  const inCompany = row => !want || rosterCompanyId(row) === want;
  const nodes = [];

  for (const row of logins || []) {
    if (!row || typeof row !== "object" || !inCompany(row)) continue;
    const uid = String(row.uid || row.id || "").trim();
    if (!uid) continue;
    const email = normalizeInviteEmail(row.email);
    nodes.push({
      uids: [uid],
      emails: email ? [email] : [],
      name: String(row.name || "").trim(),
      role: String(row.role || ""),
      jobTitle: rosterTitle(row.jobTitle),
      tags: rosterTags(row),
      hasLogin: true,
      invite: null,
      loginFirst: true,
    });
  }

  for (const row of invites || []) {
    if (!row || typeof row !== "object" || !inCompany(row)) continue;
    const view = rosterInviteStatus(row, now);
    if (view !== "pending" && view !== "expired" && view !== "accepted") continue;
    const email = normalizeInviteEmail(row.email);
    const uid = String(row.acceptedUid || "").trim();
    nodes.push({
      uids: uid ? [uid] : [],
      emails: email ? [email] : [],
      name: String(row.name || "").trim(),
      role: String(row.role || ""),
      jobTitle: rosterTitle(row.jobTitle),
      tags: rosterTags(row),
      hasLogin: view === "accepted",
      invite: row,
      loginFirst: false,
    });
  }

  const parent = nodes.map((_, i) => i);
  const union = (a, b) => {
    const pa = findRoot(parent, a);
    const pb = findRoot(parent, b);
    if (pa !== pb) parent[pb] = pa;
  };
  const byUid = new Map();
  const byEmail = new Map();
  nodes.forEach((node, i) => {
    for (const uid of node.uids) {
      if (byUid.has(uid)) union(i, byUid.get(uid));
      else byUid.set(uid, i);
    }
    for (const email of node.emails) {
      if (byEmail.has(email)) union(i, byEmail.get(email));
      else byEmail.set(email, i);
    }
  });

  const groups = new Map();
  nodes.forEach((node, i) => {
    const root = findRoot(parent, i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(node);
  });

  const rows = [];
  for (const group of groups.values()) {
    const loginsIn = group.filter(node => node.loginFirst);
    const primary = loginsIn[0] || group[0];
    const pick = (read) => {
      for (const node of [...loginsIn, ...group]) {
        const value = read(node);
        if (value) return value;
      }
      return "";
    };
    let invite = null;
    for (const node of group) {
      if (!node.invite) continue;
      invite = invite ? betterOpenInvite(invite, node.invite, now) : node.invite;
    }
    const hasLogin = group.some(node => node.hasLogin);
    const view = invite ? rosterInviteStatus(invite, now) : "";
    let status = "active";
    if (!hasLogin) {
      if (view === "pending") status = "pending";
      else if (view === "expired") status = "expired";
      else continue;
    }
    const tags = (loginsIn.find(node => node.tags.length) || group.find(node => node.tags.length) || { tags: [] }).tags;
    const open = !hasLogin && (status === "pending" || status === "expired");
    rows.push({
      uid: pick(node => node.uids[0]) || primary.uids[0] || "",
      email: pick(node => node.emails[0]) || "",
      name: pick(node => node.name) || pick(node => node.emails[0]) || "Staff",
      role: pick(node => node.role),
      jobTitle: pick(node => node.jobTitle),
      tags,
      status,
      sentAt: open && invite ? rosterSentAt(invite) : null,
      expiresAt: open && invite ? invite.expiresAt : null,
      inviteId: open && invite && invite.id ? String(invite.id) : "",
      token: open && invite ? String(invite.token || "") : "",
    });
  }

  const rank = { pending: 0, expired: 1, active: 2 };
  rows.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
    || a.name.localeCompare(b.name, "en")
    || a.email.localeCompare(b.email, "en"));
  return rows;
}

function rosterStatusText(row) {
  if (!row || row.status === "active") return "Active";
  const sent = formatWhen(row.sentAt);
  const exp = formatWhen(row.expiresAt);
  if (row.status === "pending") {
    return "Invite pending" + (sent ? " · sent " + sent : "") + (exp ? " · expires " + exp : "");
  }
  if (row.status === "expired") {
    return "Invite expired" + (sent ? " · sent " + sent : "") + (exp ? " · expires " + exp : "");
  }
  return statusLabel(row.status);
}

function rosterDetail(row) {
  const bits = [];
  if (row.email) bits.push(row.email);
  if (row.jobTitle) bits.push(row.jobTitle);
  const level = roleLabel(row.role) || row.role;
  if (level) bits.push(level);
  return bits.join(" · ");
}

// One line per pending invite saying whether CallUp emailed it, from inviteStatus/{inviteId} (written by inviteEmailWorker).
// status is { delivery, reason } or null while it is still being checked. Heartwood invites are never emailed from here.
export function inviteEmailLine(status) {
  if (!status) return "Checking whether the invite email went out…";
  const delivery = String(status.delivery || "");
  if (delivery === "sent") return "Invite email sent. If it isn't in their inbox, ask them to check junk mail.";
  if (delivery === "received" || delivery === "resend") return "Sending the invite email…";
  if (delivery === "held") return "Not emailed. Copy the link and send it to them yourself (text or email).";
  return "The invite email didn't go through. Copy the link and send it to them yourself (text or email).";
}

export function staffViewHtml(invites, { now = new Date(), error = "", origin = HEARTWOOD_APP_ORIGIN, emailStatus = null, roles = SUPERVISOR_INVITE_ROLES, titles = null, logins = null, companyId = "", loginsNote = "", resetPasswords = false, viewerUid = "", remindGps = false, locations = null } = {}) {
  const offer = INVITE_ROLES.filter(r => (roles || []).includes(r));
  const titleRows = (Array.isArray(titles) ? titles : []).filter(t => t && offer.includes(t.level) && t.name && t.id);
  const rows = mergeStaffRoster(logins || [], invites || [], { now, companyId });
  const cards = rows.map(row => {
    const actions = (row.status === "pending" || row.status === "expired") && row.inviteId;
    const link = actions && row.token ? inviteLink(row.token, origin) : "";
    const reset = resetPasswords === true && row.status === "active" && row.uid && row.uid !== String(viewerUid || "");
    const gps = row.status === "active" && row.uid && locations && typeof locations === "object"
      ? rosterShareState(locations[row.uid])
      : null;
    const remind = remindGps === true && !!gps && !gps.sharing;
    const tags = (row.tags || []).map(tag => `<span class="skill-tag">${esc(tag)}</span>`).join("");
    const mail = emailStatus && row.status === "pending"
      ? `<div class="sub invite-mail" data-invite-mail="${esc((emailStatus[row.inviteId] && emailStatus[row.inviteId].delivery) || "checking")}">${esc(inviteEmailLine(emailStatus[row.inviteId] || null))}</div>`
      : "";
    return `<article class="inviterow" data-staff-status="${esc(row.status)}" data-invite-status="${esc(row.status)}" data-staff-email="${esc(row.email)}" data-staff-uid="${esc(row.uid)}">
      <div>
        <b>${esc(row.name)}</b>${gps ? ` <span class="gps-state" data-gps="${gps.sharing ? "on" : "off"}">${esc(gps.text)}</span>` : ""}
        <div class="sub">${esc(rosterDetail(row))}</div>
        <div class="sub staff-status">${esc(rosterStatusText(row))}</div>
        ${tags ? `<div class="skill-tags">${tags}</div>` : ""}
        ${mail}
        ${link ? `<p class="invite-link">${esc(link)}</p>` : ""}
      </div>
      ${actions || reset || remind ? `<div class="inviteacts">
        ${actions && link ? `<button type="button" data-invite-copy="${esc(link)}">Copy link</button>` : ""}
        ${actions ? `<button type="button" data-invite-resend="${esc(row.inviteId)}">Resend</button>
        <button type="button" data-invite-cancel="${esc(row.inviteId)}">Cancel</button>` : ""}
        ${reset ? `<button type="button" data-password-reset="${esc(row.uid)}" data-password-reset-name="${esc(row.name)}">Send password reset</button>` : ""}
        ${remind ? `<button type="button" data-gps-remind="${esc(row.uid)}" data-gps-remind-name="${esc(row.name)}">Remind to turn on GPS</button>` : ""}
      </div>` : ""}
    </article>`;
  }).join("");
  const note = String(loginsNote || "").trim();
  return `<div class="sm-head"><h1>Staff</h1></div>
    <p class="sub invite-note">Everyone with a login or an invite is listed once. Invite a ${offer.map(r => roleLabel(r).toLowerCase()).join(", ").replace(/, ([^,]*)$/, " or $1")}. Labourers and operators see their own jobs and no dollar amounts. They set their own password from the link. ${origin !== HEARTWOOD_APP_ORIGIN ? "CallUp emails them the link. Each pending invite says whether the email went out; you can always copy the link and send it yourself." : "Mail is not sent from this screen."}</p>
    <form id="invitef" class="card invitef" autocomplete="off">
      <h2>Invite staff</h2>
      <label>Name<input name="name" required maxlength="80" autocomplete="name"></label>
      <label>Email<input name="email" type="email" required maxlength="120" autocomplete="off" inputmode="email"></label>
      ${titleRows.length ? `<label>Job title<select name="jobTitle">${titleRows.map((t, i) => `<option value="${esc(t.id)}" data-level="${esc(t.level)}" data-name="${esc(t.name)}"${t.level === "operator" && !titleRows.slice(0, i).some(x => x.level === "operator") ? " selected" : ""}>${esc(t.name)} · ${esc(roleLabel(t.level))}</option>`).join("")}</select></label>
      <p class="sub">The job title sets the permission level.</p>` : ""}
      <label>Permission level<select name="role">
        ${offer.map(r => `<option value="${r}"${r === "operator" ? " selected" : ""}>${roleLabel(r)}</option>`).join("\n        ")}
      </select></label>
      <button class="primary" type="submit">Send invite</button>
      <p id="inviteerr" class="err">${esc(error ? inviteFailureText(error) : "")}</p>
    </form>
    ${note ? `<p class="sub">${esc(note)}</p>` : ""}
    <div class="invitelist">${cards || `<p class="muted">No staff yet.</p>`}</div>`;
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
    <p class="sub">You will join as ${esc(roleLabel(model.role))}.</p>
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
  // A CallUp company (any id but heartwood) never gets Heartwood wording, even with no company name loaded.
  const heartwood = companyId === HEARTWOOD_TENANT
    && (!companyName || companyName === "Heartwood" || companyName === "Heartwood Earthworx" || companyName === "Heartwood Jobs");
  const place = heartwood ? "Heartwood Jobs" : (companyName || "CallUp");
  const text = [
    `Hello ${profile.name},`,
    "",
    `You have been invited to ${place} as ${/^[aeiou]/.test(role) ? "an" : "a"} ${role}.`,
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
    subject: heartwood ? "You're invited to Heartwood Jobs" : `You're invited to ${place}`,
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
  if (!inviterMayInvite(inviter || { uid: invite.createdBy, profile: null }, invite.role, profile.companyId || HEARTWOOD_TENANT)) return { ok: false, reason: "invalid" };
  const existing = await deps.getUserByEmail(profile.email);
  if (existing) return { ok: false, reason: "email-in-use" };
  // A Heartwood admin also needs the grant the rules read (heartwoodAdmins/{uid}); without a way to write it, refuse.
  const hwAdmin = profile.role === "admin" && (profile.companyId || HEARTWOOD_TENANT) === HEARTWOOD_TENANT;
  if (hwAdmin && typeof deps.grantHeartwoodAdmin !== "function") return { ok: false, reason: "invalid" };
  const user = await deps.createUser({ email: profile.email, password: input.password, displayName: profile.name });
  const undo = async () => {
    if (hwAdmin && typeof deps.revokeHeartwoodAdmin === "function") await deps.revokeHeartwoodAdmin(user.uid);
    await deps.deleteProfile(user.uid);
    await deps.deleteUser(user.uid);
  };
  try {
    await deps.setProfile(user.uid, profile);
    if (hwAdmin) await deps.grantHeartwoodAdmin(user.uid, { inviteId: invite.id, grantedBy: invite.createdBy });
    const claimed = await deps.claimInvite(invite.id, user.uid, now);
    if (!claimed || !claimed.ok) {
      await undo();
      return { ok: false, reason: (claimed && claimed.reason) || "invalid" };
    }
  } catch (err) {
    await undo();
    throw err;
  }
  return { ok: true, uid: user.uid, email: profile.email, role: profile.role, name: profile.name };
}
