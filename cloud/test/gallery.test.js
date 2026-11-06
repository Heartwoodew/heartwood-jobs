import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planJobPhotoMirrors, resolveMembership, canReadObject } from "../../app/features/cloud-storage.js";
import { SCHEDULING_APPROVED, operationalExpiresAfter } from "../../app/features/cloud-retention.js";
import { buildOperationalExport } from "../../app/features/cloud-retention.js";
import { buildJobGallery, stampExpiresAfter, galleryExportPhotos, photoSlotHtml, galleryHtml } from "../../app/features/photo-gallery.js";

const staff = resolveMembership({ uid: "op1", profile: { role: "operator", name: "Sam" } });
const stranger = resolveMembership({ uid: "idle", profile: { role: "operator", name: "Idle" } });
const admin = resolveMembership({ uid: "1JKLsoxkQNfkphBBO0vDz2ziEyj2", profile: null });
const jpeg = { photoId: "pphoto001", name: "site.jpg", type: "image/jpeg", size: 1200 };

function photo(path, extra = {}) {
  return {
    path,
    contentType: "image/jpeg",
    size: 1200,
    timeCreated: "2026-08-06T01:00:00.000Z",
    customMetadata: { purpose: "job-photo", tenantId: "heartwood", jobId: "job1", uploaderUid: "op1", expiresAfter: "2099-01-01", batchCount: "1" },
    ...extra,
  };
}

test("viewing uses the job anchor and does not move expiresAfter", () => {
  assert.equal(SCHEDULING_APPROVED, false);
  const completed = {
    id: "job1", status: "Done", completedAt: "2026-08-06T00:00:00+10:00",
    client: "Orbit Homes (Qld) Pty Ltd", assigned: ["op1"], updatedAt: "2030-01-01T00:00:00.000Z",
  };
  const frozen = structuredClone(completed);
  const early = buildJobGallery({
    membership: staff, job: completed, now: new Date("2026-08-07T02:00:00.000Z"),
    listing: [photo("tenants/heartwood/jobs/job1/photos/psite")],
  });
  const later = buildJobGallery({
    membership: staff, job: completed, now: new Date("2026-12-01T02:00:00.000Z"),
    listing: [photo("tenants/heartwood/jobs/job1/photos/psite", { timeCreated: "2026-12-01T02:00:00.000Z" })],
  });
  assert.equal(early.expiresAfter, "2026-11-06");
  assert.equal(later.expiresAfter, "2026-11-06");
  assert.equal(later.schedulingApproved, false);
  assert.equal(later.deletionPerformed, false);
  assert.equal(later.photos.length, 1);
  assert.doesNotMatch(later.retentionText, /2099-01-01/);
  assert.match(later.retentionText, /2026-11-06/);
  assert.match(later.retentionText, /Deletion is not scheduled/);
  assert.match(later.retentionText, /Xero/);
  assert.deepEqual(completed, frozen);

  const open = {
    id: "job1", status: "Scheduled", date: "2026-01-02", photosEmailedAt: "2026-02-01T00:00:00.000Z",
    client: "Orbit Homes (Qld) Pty Ltd", assigned: ["op1"], updatedAt: "2026-11-06T00:00:00.000Z",
  };
  const viewed = operationalExpiresAfter(open, new Date("2026-11-06T02:00:00.000Z"));
  assert.equal(viewed.expiresAfter, "2026-05-01");
  assert.notEqual(viewed.expiresAfter, "2027-02-06");
  assert.equal(open.photosEmailedAt, "2026-02-01T00:00:00.000Z");
  const pinged = operationalExpiresAfter({ ...open, cloudPhotosAt: "2026-11-06T02:00:00.000Z" }, new Date("2026-11-06T02:00:00.000Z"));
  assert.equal(pinged.expiresAfter, "2026-05-01");
});

test("gallery lists persisted job photos and hides receipts", () => {
  const job = {
    id: "job1", status: "Scheduled", date: "2026-11-06",
    client: "Orbit Homes (Qld) Pty Ltd", assigned: ["op1"],
  };
  const listing = [
    photo("tenants/heartwood/jobs/job1/photos/pnew", { timeCreated: "2026-11-06T02:00:00.000Z", customMetadata: { purpose: "job-photo" } }),
    photo("tenants/heartwood/jobs/job1/photos/pold", { timeCreated: "2026-11-06T01:00:00.000Z", customMetadata: {} }),
    photo("tenants/heartwood/jobs/job1/photos/rsecret", { customMetadata: { purpose: "receipt", receiptId: "r1" } }),
    { path: "tenants/heartwood/receipts/r1/original", contentType: "image/jpeg", size: 80, customMetadata: { purpose: "receipt", receiptId: "r1" } },
    photo("tenants/heartwood/jobs/job1/photos/note.txt", { contentType: "text/plain" }),
    { path: "tenants/heartwood/jobs/job1/photos/punreadable", readable: false, contentType: "image/jpeg", size: 10 },
  ];
  const gallery = buildJobGallery({ membership: staff, job, listing, now: new Date("2026-11-06T12:00:00+10:00") });
  assert.equal(gallery.ok, true);
  assert.deepEqual(gallery.photos.map(p => p.name), ["pnew", "pold"]);
  assert.equal(gallery.expiresAfter, "2027-02-06");
  assert.ok(gallery.hidden.some(h => h.reason === "receipt-hidden"));
  assert.equal(buildJobGallery({ membership: stranger, job, listing }).reason, "not-allowed");
  const bytes = { [gallery.photos[0].path]: new Uint8Array([1, 2, 3]) };
  const packed = galleryExportPhotos(gallery, bytes, job);
  assert.equal(packed.length, 1);
  assert.equal(packed[0].path.includes("/receipts/"), false);
  const zip = buildOperationalExport({
    membership: admin, scope: "job", jobId: job.id, jobs: [job], photos: packed, now: new Date("2026-11-06T12:00:00+10:00"),
  });
  assert.equal(zip.ok, true);
  assert.equal(zip.manifest.xero, false);
  assert.equal(zip.manifest.schedulingApproved, false);
  assert.equal(zip.manifest.deletionPerformed, false);
  assert.equal(zip.manifest.retentionMonths, 3);
  assert.ok(zip.manifest.included.some(row => row.kind === "photo"));
  assert.ok(zip.manifest.excluded.some(row => row.kind === "xeroQueue"));
  assert.equal(canReadObject({
    membership: staff,
    path: "tenants/heartwood/receipts/r1/original",
    receipt: { id: "r1", uid: "op1" },
  }).reason, "receipt-hidden");
});

test("upload stamp follows completion or the email activity, not a later view", () => {
  const completed = {
    id: "job1", status: "Done", completedAt: "2026-08-06T00:00:00+10:00",
    client: "Orbit Homes (Qld) Pty Ltd", assigned: ["op1"],
  };
  const plan = planJobPhotoMirrors({ membership: staff, job: completed, files: [jpeg] });
  const frozen = structuredClone(completed);
  const stamped = stampExpiresAfter(plan, completed, new Date("2026-12-01T00:00:00.000Z"));
  assert.equal(stamped.uploads[0].metadata.expiresAfter, "2026-11-06");
  assert.equal(stamped.uploads[0].metadata.purpose, "job-photo");
  assert.equal(stamped.uploads[0].metadata.receiptId, undefined);
  assert.deepEqual(completed, frozen);

  const open = { id: "job1", status: "Scheduled", date: "2026-01-02", client: "Orbit Homes (Qld) Pty Ltd", assigned: ["op1"] };
  const openPlan = planJobPhotoMirrors({ membership: staff, job: open, files: [jpeg] });
  const openStamp = stampExpiresAfter(openPlan, open, new Date("2026-02-01T00:00:00.000Z"));
  assert.equal(openStamp.uploads[0].metadata.expiresAfter, "2026-05-01");
  assert.equal(open.photosEmailedAt, undefined);
});

test("the photos action is absent until a cloud photo exists", () => {
  assert.equal(photoSlotHtml({ jobId: "j2", status: "ready", count: 0, role: "action" }), "");
  assert.match(photoSlotHtml({ jobId: "j2", status: "ready", count: 2, role: "action" }), /Photos \(2\)/);
  assert.match(photoSlotHtml({ jobId: "j2", status: "loading", role: "status" }), /Checking photos/);
  assert.match(photoSlotHtml({ jobId: "j2", status: "error", role: "status" }), /Couldn't load photos/);
  const html = galleryHtml({
    status: "ready", title: "Photos", retentionText: "Operational cloud copy expires 2027-02-06. Deletion is not scheduled.",
    photos: [{ path: "tenants/heartwood/jobs/j2/photos/psite", src: "blob:photo" }], canDownload: false,
  });
  assert.match(html, /data-photo-path="tenants\/heartwood\/jobs\/j2\/photos\/psite"/);
  assert.match(html, /does not change that date/);
  assert.doesNotMatch(html, /data-cloudexport/);
  assert.match(galleryHtml({ status: "empty", photos: [], retentionText: "Operational cloud copy expires 2027-02-06." }).replace("empty", ""), /No cloud photos/);
  assert.match(galleryHtml({ status: "error", error: "Couldn't load photos.", jobId: "j2" }), /data-photoretry="j2"/);
});

test("gallery code does not schedule deletion or rewrite retention anchors", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const gallery = readFileSync(new URL("../../app/features/photo-gallery.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../emulator/storage.rules", import.meta.url), "utf8");
  const prod = readFileSync(new URL("../production/storage.rules", import.meta.url));
  const emu = readFileSync(new URL("../emulator/storage.rules", import.meta.url));
  const life = readFileSync(new URL("../emulator/PROPOSED_storage_lifecycle.json", import.meta.url), "utf8");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const prodJson = JSON.parse(readFileSync(new URL("../production/firebase.json", import.meta.url), "utf8"));
  assert.equal(prod.equals(emu), true);
  assert.match(rules, /match \/tenants\/\{tenantId\}\/jobs\/\{jobId\}\/photos \{/);
  assert.match(rules, /allow list: if canSeeJob/);
  assert.match(rules, /allow delete: if false/);
  assert.doesNotMatch(rules, /match \/tenants\/\{tenantId\}\/receipts\/\{receiptId\} \{\s*allow list/);
  assert.match(life, /PROPOSED ONLY/);
  assert.match(life, /_expired\//);
  assert.doesNotMatch(index, /onSchedule/);
  assert.equal(prodJson.firestore, undefined);
  assert.doesNotMatch(app, /updateMetadata|deleteObject/);
  assert.equal(app.split("photosEmailedAt:").length - 1, 1);
  const openFn = app.slice(app.indexOf("async function openPhotoGallery"), app.indexOf("function closePhotoGallery"));
  assert.doesNotMatch(openFn, /updateDoc|cloudPhotosAt|photosEmailedAt/);
  const mirror = app.slice(app.indexOf("async function mirrorJobPhotos"), app.indexOf("function galleryNow"));
  assert.match(mirror, /cloudPhotosAt/);
  assert.match(app, /stampExpiresAfter\(/);
  assert.match(app, /buildJobGallery\(/);
  assert.doesNotMatch(gallery, /updateDoc|setDoc|uploadBytes|deleteObject|SCHEDULING_APPROVED = true/);
  assert.match(readFileSync(new URL("../../app/features/cloud-retention.js", import.meta.url), "utf8"), /export const SCHEDULING_APPROVED = false/);
});
