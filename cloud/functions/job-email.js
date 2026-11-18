// Send one job email from CallUp. The callable checks the signed-in person, builds the
// text with the same rules as the preview, and sends through the invite mail transport
// (Resend, or the Trigger Email extension when INVITE_EMAIL_PROVIDER=extension).
// No new secret: RESEND_API_KEY, INVITE_EMAIL_ENABLED and INVITE_EMAIL_ALLOW_TO are the
// ones inviteEmailWorker already uses. Nothing is sent unless INVITE_EMAIL_ENABLED is
// the string "true". This file does not open an SMTP connection.
//
// Job email only: JOB_EMAIL_FROM_OVERRIDES is a non-secret env var (not a company
// setting, not a secret). It is JSON mapping companyId to {from, name, replyTo?}.
// Heartwood's company id is "heartwood" (HEARTWOOD_TENANT in shared/staff-invites.js
// and app/features/cloud-storage.js; the same id is used for companies/heartwood).
// The override is used only when the from-address domain is listed in
// JOB_EMAIL_VERIFIED_DOMAINS (comma-separated; default callupapp.com.au). Any other
// domain, or JSON that does not parse, keeps the CallUp sender. Invites and password
// resets do not read these variables.
import { rateDecision } from "./password-reset.js";
import { canSeeJob, jobTenantOf, resolveMembership } from "./shared/cloud-storage.js";
import {
  CALLUP_INVITE_FROM,
  appOriginFor,
  inviteEmailConfig,
} from "./shared/staff-invites.js";
import {
  PHOTO_BUDGET_BYTES,
  buildJobEmail,
  dumpReceiptLabel,
  emailDumpReceipts,
  packEmailAttachments,
  parseEmailRecipients,
  selectEmailAttachments,
  uniqueNames,
  unattachedFileNote,
} from "./shared/job-email.js";

export const JOB_EMAIL_HOURLY_LIMIT = 20;
export const JOB_EMAIL_WINDOW_MS = 60 * 60 * 1000;
// Used when JOB_EMAIL_VERIFIED_DOMAINS is unset or blank. An unverified domain never sends.
export const DEFAULT_JOB_EMAIL_VERIFIED_DOMAINS = "callupapp.com.au";

const SENDING_ADDRESS = (/<([^>]+)>/.exec(CALLUP_INVITE_FROM) || [])[1] || "noreply@callupapp.com.au";
const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const SKIP_OVERRIDE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function companyOf(record) {
  if (!record || typeof record !== "object") return "heartwood";
  const company = typeof record.companyId === "string" ? record.companyId.trim() : "";
  if (company) return company;
  const tenant = typeof record.tenantId === "string" ? record.tenantId.trim() : "";
  return tenant || "heartwood";
}

function fail(reason) {
  return { ok: false, reason };
}

export function jobEmailFailureText(reason) {
  if (reason === "unauthenticated") return "Sign in to email this job.";
  if (reason === "invalid-recipient") return "Enter a valid email address. You can send to 5 addresses at most.";
  if (reason === "rate-limited") return "Too many job emails. Wait an hour and try again.";
  if (reason === "not-sent") return "Couldn't send that email. Try again in a minute.";
  if (reason === "sender-not-authorised") return "Couldn't send from your company email address yet. Ask CallUp support to check the email sender setup.";
  if (reason === "too-large") return "That email is too big to send. Remove some photos and try again.";
  if (reason === "mail-rejected") return "The mail service rejected that email. Check the addresses and try again.";
  if (reason === "mail-unavailable") return "The mail service is busy. Try again in a minute.";
  return "You can't email this job.";
}

function cleanSenderName(value) {
  return String(value || "").replace(/[\r\n<>"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function isEmail(value) {
  return EMAIL_RE.test(String(value || "").trim());
}

function emailDomain(address) {
  const email = String(address || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return "";
  return email.slice(at + 1);
}

export function jobEmailFrom(companyName) {
  const name = cleanSenderName(companyName) || "CallUp";
  return `${name} via CallUp <${SENDING_ADDRESS}>`;
}

export function jobEmailReplyTo({ companyEmail, senderEmail } = {}) {
  const company = String(companyEmail || "").trim().toLowerCase();
  const sender = String(senderEmail || "").trim().toLowerCase();
  if (isEmail(company)) return company;
  if (isEmail(sender)) return sender;
  return "";
}

/** Comma-separated domains allowed to appear in a job-email From override. */
export function jobEmailVerifiedDomains(env = {}) {
  const raw = env && env.JOB_EMAIL_VERIFIED_DOMAINS;
  const source = raw == null || String(raw).trim() === "" ? DEFAULT_JOB_EMAIL_VERIFIED_DOMAINS : String(raw);
  const seen = [];
  for (const part of source.split(",")) {
    const domain = part.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
    if (!DOMAIN_RE.test(domain) || seen.includes(domain)) continue;
    seen.push(domain);
  }
  return seen;
}

/**
 * companyId -> { from, name, replyTo? }. Bad JSON, or an entry without a real
 * address and a display name, is dropped. Companies cannot write this map.
 */
export function parseJobEmailFromOverrides(env = {}) {
  const raw = env && env.JOB_EMAIL_FROM_OVERRIDES;
  if (raw == null || String(raw).trim() === "") return Object.create(null);
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return Object.create(null);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Object.create(null);
  const out = Object.create(null);
  for (const key of Object.keys(parsed)) {
    if (SKIP_OVERRIDE_KEYS.has(key)) continue;
    const id = key.trim();
    if (!id || SKIP_OVERRIDE_KEYS.has(id)) continue;
    const value = parsed[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const from = String(value.from || "").trim().toLowerCase();
    const name = cleanSenderName(value.name);
    if (!isEmail(from) || !name) continue;
    const entry = { from, name };
    const replyTo = String(value.replyTo || "").trim().toLowerCase();
    if (replyTo && isEmail(replyTo)) entry.replyTo = replyTo;
    out[id] = entry;
  }
  return out;
}

/**
 * From and Reply-To for one job email. An override applies only when its
 * from-address domain is on the verified-domain list. Otherwise the CallUp
 * sender and the company (then sender) reply-to are unchanged.
 */
export function resolveJobEmailSender({ companyId, companyName, companyEmail, senderEmail, env } = {}) {
  const fallback = {
    from: jobEmailFrom(companyName),
    replyTo: jobEmailReplyTo({ companyEmail, senderEmail }),
  };
  const id = String(companyId || "").trim();
  if (!id) return fallback;
  const override = parseJobEmailFromOverrides(env)[id];
  if (!override) return fallback;
  const domain = emailDomain(override.from);
  if (!domain || !jobEmailVerifiedDomains(env).includes(domain)) return fallback;
  return {
    from: `${override.name} <${override.from}>`,
    replyTo: override.replyTo || override.from,
  };
}

export function jobEmailAppUrl(companyId) {
  return String(appOriginFor(companyId) || "").replace(/\/$/, "") + "/app/";
}

function displayCompanyName(companyId, company) {
  const named = company && typeof company.name === "string" ? company.name.trim() : "";
  if (named) return named;
  return companyId === "heartwood" ? "Heartwood Earthworx" : "CallUp";
}

function mailOpen(recipients, env, allowLiveMail) {
  const config = inviteEmailConfig(env || {});
  if (config.enabled !== true || allowLiveMail !== true) return false;
  const allow = Array.isArray(config.allowTo) ? config.allowTo : [];
  if (allow.length && recipients.some(addr => !allow.some(prefix => String(addr).toLowerCase().startsWith(prefix)))) return false;
  return true;
}

function receiptPath(tenantId, receipt) {
  const id = String(receipt && receipt.id || "");
  if (!JOB_ID.test(id) || !/^[A-Za-z0-9_-]{1,80}$/.test(String(tenantId || ""))) return "";
  return `tenants/${tenantId}/receipts/${id}/original`;
}

function safeFileName(item, index) {
  const base = String(item && item.name || `File ${index + 1}`)
    .replace(/[\u0000-\u001f\\/]/g, " ")
    .replace(/https?:\S+/gi, "")
    .replace(/tenants\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const stem = base || `File ${index + 1}`;
  if (/\.(jpe?g|png|webp|gif|pdf)$/i.test(stem)) return stem;
  const type = String(item && item.contentType || "");
  const ext = type === "image/png" ? ".png"
    : type === "image/webp" ? ".webp"
    : type === "image/gif" ? ".gif"
    : type === "application/pdf" ? ".pdf"
    : ".jpg";
  return stem + ext;
}

function toBase64(bytes) {
  if (!bytes) return "";
  return Buffer.from(bytes).toString("base64");
}

export function jobEmailResendPayload(message) {
  if (!message) return null;
  const body = {
    from: message.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
  };
  if (message.cc && message.cc.length) body.cc = message.cc;
  if (message.replyTo) body.reply_to = message.replyTo;
  if (message.attachments && message.attachments.length) {
    body.attachments = message.attachments.map(file => ({
      filename: file.filename,
      content: file.content,
      content_type: file.contentType || "application/octet-stream",
    }));
  }
  return body;
}

// sendViaResend (shared/staff-invites.js, mirrored into the app) reports a failure as
// reason "resend-<status>" with Resend's message in error. Read the status from there.
function resendStatus(result) {
  const direct = Number(result && result.status) || 0;
  if (direct) return direct;
  const m = /^resend-(\d{3})$/.exec(String((result && result.reason) || ""));
  return m ? Number(m[1]) : 0;
}

function senderNotAuthorised(result) {
  if (!result || result.ok) return false;
  const text = String(result.error || "");
  return resendStatus(result) === 403 && /not (?:authori[sz]ed to send|verified)|domain/i.test(text);
}

/** Map a failed Resend result to a job-email failure reason the app can show. */
export function resendFailureReason(result) {
  if (!result || result.ok) return "not-sent";
  const status = resendStatus(result);
  if (senderNotAuthorised(result)) return "sender-not-authorised";
  if (status === 413 || /too large|size|exceed/i.test(String(result.error || ""))) return "too-large";
  if (status === 422 || status === 400) return "mail-rejected";
  if (status === 429 || status >= 500) return "mail-unavailable";
  return "not-sent";
}

function logResendFailure(message, result, deps, attempt) {
  // Never logs the API key, recipients or attachment content.
  const line = {
    jobId: message.jobId || "",
    companyId: message.companyId || "",
    attempt,
    fromDomain: emailDomain((/<([^>]+)>/.exec(String(message.from || "")) || [])[1] || message.from),
    status: resendStatus(result),
    name: String((result && result.name) || "").slice(0, 80),
    error: String((result && (result.error || result.reason)) || "").slice(0, 200),
    attached: message.attachedCount || 0,
  };
  if (typeof deps.logError === "function") deps.logError("sendJobEmail resend failed", line);
  else if (!(deps.env || {}).NODE_TEST_CONTEXT && !process.env.NODE_TEST_CONTEXT) console.error("sendJobEmail resend failed", line);
}

function auditDoc(message, delivery, extra = {}) {
  return {
    kind: "job-email",
    companyId: message.companyId || "",
    jobId: message.jobId || "",
    to: message.to || [],
    cc: message.cc || [],
    subject: message.subject || "",
    attached: message.attachedCount || 0,
    linked: message.linkedCount || 0,
    delivery,
    ...extra,
  };
}

export async function queueJobEmail(message, deps = {}) {
  const env = deps.env || {};
  if (env.NODE_TEST_CONTEXT && env.INVITE_EMAIL_ENABLED === "true" && deps.allowLiveMail === true) {
    throw new Error("refusing live job email under test");
  }
  const recipients = [...(message && message.to || []), ...(message && message.cc || [])];
  if (!mailOpen(recipients, env, deps.allowLiveMail)) {
    if (typeof deps.writeMail === "function") await deps.writeMail("jobMail", auditDoc(message, "held", { reason: "not-sent" }));
    return { ok: false, sent: false, reason: "not-sent" };
  }
  const config = inviteEmailConfig(env);
  if (config.provider === "resend") {
    if (typeof deps.sendResend !== "function") return { ok: false, sent: false, reason: "not-sent" };
    let result = await deps.sendResend(jobEmailResendPayload(message), message.idempotencyKey);
    let firstError = null;
    if (!(result && result.ok)) logResendFailure(message, result, deps, "primary");
    // A company From override whose domain the Resend key may not use (403
    // "not authorized to send emails from <domain>") retries once from the
    // CallUp sender, keeping the same reply-to, so the email still goes out.
    if (!(result && result.ok) && senderNotAuthorised(result)
      && message.fallbackFrom && message.fallbackFrom !== message.from) {
      firstError = result;
      const retry = { ...message, from: message.fallbackFrom };
      result = await deps.sendResend(jobEmailResendPayload(retry), `${message.idempotencyKey}-callup`);
      if (!(result && result.ok)) logResendFailure(retry, result, deps, "fallback");
    }
    const ok = !!(result && result.ok);
    const doc = auditDoc(message, ok ? "sent" : "failed", {
      providerId: (result && result.id) || "",
      error: String((result && (result.error || result.reason)) || "").slice(0, 200),
      status: resendStatus(result),
      ...(firstError ? {
        senderFallback: true,
        fromUsed: ok ? message.fallbackFrom : "",
        primaryError: String(firstError.error || firstError.reason || "").slice(0, 200),
      } : {}),
    });
    if (typeof deps.writeMail === "function") await deps.writeMail("jobMail", doc);
    return {
      ok,
      sent: ok,
      reason: ok ? "sent" : resendFailureReason(firstError && !ok && senderNotAuthorised(result) ? firstError : result),
      senderFallback: !!firstError && ok,
    };
  }
  if (typeof deps.writeMail !== "function") return { ok: false, sent: false, reason: "not-sent" };
  await deps.writeMail("mail", {
    to: message.to,
    cc: message.cc || [],
    from: message.from,
    replyTo: message.replyTo || "",
    message: {
      subject: message.subject,
      text: message.text,
      attachments: (message.attachments || []).map(file => ({
        filename: file.filename,
        content: file.content,
        encoding: "base64",
        contentType: file.contentType || "application/octet-stream",
      })),
    },
  });
  await deps.writeMail("jobMail", auditDoc(message, "queued"));
  return { ok: true, sent: true, reason: "queued-for-extension" };
}

function objectBytes(got) {
  const bytes = got && got.bytes;
  if (!bytes) return 0;
  return bytes.byteLength || bytes.length || 0;
}

async function loadAttachment(item, deps) {
  if (item && item._loaded) return item._loaded;
  let got = null;
  if (item && item.path && typeof deps.readObject === "function") {
    try {
      got = await deps.readObject(item.path);
    } catch {
      got = null;
    }
  }
  if (objectBytes(got) > 0) {
    got = { ...got, source: "storage" };
  } else if (item && item.kind === "dump-receipt" && typeof deps.readReceiptChunks === "function") {
    try {
      got = await deps.readReceiptChunks(item.id, item.tenantId);
    } catch {
      got = null;
    }
    if (objectBytes(got) > 0) got = { ...got, source: "chunks" };
    else got = null;
  } else {
    got = objectBytes(got) > 0 ? got : null;
  }
  if (item) item._loaded = got;
  return got;
}

async function measured(item, statObject, deps) {
  let size = Number(item && item.size);
  let contentType = item && item.contentType || "";
  if (!Number.isFinite(size) || size <= 0) {
    if (typeof statObject === "function" && item && item.path) {
      try {
        const stat = await statObject(item.path);
        size = Number(stat && stat.size) || 0;
        contentType = (stat && stat.contentType) || contentType;
      } catch {
        size = 0;
      }
    }
  }
  if ((!Number.isFinite(size) || size <= 0) && item && item.kind === "dump-receipt") {
    const got = await loadAttachment(item, deps || {});
    size = objectBytes(got) || 0;
    contentType = (got && got.contentType) || contentType;
  }
  return { ...item, size, contentType };
}

function callerMembership(callerUid, caller) {
  const profile = caller && caller.profile ? caller.profile : null;
  return resolveMembership({
    uid: callerUid,
    profile,
    heartwoodAdmin: profile ? !!(caller && caller.heartwoodGrant) : undefined,
  });
}

// deps.getCaller(uid) -> { profile, heartwoodGrant, email, name }
// deps.getJob(jobId) -> job or null
// deps.getCompany(companyId) -> { name, email } or null
// deps.listPhotos(job) -> storage listing rows
// deps.listReceipts(job) -> receipt docs
// deps.listDocuments(job) -> document docs
// deps.getQuote(job) -> quote or null
// deps.statObject(path) -> { size, contentType }
// deps.readObject(path) -> { bytes, contentType }
// deps.claimRate({ uid, companyId, now }) -> { ok }
// deps.sendResend(payload, key) / deps.writeMail(collection, doc)
export async function sendJobEmail({ callerUid, jobId, to, cc } = {}, deps = {}) {
  const caller = String(callerUid || "");
  if (!caller) return fail("unauthenticated");
  const id = String(jobId || "").trim();
  if (!JOB_ID.test(id)) return fail("not-allowed");
  const recipients = parseEmailRecipients({ to, cc });
  if (!recipients.ok) return fail("invalid-recipient");

  const env = deps.env || {};
  const allowLiveMail = deps.allowLiveMail === true;
  let callerUser = null;
  let job = null;
  try {
    callerUser = typeof deps.getCaller === "function" ? await deps.getCaller(caller) : null;
    job = typeof deps.getJob === "function" ? await deps.getJob(id) : null;
  } catch {
    return fail("not-sent");
  }
  const membership = callerMembership(caller, callerUser);
  if (!membership.ok || !job || job.id !== id) return fail("not-allowed");
  if (companyOf(job) !== membership.tenantId || jobTenantOf(job) !== membership.tenantId) return fail("not-allowed");
  if (!canSeeJob(membership, job)) return fail("not-allowed");
  if (!mailOpen([...recipients.to, ...recipients.cc], env, allowLiveMail)) return fail("not-sent");

  let company = null;
  let listing = [];
  let receiptRows = [];
  let documents = [];
  let quote = null;
  try {
    if (typeof deps.getCompany === "function") company = await deps.getCompany(membership.tenantId);
    if (typeof deps.listPhotos === "function") listing = await deps.listPhotos(job) || [];
    if (typeof deps.listReceipts === "function") receiptRows = await deps.listReceipts(job) || [];
    if (typeof deps.listDocuments === "function") documents = await deps.listDocuments(job) || [];
    if (membership.canSeeMoney && job.quoteId && typeof deps.getQuote === "function") quote = await deps.getQuote(job);
  } catch {
    return fail("not-sent");
  }
  if (quote && companyOf(quote) !== membership.tenantId) quote = null;
  documents = (documents || []).filter(row => companyOf(row) === membership.tenantId);
  receiptRows = (receiptRows || []).filter(row => companyOf(row) === membership.tenantId);

  const picked = selectEmailAttachments({
    membership, job, companyId: membership.tenantId, role: membership.role, listing, receipts: [],
  });
  if (!picked.ok) return fail("not-allowed");
  const sizeByPath = new Map((listing || []).map(row => [row && row.path, Number(row && row.size) || 0]));
  const photoFiles = picked.photos.map(item => ({ ...item, size: sizeByPath.get(item.path) || 0 }));
  const dumpRows = emailDumpReceipts({ role: membership.role, job, receipts: receiptRows });
  const receiptFiles = [];
  dumpRows.forEach((row, index) => {
    const path = receiptPath(membership.tenantId, row);
    receiptFiles.push({
      kind: "dump-receipt",
      id: row.id,
      name: dumpReceiptLabel(row, index),
      path,
      tenantId: membership.tenantId,
      contentType: row.mime || "image/jpeg",
      size: Number(row.bytes) || 0,
    });
  });

  let described = [];
  try {
    described = [];
    // Receipts first so a tight photo budget cannot drop the tip dockets.
    for (const item of receiptFiles.concat(photoFiles)) described.push(await measured(item, deps.statObject, deps));
  } catch {
    return fail("not-sent");
  }
  const budget = Number(deps.attachmentBudget) > 0 ? Number(deps.attachmentBudget) : PHOTO_BUDGET_BYTES;
  const packed = packEmailAttachments(described, budget);
  const names = uniqueNames(packed.attach.map((item, index) => safeFileName(item, index)));
  const attachments = [];
  const overflow = packed.linked.slice();
  const skipped = packed.skipped.slice();
  const canRead = typeof deps.readObject === "function" || typeof deps.readReceiptChunks === "function";
  if (packed.attach.length && !canRead) return fail("not-sent");
  for (let i = 0; i < packed.attach.length; i++) {
    const item = packed.attach[i];
    const got = await loadAttachment(item, deps);
    const bytes = got && got.bytes;
    const size = objectBytes(got);
    if (!size) {
      skipped.push(item);
      continue;
    }
    if (attachments.reduce((sum, file) => sum + (file.bytes || 0), 0) + size > budget) {
      overflow.push(item);
      continue;
    }
    attachments.push({
      filename: names[i],
      content: toBase64(bytes),
      contentType: (got && got.contentType) || item.contentType || "image/jpeg",
      bytes: size,
      kind: item.kind,
      source: got.source || "",
    });
  }

  const companyName = displayCompanyName(membership.tenantId, company);
  const sender = resolveJobEmailSender({
    companyId: membership.tenantId,
    companyName,
    companyEmail: company && company.email,
    senderEmail: callerUser && callerUser.email,
    env,
  });
  const callupFrom = jobEmailFrom(companyName);
  const built = buildJobEmail({
    job,
    company: { companyId: membership.tenantId, name: companyName },
    companyId: membership.tenantId,
    role: membership.role,
    documentRole: membership.role,
    documents,
    photos: photoFiles,
    receipts: dumpRows,
    quote: membership.canSeeMoney ? quote : null,
    recipient: recipients.to[0],
  });
  if (!built.ok) return fail("not-allowed");
  const note = unattachedFileNote({
    photos: overflow.filter(item => item.kind === "photo").map(item => safeFileName(item, 0)),
    receipts: overflow.filter(item => item.kind === "dump-receipt").map(item => safeFileName(item, 0)),
    url: jobEmailAppUrl(membership.tenantId),
  });
  if (note && /tenants\/|firebasestorage|X-Goog-|token=/.test(note)) return fail("not-sent");
  const text = note ? `${built.body}\n${note}` : built.body;
  const packedBytes = attachments.reduce((sum, file) => sum + (file.bytes || 0), 0);
  const logLine = {
    jobId: id,
    companyId: membership.tenantId,
    listed: (listing || []).length,
    photos: picked.photos.length,
    receipts: receiptFiles.length,
    attached: attachments.length,
    overflow: overflow.length,
    skipped: skipped.length,
    bytes: packedBytes,
    receiptStorage: attachments.filter(file => file.kind === "dump-receipt" && file.source === "storage").length,
    receiptChunks: attachments.filter(file => file.kind === "dump-receipt" && file.source === "chunks").length,
  };
  if (typeof deps.log === "function") deps.log("sendJobEmail packed", logLine);
  else if (!process.env.NODE_TEST_CONTEXT) console.log("sendJobEmail packed", logLine);

  const now = typeof deps.now === "function" ? deps.now() : new Date();
  let claimed = { ok: false };
  try {
    claimed = typeof deps.claimRate === "function"
      ? await deps.claimRate({ uid: caller, companyId: membership.tenantId, now })
      : { ok: false };
  } catch {
    return fail("not-sent");
  }
  if (!claimed || !claimed.ok) return fail("rate-limited");

  const message = {
    from: sender.from,
    fallbackFrom: callupFrom,
    to: recipients.to,
    cc: recipients.cc,
    replyTo: sender.replyTo,
    subject: built.subject,
    text,
    attachments: attachments.map(({ filename, content, contentType }) => ({ filename, content, contentType })),
    companyId: membership.tenantId,
    jobId: id,
    attachedCount: attachments.length,
    linkedCount: overflow.length,
    idempotencyKey: `jobemail-${caller}-${id}-${now instanceof Date ? now.getTime() : Number(now)}`,
  };
  let queued;
  try {
    queued = await queueJobEmail(message, { ...deps, env, allowLiveMail: true });
  } catch (err) {
    if (err && /refusing live job email/.test(String(err.message || err))) throw err;
    const line = { jobId: id, companyId: membership.tenantId, name: String(err && err.name || "").slice(0, 80), error: String(err && err.message || err || "").slice(0, 200) };
    if (typeof deps.logError === "function") deps.logError("sendJobEmail send threw", line);
    else if (!process.env.NODE_TEST_CONTEXT) console.error("sendJobEmail send threw", line);
    return fail("not-sent");
  }
  if (!queued || !queued.sent) return fail((queued && queued.reason) || "not-sent");
  return {
    ok: true,
    senderFallback: !!queued.senderFallback,
    attached: attachments.length,
    overflowCount: overflow.length,
    skipped: skipped.length,
    to: recipients.to,
  };
}

export function jobEmailRateDecision(stamps, now) {
  return rateDecision(stamps, now, JOB_EMAIL_HOURLY_LIMIT, JOB_EMAIL_WINDOW_MS);
}
