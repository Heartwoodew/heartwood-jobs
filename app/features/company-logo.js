// Company logo upload. The file lives in the private Storage bucket at
// companies/{companyId}/logo/logo.jpg. logoUrl on the company document holds
// that path, or an older https / icons/ value. This module does not talk to Firebase.

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const LOGO_MAX_EDGE = 512;
export const LOGO_JPEG_QUALITY = 0.85;
export const LOGO_ACCEPT = "image/jpeg,image/png,.jpg,.jpeg,.png";
export const LOGO_CONTENT_TYPES = Object.freeze(["image/jpeg", "image/png"]);

const COMPANY_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const STORAGE_PATH_RE = /^companies\/([a-z0-9][a-z0-9-]{0,39})\/logo\/logo\.(jpg|png)$/;

export function cleanCompanyIdForLogo(value) {
  const id = String(value || "").trim().toLowerCase();
  return COMPANY_ID_RE.test(id) ? id : "";
}

export function logoStoragePath(companyId) {
  const id = cleanCompanyIdForLogo(companyId);
  return id ? `companies/${id}/logo/logo.jpg` : "";
}

export function isLogoStoragePath(value, companyId) {
  const v = String(value || "").trim();
  const m = v.match(STORAGE_PATH_RE);
  if (!m) return false;
  const id = cleanCompanyIdForLogo(companyId);
  return id ? m[1] === id : true;
}

// A logo value is a company Storage path, an https URL, or a file under icons/.
// When companyId is known, a path for a different company is rejected.
export function acceptLogoValue(url, companyId) {
  const value = String(url || "").trim().slice(0, 300);
  if (!value) return "";
  if (isLogoStoragePath(value, companyId)) return value;
  if (STORAGE_PATH_RE.test(value)) return "";
  if (/^icons\/[A-Za-z0-9._/-]+$/.test(value)) return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return value;
  } catch { /* not a URL */ }
  return "";
}

export function logoFileOk(file) {
  if (!file) return { ok: false, reason: "missing" };
  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  const typed = type === "image/jpeg" || type === "image/jpg" || type === "image/png";
  const named = /\.(jpe?g|png)$/.test(name);
  if (!typed && !named) return { ok: false, reason: "type" };
  const size = Number(file.size) || 0;
  if (size <= 0 || size > LOGO_SOURCE_MAX_BYTES) return { ok: false, reason: "size" };
  return { ok: true };
}

export function logoUploadPlan(companyId, uploaderUid) {
  const path = logoStoragePath(companyId);
  const uid = String(uploaderUid || "").trim();
  if (!path || !uid) return { ok: false, reason: "company" };
  return {
    ok: true,
    path,
    contentType: "image/jpeg",
    metadata: { purpose: "company-logo", uploaderUid: uid, companyId: cleanCompanyIdForLogo(companyId) },
  };
}

export function logoFailureText(code) {
  if (code === "type" || code === "missing") return "Use a JPEG or PNG photo or file.";
  if (code === "size") return "That image is too large. Use a smaller JPEG or PNG.";
  if (code === "compress") return "Couldn't read that image. Try another JPEG or PNG.";
  if (code === "upload" || code === "company") return "The logo could not be saved. Try again.";
  return "The logo could not be saved. Try again.";
}

// Resize to a 512px edge and encode as JPEG. Callers enforce the 2 MB upload cap on the result.
export async function compressLogo(file) {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    throw Object.assign(new Error("compress"), { code: "compress" });
  }
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bmp) throw Object.assign(new Error("compress"), { code: "compress" });
  const edge = Math.max(bmp.width, bmp.height) || 1;
  const k = Math.min(1, LOGO_MAX_EDGE / edge);
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", LOGO_JPEG_QUALITY));
  if (!blob || !blob.size) throw Object.assign(new Error("compress"), { code: "compress" });
  if (blob.size > LOGO_MAX_BYTES) throw Object.assign(new Error("size"), { code: "size" });
  return blob;
}
