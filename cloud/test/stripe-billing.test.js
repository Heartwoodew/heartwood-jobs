import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  BASE_PRICE_ID, EXTRA_PRICE_ID, WEBHOOK_URL, applyStripeEvent, assertTestKey, authorizeCompanyAdmin,
  checkoutParams, companiesTouchedByUser, constructStripeEvent, extraStaffQuantity, handleCheckoutCall,
  handlePortalCall, handleStripeWebhook, portalParams, staffItemChange, syncStaffQuantity,
} from "../functions/billing/stripe-billing.js";

const company = {
  name: "Acme Civil", email: "office@acme.test", plan: "trial", status: "active", isTest: false,
  billing: { provider: null, status: "not-configured", stripeCustomerId: null, stripeSubscriptionId: null },
};
const admin = { role: "admin", companyId: "acme" };

function signed(secret, body, seconds = Math.floor(Date.now() / 1000)) {
  const text = JSON.stringify(body);
  const v1 = createHmac("sha256", secret).update(`${seconds}.${text}`).digest("hex");
  return { text, header: `t=${seconds},v1=${v1}`, now: seconds * 1000 };
}

test("checkout uses the sandbox prices and skips test, friend and Heartwood companies", () => {
  assert.equal(extraStaffQuantity(1), 0);
  assert.equal(extraStaffQuantity(4), 3);
  const one = checkoutParams({ companyId: "acme", company, staffCount: 1, successUrl: "https://jobs.heartwoodew.com/?billing=success", cancelUrl: "https://jobs.heartwoodew.com/?billing=cancel" });
  assert.equal(one.ok, true);
  assert.equal(one.params.mode, "subscription");
  assert.equal(one.params.client_reference_id, "acme");
  assert.equal(one.params.automatic_tax.enabled, true);
  assert.equal(one.params.tax_id_collection.enabled, true);
  assert.equal(one.params.billing_address_collection, "required");
  assert.deepEqual(one.params.line_items, [{ price: BASE_PRICE_ID, quantity: 1 }]);
  const four = checkoutParams({ companyId: "acme", company, staffCount: 4, successUrl: "x", cancelUrl: "y" });
  assert.deepEqual(four.params.line_items, [
    { price: BASE_PRICE_ID, quantity: 1 },
    { price: EXTRA_PRICE_ID, quantity: 3 },
  ]);
  assert.equal(checkoutParams({ companyId: "yard", company: { ...company, isTest: true }, staffCount: 2, successUrl: "x", cancelUrl: "y" }).reason, "test-company");
  assert.equal(checkoutParams({ companyId: "mate", company: { ...company, plan: "friend" }, staffCount: 2, successUrl: "x", cancelUrl: "y" }).reason, "friend-trial");
  assert.equal(checkoutParams({ companyId: "heartwood", company, staffCount: 8, successUrl: "x", cancelUrl: "y" }).reason, "heartwood");
  assert.throws(() => assertTestKey("sk_live_secret"), /stripe-test-key-required/);
  assert.doesNotThrow(() => assertTestKey("sk_test_example"));
  assert.equal(authorizeCompanyAdmin({ uid: "adm", profile: { role: "operator", companyId: "acme" }, company, companyId: "acme" }).reason, "company-admin");
  assert.equal(authorizeCompanyAdmin({ uid: "adm", profile: admin, company, companyId: "acme" }).ok, true);
});

test("webhook signature, plan and billing status, and staff prorations", async () => {
  const secret = "whsec_test_example";
  const completed = {
    id: "evt_1", type: "checkout.session.completed", livemode: false,
    data: { object: { mode: "subscription", client_reference_id: "acme", customer: "cus_test", subscription: "sub_test", metadata: { companyId: "acme" } } },
  };
  const good = signed(secret, completed);
  const event = constructStripeEvent(good.text, good.header, secret, good.now);
  assert.equal(event.type, "checkout.session.completed");
  assert.throws(() => constructStripeEvent(good.text, "t=1,v1=dead", secret, good.now), /invalid-signature/);
  const applied = applyStripeEvent(event);
  assert.equal(applied.patch.plan, "paid");
  assert.equal(applied.patch.billing.status, "active");
  assert.equal(applied.patch.billing.stripeCustomerId, "cus_test");
  assert.equal(applied.patch.billing.provider, "stripe");
  assert.equal(applyStripeEvent({ ...completed, livemode: true }).reason, "live-mode");
  const failed = applyStripeEvent({ type: "invoice.payment_failed", livemode: false, data: { object: { customer: "cus_test", subscription: "sub_test", metadata: { companyId: "acme" } } } });
  assert.equal(failed.patch.billing.status, "past_due");
  assert.equal(failed.patch.plan, "paid");
  const removed = applyStripeEvent({ type: "customer.subscription.deleted", livemode: false, data: { object: { id: "sub_test", customer: "cus_test", metadata: { companyId: "acme" } } } });
  assert.equal(removed.patch.billing.status, "canceled");
  assert.equal(removed.patch.plan, undefined);
  const updated = applyStripeEvent({ type: "customer.subscription.updated", livemode: false, data: { object: { id: "sub_test", customer: "cus_test", status: "past_due", metadata: { companyId: "acme" } } } });
  assert.equal(updated.patch.billing.status, "past_due");

  let saved = null;
  const webhook = await handleStripeWebhook({
    rawBody: good.text, signature: good.header, secret, now: good.now,
    loadCompany: async () => company,
    saveBilling: async (companyId, patch) => { saved = { companyId, patch }; },
  });
  assert.equal(webhook.status, 200);
  assert.equal(saved.companyId, "acme");
  assert.equal(saved.patch.billing.stripeSubscriptionId, "sub_test");
  const skipped = await handleStripeWebhook({
    rawBody: good.text, signature: good.header, secret, now: good.now,
    loadCompany: async () => ({ ...company, isTest: true }),
    saveBilling: async () => { throw new Error("should not write"); },
  });
  assert.equal(skipped.body.skipped, "test-company");
  const bad = await handleStripeWebhook({
    rawBody: good.text, signature: "t=1,v1=nope", secret, now: good.now,
    loadCompany: async () => company, saveBilling: async () => {},
  });
  assert.equal(bad.status, 400);

  const change = staffItemChange({
    staffCount: 3,
    subscription: { items: { data: [{ id: "si_extra", quantity: 1, price: { id: EXTRA_PRICE_ID } }] } },
  });
  assert.equal(change.action, "update");
  assert.equal(change.quantity, 2);
  assert.equal(change.proration_behavior, "create_prorations");
  const created = staffItemChange({ staffCount: 2, subscription: { items: { data: [{ id: "si_base", quantity: 1, price: { id: BASE_PRICE_ID } }] } } });
  assert.equal(created.action, "create");
  assert.equal(created.price, EXTRA_PRICE_ID);
  const gone = staffItemChange({ staffCount: 1, subscription: { items: { data: [{ id: "si_extra", quantity: 2, price: { id: EXTRA_PRICE_ID } }] } } });
  assert.equal(gone.action, "remove");

  const calls = [];
  const stripe = {
    subscriptions: { async retrieve() { return { items: { data: [{ id: "si_extra", quantity: 1, price: { id: EXTRA_PRICE_ID } }] } }; } },
    subscriptionItems: {
      async update(id, body) { calls.push(["update", id, body]); },
      async create(body) { calls.push(["create", body]); },
      async del(id, body) { calls.push(["del", id, body]); },
    },
    checkout: { sessions: { async create(params) { calls.push(["checkout", params]); return { url: "https://checkout.stripe.test/session" }; } } },
    billingPortal: { sessions: { async create(params) { calls.push(["portal", params]); return { url: "https://billing.stripe.test/session" }; } } },
  };
  const paid = { ...company, plan: "paid", billing: { provider: "stripe", status: "active", stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test" } };
  const synced = await syncStaffQuantity({ companyId: "acme", company: paid, staffCount: 3, stripe });
  assert.equal(synced.change.action, "update");
  assert.equal(calls[0][2].proration_behavior, "create_prorations");
  const held = await syncStaffQuantity({ companyId: "mate", company: { ...paid, plan: "friend" }, staffCount: 5, stripe });
  assert.equal(held.skipped, "friend-trial");
  assert.equal(calls.length, 1);
  const checkout = await handleCheckoutCall({
    uid: "adm", companyId: "acme", origin: "https://evil.example",
    getContext: async () => ({ company, profile: admin, staffCount: 1 }),
    stripe,
  });
  assert.equal(checkout.url, "https://checkout.stripe.test/session");
  assert.equal(calls[1][1].success_url.startsWith("https://jobs.heartwoodew.com/"), true);
  assert.equal(calls[1][1].line_items[0].price, BASE_PRICE_ID);
  const portal = await handlePortalCall({
    uid: "adm", companyId: "acme", origin: "https://jobs.heartwoodew.com",
    getContext: async () => ({ company: paid, profile: admin, staffCount: 2 }),
    stripe,
  });
  assert.equal(portal.ok, true);
  assert.deepEqual(portalParams({ company: paid, companyId: "acme", returnUrl: "https://jobs.heartwoodew.com/" }).params.customer, "cus_test");
  assert.deepEqual(companiesTouchedByUser({ companyId: "acme" }, { companyId: "heartwood" }), ["acme"]);
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.match(index, /defineSecret\("STRIPE_SECRET_KEY"\)/);
  assert.match(index, /defineSecret\("STRIPE_WEBHOOK_SECRET"\)/);
  assert.match(index, /stripeWebhook/);
  assert.equal(WEBHOOK_URL, "https://australia-southeast1-heartwood-9f37f.cloudfunctions.net/stripeWebhook");
  assert.doesNotMatch(index, /sk_live_|whsec_[A-Za-z0-9]{8,}/);
});
