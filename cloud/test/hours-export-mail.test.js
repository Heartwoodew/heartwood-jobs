import test from "node:test";
import assert from "node:assert/strict";
import {
  HOURS_MAX_TRIES, hoursBody, hoursDue, hoursEmailPayload, hoursMailOpen, hoursRecipient, hoursSubject, processHoursExport,
} from "../functions/hours-export-mail.js";

const ID = "hxabcdefghij012345";
const NOW = Date.parse("2026-11-28T10:00:00Z");
const XLSX = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from("fake xlsx body")]);
const ON = { INVITE_EMAIL_ENABLED: "true" };

function exportDoc(over = {}) {
  return {
    weekStart: "2026-11-23", weekEnd: "2026-11-29", to: "accounts@heartwoodew.com", fileName: "Heartwood_hours_2026-11-23.xlsx",
    storagePath: `hoursExports/${ID}/Heartwood_hours_2026-11-23.xlsx`, people: 4, totalHours: 152.5, status: "queued", attempts: 0,
    createdBy: "u1", createdByName: "Alex", companyId: "heartwood", companyName: "Heartwood", ...over,
  };
}

// An in-memory Firestore stand-in: claim runs decide() on the stored doc and applies the patch, like a transaction.
function harness(initial, { env = ON, company = {}, bytes = XLSX, sendResult = { ok: true, id: "msg_123" }, downloadError = null } = {}) {
  const store = { doc: initial ? { ...initial } : null };
  const calls = { sent: [], downloads: [] };
  const deps = {
    now: () => NOW,
    env,
    loadCompany: async () => company,
    claim: async (id, decide) => {
      const out = await decide(store.doc);
      if (!out) return false;
      store.doc = { ...store.doc, ...out.patch };
      return out.held ? { held: out.held } : true;
    },
    download: async path => { calls.downloads.push(path); if (downloadError) throw new Error(downloadError); return bytes; },
    send: async (payload, key) => { calls.sent.push({ payload, key }); return sendResult; },
    finish: async (id, patch) => { store.doc = { ...store.doc, ...patch }; },
  };
  return { store, calls, deps };
}

test("Heartwood goes to accounts@heartwoodew.com only; same subject and body as the old mailer", async () => {
  const h = harness(exportDoc());
  const r = await processHoursExport(ID, h.deps);
  assert.equal(r.action, "sent");
  assert.equal(h.calls.sent.length, 1);
  const { payload, key } = h.calls.sent[0];
  assert.deepEqual(payload.to, ["accounts@heartwoodew.com"]);
  assert.equal(payload.subject, "Timesheet hours 23/11/2026 to 29/11/2026 - Heartwood [HWH abcdefgh]");
  assert.match(payload.text, /^Hi Nicole,/);
  assert.match(payload.text, /\(4 staff, 152\.50 hours total\)/);
  assert.match(payload.text, /Thanks,\nAlex\nHeartwood$/);
  assert.equal(payload.attachments[0].filename, "Heartwood_hours_2026-11-23.xlsx");
  assert.equal(Buffer.from(payload.attachments[0].content, "base64").equals(XLSX), true);
  assert.equal(key, `hours-export-${ID}`);
  assert.match(payload.from, /noreply@callupapp\.com\.au>$/);
  assert.equal(h.store.doc.status, "sent");
  assert.equal(h.store.doc.via, "resend");
  assert.equal(h.store.doc.messageId, "msg_123");
  assert.equal(h.store.doc.attempts, 1);
  assert.deepEqual(h.calls.downloads, [`hoursExports/${ID}/Heartwood_hours_2026-11-23.xlsx`]);
});

test("another company goes to its own accounts address with no Heartwood wording", async () => {
  const doc = exportDoc({ companyId: "acme", companyName: "Acme Civil", to: "accounts@acme.test", fileName: "Acme_hours.xlsx", storagePath: `hoursExports/${ID}/Acme_hours.xlsx` });
  const h = harness(doc, { company: { name: "Acme Civil", email: "office@acme.test" } });
  const r = await processHoursExport(ID, h.deps);
  assert.equal(r.action, "sent");
  const { payload } = h.calls.sent[0];
  assert.deepEqual(payload.to, ["accounts@acme.test"]);
  assert.match(payload.subject, / - Acme Civil \[HWH /);
  assert.match(payload.from, /^Acme Civil via CallUp </);
  assert.equal(payload.reply_to, "office@acme.test");
  assert.doesNotMatch(JSON.stringify(payload), /Heartwood|heartwoodew|Nicole|ServiceM8/i);
  assert.match(payload.text, /Thanks,\nAcme Civil\n$/);
});

test("another company can never be sent to Heartwood's mailbox or a bad address", async () => {
  for (const to of ["accounts@heartwoodew.com", "ACCOUNTS@heartwoodew.com", "not-an-email", ""]) {
    const h = harness(exportDoc({ companyId: "acme", companyName: "Acme", to, fileName: "A.xlsx", storagePath: `hoursExports/${ID}/A.xlsx` }));
    const r = await processHoursExport(ID, h.deps);
    assert.equal(r.action, "held", to);
    assert.equal(h.calls.sent.length, 0);
    assert.equal(h.store.doc.status, "failed");
    assert.equal(h.store.doc.attempts, HOURS_MAX_TRIES);
  }
});

test("Heartwood export to any other address is held", async () => {
  const h = harness(exportDoc({ to: "someone@else.test" }));
  const r = await processHoursExport(ID, h.deps);
  assert.equal(r.action, "held");
  assert.equal(h.calls.sent.length, 0);
});

test("test and preview companies never send real email", async () => {
  for (const [doc, company] of [
    [exportDoc({ companyId: "t1", companyName: "T", to: "a@b.test", fileName: "A.xlsx", storagePath: `hoursExports/${ID}/A.xlsx` }), { isTest: true }],
    [exportDoc({ companyId: "t1", companyName: "T", to: "a@b.test", fileName: "A.xlsx", storagePath: `hoursExports/${ID}/A.xlsx`, isTest: true }), {}],
    [exportDoc({ status: "preview" }), {}],
  ]) {
    const h = harness(doc, { company });
    const r = await processHoursExport(ID, h.deps);
    assert.notEqual(r.action, "sent");
    assert.equal(h.calls.sent.length, 0);
    assert.equal(h.calls.downloads.length, 0);
  }
  assert.equal(hoursRecipient({ companyId: "x", to: "a@b.test", isTest: true }, {}).reason, "test-company");
});

test("mail switch off or outside the allow list sends nothing and leaves the export queued", async () => {
  const off = harness(exportDoc(), { env: {} });
  assert.equal((await processHoursExport(ID, off.deps)).action, "none");
  assert.equal(off.store.doc.status, "queued");
  assert.equal(off.calls.sent.length, 0);
  const allow = harness(exportDoc(), { env: { INVITE_EMAIL_ENABLED: "true", INVITE_EMAIL_ALLOW_TO: "callup932+" } });
  assert.equal((await processHoursExport(ID, allow.deps)).action, "none");
  assert.equal(allow.calls.sent.length, 0);
  const ok = harness(exportDoc({ companyId: "acme", companyName: "Acme", to: "callup932+hours@gmail.com", fileName: "A.xlsx", storagePath: `hoursExports/${ID}/A.xlsx` }),
    { env: { INVITE_EMAIL_ENABLED: "true", INVITE_EMAIL_ALLOW_TO: "callup932+" } });
  assert.equal((await processHoursExport(ID, ok.deps)).action, "sent");
  assert.equal(hoursMailOpen("callup932+x@gmail.com", { INVITE_EMAIL_ENABLED: "true", INVITE_EMAIL_ALLOW_TO: "callup932+" }), true);
  assert.equal(hoursMailOpen("x@gmail.com", { INVITE_EMAIL_ENABLED: "true", INVITE_EMAIL_ALLOW_TO: "callup932+" }), false);
});

test("idempotent: a second run after sent never sends again, and a claimed export is not claimed twice", async () => {
  const h = harness(exportDoc());
  assert.equal((await processHoursExport(ID, h.deps)).action, "sent");
  assert.equal((await processHoursExport(ID, h.deps)).action, "none");
  assert.equal(h.calls.sent.length, 1);
  const busy = harness(exportDoc({ status: "sending", attempts: 1, updatedAt: new Date(NOW - 60 * 1000).toISOString() }));
  assert.equal((await processHoursExport(ID, busy.deps)).action, "none");
  assert.equal(busy.calls.sent.length, 0);
});

test("a send stuck in sending for over 30 minutes is retried without using another attempt, same Idempotency-Key", async () => {
  const h = harness(exportDoc({ status: "sending", attempts: 2, updatedAt: new Date(NOW - 31 * 60 * 1000).toISOString() }));
  const r = await processHoursExport(ID, h.deps);
  assert.equal(r.action, "sent");
  assert.equal(h.store.doc.attempts, 2);
  assert.equal(h.calls.sent[0].key, `hours-export-${ID}`);
});

test("a failed send is marked failed with the reason, then retried, and gives up after 5 attempts", async () => {
  const h = harness(exportDoc(), { sendResult: { ok: false, reason: "resend-422", error: "bad thing" } });
  assert.equal((await processHoursExport(ID, h.deps)).action, "failed");
  assert.equal(h.store.doc.status, "failed");
  assert.match(h.store.doc.error, /resend-422|bad thing/);
  assert.equal(h.store.doc.attempts, 1);
  for (let i = 0; i < 6; i += 1) await processHoursExport(ID, h.deps);
  assert.equal(h.store.doc.attempts, HOURS_MAX_TRIES);
  assert.equal(h.calls.sent.length, HOURS_MAX_TRIES);
  assert.equal(hoursDue(h.store.doc, NOW).due, false);
  assert.doesNotMatch(JSON.stringify(h.store.doc), /re_[A-Za-z0-9]/);
});

test("a missing or non-xlsx file fails without emailing", async () => {
  const gone = harness(exportDoc(), { downloadError: "No such object" });
  assert.equal((await processHoursExport(ID, gone.deps)).action, "failed");
  assert.equal(gone.calls.sent.length, 0);
  assert.equal(gone.store.doc.status, "failed");
  const junk = harness(exportDoc(), { bytes: Buffer.from("hello") });
  assert.equal((await processHoursExport(ID, junk.deps)).action, "failed");
  assert.equal(junk.calls.sent.length, 0);
  assert.equal(junk.store.doc.attempts, HOURS_MAX_TRIES);
});

test("bad ids and bad storage paths are refused", async () => {
  const h = harness(exportDoc({ storagePath: "hoursExports/hxOTHER00000000000/x.xlsx" }));
  assert.equal((await processHoursExport(ID, h.deps)).action, "held");
  assert.equal(h.calls.sent.length, 0);
  assert.equal((await processHoursExport("../etc", h.deps)).action, "skipped");
});

test("hoursDue and pure helpers", () => {
  assert.equal(hoursDue({ status: "sent" }, NOW).due, false);
  assert.equal(hoursDue({ status: "queued" }, NOW).due, true);
  assert.equal(hoursDue({ status: "failed", attempts: 3 }, NOW).due, true);
  assert.equal(hoursDue({ status: "failed", attempts: 5 }, NOW).due, false);
  assert.equal(hoursDue({ status: "sending", updatedAt: new Date(NOW - 5 * 60000).toISOString() }, NOW).due, false);
  assert.equal(hoursDue({ status: "weird" }, NOW).due, false);
  assert.equal(hoursSubject("Acme", "2026-11-23", "2026-11-29", ID), "Timesheet hours 23/11/2026 to 29/11/2026 - Acme [HWH abcdefgh]");
  assert.match(hoursBody({ weekStart: "2026-11-23", weekEnd: "2026-11-29", people: 1, totalHours: 8 }, "Acme"), /Hi,\n\nAttached/);
  const p = hoursEmailPayload({ id: ID, d: exportDoc(), company: {}, to: "accounts@heartwoodew.com", subjectName: "Heartwood", content: "QQ==", env: {} });
  assert.equal(p.reply_to, "alex@heartwoodew.com");
});
