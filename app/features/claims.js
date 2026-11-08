// Reimbursement claims. Any staff member claims back money they paid with a personal card or cash.
// Not tied to a job (a job link is optional). Admins approve, decline, or mark paid. No Xero push.
// This module does not talk to Firebase. The app uploads the receipt and writes the claim.

export const CLAIM_CATEGORIES = Object.freeze([
  Object.freeze(["fuel", "Fuel"]),
  Object.freeze(["tip-fees", "Tip fees"]),
  Object.freeze(["parts", "Parts"]),
  Object.freeze(["tools", "Tools"]),
  Object.freeze(["consumables", "Consumables"]),
  Object.freeze(["other", "Other"]),
]);
export const PAID_WITH = Object.freeze([
  Object.freeze(["personal-card", "Personal card"]),
  Object.freeze(["cash", "Cash"]),
]);
export const CLAIM_STATUS = Object.freeze({ submitted: "Submitted", approved: "Approved", declined: "Declined", paid: "Paid" });
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

const CATEGORY_LABEL = Object.fromEntries(CLAIM_CATEGORIES);
const PAID_LABEL = Object.fromEntries(PAID_WITH);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^rc[a-z0-9]{16}$/;
const RECEIPT_FILES = Object.freeze({
  "application/pdf": "receipt.pdf",
  "image/jpeg": "receipt.jpg",
  "image/png": "receipt.png",
  "image/webp": "receipt.webp",
});

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function clean(value, max) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

export function newClaimId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return "rc" + [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function receiptObjectName(contentType) {
  const type = String(contentType || "").toLowerCase() === "image/jpg" ? "image/jpeg" : String(contentType || "").toLowerCase();
  return RECEIPT_FILES[type] || "";
}

export function receiptContentType(contentType) {
  const name = receiptObjectName(contentType);
  if (!name) return "";
  return name === "receipt.pdf" ? "application/pdf" : name === "receipt.png" ? "image/png" : name === "receipt.webp" ? "image/webp" : "image/jpeg";
}

export function receiptStoragePath(uid, id, objectName) {
  if (!uid || !ID.test(id || "") || !Object.values(RECEIPT_FILES).includes(objectName)) return "";
  return `reimbursements/${uid}/${id}/${objectName}`;
}

/** "$12.50", "12.5", "1,234" -> cents. Returns NaN when it is not a positive amount with at most 2 decimals. */
export function amountToCents(value) {
  const text = String(value ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return NaN;
  const [whole, frac = ""] = text.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export function money(cents) {
  const n = Number(cents) || 0;
  return "$" + (n / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function claimCreateBody(input = {}) {
  const id = String(input.id || "");
  const uid = String(input.uid || "");
  const name = clean(input.name, 80);
  const date = String(input.date || "");
  const amountCents = amountToCents(input.amount);
  const supplier = clean(input.supplier, 120);
  const category = String(input.category || "");
  const notes = clean(input.notes, 1000);
  const paidWith = String(input.paidWith || "");
  const jobId = String(input.jobId || "");
  const jobLabel = jobId ? clean(input.jobLabel, 160) : "";
  const receiptPath = String(input.receiptPath || "");
  const receiptName = receiptPath ? clean(input.receiptName, 120) || "receipt" : "";
  if (!ID.test(id) || !uid) return { ok: false, reason: "Sign in again." };
  if (!name) return { ok: false, reason: "Your name is missing from your profile." };
  if (!DATE.test(date)) return { ok: false, reason: "Choose the date you paid." };
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 10000000) return { ok: false, reason: "Enter the amount including GST, e.g. 45.90." };
  if (!supplier) return { ok: false, reason: "Add the supplier or shop." };
  if (!CATEGORY_LABEL[category]) return { ok: false, reason: "Choose a category." };
  if (!PAID_LABEL[paidWith]) return { ok: false, reason: "Choose how you paid." };
  if (!/^[A-Za-z0-9_-]{0,80}$/.test(jobId)) return { ok: false, reason: "Choose a job from the list, or none." };
  if (receiptPath && receiptPath.indexOf(`reimbursements/${uid}/${id}/`) !== 0) return { ok: false, reason: "The receipt was not attached." };
  return {
    ok: true,
    data: {
      uid, name, date, amountCents, supplier, category, notes, paidWith, jobId, jobLabel, receiptPath, receiptName,
      status: "submitted", decisionNote: "", decidedBy: "", decidedByName: "", decidedAt: null, paidAt: null,
    },
  };
}

export function canMoveTo(from, to) {
  if (from === "submitted") return to === "approved" || to === "declined" || to === "paid";
  if (from === "approved") return to === "paid" || to === "declined";
  return false;
}

export function claimDecisionBody({ from, status, note, uid, name } = {}) {
  if (!canMoveTo(from, status)) return { ok: false, reason: "That change isn't allowed for this claim." };
  const decisionNote = clean(note, 500);
  if (status === "declined" && !decisionNote) return { ok: false, reason: "Add a note saying why it was declined." };
  if (!uid || !clean(name, 80)) return { ok: false, reason: "Sign in again." };
  return { ok: true, data: { status, decisionNote, decidedBy: uid, decidedByName: clean(name, 80) } };
}

/** Approved (not yet paid) and submitted totals per person, highest owed first. Declined and paid claims are left out. */
export function owedByPerson(claims) {
  const by = new Map();
  for (const row of claims || []) {
    if (row.status !== "approved" && row.status !== "submitted") continue;
    const key = row.uid || row.name || "?";
    const cur = by.get(key) || { uid: row.uid || "", name: row.name || "Staff", approvedCents: 0, submittedCents: 0, count: 0 };
    if (row.status === "approved") cur.approvedCents += Number(row.amountCents) || 0;
    else cur.submittedCents += Number(row.amountCents) || 0;
    cur.count += 1;
    by.set(key, cur);
  }
  return [...by.values()].sort((a, b) => (b.approvedCents + b.submittedCents) - (a.approvedCents + a.submittedCents) || a.name.localeCompare(b.name));
}

export function receiptDownloadName(row) {
  const name = String(row && row.name || "staff").trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "staff";
  const supplier = String(row && row.supplier || "receipt").trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "receipt";
  const date = DATE.test(row && row.date || "") ? row.date : "date";
  const match = /\.(pdf|jpg|png|webp)$/i.exec(String(row && row.receiptPath || ""));
  return `${name}_${date}_${supplier}.${match ? match[1].toLowerCase() : "bin"}`;
}

function sortClaims(rows) {
  return [...rows].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id || "").localeCompare(String(a.id || "")));
}

export function claimsScreenHtml({ claims, uid, isAdmin, jobs, today, error, filter } = {}) {
  const rows = Array.isArray(claims) ? claims : [];
  const cats = CLAIM_CATEGORIES.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join("");
  const paid = PAID_WITH.map(([id, label], i) => `<label class="ck"><input type="radio" name="paidWith" value="${id}" ${i === 0 ? "checked" : ""} required> ${esc(label)}</label>`).join("");
  const jobOpts = [`<option value="">No job</option>`].concat((jobs || []).slice(0, 200).map(j =>
    `<option value="${esc(j.id)}" data-label="${esc(j.label)}">${esc(j.label)}</option>`)).join("");
  const form = `<form id="claimform" class="lv-form rc-form">
    <h2>New claim</h2>
    <p class="sub">For things you paid for yourself. It does not have to be for a job.</p>
    <div class="lv-row"><label>Date<input type="date" name="date" required value="${esc(today || "")}"></label><label>Amount incl. GST<input name="amount" inputmode="decimal" required placeholder="0.00" autocomplete="off"></label></div>
    <label>Supplier<input name="supplier" required maxlength="120" placeholder="Shop or business" autocomplete="off"></label>
    <label>Category<select name="category" required>${cats}</select></label>
    <fieldset class="rc-paidwith"><legend>How you paid</legend>${paid}</fieldset>
    <label>Job <span class="sub">optional</span><select name="jobId">${jobOpts}</select></label>
    <label>Notes <span class="sub">optional</span><textarea name="notes" maxlength="1000" rows="2"></textarea></label>
    <label>Receipt <span class="sub">optional · photo or PDF · only you and admins can open it</span><input type="file" name="receipt" accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"></label>
    <p id="claimerr" class="err">${esc(error || "")}</p>
    <button type="submit" class="sm-btn primary">Submit claim</button>
  </form>`;
  const card = (row, admin) => {
    const st = row.status || "submitted";
    const meta = [CATEGORY_LABEL[row.category] || "Other", PAID_LABEL[row.paidWith] || "", row.jobLabel ? "Job " + row.jobLabel : ""].filter(Boolean).join(" · ");
    const note = row.decisionNote ? `<p class="sub">${esc(row.decidedByName || "Admin")}: ${esc(row.decisionNote)}</p>` : "";
    const file = row.receiptPath ? `<button type="button" class="sm-btn" data-rc-receipt="${esc(row.id)}">Download receipt</button>` : `<p class="sub">No receipt attached.</p>`;
    const btn = (to, label, primary) => canMoveTo(st, to) ? `<button type="submit" class="sm-btn${primary ? " primary" : ""}" value="${to}">${label}</button>` : "";
    const actions = admin && (st === "submitted" || st === "approved")
      ? `<form class="rc-decide" data-id="${esc(row.id)}" data-from="${esc(st)}"><label>Note<input name="note" maxlength="500" placeholder="Optional (required to decline)" autocomplete="off"></label><div class="btns">${btn("approved", "Approve", true)}${btn("paid", "Mark paid", st === "approved")}${btn("declined", "Decline")}</div></form>`
      : "";
    return `<article class="lv-card rc-card rc-${esc(st)}"><h3>${admin ? esc(row.name || "Staff") + " · " : ""}${esc(money(row.amountCents))} · ${esc(row.supplier || "")}</h3>
      <p>${esc(row.date || "")} · ${esc(meta)}</p>${row.notes ? `<p>${esc(row.notes)}</p>` : ""}
      <p class="qpill">${esc(CLAIM_STATUS[st] || st)}</p>${note}${file}${actions}</article>`;
  };
  const mine = sortClaims(rows.filter(row => row.uid === uid));
  const mineHtml = `<h2>Your claims</h2>${mine.map(row => card(row, false)).join("") || `<p class="sub">You have no claims yet.</p>`}`;
  if (!isAdmin) return `${form}${mineHtml}`;
  const owed = owedByPerson(rows);
  const owedHtml = `<h2>Owed per person</h2>${owed.length ? `<table class="rc-owed"><thead><tr><th>Person</th><th>Approved</th><th>Waiting</th></tr></thead><tbody>${owed.map(o =>
    `<tr><td>${esc(o.name)}</td><td><b>${esc(money(o.approvedCents))}</b></td><td>${esc(money(o.submittedCents))}</td></tr>`).join("")}</tbody></table><p class="sub">Approved is owed now. Waiting is submitted and not yet approved. Paid and declined claims are not counted.</p>` : `<p class="sub">Nothing owed.</p>`}`;
  const show = ["open", "paid", "declined", "all"].includes(filter) ? filter : "open";
  const pick = row => show === "all" || (show === "open" ? (row.status === "submitted" || row.status === "approved") : row.status === show);
  const tabs = `<div class="rc-filter">${[["open", "Open"], ["paid", "Paid"], ["declined", "Declined"], ["all", "All"]].map(([k, l]) => `<button type="button" class="sm-btn${k === show ? " primary" : ""}" data-rc-filter="${k}">${l}</button>`).join("")}</div>`;
  const all = sortClaims(rows.filter(pick));
  return `${owedHtml}<h2>All claims</h2>${tabs}${all.map(row => card(row, true)).join("") || `<p class="sub">No claims here.</p>`}${form}${mineHtml}`;
}
