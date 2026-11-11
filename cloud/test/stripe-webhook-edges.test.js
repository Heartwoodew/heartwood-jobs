// Stripe webhook edge cases with a made-up test secret. No network, no Stripe account.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { constructStripeEvent, handleStripeWebhook, mergeBilling } from "../functions/billing/stripe-billing.js";

const SECRET = "whsec_test_stress_only";
const OLD = "whsec_test_rolled_old";
const sig = (secret, t, text) => createHmac("sha256", secret).update(`${t}.${text}`).digest("hex");
const nowS = 1_800_000_000;
const company = () => ({ name: "Acme", status: "active", plan: "trial", isTest: false,
  billing: { provider: null, status: "not-configured", stripeCustomerId: null, stripeSubscriptionId: null } });

function store() {
  const db = { acme: company() };
  return {
    db,
    loadCompany: async id => db[id] || null,
    // Same shape as index.js saveBilling.
    saveBilling: async (id, patch, stamp) => {
      const merged = mergeBilling(db[id].billing || {}, patch.billing, stamp);
      if (merged.skipped) return merged;
      db[id] = { ...db[id], ...(patch.plan ? { plan: patch.plan } : {}), billing: merged.billing };
      return {};
    },
  };
}
async function deliver(s, event, { secret = SECRET, header, mode = "test", now = nowS } = {}) {
  const text = JSON.stringify(event);
  return handleStripeWebhook({ rawBody: Buffer.from(text), signature: header || `t=${now},v1=${sig(secret, now, text)}`, secret: SECRET, mode, now: now * 1000, ...s });
}
const ev = (id, type, created, object) => ({ id, type, created, livemode: false, data: { object: { metadata: { companyId: "acme" }, customer: "cus_1", ...object } } });

test("unsigned, wrong-secret, stale, tampered and junk deliveries are all 400", async () => {
  const s = store();
  const e = ev("evt_a", "invoice.paid", nowS, { subscription: "sub_1" });
  const text = JSON.stringify(e);
  for (const header of ["", "t=", `t=${nowS}`, `v1=${sig(SECRET, nowS, text)}`, `t=${nowS},v1=${sig("whsec_other", nowS, text)}`,
    `t=${nowS - 301},v1=${sig(SECRET, nowS - 301, text)}`, `t=${nowS + 301},v1=${sig(SECRET, nowS + 301, text)}`, `t=abc,v1=${sig(SECRET, "abc", text)}`]) {
    const out = await handleStripeWebhook({ rawBody: Buffer.from(text), signature: header, secret: SECRET, now: nowS * 1000, ...s });
    assert.equal(out.status, 400, header);
  }
  const tampered = await handleStripeWebhook({ rawBody: Buffer.from(text.replace("acme", "acmf")), signature: `t=${nowS},v1=${sig(SECRET, nowS, text)}`, secret: SECRET, now: nowS * 1000, ...s });
  assert.equal(tampered.status, 400);
  const notJson = "not json";
  const junk = await handleStripeWebhook({ rawBody: Buffer.from(notJson), signature: `t=${nowS},v1=${sig(SECRET, nowS, notJson)}`, secret: SECRET, now: nowS * 1000, ...s });
  assert.equal(junk.status, 400);
  // Empty secret never verifies anything.
  assert.throws(() => constructStripeEvent(text, `t=${nowS},v1=${sig("", nowS, text)}`, "", nowS * 1000), /invalid-signature/);
  assert.equal(s.db.acme.billing.status, "not-configured");
});

test("a header with two v1 signatures (Stripe secret roll) verifies when either matches", async () => {
  const s = store();
  const e = ev("evt_roll", "checkout.session.completed", nowS, { mode: "subscription", subscription: "sub_1", client_reference_id: "acme" });
  const text = JSON.stringify(e);
  const both = `t=${nowS},v1=${sig(SECRET, nowS, text)},v1=${sig(OLD, nowS, text)}`;
  const reversed = `t=${nowS},v1=${sig(OLD, nowS, text)},v1=${sig(SECRET, nowS, text)}`;
  assert.equal((await deliver(s, e, { header: both })).status, 200);
  assert.equal((await deliver(store(), e, { header: reversed })).status, 200);
  assert.equal(s.db.acme.billing.status, "active");
});

test("out-of-order and retried events cannot re-activate a cancelled subscription", async () => {
  const s = store();
  await deliver(s, ev("evt_1", "checkout.session.completed", nowS - 100, { mode: "subscription", subscription: "sub_1", client_reference_id: "acme" }));
  await deliver(s, ev("evt_2", "invoice.paid", nowS - 90, { subscription: "sub_1" }));
  await deliver(s, ev("evt_3", "customer.subscription.deleted", nowS - 10, { id: "sub_1", object: "subscription" }));
  assert.equal(s.db.acme.billing.status, "canceled");
  // Stripe retries the earlier invoice.paid after the cancel.
  const retry = await deliver(s, ev("evt_2", "invoice.paid", nowS - 90, { subscription: "sub_1" }));
  assert.equal(retry.status, 200);
  assert.equal(retry.body.skipped, "stale-event");
  assert.equal(s.db.acme.billing.status, "canceled");
  // Same-second events still apply, and a genuinely newer event does too.
  await deliver(s, ev("evt_4", "customer.subscription.updated", nowS - 10, { id: "sub_2", status: "active" }));
  assert.equal(s.db.acme.billing.status, "active");
  // The exact same event delivered twice is a no-op.
  const dup = await deliver(s, ev("evt_4", "customer.subscription.updated", nowS - 10, { id: "sub_2", status: "active" }));
  assert.equal(dup.body.skipped, "duplicate-event");
});

test("mode guards and companies that never bill", async () => {
  const s = store();
  const live = { ...ev("evt_l", "invoice.paid", nowS, { subscription: "sub_1" }), livemode: true };
  assert.equal((await deliver(s, live)).body.skipped, "live-mode");
  assert.equal((await deliver(s, ev("evt_t", "invoice.paid", nowS, { subscription: "sub_1" }), { mode: "live" })).body.skipped, "test-mode");
  const other = ev("evt_x", "invoice.paid", nowS, { subscription: "sub_1" });
  other.data.object.metadata.companyId = "heartwood";
  assert.equal((await deliver(s, other)).body.skipped, "missing-company");
  const unknown = ev("evt_u", "invoice.paid", nowS, { subscription: "sub_1" });
  unknown.data.object.metadata = {};
  assert.equal((await deliver(s, unknown)).body.skipped, "no-company");
  assert.equal((await deliver(s, ev("evt_i", "charge.refunded", nowS, {}))).body.skipped, "ignored-event");
  s.db.acme.isTest = true;
  assert.equal((await deliver(s, ev("evt_k", "invoice.paid", nowS, { subscription: "sub_1" }))).body.skipped, "test-company");
  s.db.acme.isTest = false; s.db.acme.status = "archived";
  assert.equal((await deliver(s, ev("evt_m", "invoice.paid", nowS, { subscription: "sub_1" }))).body.skipped, "archived");
  assert.equal(s.db.acme.billing.status, "not-configured");
});

test("basil-shaped invoice (subscription under parent) still finds the company", async () => {
  const s = store();
  const e = { id: "evt_b", type: "invoice.paid", created: nowS, livemode: false, data: { object: { customer: "cus_1",
    parent: { subscription_details: { subscription: "sub_9", metadata: { companyId: "acme" } } } } } };
  const out = await deliver(s, e);
  assert.equal(out.status, 200);
  assert.equal(s.db.acme.billing.status, "active");
  assert.equal(s.db.acme.plan, "paid");
  assert.equal(s.db.acme.billing.stripeSubscriptionId, "sub_9");
});
