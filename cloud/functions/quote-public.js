// Public quote page and the admin send. Mail uses the existing Resend path
// (noreply@callupapp.com.au). Tests pass a mock fetch. Nothing here is deployed
// by this branch. Do not log the API key or the full token.
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { resendPayload, sendViaResend } from "./shared/staff-invites.js";
import {
  acceptCustomerQuote, callerIsAdmin, clientIp, newPublicToken, planQuoteEmail, publicQuoteHtml, tokenOk, PUBLIC_QUOTE_ORIGIN,
} from "./shared/quote-public.js";

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const REGION = "australia-southeast1";
function ensureAdmin() {
  if (!getApps().some(app => app.name === "[DEFAULT]")) initializeApp();
}

function companyOf(data) {
  if (!data) return "";
  if (typeof data.companyId === "string" && data.companyId) return data.companyId;
  if (typeof data.tenantId === "string" && data.tenantId) return data.tenantId;
  return "heartwood";
}

export async function sendCustomerQuoteWork({ uid, quoteId, to, origin }, deps) {
  if (!uid) return { ok: false, code: "unauthenticated", message: "Sign in as an admin." };
  const quote = await deps.loadQuote(quoteId);
  if (!quote) return { ok: false, code: "not-found", message: "That quote is not there." };
  const companyId = companyOf(quote);
  const profile = await deps.loadProfile(uid);
  if (!callerIsAdmin(uid, profile, companyId)) return { ok: false, code: "permission-denied", message: "Only an admin can send a quote." };
  const company = await deps.loadCompany(companyId);
  const token = tokenOk(quote.publicToken) ? quote.publicToken : newPublicToken();
  if (token !== quote.publicToken) await deps.saveToken(quoteId, token);
  const plan = planQuoteEmail({
    company, quote, to, token, origin: origin || deps.origin || PUBLIC_QUOTE_ORIGIN,
    env: deps.env || {}, allowLiveMail: deps.allowLiveMail === true,
  });
  if (!plan.ok) return { ok: false, code: "invalid-argument", message: plan.reason === "allow-list" ? "That address is not allowed in this test." : "Enter the customer's email." };
  if (!plan.held) {
    const result = await deps.send(resendPayload(plan.message));
    if (!result || result.ok === false) return { ok: false, code: "failed-precondition", message: "The email was not sent." };
  }
  return { ok: true, held: plan.held === true, link: plan.link };
}

export async function readPublicQuote(token, deps) {
  if (!tokenOk(token)) return { status: 404, body: "This link is not valid." };
  const quote = await deps.findByToken(token);
  if (!quote) return { status: 404, body: "This link is not valid." };
  const company = await deps.loadCompany(companyOf(quote));
  return { status: 200, quote, company, html: publicQuoteHtml({ company, quote, accepted: quote.customerAccepted, token }) };
}

export async function postPublicAccept({ token, name, ip, userAgent, now }, deps) {
  const found = await readPublicQuote(token, deps);
  if (!found.quote) return { status: found.status, body: found.body };
  const decision = acceptCustomerQuote({ quote: found.quote, name, ip, userAgent, now });
  if (!decision.ok) return { status: 400, body: "Enter your name to accept." };
  if (!decision.already) await deps.saveAcceptance(found.quote.id, decision.customerAccepted);
  const quote = { ...found.quote, customerAccepted: decision.customerAccepted };
  return {
    status: 200,
    html: publicQuoteHtml({ company: found.company, quote, accepted: decision.customerAccepted, token }),
  };
}

function tokenFromRequest(req) {
  const path = String(req.path || req.url || "");
  const match = path.match(/\/q\/([A-Za-z0-9_-]{32,80})/);
  if (match) return match[1];
  const query = req.query && (req.query.t || req.query.token);
  return tokenOk(query) ? String(query) : "";
}

export const sendCustomerQuote = onCall(
  { region: REGION, secrets: [RESEND_API_KEY], timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    if (process.env.NODE_TEST_CONTEXT) throw new HttpsError("failed-precondition", "Quote email is off in tests.");
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in as an admin.");
    ensureAdmin();
    const db = getFirestore();
    const result = await sendCustomerQuoteWork({
      uid: request.auth.uid,
      quoteId: request.data && request.data.quoteId,
      to: request.data && request.data.to,
      origin: PUBLIC_QUOTE_ORIGIN,
    }, {
      env: process.env,
      allowLiveMail: process.env.INVITE_EMAIL_ENABLED === "true",
      loadQuote: async id => {
        const snap = await db.collection("quotes").doc(String(id || "")).get();
        return snap.exists ? { id: snap.id, ...snap.data() } : null;
      },
      loadProfile: async uid => {
        const snap = await db.collection("users").doc(uid).get();
        return snap.exists ? snap.data() : null;
      },
      loadCompany: async companyId => {
        const snap = await db.collection("companies").doc(companyId).get();
        return snap.exists ? snap.data() : { name: companyId === "heartwood" ? "Heartwood Earthworx" : "CallUp" };
      },
      saveToken: (id, token) => db.collection("quotes").doc(id).set({ publicToken: token }, { merge: true }),
      send: payload => sendViaResend({ apiKey: RESEND_API_KEY.value(), payload, fetchImpl: fetch }),
    });
    if (!result.ok) throw new HttpsError(result.code || "failed-precondition", result.message);
    return { ok: true, held: result.held === true };
  },
);

export const publicQuotePage = onRequest(
  { region: REGION, invoker: "public", timeoutSeconds: 30, memory: "256MiB" },
  async (req, res) => {
    if (process.env.NODE_TEST_CONTEXT) {
      res.status(503).send("disabled");
      return;
    }
    ensureAdmin();
    const db = getFirestore();
    const deps = {
      findByToken: async token => {
        const snap = await db.collection("quotes").where("publicToken", "==", token).limit(2).get();
        if (snap.size !== 1) return null;
        const doc = snap.docs[0];
        return { id: doc.id, ...doc.data() };
      },
      loadCompany: async companyId => {
        const snap = await db.collection("companies").doc(companyId).get();
        return snap.exists ? snap.data() : {};
      },
      saveAcceptance: (id, customerAccepted) => db.collection("quotes").doc(id).set({
        customerAccepted: { ...customerAccepted, acceptedAt: FieldValue.serverTimestamp(), acceptedAtIso: customerAccepted.acceptedAt },
      }, { merge: true }),
    };
    const token = tokenFromRequest(req);
    if (req.method === "POST") {
      const outcome = await postPublicAccept({
        token,
        name: req.body && req.body.name,
        ip: clientIp(req.headers, req.ip),
        userAgent: req.get ? req.get("user-agent") : "",
        now: new Date().toISOString(),
      }, deps);
      res.status(outcome.status).type("html").send(outcome.html || outcome.body || "");
      return;
    }
    const page = await readPublicQuote(token, deps);
    res.status(page.status).type(page.html ? "html" : "text").send(page.html || page.body || "");
  },
);
