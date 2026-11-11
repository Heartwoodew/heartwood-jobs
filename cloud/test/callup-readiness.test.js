// CallUp outside-trial readiness: app address, Resend invites, Stripe live switch, per-company settings.
// Fake data only. Nothing here opens a socket.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  appOriginFor, inviteLink, inviteEmailConfig, planInviteDelivery, queueInviteEmail, sendViaResend, resendPayload,
  inviteHoldReason, HEARTWOOD_APP_ORIGIN, CALLUP_APP_ORIGIN, CALLUP_FALLBACK_ORIGIN, RESEND_ENDPOINT,
} from "../../app/features/staff-invites.js";
import {
  billingOrigin, stripeMode, stripePrices, assertKeyForMode, applyStripeEvent, BASE_PRICE_ID, EXTRA_PRICE_ID,
} from "../functions/billing/stripe-billing.js";
import { supervisorsPath } from "../../app/features/company.js";
import { quoteRatesPath } from "../../app/features/quotes.js";

const TOKEN = "b".repeat(43);
const bravoInvite = (email = "callup932+staff@gmail.com") => ({ role: "operator", name: "Test Staff", email, token: TOKEN, companyId: "bravo", tenantId: "bravo" });
const hwInvite = { role: "operator", name: "Sam", email: "sam@example.com", token: TOKEN };

test("app address: Heartwood stays on jobs.heartwoodew.com, others use the CallUp address", () => {
  assert.equal(appOriginFor("heartwood"), HEARTWOOD_APP_ORIGIN);
  assert.equal(appOriginFor("heartwood", CALLUP_APP_ORIGIN), HEARTWOOD_APP_ORIGIN);
  assert.equal(appOriginFor("bravo", "", false), CALLUP_FALLBACK_ORIGIN);
  assert.equal(appOriginFor("bravo", "", true), CALLUP_APP_ORIGIN);
  assert.equal(appOriginFor("bravo", CALLUP_APP_ORIGIN, false), CALLUP_APP_ORIGIN);
  assert.equal(appOriginFor("bravo", "https://evil.example", false), CALLUP_FALLBACK_ORIGIN);
  assert.equal(inviteLink(TOKEN), `${HEARTWOOD_APP_ORIGIN}/app?invite=${TOKEN}`);
  assert.equal(billingOrigin("https://evil.example", "bravo", false), CALLUP_FALLBACK_ORIGIN);
  assert.equal(billingOrigin(CALLUP_APP_ORIGIN, "bravo"), CALLUP_APP_ORIGIN);
  assert.equal(billingOrigin(HEARTWOOD_APP_ORIGIN, "heartwood"), HEARTWOOD_APP_ORIGIN);
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v\d+/);
});

test("Resend invites: off by default, Heartwood held, test recipients only when allow-listed", async () => {
  const off = planInviteDelivery(bravoInvite(), inviteEmailConfig({}));
  assert.equal(off.reason, "email-disabled");
  assert.equal(off.doc.delivery, "held");
  const on = inviteEmailConfig({ INVITE_EMAIL_ENABLED: "true", INVITE_EMAIL_ALLOW_TO: "callup932+" });
  assert.equal(on.provider, "resend");
  assert.equal(inviteHoldReason(hwInvite, on), "heartwood-held");
  assert.equal(planInviteDelivery(hwInvite, on).doc.delivery, "held");
  assert.equal(inviteHoldReason(bravoInvite("someone@example.com"), on), "recipient-not-allowed");
  const plan = planInviteDelivery(bravoInvite(), { ...on, companyName: "Bravo Test", companyEmail: "callup932+test@gmail.com" });
  assert.equal(plan.reason, "send-via-resend");
  assert.equal(plan.resend.from, "CallUp <noreply@callupapp.com.au>");
  assert.deepEqual(plan.resend.to, ["callup932+staff@gmail.com"]);
  assert.equal(plan.resend.reply_to, "callup932+test@gmail.com");
  assert.match(plan.resend.text, /app\.callupapp\.com\.au\/app\?invite=/);
  assert.doesNotMatch(plan.resend.text + plan.resend.subject, /Heartwood/);

  // Never sends without allowLiveMail, and never under the test runner with it.
  let calls = 0;
  const sendResend = async () => { calls++; return { ok: true, id: "x" }; };
  const env = { INVITE_EMAIL_ENABLED: "true" };
  const r = await queueInviteEmail(bravoInvite(), { env, sendResend, company: { name: "Bravo Test" } });
  assert.equal(r.reason, "live-mail-not-allowed");
  await assert.rejects(() => queueInviteEmail(bravoInvite(), { env: { ...env, NODE_TEST_CONTEXT: "child" }, allowLiveMail: true, sendResend }), /refusing/);
  assert.equal(calls, 0);

  // sendViaResend with a fake fetch.
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => ({ id: "em_1" }) }; };
  assert.equal((await sendViaResend({ apiKey: "", payload: plan.resend, fetchImpl })).reason, "no-api-key");
  const sent = await sendViaResend({ apiKey: "re_fake_key", payload: resendPayload({ from: "a", to: "b", subject: "c", text: "d" }), fetchImpl, idempotencyKey: "k1" });
  assert.deepEqual(sent, { ok: true, id: "em_1" });
  assert.equal(seen[0].url, RESEND_ENDPOINT);
  assert.equal(seen[0].init.headers["Idempotency-Key"], "k1");
  const bad = await sendViaResend({ apiKey: "re_fake_key", payload: {}, fetchImpl: async () => ({ ok: false, status: 422, json: async () => ({ message: "bad" }) }) });
  assert.equal(bad.reason, "resend-422");
});

test("inviteEmailWorker always declares RESEND_API_KEY; sending stays behind the runtime flag", () => {
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.match(index, /export const inviteEmailWorker = onDocumentWritten\(/);
  assert.match(index, /secrets: \[RESEND_API_KEY\]/);
  assert.doesNotMatch(index, /INVITE_MAIL_ON \? \{ secrets: \[RESEND_API_KEY\] \}/);
  assert.match(index, /allowLiveMail: process\.env\.INVITE_EMAIL_ENABLED === "true"/);
});

test("Stripe stays in test mode until STRIPE_MODE=live and live prices exist", () => {
  assert.equal(stripeMode({}), "test");
  assert.equal(stripeMode({ STRIPE_MODE: "live" }), "live");
  assert.deepEqual(stripePrices("test"), { base: BASE_PRICE_ID, extra: EXTRA_PRICE_ID });
  assert.throws(() => stripePrices("live", {}), /stripe-live-prices-missing/);
  assert.throws(() => stripePrices("live", { base: BASE_PRICE_ID, extra: EXTRA_PRICE_ID }), /stripe-live-prices-missing/);
  assert.deepEqual(stripePrices("live", { base: "price_liveBase1", extra: "price_liveExtra1" }), { base: "price_liveBase1", extra: "price_liveExtra1" });
  assert.throws(() => assertKeyForMode("sk_live_" + "x".repeat(20), "test"));
  assert.throws(() => assertKeyForMode("sk_test_" + "x".repeat(20), "live"));
  assert.doesNotThrow(() => assertKeyForMode("sk_live_" + "x".repeat(20), "live"));
  const ev = live => ({ id: "evt_1", type: "invoice.paid", livemode: live, data: { object: { metadata: { companyId: "bravo" } } } });
  assert.equal(applyStripeEvent(ev(true), "test").reason, "live-mode");
  assert.equal(applyStripeEvent(ev(false), "live").reason, "test-mode");
});

test("quote rates and supervisors: Heartwood keeps meta/, others get their own companyMeta doc", () => {
  assert.deepEqual(quoteRatesPath("heartwood"), ["meta", "quoteRates"]);
  assert.deepEqual(quoteRatesPath(""), ["meta", "quoteRates"]);
  assert.deepEqual(quoteRatesPath("bravo"), ["companyMeta", "bravo_quoteRates"]);
  assert.deepEqual(supervisorsPath("heartwood"), ["meta", "supervisors"]);
  assert.deepEqual(supervisorsPath("bravo"), ["companyMeta", "bravo_supervisors"]);
});

test("Find PO, builder inbox import and Heartwood-only text are gated in the app", () => {
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.match(app, /const canFindPo = \(\) => myCompanyId\(\) === "heartwood"/);
  assert.match(app, /canImportInbox\(me\) && myCompanyId\(\) === "heartwood"/);
  assert.doesNotMatch(app, /alex@heartwoodew\.com[^\n]*[Rr]eimburse|[Rr]eimburse[^\n]*alex@heartwoodew\.com/);
});
