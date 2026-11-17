// sendJobEmail: permissions, dump-receipt filtering, crew prices, recipients, rate limit.
// Mail is a fake Resend call. Nothing leaves the test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALEX_UID } from "../../app/features/cloud-storage.js";
import {
  JOB_EMAIL_HOURLY_LIMIT,
  jobEmailAppUrl,
  jobEmailFailureText,
  jobEmailFrom,
  jobEmailRateDecision,
  jobEmailReplyTo,
  queueJobEmail,
  sendJobEmail,
} from "../functions/job-email.js";

const NOW = new Date("2026-11-16T01:00:00.000Z");
const PHOTO = Uint8Array.from([1, 2, 3]);
const DOCKET = Uint8Array.from([9, 9, 9]);

function job(extra = {}) {
  return {
    id: "job1",
    companyId: "heartwood",
    tenantId: "heartwood",
    client: "Orbit Homes",
    address: "14 Brightvale Street",
    type: "spoil",
    title: "Spoil removal",
    date: "2026-11-16",
    time: "07:00",
    assigned: ["crew1"],
    assignedNames: ["Sam"],
    po: "HW-44921",
    description: "Remove spoil $1,840.50 ex GST",
    notes: "Customer offered $40 cash",
    status: "Scheduled",
    poAmount: 1790,
    quoteAmount: 1840.5,
    quoteId: "q1",
    workAmounts: ["Cash job $40"],
    ...extra,
  };
}

const dump = {
  id: "dump1", uid: "crew1", jobId: "job1", tenantId: "heartwood", companyId: "heartwood",
  paidPersonally: false, supplier: "Remondis", tonnes: 8.2, amountInc: 88.4,
  path: "tenants/heartwood/jobs/job1/photos/not-a-receipt",
};
const personal = {
  id: "re1", uid: "crew1", jobId: "job1", tenantId: "heartwood", companyId: "heartwood",
  paidPersonally: true, supplier: "Caltex", amountInc: 62.5,
};
const claim = {
  id: "rcabc", uid: "crew1", jobId: "job1", tenantId: "heartwood", companyId: "heartwood",
  category: "tip-fees", paidWith: "personal-card", supplier: "Tip claim shop", amountCents: 5000,
  receiptPath: "reimbursements/crew1/rcabc/receipt.jpg",
};
const ambiguous = {
  id: "amb1", uid: "crew1", jobId: "job1", tenantId: "heartwood", companyId: "heartwood",
  supplier: "Mystery Dump", tonnes: 2, amountInc: 15,
};
const quote = {
  companyId: "heartwood", tenantId: "heartwood", totalEx: 1840.5,
  lines: [{ label: "Excavator", qty: 4, unit: "hour", rate: 186.25, amount: 745 }],
};

function world(extra = {}) {
  const calls = { jobs: [], photos: [], receipts: [], reads: [], stats: [], send: [], mail: [], rate: [] };
  const stamps = new Map();
  const users = {
    [ALEX_UID]: { profile: null, heartwoodGrant: false, email: "alex@heartwoodew.com", name: "Alex" },
    crew1: { profile: { role: "operator", companyId: "heartwood", tenantId: "heartwood", name: "Sam" }, email: "sam@heartwoodew.com" },
    lab1: { profile: { role: "labourer", companyId: "heartwood", tenantId: "heartwood", name: "Lee" }, email: "lee@heartwoodew.com" },
    sup1: { profile: { role: "supervisor", companyId: "heartwood", tenantId: "heartwood", name: "Sue" }, email: "sue@heartwoodew.com" },
    bare: { profile: { role: "admin", companyId: "heartwood", tenantId: "heartwood", name: "Nora" }, heartwoodGrant: false, email: "nora@heartwoodew.com" },
    bravoAdmin: { profile: { role: "admin", companyId: "bravo", tenantId: "bravo", name: "Bea" }, email: "bea@bravo.test" },
    bravoOp: { profile: { role: "operator", companyId: "bravo", tenantId: "bravo", name: "Riley" }, email: "riley@bravo.test" },
  };
  const jobs = { job1: job(), ...(extra.jobs || {}) };
  const photos = extra.photos || [{
    path: "tenants/heartwood/jobs/job1/photos/pSite01",
    contentType: "image/jpeg",
    size: 3,
    customMetadata: { purpose: "job-photo" },
  }, {
    path: "tenants/heartwood/jobs/job1/photos/pReceipt",
    contentType: "image/jpeg",
    size: 4,
    customMetadata: { purpose: "receipt", receiptId: "hid" },
  }];
  const receipts = extra.receipts || [dump, personal, claim, ambiguous, { ...dump, id: "other", jobId: "job9", supplier: "Other tip" }];
  const deps = {
    now: () => NOW,
    env: { INVITE_EMAIL_ENABLED: "true" },
    allowLiveMail: true,
    attachmentBudget: extra.budget,
    async getCaller(uid) { return users[uid] || { profile: null, heartwoodGrant: false, email: "" }; },
    async getJob(id) { calls.jobs.push(id); return jobs[id] ? { ...jobs[id] } : null; },
    async getCompany(id) {
      if (id === "bravo") return { name: "Bravo Civil", email: extra.companyEmail === undefined ? "office@bravo.test" : extra.companyEmail };
      return { name: "Heartwood Earthworx", email: "alex@heartwoodew.com" };
    },
    async listPhotos(row) { calls.photos.push(row.id); return photos.filter(item => item.path.includes(`/jobs/${row.id}/`)); },
    async listReceipts() { calls.receipts.push(true); return receipts; },
    async listDocuments() { return [{ id: "plan", name: "Site plan", visibility: "crew", companyId: "heartwood" }, { id: "inv", name: "Invoice $1840.pdf", visibility: "office", companyId: "heartwood" }]; },
    async getQuote() { return quote; },
    async statObject(path) {
      calls.stats.push(path);
      if (path.endsWith("/original")) return { size: extra.receiptSize || 3, contentType: "image/jpeg" };
      const row = photos.find(item => item.path === path);
      return { size: row ? row.size : 0, contentType: "image/jpeg" };
    },
    async readObject(path) {
      calls.reads.push(path);
      const bytes = path.endsWith("/original") ? DOCKET : PHOTO;
      return { bytes, contentType: "image/jpeg", size: bytes.length };
    },
    async claimRate({ uid, now }) {
      calls.rate.push(uid);
      const decision = jobEmailRateDecision(stamps.get(uid) || [], now);
      if (!decision.ok) return { ok: false };
      stamps.set(uid, decision.stamps);
      return { ok: true };
    },
    async sendResend(payload, key) {
      calls.send.push({ payload, key });
      return { ok: true, id: "em_job" };
    },
    async writeMail(col, doc) { calls.mail.push({ col, doc }); },
  };
  return { deps, calls, users, jobs };
}

function payloadOf(calls) {
  assert.equal(calls.send.length, 1);
  return calls.send[0].payload;
}

test("from name is the company via CallUp, and reply-to is the company then the sender", () => {
  assert.equal(jobEmailFrom("Bravo Civil"), "Bravo Civil via CallUp <noreply@callupapp.com.au>");
  assert.equal(jobEmailFrom("Heartwood Earthworx"), "Heartwood Earthworx via CallUp <noreply@callupapp.com.au>");
  assert.equal(jobEmailFrom("Bad\r\nBcc: x <y>"), "Bad Bcc: x y via CallUp <noreply@callupapp.com.au>");
  assert.equal(jobEmailReplyTo({ companyEmail: "Office@Bravo.test", senderEmail: "bea@bravo.test" }), "office@bravo.test");
  assert.equal(jobEmailReplyTo({ companyEmail: "", senderEmail: "Bea@Bravo.test" }), "bea@bravo.test");
  assert.equal(jobEmailReplyTo({ companyEmail: "not-an-email", senderEmail: "bea@bravo.test" }), "bea@bravo.test");
  assert.equal(jobEmailAppUrl("heartwood"), "https://jobs.heartwoodew.com/app/");
  assert.equal(jobEmailAppUrl("bravo"), "https://app.callupapp.com.au/app/");
  assert.match(jobEmailFailureText("rate-limited"), /Wait an hour/);
  assert.equal(JOB_EMAIL_HOURLY_LIMIT, 20);
});

test("an admin sends photos and the dump receipt, never a reimbursement or an unclear docket", async () => {
  const { deps, calls } = world();
  const result = await sendJobEmail({ callerUid: ALEX_UID, jobId: "job1", to: "Jo@Orbit.example", cc: "accounts@orbit.example" }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.attached, 2);
  const payload = payloadOf(calls);
  assert.equal(payload.from, "Heartwood Earthworx via CallUp <noreply@callupapp.com.au>");
  assert.equal(payload.reply_to, "alex@heartwoodew.com");
  assert.deepEqual(payload.to, ["jo@orbit.example"]);
  assert.deepEqual(payload.cc, ["accounts@orbit.example"]);
  assert.match(payload.subject, /^Job: Spoil removal/);
  assert.match(payload.text, /\$1,840\.50/);
  assert.match(payload.text, /\$88\.40 inc GST/);
  assert.match(payload.text, /Site plan/);
  assert.doesNotMatch(payload.text, /Caltex|Tip claim shop|Mystery Dump/);
  assert.doesNotMatch(payload.text, /tenants\/|firebasestorage|X-Goog-|token=/);
  const names = payload.attachments.map(file => file.filename);
  assert.equal(names.some(name => /Remondis/.test(name)), true);
  assert.equal(names.some(name => /Caltex|Mystery|claim/.test(name)), false);
  assert.deepEqual(calls.reads, [
    "tenants/heartwood/jobs/job1/photos/pSite01",
    "tenants/heartwood/receipts/dump1/original",
  ]);
  assert.equal(calls.reads.includes(dump.path), false);
  assert.equal(payload.attachments[0].content, Buffer.from(PHOTO).toString("base64"));
  assert.equal(JSON.stringify(calls.mail).includes(payload.attachments[0].content), false);
  assert.equal(calls.mail[0].col, "jobMail");
  assert.equal(calls.mail[0].doc.kind, "job-email");
  assert.equal(calls.mail[0].doc.text, undefined);
});

test("crew and labourers get no prices and no receipts", async () => {
  for (const [uid, role] of [["crew1", "operator"], ["lab1", "labourer"]]) {
    const { deps, calls, jobs } = world();
    jobs.job1 = job({ assigned: [uid] });
    const result = await sendJobEmail({ callerUid: uid, jobId: "job1", to: "jo@orbit.example" }, deps);
    assert.equal(result.ok, true, role);
    const payload = payloadOf(calls);
    assert.equal(payload.attachments.length, 1);
    assert.doesNotMatch(payload.text, /\$|186\.25|1,840|88\.40|Caltex|Remondis|Dump receipts|Invoice/);
    assert.match(payload.text, /\[price removed\]/);
    assert.match(payload.text, /Site plan/);
    assert.doesNotMatch(payload.text, /Invoice \$1840/);
    assert.deepEqual(calls.reads, ["tenants/heartwood/jobs/job1/photos/pSite01"]);
  }
});

test("a supervisor who can see prices gets the dump receipt; another company and a stranger do not", async () => {
  const own = world();
  own.jobs.job1 = job({ assigned: ["sup1"] });
  const sent = await sendJobEmail({ callerUid: "sup1", jobId: "job1", to: "jo@orbit.example" }, own.deps);
  assert.equal(sent.ok, true);
  assert.equal(payloadOf(own.calls).attachments.length, 2);
  assert.match(payloadOf(own.calls).text, /Remondis/);

  const other = world();
  const denied = await sendJobEmail({ callerUid: "bravoAdmin", jobId: "job1", to: "jo@orbit.example" }, other.deps);
  assert.deepEqual(denied, { ok: false, reason: "not-allowed" });
  assert.equal(other.calls.send.length, 0);
  assert.equal(other.calls.photos.length, 0);

  const stranger = world();
  const crew = await sendJobEmail({ callerUid: "crew1", jobId: "job1", to: "jo@orbit.example" }, {
    ...stranger.deps,
    async getJob() { return job({ assigned: ["someone-else"] }); },
  });
  assert.equal(crew.reason, "not-allowed");
  assert.equal(stranger.calls.send.length, 0);

  const bare = world();
  const ungranted = await sendJobEmail({ callerUid: "bare", jobId: "job1", to: "jo@orbit.example" }, bare.deps);
  assert.equal(ungranted.reason, "not-allowed");
  assert.equal(bare.calls.send.length, 0);
});

test("recipients are real emails, five at most", async () => {
  const { deps, calls } = world();
  assert.equal((await sendJobEmail({ callerUid: ALEX_UID, jobId: "job1", to: "" }, deps)).reason, "invalid-recipient");
  assert.equal((await sendJobEmail({ callerUid: ALEX_UID, jobId: "job1", to: "not-an-email" }, deps)).reason, "invalid-recipient");
  assert.equal((await sendJobEmail({ callerUid: "", jobId: "job1", to: "jo@orbit.example" }, deps)).reason, "unauthenticated");
  const six = ["a", "b", "c", "d", "e", "f"].map(n => `${n}@orbit.example`).join(", ");
  assert.equal((await sendJobEmail({ callerUid: ALEX_UID, jobId: "job1", to: six }, deps)).reason, "invalid-recipient");
  const five = await sendJobEmail({
    callerUid: ALEX_UID, jobId: "job1",
    to: "a@orbit.example, b@orbit.example",
    cc: "b@orbit.example, c@orbit.example, d@orbit.example, e@orbit.example",
  }, deps);
  assert.equal(five.ok, true);
  assert.deepEqual(payloadOf(calls).to, ["a@orbit.example", "b@orbit.example"]);
  assert.deepEqual(payloadOf(calls).cc, ["c@orbit.example", "d@orbit.example", "e@orbit.example"]);
  assert.equal(calls.jobs.length, 1);
});

test("twenty emails an hour are allowed, and the next one is not sent", async () => {
  const { deps, calls } = world();
  for (let i = 0; i < 20; i++) {
    const result = await sendJobEmail({ callerUid: ALEX_UID, jobId: "job1", to: "jo@orbit.example" }, deps);
    assert.equal(result.ok, true, String(i));
  }
  const blocked = await sendJobEmail({ callerUid: ALEX_UID, jobId: "job1", to: "jo@orbit.example" }, deps);
  assert.deepEqual(blocked, { ok: false, reason: "rate-limited" });
  assert.equal(calls.send.length, 20);
  const later = jobEmailRateDecision(
    calls.rate.slice(0, 20).map(() => NOW.getTime()),
    new Date(NOW.getTime() + 60 * 60 * 1000),
  );
  assert.equal(later.ok, true);
});

test("files over 20 MB are named as CallUp links, not public storage urls", async () => {
  const { deps, calls } = world({
    budget: 10,
    photos: [
      { path: "tenants/heartwood/jobs/job1/photos/small", contentType: "image/jpeg", size: 8, customMetadata: { purpose: "job-photo" } },
      { path: "tenants/heartwood/jobs/job1/photos/wide", contentType: "image/jpeg", size: 12, customMetadata: { purpose: "job-photo" }, fileName: "Wide shot.jpg" },
    ],
    receipts: [],
  });
  const result = await sendJobEmail({ callerUid: ALEX_UID, jobId: "job1", to: "jo@orbit.example" }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.attached, 1);
  assert.equal(result.overflowCount, 1);
  const payload = payloadOf(calls);
  assert.equal(payload.attachments.length, 1);
  assert.match(payload.text, /Photos:/);
  assert.match(payload.text, /Wide shot\.jpg|Photo 2\.jpg/);
  assert.match(payload.text, /https:\/\/jobs\.heartwoodew\.com\/app\//);
  assert.match(payload.text, /signed in to this company/);
  assert.doesNotMatch(payload.text, /tenants\/|firebasestorage|token=|X-Goog-/);
  assert.deepEqual(calls.reads, ["tenants/heartwood/jobs/job1/photos/small"]);
});

test("mail stays off unless invite email is enabled, and a test cannot send live", async () => {
  const held = world();
  held.deps.env = {};
  held.deps.allowLiveMail = false;
  const quiet = await sendJobEmail({ callerUid: ALEX_UID, jobId: "job1", to: "jo@orbit.example" }, held.deps);
  assert.deepEqual(quiet, { ok: false, reason: "not-sent" });
  assert.equal(held.calls.send.length, 0);
  assert.equal(held.calls.photos.length, 0);

  const allowed = world();
  allowed.deps.env = { INVITE_EMAIL_ENABLED: "true", INVITE_EMAIL_ALLOW_TO: "callup932+" };
  const blocked = await sendJobEmail({ callerUid: ALEX_UID, jobId: "job1", to: "jo@orbit.example" }, allowed.deps);
  assert.equal(blocked.reason, "not-sent");
  assert.equal(allowed.calls.send.length, 0);

  await assert.rejects(() => queueJobEmail({
    to: ["jo@orbit.example"], cc: [], subject: "Job", text: "Hello", from: jobEmailFrom("Heartwood Earthworx"),
  }, {
    env: { NODE_TEST_CONTEXT: "child", INVITE_EMAIL_ENABLED: "true" },
    allowLiveMail: true,
    sendResend: () => { throw new Error("should not send"); },
  }), /refusing live job email under test/);
});

test("the callable reuses the invite mail secret and the rate collection is closed", () => {
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const handler = index.slice(index.indexOf("export const sendJobEmail = onCall"), index.indexOf("export const inviteEmailWorker"));
  assert.match(handler, /secrets: \[RESEND_API_KEY\]/);
  assert.match(handler, /INVITE_EMAIL_ENABLED/);
  assert.match(handler, /jobEmailRate/);
  assert.match(handler, /NODE_TEST_CONTEXT/);
  assert.doesNotMatch(handler, /nodemailer|smtp|createTransport|defineSecret\(/);
  assert.doesNotMatch(index, /defineSecret\("JOB_EMAIL/);
  const rules = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const prod = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/jobEmailRate\/\{uid\} \{\s*allow read, write: if false;/);
  assert.match(prod, /match \/jobEmailRate\/\{uid\} \{\s*allow read, write: if false;/);
  assert.match(rules, /match \/jobMail\/\{id\} \{\s*allow read, write: if false;/);
  assert.match(prod, /match \/jobMail\/\{id\} \{\s*allow read, write: if false;/);
  const storage = readFileSync(new URL("../emulator/storage.rules", import.meta.url), "utf8");
  assert.doesNotMatch(storage, /allow read: if true/);
});
