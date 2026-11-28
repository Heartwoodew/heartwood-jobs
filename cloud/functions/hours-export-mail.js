// Emails the weekly hours spreadsheet the office saved ("Send to accounts").
//
// The browser builds the .xlsx, uploads it to private Storage (hoursExports/<id>/<file>.xlsx) and writes
// hoursExports/<id> with status "queued". This file replaces the old box routine
// (tools/hours_export_mailer.py + the Gmail connector): a Firestore trigger sends it through Resend
// the moment the document is written, and a 15 minute sweep retries anything that failed.
//
// Recipients are the same hard rules as tools/company_scope.py:
//   Heartwood goes to accounts@heartwoodew.com and nowhere else.
//   Another company goes to its own accounts address, never Heartwood's mailbox.
//   A test or preview company never sends real email.
// The same master switch as every other CallUp email applies: nothing is sent unless
// INVITE_EMAIL_ENABLED is "true", and INVITE_EMAIL_ALLOW_TO (when set) limits recipients.
// This file never reads or logs the Resend key. Each export is claimed in a transaction, so a
// trigger and a sweep can never send it twice, and Resend gets a fixed Idempotency-Key per export.
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { inviteEmailConfig, sendViaResend } from "./shared/staff-invites.js";
import { resolveJobEmailSender } from "./job-email.js";

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const REGION = "australia-southeast1";

export const HOURS_HEARTWOOD_ID = "heartwood";
export const HOURS_HEARTWOOD_ACCOUNTS = "accounts@heartwoodew.com";
export const HOURS_MAX_TRIES = 5;
export const HOURS_STALE_MS = 30 * 60 * 1000;
export const HOURS_MAX_BYTES = 5 * 1024 * 1024;
export const HOURS_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ID_RE = /^hx[a-z0-9]{16}$/;
const FILE_RE = /^[A-Za-z0-9_-]{1,80}\.xlsx$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function dmy(s) {
  const t = String(s || "");
  return t.length >= 10 ? `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(0, 4)}` : "";
}

function companyIdOf(d) {
  const c = String((d && (d.companyId || d.tenantId)) || "").trim();
  return c || HOURS_HEARTWOOD_ID;
}

export function isTestExport(d, company) {
  return (d && d.isTest === true) || (company && company.isTest === true) || (d && d.status === "preview");
}

/** { ok, to, subjectName, reason }. Same rules as tools/company_scope.hours_recipient. */
export function hoursRecipient(d, company) {
  if (isTestExport(d, company)) return { ok: false, to: "", subjectName: "", reason: "test-company" };
  const to = String((d && d.to) || "").trim();
  if (companyIdOf(d) === HOURS_HEARTWOOD_ID) {
    return to === HOURS_HEARTWOOD_ACCOUNTS
      ? { ok: true, to: HOURS_HEARTWOOD_ACCOUNTS, subjectName: "Heartwood", reason: "" }
      : { ok: false, to: "", subjectName: "", reason: "bad-recipient" };
  }
  if (!EMAIL_RE.test(to) || to.toLowerCase() === HOURS_HEARTWOOD_ACCOUNTS) return { ok: false, to: "", subjectName: "", reason: "bad-recipient" };
  const name = String((d && d.companyName) || "").trim().slice(0, 80) || "Company";
  return { ok: true, to, subjectName: name, reason: "" };
}

export function hoursSubject(subjectName, weekStart, weekEnd, id) {
  return `Timesheet hours ${dmy(weekStart)} to ${dmy(weekEnd)} - ${subjectName} [HWH ${String(id).slice(2, 10)}]`;
}

const SHEETS_TEXT = [
  "The first sheet is one row per person and one column per day (Mon 02/11). Each cell is the hours worked that day, or Annual, Sick, Other, or Pending on a leave day with no hours. It has a Total column and a grand total.",
  "The Detail sheet lists every day in the pay period. Each day shows the date and weekday, clock on and clock off for every shift, break start, break end and minutes, hours for the shift, and the day's total. Job, site and machine are filled in when they were recorded.",
  "A day with no hours is 0. Approved leave shows as annual leave, sick leave, or other leave, with a note when a medical certificate is attached. Pending leave shows as Leave requested (pending). A day with no leave and no hours shows as Day off.",
  "",
].join("\n") + "\n";

export function hoursBody(d, subjectName) {
  const people = Number(d.people) || 0;
  const hours = (Number(d.totalHours) || 0).toFixed(2);
  const head = `Attached are the timesheet hours for Mon ${dmy(d.weekStart)} to Sun ${dmy(d.weekEnd)} (${people} staff, ${hours} hours total).\n`;
  if (subjectName === "Heartwood") return `Hi Nicole,\n\n${head}${SHEETS_TEXT}Thanks,\nAlex\nHeartwood`;
  return `Hi,\n\n${head}${SHEETS_TEXT}Thanks,\n${subjectName}\n`;
}

/** Whether a stored export should be picked up now. */
export function hoursDue(d, nowMs) {
  const st = String((d && d.status) || "");
  if (st === "sent") return { due: false, retry: false };
  const tries = Number(d && d.attempts) || 0;
  if (st === "sending") {
    const t = Date.parse(String((d && d.updatedAt) || ""));
    return { due: !Number.isFinite(t) || nowMs - t > HOURS_STALE_MS, retry: true };
  }
  if (st !== "queued" && st !== "failed") return { due: false, retry: false };
  if (tries >= HOURS_MAX_TRIES) return { due: false, retry: false };
  return { due: true, retry: st === "failed" };
}

export function hoursMailOpen(to, env = {}) {
  const config = inviteEmailConfig(env);
  if (config.enabled !== true) return false;
  const allow = Array.isArray(config.allowTo) ? config.allowTo : [];
  return !allow.length || allow.some(prefix => String(to).toLowerCase().startsWith(prefix));
}

export function hoursEmailPayload({ id, d, company, to, subjectName, content, env }) {
  const companyId = companyIdOf(d);
  const sender = resolveJobEmailSender({
    companyId,
    companyName: subjectName === "Heartwood" ? "Heartwood" : subjectName,
    companyEmail: companyId === HOURS_HEARTWOOD_ID ? "alex@heartwoodew.com" : String((company && company.email) || ""),
    env,
  });
  const payload = {
    from: sender.from,
    to: [to],
    subject: hoursSubject(subjectName, d.weekStart, d.weekEnd, id),
    text: hoursBody(d, subjectName),
    attachments: [{ filename: d.fileName, content }],
  };
  if (sender.replyTo) payload.reply_to = sender.replyTo;
  return payload;
}

/**
 * Process one export. deps: now(), env, loadCompany(id), claim(id, decide), download(path), send(payload, key),
 * finish(id, patch). claim runs decide(d) inside a transaction and applies the patch it returns.
 */
export async function processHoursExport(id, deps) {
  if (!ID_RE.test(String(id))) return { ok: false, action: "skipped", reason: "bad-id" };
  const nowMs = deps.now();
  const iso = new Date(nowMs).toISOString();
  const env = deps.env || {};
  let seen = null;
  let company = null;
  const claimed = await deps.claim(id, async d => {
    if (!d) return null;
    const check = hoursDue(d, nowMs);
    if (!check.due) return null;
    company = await deps.loadCompany(companyIdOf(d));
    const rcpt = hoursRecipient(d, company);
    if (!rcpt.ok) {
      return { patch: { status: "failed", attempts: HOURS_MAX_TRIES, error: rcpt.reason === "test-company" ? "Held: test company, not emailed." : "Held: no valid accounts email for this company.", updatedAt: iso }, held: rcpt.reason };
    }
    if (!hoursMailOpen(rcpt.to, env)) return null;
    const name = String(d.fileName || "");
    if (!FILE_RE.test(name) || d.storagePath !== `hoursExports/${id}/${name}`) {
      return { patch: { status: "failed", attempts: HOURS_MAX_TRIES, error: "Bad file path.", updatedAt: iso }, held: "bad-path" };
    }
    const tries = Number(d.attempts) || 0;
    seen = { d, rcpt };
    return { patch: { status: "sending", attempts: tries + (d.status === "sending" ? 0 : 1), updatedAt: iso } };
  });
  if (!claimed) return { ok: true, action: "none" };
  if (claimed.held) return { ok: false, action: "held", reason: claimed.held };
  const { d, rcpt } = seen;
  try {
    let bytes;
    try {
      bytes = await deps.download(d.storagePath);
    } catch (e) {
      await deps.finish(id, { status: "failed", error: ("Could not read the file: " + String((e && e.message) || e)).slice(0, 300), updatedAt: new Date(deps.now()).toISOString() });
      return { ok: false, action: "failed", reason: "download" };
    }
    if (!bytes || !bytes.length || bytes.length > HOURS_MAX_BYTES || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      await deps.finish(id, { status: "failed", attempts: HOURS_MAX_TRIES, error: "The spreadsheet file is missing or not a valid .xlsx.", updatedAt: new Date(deps.now()).toISOString() });
      return { ok: false, action: "failed", reason: "bad-file" };
    }
    const payload = hoursEmailPayload({ id, d, company, to: rcpt.to, subjectName: rcpt.subjectName, content: Buffer.from(bytes).toString("base64"), env });
    const result = await deps.send(payload, `hours-export-${id}`);
    if (!result || result.ok !== true) {
      const why = String((result && (result.error || result.reason)) || "send failed").slice(0, 280);
      await deps.finish(id, { status: "failed", error: "Resend: " + why, updatedAt: new Date(deps.now()).toISOString() });
      return { ok: false, action: "failed", reason: "send" };
    }
    const at = new Date(deps.now()).toISOString();
    await deps.finish(id, { status: "sent", sentAt: at, messageId: String(result.id || "").slice(0, 100), via: "resend", error: "", updatedAt: at });
    return { ok: true, action: "sent", to: rcpt.to };
  } catch (e) {
    await deps.finish(id, { status: "failed", error: ("Unexpected: " + String((e && e.message) || e)).slice(0, 300), updatedAt: new Date(deps.now()).toISOString() }).catch(() => {});
    return { ok: false, action: "failed", reason: "unexpected" };
  }
}

function ensureAdmin() {
  if (!getApps().some(a => a.name === "[DEFAULT]")) initializeApp();
}

export function hoursLiveDeps(db, over = {}) {
  return {
    now: () => Date.now(),
    env: process.env,
    loadCompany: async id => {
      if (id === HOURS_HEARTWOOD_ID) return {};
      const snap = await db.collection("companies").doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    claim: (id, decide) => db.runTransaction(async tx => {
      const ref = db.collection("hoursExports").doc(id);
      const snap = await tx.get(ref);
      const out = await decide(snap.exists ? snap.data() : null);
      if (!out) return false;
      tx.update(ref, out.patch);
      return out.held ? { held: out.held } : true;
    }),
    download: async path => {
      const [buf] = await getStorage().bucket().file(path).download();
      return buf;
    },
    send: (payload, key) => sendViaResend({ apiKey: RESEND_API_KEY.value(), payload, fetchImpl: globalThis.fetch, idempotencyKey: key }),
    finish: (id, patch) => db.collection("hoursExports").doc(id).update(patch),
    ...over,
  };
}

export const hoursExportMailer = onDocumentCreated(
  { document: "hoursExports/{id}", region: REGION, secrets: [RESEND_API_KEY], timeoutSeconds: 120, memory: "256MiB" },
  async event => {
    if (process.env.NODE_TEST_CONTEXT) return;
    ensureAdmin();
    const result = await processHoursExport(event.params.id, hoursLiveDeps(getFirestore()));
    console.log("hoursExportMailer", event.params.id, result.action, result.reason || "");
  },
);

export const hoursExportRetry = onSchedule(
  { schedule: "*/15 * * * *", timeZone: "Australia/Brisbane", region: REGION, secrets: [RESEND_API_KEY], timeoutSeconds: 300, memory: "256MiB" },
  async () => {
    if (process.env.NODE_TEST_CONTEXT) return;
    ensureAdmin();
    const db = getFirestore();
    const deps = hoursLiveDeps(db);
    const seen = new Set();
    for (const status of ["queued", "failed", "sending"]) {
      const snap = await db.collection("hoursExports").where("status", "==", status).limit(50).get();
      for (const docSnap of snap.docs) {
        if (seen.has(docSnap.id)) continue;
        seen.add(docSnap.id);
        const result = await processHoursExport(docSnap.id, deps);
        if (result.action !== "none") console.log("hoursExportRetry", docSnap.id, result.action, result.reason || "");
      }
    }
  },
);
