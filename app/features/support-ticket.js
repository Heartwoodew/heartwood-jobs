// Raise a support ticket. Any signed-in person can send one. The form does not
// show prices, rates, or another company's records. The screenshot is a private
// Storage object. Master (the platform owner) lists every ticket.

export const SHELL_VERSION = "callup-shell-v147-help-videos";
export const SHOT_MAX_BYTES = 5 * 1024 * 1024;
export const SHOT_INPUT_MAX = 12 * 1024 * 1024;
const SHOT_EDGE = 1600;
const SHOT_QUALITY = 0.82;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function clip(value, max) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

export function newTicketId(fill) {
  const bytes = new Uint8Array(20);
  if (fill) fill(bytes);
  else if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else throw new Error("no-crypto");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}

export function supportShotPath(companyId, uid, ticketId) {
  return `supportTickets/${companyId}/${uid}/${ticketId}/shot.jpg`;
}

export function screenshotFileOk(file) {
  if (!file) return { ok: true };
  const type = String(file.type || "");
  if (!IMAGE_TYPES.has(type)) return { ok: false, reason: "type" };
  if (!file.size || file.size > SHOT_INPUT_MAX) return { ok: false, reason: "size" };
  return { ok: true };
}

export function screenshotUploadPlan(path, { uid, companyId, ticketId } = {}) {
  return {
    path,
    contentType: "image/jpeg",
    metadata: {
      purpose: "support-ticket",
      uploaderUid: String(uid || ""),
      companyId: String(companyId || ""),
      ticketId: String(ticketId || ""),
    },
  };
}

export function ticketPage(loc, view) {
  const path = String((loc && loc.pathname) || "/");
  const search = String((loc && loc.search) || "");
  const route = String(view || "").replace(/[\r\n]/g, " ").trim();
  return (path + search + (route ? " " + route : "")).replace(/\s+/g, " ").trim().slice(0, 200);
}

export function prepareTicket(input = {}) {
  const subject = String(input.subject || "").replace(/[\r\n]+/g, " ").trim();
  const description = String(input.description || "").replace(/\r\n/g, "\n").trim();
  if (!subject || subject.length > 120) return { ok: false, reason: "subject" };
  if (!description || description.length > 4000) return { ok: false, reason: "description" };
  const uid = String(input.uid || "").trim();
  const companyId = String(input.companyId || "").trim();
  if (!uid || !companyId) return { ok: false, reason: "account" };
  const id = String(input.id || "").trim();
  if (!/^[A-Za-z0-9]{16,28}$/.test(id)) return { ok: false, reason: "id" };
  const file = input.file || null;
  const shot = screenshotFileOk(file);
  if (!shot.ok) return shot;
  const screenshotPath = file ? supportShotPath(companyId, uid, id) : "";
  return {
    ok: true,
    id,
    screenshotPath,
    doc: {
      subject,
      description,
      uid,
      name: clip(input.name, 80),
      email: clip(input.email, 120),
      role: clip(input.staffRole || input.role, 40),
      companyId,
      companyName: clip(input.companyName, 80),
      appVersion: clip(input.appVersion || SHELL_VERSION, 80),
      swVersion: clip(input.swVersion || SHELL_VERSION, 80),
      userAgent: clip(input.userAgent, 300),
      page: clip(input.page, 200),
      status: "open",
      screenshotPath,
    },
  };
}

export function ticketFailureText(code) {
  if (code === "subject") return "Add a subject.";
  if (code === "description") return "Describe what happened.";
  if (code === "type") return "Use a photo: JPEG, PNG, WebP or GIF.";
  if (code === "size") return "That image is too large.";
  if (code === "compress") return "Couldn't read that image. Try another photo.";
  if (code === "upload") return "The screenshot could not be saved.";
  if (code === "account") return "Sign in again, then raise the ticket.";
  return "The ticket could not be sent. Try again.";
}

export function ticketDialogHtml() {
  return `<div class="embox ticketbox" role="dialog" aria-label="Raise ticket">
    <h3>Raise a ticket</h3>
    <p class="sub">This sends a note to CallUp support. It does not change your jobs.</p>
    <form id="ticketform" class="jf">
      <label>Subject<input name="subject" required maxlength="120" autocomplete="off"></label>
      <label>What happened<textarea name="description" required maxlength="4000" rows="5"></textarea></label>
      <label>Screenshot, optional<input name="shot" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
      <button class="primary" type="submit">Send ticket</button>
      <p id="ticketerr" class="err"></p>
    </form>
    <button type="button" class="mbtn" data-x>Close</button>
  </div>`;
}

export function ticketTime(ticket) {
  const value = ticket && ticket.createdAt;
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const n = new Date(value).getTime();
  return Number.isNaN(n) ? 0 : n;
}

function whenTicket(value) {
  const ms = ticketTime({ createdAt: value });
  if (!ms) return "";
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
  } catch {
    return "";
  }
}

export function masterTicketsHtml(tickets, { focusId = "" } = {}) {
  const rows = (tickets || []).slice().sort((a, b) => ticketTime(b) - ticketTime(a) || String(b.id || "").localeCompare(String(a.id || "")));
  const body = rows.map(ticket => {
    const open = ticket.status !== "closed";
    const next = open ? "closed" : "open";
    const focus = ticket.id && ticket.id === focusId ? " ticket-focus" : "";
    const shot = ticket.screenshotPath
      ? `<img alt="Screenshot" data-ticket-shot="${esc(ticket.screenshotPath)}">`
      : `<p class="sub">No screenshot</p>`;
    return `<article class="ticket-row${focus}" id="ticket-${esc(ticket.id)}">
      <div class="sm-head"><h3>${esc(ticket.subject || "Ticket")}</h3><span class="sub">${open ? "open" : "closed"}</span></div>
      <p>${esc(ticket.description || "")}</p>
      <p class="sub">${esc(ticket.name || "")}${ticket.email ? " · " + esc(ticket.email) : ""}${ticket.role ? " · " + esc(ticket.role) : ""}<br>
        ${esc(ticket.companyName || "")}${ticket.companyId ? " · " + esc(ticket.companyId) : ""}<br>
        ${esc(ticket.page || "")}${ticket.appVersion ? " · " + esc(ticket.appVersion) : ""}<br>
        ${esc(whenTicket(ticket.createdAt))}</p>
      ${shot}
      <button type="button" class="sm-btn" data-ticket-toggle="${esc(ticket.id)}" data-ticket-next="${next}">${open ? "Close ticket" : "Reopen ticket"}</button>
    </article>`;
  }).join("");
  return `<section class="card" id="supporttickets"><h2>Tickets</h2><p class="sub">Newest first. Close a ticket when it is done.</p>${body || `<p class="muted">No tickets yet.</p>`}</section>`;
}

export async function compressTicketShot(file) {
  const check = screenshotFileOk(file);
  if (!file || !check.ok) throw Object.assign(new Error(check.reason || "type"), { code: check.reason || "type" });
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    if (file.type === "image/jpeg" && file.size <= SHOT_MAX_BYTES) return file;
    throw Object.assign(new Error("compress"), { code: "compress" });
  }
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bmp) throw Object.assign(new Error("compress"), { code: "compress" });
  const edge = Math.max(bmp.width, bmp.height) || 1;
  const k = Math.min(1, SHOT_EDGE / edge);
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", SHOT_QUALITY));
  if (!blob || !blob.size || blob.size > SHOT_MAX_BYTES) throw Object.assign(new Error("size"), { code: "size" });
  return blob;
}
