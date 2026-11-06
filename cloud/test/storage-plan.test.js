import test from "node:test";
import assert from "node:assert/strict";
import {
  ALEX_UID, PATRICK_UID, CALLUP_BASE, planJobPhotoBatch, planReceiptUpload,
  canReadObject, resolveMembership, putPlanned, JOB_PHOTO_MAX_COUNT, RECEIPT_MAX_BYTES,
} from "../../app/features/cloud-storage.js";

const job = { id: "job1", client: "Orbit Homes (Qld) Pty Ltd", assigned: ["op1"], address: "1 Creek Rd" };
const silk = { id: "job2", client: "Silkwood Homes", assigned: ["op1"] };
const otherJob = { id: "job9", tenantId: "otherco", client: "Silkwood Homes", assigned: ["op2"] };

function op(extra = {}) {
  return resolveMembership({ uid: "op1", profile: { role: "operator", name: "Sam", ...extra } });
}
function admin() {
  return resolveMembership({ uid: ALEX_UID, profile: null, requestedTenantId: "otherco", requestedBusinessId: "Silkwood Homes" });
}

test("Base plan has no Xero or invoicing", () => {
  assert.equal(CALLUP_BASE.xero, false);
  assert.equal(CALLUP_BASE.invoicing, false);
  assert.equal(CALLUP_BASE.photos, true);
  assert.equal(CALLUP_BASE.receipts, true);
});

test("profile membership ignores client tenant and business ids", () => {
  const m = resolveMembership({
    uid: "op1",
    profile: { role: "operator", tenantId: "heartwood" },
    requestedTenantId: "otherco",
    requestedBusinessId: "made-up",
  });
  assert.equal(m.tenantId, "heartwood");
  assert.equal(m.finance, false);
  assert.equal(m.ignoredClientTenantId, "otherco");
  assert.equal(admin().tenantId, "heartwood");
  assert.equal(admin().finance, true);
  assert.equal(admin().ignoredClientTenantId, "otherco");
});

test("missing profile tenant stays Heartwood for existing staff", () => {
  assert.equal(op().tenantId, "heartwood");
  assert.equal(resolveMembership({ uid: PATRICK_UID, profile: { role: "operator" } }).rulesAdmin, true);
  assert.equal(resolveMembership({ uid: PATRICK_UID, profile: { role: "operator" } }).finance, true);
  assert.equal(resolveMembership({ uid: "nobody", profile: null }).ok, false);
});

test("assigned operator can plan a job photo and a hostile path is refused before upload", async () => {
  const file = { photoId: "pabc123", type: "image/jpeg", size: 1000 };
  const ok = planJobPhotoBatch({ membership: op(), job, files: [file] });
  assert.equal(ok.ok, true);
  assert.equal(ok.uploads[0].path, "tenants/heartwood/jobs/job1/photos/pabc123");
  assert.equal(ok.uploads[0].metadata.tenantId, "heartwood");
  const calls = [];
  await putPlanned(ok, async (target) => { calls.push(target.path); return target; });
  assert.deepEqual(calls, [ok.uploads[0].path]);

  const hostile = planJobPhotoBatch({
    membership: op(), job, files: [file],
    requestedTenantId: "otherco",
    clientPath: "tenants/otherco/jobs/job1/photos/pabc123",
  });
  assert.equal(hostile.ok, false);
  assert.equal(hostile.reason, "wrong-tenant");
  await assert.rejects(putPlanned(hostile, async () => { throw new Error("upload should not run"); }));
});

test("path alone cannot authorise a read", () => {
  const path = "tenants/heartwood/jobs/job1/photos/pabc123";
  assert.equal(canReadObject({ membership: op(), path }).ok, false);
  assert.equal(canReadObject({ membership: op(), path, job }).ok, true);
  assert.equal(canReadObject({ membership: op(), path, job: otherJob }).ok, false);
  assert.equal(canReadObject({ membership: op(), path: "tenants/otherco/jobs/job9/photos/pabc123", job: otherJob }).reason, "wrong-tenant");
});

test("customer scope and assignment block other business files", () => {
  const scoped = op({ customerIds: ["Orbit Homes (Qld) Pty Ltd"] });
  assert.equal(planJobPhotoBatch({ membership: scoped, job: silk, files: [{ photoId: "p1", type: "image/jpeg", size: 10 }] }).reason, "customer-scope");
  const other = resolveMembership({ uid: "op2", profile: { role: "operator", tenantId: "otherco" } });
  assert.equal(planJobPhotoBatch({ membership: other, job, files: [{ photoId: "p1", type: "image/jpeg", size: 10 }] }).reason, "wrong-tenant");
  const unassigned = resolveMembership({ uid: "op9", profile: { role: "operator" } });
  assert.equal(planJobPhotoBatch({ membership: unassigned, job, files: [{ photoId: "p1", type: "image/jpeg", size: 10 }] }).reason, "not-allowed");
});

test("mime, size and count are enforced and finance paths are refused", () => {
  const membership = op();
  assert.equal(planJobPhotoBatch({ membership, job, files: [{ photoId: "p1", type: "text/plain", size: 10 }] }).reason, "mime-not-allowed");
  assert.equal(planJobPhotoBatch({ membership, job, files: [{ photoId: "p1", type: "image/jpeg", size: 16 * 1024 * 1024 }] }).reason, "too-large");
  assert.equal(planJobPhotoBatch({ membership, job, files: [{ photoId: "../finance/x", type: "image/jpeg", size: 10 }] }).reason, "bad-name");
  const many = Array.from({ length: JOB_PHOTO_MAX_COUNT + 1 }, (_, i) => ({ photoId: `p${i}`, type: "image/jpeg", size: 10 }));
  assert.equal(planJobPhotoBatch({ membership, job, files: many }).reason, "too-many-files");
  assert.equal(canReadObject({ membership, path: "tenants/heartwood/finance/xero/invoice.pdf" }).reason, "finance-denied");
  assert.equal(canReadObject({ membership: admin(), path: "tenants/heartwood/finance/xero/invoice.pdf" }).ok, true);
  assert.equal(canReadObject({ membership: admin(), path: "tenants/otherco/finance/xero/invoice.pdf" }).reason, "wrong-tenant");
});

test("operators can upload their own receipt but cannot read the file or another tenant", () => {
  const membership = op();
  const receipt = { id: "r1", uid: "op1" };
  const file = { type: "image/jpeg", size: 2000 };
  const plan = planReceiptUpload({ membership, receipt, file });
  assert.equal(plan.ok, true);
  assert.equal(plan.path, "tenants/heartwood/receipts/r1/original");
  assert.equal("amountInc" in plan.metadata, false);
  assert.equal(canReadObject({ membership, path: plan.path, receipt }).reason, "receipt-hidden");
  const sup = resolveMembership({ uid: "sup1", profile: { role: "supervisor" } });
  assert.equal(canReadObject({ membership: sup, path: "tenants/heartwood/receipts/r1/original", receipt: { id: "r1", uid: "sup1" } }).ok, true);
  assert.equal(canReadObject({ membership: sup, path: plan.path, receipt }).reason, "receipt-hidden");
  assert.equal(canReadObject({ membership: admin(), path: plan.path, receipt }).ok, true);
  assert.equal(planReceiptUpload({
    membership, receipt, file, requestedTenantId: "otherco",
    clientPath: "tenants/otherco/receipts/r1/original",
  }).reason, "wrong-tenant");
  assert.equal(planReceiptUpload({ membership, receipt, file: { type: "image/gif", size: 10 } }).reason, "mime-not-allowed");
  assert.equal(planReceiptUpload({ membership, receipt, file: { type: "image/jpeg", size: RECEIPT_MAX_BYTES + 1 } }).reason, "too-large");
  assert.equal(canReadObject({ membership: sup, path: "tenants/heartwood/finance/xero/a.csv" }).reason, "finance-denied");
});
