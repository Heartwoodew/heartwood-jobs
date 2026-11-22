// Resend inbound webhook for per-company job-email forwarding.
// Verifies the Svix signature, loads the message, and stores a draft only
// when the sender (or the original sender inside a forward) is one of that
// company's saved supervisors. Unmatched senders are logged and not turned
// into jobs. Forwarding confirmation codes are stored for the admin.
// This file does not send email.
//
// DNS is not changed here. Do not point callupapp.com.au (the sending domain)
// at Resend. Receiving uses the subdomain inbound.callupapp.com.au.
// When a person turns it on, confirm the records in the Resend dashboard:
//   MX   inbound.callupapp.com.au   priority 10   inbound-smtp.resend.com
//   TXT  the verification value Resend shows for that host
// After a human deploys inboundEmailWebhook (not part of this change):
//   https://australia-southeast1-heartwood-9f37f.cloudfunctions.net/inboundEmailWebhook
// Event: email.received
// Secret: RESEND_INBOUND_WEBHOOK_SECRET (Svix whsec_). Never log it.
// The body is read with the existing RESEND_API_KEY. Builder portal login
// import is a later phase and is not handled here.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  decideInbound,
  recipientLocalParts,
} from "./shared/inbound-forward.js";

const MAX_SKEW_MS = 5 * 60 * 1000;
const RECEIVING_URL = "https://api.resend.com/emails/receiving/";

function rawText(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody.toString("utf8");
  if (typeof rawBody === "string") return rawBody;
  return "";
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === wanted) return Array.isArray(value) ? value[0] : String(value || "");
  }
  return "";
}

export function resendSignatureFor({ id, timestamp, rawBody, secret }) {
  const text = rawText(rawBody);
  const key = Buffer.from(String(secret || "").replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${text}`).digest("base64");
}

export function verifyResendWebhook({ rawBody, headers, secret, now = Date.now() }) {
  const text = rawText(rawBody);
  const id = headerValue(headers, "svix-id") || headerValue(headers, "webhook-id");
  const timestamp = headerValue(headers, "svix-timestamp") || headerValue(headers, "webhook-timestamp");
  const signature = headerValue(headers, "svix-signature") || headerValue(headers, "webhook-signature");
  if (!id || !timestamp || !signature || !secret || !text) {
    const err = new Error("invalid-signature");
    throw err;
  }
  const seconds = Number(timestamp);
  const age = Math.abs(now - seconds * 1000);
  if (!Number.isFinite(seconds) || !Number.isFinite(age) || age > MAX_SKEW_MS) {
    throw new Error("invalid-signature");
  }
  const expected = Buffer.from(resendSignatureFor({ id, timestamp, rawBody: text, secret }));
  const parts = String(signature).split(" ").map(p => p.trim()).filter(p => p.startsWith("v1,"));
  const match = parts.some(part => {
    const right = Buffer.from(part.slice(3));
    return expected.length === right.length && timingSafeEqual(expected, right);
  });
  if (!match) throw new Error("invalid-signature");
  let event;
  try {
    event = JSON.parse(text);
  } catch {
    throw new Error("invalid-signature");
  }
  if (!event || typeof event !== "object" || typeof event.type !== "string") throw new Error("invalid-signature");
  return event;
}

export async function fetchResendReceived(emailId, apiKey, fetchImpl = fetch) {
  if (!apiKey) {
    const err = new Error("resend-key-missing");
    err.status = 503;
    throw err;
  }
  const res = await fetchImpl(RECEIVING_URL + encodeURIComponent(emailId), {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const err = new Error("resend-fetch-" + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function asList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function sha256Id(material) {
  if (!material) return "";
  return createHash("sha256").update(material).digest("hex");
}

export async function handleInboundWebhook({
  rawBody,
  headers,
  secret,
  now = Date.now(),
  apiKey = "",
  fetchEmail,
  findRoute,
  loadSupervisors,
  saveResult,
  log = () => {},
  today = "",
}) {
  let event;
  try {
    event = verifyResendWebhook({ rawBody, headers, secret, now });
  } catch {
    return { status: 401, body: { error: "invalid-signature" } };
  }
  if (event.type !== "email.received") return { status: 200, body: { received: true, skipped: event.type || "ignored" } };
  const data = event.data || {};
  const messageId = String(data.email_id || data.emailId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(messageId)) return { status: 400, body: { error: "missing-email-id" } };
  const locals = recipientLocalParts([...asList(data.to), ...asList(data.cc), ...asList(data.bcc)]);
  let route = null;
  for (const local of locals) {
    route = await findRoute(local);
    if (route && route.companyId) break;
    route = null;
  }
  if (!route) {
    log("inbound ignored", { reason: "unknown-recipient", messageId });
    return { status: 200, body: { received: true, skipped: "unknown-recipient" } };
  }
  let content = {
    text: data.text || "",
    html: data.html || "",
    headers: data.headers || {},
  };
  if (!content.text && !content.html) {
    try {
      const loader = fetchEmail || (id => fetchResendReceived(id, apiKey));
      const fetched = await loader(messageId);
      content = {
        text: fetched.text || "",
        html: fetched.html || "",
        headers: fetched.headers || content.headers,
        replyTo: fetched.reply_to || fetched.replyTo || "",
      };
    } catch (err) {
      const status = err && err.status;
      log("inbound fetch failed", { messageId, status: status || "error" });
      return { status: status === 404 ? 200 : 503, body: { error: status === 404 ? "not-found" : "fetch-failed" } };
    }
  }
  const supervisors = await loadSupervisors(route.companyId);
  const decision = decideInbound({
    companyId: route.companyId,
    messageId,
    from: data.from || "",
    replyTo: content.replyTo || data.reply_to || "",
    subject: data.subject || "",
    text: content.text,
    html: content.html,
    headers: content.headers,
    rfcMessageId: data.message_id || data.messageId || "",
    attachments: data.attachments || [],
    supervisors,
    receivedAt: data.created_at || new Date(now).toISOString(),
    today,
  });
  decision.seenId = sha256Id(decision.rfcMaterial);
  if (decision.kind === "ignored") {
    log("inbound ignored", {
      companyId: route.companyId,
      messageId,
      reason: decision.reason,
      from: decision.mail.fromEmail || "",
    });
  }
  try {
    const saved = await saveResult(decision);
    return { status: 200, body: { received: true, kind: saved && saved.duplicate ? "duplicate" : decision.kind, companyId: route.companyId } };
  } catch {
    log("inbound save failed", { messageId, companyId: route.companyId });
    return { status: 503, body: { error: "save-failed" } };
  }
}

// Firestore + Storage write. Admin SDK only. A second delivery of the same
// Resend id, or the same RFC Message-ID for that company, does not create
// another draft. The body object is rewritten on a retry so a failed upload
// still lands.
export async function saveInboundDecision(db, bucket, decision) {
  const companyId = decision.mail.companyId;
  const messageId = decision.mail.messageId;
  const mailRef = db.collection("companies").doc(companyId).collection("inboundMail").doc(messageId);
  const seenRef = decision.seenId ? db.collection("inboundSeen").doc(decision.seenId) : null;
  const draftRef = decision.draftId
    ? db.collection("companies").doc(companyId).collection("jobDrafts").doc(decision.draftId)
    : null;
  const result = await db.runTransaction(async tx => {
    const mail = await tx.get(mailRef);
    if (mail.exists) return { duplicate: true };
    if (seenRef) {
      const seen = await tx.get(seenRef);
      if (seen.exists) {
        tx.set(mailRef, { ...decision.mail, kind: "duplicate", reason: "duplicate-message" });
        return { duplicate: true, stored: "seen" };
      }
      tx.set(seenRef, { companyId, messageId, createdAt: new Date() });
    }
    tx.set(mailRef, { ...decision.mail, receivedAt: new Date() });
    if (draftRef && decision.draft) tx.set(draftRef, { ...decision.draft, createdAt: new Date() });
    return { duplicate: false };
  });
  if (decision.bodyText && bucket) {
    await bucket.file(`companies/${companyId}/inbound/${messageId}/body.txt`).save(Buffer.from(decision.bodyText, "utf8"), {
      contentType: "text/plain; charset=utf-8",
      resumable: false,
      metadata: { metadata: { purpose: "inbound-mail", companyId } },
    });
  }
  return result;
}
