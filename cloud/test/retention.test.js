import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALEX_UID } from "../../app/features/cloud-storage.js";
import {
  ACCOUNTING_FIELDS, MAX_EXPORT_BYTES, SCHEDULING_APPROVED, addCalendarMonths,
  buildOperationalExport, cancelScheduledDeletion, issueExportGrant, restoreOperationalCopy,
  retentionAdminText, retentionView, runRetention,
} from "../../app/features/cloud-retention.js";
import { retentionSweepHandler } from "../functions/lib/retention-run.js";
import { handlePhotoIntake } from "../functions/lib/photo-intake.js";
import { fetchGmailAttachment } from "../functions/lib/gmail-stub.js";
import { handleXeroQueue } from "../functions/pro/xero-queue.js";

const ON = { schedulingApproved: true, purgeEnabled: true, heartwoodApproved: true };
const ON_NOT_HEARTWOOD = { schedulingApproved: true, purgeEnabled: true, heartwoodApproved: false };
const DUE = new Date("2026-11-05T14:00:00.000Z"); // 2026-11-06 00:00 Brisbane
const BEFORE = new Date("2026-11-05T13:30:00.000Z"); // 2026-11-05 23:30 Brisbane
const PURGE_AT = new Date("2026-11-19T14:00:00.000Z"); // 2026-11-20 00:00 Brisbane
const STILL_GRACE = new Date("2026-11-18T14:00:00.000Z"); // 2026-11-19 00:00 Brisbane

function admin(uid = ALEX_UID) {
  return { ok: true, uid, tenantId: "heartwood", role: "admin", rulesAdmin: true, finance: true, canSeeMoney: true, plan: "base" };
}
function otherAdmin() {
  return { ok: true, uid: "adm2", tenantId: "otherco", role: "admin", rulesAdmin: true, finance: false, canSeeMoney: true, plan: "base" };
}
function operator() {
  return { ok: true, uid: "op1", tenantId: "heartwood", role: "operator", rulesAdmin: false, finance: false, canSeeMoney: false, plan: "base" };
}

function completedJob(over = {}) {
  return {
    id: "job1",
    status: "Done",
    completedAt: "2026-08-06T00:00:00+10:00",
    client: "Orbit Homes (Qld) Pty Ltd",
    address: "12 Creek Rd",
    description: "Spoil removal",
    invoiceNo: "5442",
    invoiceAmount: 2000,
    xeroStatus: "draft",
    xeroInvoiceId: "inv-1",
    poAmount: 1800,
    quoteAmount: 1800,
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...over,
  };
}

test("calendar months clamp month ends and the 3 month boundary is Brisbane-local", () => {
  assert.equal(addCalendarMonths("2026-08-06", 3), "2026-11-06");
  assert.equal(addCalendarMonths("2026-11-30", 3), "2027-02-28");
  assert.equal(addCalendarMonths("2023-11-30", 3), "2024-02-29");
  const before = retentionView(completedJob(), BEFORE);
  const at = retentionView(completedJob(), DUE);
  assert.equal(before.due, false);
  assert.equal(before.expiresOn, "2026-11-06");
  assert.equal(at.due, true);
  assert.equal(at.state, "due");
  const warn = retentionView(completedJob(), new Date("2026-10-22T14:00:00.000Z"));
  const notWarn = retentionView(completedJob(), new Date("2026-10-22T13:00:00.000Z"));
  assert.equal(warn.warning, true);
  assert.equal(notWarn.warning, false);
});

test("missing, locale and updatedAt timestamps do not delete", () => {
  const flags = ON;
  const cases = [
    completedJob({ completedAt: "", date: "" }),
    completedJob({ completedAt: "not-a-date", date: null }),
    { id: "open", status: "Scheduled", updatedAt: "2020-01-01T00:00:00.000Z", log: [{ at: "6/11/2024, 9:00 am", text: "note" }] },
  ];
  for (const job of cases) {
    const result = runRetention({ jobs: [job], xeroQueue: [{ id: "q" }], reimbursements: [{ id: "led" }] }, { flags, now: DUE });
    assert.equal(result.purged.length, 0);
    assert.equal(result.softDeleted.length, 0);
    assert.equal(result.state.jobs[0].description || result.state.jobs[0].status, job.description || job.status);
    assert.equal(result.state.xeroQueue.length, 1);
    assert.equal(result.state.reimbursements.length, 1);
    assert.ok(result.skipped.some(s => s.reason === "missing-anchor"));
  }
});

test("scheduling stays off unless both the source constant and flags allow it", () => {
  assert.equal(SCHEDULING_APPROVED, false);
  const state = { jobs: [completedJob()] };
  const off = runRetention(state, { flags: { schedulingApproved: false, purgeEnabled: true, heartwoodApproved: true }, now: DUE });
  assert.equal(off.ran, false);
  assert.equal(off.reason, "scheduling-not-approved");
  assert.equal(off.state.jobs[0].description, "Spoil removal");
  const handler = retentionSweepHandler(state, {
    RETENTION_SCHEDULING_APPROVED: "true",
    RETENTION_PURGE_ENABLED: "true",
    HEARTWOOD_RETENTION_APPROVED: "true",
    now: DUE,
  });
  assert.equal(handler.ran, false);
  assert.equal(handler.state.jobs[0].invoiceAmount, 2000);
});

test("Heartwood historical rows stay put when only other tenants are approved", () => {
  const old = completedJob({ completedAt: "2020-01-15T00:00:00.000Z", description: "keep me" });
  const other = completedJob({ id: "o1", tenantId: "otherco", completedAt: "2020-01-15T00:00:00.000Z", description: "other" });
  const result = runRetention({ jobs: [old, other], photos: [{ path: "tenants/heartwood/jobs/job1/photos/p1", jobId: "job1", tenantId: "heartwood" }] }, {
    flags: ON_NOT_HEARTWOOD, now: DUE,
  });
  assert.equal(result.state.jobs.find(j => j.id === "job1").description, "keep me");
  assert.equal(result.state.jobs.find(j => j.id === "o1").retention.state, "soft-deleted");
  assert.equal(result.state.photos.length, 1);
  assert.ok(result.skipped.some(s => s.id === "job1" && s.reason === "heartwood-not-approved"));
});

test("soft-delete, grace, purge, restore and cancel keep accounting fields", () => {
  const state = {
    jobs: [completedJob()],
    photos: [{ path: "tenants/heartwood/jobs/job1/photos/p1", jobId: "job1", tenantId: "heartwood", bytes: new Uint8Array([1, 2]) }],
    receipts: [{ id: "r1", jobId: "job1", uid: "op1", amountInc: 44.5, supplier: "Bunnings", createdAtIso: "2026-08-01T00:00:00.000Z" }],
    receiptChunks: [{ id: "r1_0", rid: "r1", data: "abc" }],
    quotes: [{ id: "q1", jobId: "job1", totalEx: 1800, updatedAtIso: "2026-08-01T00:00:00.000Z" }],
    users: [{ id: ALEX_UID, role: "admin" }],
    xeroQueue: [{ id: "xq", type: "check" }],
    reimbursements: [{ id: "r1", amountInc: 44.5 }],
    meta: [{ id: "profitHistory", months: [1] }, { id: "quoteRates", travelPerKm: 2 }, { id: "invHist_2026", rows: 3 }],
    timesheets: [{ id: "ts1", hours: 8 }],
  };
  const early = runRetention(state, { flags: ON, now: BEFORE });
  assert.equal(early.softDeleted.length, 0);
  assert.equal(early.state.jobs[0].description, "Spoil removal");

  const soft = runRetention(state, { flags: ON, now: DUE });
  assert.deepEqual(soft.softDeleted.map(x => x.id), ["job1"]);
  assert.equal(soft.state.jobs[0].description, "Spoil removal");
  assert.equal(soft.state.jobs[0].invoiceAmount, 2000);
  assert.equal(soft.state.receipts[0].amountInc, 44.5);

  const grace = runRetention(soft.state, { flags: ON, now: STILL_GRACE, deleteObject() { throw new Error("should not purge yet"); } });
  assert.equal(grace.purged.length, 0);
  assert.equal(grace.state.jobs[0].description, "Spoil removal");

  let thrown = 0;
  const failed = runRetention(soft.state, {
    flags: ON, now: PURGE_AT,
    deleteObject() { thrown += 1; if (thrown === 1) throw new Error("transient"); },
  });
  assert.ok(failed.errors.length >= 1);
  assert.equal(failed.state.jobs[0].description, "Spoil removal");
  assert.equal(failed.state.receiptChunks.length, 1);

  const purged = runRetention(failed.state, { flags: ON, now: PURGE_AT, deleteObject() {} });
  const stub = purged.state.jobs[0];
  assert.equal(stub.retention.state, "purged");
  assert.equal(stub.description, undefined);
  assert.equal(stub.address, undefined);
  assert.equal(stub.invoiceAmount, 2000);
  assert.equal(stub.invoiceNo, "5442");
  assert.equal(stub.xeroStatus, "draft");
  assert.equal(stub.xeroInvoiceId, "inv-1");
  assert.equal(stub.poAmount, 1800);
  assert.equal(stub.quoteAmount, 1800);
  assert.equal(purged.state.receipts.length, 0);
  assert.equal(purged.state.receiptChunks.length, 0);
  assert.equal(purged.state.quotes.length, 0);
  assert.equal(purged.state.photos.length, 0);
  assert.equal(purged.state.xeroQueue.length, 1);
  assert.equal(purged.state.reimbursements[0].amountInc, 44.5);
  assert.equal(purged.state.meta.find(m => m.id === "profitHistory").months[0], 1);
  assert.equal(purged.state.meta.find(m => m.id === "quoteRates").travelPerKm, 2);
  assert.equal(purged.state.timesheets[0].hours, 8);
  assert.equal(purged.state.users.length, 1);

  const again = runRetention(purged.state, { flags: ON, now: PURGE_AT, deleteObject() { throw new Error("no second delete"); } });
  assert.equal(again.purged.length, 0);
  assert.equal(again.errors.length, 0);
  assert.equal(again.state.jobs[0].invoiceAmount, 2000);
  assert.equal(restoreOperationalCopy({ membership: admin(), job: again.state.jobs[0], now: PURGE_AT }).reason, "already-purged");
});

test("admin can cancel before soft-delete and restore during grace; other tenants and operators cannot", () => {
  const job = completedJob();
  const held = cancelScheduledDeletion({ membership: admin(), job, requestedTenantId: "otherco", now: DUE });
  assert.equal(held.reason, "wrong-tenant");
  assert.equal(cancelScheduledDeletion({ membership: operator(), job, now: DUE }).reason, "not-authorised");
  assert.equal(cancelScheduledDeletion({ membership: otherAdmin(), job, now: DUE }).reason, "wrong-tenant");
  const ok = cancelScheduledDeletion({ membership: admin(), job, now: DUE });
  const skipped = runRetention({ jobs: [ok.job] }, { flags: ON, now: PURGE_AT });
  assert.equal(skipped.state.jobs[0].description, "Spoil removal");
  assert.ok(skipped.skipped.some(s => s.reason === "held"));

  const soft = runRetention({ jobs: [job], quotes: [], receipts: [] }, { flags: ON, now: DUE });
  const restored = restoreOperationalCopy({ membership: admin(), job: soft.state.jobs[0], requestedTenantId: "heartwood", now: DUE });
  assert.equal(restored.ok, true);
  const after = runRetention({ jobs: [restored.job] }, { flags: ON, now: PURGE_AT });
  assert.equal(after.state.jobs[0].description, "Spoil removal");
  assert.equal(after.purged.length, 0);
  assert.match(retentionAdminText(retentionView(job, BEFORE)), /not scheduled/i);
  assert.match(retentionAdminText(retentionView(job, BEFORE)), /Xero/);
});

test("unlinked quotes and receipts follow their own dates and quote rates stay", () => {
  const quote = { id: "q-loose", totalEx: 90, updatedAtIso: "2026-08-01T01:00:00.000Z", tenantId: "otherco" };
  const young = { id: "q-new", totalEx: 10, updatedAtIso: "2026-10-01T01:00:00.000Z", tenantId: "otherco" };
  const noDate = { id: "q-blank", tenantId: "otherco", totalEx: 5 };
  const result = runRetention({
    jobs: [], quotes: [quote, young, noDate], meta: [{ id: "quoteRates", travelPerKm: 4 }],
  }, { flags: ON, now: DUE });
  assert.equal(result.state.quotes.find(q => q.id === "q-loose").retention.state, "soft-deleted");
  assert.equal(result.state.quotes.find(q => q.id === "q-new").retention, undefined);
  assert.ok(result.skipped.some(s => s.id === "q-blank" && s.reason === "missing-anchor"));
  assert.equal(result.state.meta[0].travelPerKm, 4);
  assert.ok(ACCOUNTING_FIELDS.includes("invoiceAmount"));
  assert.ok(ACCOUNTING_FIELDS.includes("xeroCheck"));
});

test("export zip is admin-only, tenant-isolated, and omits GST and Xero records", () => {
  const photo = { path: "tenants/heartwood/jobs/job1/photos/p1", jobId: "job1", tenantId: "heartwood", bytes: new Uint8Array([9, 8, 7]) };
  const receipt = {
    id: "r1", jobId: "job1", uid: "op1", amountInc: 12.5, supplier: "Bunnings",
    file: { bytes: new Uint8Array([1, 2, 3]) },
  };
  const quote = { id: "q1", jobId: "job1", totalEx: 100, lines: [{ label: "Travel", amount: 100 }] };
  const denied = buildOperationalExport({ membership: operator(), jobs: [completedJob()], jobId: "job1" });
  assert.equal(denied.reason, "not-authorised");
  assert.equal(denied.zip, undefined);
  const wrong = buildOperationalExport({
    membership: admin(), requestedTenantId: "otherco", jobs: [completedJob()], jobId: "job1",
  });
  assert.equal(wrong.reason, "wrong-tenant");
  const built = buildOperationalExport({
    membership: admin(), scope: "job", jobId: "job1", now: DUE,
    jobs: [completedJob(), { id: "foreign", tenantId: "otherco", description: "secret" }],
    photos: [photo], receipts: [receipt], quotes: [quote],
  });
  assert.equal(built.ok, true);
  assert.equal(built.public, false);
  assert.equal(built.manifest.xero, false);
  assert.equal(built.manifest.schedulingApproved, false);
  assert.match(built.manifest.accountingNote, /5 years/);
  const names = unzip(built.zip);
  assert.ok(names.includes("manifest.json"));
  assert.ok(names.includes("jobs/job1.json"));
  assert.ok(names.includes("photos/job1/p1"));
  assert.ok(names.includes("receipts/r1.json"));
  assert.ok(!names.some(n => n.includes("foreign") || n.includes("xero") || n.includes("profit")));
  const jobJson = JSON.parse(readZip(built.zip, "jobs/job1.json"));
  assert.equal(jobJson.description, "Spoil removal");
  assert.equal(jobJson.invoiceAmount, undefined);
  assert.equal(jobJson.xeroInvoiceId, undefined);
  assert.equal(jobJson.poAmount, undefined);
  const receiptJson = JSON.parse(readZip(built.zip, "receipts/r1.json"));
  assert.equal(receiptJson.amountInc, 12.5);
  assert.equal(receiptJson.accountingRecord, false);
  const quoteJson = JSON.parse(readZip(built.zip, "quotes/q1.json"));
  assert.equal(quoteJson.taxInvoice, false);
  assert.equal(quoteJson.totalEx, 100);
  const tooBig = buildOperationalExport({
    membership: admin(), scope: "job", jobId: "job1", jobs: [completedJob()],
    photos: [{ path: "tenants/heartwood/jobs/job1/photos/big", jobId: "job1", size: MAX_EXPORT_BYTES + 1 }],
  });
  assert.equal(tooBig.reason, "export-too-large");
  assert.equal(tooBig.zip, undefined);
});

test("signed export URLs are short-lived and a public URL is refused", () => {
  const now = new Date("2026-11-06T00:00:00.000Z");
  const meta = { tenantId: "heartwood", path: "tenants/heartwood/_exports/job1.zip" };
  const bad = issueExportGrant({
    membership: admin(), exportMeta: meta, now,
    sign: () => ({ url: "https://storage.googleapis.com/heartwood-9f37f.appspot.com/tenants/heartwood/_exports/job1.zip", public: true }),
  });
  assert.equal(bad.reason, "public-url-refused");
  const unsigned = issueExportGrant({
    membership: admin(), exportMeta: meta, now,
    sign: () => ({ url: "https://storage.googleapis.com/bucket/tenants/heartwood/_exports/job1.zip" }),
  });
  assert.equal(unsigned.reason, "public-url-refused");
  const foreign = issueExportGrant({
    membership: admin(), exportMeta: { tenantId: "otherco", path: "tenants/otherco/_exports/job1.zip" }, now,
    sign: () => ({ url: "https://example.invalid/tenants/otherco/_exports/job1.zip?Expires=1" }),
  });
  assert.equal(foreign.reason, "wrong-tenant");
  assert.equal(issueExportGrant({ membership: operator(), exportMeta: meta, now, sign: () => ({ url: "x?Expires=1" }) }).reason, "not-authorised");
  const issued = issueExportGrant({
    membership: admin(), requestedTenantId: "heartwood", exportMeta: meta, now,
    sign: ({ path, expiresAtMs }) => ({ url: `https://storage.googleapis.com/download?path=${encodeURIComponent(path)}&Expires=${expiresAtMs}` }),
  });
  assert.equal(issued.ok, true);
  assert.equal(issued.public, false);
  assert.equal(issued.ttlSeconds, 15 * 60);
  assert.match(issued.url, /Expires=/);
  assert.ok(!issued.url.includes("otherco"));
});

test("email intake and Pro Xero executor do not call Gmail or Xero", () => {
  const held = handlePhotoIntake({
    mailbox: "alex@heartwoodew.com",
    tenantId: "otherco",
    subject: "[Job Photos] Job #697 – 1 Creek Rd",
  }, { gmailEnabled: false });
  assert.equal(held.reason, "gmail-rights-not-enabled");
  assert.equal(held.tenantId, "heartwood");
  assert.equal(held.ignoredClientTenantId, "otherco");
  assert.equal(held.gmailCalls, 0);
  assert.deepEqual(held.jobWrites, []);
  const still = handlePhotoIntake({
    mailbox: "alex@heartwoodew.com",
    subject: "[Job Photos] Job #697",
  }, { gmailEnabled: true });
  assert.equal(still.reason, "gmail-client-not-configured");
  assert.equal(still.gmailCalls, 0);
  assert.throws(() => fetchGmailAttachment(), /gmail-stub/);
  const spy = { n: 0, async send() { this.n += 1; } };
  const refused = handleXeroQueue([{ id: "1", status: "queued" }], { CALLUP_PLAN: "pro", XERO_PROCESSING_ENABLED: "true" }, spy.send.bind(spy));
  assert.equal(refused.ran, false);
  assert.equal(refused.reason, "not-a-product-feature");
  assert.equal(refused.transportCalls, 0);
  assert.equal(refused.liveXero, false);
  assert.equal(spy.n, 0);
});

function unzip(bytes) {
  const dir = mkdtempSync(join(tmpdir(), "hwzip-"));
  const file = join(dir, "a.zip");
  writeFileSync(file, Buffer.from(bytes));
  const listing = execFileSync("python3", ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print('\\n'.join(z.namelist()))", file], { encoding: "utf8" });
  return listing.trim().split("\n");
}
function readZip(bytes, name) {
  const dir = mkdtempSync(join(tmpdir(), "hwzip-"));
  const file = join(dir, "a.zip");
  writeFileSync(file, Buffer.from(bytes));
  return execFileSync("python3", ["-c", "import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode())", file, name], { encoding: "utf8" });
}
