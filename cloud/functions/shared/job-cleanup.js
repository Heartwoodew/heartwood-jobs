// Clean up old jobs. An admin lists finished jobs older than a cut-off, downloads a copy, then deletes them.
// Pure: no Firestore, Storage or DOM. The webpage builds the download; the cleanupOldJobs callable re-checks
// every rule here before it deletes anything. Same file in app/features and cloud/functions/shared.
// Nothing here runs on a schedule.
import { buildZip } from "./cloud-retention.js";

export const CLEANUP_STATUSES = Object.freeze(["Done", "Cancelled", "Invoiced"]);
export const DEFAULT_CUTOFF_DAYS = 90;
export const MIN_CUTOFF_DAYS = 30;
export const MAX_CUTOFF_DAYS = 3650;
export const MAX_JOBS_PER_RUN = 300;
export const EXPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const HEARTWOOD = "heartwood";

export function cutoffDays(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_CUTOFF_DAYS;
  return Math.min(MAX_CUTOFF_DAYS, Math.max(MIN_CUTOFF_DAYS, n));
}

// Brisbane calendar date (no daylight saving, UTC+10).
export function brisbaneIso(now) {
  const ms = now instanceof Date ? now.getTime() : Number(now);
  return new Date(ms + 10 * 3600 * 1000).toISOString().slice(0, 10);
}

export function cutoffDate(now, days) {
  const d = new Date(brisbaneIso(now) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - cutoffDays(days));
  return d.toISOString().slice(0, 10);
}

export function jobCompanyOf(job) {
  const c = job && typeof job.companyId === "string" && job.companyId.trim() ? job.companyId.trim()
    : job && typeof job.tenantId === "string" && job.tenantId.trim() ? job.tenantId.trim() : HEARTWOOD;
  return c;
}

function isoOf(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
  if (typeof value.toDate === "function") return brisbaneIso(value.toDate());
  if (typeof value.toMillis === "function") return brisbaneIso(value.toMillis());
  if (typeof value.seconds === "number") return brisbaneIso(value.seconds * 1000);
  if (typeof value._seconds === "number") return brisbaneIso(value._seconds * 1000);
  if (value instanceof Date) return brisbaneIso(value);
  return "";
}

// The day a finished job counts from: when it was completed, else its job date, else its last update.
export function finishedOn(job) {
  return isoOf(job && job.completedAt) || isoOf(job && job.date) || isoOf(job && job.updatedAt) || "";
}

export function isFinishedJob(job) {
  if (!job) return false;
  if (CLEANUP_STATUSES.includes(String(job.status || ""))) return true;
  return job.sm8Status === "Completed" || job.sm8Status === "Unsuccessful";
}

// Why a job cannot be cleaned up, or "" when it can.
export function cleanupBlocker(job, { companyId, now, days } = {}) {
  if (!job || !job.id) return "missing";
  if (!companyId || jobCompanyOf(job) !== companyId) return "other-company";
  if (!isFinishedJob(job)) return "not-finished";
  if (job.retention && job.retention.state === "held") return "on-hold";
  const on = finishedOn(job);
  if (!on) return "no-date";
  if (on >= cutoffDate(now, days)) return "too-recent";
  return "";
}

export function selectOldJobs(jobs, opts = {}) {
  return (jobs || []).filter(j => !cleanupBlocker(j, opts))
    .sort((a, b) => finishedOn(a).localeCompare(finishedOn(b)) || String(a.id).localeCompare(String(b.id)));
}

export function jobLabel(job) {
  const no = String((job && (job.sm8JobNo || job.jobNo)) || "").trim();
  return no || String((job && job.id) || "").slice(-6).toUpperCase();
}

export function confirmPhrase(count) {
  return `DELETE ${Number(count) || 0} JOBS`;
}

export function confirmOk(typed, count) {
  return String(typed || "").trim().toUpperCase() === confirmPhrase(count);
}

// A timesheet entry belongs to a job when its job text names the job number or id.
// Shifts on the same day by someone on the job are listed too, but only the named ones can be removed.
function jobTokens(job) {
  const out = [String(job.id || "")];
  const no = String(job.sm8JobNo || job.jobNo || "").trim();
  if (no) out.push(no);
  return out.filter(t => t.length >= 3).map(t => t.toLowerCase());
}
export function entryNamesJob(entry, job) {
  const text = String((entry && entry.job) || "").toLowerCase();
  if (!text) return false;
  // Whole word only, so job B-101 does not match B-1010.
  return jobTokens(job).some(t => new RegExp("(^|[^a-z0-9])" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^a-z0-9])").test(text));
}
function sheetEntries(sheet) {
  const e = sheet && sheet.entries;
  if (!e || typeof e !== "object") return [];
  return Object.values(e).filter(x => x && typeof x === "object");
}
export function linkedTimesheetRows(sheets, jobs) {
  const rows = [];
  for (const sheet of sheets || []) {
    for (const entry of sheetEntries(sheet)) {
      for (const job of jobs || []) {
        const named = entryNamesJob(entry, job);
        const sameDay = !named && entry.date && entry.date === job.date && Array.isArray(job.assigned) && job.assigned.includes(sheet.uid);
        if (named || sameDay) rows.push({ job, sheet, entry, link: named ? "named" : "same-day" });
      }
    }
  }
  return rows;
}

// Timesheet edits for the optional "also remove their timesheet entries" box.
// Only entries that name a job in this run are removed. A sheet left with no entries is deleted.
// Sheets already marked sent to payroll are never changed.
export function timesheetRemovals(sheets, jobs) {
  const out = [];
  for (const sheet of sheets || []) {
    if (!sheet || !sheet.id || sheet.sent === true) continue;
    const entries = sheet.entries && typeof sheet.entries === "object" ? sheet.entries : {};
    const drop = Object.keys(entries).filter(k => (jobs || []).some(j => entryNamesJob(entries[k], j)));
    if (!drop.length) continue;
    out.push({ id: sheet.id, removeEntryIds: drop, deleteSheet: drop.length === Object.keys(entries).length });
  }
  return out;
}

export function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function table(headers, rows) {
  return "\ufeff" + [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
function logText(log) {
  if (!Array.isArray(log)) return "";
  return log.map(x => typeof x === "string" ? x : [isoOf(x && x.at), x && (x.byName || x.by), x && (x.text || x.note || x.msg)].filter(Boolean).join(" ")).join(" | ");
}

export const JOB_COLUMNS = Object.freeze(["Job", "Id", "Status", "Finished on", "Job date", "Client", "Address", "Type", "PO", "Assigned",
  "Description", "Notes", "Loads", "Supervisor", "Invoice no", "Log"]);
export function jobsCsv(jobs) {
  return table(JOB_COLUMNS, (jobs || []).map(j => [jobLabel(j), j.id, j.status || j.sm8Status || "", finishedOn(j), j.date || "", j.client || "",
    j.address || "", j.type || "", j.po || "", (j.assignedNames || j.assigned || []).join("; "), j.description || "", j.notes || "",
    j.loads ?? "", j.supervisorName || "", j.invoiceNo || j.xeroInvoiceNo || "", logText(j.log)]));
}
export function timesheetsCsv(rows) {
  return table(["Job", "Job id", "Person", "Week", "Date", "Start", "Finish", "Break start", "Break end", "Job text", "Note", "Link"],
    (rows || []).map(({ job, sheet, entry, link }) => [jobLabel(job), job.id, sheet.name || sheet.uid || "", sheet.weekStart || "", entry.date || "",
      entry.start || "", entry.finish || "", entry.breakStart || "", entry.breakEnd || "", entry.job || "", entry.note || "", link]));
}
export function receiptsCsv(receipts, jobs) {
  const byId = new Map((jobs || []).map(j => [j.id, j]));
  return table(["Job", "Job id", "Receipt id", "Who", "Date", "Supplier", "Amount inc GST", "Status", "Notes"],
    (receipts || []).filter(r => byId.has(r.jobId)).map(r => [jobLabel(byId.get(r.jobId)), r.jobId, r.id, r.name || r.uid || "",
      isoOf(r.date) || isoOf(r.createdAt) || "", r.supplier || "", r.amountInc ?? (r.amountCents != null ? (r.amountCents / 100).toFixed(2) : ""),
      r.status || "", r.notes || r.note || ""]));
}

function safeName(s) { return String(s || "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "file"; }

// photos: [{ jobId, name, bytes: Uint8Array }]
export function buildCleanupExport({ companyId, jobs, sheets, receipts, photos, now, days, by } = {}) {
  const list = jobs || [];
  const rows = linkedTimesheetRows(sheets, list);
  const day = brisbaneIso(now || Date.now());
  const files = [
    { name: "README.txt", data: [`Old jobs copy for ${companyId}, made ${day} by ${by || "an admin"}.`,
      `${list.length} finished jobs older than ${cutoffDays(days)} days (before ${cutoffDate(now || Date.now(), days)}).`,
      "jobs.csv: job details, notes and log. timesheets.csv: shifts that name a job, and same-day shifts by people on it.",
      "receipts.csv: receipt details only (no images). photos/: job photos, when included.",
      "Open the .csv files in Excel or Google Sheets.", ""].join("\r\n") },
    { name: "jobs.csv", data: jobsCsv(list) },
    { name: "timesheets.csv", data: timesheetsCsv(rows) },
    { name: "receipts.csv", data: receiptsCsv(receipts, list) },
  ];
  const byId = new Map(list.map(j => [j.id, j]));
  for (const p of photos || []) {
    const job = byId.get(p.jobId);
    if (!job || !(p.bytes instanceof Uint8Array)) continue;
    files.push({ name: `photos/${safeName(jobLabel(job))}_${safeName(job.id)}/${safeName(p.name)}`, data: p.bytes });
  }
  return {
    filename: `old-jobs-${safeName(companyId)}-${day}.zip`,
    zip: buildZip(files),
    counts: { jobs: list.length, timesheetRows: rows.length, receipts: (receipts || []).filter(r => byId.has(r.jobId)).length, photos: files.length - 4 },
  };
}

export function exportRecord({ companyId, uid, jobIds, days, photos, counts }) {
  return {
    companyId: String(companyId), createdBy: String(uid), jobIds: [...new Set(jobIds || [])].slice(0, MAX_JOBS_PER_RUN),
    cutoffDays: cutoffDays(days), photos: !!photos, counts: counts || {}, used: false,
  };
}

// Server-side checks before any delete. ctx: { uid, companyId, isAdmin, exportDoc, exportId, nowMs, jobs, typed, includeTimesheets }.
export function checkCleanupRequest({ uid, companyId, isAdmin, exportDoc, nowMs, jobIds, jobs, typed } = {}) {
  if (!uid) return { ok: false, code: "unauthenticated", reason: "sign-in" };
  if (!isAdmin || !companyId) return { ok: false, code: "permission-denied", reason: "admins-only" };
  const ids = [...new Set((jobIds || []).filter(x => typeof x === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(x)))];
  if (!ids.length || ids.length !== (jobIds || []).length) return { ok: false, code: "invalid-argument", reason: "bad-job-list" };
  if (ids.length > MAX_JOBS_PER_RUN) return { ok: false, code: "invalid-argument", reason: "too-many" };
  if (!exportDoc) return { ok: false, code: "failed-precondition", reason: "download-first" };
  if (exportDoc.createdBy !== uid || exportDoc.companyId !== companyId) return { ok: false, code: "permission-denied", reason: "not-your-download" };
  if (exportDoc.used === true) return { ok: false, code: "failed-precondition", reason: "download-already-used" };
  const made = exportDoc.createdAtMs || 0;
  if (!made || nowMs - made > EXPORT_MAX_AGE_MS) return { ok: false, code: "failed-precondition", reason: "download-too-old" };
  const exported = new Set(exportDoc.jobIds || []);
  if (ids.some(id => !exported.has(id))) return { ok: false, code: "failed-precondition", reason: "not-in-download" };
  if (!confirmOk(typed, ids.length)) return { ok: false, code: "failed-precondition", reason: "confirm-text" };
  const byId = new Map((jobs || []).filter(Boolean).map(j => [j.id, j]));
  const blocked = [];
  for (const id of ids) {
    const why = cleanupBlocker(byId.get(id), { companyId, now: nowMs, days: exportDoc.cutoffDays });
    if (why) blocked.push({ id, why });
  }
  if (blocked.length) return { ok: false, code: "failed-precondition", reason: "not-eligible", blocked };
  return { ok: true, ids };
}
