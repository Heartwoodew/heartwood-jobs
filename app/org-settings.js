// CallUp organisation settings.
// The product name is CallUp. The business shown in the header, on SWMS,
// quotes and emails is this organisation. Heartwood Earthworx is the
// customer on this install. Another CallUp customer changes these defaults,
// or an admin saves an override on the Organisation screen (this phone only).
// This file is not a Firebase id, collection, storage path, or tenant id.

export const PRODUCT_NAME = "CallUp";
export const PRODUCT_SHORT = "CallUp";
export const POWERED_BY = "Powered by CallUp";

export const DEFAULT_ORG = Object.freeze({
  name: "Heartwood Earthworx",
  legalName: "Heartwood Earthworx Pty Ltd",
  abn: "31 667 738 098",
  signoff: "Heartwood Earthworx",
  logoUrl: "",
});

const STORE_KEY = "callup.org.v1";
const FIELDS = ["name", "legalName", "abn", "signoff", "logoUrl"];

function clean(source) {
  const out = {};
  if (!source || typeof source !== "object") return out;
  for (const key of FIELDS) {
    if (typeof source[key] !== "string") continue;
    const max = key === "logoUrl" ? 300 : key === "legalName" ? 120 : 80;
    out[key] = source[key].trim().slice(0, max);
  }
  return out;
}

// A customer logo is an https URL or a file under icons/. Blank means text only.
export function safeLogo(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^icons\/[A-Za-z0-9._/-]+$/.test(value)) return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return value;
  } catch { /* not a URL */ }
  return "";
}

function readSaved() {
  try {
    if (typeof localStorage === "undefined") return {};
    return clean(JSON.parse(localStorage.getItem(STORE_KEY) || "null"));
  } catch {
    return {};
  }
}

export function orgSettings() {
  const overlay = typeof window !== "undefined" ? window.CALLUP_ORG : null;
  const merged = { ...DEFAULT_ORG, ...readSaved(), ...clean(overlay) };
  if (!merged.name) merged.name = DEFAULT_ORG.name;
  if (!merged.legalName) merged.legalName = DEFAULT_ORG.legalName;
  if (!merged.signoff) merged.signoff = merged.name;
  merged.logoUrl = safeLogo(merged.logoUrl);
  return merged;
}

// Returns the saved organisation. A rejected logo URL is stored blank.
export function saveOrgSettings(partial) {
  const next = { ...orgSettings(), ...clean(partial) };
  next.logoUrl = safeLogo(next.logoUrl);
  if (!next.name) next.name = DEFAULT_ORG.name;
  if (!next.legalName) next.legalName = DEFAULT_ORG.legalName;
  if (!next.signoff) next.signoff = next.name;
  const stored = {};
  for (const key of FIELDS) stored[key] = next[key];
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(stored));
  } catch { /* private mode: the form still shows the typed values for this view */ }
  return stored;
}
