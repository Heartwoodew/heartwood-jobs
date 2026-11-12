// 12 Nov 2026: invoiceAmount lives in jobMoney/{jobId} (office only). Loads cloud/firestore.production.rules.
// Fake data only (demo project). Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteField, collection, query, where, runTransaction, writeBatch } from "firebase/firestore";
import { migrateInvoiceAmount } from "../scripts/migrate-office-money.mjs";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const PATRICK = "R7t41e54Ykcdk9WPdVZnDd697iI2";
const SYNC = "38SU5waAy4f9UI9N6JTqDMaYpQg2";
let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-invoice-amount",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, "users/op1"), { role: "operator", name: "Sam" });
    await setDoc(doc(d, "users/hwSupOp"), { role: "operator", staffRole: "supervisor", name: "Hank" });
    await setDoc(doc(d, "users/bAdm"), { role: "admin", name: "Bea", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bSup"), { role: "supervisor", name: "Sue", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bOp"), { role: "operator", name: "Bo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "jobs/hwDone"), { companyId: "heartwood", client: "Orbit", assigned: ["op1", "hwSupOp"], status: "Done", po: "PO-1", invoiceNo: "5500" });
    await setDoc(doc(d, "jobMoney/hwDone"), { jobId: "hwDone", companyId: "heartwood", invoiceAmount: 700 });
    await setDoc(doc(d, "jobs/hwNext"), { companyId: "heartwood", client: "Orbit", assigned: ["op1"], status: "Done", po: "PO-2" });
    await setDoc(doc(d, "jobs/hwLegacy"), { companyId: "heartwood", client: "Orbit", assigned: ["op1"], status: "Done", po: "PO-3", invoiceAmount: 410 });
    await setDoc(doc(d, "jobs/bDone"), { companyId: "bravo", tenantId: "bravo", client: "Acme", assigned: ["bOp"], status: "Done" });
    await setDoc(doc(d, "jobMoney/bDone"), { jobId: "bDone", companyId: "bravo", tenantId: "bravo", invoiceAmount: 300 });
  });
});
test.after(async () => { if (env) await env.cleanup(); });
const db = uid => env.authenticatedContext(uid).firestore();

test("operators can't read the invoice price; Heartwood admins and company office can", async () => {
  const job = await assertSucceeds(getDoc(doc(db("op1"), "jobs/hwDone")));
  assert.equal("invoiceAmount" in job.data(), false, "the crew-readable job carries no price");
  await assertFails(getDoc(doc(db("op1"), "jobMoney/hwDone")));
  await assertFails(getDoc(doc(db("hwSupOp"), "jobMoney/hwDone")));
  await assertFails(getDocs(query(collection(db("op1"), "jobMoney"), where("companyId", "==", "heartwood"))));
  await assertFails(getDoc(doc(db("bOp"), "jobMoney/bDone")));
  await assertFails(getDocs(query(collection(db("bOp"), "jobMoney"), where("companyId", "==", "bravo"))));
  assert.equal((await assertSucceeds(getDoc(doc(db(ALEX), "jobMoney/hwDone")))).data().invoiceAmount, 700);
  assert.equal((await assertSucceeds(getDoc(doc(db(PATRICK), "jobMoney/hwDone")))).data().invoiceAmount, 700);
  await assertSucceeds(getDocs(query(collection(db(ALEX), "jobMoney"), where("companyId", "==", "heartwood"))));
  assert.equal((await assertSucceeds(getDoc(doc(db("bAdm"), "jobMoney/bDone")))).data().invoiceAmount, 300);
  await assertSucceeds(getDoc(doc(db("bSup"), "jobMoney/bDone")));
  await assertFails(getDoc(doc(db("bAdm"), "jobMoney/hwDone")));
});

test("nobody can put invoiceAmount on a job any more (app writers, company office, the box); removing a legacy copy is fine", async () => {
  await assertFails(updateDoc(doc(db(ALEX), "jobs/hwNext"), { invoiceAmount: 500 }));
  await assertFails(updateDoc(doc(db(PATRICK), "jobs/hwNext"), { invoiceAmount: 500 }));
  await assertFails(updateDoc(doc(db(SYNC), "jobs/hwNext"), { invoiceAmount: 500 }));
  await assertFails(updateDoc(doc(db(SYNC), "jobs/hwLegacy"), { invoiceAmount: 411 }));
  await assertFails(setDoc(doc(db(SYNC), "jobs/hwNew"), { companyId: "heartwood", status: "Done", invoiceAmount: 1 }));
  await assertSucceeds(setDoc(doc(db(SYNC), "jobs/hwNew2"), { companyId: "heartwood", status: "Done", invoiceNo: "5501" }));
  await assertSucceeds(updateDoc(doc(db(SYNC), "jobs/hwNext"), { invoiceNo: "5502", invoiced: false }));
  await assertFails(updateDoc(doc(db("bAdm"), "jobs/bDone"), { invoiceAmount: 5 }));
  await assertFails(updateDoc(doc(db("op1"), "jobs/hwNext"), { invoiceAmount: 5 }));
  await assertSucceeds(updateDoc(doc(db(ALEX), "jobs/hwLegacy"), { invoiceAmount: deleteField(), invoiceDescription: "Spoil" }));
});

test("office writes the price to jobMoney (number only); crew can't", async () => {
  await assertSucceeds(setDoc(doc(db(ALEX), "jobMoney/hwNext"), { jobId: "hwNext", companyId: "heartwood", invoiceAmount: 640, updatedBy: ALEX }, { merge: true }));
  await assertSucceeds(setDoc(doc(db(SYNC), "jobMoney/hwNext"), { jobId: "hwNext", companyId: "heartwood", invoiceAmount: 650 }, { merge: true }));
  await assertSucceeds(setDoc(doc(db("bAdm"), "jobMoney/bDone"), { jobId: "bDone", companyId: "bravo", invoiceAmount: 320 }, { merge: true }));
  await assertSucceeds(setDoc(doc(db(ALEX), "jobMoney/hwNext"), { jobId: "hwNext", companyId: "heartwood", invoiceAmount: null }, { merge: true }));
  await assertFails(setDoc(doc(db(ALEX), "jobMoney/hwNext"), { jobId: "hwNext", companyId: "heartwood", invoiceAmount: "640" }, { merge: true }));
  await assertFails(setDoc(doc(db("op1"), "jobMoney/hwNext"), { jobId: "hwNext", companyId: "heartwood", invoiceAmount: 1 }, { merge: true }));
  await assertFails(setDoc(doc(db("bOp"), "jobMoney/bDone"), { jobId: "bDone", companyId: "bravo", invoiceAmount: 1 }, { merge: true }));
});

test("numbering transaction (as the app does it): number on the job, price on jobMoney", async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "jobs/hwNum"), { companyId: "heartwood", assigned: ["op1"], status: "Done", po: "PO-9", invoiceAmount: 123 });
  });
  const a = db(ALEX);
  await assertSucceeds(runTransaction(a, async tx => {
    await tx.get(doc(a, "jobs/hwNum"));
    tx.update(doc(a, "jobs/hwNum"), { invoiceNo: "5600", invoiceDescription: "Spoil", invoiced: false, updatedBy: ALEX, invoiceAmount: deleteField() });
    tx.set(doc(a, "jobMoney/hwNum"), { jobId: "hwNum", companyId: "heartwood", invoiceAmount: 125, updatedBy: ALEX }, { merge: true });
  }));
  const j = (await getDoc(doc(db("op1"), "jobs/hwNum"))).data();
  assert.equal(j.invoiceNo, "5600"); assert.equal("invoiceAmount" in j, false);
  assert.equal((await getDoc(doc(a, "jobMoney/hwNum"))).data().invoiceAmount, 125);
  // A batch that still tried to put the price on the job is refused as a whole.
  const b = writeBatch(a);
  b.update(doc(a, "jobs/hwNum"), { invoiceAmount: 125 });
  b.set(doc(a, "jobMoney/hwNum"), { jobId: "hwNum", companyId: "heartwood", invoiceAmount: 125 }, { merge: true });
  await assertFails(b.commit());
});

test("migration on the emulator: backup first, copy + remove, conflict untouched, second run clean, crew lose the price", async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, "jobs/m1"), { companyId: "heartwood", assigned: ["op1"], status: "Done", invoiceNo: "1", invoiceAmount: 900 });
    await setDoc(doc(d, "jobs/m2"), { companyId: "heartwood", assigned: ["op1"], status: "Done", invoiceAmount: 50 });
    await setDoc(doc(d, "jobMoney/m2"), { jobId: "m2", companyId: "heartwood", invoiceAmount: 50, poAmount: 45 });
    await setDoc(doc(d, "jobs/m3"), { companyId: "heartwood", assigned: ["op1"], status: "Done", invoiceAmount: 60 });
    await setDoc(doc(d, "jobMoney/m3"), { jobId: "m3", companyId: "heartwood", invoiceAmount: 61 });
    await setDoc(doc(d, "jobs/m4"), { companyId: "bravo", tenantId: "bravo", assigned: ["bOp"], status: "Done", invoiceAmount: 70 });
  });
  let backup = null, report;
  await env.withSecurityRulesDisabled(async ctx => {
    const dry = await migrateInvoiceAmount(ctx.firestore(), {});
    assert.equal(dry.apply, false);
    assert.ok(dry.copyAndRemove >= 2 && dry.conflicts.includes("jobs/m3"));
    assert.equal((await getDoc(doc(ctx.firestore(), "jobs/m1"))).data().invoiceAmount, 900, "dry run writes nothing");
    report = await migrateInvoiceAmount(ctx.firestore(), { apply: true, writeBackup: async b => { backup = b; } });
    const again = await migrateInvoiceAmount(ctx.firestore(), {});
    assert.equal(again.copyAndRemove + again.removeOnly, 0);
    assert.deepEqual(again.conflicts, ["jobs/m3"]);
  });
  assert.ok(backup.rows.some(r => r.path === "jobs/m1" && r.job.invoiceAmount === 900));
  assert.deepEqual(report.verifyFailed, []);
  const m1 = (await assertSucceeds(getDoc(doc(db("op1"), "jobs/m1")))).data();
  assert.equal("invoiceAmount" in m1, false); assert.equal(m1.invoiceNo, "1");
  assert.equal((await getDoc(doc(db(ALEX), "jobMoney/m1"))).data().invoiceAmount, 900);
  const m2 = (await getDoc(doc(db(ALEX), "jobMoney/m2"))).data();
  assert.equal(m2.invoiceAmount, 50); assert.equal(m2.poAmount, 45, "other money kept");
  assert.equal((await getDoc(doc(db(ALEX), "jobs/m3"))).data().invoiceAmount, 60, "conflict left for a person");
  assert.equal((await getDoc(doc(db("bAdm"), "jobMoney/m4"))).data().invoiceAmount, 70);
  assert.equal((await getDoc(doc(db("bAdm"), "jobMoney/m4"))).data().tenantId, "bravo");
  await assertFails(getDoc(doc(db("bOp"), "jobMoney/m4")));
});

test("xeroCheck (Xero totals) is office only: crew can't read it, nobody puts it on a job, the migration moves it", async () => {
  const xc = { checkedAt: "2026-11-01T08:00:00+10:00", status: "invoiced", matches: [{ invoiceNumber: "5401", status: "PAID", totalEx: 900, amountDue: 0 }] };
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "jobs/x1"), { companyId: "heartwood", assigned: ["op1"], status: "Done", xeroCheckPending: true, xeroCheck: xc });
  });
  await assertFails(updateDoc(doc(db(SYNC), "jobs/hwNext"), { xeroCheck: xc }));
  await assertFails(updateDoc(doc(db(ALEX), "jobs/hwNext"), { xeroCheck: xc }));
  await assertSucceeds(updateDoc(doc(db(SYNC), "jobs/hwNext"), { xeroCheckPending: false }));
  await assertSucceeds(setDoc(doc(db(SYNC), "jobMoney/hwNext"), { jobId: "hwNext", companyId: "heartwood", xeroCheck: xc }, { merge: true }));
  await assertFails(setDoc(doc(db(ALEX), "jobMoney/hwNext"), { jobId: "hwNext", companyId: "heartwood", xeroCheck: "paid" }, { merge: true }));
  await assertFails(getDoc(doc(db("op1"), "jobMoney/hwNext")));
  await env.withSecurityRulesDisabled(async ctx => { await migrateInvoiceAmount(ctx.firestore(), { apply: true, writeBackup: async () => {} }); });
  const j = (await assertSucceeds(getDoc(doc(db("op1"), "jobs/x1")))).data();
  assert.equal("xeroCheck" in j, false); assert.equal(j.xeroCheckPending, true);
  await assertFails(getDoc(doc(db("op1"), "jobMoney/x1")));
  assert.deepEqual((await getDoc(doc(db(ALEX), "jobMoney/x1"))).data().xeroCheck, xc);
});
