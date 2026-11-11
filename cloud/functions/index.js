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
 * role (operator or supervisor only). inviteEmailWorker queues mail.
 * INVITE_EMAIL_ENABLED must be the string "true" or the message is held in
 * inviteMail and nothing is sent. This file does not open an SMTP connection.
 *
 * helperAsk stays deployed and refuses every request. HELPER_ENABLED defaults
 * to "false", and HELPER_HARD_OFF returns before Auth, Firestore, or Vertex.
 * An environment change cannot turn it back on. See helper/DEPLOY.md.
 */
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { handlePhotoIntake } from "./lib/photo-intake.js";
import { runJobCleanup } from "./lib/job-cleanup-run.js";
import {
  acceptStaffInvite as acceptInvite,
  previewStaffInvite as previewInvite,
  queueInviteEmail,
  sendViaResend,
  shouldQueueInviteEmail,
  displayStatus,
  profileFromInvite,
} from "./shared/staff-invites.js";
import { authorizeCallable, handleHelperAsk } from "./helper/ask.js";
import { adminReader } from "./helper/reader.js";
import { createModelProvider, helperLiveEnabled } from "./helper/provider.js";
import { firestoreHelperStore } from "./helper/apply.js";
import {
  assertKeyForMode,
  handleCheckoutCall,
  stripeMode,
  STRIPE_API_VERSION,
  stripePrices,
  handlePortalCall,
  handleStripeWebhook,
  syncStaffQuantity,
  companiesTouchedByUser,
  mergeBilling,
} from "./billing/stripe-billing.js";

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
      const snap = await db.collection("users").doc(String(uid || "")).get();
      return { uid, profile: snap.exists ? (snap.data() || null) : null };
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
  const code = result && (result.code === "unauthenticated" || result.code === "permission-denied" || result.code === "not-found")
    ? result.code
    : "failed-precondition";
  throw new HttpsError(code, (result && result.reason) || "billing-failed");
}

export const createBillingCheckout = onCall(
  { region: INVITE_REGION, secrets: STRIPE_KEY_SECRETS },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "sign-in");
    const result = await handleCheckoutCall({
      uid: request.auth.uid,
      companyId: String(request.data?.companyId || ""),
      origin: request.data?.origin,
      getContext: billingContext,
      stripe: await testStripe(),
      prices: currentPrices(),
    });
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

// Clean up old jobs: admin button only, never scheduled. See lib/job-cleanup-run.js.
export const cleanupOldJobs = onCall(
  { region: INVITE_REGION, timeoutSeconds: 300, memory: "512MiB" },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "sign-in");
    ensureAdmin();
    let bucket = null;
    try { bucket = getStorage().bucket(); } catch { bucket = null; }
    const result = await runJobCleanup({ uid: request.auth.uid, data: request.data, db: getFirestore(), bucket });
    if (!result.ok) throw new HttpsError(result.code || "failed-precondition", result.reason || "cleanup-refused", result.blocked ? { blocked: result.blocked } : undefined);
    return result;
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
