// Locked profile uids (28 Nov 2026): Alex, Patrick and the box sync user may never get a users/{uid} profile for another
// company. An old copy of the app once ran the signup recovery and wrote Alex a Yard demo profile. Loads
// cloud/firestore.production.rules (and the emulator rules for the self-create path). Fake data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2", PAT = "R7t41e54Ykcdk9WPdVZnDd697iI2", SYNC = "38SU5waAy4f9UI9N6JTqDMaYpQg2";
const alexToken = { email: "alex@heartwoodew.com", email_verified: true };
const ownerShape = (companyId, name = "Owner") => ({ name, email: "owner@example.com", role: "admin", companyId, tenantId: companyId, jobTitle: "Admin", jobTitleId: "earthworks:admin" });
let env, envEmu;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-profile-lock",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  envEmu = await initializeTestEnvironment({
    projectId: "demo-profile-lock-emu",
    firestore: { rules: readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8") },
  });
  const billing = { provider: null, status: "not-configured", stripeCustomerId: null, stripeSubscriptionId: null };
  for (const e of [env, envEmu]) {
    await e.withSecurityRulesDisabled(async ctx => {
      const d = ctx.firestore();
      await setDoc(doc(d, "companies/heartwood"), { name: "Heartwood", status: "active" });
      await setDoc(doc(d, "companies/yard-test"), { name: "Yard test", isTest: true, status: "active", plan: "trial", ownerUid: ALEX, billing });
      await setDoc(doc(d, "companies/pat-trial"), { name: "Pat trial", isTest: false, status: "active", plan: "trial", ownerUid: PAT, billing });
      await setDoc(doc(d, "companies/sync-co"), { name: "Sync co", isTest: false, status: "active", plan: "trial", ownerUid: SYNC, billing });
      await setDoc(doc(d, "companies/bravo"), { name: "Bravo", isTest: false, status: "active", plan: "trial", ownerUid: "bravoOwner", billing });
      await setDoc(doc(d, "users/" + PAT), { role: "operator", name: "Patrick", companyId: "heartwood", staffName: "Patrick" });
    });
  }
});
test.after(async () => { if (env) await env.cleanup(); if (envEmu) await envEmu.cleanup(); });

const db = (e, uid, token) => e.authenticatedContext(uid, token).firestore();

test("control: an ordinary new owner can still write their own admin profile at signup", async () => {
  await assertSucceeds(setDoc(doc(db(env, "bravoOwner"), "users/bravoOwner"), ownerShape("bravo", "Bea")));
});

test("production: the signup-recovery profile is refused for Alex (the 28 Nov Yard demo profile)", async () => {
  const a = db(env, ALEX, alexToken);
  await assertFails(setDoc(doc(a, "users/" + ALEX), ownerShape("yard-test", "Yard demo")));
  await assertFails(setDoc(doc(a, "users/" + ALEX), { ...ownerShape("yard-test"), companyId: "heartwood" }));
  await assertFails(setDoc(doc(a, "users/" + ALEX), { name: "Alex", role: "admin", companyId: "yard-test", tenantId: "yard-test" }));
});

test("production: Patrick and the box sync user cannot be given another company's profile", async () => {
  const p = db(env, PAT);
  await assertFails(setDoc(doc(p, "users/" + PAT), ownerShape("pat-trial", "Patrick Marsh")));
  await assertFails(updateDoc(doc(p, "users/" + PAT), { companyId: "bravo", tenantId: "bravo" }));
  await assertFails(updateDoc(doc(p, "users/" + PAT), { tenantId: "bravo" }));
  const s = db(env, SYNC);
  await assertFails(setDoc(doc(s, "users/" + SYNC), { role: "admin", name: "Sync", companyId: "sync-co", tenantId: "sync-co" }));
  await assertFails(setDoc(doc(s, "users/" + SYNC), { role: "admin", name: "Sync", companyId: "heartwood", tenantId: "sync-co" }));
});

test("production: the platform owner cannot write a test-company profile onto a locked uid", async () => {
  const a = db(env, ALEX, alexToken);
  await assertFails(setDoc(doc(a, "users/" + PAT), { role: "admin", name: "Patrick", companyId: "yard-test", tenantId: "yard-test" }));
  await assertFails(setDoc(doc(a, "users/" + SYNC), { role: "admin", name: "Sync", companyId: "yard-test", tenantId: "yard-test" }));
});

test("production: Heartwood profiles for the locked uids still work, and the box sync user keeps its other access", async () => {
  const a = db(env, ALEX, alexToken);
  await assertSucceeds(setDoc(doc(a, "users/" + ALEX), { name: "Alex", role: "admin", companyId: "heartwood" }));
  await assertSucceeds(setDoc(doc(a, "users/" + ALEX), { name: "Alex", role: "admin" }));
  const p = db(env, PAT);
  await assertSucceeds(updateDoc(doc(p, "users/" + PAT), { name: "Patrick M" }));
  const s = db(env, SYNC);
  await assertSucceeds(setDoc(doc(s, "users/" + SYNC), { role: "admin", name: "Sync", companyId: "heartwood", tenantId: "heartwood" }));
  await assertSucceeds(setDoc(doc(s, "users/someoneElse"), { role: "operator", name: "Other staff", companyId: "bravo", tenantId: "bravo" }));
  await assertSucceeds(updateDoc(doc(s, "users/someoneElse"), { name: "Other staff 2" }));
  await assertSucceeds(getDoc(doc(s, "users/" + SYNC)));
});

test("production: a stray profile can still be removed (delete is not locked)", async () => {
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), "users/" + ALEX), ownerShape("yard-test", "Yard demo")); });
  await assertSucceeds(deleteDoc(doc(db(env, SYNC), "users/" + ALEX)));
  await assertFails(getDoc(doc(db(env, "stranger"), "users/" + ALEX)));
});

test("emulator rules: the same lock holds for the self-create path", async () => {
  const a = db(envEmu, ALEX, alexToken);
  await assertFails(setDoc(doc(a, "users/" + ALEX), ownerShape("yard-test", "Yard demo")));
  await assertSucceeds(setDoc(doc(db(envEmu, "bravoOwner"), "users/bravoOwner"), ownerShape("bravo", "Bea")));
  await assertSucceeds(setDoc(doc(a, "users/" + ALEX), { name: "Alex" }));
});

test("rules text: the lock covers the three uids and every create/update path in both rules files", () => {
  for (const f of ["../firestore.production.rules", "../emulator/firestore.rules"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /function lockedProfileUid\(id\)/);
    for (const uid of [ALEX, PAT, SYNC]) assert.ok(src.includes(`"${uid}"`), `${f} names ${uid}`);
    assert.match(src, /function lockedProfileOk\(id\)/);
  }
  const prod = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  const users = prod.slice(prod.indexOf("match /users/{uid} {"), prod.indexOf("    // Job money (Nov 2026"));
  assert.ok(!/allow read, write: if isSync\(\)/.test(users), "isSync write must carry the lock");
  for (const needle of ["lockedProfileOk(uid) && ownerProfileCreate()", "allow create, update: if isSync() && lockedProfileOk(uid)", "&& lockedProfileOk(uid);\n      allow update: if isAdmin()", "testCompanyId(docCompany(docData())) && lockedProfileOk(uid)"]) {
    assert.ok(users.includes(needle), "missing: " + needle);
  }
});
