/**
 * CallUp Base workers for the existing Firebase project.
 * Do not deploy from this branch. cloud/scripts/refuse-live-deploy.js blocks firebase deploy.
 *
 * photoInboxWorker only marks a new photoInbox document as held.
 * It does not read Gmail and does not write job or Xero documents.
 *
 * Retention is exported as retentionSweepHandler and is NOT scheduled.
 * Xero processing is not imported. See pro/xero-queue.js.
 */
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { handlePhotoIntake } from "./lib/photo-intake.js";

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
