// Office of a company can read and write that company's sent-email list. Crew cannot.
// Another company cannot. No price field, no list, no delete. Emulator only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const BADM = "bAdm";
const BSUP = "bSup";
const BOP = "bOp";
const OP = "op1";
let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-autofill",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/" + BADM), { role: "admin", name: "Bea", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(db, "users/" + BSUP), { role: "supervisor", name: "Sue", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(db, "users/" + BOP), { role: "operator", name: "Bo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(db, "users/" + OP), { role: "operator", name: "Sam", companyId: "heartwood", tenantId: "heartwood" });
    await setDoc(doc(db, "users/" + ALEX), { role: "admin", name: "Alex", companyId: "heartwood", tenantId: "heartwood" });
    await setDoc(doc(db, "companies/bravo"), { name: "Bravo", status: "active", plan: "paid", isTest: false, ownerPaused: false, billing: { status: "active" } });
  });
});

test.after(async () => { if (env) await env.cleanup(); });

const db = uid => env.authenticatedContext(uid).firestore();
function body(company, uid, emails = ["a@bravo.test"]) {
  return { companyId: company, emails, updatedAt: serverTimestamp(), updatedBy: uid };
}

test("office can store and read sent recipients; crew and other companies cannot", async () => {
  const admin = db(BADM);
  const ref = doc(admin, "companies/bravo/autofill/recipients");
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(setDoc(ref, body("bravo", BADM)));
  const saved = await assertSucceeds(getDoc(ref));
  assert.deepEqual(saved.data().emails, ["a@bravo.test"]);
  await assertSucceeds(setDoc(doc(db(BSUP), "companies/bravo/autofill/recipients"), body("bravo", BSUP, ["sue@bravo.test"])));
  await assertSucceeds(getDoc(doc(db(BSUP), "companies/bravo/autofill/recipients")));

  await assertFails(getDoc(doc(db(BOP), "companies/bravo/autofill/recipients")));
  await assertFails(setDoc(doc(db(BOP), "companies/bravo/autofill/recipients"), body("bravo", BOP)));
  await assertFails(getDoc(doc(db(OP), "companies/bravo/autofill/recipients")));
  await assertFails(getDoc(doc(db(ALEX), "companies/bravo/autofill/recipients")));
  await assertFails(getDoc(doc(db(BADM), "companies/heartwood/autofill/recipients")));

  await assertSucceeds(setDoc(doc(db(ALEX), "companies/heartwood/autofill/recipients"), body("heartwood", ALEX, ["office@heartwood.test"])));
  await assertFails(getDoc(doc(db(OP), "companies/heartwood/autofill/recipients")));
  await assertFails(getDocs(collection(admin, "companies/bravo/autofill")));
  await assertFails(deleteDoc(ref));
  await assertFails(setDoc(ref, { ...body("bravo", BADM), amount: 12 }));
  await assertFails(setDoc(ref, body("bravo", "someone-else")));
  const tooMany = Array.from({ length: 41 }, (_, i) => `p${i}@bravo.test`);
  await assertFails(setDoc(ref, body("bravo", BADM, tooMany)));
  await assertFails(setDoc(doc(admin, "companies/bravo/autofill/prices"), body("bravo", BADM)));
});
