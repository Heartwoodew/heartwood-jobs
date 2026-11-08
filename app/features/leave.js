// Leave requests. Annual, sick, or other.
// A half day is optional. A medical certificate is an optional private file.
// This module does not talk to Firebase. The app uploads the file and writes the request.

export const LEAVE_TYPES = Object.freeze([
  Object.freeze(["annual", "Annual leave"]),
  Object.freeze(["sick", "Sick leave"]),
  Object.freeze(["other", "Other leave"]),
]);

const TYPE_LABEL = Object.fromEntries(LEAVE_TYPES);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^lv[a-z0-9]{16}$/;
const CERT_FILES = Object.freeze({
  "application/pdf": "cert.pdf",
  "image/jpeg": "cert.jpg",
  "image/png": "cert.png",
  "image/webp": "cert.webp",
});
export const CERT_MAX_BYTES = 8 * 1024 * 1024;

export function newLeaveId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return "lv" + [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function certificateObjectName(contentType) {
  const type = String(contentType || "").toLowerCase() === "image/jpg" ? "image/jpeg" : String(contentType || "").toLowerCase();
  return CERT_FILES[type] || "";
}

export function certificateContentType(contentType) {
  const name = certificateObjectName(contentType);
  if (!name) return "";
  return name === "cert.pdf" ? "application/pdf" : name === "cert.png" ? "image/png" : name === "cert.webp" ? "image/webp" : "image/jpeg";
}

export function certificateStoragePath(uid, id, objectName) {
  if (!uid || !ID.test(id || "") || !Object.values(CERT_FILES).includes(objectName)) return "";
  return `leaveCertificates/${uid}/${id}/${objectName}`;
}

function clean(value, max) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

export function halvesOk(start, end, startHalf, endHalf) {
  const sh = startHalf || "";
  const eh = endHalf || "";
  if (!["", "am", "pm"].includes(sh) || !["", "am", "pm"].includes(eh)) return false;
  if (start === end) return sh === eh;
  return start < end && (sh === "" || sh === "pm") && (eh === "" || eh === "am");
}

export function leaveCreateBody(input) {
  const id = String(input && input.id || "");
  const uid = String(input && input.uid || "");
  const name = clean(input && input.name, 80);
  const type = String(input && input.type || "");
  const start = String(input && input.start || "");
  const end = String(input && input.end || "");
  const startHalf = String(input && input.startHalf || "");
  const endHalf = String(input && input.endHalf || "");
  const reason = clean(input && input.reason, 500);
  const certificatePath = String(input && input.certificatePath || "");
  const certificateName = clean(input && input.certificateName, 120);
  if (!ID.test(id)) return { ok: false, reason: "That request could not be started. Try again." };
  if (!uid) return { ok: false, reason: "Sign in again." };
  if (!name) return { ok: false, reason: "Your name is missing." };
  if (!TYPE_LABEL[type]) return { ok: false, reason: "Choose annual, sick, or other leave." };
  if (!DATE.test(start) || !DATE.test(end)) return { ok: false, reason: "Choose a start and an end date." };
  if (end < start) return { ok: false, reason: "The end date is before the start date." };
  if (!halvesOk(start, end, startHalf, endHalf)) {
    return {
      ok: false,
      reason: start === end
        ? "On one day, the two half-day choices have to match."
        : "A longer request can start in the afternoon and finish in the morning.",
    };
  }
  if (!reason) return { ok: false, reason: "Add a reason." };
  if (reason.length > 500) return { ok: false, reason: "Keep the reason under 500 characters." };
  const allowed = ["", ...Object.values(CERT_FILES).map(file => certificateStoragePath(uid, id, file))];
  if (!allowed.includes(certificatePath)) return { ok: false, reason: "The certificate file is not in the right place." };
  if (!certificatePath && certificateName) return { ok: false, reason: "Choose a certificate file, or clear the name." };
  if (certificatePath && !certificateName) return { ok: false, reason: "The certificate needs a file name." };
  return {
    ok: true,
    data: {
      uid, name, type, start, end, startHalf, endHalf, reason,
      certificatePath, certificateName,
      status: "pending",
      decisionNote: "",
      decidedBy: "",
      decidedByName: "",
      decidedAt: null,
    },
  };
}

export function leaveDecisionBody({ status, note, uid, name } = {}) {
  if (status !== "approved" && status !== "declined") return { ok: false, reason: "Choose approve or decline." };
  const decisionNote = clean(note, 500);
  if (!decisionNote) return { ok: false, reason: "Add a note." };
  if (decisionNote.length > 500) return { ok: false, reason: "Keep the note under 500 characters." };
  const decidedByName = clean(name, 80);
  if (!uid || !decidedByName) return { ok: false, reason: "Sign in again." };
  return { ok: true, data: { status, decisionNote, decidedBy: uid, decidedByName } };
}

export function typeLabel(type) {
  return TYPE_LABEL[type] || "Leave";
}

export function portionLabel(leave, date) {
  if (!leave || !date) return "";
  if (date === leave.start && date === leave.end) {
    if (leave.startHalf === "am") return "morning only";
    if (leave.startHalf === "pm") return "afternoon only";
    return "all day";
  }
  if (date === leave.start && leave.startHalf === "pm") return "from the afternoon";
  if (date === leave.end && leave.endHalf === "am") return "until midday";
  return "all day";
}

function samePerson(leave, person) {
  if (!leave || !person) return false;
  if (person.uid && leave.uid === person.uid) return true;
  const a = String(leave.name || "").trim().toLowerCase();
  const b = String(person.name || "").trim().toLowerCase();
  return !!a && a === b;
}

export function approvedOn(leaves, person, date) {
  if (!DATE.test(date || "")) return null;
  return (leaves || []).find(leave => leave && leave.status === "approved" && samePerson(leave, person) && leave.start <= date && leave.end >= date) || null;
}

export function assignmentWarning(leaves, date, people) {
  if (!DATE.test(date || "")) return "";
  const lines = [];
  for (const person of people || []) {
    const hit = approvedOn(leaves, person, date);
    if (!hit) continue;
    const who = person.name || hit.name || "This person";
    lines.push(`${who} is on approved ${typeLabel(hit.type).toLowerCase()} (${portionLabel(hit, date)})`);
  }
  if (!lines.length) return "";
  return lines.join(". ") + ".";
}

export function weekLeaves(leaves, weekStart, person) {
  if (!DATE.test(weekStart || "")) return [];
  const weekEnd = addDays(weekStart, 6);
  return (leaves || []).filter(leave => {
    if (!leave || leave.status !== "approved") return false;
    if (person && !samePerson(leave, person)) return false;
    return leave.start <= weekEnd && leave.end >= weekStart;
  });
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function pretty(iso) {
  if (!DATE.test(iso || "")) return iso || "";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function leaveSpan(leave) {
  if (!leave) return "";
  const start = pretty(leave.start);
  const end = pretty(leave.end);
  const when = leave.start === leave.end ? start : `${start} – ${end}`;
  const half = leave.start === leave.end
    ? (leave.startHalf === "am" ? ", morning only" : leave.startHalf === "pm" ? ", afternoon only" : "")
    : `${leave.startHalf === "pm" ? ", starts in the afternoon" : ""}${leave.endHalf === "am" ? ", finishes at midday" : ""}`;
  return `${when}${half}`;
}

export function weekLeaveHtml(leaves, weekStart, person) {
  const rows = weekLeaves(leaves, weekStart, person);
  if (!rows.length) return "";
  return `<div class="leave-banner" role="status">${rows.map(leave => `<p><b>${esc(leave.name || person && person.name || "Leave")}</b> · ${esc(typeLabel(leave.type))} · ${esc(leaveSpan(leave))}</p>`).join("")}</div>`;
}

export function plannerLeaveHtml(leaves, dates, people) {
  const days = (dates || []).filter(d => DATE.test(d));
  if (!days.length) return "";
  const start = days[0];
  const end = days[days.length - 1];
  const lines = [];
  for (const person of people || []) {
    const hits = (leaves || []).filter(leave => leave && leave.status === "approved" && samePerson(leave, person) && leave.start <= end && leave.end >= start);
    for (const leave of hits) lines.push(`<p><b>${esc(person.name || leave.name)}</b> · ${esc(typeLabel(leave.type))} · ${esc(leaveSpan(leave))}</p>`);
  }
  if (!lines.length) return "";
  return `<div class="leave-banner" role="status"><p class="leave-kicker">Approved leave</p>${lines.join("")}</div>`;
}

export function cellLeaveText(leaves, person, date) {
  const hit = approvedOn(leaves, person, date);
  if (!hit) return "";
  const portion = portionLabel(hit, date);
  return portion === "all day" ? typeLabel(hit.type) : `${typeLabel(hit.type)} · ${portion}`;
}

// Spreadsheet wording for one day. Approved leave keeps its type. Pending does not.
// A medical certificate is only a note that the file is there. Declined leave is ignored.
export function exportDayLeave(leaves, person, date) {
  const empty = { text: "", annual: 0, sick: 0, other: 0, pending: 0 };
  if (!DATE.test(date || "")) return empty;
  const rows = (leaves || []).filter(leave => leave && samePerson(leave, person) && String(leave.start || "") <= date && String(leave.end || "") >= date);
  const approved = rows.filter(leave => leave.status === "approved");
  const pending = rows.some(leave => leave.status === "pending") ? 1 : 0;
  const parts = [];
  const units = { annual: 0, sick: 0, other: 0 };
  for (const type of ["annual", "sick", "other"]) {
    const hits = approved.filter(leave => leave.type === type);
    if (!hits.length) continue;
    let unit = 0;
    let cert = false;
    const portions = [];
    for (const hit of hits) {
      const portion = portionLabel(hit, date) || "all day";
      unit = Math.max(unit, portion === "all day" ? 1 : 0.5);
      if (!portions.includes(portion)) portions.push(portion);
      if (String(hit.certificatePath || "").trim()) cert = true;
    }
    units[type] = unit;
    let label = typeLabel(type);
    if (!portions.includes("all day")) label += " · " + portions.join(", ");
    if (cert) label += " · Medical certificate";
    parts.push(label);
  }
  if (pending) parts.push("Leave requested (pending)");
  return { text: parts.join(" · "), annual: units.annual, sick: units.sick, other: units.other, pending };
}

const STATUS_LABEL = { pending: "Pending", approved: "Approved", declined: "Declined" };

function certHtml(row, uid, canOpenCert) {
  if (!row.certificatePath) return "";
  if (row.uid === uid || canOpenCert) {
    const id = esc(row.id);
    return `<div class="lv-cert-row"><button type="button" class="sm-btn lv-cert" data-cert="${id}">Open certificate</button><button type="button" class="sm-btn primary lv-cert-dl" data-cert="${id}">Download</button></div>`;
  }
  return `<p class="sub">Certificate attached. Only that person and an admin can open it.</p>`;
}

export function certificateDownloadName(row) {
  const name = String(row && row.name || "staff").trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "staff";
  const type = ["annual", "sick", "other"].includes(row && row.type) ? row.type : "leave";
  const start = /^\d{4}-\d{2}-\d{2}$/.test(row && row.start || "") ? row.start : "date";
  const match = /\.(pdf|jpeg|jpg|png|webp)$/i.exec(String(row && row.certificatePath || ""));
  let ext = match ? match[1].toLowerCase() : "bin";
  if (ext === "jpeg") ext = "jpg";
  return `${name}_${type}_${start}.${ext}`;
}

function clickFileLink(documentRef, { href, download, target }) {
  const link = documentRef.createElement("a");
  link.href = href;
  link.download = download;
  link.rel = "noopener";
  if (target) link.target = target;
  documentRef.body.appendChild(link);
  link.click();
  link.remove();
}

/** Save a certificate the person is already allowed to read. Blob keeps the filename on desktop. iPhone uses the share sheet, then the download URL. */
export async function saveCertificate({ blob, downloadUrl, filename, doc, nav } = {}) {
  const documentRef = doc || globalThis.document;
  const navigatorRef = nav || globalThis.navigator;
  const ua = String(navigatorRef && navigatorRef.userAgent || "");
  const ios = /iPhone|iPad|iPod/i.test(ua) || !!(navigatorRef && navigatorRef.platform === "MacIntel" && navigatorRef.maxTouchPoints > 1);
  const file = blob && typeof File === "function" ? new File([blob], filename, { type: blob.type || "application/octet-stream" }) : null;
  if (ios && file && navigatorRef && typeof navigatorRef.canShare === "function" && navigatorRef.canShare({ files: [file] }) && typeof navigatorRef.share === "function") {
    try {
      await navigatorRef.share({ files: [file], title: filename });
      return { ok: true, via: "share", filename };
    } catch (err) {
      if (err && err.name === "AbortError") return { ok: true, via: "share", filename };
    }
  }
  if (blob && documentRef && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    const objectUrl = URL.createObjectURL(blob);
    clickFileLink(documentRef, { href: objectUrl, download: filename, target: ios ? "_blank" : "" });
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    if (!ios) return { ok: true, via: "blob", filename };
  }
  if (downloadUrl && documentRef) {
    clickFileLink(documentRef, { href: downloadUrl, download: filename, target: "_blank" });
    return { ok: true, via: "url", filename };
  }
  return { ok: !!blob, via: blob ? "blob" : "", filename };
}

export function leaveScreenHtml({ requests, uid, canDecide, canOpenCert, error } = {}) {
  const rows = Array.isArray(requests) ? requests : [];
  const mine = rows.filter(row => row.uid === uid).sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")));
  const queue = canDecide ? rows.filter(row => row.status === "pending").sort((a, b) => String(a.start || "").localeCompare(String(b.start || ""))) : [];
  const types = LEAVE_TYPES.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join("");
  const half = name => `<select name="${name}"><option value="">Full day</option><option value="am">Morning only</option><option value="pm">Afternoon only</option></select>`;
  const form = `<form id="leaveform" class="lv-form">
    <h2>Request leave</h2>
    <label>Type<select name="type" required>${types}</select></label>
    <div class="lv-row"><label>Starts<input type="date" name="start" required></label><label>That day${half("startHalf")}</label></div>
    <div class="lv-row"><label>Ends<input type="date" name="end" required></label><label>That day${half("endHalf")}</label></div>
    <label>Reason<textarea name="reason" required maxlength="500" rows="3" placeholder="Why you need the leave"></textarea></label>
    <label>Medical certificate <span class="sub">optional · photo or PDF · only you and admins can open it</span><input type="file" name="certificate" accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"></label>
    <p id="leaveerr" class="err">${esc(error || "")}</p>
    <button type="submit" class="sm-btn primary">Submit request</button>
  </form>`;
  const card = (row, decide) => {
    const note = row.decisionNote ? `<p class="sub">${esc(STATUS_LABEL[row.status] || row.status)} · ${esc(row.decisionNote)}</p>` : "";
    const actions = decide && row.status === "pending"
      ? `<form class="lv-decide" data-id="${esc(row.id)}"><label>Note<textarea name="note" required maxlength="500" rows="2" placeholder="Required"></textarea></label><div class="btns"><button type="submit" class="sm-btn primary" value="approved">Approve</button><button type="submit" class="sm-btn" value="declined">Decline</button></div><p class="lv-msg sub"></p></form>`
      : "";
    return `<article class="lv-card lv-${esc(row.status || "pending")}"><h3>${esc(row.name || "Staff")} · ${esc(typeLabel(row.type))}</h3><p>${esc(leaveSpan(row))}</p><p>${esc(row.reason || "")}</p><p class="qpill">${esc(STATUS_LABEL[row.status] || "Pending")}</p>${note}${certHtml(row, uid, canOpenCert)}${actions}</article>`;
  };
  const mineCards = mine.map(row => card(row, false)).join("") || `<p class="sub">You have no leave requests yet.</p>`;
  const queueHtml = canDecide ? `<h2>To decide</h2>${queue.map(row => card(row, true)).join("") || `<p class="sub">Nothing waiting.</p>`}` : "";
  return `${form}<h2>Your requests</h2>${mineCards}${queueHtml}`;
}
