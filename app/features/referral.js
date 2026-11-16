// Referral link captured in the browser. The code is checked again on the server.
// This module does not write Firestore and does not call Stripe.

export const REFERRAL_STORAGE_KEY = "callup.ref";
export const REFERRAL_CODE_LENGTH = 20;
export const REFERRAL_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_RE = new RegExp(`^[${REFERRAL_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

export function referralCodeOk(code) {
  return typeof code === "string" && CODE_RE.test(code);
}

export function normalizeReferralCode(value) {
  const code = String(value || "").trim().toLowerCase();
  return referralCodeOk(code) ? code : "";
}

export function referralLink(code, origin = "https://app.callupapp.com.au") {
  const base = String(origin || "https://app.callupapp.com.au").replace(/\/$/, "");
  return `${base}/app/?ref=${encodeURIComponent(normalizeReferralCode(code) || String(code || ""))}`;
}

function paramsOf(search) {
  const raw = String(search || "");
  const q = raw.includes("?") ? raw.slice(raw.indexOf("?")) : (raw.startsWith("ref=") ? `?${raw}` : raw);
  try { return new URLSearchParams(q); } catch { return new URLSearchParams(); }
}

// Persist a valid ?ref= code. An empty or invalid value leaves whatever was already stored.
export function captureReferralParam(search, storage) {
  const code = normalizeReferralCode(paramsOf(search).get("ref") || "");
  if (!code || !storage || typeof storage.setItem !== "function") return code;
  try { storage.setItem(REFERRAL_STORAGE_KEY, code); } catch { /* private mode */ }
  return code;
}

export function storedReferralCode(storage) {
  if (!storage || typeof storage.getItem !== "function") return "";
  try { return normalizeReferralCode(storage.getItem(REFERRAL_STORAGE_KEY) || ""); }
  catch { return ""; }
}

export function clearStoredReferral(storage) {
  if (!storage || typeof storage.removeItem !== "function") return;
  try { storage.removeItem(REFERRAL_STORAGE_KEY); } catch { /* private mode */ }
}

// Reasons that will not succeed on a later retry. Anything else (offline, function cold) keeps the code.
export function referralGiveUp(message) {
  return ["unknown-code", "self-referral", "after-creation", "not-signup", "not-owner"].includes(String(message || ""));
}
