// Operational cloud retention for CallUp Base.
// 3 calendar months after job completion or the last whitelisted activity.
// This module does not schedule anything. SCHEDULING_APPROVED stays false
// until the owner changes it after a reviewed test run.
//
// Australian business records are generally kept for 5 years (ATO).
// This clock is only the short-lived operational copy in CallUp/Firebase.
// It does not satisfy accounting retention. Invoices, GST, Xero, the
// reimbursements ledger, timesheets and profit history are not deleted.

import { HEARTWOOD_TENANT, jobTenantOf, resolveMembership } from "./cloud-storage.js";

export const RETENTION_MONTHS = 3;
export const WARNING_DAYS = 14;
export const SOFT_DELETE_GRACE_DAYS = 14;
export const EXPORT_URL_TTL_SECONDS = 15 * 60;
export const MAX_EXPORT_BYTES = 32 * 1024 * 1024;

// Owner must set this to true in source, deliberately, after tests.
// Environment variables alone cannot turn deletion on.
export const SCHEDULING_APPROVED = false;

export const ACCOUNTING_NOTE =
  "Australian business accounting records are usually kept for 5 years. " +
  "This 3-month policy deletes only short-lived operational cloud copies. " +
  "It does not satisfy that accounting obligation. Invoices, GST, Xero records, " +
  "the reimbursements ledger and profit history stay in Xero or in the retained financial fields.";

export const ACCOUNTING_FIELDS = Object.freeze([
  "invoiceNo", "invoiceAmount", "invoiceDate", "invoiceDescription", "invoiceContact",
  "invoiced", "invoicedAt", "invoicedBy",
  "invoiceExcluded", "invoiceExcludedAt", "invoiceExcludedByName",
  "doNotInvoice",
  "xeroStatus", "xeroInvoiceId", "xeroInvoiceNo", "xeroError", "xeroQueuedAt",
  "xeroCheck", "xeroCheckPending", "xeroCheckQueuedAt",
  "poAmount", "poAmountBasis", "poAmountSource", "quoteAmount",
]);

export const NEVER_PURGE_COLLECTIONS = Object.freeze([
  "xeroQueue", "reimbursements", "timesheets", "users", "jobMoney",
  "swmsChunks", "swmsSignatures", "incidents", "incidentCounter", "ownerSettings",
]);

const NEVER_PURGE_META = /^(profitHistory|quoteRates|findAllPos|invHist_)/;

export function addCalendarMonths(isoDate, months) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!m) return null;
  let year = Number(m[1]);
  let monthIndex = Number(m[2]) - 1 + months;
  year += Math.floor(monthIndex / 12);
  monthIndex = ((monthIndex % 12) + 12) % 12;
  const day = Number(m[3]);
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const used = Math.min(day, last);
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(used).padStart(2, "0")}`;
}

export function addCalendarDays(isoDate, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!m) return null;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return t.toISOString().slice(0, 10);
}

export function brisbaneToday(now) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** Accept real instants and YYYY-MM-DD. Reject locale diary strings and updatedAt-shaped guesses. */
export function parseInstant(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") {
    try {
      const d = value.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch { return null; }
  }
  if (typeof value === "object" && typeof value.seconds === "number" && Number.isFinite(value.seconds)) {
    if (value.seconds < 946684800 || value.seconds > 4102444800) return null;
    return new Date(value.seconds * 1000);
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const d = new Date(`${value}T02:00:00.000Z`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }
  return null;
}

export function isCompletedJob(job) {
  return !!job && (job.status === "Done" || job.sm8Status === "Completed");
}

function latest(instants) {
  return instants.filter(Boolean).sort((a, b) => b.getTime() - a.getTime())[0] || null;
}

export function retentionAnchor(job, extras = {}) {
  if (!job) return { ok: false, reason: "missing-record" };
  if (isCompletedJob(job)) {
    const completed = parseInstant(job.completedAt);
    if (completed) return { ok: true, kind: "completion", at: completed };
    if (typeof job.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(job.date)) {
      return { ok: true, kind: "completion-date", at: parseInstant(job.date) };
    }
    return { ok: false, reason: "missing-anchor" };
  }
  const instants = [];
  const started = parseInstant(job.startedAt);
  if (started) instants.push(started);
  const emailed = parseInstant(job.photosEmailedAt);
  if (emailed) instants.push(emailed);
  for (const r of extras.receipts || []) {
    if (r && r.jobId === job.id) {
      const t = parseInstant(r.createdAtIso || r.createdAt);
      if (t) instants.push(t);
    }
  }
  for (const q of extras.quotes || []) {
    if (q && q.jobId === job.id) {
      const t = parseInstant(q.acceptedAt || q.updatedAtIso);
      if (t) instants.push(t);
    }
  }
  const best = latest(instants);
  if (best) return { ok: true, kind: "activity", at: best };
  if (typeof job.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(job.date)) {
    return { ok: true, kind: "scheduled-date", at: parseInstant(job.date) };
  }
  return { ok: false, reason: "missing-anchor" };
}

export function quoteAnchor(quote) {
  if (!quote) return { ok: false, reason: "missing-record" };
  const accepted = parseInstant(quote.acceptedAt);
  if (accepted) return { ok: true, kind: "quote-accepted", at: accepted };
  const updated = parseInstant(quote.updatedAtIso);
  if (updated) return { ok: true, kind: "quote-updated", at: updated };
  const created = parseInstant(quote.createdAt);
  if (created) return { ok: true, kind: "quote-created", at: created };
  return { ok: false, reason: "missing-anchor" };
}

export function receiptAnchor(receipt) {
  if (!receipt) return { ok: false, reason: "missing-record" };
  const t = parseInstant(receipt.createdAtIso || receipt.createdAt);
  if (!t) return { ok: false, reason: "missing-anchor" };
  return { ok: true, kind: "receipt-created", at: t };
}

export function expiryDate(instant) {
  const day = brisbaneToday(instant);
  if (!day) return null;
  return addCalendarMonths(day, RETENTION_MONTHS);
}

export function retentionView(job, now, extras) {
  const anchor = retentionAnchor(job, extras || {});
  if (job?.retention?.state === "purged") {
    return {
      state: "purged", expiresOn: job.retention.expiresOn || null, due: false,
      warning: false, anchorKind: job.retention.anchorKind || null, reason: null,
    };
  }
  if (!anchor.ok) {
    return { state: "hold", reason: anchor.reason, expiresOn: null, warning: false, due: false, anchorKind: null };
  }
  const expiresOn = expiryDate(anchor.at);
  const today = brisbaneToday(now);
  const warnFrom = addCalendarDays(expiresOn, -WARNING_DAYS);
  const due = !!(today && expiresOn && today >= expiresOn);
  const warning = !!(today && warnFrom && !due && today >= warnFrom);
  if (job?.retention?.hold || job?.retention?.state === "held") {
    return { state: "held", reason: "admin-hold", expiresOn, warning: false, due, anchorKind: anchor.kind };
  }
  if (job?.retention?.state === "soft-deleted") {
    return { state: "soft-deleted", reason: null, expiresOn, warning: false, due, anchorKind: anchor.kind };
  }
  return {
    state: due ? "due" : warning ? "warning" : "active",
    reason: null, expiresOn, warning, due, anchorKind: anchor.kind,
  };
}

export function retentionAdminText(view) {
  if (!view || view.reason === "missing-anchor" || !view.expiresOn) {
    return "Cloud copy: no automatic deletion date (missing completion or activity date). Deletion is not scheduled. Invoices and Xero records are not deleted.";
  }
  if (view.state === "held") {
    return `Cloud deletion is on hold. The operational expiry date would be ${view.expiresOn}. Deletion is not scheduled. Invoices and Xero records are not deleted.`;
  }
  if (view.state === "purged") {
    return `Operational cloud copy was purged. Accounting fields and Xero records were kept. Expiry was ${view.expiresOn}.`;
  }
  const head = view.due
    ? `Operational cloud copy passed ${view.expiresOn}.`
    : `Operational cloud copy expires ${view.expiresOn}.`;
  const soon = view.warning ? " Download it before then." : "";
  return `${head}${soon} Deletion is not scheduled. Invoices, GST and Xero records are not deleted.`;
}

/**
 * Operational expiry for a job photo. The date comes from the job's existing
 * retention anchor (completion, or the whitelisted activity already stored).
 * `now` only decides warning / due. It is not an anchor, so opening a photo
 * does not move expiresAfter. SCHEDULING_APPROVED is unchanged.
 */
export function operationalExpiresAfter(job, now, extras) {
  const view = retentionView(job, now || new Date(), extras || {});
  return {
    expiresAfter: view.expiresOn || null,
    state: view.state,
    warning: !!view.warning,
    due: !!view.due,
    anchorKind: view.anchorKind || null,
    reason: view.reason || null,
    schedulingApproved: SCHEDULING_APPROVED === true,
    deletionPerformed: false,
  };
}

function cloneRow(row) {
  return row ? { ...row, retention: row.retention ? { ...row.retention } : row.retention } : row;
}

function cloneState(state) {
  const src = state || {};
  return {
    jobs: (src.jobs || []).map(cloneRow),
    receipts: (src.receipts || []).map(cloneRow),
    receiptChunks: (src.receiptChunks || []).map(r => ({ ...r })),
    quotes: (src.quotes || []).map(cloneRow),
    photos: (src.photos || []).map(p => ({ ...p })),
    users: (src.users || []).map(u => ({ ...u })),
    xeroQueue: (src.xeroQueue || []).map(x => ({ ...x })),
    reimbursements: (src.reimbursements || []).map(r => ({ ...r })),
    meta: (src.meta || []).map(m => ({ ...m })),
    timesheets: (src.timesheets || []).map(t => ({ ...t })),
  };
}

function accountingStub(job, view, now) {
  const stub = {
    id: job.id,
    tenantId: jobTenantOf(job),
    status: job.status || null,
    sm8JobNo: job.sm8JobNo ?? null,
    sm8Status: job.sm8Status ?? null,
    operationalPurgedAt: now.toISOString(),
    retention: {
      state: "purged",
      expiresOn: view.expiresOn,
      purgedAt: now.toISOString(),
      anchorKind: view.anchorKind,
      hold: false,
    },
  };
  for (const key of ACCOUNTING_FIELDS) {
    if (job[key] != null && job[key] !== "") stub[key] = job[key];
  }
  return stub;
}

function linkedIds(job, state) {
  const tenantId = jobTenantOf(job);
  const receipts = (state.receipts || []).filter(r => r.jobId === job.id && jobTenantOf(r) === tenantId);
  const quotes = (state.quotes || []).filter(q => q.jobId === job.id && jobTenantOf(q) === tenantId);
  const photos = (state.photos || []).filter(p => p.jobId === job.id && jobTenantOf(p) === tenantId);
  const receiptIds = receipts.map(r => r.id);
  const paths = [
    ...photos.map(p => p.path),
    ...receipts.map(r => r.storagePath || `tenants/${tenantId}/receipts/${r.id}/original`),
  ];
  return { receipts, quotes, photos, receiptIds, quoteIds: quotes.map(q => q.id), paths };
}

function decideJob(job, state, now) {
  if (job.retention?.state === "purged") return { action: "skip", reason: "already-purged" };
  if (job.retention?.hold || job.retention?.state === "held") return { action: "skip", reason: "held" };
  const view = retentionView(job, now, state);
  if (!view.expiresOn || view.reason === "missing-anchor") return { action: "skip", reason: view.reason || "missing-anchor" };
  if (job.retention?.state === "soft-deleted") {
    const deletedOn = brisbaneToday(parseInstant(job.retention.softDeletedAt));
    const graceOn = addCalendarDays(deletedOn, SOFT_DELETE_GRACE_DAYS);
    const today = brisbaneToday(now);
    if (!graceOn || !today || today < graceOn) return { action: "skip", reason: "in-grace" };
    const linked = linkedIds(job, state);
    return { action: "purge", view, stub: accountingStub(job, view, now), ...linked };
  }
  if (!view.due) return { action: "skip", reason: "not-due" };
  return {
    action: "soft-delete",
    retention: {
      state: "soft-deleted",
      hold: false,
      expiresOn: view.expiresOn,
      softDeletedAt: now.toISOString(),
      anchorKind: view.anchorKind,
    },
  };
}

function tenantBlocked(record, flags) {
  return jobTenantOf(record) === HEARTWOOD_TENANT && flags.heartwoodApproved !== true;
}

export function runRetention(state, options = {}) {
  const flags = options.flags || {};
  const base = cloneState(state);
  if (flags.schedulingApproved !== true || flags.purgeEnabled !== true) {
    return {
      ran: false, reason: "scheduling-not-approved", mutated: false, state: base,
      softDeleted: [], purged: [], skipped: [], errors: [],
    };
  }
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) {
    return { ran: false, reason: "bad-clock", mutated: false, state: base, softDeleted: [], purged: [], skipped: [], errors: [] };
  }
  const next = base;
  const softDeleted = [];
  const purged = [];
  const skipped = [];
  const errors = [];
  let mutated = false;
  const deleter = options.deleteObject || (() => {});

  for (const job of next.jobs) {
    if (tenantBlocked(job, flags)) {
      skipped.push({ id: job.id, kind: "job", reason: "heartwood-not-approved" });
      continue;
    }
    let decision;
    try {
      decision = decideJob(job, next, now);
    } catch (e) {
      errors.push({ id: job.id, kind: "job", message: String(e.message || e) });
      continue;
    }
    if (decision.action === "skip") {
      skipped.push({ id: job.id, kind: "job", reason: decision.reason });
      continue;
    }
    if (decision.action === "soft-delete") {
      job.retention = decision.retention;
      softDeleted.push({ id: job.id, kind: "job" });
      mutated = true;
      continue;
    }
    try {
      for (const path of decision.paths) deleter(path);
    } catch (e) {
      errors.push({ id: job.id, kind: "job", message: String(e.message || e) });
      continue;
    }
    const idx = next.jobs.findIndex(j => j.id === job.id);
    next.jobs[idx] = decision.stub;
    const dropR = new Set(decision.receiptIds);
    const dropQ = new Set(decision.quoteIds);
    next.receipts = next.receipts.filter(r => !dropR.has(r.id));
    next.receiptChunks = next.receiptChunks.filter(c => !dropR.has(c.rid));
    next.quotes = next.quotes.filter(q => !dropQ.has(q.id));
    next.photos = next.photos.filter(p => !(p.jobId === job.id && jobTenantOf(p) === jobTenantOf(job)));
    purged.push({ id: job.id, kind: "job" });
    mutated = true;
  }

  for (const quote of [...next.quotes]) {
    if (quote.jobId && next.jobs.some(j => j.id === quote.jobId)) {
      skipped.push({ id: quote.id, kind: "quote", reason: "follows-job" });
      continue;
    }
    if (tenantBlocked(quote, flags)) {
      skipped.push({ id: quote.id, kind: "quote", reason: "heartwood-not-approved" });
      continue;
    }
    if (quote.retention?.state === "purged") {
      skipped.push({ id: quote.id, kind: "quote", reason: "already-purged" });
      continue;
    }
    if (quote.retention?.hold) {
      skipped.push({ id: quote.id, kind: "quote", reason: "held" });
      continue;
    }
    const anchor = quoteAnchor(quote);
    if (!anchor.ok) {
      skipped.push({ id: quote.id, kind: "quote", reason: "missing-anchor" });
      continue;
    }
    const expiresOn = expiryDate(anchor.at);
    const today = brisbaneToday(now);
    if (!expiresOn || today < expiresOn) {
      skipped.push({ id: quote.id, kind: "quote", reason: "not-due" });
      continue;
    }
    if (quote.retention?.state !== "soft-deleted") {
      quote.retention = { state: "soft-deleted", hold: false, expiresOn, softDeletedAt: now.toISOString(), anchorKind: anchor.kind };
      softDeleted.push({ id: quote.id, kind: "quote" });
      mutated = true;
      continue;
    }
    const graceOn = addCalendarDays(brisbaneToday(parseInstant(quote.retention.softDeletedAt)), SOFT_DELETE_GRACE_DAYS);
    if (!graceOn || today < graceOn) {
      skipped.push({ id: quote.id, kind: "quote", reason: "in-grace" });
      continue;
    }
    next.quotes = next.quotes.filter(q => q.id !== quote.id);
    purged.push({ id: quote.id, kind: "quote" });
    mutated = true;
  }

  for (const receipt of [...next.receipts]) {
    if (receipt.jobId && next.jobs.some(j => j.id === receipt.jobId && j.retention?.state !== "purged")) {
      skipped.push({ id: receipt.id, kind: "receipt", reason: "follows-job" });
      continue;
    }
    if (receipt.jobId && next.jobs.some(j => j.id === receipt.jobId)) continue;
    if (tenantBlocked(receipt, flags)) {
      skipped.push({ id: receipt.id, kind: "receipt", reason: "heartwood-not-approved" });
      continue;
    }
    const anchor = receiptAnchor(receipt);
    if (!anchor.ok) {
      skipped.push({ id: receipt.id, kind: "receipt", reason: "missing-anchor" });
      continue;
    }
    const expiresOn = expiryDate(anchor.at);
    const today = brisbaneToday(now);
    if (!expiresOn || today < expiresOn) {
      skipped.push({ id: receipt.id, kind: "receipt", reason: "not-due" });
      continue;
    }
    if (receipt.retention?.hold) {
      skipped.push({ id: receipt.id, kind: "receipt", reason: "held" });
      continue;
    }
    if (receipt.retention?.state !== "soft-deleted") {
      receipt.retention = { state: "soft-deleted", hold: false, expiresOn, softDeletedAt: now.toISOString(), anchorKind: anchor.kind };
      softDeleted.push({ id: receipt.id, kind: "receipt" });
      mutated = true;
      continue;
    }
    const graceOn = addCalendarDays(brisbaneToday(parseInstant(receipt.retention.softDeletedAt)), SOFT_DELETE_GRACE_DAYS);
    if (!graceOn || today < graceOn) {
      skipped.push({ id: receipt.id, kind: "receipt", reason: "in-grace" });
      continue;
    }
    const path = receipt.storagePath || `tenants/${jobTenantOf(receipt)}/receipts/${receipt.id}/original`;
    try { deleter(path); }
    catch (e) {
      errors.push({ id: receipt.id, kind: "receipt", message: String(e.message || e) });
      continue;
    }
    next.receipts = next.receipts.filter(r => r.id !== receipt.id);
    next.receiptChunks = next.receiptChunks.filter(c => c.rid !== receipt.id);
    next.photos = next.photos.filter(p => p.path !== path);
    purged.push({ id: receipt.id, kind: "receipt" });
    mutated = true;
  }

  for (const name of NEVER_PURGE_COLLECTIONS) {
    if (JSON.stringify(next[name] || []) !== JSON.stringify((state || {})[name] || [])) {
      throw new Error(`retention tried to change protected collection ${name}`);
    }
  }
  const metaChanged = (next.meta || []).some(row => NEVER_PURGE_META.test(row.id || ""));
  if (metaChanged && JSON.stringify(next.meta) !== JSON.stringify((state || {}).meta || [])) {
    throw new Error("retention tried to change protected meta");
  }
  return { ran: true, reason: null, mutated, state: next, softDeleted, purged, skipped, errors };
}

export function cancelScheduledDeletion({ membership, job, requestedTenantId, now }) {
  if (!membership?.ok || !membership.rulesAdmin) return { ok: false, reason: "not-authorised" };
  if (!job) return { ok: false, reason: "missing-record" };
  if (jobTenantOf(job) !== membership.tenantId) return { ok: false, reason: "wrong-tenant" };
  if (requestedTenantId != null && requestedTenantId !== membership.tenantId) return { ok: false, reason: "wrong-tenant" };
  if (job.retention?.state === "purged") return { ok: false, reason: "already-purged" };
  if (job.retention?.state === "soft-deleted") return { ok: false, reason: "use-restore" };
  const view = retentionView(job, now || new Date());
  return {
    ok: true,
    job: {
      ...job,
      retention: {
        ...(job.retention || {}),
        state: "held",
        hold: true,
        heldAt: (now || new Date()).toISOString(),
        heldBy: membership.uid,
        expiresOn: view.expiresOn,
      },
    },
  };
}

export function restoreOperationalCopy({ membership, job, requestedTenantId, now }) {
  if (!membership?.ok || !membership.rulesAdmin) return { ok: false, reason: "not-authorised" };
  if (!job) return { ok: false, reason: "missing-record" };
  if (jobTenantOf(job) !== membership.tenantId) return { ok: false, reason: "wrong-tenant" };
  if (requestedTenantId != null && requestedTenantId !== membership.tenantId) return { ok: false, reason: "wrong-tenant" };
  if (job.retention?.state === "purged") return { ok: false, reason: "already-purged" };
  if (job.retention?.state !== "soft-deleted") return { ok: false, reason: "not-soft-deleted" };
  return {
    ok: true,
    job: {
      ...job,
      retention: {
        state: "active",
        hold: true,
        restoredAt: (now || new Date()).toISOString(),
        restoredBy: membership.uid,
        expiresOn: job.retention.expiresOn || null,
      },
    },
  };
}

function textBytes(value) {
  return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  const bytes = parts.map(p => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const len = bytes.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const b of bytes) { out.set(b, o); o += b.length; }
  return out;
}
function u16(n) { return [n & 255, (n >>> 8) & 255]; }
function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }

export function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : textBytes(file.data);
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
      name, data,
    ]);
    const central = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cd = concat(centrals);
  const eocd = concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cd.length), u32(offset), u16(0),
  ]);
  return concat([...locals, cd, eocd]);
}

function operationalJob(job) {
  const out = { classification: "operational-cloud-copy", accountingRecord: false };
  for (const [key, value] of Object.entries(job || {})) {
    if (ACCOUNTING_FIELDS.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

function byteSize(file) {
  if (!file) return 0;
  if (file.bytes instanceof Uint8Array) return file.bytes.byteLength;
  if (typeof file.size === "number") return file.size;
  if (typeof file.byteLength === "number") return file.byteLength;
  return 0;
}

export function buildOperationalExport({
  membership, requestedTenantId, scope = "job", jobId, jobs = [], photos = [], receipts = [], quotes = [], now,
} = {}) {
  if (!membership?.ok || !membership.rulesAdmin) return { ok: false, reason: "not-authorised" };
  if (requestedTenantId != null && requestedTenantId !== membership.tenantId) return { ok: false, reason: "wrong-tenant" };
  const tenantId = membership.tenantId;
  const inTenant = row => jobTenantOf(row) === tenantId;
  let jobRows = (jobs || []).filter(inTenant);
  if (scope === "job") {
    jobRows = jobRows.filter(j => j.id === jobId);
    if (!jobRows.length) return { ok: false, reason: "not-allowed" };
  }
  const jobIds = new Set(jobRows.map(j => j.id));
  const photoRows = (photos || []).filter(p => inTenant(p) && (scope !== "job" || jobIds.has(p.jobId)));
  const receiptRows = (receipts || []).filter(r => inTenant(r) && (scope !== "job" || jobIds.has(r.jobId) || (!r.jobId && scope !== "job")));
  const quoteRows = (quotes || []).filter(q => inTenant(q) && (scope !== "job" || jobIds.has(q.jobId) || (!q.jobId && scope !== "job")));
  const foreign = (jobs || []).filter(j => !inTenant(j)).map(j => j.id);
  let total = 0;
  for (const p of photoRows) total += byteSize(p);
  for (const r of receiptRows) total += byteSize(r.file || r);
  if (total > MAX_EXPORT_BYTES) return { ok: false, reason: "export-too-large", bytes: total };

  const excluded = [
    { kind: "xeroQueue", reason: "accounting-record-not-in-operational-export" },
    { kind: "reimbursements", reason: "financial-ledger-kept" },
    { kind: "timesheets", reason: "wage-record-kept" },
    { kind: "meta/profitHistory", reason: "accounting-record-kept" },
    { kind: "meta/quoteRates", reason: "business-rate-card-kept" },
    { kind: "meta/invHist", reason: "accounting-record-kept" },
    { kind: "users", reason: "sign-in-profiles-kept" },
    ...ACCOUNTING_FIELDS.map(field => ({ kind: `job.${field}`, reason: "financial-field-retained-in-database-and-omitted-from-zip" })),
  ];
  for (const id of foreign) excluded.push({ kind: "job", id, reason: "other-tenant" });

  const included = [];
  const files = [];
  for (const job of jobRows) {
    const body = operationalJob(job);
    files.push({ name: `jobs/${job.id}.json`, data: textBytes(body) });
    included.push({ kind: "job", id: job.id, classification: "operational-cloud-copy" });
    for (const field of ACCOUNTING_FIELDS) {
      if (job[field] != null && job[field] !== "") {
        included.push({ kind: "accounting-field-omitted", id: job.id, field });
      }
    }
  }
  for (const photo of photoRows) {
    if (!(photo.bytes instanceof Uint8Array)) {
      excluded.push({ kind: "photo", id: photo.path || photo.id, reason: "bytes-not-loaded" });
      continue;
    }
    const name = `photos/${photo.jobId || "loose"}/${(photo.path || "photo").split("/").pop()}`;
    files.push({ name, data: photo.bytes });
    included.push({ kind: "photo", path: photo.path, jobId: photo.jobId });
  }
  for (const receipt of receiptRows) {
    const body = {
      ...receipt,
      classification: "operational-reimbursement-copy",
      accountingRecord: false,
      note: "Receipt amount is the operational copy the worker submitted. It is not the Xero/Hubdoc accounting record. The reimbursements ledger is not in this zip and is not deleted by this policy.",
    };
    delete body.file;
    files.push({ name: `receipts/${receipt.id}.json`, data: textBytes(body) });
    included.push({ kind: "receipt", id: receipt.id, classification: "operational-reimbursement-copy" });
    if (receipt.file?.bytes instanceof Uint8Array) {
      files.push({ name: `receipts/${receipt.id}.bin`, data: receipt.file.bytes });
    }
  }
  for (const quote of quoteRows) {
    files.push({
      name: `quotes/${quote.id}.json`,
      data: textBytes({
        ...quote,
        classification: "operational-quote",
        accountingRecord: false,
        taxInvoice: false,
        note: "Ex GST quote estimate. Not a tax invoice and not a 5-year accounting record.",
      }),
    });
    included.push({ kind: "quote", id: quote.id, classification: "operational-quote" });
  }

  const manifest = {
    plan: "base",
    xero: false,
    invoicing: false,
    tenantId,
    scope,
    generatedAt: (now instanceof Date ? now : new Date()).toISOString(),
    retentionMonths: RETENTION_MONTHS,
    schedulingApproved: SCHEDULING_APPROVED,
    deletionPerformed: false,
    accountingNote: ACCOUNTING_NOTE,
    included,
    excluded,
  };
  files.unshift({ name: "manifest.json", data: textBytes(manifest) });
  const safeTenant = String(tenantId).replace(/[^A-Za-z0-9_-]/g, "");
  return {
    ok: true,
    filename: `operational-${safeTenant}-${scope}${jobId ? "-" + String(jobId).replace(/[^A-Za-z0-9_-]/g, "") : ""}.zip`,
    zip: buildZip(files),
    manifest,
    public: false,
  };
}

export function issueExportGrant({ membership, requestedTenantId, exportMeta, now, sign } = {}) {
  if (!membership?.ok || !membership.rulesAdmin) return { ok: false, reason: "not-authorised", public: false };
  if (requestedTenantId != null && requestedTenantId !== membership.tenantId) return { ok: false, reason: "wrong-tenant", public: false };
  if (!exportMeta || exportMeta.tenantId !== membership.tenantId) return { ok: false, reason: "wrong-tenant", public: false };
  const path = exportMeta.path;
  if (typeof path !== "string" || !path.startsWith(`tenants/${membership.tenantId}/_exports/`)) {
    return { ok: false, reason: "path-not-authoritative", public: false };
  }
  const clock = now instanceof Date ? now : new Date();
  const expiresAtMs = clock.getTime() + EXPORT_URL_TTL_SECONDS * 1000;
  const signed = typeof sign === "function"
    ? sign({ path, expiresAtMs, tenantId: membership.tenantId })
    : null;
  if (!signed || signed.public === true || typeof signed.url !== "string") {
    return { ok: false, reason: "public-url-refused", public: false };
  }
  if (!/[?&](X-Goog-Expires|Expires)=/.test(signed.url)) {
    return { ok: false, reason: "public-url-refused", public: false };
  }
  if (signed.url.includes(`tenants/${membership.tenantId}`) === false && signed.url.includes(encodeURIComponent(`tenants/${membership.tenantId}`)) === false) {
    return { ok: false, reason: "wrong-tenant", public: false };
  }
  return {
    ok: true,
    url: signed.url,
    expiresAt: new Date(expiresAtMs).toISOString(),
    ttlSeconds: EXPORT_URL_TTL_SECONDS,
    public: false,
    tenantId: membership.tenantId,
    path,
  };
}

export { resolveMembership };
