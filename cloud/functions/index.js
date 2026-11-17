/**
 * CallUp Base workers for the existing Firebase project.
 * Do not deploy from this branch. cloud/scripts/refuse-live-deploy.js blocks firebase deploy.
 *
 * photoInboxWorker only marks a new photoInbox document as held.
 * It does not read Gmail and does not write job or Xero documents.
 *
 * Retention is exported as retentionSweepHandler and is NOT scheduled.
 * Xero processing is not imported. See pro/xero-queue.js.
 *
 * Staff invites: previewStaffInvite and acceptStaffInvite are callable.
 * acceptStaffInvite creates the Auth user and users/{uid} with the invited
 * role (labourer, operator, supervisor, or admin for a CallUp company when an admin invited).
 * inviteEmailWorker queues mail.
 * INVITE_EMAIL_ENABLED must be the string "true" or the message is held in
 * inviteMail and nothing is sent. This file does not open an SMTP connection.
 *
 * adminSendPasswordReset emails a password reset link to a staff login in the
 * caller's own company. The link is never returned to the browser.
 *
 * sendJobEmail emails one job from the CallUp sending address. It reuses
 * RESEND_API_KEY and INVITE_EMAIL_ENABLED. No new secret. Photos and dump
 * receipts are read with the Admin SDK. The message is not sent unless
 * INVITE_EMAIL_ENABLED is the string "true".
 *
 * helperAsk stays deployed and refuses every request. HELPER_ENABLED defaults
 * to "false", and HELPER_HARD_OFF returns before Auth, Firestore, or Vertex.
 * An environment change cannot turn it back on. See helper/DEPLOY.md.
 *
 * Phone notifications live in push-schedule.js: chatMessagePush, dailyJobPush
 * (06:00 Australia/Brisbane), dailyJobChangePush, prestartJobPush, prestartAssetPush
 * and prestartTimesheetPush. Photo retention is not scheduled.
 * pauseRetentionSweep (03:00 Australia/Brisbane) logs paused companies it would delete.
 * It does not delete anything unless PAUSE_DELETE_DRY_RUN=false.
 * An owner-paused company is never selected. That pause is not an automatic deletion.
 *
 * veoliaReceiptGuard clears paidPersonally on a Veolia receipt.
 * veoliaReimbursementGuard deletes a reimbursement created from a Veolia receipt.
 * Veolia dump fees are on the company account and are never paid back to staff.
 *
 * deleteCompanyAccount is the platform-owner callable that deletes one CallUp company.
 * It refuses Heartwood and the caller's own company. When the company has a Stripe
 * subscription id, it cancels that subscription (invoice_now false, prorate false)
 * and does not create a charge, invoice, or Checkout session.
 *
 * Referral bonus: ensureReferralCode mints a company's share code on first use.
 * attachSignupReferral records referredBy at signup. stripeWebhook grants the
 * referrer 2 months free on the referred company's first paid invoice.
 */
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { handlePhotoIntake } from "./lib/photo-intake.js";
import {
  acceptStaffInvite as acceptInvite,
  previewStaffInvite as previewInvite,
  queueInviteEmail,
  sendViaResend,
  shouldQueueInviteEmail,
  displayStatus,
  profileFromInvite,
} from "./shared/staff-invites.js";
import { adminSendPasswordReset as sendPasswordReset, rateDecision, resetFailureText } from "./password-reset.js";
import { jobEmailFailureText, jobEmailRateDecision, sendJobEmail as deliverJobEmail } from "./job-email.js";
import { authorizeCallable, handleHelperAsk } from "./helper/ask.js";
import { adminReader } from "./helper/reader.js";
import { createModelProvider, helperLiveEnabled } from "./helper/provider.js";
import { firestoreHelperStore } from "./helper/apply.js";
import {
  assertKeyForMode,
  authorizeCompanyAdmin,
  billingOrigin,
  handleCheckoutCall,
  stripeMode,
  STRIPE_API_VERSION,
  stripePrices,
  handlePortalCall,
  handleStripeWebhook,
  syncStaffQuantity,
  companiesTouchedByUser,
  mergeBilling,
  cancelSubscriptionOnCompanyDeletion,
} from "./billing/stripe-billing.js";
import {
  REFERRAL_COUPON_ID,
  allocateCompanyCode,
  attachSignupReferral as saveSignupReferral,
  ensureReferralCoupon,
  handleEnsureReferralCode,
  handleReferralWebhookEvent,
  oldestEarned,
  referralStore,
} from "./billing/referrals.js";
import { deleteCompanyAccountData } from "./owner-company.js";
import { deletionErrorMessage } from "./billing/owner-company.js";
import { applyVeoliaReceiptWrite, applyVeoliaReimbursementCreate } from "./receipt-reimburse.js";
export { pauseRetentionSweep } from "./pause-retention.js";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
// Resend API key for staff invite email. Always declared so a deploy binds it even if
// INVITE_EMAIL_ENABLED is not set in the analyze-time environment. Runtime INVITE_EMAIL_ENABLED
// and INVITE_EMAIL_ALLOW_TO still control whether mail is actually sent.
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const INVITE_MAIL_ON = process.env.INVITE_EMAIL_ENABLED === "true";
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
// Live Stripe. Only declared, bound and required in Secret Manager when STRIPE_MODE=live in functions/.env.heartwood-9f37f
// (the deploy CLI asks for every declared secret, so they must not be declared in test mode).
// Until then the functions run in test mode and refuse live keys and live events.
const STRIPE_MODE = stripeMode(process.env);
const STRIPE_LIVE = STRIPE_MODE === "live";
const STRIPE_LIVE_SECRET_KEY = STRIPE_LIVE ? defineSecret("STRIPE_LIVE_SECRET_KEY") : null;
const STRIPE_LIVE_WEBHOOK_SECRET = STRIPE_LIVE ? defineSecret("STRIPE_LIVE_WEBHOOK_SECRET") : null;
const STRIPE_LIVE_BASE_PRICE_ID = STRIPE_LIVE ? defineSecret("STRIPE_LIVE_BASE_PRICE_ID") : null;
const STRIPE_LIVE_EXTRA_PRICE_ID = STRIPE_LIVE ? defineSecret("STRIPE_LIVE_EXTRA_PRICE_ID") : null;
const STRIPE_KEY_SECRETS = STRIPE_LIVE ? [STRIPE_LIVE_SECRET_KEY, STRIPE_LIVE_BASE_PRICE_ID, STRIPE_LIVE_EXTRA_PRICE_ID] : [STRIPE_SECRET_KEY];
const STRIPE_HOOK_SECRETS = STRIPE_LIVE ? [STRIPE_LIVE_WEBHOOK_SECRET] : [STRIPE_WEBHOOK_SECRET];
function currentPrices() {
  return stripePrices(STRIPE_MODE, STRIPE_LIVE ? { base: STRIPE_LIVE_BASE_PRICE_ID.value(), extra: STRIPE_LIVE_EXTRA_PRICE_ID.value() } : {});
}

// firebase-functions creates its own "__admin__" app for Firestore triggers, so getApps().length is not enough:
// check for the default app by name.
function hasDefaultApp() { return getApps().some(a => a.name === "[DEFAULT]"); }
function ensureAdmin() {
  if (!hasDefaultApp()) initializeApp();
}

export const helperAsk = onCall(
  { region: "australia-southeast1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    // Hard early return. Do not read the caller, Firestore, or Vertex.
    // helperLiveEnabled() is false while HELPER_HARD_OFF is true, including
    // when HELPER_ENABLED=true. Leave this return in place.
    if (!helperLiveEnabled()) {
      throw new HttpsError("failed-precondition", "Helper is switched off.");
    }
    const header = request.rawRequest?.headers?.authorization || "";
    if (!/^Bearer\s+\S+/.test(String(header))) {
      throw new HttpsError("unauthenticated", "Sign in to use Helper.");
    }
    ensureAdmin();
    const gate = await authorizeCallable(request, token => getAuth().verifyIdToken(token));
    if (!gate.ok) throw new HttpsError("unauthenticated", gate.reply);
    let model;
    try {
      model = createModelProvider();
    } catch {
      model = { async generate() { throw new Error("helper-misconfigured"); } };
    }
    const db = getFirestore();
    const result = await handleHelperAsk({
      auth: { uid: gate.uid },
      data: request.data,
      reader: adminReader(db),
      store: firestoreHelperStore(db),
      model,
      enabled: helperLiveEnabled(),
    });
    if (!result.ok) {
      const code = result.code === "invalid-argument" || result.code === "permission-denied" ? result.code : "permission-denied";
      throw new HttpsError(code, result.reply);
    }
    return {
      reply: result.reply,
      enabled: !!result.enabled,
      admin: !!result.admin,
      knowledge: result.knowledge || "placeholder",
      proposal: result.proposal || null,
    };
  },
);

export { retentionSweepHandler } from "./lib/retention-run.js";
export { chatMessagePush, dailyJobPush, dailyJobChangePush, prestartJobPush, prestartAssetPush, prestartTimesheetPush } from "./push-schedule.js";

const INVITE_REGION = "australia-southeast1";

function inviteBackend() {
  ensureAdmin();
  const db = getFirestore();
  const auth = getAuth();
  return {
    now: () => new Date(),
    async findByToken(token) {
      const snap = await db.collection("invites").where("token", "==", token).limit(2).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async getUserByEmail(email) {
      try {
        const user = await auth.getUserByEmail(email);
        return { uid: user.uid, email: user.email || email };
      } catch (err) {
        if (err && err.code === "auth/user-not-found") return null;
        throw err;
      }
    },
    async createUser({ email, password, displayName }) {
      const user = await auth.createUser({ email, password, displayName, emailVerified: false, disabled: false });
      return { uid: user.uid };
    },
    async deleteUser(uid) {
      await auth.deleteUser(uid);
    },
    async setProfile(uid, profile) {
      await db.collection("users").doc(uid).set(profile);
    },
    async deleteProfile(uid) {
      await db.collection("users").doc(uid).delete();
    },
    async getInviter(uid) {
      const id = String(uid || "");
      const [snap, grant] = await Promise.all([db.collection("users").doc(id).get(), db.collection("heartwoodAdmins").doc(id).get()]);
      return { uid, profile: snap.exists ? (snap.data() || null) : null, heartwoodAdmin: grant.exists && (grant.data() || {}).role === "admin" };
    },
    // Accepted Heartwood admin invite: the grant the rules read (isAdmin) alongside the fixed admin list.
    async grantHeartwoodAdmin(uid, { inviteId, grantedBy }) {
      await db.collection("heartwoodAdmins").doc(uid).set({
        uid, role: "admin", companyId: "heartwood", inviteId: String(inviteId || ""), grantedBy: String(grantedBy || ""),
        grantedAt: FieldValue.serverTimestamp(),
      });
    },
    async revokeHeartwoodAdmin(uid) {
      await db.collection("heartwoodAdmins").doc(uid).delete();
    },
    async claimInvite(id, uid, now) {
      return db.runTransaction(async tx => {
        const ref = db.collection("invites").doc(id);
        const snap = await tx.get(ref);
        if (!snap.exists) return { ok: false, reason: "invalid" };
        const invite = snap.data() || {};
        const status = displayStatus(invite, now);
        if (status !== "pending") return { ok: false, reason: status === "invalid" ? "invalid" : status };
        if (!profileFromInvite(invite)) return { ok: false, reason: "invalid" };
        tx.update(ref, {
          status: "accepted",
          acceptedUid: uid,
          acceptedAt: FieldValue.serverTimestamp(),
        });
        const lock = {
          email: invite.email,
          status: "accepted",
          inviteId: id,
          role: invite.role,
          expiresAt: invite.expiresAt,
        };
        if (invite.tenantId) lock.tenantId = invite.tenantId;
        tx.set(db.collection("inviteEmails").doc(invite.email), lock, { merge: true });
        return { ok: true };
      });
    },
  };
}

async function runInviteCall(fn, data) {
  try {
    return await fn(data || {}, inviteBackend());
  } catch (err) {
    console.error("staff-invite", err && err.code ? err.code : "failed");
    throw new HttpsError("internal", "invite-failed");
  }
}

export const previewStaffInvite = onCall({ region: INVITE_REGION, invoker: "public", cors: true }, request => {
  return runInviteCall(previewInvite, request.data);
});

export const acceptStaffInvite = onCall({ region: INVITE_REGION, invoker: "public", cors: true }, request => {
  return runInviteCall(acceptInvite, request.data);
});

export const adminSendPasswordReset = onCall(
  { region: INVITE_REGION, secrets: [RESEND_API_KEY] },
  async request => {
    if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", resetFailureText("unauthenticated"));
    if (process.env.NODE_TEST_CONTEXT) throw new HttpsError("failed-precondition", resetFailureText("not-sent"));
    ensureAdmin();
    const db = getFirestore();
    const auth = getAuth();
    const result = await sendPasswordReset({
      callerUid: request.auth.uid,
      targetUid: request.data && request.data.uid,
    }, {
      now: () => new Date(),
      env: process.env,
      allowLiveMail: process.env.INVITE_EMAIL_ENABLED === "true",
      async getUser(uid) {
        const [snap, grant] = await Promise.all([
          db.collection("users").doc(uid).get(),
          db.collection("heartwoodAdmins").doc(uid).get(),
        ]);
        return {
          profile: snap.exists ? (snap.data() || null) : null,
          heartwoodGrant: grant.exists && (grant.data() || {}).role === "admin",
        };
      },
      async getAuthUser(uid) {
        try {
          const user = await auth.getUser(uid);
          return {
            email: user.email || "",
            displayName: user.displayName || "",
            providerData: (user.providerData || []).map(p => ({ providerId: p.providerId })),
          };
        } catch (err) {
          if (err && err.code === "auth/user-not-found") return null;
          throw err;
        }
      },
      async getCompany(companyId) {
        const snap = await db.collection("companies").doc(companyId).get();
        if (!snap.exists) return null;
        const c = snap.data() || {};
        return { name: c.name || "", email: c.email || "" };
      },
      generateLink: (email, settings) => auth.generatePasswordResetLink(email, settings),
      async claimRate({ uid, companyId, now }) {
        const ref = db.collection("passwordResetRate").doc(uid);
        return db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          const prev = snap.exists ? (snap.data() || {}).stamps : [];
          const decision = rateDecision(prev, now);
          if (!decision.ok) return { ok: false };
          tx.set(ref, {
            companyId,
            stamps: decision.stamps,
            updatedAt: FieldValue.serverTimestamp(),
          });
          return { ok: true };
        });
      },
      sendResend: (payload, idempotencyKey) => sendViaResend({
        apiKey: INVITE_MAIL_ON ? RESEND_API_KEY.value() : "",
        payload,
        fetchImpl: globalThis.fetch,
        idempotencyKey,
      }),
      writeMail: (collectionName, body) => db.collection(collectionName).add({
        ...body,
        createdAt: FieldValue.serverTimestamp(),
      }),
    });
    if (!result || !result.ok) {
      if (result && result.reason === "google-only") return { ok: false, reason: "google-only" };
      const reason = result && result.reason;
      const code = reason === "rate-limited" ? "resource-exhausted"
        : reason === "unauthenticated" ? "unauthenticated"
        : reason === "not-sent" ? "failed-precondition"
        : "permission-denied";
      throw new HttpsError(code, resetFailureText(reason));
    }
    return { ok: true };
  },
);

function jobTenantId(job) {
  const tenant = job && typeof job.tenantId === "string" ? job.tenantId.trim() : "";
  if (tenant) return tenant;
  const company = job && typeof job.companyId === "string" ? job.companyId.trim() : "";
  return company || "heartwood";
}

export const sendJobEmail = onCall(
  // 256MiB and the default concurrency of 80 is too small: a Heartwood send
  // of 16 job photos was killed at 274MiB on 17 Nov 2026 (9:56pm Brisbane).
  { region: INVITE_REGION, secrets: [RESEND_API_KEY], memory: "1GiB", concurrency: 1, timeoutSeconds: 120 },
  async request => {
    if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", jobEmailFailureText("unauthenticated"));
    if (process.env.NODE_TEST_CONTEXT) throw new HttpsError("failed-precondition", jobEmailFailureText("not-sent"));
    ensureAdmin();
    const db = getFirestore();
    const bucket = getStorage().bucket();
    const result = await deliverJobEmail({
      callerUid: request.auth.uid,
      jobId: request.data && request.data.jobId,
      to: request.data && request.data.to,
      cc: request.data && request.data.cc,
    }, {
      now: () => new Date(),
      env: process.env,
      allowLiveMail: process.env.INVITE_EMAIL_ENABLED === "true",
      async getCaller(uid) {
        const [snap, grant, authUser] = await Promise.all([
          db.collection("users").doc(uid).get(),
          db.collection("heartwoodAdmins").doc(uid).get(),
          getAuth().getUser(uid).catch(err => (err && err.code === "auth/user-not-found" ? null : Promise.reject(err))),
        ]);
        return {
          profile: snap.exists ? (snap.data() || null) : null,
          heartwoodGrant: grant.exists && (grant.data() || {}).role === "admin",
          email: authUser && authUser.email || "",
          name: (snap.exists && (snap.data() || {}).name) || (authUser && authUser.displayName) || "",
        };
      },
      async getJob(jobId) {
        const snap = await db.collection("jobs").doc(jobId).get();
        if (!snap.exists) return null;
        return { id: snap.id, ...(snap.data() || {}) };
      },
      async getCompany(companyId) {
        const snap = await db.collection("companies").doc(companyId).get();
        const fallback = companyId === "heartwood" ? "Heartwood Earthworx" : "";
        if (!snap.exists) return fallback ? { name: fallback, email: "" } : null;
        const c = snap.data() || {};
        return { name: c.name || fallback, email: c.email || "" };
      },
      async listPhotos(job) {
        const prefix = `tenants/${jobTenantId(job)}/jobs/${job.id}/photos/`;
        const [files] = await bucket.getFiles({ prefix });
        const rows = [];
        for (const file of files || []) {
          if (!file.name || file.name.endsWith("/")) continue;
          const [meta] = await file.getMetadata();
          rows.push({
            path: file.name,
            contentType: meta.contentType || "",
            customMetadata: (meta && meta.metadata) || {},
            size: Number(meta.size) || 0,
          });
        }
        return rows;
      },
      async listReceipts(job) {
        const snap = await db.collection("receipts").where("jobId", "==", job.id).get();
        return snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
      },
      async readReceiptChunks(receiptId, tenantId) {
        const id = String(receiptId || "");
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
        const want = String(tenantId || "heartwood").trim() || "heartwood";
        const snap = await db.collection("receiptChunks").where("rid", "==", id).get();
        const parts = snap.docs
          .map(d => d.data() || {})
          .filter(row => {
            const company = String(row.companyId || row.tenantId || "heartwood").trim() || "heartwood";
            return company === want;
          })
          .sort((a, b) => (Number(a.i) || 0) - (Number(b.i) || 0));
        if (!parts.length) return null;
        const b64 = parts.map(row => String(row.data || "")).join("");
        if (!b64) return null;
        const bytes = Buffer.from(b64, "base64");
        if (!bytes.length) return null;
        return { bytes, contentType: "image/jpeg", size: bytes.length };
      },
      async listDocuments(job) {
        const snap = await db.collection("jobs").doc(job.id).collection("documents").get();
        return snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
      },
      async getQuote(job) {
        if (!job || !job.quoteId) return null;
        const snap = await db.collection("quotes").doc(String(job.quoteId)).get();
        if (!snap.exists) return null;
        return snap.data() || null;
      },
      async statObject(path) {
        const [meta] = await bucket.file(path).getMetadata();
        return { size: Number(meta.size) || 0, contentType: meta.contentType || "" };
      },
      async readObject(path) {
        const file = bucket.file(path);
        const [meta] = await file.getMetadata();
        const [buf] = await file.download();
        return { bytes: buf, contentType: meta.contentType || "", size: buf.length };
      },
      async claimRate({ uid, companyId, now }) {
        const ref = db.collection("jobEmailRate").doc(uid);
        return db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          const prev = snap.exists ? (snap.data() || {}).stamps : [];
          const decision = jobEmailRateDecision(prev, now);
          if (!decision.ok) return { ok: false };
          tx.set(ref, {
            companyId,
            stamps: decision.stamps,
            updatedAt: FieldValue.serverTimestamp(),
          });
          return { ok: true };
        });
      },
      sendResend: (payload, idempotencyKey) => sendViaResend({
        apiKey: INVITE_MAIL_ON ? RESEND_API_KEY.value() : "",
        payload,
        fetchImpl: globalThis.fetch,
        idempotencyKey,
      }),
      writeMail: (collectionName, body) => db.collection(collectionName).add({
        ...body,
        createdAt: FieldValue.serverTimestamp(),
      }),
    });
    if (!result || !result.ok) {
      const reason = result && result.reason;
      const code = reason === "rate-limited" ? "resource-exhausted"
        : reason === "unauthenticated" ? "unauthenticated"
        : reason === "invalid-recipient" ? "invalid-argument"
        : reason === "not-sent" ? "failed-precondition"
        : "permission-denied";
      throw new HttpsError(code, jobEmailFailureText(reason));
    }
    const tooBig = result.overflowCount || 0;
    return { ok: true, attached: result.attached || 0, overflow: tooBig, skipped: result.skipped || 0, to: result.to || [] };
  },
);

export const inviteEmailWorker = onDocumentWritten(
  { document: "invites/{inviteId}", region: INVITE_REGION, secrets: [RESEND_API_KEY] },
  async event => {
    if (process.env.NODE_TEST_CONTEXT) return;
    const beforeSnap = event.data && event.data.before;
    const afterSnap = event.data && event.data.after;
    const before = beforeSnap && beforeSnap.exists ? beforeSnap.data() : null;
    const after = afterSnap && afterSnap.exists ? afterSnap.data() : null;
    ensureAdmin();
    const db = getFirestore();
    const statusRef = db.collection("inviteStatus").doc(event.params.inviteId);
    const statusCompany = String((after && (after.companyId || after.tenantId)) || (before && (before.companyId || before.tenantId)) || "heartwood");
    const queue = shouldQueueInviteEmail(before, after);
    console.log("inviteEmailWorker event", event.params.inviteId, "queue", queue, "mailOn", INVITE_MAIL_ON);
    if (!queue) return;
    await statusRef.set({ companyId: statusCompany, delivery: "received", reason: "", error: "", updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      .catch(e => console.error("inviteStatus write failed", e && e.message));
    const companyId = statusCompany;
    let company = null;
    let result;
    try {
    if (companyId !== "heartwood") {
      const snap = await db.collection("companies").doc(companyId).get();
      const c = snap.exists ? snap.data() : {};
      company = { name: c.name || "", email: c.email || "" };
    }
      result = await queueInviteEmail(after, {
      company,
      env: process.env,
      allowLiveMail: process.env.INVITE_EMAIL_ENABLED === "true",
      sendResend: payload => sendViaResend({
        apiKey: INVITE_MAIL_ON ? RESEND_API_KEY.value() : "",
        payload,
        fetchImpl: globalThis.fetch,
        idempotencyKey: `invite-${event.params.inviteId}-${String(after.token || "").slice(0, 12)}`,
      }),
      writeMail: (collectionName, body) => db.collection(collectionName).add({
        ...body,
        inviteId: event.params.inviteId,
        createdAt: FieldValue.serverTimestamp(),
      }),
    });
    } catch (e) {
      result = { sent: false, reason: "error", doc: { error: String((e && e.message) || e).slice(0, 200) } };
    }
    // Delivery status the inviting company's office can read (no token, no link, no message body).
    const status = {
      companyId,
      delivery: (result && result.doc && result.doc.delivery) || (result && result.reason) || "unknown",
      reason: String((result && result.reason) || ""),
      error: String((result && result.doc && result.doc.error) || "").slice(0, 200),
      updatedAt: FieldValue.serverTimestamp(),
    };
    console.log("invite email", event.params.inviteId, status.delivery, status.reason, status.error);
    await statusRef.set(status, { merge: true }).catch(e => console.error("inviteStatus write failed", e && e.message));
  },
);

async function billingContext(uid, companyId) {
  ensureAdmin();
  const db = getFirestore();
  const [companySnap, profileSnap, staffSnap] = await Promise.all([
    db.collection("companies").doc(companyId).get(),
    db.collection("users").doc(uid).get(),
    db.collection("users").where("companyId", "==", companyId).get(),
  ]);
  return {
    company: companySnap.exists ? companySnap.data() : null,
    profile: profileSnap.exists ? profileSnap.data() : null,
    staffCount: staffSnap.size,
  };
}

async function testStripe() {
  const key = STRIPE_LIVE ? STRIPE_LIVE_SECRET_KEY.value() : STRIPE_SECRET_KEY.value();
  assertKeyForMode(key, STRIPE_MODE);
  const { default: Stripe } = await import("stripe");
  // The live CallUp account uses Stripe Managed Payments, which Checkout refuses on API versions before basil.
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

function billingFailure(result) {
  if (result && result.reason === "stripe-not-configured") {
    throw new HttpsError("failed-precondition", "Card setup isn't available yet, you can add it later in Settings");
  }
  const code = result && (result.code === "unauthenticated" || result.code === "permission-denied" || result.code === "not-found")
    ? result.code
    : "failed-precondition";
  throw new HttpsError(code, (result && result.reason) || "billing-failed");
}

function referralFailure(result) {
  const code = result && (result.code === "unauthenticated" || result.code === "permission-denied" || result.code === "not-found" || result.code === "invalid-argument")
    ? result.code
    : "failed-precondition";
  throw new HttpsError(code, (result && result.reason) || "referral-failed");
}

async function stripeClient() {
  try {
    return await testStripe();
  } catch (e) {
    console.warn("stripe not configured", e && e.message);
    return null;
  }
}

export const ensureReferralCode = onCall(
  { region: INVITE_REGION, invoker: "public", cors: true },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "sign-in");
    ensureAdmin();
    const companyId = String(request.data?.companyId || "");
    const ctx = await billingContext(request.auth.uid, companyId);
    const store = referralStore(getFirestore());
    const result = await handleEnsureReferralCode({
      uid: request.auth.uid,
      companyId,
      profile: ctx.profile,
      company: ctx.company,
      existingCode: ctx.company && ctx.company.referralCode,
      origin: billingOrigin(request.data?.origin, companyId),
      loadCounts: () => store.countsFor(companyId),
      allocate: () => allocateCompanyCode({ store, companyId, uid: request.auth.uid }),
    });
    if (!result.ok) referralFailure(result);
    if (result.created) {
      await store.audit({
        action: "code-created",
        referrerCompanyId: companyId,
        code: result.code,
        fromStatus: "",
        toStatus: "code",
        at: new Date().toISOString(),
        by: request.auth.uid,
      });
    }
    return { code: result.code, link: result.link, pending: result.pending, earned: result.earned };
  },
);

export const attachSignupReferral = onCall(
  { region: INVITE_REGION, invoker: "public", cors: true },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "sign-in");
    ensureAdmin();
    const result = await saveSignupReferral({
      uid: request.auth.uid,
      companyId: String(request.data?.companyId || ""),
      code: request.data?.code,
      now: Date.now(),
      store: referralStore(getFirestore()),
    });
    if (!result.ok) referralFailure(result);
    return { ok: true, referredBy: result.referredBy };
  },
);

export const createBillingCheckout = onCall(
  { region: INVITE_REGION, secrets: STRIPE_KEY_SECRETS },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "sign-in");
    ensureAdmin();
    const companyId = String(request.data?.companyId || "");
    const ctx = await billingContext(request.auth.uid, companyId);
    const authz = authorizeCompanyAdmin({ uid: request.auth.uid, profile: ctx.profile, company: ctx.company, companyId });
    if (!authz.ok) billingFailure(authz);
    const stripe = await stripeClient();
    let referralCoupon = "";
    let referralFor = "";
    if (stripe) {
      try {
        const store = referralStore(getFirestore());
        const reward = oldestEarned(await store.listByReferrer(companyId));
        if (reward) {
          await ensureReferralCoupon(stripe);
          referralCoupon = REFERRAL_COUPON_ID;
          referralFor = reward.referredCompanyId;
        }
      } catch (err) {
        console.warn("referral checkout", err && err.message);
        referralCoupon = "";
        referralFor = "";
      }
    }
    const checkoutArgs = {
      uid: request.auth.uid,
      companyId,
      origin: request.data?.origin,
      getContext: async () => ctx,
      stripe,
      prices: currentPrices(),
      preserveTrial: request.data?.preserveTrial === true,
      referralCoupon,
      referralFor,
    };
    let result;
    try {
      result = await handleCheckoutCall(checkoutArgs);
    } catch (err) {
      if (!referralCoupon) throw err;
      console.warn("referral discount skipped", err && err.message);
      result = await handleCheckoutCall({ ...checkoutArgs, referralCoupon: "", referralFor: "" });
    }
    if (!result.ok) billingFailure(result);
    return { url: result.url };
  },
);

export const createBillingPortal = onCall(
  { region: INVITE_REGION, secrets: STRIPE_KEY_SECRETS },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "sign-in");
    const result = await handlePortalCall({
      uid: request.auth.uid,
      companyId: String(request.data?.companyId || ""),
      origin: request.data?.origin,
      getContext: billingContext,
      stripe: await testStripe(),
    });
    if (!result.ok) billingFailure(result);
    return { url: result.url };
  },
);

export const stripeWebhook = onRequest(
  { region: INVITE_REGION, secrets: STRIPE_HOOK_SECRETS, invoker: "public" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("POST");
      return;
    }
    ensureAdmin();
    const db = getFirestore();
    const outcome = await handleStripeWebhook({
      rawBody: req.rawBody,
      signature: req.get("stripe-signature") || "",
      secret: STRIPE_LIVE ? STRIPE_LIVE_WEBHOOK_SECRET.value() : STRIPE_WEBHOOK_SECRET.value(),
      mode: STRIPE_MODE,
      loadCompany: async companyId => {
        const snap = await db.collection("companies").doc(companyId).get();
        return snap.exists ? snap.data() : null;
      },
      saveBilling: async (companyId, patch, stamp) => {
        const ref = db.collection("companies").doc(companyId);
        return db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) return { skipped: "missing-company" };
          const merged = mergeBilling(snap.data().billing || {}, patch.billing, stamp);
          if (merged.skipped) return merged;
          tx.update(ref, {
            ...(patch.plan ? { plan: patch.plan } : {}),
            billing: merged.billing,
          });
          return {};
        });
      },
      onReferral: async ({ event, companyId, paid }) => {
        let stripe = null;
        const getStripe = async () => {
          if (!stripe) stripe = await testStripe();
          return stripe;
        };
        const lazy = {
          coupons: {
            retrieve: async (...args) => (await getStripe()).coupons.retrieve(...args),
            create: async (...args) => (await getStripe()).coupons.create(...args),
          },
          subscriptions: {
            retrieve: async (...args) => (await getStripe()).subscriptions.retrieve(...args),
            update: async (...args) => (await getStripe()).subscriptions.update(...args),
          },
        };
        await handleReferralWebhookEvent({
          event,
          paid,
          companyId,
          now: new Date().toISOString(),
          store: referralStore(db),
          stripe: lazy,
        });
      },
    });
    res.status(outcome.status).json(outcome.body);
  },
);

export const syncStripeStaff = onDocumentWritten(
  { document: "users/{uid}", region: INVITE_REGION, secrets: STRIPE_KEY_SECRETS },
  async event => {
    if (process.env.NODE_TEST_CONTEXT) return;
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    const ids = companiesTouchedByUser(before, after);
    if (!ids.length) return;
    ensureAdmin();
    const db = getFirestore();
    const stripe = await testStripe();
    for (const companyId of ids) {
      const snap = await db.collection("companies").doc(companyId).get();
      if (!snap.exists) continue;
      const staff = await db.collection("users").where("companyId", "==", companyId).get();
      await syncStaffQuantity({ companyId, company: snap.data(), staffCount: staff.size, stripe, prices: currentPrices() });
    }
  },
);

export const deleteCompanyAccount = onCall(
  { region: INVITE_REGION, secrets: STRIPE_KEY_SECRETS, invoker: "public", cors: true },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in.");
    ensureAdmin();
    const result = await deleteCompanyAccountData({
      companyId: request.data?.companyId,
      confirmName: request.data?.confirmName,
      auth: request.auth,
      now: Date.now(),
      // Existing Stripe integration only. cancelSubscriptionOnCompanyDeletion calls
      // subscriptions.cancel and does not create a charge.
      cancelSubscription: async subscriptionId => cancelSubscriptionOnCompanyDeletion({
        stripe: await stripeClient(),
        subscriptionId,
      }),
    });
    if (!result.ok) {
      const code = result.code === "unauthenticated" || result.code === "permission-denied" || result.code === "not-found"
        ? result.code
        : "failed-precondition";
      throw new HttpsError(code, deletionErrorMessage(result));
    }
    return { ok: true, companyId: result.companyId, counts: result.counts, stripe: result.stripe };
  },
);

export const veoliaReceiptGuard = onDocumentWritten(
  { document: "receipts/{rid}", region: "australia-southeast1" },
  async (event) => {
    const after = event.data?.after;
    if (!after) return;
    await applyVeoliaReceiptWrite(after);
  },
);

export const veoliaReimbursementGuard = onDocumentCreated(
  { document: "reimbursements/{id}", region: "australia-southeast1" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    ensureAdmin();
    const db = getFirestore();
    await applyVeoliaReimbursementCreate(snap, async (id) => {
      const row = await db.collection("receipts").doc(String(id)).get();
      return row.exists ? (row.data() || null) : null;
    });
  },
);

export const photoInboxWorker = onDocumentCreated(
  { document: "photoInbox/{id}", region: "australia-southeast1" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    const result = handlePhotoIntake(data, {
      gmailEnabled: process.env.GMAIL_INTAKE_ENABLED === "true",
    });
    await snap.ref.set({
      status: "queued",
      holdReason: result.reason,
      resolvedTenantId: result.tenantId,
      ignoredClientTenantId: result.ignoredClientTenantId,
    }, { merge: true });
  },
);
