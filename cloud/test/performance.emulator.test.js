// Staff performance and Take 5 rules. Fake data only. Loads cloud/firestore.production.rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
let env;
const weights = { hours: 1, money: 1, jobs: 1, prestart: 1, take5: 1, incidents: 1, sick: 1, annual: 0 };
const steps = { stop: true, look: true, assess: true, control: true, proceed: true };

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-staff-performance",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const past = Timestamp.fromDate(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
    await setDoc(doc(db, "companies/bravo"), { name: "Bravo", status: "active", plan: "paid", isTest: false, billing: { provider: "stripe", status: "active", stripeCustomerId: "c", stripeSubscriptionId: "s" } });
    await setDoc(doc(db, "companies/paused"), { name: "Paused", status: "active", plan: "trial", isTest: false, trialEndsAt: past, billing: { provider: null, status: "not-configured", stripeCustomerId: null, stripeSubscriptionId: null } });
    await setDoc(doc(db, "users/bOp"), { role: "operator", name: "Bo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(db, "users/bSup"), { role: "supervisor", name: "Sue", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(db, "users/bMgr"), { role: "manager", name: "Mo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(db, "users/bAdmin"), { role: "admin", name: "Bea", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(db, "users/pOp"), { role: "operator", name: "Pat", companyId: "paused", tenantId: "paused" });
    await setDoc(doc(db, "users/op1"), { role: "operator", name: "Sam" });
    await setDoc(doc(db, "jobMoney/b1"), { jobId: "b1", companyId: "bravo", poAmount: 900, quoteAmount: 950, invoiceAmount: 1000 });
    await setDoc(doc(db, "incidentCounter/bravo"), { n: 0 });
    await setDoc(doc(db, "incidentCounter/main"), { n: 3 });
  });
});
test.after(async () => { if (env) await env.cleanup(); });
const db = uid => env.authenticatedContext(uid).firestore();

function take5(uid, companyId, id = "t5aaaaaaaaaaaaaaaa") {
  return {
    companyId, uid, name: "Bo", jobId: "job-1", jobNo: "18", day: "2026-11-15",
    note: "Wet floor. Cones out.", steps, photoPath: "", createdAt: serverTimestamp(),
  };
}

test("crew cannot read performance settings or job money, and can read only the Take 5 switch", async () => {
  await assertSucceeds(setDoc(doc(db("bAdmin"), "performanceSettings/bravo"), {
    companyId: "bravo", excludeLeaders: true, weights, updatedBy: "bAdmin", updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(db("bAdmin"), "take5Settings/bravo"), {
    companyId: "bravo", enabled: true, updatedBy: "bAdmin", updatedAt: serverTimestamp(),
  }));
  await assertFails(getDoc(doc(db("bOp"), "performanceSettings/bravo")));
  await assertFails(getDoc(doc(db("bSup"), "performanceSettings/bravo")));
  await assertFails(getDoc(doc(db("bOp"), "jobMoney/b1")));
  await assertSucceeds(getDoc(doc(db("bMgr"), "performanceSettings/bravo")));
  await assertSucceeds(getDoc(doc(db("bOp"), "take5Settings/bravo")));
  await assertFails(setDoc(doc(db("bOp"), "take5Settings/bravo"), { companyId: "bravo", enabled: false, updatedBy: "bOp", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db("bMgr"), "performanceSettings/bravo"), { weights: { ...weights, hours: 5 }, updatedAt: serverTimestamp(), updatedBy: "bMgr" }));
  await assertSucceeds(updateDoc(doc(db("bMgr"), "performanceSettings/bravo"), { excludeLeaders: false, updatedAt: serverTimestamp(), updatedBy: "bMgr" }));
});

test("crew can create their own Take 5 and incident, and cannot cross companies", async () => {
  const id = "t5bbbbbbbbbbbbbbbb";
  await assertSucceeds(setDoc(doc(db("bOp"), "take5s", id), take5("bOp", "bravo", id)));
  await assertFails(setDoc(doc(db("bOp"), "take5s/t5cccccccccccccccc"), take5("bOp", "heartwood", "t5cccccccccccccccc")));
  await assertFails(getDocs(query(collection(db("bOp"), "take5s"), where("companyId", "==", "bravo"))));
  await assertSucceeds(getDocs(query(collection(db("bSup"), "take5s"), where("companyId", "==", "bravo"))));
  await assertFails(getDoc(doc(db("op1"), "take5s", id)));
  const pausedId = "t5dddddddddddddddd";
  await assertFails(setDoc(doc(db("pOp"), "take5s", pausedId), take5("pOp", "paused", pausedId)));
  const op = db("bOp");
  const reportId = await assertSucceeds(runTransaction(op, async tx => {
    const counter = doc(op, "incidentCounter/bravo");
    const current = await tx.get(counter);
    const n = current.data().n + 1;
    const reportNo = "INC-" + String(n).padStart(4, "0");
    const incidentId = "bravo_" + reportNo;
    tx.set(counter, { n });
    tx.set(doc(op, "incidents", incidentId), {
      type: "Near miss", occurredAt: "2026-11-15T09:00", jobId: "job-1", jobNo: "18", location: "1 Test St",
      people: "Bo", staffInvolved: ["bOp"], what: "Slipped", injury: "", action: "Cleaned up",
      reportedBy: "bOp", reportedByName: "Bo", reportedAt: "2026-11-15T09:05:00.000Z", status: "Open",
      companyId: "bravo", tenantId: "bravo", rootCause: "", actions: [], history: [], seq: n, reportNo,
    });
    return incidentId;
  }));
  assert.equal(reportId, "bravo_INC-0001");
  await assertFails(getDocs(query(collection(db("bOp"), "incidents"), where("companyId", "==", "bravo"))));
  await assertSucceeds(getDocs(query(collection(db("bMgr"), "incidents"), where("companyId", "==", "bravo"))));
  await assertFails(getDoc(doc(db("op1"), "incidents", reportId)));
  await assertFails(getDocs(query(collection(db("op1"), "take5s"), where("companyId", "==", "bravo"))));
});

test("Heartwood crew can file their own Take 5 and Alex can read the ranking settings", async () => {
  const id = "t5eeeeeeeeeeeeeeee";
  await assertSucceeds(setDoc(doc(db("op1"), "take5s", id), take5("op1", "heartwood", id)));
  await assertSucceeds(getDoc(doc(db(ALEX), "take5s", id)));
  await assertFails(getDoc(doc(db("bOp"), "take5s", id)));
  await assertSucceeds(setDoc(doc(db(ALEX), "performanceSettings/heartwood"), {
    companyId: "heartwood", excludeLeaders: true, weights, updatedBy: ALEX, updatedAt: serverTimestamp(),
  }));
  await assertFails(getDoc(doc(db("op1"), "performanceSettings/heartwood")));
});
