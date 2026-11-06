// Incoming email-linked photo intake.
// Gmail is not called. GMAIL_INTAKE_ENABLED does not create a mailbox client.
// The mailbox→tenant map is server configuration. A tenantId on the document is ignored.
// Nothing here writes jobs.photosEmailed* or touches Gmail records.

import { HEARTWOOD_TENANT } from "../shared/cloud-storage.js";

export const MAILBOX_TENANTS = Object.freeze({
  "alex@heartwoodew.com": HEARTWOOD_TENANT,
});

const JOB_SUBJECT = /\[Job Photos\]\s*Job\s*#\s*([A-Za-z0-9-]+)/i;

export function handlePhotoIntake(doc, deps = {}) {
  const data = doc || {};
  const mailbox = String(data.mailbox || "").trim().toLowerCase();
  const tenantId = MAILBOX_TENANTS[mailbox] || null;
  const ignoredClientTenantId = data.tenantId && data.tenantId !== tenantId ? data.tenantId : null;
  if (!tenantId) {
    return {
      action: "hold",
      reason: "unknown-mailbox",
      tenantId: null,
      ignoredClientTenantId,
      jobWrites: [],
      gmailCalls: 0,
    };
  }
  const subject = JOB_SUBJECT.exec(String(data.subject || ""));
  if (!subject) {
    return {
      action: "hold",
      reason: "not-job-photo",
      tenantId,
      ignoredClientTenantId,
      jobWrites: [],
      gmailCalls: 0,
    };
  }
  if (deps.gmailEnabled === true) {
    return {
      action: "hold",
      reason: "gmail-client-not-configured",
      tenantId,
      ignoredClientTenantId,
      jobNo: subject[1],
      jobWrites: [],
      gmailCalls: 0,
    };
  }
  return {
    action: "hold",
    reason: "gmail-rights-not-enabled",
    tenantId,
    ignoredClientTenantId,
    jobNo: subject[1],
    jobWrites: [],
    gmailCalls: 0,
  };
}
