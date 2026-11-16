import { authorizeCompanyAdmin } from "./stripe-billing.js";

// CallUp referral bonus (Alex, 16 Nov 2026).
// The referrer gets 2 months free once the referred company pays a real invoice.
// The referred company gets the normal 14-day trial and nothing else.
//
// Discount choice: queue, do not stack.
// One reusable Stripe coupon (100% off, repeating, 2 months) is created by id if it is missing.
// Stripe will not extend that coupon while it is already on the subscription, and replacing
// a different discount would take away something the customer already has. A reward that
// cannot be applied yet stays earned, with applyStatus "pending" (no subscription yet:
// still on the app trial, or paused) or "queued" (the subscription already has a discount).
// The oldest earned reward is applied when they subscribe (Checkout discounts) or when a
// later subscription event finds no discount. Each referred company pays out once.
// Grandfathered A$20 subscriptions are eligible: the coupon is percent-off and does not
// look at the price id. Test and live use the same coupon id in their own Stripe account.
// No new secret is required.

export const REFERRAL_COUPON_ID = "callup_referral_2_months";
export const REFERRAL_MONTHS = 2;
export const REFERRAL_CODE_LENGTH = 20;
export const REFERRAL_ATTACH_WINDOW_MS = 30 * 60 * 1000;
export const REFERRAL_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_RE = new RegExp(`^[${REFERRAL_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

export function referralCouponCreateParams(id = REFERRAL_COUPON_ID) {
  return {
    id,
    percent_off: 100,
    duration: "repeating",
    duration_in_months: REFERRAL_MONTHS,
    name: "CallUp referral: 2 months free",
    metadata: { kind: "referral", months: String(REFERRAL_MONTHS) },
  };
}

export function couponMatchesReferral(coupon, id = REFERRAL_COUPON_ID) {
  if (!coupon || coupon.id !== id || coupon.valid === false) return false;
  return coupon.percent_off === 100 && coupon.duration === "repeating" && Number(coupon.duration_in_months) === REFERRAL_MONTHS;
}

export function newReferralCode(fill) {
  const bytes = new Uint8Array(REFERRAL_CODE_LENGTH);
  if (typeof fill === "function") fill(bytes);
  else if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else throw new Error("referral-random-unavailable");
  let out = "";
  for (const b of bytes) out += REFERRAL_ALPHABET[b % REFERRAL_ALPHABET.length];
  return out;
}

export function referralCodeOk(code) {
  return typeof code === "string" && CODE_RE.test(code);
}

export function normalizeReferralCode(value) {
  const code = String(value || "").trim().toLowerCase();
  return referralCodeOk(code) ? code : "";
}

// Hosting uses a trailing slash (firebase.hosting.json trailingSlash: true).
export function referralLink(code, origin = "https://app.callupapp.com.au") {
  const base = String(origin || "https://app.callupapp.com.au").replace(/\/$/, "");
  return `${base}/app/?ref=${encodeURIComponent(normalizeReferralCode(code) || String(code || ""))}`;
}

export function tallyReferrals(rows, referrerCompanyId) {
  let pending = 0;
  let earned = 0;
  for (const row of rows || []) {
    if (!row || row.referrerCompanyId !== referrerCompanyId) continue;
    if (row.status === "pending") pending += 1;
    else if (row.status === "earned" || row.status === "applied") earned += 1;
  }
  return { pending, earned };
}

function millisOf(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (typeof value._seconds === "number") return value._seconds * 1000;
  const n = new Date(value).getTime();
  return Number.isNaN(n) ? null : n;
}

export function attachDecision({ company, companyId, code, lookup, uid, now = Date.now() }) {
  const normalized = normalizeReferralCode(code);
  if (!uid) return { ok: false, code: "unauthenticated", reason: "sign-in" };
  if (!normalized) return { ok: false, code: "invalid-argument", reason: "unknown-code" };
  if (!company) return { ok: false, code: "not-found", reason: "missing-company" };
  if (company.ownerUid !== uid) return { ok: false, code: "permission-denied", reason: "not-owner" };
  if (company.origin !== "signup" || company.isTest === true || company.plan === "friend") {
    return { ok: false, code: "failed-precondition", reason: "not-signup" };
  }
  if (company.referredBy && company.referredBy.companyId) {
    return { ok: false, code: "failed-precondition", reason: "after-creation" };
  }
  const signed = millisOf(company.signedUpAt);
  const at = now instanceof Date ? now.getTime() : Number(now);
  if (signed == null || at - signed > REFERRAL_ATTACH_WINDOW_MS || signed - at > 5 * 60 * 1000) {
    return { ok: false, code: "failed-precondition", reason: "after-creation" };
  }
  if (!lookup || lookup.companyId == null || lookup.companyId === "") {
    return { ok: false, code: "invalid-argument", reason: "unknown-code" };
  }
  if (lookup.companyId === companyId) return { ok: false, code: "failed-precondition", reason: "self-referral" };
  const referredBy = { companyId: lookup.companyId, code: normalized };
  return {
    ok: true,
    referredBy,
    referral: {
      status: "pending",
      referredCompanyId: companyId,
      referrerCompanyId: lookup.companyId,
      code: normalized,
      createdAt: new Date(at).toISOString(),
    },
  };
}

export function planNewCode(existing, isTaken, random) {
  if (referralCodeOk(existing)) return { ok: true, code: existing, created: false };
  const taken = typeof isTaken === "function" ? isTaken : () => false;
  for (let i = 0; i < 5; i++) {
    const code = newReferralCode(random);
    if (!taken(code)) return { ok: true, code, created: true };
  }
  return { ok: false, reason: "code-collision" };
}

// A paying subscription, including a trialing Checkout subscription and a grandfathered A$20 plan.
// The plain 14-day app trial has no Stripe subscription id, so the reward waits.
export function referrerCanTakeCoupon(company) {
  const billing = (company && company.billing) || {};
  const sub = String(billing.stripeSubscriptionId || "");
  const status = billing.status;
  if (sub && (status === "active" || status === "past_due" || status === "trialing")) {
    return { ok: true, subscriptionId: sub };
  }
  return { ok: false, reason: "no-subscription" };
}

export function subscriptionDiscountIds(subscription) {
  if (!subscription) return [];
  const raw = Array.isArray(subscription.discounts) ? subscription.discounts : [];
  const ids = [];
  for (const entry of raw) {
    if (!entry) continue;
    if (typeof entry === "string") ids.push(entry);
    else {
      const coupon = entry.coupon;
      const couponId = typeof coupon === "string" ? coupon : coupon && coupon.id;
      ids.push(couponId || entry.id || "discount");
    }
  }
  if (!ids.length && subscription.discount) {
    const d = subscription.discount;
    if (typeof d === "string") ids.push(d);
    else {
      const coupon = d.coupon;
      const couponId = typeof coupon === "string" ? coupon : coupon && coupon.id;
      ids.push(couponId || d.id || "discount");
    }
  }
  return ids.filter(Boolean);
}

// Any discount already on the subscription, including this same coupon from an earlier referral, queues.
export function discountApplyPlan(discountIds) {
  const ids = (discountIds || []).filter(Boolean);
  if (!ids.length) return { action: "apply" };
  return { action: "queue", reason: "existing-discount" };
}

export function earnReferral(referral, { invoiceId, amountPaid, now }) {
  if (!referral) return { ok: false, reason: "no-referral" };
  if (!(Number(amountPaid) > 0)) return { ok: false, reason: "zero-invoice" };
  if (referral.referrerCompanyId && referral.referrerCompanyId === referral.referredCompanyId) {
    return { ok: false, reason: "self-referral" };
  }
  if (referral.status === "applied") return { ok: true, changed: false, reason: "already-applied", referral };
  if (referral.status === "earned") return { ok: true, changed: false, reason: "already-earned", referral };
  if (referral.status !== "pending") return { ok: false, reason: "bad-status", referral };
  return {
    ok: true,
    changed: true,
    referral: {
      ...referral,
      status: "earned",
      invoiceId: String(invoiceId || ""),
      amountPaid: Number(amountPaid),
      earnedAt: typeof now === "string" ? now : new Date(now || Date.now()).toISOString(),
      applyStatus: "pending",
    },
  };
}

export function markApplied(referral, { couponId, subscriptionId, now }) {
  if (!referral || referral.status === "applied") return { changed: false, referral };
  return {
    changed: true,
    referral: {
      ...referral,
      status: "applied",
      applyStatus: "applied",
      couponId: couponId || REFERRAL_COUPON_ID,
      subscriptionId: subscriptionId || referral.subscriptionId || "",
      appliedAt: typeof now === "string" ? now : new Date(now || Date.now()).toISOString(),
    },
  };
}

export function markWaiting(referral, { reason, now }) {
  if (!referral || referral.status === "applied") return { changed: false, referral };
  const applyStatus = reason === "existing-discount" ? "queued" : "pending";
  if (referral.status === "earned" && referral.applyStatus === applyStatus && referral.queueReason === (reason || "")) {
    return { changed: false, referral };
  }
  return {
    changed: true,
    referral: {
      ...referral,
      status: "earned",
      applyStatus,
      queueReason: reason || "",
      queuedAt: referral.queuedAt || (typeof now === "string" ? now : new Date(now || Date.now()).toISOString()),
    },
  };
}

export function oldestEarned(rows) {
  return (rows || [])
    .filter(row => row && row.status === "earned" && row.applyStatus !== "applied")
    .sort((a, b) => String(a.earnedAt || "").localeCompare(String(b.earnedAt || "")) || String(a.referredCompanyId || "").localeCompare(String(b.referredCompanyId || "")))[0] || null;
}

function stripeErrorCode(err) {
  return err && (err.code || (err.raw && err.raw.code) || "");
}

export async function ensureReferralCoupon(stripe, id = REFERRAL_COUPON_ID) {
  if (!stripe || !stripe.coupons) {
    const err = new Error("stripe-not-configured");
    err.code = "failed-precondition";
    throw err;
  }
  try {
    const existing = await stripe.coupons.retrieve(id);
    if (!couponMatchesReferral(existing, id)) {
      const err = new Error("referral-coupon-mismatch");
      err.code = "failed-precondition";
      throw err;
    }
    return existing;
  } catch (err) {
    if (err.message === "referral-coupon-mismatch") throw err;
    if (stripeErrorCode(err) !== "resource_missing") throw err;
    try {
      return await stripe.coupons.create(referralCouponCreateParams(id));
    } catch (createErr) {
      if (stripeErrorCode(createErr) !== "resource_already_exists") throw createErr;
      const existing = await stripe.coupons.retrieve(id);
      if (!couponMatchesReferral(existing, id)) {
        const mismatch = new Error("referral-coupon-mismatch");
        mismatch.code = "failed-precondition";
        throw mismatch;
      }
      return existing;
    }
  }
}

export async function handleEnsureReferralCode({ uid, companyId, profile, company, existingCode, loadCounts, allocate, origin }) {
  const authz = authorizeCompanyAdmin({ uid, profile, company, companyId });
  if (!authz.ok) return authz;
  let code = referralCodeOk(existingCode) ? existingCode : "";
  let created = false;
  if (!code) {
    const planned = await allocate();
    if (!planned || !planned.ok) return { ok: false, code: "failed-precondition", reason: (planned && planned.reason) || "code-collision" };
    code = planned.code;
    created = planned.created === true;
  }
  const tally = typeof loadCounts === "function" ? await loadCounts() : { pending: 0, earned: 0 };
  return {
    ok: true,
    code,
    created,
    link: referralLink(code, origin),
    pending: tally.pending || 0,
    earned: tally.earned || 0,
  };
}

async function audit(store, entry) {
  if (store && typeof store.audit === "function") await store.audit(entry);
}

export async function awardPaidReferral({ referredCompanyId, invoiceId, amountPaid, now, store, stripe }) {
  if (!(Number(amountPaid) > 0)) return { ok: true, skipped: "zero-invoice" };
  const current = await store.getReferral(referredCompanyId);
  if (!current) return { ok: true, skipped: "no-referral" };
  const earned = earnReferral(current, { invoiceId, amountPaid, now });
  if (!earned.ok) return { ok: true, skipped: earned.reason };
  let referral = earned.referral;
  if (earned.changed) {
    const saved = await store.setEarned(referredCompanyId, referral);
    referral = (saved && saved.referral) || referral;
    if (saved && saved.changed) {
      await audit(store, {
        action: "earned",
        referredCompanyId,
        referrerCompanyId: referral.referrerCompanyId,
        code: referral.code,
        invoiceId: String(invoiceId || ""),
        fromStatus: "pending",
        toStatus: "earned",
        at: typeof now === "string" ? now : new Date(now || Date.now()).toISOString(),
      });
    }
  }
  if (!referral || referral.status === "applied") return { ok: true, skipped: "already-applied", referral };
  if (referral.status !== "earned") return { ok: true, referral };
  return applyOneReward({ referral, now, store, stripe });
}

export async function applyOneReward({ referral, now, store, stripe }) {
  if (!referral || referral.status !== "earned") return { ok: true, skipped: "not-earned", referral };
  let claimed = false;
  if (store && typeof store.claimReferrer === "function") {
    const claim = await store.claimReferrer(referral.referrerCompanyId, referral.referredCompanyId);
    if (!claim || !claim.ok) {
      if (claim && claim.reason === "busy") throw new Error("referral-busy");
      return { ok: true, skipped: (claim && claim.reason) || "busy", referral };
    }
    claimed = true;
  }
  try {
    return await applyClaimedReward({ referral, now, store, stripe });
  } finally {
    if (claimed && typeof store.releaseReferrer === "function") await store.releaseReferrer(referral.referrerCompanyId);
  }
}

async function applyClaimedReward({ referral, now, store, stripe }) {
  const referrer = await store.getCompany(referral.referrerCompanyId);
  const gate = referrerCanTakeCoupon(referrer);
  if (!gate.ok) {
    const waiting = markWaiting(referral, { reason: gate.reason, now });
    if (waiting.changed) {
      await store.setWaiting(referral.referredCompanyId, waiting.referral);
      await audit(store, {
        action: "reward-pending",
        referredCompanyId: referral.referredCompanyId,
        referrerCompanyId: referral.referrerCompanyId,
        code: referral.code,
        fromStatus: "earned",
        toStatus: "earned",
        reason: gate.reason,
        at: typeof now === "string" ? now : new Date(now || Date.now()).toISOString(),
      });
    }
    return { ok: true, pending: true, reason: gate.reason, referral: waiting.referral };
  }
  const coupon = await ensureReferralCoupon(stripe);
  const sub = await stripe.subscriptions.retrieve(gate.subscriptionId, { expand: ["discounts"] });
  const plan = discountApplyPlan(subscriptionDiscountIds(sub));
  const ids = subscriptionDiscountIds(sub);
  const onlyOurs = ids.length > 0 && ids.every(id => id === coupon.id);
  const rows = typeof store.listByReferrer === "function" ? await store.listByReferrer(referral.referrerCompanyId) : [];
  const otherApplied = rows.some(row => row && row.status === "applied" && row.referredCompanyId !== referral.referredCompanyId);
  if (plan.action === "queue" && !(onlyOurs && !otherApplied)) {
    const waiting = markWaiting(referral, { reason: plan.reason, now });
    if (waiting.changed) {
      await store.setWaiting(referral.referredCompanyId, waiting.referral);
      await audit(store, {
        action: "queued",
        referredCompanyId: referral.referredCompanyId,
        referrerCompanyId: referral.referrerCompanyId,
        code: referral.code,
        fromStatus: "earned",
        toStatus: "earned",
        reason: plan.reason,
        at: typeof now === "string" ? now : new Date(now || Date.now()).toISOString(),
      });
    }
    return { ok: true, queued: true, reason: plan.reason, referral: waiting.referral };
  }
  if (plan.action === "apply") {
    await stripe.subscriptions.update(gate.subscriptionId, {
      discounts: [{ coupon: coupon.id }],
      proration_behavior: "none",
    });
  }
  const applied = markApplied(referral, { couponId: coupon.id, subscriptionId: gate.subscriptionId, now });
  const saved = await store.setApplied(referral.referredCompanyId, applied.referral);
  const finalReferral = (saved && saved.referral) || applied.referral;
  await audit(store, {
    action: "applied",
    referredCompanyId: referral.referredCompanyId,
    referrerCompanyId: referral.referrerCompanyId,
    code: referral.code,
    couponId: coupon.id,
    subscriptionId: gate.subscriptionId,
    fromStatus: "earned",
    toStatus: "applied",
    at: typeof now === "string" ? now : new Date(now || Date.now()).toISOString(),
  });
  return { ok: true, applied: true, referral: finalReferral };
}

export async function applyReferrerRewards({ referrerCompanyId, now, store, stripe }) {
  const rows = await store.listByReferrer(referrerCompanyId);
  const next = oldestEarned(rows);
  if (!next) return { ok: true, skipped: "none" };
  return applyOneReward({ referral: next, now, store, stripe });
}

export async function markCheckoutReward({ referredCompanyId, subscriptionId, now, store }) {
  const current = await store.getReferral(referredCompanyId);
  if (!current || current.status !== "earned") return { ok: true, skipped: "not-earned" };
  const applied = markApplied(current, { couponId: REFERRAL_COUPON_ID, subscriptionId, now });
  if (applied.changed) await store.setApplied(referredCompanyId, applied.referral);
  await audit(store, {
    action: "applied",
    referredCompanyId,
    referrerCompanyId: current.referrerCompanyId,
    code: current.code,
    couponId: REFERRAL_COUPON_ID,
    subscriptionId: subscriptionId || "",
    fromStatus: "earned",
    toStatus: "applied",
    reason: "checkout",
    at: typeof now === "string" ? now : new Date(now || Date.now()).toISOString(),
  });
  return { ok: true, applied: true, referral: applied.referral };
}

export async function handleReferralWebhookEvent({ event, paid, companyId, now, store, stripe }) {
  const results = {};
  if (paid && Number(paid.amountPaid) > 0 && paid.companyId) {
    results.award = await awardPaidReferral({
      referredCompanyId: paid.companyId,
      invoiceId: paid.invoiceId,
      amountPaid: paid.amountPaid,
      now,
      store,
      stripe,
    });
  } else if (event && event.type === "invoice.paid") {
    results.award = { ok: true, skipped: "zero-invoice" };
  }
  const metadata = event && event.data && event.data.object && event.data.object.metadata;
  const referralFor = metadata && metadata.referralFor;
  if (event && event.type === "checkout.session.completed" && referralFor) {
    const subscriptionId = event.data.object.subscription || "";
    results.checkout = await markCheckoutReward({ referredCompanyId: referralFor, subscriptionId, now, store });
  }
  if (companyId && event && !referralFor && (
    event.type === "checkout.session.completed"
    || event.type === "customer.subscription.updated"
    || (event.type === "invoice.paid" && paid && Number(paid.amountPaid) > 0)
  )) {
    results.referrer = await applyReferrerRewards({ referrerCompanyId: companyId, now, store, stripe });
  }
  return results;
}

function referralData(snap) {
  if (!snap || !snap.exists) return null;
  const data = typeof snap.data === "function" ? snap.data() : snap.data;
  return { ...data, referredCompanyId: data.referredCompanyId || snap.id };
}

export function referralStore(db) {
  const referrals = () => db.collection("referrals");
  let FieldValue = null;
  async function serverTimestamp() {
    if (!FieldValue) FieldValue = (await import("firebase-admin/firestore")).FieldValue;
    return FieldValue.serverTimestamp();
  }
  return {
    async getReferral(id) {
      const snap = await referrals().doc(id).get();
      return referralData(snap);
    },
    async getCompany(id) {
      const snap = await db.collection("companies").doc(id).get();
      if (!snap.exists) return null;
      return { id, ...snap.data() };
    },
    async getCode(code) {
      const snap = await db.collection("referralCodes").doc(code).get();
      return snap.exists ? snap.data() : null;
    },
    async listByReferrer(companyId) {
      const snap = await referrals().where("referrerCompanyId", "==", companyId).get();
      return snap.docs.map(docSnap => referralData(docSnap));
    },
    async countsFor(companyId) {
      return tallyReferrals(await this.listByReferrer(companyId), companyId);
    },
    async putCode({ companyId, code, uid }) {
      const companyRef = db.collection("companies").doc(companyId);
      const codeRef = db.collection("referralCodes").doc(code);
      return db.runTransaction(async tx => {
        const company = await tx.get(companyRef);
        const lookup = await tx.get(codeRef);
        if (!company.exists) return { ok: false, reason: "missing-company" };
        const existing = company.data().referralCode;
        if (referralCodeOk(existing)) return { ok: true, code: existing, created: false };
        if (lookup.exists) return { ok: false, reason: "code-taken" };
        tx.update(companyRef, { referralCode: code });
        tx.set(codeRef, { companyId, createdBy: uid || "", createdAt: await serverTimestamp() });
        return { ok: true, code, created: true };
      });
    },
    async insertPending({ companyId, referredBy, referral }) {
      const companyRef = db.collection("companies").doc(companyId);
      const ref = referrals().doc(companyId);
      const codeRef = db.collection("referralCodes").doc(referredBy.code);
      return db.runTransaction(async tx => {
        const company = await tx.get(companyRef);
        const existing = await tx.get(ref);
        const lookup = await tx.get(codeRef);
        if (!company.exists) return { ok: false, reason: "missing-company" };
        const data = company.data();
        if ((data.referredBy && data.referredBy.companyId) || existing.exists) return { ok: false, reason: "after-creation" };
        if (!lookup.exists || !lookup.data().companyId) return { ok: false, reason: "unknown-code" };
        if (lookup.data().companyId === companyId) return { ok: false, reason: "self-referral" };
        if (lookup.data().companyId !== referredBy.companyId) return { ok: false, reason: "unknown-code" };
        tx.update(companyRef, { referredBy });
        tx.set(ref, referral);
        return { ok: true };
      });
    },
    async setEarned(id, referral) {
      return compareStatus(db, id, ["pending"], referral);
    },
    async setApplied(id, referral) {
      return compareStatus(db, id, ["earned"], { ...referral, status: "applied", applyStatus: "applied" });
    },
    async setWaiting(id, referral) {
      return compareStatus(db, id, ["earned", "pending"], referral);
    },
    async audit(entry) {
      await db.collection("referralAudits").add({
        ...entry,
        at: entry.at || new Date().toISOString(),
        writtenAt: await serverTimestamp(),
      });
    },
    async claimReferrer(referrerCompanyId, referredCompanyId) {
      const lockRef = db.collection("referralLocks").doc(referrerCompanyId);
      return db.runTransaction(async tx => {
        const lock = await tx.get(lockRef);
        const now = Date.now();
        const heldFor = lock.exists ? String(lock.data().referralId || "") : "";
        const heldUntil = lock.exists ? Number(lock.data().heldUntil) || 0 : 0;
        if (heldUntil > now && heldFor && heldFor !== referredCompanyId) return { ok: false, reason: "busy" };
        tx.set(lockRef, { heldUntil: now + 60_000, referralId: referredCompanyId });
        return { ok: true };
      });
    },
    async releaseReferrer(referrerCompanyId) {
      await db.collection("referralLocks").doc(referrerCompanyId).set({ heldUntil: 0, referralId: "" }, { merge: true });
    },
  };
}

async function compareStatus(db, id, fromStatuses, referral) {
  const ref = db.collection("referrals").doc(id);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "no-referral" };
    const cur = snap.data();
    if (cur.status === "applied" || (referral.status === "applied" && cur.status === "applied")) {
      return { ok: true, changed: false, referral: { ...cur, referredCompanyId: cur.referredCompanyId || id } };
    }
    if (cur.status === referral.status && cur.applyStatus === referral.applyStatus && cur.invoiceId === referral.invoiceId) {
      return { ok: true, changed: false, referral: { ...cur, referredCompanyId: cur.referredCompanyId || id } };
    }
    if (!fromStatuses.includes(cur.status) && cur.status === referral.status) {
      return { ok: true, changed: false, referral: { ...cur, referredCompanyId: cur.referredCompanyId || id } };
    }
    if (!fromStatuses.includes(cur.status)) {
      return { ok: true, changed: false, referral: { ...cur, referredCompanyId: cur.referredCompanyId || id } };
    }
    const saved = { ...cur, ...referral, referredCompanyId: referral.referredCompanyId || cur.referredCompanyId || id };
    tx.set(ref, saved);
    return { ok: true, changed: true, referral: saved };
  });
}

export async function allocateCompanyCode({ store, companyId, uid, random }) {
  const company = await store.getCompany(companyId);
  if (!company) return { ok: false, reason: "missing-company" };
  if (referralCodeOk(company.referralCode)) return { ok: true, code: company.referralCode, created: false };
  for (let i = 0; i < 5; i++) {
    const code = newReferralCode(random);
    const result = await store.putCode({ companyId, code, uid });
    if (result && result.ok) return result;
    if (result && result.reason !== "code-taken") return result;
  }
  return { ok: false, reason: "code-collision" };
}

export async function attachSignupReferral({ uid, companyId, code, now, store }) {
  const company = await store.getCompany(companyId);
  const normalized = normalizeReferralCode(code);
  const lookup = normalized ? await store.getCode(normalized) : null;
  const decision = attachDecision({ company, companyId, code: normalized, lookup, uid, now });
  if (!decision.ok) return decision;
  const saved = await store.insertPending({ companyId, referredBy: decision.referredBy, referral: decision.referral });
  if (!saved.ok) return { ok: false, code: "failed-precondition", reason: saved.reason || "after-creation" };
  await audit(store, {
    action: "captured",
    referredCompanyId: companyId,
    referrerCompanyId: decision.referredBy.companyId,
    code: decision.referredBy.code,
    fromStatus: "",
    toStatus: "pending",
    at: new Date(now instanceof Date ? now.getTime() : Number(now)).toISOString(),
    by: uid,
  });
  return { ok: true, referredBy: decision.referredBy };
}
