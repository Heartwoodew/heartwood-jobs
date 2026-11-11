import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planJobPhotoMirrors, planStaffReceiptCapture, stubReceiptStorageDecision, resolveMembership } from "../../app/features/cloud-storage.js";

const job = { id: "job1", client: "Orbit Homes (Qld) Pty Ltd", assigned: ["op1"] };
const staff = resolveMembership({ uid: "op1", profile: { role: "operator", name: "Sam" } });
const jpeg = (photoId, name = "site.jpg") => ({ photoId, name, type: "image/jpeg", size: 1200 });

test("multiple job photos upload the accepted files and skip a bad one", () => {
  const files = [jpeg("pphoto001", "a.jpg"), { photoId: "pphoto002", name: "note.txt", type: "text/plain", size: 20 }, jpeg("pphoto003", "b.jpg")];
  const plan = planJobPhotoMirrors({ membership: staff, job, files });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.uploads.map(u => u.sourceIndex), [0, 2]);
  assert.equal(plan.skipped[0].reason, "mime-not-allowed");
  assert.equal(plan.uploads[0].path, "tenants/heartwood/jobs/job1/photos/pphoto001");
  const many = Array.from({ length: 12 }, (_, i) => jpeg("p" + i, "n" + i + ".jpg"));
  const capped = planJobPhotoMirrors({ membership: staff, job, files: many });
  assert.equal(capped.uploads.length, 10);
  assert.ok(capped.skipped.every(s => s.reason === "too-many-files"));
});

test("staff receipt storage is allowed only after the job-matched doc is written", () => {
  const path = "tenants/heartwood/receipts/r1/original";
  const metadata = { purpose: "receipt", receiptId: "r1", uploaderUid: "op1", tenantId: "heartwood" };
  assert.equal(stubReceiptStorageDecision({ receiptDoc: null, authUid: "op1", path, metadata, job }).reason, "receipt-not-written");
  const wrongJob = stubReceiptStorageDecision({
    receiptDoc: { id: "r1", uid: "op1", jobId: "other-job", status: "queued" },
    authUid: "op1", path, metadata, job,
  });
  assert.equal(wrongJob.reason, "job-mismatch");
  const written = { id: "r1", uid: "op1", jobId: "job1", status: "queued" };
  assert.equal(stubReceiptStorageDecision({ receiptDoc: written, authUid: "op1", path, metadata, job }).ok, true);
  assert.equal(stubReceiptStorageDecision({ receiptDoc: written, authUid: "someone", path, metadata, job }).reason, "not-allowed");
  const before = planStaffReceiptCapture({ membership: staff, job, receiptId: "r1", file: { type: "image/jpeg", size: 500 } });
  assert.equal(before.reason, "receipt-not-written");
  const after = planStaffReceiptCapture({
    membership: staff, job, receiptId: "r1", receiptDoc: written, file: { type: "image/jpeg", size: 500 },
  });
  assert.deepEqual(after.order, ["receiptChunks", "receiptDoc", "storage"]);
  assert.equal(after.receiptDocFirst, true);
  assert.equal(after.receipt.jobId, "job1");
  assert.equal(after.storage.path, path);
  assert.equal(after.storage.metadata.purpose, "receipt");
});

test("the live capture handlers call the storage feature after the receipt doc", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const cfg = readFileSync(new URL("../../app/firebase-config.js", import.meta.url), "utf8");
  assert.match(cfg, /photosEnabled = false/);
  assert.match(cfg, /heartwood-9f37f\.firebasestorage\.app/);
  assert.match(app, /planJobPhotoMirrors\(/);
  assert.match(app, /planStaffReceiptCapture\(/);
  assert.match(app, /mirrorJobPhotos\(j, files\)/);
  const submit = app.slice(app.indexOf("f.onsubmit = async"), app.indexOf("function wireJobReceipts"));
  assert.ok(submit.indexOf("await setDoc(ref,") < submit.indexOf("mirrorReceipt("), "receipt doc is written before storage");
  assert.match(submit, /receiptChunks/);
  assert.match(submit, /status: "queued"/);
  assert.match(app, /inp\.multiple = true/);
});

test("putPlanned hands each upload the picked file it was planned for (not undefined)", async () => {
  const { putPlanned } = await import("../../app/features/cloud-storage.js");
  const { stampExpiresAfter } = await import("../../app/features/photo-gallery.js");
  const picked = [{ bytes: "A" }, { bytes: "note" }, { bytes: "B" }];
  const files = [jpeg("pphoto011", "a.jpg"), { photoId: "pphoto012", name: "note.txt", type: "text/plain", size: 20 }, jpeg("pphoto013", "b.jpg")];
  let plan = planJobPhotoMirrors({ membership: staff, job, files });
  plan = stampExpiresAfter(plan, { ...job, status: "Scheduled" }, new Date("2026-11-11T02:00:00Z"));
  const sent = await putPlanned(plan, target => ({ path: target.path, body: picked[target.sourceIndex] }));
  assert.deepEqual(sent.map(s => s.body && s.body.bytes), ["A", "B"]);
  assert.deepEqual(sent.map(s => s.path.split("/").pop()), ["pphoto011", "pphoto013"]);
  // The app refuses to upload a missing file instead of sending the string "undefined".
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.match(app, /photo-file-missing/);
});
