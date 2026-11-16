// Platform-owner company deletion. No emulator and no Stripe network call.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cancelSubscriptionOnCompanyDeletion } from "../functions/billing/stripe-billing.js";
import {
  AUDIT_COLLECTION, authActionForProfile, callerIsPlatformOwner, companyStoragePrefixes,
  deletionErrorMessage, docInCompanyScope, runOwnerCompanyDeletion,
} from "../functions/billing/owner-company.js";

const ALEX = "1JKLsoxkQNfkphBBO0vDz2ziEyj2";
const STAFF = "a".repeat(28);
const SHARED = "b".repeat(28);
const NOW = Date.parse("2026-11-16T00:00:00Z");

function owner(extra = {}) {
  return { uid: ALEX, token: { email: "alex@heartwoodew.com", email_verified: true, platformOwner: true, ...extra } };
}

function company(extra = {}) {
  return {
    name: "Acme Civil",
    plan: "paid",
    status: "active",
    billing: { provider: "stripe", status: "active", stripeCustomerId: "cus_acme", stripeSubscriptionId: "sub_acme" },
    ...extra,
  };
}

function world() {
  return [
    { path: "jobs/acme1", id: "acme1", collection: "jobs", data: { companyId: "acme", tenantId: "acme", client: "Acme yard" } },
    { path: "jobs/notenant", id: "notenant", collection: "jobs", data: { companyId: "acme", client: "Missing tenant is Heartwood" } },
    { path: "jobs/hw", id: "hw", collection: "jobs", data: { client: "No ids" } },
    { path: "jobs/hw2", id: "hw2", collection: "jobs", data: { companyId: "heartwood", client: "Heartwood" } },
    { path: "jobs/beta1", id: "beta1", collection: "jobs", data: { companyId: "beta", tenantId: "beta", client: "Beta" } },
    { path: "quotes/acmeq", id: "acmeq", collection: "quotes", data: { companyId: "acme", tenantId: "acme" } },
    { path: "quotes/betaq", id: "betaq", collection: "quotes", data: { companyId: "beta", tenantId: "beta" } },
    { path: "receipts/ar", id: "ar", collection: "receipts", data: { companyId: "acme", tenantId: "acme" } },
    { path: "receipts/br", id: "br", collection: "receipts", data: { companyId: "beta", tenantId: "beta" } },
    { path: "users/" + STAFF, id: STAFF, collection: "users", data: { companyId: "acme", tenantId: "acme", role: "operator" } },
    { path: "users/" + SHARED, id: SHARED, collection: "users", data: { companyId: "acme", tenantId: "beta", role: "operator" } },
    { path: "users/" + ALEX, id: ALEX, collection: "users", data: { companyId: "acme", tenantId: "acme", role: "admin" } },
    { path: "companies/acme", id: "acme", collection: "companies", data: company() },
    { path: "companies/beta", id: "beta", collection: "companies", data: { name: "Beta Co", companyId: "beta" } },
    { path: "companies/heartwood", id: "heartwood", collection: "companies", data: { name: "Heartwood Earthworx" } },
    { path: "hoursExports/hx1", id: "hx1", collection: "hoursExports", data: { companyId: "acme", tenantId: "acme", storagePath: "hoursExports/hx1/week.xlsx" } },
  ];
}

function harness(overrides = {}) {
  const deleted = [];
  const trees = [];
  const auth = [];
  const storage = [];
  const audits = [];
  const calls = [];
  let listed = 0;
  const stripe = {
    subscriptions: {
      cancel: async (id, params) => {
        calls.push({ method: "subscriptions.cancel", id, params });
        return { id, status: "canceled" };
      },
    },
    charges: { create: async () => { calls.push({ method: "charges.create" }); throw new Error("charge"); } },
    invoices: { create: async () => { calls.push({ method: "invoices.create" }); throw new Error("invoice"); } },
    paymentIntents: { create: async () => { calls.push({ method: "paymentIntents.create" }); throw new Error("pi"); } },
    checkout: { sessions: { create: async () => { calls.push({ method: "checkout" }); throw new Error("checkout"); } } },
  };
  const deps = {
    auth: owner(),
    companyId: "acme",
    confirmName: "Acme Civil",
    now: NOW,
    loadCompany: async id => ({ id, data: id === "acme" ? company() : null }),
    loadCallerProfile: async () => ({ companyId: "heartwood", tenantId: "heartwood", role: "admin" }),
    listCandidateDocs: async () => { listed += 1; return world(); },
    deleteDoc: async path => { deleted.push(path); },
    deleteTree: async id => { trees.push(id); return 3; },
    deleteStorage: async spec => { storage.push(spec); return { deleted: (spec.prefixes || []).length, failed: 0 }; },
    deleteAuthUser: async uid => { auth.push(uid); return "deleted"; },
    writeAudit: async audit => { audits.push(audit); },
    cancelSubscription: id => cancelSubscriptionOnCompanyDeletion({ stripe, subscriptionId: id }),
    ...overrides,
  };
  return { deps, deleted, trees, auth, storage, audits, calls, stripe, listed: () => listed };
}

test("only a verified platform owner can delete, and Heartwood and the caller's company are refused", async () => {
  assert.equal(callerIsPlatformOwner(owner()), true);
  assert.equal(callerIsPlatformOwner({ uid: ALEX, token: { email: "alex@heartwoodew.com", email_verified: true } }), true);
  assert.equal(callerIsPlatformOwner({ uid: "someone", token: { email: "a@b.test", email_verified: true, platformOwner: true } }), false);
  assert.equal(callerIsPlatformOwner({ uid: ALEX, token: { email: "alex@heartwoodew.com", email_verified: false, platformOwner: true } }), false);
  assert.equal(callerIsPlatformOwner(null), false);

  const stranger = harness({ auth: { uid: "someone", token: { email: "a@b.test", email_verified: true, platformOwner: true } } });
  const denied = await runOwnerCompanyDeletion(stranger.deps);
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "platform-owner");
  assert.equal(denied.code, "permission-denied");
  assert.equal(stranger.deleted.length, 0);
  assert.equal(stranger.listed(), 0);
  assert.match(deletionErrorMessage(denied), /platform owner/);

  const heartwood = harness({
    companyId: "heartwood",
    confirmName: "Heartwood Earthworx",
    loadCompany: async () => ({ id: "heartwood", data: { name: "Heartwood Earthworx" } }),
  });
  const refused = await runOwnerCompanyDeletion(heartwood.deps);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "heartwood");
  assert.equal(heartwood.deleted.length, 0);
  assert.equal(heartwood.trees.length, 0);
  assert.equal(heartwood.listed(), 0);
  assert.match(deletionErrorMessage(refused), /Heartwood cannot be deleted/);

  const blank = harness({ companyId: "" });
  const blanked = await runOwnerCompanyDeletion(blank.deps);
  assert.equal(blanked.reason, "heartwood");
  assert.equal(blank.deleted.length, 0);

  const own = harness({ loadCallerProfile: async () => ({ companyId: "acme", role: "admin" }) });
  const owned = await runOwnerCompanyDeletion(own.deps);
  assert.equal(owned.ok, false);
  assert.equal(owned.reason, "own-company");
  assert.equal(own.deleted.length, 0);
  assert.equal(own.listed(), 0);
});

test("the company name must match exactly, and a wrong name deletes nothing", async () => {
  const wrong = harness({ confirmName: "acme civil" });
  const result = await runOwnerCompanyDeletion(wrong.deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "name-mismatch");
  assert.equal(wrong.deleted.length, 0);
  assert.equal(wrong.calls.length, 0);
  assert.equal(wrong.listed(), 0);
  assert.match(deletionErrorMessage(result), /exactly/);

  const spaced = harness({ confirmName: "Acme Civil " });
  assert.equal((await runOwnerCompanyDeletion(spaced.deps)).reason, "name-mismatch");
  assert.equal(spaced.deleted.length, 0);

  const missing = harness({
    companyId: "gone",
    loadCompany: async () => ({ id: "gone", data: null }),
  });
  assert.equal((await runOwnerCompanyDeletion(missing.deps)).reason, "missing-company");
  assert.equal(missing.deleted.length, 0);
});

test("deletion stays inside the company, keeps Heartwood jobs, and cancels Stripe without a charge", async () => {
  const run = harness();
  const result = await runOwnerCompanyDeletion(run.deps);
  assert.equal(result.ok, true);
  assert.equal(result.companyName, "Acme Civil");
  assert.deepEqual(run.deleted.sort(), [
    "hoursExports/hx1",
    "jobs/acme1",
    "quotes/acmeq",
    "receipts/ar",
    "users/" + STAFF,
  ].sort());
  assert.deepEqual(run.trees, ["acme"]);
  assert.equal(run.deleted.includes("jobs/notenant"), false);
  assert.equal(run.deleted.includes("jobs/hw"), false);
  assert.equal(run.deleted.includes("jobs/hw2"), false);
  assert.equal(run.deleted.includes("jobs/beta1"), false);
  assert.equal(run.deleted.includes("companies/beta"), false);
  assert.equal(run.deleted.includes("companies/heartwood"), false);
  assert.equal(run.deleted.includes("users/" + SHARED), false);
  assert.equal(run.deleted.includes("users/" + ALEX), false);
  assert.deepEqual(run.auth, [STAFF]);
  assert.equal(authActionForProfile(SHARED, { companyId: "acme", tenantId: "beta" }, "acme"), "keep");
  assert.equal(authActionForProfile(ALEX, { companyId: "acme", tenantId: "acme" }, "acme"), "keep");
  assert.equal(authActionForProfile(STAFF, { companyId: "acme", tenantId: "acme" }, "acme"), "delete");
  assert.equal(docInCompanyScope({ path: "jobs/notenant", collection: "jobs", data: { companyId: "acme" } }, "acme"), false);
  assert.equal(docInCompanyScope({ path: "jobs/hw", collection: "jobs", data: {} }, "acme"), false);

  const spec = run.storage[0];
  assert.ok(spec.prefixes.includes("companies/acme/"));
  assert.ok(spec.prefixes.includes("tenants/acme/"));
  assert.ok(spec.prefixes.includes("take5Photos/acme/"));
  assert.ok(spec.prefixes.includes(`leaveCertificates/${STAFF}/`));
  assert.ok(spec.prefixes.includes(`reimbursements/${STAFF}/`));
  assert.equal(spec.prefixes.some(prefix => prefix.includes("beta") || prefix.includes("heartwood")), false);
  assert.equal(spec.prefixes.some(prefix => prefix.includes(SHARED) || prefix.includes(ALEX)), false);
  assert.deepEqual(spec.paths, ["hoursExports/hx1/week.xlsx"]);
  assert.deepEqual(companyStoragePrefixes("heartwood"), []);
  assert.deepEqual(companyStoragePrefixes(""), []);

  assert.equal(run.calls.length, 1);
  assert.equal(run.calls[0].method, "subscriptions.cancel");
  assert.equal(run.calls[0].id, "sub_acme");
  assert.deepEqual(run.calls[0].params, { invoice_now: false, prorate: false });
  assert.equal(result.stripe, "cancelled");

  assert.equal(run.audits.length, 1);
  const audit = run.audits[0];
  assert.equal(audit.collection, AUDIT_COLLECTION);
  assert.equal(audit.id, "acme");
  assert.equal(audit.data.companyName, "Acme Civil");
  assert.equal(audit.data.companyId, "acme");
  assert.equal(audit.data.deletedAt, "2026-11-16T00:00:00.000Z");
  assert.equal(audit.data.deletedBy, ALEX);
  assert.equal(audit.data.counts.firestore, 8);
  assert.equal(audit.data.counts.authDeleted, 1);
  assert.equal(audit.data.counts.authKept, 0);
  assert.equal(audit.data.stripe, "cancelled");
  assert.equal(run.deleted.includes("companyDeletions/acme"), false);

  const rules = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const storage = readFileSync(new URL("../production/storage.rules", import.meta.url), "utf8");
  const storageEmu = readFileSync(new URL("../emulator/storage.rules", import.meta.url), "utf8");
  for (const text of [rules, emu]) {
    assert.match(text, /function ownerPauseEdit\(companyId\)/);
    assert.match(text, /data\.get\("ownerPaused", false\) != true/);
    assert.match(text, /match \/companyDeletions\/\{companyId\}/);
  }
  assert.match(storage, /data\.get\("ownerPaused", false\) != true/);
  assert.match(storageEmu, /data\.get\("ownerPaused", false\) != true/);
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.match(index, /export const deleteCompanyAccount = onCall/);
  assert.match(index, /cancelSubscriptionOnCompanyDeletion/);
  assert.match(index, /invoice_now false, prorate false/);
});

test("a company with no subscription is deleted without calling Stripe, and a missing client deletes nothing", async () => {
  const plain = company({ billing: { provider: null, status: "not-configured", stripeCustomerId: null, stripeSubscriptionId: null } });
  const run = harness({ loadCompany: async () => ({ id: "acme", data: plain }) });
  delete run.deps.cancelSubscription;
  const result = await runOwnerCompanyDeletion(run.deps);
  assert.equal(result.ok, true);
  assert.equal(result.stripe, "none");
  assert.equal(run.calls.length, 0);
  assert.equal(run.deleted.includes("jobs/acme1"), true);
  assert.equal(run.deleted.includes("jobs/beta1"), false);

  const blocked = harness({
    cancelSubscription: async () => cancelSubscriptionOnCompanyDeletion({ stripe: null, subscriptionId: "sub_acme" }),
  });
  const stopped = await runOwnerCompanyDeletion(blocked.deps);
  assert.equal(stopped.ok, false);
  assert.equal(stopped.reason, "stripe-not-configured");
  assert.equal(blocked.deleted.length, 0);
  assert.equal(blocked.audits.length, 0);
  assert.match(deletionErrorMessage(stopped), /not cancelled and the company was not deleted/);
});
