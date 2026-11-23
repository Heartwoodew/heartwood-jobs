// Support tickets. Pure planning: no Firebase import, no network.
// A new supportTickets document tells the platform owner by push and by email.
// Mail uses the same Resend gate as invites: INVITE_EMAIL_ENABLED must be "true"
// and the caller must pass allowLiveMail. INVITE_EMAIL_ALLOW_TO still limits
// recipients (tests use callup932+). A TEST company never sends a real email.
// SUPPORT_TICKET_EMAIL is a comma-separated list. When it is unset, mail goes
// to admin@callupapp.com.au and alex@heartwoodew.com.

import { ALEX_UID, fcmMessage, staleTargets, truncatePush, PUSH_ORIGINS } from "./chat-push.js";
import { allowPrefixes } from "./shared/quote-public.js";

export { staleTargets };
export const SUPPORT_OWNER_UID = ALEX_UID;
export const DEFAULT_SUPPORT_TICKET_EMAIL = ["admin@callupapp.com.au", "alex@heartwoodew.com"].join(",");
export const SUPPORT_FROM = "CallUp <noreply@callupapp.com.au>";
export const SUPPORT_APP_ORIGIN = "https://app.callupapp.com.au";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function supportTicketRecipients(env = {}) {
  const raw = env.SUPPORT_TICKET_EMAIL;
  const source = raw == null || String(raw).trim() === "" ? DEFAULT_SUPPORT_TICKET_EMAIL : String(raw);
  const seen = new Set();
  const out = [];
  for (const part of source.split(",")) {
    const addr = part.trim().toLowerCase();
    if (!addr || seen.has(addr) || addr.length > 120 || !EMAIL_RE.test(addr)) continue;
    seen.add(addr);
    out.push(addr);
    if (out.length >= 5) break;
  }
  return out;
}

export function supportOpenUrl(origin, ticketId) {
  const base = PUSH_ORIGINS.includes(origin) ? origin : SUPPORT_APP_ORIGIN;
  return base.replace(/\/$/, "") + "/app/?ticket=" + encodeURIComponent(String(ticketId || ""));
}

// Held mail is not sent. isTest wins over the kill switch so a test company
// never reaches Resend, even when live mail is switched on.
export function supportMailGate(recipients, env = {}, { allowLiveMail = false, isTest = false } = {}) {
  if (isTest) return { held: true, reason: "test-company", to: [] };
  const list = Array.isArray(recipients) ? recipients.filter(addr => typeof addr === "string" && EMAIL_RE.test(addr)) : [];
  if (!list.length) return { held: true, reason: "email", to: [] };
  const enabled = env.INVITE_EMAIL_ENABLED === "true" && allowLiveMail === true;
  if (!enabled) return { held: true, reason: "email-disabled", to: [] };
  const allow = allowPrefixes(env);
  const to = allow.length ? list.filter(addr => allow.some(prefix => addr.startsWith(prefix))) : list.slice();
  if (!to.length) return { held: true, reason: "allow-list", to: [] };
  return { held: false, reason: "send", to };
}

export function supportEmailMessage(ticket, { to, screenshotUrl = "" } = {}) {
  const id = String((ticket && ticket.id) || "");
  const link = supportOpenUrl(SUPPORT_APP_ORIGIN, id);
  const shot = screenshotUrl
    ? `Screenshot: ${screenshotUrl}`
    : (ticket && ticket.screenshotPath ? "A screenshot is on the ticket in Master." : "No screenshot.");
  const lines = [
    `Support ticket ${id}`,
    "",
    `Subject: ${ticket && ticket.subject || ""}`,
    "",
    String((ticket && ticket.description) || ""),
    "",
    `From: ${ticket && ticket.name || ""} <${ticket && ticket.email || ""}>`,
    `Role: ${ticket && ticket.role || ""}`,
    `Company: ${ticket && ticket.companyName || ""} (${ticket && ticket.companyId || ""})`,
    `User: ${ticket && ticket.uid || ""}`,
    `App: ${ticket && ticket.appVersion || ""}`,
    `Service worker: ${ticket && ticket.swVersion || ""}`,
    `Page: ${ticket && ticket.page || ""}`,
    `Browser: ${ticket && ticket.userAgent || ""}`,
    "",
    `Open the ticket: ${link}`,
    shot,
  ];
  const subject = `CallUp ticket: ${String((ticket && ticket.subject) || "Support").replace(/[\r\n]+/g, " ").trim()}`.slice(0, 120);
  return {
    link,
    payload: {
      from: SUPPORT_FROM,
      to: to || [],
      subject,
      text: lines.join("\n").slice(0, 20000),
    },
  };
}

export function supportPushMessages(tokens, ticket) {
  const id = String((ticket && ticket.id) || "");
  const body = truncatePush(String((ticket && ticket.subject) || "New support ticket"), 100);
  const title = "CallUp support";
  const out = [];
  for (const row of tokens || []) {
    if (!row || typeof row.token !== "string" || row.token.length < 20 || row.token.length > 4096) continue;
    const url = supportOpenUrl(row.origin, id);
    const target = { uid: SUPPORT_OWNER_UID, tokenId: String(row.id || ""), token: row.token };
    out.push({
      target,
      message: fcmMessage(target, {
        url,
        data: {
          kind: "support",
          title,
          body,
          url,
          ticketId: id,
          companyId: String((ticket && ticket.companyId) || ""),
          tag: ("support-" + id).slice(0, 80),
        },
      }),
    });
  }
  return out;
}

export function notifyPatch(result = {}) {
  return {
    email: String(result.emailReason || "failed").slice(0, 40),
    push: String(result.pushReason || "failed").slice(0, 40),
    at: String(result.at || "").slice(0, 40),
  };
}

function companyIsTest(company) {
  return !!(company && company.isTest === true);
}

export async function deliverSupportTicket(ticket, deps = {}) {
  const env = deps.env || {};
  const id = String((ticket && ticket.id) || "");
  const at = typeof deps.now === "function" ? deps.now() : new Date().toISOString();
  if (!id || !ticket) return { emailReason: "invalid", pushReason: "skipped", at, sent: [] };
  const isTest = companyIsTest(deps.company);
  const gate = supportMailGate(supportTicketRecipients(env), env, {
    allowLiveMail: deps.allowLiveMail === true,
    isTest,
  });
  let emailReason = gate.held ? gate.reason : "failed";
  let sent = [];
  if (!gate.held) {
    if (env.NODE_TEST_CONTEXT && gate.to.some(addr => !addr.startsWith("callup932+"))) {
      throw new Error("refusing live support email under test: recipients must be callup932+ addresses");
    }
    let screenshotUrl = "";
    if (ticket.screenshotPath && typeof deps.signScreenshot === "function") {
      try { screenshotUrl = String(await deps.signScreenshot(ticket.screenshotPath) || ""); }
      catch { screenshotUrl = ""; }
    }
    const message = supportEmailMessage(ticket, { to: gate.to, screenshotUrl });
    if (typeof deps.sendResend !== "function") emailReason = "no-sender";
    else {
      const result = await deps.sendResend(message.payload);
      if (result && result.ok) {
        emailReason = "sent";
        sent = gate.to.slice();
      } else emailReason = "failed";
    }
  }
  const pushes = supportPushMessages(deps.tokens || [], ticket);
  let pushReason = pushes.length ? "no-sender" : "none";
  if (pushes.length && typeof deps.sendEach === "function") {
    try {
      const result = await deps.sendEach(pushes.map(row => row.message));
      const responses = (result && result.responses) || [];
      const drop = staleTargets(responses, pushes.map(row => row.target));
      if (typeof deps.deleteToken === "function") {
        for (const target of drop) {
          try { await deps.deleteToken(target); } catch { /* the next ticket tries again */ }
        }
      }
      const failed = responses.filter(row => row && row.success === false).length;
      pushReason = responses.length && failed >= pushes.length ? "failed" : "sent";
    } catch {
      pushReason = "failed";
    }
  }
  return { emailReason, pushReason, at, sent };
}
