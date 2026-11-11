// Staff profiles (users/) are company-scoped: Heartwood admins see Heartwood staff only, the platform owner sees TEST
// companies only, other companies' office staff see their own. Loads cloud/firestore.production.rules. Fake data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2", PAT = "R7t41e54Ykcdk9WPdVZnDd697iI2", SYNC = "38SU5waAy4f9UI9N6JTqDMaYpQg2";
const WS = "2026-11-09";
let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-profile-scope",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    const billing = { provider: null, status: "not-configured", stripeCustomerId: null, stripeSubscriptionId: null };
    await setDoc(doc(d, "companies/heartwood"), { name: "Heartwood", status: "active" });
    await setDoc(doc(d, "companies/bravo"), { name: "Bravo", isTest: false, status: "active", plan: "trial", ownerUid: "bravoAdm", billing });
    await setDoc(doc(d, "companies/yard-test"), { name: "Yard test", isTest: true, status: "active", plan: "trial", ownerUid: ALEX, billing });
    await setDoc(doc(d, "users/" + PAT), { role: "operator", name: "Patrick", companyId: "heartwood", staffName: "Patrick" });
    await setDoc(doc(d, "users/hwOp"), { role: "operator", name: "Test Worker", companyId: "heartwood" });
    await setDoc(doc(d, "users/hwSup"), { role: "supervisor", name: "Hana", companyId: "heartwood" });
    await setDoc(doc(d, "users/legacy"), { role: "operator", name: "Nick" });
    await setDoc(doc(d, "users/bravoAdm"), { role: "admin", name: "Bea", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bravoSup"), { role: "supervisor", name: "Bo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bravoOp"), { role: "operator", name: "Bri", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/demo-yard-test-sam"), { role: "operator", name: "Sam", companyId: "yard-test", tenantId: "yard-test", demo: true });
    await setDoc(doc(d, `timesheets/hwOp_${WS}`), { companyId: "heartwood", uid: "hwOp", name: "Test Worker", weekStart: WS });
    await setDoc(doc(d, `timesheets/legacy_${WS}`), { uid: "legacy", name: "Nick", weekStart: WS });
    await setDoc(doc(d, "jobs/hw1"), { companyId: "heartwood", client: "HW", assigned: ["hwOp"], date: "2026-11-11", status: "Scheduled" });
  });
});
test.after(async () => { if (env) await env.cleanup(); });

const db = (uid, token) => env.authenticatedContext(uid, token).firestore();
const alexToken = { email: "alex@heartwoodew.com", email_verified: true };

test("Heartwood admin (Patrick) still sees every Heartwood profile, timesheet and the planner jobs", async () => {
  const p = db(PAT);
  const list = await assertSucceeds(getDocs(query(collection(p, "users"), where("companyId", "==", "heartwood"))));
  assert.deepEqual(list.docs.map(x => x.id).sort(), [PAT, "hwOp", "hwSup"].sort());
  await assertSucceeds(getDoc(doc(p, "users/legacy")));
  await assertSucceeds(updateDoc(doc(p, "users/hwOp"), { name: "Test Worker 2" }));
  await assertSucceeds(setDoc(doc(p, "users/hwNew"), { role: "operator", name: "New", companyId: "heartwood" }));
  await assertSucceeds(getDocs(query(collection(p, "jobs"), where("companyId", "==", "heartwood"), where("date", ">=", "2026-11-01"))));
  const a = db(ALEX, alexToken);
  const ts = await assertSucceeds(getDocs(query(collection(a, "timesheets"), where("companyId", "==", "heartwood"), where("weekStart", "==", WS))));
  assert.ok(ts.docs.some(x => x.id === `hwOp_${WS}`));
  await assertSucceeds(getDoc(doc(a, `timesheets/legacy_${WS}`)));
  await assertSucceeds(getDocs(query(collection(a, "users"), where("companyId", "==", "heartwood"))));
});

test("Heartwood admins cannot read, list or edit another company's staff profiles", async () => {
  for (const [uid, token] of [[PAT, undefined], [ALEX, alexToken]]) {
    const x = db(uid, token);
    await assertFails(getDocs(collection(x, "users")));
    await assertFails(getDocs(query(collection(x, "users"), where("companyId", "==", "bravo"))));
    await assertFails(getDoc(doc(x, "users/bravoAdm")));
    await assertFails(getDoc(doc(x, "users/bravoOp")));
    await assertFails(updateDoc(doc(x, "users/bravoOp"), { role: "admin" }));
    await assertFails(updateDoc(doc(x, "users/bravoOp"), { companyId: "heartwood", tenantId: "heartwood" }));
    await assertFails(deleteDoc(doc(x, "users/bravoOp")));
    await assertFails(setDoc(doc(x, "users/planted"), { role: "admin", name: "Planted", companyId: "bravo", tenantId: "bravo" }));
    await assertFails(updateDoc(doc(x, "users/hwOp"), { companyId: "bravo" }));
  }
});

test("Patrick cannot use the platform owner's test-company access", async () => {
  const p = db(PAT);
  await assertFails(getDoc(doc(p, "users/demo-yard-test-sam")));
  await assertFails(setDoc(doc(p, "users/demo-yard-test-sue"), { role: "supervisor", name: "Sue", companyId: "yard-test", tenantId: "yard-test", demo: true }));
});

test("platform owner keeps test-company staff access only (open-as-test, demo reset)", async () => {
  const a = db(ALEX, alexToken);
  await assertSucceeds(getDoc(doc(a, "users/demo-yard-test-sam")));
  await assertSucceeds(setDoc(doc(a, "users/demo-yard-test-sue"), { role: "supervisor", name: "Sue", companyId: "yard-test", tenantId: "yard-test", demo: true }));
  await assertSucceeds(setDoc(doc(a, "users/demo-yard-test-sam"), { role: "operator", name: "Sam Taylor", companyId: "yard-test", tenantId: "yard-test", demo: true }));
  await assertFails(updateDoc(doc(a, "users/demo-yard-test-sam"), { companyId: "bravo" }));
  await assertFails(getDocs(query(collection(a, "users"), where("companyId", "==", "yard-test"))));
  await assertSucceeds(setDoc(doc(a, "platformSessions/" + ALEX), { companyId: "yard-test" }));
  const list = await assertSucceeds(getDocs(query(collection(a, "users"), where("companyId", "==", "yard-test"))));
  assert.ok(list.docs.every(x => x.data().companyId === "yard-test"));
  await assertFails(getDocs(query(collection(a, "users"), where("companyId", "==", "bravo"))));
  await assertFails(getDoc(doc(a, "users/bravoOp")));
  await assertSucceeds(setDoc(doc(a, "platformSessions/" + ALEX), { companyId: "" }));
  // An unverified Alex token gets no test-company access.
  await assertFails(getDoc(doc(db(ALEX, { email: "alex@heartwoodew.com", email_verified: false }), "users/demo-yard-test-sam")));
});

test("other companies' office staff see only their own staff; Heartwood staff see only themselves", async () => {
  for (const uid of ["bravoAdm", "bravoSup"]) {
    const b = db(uid);
    const list = await assertSucceeds(getDocs(query(collection(b, "users"), where("companyId", "==", "bravo"))));
    assert.equal(list.size, 3);
    await assertFails(getDocs(query(collection(b, "users"), where("companyId", "==", "heartwood"))));
    await assertFails(getDoc(doc(b, "users/" + PAT)));
    await assertFails(getDoc(doc(b, "users/legacy")));
    await assertFails(updateDoc(doc(b, "users/bravoOp"), { role: "admin" }));
  }
  const op = db("hwOp");
  await assertSucceeds(getDoc(doc(op, "users/hwOp")));
  await assertFails(getDoc(doc(op, "users/hwSup")));
  await assertFails(getDocs(query(collection(op, "users"), where("companyId", "==", "heartwood"))));
  const sup = db("hwSup");
  await assertFails(getDocs(query(collection(sup, "users"), where("companyId", "==", "heartwood"))));
  await assertFails(getDoc(doc(db("bravoOp"), "users/bravoSup")));
});

test("box sync account keeps full profile access; signed-out is refused", async () => {
  const s = db(SYNC);
  await assertSucceeds(getDocs(collection(s, "users")));
  await assertSucceeds(getDoc(doc(s, "users/bravoOp")));
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(getDocs(collection(anon, "users")));
  await assertFails(getDoc(doc(anon, "users/hwOp")));
});
