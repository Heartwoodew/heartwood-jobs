import test from "node:test";
import assert from "node:assert/strict";
import { isVeoliaSupplier, reimbursementFromReceipt } from "../functions/shared/receipts.js";
import {
  applyVeoliaReceiptWrite, applyVeoliaReimbursementCreate, veoliaReceiptPatch, veoliaReimbursementDrop,
} from "../functions/receipt-reimburse.js";

const sites = ["Veolia wattleglen - tip fees", "VEOLIA", "veolia sunshine", "Veolia Clayton"];

test("a Veolia receipt never becomes a reimbursement, at any site", () => {
  for (const supplier of sites) {
    assert.equal(isVeoliaSupplier(supplier), true, supplier);
    assert.equal(reimbursementFromReceipt({
      id: "r1", supplier, paidPersonally: true, amountInc: 88, uid: "op1", workerName: "Sam",
    }), null, supplier);
  }
  assert.equal(reimbursementFromReceipt({ id: "r1", supplier: "Veolia", paidPersonally: true }), null);
  assert.equal(reimbursementFromReceipt({ supplier: "Caltex", paidPersonally: true }), null);
  const kept = reimbursementFromReceipt({
    id: "r2", supplier: "Caltex", paidPersonally: true, amountInc: 62.5, uid: "op1", workerName: "Sam", tonnes: null,
  });
  assert.equal(kept.receiptId, "r2");
  assert.equal(kept.supplier, "Caltex");
  assert.equal(kept.amountInc, 62.5);
  assert.equal(reimbursementFromReceipt({ id: "r3", supplier: "Remondis", paidPersonally: false, tonnes: 8 }), null);
  assert.equal(reimbursementFromReceipt(null), null);
});

test("the receipt guard clears paidPersonally only for Veolia", () => {
  assert.deepEqual(veoliaReceiptPatch({ supplier: "Veolia wattleglen - tip fees", paidPersonally: true }), { paidPersonally: false });
  assert.deepEqual(veoliaReceiptPatch({ supplier: "veolia", paidPersonally: true }), { paidPersonally: false });
  assert.deepEqual(veoliaReceiptPatch({ supplier: "VEOLIA Sunshine" }), { paidPersonally: false });
  assert.equal(veoliaReceiptPatch({ supplier: "Veolia", paidPersonally: false }), null);
  assert.equal(veoliaReceiptPatch({ supplier: "Bunnings", paidPersonally: true }), null);
  assert.equal(veoliaReimbursementDrop({ supplier: "Veolia wattleglen - tip fees" }, null), true);
  assert.equal(veoliaReimbursementDrop({ supplier: "Tip" }, { supplier: "VEOLIA Clayton" }), true);
  assert.equal(veoliaReimbursementDrop({ supplier: "Caltex" }, { supplier: "Caltex" }), false);
});

test("receipt and reimbursement writes are corrected for Veolia and left alone otherwise", async () => {
  const updates = [];
  const cleared = await applyVeoliaReceiptWrite({
    exists: true,
    data: () => ({ supplier: "Veolia wattleglen - tip fees", paidPersonally: true }),
    ref: { update: async (patch) => { updates.push(patch); } },
  });
  assert.equal(cleared.action, "cleared");
  assert.deepEqual(updates, [{ paidPersonally: false }]);
  const kept = await applyVeoliaReceiptWrite({
    exists: true,
    data: () => ({ supplier: "Veolia", paidPersonally: false }),
    ref: { update: async () => { throw new Error("should not write"); } },
  });
  assert.equal(kept.action, "keep");
  assert.equal((await applyVeoliaReceiptWrite({ exists: false, data: () => ({}) })).action, "skip");

  const deleted = [];
  const dropped = await applyVeoliaReimbursementCreate({
    id: "r1",
    data: () => ({ supplier: "Tip fees", receiptId: "r1", paidPersonally: true }),
    ref: { delete: async () => { deleted.push("r1"); } },
  }, async () => ({ supplier: "Veolia wattleglen - tip fees", paidPersonally: true }));
  assert.equal(dropped.action, "dropped");
  assert.deepEqual(deleted, ["r1"]);

  let looked = 0;
  const named = await applyVeoliaReimbursementCreate({
    id: "r2",
    data: () => ({ supplier: "VEOLIA" }),
    ref: { delete: async () => { deleted.push("r2"); } },
  }, async () => { looked += 1; return null; });
  assert.equal(named.action, "dropped");
  assert.equal(looked, 0);

  const stay = await applyVeoliaReimbursementCreate({
    id: "r3",
    data: () => ({ supplier: "Caltex", receiptId: "r3" }),
    ref: { delete: async () => { throw new Error("should not delete"); } },
  }, async () => ({ supplier: "Caltex", paidPersonally: true }));
  assert.equal(stay.action, "keep");
});
