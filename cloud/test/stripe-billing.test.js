import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  BASE_PRICE_ID, EXTRA_PRICE_ID, WEBHOOK_URL, applyStripeEvent, assertTestKey, auAbnTaxId, authorizeCompanyAdmin,
  checkoutParams, companiesTouchedByUser, constructStripeEvent, extraStaffQuantity, handleCheckoutCall, trialCheckoutFields,
  handlePortalCall, handleStripeWebhook, portalParams, prefillCustomerAbn, staffItemChange, stripeGstTaxRateId, syncStaffQuantity,
} from "../functions/billing/stripe-billing.js";

const GST_RATE = "txr_testgst10";

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
  const one = checkoutParams({ companyId: "acme", company, staffCount: 1, successUrl: "https://jobs.heartwoodew.com/?billing=success", cancelUrl: "https://jobs.heartwoodew.com/?billing=cancel", taxRateId: GST_RATE });
  assert.equal(one.ok, true);
  assert.equal(one.params.mode, "subscription");
  assert.equal(one.params.client_reference_id, "acme");
  assert.equal(one.params.managed_payments.enabled, false);
  assert.equal(one.params.automatic_tax, undefined);
  assert.equal(one.params.tax_id_collection.enabled, true);
  assert.equal(one.params.billing_address_collection, "required");
  assert.deepEqual(one.params.subscription_data.default_tax_rates, [GST_RATE]);
  assert.deepEqual(one.params.line_items, [{ price: BASE_PRICE_ID, quantity: 1, tax_rates: [GST_RATE] }]);
  const four = checkoutParams({ companyId: "acme", company, staffCount: 4, successUrl: "x", cancelUrl: "y", taxRateId: GST_RATE });
  assert.deepEqual(four.params.line_items, [
    { price: BASE_PRICE_ID, quantity: 1, tax_rates: [GST_RATE] },
    { price: EXTRA_PRICE_ID, quantity: 3, tax_rates: [GST_RATE] },
  ]);
  assert.deepEqual(four.params.subscription_data.default_tax_rates, [GST_RATE]);
  assert.equal(checkoutParams({ companyId: "acme", company, staffCount: 1, successUrl: "x", cancelUrl: "y" }).reason, "gst-tax-rate-missing");
  assert.equal(checkoutParams({ companyId: "acme", company, staffCount: 1, successUrl: "x", cancelUrl: "y", taxRateId: "price_notatax" }).reason, "gst-tax-rate-missing");
  assert.equal(stripeGstTaxRateId("test", { test: " txr_sandbox1 " }), "txr_sandbox1");
  assert.equal(stripeGstTaxRateId("live", { test: "txr_sandbox1", live: "txr_live1" }), "txr_live1");
  assert.throws(() => stripeGstTaxRateId("live", { test: "txr_sandbox1" }), /stripe-gst-tax-rate-missing/);
  assert.throws(() => stripeGstTaxRateId("test", { test: "" }), /stripe-gst-tax-rate-missing/);
  assert.equal(auAbnTaxId("12 345 678 901").value, "12345678901");
  assert.equal(auAbnTaxId("1"), null);
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
  const trialing = applyStripeEvent({ type: "customer.subscription.updated", livemode: false, data: { object: { id: "sub_trial", customer: "cus_test", status: "trialing", metadata: { companyId: "acme" } } } });
  assert.equal(trialing.patch.billing.status, "trialing");
  assert.equal(trialing.patch.plan, undefined);
  const preserved = applyStripeEvent({ type: "checkout.session.completed", livemode: false, data: { object: { mode: "subscription", client_reference_id: "acme", customer: "cus_test", subscription: "sub_trial", metadata: { companyId: "acme", preserveTrial: "1" } } } });
  assert.equal(preserved.patch.billing.status, "trialing");
  assert.equal(preserved.patch.plan, undefined);

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
    stripe, taxRateId: GST_RATE,
  });
  assert.equal(checkout.url, "https://checkout.stripe.test/session");
  assert.equal(calls[1][1].success_url, "https://app.callupapp.com.au/app/?billing=success");
  assert.equal(calls[1][1].line_items[0].price, BASE_PRICE_ID);
  assert.equal(calls[1][1].managed_payments.enabled, false);
  assert.deepEqual(calls[1][1].line_items[0].tax_rates, [GST_RATE]);
  assert.deepEqual(calls[1][1].subscription_data.default_tax_rates, [GST_RATE]);
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
  assert.match(index, /defineSecret\("STRIPE_GST_TAX_RATE_ID"\)/);
  assert.match(index, /defineSecret\("STRIPE_LIVE_GST_TAX_RATE_ID"\)/);
  assert.match(index, /taxRateId: currentGstTaxRateId\(\)/);
  assert.match(index, /STRIPE_LIVE_GST_TAX_RATE_ID/);
  assert.match(index, /stripeWebhook/);
  assert.doesNotMatch(index, /uses Stripe Managed Payments/);
  assert.equal(WEBHOOK_URL, "https://australia-southeast1-heartwood-9f37f.cloudfunctions.net/stripeWebhook");
  assert.doesNotMatch(index, /sk_live_|whsec_[A-Za-z0-9]{8,}/);
});

test("billing callables say nothing about a company to someone who is not its admin (round 3)", () => {
  const outsider = { role: "admin", companyId: "mine" };
  for (const company of [null, { isTest: true }, { plan: "friend" }, { status: "archived" }, { plan: "trial" }]) {
    const r = authorizeCompanyAdmin({ uid: "u1", profile: outsider, company, companyId: "theirs" });
    assert.equal(r.code, "permission-denied");
    assert.equal(r.reason, "company-admin");
  }
  assert.equal(authorizeCompanyAdmin({ uid: "u1", profile: outsider, company: { name: "H" }, companyId: "heartwood" }).reason, "company-admin");
  assert.equal(authorizeCompanyAdmin({ uid: "u1", profile: { role: "admin", companyId: "t1" }, company: { isTest: true }, companyId: "t1" }).reason, "test-company");
});

test("signup checkout keeps the company trial and still works when Stripe is not configured", async () => {
  const end = new Date("2026-12-01T00:00:00Z");
  const now = new Date("2026-11-17T00:00:00Z").getTime();
  const withTrial = { ...company, trialEndsAt: end.toISOString() };
  const kept = checkoutParams({
    companyId: "acme", company: withTrial, staffCount: 2,
    successUrl: "https://app.callupapp.com.au/app/?billing=success",
    cancelUrl: "https://app.callupapp.com.au/app/?billing=cancel",
    preserveTrial: true, now, taxRateId: GST_RATE,
  });
  assert.equal(kept.ok, true);
  assert.equal(kept.params.mode, "subscription");
  assert.equal(kept.params.payment_method_collection, "always");
  assert.equal(kept.params.subscription_data.trial_end, Math.floor(end.getTime() / 1000));
  assert.deepEqual(kept.params.subscription_data.default_tax_rates, [GST_RATE]);
  assert.equal(kept.params.managed_payments.enabled, false);
  assert.equal(kept.params.metadata.preserveTrial, "1");
  assert.deepEqual(trialCheckoutFields(end, now), { trial_end: Math.floor(end.getTime() / 1000) });
  const short = trialCheckoutFields(new Date(now + 20 * 60 * 60 * 1000), now);
  assert.equal(short.trial_period_days >= 2, true);
  assert.equal(trialCheckoutFields(new Date(now - 1000), now), null);
  const plain = checkoutParams({ companyId: "acme", company: withTrial, staffCount: 1, successUrl: "x", cancelUrl: "y", now, taxRateId: GST_RATE });
  assert.equal(plain.params.subscription_data.trial_end, undefined);
  assert.equal(plain.params.payment_method_collection, undefined);
  const calls = [];
  const stripe = { checkout: { sessions: { async create(params) { calls.push(params); return { url: "https://checkout.stripe.test/trial" }; } } } };
  const opened = await handleCheckoutCall({
    uid: "adm", companyId: "acme", origin: "https://app.callupapp.com.au",
    getContext: async () => ({ company: withTrial, profile: admin, staffCount: 2 }),
    stripe, preserveTrial: true, now, taxRateId: GST_RATE,
  });
  assert.equal(opened.ok, true);
  assert.equal(calls[0].subscription_data.trial_end, Math.floor(end.getTime() / 1000));
  assert.equal(calls[0].payment_method_collection, "always");
  const missing = await handleCheckoutCall({
    uid: "adm", companyId: "acme", origin: "https://app.callupapp.com.au",
    getContext: async () => ({ company: withTrial, profile: admin, staffCount: 1 }),
    stripe: null, preserveTrial: true,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "stripe-not-configured");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.match(index, /preserveTrial: request\.data\?\.preserveTrial === true/);
  assert.match(index, /Card setup isn't available yet, you can add it later in Settings/);
  const already = checkoutParams({
    companyId: "acme",
    company: { ...withTrial, billing: { status: "trialing", stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1" } },
    staffCount: 1, successUrl: "x", cancelUrl: "y",
  });
  assert.equal(already.reason, "already-subscribed");
});

test("checkout prefills a saved ABN and still opens when Stripe rejects the tax id", async () => {
  const calls = [];
  const stripe = {
    customers: {
      async listTaxIds(id) { calls.push(["list", id]); return { data: [] }; },
      async createTaxId(id, body) { calls.push(["tax", id, body]); return { id: "txi_1" }; },
      async create(body) { calls.push(["customer", body]); return { id: "cus_new" }; },
    },
    checkout: { sessions: { async create(params) { calls.push(["checkout", params]); return { url: "https://checkout.stripe.test/abn" }; } } },
  };
  const withAbn = {
    ...company, abn: "12 345 678 901", legalName: "Acme Civil Pty Ltd",
    billing: { ...company.billing, stripeCustomerId: "cus_test" },
  };
  const opened = await handleCheckoutCall({
    uid: "adm", companyId: "acme", origin: "https://app.callupapp.com.au",
    getContext: async () => ({ company: withAbn, profile: admin, staffCount: 1 }),
    stripe, taxRateId: GST_RATE,
  });
  assert.equal(opened.ok, true);
  assert.deepEqual(calls[0], ["list", "cus_test"]);
  assert.deepEqual(calls[1], ["tax", "cus_test", { type: "au_abn", value: "12345678901" }]);
  assert.equal(calls[2][1].customer, "cus_test");
  assert.equal(calls[2][1].managed_payments.enabled, false);
  assert.equal(calls[2][1].automatic_tax, undefined);
  assert.deepEqual(calls[2][1].subscription_data.default_tax_rates, [GST_RATE]);

  calls.length = 0;
  stripe.customers.listTaxIds = async (id) => { calls.push(["list", id]); return { data: [{ type: "au_abn", value: "12 345 678 901" }] }; };
  const again = await handleCheckoutCall({
    uid: "adm", companyId: "acme", origin: "https://app.callupapp.com.au",
    getContext: async () => ({ company: withAbn, profile: admin, staffCount: 1 }),
    stripe, taxRateId: GST_RATE,
  });
  assert.equal(again.ok, true);
  assert.equal(calls.some(row => row[0] === "tax"), false);

  calls.length = 0;
  const fresh = { ...company, abn: "51 824 753 556", legalName: "New Co Pty Ltd" };
  const created = await handleCheckoutCall({
    uid: "adm", companyId: "acme", origin: "https://app.callupapp.com.au",
    getContext: async () => ({ company: fresh, profile: admin, staffCount: 1 }),
    stripe, taxRateId: GST_RATE,
  });
  assert.equal(created.ok, true);
  assert.equal(calls[0][0], "customer");
  assert.deepEqual(calls[0][1].tax_id_data, [{ type: "au_abn", value: "51824753556" }]);
  assert.equal(calls[1][1].customer, "cus_new");
  assert.equal(calls[1][1].customer_email, undefined);
  assert.deepEqual(calls[1][1].customer_update, { name: "auto", address: "auto" });

  calls.length = 0;
  stripe.customers.listTaxIds = async (id) => { calls.push(["list", id]); return { data: [] }; };
  stripe.customers.createTaxId = async () => { throw new Error("tax-id-rejected"); };
  const rejected = await handleCheckoutCall({
    uid: "adm", companyId: "acme", origin: "https://app.callupapp.com.au",
    getContext: async () => ({ company: withAbn, profile: admin, staffCount: 1 }),
    stripe, taxRateId: GST_RATE,
  });
  assert.equal(rejected.url, "https://checkout.stripe.test/abn");
  assert.equal(calls[0][0], "list");
  assert.equal(calls[1][0], "checkout");
  calls.length = 0;
  const short = await handleCheckoutCall({
    uid: "adm", companyId: "acme", origin: "https://app.callupapp.com.au",
    getContext: async () => ({ company: { ...company, abn: "1", billing: { stripeCustomerId: "cus_short" } }, profile: admin, staffCount: 1 }),
    stripe, taxRateId: GST_RATE,
  });
  assert.equal(short.ok, true);
  assert.deepEqual(calls.map(row => row[0]), ["checkout"]);
  const direct = { customer_email: "office@acme.test", client_reference_id: "acme" };
  stripe.customers.create = async () => { throw new Error("customer-rejected"); };
  await prefillCustomerAbn({ stripe, params: direct, company: fresh, companyId: "acme" });
  assert.equal(direct.customer, undefined);
  assert.equal(direct.customer_email, "office@acme.test");
});
