// Browser wiring for team chat and job chat. Rules reject a bad write.
// Photos are read with authenticated getBlob. No public download link is created.

import {
  collection, doc, query, orderBy, limitToLast, onSnapshot, addDoc, setDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getBlob, deleteObject } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { resolveMembership } from "./cloud-storage.js";
import { orgSettings } from "../org-settings.js";
import {
  STAFF_THREAD, badgeMarkup, canDeleteMessage, canUseJobChat, canUseTeamChat, chatDeniedHtml, chatPhotoPath,
  chatShellHtml, headPayload, headUnread, jobThreadId, messageMillis, messagePayload, messagesHtml,
  newChatFileId, orderedMessages, planChatPhoto, readSeenMap, shouldStickToBottom, threadJobId, unreadCount,
  writeSeenMap,
} from "./chat.js";
import { alertsModel, bindChatAlerts, chatAlertsHtml, noteHead, noteMessages, startChatAlerts, stopChatAlerts } from "./chat-notify.js";

const urls = new Map();
const state = {
  me: null,
  membership: null,
  messages: {},
  loaded: {},
  heads: {},
  seen: {},
  errors: {},
  drafts: {},
  listening: new Set(),
  seenListening: new Set(),
  markedOpen: {},
  headUnsubs: new Map(),
  unsubs: [],
};

let deps = null;

function membershipOf(me) {
  if (!me?.uid) return { ok: false, reason: "no-membership" };
  return resolveMembership({ uid: me.uid, profile: me.cloudProfile || null });
}

function tenantId() {
  return state.membership?.tenantId || "";
}

function seenMillis(threadId) {
  const n = Number(state.seen[threadId]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function staffUnread() {
  return threadCount(STAFF_THREAD);
}

export function jobUnread(jobId) {
  const threadId = jobThreadId(jobId);
  return threadId ? threadCount(threadId) : 0;
}

function threadCount(threadId) {
  const uid = state.me?.uid;
  if (state.loaded[threadId]) return unreadCount(state.messages[threadId], seenMillis(threadId), uid);
  return headUnread(state.heads[threadId], seenMillis(threadId), uid);
}

function badge(threadId) {
  return badgeMarkup(threadId, threadId === STAFF_THREAD ? staffUnread() : threadCount(threadId));
}

function persistSeen() {
  try { writeSeenMap(localStorage, state.me?.uid, state.seen); } catch { /* private mode */ }
}

function paintBadges() {
  document.querySelectorAll("[data-badge-thread]").forEach(el => {
    const threadId = el.dataset.badgeThread;
    const count = threadId === STAFF_THREAD ? staffUnread() : threadCount(threadId);
    const label = count > 9 ? "9+" : count > 0 ? String(count) : "";
    el.textContent = label;
    el.hidden = !label;
  });
}

function visible(el) {
  return !!(el && el.getClientRects && el.getClientRects().length);
}

function cssPath(value) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}

function rememberUrl(path, url) {
  const prev = urls.get(path);
  if (prev && prev !== url) URL.revokeObjectURL(prev);
  urls.set(path, url);
}

function paintLog(log) {
  const threadId = log.dataset.thread;
  const first = log.dataset.booted !== "1";
  const stick = shouldStickToBottom({
    scrollHeight: log.scrollHeight,
    scrollTop: log.scrollTop,
    clientHeight: log.clientHeight,
    first: first || log.dataset.stuck !== "0",
  });
  const err = state.errors[threadId];
  if (err) {
    log.innerHTML = `<p class="chat-empty">Couldn't open this chat (${escText(err)}).</p>`;
  } else {
    log.innerHTML = messagesHtml(state.messages[threadId] || [], {
      myUid: state.me?.uid,
      canDelete: message => canDeleteMessage(state.membership, message),
    });
  }
  log.dataset.booted = "1";
  if (stick) log.scrollTop = log.scrollHeight;
  log.querySelectorAll("img[data-chat-photo]").forEach(img => {
    const path = img.dataset.chatPhoto;
    const known = urls.get(path);
    if (known) img.src = known;
    else loadPhoto(path);
    img.addEventListener("load", () => {
      if (log.dataset.stuck !== "0") log.scrollTop = log.scrollHeight;
    }, { once: true });
  });
}

function escText(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function refresh() {
  paintBadges();
  document.querySelectorAll(".chat-log[data-thread]").forEach(log => {
    paintLog(log);
    maybeMark(log.dataset.thread, log);
  });
}

function maybeMark(threadId, log) {
  if (!visible(log) || state.errors[threadId]) return;
  const latest = orderedMessages(state.messages[threadId] || []).reduce((max, message) => {
    const at = messageMillis(message);
    return at == null ? max : Math.max(max, at);
  }, 0);
  if (state.markedOpen[threadId] && (state.seen[threadId] || 0) >= latest) return;
  state.markedOpen[threadId] = true;
  state.seen[threadId] = Math.max(state.seen[threadId] || 0, latest, Date.now());
  persistSeen();
  paintBadges();
  const tid = tenantId();
  if (!deps || !tid || !state.me?.uid) return;
  setDoc(doc(deps.db, "tenants", tid, "chatSeen", state.me.uid, "threads", threadId), { seenAt: serverTimestamp() })
    .catch(e => console.warn("chat seen", e && (e.code || e.message) || e));
}

async function loadPhoto(path) {
  if (!deps || urls.has(path)) return;
  urls.set(path, "");
  try {
    const blob = await getBlob(storageRef(deps.storage, path));
    const url = URL.createObjectURL(blob);
    rememberUrl(path, url);
    document.querySelectorAll(`img[data-chat-photo="${cssPath(path)}"]`).forEach(img => { img.src = url; });
  } catch (e) {
    urls.delete(path);
    document.querySelectorAll(`img[data-chat-photo="${cssPath(path)}"]`).forEach(img => { img.alt = "Photo unavailable"; });
    console.warn("chat photo", e && (e.code || e.message) || e);
  }
}

function listenMessages(threadId) {
  if (!deps || state.listening.has(threadId) || !tenantId()) return;
  state.listening.add(threadId);
  const q = query(
    collection(deps.db, "tenants", tenantId(), "chats", threadId, "messages"),
    orderBy("createdAt", "asc"),
    limitToLast(100),
  );
  const unsub = onSnapshot(q, snap => {
    state.messages[threadId] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.loaded[threadId] = true;
    state.errors[threadId] = "";
    noteMessages(threadId, state.messages[threadId], state.me?.uid);
    refresh();
  }, err => {
    state.errors[threadId] = err.code || err.message || "permission-denied";
    state.loaded[threadId] = true;
    refresh();
  });
  state.unsubs.push(() => { state.listening.delete(threadId); unsub(); });
}

function listenHead(threadId) {
  if (!deps || !tenantId()) return () => {};
  return onSnapshot(doc(deps.db, "tenants", tenantId(), "chats", threadId), snap => {
    state.heads[threadId] = snap.exists() ? snap.data() : null;
    noteHead(threadId, state.heads[threadId], state.me?.uid, !!state.loaded[threadId]);
    paintBadges();
  }, () => { state.heads[threadId] = null; paintBadges(); });
}

function listenSeen(threadId) {
  if (!deps || !state.me?.uid || !tenantId() || state.seenListening.has(threadId)) return;
  state.seenListening.add(threadId);
  const unsub = onSnapshot(doc(deps.db, "tenants", tenantId(), "chatSeen", state.me.uid, "threads", threadId), snap => {
    if (!snap.exists()) return;
    const at = messageMillis({ createdAt: snap.data().seenAt });
    if (at == null) return;
    state.seen[threadId] = Math.max(state.seen[threadId] || 0, at);
    persistSeen();
    paintBadges();
  }, () => {});
  state.unsubs.push(unsub);
}

async function shrinkChatPhoto(file) {
  if (!file || !/^image\//.test(file.type || "")) throw new Error("Choose a photo");
  if (file.type === "image/gif" && file.size <= 8 * 1024 * 1024) return file;
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bmp) {
    if (file.size <= 8 * 1024 * 1024 && /image\/(jpeg|png|webp)/.test(file.type || "")) return file;
    throw new Error("Can't read that photo");
  }
  const max = 1600;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("Couldn't prepare that photo");
  if (blob.size > 8 * 1024 * 1024) throw new Error("That photo is too large");
  return new File([blob], "chat.jpg", { type: "image/jpeg" });
}

function openViewer(src, alt) {
  if (!src) return;
  const view = document.createElement("div");
  view.className = "chat-view";
  view.innerHTML = `<button type="button" class="chat-view-x">Close</button><img alt="${escText(alt || "Chat photo")}" src="${src}">`;
  view.querySelector("button").onclick = () => view.remove();
  view.addEventListener("click", e => { if (e.target === view) view.remove(); });
  document.body.appendChild(view);
}

function bindScreen(screen, threadId, job) {
  if (!screen || screen.dataset.bound === "1") {
    refresh();
    return;
  }
  screen.dataset.bound = "1";
  const log = screen.querySelector(".chat-log");
  const form = screen.querySelector(".chat-compose");
  const text = form?.querySelector("textarea");
  const file = form?.querySelector(".chat-file");
  const pending = screen.querySelector(".chat-pending");
  let fileBlob = null;
  let fileUrl = "";
  if (text) text.value = state.drafts[threadId] || "";
  log?.addEventListener("scroll", () => {
    const near = shouldStickToBottom({
      scrollHeight: log.scrollHeight,
      scrollTop: log.scrollTop,
      clientHeight: log.clientHeight,
      first: false,
    });
    log.dataset.stuck = near ? "1" : "0";
  });
  const showPending = () => {
    if (!pending) return;
    if (!fileUrl) { pending.hidden = true; pending.innerHTML = ""; return; }
    pending.hidden = false;
    pending.innerHTML = `<img alt="Photo to send" src="${fileUrl}"><button type="button" class="chat-clear">Remove photo</button>`;
    pending.querySelector(".chat-clear").onclick = () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      fileUrl = "";
      fileBlob = null;
      if (file) file.value = "";
      showPending();
    };
  };
  form?.querySelector(".chat-attach")?.addEventListener("click", () => file?.click());
  file?.addEventListener("change", async () => {
    const picked = file.files && file.files[0];
    if (!picked) return;
    try {
      fileBlob = await shrinkChatPhoto(picked);
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      fileUrl = URL.createObjectURL(fileBlob);
      showPending();
    } catch (e) {
      fileBlob = null;
      deps.toast(e.message || "Couldn't attach that photo");
    }
  });
  log?.addEventListener("click", async e => {
    const opener = e.target.closest("[data-open-photo]");
    if (opener) {
      const img = opener.querySelector("img");
      if (img?.src) openViewer(img.src, img.alt);
      return;
    }
    const del = e.target.closest("[data-del]");
    if (!del || !deps) return;
    const id = del.dataset.del;
    const message = (state.messages[threadId] || []).find(m => m.id === id);
    if (!message || !canDeleteMessage(state.membership, message)) return;
    if (!confirm("Delete this message?")) return;
    try {
      await deleteDoc(doc(deps.db, "tenants", tenantId(), "chats", threadId, "messages", id));
      if (message.photoPath && message.photoPath === chatPhotoPath(tenantId(), threadId, message.photoPath.split("/").pop())) {
        await deleteObject(storageRef(deps.storage, message.photoPath)).catch(err => console.warn("chat photo delete", err && (err.code || err.message) || err));
      }
    } catch (err) {
      deps.toast("Not deleted: " + (err.code || err.message));
    }
  });
  async function submitChat() {
    if (!deps || !state.me) return;
    const raw = text ? text.value : "";
    const sendBtn = form.querySelector(".chat-send");
    if (sendBtn) sendBtn.disabled = true;
    try {
      let photo = null;
      if (fileBlob) {
        const planned = planChatPhoto({
          membership: state.membership,
          threadId,
          job,
          file: fileBlob,
          fileId: newChatFileId(),
        });
        if (!planned.ok) throw new Error(planned.reason || "not-allowed");
        await uploadBytes(storageRef(deps.storage, planned.path), fileBlob, {
          contentType: planned.contentType,
          customMetadata: planned.metadata,
        });
        photo = { path: planned.path, contentType: planned.contentType };
      }
      const payload = messagePayload({ uid: state.me.uid, name: state.me.name, text: raw, photo });
      if (!payload.ok) throw new Error(payload.reason === "empty" ? "Write a message or attach a photo" : payload.reason);
      await addDoc(collection(deps.db, "tenants", tenantId(), "chats", threadId, "messages"), {
        ...payload.data,
        createdAt: serverTimestamp(),
      });
      const head = headPayload({ uid: state.me.uid, name: state.me.name, text: payload.data.text, photo });
      await setDoc(doc(deps.db, "tenants", tenantId(), "chats", threadId), { ...head, lastAt: serverTimestamp() });
      if (text) text.value = "";
      state.drafts[threadId] = "";
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      fileUrl = "";
      fileBlob = null;
      if (file) file.value = "";
      showPending();
      if (log) log.dataset.stuck = "1";
    } catch (err) {
      const code = err && (err.code || err.message) || "not sent";
      deps.toast(/permission-denied|unauthorized/i.test(code) ? "You can't post in this chat" : "Not sent: " + code);
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }
  form?.querySelector(".chat-send")?.addEventListener("click", () => submitChat());
  text?.addEventListener("keydown", ev => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submitChat(); }
  });
  text?.addEventListener("input", () => { state.drafts[threadId] = text.value; });
  listenMessages(threadId);
  listenSeen(threadId);
  refresh();
}

function teamHtml() {
  const orgName = orgSettings().name;
  if (!canUseTeamChat(state.membership)) return chatDeniedHtml(`Team chat is for signed-in ${orgName} staff.`);
  return chatShellHtml({
    threadId: STAFF_THREAD,
    title: "Team chat",
    subtitle: `Everyone signed in at ${orgName}`,
    extra: chatAlertsHtml(alertsModel()),
  });
}

function jobHtml(job) {
  const threadId = job && jobThreadId(job.id);
  if (!threadId) return chatDeniedHtml("This job can't have a chat.");
  if (state.membership?.ok && job && !canUseJobChat(state.membership, job) && state.me?.role !== "admin") {
    return chatDeniedHtml("Only the admin and the crew on this job can use this chat.");
  }
  const where = [job.address, job.client].filter(Boolean).join(" · ");
  return chatShellHtml({
    threadId,
    title: "Job chat",
    subtitle: where || "People assigned to this job",
  });
}

function placeholder(screen, message) {
  const area = screen?.querySelector(".chat-compose textarea");
  if (area && message) area.placeholder = message;
}

export function installChatApp({ db, storage, getMe, toast }) {
  deps = { db, storage, getMe, toast };
  return {
    start() {
      const me = getMe();
      state.me = me;
      state.membership = membershipOf(me);
      state.seen = readSeenMap(localStorage, me?.uid);
      startChatAlerts();
      if (!canUseTeamChat(state.membership)) return;
      listenMessages(STAFF_THREAD);
      listenSeen(STAFF_THREAD);
      const stopHead = listenHead(STAFF_THREAD);
      state.unsubs.push(stopHead);
    },
    stop() {
      stopChatAlerts();
      state.unsubs.splice(0).forEach(fn => { try { fn(); } catch { /* already stopped */ } });
      state.headUnsubs.forEach(fn => { try { fn(); } catch { /* already stopped */ } });
      state.headUnsubs.clear();
      state.listening.clear();
      state.seenListening.clear();
      state.markedOpen = {};
      state.me = null;
      state.membership = null;
    },
    watch(jobs) {
      if (!canUseTeamChat(state.membership)) return;
      const ids = [];
      const seen = new Set();
      for (const job of jobs || []) {
        if (!job?.id || seen.has(job.id) || ids.length >= 40) continue;
        if (!jobThreadId(job.id)) continue;
        seen.add(job.id);
        ids.push(job.id);
      }
      for (const id of [...state.headUnsubs.keys()]) {
        if (!seen.has(id)) {
          state.headUnsubs.get(id)();
          state.headUnsubs.delete(id);
        }
      }
      for (const id of ids) {
        if (state.headUnsubs.has(id)) continue;
        state.headUnsubs.set(id, listenHead(jobThreadId(id)));
      }
    },
    teamHtml,
    jobHtml,
    badge,
    mount(root) {
      const screen = root?.querySelector(`.chat-screen[data-thread="${STAFF_THREAD}"]`);
      placeholder(screen, "Message the team");
      bindScreen(screen, STAFF_THREAD, null);
      bindChatAlerts(root);
    },
    openJob(container, job) {
      if (!container || !job) return;
      const threadId = jobThreadId(job.id);
      if (!threadId) return;
      if (!container.querySelector(".chat-screen")) container.innerHTML = jobHtml(job);
      const screen = container.querySelector(".chat-screen");
      placeholder(screen, "Message this job");
      bindScreen(screen, threadId, job);
    },
    refresh,
  };
}

export function chatThreadForJob(jobId) {
  return jobThreadId(jobId);
}

export function jobIdFromThread(threadId) {
  return threadJobId(threadId);
}
