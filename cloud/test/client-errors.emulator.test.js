// Phone error rules. Loads production Firestore rules in the emulator.
// Fake data only. Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, orderBy, limit, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const PATRICK = "R7t41e54Ykcdk9WPdVZnDd697iI2";
const ADMIN = "bravoAdmin";
const MANAGER = "bravoManager";
const CREW = "bravoCrew";
const HELD = "heldOp";
let env;

function ownerToken() {
  return { email: "alex@heartwoodew.com", email_verified: true, platformOwner: true };
}
function db(uid, token) { return env.authenticatedContext(uid, token).firestore(); }
function body(uid, extra = {}) {
  return {
    createdAt: serverTimestamp(),
    uid,
    role: "operator",
    appVersion: "callup-shell-v166",
    swVersion: "callup-shell-v166",
    screen: "/app/ hours",
    message: "ReferenceError: SHARE_MIN_MS is not defined",
    stack: "ReferenceError: SHARE_MIN_MS is not defined\n    at armShareWatch",
    userAgent: "test",
    online: true,
    ...extra,
  };
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-client-errors",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const root = ctx.firestore();
    await setDoc(doc(root, "users/" + ADMIN), { role: "admin", name: "Bea", companyId: "bravo" });
    await setDoc(doc(root, "users/" + MANAGER), { role: "manager", name: "Mo", companyId: "bravo" });
    await setDoc(doc(root, "users/" + CREW), { role: "operator", name: "Sam", companyId: "bravo" });
    await setDoc(doc(root, "users/" + PATRICK), { role: "operator", name: "Patrick", companyId: "heartwood" });
    await setDoc(doc(root, "users/" + HELD), { role: "operator", name: "Pat", companyId: "held" });
    await setDoc(doc(root, "companies/bravo"), { name: "Bravo", status: "active", plan: "paid", isTest: false, billing: { status: "active" } });
    await setDoc(doc(root, "companies/held"), { name: "Held", status: "active", plan: "paid", isTest: false, ownerPaused: true, billing: { status: "active" } });
  });
});

test.after(async () => { if (env) await env.cleanup(); });

test("a member creates a phone error and cannot read, change, or delete it", async () => {
  const ref = doc(db(CREW), "companies/bravo/clientErrors/errCrew1");
  await assertSucceeds(setDoc(ref, body(CREW)));
  await assertFails(getDoc(ref));
  await assertFails(getDocs(query(collection(db(CREW), "companies/bravo/clientErrors"), orderBy("createdAt", "desc"), limit(100))));
  await assertFails(updateDoc(ref, { message: "changed" }));
  await assertFails(deleteDoc(ref));
  await assertFails(setDoc(doc(db(CREW), "companies/bravo/clientErrors/errCrew2"), body("someone-else")));
  await assertFails(setDoc(doc(db(CREW), "companies/heartwood/clientErrors/errCrew3"), body(CREW)));
  await assertFails(setDoc(doc(db(CREW), "companies/bravo/clientErrors/errCrew4"), body(CREW, { lat: -27.47, lng: 153.02 })));
  await assertFails(setDoc(doc(db(CREW), "companies/bravo/clientErrors/errCrew5"), body(CREW, { poAmount: 50 })));
  await assertFails(setDoc(doc(db(CREW), "companies/bravo/clientErrors/errCrew6"), body(CREW, { stack: "x".repeat(2049) })));
  await assertFails(setDoc(doc(db(CREW), "companies/bravo/clientErrors/bad id"), body(CREW)));
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), "companies/bravo/clientErrors/errOut"), body(CREW)));
  await assertSucceeds(setDoc(doc(db(HELD), "companies/held/clientErrors/errHeld1"), body(HELD, { online: false })));

  const saved = await assertSucceeds(getDocs(query(collection(db(ADMIN), "companies/bravo/clientErrors"), orderBy("createdAt", "desc"), limit(100))));
  assert.equal(saved.size, 1);
  assert.equal(saved.docs[0].data().message, "ReferenceError: SHARE_MIN_MS is not defined");
  assert.equal(saved.docs[0].data().lat, undefined);
  await assertSucceeds(getDoc(doc(db(ADMIN), "companies/bravo/clientErrors/errCrew1")));
  await assertFails(getDocs(query(collection(db(MANAGER), "companies/bravo/clientErrors"), orderBy("createdAt", "desc"), limit(100))));
  await assertFails(getDoc(doc(db(MANAGER), "companies/bravo/clientErrors/errCrew1")));
  await assertFails(getDoc(doc(db(ADMIN), "companies/heartwood/clientErrors/nope")));
  await assertFails(updateDoc(doc(db(ADMIN), "companies/bravo/clientErrors/errCrew1"), { message: "no" }));
  await assertFails(deleteDoc(doc(db(ADMIN), "companies/bravo/clientErrors/errCrew1")));
});

test("Heartwood admins read Heartwood phone errors, including Patrick's operator profile", async () => {
  await assertSucceeds(setDoc(doc(db(PATRICK), "companies/heartwood/clientErrors/errPat1"), body(PATRICK)));
  const heartwood = await assertSucceeds(getDocs(query(collection(db(PATRICK), "companies/heartwood/clientErrors"), orderBy("createdAt", "desc"), limit(100))));
  assert.ok(heartwood.docs.some(d => d.id === "errPat1"));
  await assertFails(getDocs(query(collection(db(PATRICK), "companies/bravo/clientErrors"), orderBy("createdAt", "desc"), limit(100))));
  await assertSucceeds(getDocs(query(collection(db(ALEX, ownerToken()), "companies/heartwood/clientErrors"), orderBy("createdAt", "desc"), limit(100))));
  await assertFails(setDoc(doc(db(ALEX, ownerToken()), "companies/bravo/clientErrors/errAlex"), body(ALEX)));
  await assertFails(getDoc(doc(db(CREW), "companies/heartwood/clientErrors/errPat1")));
});
