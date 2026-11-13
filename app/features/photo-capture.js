// Decide whether job photos still need the office email fallback.
// Storage is the primary copy. Email is only used when the cloud mirror
// did not store a file, or for incident photos (they are not mirrored).

export function decidePhotoEmail({ collection, mirror, fileCount } = {}) {
  if (collection && collection !== "jobs") {
    return { email: true, reason: "not-job-photos" };
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
