// Decide whether job photos still need the office email fallback.
// Storage is the primary copy. Email is only used when the cloud mirror
// did not store a file, or for incident photos (they are not mirrored).

// First bytes of a file. A renamed extension is not enough.
export function sniffFileKind(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  return "";
}

export async function readFileKind(file) {
  if (!file) return "";
  try {
    const blob = typeof file.slice === "function" ? file.slice(0, 16) : file;
    const buf = typeof blob.arrayBuffer === "function" ? await blob.arrayBuffer() : null;
    return buf ? sniffFileKind(new Uint8Array(buf)) : "";
  } catch {
    return "";
  }
}

export function decidePhotoEmail({ collection, mirror, fileCount } = {}) {
  if (collection && collection !== "jobs") {
    return { email: true, reason: "not-job-photos" };
  }
  // Queued files stay on the phone and upload later. They are not emailed.
  if (mirror && mirror.reason === "queued") {
    return { email: false, reason: "queued", storedCount: 0 };
  }
  if (!mirror || mirror.ok !== true) {
    return { email: true, reason: (mirror && mirror.reason) || "mirror-failed" };
  }
  const skipped = Array.isArray(mirror.skipped) ? mirror.skipped : [];
  const uploaded = Array.isArray(mirror.uploaded) ? mirror.uploaded : [];
  const n = Number(fileCount) || 0;
  const emailIndexes = [...new Set(skipped
    .map(s => s && s.sourceIndex)
    .filter(i => Number.isInteger(i) && i >= 0 && i < n))];
  if (emailIndexes.length) {
    return { email: true, reason: "partial-mirror", fileIndexes: emailIndexes, storedCount: uploaded.length };
  }
  if (!uploaded.length) {
    return { email: true, reason: "mirror-empty" };
  }
  return { email: false, reason: "stored", storedCount: uploaded.length };
}
