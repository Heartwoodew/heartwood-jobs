// Quote create/update must stay under Firestore's 1000-expression limit.
// A verified email used to make the platform-owner check blow that limit.
// Fake data only. Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
let env;

const draft = (companyId, extra = {}) => ({
  companyId, client: "Orbit", address: "1 Creek Rd", quoteStatus: "Draft",
  totalEx: 200, lines: [], extraItems: [], priceOverrides: {}, ...extra,
});

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-quote-writes",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, "users/hwMgr"), { role: "manager", name: "Pat", companyId: "heartwood" });
    await setDoc(doc(d, "users/hwSup"), { role: "supervisor", name: "Sue", companyId: "heartwood" });
    await setDoc(doc(d, "users/hwOp"), { role: "operator", name: "Sam", companyId: "heartwood" });
    await setDoc(doc(d, "users/bMgr"), { role: "manager", name: "Mia", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bSup"), { role: "supervisor", name: "Bo", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bAdm"), { role: "admin", name: "Bea", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "users/bOp"), { role: "operator", name: "Ben", companyId: "bravo", tenantId: "bravo" });
    await setDoc(doc(d, "quotes/hwDraft"), draft("heartwood"));
    await setDoc(doc(d, "quotes/bDraft"), draft("bravo", { tenantId: "bravo", priceOverrides: { travel: 90 } }));
  });
});
test.after(async () => { if (env) await env.cleanup(); });

function db(uid, token) {
  return env.authenticatedContext(uid, token).firestore();
}

test("manager, supervisor and admin can create, update, accept and override without crossing companies", async () => {
  const verified = { email: "alex@heartwoodew.com", email_verified: true };
  const unverified = { email: "alex@heartwoodew.com", email_verified: false };
  for (const [label, token] of [["v", verified], ["u", unverified]]) {
    const admin = db(ALEX, token);
    const id = "hwNew" + label;
    await assertSucceeds(updateDoc(doc(admin, "quotes/hwDraft"), { client: "Orbit Homes", priceOverrides: { travel: 40 } }));
    await assertSucceeds(setDoc(doc(admin, "quotes/" + id), draft("heartwood", { priceOverrides: { travel: 10 } })));
    await assertSucceeds(updateDoc(doc(admin, "quotes/" + id), { quoteStatus: "Accepted", priceOverrides: { travel: 10 } }));
    await assertFails(updateDoc(doc(admin, "quotes/" + id), { client: "Too late" }));
  }

  const verifiedOffice = { email: "office@heartwoodew.com", email_verified: true };
  const unverifiedOffice = { email: "office@heartwoodew.com", email_verified: false };
  await assertSucceeds(setDoc(doc(db("hwMgr", unverifiedOffice), "quotes/hwMgrU"), draft("heartwood", { priceOverrides: { travel: 12 } })));
  await assertSucceeds(setDoc(doc(db("hwMgr", verifiedOffice), "quotes/hwMgrV"), draft("heartwood", { priceOverrides: { travel: 12 } })));
  await assertSucceeds(updateDoc(doc(db("hwSup", verifiedOffice), "quotes/hwMgrV"), { client: "Verified supervisor", priceOverrides: { travel: 12 } }));
  await assertFails(updateDoc(doc(db("hwSup", verifiedOffice), "quotes/hwMgrV"), { priceOverrides: { travel: 1 } }));
  await assertSucceeds(setDoc(doc(db("bMgr", verifiedOffice), "quotes/bMgrV"), draft("bravo", { tenantId: "bravo", priceOverrides: { travel: 4 } })));
  await assertSucceeds(updateDoc(doc(db("bAdm", verifiedOffice), "quotes/bMgrV"), { quoteStatus: "Accepted", priceOverrides: { travel: 4 } }));
  await assertFails(updateDoc(doc(db("bAdm", verifiedOffice), "quotes/bMgrV"), { client: "After accept" }));
  await assertSucceeds(setDoc(doc(db("hwMgr"), "quotes/hwMgr"), draft("heartwood", { priceOverrides: { travel: 12 } })));
  await assertSucceeds(updateDoc(doc(db("hwMgr"), "quotes/hwDraft"), { client: "Manager edit", priceOverrides: { travel: 15 } }));
  await assertSucceeds(updateDoc(doc(db("bMgr"), "quotes/bDraft"), { client: "Acme", priceOverrides: { travel: 20 } }));
  await assertSucceeds(setDoc(doc(db("bMgr"), "quotes/bNew"), draft("bravo", { tenantId: "bravo", priceOverrides: { travel: 8 } })));
  await assertSucceeds(updateDoc(doc(db("bMgr"), "quotes/bNew"), { quoteStatus: "Accepted", priceOverrides: { travel: 8 } }));

  await assertSucceeds(updateDoc(doc(db("hwSup"), "quotes/hwDraft"), { client: "Supervisor edit", priceOverrides: { travel: 15 } }));
  await assertFails(updateDoc(doc(db("hwSup"), "quotes/hwDraft"), { priceOverrides: { travel: 1 } }));
  await assertSucceeds(updateDoc(doc(db("bSup"), "quotes/bDraft"), { client: "Acme Homes", priceOverrides: { travel: 20 } }));
  await assertFails(setDoc(doc(db("bSup"), "quotes/bSupPrice"), draft("bravo", { tenantId: "bravo", priceOverrides: { travel: 1 } })));
  await assertSucceeds(setDoc(doc(db("bSup"), "quotes/bSupOk"), draft("bravo", { tenantId: "bravo" })));
  await assertSucceeds(updateDoc(doc(db("bAdm"), "quotes/bDraft"), { priceOverrides: { travel: 30 } }));

  await assertFails(updateDoc(doc(db("hwOp"), "quotes/hwDraft"), { client: "Crew" }));
  await assertFails(setDoc(doc(db("bOp"), "quotes/bCrew"), draft("bravo", { tenantId: "bravo" })));
  await assertFails(updateDoc(doc(db("bMgr"), "quotes/hwDraft"), { client: "Wrong company" }));
});
