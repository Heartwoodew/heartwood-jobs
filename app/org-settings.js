// CallUp organisation settings.
// The product name is CallUp. The business shown in the header, on SWMS,
// quotes and emails is the signed-in company. Heartwood Earthworx is the
// first company. When no company document is loaded, these defaults keep
// Heartwood's current name, ABN and sign-off.
// This file is not a Firebase id, collection, storage path, or tenant id.

export const PRODUCT_NAME = "CallUp";
export const PRODUCT_SHORT = "CallUp";
export const POWERED_BY = "Powered by CallUp";

export const DEFAULT_ORG = Object.freeze({
  companyId: "heartwood",
  name: "Heartwood Earthworx",
  legalName: "Heartwood Earthworx Pty Ltd",
  abn: "31 667 738 098",
  signoff: "Heartwood Earthworx",
  logoUrl: "",
  address: "208-220 Holdsworth Rd, Chuwar QLD 4306",
  phone: "",
  email: "alex@heartwoodew.com",
  accountsEmail: "accounts@heartwoodew.com",
  hubdocAddress: "",
});

const STORE_KEY = "callup.org.v1";
const FIELDS = ["name", "legalName", "abn", "signoff", "logoUrl", "address", "phone", "email", "accountsEmail", "hubdocAddress"];
let activeCompany = null;

function clean(source) {
  const out = {};
  if (!source || typeof source !== "object") return out;
  for (const key of FIELDS) {
    if (typeof source[key] !== "string") continue;
    const max = key === "logoUrl" ? 300 : key === "legalName" || key === "address" ? 160 : key === "email" || key === "accountsEmail" || key === "hubdocAddress" ? 120 : 80;
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

export function setActiveCompany(company) {
  if (!company || typeof company !== "object") {
    activeCompany = null;
    return orgSettings();
  }
  const billing = company.billing && typeof company.billing === "object" ? company.billing : null;
  activeCompany = {
    ...clean(company),
    companyId: typeof company.companyId === "string" && company.companyId ? company.companyId : DEFAULT_ORG.companyId,
    isTest: company.isTest === true,
    plan: typeof company.plan === "string" ? company.plan : "",
    billing: billing ? {
      provider: billing.provider === "stripe" ? "stripe" : null,
      status: ["active", "past_due", "canceled", "not-configured"].includes(billing.status) ? billing.status : "not-configured",
      stripeCustomerId: typeof billing.stripeCustomerId === "string" ? billing.stripeCustomerId : null,
      stripeSubscriptionId: typeof billing.stripeSubscriptionId === "string" ? billing.stripeSubscriptionId : null,
    } : null,
  };
  return orgSettings();
}

export function orgSettings() {
  const overlay = typeof window !== "undefined" ? window.CALLUP_ORG : null;
  const base = activeCompany ? { ...DEFAULT_ORG, ...activeCompany } : { ...DEFAULT_ORG, ...readSaved() };
  const merged = { ...base, ...clean(overlay) };
  if (!merged.companyId) merged.companyId = DEFAULT_ORG.companyId;
  if (!merged.name) merged.name = DEFAULT_ORG.name;
  if (!merged.legalName) merged.legalName = DEFAULT_ORG.legalName;
  if (!merged.signoff) merged.signoff = merged.name;
  if (!merged.accountsEmail && merged.companyId === "heartwood") merged.accountsEmail = DEFAULT_ORG.accountsEmail;
  if (!merged.email && merged.companyId === "heartwood") merged.email = DEFAULT_ORG.email;
  if (!merged.address && merged.companyId === "heartwood") merged.address = DEFAULT_ORG.address;
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
