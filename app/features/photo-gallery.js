// In-app gallery for job photos already stored under the job photo prefix.
// Listing and viewing read Storage. They do not write the job, do not stamp
// photosEmailedAt, and do not move operationalExpiresAfter.
// Receipt objects are left out. Image bytes are not written to Firestore.
// The 3-month operational date is guidance. SCHEDULING_APPROVED stays false.

import { jobPhotoPrefix, jobTenantOf, listedJobPhoto } from "./cloud-storage.js";
import { operationalExpiresAfter, retentionAdminText, SCHEDULING_APPROVED } from "./cloud-retention.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function buildJobGallery({ membership, job, listing, now } = {}) {
  const prefix = jobPhotoPrefix(membership, job);
  if (!prefix.ok) return prefix;
  const photos = [];
  const hidden = [];
  for (const item of listing || []) {
    const path = item && (item.path || item.fullPath) || "";
    const row = listedJobPhoto({
      membership,
      job,
      path,
      contentType: item && item.contentType,
      customMetadata: item && item.customMetadata,
      size: item && item.size,
      readable: item && item.readable,
    });
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
  const m = /^storage\/[a-z0-9-]{1,40}$/.exec(String(raw || "").trim());
  return m ? m[0] : "";
}
function photoErrorText(error) {
  const code = safeStorageCode(error);
  return code ? `Couldn't load photos (${code}).` : "Couldn't load photos.";
}

export function photoSlotHtml({ jobId, status, count, role = "both", variant, iconHtml, error } = {}) {
  const id = esc(jobId || "");
  const n = Number(count) || 0;
  const cloud = role === "cloud";
  const button = cloud || (status === "ready" && n > 0)
    ? `<button type="button" class="${variant === "sm" ? "sm-btn viewphotos" : "viewphotos"}" data-viewphotos="${id}" aria-label="View cloud photos">${iconHtml || ""}<span>${cloud ? (n > 0 ? `View cloud photos (${n})` : "View cloud photos") : `Photos (${n})`}</span></button>`
    : "";
  if (role === "action") return button;
  let statusHtml = "";
  if (status === "error") {
    statusHtml = `<p class="err" data-photos-state="error">${esc(photoErrorText(error))} <button type="button" class="sm-btn" data-photoretry="${id}">Try again</button></p>`;
  } else if (!cloud && (status === "loading" || !status)) {
    statusHtml = `<p class="muted sub" data-photos-state="loading">Checking photos…</p>`;
  } else if (cloud && (status === "loading" || !status)) {
    statusHtml = `<p class="muted sub" data-photos-state="loading">Checking cloud photos…</p>`;
  } else {
    statusHtml = `<span data-photos-state="${n > 0 ? "ready" : "empty"}" hidden></span>`;
  }
  if (role === "status") return statusHtml;
  return statusHtml + button;
}

export function galleryHtml({ title, subtitle, status, error, retentionText, canDownload, photos, closeHtml, jobId } = {}) {
  const head = `<div class="pgal-bar"><button type="button" class="pgal-x" aria-label="Close photos">${closeHtml || "Back"}</button><div><div class="mob-title">${esc(title || "Photos")}</div><div class="mob-sub">${esc(subtitle || "")}</div></div></div>`;
  const note = `${esc(retentionText || "")} Opening these photos does not change that date.`.trim();
  const dl = canDownload ? `<button type="button" class="sm-btn" data-cloudexport="1">Download cloud copy</button>` : "";
  let body;
  if (status === "loading") body = `<p class="muted pad" data-photos-state="loading">Loading photos…</p>`;
  else if (status === "error") body = `<p class="err pad" data-photos-state="error">${esc(photoErrorText(error))} <button type="button" class="sm-btn" data-photoretry="${esc(jobId || "")}">Try again</button></p>`;
  else if (!photos?.length) body = `<p class="muted pad" data-photos-state="empty">No cloud photos on this job yet.</p>`;
  else {
    body = `<div class="pgrid">${photos.map(p => p.failed
      ? `<div class="pth perr" data-photo-path="${esc(p.path)}">Couldn't load</div>`
      : `<button type="button" class="pth" data-photo-path="${esc(p.path)}" aria-label="View photo"><img alt=""${p.src ? ` src="${esc(p.src)}"` : ""}></button>`).join("")}</div>`;
  }
  return `${head}<div class="pgal-body"><p class="pgal-ret">${note}</p>${dl}${body}</div>`;
}

export function largePhotoHtml({ src, caption, closeHtml } = {}) {
  return `<div class="pview" role="dialog" aria-modal="true" aria-label="Photo"><button type="button" class="px" aria-label="Close photo">${closeHtml || "×"}</button><img alt="" src="${esc(src || "")}"><div class="pcap">${esc(caption || "Job photo")}</div></div>`;
}
