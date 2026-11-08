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
 * helperAsk is read-only. It stays off unless HELPER_ENABLED=true.
 * See helper/DECISION.md. Do not deploy it from this branch.
 */
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { handlePhotoIntake } from "./lib/photo-intake.js";
import { authorizeCallable, handleHelperAsk } from "./helper/ask.js";
import { adminReader } from "./helper/reader.js";
import { createModelProvider } from "./helper/provider.js";

function ensureAdmin() {
  if (!getApps().length) initializeApp();
}

export const helperAsk = onCall(
  { region: "australia-southeast1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
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
    const result = await handleHelperAsk({
      auth: { uid: gate.uid },
      data: request.data,
      reader: adminReader(getFirestore()),
      model,
      enabled: process.env.HELPER_ENABLED === "true",
    });
    if (!result.ok) {
      const code = result.code === "invalid-argument" || result.code === "permission-denied" ? result.code : "permission-denied";
      throw new HttpsError(code, result.reply);
    }
    return { reply: result.reply, enabled: !!result.enabled, knowledge: result.knowledge || "placeholder" };
  },
);

export { retentionSweepHandler } from "./lib/retention-run.js";

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
