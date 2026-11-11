import { createHmac, timingSafeEqual } from "node:crypto";
import { CALLUP_ORIGINS, HEARTWOOD_APP_ORIGIN, appOriginFor } from "../shared/staff-invites.js";

// Stripe for CallUp (live since 11 Nov 2026 via STRIPE_MODE=live). One plan: A$20 includes 1 person, A$5 each extra person.
// There is no second tier. Test companies, friend trials and Heartwood never call Stripe.
// Test mode (default): the secret key must be an sk_test_ key and live events are refused.
// Test secrets are STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Secret Manager.
// Live mode only when STRIPE_MODE=live is set in functions/.env.heartwood-9f37f AND the live secrets exist:
// STRIPE_LIVE_SECRET_KEY (sk_live_), STRIPE_LIVE_WEBHOOK_SECRET, STRIPE_LIVE_BASE_PRICE_ID, STRIPE_LIVE_EXTRA_PRICE_ID.
// In live mode, test keys and test events are refused instead. See /workspace/callup/stripe-go-live-steps.md.
// Webhook URL, after a human deploys: https://australia-southeast1-heartwood-9f37f.cloudfunctions.net/stripeWebhook

export const BASE_PRICE_ID = "price_1UZRdBHEbjZCMeDTohSuaIwr";
export const EXTRA_PRICE_ID = "price_1UZRdDHEbjZCMeDTrPHYbfnK";
export const BASE_LOOKUP = "callup_base_monthly";
export const EXTRA_LOOKUP = "callup_extra_staff_monthly";
// Pinned Stripe API version. Managed Payments (live account) needs 2025-03-31.basil or newer.
export const STRIPE_API_VERSION = "2025-03-31.basil";
export const WEBHOOK_URL = "https://australia-southeast1-heartwood-9f37f.cloudfunctions.net/stripeWebhook";

// Return address for Checkout / the billing portal. Only our own app addresses are accepted.
// Anything else falls back to the company's preferred address (Heartwood: jobs.heartwoodew.com; others: CallUp).
export function billingOrigin(value, companyId = "", domainLive) {
  const origin = String(value || "").replace(/\/$/, "");
  if (origin === HEARTWOOD_APP_ORIGIN || CALLUP_ORIGINS.includes(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return appOriginFor(companyId || "heartwood", "", domainLive);
}

export function stripeMode(env = {}) {
  return env.STRIPE_MODE === "live" ? "live" : "test";
}

// Prices for a mode. Live price ids come from Secret Manager values; test ids are the sandbox constants.
export function stripePrices(mode = "test", live = {}) {
  if (mode !== "live") return { base: BASE_PRICE_ID, extra: EXTRA_PRICE_ID };
  const base = String(live.base || "").trim();
  const extra = String(live.extra || "").trim();
  if (!/^price_[A-Za-z0-9]+$/.test(base) || !/^price_[A-Za-z0-9]+$/.test(extra) || base === BASE_PRICE_ID || extra === EXTRA_PRICE_ID) {
    const err = new Error("stripe-live-prices-missing");
    err.code = "failed-precondition";
    throw err;
  }
  return { base, extra };
}

export function extraStaffQuantity(staffCount) {
  const n = Math.floor(Number(staffCount) || 0);
  return Math.max(0, n - 1);
}

export function billingSkipped(company, companyId) {
  const id = companyId || (company && (company.companyId || company.id)) || "";
  if (!company) return "missing-company";
  if (id === "heartwood") return "heartwood";
  if (company.isTest === true) return "test-company";
  if (company.plan === "friend") return "friend-trial";
  if (company.status === "archived") return "archived";
  return "";
}

export function assertTestKey(secret) {
  const key = String(secret || "");
  if (!key.startsWith("sk_test_")) {
    const err = new Error("stripe-test-key-required");
    err.code = "failed-precondition";
    throw err;
  }
}

// Key check for the configured mode. Live keys are refused unless mode is explicitly "live".
export function assertKeyForMode(secret, mode = "test") {
  if (mode !== "live") return assertTestKey(secret);
  const key = String(secret || "");
  if (!key.startsWith("sk_live_") && !key.startsWith("rk_live_")) {
    const err = new Error("stripe-live-key-required");
    err.code = "failed-precondition";
    throw err;
  }
}

export function authorizeCompanyAdmin({ uid, profile, company, companyId }) {
  if (!uid) return { ok: false, code: "unauthenticated", reason: "sign-in" };
  // Check the caller is this company's admin before saying anything about the company, so a signed-in user
  // can't probe which company ids exist or which are test, friend, archived or Heartwood.
  const role = profile && profile.role;
  const home = (profile && (profile.companyId || profile.tenantId)) || "";
  if (role !== "admin" || home !== companyId) return { ok: false, code: "permission-denied", reason: "company-admin" };
  if (!company) return { ok: false, code: "not-found", reason: "missing-company" };
  const skip = billingSkipped(company, companyId);
  if (skip) return { ok: false, code: "failed-precondition", reason: skip };
  return { ok: true };
}

export function checkoutParams({ companyId, company, staffCount, successUrl, cancelUrl, prices = stripePrices() }) {
  const skip = billingSkipped(company, companyId);
  if (skip) return { ok: false, reason: skip };
  const billing = company.billing || {};
  if (billing.stripeSubscriptionId && billing.status === "active") return { ok: false, reason: "already-subscribed" };
  const extra = extraStaffQuantity(staffCount);
  const lineItems = [{ price: prices.base, quantity: 1 }];
  if (extra > 0) lineItems.push({ price: prices.extra, quantity: extra });
  const params = {
    mode: "subscription",
    client_reference_id: companyId,
    line_items: lineItems,
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    billing_address_collection: "required",
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { companyId },
    subscription_data: { metadata: { companyId } },
  };
  if (billing.stripeCustomerId) {
    params.customer = billing.stripeCustomerId;
    params.customer_update = { name: "auto", address: "auto" };
  } else if (company.email) {
    params.customer_email = company.email;
  }
  return { ok: true, params };
}

export function portalParams({ company, companyId, returnUrl }) {
  const skip = billingSkipped(company, companyId);
  if (skip) return { ok: false, reason: skip };
  const customer = company.billing && company.billing.stripeCustomerId;
  if (!customer) return { ok: false, reason: "no-customer" };
  return { ok: true, params: { customer, return_url: returnUrl } };
}

function companyIdOf(object) {
  if (!object || typeof object !== "object") return "";
  return object.client_reference_id
    || (object.metadata && object.metadata.companyId)
    || (object.subscription_details && object.subscription_details.metadata && object.subscription_details.metadata.companyId)
    || (object.parent && object.parent.subscription_details && object.parent.subscription_details.metadata && object.parent.subscription_details.metadata.companyId)
    || "";
}

// API 2025-03-31.basil moved invoice.subscription to invoice.parent.subscription_details.subscription.
function invoiceSubscription(object) {
  return object.subscription
    || (object.parent && object.parent.subscription_details && object.parent.subscription_details.subscription)
    || undefined;
}

function mapStatus(stripeStatus) {
  if (stripeStatus === "active" || stripeStatus === "trialing") return "active";
  if (stripeStatus === "past_due" || stripeStatus === "unpaid") return "past_due";
  if (stripeStatus === "canceled" || stripeStatus === "incomplete_expired") return "canceled";
  return "";
}

function billingPatch(status, ids = {}) {
  const billing = { provider: "stripe", status };
  if (ids.customer) billing.stripeCustomerId = ids.customer;
  if (ids.subscription) billing.stripeSubscriptionId = ids.subscription;
  return billing;
}

export function applyStripeEvent(event, mode = "test") {
  if (!event) return { ok: false, reason: "no-event" };
  if (mode !== "live" && event.livemode === true) return { ok: false, reason: "live-mode" };
  if (mode === "live" && event.livemode !== true) return { ok: false, reason: "test-mode" };
  const object = event.data && event.data.object;
  const companyId = companyIdOf(object);
  if (!companyId) return { ok: false, reason: "no-company" };
  if (event.type === "checkout.session.completed") {
    if (object.mode !== "subscription") return { ok: false, reason: "not-subscription" };
    return {
      ok: true,
      companyId,
      patch: { plan: "paid", billing: billingPatch("active", { customer: object.customer, subscription: object.subscription }) },
    };
  }
  if (event.type === "invoice.paid") {
    return {
      ok: true,
      companyId,
      patch: { plan: "paid", billing: billingPatch("active", { customer: object.customer, subscription: invoiceSubscription(object) }) },
    };
  }
  if (event.type === "invoice.payment_failed") {
    return { ok: true, companyId, patch: { plan: "paid", billing: billingPatch("past_due", { customer: object.customer, subscription: invoiceSubscription(object) }) } };
  }
  if (event.type === "customer.subscription.updated") {
    const status = mapStatus(object.status);
    if (!status) return { ok: false, reason: "ignored-status" };
    const plan = status === "canceled" ? undefined : "paid";
    return { ok: true, companyId, patch: { ...(plan ? { plan } : {}), billing: billingPatch(status, { customer: object.customer, subscription: object.id }) } };
  }
  if (event.type === "customer.subscription.deleted") {
    return { ok: true, companyId, patch: { billing: billingPatch("canceled", { customer: object.customer, subscription: object.id }) } };
  }
  return { ok: false, reason: "ignored-event" };
}

export function staffItemChange({ subscription, staffCount, prices = stripePrices() }) {
  const quantity = extraStaffQuantity(staffCount);
  const items = (subscription && subscription.items && subscription.items.data) || [];
  const extra = items.find(item => item.price && (item.price.id === prices.extra || item.price.lookup_key === EXTRA_LOOKUP));
  if (!extra && quantity === 0) return { action: "none", quantity };
  if (!extra) return { action: "create", price: prices.extra, quantity, proration_behavior: "create_prorations" };
  if (quantity === 0) return { action: "remove", itemId: extra.id, proration_behavior: "create_prorations" };
  if (extra.quantity === quantity) return { action: "none", quantity };
  return { action: "update", itemId: extra.id, quantity, proration_behavior: "create_prorations" };
}

export function companiesTouchedByUser(before, after) {
  const ids = new Set();
  for (const row of [before, after]) {
    if (!row) continue;
    const id = typeof row.companyId === "string" && row.companyId ? row.companyId : "";
    if (id && id !== "heartwood") ids.add(id);
  }
  return [...ids];
}

export async function syncStaffQuantity({ companyId, company, staffCount, stripe, prices = stripePrices() }) {
  const skip = billingSkipped(company, companyId);
  if (skip) return { ok: true, skipped: skip };
  const billing = company.billing || {};
  if (billing.provider !== "stripe" || !billing.stripeSubscriptionId) return { ok: true, skipped: "no-subscription" };
  if (billing.status !== "active" && billing.status !== "past_due") return { ok: true, skipped: "not-billable" };
  const subscription = await stripe.subscriptions.retrieve(billing.stripeSubscriptionId);
  const change = staffItemChange({ subscription, staffCount, prices });
  if (change.action === "create") {
    await stripe.subscriptionItems.create({
      subscription: billing.stripeSubscriptionId,
      price: change.price,
      quantity: change.quantity,
      proration_behavior: change.proration_behavior,
    });
  } else if (change.action === "update") {
    await stripe.subscriptionItems.update(change.itemId, {
      quantity: change.quantity,
      proration_behavior: change.proration_behavior,
    });
  } else if (change.action === "remove") {
    await stripe.subscriptionItems.del(change.itemId, { proration_behavior: change.proration_behavior });
  }
  return { ok: true, change };
}

export async function handleCheckoutCall({ uid, companyId, origin, getContext, stripe, prices = stripePrices() }) {
  origin = billingOrigin(origin, companyId);
  const ctx = await getContext(uid, companyId);
  const authz = authorizeCompanyAdmin({ uid, profile: ctx.profile, company: ctx.company, companyId });
  if (!authz.ok) return authz;
  const built = checkoutParams({
    companyId,
    company: ctx.company,
    staffCount: ctx.staffCount,
    successUrl: `${origin}/app/?billing=success`,
    cancelUrl: `${origin}/app/?billing=cancel`,
    prices,
  });
  if (!built.ok) return built;
  const session = await stripe.checkout.sessions.create(built.params);
  return { ok: true, url: session.url };
}

export async function handlePortalCall({ uid, companyId, origin, getContext, stripe }) {
  origin = billingOrigin(origin, companyId);
  const ctx = await getContext(uid, companyId);
  const authz = authorizeCompanyAdmin({ uid, profile: ctx.profile, company: ctx.company, companyId });
  if (!authz.ok) return authz;
  const built = portalParams({ company: ctx.company, companyId, returnUrl: `${origin}/app/` });
  if (!built.ok) return built;
  const session = await stripe.billingPortal.sessions.create(built.params);
  return { ok: true, url: session.url };
}

export function constructStripeEvent(rawBody, header, secret, now = Date.now()) {
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  const parts = {};
  for (const piece of String(header || "").split(",")) {
    const cut = piece.indexOf("=");
    if (cut > 0) parts[piece.slice(0, cut)] = piece.slice(cut + 1);
  }
  const timestamp = parts.t;
  // Stripe sends one v1 per active signing secret (two while a rolled secret is still valid). Accept any match.
  const signatures = String(header || "").split(",").map(p => p.trim()).filter(p => p.startsWith("v1=")).map(p => p.slice(3)).filter(Boolean);
  if (!timestamp || !signatures.length || !secret) throw new Error("invalid-signature");
  const age = Math.abs(now - Number(timestamp) * 1000);
  if (!Number.isFinite(age) || age > 5 * 60 * 1000) throw new Error("invalid-signature");
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${text}`).digest("hex"));
  const match = signatures.some(sig => {
    const right = Buffer.from(String(sig));
    return expected.length === right.length && timingSafeEqual(expected, right);
  });
  if (!match) throw new Error("invalid-signature");
  const event = JSON.parse(text);
  if (!event || typeof event !== "object" || typeof event.type !== "string") throw new Error("invalid-signature");
  return event;
}

export async function handleStripeWebhook({ rawBody, signature, secret, loadCompany, saveBilling, now, mode = "test" }) {
  let event;
  try {
    event = constructStripeEvent(rawBody, signature, secret, now);
  } catch {
    return { status: 400, body: { error: "invalid-signature" } };
  }
  const decision = applyStripeEvent(event, mode);
  if (!decision.ok) return { status: 200, body: { received: true, skipped: decision.reason } };
  const company = await loadCompany(decision.companyId);
  const skip = billingSkipped(company, decision.companyId);
  if (skip) return { status: 200, body: { received: true, skipped: skip } };
  const saved = await saveBilling(decision.companyId, decision.patch, eventStamp(event));
  if (saved && saved.skipped) return { status: 200, body: { received: true, skipped: saved.skipped } };
  return { status: 200, body: { received: true, companyId: decision.companyId } };
}

function eventStamp(event) {
  const created = Math.floor(Number(event && event.created));
  return { id: String((event && event.id) || ""), created: Number.isFinite(created) && created > 0 ? created : 0 };
}

// Stripe does not deliver events in order and retries old ones for days. Apply a patch only when the event is not older
// than the last one applied, so a retried invoice.paid can't turn a cancelled subscription back on. Same-second events
// still apply. Events without a created time (never from Stripe) apply but don't move the marker.
export function mergeBilling(current = {}, patch = {}, stamp = {}) {
  const last = Math.floor(Number(current.lastEventCreated) || 0);
  const created = Math.floor(Number(stamp.created) || 0);
  if (created && last && created < last) return { skipped: "stale-event" };
  if (stamp.id && current.lastEventId === stamp.id) return { skipped: "duplicate-event" };
  const billing = { ...current, ...patch };
  if (created) { billing.lastEventCreated = Math.max(created, last); billing.lastEventId = stamp.id || ""; }
  return { billing };
}
