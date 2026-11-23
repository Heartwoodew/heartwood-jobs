// Emails a certificate the office already saved. Uses the same Resend sender as
// other CallUp mail. Tests pass a mock and only callup932+ addresses when the
// allow list is set. Do not deploy from this branch. Do not log the API key.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { sendViaResend } from "./shared/staff-invites.js";
import { certificatesEnabled, planCertificateEmail, tradeIdsFromCompany } from "./shared/certificates.js";
import { callerIsAdmin } from "./shared/quote-public.js";

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const REGION = "australia-southeast1";

function ensureAdmin() {
  if (!getApps().some(app => app.name === "[DEFAULT]")) initializeApp();
}

export async function sendCertificateWork({ uid, to, fileName, pdfBase64, companyId }, deps) {
  const profile = await deps.loadProfile(uid);
  if (!callerIsAdmin(uid, profile, companyId)) return { ok: false, code: "permission-denied", message: "Only an admin can email a certificate." };
  const company = await deps.loadCompany(companyId);
  const stored = typeof deps.loadTrades === "function" ? await deps.loadTrades(companyId) : null;
  if (!certificatesEnabled(tradeIdsFromCompany(company, stored))) {
    return { ok: false, code: "failed-precondition", message: "Certificates are only for pest control." };
  }
  const plan = planCertificateEmail({
    to, company, job: deps.job || {}, fileName, pdfBase64,
    env: deps.env || {}, allowLiveMail: deps.allowLiveMail === true,
  });
  if (!plan.ok) return { ok: false, code: "invalid-argument", message: plan.reason === "allow-list" ? "That address is not allowed in this test." : "Enter the customer's email." };
  if (!plan.held) {
    const result = await deps.send(plan.payload);
    if (!result || result.ok === false) return { ok: false, code: "failed-precondition", message: "The email was not sent." };
  }
  return { ok: true, held: plan.held === true };
}

export const sendCertificateEmail = onCall(
  { region: REGION, secrets: [RESEND_API_KEY], timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    if (process.env.NODE_TEST_CONTEXT) throw new HttpsError("failed-precondition", "Certificate email is off in tests.");
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in as an admin.");
    ensureAdmin();
    const db = getFirestore();
    const data = request.data || {};
    const jobSnap = await db.collection("jobs").doc(String(data.jobId || "")).get();
    if (!jobSnap.exists) throw new HttpsError("not-found", "That job is not there.");
    const job = jobSnap.data();
    const companyId = job.companyId || job.tenantId || "heartwood";
    const result = await sendCertificateWork({
      uid: request.auth.uid,
      to: data.to,
      fileName: data.fileName,
      pdfBase64: data.pdfBase64,
      companyId,
    }, {
      env: process.env,
      allowLiveMail: process.env.INVITE_EMAIL_ENABLED === "true",
      job,
      loadProfile: async uid => {
        const snap = await db.collection("users").doc(uid).get();
        return snap.exists ? snap.data() : null;
      },
      loadCompany: async id => {
        const snap = await db.collection("companies").doc(id).get();
        return snap.exists ? snap.data() : {};
      },
      loadTrades: async id => {
        const snap = await db.collection("companyTrades").doc(id).get();
        return snap.exists ? snap.data() : null;
      },
      send: payload => sendViaResend({ apiKey: RESEND_API_KEY.value(), payload, fetchImpl: fetch }),
    });
    if (!result.ok) throw new HttpsError(result.code || "failed-precondition", result.message);
    return { ok: true, held: result.held === true };
  },
);
