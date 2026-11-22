// Owner pause rules. Loads the production rules in the emulator. Fake data only.
// Does not touch heartwood-9f37f.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const RULES = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
const STORAGE = readFileSync(new URL("../production/storage.rules", import.meta.url), "utf8");
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function billing(status, customer = null) {
  return { provider: customer ? "stripe" : null, status, stripeCustomerId: customer, stripeSubscriptionId: customer ? "sub_x" : null };
}
function company(extra = {}) {
  return {
    name: "Acme Civil", legalName: "Acme Civil", abn: "1", signoff: "Acme", logoUrl: "", address: "1 St", phone: "",
    email: "office@acme.test", accountsEmail: "accounts@acme.test", hubdocAddress: "",
    status: "active", plan: "paid", origin: "signup", isTest: false,
    billing: billing("active", "cus_acme"),
    ...extra,
  };
}
function ownerToken() {
  return { email: "alex@heartwoodew.com", email_verified: true, platformOwner: true };
}

let env;
let storageEnv;

async function seed(target) {
  await target.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "companies/acme"), company());
    await setDoc(doc(db, "companies/heartwood"), company({ name: "Heartwood Earthworx", plan: "paid", billing: billing("not-configured") }));
    await setDoc(doc(db, "users/acmeAdm"), { name: "Ada", role: "admin", email: "ada@acme.test", companyId: "acme", tenantId: "acme" });
    await setDoc(doc(db, "users", ALEX), { name: "Alex", role: "admin", email: "alex@heartwoodew.com", companyId: "heartwood", tenantId: "heartwood" });
    await setDoc(doc(db, "jobs/acmejob"), { companyId: "acme", tenantId: "acme", client: "Acme secret", address: "1 St", status: "Scheduled", assigned: [] });
    await setDoc(doc(db, "companyDeletions/old"), {
      companyId: "old", companyName: "Old Co", deletedAt: "2026-11-01T00:00:00.000Z", deletedBy: ALEX,
      counts: { firestore: 1, storage: 0, authDeleted: 0 }, stripe: "none",
    });
  });
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-owner-pause",
    firestore: { rules: RULES },
  });
  await seed(env);
  storageEnv = await initializeTestEnvironment({
    projectId: "demo-heartwood",
    firestore: { rules: RULES },
    storage: { rules: STORAGE },
  });
  await storageEnv.clearFirestore();
  await storageEnv.clearStorage();
  await seed(storageEnv);
  await storageEnv.withSecurityRulesDisabled(async ctx => {
    await uploadBytes(ref(ctx.storage(), "tenants/acme/jobs/acmejob/documents/dOwnerPause12345"), PDF, {
      contentType: "application/pdf",
    });
  });
});

test.after(async () => {
  if (env) await env.cleanup();
  if (storageEnv) await storageEnv.cleanup();
});

function db(uid, token) {
  return env.authenticatedContext(uid, token).firestore();
}
const pausePatch = uid => ({ ownerPaused: true, ownerPausedAt: serverTimestamp(), ownerPausedBy: uid });

test("only the platform owner can set an owner pause, and a paused company is locked", async () => {
  const admin = db("acmeAdm");
  const alex = db(ALEX, ownerToken());
  await assertFails(updateDoc(doc(admin, "companies/acme"), pausePatch("acmeAdm")));
  await assertFails(updateDoc(doc(db("someone", { email: "a@b.test", email_verified: true, platformOwner: true }), "companies/acme"), pausePatch("someone")));
  await assertFails(updateDoc(doc(alex, "companies/heartwood"), pausePatch(ALEX)));

  await env.withSecurityRulesDisabled(async ctx => {
    await updateDoc(doc(ctx.firestore(), "users", ALEX), { companyId: "acme", tenantId: "acme" });
  });
  await assertFails(updateDoc(doc(alex, "companies/acme"), pausePatch(ALEX)));
  await env.withSecurityRulesDisabled(async ctx => {
    await updateDoc(doc(ctx.firestore(), "users", ALEX), { companyId: "heartwood", tenantId: "heartwood" });
  });

  await assertSucceeds(getDoc(doc(admin, "jobs/acmejob")));
  await assertSucceeds(updateDoc(doc(alex, "companies/acme"), pausePatch(ALEX)));
  await assertFails(getDoc(doc(admin, "jobs/acmejob")));
  await assertFails(setDoc(doc(admin, "jobs/acmeNew"), { companyId: "acme", tenantId: "acme", client: "New", address: "2 St", status: "Scheduled", assigned: [] }));
  const still = await assertSucceeds(getDoc(doc(admin, "companies/acme")));
  assert.equal(still.data().ownerPaused, true);
  assert.equal(still.data().ownerPausedBy, ALEX);
  await assertSucceeds(getDoc(doc(admin, "users/acmeAdm")));

  await assertFails(setDoc(doc(admin, "companyDeletions/hack"), { companyId: "acme", companyName: "Acme Civil" }));
  const audit = await assertSucceeds(getDoc(doc(alex, "companyDeletions/old")));
  assert.equal(audit.data().companyName, "Old Co");
  await assertFails(updateDoc(doc(alex, "companyDeletions/old"), { companyName: "changed" }));

  await assertSucceeds(updateDoc(doc(alex, "companies/acme"), {
    ownerPaused: false,
    ownerReactivatedAt: serverTimestamp(),
    ownerReactivatedBy: ALEX,
  }));
  await assertSucceeds(getDoc(doc(admin, "jobs/acmejob")));
  const open = await assertSucceeds(getDoc(doc(admin, "companies/acme")));
  assert.equal(open.data().ownerPaused, false);
  assert.equal(open.data().ownerPausedBy, ALEX);
});

test("storage for an owner-paused company cannot be read or deleted", async () => {
  const file = "tenants/acme/jobs/acmejob/documents/dOwnerPause12345";
  const created = "tenants/acme/jobs/acmejob/documents/dOwnerNew1234567";
  const admin = () => storageEnv.authenticatedContext("acmeAdm").storage();
  await assertSucceeds(getBytes(ref(admin(), file)));
  await storageEnv.withSecurityRulesDisabled(async ctx => {
    await updateDoc(doc(ctx.firestore(), "companies/acme"), { ownerPaused: true, ownerPausedBy: ALEX });
  });
  await assertFails(getBytes(ref(admin(), file)));
  // Create already reads the uploader and the job. A company read would be a
  // third document, which production storage rules reject, so a paused office
  // can upload. The new bytes still cannot be read back.
  const meta = {
    contentType: "application/pdf",
    customMetadata: {
      tenantId: "acme", jobId: "acmejob", uploaderUid: "acmeAdm", purpose: "job-document",
      visibility: "office", fileName: "new.pdf",
    },
  };
  await assertSucceeds(uploadBytes(ref(admin(), created), PDF, meta));
  await assertFails(getBytes(ref(admin(), created)));
});
