// Clean up old jobs end to end on the emulators: rules for the download record and log, and the cleanupOldJobs
// handler with the Admin SDK. Fake companies only (bravo, charlie). Never points at heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { runJobCleanup } from "../functions/lib/job-cleanup-run.js";
import { exportRecord } from "../../app/features/job-cleanup.js";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const PROJECT = "demo-heartwood";
let env, admin, db, bucket;
const ctx = uid => env.authenticatedContext(uid).firestore();
const old = (id, extra = {}) => ({ companyId: "bravo", tenantId: "bravo", status: "Done", date: "2026-03-02", client: "Acme", address: id + " St",
  sm8JobNo: "B-" + id, assigned: ["bOp"], ...extra });

test.before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST, "run on the emulators");
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") } });
  admin = initializeApp({ projectId: PROJECT, storageBucket: "demo-cleanup.appspot.com" }, "cleanup-test");
  db = getFirestore(admin);
  bucket = getStorage(admin).bucket();
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    await setDoc(doc(d, "users/bAdm"), { role: "admin", name: "Bea", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bSup"), { role: "supervisor", name: "Sid", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bOp"), { role: "operator", name: "Bo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/cAdm"), { role: "admin", name: "Cy", companyId: "charlie", tenantId: "charlie" });
    await setDoc(doc(d, "users/" + ALEX), { role: "admin", name: "Alex" });
  });
});
test.after(async () => { if (admin) await deleteApp(admin); if (env) await env.cleanup(); });

test("only that company's admin can record a download, and nobody edits it or the log", async () => {
  const rec = (uid, companyId) => ({ ...exportRecord({ companyId, uid, jobIds: ["j1"], days: 90, photos: false, counts: { jobs: 1 } }), createdAt: serverTimestamp() });
  await assertSucceeds(setDoc(doc(ctx("bAdm"), "cleanupExports/exportbAdm01"), rec("bAdm", "bravo")));
  await assertSucceeds(getDoc(doc(ctx("bAdm"), "cleanupExports/exportbAdm01")));
  await assertFails(getDoc(doc(ctx("cAdm"), "cleanupExports/exportbAdm01")));
  await assertFails(updateDoc(doc(ctx("bAdm"), "cleanupExports/exportbAdm01"), { used: false, jobIds: ["j1", "j9"] }));
  await assertFails(deleteDoc(doc(ctx("bAdm"), "cleanupExports/exportbAdm01")));
  await assertFails(setDoc(doc(ctx("bSup"), "cleanupExports/exportbSup01"), rec("bSup", "bravo")));
  await assertFails(setDoc(doc(ctx("bOp"), "cleanupExports/exportbOp001"), rec("bOp", "bravo")));
  await assertFails(setDoc(doc(ctx("bAdm"), "cleanupExports/exportbAdm02"), rec("bAdm", "charlie")));
  await assertFails(setDoc(doc(ctx("bAdm"), "cleanupExports/exportbAdm03"), rec("cAdm", "bravo")));
  await assertFails(setDoc(doc(ctx("bAdm"), "cleanupExports/exportbAdm04"), { ...rec("bAdm", "bravo"), used: true }));
  await assertFails(setDoc(doc(ctx("bAdm"), "cleanupExports/exportbAdm05"), { ...rec("bAdm", "bravo"), cutoffDays: 1 }));
  await assertFails(setDoc(doc(ctx(ALEX), "cleanupExports/exportAlex01"), rec(ALEX, "bravo")));
  await db.collection("jobCleanupLog").doc("logBravo").set({ companyId: "bravo", by: "bAdm", count: 1 });
  await assertSucceeds(getDoc(doc(ctx("bAdm"), "jobCleanupLog/logBravo")));
  for (const uid of ["bSup", "bOp", "cAdm", ALEX]) await assertFails(getDoc(doc(ctx(uid), "jobCleanupLog/logBravo")));
  await assertFails(setDoc(doc(ctx("bAdm"), "jobCleanupLog/forged"), { companyId: "bravo", by: "bAdm" }));
});

async function seed() {
  const recent = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
  const jobs = { j1: old("j1"), j2: old("j2", { status: "Cancelled" }), keepOpen: old("keepOpen", { status: "Scheduled" }),
    keepRecent: old("keepRecent", { date: recent }), charlieOld: old("charlieOld", { companyId: "charlie", tenantId: "charlie" }) };
  for (const [id, data] of Object.entries(jobs)) await db.collection("jobs").doc(id).set(data);
  await db.collection("jobs").doc("j1").collection("notes").doc("n1").set({ text: "sub note" });
  await db.doc("tenants/bravo/chats/job_j1/messages/m1").set({ text: "see you there", senderUid: "bOp" });
  await bucket.file("tenants/bravo/jobs/j1/photos/a.jpg").save(Buffer.from([1, 2, 3]), { contentType: "image/jpeg" });
  await bucket.file("tenants/bravo/jobs/j2/photos/b.jpg").save(Buffer.from([4, 5]), { contentType: "image/jpeg" });
  await bucket.file("tenants/bravo/jobs/keepOpen/photos/c.jpg").save(Buffer.from([6]), { contentType: "image/jpeg" });
  await db.collection("receipts").doc("r1").set({ uid: "bOp", companyId: "bravo", jobId: "j1", supplier: "Ampol", amountInc: 42, status: "queued" });
  await db.collection("timesheets").doc("bOp_2026-03-02").set({ uid: "bOp", companyId: "bravo", weekStart: "2026-03-02", entries: {
    e1: { date: "2026-03-02", job: "B-j1 spoil", start: "07:00", finish: "15:00" }, e2: { date: "2026-03-03", job: "B-other", start: "07:00", finish: "12:00" } } });
  await db.collection("timesheets").doc("bOp_2026-02-23").set({ uid: "bOp", companyId: "bravo", weekStart: "2026-02-23", sent: true,
    entries: { e3: { date: "2026-02-24", job: "B-j1", start: "07:00", finish: "15:00" } } });
}
async function download(uid, companyId, jobIds, id) {
  await db.collection("cleanupExports").doc(id).set({ ...exportRecord({ companyId, uid, jobIds, days: 90 }), createdAt: Timestamp.now() });
  return id;
}
const run = (uid, data) => runJobCleanup({ uid, data, db, bucket, FieldValue });
const exists = async p => (await db.doc(p).get()).exists;
const fileExists = async p => (await bucket.file(p).exists())[0];

test("cleanupOldJobs refuses anything unsafe and deletes nothing", async () => {
  await seed();
  const id = await download("bAdm", "bravo", ["j1", "j2"], "dlrefuse0001");
  const ok = { exportId: id, jobIds: ["j1", "j2"], typed: "DELETE 2 JOBS" };
  assert.equal((await run("bAdm", { ...ok, exportId: "nodownload01" })).reason, "download-first");
  assert.equal((await run("bAdm", { ...ok, typed: "delete" })).reason, "confirm-text");
  assert.equal((await run("bSup", ok)).reason, "admins-only");
  assert.equal((await run("bOp", ok)).reason, "admins-only");
  assert.equal((await run("cAdm", ok)).reason, "not-your-download");
  assert.equal((await run(ALEX, ok)).reason, "not-your-download");
  assert.equal((await run("bAdm", { ...ok, jobIds: ["j1", "j2", "keepOpen"], typed: "DELETE 3 JOBS" })).reason, "not-in-download");
  const open = await download("bAdm", "bravo", ["keepOpen", "keepRecent", "charlieOld"], "dlrefuse0002");
  const r = await run("bAdm", { exportId: open, jobIds: ["keepOpen", "keepRecent", "charlieOld"], typed: "DELETE 3 JOBS" });
  assert.equal(r.reason, "not-eligible");
  assert.deepEqual(r.blocked.map(b => b.id + ":" + b.why).sort(), ["charlieOld:other-company", "keepOpen:not-finished", "keepRecent:too-recent"]);
  assert.ok(r.blocked.some(b => b.id === "charlieOld" && b.why === "other-company"));
  const stale = await download("bAdm", "bravo", ["j1"], "dlrefuse0003");
  await db.collection("cleanupExports").doc(stale).update({ createdAt: Timestamp.fromMillis(Date.now() - 25 * 3600e3) });
  assert.equal((await run("bAdm", { exportId: stale, jobIds: ["j1"], typed: "DELETE 1 JOBS" })).reason, "download-too-old");
  for (const p of ["jobs/j1", "jobs/j2", "jobs/j1/notes/n1", "tenants/bravo/chats/job_j1/messages/m1"]) assert.equal(await exists(p), true, p);
  assert.equal(await fileExists("tenants/bravo/jobs/j1/photos/a.jpg"), true);
});

test("cleanupOldJobs deletes the jobs, their subcollections, job chat and photos, keeps receipts and timesheets, and logs it", async () => {
  const id = await download("bAdm", "bravo", ["j1", "j2"], "dlrun0000001");
  const r = await run("bAdm", { exportId: id, jobIds: ["j1", "j2"], typed: "delete 2 jobs" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.deleted, 2);
  assert.equal(r.photosDeleted, 2);
  for (const p of ["jobs/j1", "jobs/j2", "jobs/j1/notes/n1", "tenants/bravo/chats/job_j1/messages/m1"]) assert.equal(await exists(p), false, p);
  assert.equal(await fileExists("tenants/bravo/jobs/j1/photos/a.jpg"), false);
  assert.equal(await fileExists("tenants/bravo/jobs/keepOpen/photos/c.jpg"), true);
  for (const p of ["jobs/keepOpen", "jobs/keepRecent", "jobs/charlieOld", "receipts/r1", "timesheets/bOp_2026-03-02"]) assert.equal(await exists(p), true, p);
  const sheet = (await db.doc("timesheets/bOp_2026-03-02").get()).data();
  assert.deepEqual(Object.keys(sheet.entries).sort(), ["e1", "e2"]);
  const log = (await db.collection("jobCleanupLog").doc(r.logId).get()).data();
  assert.equal(log.by, "bAdm");
  assert.equal(log.companyId, "bravo");
  assert.deepEqual(log.jobIds.sort(), ["j1", "j2"]);
  assert.ok(log.at);
  assert.equal(log.includeTimesheets, false);
  assert.equal((await db.doc("cleanupExports/" + id).get()).data().used, true);
  // The same download cannot be used twice.
  assert.equal((await run("bAdm", { exportId: id, jobIds: ["j1", "j2"], typed: "DELETE 2 JOBS" })).reason, "download-already-used");
});

test("with the timesheet box ticked, only entries naming the deleted job go, and a sent sheet is kept", async () => {
  await db.collection("jobs").doc("j3").set(old("j3", { sm8JobNo: "B-j1" }));
  const id = await download("bAdm", "bravo", ["j3"], "dlrunts00001");
  const r = await run("bAdm", { exportId: id, jobIds: ["j3"], typed: "DELETE 1 JOBS", includeTimesheets: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.timesheetEntriesRemoved, 1);
  const sheet = (await db.doc("timesheets/bOp_2026-03-02").get()).data();
  assert.deepEqual(Object.keys(sheet.entries), ["e2"]);
  const sent = (await db.doc("timesheets/bOp_2026-02-23").get()).data();
  assert.deepEqual(Object.keys(sent.entries), ["e3"]);
});
