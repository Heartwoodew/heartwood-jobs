// Fit job-email attachments under the raw byte budget without holding every
// photo in memory. Resend rejects an email larger than 40MB after Base64
// encoding (https://resend.com/docs/dashboard/emails/attachments). Base64
// expands raw bytes by 4/3, so the 20MB raw budget encodes to about 26.7MB.
// An 8MB margin under the 40MB cap leaves room for the JSON envelope and the
// job text. Originals are sent unchanged when they fit. Otherwise each photo
// is re-encoded only as far as it needs to go.
import { PHOTO_BUDGET_BYTES } from "./shared/job-email.js";

export const RESEND_MAX_EMAIL_BYTES = 40 * 1024 * 1024;
export const RESEND_ENCODED_MARGIN_BYTES = 8 * 1024 * 1024;
export const ENCODED_ATTACHMENT_BUDGET = RESEND_MAX_EMAIL_BYTES - RESEND_ENCODED_MARGIN_BYTES;

// Mildest first. Quality drops before the long edge, so a photo keeps its
// pixels when a slightly stronger JPEG is enough. 1280px at quality 60 is the
// last step that still gets attached. Past that, the photo is named as a link.
export const JPEG_QUALITIES = [85, 80, 70, 60];
export const JPEG_LONG_EDGES = [null, 2560, 2048, 1600, 1280];
// Tip dockets stay legible. Never shrink the long edge below this.
export const RECEIPT_MIN_LONG_EDGE = 1600;

let sharpLib = null;

export function base64Length(rawBytes) {
  const n = Math.max(0, Math.floor(Number(rawBytes) || 0));
  return Math.ceil(n / 3) * 4;
}

/** Largest raw size whose Base64 form fits in the encoded attachment budget. */
export function maxRawFittingEncoded(encodedBudget = ENCODED_ATTACHMENT_BUDGET) {
  const budget = Math.max(0, Math.floor(Number(encodedBudget) || 0));
  return Math.floor(budget / 4) * 3;
}

/**
 * Raw byte cap for one email. Never above the 20MB product budget, and never
 * above the raw size that still Base64-encodes inside the Resend margin.
 */
export function effectiveRawBudget(requested, fallback = PHOTO_BUDGET_BYTES) {
  const asked = Number(requested) > 0 ? Math.floor(Number(requested)) : fallback;
  return Math.min(Math.max(0, asked), fallback, maxRawFittingEncoded());
}

/** True when these raw sizes fit the raw budget and the encoded Resend margin. */
export function fitsAttachmentBudget(rawSizes, rawBudget = PHOTO_BUDGET_BYTES) {
  const sizes = [];
  for (const value of rawSizes || []) {
    const n = Number(value && typeof value === "object" ? value.size : value);
    if (!Number.isFinite(n) || n < 0) return false;
    sizes.push(n);
  }
  const limit = effectiveRawBudget(rawBudget);
  const raw = sizes.reduce((sum, n) => sum + n, 0);
  if (raw > limit) return false;
  const encoded = sizes.reduce((sum, n) => sum + base64Length(n), 0);
  return encoded <= ENCODED_ATTACHMENT_BUDGET;
}

export function compressionLadder({ minLongEdge = 0 } = {}) {
  const floor = Number(minLongEdge) || 0;
  const steps = [];
  for (const longEdge of JPEG_LONG_EDGES) {
    if (longEdge != null && floor && longEdge < floor) continue;
    for (const quality of JPEG_QUALITIES) steps.push({ longEdge, quality });
  }
  return steps;
}

/**
 * Split `remaining` bytes across files. A file already smaller than an equal
 * share of what is left keeps its original size. The rest share the leftover,
 * which is that file's compression target.
 */
export function photoTargets(sizes, remaining) {
  const pending = (sizes || []).map((size, index) => ({
    index,
    size: Math.max(0, Math.floor(Number(size) || 0)),
  }));
  const targets = pending.map(item => ({ index: item.index, target: 0, action: "compress" }));
  let left = Math.max(0, Math.floor(Number(remaining) || 0));
  let open = pending.slice();
  let guard = 0;
  while (open.length && guard++ <= pending.length + 1) {
    if (left <= 0) {
      for (const item of open) targets[item.index] = { index: item.index, target: 0, action: "compress" };
      break;
    }
    const share = Math.floor(left / open.length);
    const still = [];
    let moved = false;
    for (const item of open) {
      if (item.size <= share) {
        targets[item.index] = { index: item.index, target: item.size, action: "original" };
        left -= item.size;
        moved = true;
      } else still.push(item);
    }
    if (!moved) {
      const extra = left - share * still.length;
      still.forEach((item, i) => {
        const target = share + (i === still.length - 1 ? extra : 0);
        targets[item.index] = { index: item.index, target, action: item.size <= target ? "original" : "compress" };
      });
      break;
    }
    open = still;
  }
  return targets;
}

function sumSizes(items) {
  return (items || []).reduce((sum, item) => sum + (Number(item && item.size) || 0), 0);
}

function markOriginal(item) {
  return { ...item, action: "original", bytes: Number(item.size) || 0, longEdge: null, quality: null };
}

async function measuredSize(measure, item, step) {
  if (typeof measure !== "function") return false;
  const n = await measure(item, step);
  if (n === false) return false;
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

/**
 * Smallest ladder step whose encoded size fits `allowance` and is smaller
 * than the original. `measure` returns a byte size, null to skip one step,
 * or false when the file cannot be re-encoded at all.
 */
export async function pickCompressionStep(item, allowance, measure, { minLongEdge = 0 } = {}) {
  const size = Number(item && item.size) || 0;
  const room = Math.max(0, Math.floor(Number(allowance) || 0));
  if (size > 0 && size <= room) return markOriginal(item);
  const ladder = compressionLadder({ minLongEdge });
  let encoded = false;
  let floor = null;
  for (const step of ladder) {
    const n = await measuredSize(measure, item, step);
    if (n === false) return { ...item, action: "incompressible", bytes: size, longEdge: null, quality: null };
    if (n == null) continue;
    encoded = true;
    floor = n;
    if (n <= room && n < size) {
      return { ...item, action: "compress", bytes: n, longEdge: step.longEdge, quality: step.quality };
    }
  }
  const last = ladder[ladder.length - 1] || { longEdge: null, quality: null };
  if (!encoded) return { ...item, action: "incompressible", bytes: size, longEdge: null, quality: null };
  return { ...item, action: "link", bytes: floor == null ? size : floor, longEdge: last.longEdge, quality: last.quality };
}

async function packOriginals(items, room, onDecided) {
  const kept = [];
  const linked = [];
  let used = 0;
  const limit = Math.max(0, Math.floor(Number(room) || 0));
  for (const item of items || []) {
    const size = Number(item && item.size) || 0;
    const row = size > 0 && used + size <= limit
      ? markOriginal(item)
      : { ...item, action: "link", bytes: size, longEdge: null, quality: null };
    if (row.action === "link") linked.push(row);
    else {
      kept.push(row);
      used += size;
    }
    if (typeof onDecided === "function") await onDecided(item, row);
  }
  return { kept, linked, bytes: used };
}

async function fitGroup(items, room, { minLongEdge = 0, measure, allowCompress = false, onDecided } = {}) {
  const list = items || [];
  const limit = Math.max(0, Math.floor(Number(room) || 0));
  if (!allowCompress || sumSizes(list) <= limit) return packOriginals(list, limit, onDecided);

  const targets = photoTargets(list.map(item => Number(item && item.size) || 0), limit);
  const order = list.map((item, index) => ({ item, index, target: targets[index].target }))
    .sort((a, b) => (Number(a.item.size) || 0) - (Number(b.item.size) || 0) || a.index - b.index);
  const chosen = new Array(list.length);
  const deferred = [];
  let carry = 0;
  for (const row of order) {
    const allowance = row.target + carry;
    const picked = await pickCompressionStep(row.item, allowance, measure, { minLongEdge });
    if (picked.action === "incompressible") {
      deferred.push(row.index);
      carry = allowance;
      continue;
    }
    chosen[row.index] = picked;
    if (picked.action === "link") carry = allowance;
    else carry = Math.max(0, allowance - picked.bytes);
    if (typeof onDecided === "function") await onDecided(row.item, picked);
  }

  let used = 0;
  for (const row of chosen) if (row && row.action !== "link") used += row.bytes;
  let left = Math.max(0, limit - used);
  for (const index of deferred.slice().sort((a, b) => a - b)) {
    const item = list[index];
    const size = Number(item && item.size) || 0;
    const row = size > 0 && size <= left
      ? markOriginal(item)
      : { ...item, action: "link", bytes: size, longEdge: null, quality: null };
    chosen[index] = row;
    if (row.action !== "link") left -= size;
    if (typeof onDecided === "function") await onDecided(item, row);
  }

  const kept = [];
  const linked = [];
  let bytes = 0;
  for (let i = 0; i < list.length; i++) {
    const row = chosen[i] || { ...list[i], action: "link", bytes: Number(list[i] && list[i].size) || 0 };
    if (row.action === "link") linked.push(row);
    else {
      kept.push(row);
      bytes += row.bytes;
    }
  }
  return { kept, linked, bytes };
}

function outcomeOf(receipts, photos, linked) {
  if (linked.length) return "links";
  if (receipts.some(item => item.action === "compress")) return "receipts-compressed";
  if (photos.some(item => item.action === "compress")) return "compress";
  return "untouched";
}

/**
 * Decide originals, the mildest JPEG step, or a link.
 * `sizeAt(item, step)` is only called for a file that does not already fit
 * its share. Receipts are packed first and are re-encoded only when they
 * alone exceed the budget, never below RECEIPT_MIN_LONG_EDGE.
 * `onDecided(item, decision)` runs as soon as that file's action is final,
 * so the caller can keep one output and free the original before the next file.
 */
export async function planJobEmailAttachments({ receipts = [], photos = [], budget, sizeAt, onDecided } = {}) {
  const limit = effectiveRawBudget(budget);
  const receiptList = (receipts || []).filter(item => Number(item && item.size) > 0);
  const photoList = (photos || []).filter(item => Number(item && item.size) > 0);
  const sizes = receiptList.concat(photoList).map(item => Number(item.size) || 0);
  if (fitsAttachmentBudget(sizes, limit)) {
    const keptReceipts = receiptList.map(markOriginal);
    const keptPhotos = photoList.map(markOriginal);
    return {
      outcome: "untouched",
      receipts: keptReceipts,
      photos: keptPhotos,
      linked: [],
      compressed: 0,
      compressedReceipts: 0,
      bytes: sizes.reduce((sum, n) => sum + n, 0),
      budget: limit,
    };
  }

  const receiptBytes = sumSizes(receiptList);
  const receiptPlan = await fitGroup(receiptList, limit, {
    minLongEdge: RECEIPT_MIN_LONG_EDGE,
    measure: sizeAt,
    allowCompress: receiptBytes > limit,
    onDecided,
  });
  const photoPlan = await fitGroup(photoList, Math.max(0, limit - receiptPlan.bytes), {
    minLongEdge: 0,
    measure: sizeAt,
    allowCompress: true,
    onDecided,
  });
  const linked = receiptPlan.linked.concat(photoPlan.linked);
  return {
    outcome: outcomeOf(receiptPlan.kept, photoPlan.kept, linked),
    receipts: receiptPlan.kept,
    photos: photoPlan.kept,
    linked,
    compressed: photoPlan.kept.filter(item => item.action === "compress").length,
    compressedReceipts: receiptPlan.kept.filter(item => item.action === "compress").length,
    bytes: receiptPlan.bytes + photoPlan.bytes,
    budget: limit,
  };
}

async function loadSharp() {
  if (sharpLib) return sharpLib;
  const mod = await import("sharp");
  sharpLib = mod.default;
  // One photo at a time, and no libvips decode cache, so a 1GiB instance
  // does not keep every original it has already finished.
  sharpLib.cache(false);
  sharpLib.concurrency(1);
  return sharpLib;
}

/**
 * Re-encode one image as a JPEG. EXIF orientation is applied first, then every
 * other metadata block is left out. `longEdge` null keeps the original pixels.
 */
export async function encodeJobJpeg(bytes, { longEdge = null, quality = 85 } = {}) {
  const sharp = await loadSharp();
  const image = sharp(bytes, {
    failOn: "none",
    sequentialRead: true,
    limitInputPixels: 60_000_000,
    animated: false,
  });
  try {
    let pipeline = image.rotate();
    if (longEdge) {
      pipeline = pipeline.resize({
        width: longEdge,
        height: longEdge,
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    return await pipeline.jpeg({ quality, mozjpeg: false, chromaSubsampling: "4:2:0" }).toBuffer();
  } finally {
    image.destroy();
  }
}
