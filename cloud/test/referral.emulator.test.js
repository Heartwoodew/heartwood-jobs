// Referral fields stay server-side. Loads the production rules in the emulator. Fake data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { buildCompanyCreate, ownerProfile, validateCompanyInput, trialEnd } from "../../app/features/company.js";

const CODE = "abcdefghjkmnpqrstu23";
let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-referral-rules",
    firestore: { rules: readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8") },
  });
});

test.after(async () => { if (env) await env.cleanup(); });

function db(uid) { return env.authenticatedContext(uid).firestore(); }

test("clients cannot write referredBy, a referral code, or a reward", async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    const root = ctx.firestore();
    await setDoc(doc(root, "companies/acme"), {
      name: "Acme Civil", legalName: "Acme Civil Pty Ltd", abn: "11 111 111 111", signoff: "Acme",
      logoUrl: "", address: "1 Yard St", phone: "", email: "office@acme.test",
      accountsEmail: "accounts@acme.test", hubdocAddress: "", ownerUid: "coA", createdBy: "coA",
      status: "active", plan: "trial", origin: "signup", isTest: false, staffCount: 1, jobCount: 0,
      billing: { provider: null, status: "not-configured", stripeCustomerId: null, stripeSubscriptionId: null },
    });
    await setDoc(doc(root, "users/coA"), { role: "admin", name: "Ari", email: "ari@acme.test", companyId: "acme", tenantId: "acme" });
    await setDoc(doc(root, "users/crew"), { role: "operator", name: "Ollie", companyId: "acme", tenantId: "acme" });
  });
  const admin = db("coA");
  const crew = db("crew");
  await assertSucceeds(updateDoc(doc(admin, "companies/acme"), { phone: "0400000001" }));
  await assertFails(updateDoc(doc(admin, "companies/acme"), { referredBy: { companyId: "bravo", code: CODE } }));
  await assertFails(updateDoc(doc(admin, "companies/acme"), { referralCode: CODE }));
  await assertFails(updateDoc(doc(admin, "companies/acme"), { referralReward: { status: "applied", months: 2 } }));
  await assertFails(setDoc(doc(admin, "referralCodes", CODE), { companyId: "acme" }));
  await assertFails(setDoc(doc(admin, "referrals/bravo"), { status: "earned", referrerCompanyId: "acme", referredCompanyId: "bravo" }));
  await assertFails(setDoc(doc(admin, "referralAudits/one"), { action: "applied", referredCompanyId: "bravo" }));
  await assertFails(getDoc(doc(admin, "referrals/bravo")));
  await assertFails(getDoc(doc(crew, "referralCodes", CODE)));
  await assertFails(updateDoc(doc(crew, "companies/acme"), { referredBy: { companyId: "self", code: CODE } }));
  const kept = await assertSucceeds(getDoc(doc(admin, "companies/acme")));
  assert.equal(kept.data().referredBy, undefined);
  assert.equal(kept.data().referralCode, undefined);
  assert.equal(kept.data().phone, "0400000001");
});

test("a new company cannot include referredBy, and a normal signup still can", async () => {
  const input = validateCompanyInput({
    name: "Delta Diggers", legalName: "Delta Diggers Pty Ltd", abn: "51 824 753 556",
    address: "1 Test St", phone: "", email: "office@delta.test", accountsEmail: "accounts@delta.test", hubdocAddress: "", logoUrl: "",
  }).value;
  const owner = db("referral-owner");
  const created = buildCompanyCreate(input, {
    companyId: "delta-ref-zz01", ownerUid: "referral-owner", signedUpAt: serverTimestamp(),
    trialEndsAt: Timestamp.fromDate(trialEnd(new Date())), lastActivityAt: serverTimestamp(),
  });
  await assertFails(setDoc(doc(owner, "companies/delta-ref-zz01"), { ...created, referredBy: { companyId: "acme", code: CODE } }));
  await assertSucceeds(setDoc(doc(owner, "companies/delta-ref-zz01"), created));
  await assertSucceeds(setDoc(doc(owner, "users/referral-owner"), { ...ownerProfile(input, "delta-ref-zz01", "Dee Owner"), email: "owner@delta.test", jobTitle: "Admin", jobTitleId: "earthworks:admin" }));
  const saved = await assertSucceeds(getDoc(doc(owner, "companies/delta-ref-zz01")));
  assert.equal(saved.data().referredBy, undefined);
  assert.equal(saved.data().plan, "trial");
});
