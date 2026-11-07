// In-app gallery for job photos already stored under the job photo prefix.
// Listing and viewing read Storage. They do not write the job, do not stamp
// photosEmailedAt, and do not move operationalExpiresAfter.
// Receipt objects are left out. Image bytes are not written to Firestore.
// The 3-month operational date is guidance. SCHEDULING_APPROVED stays false.

import { jobPhotoPrefix, jobTenantOf, listedJobPhoto, storageErrorCode } from "./cloud-storage.js";
import { operationalExpiresAfter, retentionAdminText, SCHEDULING_APPROVED } from "./cloud-retention.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function buildJobGallery({ membership, job, listing, now } = {}) {
  const prefix = jobPhotoPrefix(membership, job);
  if (!prefix.ok) return prefix;
  const photos = [];
  const hidden = [];
  for (const item of listing || []) {
    const path = item && (item.path || item.fullPath) || "";
    if (item && item.error) return { ok: false, reason: storageErrorCode(item.error) };
    const row = listedJobPhoto({
      membership,
      job,
      path,
      contentType: item && item.contentType,
      customMetadata: item && item.customMetadata,
      size: item && item.size,
      readable: item && item.readable,
      error: item && item.error,
    });
    if (!row.ok && String(row.reason || "").startsWith("storage/")) return { ok: false, reason: row.reason };
    if (!row.ok) hidden.push({ path, reason: row.reason });
    else photos.push({ ...row, timeCreated: item && typeof item.timeCreated === "string" ? item.timeCreated : null });
  }
  photos.sort((a, b) => String(b.timeCreated || "").localeCompare(String(a.timeCreated || "")) || a.name.localeCompare(b.name));
  const expiry = operationalExpiresAfter(job, now || new Date());
  return {
    ok: true,
    prefix: prefix.prefix,
    photos,
    hidden,
    expiresAfter: expiry.expiresAfter,
    anchorKind: expiry.anchorKind,
    schedulingApproved: SCHEDULING_APPROVED === true,
    deletionPerformed: false,
    retentionText: retentionAdminText({
      expiresOn: expiry.expiresAfter,
      state: expiry.state,
      warning: expiry.warning,
      due: expiry.due,
      reason: expiry.expiresAfter ? null : (expiry.reason || "missing-anchor"),
      anchorKind: expiry.anchorKind,
    }),
  };
}

/**
 * Upload stamp only. Completed jobs keep their completion anchor.
 * An open job uses this upload's email time, which the existing email flow
 * already writes. Callers must not use this while merely opening the gallery.
 * The job argument is not mutated.
 */
export function stampExpiresAfter(plan, job, now) {
  if (!plan?.uploads?.length || !job) return plan;
  const clock = now instanceof Date ? now : new Date(now || Date.now());
  if (Number.isNaN(clock.getTime())) return plan;
  const completed = job.status === "Done" || job.sm8Status === "Completed";
  const anchored = completed ? job : { ...job, photosEmailedAt: clock.toISOString() };
  const expiresAfter = operationalExpiresAfter(anchored, clock).expiresAfter;
  if (!expiresAfter) return plan;
  return {
    ...plan,
    uploads: plan.uploads.map(u => ({ ...u, metadata: { ...(u.metadata || {}), expiresAfter } })),
  };
}

/** Bytes for the operational zip. Receipt rows are never included. */
export function galleryExportPhotos(gallery, blobs, job) {
  if (!gallery?.ok || !job?.id) return [];
  const tenantId = jobTenantOf(job);
  const out = [];
  for (const photo of gallery.photos) {
    const bytes = blobs && blobs[photo.path];
    if (!(bytes instanceof Uint8Array)) continue;
    out.push({ path: photo.path, jobId: job.id, tenantId, bytes });
  }
  return out;
}

function safeStorageCode(raw) {
  const value = raw && typeof raw === "object" && "code" in raw ? raw.code : raw;
  const m = /^storage\/[a-z0-9-]{1,40}$/.exec(String(value || "").trim());
  return m ? m[0] : "";
}
function photoErrorText(error) {
  const code = safeStorageCode(error);
  return code ? `Couldn't load photos (${code}).` : "Couldn't load photos.";
}
export function photoFailureText(error) {
  return photoErrorText(storageErrorCode(error));
}

/** Empty cloud list. The emailed count is history, not a promise of thumbnails. */
export function cloudEmptyCopy(emailedCount) {
  const n = Number(emailedCount) || 0;
  if (n > 0) return `No cloud copies on this job yet. The ${n} emailed photos are separate from this gallery.`;
  return "No cloud copies on this job yet. Emailed photos are separate from this gallery.";
}

/** Inline thumbnails. src is a same-page blob URL after a private getBlob, never a download URL. */
export function photoGridHtml({ photos, retentionText } = {}) {
  const list = Array.isArray(photos) ? photos : [];
  if (!list.length) return "";
  const note = retentionText
    ? `<p class="pgal-ret">${esc(String(retentionText))} Opening these photos does not change that date.</p>`
    : "";
  const cells = list.map(p => {
    const path = esc(p && p.path || "");
    if (p && p.failed) return `<div class="pth perr" data-photo-path="${path}">${esc(photoFailureText(p.error || ""))}</div>`;
    const src = p && (p.thumb || p.src) || "";
    return `<button type="button" class="pth" data-photo-path="${path}" aria-label="View photo"><img alt="" data-photo-path="${path}" loading="lazy" decoding="async"${src ? ` src="${esc(src)}"` : " hidden"}></button>`;
  }).join("");
  return `${note}<div class="pgrid" data-photo-grid="1">${cells}</div>`;
}

export function photoSlotHtml({ jobId, status, count, role = "both", variant, iconHtml, error, emailedCount, photos, retentionText } = {}) {
  const id = esc(jobId || "");
  const n = Number(count) || 0;
  const cloud = role === "cloud";
  const grid = cloud ? photoGridHtml({ photos, retentionText }) : "";
  const button = !cloud && status === "ready" && n > 0
    ? `<button type="button" class="${variant === "sm" ? "sm-btn viewphotos" : "viewphotos"}" data-viewphotos="${id}" aria-label="View cloud photos">${iconHtml || ""}<span>Photos (${n})</span></button>`
    : "";
  if (role === "action") return button;
  let statusHtml = "";
  if (status === "error") {
    statusHtml = `<p class="err" data-photos-state="error">${esc(photoErrorText(error))} <button type="button" class="sm-btn" data-photoretry="${id}">Try again</button></p>`;
  } else if (!cloud && (status === "loading" || !status)) {
    statusHtml = `<p class="muted sub" data-photos-state="loading">Checking photos…</p>`;
  } else if (cloud && (status === "loading" || !status)) {
    statusHtml = `<p class="muted sub" data-photos-state="loading">Checking cloud photos…</p>`;
  } else if (cloud && n === 0) {
    statusHtml = `<p class="muted sub cloud-empty" data-photos-state="empty">${esc(cloudEmptyCopy(emailedCount))}</p>`;
  } else {
    statusHtml = `<span data-photos-state="${n > 0 ? "ready" : "empty"}" hidden></span>`;
  }
  if (role === "status") return statusHtml;
  if (role === "cloud") return grid + statusHtml;
  return statusHtml + button;
}

export function galleryHtml({ title, subtitle, status, error, retentionText, canDownload, photos, closeHtml, jobId, emailedCount } = {}) {
  const head = `<div class="pgal-bar"><button type="button" class="pgal-x" aria-label="Close photos">${closeHtml || "Back"}</button><div><div class="mob-title">${esc(title || "Photos")}</div><div class="mob-sub">${esc(subtitle || "")}</div></div></div>`;
  const note = `${esc(retentionText || "")} Opening these photos does not change that date.`.trim();
  const dl = canDownload ? `<button type="button" class="sm-btn" data-cloudexport="1">Download cloud copy</button>` : "";
  let body;
  if (status === "loading") body = `<p class="muted pad" data-photos-state="loading">Loading photos…</p>`;
  else if (status === "error") body = `<p class="err pad" data-photos-state="error">${esc(photoErrorText(error))} <button type="button" class="sm-btn" data-photoretry="${esc(jobId || "")}">Try again</button></p>`;
  else if (!photos?.length) body = `<p class="muted pad" data-photos-state="empty">${esc(cloudEmptyCopy(emailedCount))}</p>`;
  else {
    body = `<div class="pgrid">${photos.map(p => p.failed
      ? `<div class="pth perr" data-photo-path="${esc(p.path)}">${esc(photoFailureText(p.error || ""))}</div>`
      : `<button type="button" class="pth" data-photo-path="${esc(p.path)}" aria-label="View photo"><img alt="" loading="lazy" decoding="async"${p.src ? ` src="${esc(p.src)}"` : ""}></button>`).join("")}</div>`;
  }
  return `${head}<div class="pgal-body"><p class="pgal-ret">${note}</p>${dl}${body}</div>`;
}

export function lightboxHtml({ src, caption, closeHtml, index, count } = {}) {
  const n = Number(count) || 0;
  const i = Number(index) || 0;
  const nav = n > 1
    ? `<button type="button" class="pnav pp" aria-label="Previous photo">‹</button><button type="button" class="pnav pn" aria-label="Next photo">›</button>`
    : "";
  const img = src ? `<img alt="" src="${esc(src)}">` : "";
  const place = n > 1 ? ` · ${i + 1} of ${n}` : "";
  return `<div class="pview" role="dialog" aria-modal="true" aria-label="Photo" data-lightbox="1" tabindex="-1"><button type="button" class="px" aria-label="Close photo">${closeHtml || "×"}</button>${nav}${img}<div class="pcap">${esc(caption || "Job photo")}${esc(place)}</div></div>`;
}

export function largePhotoHtml(opts = {}) {
  return lightboxHtml(opts);
}
