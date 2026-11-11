// Round 3 (Q6): job money helpers and the jobMoney migration plan. No Firebase.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JOB_MONEY_KEYS, splitJobMoney, mergeJobMoney, jobMoneyDoc, stripJobMoney } from "../../app/features/job-money.js";
import { planJobMoney } from "../scripts/migrate-job-money.mjs";

test("splitJobMoney sends money keys to jobMoney and clears them on the job", () => {
  const del = () => "DELETE";
  const { job, money, hasMoney } = splitJobMoney({ po: "PO-1", poAmount: 100, poAmountBasis: "ex GST", notes: "n" }, del);
  assert.equal(hasMoney, true);
  assert.deepEqual(money, { poAmount: 100, poAmountBasis: "ex GST" });
  assert.deepEqual(job, { po: "PO-1", notes: "n", poAmount: "DELETE", poAmountBasis: "DELETE" });
  const created = splitJobMoney({ po: "PO-1", quoteAmount: 5 });
  assert.deepEqual(created.job, { po: "PO-1" });
  assert.equal(splitJobMoney({ notes: "x" }).hasMoney, false);
});

test("mergeJobMoney: jobMoney wins, legacy job values remain as a fallback", () => {
  assert.equal(mergeJobMoney({ id: "a", poAmount: 5 }, null).poAmount, 5);
  assert.equal(mergeJobMoney({ id: "a", poAmount: 5 }, { poAmount: 7 }).poAmount, 7);
  assert.equal(mergeJobMoney({ id: "a", poAmount: 5 }, { poAmount: null }).poAmount, null);
  assert.equal(mergeJobMoney({ id: "a" }, { splitUndoPoAmount: 3 }).splitUndoPoAmount, undefined);
  assert.deepEqual(Object.keys(stripJobMoney({ id: "a", poAmount: 1, quoteAmount: 2, po: "x" })), ["id", "po"]);
  assert.deepEqual(jobMoneyDoc("j1", "bravo", { poAmount: 1, other: 2 }, { updatedBy: "u" }), { jobId: "j1", companyId: "bravo", poAmount: 1, updatedBy: "u" });
});

test("planJobMoney moves amounts, cleans the quote copy and the split undo copy", () => {
  const job = { companyId: "bravo", tenantId: "bravo", po: "P", quoteAmount: 2085, poAmount: 2085, poAmountBasis: "accepted quote (ex GST)", poAmountSource: "quote",
    quote: { travelKm: 5, totalEx: 2085, gst: 208.5, totalInc: 2293.5, lines: [{ label: "Truck", amount: 900 }], priceOverrides: { travel: 1 },
      extraItems: [{ id: "x", qty: 6, unit: "m3", unitPrice: 55 }] },
    splitUndo: { description: "d", poAmount: 400 } };
  const p = planJobMoney("j1", job);
  assert.deepEqual(p.remove.sort(), [...JOB_MONEY_KEYS].sort());
  assert.deepEqual(p.set.quote, { travelKm: 5, extraItems: [{ id: "x", qty: 6, unit: "m3" }] });
  assert.deepEqual(p.set.splitUndo, { description: "d" });
  assert.deepEqual(p.money, { jobId: "j1", companyId: "bravo", tenantId: "bravo", quoteAmount: 2085, poAmount: 2085,
    poAmountBasis: "accepted quote (ex GST)", poAmountSource: "quote", splitUndoPoAmount: 400 });
  assert.equal(JSON.stringify({ ...job, ...p.set, ...Object.fromEntries(p.remove.map(k => [k, undefined])) }).match(/2085|55|900|400/), null);
});

test("planJobMoney never overwrites jobMoney and leaves invoice fields alone", () => {
  const p = planJobMoney("j2", { poAmount: 10, invoiceAmount: 99, quote: { totalEx: 50 } }, { poAmount: 12 });
  assert.deepEqual(p.remove, ["poAmount"]);
  assert.deepEqual(p.money, { jobId: "j2", companyId: "heartwood", quoteAmount: 50 });
  assert.equal("invoiceAmount" in p.set, false);
  assert.equal(planJobMoney("j3", { po: "P", quote: { travelKm: 1 } }).changes, false);
});

test("rules keep the same money keys as the app", () => {
  const rules = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  const m = rules.match(/function jobMoneyKeys\(\) \{ return (\[[^\]]*\]); \}/);
  assert.ok(m, "jobMoneyKeys in rules");
  assert.deepEqual(JSON.parse(m[1]), [...JOB_MONEY_KEYS]);
});

test("the app never writes money keys straight onto a job", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  const quotes = readFileSync(new URL("../../app/features/quotes.js", import.meta.url), "utf8");
  for (const src of [app, quotes]) {
    for (const m of src.matchAll(/updateDoc\(doc\(db, "jobs"[^;]*;/g)) assert.doesNotMatch(m[0], /poAmount|quoteAmount/, m[0].slice(0, 120));
    for (const m of src.matchAll(/addDoc\(collection\(db, "jobs"\)[^;]*;/g)) assert.doesNotMatch(m[0], /poAmount|quoteAmount/);
  }
  assert.doesNotMatch(quotes.slice(quotes.indexOf("async function createJobFromQuote"), quotes.indexOf("export function adminViewRouter")).split("const jobDoc")[1].split("await setDoc(ref, jobDoc)")[0], /quoteAmount|poAmount/);
});
