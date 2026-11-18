// Budget and JPEG ladder for job email. Sharp is only used for the encode test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PHOTO_BUDGET_BYTES } from "../functions/shared/job-email.js";
import { missingObjectNote } from "../../app/features/job-email.js";
import {
  ENCODED_ATTACHMENT_BUDGET,
  JPEG_LONG_EDGES,
  JPEG_QUALITIES,
  RECEIPT_MIN_LONG_EDGE,
  RESEND_ENCODED_MARGIN_BYTES,
  RESEND_MAX_EMAIL_BYTES,
  base64Length,
  compressionLadder,
  effectiveRawBudget,
  encodeJobJpeg,
  fitsAttachmentBudget,
  maxRawFittingEncoded,
  planJobEmailAttachments,
} from "../functions/job-email-compress.js";

const MB = 1024 * 1024;

function photo(name, size) {
  return { kind: "photo", name, size, path: `photos/${name}` };
}

function receipt(name, size) {
  return { kind: "dump-receipt", name, size, path: `receipts/${name}` };
}

test("the 20MB raw budget stays inside Resend's 40MB encoded limit", () => {
  assert.equal(RESEND_MAX_EMAIL_BYTES, 40 * MB);
  assert.equal(ENCODED_ATTACHMENT_BUDGET, RESEND_MAX_EMAIL_BYTES - RESEND_ENCODED_MARGIN_BYTES);
  assert.ok(RESEND_ENCODED_MARGIN_BYTES >= 8 * MB);
  const encoded = base64Length(PHOTO_BUDGET_BYTES);
  assert.ok(encoded > 26 * MB);
  assert.ok(encoded < ENCODED_ATTACHMENT_BUDGET);
  assert.ok(ENCODED_ATTACHMENT_BUDGET < RESEND_MAX_EMAIL_BYTES);
  assert.equal(effectiveRawBudget(PHOTO_BUDGET_BYTES), PHOTO_BUDGET_BYTES);
  assert.equal(effectiveRawBudget(100 * MB), PHOTO_BUDGET_BYTES);
  assert.ok(base64Length(maxRawFittingEncoded()) <= ENCODED_ATTACHMENT_BUDGET);
  assert.equal(fitsAttachmentBudget([PHOTO_BUDGET_BYTES]), true);
  assert.equal(fitsAttachmentBudget([10 * MB, 10 * MB]), true);
  assert.equal(fitsAttachmentBudget([PHOTO_BUDGET_BYTES + 1]), false);
});

test("receipts and photos that fit are left untouched", async () => {
  const calls = [];
  const plan = await planJobEmailAttachments({
    budget: PHOTO_BUDGET_BYTES,
    receipts: [receipt("Remondis tip docket", 2 * MB)],
    photos: [photo("a.jpg", 9 * MB), photo("b.jpg", 8 * MB)],
    sizeAt: (item, step) => {
      calls.push([item.name, step]);
      throw new Error("should not encode");
    },
  });
  assert.equal(plan.outcome, "untouched");
  assert.equal(plan.linked.length, 0);
  assert.equal(plan.compressed, 0);
  assert.equal(plan.compressedReceipts, 0);
  assert.ok(plan.receipts.every(item => item.action === "original"));
  assert.ok(plan.photos.every(item => item.action === "original"));
  assert.equal(calls.length, 0);
});

test("a set that is only a little over the budget takes the mildest JPEG step", async () => {
  const calls = [];
  const plan = await planJobEmailAttachments({
    budget: 20 * MB,
    receipts: [receipt("Remondis tip docket", 1 * MB)],
    photos: [photo("small.jpg", 2 * MB), photo("wide.jpg", 18 * MB)],
    sizeAt: (item, step) => {
      calls.push(item.name);
      if (item.kind === "dump-receipt") throw new Error("receipt was encoded");
      if (step.longEdge == null && step.quality === 85) return 16 * MB;
      return 4 * MB;
    },
  });
  assert.equal(plan.outcome, "compress");
  assert.equal(plan.linked.length, 0);
  assert.equal(plan.compressed, 1);
  assert.equal(plan.receipts[0].action, "original");
  assert.equal(plan.photos[0].action, "original");
  assert.equal(plan.photos[0].name, "small.jpg");
  assert.equal(plan.photos[1].action, "compress");
  assert.equal(plan.photos[1].longEdge, null);
  assert.equal(plan.photos[1].quality, 85);
  assert.deepEqual(calls, ["wide.jpg"]);
});

test("a set that still does not fit keeps stepping down to 1280px quality 60", async () => {
  const seen = [];
  const plan = await planJobEmailAttachments({
    budget: 20 * MB,
    photos: [photo("huge.jpg", 30 * MB)],
    sizeAt: (_item, step) => {
      seen.push(step);
      return step.longEdge === 1280 && step.quality === 60 ? 10 * MB : 22 * MB;
    },
  });
  assert.equal(plan.outcome, "compress");
  assert.equal(plan.linked.length, 0);
  assert.equal(plan.compressed, 1);
  assert.equal(plan.photos[0].action, "compress");
  assert.equal(plan.photos[0].longEdge, 1280);
  assert.equal(plan.photos[0].quality, 60);
  assert.deepEqual(seen[0], { longEdge: null, quality: 85 });
  assert.deepEqual(seen.at(-1), { longEdge: 1280, quality: 60 });
  assert.equal(seen.length, compressionLadder().length);
});

test("a photo that cannot fit at 1280px quality 60 is linked", async () => {
  const seen = [];
  const plan = await planJobEmailAttachments({
    budget: 20 * MB,
    photos: [photo("huge.jpg", 30 * MB)],
    sizeAt: (_item, step) => {
      seen.push(step);
      return 25 * MB;
    },
  });
  assert.equal(plan.outcome, "links");
  assert.equal(plan.photos.length, 0);
  assert.equal(plan.linked.length, 1);
  assert.equal(plan.linked[0].name, "huge.jpg");
  assert.equal(plan.compressed, 0);
  const ladder = compressionLadder();
  assert.deepEqual(seen[0], { longEdge: null, quality: 85 });
  assert.deepEqual(seen.at(-1), ladder.at(-1));
  assert.deepEqual(ladder.at(-1), { longEdge: 1280, quality: 60 });
  assert.deepEqual(JPEG_QUALITIES, [85, 80, 70, 60]);
  assert.deepEqual(JPEG_LONG_EDGES, [null, 2560, 2048, 1600, 1280]);
});

test("receipts alone over the budget are compressed, and not below 1600px", async () => {
  const seen = [];
  const plan = await planJobEmailAttachments({
    budget: 20 * MB,
    receipts: [receipt("Remondis tip docket", 22 * MB)],
    photos: [photo("site.jpg", 2 * MB)],
    sizeAt: (item, step) => {
      seen.push([item.kind, step.longEdge, step.quality]);
      if (item.kind !== "dump-receipt") return item.size;
      if (step.longEdge === 1280) throw new Error("receipt long edge went below 1600");
      if (step.longEdge === 1600 && step.quality <= 80) return 12 * MB;
      return 21 * MB;
    },
  });
  assert.equal(plan.outcome, "receipts-compressed");
  assert.equal(plan.linked.length, 0);
  assert.equal(plan.compressedReceipts, 1);
  assert.equal(plan.receipts[0].action, "compress");
  assert.equal(plan.receipts[0].longEdge, 1600);
  assert.equal(plan.receipts[0].quality, 80);
  assert.ok(plan.receipts[0].longEdge >= RECEIPT_MIN_LONG_EDGE);
  assert.equal(plan.photos[0].action, "original");
  assert.equal(plan.compressed, 0);
  assert.equal(seen.some(row => row[1] === 1280), false);
  const receiptLadder = compressionLadder({ minLongEdge: RECEIPT_MIN_LONG_EDGE });
  assert.equal(receiptLadder.some(step => step.longEdge === 1280), false);
  assert.deepEqual(receiptLadder.at(-1), { longEdge: 1600, quality: 60 });
});

test("a missing stored photo is named without a storage path", () => {
  const note = missingObjectNote({
    photos: ["Gone.jpg"],
    receipts: ["Remondis tip docket"],
  });
  assert.match(note, /missing in CallUp/);
  assert.match(note, /Gone\.jpg/);
  assert.match(note, /Remondis tip docket/);
  assert.match(note, /Photos:/);
  assert.match(note, /Dump receipts:/);
  assert.doesNotMatch(note, /tenants\/|firebasestorage|token=|X-Goog-/);
  assert.equal(missingObjectNote({ photos: [], receipts: [] }), "");
  const fn = readFileSync(new URL("../functions/shared/job-email.js", import.meta.url));
  const web = readFileSync(new URL("../../app/features/job-email.js", import.meta.url));
  assert.equal(fn.equals(web), true);
});

test("encode applies EXIF orientation, strips it, and caps the long edge", async () => {
  const sharp = createRequire(new URL("../functions/package.json", import.meta.url))("sharp");
  const width = 64;
  const height = 32;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i += 3) {
    raw[i] = i % 251;
    raw[i + 1] = (i * 3) % 251;
    raw[i + 2] = (i * 7) % 251;
  }
  const input = await sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const before = await sharp(input).metadata();
  assert.equal(before.orientation, 6);
  assert.equal(before.width, width);
  assert.equal(before.height, height);

  const turned = await encodeJobJpeg(input, { longEdge: null, quality: 80 });
  const after = await sharp(turned).metadata();
  assert.equal(after.format, "jpeg");
  assert.equal(after.width, height);
  assert.equal(after.height, width);
  assert.ok(after.orientation == null || after.orientation === 1);
  assert.equal(after.exif, undefined);

  const scaled = await encodeJobJpeg(input, { longEdge: 20, quality: 60 });
  const fit = await sharp(scaled).metadata();
  assert.ok(Math.max(fit.width, fit.height) <= 20);
  assert.ok(Math.max(fit.width, fit.height) >= 8);
});
