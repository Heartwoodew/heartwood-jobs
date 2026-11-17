// Plain-text "Email job" for one job. CallUp sends it from the app. "Other mail app"
// still opens the phone's share sheet or a mailto link. The text rules live here so
// the send function and the preview stay the same.
//
// Dump receipts vs reimbursement receipts:
// A job receipt is a dump / tip docket only when receipts.paidPersonally is false.
// That is the upload checkbox "I paid for this myself (reimburse me)" left unchecked
// (company account, for example a Remondis tip docket or weighbridge ticket).
// A reimbursement is paidPersonally true, any reimbursement claim (fuel, tip-fees,
// parts, tools, consumables, other — tip-fees there means the staff member paid),
// the reimbursements ledger, or a file marked purpose reimbursement-receipt.
// Anything else, including a missing paidPersonally, is ambiguous and is left out.
// The phone's Other mail app only offers a dump receipt image that person can already open.
// Send includes every clear dump receipt when the sender can see prices.
// Crew cannot: a receipt shows a dollar amount, and crew never see prices.

import { CLAIM_CATEGORIES, PAID_WITH } from "./claims.js";
import { buildZip } from "./cloud-retention.js";
import { canReadObject, canSeeJob, jobTenantOf, listedJobPhoto } from "./cloud-storage.js";
import { visibleDocuments } from "./job-documents.js";
import { receiptAmount, receiptTonnes } from "./receipts.js";
import { seesMoney } from "./staff-invites.js";

export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_JPEG_QUALITY = 0.82;
export const PHOTO_BUDGET_BYTES = 20 * 1024 * 1024;
export const MAILTO_URL_LIMIT = 1900;
export const NOTES_TRIM_NOTE = "see app for full notes";
export const JOB_EMAIL_MAX_RECIPIENTS = 5;

export const DUMP_RECEIPT = "dump";
export const REIMBURSEMENT_RECEIPT = "reimbursement";
export const AMBIGUOUS_RECEIPT = "ambiguous";
// The field and value that mark a company-account tip / dump docket.
export const DUMP_RECEIPT_FIELD = "paidPersonally";
export const DUMP_RECEIPT_VALUE = false;

const CLAIM_CATEGORY_IDS = new Set(CLAIM_CATEGORIES.map(([id]) => id));
const PAID_WITH_IDS = new Set(PAID_WITH.map(([id]) => id));
const PRIVATE_URL = /https?:\/\/\S*(?:firebasestorage\.googleapis\.com|storage\.googleapis\.com|googleapis\.com\/v0\/b|X-Goog-Signature|X-Goog-Algorithm|[?&]token=)\S*/gi;
const STORAGE_PATH = /tenants\/[A-Za-z0-9_-]+\/(?:jobs|receipts|documents|reimbursements)\S*/gi;
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

// Same company id as company.docCompanyId. Inlined so the mail worker can share this
// file without importing the company module.
function docCompanyId(data) {
  if (!data || typeof data !== "object") return "heartwood";
  const company = typeof data.companyId === "string" ? data.companyId.trim() : "";
  if (company) return company;
  const tenant = typeof data.tenantId === "string" ? data.tenantId.trim() : "";
  return tenant || "heartwood";
}

// Same replacement as quotes.noDollars. Inlined so the mail worker does not import the quote builder.
function noDollars(text) {
  return String(text == null ? "" : text).replace(/(?:A|AU)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:ex|inc|incl)\.?\s?GST)?/gi, "[price removed]").replace(/\$/g, "");
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : "";
}

function splitAddresses(value) {
  return String(value || "").split(/[,;\s]+/).map(part => part.trim()).filter(Boolean);
}

/** To plus Cc, deduped. At least one To. At most JOB_EMAIL_MAX_RECIPIENTS altogether. */
export function parseEmailRecipients({ to = "", cc = "" } = {}) {
  const toParts = splitAddresses(to);
  const ccParts = splitAddresses(cc);
  if (!toParts.length || toParts.some(part => !cleanEmail(part)) || ccParts.some(part => !cleanEmail(part))) {
    return { ok: false, reason: "invalid-recipient", to: [], cc: [] };
  }
  const tos = [];
  for (const part of toParts) {
    const email = cleanEmail(part);
    if (!tos.includes(email)) tos.push(email);
  }
  const ccs = [];
  for (const part of ccParts) {
    const email = cleanEmail(part);
    if (tos.includes(email) || ccs.includes(email)) continue;
    ccs.push(email);
  }
  if (tos.length + ccs.length > JOB_EMAIL_MAX_RECIPIENTS) {
    return { ok: false, reason: "invalid-recipient", to: tos, cc: ccs };
  }
  return { ok: true, to: tos, cc: ccs };
}

export function sameCompany(record, companyId) {
  return docCompanyId(record) === docCompanyId({ companyId: companyId || "heartwood" });
}

function publicText(value, showMoney) {
  let text = String(value ?? "").replace(PRIVATE_URL, "").replace(STORAGE_PATH, "");
  if (!showMoney) text = noDollars(text);
  return text.replace(/[ \t]+\n/g, "\n").trim();
}

function safeName(value, fallback) {
  let text = publicText(value, true).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || /https?:/i.test(text) || text.includes("tenants/")) return fallback;
  text = text.split(/[\\/]/).pop();
  if (!text || /https?:/i.test(text) || text.includes("..")) return fallback;
  return text.slice(0, 160);
}

export function moneyText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatJobDate(date) {
  const iso = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return date ? String(date) : "Unscheduled";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "Unscheduled";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatJobTime(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || "").trim());
  if (!m) return "";
  let h = Number(m[1]);
  if (h > 23) return "";
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}

export function mapsLink(address) {
  const text = String(address || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(text);
}

export function jobTitle(job, typeLabels) {
  const title = String(job && job.title || "").trim();
  if (title) return title.slice(0, 120);
  const ids = Array.isArray(job && job.types) && job.types.length ? job.types : [job && job.type || ""];
  const labels = [];
  for (const id of ids) {
    const key = String(id || "").trim();
    if (!key) continue;
    const label = typeLabels && typeLabels[key] ? String(typeLabels[key]) : key;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.join(", ") || "Job";
}

export function suggestRecipient(job, client) {
  const onJob = [job && job.contactEmail, job && job.clientEmail, job && job.supervisorEmail].map(cleanEmail).find(Boolean);
  if (onJob) return { email: onJob, label: "Client contact" };
  const contacts = Array.isArray(client && client.contacts) ? client.contacts : [];
  const name = String(job && (job.contactName || job.supervisorName) || "").trim().toLowerCase();
  const named = name && contacts.find(c => cleanEmail(c && c.email) && String(c.name || "").trim().toLowerCase() === name);
  if (named) return { email: cleanEmail(named.email), label: named.name || "Client contact" };
  const preferred = contacts.find(c => c && c.default && cleanEmail(c.email)) || contacts.find(c => cleanEmail(c && c.email));
  if (preferred) return { email: cleanEmail(preferred.email), label: preferred.name || "Client contact" };
  return { email: "", label: "" };
}

function reimbursementSignal(row) {
  if (!row || typeof row !== "object") return false;
  if (row.paidPersonally === true || row.reimbursed === true || row.reimbursement === true) return true;
  if (row.purpose === "reimbursement-receipt") return true;
  if (row.category && CLAIM_CATEGORY_IDS.has(row.category)) return true;
  if (row.paidWith && PAID_WITH_IDS.has(row.paidWith)) return true;
  const path = String(row.receiptPath || row.path || row.storagePath || "");
  if (path.includes("/reimbursements/") || path.startsWith("reimbursements/")) return true;
  if (row.kind === "reimbursement" || row.collection === "reimbursements" || row.collection === "reimbursementClaims") return true;
  return false;
}

/** dump, reimbursement, or ambiguous. Ambiguous is never attached. */
export function receiptEmailKind(row) {
  if (!row || typeof row !== "object") return AMBIGUOUS_RECEIPT;
  if (reimbursementSignal(row)) return REIMBURSEMENT_RECEIPT;
  // Company-account dockets, including tonnes-only / queued tip tickets with no dollar amount.
  if (row[DUMP_RECEIPT_FIELD] === DUMP_RECEIPT_VALUE) {
    return DUMP_RECEIPT;
  }
  return AMBIGUOUS_RECEIPT;
}

function quoteRows(quote) {
  if (!quote || typeof quote !== "object") return [];
  const sections = Array.isArray(quote.sections) ? quote.sections : [];
  const fromSections = [];
  for (const section of sections) {
    const rows = Array.isArray(section && section.lines) ? section.lines : [];
    for (const line of rows) fromSections.push(line);
  }
  if (fromSections.length) return fromSections;
  if (Array.isArray(quote.lines)) return quote.lines;
  return [];
}

function formatQuoteLine(line) {
  if (!line || typeof line !== "object") return "";
  const label = String(line.label || line.name || line.description || "").replace(/\s+/g, " ").trim();
  if (!label) return "";
  const qty = line.qty != null && line.qty !== "" && Number(line.qty) !== 0 ? line.qty : "";
  const unit = line.unit ? String(line.unit) : "";
  const rate = line.rate != null ? line.rate : line.unitPrice;
  const amount = line.amount != null ? line.amount : (rate != null && qty !== "" ? Number(rate) * Number(qty) : null);
  const parts = [label];
  if (qty !== "") parts.push(unit ? `${qty} ${unit}` : String(qty));
  if (rate != null && rate !== "" && Number.isFinite(Number(rate))) parts.push(`${moneyText(rate)}${unit ? "/" + unit : ""}`);
  if (amount != null && amount !== "" && Number.isFinite(Number(amount))) parts.push(`${moneyText(amount)} ex GST`);
  return parts.join(" — ");
}

function priceLines(job, quote) {
  const lines = [];
  for (const line of quoteRows(quote)) {
    const text = formatQuoteLine(line);
    if (text) lines.push(text);
    if (lines.length >= 40) break;
  }
  const total = quote && quote.totalEx != null ? quote.totalEx : job.quoteAmount;
  if (total != null && total !== "" && Number.isFinite(Number(total))) lines.push(`Quote total: ${moneyText(total)} ex GST`);
  if (quote && quote.gst != null && Number.isFinite(Number(quote.gst))) lines.push(`GST: ${moneyText(quote.gst)}`);
  if (quote && quote.totalInc != null && Number.isFinite(Number(quote.totalInc))) lines.push(`Quote total inc GST: ${moneyText(quote.totalInc)}`);
  if (job.poAmount != null && job.poAmount !== "" && Number.isFinite(Number(job.poAmount))) lines.push(`PO value: ${moneyText(job.poAmount)} ex GST`);
  if (job.invoiceAmount != null && job.invoiceAmount !== "" && Number.isFinite(Number(job.invoiceAmount))) lines.push(`Invoice amount: ${moneyText(job.invoiceAmount)} ex GST`);
  return lines;
}

export function dumpReceiptLabel(row, index = 0) {
  const supplier = String(row && row.supplier || "").replace(/\s+/g, " ").trim();
  const tonnes = receiptTonnes(row);
  const base = supplier ? `${supplier} tip docket` : `Tip docket ${index + 1}`;
  const withTonnes = tonnes ? `${base} (${tonnes} t)` : base;
  return safeName(withTonnes, `Tip docket ${index + 1}`);
}

export function buildJobEmail({
  job, company, companyId, role, documentRole, typeLabels, documents, photos, receipts, quote, recipient,
} = {}) {
  if (!job || !job.id) return { ok: false, reason: "no-job" };
  const cid = companyId || (company && company.companyId) || "heartwood";
  if (!sameCompany(job, cid)) return { ok: false, reason: "wrong-company" };
  const showMoney = seesMoney(role);
  const title = jobTitle(job, typeLabels);
  const address = String(job.address || "").replace(/\s+/g, " ").trim();
  const date = formatJobDate(job.date);
  const time = formatJobTime(job.time);
  const subject = `Job: ${title} – ${address || "No address"} – ${date}`;
  const companyName = (company && (company.name || company.legalName)) || "CallUp";
  const operators = Array.isArray(job.assignedNames) && job.assignedNames.length
    ? job.assignedNames.map(name => String(name || "").trim()).filter(Boolean).join(", ")
    : "Unallocated";
  const docRole = documentRole || role || "operator";
  const docs = visibleDocuments(documents || [], docRole).map((row, i) => safeName(
    publicText(row.name || row.fileName || "", showMoney),
    `Document ${i + 1}`,
  ));
  const pics = (Array.isArray(photos) ? photos : []).map((p, i) => safeName(p && (p.name || p.label), `Photo ${i + 1}.jpg`));
  const dumpRows = showMoney && Array.isArray(receipts) ? receipts.filter(row => receiptEmailKind(row) === DUMP_RECEIPT) : [];
  const lines = [
    companyName,
    "",
    `Job: ${title}`,
    `Client: ${publicText(job.client, showMoney) || "—"}`,
    `Site: ${publicText(address, showMoney) || "—"}`,
  ];
  const map = mapsLink(address);
  if (map) lines.push(`Map: ${map}`);
  lines.push(`Scheduled: ${date}${time ? " · " + time : ""}`);
  lines.push(`Operators: ${operators || "Unallocated"}`);
  lines.push(`PO: ${publicText(job.po, showMoney) || "—"}`);
  lines.push(`Status: ${publicText(job.status, showMoney) || "—"}`);
  lines.push("", "Description:", publicText(job.description, showMoney) || "—");
  lines.push("", "Notes:", publicText(job.notes, showMoney) || "—");
  const amounts = Array.isArray(job.workAmounts) ? job.workAmounts.filter(a => typeof a === "string" && a.trim()) : [];
  if (amounts.length) {
    lines.push("", "Amounts:");
    for (const amount of amounts) lines.push(`- ${publicText(amount, showMoney)}`);
  }
  if (showMoney) {
    const prices = priceLines(job, quote);
    if (prices.length) {
      lines.push("", "Quote:");
      for (const price of prices) lines.push(`- ${price}`);
    }
    if (dumpRows.length) {
      lines.push("", "Dump receipts:");
      dumpRows.forEach((row, i) => {
        const name = row.kind === "dump-receipt" && row.name ? safeName(row.name, dumpReceiptLabel(row, i)) : dumpReceiptLabel(row, i);
        const amount = receiptAmount(row);
        lines.push(`- ${name}${amount ? " — " + moneyText(amount) + " inc GST" : ""}`);
      });
    }
  }
  lines.push("", "Documents:");
  if (docs.length) for (const name of docs) lines.push(`- ${name}`);
  else lines.push("- None");
  lines.push("Photos:");
  if (pics.length) for (const name of pics) lines.push(`- ${name}`);
  else lines.push("- None");
  let body = lines.join("\n");
  if (!showMoney) body = noDollars(body);
  return {
    ok: true,
    subject,
    body,
    showMoney,
    recipient: cleanEmail(recipient),
    documents: docs,
    photos: pics,
  };
}

function notesParts(body) {
  const head = "Notes:\n";
  const at = body.indexOf(head);
  if (at < 0) return null;
  const start = at + head.length;
  const rest = body.slice(start);
  const m = rest.match(/\n(?=Amounts:\n|Quote:\n|Dump receipts:\n|Documents:\n|Photos:\n)/);
  const end = m ? start + m.index : body.length;
  return { prefix: body.slice(0, start), notes: body.slice(start, end), suffix: body.slice(end) };
}

export function mailtoHref({ to = "", subject = "", body = "", limit = MAILTO_URL_LIMIT } = {}) {
  const addr = cleanEmail(to);
  const full = String(body || "");
  const hrefOf = text => `mailto:${addr}?subject=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(text)}`;
  let text = full;
  let trimmed = false;
  const fit = () => hrefOf(text).length <= limit;
  if (!fit()) {
    trimmed = true;
    const parts = notesParts(text);
    if (parts) {
      let note = parts.notes.replace(/\s+$/, "");
      const build = n => parts.prefix + (n ? n + "\n" : "") + NOTES_TRIM_NOTE + parts.suffix;
      text = build(note);
      while (!fit() && note.length) {
        note = note.slice(0, Math.max(0, note.length - 80)).replace(/\s+$/, "");
        text = build(note);
      }
      if (!fit()) text = build("");
    }
    while (!fit() && text.length > NOTES_TRIM_NOTE.length + 8) text = text.slice(0, text.length - 40).replace(/\s+$/, "");
    if (!text.includes(NOTES_TRIM_NOTE)) text = `${text}\n${NOTES_TRIM_NOTE}`;
    while (!fit() && text.length > 24) text = `${NOTES_TRIM_NOTE}`;
  }
  return { href: hrefOf(text), body: text, fullBody: full, trimmed, to: addr, subject: subject || "" };
}

export function shareText({ to, subject, body } = {}) {
  const lines = [];
  const addr = cleanEmail(to);
  if (addr) lines.push(`To: ${addr}`);
  if (subject) lines.push(`Subject: ${subject}`);
  lines.push("", String(body || ""));
  return lines.join("\n");
}

function photoItem(row, index) {
  return {
    kind: "photo",
    id: row.path,
    name: safeName(row.fileName || row.displayName || row.label, `Photo ${index + 1}.jpg`),
    path: row.path,
    contentType: row.contentType || "image/jpeg",
  };
}

function receiptItem(row, index, path) {
  return {
    kind: "dump-receipt",
    id: `receipt:${row.id}`,
    name: dumpReceiptLabel(row, index),
    path,
    contentType: "image/jpeg",
    amountInc: row.amountInc ?? null,
    tonnes: row.tonnes ?? null,
    supplier: row.supplier || "",
    paidPersonally: false,
  };
}

function receiptObjectPath(membership, receipt) {
  const given = String(receipt.path || receipt.storagePath || "");
  if (given.startsWith(`tenants/${membership.tenantId}/receipts/${receipt.id}/original`)) return given;
  if (!receipt.id) return "";
  return `tenants/${membership.tenantId}/receipts/${receipt.id}/original`;
}

/**
 * Job photos the person can already see, plus dump receipts they can already open.
 * Reimbursement and ambiguous receipts are dropped and never returned for the picker.
 * Omit pickedIds to keep every allowed file ticked. Pass [] for none.
 */
export function selectEmailAttachments({ membership, job, companyId, role, listing, receipts, pickedIds } = {}) {
  const dropped = [];
  if (!membership || !membership.ok || !job || !job.id) return { ok: false, reason: "not-allowed", photos: [], receipts: [], attachments: [], dropped };
  if (companyId && !sameCompany(job, companyId)) return { ok: false, reason: "wrong-company", photos: [], receipts: [], attachments: [], dropped };
  if (!canSeeJob(membership, job) || jobTenantOf(job) !== membership.tenantId) {
    return { ok: false, reason: "not-allowed", photos: [], receipts: [], attachments: [], dropped };
  }
  const photos = [];
  let photoIndex = 0;
  for (const item of listing || []) {
    const row = listedJobPhoto({
      membership,
      job,
      path: item && (item.path || item.fullPath),
      contentType: item && item.contentType,
      customMetadata: item && (item.customMetadata || item.metadata),
      size: item && (item.size != null ? item.size : item.bytes),
      readable: item && item.readable,
      error: item && item.error,
    });
    if (!row.ok) {
      dropped.push({ reason: row.reason || "not-allowed", kind: "photo" });
      continue;
    }
    photos.push(photoItem({ ...item, ...row }, photoIndex));
    photoIndex += 1;
  }
  const showMoney = seesMoney(role);
  const dump = [];
  let dumpIndex = 0;
  for (const receipt of receipts || []) {
    const kind = receiptEmailKind(receipt);
    if (kind !== DUMP_RECEIPT) {
      dropped.push({ reason: kind, id: receipt && receipt.id, kind: "receipt" });
      continue;
    }
    if (!receipt.jobId || receipt.jobId !== job.id) {
      dropped.push({ reason: "other-job", id: receipt.id, kind: "receipt" });
      continue;
    }
    if (!sameCompany(receipt, docCompanyId(job))) {
      dropped.push({ reason: "wrong-company", id: receipt.id, kind: "receipt" });
      continue;
    }
    if (!showMoney) {
      dropped.push({ reason: "no-money", id: receipt.id, kind: "receipt" });
      continue;
    }
    const path = receiptObjectPath(membership, receipt);
    const read = canReadObject({ membership, path, receipt, job });
    if (!read.ok || read.purpose !== "receipt") {
      dropped.push({ reason: read.reason || "not-allowed", id: receipt.id, kind: "receipt" });
      continue;
    }
    dump.push(receiptItem(receipt, dumpIndex, path));
    dumpIndex += 1;
  }
  let attachments = photos.concat(dump);
  if (Array.isArray(pickedIds)) {
    const want = new Set(pickedIds);
    attachments = attachments.filter(item => want.has(item.id));
  }
  return {
    ok: true,
    photos: attachments.filter(item => item.kind === "photo"),
    receipts: attachments.filter(item => item.kind === "dump-receipt"),
    attachments,
    dropped,
  };
}

/**
 * Dump receipts a money-viewer may include. Crew get none.
 * Reimbursements and ambiguous rows (including a missing paidPersonally) are left out.
 * This does not decide Storage reads for the phone; the send function loads the bytes.
 */
export function emailDumpReceipts({ role, job, receipts } = {}) {
  if (!seesMoney(role) || !job || !job.id) return [];
  const out = [];
  for (const row of receipts || []) {
    if (receiptEmailKind(row) !== DUMP_RECEIPT) continue;
    if (!row || !row.id || row.jobId !== job.id) continue;
    if (!sameCompany(row, docCompanyId(job))) continue;
    out.push(row);
  }
  return out;
}

export function emailSendPlan({ canShareFiles, attachmentCount } = {}) {
  const count = Number(attachmentCount) || 0;
  if (count > 0 && canShareFiles) return { channel: "share", download: false };
  return { channel: "mailto", download: count > 0 };
}

export function deviceCanShareFiles(nav) {
  const host = nav || (typeof navigator !== "undefined" ? navigator : null);
  if (!host || typeof host.canShare !== "function" || typeof host.share !== "function") return false;
  if (typeof File !== "function") return false;
  try {
    return host.canShare({ files: [new File(["x"], "photo.jpg", { type: "image/jpeg" })] }) === true;
  } catch {
    return false;
  }
}

export function fitEdge(width, height, max = PHOTO_MAX_EDGE) {
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  const edge = Math.max(w, h);
  if (!edge) return { width: 0, height: 0, scale: 1 };
  if (edge <= max) return { width: w, height: h, scale: 1 };
  const scale = max / edge;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

/** Attach files in order while they fit. The rest are named in the email, not attached. A missing size is not attached. */
export function packEmailAttachments(files, budget = PHOTO_BUDGET_BYTES) {
  const attach = [];
  const linked = [];
  const skipped = [];
  let used = 0;
  const limit = Number(budget) > 0 ? Number(budget) : PHOTO_BUDGET_BYTES;
  for (const file of files || []) {
    const size = Number(file && file.size);
    if (!Number.isFinite(size) || size <= 0) {
      skipped.push(file);
      continue;
    }
    if (used + size <= limit) {
      attach.push(file);
      used += size;
    } else {
      linked.push(file);
    }
  }
  return { attach, linked, skipped, bytes: used, budget: limit };
}

/** Names and one app link for files that did not fit. No storage path and no download token. */
export function unattachedFileNote({ photos = [], receipts = [], url = "" } = {}) {
  const pics = (photos || []).map(name => String(name || "").trim()).filter(Boolean);
  const dumps = (receipts || []).map(name => String(name || "").trim()).filter(Boolean);
  if (!pics.length && !dumps.length) return "";
  const link = String(url || "").trim();
  const lines = [
    "",
    "These files were too large to attach. Open the job in CallUp while signed in to this company. The link does not make the files public.",
  ];
  if (link) lines.push(link);
  if (pics.length) {
    lines.push("", "Photos:");
    for (const name of pics) lines.push(`- ${name}`);
  }
  if (dumps.length) {
    lines.push("", "Dump receipts:");
    for (const name of dumps) lines.push(`- ${name}`);
  }
  return lines.join("\n");
}

export function photoBudget(files, budget = PHOTO_BUDGET_BYTES) {
  const total = (files || []).reduce((sum, file) => {
    if (typeof file === "number") return sum + (Number.isFinite(file) ? file : 0);
    return sum + (Number(file && (file.size ?? file.bytes)) || 0);
  }, 0);
  const over = total > budget;
  const mb = total / (1024 * 1024);
  return {
    total,
    over,
    budget,
    message: over ? `These files are ${mb.toFixed(1)} MB. Mail apps often struggle over 20 MB. Untick some, or send anyway.` : "",
  };
}

export function jpegName(name, index = 0) {
  const base = safeName(name, `Photo ${index + 1}`).replace(/\.(png|webp|gif|jpe?g)$/i, "");
  return `${base || `Photo ${index + 1}`}.jpg`;
}

export function uniqueNames(names) {
  const seen = new Map();
  return (names || []).map(name => {
    const clean = name || "Photo.jpg";
    const count = seen.get(clean) || 0;
    seen.set(clean, count + 1);
    if (!count) return clean;
    const dot = clean.lastIndexOf(".");
    if (dot > 0) return `${clean.slice(0, dot)}-${count + 1}${clean.slice(dot)}`;
    return `${clean}-${count + 1}`;
  });
}

export async function compressImageBlob(blob, { maxEdge = PHOTO_MAX_EDGE, quality = PHOTO_JPEG_QUALITY } = {}) {
  if (!blob) return { blob, compressed: false };
  const create = typeof createImageBitmap === "function" ? createImageBitmap : null;
  const doc = typeof document !== "undefined" ? document : null;
  if (!create || !doc || typeof doc.createElement !== "function") return { blob, compressed: false };
  let bmp = null;
  try {
    bmp = await create(blob, { imageOrientation: "from-image" });
  } catch {
    try { bmp = await create(blob); } catch { return { blob, compressed: false }; }
  }
  const fit = fitEdge(bmp.width, bmp.height, maxEdge);
  const canvas = doc.createElement("canvas");
  canvas.width = fit.width || 1;
  canvas.height = fit.height || 1;
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof canvas.toBlob !== "function") {
    bmp.close?.();
    return { blob, compressed: false };
  }
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const out = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!out) return { blob, compressed: false, width: fit.width, height: fit.height };
  return { blob: out, compressed: true, width: fit.width, height: fit.height };
}

export function photosZip(files) {
  const named = uniqueNames((files || []).map((file, i) => jpegName(file && file.name, i)));
  const entries = [];
  for (let i = 0; i < (files || []).length; i++) {
    const data = files[i] && files[i].data instanceof Uint8Array ? files[i].data : null;
    if (!data || /tenants\/|reimbursements\/|https?:/i.test(named[i])) continue;
    entries.push({ name: named[i], data });
  }
  return { ok: entries.length > 0, zip: entries.length ? buildZip(entries) : new Uint8Array(), names: entries.map(entry => entry.name) };
}

function checkRows(items, kind) {
  return (items || []).map((item, i) => {
    const name = esc(item && item.name || (kind === "receipt" ? `Tip docket ${i + 1}` : `Photo ${i + 1}.jpg`));
    return `<label class="ck"><input type="checkbox" data-jem-index="${i}" data-jem-kind="${kind}" checked> ${name}</label>`;
  }).join("");
}

export function emailSheetHtml({ subject = "", body = "", to = "", suggestion = "", photos = [], receipts = [], photoError = false } = {}) {
  const photoBlock = photos.length
    ? `<div class="jem-photos"><p class="sub">Photos</p><button type="button" class="sm-btn" id="jemnone">No photos</button>${checkRows(photos, "photo", "photo")}</div>`
    : `<p class="sub">${photoError ? "Photos couldn't be loaded. You can still email the job details." : "No photos on this job."}</p>`;
  const receiptBlock = receipts.length
    ? `<div class="jem-photos"><p class="sub">Tip dockets</p><p class="sub">Company-account dump receipts. Reimbursements are not listed.</p>${checkRows(receipts, "receipt", "receipt")}</div>`
    : "";
  const filled = esc(to || "");
  return `<div class="embox jobemail"><h3>Email job</h3>
    <p class="sub">CallUp sends this email. Nothing goes until you tap Send.</p>
    <label>To<input type="email" id="jemto" inputmode="email" autocomplete="email" placeholder="Client’s email" value="${filled}"></label>
    <label>Cc<input type="text" id="jemcc" inputmode="email" autocomplete="off" placeholder="Optional" value=""></label>
    ${suggestion && suggestion !== to ? `<p class="sub">Client contact <button type="button" class="sm-btn" id="jemuse">${esc(suggestion)}</button></p>` : ""}
    <p class="sub jem-subject" id="jemsubj">${esc(subject)}</p>
    <pre class="email-preview" id="jembody">${esc(body)}</pre>
    ${photoBlock}
    ${receiptBlock}
    <p class="sub">Send attaches the job photos and, when you can see prices, the company tip dockets. Unticked files apply only to Other mail app.</p>
    <p class="sub" id="jemstate" hidden></p>
    <p class="sub" id="jemprog" hidden></p>
    <p class="err" id="jemwarn" hidden></p>
    <button type="button" class="mbtn complete" id="jemsend">Send</button>
    <p class="sub jem-other"><a id="jemmail" href="">Other mail app</a></p>
    <button type="button" class="mbtn" id="jemcopy">Copy</button>
    <button type="button" class="mbtn" id="jemzip" hidden>Download photos</button>
    <button type="button" class="mbtn ghost" id="jemx">Cancel</button></div>`;
}
