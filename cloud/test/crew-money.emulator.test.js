// 12 Nov 2026 (Alex: "everyone below supervisor can't see dollar amounts"). Every money-bearing record an operator
// (Heartwood crew or a CallUp company's staff) could try to read, against cloud/firestore.production.rules. Fake data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, collection, query, where } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
let env;
const M = { jobId: "J", companyId: "heartwood", poAmount: 900, poAmountBasis: "ex GST", poAmountSource: "app", quoteAmount: 950,
  poLookupCandidates: [{ po: "1", amount: 900 }], invoiceAmount: 1000, splitUndoPoAmount: 800,
  xeroCheck: { status: "invoiced", matches: [{ invoiceNumber: "1", totalEx: 1000, amountDue: 100 }] } };

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-crew-money",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") } });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, "users/op1"), { role: "operator", name: "Sam" });
    await setDoc(doc(d, "users/op2"), { role: "operator", name: "Pat" });
    await setDoc(doc(d, "users/bOp"), { role: "operator", name: "Bo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bOp2"), { role: "operator", name: "Bix", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "companies/bravo"), { name: "Bravo", companyId: "bravo", tenantId: "bravo", plan: "base", billing: { provider: "stripe", status: "active" } });
    await setDoc(doc(d, "jobs/hw1"), { companyId: "heartwood", assigned: ["op1"], status: "Done", invoiceNo: "5500", description: "Spoil" });
    await setDoc(doc(d, "jobs/b1"), { companyId: "bravo", tenantId: "bravo", assigned: ["bOp"], status: "Done" });
    await setDoc(doc(d, "jobMoney/hw1"), { ...M, jobId: "hw1" });
    await setDoc(doc(d, "jobMoney/b1"), { ...M, jobId: "b1", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "quotes/q1"), { companyId: "heartwood", totalEx: 2000, gst: 200, totalInc: 2200, lines: [{ amount: 2000 }] });
    await setDoc(doc(d, "quotes/qb"), { companyId: "bravo", tenantId: "bravo", totalEx: 2000 });
    await setDoc(doc(d, "meta/quoteRates"), { truckHour: 150 });
    await setDoc(doc(d, "meta/invoicing"), { lastNo: 5500 });
    await setDoc(doc(d, "meta/profitHistory"), { months: [{ profit: 1 }] });
    await setDoc(doc(d, "companyMeta/bravo_quoteRates"), { companyId: "bravo", truckHour: 150 });
    await setDoc(doc(d, "companyMeta/bravo_invoicing"), { companyId: "bravo", lastNo: 1 });
    await setDoc(doc(d, "xeroQueue/x1"), { amountEx: 1000, status: "queued" });
    await setDoc(doc(d, "reimbursements/r1"), { amountInc: 50, uid: "op1" });
    await setDoc(doc(d, "receipts/rOwn"), { uid: "op1", companyId: "heartwood", amountInc: 50 });
    await setDoc(doc(d, "receipts/rOther"), { uid: "op2", companyId: "heartwood", amountInc: 70 });
    await setDoc(doc(d, "receipts/bOther"), { uid: "bOp2", companyId: "bravo", tenantId: "bravo", amountInc: 70 });
    await setDoc(doc(d, "receiptChunks/c1"), { rid: "rOther" });
    await setDoc(doc(d, "reimbursementClaims/rcaaaaaaaaaaaaaaaa"), { uid: "op2", amountCents: 7000, status: "pending" });
    await setDoc(doc(d, "companies/bravo/reimbursementClaims/rcbbbbbbbbbbbbbbbb"), { uid: "bOp2", companyId: "bravo", amountCents: 7000, status: "pending" });
    await setDoc(doc(d, "tenants/bravo/serviceCosts/s1"), { amount: "$400" });
    await setDoc(doc(d, "tenants/heartwood/serviceCosts/s1"), { amount: "$400" });
    await setDoc(doc(d, "hoursExports/h1"), { companyId: "bravo", rows: [] });
    await setDoc(doc(d, "poLookups/p1"), { amount: 900 });
    await setDoc(doc(d, "ownerSettings/o1"), { x: 1 });
  });
});
test.after(async () => { if (env) await env.cleanup(); });
const db = uid => env.authenticatedContext(uid).firestore();

test("Heartwood operator: no money record is readable", async () => {
  const o = db("op1");
  for (const p of ["jobMoney/hw1", "quotes/q1", "meta/quoteRates", "meta/invoicing", "meta/profitHistory", "xeroQueue/x1", "reimbursements/r1",
    "receipts/rOther", "receiptChunks/c1", "reimbursementClaims/rcaaaaaaaaaaaaaaaa", "tenants/heartwood/serviceCosts/s1", "poLookups/p1", "ownerSettings/o1"])
    await assertFails(getDoc(doc(o, p)), p);
  for (const c of ["jobMoney", "quotes", "xeroQueue", "reimbursements", "receipts"])
    await assertFails(getDocs(query(collection(o, c), where("companyId", "==", "heartwood"))), c);
  const job = (await assertSucceeds(getDoc(doc(o, "jobs/hw1")))).data();
  for (const k of Object.keys(M).filter(k => !["jobId", "companyId"].includes(k))) assert.equal(k in job, false, k);
});

test("company operator: no money record is readable", async () => {
  const o = db("bOp");
  for (const p of ["jobMoney/b1", "quotes/qb", "companyMeta/bravo_quoteRates", "companyMeta/bravo_invoicing", "receipts/bOther",
    "companies/bravo/reimbursementClaims/rcbbbbbbbbbbbbbbbb", "tenants/bravo/serviceCosts/s1", "hoursExports/h1"])
    await assertFails(getDoc(doc(o, p)), p);
  await assertFails(getDocs(query(collection(o, "jobMoney"), where("companyId", "==", "bravo"))));
  await assertFails(getDocs(query(collection(o, "quotes"), where("companyId", "==", "bravo"))));
  const job = (await assertSucceeds(getDoc(doc(o, "jobs/b1")))).data();
  for (const k of Object.keys(M).filter(k => !["jobId", "companyId"].includes(k))) assert.equal(k in job, false, k);
  // The company doc an operator reads carries the plan name and billing status only, no amounts.
  const co = (await assertSucceeds(getDoc(doc(o, "companies/bravo")))).data();
  assert.doesNotMatch(JSON.stringify(co), /amount|price|\$\d/i);
});

test("exception (flagged for Alex): an operator still reads the amount on their OWN receipt", async () => {
  assert.equal((await assertSucceeds(getDoc(doc(db("op1"), "receipts/rOwn")))).data().amountInc, 50);
});

test("admins still read job money", async () => {
  assert.equal((await assertSucceeds(getDoc(doc(db(ALEX), "jobMoney/hw1")))).data().invoiceAmount, 1000);
});
