// Veolia dump receipts are on the company account. A receipt write that still
// says the worker paid personally is corrected, and a reimbursement created
// from a Veolia receipt (any site) is dropped. The receipts worker is not in
// this repo; it must use reimbursementFromReceipt and skip a null result.

import { isVeoliaSupplier, reimbursementFromReceipt } from "./shared/receipts.js";

export { reimbursementFromReceipt };

/** Patch for a stored receipt. Null when the document can be left as it is. */
export function veoliaReceiptPatch(receipt) {
  if (!isVeoliaSupplier(receipt && receipt.supplier)) return null;
  if (receipt.paidPersonally === false) return null;
  return { paidPersonally: false };
}

/**
 * True when this reimbursement must not exist.
 * Matches the ledger supplier or the source receipt supplier, any Veolia site.
 */
export function veoliaReimbursementDrop(reimbursement, receipt) {
  if (isVeoliaSupplier(reimbursement && reimbursement.supplier)) return true;
  if (isVeoliaSupplier(receipt && receipt.supplier)) return true;
  return false;
}

export async function applyVeoliaReceiptWrite(afterSnap) {
  if (!afterSnap || afterSnap.exists === false) return { action: "skip" };
  const patch = veoliaReceiptPatch(typeof afterSnap.data === "function" ? afterSnap.data() : null);
  if (!patch) return { action: "keep" };
  await afterSnap.ref.update(patch);
  return { action: "cleared" };
}

export async function applyVeoliaReimbursementCreate(snap, loadReceipt) {
  if (!snap) return { action: "skip" };
  const data = (typeof snap.data === "function" ? snap.data() : null) || {};
  let receipt = null;
  if (!isVeoliaSupplier(data.supplier) && typeof loadReceipt === "function") {
    const rid = data.receiptId || snap.id;
    if (rid) receipt = await loadReceipt(rid);
  }
  if (!veoliaReimbursementDrop(data, receipt)) return { action: "keep" };
  await snap.ref.delete();
  return { action: "dropped" };
}
