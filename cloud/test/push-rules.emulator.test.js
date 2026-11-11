// Chat push tokens, push settings and the daily digest log, against cloud/firestore.production.rules.
// Fake data only. Never points at heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, collection, getDocs, query, where } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const TOK = "a".repeat(32), TOK2 = "b".repeat(32);
let env;
const db = uid => env.authenticatedContext(uid).firestore();
const token = (companyId, extra = {}) => ({ token: "fcm-" + "x".repeat(40), companyId, origin: "https://app.callupapp.com.au", platform: "web", updatedAt: serverTimestamp(), ...extra });

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-push-rules",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, "users/" + ALEX), { role: "admin", name: "Alex" });
    await setDoc(doc(d, "users/hwOp"), { role: "operator", name: "Sam" });
    await setDoc(doc(d, "users/bAdm"), { role: "admin", name: "Bea", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bOp"), { role: "operator", name: "Bo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/cOp"), { role: "operator", name: "Cy", companyId: "charlie", tenantId: "charlie" });
    await setDoc(doc(d, "users/bOp/fcmTokens/" + TOK), { token: "fcm-" + "y".repeat(40), companyId: "bravo", origin: "https://app.callupapp.com.au", platform: "web" });
    await setDoc(doc(d, "dailyJobDigest/bravo_2026-11-12_bOp"), { companyId: "bravo", date: "2026-11-12", uid: "bOp", jobIds: ["j1"] });
  });
});
test.after(async () => { if (env) await env.cleanup(); });

test("a push token is tagged with the caller's own company only", async () => {
  await assertSucceeds(setDoc(doc(db("bAdm"), `users/bAdm/fcmTokens/${TOK}`), token("bravo")));
  await assertFails(setDoc(doc(db("bAdm"), `users/bAdm/fcmTokens/${TOK2}`), token("heartwood")));
  await assertFails(setDoc(doc(db("bAdm"), `users/bAdm/fcmTokens/${TOK2}`), token("charlie")));
  await assertSucceeds(setDoc(doc(db("hwOp"), `users/hwOp/fcmTokens/${TOK}`), token("heartwood")));
  await assertFails(setDoc(doc(db("hwOp"), `users/hwOp/fcmTokens/${TOK2}`), token("bravo")));
  await assertSucceeds(setDoc(doc(db(ALEX), `users/${ALEX}/fcmTokens/${TOK}`), token("heartwood", { origin: "https://jobs.heartwoodew.com" })));
  // No profile and not Alex or Patrick: no company, so no token.
  await assertFails(setDoc(doc(db("ghost"), `users/ghost/fcmTokens/${TOK}`), token("heartwood")));
});

test("push tokens are private to their owner and cannot carry extra fields", async () => {
  await assertFails(getDoc(doc(db("bAdm"), `users/bOp/fcmTokens/${TOK}`)));
  await assertFails(getDoc(doc(db(ALEX), `users/bOp/fcmTokens/${TOK}`)));
  await assertFails(getDocs(collection(db("bAdm"), "users/bOp/fcmTokens")));
  await assertFails(getDocs(query(collection(db("bAdm"), "users/bOp/fcmTokens"), where("companyId", "==", "bravo"))));
  await assertFails(setDoc(doc(db("bAdm"), `users/bOp/fcmTokens/${TOK2}`), token("bravo")));
  await assertFails(deleteDoc(doc(db("bAdm"), `users/bOp/fcmTokens/${TOK}`)));
  await assertFails(setDoc(doc(db("bOp"), `users/bOp/fcmTokens/${TOK2}`), token("bravo", { role: "admin" })));
  await assertFails(setDoc(doc(db("bOp"), `users/bOp/fcmTokens/${TOK2}`), token("bravo", { origin: "https://evil.example" })));
  await assertFails(setDoc(doc(db("bOp"), `users/bOp/fcmTokens/NOT-HEX`), token("bravo")));
  await assertFails(setDoc(doc(db("bOp"), `users/bOp/fcmTokens/${TOK2}`), token("bravo", { token: "short" })));
  await assertSucceeds(getDoc(doc(db("bOp"), `users/bOp/fcmTokens/${TOK}`)));
  await assertSucceeds(deleteDoc(doc(db("bOp"), `users/bOp/fcmTokens/${TOK}`)));
});

test("push settings are the caller's own, three booleans only", async () => {
  await assertSucceeds(setDoc(doc(db("bOp"), "users/bOp/chatSettings/prefs"), { sound: true, push: true, dailyJobs: false }));
  await assertSucceeds(updateDoc(doc(db("bOp"), "users/bOp/chatSettings/prefs"), { dailyJobs: true }));
  await assertFails(updateDoc(doc(db("bOp"), "users/bOp/chatSettings/prefs"), { dailyJobs: "yes" }));
  await assertFails(setDoc(doc(db("bOp"), "users/bOp/chatSettings/prefs"), { sound: true, push: true, role: "admin" }));
  await assertFails(setDoc(doc(db("bOp"), "users/bOp/chatSettings/other"), { sound: true, push: true }));
  await assertFails(setDoc(doc(db("bAdm"), "users/bOp/chatSettings/prefs"), { sound: false, push: false }));
  await assertFails(getDoc(doc(db("bAdm"), "users/bOp/chatSettings/prefs")));
  await assertFails(deleteDoc(doc(db("bOp"), "users/bOp/chatSettings/prefs")));
});

test("the daily digest log is server only", async () => {
  for (const uid of [ALEX, "bAdm", "bOp"]) {
    await assertFails(getDoc(doc(db(uid), "dailyJobDigest/bravo_2026-11-12_bOp")));
    await assertFails(setDoc(doc(db(uid), "dailyJobDigest/bravo_2026-11-13_bOp"), { companyId: "bravo" }));
  }
  await assertFails(getDocs(collection(db(ALEX), "dailyJobDigest")));
});
