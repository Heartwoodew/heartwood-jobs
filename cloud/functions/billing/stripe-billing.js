import { createHmac, timingSafeEqual } from "node:crypto";

// Sandbox Stripe for CallUp. One plan: A$20 includes 1 person, A$5 each extra person.
// There is no second tier. Test companies, friend trials and Heartwood never call Stripe.
// The secret key must be an sk_test_ key. Live mode is refused.
// Secrets are STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Secret Manager.
// Webhook URL, after a human deploys: https://australia-southeast1-heartwood-9f37f.cloudfunctions.net/stripeWebhook

export const BASE_PRICE_ID = "price_1UZRdBHEbjZCMeDTohSuaIwr";
export const EXTRA_PRICE_ID = "price_1UZRdDHEbjZCMeDTrPHYbfnK";
export const BASE_LOOKUP = "callup_base_monthly";
export const EXTRA_LOOKUP = "callup_extra_staff_monthly";
export const WEBHOOK_URL = "https://australia-southeast1-heartwood-9f37f.cloudfunctions.net/stripeWebhook";

export function billingOrigin(value) {
  const origin = String(value || "").replace(/\/$/, "");
  if (origin === "https://jobs.heartwoodew.com") return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return "https://jobs.heartwoodew.com";
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

export function authorizeCompanyAdmin({ uid, profile, company, companyId }) {
  const skip = billingSkipped(company, companyId);
  if (!uid) return { ok: false, code: "unauthenticated", reason: "sign-in" };
  if (!company) return { ok: false, code: "not-found", reason: "missing-company" };
  if (skip) return { ok: false, code: "failed-precondition", reason: skip };
  const role = profile && profile.role;
  const home = (profile && (profile.companyId || profile.tenantId)) || "";
  if (role !== "admin" || home !== companyId) return { ok: false, code: "permission-denied", reason: "company-admin" };
  return { ok: true };
}

export function checkoutParams({ companyId, company, staffCount, successUrl, cancelUrl }) {
  const skip = billingSkipped(company, companyId);
  if (skip) return { ok: false, reason: skip };
  const billing = company.billing || {};
  if (billing.stripeSubscriptionId && billing.status === "active") return { ok: false, reason: "already-subscribed" };
  const extra = extraStaffQuantity(staffCount);
  const lineItems = [{ price: BASE_PRICE_ID, quantity: 1 }];
  if (extra > 0) lineItems.push({ price: EXTRA_PRICE_ID, quantity: extra });
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

export function applyStripeEvent(event) {
  if (!event || event.livemode === true) return { ok: false, reason: "live-mode" };
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
      patch: { plan: "paid", billing: billingPatch("active", { customer: object.customer, subscription: object.subscription }) },
    };
  }
  if (event.type === "invoice.payment_failed") {
    return { ok: true, companyId, patch: { plan: "paid", billing: billingPatch("past_due", { customer: object.customer, subscription: object.subscription }) } };
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

export function staffItemChange({ subscription, staffCount }) {
  const quantity = extraStaffQuantity(staffCount);
  const items = (subscription && subscription.items && subscription.items.data) || [];
  const extra = items.find(item => item.price && (item.price.id === EXTRA_PRICE_ID || item.price.lookup_key === EXTRA_LOOKUP));
  if (!extra && quantity === 0) return { action: "none", quantity };
  if (!extra) return { action: "create", price: EXTRA_PRICE_ID, quantity, proration_behavior: "create_prorations" };
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

export async function syncStaffQuantity({ companyId, company, staffCount, stripe }) {
  const skip = billingSkipped(company, companyId);
  if (skip) return { ok: true, skipped: skip };
  const billing = company.billing || {};
  if (billing.provider !== "stripe" || !billing.stripeSubscriptionId) return { ok: true, skipped: "no-subscription" };
  if (billing.status !== "active" && billing.status !== "past_due") return { ok: true, skipped: "not-billable" };
  const subscription = await stripe.subscriptions.retrieve(billing.stripeSubscriptionId);
  const change = staffItemChange({ subscription, staffCount });
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

export async function handleCheckoutCall({ uid, companyId, origin, getContext, stripe }) {
  origin = billingOrigin(origin);
  const ctx = await getContext(uid, companyId);
  const authz = authorizeCompanyAdmin({ uid, profile: ctx.profile, company: ctx.company, companyId });
  if (!authz.ok) return authz;
  const built = checkoutParams({
    companyId,
    company: ctx.company,
    staffCount: ctx.staffCount,
    successUrl: `${origin}/?billing=success`,
    cancelUrl: `${origin}/?billing=cancel`,
  });
  if (!built.ok) return built;
  const session = await stripe.checkout.sessions.create(built.params);
  return { ok: true, url: session.url };
}

export async function handlePortalCall({ uid, companyId, origin, getContext, stripe }) {
  origin = billingOrigin(origin);
  const ctx = await getContext(uid, companyId);
  const authz = authorizeCompanyAdmin({ uid, profile: ctx.profile, company: ctx.company, companyId });
  if (!authz.ok) return authz;
  const built = portalParams({ company: ctx.company, companyId, returnUrl: `${origin}/` });
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
  const v1 = parts.v1;
  if (!timestamp || !v1 || !secret) throw new Error("invalid-signature");
  const age = Math.abs(now - Number(timestamp) * 1000);
  if (!Number.isFinite(age) || age > 5 * 60 * 1000) throw new Error("invalid-signature");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${text}`).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(String(v1));
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error("invalid-signature");
  const event = JSON.parse(text);
  if (!event || typeof event !== "object" || typeof event.type !== "string") throw new Error("invalid-signature");
  return event;
}

export async function handleStripeWebhook({ rawBody, signature, secret, loadCompany, saveBilling, now }) {
  let event;
  try {
    event = constructStripeEvent(rawBody, signature, secret, now);
  } catch {
    return { status: 400, body: { error: "invalid-signature" } };
  }
  const decision = applyStripeEvent(event);
  if (!decision.ok) return { status: 200, body: { received: true, skipped: decision.reason } };
  const company = await loadCompany(decision.companyId);
  const skip = billingSkipped(company, decision.companyId);
  if (skip) return { status: 200, body: { received: true, skipped: skip } };
  await saveBilling(decision.companyId, decision.patch);
  return { status: 200, body: { received: true, companyId: decision.companyId } };
}
