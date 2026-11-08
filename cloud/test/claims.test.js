import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  amountToCents, canMoveTo, claimCreateBody, claimDecisionBody, claimsScreenHtml, newClaimId, owedByPerson,
  receiptContentType, receiptDownloadName, receiptObjectName, receiptStoragePath,
} from "../../app/features/claims.js";

const id = "rc0123456789abcdef";
const draft = (extra = {}) => claimCreateBody({
  id, uid: "op1", name: "Sam", date: "2026-11-08", amount: "45.90", supplier: "Ampol", category: "fuel",
  notes: "", paidWith: "personal-card", jobId: "", jobLabel: "", receiptPath: "", receiptName: "", ...extra,
});

test("a claim is valid without a job and stores cents", () => {
  const ok = draft();
  assert.equal(ok.ok, true);
  assert.equal(ok.data.amountCents, 4590);
  assert.equal(ok.data.status, "submitted");
  assert.equal(ok.data.jobId, "");
  assert.equal(ok.data.paidAt, null);
  assert.deepEqual(Object.keys(ok.data).sort(), ["amountCents", "category", "date", "decidedAt", "decidedBy", "decidedByName", "decisionNote", "jobId", "jobLabel", "name", "notes", "paidAt", "paidWith", "receiptName", "receiptPath", "status", "supplier", "uid"]);
  assert.equal(draft({ jobId: "abc123", jobLabel: "HW-1234 · Smith" }).data.jobLabel, "HW-1234 · Smith");
  assert.equal(draft({ amount: "0" }).ok, false);
  assert.equal(draft({ amount: "12.345" }).ok, false);
  assert.equal(draft({ amount: "abc" }).ok, false);
  assert.equal(draft({ category: "beer" }).ok, false);
  assert.equal(draft({ paidWith: "company-card" }).ok, false);
  assert.equal(draft({ supplier: " " }).ok, false);
  assert.equal(draft({ date: "8/11/2026" }).ok, false);
  assert.equal(draft({ receiptPath: "reimbursements/op2/" + id + "/receipt.jpg", receiptName: "x" }).ok, false);
  assert.equal(amountToCents("$1,234.5"), 123450);
  assert.match(newClaimId(), /^rc[a-f0-9]{16}$/);
});

test("receipts go in the private reimbursements folder", () => {
  assert.equal(receiptObjectName("image/jpg"), "receipt.jpg");
  assert.equal(receiptObjectName("text/plain"), "");
  assert.equal(receiptContentType("image/jpg"), "image/jpeg");
  assert.equal(receiptStoragePath("op1", id, "receipt.pdf"), `reimbursements/op1/${id}/receipt.pdf`);
  assert.equal(receiptStoragePath("op1", "bad", "receipt.pdf"), "");
  assert.equal(receiptDownloadName({ name: "Sam Smith", date: "2026-11-08", supplier: "Bunnings Warehouse", receiptPath: `reimbursements/op1/${id}/receipt.jpg` }), "Sam_Smith_2026-11-08_Bunnings_Warehouse.jpg");
});

test("admins approve, decline, or mark paid; paid and declined are final", () => {
  assert.equal(canMoveTo("submitted", "approved"), true);
  assert.equal(canMoveTo("approved", "paid"), true);
  assert.equal(canMoveTo("paid", "approved"), false);
  assert.equal(canMoveTo("declined", "approved"), false);
  assert.equal(claimDecisionBody({ from: "submitted", status: "declined", note: "", uid: "a", name: "Alex" }).ok, false);
  assert.equal(claimDecisionBody({ from: "submitted", status: "approved", note: "", uid: "a", name: "Alex" }).ok, true);
  assert.equal(claimDecisionBody({ from: "submitted", status: "approved", note: "", uid: "a", name: "Alex" }).data.hubdocStatus, undefined);
  assert.equal(claimDecisionBody({ from: "approved", status: "paid", note: "", uid: "a", name: "Alex", receiptPath: "reimbursements/a/rc1/receipt.jpg" }).data.hubdocStatus, "queued");
  assert.equal(claimDecisionBody({ from: "approved", status: "paid", note: "", uid: "a", name: "Alex", receiptPath: "" }).data.hubdocStatus, "no-receipt");
});

test("owed per person counts approved and waiting, not paid or declined", () => {
  const rows = [
    { uid: "op1", name: "Sam", amountCents: 1000, status: "approved" },
    { uid: "op1", name: "Sam", amountCents: 500, status: "submitted" },
    { uid: "op1", name: "Sam", amountCents: 9999, status: "paid" },
    { uid: "op2", name: "Pat", amountCents: 7000, status: "declined" },
    { uid: "op2", name: "Pat", amountCents: 300, status: "approved" },
  ];
  assert.deepEqual(owedByPerson(rows).map(o => [o.name, o.approvedCents, o.submittedCents]), [["Sam", 1000, 500], ["Pat", 300, 0]]);
});

test("staff see only their own claims; admins see everyone, totals and actions", () => {
  const claims = [
    { id: "rc1", uid: "op1", name: "Sam", amountCents: 1000, supplier: "Ampol", status: "submitted", date: "2026-11-08", receiptPath: "reimbursements/op1/rc1/receipt.jpg" },
    { id: "rc2", uid: "op2", name: "Pat", amountCents: 2000, supplier: "Repco", status: "approved", date: "2026-11-07" },
  ];
  const staff = claimsScreenHtml({ claims, uid: "op1", isAdmin: false, jobs: [] });
  assert.match(staff, /Ampol/);
  assert.doesNotMatch(staff, /Repco|Owed per person|rc-decide/);
  const admin = claimsScreenHtml({ claims, uid: "adm", isAdmin: true, jobs: [{ id: "j1", label: "HW-1 · Smith" }] });
  assert.match(admin, /Owed per person/);
  assert.match(admin, /Repco/);
  assert.match(admin, /value="paid"/);
  assert.match(admin, /data-rc-receipt="rc1"/);
  assert.match(admin, /HW-1 · Smith/);
});

test("claim rules match the emulator, are additive, and never delete", () => {
  const slice = (text, begin, end) => {
    const a = text.indexOf(begin), b = text.indexOf(end);
    assert.ok(a >= 0 && b > a, begin);
    return text.slice(a, b + end.length);
  };
  const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
  const fsB = ["// BEGIN REIMBURSEMENT CLAIM RULES", "// END REIMBURSEMENT CLAIM RULES"];
  const stB = ["// BEGIN REIMBURSEMENT RECEIPT RULES", "// END REIMBURSEMENT RECEIPT RULES"];
  const block = slice(read("../production/firestore.reimbursements.rules"), ...fsB);
  assert.equal(slice(read("../emulator/firestore.rules"), ...fsB), block);
  const st = slice(read("../production/storage.reimbursements.rules"), ...stB);
  assert.equal(slice(read("../emulator/storage.rules"), ...stB), st);
  assert.equal(read("../emulator/storage.rules"), read("../production/storage.rules"));
  assert.match(block, /match \/reimbursementClaims\/\{id\}/);
  assert.match(block, /allow delete: if false/);
  assert.doesNotMatch(block, /match \/receipts\/|match \/reimbursements\/|match \/receiptChunks\/|xeroQueue/);
  assert.doesNotMatch(block, /role == "supervisor"/);
  assert.match(st, /match \/reimbursements\/\{uid\}\/\{claimId\}\/\{file\}/);
  assert.match(st, /allow update, delete: if false/);
  assert.match(st, /request\.auth\.uid == uid \|\| rcFileAdmin\(\)/);
  assert.doesNotMatch(st, /match \/receipts|tenants\//);
});
