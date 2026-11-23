// Per-company job import from a mailbox the company forwards to CallUp.
// Each company has one address at inbound.callupapp.com.au. The webhook
// (cloud/functions/inbound-email.js) matches the sender to that company's
// saved supervisors and stores a draft. An admin or office user approves
// the draft before it becomes a job. This file does not send email and
// does not write Firestore.
//
// DNS for inbound.callupapp.com.au is not changed here. Do not point the
// apex callupapp.com.au MX at Resend: that domain sends mail. When receiving
// is turned on, confirm the records in the Resend dashboard. The documented
// receiving records are an MX of priority 10 at inbound-smtp.resend.com for
// the host inbound.callupapp.com.au, plus the TXT record Resend shows.

import { parseInboxEmail } from "./inbox-import.js";

export const INBOUND_DOMAIN = "inbound.callupapp.com.au";
export const INBOUND_TOKEN_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const MONEY_KEYS = ["poAmount", "poAmountBasis", "poAmountSource", "quoteAmount", "poLookupCandidates", "invoiceAmount", "xeroCheck", "amountInc", "totalEx", "gst", "totalInc", "priceOverrides", "lines"];
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function stripPrices(text) {
  return String(text == null ? "" : text)
    .replace(/(?:A|AU)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:ex|inc|incl)\.?\s?GST)?/gi, "[price removed]")
    .replace(/\$/g, "");
}

export function htmlToText(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function emailsIn(value) {
  const out = [];
  const re = new RegExp(EMAIL_RE.source, "gi");
  let m;
  const s = String(value || "");
  while ((m = re.exec(s))) out.push(m[0].toLowerCase());
  return out;
}

export function normalizeSupervisorEmail(value) {
  const hit = emailsIn(value)[0] || "";
  if (!hit || hit.length > 120) return "";
  return hit;
}

export function inboundToken(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  if (arr.length < 8) return "";
  let out = "";
  for (let i = 0; i < 8; i++) out += INBOUND_TOKEN_ALPHABET[arr[i] % INBOUND_TOKEN_ALPHABET.length];
  return out;
}

export function inboundLocalPart(companyId, token) {
  const id = String(companyId || "").trim().toLowerCase();
  const suffix = String(token || "");
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return "";
  if (!/^[a-z0-9]{8}$/.test(suffix)) return "";
  return `${id}-${suffix}`;
}

export function inboundAddress(companyId, token) {
  const local = inboundLocalPart(companyId, token);
  return local ? `${local}@${INBOUND_DOMAIN}` : "";
}

export function recipientLocalParts(list, domain = INBOUND_DOMAIN) {
  const out = [];
  const host = String(domain || "").toLowerCase();
  for (const raw of list || []) {
    for (const email of emailsIn(raw)) {
      const at = email.lastIndexOf("@");
      if (at < 1) continue;
      if (email.slice(at + 1) !== host) continue;
      const local = email.slice(0, at);
      if (/^[a-z0-9][a-z0-9-]{0,48}-[a-z0-9]{8}$/.test(local) && !out.includes(local)) out.push(local);
    }
  }
  return out;
}

function addEmails(bag, value) {
  if (typeof value === "string") emailsIn(value).forEach(e => bag.add(e));
  else if (value && typeof value === "object") {
    emailsIn(value.email).forEach(e => bag.add(e));
    emailsIn(value.mail).forEach(e => bag.add(e));
  }
}

// Saved supervisors live on meta/supervisors (Heartwood) or companyMeta/{id}_supervisors.
// emails[] is the list the forwarding screen edits. remembered, byClient and byPo
// are the older maps (a string or {email,name}).
export function collectSupervisorEmails(doc) {
  const bag = new Set();
  const src = doc && typeof doc === "object" ? doc : {};
  if (Array.isArray(src.emails)) src.emails.forEach(v => addEmails(bag, v));
  for (const key of ["remembered", "byClient", "byPo"]) {
    const map = src[key];
    if (!map || typeof map !== "object") continue;
    for (const value of Object.values(map)) addEmails(bag, value);
  }
  return [...bag];
}

export function headerMap(headers) {
  const out = {};
  if (!headers) return out;
  if (Array.isArray(headers)) {
    for (const row of headers) {
      const name = String(row && (row.name || row.key) || "").trim().toLowerCase();
      const value = String(row && (row.value || row.val) || "");
      if (!name) continue;
      out[name] = out[name] ? `${out[name]}\n${value}` : value;
    }
    return out;
  }
  if (typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      out[String(key).trim().toLowerCase()] = Array.isArray(value) ? value.join("\n") : String(value ?? "");
    }
  }
  return out;
}

function forwardedRegion(text) {
  const src = String(text || "");
  const parts = src.split(/-{2,}\s*forwarded message\s*-{2,}|begin forwarded message:|-----original message-----|_{5,}\s*$/im);
  if (parts.length > 1) return parts.slice(1).join("\n");
  return src;
}

// Envelope From, then the original sender inside a forward (body and headers).
export function candidateSenders({ from = "", replyTo = "", headers = {}, text = "" } = {}) {
  const ordered = [];
  const push = value => {
    for (const email of emailsIn(value)) {
      if (!ordered.includes(email)) ordered.push(email);
    }
  };
  const region = forwardedRegion(text);
  const lines = region.match(/^\s*from:\s*.+$/gim) || [];
  for (const line of lines.slice(0, 4)) push(line);
  const map = headerMap(headers);
  for (const key of ["x-original-from", "x-original-sender", "resent-from", "reply-to"]) push(map[key]);
  push(replyTo);
  push(from);
  push(map.from);
  return ordered;
}

export function detectForwardVerification({ from = "", subject = "", text = "" } = {}) {
  const fromEmails = emailsIn(from);
  const fromBlob = fromEmails.join(" ");
  const blob = `${subject}\n${text}`;
  const gmail = /forwarding-noreply@google\.com/.test(fromBlob) || /@(google|googlemail)\.com$/.test(fromEmails[0] || "");
  const outlook = /@(outlook|hotmail|live|microsoft|office365)\./i.test(fromBlob) || /microsoft outlook/i.test(blob);
  const forwarding = /forwarding confirmation|confirm(?:\s+your)?\s+forwarding|verify your forwarding|forwarding address|has requested to automatically forward/i.test(blob);
  if (!forwarding) return null;
  if (!gmail && !outlook && !/confirmation code/i.test(blob)) return null;
  const code = (String(subject).match(/\(#(\d{4,12})\)/) || blob.match(/confirmation code[:\s#]+(\d{4,12})/i) || [])[1] || "";
  const urlMatch = blob.match(/https:\/\/[^\s<>"']+/i);
  let url = urlMatch ? urlMatch[0].replace(/[).,>]+$/, "") : "";
  if (!/^https:\/\/(?:mail\.google\.com|mail-settings\.google\.com|outlook\.live\.com|outlook\.office\.com|aka\.ms)\//i.test(url)) url = "";
  return {
    provider: gmail ? "gmail" : outlook ? "outlook" : "forwarding",
    code,
    url,
  };
}

function clip(value, max) {
  return stripPrices(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function previewOf(text, max) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function draftIdForMessage(messageId) {
  const clean = String(messageId || "").replace(/[^A-Za-z0-9]/g, "");
  return ("fwd" + clean).slice(0, 40);
}

export function jobIdForDraft(draft) {
  const id = String((draft && (draft.id || draft.draftId)) || "").replace(/[^A-Za-z0-9]/g, "");
  const body = (id.startsWith("fwd") ? id : "fwd" + id).slice(0, 40);
  return body.length >= 11 ? body : "";
}

function moneyFree(doc) {
  const out = { ...doc };
  for (const key of MONEY_KEYS) delete out[key];
  return out;
}

export function jobFromDraft(draft, { companyId = "", uid = "" } = {}) {
  const d = draft || {};
  const address = clip(d.address, 200);
  const client = clip(d.client, 120);
  if (!client || !address) return { ok: false, reason: "client-address" };
  const id = jobIdForDraft(d);
  if (!id) return { ok: false, reason: "draft-id" };
  const name = clip(d.supervisorName, 80);
  const email = normalizeSupervisorEmail(d.supervisorEmail);
  const job = moneyFree({
    client,
    address,
    type: clip(d.type || "other", 40) || "other",
    po: String(d.po || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 40),
    description: clip(d.description, 800),
    date: /^\d{4}-\d{2}-\d{2}$/.test(d.date || "") ? d.date : "",
    time: "07:00",
    durationHrs: 4,
    assigned: [],
    assignedNames: [],
    status: "Scheduled",
    notes: clip(d.notes, 800),
    loads: null,
    editedInApp: true,
    source: "inbound-forward",
    log: [],
    companyId: String(companyId || ""),
    draftId: String(d.id || d.draftId || id).slice(0, 40),
    inboundMessageId: String(d.messageId || "").slice(0, 128),
    createdBy: String(uid || ""),
  });
  if (d.costCode) job.costCode = clip(d.costCode, 8);
  if (name) {
    job.supervisorName = name;
    job.contactName = name;
  }
  if (email) job.supervisorEmail = email;
  if (d.supervisorPhone) job.contactPhone = clip(d.supervisorPhone, 40);
  return { ok: true, id, job };
}

function messageText({ text = "", html = "" } = {}) {
  const plain = String(text || "").trim();
  if (plain) return plain.slice(0, 120000);
  return htmlToText(html).slice(0, 120000);
}

export function decideInbound({
  companyId,
  messageId,
  from = "",
  replyTo = "",
  subject = "",
  text = "",
  html = "",
  headers = {},
  rfcMessageId = "",
  attachments = [],
  supervisors = {},
  receivedAt = "",
  today = "",
} = {}) {
  const id = String(messageId || "").trim();
  const company = String(companyId || "").trim();
  const body = messageText({ text, html });
  const files = (attachments || []).map(a => typeof a === "string" ? a : (a && a.filename) || "").filter(Boolean).slice(0, 10);
  const senders = candidateSenders({ from, replyTo, headers, text: body });
  const saved = new Set(collectSupervisorEmails(supervisors));
  const verification = detectForwardVerification({ from, subject, text: body });
  const rfc = String(rfcMessageId || headerMap(headers)["message-id"] || "").trim().slice(0, 200);
  const base = {
    companyId: company,
    messageId: id,
    fromEmail: senders.at(-1) || emailsIn(from)[0] || "",
    subject: clip(subject, 200),
    rfcMessageId: rfc,
    provider: "resend",
  };
  if (verification) {
    return {
      kind: "verification",
      reason: "forwarding-verification",
      matchedEmail: "",
      rfcMaterial: rfc ? `${company}\n${rfc.toLowerCase()}` : "",
      bodyText: body.slice(0, 20000),
      draft: null,
      draftId: "",
      mail: {
        ...base,
        kind: "verification",
        reason: "forwarding-verification",
        verificationProvider: verification.provider,
        verificationCode: verification.code,
        verificationUrl: verification.url,
        textPreview: previewOf(body, 4000),
        originalFromEmail: senders[0] || "",
      },
    };
  }
  const matched = senders.find(email => saved.has(email)) || "";
  if (!matched) {
    return {
      kind: "ignored",
      reason: "unmatched-sender",
      matchedEmail: "",
      rfcMaterial: rfc ? `${company}\n${rfc.toLowerCase()}` : "",
      bodyText: "",
      draft: null,
      draftId: "",
      mail: {
        ...base,
        kind: "ignored",
        reason: "unmatched-sender",
        originalFromEmail: senders[0] || "",
        textPreview: previewOf(`${base.fromEmail} ${base.subject}`, 180),
      },
    };
  }
  const parsed = parseInboxEmail({
    id,
    subject,
    body,
    text: body,
    fromEmail: matched,
    fromName: "",
    date: receivedAt,
    attachments: files,
  }, { today });
  const draftId = draftIdForMessage(id);
  const warnings = [...(parsed.warnings || [])];
  if (!parsed.jobLike) warnings.push("This email does not look like a job. Check every field before you approve it.");
  const draft = moneyFree({
    companyId: company,
    status: "pending",
    source: "inbound-forward",
    messageId: id,
    client: clip(parsed.client, 120),
    lot: clip(parsed.lot, 20),
    street: clip(parsed.street, 120),
    suburb: clip(parsed.suburb, 80),
    address: clip(parsed.address, 200),
    type: clip(parsed.type || "other", 40) || "other",
    typeLabel: clip(parsed.typeLabel, 80),
    costCode: clip(parsed.costCode, 8),
    date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || "") ? parsed.date : "",
    po: String(parsed.po || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 40),
    supervisorName: clip(parsed.supervisorName, 80),
    supervisorEmail: normalizeSupervisorEmail(parsed.supervisorEmail || matched),
    supervisorPhone: clip(parsed.supervisorPhone, 40),
    notes: clip(parsed.notes, 800),
    description: clip(parsed.description, 800),
    warnings: warnings.map(w => clip(w, 400)).slice(0, 8),
    subject: clip(subject, 200),
    fromEmail: matched,
    jobLike: parsed.jobLike === true,
  });
  return {
    kind: "draft",
    reason: "matched-supervisor",
    matchedEmail: matched,
    rfcMaterial: rfc ? `${company}\n${rfc.toLowerCase()}` : "",
    bodyText: body.slice(0, 120000),
    draft,
    draftId,
    mail: {
      ...base,
      kind: "draft",
      reason: "matched-supervisor",
      matchedEmail: matched,
      originalFromEmail: matched,
      draftId,
      textPreview: previewOf(body, 4000),
      attachmentNames: files,
    },
  };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function forwardScreenHtml(state = {}) {
  const address = String(state.address || "");
  const emails = Array.isArray(state.emails) ? state.emails : [];
  const verifications = (state.verifications || []).filter(v => v && !v.dismissed);
  const drafts = (state.drafts || []).filter(d => d && d.status !== "discarded" && d.status !== "approved");
  const ignored = state.ignored || [];
  const addressBlock = address
    ? `<div class="fwd-addr"><code id="fwdaddr">${esc(address)}</code><button type="button" class="sm-btn" id="fwdcopy" data-address="${esc(address)}">Copy</button></div>`
    : state.canMint
      ? `<button type="button" class="sm-btn primary" id="fwdmint">Create forwarding address</button>`
      : `<p>An admin needs to create this company's forwarding address.</p>`;
  const verifyBlock = verifications.map(v => `<article class="fwd-card">
      <b>${esc(v.verificationProvider === "outlook" ? "Outlook" : "Gmail")} forwarding confirmation</b>
      <p class="sub">${esc(v.subject || "Confirm this address in your mailbox settings.")}</p>
      ${v.verificationCode ? `<p class="fwd-code">${esc(v.verificationCode)}</p>` : ""}
      ${v.verificationUrl ? `<p><a href="${esc(v.verificationUrl)}">Open the confirmation link</a></p>` : ""}
      <button type="button" class="sm-btn" data-fwd-dismiss="${esc(v.id)}">Hide</button>
    </article>`).join("");
  const emailList = emails.length
    ? `<ul class="fwd-list">${emails.map(e => `<li><code>${esc(e)}</code>${state.canEditSupervisors ? ` <button type="button" class="sm-btn" data-fwd-remove="${esc(e)}">Remove</button>` : ""}</li>`).join("")}</ul>`
    : `<p class="sub">No supervisor emails yet. Add the people whose job emails should become drafts.</p>`;
  const editor = state.canEditSupervisors
    ? `<form id="fwdsup" class="row"><label>Supervisor email<input name="email" type="email" maxlength="120" placeholder="callup932+supervisor@gmail.com" required></label><button class="sm-btn" type="submit">Add</button></form>`
    : "";
  const draftCards = drafts.map(d => `<article class="fwd-card" data-fwd-draft="${esc(d.id)}">
      <b>${esc(d.subject || d.client || "Draft job")}</b>
      <p class="sub">From ${esc(d.fromEmail || d.supervisorEmail || "")}${d.jobLike === false ? " · check before approving" : ""}</p>
      ${(d.warnings || []).map(w => `<p class="iwarn">${esc(w)}</p>`).join("")}
      <div class="row">
        <label>Client<input data-fwd-id="${esc(d.id)}" data-fwd-field="client" value="${esc(d.client || "")}" maxlength="120"></label>
        <label>Address<input data-fwd-id="${esc(d.id)}" data-fwd-field="address" value="${esc(d.address || "")}" maxlength="200"></label>
      </div>
      <div class="row">
        <label>Date<input data-fwd-id="${esc(d.id)}" data-fwd-field="date" type="date" value="${esc(d.date || "")}"></label>
        <label>PO<input data-fwd-id="${esc(d.id)}" data-fwd-field="po" value="${esc(d.po || "")}" maxlength="40"></label>
        <label>Category<input data-fwd-id="${esc(d.id)}" data-fwd-field="type" value="${esc(d.type || "")}" maxlength="40"></label>
      </div>
      <div class="row">
        <label>Supervisor<input data-fwd-id="${esc(d.id)}" data-fwd-field="supervisorName" value="${esc(d.supervisorName || "")}" maxlength="80"></label>
        <label>Email<input data-fwd-id="${esc(d.id)}" data-fwd-field="supervisorEmail" value="${esc(d.supervisorEmail || "")}" maxlength="120"></label>
        <label>Phone<input data-fwd-id="${esc(d.id)}" data-fwd-field="supervisorPhone" value="${esc(d.supervisorPhone || "")}" maxlength="40"></label>
      </div>
      <label>Notes<textarea data-fwd-id="${esc(d.id)}" data-fwd-field="notes" rows="2" maxlength="800">${esc(d.notes || "")}</textarea></label>
      <div class="row">
        ${state.canApprove ? `<button type="button" class="sm-btn primary" data-fwd-approve="${esc(d.id)}">Approve</button>` : `<span class="sub">An admin approves this before it becomes a job.</span>`}
        <button type="button" class="sm-btn" data-fwd-discard="${esc(d.id)}">Discard</button>
      </div>
    </article>`).join("");
  const ignoredBlock = ignored.slice(0, 10).map(row => `<li>${esc(row.fromEmail || "unknown sender")} — ${esc(row.subject || "no subject")} · not a saved supervisor</li>`).join("");
  return `<div class="sm-head"><h1>Job email</h1><span class="sub">Forward job emails to CallUp. Nothing becomes a job until someone here approves it.</span>
      <span class="headbtns"><button type="button" class="sm-btn" id="fwdrefresh">Refresh</button></span></div>
    <section class="pad">
      <h3>Forwarding address</h3>
      ${state.loading ? `<p class="sub">Loading…</p>` : addressBlock}
      ${state.error ? `<p class="iwarn">${esc(state.error)}</p>` : ""}
      <ol class="fwd-steps">
        <li>Copy the address above.</li>
        <li>Gmail: Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address. Paste the CallUp address. Gmail emails a confirmation code. It shows on this page. Enter the code in Gmail, then choose “Forward a copy of incoming mail” and keep Gmail’s copy.</li>
        <li>Outlook: Settings → Mail → Forwarding. Turn forwarding on, paste the CallUp address, and keep a copy in Outlook. A confirmation code shows on this page when Outlook sends one.</li>
      </ol>
    </section>
    ${verifyBlock ? `<section class="pad"><h3>Confirm forwarding</h3>${verifyBlock}</section>` : ""}
    <section class="pad">
      <h3>Supervisor emails</h3>
      <p class="sub">Only mail from these addresses, including the original sender when the message was forwarded, becomes a draft. Anyone else is ignored.</p>
      ${emailList}
      ${editor}
    </section>
    <section class="pad">
      <h3>Drafts to approve</h3>
      ${draftCards || `<p class="sub">No drafts waiting.</p>`}
    </section>
    ${ignoredBlock ? `<section class="pad"><h3>Ignored senders</h3><ul class="fwd-list">${ignoredBlock}</ul></section>` : ""}`;
}

export function readDraftEdits(root, draft) {
  const out = { ...(draft || {}) };
  const id = out.id;
  if (!root || !id) return out;
  root.querySelectorAll("[data-fwd-field]").forEach(el => {
    if (el.dataset.fwdId !== id || !el.dataset.fwdField) return;
    out[el.dataset.fwdField] = el.value;
  });
  return out;
}
