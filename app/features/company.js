// CallUp companies. Heartwood is company id "heartwood".
// A new paying customer is another companies/{companyId} document.
// Stripe is not wired. billing is a hook for a later subscription.
// This module does not talk to Firestore.

import { DEFAULT_ORG } from "../org-settings.js";
import { appOriginFor } from "./staff-invites.js";
import { acceptLogoValue } from "./company-logo.js";

export const HEARTWOOD_COMPANY_ID = "heartwood";
export const PLATFORM_OWNER_EMAIL = "alex@heartwoodew.com";
export const PLATFORM_OWNER_UID = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
export const HEARTWOOD_ACCOUNTS_EMAIL = "accounts@heartwoodew.com";
export const HEARTWOOD_OFFICE_EMAIL = "alex@heartwoodew.com";
export const HEARTWOOD_ADDRESS = "208-220 Holdsworth Rd, Chuwar QLD 4306";
export const TRIAL_DAYS = 14;
export const COMPANY_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// The browser always creates billing as not-configured. A webhook (Admin SDK) may later
// set provider to "stripe" and status to "active", "past_due" or "canceled".
// Test companies and friend trials stay on this empty hook. The browser never writes a Stripe id.
export function billingHook() {
  return {
    provider: null,
    status: "not-configured",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  };
}

export const HEARTWOOD_COMPANY = Object.freeze({
  companyId: HEARTWOOD_COMPANY_ID,
  name: DEFAULT_ORG.name,
  legalName: DEFAULT_ORG.legalName,
  abn: DEFAULT_ORG.abn,
  signoff: DEFAULT_ORG.signoff,
  logoUrl: DEFAULT_ORG.logoUrl || "",
  address: HEARTWOOD_ADDRESS,
  phone: "",
  email: HEARTWOOD_OFFICE_EMAIL,
  accountsEmail: HEARTWOOD_ACCOUNTS_EMAIL,
  hubdocAddress: "",
  status: "active",
  plan: "paid",
  origin: "heartwood",
  staffCount: 0,
  jobCount: 0,
  billing: Object.freeze(billingHook()),
});

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const HUBDOC_RE = /^[a-z0-9._+-]+@app\.hubdoc\.com$/;

export function cleanCompanyId(value) {
  const id = String(value || "").trim().toLowerCase();
  return COMPANY_ID_RE.test(id) ? id : "";
}

export function companyIdFromName(name, rand = Math.random) {
  const slug = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "company";
  const n = Math.floor(Math.abs(Number(rand()) || 0) * (36 ** 4));
  const suffix = n.toString(36).padStart(4, "0").slice(-4);
  return `${slug}-${suffix}`.slice(0, 40);
}

function clip(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

export function safeLogo(url, companyId) {
  return acceptLogoValue(url, companyId);
}

export function validateCompanyInput(input = {}) {
  const name = clip(input.name, 80);
  const legalName = clip(input.legalName || input.name, 120);
  const abn = clip(input.abn, 20);
  const signoff = clip(input.signoff || name, 80);
  const address = clip(input.address, 160);
  const phone = clip(input.phone, 40);
  const email = clip(input.email, 120).toLowerCase();
  const accountsEmail = clip(input.accountsEmail, 120).toLowerCase();
  const hubdocAddress = clip(input.hubdocAddress, 120).toLowerCase();
  const logoUrl = safeLogo(input.logoUrl, input.companyId);
  if (!name) return { ok: false, reason: "name" };
  if (!legalName) return { ok: false, reason: "legalName" };
  if (!abn) return { ok: false, reason: "abn" };
  if (abn && !/^[0-9 ]{1,20}$/.test(abn)) return { ok: false, reason: "abn" };
  if (!address) return { ok: false, reason: "address" };
  if (phone && !/^[0-9+() ./-]{3,40}$/.test(phone)) return { ok: false, reason: "phone" };
  if (!EMAIL_RE.test(email)) return { ok: false, reason: "email" };
  if (!EMAIL_RE.test(accountsEmail)) return { ok: false, reason: "accountsEmail" };
  if (hubdocAddress && !HUBDOC_RE.test(hubdocAddress)) return { ok: false, reason: "hubdoc" };
  if (input.logoUrl && String(input.logoUrl).trim() && !logoUrl) return { ok: false, reason: "logo" };
  return {
    ok: true,
    value: { name, legalName, abn, signoff, logoUrl, address, phone, email, accountsEmail, hubdocAddress },
  };
}

export function trialEnd(from) {
  const start = from instanceof Date ? from : new Date(from || Date.now());
  return new Date(start.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

// Browser payload for companies/{id}. Timestamps are filled by the caller
// (server timestamps for signedUpAt and lastActivityAt).
export function buildCompanyCreate(value, { companyId, ownerUid, signedUpAt, trialEndsAt, lastActivityAt }) {
  return {
    ...value,
    ownerUid,
    createdBy: ownerUid,
    status: "active",
    plan: "trial",
    origin: "signup",
    isTest: false,
    signedUpAt,
    trialEndsAt,
    staffCount: 1,
    jobCount: 0,
    lastActivityAt,
    billing: billingHook(),
  };
}

// A test company is not a customer. Emails are not sent and nothing is billed.
export function buildTestCompany(name, { companyId, ownerUid, signedUpAt, demoData }) {
  const label = clip(name, 80);
  const demo = demoData === true;
  return {
    name: label,
    legalName: clip(label + " (test)", 120),
    abn: "00 000 000 000",
    signoff: label,
    logoUrl: "",
    address: "Test company. No real site.",
    phone: "",
    email: "preview@example.com",
    accountsEmail: "preview@example.com",
    hubdocAddress: "",
    ownerUid,
    createdBy: ownerUid,
    status: "active",
    plan: "trial",
    origin: "test",
    isTest: true,
    demoData: demo,
    signedUpAt,
    trialEndsAt: null,
    staffCount: demo ? 2 : 0,
    jobCount: demo ? 2 : 0,
    lastActivityAt: signedUpAt,
    billing: billingHook(),
  };
}

// A friend trial is a real company. The friend types their own details.
export function buildFriendCompany(value, { companyId, ownerUid, signedUpAt, friendInvite }) {
  return {
    ...value,
    ownerUid,
    createdBy: ownerUid,
    status: "active",
    plan: "friend",
    origin: "friend",
    isTest: false,
    demoData: false,
    friendInvite,
    friendEndsAt: null,
    signedUpAt,
    trialEndsAt: null,
    staffCount: 1,
    jobCount: 0,
    lastActivityAt: signedUpAt,
    billing: billingHook(),
  };
}

const FRIEND_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newFriendCode(fill) {
  const bytes = new Uint8Array(8);
  if (typeof fill === "function") fill(bytes);
  else if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (const b of bytes) out += FRIEND_CODE_ALPHABET[b % FRIEND_CODE_ALPHABET.length];
  return out;
}

// Friend trials are new CallUp companies, so the link uses the CallUp address, not jobs.heartwoodew.com.
export function friendInviteLink(code, currentOrigin = "") {
  return appOriginFor("callup", currentOrigin) + "/app?friend=" + encodeURIComponent(String(code || ""));
}

export function friendCodeOk(code) {
  return typeof code === "string" && /^[a-z0-9]{8}$/.test(code);
}

// Stable ids so a reset overwrites the same documents and never deletes them.
export function demoBundle(companyId, { date = "2026-11-10" } = {}) {
  const id = cleanCompanyId(companyId);
  const staff = [
    { id: `demo-${id}-sam`, name: "Sam Taylor", role: "operator" },
    { id: `demo-${id}-sue`, name: "Sue Nguyen", role: "supervisor" },
  ];
  const jobs = [
    { id: `demo-${id}-job1`, client: "Sample Homes", address: "12 Test Street, Brisbane QLD", type: "other", description: "Sample job for this test company.", date, status: "Scheduled" },
    { id: `demo-${id}-job2`, client: "Example Builder", address: "4 Demo Court, Brisbane QLD", type: "spoil", description: "Second sample job. No prices are stored.", date, status: "Scheduled" },
  ];
  return {
    staff: staff.map(person => ({
      id: person.id,
      data: { name: person.name, role: person.role, companyId: id, tenantId: id, demo: true, email: "" },
    })),
    jobs: jobs.map(job => ({
      id: job.id,
      data: {
        client: job.client, address: job.address, type: job.type, description: job.description,
        date: job.date, time: "07:00", status: job.status, companyId: id, tenantId: id, demo: true,
        assigned: [], assignedNames: [job.id.endsWith("job1") ? "Sam Taylor" : "Sue Nguyen"],
      },
    })),
  };
}

export function ownerProfile(value, companyId, ownerName) {
  return {
    name: clip(ownerName, 80),
    email: value.email,
    role: "admin",
    companyId,
    tenantId: companyId,
  };
}

// Missing companyId means Heartwood, including records that only have tenantId.
export function docCompanyId(data) {
  if (!data || typeof data !== "object") return HEARTWOOD_COMPANY_ID;
  const company = typeof data.companyId === "string" ? data.companyId.trim() : "";
  if (company) return company;
  const tenant = typeof data.tenantId === "string" ? data.tenantId.trim() : "";
  return tenant || HEARTWOOD_COMPANY_ID;
}

// New writes carry companyId. Heartwood does not gain a tenantId it never had.
export function scopeRecord(data, companyId) {
  const id = cleanCompanyId(companyId) || HEARTWOOD_COMPANY_ID;
  const next = { ...data, companyId: id };
  if (id !== HEARTWOOD_COMPANY_ID) next.tenantId = id;
  return next;
}

export function isHeartwoodCompany(companyId) {
  return !companyId || companyId === HEARTWOOD_COMPANY_ID;
}

// Spreadsheet title, filename and the accounts mailbox.
// Heartwood keeps the current title name and accounts@heartwoodew.com.
export function hoursBrand(org) {
  const heartwood = isHeartwoodCompany(org && org.companyId);
  const name = (org && org.name) || (heartwood ? "Heartwood" : "Company");
  return {
    companyId: heartwood ? HEARTWOOD_COMPANY_ID : org.companyId,
    titleName: heartwood ? (org && org.name) || "Heartwood" : name,
    fileName: heartwood ? (org && org.name) || "Heartwood" : name,
    subjectName: heartwood ? "Heartwood" : name,
    accountsEmail: heartwood ? HEARTWOOD_ACCOUNTS_EMAIL : (org && org.accountsEmail) || "",
    heartwood,
  };
}

export function isPlatformOwner({ uid, email, emailVerified, claims } = {}) {
  const verified = emailVerified === true && String(email || "").trim().toLowerCase() === PLATFORM_OWNER_EMAIL;
  if (!verified) return false;
  if (claims && claims.platformOwner === true) return true;
  return uid === PLATFORM_OWNER_UID;
}

function millis(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const n = new Date(value).getTime();
  return Number.isNaN(n) ? null : n;
}

export function companyPlanView(company, now = new Date()) {
  const raw = company && company.plan;
  const plan = raw === "paid" || raw === "friend" ? raw : "trial";
  const rawStatus = company && company.status;
  const status = rawStatus === "suspended" || rawStatus === "archived" ? rawStatus : "active";
  const end = millis(company && company.trialEndsAt);
  const friendEnd = millis(company && company.friendEndsAt);
  const at = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const trialActive = status === "active" && plan === "trial" && company && company.isTest !== true && end != null && end > at;
  const trialEnded = plan === "trial" && company && company.isTest !== true && end != null && end <= at;
  const friendEnded = plan === "friend" && friendEnd != null && friendEnd <= at;
  let planLabel = "Trial";
  if (company && company.isTest === true) planLabel = "Test";
  else if (plan === "paid") planLabel = "Paying";
  else if (plan === "friend") planLabel = friendEnded ? "Friend ended" : "Friend";
  else if (trialEnded) planLabel = "Trial ended";
  else if (trialActive) planLabel = "Trial";
  return { plan, status, trialActive, trialEnded, friendEnded, planLabel, trialEndsAt: end, friendEndsAt: friendEnd };
}

// Account-level row only. Job text, photos and money are not copied onto it.
export function masterRow(id, company, now = new Date()) {
  const view = companyPlanView(company, now);
  const signed = millis(company && (company.signedUpAt || company.createdAt));
  const activity = millis(company && company.lastActivityAt);
  return {
    id,
    name: company.name || "",
    legalName: company.legalName || "",
    abn: company.abn || "",
    email: company.email || "",
    phone: company.phone || "",
    address: company.address || "",
    accountsEmail: company.accountsEmail || "",
    hubdocAddress: company.hubdocAddress || "",
    signedUpAt: signed,
    lastActivityAt: activity,
    staffCount: Number.isFinite(+company.staffCount) ? +company.staffCount : 0,
    jobCount: Number.isFinite(+company.jobCount) ? +company.jobCount : 0,
    status: view.status,
    plan: view.plan,
    planLabel: view.planLabel,
    trialActive: view.trialActive,
    trialEnded: view.trialEnded,
    trialEndsAt: view.trialEndsAt,
    friendEndsAt: view.friendEndsAt,
    friendEnded: view.friendEnded,
    isTest: company.isTest === true,
    paying: view.plan === "paid" && view.status === "active" && company.isTest !== true,
    billingStatus: billingStatusLabel(company, view),
  };
}

export function billingStatusLabel(company, view = companyPlanView(company)) {
  if (!company || company.isTest === true || view.plan === "friend") return "Not billed";
  const status = company.billing && company.billing.status;
  if (status === "active") return "Active";
  if (status === "past_due") return "Past due";
  if (status === "canceled") return "Canceled";
  return "Not set up";
}

export function masterTotals(rows) {
  const list = rows || [];
  const customers = list.filter(r => !r.isTest);
  return {
    companies: list.length,
    activeTrials: customers.filter(r => r.trialActive && r.status === "active" && r.plan === "trial").length,
    paying: customers.filter(r => r.paying).length,
    friends: customers.filter(r => r.plan === "friend" && r.status === "active" && !r.friendEnded).length,
    staff: customers.filter(r => r.status !== "archived").reduce((n, r) => n + (r.staffCount || 0), 0),
  };
}

export function filterMaster(rows, { q = "", status = "all", plan = "all" } = {}) {
  const query = String(q || "").trim().toLowerCase();
  return (rows || []).filter(row => {
    if (status === "active" && row.status !== "active") return false;
    if (status === "suspended" && row.status !== "suspended") return false;
    if (plan === "trial" && !(row.plan === "trial" && row.trialActive)) return false;
    if (plan === "trial-ended" && !row.trialEnded) return false;
    if (plan === "paid" && row.plan !== "paid") return false;
    if (plan === "friend" && row.plan !== "friend") return false;
    if (plan === "test" && !row.isTest) return false;
    if (status === "archived" && row.status !== "archived") return false;
    if (!query) return true;
    const hay = [row.name, row.legalName, row.abn, row.email, row.phone, row.id].join(" ").toLowerCase();
    return hay.includes(query);
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// Migration planner. Adds companyId only. Never deletes or overwrites a companyId.
export function planCompanyField(data, pathCompanyId) {
  if (!data || typeof data !== "object") return { action: "skip", reason: "not-a-document" };
  if (typeof data.companyId === "string" && data.companyId.trim()) {
    return { action: "keep", companyId: data.companyId.trim() };
  }
  const tenant = typeof data.tenantId === "string" ? data.tenantId.trim() : "";
  const companyId = cleanCompanyId(pathCompanyId) || cleanCompanyId(tenant) || HEARTWOOD_COMPANY_ID;
  return { action: "add", companyId, field: "companyId" };
}

const COMPANY_DETAIL_KEYS = ["name", "legalName", "abn", "signoff", "logoUrl", "address", "phone", "email", "accountsEmail", "hubdocAddress"];

export function companyDetailPatch(current, input) {
  const checked = validateCompanyInput({ ...current, ...input });
  if (!checked.ok) return checked;
  const extras = validateCompanyExtras(input || {});
  if (!extras.ok) return extras;
  const value = { ...checked.value, ...extras.value };
  const patch = {};
  for (const key of COMPANY_DETAIL_KEYS) {
    if (checked.value[key] !== (current && current[key])) patch[key] = checked.value[key];
  }
  // Optional settings fields. Only written when given, so Heartwood's record is untouched unless an admin sets them.
  for (const key of COMPANY_EXTRA_KEYS) {
    if (!(key in (input || {}))) continue;
    if (value[key] !== ((current && current[key]) || "")) patch[key] = value[key];
  }
  return { ok: true, value, patch };
}

// ---- Per-company details used in place of Heartwood's (job numbers, clients, emails).
export const COMPANY_EXTRA_KEYS = ["jobPrefix", "accountsName"];
export const JOB_PREFIX_RE = /^[A-Z0-9]{1,5}$/;
export const HEARTWOOD_JOB_PREFIX = "HW";
export const HEARTWOOD_CLIENTS = Object.freeze(["Orbit Homes (Qld) Pty Ltd", "Torsion Built Pty Ltd", "Silkwood Homes", "OJ Pippin Homes", "Envision Homes"]);
// Neutral sender for app emails from companies other than Heartwood. Replies go to the company's own email.
export const CALLUP_SENDER = "CallUp <noreply@callupapp.com.au>";

export function validateCompanyExtras(input = {}) {
  const jobPrefix = clip(input.jobPrefix, 5).toUpperCase();
  const accountsName = clip(input.accountsName, 80);
  if (jobPrefix && !JOB_PREFIX_RE.test(jobPrefix)) return { ok: false, reason: "jobPrefix" };
  if (/[\n\r\t<>]/.test(accountsName)) return { ok: false, reason: "accountsName" };
  return { ok: true, value: { jobPrefix, accountsName } };
}

// "Acme Earthmoving" -> "AE", "Bravo" -> "BRA". Heartwood is always HW.
export function derivedJobPrefix(name) {
  const words = String(name || "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/)
    .filter(w => w && !["PTY", "LTD", "THE", "AND", "CO", "CO.", "QLD"].includes(w));
  if (!words.length) return "JOB";
  const p = words.length === 1 ? words[0].slice(0, 3) : words.slice(0, 3).map(w => w[0]).join("");
  return p || "JOB";
}

export function companyJobPrefix(org) {
  if (isHeartwoodCompany(org && org.companyId)) return HEARTWOOD_JOB_PREFIX;
  const set = String((org && org.jobPrefix) || "").trim().toUpperCase();
  return JOB_PREFIX_RE.test(set) ? set : derivedJobPrefix(org && org.name);
}

// Builder/client names offered on job and quote forms. Heartwood keeps its fixed builder list;
// other companies start empty and see only the clients they add (plus "Private").
export function companyClientNames(org, savedClients = []) {
  if (isHeartwoodCompany(org && org.companyId)) return [...HEARTWOOD_CLIENTS, "Private"];
  const names = [...new Set((savedClients || []).map(c => String((c && c.name) || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return [...names, "Private"];
}
export function companyStdClients(org, savedClients = []) {
  return companyClientNames(org, savedClients).filter(n => n !== "Private");
}

// Client doc id. Heartwood keeps its plain slug ids; other companies are prefixed so ids never collide.
export function clientDocId(companyId, name) {
  const slug = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "client";
  return isHeartwoodCompany(companyId) ? slug : `${companyId}_${slug}`.slice(0, 100);
}

// Timesheet email text: greeting and sign-off. Heartwood keeps "Hi Nicole" / "Alex".
export function timesheetMailParts(org, senderName) {
  if (isHeartwoodCompany(org && org.companyId)) return { greeting: "Hi Nicole,", sender: "Alex" };
  const who = String((org && org.accountsName) || "").trim();
  return { greeting: who ? `Hi ${who.split(/\s+/)[0]},` : "Hi,", sender: String(senderName || "").trim() || (org && org.signoff) || "" };
}

// Sign-off lines for builder emails (PO exceeded). Heartwood keeps Alex Daly and his mobile.
export function builderSignoff(org, senderName) {
  if (isHeartwoodCompany(org && org.companyId)) return ["Alex Daly", (org && org.signoff) || "Heartwood Earthworx", "0499 802 812"];
  return [String(senderName || "").trim(), (org && org.signoff) || (org && org.name) || "", String((org && org.phone) || "").trim()].filter(Boolean);
}

// Remembered builder supervisors (PO-exceeded emails). Heartwood keeps meta/supervisors; others start empty.
export function supervisorsPath(companyId) {
  const id = String(companyId || HEARTWOOD_COMPANY_ID);
  return isHeartwoodCompany(id) ? ["meta", "supervisors"] : ["companyMeta", id + "_supervisors"];
}

// Gmail address used for compose/search links. Heartwood: alex@heartwoodew.com. Others: the company email.
export function companyMailbox(org) {
  if (isHeartwoodCompany(org && org.companyId)) return HEARTWOOD_OFFICE_EMAIL;
  return String((org && org.email) || "").trim();
}

export function heartwoodSeed(now = new Date()) {
  return {
    ...HEARTWOOD_COMPANY,
    billing: billingHook(),
    signedUpAt: null,
    trialEndsAt: null,
    lastActivityAt: now,
    createdAt: now,
    ownerUid: PLATFORM_OWNER_UID,
    createdBy: "migration",
  };
}
