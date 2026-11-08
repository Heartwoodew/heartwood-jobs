// Loads cloud/firestore.production.rules. Fake data only. Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const OP = "op1";
const BRAVO = "coB";

let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-production-rules",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/op1"), { role: "operator", name: "Sam" });
    await setDoc(doc(db, "users/coB"), { role: "admin", name: "Bea", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(db, "jobs/legacy"), { client: "Orbit Homes", address: "1 Creek Rd", assigned: [OP], status: "Scheduled" });
    await setDoc(doc(db, "jobs/hw1"), { companyId: "heartwood", client: "Secret Homes", address: "9 Private Rd", assigned: [OP], status: "Scheduled" });
    await setDoc(doc(db, "jobs/hw2"), { companyId: "heartwood", client: "Other Homes", address: "2 Other St", assigned: [], status: "Scheduled" });
    await setDoc(doc(db, "jobs/bravo1"), { companyId: "bravo", tenantId: "bravo", client: "Bravo Secret", address: "8 Hidden St", assigned: [BRAVO], status: "Scheduled" });
    await setDoc(doc(db, "quotes/q1"), { companyId: "heartwood", client: "Secret Quote", quoteStatus: "Draft" });
    await setDoc(doc(db, "receipts/r1"), { uid: OP, supplier: "Secret supplier", jobId: "hw1", amountInc: 10, status: "queued" });
    await setDoc(doc(db, "inbox/mail1"), { builder: "Orbit", subject: "PO for Secret Homes", read: false });
    await setDoc(doc(db, "hoursExports/hxheartwood0123456"), { companyId: "heartwood", companyName: "Heartwood", to: "accounts@heartwoodew.com", status: "queued" });
    await setDoc(doc(db, "leaveRequests/lvheartwood012345"), { companyId: "heartwood", uid: OP, name: "Sam", status: "pending" });
    await setDoc(doc(db, "reimbursementClaims/rc1"), { companyId: "heartwood", uid: OP, name: "Sam", status: "submitted", supplier: "Secret shop" });
    await setDoc(doc(db, "swmsSignatures/s1"), { companyId: "heartwood", uid: OP, name: "Sam", swmsId: "mobile-plant" });
    await setDoc(doc(db, "tenants/heartwood/fleet/tipper"), { type: "vehicle", name: "Tipper" });
    await setDoc(doc(db, "tenants/heartwood/chats/staff/messages/m1"), { text: "Hello from Heartwood", senderUid: ALEX });
    await setDoc(doc(db, "meta/quoteRates"), { travelPerKm: 4 });
  });
});

test.after(async () => { if (env) await env.cleanup(); });

function db(uid) { return env.authenticatedContext(uid).firestore(); }

test("Heartwood admin and assigned staff keep jobs, quotes, inbox, hours, leave, fleet and chat", async () => {
  const alex = db(ALEX);
  const op = db(OP);
  const legacy = await assertSucceeds(getDoc(doc(alex, "jobs/legacy")));
  assert.equal(legacy.data().client, "Orbit Homes");
  assert.equal(legacy.data().companyId, undefined);
  await assertSucceeds(getDoc(doc(alex, "jobs/hw1")));
  await assertSucceeds(getDocs(query(collection(alex, "jobs"), where("companyId", "==", "heartwood"))));
  await assertSucceeds(setDoc(doc(alex, "jobs/hwnew"), { companyId: "heartwood", client: "New Homes", address: "3 New St", assigned: [], status: "Scheduled" }));
  await assertSucceeds(updateDoc(doc(alex, "jobs/hw1"), { address: "9 Private Road" }));
  await assertSucceeds(getDoc(doc(op, "jobs/hw1")));
  await assertSucceeds(getDoc(doc(op, "jobs/legacy")));
  await assertFails(getDoc(doc(op, "jobs/hw2")));
  const mine = await assertSucceeds(getDocs(query(collection(op, "jobs"), where("companyId", "==", "heartwood"), where("assigned", "array-contains", OP))));
  assert.ok(mine.docs.some(d => d.id === "hw1"));
  assert.ok(!mine.docs.some(d => d.id === "hw2"));
  const quote = await assertSucceeds(getDoc(doc(alex, "quotes/q1")));
  assert.equal(quote.data().client, "Secret Quote");
  await assertSucceeds(getDocs(query(collection(alex, "quotes"), where("companyId", "==", "heartwood"))));
  await assertSucceeds(getDoc(doc(alex, "inbox/mail1")));
  await assertFails(getDoc(doc(op, "inbox/mail1")));
  await assertSucceeds(getDoc(doc(alex, "hoursExports/hxheartwood0123456")));
  await assertSucceeds(getDoc(doc(alex, "leaveRequests/lvheartwood012345")));
  await assertSucceeds(getDoc(doc(op, "leaveRequests/lvheartwood012345")));
  await assertSucceeds(getDoc(doc(alex, "reimbursementClaims/rc1")));
  await assertSucceeds(getDoc(doc(alex, "swmsSignatures/s1")));
  await assertSucceeds(getDoc(doc(alex, "tenants/heartwood/fleet/tipper")));
  const chat = await assertSucceeds(getDoc(doc(alex, "tenants/heartwood/chats/staff/messages/m1")));
  assert.equal(chat.data().text, "Hello from Heartwood");
  const rates = await assertSucceeds(getDoc(doc(alex, "meta/quoteRates")));
  assert.equal(rates.data().travelPerKm, 4);
  const receipt = await assertSucceeds(getDoc(doc(op, "receipts/r1")));
  assert.equal(receipt.data().supplier, "Secret supplier");
});

test("a second company cannot read Heartwood jobs, quotes, receipts, inbox, hours, leave, fleet or chat", async () => {
  const bravo = db(BRAVO);
  for (const path of [
    "jobs/legacy", "jobs/hw1", "jobs/hw2", "quotes/q1", "receipts/r1", "inbox/mail1",
    "hoursExports/hxheartwood0123456", "leaveRequests/lvheartwood012345", "reimbursementClaims/rc1",
    "swmsSignatures/s1", "tenants/heartwood/fleet/tipper", "tenants/heartwood/chats/staff/messages/m1",
    "meta/quoteRates",
  ]) {
    await assertFails(getDoc(doc(bravo, path)));
  }
  await assertFails(getDocs(query(collection(bravo, "jobs"), where("companyId", "==", "heartwood"))));
  await assertFails(getDocs(query(collection(bravo, "quotes"), where("companyId", "==", "heartwood"))));
  const own = await assertSucceeds(getDoc(doc(bravo, "jobs/bravo1")));
  assert.equal(own.data().client, "Bravo Secret");
  await assertFails(updateDoc(doc(bravo, "jobs/hw1"), { client: "Stolen" }));
  await assertFails(setDoc(doc(bravo, "jobs/stolen"), { companyId: "heartwood", client: "Stolen", address: "x", assigned: [], status: "Scheduled" }));
});
