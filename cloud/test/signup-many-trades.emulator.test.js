import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { buildCompanyCreate, ownerProfile, validateCompanyInput, trialEnd, companyIdFromName } from "../../app/features/company.js";
import { companyTradesDoc } from "../../app/features/trades.js";
let env;
test.before(async () => { env = await initializeTestEnvironment({ projectId: "demo-signup-many-trades",
  firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") } }); });
test.after(async () => env && env.cleanup());
const v = validateCompanyInput({ name: "Pat Test Earthworks", legalName: "Pat Test", abn: "12 345 678 901", address: "1 Test St, Ipswich QLD",
  phone: "0400 000 000", email: "pat@example.test", accountsEmail: "pat@example.test", hubdocAddress: "", logoUrl: "", signoff: "Pat Test Earthworks" }).value;
const r = p => p.then(() => "ok", e => e.code + " " + String(e.message).slice(0, 200));
async function signup(uid, trades, token) {
  const db = env.authenticatedContext(uid, token).firestore();
  const companyId = companyIdFromName(v.name);
  const out = { companyId };
  out.company = await r(setDoc(doc(db, "companies", companyId), { ...buildCompanyCreate(v, { companyId, ownerUid: uid, signedUpAt: serverTimestamp(),
    trialEndsAt: Timestamp.fromDate(trialEnd(new Date())), lastActivityAt: serverTimestamp() }), trades, trade: trades[0] }));
  out.profile = await r(setDoc(doc(db, "users", uid), { ...ownerProfile(v, companyId, "Pat"), email: token.email, jobTitle: "Admin", jobTitleId: trades[0] + ":admin" }));
  out.trades = await r(setDoc(doc(db, "companyTrades", companyId), { ...companyTradesDoc(companyId, trades, uid), updatedAt: serverTimestamp() }));
  return out;
}
for (const trades of [["earthworks"], ["earthworks", "landscaping"], ["earthworks", "landscaping", "fencing", "plumbing"], ["landscaping", "fencing"], ["concrete-cutting", "plumbing"], ["earthworks","landscaping","concreting","fencing","carpentry","tiling","plumbing","electrical"], ["concrete-cutting","earthworks","landscaping","concreting","fencing","carpentry","tiling","plumbing","electrical"]]) {
  test("fresh signup " + trades.join("+"), async () => {
    await env.clearFirestore();
    const out = await signup("fresh" + trades.length, trades, { email: "p@example.test", email_verified: false });
    console.log(JSON.stringify({ trades, ...out }));
    assert.equal(out.company, "ok"); assert.equal(out.profile, "ok");
    assert.equal(out.trades, "ok", "companyTrades write must succeed");
  });
}
test("existing Heartwood member creates company B", async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => setDoc(doc(c.firestore(), "users", "member1"), { name: "Member", companyId: "heartwood", role: "operator" }));
  const out = await signup("member1", ["earthworks"], { email: "member@example.test", email_verified: false });
  console.log(JSON.stringify({ existing: true, ...out }));
  // By design an existing member can't open a second company with the same login; the app's sign-up always makes a new login.
  assert.notEqual(out.company, "ok"); assert.notEqual(out.profile, "ok");
});
test("concrete-cutting plus every other trade is accepted", async () => {
  const trades = ["concrete-cutting", "earthworks", "landscaping", "concreting", "fencing", "carpentry", "tiling", "plumbing", "electrical"];
  assert.equal(trades.length, 9);
  const catalog = companyTradesDoc("ignored", trades, "cutter9");
  assert.deepEqual(catalog.trades, trades);
  assert.equal(catalog.extraTrades.length, 8);
  assert.equal(catalog.titles.some(row => row.id === "concrete-cutting:admin" && row.level === "admin"), true);
  await env.clearFirestore();
  const out = await signup("cutter9", trades, { email: "cut@example.test", email_verified: false });
  assert.equal(out.company, "ok", out.company);
  assert.equal(out.profile, "ok", out.profile);
  assert.equal(out.trades, "ok", out.trades);
});
test("unknown trade still rejected on companyTrades", async () => {
  await env.clearFirestore();
  const out = await signup("bad1", ["earthworks"], { email: "b@example.test", email_verified: false });
  assert.equal(out.trades, "ok");
  const db = env.authenticatedContext("bad1", { email: "b@example.test" }).firestore();
  const bad = { ...companyTradesDoc(out.companyId, ["earthworks", "landscaping"], "bad1"), updatedAt: serverTimestamp() };
  bad.extraTrades = ["roofing"];
  assert.notEqual(await r(setDoc(doc(db, "companyTrades", out.companyId), bad)), "ok");
  bad.extraTrades = ["landscaping"]; bad.trades = ["earthworks", "roofing"];
  assert.notEqual(await r(setDoc(doc(db, "companyTrades", out.companyId), bad)), "ok");
});
