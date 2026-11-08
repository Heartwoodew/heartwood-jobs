// CallUp Base cloud storage planner.
// The browser may suggest a path. It never decides access.
// Tenant, business/customer and finance come from the signed-in profile
// (and the Heartwood bootstrap UIDs already used by the jobs app).
// A tenant id, business id, file name or storage path supplied by the client is not authority.
// CallUp has one plan. It does not connect customer companies to Xero.
// Heartwood's existing Xero UI is unchanged and is not a product feature.

export const HEARTWOOD_TENANT = "heartwood";
export const ALEX_UID = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
export const PATRICK_UID = "R7t41e54Ykcdk9WPdVZnDd697iI2";

// Rules-admin and Xero access match app.js. Finance is this Heartwood UID list only.
// profile.finance is ignored so a client-writable profile cannot grant it.
export const BOOTSTRAP = {
  [ALEX_UID]: { name: "Alex", rulesAdmin: true, finance: true },
  [PATRICK_UID]: { name: "Patrick", rulesAdmin: true, finance: true },
};

export const CALLUP_BASE = Object.freeze({
  plan: "callup",
  jobs: true,
  photos: true,
  receipts: true,
  quotes: true,
  staffPermissions: true,
  staffInvites: true,
  xero: false,
  invoicing: false,
  // Fleet, policies, servicing and prestart are included for every company.
  // Xero stays off here. Heartwood finance is the bootstrap UID list, not this flag.
  features: Object.freeze({
    fleet: true,
    policies: true,
    servicing: true,
    prestart: true,
  }),
});

export const JOB_PHOTO_MIMES = Object.freeze(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const RECEIPT_MIMES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
export const JOB_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
export const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;
export const JOB_PHOTO_MAX_COUNT = 10;
export const RECEIPT_MAX_COUNT = 1;

export function jobTenantOf(record) {
  const id = record && typeof record.tenantId === "string" ? record.tenantId.trim() : "";
  return id || HEARTWOOD_TENANT;
}

/**
 * Membership is read from the server-stored profile (or Heartwood bootstrap).
 * requestedTenantId and requestedBusinessId are recorded and then ignored.
 */
export function resolveMembership({ uid, profile, requestedTenantId, requestedBusinessId } = {}) {
  const bootstrap = BOOTSTRAP[uid] || null;
  const ignoredClientTenantId = requestedTenantId ?? null;
  const ignoredClientBusinessId = requestedBusinessId ?? null;
  if (!uid || (!profile && !bootstrap)) {
    return { ok: false, reason: "no-membership", ignoredClientTenantId, ignoredClientBusinessId, plan: "callup" };
  }
  const explicit = profile && typeof profile.tenantId === "string" && profile.tenantId.trim();
  const tenantId = explicit ? profile.tenantId.trim() : HEARTWOOD_TENANT;
  const role = (profile && profile.role) || (bootstrap ? "admin" : "operator");
  const rulesAdmin = role === "admin" || !!(bootstrap && bootstrap.rulesAdmin);
  const finance = tenantId === HEARTWOOD_TENANT && !!(bootstrap && bootstrap.finance);
  const customerIds = profile && Array.isArray(profile.customerIds)
    ? profile.customerIds.filter(x => typeof x === "string" && x.trim()).map(x => x.trim())
    : null;
  const canSeeMoney = rulesAdmin || role === "supervisor";
  return {
    ok: true,
    uid,
    tenantId,
    role,
    rulesAdmin,
    finance,
    canSeeMoney,
    customerIds: customerIds && customerIds.length ? customerIds : null,
    plan: "callup",
    xero: false,
    invoicing: false,
    ignoredClientTenantId,
    ignoredClientBusinessId,
  };
}

function deny(reason) {
  return { ok: false, reason };
}

function checkFile(file, mimes, max) {
  if (!file) return deny("no-file");
  const type = String(file.type || "").toLowerCase();
  if (!mimes.includes(type)) return deny("mime-not-allowed");
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) return deny("empty-file");
  if (size > max) return deny("too-large");
  return { ok: true, type, size };
}

function customerOk(membership, job) {
  if (!membership.customerIds) return true;
  return membership.customerIds.includes(job && job.client);
}

/** Firebase Storage error codes only. A raw server message is not shown. */
export function storageErrorCode(error) {
  const raw = error && typeof error === "object" && "code" in error ? error.code : error;
  const m = /^storage\/[a-z0-9-]{1,40}$/.exec(String(raw || "").trim());
  return m ? m[0] : "storage/unknown";
}

/**
 * One metadata failure is a storage error, not an empty gallery.
 * `readable: false` must not be used to hide getMetadata or getBlob.
 */
export function summarizePhotoListing(rows) {
  const items = [];
  for (const row of rows || []) {
    if (row && row.error) return { ok: false, reason: storageErrorCode(row.error) };
    items.push(row);
  }
  return { ok: true, items };
}

export function canSeeJob(membership, job) {
  if (!membership?.ok || !job?.id) return false;
  if (jobTenantOf(job) !== membership.tenantId) return false;
  if (!customerOk(membership, job)) return false;
  if (membership.rulesAdmin) return true;
  return Array.isArray(job.assigned) && job.assigned.includes(membership.uid);
}

/** Storage prefix for one job's photos. The path is not authority; canSeeJob is. */
export function jobPhotoPrefix(membership, job) {
  if (!membership?.ok) return deny(membership?.reason || "no-membership");
  if (!job?.id) return deny("no-job");
  if (!canSeeJob(membership, job)) {
    return deny(jobTenantOf(job) !== membership.tenantId ? "wrong-tenant" : "not-allowed");
  }
  return { ok: true, prefix: `tenants/${membership.tenantId}/jobs/${job.id}/photos` };
}

/**
 * One object returned by a storage list. Receipt objects stay hidden.
 * An older mirror with no purpose still shows when its content type is an
 * accepted image. An absent or unknown content type is not shown.
 * A receipt purpose or receipt id is never accepted, even on this prefix.
 */
export function listedJobPhoto({ membership, job, path, contentType, customMetadata, size, readable, error } = {}) {
  if (error) return deny(storageErrorCode(error));
  if (readable === false) return deny("not-allowed");
  const prefix = jobPhotoPrefix(membership, job);
  if (!prefix.ok) return prefix;
  const meta = customMetadata && typeof customMetadata === "object" ? customMetadata : {};
  const full = typeof path === "string" ? path : "";
  if (meta.purpose === "receipt" || meta.receiptId || full.includes("/receipts/")) return deny("receipt-hidden");
  if (!full.startsWith(prefix.prefix + "/")) return deny("not-allowed");
  const name = full.slice(prefix.prefix.length + 1);
  if (!name || name.includes("/")) return deny("not-allowed");
  if (meta.purpose && meta.purpose !== "job-photo") return deny("not-allowed");
  const type = String(contentType ?? "").trim().toLowerCase();
  if (!JOB_PHOTO_MIMES.includes(type)) return deny("mime-not-allowed");
  if (size === 0) return deny("empty-file");
  const storedExpiry = typeof meta.expiresAfter === "string" && /^\d{4}-\d{2}-\d{2}$/.test(meta.expiresAfter) ? meta.expiresAfter : null;
  return {
    ok: true,
    path: full,
    name,
    contentType: type || null,
    storedExpiresAfter: storedExpiry,
    uploaderUid: typeof meta.uploaderUid === "string" ? meta.uploaderUid : null,
    bytes: Number.isFinite(size) ? size : null,
  };
}

function safePhotoId(id) {
  const s = String(id || "");
  if (!/^p[A-Za-z0-9_-]{1,40}$/.test(s)) return null;
  return s;
}

export function planJobPhotoBatch({ membership, job, files, clientPath, requestedTenantId } = {}) {
  if (!membership?.ok) return deny(membership?.reason || "no-membership");
  if (requestedTenantId != null && requestedTenantId !== membership.tenantId) return deny("wrong-tenant");
  if (!job?.id) return deny("no-job");
  if (jobTenantOf(job) !== membership.tenantId) return deny("wrong-tenant");
  if (!customerOk(membership, job)) return deny("customer-scope");
  if (!canSeeJob(membership, job)) return deny("not-allowed");
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return deny("no-file");
  if (list.length > JOB_PHOTO_MAX_COUNT) return deny("too-many-files");
  const uploads = [];
  for (const file of list) {
    const checked = checkFile(file, JOB_PHOTO_MIMES, JOB_PHOTO_MAX_BYTES);
    if (!checked.ok) return checked;
    const photoId = safePhotoId(file.photoId);
    if (!photoId) return deny("bad-name");
    const path = `tenants/${membership.tenantId}/jobs/${job.id}/photos/${photoId}`;
    if (clientPath != null && clientPath !== path) return deny("path-not-authoritative");
    if (path.includes("/finance/")) return deny("finance-denied");
    uploads.push({
      path,
      contentType: checked.type,
      bytes: checked.size,
      metadata: {
        tenantId: membership.tenantId,
        jobId: String(job.id),
        uploaderUid: membership.uid,
        purpose: "job-photo",
        batchCount: String(list.length),
      },
    });
  }
  return { ok: true, uploads };
}

export function planReceiptUpload({ membership, receipt, file, clientPath, requestedTenantId } = {}) {
  if (!membership?.ok) return deny(membership?.reason || "no-membership");
  if (requestedTenantId != null && requestedTenantId !== membership.tenantId) return deny("wrong-tenant");
  if (!receipt?.id || receipt.uid !== membership.uid) return deny("not-allowed");
  if (jobTenantOf(receipt) !== membership.tenantId) return deny("wrong-tenant");
  const checked = checkFile(file, RECEIPT_MIMES, RECEIPT_MAX_BYTES);
  if (!checked.ok) return checked;
  const path = `tenants/${membership.tenantId}/receipts/${receipt.id}/original`;
  if (clientPath != null && clientPath !== path) return deny("path-not-authoritative");
  if (path.split("/").includes("finance")) return deny("finance-denied");
  return {
    ok: true,
    path,
    contentType: checked.type,
    bytes: checked.size,
    metadata: {
      tenantId: membership.tenantId,
      receiptId: String(receipt.id),
      uploaderUid: membership.uid,
      purpose: "receipt",
    },
  };
}

/**
 * Read decision. The path is a hint only: the job or receipt record must agree,
 * and finance files stay on the Heartwood Xero UID list.
 * Operators may upload a receipt and still be refused a read (the image shows dollars).
 */
export function canReadObject({ membership, path, job, receipt } = {}) {
  if (!membership?.ok || typeof path !== "string" || !path) return deny("not-allowed");
  const parts = path.split("/");
  if (parts[0] !== "tenants" || parts.length < 4) return deny("not-allowed");
  if (parts[1] !== membership.tenantId) return deny("wrong-tenant");
  if (parts[2] === "finance") {
    return membership.finance ? { ok: true, purpose: "finance" } : deny("finance-denied");
  }
  if (parts[2] === "jobs" && parts[4] === "photos") {
    if (!job || String(job.id) !== parts[3]) return deny("not-allowed");
    if (!canSeeJob(membership, job)) return deny(jobTenantOf(job) !== membership.tenantId ? "wrong-tenant" : "not-allowed");
    return { ok: true, purpose: "job-photo" };
  }
  if (parts[2] === "receipts" && parts[4] === "original") {
    if (!receipt || String(receipt.id) !== parts[3]) return deny("not-allowed");
    if (jobTenantOf(receipt) !== membership.tenantId) return deny("wrong-tenant");
    if (membership.uid === ALEX_UID && membership.tenantId === HEARTWOOD_TENANT && jobTenantOf(receipt) === HEARTWOOD_TENANT) {
      return { ok: true, purpose: "receipt" };
    }
    if (receipt.uid === membership.uid && membership.canSeeMoney) return { ok: true, purpose: "receipt" };
    return deny("receipt-hidden");
  }
  if (parts[2] === "_exports") {
    return membership.rulesAdmin ? { ok: true, purpose: "export" } : deny("not-allowed");
  }
  return deny("not-allowed");
}

/**
 * Job-photo capture. Each file is planned on its own so one rejected file
 * does not block the rest. At most JOB_PHOTO_MAX_COUNT files are stored.
 * Email still sends every picked file; this plan is only the Storage mirror.
 */
export function planJobPhotoMirrors({ membership, job, files } = {}) {
  const list = Array.isArray(files) ? files : [];
  const uploads = [];
  const skipped = [];
  list.forEach((file, sourceIndex) => {
    if (uploads.length >= JOB_PHOTO_MAX_COUNT) {
      skipped.push({ sourceIndex, name: file && file.name, reason: "too-many-files" });
      return;
    }
    const one = planJobPhotoBatch({ membership, job, files: [file] });
    if (!one.ok) skipped.push({ sourceIndex, name: file && file.name, reason: one.reason });
    else uploads.push({ ...one.uploads[0], sourceIndex });
  });
  return { ok: uploads.length > 0, uploads, skipped, order: ["prepare-files", "storage-each-accepted-file", "email-flag-unchanged"] };
}

/**
 * Receipt capture order required by the deployed Storage rules.
 * The receipts document must already exist, owned by the signed-in staff user,
 * and its jobId must be the open job when the upload started from a job.
 * Storage is last. receiptChunks stay the email/Hubdoc fallback and are not replaced.
 */
export function planStaffReceiptCapture({ membership, job, receiptId, file, receiptDoc } = {}) {
  if (!membership?.ok) return deny(membership?.reason || "no-membership");
  if (!receiptDoc) return deny("receipt-not-written");
  if (!receiptId || receiptDoc.id !== receiptId) return deny("receipt-not-written");
  if (receiptDoc.uid !== membership.uid) return deny("not-allowed");
  const jobId = job && job.id ? job.id : null;
  if (jobId && receiptDoc.jobId !== jobId) return deny("job-mismatch");
  if (!jobId && receiptDoc.jobId) return deny("job-mismatch");
  const storage = planReceiptUpload({
    membership,
    receipt: { id: receiptDoc.id, uid: receiptDoc.uid, tenantId: jobTenantOf(receiptDoc) },
    file,
  });
  if (!storage.ok) return storage;
  return {
    ok: true,
    order: ["receiptChunks", "receiptDoc", "storage"],
    receiptDocFirst: true,
    receipt: { id: receiptDoc.id, uid: receiptDoc.uid, jobId: receiptDoc.jobId || null, status: receiptDoc.status || "queued" },
    storage,
  };
}

/** Named stub of the deployed receipt create rule. A missing receipt doc is denied. */
export function stubReceiptStorageDecision({ receiptDoc, authUid, path, metadata, job } = {}) {
  if (!receiptDoc) return deny("receipt-not-written");
  if (!authUid || receiptDoc.uid !== authUid) return deny("not-allowed");
  if (typeof path !== "string" || !path.endsWith(`/receipts/${receiptDoc.id}/original`)) return deny("path-not-authoritative");
  if (!metadata || metadata.purpose !== "receipt" || metadata.receiptId !== receiptDoc.id || metadata.uploaderUid !== authUid) {
    return deny("not-allowed");
  }
  if (job && job.id && receiptDoc.jobId !== job.id) return deny("job-mismatch");
  return { ok: true, purpose: "receipt" };
}

export async function putPlanned(plan, upload) {
  if (!plan?.ok) {
    const err = new Error(plan?.reason || "not-allowed");
    err.code = plan?.reason || "not-allowed";
    throw err;
  }
  const targets = plan.uploads || [plan];
  const out = [];
  for (const target of targets) {
    out.push(await upload({
      path: target.path,
      contentType: target.contentType,
      metadata: target.metadata,
    }));
  }
  return out;
}
