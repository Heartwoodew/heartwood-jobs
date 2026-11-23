// Industry trades, repeating jobs and certificate files against production rules.
// Emulator only. Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { companyTradesDoc, TRADES } from "../../app/features/trades.js";

let env;
test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-industries",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/bAdm"), { role: "admin", name: "Bea", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(db, "users/bOp"), { role: "operator", name: "Bo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(db, "users/bIdle"), { role: "operator", name: "Idle", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(db, "users/bSup"), { role: "supervisor", name: "Sue", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(db, "companies/bravo"), { name: "Bravo", status: "active", plan: "paid", isTest: true });
    await setDoc(doc(db, "jobs/pool1"), {
      companyId: "bravo", tenantId: "bravo", client: "Strata", address: "1 Pool St", status: "Scheduled",
      assigned: ["bOp"], seriesId: "spool", seriesRole: "template",
    });
    await setDoc(doc(db, "jobMoney/pool1"), { jobId: "pool1", companyId: "bravo", quoteAmount: 120, poAmount: 120 });
  });
});
test.after(async () => { if (env) await env.cleanup(); });
const db = uid => env.authenticatedContext(uid).firestore();

test("a company can save the new industries and its own checklist", async () => {
  const body = { ...companyTradesDoc("bravo", ["cleaning", "pest-control", "pools"], "bAdm"), updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(db("bAdm"), "companyTrades/bravo"), body));
  const bad = { ...body, updatedAt: serverTimestamp(), trades: ["cleaning", "roofing"], extraTrades: ["roofing"] };
  await assertFails(setDoc(doc(db("bAdm"), "companyTrades/bravo"), bad));
  const all = { ...companyTradesDoc("bravo", TRADES.map(row => row.id), "bAdm"), updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(db("bAdm"), "companyTrades/bravo"), all));
  const legacy = { ...companyTradesDoc("bravo", ["earthworks"], "bAdm"), updatedAt: serverTimestamp(), trade: "traffic-civil", trades: ["traffic-civil"], extraTrades: [] };
  await assertSucceeds(setDoc(doc(db("bAdm"), "companyTrades/bravo"), legacy));
  const civil = { ...companyTradesDoc("bravo", ["civil-earthworks"], "bAdm"), updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(db("bAdm"), "companyTrades/bravo"), civil));
});

test("office can store a repeating job without putting the price on it, and crew cannot read the money", async () => {
  await assertSucceeds(setDoc(doc(db("bAdm"), "jobs/pool-week"), {
    companyId: "bravo", tenantId: "bravo", client: "Strata", address: "1 Pool St", type: "po-service",
    description: "Weekly pool service", date: "2026-11-30", status: "Scheduled", assigned: ["bOp"],
    seriesId: "spool", seriesRole: "occurrence", occurrenceKey: "spool_2026-11-30",
    recurrence: { freq: "weekly", interval: 1, unit: "", endDate: "", count: null, anchor: "2026-11-23" },
  }));
  await assertSucceeds(getDoc(doc(db("bOp"), "jobs/pool1")));
  await assertFails(getDoc(doc(db("bOp"), "jobMoney/pool1")));
  await assertFails(updateDoc(doc(db("bOp"), "jobs/pool1"), { recurrence: { freq: "weekly" }, updatedAt: serverTimestamp(), updatedBy: "bOp" }));
});

test("a certificate is a job document: office and the assigned crew can read it, another crew cannot", async () => {
  const docId = "dCertPest12345678";
  const body = {
    companyId: "bravo", tenantId: "bravo", jobId: "pool1", name: "Pest treatment certificate",
    fileName: "Pest treatment certificate.pdf", contentType: "application/pdf", size: 1200,
    visibility: "crew", storagePath: `tenants/bravo/jobs/pool1/documents/${docId}`,
    uploaderUid: "bSup", uploaderName: "Sue", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(doc(db("bSup"), `jobs/pool1/documents/${docId}`), body));
  await assertSucceeds(getDoc(doc(db("bOp"), `jobs/pool1/documents/${docId}`)));
  await assertSucceeds(getDoc(doc(db("bAdm"), `jobs/pool1/documents/${docId}`)));
  await assertFails(getDoc(doc(db("bIdle"), `jobs/pool1/documents/${docId}`)));
});
