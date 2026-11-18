// Offline queue, cache warm, and the "needs signal" gates.
// Manual airplane-mode checks (do these on a phone after the hosting deploy, not in CI):
// Android Chrome: install CallUp, open Today online, turn on airplane mode, kill Chrome,
//   open CallUp from the home screen. Today, the open job, notes, clock on/off and a photo
//   should work. The photo stays as a thumbnail. The chip says Offline. Turn airplane mode
//   off and leave the app open: the chip returns to Online and the photo leaves the pending list.
// iOS Safari: Share → Add to Home Screen, open once on Wi-Fi, then airplane mode, force-quit,
//   open the home-screen icon. Same checks. Background Sync is not on iOS; leaving the app
//   open after signal returns, or opening it again, sends the queue. Email job, billing and
//   invites stay disabled with "needs signal". You should not be asked to sign in again.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SAVED_ON_PHONE, deviceOnline, needsSignal, emailOutboxAllowed, jobsToWarm, warmReads,
  profileMiss, makeUpload, makeOutbox, classifyUploadError, flushUploads, noteWrite, clearWrite,
  pendingEntries, indicatorModel, memoryOfflineStore, actionForCall,
} from "../../app/features/offline.js";

const file = (name = "a.jpg") => ({ name, size: 12, type: "image/jpeg" });

test("a fast failure is not treated as offline, and a dead network is", () => {
  assert.equal(deviceOnline(true), true);
  assert.equal(deviceOnline(false), false);
  assert.equal(needsSignal("email-job", true).ok, true);
  assert.equal(needsSignal("email-job", false).ok, false);
  assert.match(needsSignal("email-job", false).message, /needs signal/i);
  assert.match(needsSignal("billing", false).message, /needs signal/i);
  assert.match(needsSignal("invite", false).message, /needs signal/i);
  assert.match(needsSignal("quote-price", false).message, /needs signal/i);
  assert.equal(actionForCall("sendJobEmail"), "email-job");
  assert.equal(emailOutboxAllowed(), false);
});

test("upcoming assigned jobs are the ones warmed, and office can warm the window", () => {
  const jobs = [
    { id: "a", date: "2026-11-18", assigned: ["crew"] },
    { id: "b", date: "2026-11-20", assigned: ["other"] },
    { id: "c", date: "2026-12-20", assigned: ["crew"] },
    { id: "d", date: "2026-11-19", assigned: ["crew"] },
  ];
  assert.deepEqual(jobsToWarm(jobs, { today: "2026-11-18", uid: "crew" }).map(j => j.id), ["a", "d"]);
  assert.deepEqual(jobsToWarm(jobs, { today: "2026-11-18", uid: "crew", office: true }).map(j => j.id), ["a", "b", "d"]);
  const reads = warmReads({ jobs: [{ id: "a" }], companyId: "acme", uid: "crew", swmsIds: ["mobile-plant"], today: "2026-11-18", days: 1 });
  assert.ok(reads.some(r => r.kind === "documents" && r.jobId === "a"));
  assert.ok(reads.some(r => r.kind === "run-sheet" && r.date === "2026-11-19"));
  assert.ok(reads.some(r => r.kind === "swms" && r.id === "mobile-plant"));
  assert.ok(reads.some(r => r.kind === "prestart-templates"));
});

test("a signed-in user with no cached profile is held, not signed out", () => {
  assert.equal(profileMiss({ online: false, cached: false }).action, "offline-hold");
  assert.equal(profileMiss({ online: false, cached: true }).action, "use");
  assert.equal(profileMiss({ online: true, cached: false }).action, "no-access");
});

test("files stay queued when the network fails and leave only after a real upload", async () => {
  const store = memoryOfflineStore();
  const built = makeUpload({ id: "p1", kind: "photo", uid: "u1", path: "tenants/acme/jobs/j/photos/p1", file: file(), label: "Site" });
  assert.equal(built.ok, true);
  assert.equal(built.row.path, "tenants/acme/jobs/j/photos/p1");
  await store.putFile(built.row);
  const held = await flushUploads(await store.listFiles("u1"), { online: false, upload: async () => { throw new Error("should not run"); } });
  assert.equal(held.uploaded.length, 0);
  assert.equal(held.kept.length, 1);
  let calls = 0;
  const failed = await flushUploads(held.kept, {
    online: true,
    upload: async () => { calls += 1; const err = new Error("no"); err.code = "storage/retry-limit-exceeded"; throw err; },
  });
  assert.equal(calls, 1);
  assert.equal(failed.kept.length, 1);
  assert.equal(failed.kept[0].hold, false);
  assert.equal(classifyUploadError({ code: "storage/unauthorized" }), "refused");
  const refused = await flushUploads(failed.kept, {
    online: true,
    upload: async () => { const err = new Error("no"); err.code = "storage/unauthorized"; throw err; },
  });
  assert.equal(refused.refused.length, 1);
  assert.equal(refused.refused[0].hold, true);
  await store.putFile(refused.refused[0]);
  assert.equal((await store.listFiles("u1")).length, 1, "a refused file is kept on the phone");
  const sent = await flushUploads([{ ...built.row }], { online: true, upload: async () => {} });
  assert.equal(sent.uploaded.length, 1);
});

test("the pending list counts writes, files and incident drafts", () => {
  let writes = noteWrite([], { id: "job-note:1", kind: "note", label: "Job note" });
  writes = noteWrite(writes, { id: "job-note:1", kind: "note", label: "Job note" });
  assert.equal(writes.length, 1);
  writes = clearWrite(writes, "job-note:1");
  assert.equal(writes.length, 0);
  const incident = makeOutbox({ id: "incq_1", uid: "u1", kind: "incident", label: "Incident report", payload: { what: "slip" } });
  assert.equal(incident.ok, true);
  const items = pendingEntries({
    writes: [{ id: "leave:1", kind: "leave", label: "Leave request" }],
    uploads: [{ id: "p1", kind: "photo", label: "Site", hold: false }],
    documents: [{ id: "d1", name: "Plan" }],
    outbox: [incident.row],
  });
  assert.equal(items.length, 4);
  assert.equal(indicatorModel({ online: false, pendingCount: 4 }).text, "Offline · 4 waiting to sync");
  assert.equal(indicatorModel({ online: true, pendingCount: 0 }).mode, "online");
  assert.equal(SAVED_ON_PHONE, "Saved on phone — will sync");
});

test("the shell is callup-shell-v133-desktop and installs before it drops the previous cache", () => {
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v133-desktop/);
  assert.match(sw, /features\/offline\.js/);
  assert.match(sw, /callup-uploads/);
  const install = sw.slice(sw.indexOf('addEventListener("install"'), sw.indexOf('addEventListener("activate"'));
  assert.ok(install.indexOf("addAll") < install.indexOf("skipWaiting"));
  assert.match(app, /persistentLocalCache\(\{ tabManager: persistentMultipleTabManager\(\) \}\)/);
  assert.match(app, /browserLocalPersistence/);
  assert.match(app, /SAVED_ON_PHONE/);
  assert.match(app, /warmUpcoming/);
  assert.doesNotMatch(app, /emailOutboxAllowed\(\) && deviceOnline\(\) === "queue"/);
});
