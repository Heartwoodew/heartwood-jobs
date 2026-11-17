import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseReceiptMeasures, validateReceiptUpload, receiptHasMoney, receiptNeedsAmount,
  formatReceiptMeasure, receiptOwedTotal, receiptDupKey, receiptHubdocLines,
  receiptMeasureFields, receiptAmount, receiptTonnes,
  isVeoliaSupplier, nextPaidPersonallyControl, receiptPaidPersonally, VEOLIA_PAID_NOTE,
} from "../../app/features/receipts.js";

test("a receipt is accepted with dollars, tonnes, or both, but not neither", () => {
  assert.deepEqual(parseReceiptMeasures({ amount: "12.5" }), { amountInc: 12.5, tonnes: null, ok: true });
  assert.deepEqual(parseReceiptMeasures({ tonnes: "3.25" }), { amountInc: null, tonnes: 3.25, ok: true });
  assert.deepEqual(parseReceiptMeasures({ amount: "40", tonnes: "1.5" }), { amountInc: 40, tonnes: 1.5, ok: true });
  assert.equal(parseReceiptMeasures({ amount: "", tonnes: "" }).ok, false);
  assert.equal(parseReceiptMeasures({ amount: "0", tonnes: "0" }).ok, false);
  assert.equal(parseReceiptMeasures({ amount: "-4", tonnes: "-1" }).ok, false);
  assert.equal(parseReceiptMeasures({}).ok, false);
});

test("upload validation requires a photo, supplier, and at least one measure", () => {
  const tonnesOnly = validateReceiptUpload({ hasPhoto: true, supplier: "Remondis tip", tonnes: "4.1" });
  assert.equal(tonnesOnly.ok, true);
  assert.equal(tonnesOnly.measures.amountInc, null);
  assert.equal(tonnesOnly.measures.tonnes, 4.1);
  const bothMissing = validateReceiptUpload({ hasPhoto: true, supplier: "Remondis tip", amount: "", tonnes: "" });
  assert.equal(bothMissing.ok, false);
  assert.match(bothMissing.reason, /dollar amount or tonnes/);
  const noPhoto = validateReceiptUpload({ hasPhoto: false, supplier: "Bunnings", amount: "10" });
  assert.equal(noPhoto.ok, false);
});

test("account dockets with only tonnes are not owed and do not need an amount", () => {
  const account = { supplier: "Remondis", tonnes: 8.2, paidPersonally: false, status: "queued" };
  assert.equal(receiptHasMoney(account), false);
  assert.equal(receiptNeedsAmount(account), false);
  assert.equal(receiptOwedTotal([account]), 0);
  assert.equal(formatReceiptMeasure(account, v => `$${v.toFixed(2)}`), "8.2 t");
  assert.equal(receiptHubdocLines(account), "Tonnes: 8.2 t");
});

test("a personally paid receipt with no dollar amount needs an amount before payback", () => {
  const personal = { supplier: "Tip docket", tonnes: 2, paidPersonally: true, status: "queued" };
  assert.equal(receiptNeedsAmount(personal), true);
  assert.equal(receiptHasMoney(personal), false);
  const filled = { ...personal, amountInc: 88.4 };
  assert.equal(receiptNeedsAmount(filled), false);
  assert.equal(receiptHasMoney(filled), true);
  const ledger = { workerName: "Sam", tonnes: 2, paid: false, needsAmount: true };
  assert.equal(receiptNeedsAmount(ledger), true);
  assert.equal(receiptOwedTotal([personal, filled, { amountInc: 10, paid: false }]), 98.4);
});

test("display, CSV money totals and duplicate keys never treat missing dollars as $0", () => {
  const hide = () => "";
  const show = v => `$${v.toFixed(2)}`;
  const money = { amountInc: 12, supplier: "Bunnings" };
  const tonnes = { tonnes: 3, supplier: "Remondis", paidPersonally: false };
  assert.equal(formatReceiptMeasure(money, show), "$12.00");
  assert.equal(formatReceiptMeasure(money, hide), "");
  assert.equal(formatReceiptMeasure(tonnes, hide), "3 t");
  assert.equal(formatReceiptMeasure({ amountInc: 12, tonnes: 3 }, show), "$12.00 · 3 t");
  assert.equal(receiptOwedTotal([money, tonnes, { amountInc: 0, tonnes: 4, paidPersonally: true }]), 12);
  assert.notEqual(
    receiptDupKey({ workerName: "Sam", date: "2026-11-12", tonnes: 3, paidPersonally: true }),
    receiptDupKey({ workerName: "Sam", date: "2026-11-12", amountInc: 0, paidPersonally: true }),
  );
  assert.equal(
    receiptDupKey({ workerName: "Sam", date: "2026-11-12", amountInc: 10 }),
    receiptDupKey({ workerName: "Sam", date: "2026-11-12T08:00:00Z", amountInc: 10 }),
  );
  assert.equal(receiptHubdocLines(money), "Amount $12.00 inc GST");
  assert.equal(receiptAmount({ amountInc: "0" }), 0);
  assert.equal(receiptTonnes({ tonnes: "0.5" }), 0.5);
  assert.deepEqual(receiptMeasureFields({ amountInc: null, tonnes: 2.25 }), { amountInc: null, tonnes: 2.25 });
});

test("Veolia suppliers match any site, ignoring case", () => {
  for (const name of ["Veolia", "VEOLIA", "veolia", "Veolia wattleglen - tip fees", "veolia sunshine", "  VEOLIA Clayton tip fees"]) {
    assert.equal(isVeoliaSupplier(name), true, name);
  }
  for (const name of ["", "Remondis", "Bunnings", "Caltex", "viola", "Marvel", null, undefined]) {
    assert.equal(isVeoliaSupplier(name), false, String(name));
  }
});

test("the paid-myself box hides for Veolia and comes back unticked", () => {
  const open = { checkboxVisible: true, checked: true };
  assert.deepEqual(nextPaidPersonallyControl({ ...open, supplier: "" }), { ...open, note: "" });
  assert.deepEqual(nextPaidPersonallyControl({ ...open, supplier: "Bunnings - silt fence" }), { ...open, note: "" });
  const hidden = nextPaidPersonallyControl({ ...open, supplier: "Veolia wattleglen - tip fees" });
  assert.deepEqual(hidden, { checkboxVisible: false, checked: false, note: VEOLIA_PAID_NOTE });
  assert.deepEqual(nextPaidPersonallyControl({ supplier: "VEOLIA", checkboxVisible: true, checked: true }).note, VEOLIA_PAID_NOTE);
  const back = nextPaidPersonallyControl({ supplier: "Remondis", checkboxVisible: false, checked: false });
  assert.deepEqual(back, { checkboxVisible: true, checked: false, note: "" });
  assert.deepEqual(nextPaidPersonallyControl({ supplier: "Caltex", checkboxVisible: true, checked: false }), {
    checkboxVisible: true, checked: false, note: "",
  });
});

test("saving a Veolia receipt forces paidPersonally false", () => {
  assert.equal(receiptPaidPersonally("Veolia wattleglen - tip fees", true), false);
  assert.equal(receiptPaidPersonally("veolia", true), false);
  assert.equal(receiptPaidPersonally("VEOLIA Sunshine", false), false);
  assert.equal(receiptPaidPersonally("Bunnings", true), true);
  assert.equal(receiptPaidPersonally("Bunnings", false), false);
  const veolia = { supplier: "Veolia wattleglen - tip fees", tonnes: 4, paidPersonally: true, status: "queued" };
  assert.equal(receiptNeedsAmount(veolia), false);
  assert.equal(receiptNeedsAmount({ supplier: "Tip docket", tonnes: 2, paidPersonally: true }), true);
});

test("the receipt dialog re-checks the supplier and does not trust the checkbox for Veolia", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const dialog = app.slice(app.indexOf("function receiptDialog"), app.indexOf("const jobReceiptsHtml"));
  assert.match(dialog, /\$\{VEOLIA_PAID_NOTE\}/);
  assert.equal(VEOLIA_PAID_NOTE, "Veolia is paid on account, not reimbursed.");
  assert.match(dialog, /nextPaidPersonallyControl\(/);
  assert.match(dialog, /receiptPaidPersonally\(supplier, f\.mine\.checked\)/);
  assert.match(dialog, /addEventListener\("input", syncPaid\)/);
  assert.doesNotMatch(dialog, /paidPersonally: f\.mine\.checked/);
  assert.match(dialog, /name="mine" checked/);
  const css = readFileSync(new URL("../../app/styles.css", import.meta.url), "utf8");
  assert.match(css, /#rpaidbox\[hidden\].*display:\s*none\s*!important/);
});
