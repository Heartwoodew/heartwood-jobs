// Platform-owner deletion of one CallUp company. Pure checks: no Admin SDK, no Stripe client.
// Heartwood (the "heartwood" tenant, and jobs with no tenantId) is never deleted.
// A staff Auth user is removed only when that user belongs to this company and no other.

// Keep in step with app/features/company.js.
const HEARTWOOD_COMPANY_ID = "heartwood";
const PLATFORM_OWNER_EMAIL = "alex@heartwoodew.com";
const PLATFORM_OWNER_UID = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";

export const AUDIT_COLLECTION = "companyDeletions";
export const COMPANY_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// Same people pause-retention.js refuses to delete. Alex, the box sync user, Patrick.
const PROTECTED_UIDS = new Set([
  "1JKLsoxkQNfkphBBO0vDz2ziEyj2",
  "38SU5waAy4f9UI9N6JTqDMaYpQg2",
  "R7t41e54Ykcdk9WPdVZnDd697iI2",
]);

export const COMPANY_DELETE_COLLECTIONS = [
  "jobs", "jobMoney", "quotes", "timesheets", "leaveRequests", "reimbursementClaims",
  "receipts", "incidents", "swmsSignatures", "invites", "hoursExports", "liveLocations",
  "runSheets", "clients", "inbox", "take5s", "users", "platformSessions", "testMailLog", "mail",
];

export function callerIsPlatformOwner(auth) {
  if (!auth || !auth.uid) return false;
  const token = auth.token || {};
  const email = String(token.email || "").trim().toLowerCase();
  const verified = token.email_verified === true;
  if (!verified || email !== PLATFORM_OWNER_EMAIL) return false;
  if (token.platformOwner === true) return true;
  return auth.uid === PLATFORM_OWNER_UID;
}

export function callerHomeCompany(profile) {
  const company = profile && typeof profile.companyId === "string" ? profile.companyId.trim() : "";
  if (company) return company;
  const tenant = profile && typeof profile.tenantId === "string" ? profile.tenantId.trim() : "";
  return tenant || HEARTWOOD_COMPANY_ID;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function subscriptionIdOf(company) {
  const billing = company && company.billing;
  const id = billing && typeof billing.stripeSubscriptionId === "string" ? billing.stripeSubscriptionId.trim() : "";
  return id;
}

// Jobs with no tenantId are Heartwood, even when a companyId was copied onto them.
// A document belongs to this company only when every company id it carries is this company.
export function docInCompanyScope(doc, companyId, callerUid = "") {
  if (!companyId || companyId === HEARTWOOD_COMPANY_ID || !COMPANY_ID_RE.test(companyId)) return false;
  if (!doc || typeof doc !== "object") return false;
  const path = typeof doc.path === "string" ? doc.path : "";
  const collection = doc.collection || path.split("/")[0] || "";
  if (path.startsWith("companies/heartwood") || path.startsWith("tenants/heartwood")) return false;
  if (path === `companies/${companyId}` || path === `tenants/${companyId}`) return true;
  if (path === `companyTrades/${companyId}` || path === `take5Settings/${companyId}` || path === `performanceSettings/${companyId}`) return true;
  if (path === `companyMeta/${companyId}` || path === `companyMeta/${companyId}_dispatch`) return true;
  const data = doc.data || {};
  const company = text(data.companyId);
  const tenant = text(data.tenantId);
  if (company === HEARTWOOD_COMPANY_ID || tenant === HEARTWOOD_COMPANY_ID) return false;
  if (!company && !tenant) return false;
  if (collection === "jobs" && !tenant) return false;
  if (company && company !== companyId) return false;
  if (tenant && tenant !== companyId) return false;
  if (company !== companyId && tenant !== companyId) return false;
  if (collection === "users") {
    const uid = doc.id || path.split("/")[1] || "";
    if (!uid || uid === callerUid || authActionForProfile(uid, data, companyId) !== "delete") return false;
  }
  return true;
}

// "delete" only when this profile's company is exactly the target and no other company is named.
export function authActionForProfile(uid, profile, companyId) {
  if (!uid || !profile || !companyId || companyId === HEARTWOOD_COMPANY_ID) return "keep";
  if (PROTECTED_UIDS.has(uid)) return "keep";
  if (!COMPANY_ID_RE.test(companyId)) return "keep";
  const company = text(profile.companyId);
  const tenant = text(profile.tenantId);
  if (company === HEARTWOOD_COMPANY_ID || tenant === HEARTWOOD_COMPANY_ID) return "keep";
  if (!company && !tenant) return "keep";
  if (company && company !== companyId) return "keep";
  if (tenant && tenant !== companyId) return "keep";
  if (company !== companyId && tenant !== companyId) return "keep";
  return "delete";
}

export function companyStoragePrefixes(companyId) {
  if (!companyId || companyId === HEARTWOOD_COMPANY_ID || !COMPANY_ID_RE.test(companyId)) return [];
  return [
    `companies/${companyId}/`,
    `tenants/${companyId}/`,
    `take5Photos/${companyId}/`,
    `pauseBackups/${companyId}/`,
  ];
}

export function staffStoragePrefixes(uid) {
  if (!uid || !/^[A-Za-z0-9]{10,128}$/.test(uid)) return [];
  return [`leaveCertificates/${uid}/`, `reimbursements/${uid}/`];
}

export function deletionRefusal({ auth, companyId, confirmName, company, callerProfile }) {
  if (!callerIsPlatformOwner(auth)) {
    return { ok: false, code: auth && auth.uid ? "permission-denied" : "unauthenticated", reason: "platform-owner" };
  }
  const id = text(companyId);
  if (!id || id.toLowerCase() === HEARTWOOD_COMPANY_ID) {
    return { ok: false, code: "permission-denied", reason: "heartwood" };
  }
  if (!COMPANY_ID_RE.test(id)) {
    return { ok: false, code: "permission-denied", reason: "heartwood" };
  }
  if (callerHomeCompany(callerProfile) === id) {
    return { ok: false, code: "permission-denied", reason: "own-company" };
  }
  if (!company || typeof company !== "object") {
    return { ok: false, code: "not-found", reason: "missing-company" };
  }
  const name = typeof company.name === "string" ? company.name : "";
  if (!name || typeof confirmName !== "string" || confirmName !== name) {
    return { ok: false, code: "failed-precondition", reason: "name-mismatch" };
  }
  return { ok: true, companyId: id, companyName: name };
}

export function deletionErrorMessage(result) {
  const reason = result && result.reason;
  const map = {
    "platform-owner": "Only the platform owner can delete a company.",
    heartwood: "Heartwood cannot be deleted.",
    "own-company": "You cannot delete your own company.",
    "name-mismatch": "Type the company name exactly.",
    "missing-company": "That company was not found.",
    "stripe-not-configured": "Stripe is not configured, so the subscription was not cancelled and the company was not deleted.",
    "stripe-cancel-failed": "The Stripe subscription could not be cancelled, so the company was not deleted.",
  };
  return map[reason] || "That company could not be deleted.";
}

export function deletionAuditRecord({ companyId, companyName, deletedBy, at, counts, stripe }) {
  return {
    collection: AUDIT_COLLECTION,
    id: companyId,
    data: {
      companyId,
      companyName,
      deletedAt: new Date(at).toISOString(),
      deletedBy: deletedBy || "",
      counts: {
        firestore: counts.firestore || 0,
        storage: counts.storage || 0,
        storageFailed: counts.storageFailed || 0,
        authDeleted: counts.authDeleted || 0,
        authDisabled: counts.authDisabled || 0,
        authKept: counts.authKept || 0,
      },
      stripe: stripe || "none",
    },
  };
}

function hoursExportPaths(rows) {
  const paths = [];
  for (const row of rows) {
    if (!row || row.collection !== "hoursExports") continue;
    const path = row.data && typeof row.data.storagePath === "string" ? row.data.storagePath : "";
    if (!path || path.includes("..") || !path.startsWith("hoursExports/")) continue;
    paths.push(path);
  }
  return paths;
}

// Validates, cancels a Stripe subscription when one is stored, then deletes only this company's docs.
// The audit record is written to companyDeletions, which this function never deletes.
export async function runOwnerCompanyDeletion(deps) {
  const companyId = deps.companyId;
  const loaded = await deps.loadCompany(companyId);
  const company = loaded && loaded.data;
  const callerUid = deps.auth && deps.auth.uid;
  const callerProfile = await deps.loadCallerProfile(callerUid);
  const gate = deletionRefusal({
    auth: deps.auth,
    companyId,
    confirmName: deps.confirmName,
    company,
    callerProfile,
  });
  if (!gate.ok) return gate;

  const subscriptionId = subscriptionIdOf(company);
  let stripe = "none";
  if (subscriptionId) {
    if (typeof deps.cancelSubscription !== "function") {
      return { ok: false, code: "failed-precondition", reason: "stripe-not-configured" };
    }
    const cancelled = await deps.cancelSubscription(subscriptionId);
    if (!cancelled || cancelled.ok === false) {
      return {
        ok: false,
        code: "failed-precondition",
        reason: (cancelled && cancelled.reason) || "stripe-cancel-failed",
      };
    }
    stripe = cancelled.skipped === "already-gone" ? "already-gone" : "cancelled";
  }

  const listed = await deps.listCandidateDocs(gate.companyId);
  const selected = (listed || []).filter(row => docInCompanyScope(row, gate.companyId, callerUid));
  const authPlans = [];
  for (const row of selected) {
    if (row.collection !== "users") continue;
    const uid = row.id || String(row.path || "").split("/")[1] || "";
    authPlans.push({ uid, action: authActionForProfile(uid, row.data, gate.companyId) });
  }
  const prefixes = [
    ...companyStoragePrefixes(gate.companyId),
    ...authPlans.filter(plan => plan.action === "delete").flatMap(plan => staffStoragePrefixes(plan.uid)),
  ];
  const storageResult = await deps.deleteStorage({
    companyId: gate.companyId,
    prefixes,
    paths: hoursExportPaths(selected),
  });
  const storage = typeof storageResult === "number" ? storageResult : (storageResult && storageResult.deleted) || 0;
  const storageFailed = storageResult && storageResult.failed ? storageResult.failed : 0;

  let authDeleted = 0;
  let authDisabled = 0;
  let authKept = 0;
  for (const plan of authPlans) {
    if (plan.action !== "delete") {
      authKept += 1;
      continue;
    }
    const result = await deps.deleteAuthUser(plan.uid);
    if (result === "deleted") authDeleted += 1;
    else if (result === "disabled") authDisabled += 1;
    else authKept += 1;
  }

  const roots = new Set([`companies/${gate.companyId}`, `tenants/${gate.companyId}`]);
  let firestore = 0;
  for (const row of selected) {
    if (!row.path || roots.has(row.path)) continue;
    await deps.deleteDoc(row.path);
    firestore += 1;
  }
  if (typeof deps.deleteTree === "function") firestore += Number(await deps.deleteTree(gate.companyId)) || 0;
  else {
    await deps.deleteDoc(`companies/${gate.companyId}`);
    firestore += 1;
  }

  const counts = { firestore, storage, storageFailed, authDeleted, authDisabled, authKept };
  const at = deps.now != null ? (deps.now instanceof Date ? deps.now.getTime() : Number(deps.now)) : Date.now();
  const audit = deletionAuditRecord({
    companyId: gate.companyId,
    companyName: gate.companyName,
    deletedBy: callerUid,
    at,
    counts,
    stripe,
  });
  await deps.writeAudit(audit);
  return { ok: true, companyId: gate.companyId, companyName: gate.companyName, counts, stripe, audit };
}
