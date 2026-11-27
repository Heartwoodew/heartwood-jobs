// Referral bonus. No network and no Stripe account. Firestore rules are exercised in referral.emulator.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { companySettingsHtml, pausedStaffHtml, referralBoxHtml, signupFormHtml } from "../../app/features/company-ui.js";
import {
  REFERRAL_ALPHABET as CLIENT_ALPHABET, REFERRAL_CODE_LENGTH as CLIENT_LENGTH, captureReferralParam, clearStoredReferral,
  normalizeReferralCode as clientNormalize, referralGiveUp, referralLink as clientLink, storedReferralCode,
} from "../../app/features/referral.js";
import { checkoutParams, handleStripeWebhook, paidInvoiceSignal } from "../functions/billing/stripe-billing.js";
import {
  REFERRAL_ALPHABET, REFERRAL_CODE_LENGTH, REFERRAL_COUPON_ID, allocateCompanyCode, applyReferrerRewards,
  attachSignupReferral, awardPaidReferral, couponMatchesReferral, discountApplyPlan, earnReferral,
  ensureReferralCoupon, handleEnsureReferralCode, handleReferralWebhookEvent, markCheckoutReward,
  newReferralCode, oldestEarned, planNewCode, referralCodeOk, referralCouponCreateParams, referralLink,
  referrerCanTakeCoupon, subscriptionDiscountIds, tallyReferrals,
} from "../functions/billing/referrals.js";

const NOW = "2026-11-16T04:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const CODE = "abcdefghjkmnpqrstu23";
const admin = { role: "admin", companyId: "acme" };

function memoryStore(seed = {}) {
  const referrals = new Map(Object.entries(seed.referrals || {}));
  const companies = new Map(Object.entries(seed.companies || {}));
  const codes = new Map(Object.entries(seed.codes || {}));
  const audits = [];
  function writeStatus(id, from, referral) {
    const cur = referrals.get(id);
    if (!cur) return { ok: false, reason: "no-referral" };
    if (cur.status === "applied") return { ok: true, changed: false, referral: cur };
    if (cur.status === referral.status && cur.applyStatus === referral.applyStatus && cur.invoiceId === referral.invoiceId) {
      return { ok: true, changed: false, referral: cur };
    }
    if (!from.includes(cur.status)) return { ok: true, changed: false, referral: cur };
    const saved = { ...cur, ...referral };
    referrals.set(id, saved);
    return { ok: true, changed: true, referral: saved };
  }
  return {
    audits,
    referrals,
    companies,
    async getReferral(id) { return referrals.get(id) || null; },
    async getCompany(id) { return companies.get(id) || null; },
    async getCode(code) { return codes.get(code) || null; },
    async listByReferrer(companyId) { return [...referrals.values()].filter(row => row.referrerCompanyId === companyId); },
    async countsFor(companyId) { return tallyReferrals([...referrals.values()], companyId); },
    async putCode({ companyId, code, uid }) {
      const company = companies.get(companyId);
      if (!company) return { ok: false, reason: "missing-company" };
      if (referralCodeOk(company.referralCode)) return { ok: true, code: company.referralCode, created: false };
      if (codes.has(code)) return { ok: false, reason: "code-taken" };
      company.referralCode = code;
      codes.set(code, { companyId, createdBy: uid });
      return { ok: true, code, created: true };
    },
    async insertPending({ companyId, referredBy, referral }) {
      const company = companies.get(companyId);
      if (!company) return { ok: false, reason: "missing-company" };
      if ((company.referredBy && company.referredBy.companyId) || referrals.has(companyId)) return { ok: false, reason: "after-creation" };
      const lookup = codes.get(referredBy.code);
      if (!lookup || !lookup.companyId) return { ok: false, reason: "unknown-code" };
      if (lookup.companyId === companyId) return { ok: false, reason: "self-referral" };
      if (lookup.companyId !== referredBy.companyId) return { ok: false, reason: "unknown-code" };
      company.referredBy = referredBy;
      referrals.set(companyId, { ...referral });
      return { ok: true };
    },
    async setEarned(id, referral) { return writeStatus(id, ["pending"], referral); },
    async setApplied(id, referral) { return writeStatus(id, ["earned"], { ...referral, status: "applied", applyStatus: "applied" }); },
    async setWaiting(id, referral) { return writeStatus(id, ["earned", "pending"], referral); },
    async audit(entry) { audits.push(entry); },
  };
}

function fakeStripe() {
  const couponRecords = new Map();
  const subs = new Map();
  const updates = [];
  return {
    updates,
    couponRecords,
    subs,
    seed(id, data) { subs.set(id, { id, discounts: [], ...data }); },
    coupons: {
      async retrieve(id) {
        if (!couponRecords.has(id)) { const err = new Error("missing"); err.code = "resource_missing"; throw err; }
        return couponRecords.get(id);
      },
      async create(params) {
        if (couponRecords.has(params.id)) { const err = new Error("exists"); err.code = "resource_already_exists"; throw err; }
        const coupon = { id: params.id, valid: true, ...params };
        couponRecords.set(params.id, coupon);
        return coupon;
      },
    },
    subscriptions: {
      async retrieve(id) { return subs.get(id) || { id, discounts: [] }; },
      async update(id, params) {
        updates.push({ id, params });
        const next = { id, discounts: (params.discounts || []).map(row => ({ id: "di_1", coupon: { id: row.coupon } })) };
        subs.set(id, next);
        return next;
      },
    },
  };
}

function company(extra = {}) {
  return {
    name: "Acme Civil", ownerUid: "owner", origin: "signup", isTest: false, plan: "trial", status: "active",
    signedUpAt: new Date(NOW_MS - 60_000).toISOString(),
    billing: { provider: null, status: "not-configured", stripeCustomerId: null, stripeSubscriptionId: null },
    ...extra,
  };
}

function storage(initial) {
  const data = { ...initial };
  return {
    getItem: key => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: key => { delete data[key]; },
    data,
  };
}

test("referral codes are unguessable, stable, and shared as a CallUp sign-up link", () => {
  assert.equal(CLIENT_LENGTH, REFERRAL_CODE_LENGTH);
  assert.equal(CLIENT_ALPHABET, REFERRAL_ALPHABET);
  assert.equal(REFERRAL_ALPHABET.length, 31);
  const seq = fill => { let n = 0; return bytes => { for (let i = 0; i < bytes.length; i++) bytes[i] = (n++ * 17) % 256; return fill; }; };
  const a = newReferralCode(seq());
  const b = newReferralCode(seq());
  assert.equal(a, b);
  assert.equal(a.length, 20);
  assert.equal(referralCodeOk(a), true);
  assert.equal(clientNormalize(a.toUpperCase()), a);
  assert.equal(referralCodeOk("short"), false);
  assert.equal(referralCodeOk(a + "0"), false);
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(newReferralCode(bytes => crypto.getRandomValues(bytes)));
  assert.equal(seen.size, 20);
  const taken = planNewCode("", () => true, seq());
  assert.equal(taken.ok, false);
  assert.equal(taken.reason, "code-collision");
  const fresh = planNewCode(a, () => true);
  assert.equal(fresh.created, false);
  assert.equal(fresh.code, a);
  assert.equal(referralLink(a), `https://app.callupapp.com.au/app/?ref=${a}`);
  assert.equal(clientLink(a, "https://callupapp.web.app"), `https://callupapp.web.app/app/?ref=${a}`);
  const coupon = referralCouponCreateParams();
  assert.equal(coupon.id, REFERRAL_COUPON_ID);
  assert.equal(coupon.percent_off, 100);
  assert.equal(coupon.duration, "repeating");
  assert.equal(coupon.duration_in_months, 2);
  assert.equal(couponMatchesReferral(coupon), true);
});

test("a code is minted lazily once and counted for the company admin only", async () => {
  const store = memoryStore({ companies: { acme: company() } });
  const first = await allocateCompanyCode({ store, companyId: "acme", uid: "owner", random: bytes => crypto.getRandomValues(bytes) });
  assert.equal(first.created, true);
  assert.equal(referralCodeOk(first.code), true);
  const again = await allocateCompanyCode({ store, companyId: "acme", uid: "owner" });
  assert.equal(again.created, false);
  assert.equal(again.code, first.code);
  assert.equal((await store.getCode(first.code)).companyId, "acme");
  const crew = await handleEnsureReferralCode({
    uid: "op", companyId: "acme", profile: { role: "operator", companyId: "acme" }, company: company(),
    existingCode: first.code, origin: "https://app.callupapp.com.au",
  });
  assert.equal(crew.reason, "company-admin");
  store.referrals.set("bravo", { status: "pending", referrerCompanyId: "acme", referredCompanyId: "bravo", code: first.code });
  store.referrals.set("charlie", { status: "applied", referrerCompanyId: "acme", referredCompanyId: "charlie", code: first.code });
  const shown = await handleEnsureReferralCode({
    uid: "owner", companyId: "acme", profile: admin, company: company({ referralCode: first.code }),
    existingCode: first.code, origin: "https://app.callupapp.com.au",
    loadCounts: () => store.countsFor("acme"),
    allocate: async () => { throw new Error("should reuse"); },
  });
  assert.equal(shown.ok, true);
  assert.equal(shown.pending, 1);
  assert.equal(shown.earned, 1);
  assert.equal(shown.link, `https://app.callupapp.com.au/app/?ref=${first.code}`);
});

test("sign-up keeps ?ref= and the server stores referredBy only for a real new company", async () => {
  const box = storage();
  assert.equal(captureReferralParam("https://app.callupapp.com.au/app/?ref=" + CODE, box), CODE);
  assert.equal(storedReferralCode(box), CODE);
  captureReferralParam("?ref=nope", box);
  assert.equal(storedReferralCode(box), CODE);
  const store = memoryStore({
    companies: {
      acme: company({ referralCode: CODE }),
      bravo: company({ ownerUid: "new", signedUpAt: new Date(NOW_MS - 5_000).toISOString() }),
    },
    codes: { [CODE]: { companyId: "acme" } },
  });
  const saved = await attachSignupReferral({ uid: "new", companyId: "bravo", code: CODE.toUpperCase(), now: NOW_MS, store });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.referredBy, { companyId: "acme", code: CODE });
  assert.equal(store.referrals.get("bravo").status, "pending");
  assert.equal(store.audits[0].action, "captured");
  assert.equal(store.audits[0].toStatus, "pending");
  const late = await attachSignupReferral({ uid: "new", companyId: "bravo", code: CODE, now: NOW_MS, store });
  assert.equal(late.reason, "after-creation");
  clearStoredReferral(box);
  assert.equal(storedReferralCode(box), "");
  assert.equal(referralGiveUp("unknown-code"), true);
  assert.equal(referralGiveUp("Billing is not available."), false);
});

test("self-referral, an unknown code, and a referral after creation are refused", async () => {
  const store = memoryStore({
    companies: {
      acme: company({ referralCode: CODE, ownerUid: "owner" }),
      old: company({ ownerUid: "late", signedUpAt: new Date(NOW_MS - 2 * 60 * 60 * 1000).toISOString() }),
    },
    codes: { [CODE]: { companyId: "acme" } },
  });
  const self = await attachSignupReferral({ uid: "owner", companyId: "acme", code: CODE, now: NOW_MS, store });
  assert.equal(self.reason, "self-referral");
  store.companies.set("fresh", company({ ownerUid: "new" }));
  const unknown = await attachSignupReferral({
    uid: "new", companyId: "fresh", code: "zzzzzzzzzzzzzzzzzzzz", now: NOW_MS, store,
  });
  assert.equal(unknown.reason, "unknown-code");
  const aged = await attachSignupReferral({ uid: "late", companyId: "old", code: CODE, now: NOW_MS, store });
  assert.equal(aged.reason, "after-creation");
  assert.equal(store.referrals.size, 0);
});

test("the first paid invoice earns once, a zero invoice does not, and a second delivery does not apply twice", async () => {
  const code = CODE;
  const pending = { status: "pending", referredCompanyId: "bravo", referrerCompanyId: "acme", code };
  const store = memoryStore({
    referrals: { bravo: { ...pending } },
    companies: {
      acme: company({ billing: { status: "active", stripeCustomerId: "cus_old", stripeSubscriptionId: "sub_20" } }),
      bravo: company(),
    },
  });
  const stripe = fakeStripe();
  stripe.seed("sub_20", { discounts: [] });
  const zero = await awardPaidReferral({ referredCompanyId: "bravo", invoiceId: "in_0", amountPaid: 0, now: NOW, store, stripe });
  assert.equal(zero.skipped, "zero-invoice");
  assert.equal(store.referrals.get("bravo").status, "pending");
  assert.equal(stripe.updates.length, 0);
  const first = await awardPaidReferral({ referredCompanyId: "bravo", invoiceId: "in_1", amountPaid: 2000, now: NOW, store, stripe });
  assert.equal(first.applied, true);
  assert.equal(store.referrals.get("bravo").status, "applied");
  assert.equal(stripe.updates.length, 1);
  assert.equal(stripe.updates[0].id, "sub_20");
  assert.deepEqual(stripe.updates[0].params.discounts, [{ coupon: REFERRAL_COUPON_ID }]);
  assert.equal(stripe.updates[0].params.proration_behavior, "none");
  assert.equal(couponMatchesReferral(stripe.couponRecords.get(REFERRAL_COUPON_ID)), true);
  const again = await awardPaidReferral({ referredCompanyId: "bravo", invoiceId: "in_1", amountPaid: 2000, now: NOW, store, stripe });
  assert.equal(again.skipped, "already-applied");
  assert.equal(stripe.updates.length, 1);
  assert.ok(store.audits.some(row => row.action === "earned"));
  assert.ok(store.audits.some(row => row.action === "applied"));
  assert.equal(referrerCanTakeCoupon(store.companies.get("acme")).ok, true);
});

test("a referrer still on trial keeps the reward pending, then it is applied when they subscribe", async () => {
  const pending = { status: "pending", referredCompanyId: "bravo", referrerCompanyId: "acme", code: CODE };
  const store = memoryStore({
    referrals: { bravo: { ...pending } },
    companies: { acme: company(), bravo: company() },
  });
  const stripe = fakeStripe();
  const earned = await awardPaidReferral({ referredCompanyId: "bravo", invoiceId: "in_9", amountPaid: 5000, now: NOW, store, stripe });
  assert.equal(earned.pending, true);
  assert.equal(earned.reason, "no-subscription");
  assert.equal(store.referrals.get("bravo").status, "earned");
  assert.equal(store.referrals.get("bravo").applyStatus, "pending");
  assert.equal(stripe.updates.length, 0);
  const held = await applyReferrerRewards({ referrerCompanyId: "acme", now: NOW, store, stripe });
  assert.equal(held.pending, true);
  assert.equal(stripe.updates.length, 0);
  store.companies.set("acme", company({
    billing: { status: "active", stripeCustomerId: "cus_20", stripeSubscriptionId: "sub_grandfather" },
  }));
  const applied = await applyReferrerRewards({ referrerCompanyId: "acme", now: NOW, store, stripe });
  assert.equal(applied.applied, true);
  assert.equal(store.referrals.get("bravo").status, "applied");
  assert.equal(stripe.updates[0].id, "sub_grandfather");
  const checkout = checkoutParams({
    companyId: "acme", company: company(), staffCount: 1, successUrl: "https://app.callupapp.com.au/app/?billing=success",
    cancelUrl: "https://app.callupapp.com.au/app/?billing=cancel", referralCoupon: REFERRAL_COUPON_ID, referralFor: "bravo",
  });
  assert.deepEqual(checkout.params.discounts, [{ coupon: REFERRAL_COUPON_ID }]);
  assert.equal(checkout.params.metadata.referralFor, "bravo");
  store.referrals.set("bravo", { ...store.referrals.get("bravo"), status: "earned", applyStatus: "pending" });
  const marked = await markCheckoutReward({ referredCompanyId: "bravo", subscriptionId: "sub_new", now: NOW, store });
  assert.equal(marked.applied, true);
  assert.equal(store.referrals.get("bravo").status, "applied");
});

test("an existing discount is queued instead of replaced, and a $0 webhook does not earn", async () => {
  const older = { status: "earned", applyStatus: "pending", earnedAt: "2026-11-01T00:00:00.000Z", referredCompanyId: "bravo", referrerCompanyId: "acme", code: CODE };
  const newer = { status: "earned", applyStatus: "pending", earnedAt: "2026-11-02T00:00:00.000Z", referredCompanyId: "charlie", referrerCompanyId: "acme", code: CODE };
  assert.equal(oldestEarned([newer, older]).referredCompanyId, "bravo");
  const store = memoryStore({
    referrals: { bravo: { ...older }, charlie: { ...newer } },
    companies: { acme: company({ billing: { status: "active", stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1" } }) },
  });
  const stripe = fakeStripe();
  stripe.seed("sub_1", { discounts: [{ id: "di_keep", coupon: { id: "other_coupon" } }] });
  assert.deepEqual(subscriptionDiscountIds(stripe.subs.get("sub_1")), ["other_coupon"]);
  assert.equal(discountApplyPlan(["other_coupon"]).action, "queue");
  const queued = await applyReferrerRewards({ referrerCompanyId: "acme", now: NOW, store, stripe });
  assert.equal(queued.queued, true);
  assert.equal(queued.reason, "existing-discount");
  assert.equal(store.referrals.get("bravo").applyStatus, "queued");
  assert.equal(store.referrals.get("charlie").applyStatus, "pending");
  assert.equal(stripe.updates.length, 0);
  const signal = paidInvoiceSignal({ type: "invoice.paid", data: { object: { id: "in_0", amount_paid: 0, metadata: { companyId: "bravo" } } } });
  assert.equal(signal.amountPaid, 0);
  const paid = paidInvoiceSignal({ type: "invoice.paid", data: { object: { id: "in_2", amount_paid: 5500, metadata: { companyId: "bravo" } } } });
  assert.equal(paid.amountPaid, 5500);
  const event = { id: "evt_z", type: "invoice.paid", created: 1_800_000_000, livemode: false, data: { object: { id: "in_0", amount_paid: 0, customer: "cus_b", subscription: "sub_b", metadata: { companyId: "bravo" } } } };
  const calls = [];
  const text = JSON.stringify(event);
  const secret = "whsec_referral_test";
  const header = `t=1800000000,v1=${createHmac("sha256", secret).update(`1800000000.${text}`).digest("hex")}`;
  const out = await handleStripeWebhook({
    rawBody: text, signature: header, secret, now: 1_800_000_000 * 1000,
    loadCompany: async () => company(),
    saveBilling: async () => ({}),
    onReferral: async payload => { calls.push(payload.paid); },
  });
  assert.equal(out.status, 200);
  assert.equal(calls[0].amountPaid, 0);
  const ignored = earnReferral(older, { invoiceId: "in_0", amountPaid: 0, now: NOW });
  assert.equal(ignored.reason, "zero-invoice");
  const results = await handleReferralWebhookEvent({
    event, paid: calls[0], companyId: "bravo", now: NOW, store, stripe,
  });
  assert.equal(results.award.skipped, "zero-invoice");
  assert.equal(store.referrals.get("bravo").status, "earned");
});

test("billing settings show the referral to an admin and hide prices from crew", () => {
  const org = {
    companyId: "acme", name: "Acme", legalName: "Acme Civil", abn: "1", signoff: "Acme",
    address: "1 St", phone: "", email: "office@acme.test", accountsEmail: "accounts@acme.test", hubdocAddress: "",
    plan: "trial", billing: { status: "not-configured" },
  };
  const adminHtml = companySettingsHtml(org, { canEdit: true });
  assert.match(adminHtml, /Refer another business\. When they start paying, you get 2 months free\./);
  assert.match(adminHtml, /id="referralbox"/);
  assert.match(adminHtml, /A\$50 a month/);
  const ready = referralBoxHtml({ code: CODE, link: referralLink(CODE), pending: 2, earned: 1 });
  assert.match(ready, /id="refcopy"/);
  assert.match(ready, new RegExp(CODE));
  assert.match(ready, /2 pending · 1 earned/);
  assert.match(ready, /https:\/\/app\.callupapp\.com\.au\/app\/\?ref=/);
  const crew = companySettingsHtml(org, { canEdit: false });
  assert.doesNotMatch(crew, /referralbox/);
  assert.doesNotMatch(crew, /2 months free/);
  assert.doesNotMatch(crew, /A\$20|A\$50/);
  const staff = pausedStaffHtml();
  assert.doesNotMatch(staff, /A\$20|A\$50/);
  assert.doesNotMatch(staff, /referral/);
  assert.match(signupFormHtml(), /14-day trial/);
  assert.doesNotMatch(signupFormHtml(), /2 months free/);
  const rules = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  for (const text of [rules, emu]) {
    assert.match(text, /function referralFieldsSame\(\)/);
    assert.match(text, /function referralClientFieldsAbsent\(data\)/);
    assert.match(text, /match \/referralCodes\/\{code\}/);
    assert.match(text, /match \/referrals\/\{referredCompanyId\}/);
    assert.match(text, /match \/referralAudits\/\{id\}/);
    assert.match(text, /allow read, write: if false/);
  }
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.match(index, /export const ensureReferralCode = onCall/);
  assert.match(index, /export const attachSignupReferral = onCall/);
  assert.match(index, /handleReferralWebhookEvent/);
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v164/);
  assert.match(sw, /features\/referral\.js/);
});
