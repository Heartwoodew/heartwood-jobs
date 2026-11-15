// Quote revisions and the capacity job read. Loads cloud/firestore.production.rules.
// Fake data only. Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, serverTimestamp } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
let env;

function rev(uid, name, companyId, quoteId, n = 1) {
  return {
    revision: n,
    quoteId,
    companyId,
    createdBy: uid,
    createdByName: name,
    createdAt: serverTimestamp(),
    createdAtIso: "2026-11-16T01:00:00.000Z",
    lines: [{ key: "machine:truck", label: "Truck + operator (2 h)", qty: 2, unit: "hour", rate: 100, amount: 200, note: "" }],
    extraItems: [],
    priceOverrides: {},
    totalEx: 200,
    gst: 20,
    totalInc: 220,
    changes: n === 1 ? ["First saved version"] : ["qty 2 → 3"]
  };
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-quote-revisions",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") }
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, "users/hwSup"), { role: "supervisor", name: "Sue", companyId: "heartwood" });
    await setDoc(doc(d, "users/hwOp"), { role: "operator", name: "Sam", companyId: "heartwood" });
    await setDoc(doc(d, "users/hwLab"), { role: "labourer", name: "Lee", companyId: "heartwood" });
    await setDoc(doc(d, "users/bSup"), { role: "supervisor", name: "Bo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bMgr"), { role: "manager", name: "Mia", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bOp"), { role: "operator", name: "Ben", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bLab"), { role: "labourer", name: "Lia", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/cAdm"), { role: "admin", name: "Cy", companyId: "charlie", tenantId: "charlie" });
    await setDoc(doc(d, "quotes/hwDraft"), { companyId: "heartwood", client: "Orbit", quoteStatus: "Draft", totalEx: 200, lines: [] });
    await setDoc(doc(d, "quotes/hwAccepted"), { companyId: "heartwood", client: "Orbit", quoteStatus: "Accepted", totalEx: 200, lines: [], acceptedRevision: 1 });
    await setDoc(doc(d, "quotes/bDraft"), { companyId: "bravo", tenantId: "bravo", client: "Acme", quoteStatus: "Draft", totalEx: 200, lines: [] });
    await setDoc(doc(d, "quotes/cDraft"), { companyId: "charlie", tenantId: "charlie", client: "Other", quoteStatus: "Draft", totalEx: 80, lines: [] });
    await setDoc(doc(d, "jobs/hwCap"), { companyId: "heartwood", client: "Orbit", address: "1 Creek Rd, Chuwar QLD 4306", assigned: ["hwOp"], status: "Scheduled", date: "2026-11-16" });
    await setDoc(doc(d, "jobs/bCap"), { companyId: "bravo", tenantId: "bravo", client: "Acme", address: "2 Other St", assigned: ["bOp"], status: "Scheduled", date: "2026-11-16" });
  });
});
test.after(async () => { if (env) await env.cleanup(); });
const db = uid => env.authenticatedContext(uid).firestore();

test("supervisor, manager and admin create and read their own company's revisions", async () => {
  await assertSucceeds(setDoc(doc(db("bSup"), "quotes/bDraft/revisions/r001"), rev("bSup", "Bo", "bravo", "bDraft", 1)));
  await assertSucceeds(setDoc(doc(db("bMgr"), "quotes/bDraft/revisions/r002"), rev("bMgr", "Mia", "bravo", "bDraft", 2)));
  await assertSucceeds(setDoc(doc(db(ALEX), "quotes/hwDraft/revisions/r001"), rev(ALEX, "Alex", "heartwood", "hwDraft", 1)));
  await assertSucceeds(setDoc(doc(db("hwSup"), "quotes/hwDraft/revisions/r002"), rev("hwSup", "Sue", "heartwood", "hwDraft", 2)));
  const got = await assertSucceeds(getDoc(doc(db("bSup"), "quotes/bDraft/revisions/r001")));
  assert.equal(got.data().totalEx, 200);
  const listed = await assertSucceeds(getDocs(query(collection(db("bMgr"), "quotes/bDraft/revisions"), where("companyId", "==", "bravo"))));
  assert.equal(listed.size, 2);
  const hw = await assertSucceeds(getDocs(query(collection(db("hwSup"), "quotes/hwDraft/revisions"), where("companyId", "==", "heartwood"))));
  assert.equal(hw.size, 2);
  await assertSucceeds(updateDoc(doc(db("hwSup"), "quotes/hwDraft"), { client: "Orbit 2", priceOverrides: {} }));
  await assertFails(updateDoc(doc(db("hwOp"), "quotes/hwDraft"), { client: "Nope" }));
});

test("crew cannot read or create revisions, including across companies", async () => {
  for (const uid of ["bOp", "bLab", "hwOp", "hwLab"]) {
    await assertFails(getDoc(doc(db(uid), "quotes/bDraft/revisions/r001")));
    await assertFails(getDoc(doc(db(uid), "quotes/hwDraft/revisions/r001")));
    await assertFails(getDocs(query(collection(db(uid), "quotes/bDraft/revisions"), where("companyId", "==", "bravo"))));
  }
  await assertFails(setDoc(doc(db("bOp"), "quotes/bDraft/revisions/r003"), rev("bOp", "Ben", "bravo", "bDraft", 3)));
  await assertFails(setDoc(doc(db("bLab"), "quotes/bDraft/revisions/r004"), rev("bLab", "Lia", "bravo", "bDraft", 4)));
  await assertFails(getDoc(doc(db("cAdm"), "quotes/bDraft/revisions/r001")));
  await assertFails(setDoc(doc(db("cAdm"), "quotes/bDraft/revisions/r005"), rev("cAdm", "Cy", "bravo", "bDraft", 5)));
  await assertFails(setDoc(doc(db("bSup"), "quotes/cDraft/revisions/r001"), rev("bSup", "Bo", "bravo", "cDraft", 1)));
  await assertFails(setDoc(doc(db("bSup"), "quotes/hwDraft/revisions/r003"), rev("bSup", "Bo", "heartwood", "hwDraft", 3)));
  await assertFails(getDocs(query(collection(db("bSup"), "quotes/hwDraft/revisions"), where("companyId", "==", "heartwood"))));
});

test("past revisions cannot be edited or deleted, and an accepted quote takes no new revision", async () => {
  await assertFails(updateDoc(doc(db("bSup"), "quotes/bDraft/revisions/r001"), { totalEx: 1 }));
  await assertFails(deleteDoc(doc(db("bSup"), "quotes/bDraft/revisions/r001")));
  await assertFails(updateDoc(doc(db(ALEX), "quotes/hwDraft/revisions/r001"), { changes: ["tampered"] }));
  await assertFails(setDoc(doc(db("hwSup"), "quotes/hwAccepted/revisions/r001"), rev("hwSup", "Sue", "heartwood", "hwAccepted", 1)));
  await assertFails(updateDoc(doc(db(ALEX), "quotes/hwAccepted"), { client: "Changed after accept" }));
  const bad = rev("bSup", "Bo", "bravo", "bDraft", 6);
  bad.note = "nope";
  await assertFails(setDoc(doc(db("bSup"), "quotes/bDraft/revisions/r006"), bad));
});

test("a supervisor can read the company's jobs for capacity and not another company's", async () => {
  await assertSucceeds(getDoc(doc(db("hwSup"), "jobs/hwCap")));
  await assertSucceeds(getDocs(query(collection(db("hwSup"), "jobs"), where("companyId", "==", "heartwood"))));
  await assertFails(getDoc(doc(db("hwSup"), "jobs/bCap")));
  await assertFails(getDocs(query(collection(db("hwSup"), "jobs"), where("companyId", "==", "bravo"))));
  await assertFails(updateDoc(doc(db("hwSup"), "jobs/hwCap"), { address: "changed" }));
  await assertSucceeds(getDoc(doc(db("bSup"), "jobs/bCap")));
  await assertFails(getDoc(doc(db("bOp"), "jobs/hwCap")));
  await assertFails(getDocs(query(collection(db("bLab"), "jobs"), where("companyId", "==", "bravo"))));
});
