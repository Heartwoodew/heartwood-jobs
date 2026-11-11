// cleanupOldJobs: deletes finished jobs an admin has already downloaded. Called by the admin's button only;
// there is no schedule. Every check in shared/job-cleanup.js runs again here with server data before a delete.
// Deletes: the job doc and its subcollections, the job chat thread, and Storage under tenants/{c}/jobs/{id}/.
// Keeps: receipts, claims, invoices, Xero records, and timesheets unless includeTimesheets is true.
import { FieldValue as AdminFieldValue } from "firebase-admin/firestore";
import { checkCleanupRequest, timesheetRemovals, jobLabel, MAX_JOBS_PER_RUN } from "../shared/job-cleanup.js";

export const HEARTWOOD_ADMIN_UIDS = Object.freeze(["1JKLsoxkQNfkphBBO0vDz2ziEyj2", "R7t41e54Ykcdk9WPdVZnDd697iI2"]);

export function callerScope(uid, profile) {
  if (HEARTWOOD_ADMIN_UIDS.includes(uid)) return { companyId: "heartwood", isAdmin: true, name: (profile && profile.name) || "" };
  if (!profile) return { companyId: "", isAdmin: false, name: "" };
  const company = String(profile.companyId || profile.tenantId || "heartwood");
  // Heartwood admin rights come from the uid list, never from a profile role.
  const isAdmin = company !== "heartwood" && profile.role === "admin";
  return { companyId: company, isAdmin, name: String(profile.name || "") };
}

function ms(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return 0;
}

export async function runJobCleanup({ uid, data, db, bucket, nowMs = Date.now(), FieldValue = AdminFieldValue }) {
  const input = data || {};
  const exportId = typeof input.exportId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(input.exportId) ? input.exportId : "";
  const jobIds = Array.isArray(input.jobIds) ? input.jobIds.slice(0, MAX_JOBS_PER_RUN + 1) : [];
  const includeTimesheets = input.includeTimesheets === true;
  const profileSnap = uid ? await db.collection("users").doc(uid).get() : null;
  const scope = callerScope(uid, profileSnap && profileSnap.exists ? profileSnap.data() : null);
  const exportRef = exportId ? db.collection("cleanupExports").doc(exportId) : null;
  const exportSnap = exportRef ? await exportRef.get() : null;
  const exportDoc = exportSnap && exportSnap.exists ? { ...exportSnap.data(), createdAtMs: ms(exportSnap.data().createdAt) } : null;
  const refs = jobIds.filter(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)).map(id => db.collection("jobs").doc(id));
  const snaps = refs.length ? await db.getAll(...refs) : [];
  const jobs = snaps.filter(s => s.exists).map(s => ({ id: s.id, ...s.data() }));
  const check = checkCleanupRequest({ uid, companyId: scope.companyId, isAdmin: scope.isAdmin, exportDoc, nowMs, jobIds, jobs, typed: input.typed });
  if (!check.ok) return check;

  // One run per download, even if the button is pressed twice.
  const claimed = await db.runTransaction(async tx => {
    const s = await tx.get(exportRef);
    if (!s.exists || s.data().used === true) return false;
    tx.update(exportRef, { used: true, usedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!claimed) return { ok: false, code: "failed-precondition", reason: "download-already-used" };

  const companyId = scope.companyId;
  let photosDeleted = 0;
  for (const job of jobs) {
    if (bucket) {
      const prefix = `tenants/${companyId}/jobs/${job.id}/`;
      const [files] = await bucket.getFiles({ prefix });
      for (const f of files) { await f.delete({ ignoreNotFound: true }); photosDeleted += 1; }
    }
    await db.recursiveDelete(db.collection("tenants").doc(companyId).collection("chats").doc("job_" + job.id));
    await db.recursiveDelete(db.collection("jobs").doc(job.id));
  }

  let entriesRemoved = 0, sheetsDeleted = 0;
  if (includeTimesheets) {
    const people = [...new Set(jobs.flatMap(j => Array.isArray(j.assigned) ? j.assigned : []).filter(x => typeof x === "string" && x))];
    const sheets = [];
    for (const person of people) {
      const s = await db.collection("timesheets").where("uid", "==", person).get();
      s.forEach(d => { const v = d.data() || {}; if ((v.companyId || v.tenantId || "heartwood") === companyId) sheets.push({ id: d.id, ...v }); });
    }
    for (const plan of timesheetRemovals(sheets, jobs)) {
      const ref = db.collection("timesheets").doc(plan.id);
      if (plan.deleteSheet) { await ref.delete(); sheetsDeleted += 1; }
      else await ref.update(Object.fromEntries(plan.removeEntryIds.map(k => ["entries." + k, FieldValue.delete()])));
      entriesRemoved += plan.removeEntryIds.length;
    }
  }

  const log = {
    companyId, by: uid, byName: scope.name, at: FieldValue.serverTimestamp(), exportId,
    jobIds: jobs.map(j => j.id), jobLabels: jobs.map(jobLabel), count: jobs.length,
    photosDeleted, includeTimesheets, timesheetEntriesRemoved: entriesRemoved, timesheetsDeleted: sheetsDeleted,
  };
  const logRef = await db.collection("jobCleanupLog").add(log);
  return { ok: true, logId: logRef.id, deleted: jobs.length, photosDeleted, timesheetEntriesRemoved: entriesRemoved, timesheetsDeleted: sheetsDeleted };
}
