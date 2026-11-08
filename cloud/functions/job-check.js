// Heartwood "check for jobs" request.
// requestJobCheck (Admin SDK) writes jobChecks/{id} and wakes a Grok Bot routine.
// The routine docs (https://cursor.com/help/grok-bot/routines) say the key is sent
// as `Authorization: Bearer <key>`. JOB_CHECK_WEBHOOK_HEADER can rename that header.
// The value stays `Bearer <key>`. This file does not read Secret Manager.

export const HEARTWOOD_COMPANY_ID = "heartwood";
export const ALEX_UID = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
export const PATRICK_UID = "R7t41e54Ykcdk9WPdVZnDd697iI2";
export const RATE_LIMIT_MS = 2 * 60 * 1000;
export const DEFAULT_WEBHOOK_HEADER = "Authorization";

const BOOTSTRAP = new Set([ALEX_UID, PATRICK_UID]);
const HEADER_NAME = /^[A-Za-z0-9-]{1,40}$/;
const RESERVED_HEADERS = new Set(["content-type", "content-length", "host", "authorization"]);

export function profileCompanyId(profile) {
  if (!profile || typeof profile !== "object") return "";
  const company = typeof profile.companyId === "string" ? profile.companyId.trim() : "";
  if (company) return company;
  const tenant = typeof profile.tenantId === "string" ? profile.tenantId.trim() : "";
  if (tenant) return tenant;
  return HEARTWOOD_COMPANY_ID;
}

export function isBlockedCompany(company) {
  if (!company || typeof company !== "object") return false;
  if (company.isTest === true) return true;
  if (company.plan === "friend" || company.origin === "friend") return true;
  return false;
}

export function authorizeJobCheck({ uid, profile, company }) {
  if (!uid) return { ok: false, code: "unauthenticated" };
  const bootstrap = BOOTSTRAP.has(uid);
  const role = profile && profile.role;
  const office = role === "admin" || role === "supervisor";
  if (!bootstrap && !office) return { ok: false, code: "permission-denied" };
  if (!bootstrap && profileCompanyId(profile) !== HEARTWOOD_COMPANY_ID) return { ok: false, code: "permission-denied" };
  if (isBlockedCompany(company)) return { ok: false, code: "permission-denied", reason: "blocked-company" };
  return { ok: true, companyId: HEARTWOOD_COMPANY_ID, requestedBy: uid };
}

export function withinRateLimit(lastRequestedAt, now) {
  const last = typeof lastRequestedAt === "number" ? lastRequestedAt : NaN;
  const current = typeof now === "number" ? now : NaN;
  if (!Number.isFinite(last) || !Number.isFinite(current)) return false;
  return current - last < RATE_LIMIT_MS;
}

export function jobCheckDoc({ requestedBy, requestedAt }) {
  return {
    companyId: HEARTWOOD_COMPANY_ID,
    requestedBy,
    requestedAt,
    status: "requested",
  };
}

// Header name only. "authorization" is reserved here so a custom name cannot
// replace the default by accident; the default path still uses Authorization.
export function webhookHeaderName(name) {
  const value = String(name || "").trim();
  if (!HEADER_NAME.test(value)) return DEFAULT_WEBHOOK_HEADER;
  if (RESERVED_HEADERS.has(value.toLowerCase())) return DEFAULT_WEBHOOK_HEADER;
  return value;
}

export function jobCheckWebhookRequest({ url, key, headerName, requestId, requestedBy }) {
  const name = webhookHeaderName(headerName);
  return {
    url,
    method: "POST",
    headers: {
      [name]: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ requestId, requestedBy }),
  };
}

export async function performJobCheck(input) {
  const authz = authorizeJobCheck({ uid: input.uid, profile: input.profile, company: input.company });
  if (!authz.ok) return authz;
  if (!input.url || !input.key) return { ok: false, code: "failed-precondition", reason: "not-configured" };
  if (withinRateLimit(input.lastRequestedAt, input.now)) return { ok: false, code: "resource-exhausted" };
  let created;
  try {
    created = await input.createCheck(jobCheckDoc({ requestedBy: input.uid, requestedAt: input.now }));
  } catch (err) {
    if (err && err.code === "resource-exhausted") return { ok: false, code: "resource-exhausted" };
    return { ok: false, code: "internal" };
  }
  if (!created || !created.id) return { ok: false, code: "internal" };
  const request = jobCheckWebhookRequest({
    url: input.url,
    key: input.key,
    headerName: input.headerName,
    requestId: created.id,
    requestedBy: input.uid,
  });
  let posted;
  try {
    posted = await input.post(request);
  } catch {
    posted = { ok: false, status: 0 };
  }
  if (!posted || posted.ok !== true) {
    const summary = "The check did not start. Try again in a couple of minutes.";
    try {
      await input.markError(created.id, { summary, finishedAtMs: input.now });
    } catch {
      return { ok: false, code: "internal", requestId: created.id, reason: "webhook" };
    }
    return { ok: false, code: "failed-precondition", requestId: created.id, reason: "webhook" };
  }
  return { ok: true, requestId: created.id };
}
