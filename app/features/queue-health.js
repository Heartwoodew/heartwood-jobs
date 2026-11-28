// Honest status for work the app hands to a background worker (a Cloud Function, or an office helper that may
// be switched off). A request that has been waiting too long is shown as "not done yet, do it by hand" instead
// of "queued" forever. Pure functions: nothing here reads or writes Firestore.
//
// Thresholds are minutes since the request was made.
export const STALE_MIN = Object.freeze({
  hours: 30, // hours spreadsheet email: sent in seconds, retried every 15 min
  xero: 30, // Send to Xero / Check Xero
  po: 15, // Find PO answer
  hubdoc: 24 * 60, // paid claim filed to Hubdoc
});

// Find PO was answered by a worker on a private computer (saved PO PDFs, a mailbox and a builder portal).
// That cannot be guaranteed, so the button and "Find all POs" stay off until the worker is wired to a server.
// Existing answers (found / pick one) still show. Turn this on only when the lookup is running again.
export const PO_LOOKUP_AUTOMATIC = false;
export const PO_BY_HAND = "Automatic PO search is off. Type the PO in the PO field by hand.";

/** Milliseconds from a Firestore Timestamp, a Date, an ISO string or a number. null when unknown. */
export function toMs(t) {
  if (t == null || t === "") return null;
  if (typeof t === "number") return Number.isFinite(t) ? t : null;
  if (typeof t.toMillis === "function") { try { return t.toMillis(); } catch { return null; } }
  if (typeof t.toDate === "function") { try { return t.toDate().getTime(); } catch { return null; } }
  if (t instanceof Date) return t.getTime();
  if (typeof t === "object" && typeof t.seconds === "number") return t.seconds * 1000;
  const ms = Date.parse(String(t));
  return Number.isFinite(ms) ? ms : null;
}

export function ageMin(t, now = Date.now()) {
  const ms = toMs(t);
  return ms == null ? 0 : Math.max(0, (now - ms) / 60000);
}

export function agoText(t, now = Date.now()) {
  const m = Math.round(ageMin(t, now));
  if (m < 2) return "just now";
  if (m < 90) return `${m} minutes ago`;
  if (m < 36 * 60) return `${Math.round(m / 60)} hours ago`;
  return `${Math.round(m / 1440)} days ago`;
}

const dmy = s => { const t = String(s || "").slice(0, 10); return t.length === 10 ? `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(0, 4)}` : ""; };

/** One hours-spreadsheet export row. { key, label, tone, stalled, hint } */
export function hoursExportState(x, now = Date.now()) {
  const st = String((x && x.status) || "queued");
  const tries = Number(x && x.attempts) || 0;
  if (st === "sent") return { key: "sent", label: `Emailed ${dmy(x.sentAt)}`.trim(), tone: "ok", stalled: false, hint: "" };
  const hint = "Download the spreadsheet and email it to accounts yourself.";
  if (st === "failed" && tries >= 5) return { key: "gaveup", label: "Not emailed, gave up", tone: "warn", stalled: true, hint };
  if (ageMin(x && x.createdAt, now) >= STALE_MIN.hours) return { key: "stalled", label: "Not emailed yet", tone: "warn", stalled: true, hint };
  if (st === "failed") return { key: "retrying", label: "Send failed, trying again", tone: "wait", stalled: false, hint: "" };
  if (st === "sending") return { key: "sending", label: "Sending…", tone: "wait", stalled: false, hint: "" };
  return { key: "queued", label: "Emailing now…", tone: "wait", stalled: false, hint: "" };
}

/** Send to Xero state for a job. null when nothing is waiting. */
export function xeroSendState(j, now = Date.now()) {
  if (!j || j.xeroStatus !== "queued") return null;
  const stalled = ageMin(j.xeroQueuedAt, now) >= STALE_MIN.xero;
  return { stalled, label: stalled ? "Not sent to Xero yet" : "Queued for Xero", hint: stalled ? "Use Download Xero CSV on the Invoices screen instead." : "" };
}

/** Check Xero state for a job. null when no check is waiting. */
export function xeroCheckState(j, now = Date.now()) {
  if (!j || !j.xeroCheckPending) return null;
  const stalled = ageMin(j.xeroCheckQueuedAt, now) >= STALE_MIN.xero;
  return { stalled, label: stalled ? "Xero check didn't finish" : "Checking…", hint: stalled ? "Check it in Xero yourself, or try again." : "" };
}

/** Find PO state for a job. null when no lookup is waiting. */
export function poLookupState(j, now = Date.now()) {
  if (!j || (j.poLookupStatus !== "pending" && j.poLookupStatus !== "searching")) return null;
  const stalled = !PO_LOOKUP_AUTOMATIC || ageMin(j.poLookupAt, now) >= STALE_MIN.po;
  return { stalled, label: stalled ? "No automatic answer" : "Searching…", hint: stalled ? PO_BY_HAND : "" };
}

/** Hubdoc state text for a paid claim. */
export function hubdocStale(row, now = Date.now()) {
  const st = String((row && row.hubdocStatus) || "");
  if (st !== "queued" && st !== "sending" && st !== "failed") return false;
  return ageMin(row && row.paidAt, now) >= STALE_MIN.hubdoc;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Lines for the admin "Needs attention" health strip. Heartwood-only items are included only when the caller
 * says that office may see them (xero / po), so another company never sees them.
 */
export function healthItems({ exports = [], jobs = [], xero = false, po = false, now = Date.now() } = {}) {
  const out = [];
  const hx = exports.filter(x => hoursExportState(x, now).stalled);
  if (hx.length) out.push({ id: "hours", text: `${plural(hx.length, "hours spreadsheet hasn't", "hours spreadsheets haven't")} been emailed to accounts. Open Timesheets, download ${hx.length === 1 ? "it" : "them"} and email ${hx.length === 1 ? "it" : "them"} yourself.` });
  if (xero) {
    const send = jobs.filter(j => (xeroSendState(j, now) || {}).stalled);
    if (send.length) out.push({ id: "xero", text: `${plural(send.length, "job is", "jobs are")} still waiting to go to Xero. Use Download Xero CSV on Invoices instead.` });
    const chk = jobs.filter(j => (xeroCheckState(j, now) || {}).stalled);
    if (chk.length) out.push({ id: "xerocheck", text: `${plural(chk.length, "Xero check hasn't", "Xero checks haven't")} finished. Check ${chk.length === 1 ? "it" : "them"} in Xero yourself.` });
  }
  if (po) {
    const lk = jobs.filter(j => (poLookupState(j, now) || {}).stalled);
    if (lk.length) out.push({ id: "po", text: `${plural(lk.length, "PO search has", "PO searches have")} no automatic answer. Type the PO in by hand.` });
  }
  return out;
}

export function healthLineHtml(items, esc = s => String(s)) {
  if (!items || !items.length) return "";
  return `<div class="healthline" role="status" aria-live="polite"><b>Needs doing by hand</b>${items.map(i => `<p data-health="${esc(i.id)}">${esc(i.text)}</p>`).join("")}</div>`;
}
