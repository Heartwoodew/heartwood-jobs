import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decidePhotoEmail, sniffFileKind } from "../../app/features/photo-capture.js";

test("successful job-photo mirror does not open the office email", () => {
  const decision = decidePhotoEmail({
    collection: "jobs",
    fileCount: 2,
    mirror: { ok: true, uploaded: [{ sourceIndex: 0 }, { sourceIndex: 1 }], skipped: [] },
  });
  assert.equal(decision.email, false);
  assert.equal(decision.reason, "stored");
  assert.equal(decision.storedCount, 2);
});

test("a failed or skipped mirror keeps the email fallback so photos are not lost", () => {
  assert.equal(decidePhotoEmail({ collection: "jobs", fileCount: 1, mirror: { ok: false, reason: "no-membership" } }).email, true);
  assert.equal(decidePhotoEmail({ collection: "jobs", fileCount: 1 }).reason, "mirror-failed");
  const partial = decidePhotoEmail({
    collection: "jobs",
    fileCount: 3,
    mirror: {
      ok: true,
      uploaded: [{ sourceIndex: 0 }, { sourceIndex: 1 }],
      skipped: [{ sourceIndex: 2, reason: "too-many-files" }],
    },
  });
  assert.equal(partial.email, true);
  assert.equal(partial.reason, "partial-mirror");
  assert.deepEqual(partial.fileIndexes, [2]);
  assert.equal(partial.storedCount, 2);
});

test("photos kept on the phone are not emailed", () => {
  const queued = decidePhotoEmail({
    collection: "jobs",
    fileCount: 2,
    mirror: { ok: false, reason: "queued", uploaded: [], skipped: [] },
  });
  assert.equal(queued.email, false);
  assert.equal(queued.reason, "queued");
});

test("incident photos still email because they are not mirrored to job storage", () => {
  const decision = decidePhotoEmail({
    collection: "incidents",
    fileCount: 2,
    mirror: { ok: true, uploaded: [{ sourceIndex: 0 }, { sourceIndex: 1 }], skipped: [] },
  });
  assert.equal(decision.email, true);
  assert.equal(decision.reason, "not-job-photos");
});

test("the app waits for the cloud mirror before offering email, and still stamps photosEmailedAt once", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.match(app, /decidePhotoEmail\(/);
  assert.match(app, /await afterPhotosPrepared\(/);
  assert.match(app, /await mirrorJobPhotos\(/);
  assert.match(app, /Photos saved to the job/);
  assert.match(app, /Photos saved \(\$\{n\}\) by/);
  assert.doesNotMatch(app, /if \(!o\.coll \|\| o\.coll === "jobs"\) mirrorJobPhotos\(j, files\)\.catch/);
  assert.equal(app.split("photosEmailedAt:").length - 1, 1);
  assert.match(app, /const jobPhotosIcon = \(\) => ""/);
});

test("job photo upload gives feedback and falls back fast with no signal (Patrick, 16 Nov)", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const mirror = app.slice(app.indexOf("async function mirrorJobPhotos"), app.indexOf("function galleryNow"));
  assert.match(mirror, /navigator\.onLine === false/);
  assert.match(mirror, /reason: "offline"/);
  assert.match(mirror, /uploadJobPhoto\(target, file, say\)/);
  assert.match(mirror, /failed\.push\(/, "one failed photo does not fail the whole batch");
  assert.doesNotMatch(mirror, /await ensurePhotoList/, "the gallery refresh does not hold up Photos saved");
  const upload = app.slice(app.indexOf("function uploadJobPhoto"), app.indexOf("function photoFailReason"));
  assert.match(upload, /uploadBytesResumable\(/);
  assert.match(upload, /upload-stalled/);
  assert.match(upload, /task\.cancel\(\)/);
  assert.match(app, /const PHOTO_STALL_MS = \d+/);
  assert.match(app, /Why: \$\{esc\(photoFailText\(o\.saveFail\)\)\}/);
});

test("image checks use the file header, and a pdf is recognised where certificates allow it", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const pdf = new TextEncoder().encode("%PDF-1.4");
  const text = new TextEncoder().encode("hello png");
  assert.equal(sniffFileKind(png), "image/png");
  assert.equal(sniffFileKind(jpeg), "image/jpeg");
  assert.equal(sniffFileKind(pdf), "application/pdf");
  assert.equal(sniffFileKind(text), "");
});
