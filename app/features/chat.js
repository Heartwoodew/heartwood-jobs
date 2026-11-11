// Team chat and per-job chat. Plain text, optional private photo.
// Paths and payloads only. Firestore rules are the authority.
// No download URLs and no public tokens.

import { canSeeJob } from "./cloud-storage.js";

export const STAFF_THREAD = "staff";
export const CHAT_MIMES = Object.freeze(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const CHAT_MAX_BYTES = 8 * 1024 * 1024;
export const CHAT_TEXT_MAX = 4000;
const SEEN_KEY = "hwChatSeen:";

function deny(reason) {
  return { ok: false, reason };
}

export function jobThreadId(jobId) {
  const id = String(jobId || "");
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return null;
  return "job_" + id;
}

export function threadJobId(threadId) {
  if (typeof threadId !== "string" || !threadId.startsWith("job_")) return null;
  const id = threadId.slice(4);
  return jobThreadId(id) === threadId ? id : null;
}

export function canUseTeamChat(membership) {
  return !!(membership && membership.ok && membership.tenantId);
}

export function canUseJobChat(membership, job) {
  return canSeeJob(membership, job);
}

export function canDeleteMessage(membership, message) {
  if (!membership?.ok || !message) return false;
  if (message.senderUid && message.senderUid === membership.uid) return true;
  return !!membership.rulesAdmin;
}

export function newChatFileId() {
  const bytes = new Uint8Array(12);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return "c" + [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function chatPhotoPath(tenantId, threadId, fileId) {
  if (!tenantId || !/^c[A-Za-z0-9]{8,40}$/.test(String(fileId || ""))) return null;
  if (threadId === STAFF_THREAD) return `tenants/${tenantId}/chat/staff/photos/${fileId}`;
  const jobId = threadJobId(threadId);
  if (!jobId) return null;
  return `tenants/${tenantId}/chat/jobs/${jobId}/photos/${fileId}`;
}

export function planChatPhoto({ membership, threadId, job, file, fileId } = {}) {
  if (!canUseTeamChat(membership)) return deny(membership?.reason || "no-membership");
  const id = String(fileId || "");
  const path = chatPhotoPath(membership.tenantId, threadId, id);
  if (!path) return deny("bad-name");
  if (threadId === STAFF_THREAD) {
    if (!canUseTeamChat(membership)) return deny("not-allowed");
  } else {
    if (!job || jobThreadId(job.id) !== threadId) return deny("bad-thread");
    if (!canUseJobChat(membership, job)) return deny("not-allowed");
  }
  if (!file) return deny("no-file");
  const type = String(file.type || "").toLowerCase();
  if (!CHAT_MIMES.includes(type)) return deny("mime-not-allowed");
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) return deny("empty-file");
  if (size > CHAT_MAX_BYTES) return deny("too-large");
  if (path.includes("/finance/") || path.includes("/receipts/") || path.includes("/_exports/")) return deny("not-allowed");
  const metadata = {
    tenantId: membership.tenantId,
    threadId,
    uploaderUid: membership.uid,
    purpose: "chat-photo",
  };
  if (threadId !== STAFF_THREAD) metadata.jobId = String(job.id);
  return { ok: true, path, contentType: type, bytes: size, metadata };
}

export function messagePayload({ uid, name, text, photo } = {}) {
  if (!uid) return deny("not-allowed");
  const body = String(text || "").replace(/\r\n/g, "\n").trim();
  if (body.length > CHAT_TEXT_MAX) return deny("too-long");
  if (!body && !photo?.path) return deny("empty");
  const senderName = String(name || "Staff").trim().slice(0, 80) || "Staff";
  const data = { senderUid: uid, senderName, text: body };
  if (photo?.path) {
    if (!CHAT_MIMES.includes(String(photo.contentType || "").toLowerCase())) return deny("mime-not-allowed");
    if (String(photo.path).includes("/receipts/") || String(photo.path).includes("/finance/") || String(photo.path).includes("/_exports/")) {
      return deny("not-allowed");
    }
    data.photoPath = photo.path;
    data.photoType = String(photo.contentType).toLowerCase();
  }
  return { ok: true, data };
}

export function headPayload({ uid, name, text, photo } = {}) {
  const previewSrc = String(text || "").trim() || (photo?.path ? "Photo" : "");
  return {
    lastSenderUid: uid,
    lastSenderName: String(name || "Staff").trim().slice(0, 80) || "Staff",
    preview: previewSrc.slice(0, 140),
  };
}

export function messageMillis(message) {
  const t = message && message.createdAt;
  if (t == null || t === "") return null;
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t.toDate === "function") {
    const d = t.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
  }
  if (typeof t.seconds === "number") return t.seconds * 1000 + Math.floor((t.nanoseconds || 0) / 1e6);
  if (typeof t === "number" && Number.isFinite(t)) return t;
  if (typeof t === "string") {
    const n = Date.parse(t);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export function messageDate(message) {
  const ms = messageMillis(message);
  return ms == null ? null : new Date(ms);
}

export function orderedMessages(messages) {
  return [...(messages || [])].sort((a, b) => {
    const ta = messageMillis(a);
    const tb = messageMillis(b);
    if (ta == null && tb == null) return String(a?.id || "").localeCompare(String(b?.id || ""));
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb || String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}

export function unreadCount(messages, seenMillis, myUid) {
  let n = 0;
  for (const message of messages || []) {
    if (!message || message.senderUid === myUid) continue;
    const at = messageMillis(message);
    if (at == null) continue;
    if (seenMillis == null || at > seenMillis) n += 1;
  }
  return n;
}

export function headUnread(head, seenMillis, myUid) {
  if (!head) return 0;
  if (head.lastSenderUid && head.lastSenderUid === myUid) return 0;
  const at = messageMillis({ createdAt: head.lastAt });
  if (at == null) return 0;
  if (seenMillis != null && at <= seenMillis) return 0;
  return 1;
}

export function threadUnread({ messages, head, seenMillis, myUid, loaded }) {
  if (loaded) return unreadCount(messages, seenMillis, myUid);
  return headUnread(head, seenMillis, myUid);
}

export function formatBadge(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return n > 9 ? "9+" : String(n);
}

export function shouldStickToBottom({ scrollHeight, scrollTop, clientHeight, first }) {
  if (first) return true;
  if (!scrollHeight || scrollHeight <= clientHeight) return true;
  return scrollHeight - scrollTop - clientHeight < 80;
}

export function formatChatTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function readSeenMap(storage, uid) {
  if (!storage || !uid) return {};
  try {
    const raw = storage.getItem(SEEN_KEY + uid);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

export function writeSeenMap(storage, uid, map) {
  if (!storage || !uid) return;
  storage.setItem(SEEN_KEY + uid, JSON.stringify(map || {}));
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function badgeMarkup(threadId, count) {
  const label = formatBadge(count);
  return `<span class="nav-badge" data-badge-thread="${esc(threadId)}" ${label ? "" : "hidden"}>${label}</span>`;
}

export function messagesHtml(messages, { myUid, canDelete } = {}) {
  const rows = orderedMessages(messages);
  if (!rows.length) return `<p class="chat-empty">No messages yet.</p>`;
  return rows.map(m => {
    const mine = m.senderUid === myUid;
    const when = formatChatTime(messageDate(m));
    const photo = m.photoPath
      ? `<button type="button" class="chat-pic" data-open-photo="${esc(m.photoPath)}"><img alt="Photo from ${esc(m.senderName || "staff")}" data-chat-photo="${esc(m.photoPath)}"></button>`
      : "";
    const allow = typeof canDelete === "function" ? canDelete(m) : false;
    const del = allow ? `<button type="button" class="chat-del" data-del="${esc(m.id)}">Delete</button>` : "";
    const text = m.text ? `<p class="chat-text">${esc(m.text)}</p>` : "";
    return `<article class="chat-msg ${mine ? "mine" : "theirs"}" data-mid="${esc(m.id)}"><div class="chat-meta"><b>${esc(m.senderName || "Staff")}</b>${when ? ` · <time>${esc(when)}</time>` : ""}</div>${text}${photo}${del}</article>`;
  }).join("");
}

export function chatShellHtml({ threadId, title, subtitle, extra = "" }) {
  return `<section class="chat-screen" data-thread="${esc(threadId)}">
    <div class="chat-head"><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>
    ${extra || ""}
    <div class="chat-log" role="log" aria-relevant="additions" aria-label="${esc(title)}" data-thread="${esc(threadId)}"></div>
    <div class="chat-pending" hidden></div>
    <div class="chat-compose" data-compose="${esc(threadId)}">
      <button type="button" class="chat-attach" aria-label="Attach a photo">+</button>
      <input class="chat-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
      <textarea rows="1" maxlength="${CHAT_TEXT_MAX}" placeholder="Message the team" aria-label="Message"></textarea>
      <button type="button" class="chat-send">Send</button>
    </div>
  </section>`;
}

export function chatDeniedHtml(message) {
  return `<section class="chat-screen chat-denied"><p>${esc(message)}</p></section>`;
}
