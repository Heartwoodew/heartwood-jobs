// Phone offline behaviour for CallUp field crews.
// Firestore already queues document writes. This module decides what the screen
// should say, which jobs to warm, and how photo / receipt / document bytes wait
// in a store until the phone has signal again.
// Email sending is intentionally not queued: the callable's idempotency key
// includes the clock time, so a retry after a lost response would send twice.

export const SAVED_ON_PHONE = "Saved on phone — will sync";
export const SYNC_TAG = "callup-uploads";
export const WARM_DAYS = 14;
export const DB_NAME = "callup-offline";
export const DB_VERSION = 1;

export const SERVER_ACTIONS = Object.freeze({
  "email-job": "Email job needs signal. Nothing was sent.",
  "quote-price": "Quote travel pricing needs signal. Enter the kilometres if you already know them.",
  helper: "The assistant needs signal. This answer is the one saved on the phone.",
  billing: "Billing needs signal.",
  invite: "Sending a staff invite needs signal.",
  "password-reset": "Password reset needs signal.",
  "gps-remind": "Sending a location reminder needs signal.",
  "stop-series": "Stop series needs a connection so future visits can be checked before they are removed.",
  server: "This needs signal.",
});

const CALL_ACTIONS = Object.freeze({
  sendJobEmail: "email-job",
  createBillingCheckout: "billing",
  createBillingPortal: "billing",
  helperAsk: "helper",
  adminSendPasswordReset: "password-reset",
  remindLocationSharing: "gps-remind",
  attachSignupReferral: "server",
  ensureReferralCode: "server",
  deleteCompanyAccount: "server",
  acceptStaffInvite: "invite",
  previewStaffInvite: "invite",
});

export function deviceOnline(online) {
  if (online === false) return false;
  if (online === true) return true;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  return true;
}

export function actionForCall(name) {
  return CALL_ACTIONS[name] || "server";
}

export function needsSignal(action, online) {
  if (deviceOnline(online)) return { ok: true, message: "" };
  const key = SERVER_ACTIONS[action] ? action : "server";
  return { ok: false, action: key, message: SERVER_ACTIONS[key] };
}

// The job-email callable is not safe to replay from an outbox.
export function emailOutboxAllowed() {
  return false;
}

export function addDaysIso(day, n) {
  const d = new Date(String(day) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Jobs the signed-in person should have on the phone before they lose signal.
// Office sees the company window. Crew see jobs they are assigned to.
export function jobsToWarm(jobs, { today, uid = "", days = WARM_DAYS, office = false } = {}) {
  if (!today) return [];
  const end = addDaysIso(today, days);
  if (!end) return [];
  const out = [];
  for (const job of jobs || []) {
    if (!job || !job.id || !job.date) continue;
    if (job.date < today || job.date > end) continue;
    if (!office && uid) {
      const assigned = Array.isArray(job.assigned) ? job.assigned : [];
      if (!assigned.includes(uid)) continue;
    }
    out.push(job);
    if (out.length >= 40) break;
  }
  return out;
}

export function warmReads({ jobs = [], companyId = "", uid = "", swmsIds = [], days = WARM_DAYS, today = "" } = {}) {
  const reads = [];
  for (const job of jobs) {
    if (job && job.id) reads.push({ kind: "documents", jobId: String(job.id) });
  }
  if (uid && today) {
    for (let i = 0; i <= days; i++) {
      const date = addDaysIso(today, i);
      if (date) reads.push({ kind: "run-sheet", uid, date });
    }
  }
  if (companyId) {
    reads.push({ kind: "company", companyId });
    reads.push({ kind: "prestart-templates", companyId });
    reads.push({ kind: "fleet", companyId });
    reads.push({ kind: "take5-settings", companyId });
  }
  for (const id of swmsIds || []) if (id) reads.push({ kind: "swms", id: String(id) });
  if (uid && companyId) reads.push({ kind: "swms-signatures", companyId, uid });
  return reads;
}

// A signed-in user with no cached profile must not be shown the "no company" screen.
export function profileMiss({ online, cached }) {
  if (cached) return { action: "use" };
  if (deviceOnline(online) === false) return { action: "offline-hold" };
  return { action: "no-access" };
}

export function makeUpload(input = {}) {
  const file = input.file;
  const id = String(input.id || "");
  const kind = String(input.kind || "");
  const uid = String(input.uid || "");
  const path = String(input.path || "");
  const allowed = ["photo", "receipt", "document", "take5", "leave-cert", "claim-receipt"];
  if (!id || !allowed.includes(kind) || !uid || !path || !file) return { ok: false, reason: "incomplete" };
  return {
    ok: true,
    row: {
      id,
      kind,
      uid,
      companyId: String(input.companyId || ""),
      path,
      contentType: String(input.contentType || file.type || "application/octet-stream"),
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
      label: String(input.label || file.name || kind).slice(0, 160),
      extra: input.extra && typeof input.extra === "object" ? input.extra : {},
      file,
      bytes: Number(file.size) || 0,
      createdAt: Date.now(),
      attempts: 0,
      lastError: "",
      hold: false,
    },
  };
}

export function makeOutbox(input = {}) {
  const id = String(input.id || "");
  const uid = String(input.uid || "");
  const kind = String(input.kind || "");
  if (!id || !uid || !kind || !input.payload || typeof input.payload !== "object") return { ok: false, reason: "incomplete" };
  return {
    ok: true,
    row: {
      id,
      uid,
      kind,
      companyId: String(input.companyId || ""),
      label: String(input.label || kind).slice(0, 160),
      payload: input.payload,
      createdAt: input.createdAt || Date.now(),
      attempts: input.attempts || 0,
      lastError: input.lastError || "",
      hold: !!input.hold,
    },
  };
}

export function classifyUploadError(error) {
  const code = String((error && (error.code || error.message)) || error || "");
  if (/permission-denied|unauthorized|unauthenticated|storage\/unauthorized|storage\/unauthenticated/i.test(code)) return "refused";
  return "retry";
}

export function applyUploadError(row, error) {
  const verdict = classifyUploadError(error);
  const lastError = String((error && (error.code || error.message)) || error || verdict);
  return {
    ...row,
    attempts: (row.attempts || 0) + 1,
    lastError,
    hold: verdict === "refused",
  };
}

export function rowsReady(rows) {
  return (rows || []).filter(row => row && !row.hold);
}

// Refused files stay in the store. Retryable files stay too. Nothing is deleted on a network miss.
export async function flushUploads(rows, { online, upload } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (online === false) return { uploaded: [], kept: list.slice(), refused: list.filter(row => row.hold) };
  const uploaded = [];
  const kept = [];
  const refused = [];
  for (const row of list) {
    if (row.hold) { refused.push(row); continue; }
    try {
      await upload(row);
      uploaded.push(row);
    } catch (error) {
      const next = applyUploadError(row, error);
      if (next.hold) refused.push(next);
      else kept.push(next);
    }
  }
  return { uploaded, kept, refused };
}

export function noteWrite(list, item) {
  const id = item && item.id;
  if (!id) return Array.isArray(list) ? list.slice() : [];
  const next = (list || []).filter(row => row.id !== id);
  next.push({ id, kind: item.kind || "write", label: item.label || "Saved on this phone", at: item.at || Date.now() });
  return next;
}

export function clearWrite(list, id) {
  return (list || []).filter(row => row.id !== id);
}

export function pendingEntries({ writes = [], uploads = [], outbox = [], documents = [] } = {}) {
  const items = [];
  for (const row of writes) items.push({ id: row.id, kind: row.kind || "write", label: row.label || "Saved on this phone", state: "waiting" });
  for (const row of uploads) items.push(fileEntry(row));
  for (const row of documents) items.push({ id: "doc:" + row.id, kind: "document", label: row.name || row.fileName || "Document", state: "waiting" });
  for (const row of outbox) items.push({
    id: row.id,
    kind: row.kind || "outbox",
    label: row.label || row.kind,
    state: row.hold ? "needs-you" : "waiting",
    detail: row.hold ? (row.lastError || "") : "",
  });
  return items;
}

function fileEntry(row) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label || row.kind,
    state: row.hold ? "needs-you" : "waiting",
    detail: row.hold ? (row.lastError || "Not accepted") : "",
  };
}

export function indicatorModel({ online, pendingCount = 0 } = {}) {
  const n = Math.max(0, Number(pendingCount) || 0);
  if (!deviceOnline(online)) return { mode: "offline", text: n ? `Offline · ${n} waiting to sync` : "Offline", pending: n };
  if (n) return { mode: "pending", text: `${n} waiting to sync`, pending: n };
  return { mode: "online", text: "Online", pending: 0 };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function pendingListHtml(items) {
  const rows = items || [];
  if (!rows.length) return `<p class="sub">Nothing is waiting. Changes you make with signal save straight away.</p>`;
  return `<ul class="syncitems">${rows.map(row => `<li><b>${esc(row.label || row.kind)}</b> <span class="sub">${row.state === "needs-you" ? "Needs a check on this phone" : "Saved on phone — will sync"}</span></li>`).join("")}</ul>`;
}

export function memoryOfflineStore() {
  const files = new Map();
  const outbox = new Map();
  const own = (row, uid) => row && (!uid || row.uid === uid);
  return {
    async putFile(row) { files.set(row.id, row); },
    async removeFile(id) { files.delete(id); },
    async listFiles(uid) { return [...files.values()].filter(row => own(row, uid)); },
    async putOutbox(row) { outbox.set(row.id, row); },
    async removeOutbox(id) { outbox.delete(id); },
    async listOutbox(uid) { return [...outbox.values()].filter(row => own(row, uid)); },
  };
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbOfflineStore() {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (store, mode, fn) => {
    const db = await open();
    try {
      const tx = db.transaction(store, mode);
      const result = await fn(tx.objectStore(store));
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return result;
    } finally {
      db.close();
    }
  };
  return {
    putFile: row => run("files", "readwrite", store => requestToPromise(store.put(row))),
    removeFile: id => run("files", "readwrite", store => requestToPromise(store.delete(id))),
    async listFiles(uid) {
      const rows = await run("files", "readonly", store => requestToPromise(store.getAll()));
      return (rows || []).filter(row => row && (!uid || row.uid === uid));
    },
    putOutbox: row => run("outbox", "readwrite", store => requestToPromise(store.put(row))),
    removeOutbox: id => run("outbox", "readwrite", store => requestToPromise(store.delete(id))),
    async listOutbox(uid) {
      const rows = await run("outbox", "readonly", store => requestToPromise(store.getAll()));
      return (rows || []).filter(row => row && (!uid || row.uid === uid));
    },
  };
}

export function createOfflineStore() {
  const memory = memoryOfflineStore();
  if (typeof indexedDB === "undefined") return memory;
  const idb = idbOfflineStore();
  const mix = (primary, extra) => {
    const seen = new Set(primary.map(row => row.id));
    return primary.concat(extra.filter(row => row && !seen.has(row.id)));
  };
  return {
    async putFile(row) { try { await idb.putFile(row); } catch { await memory.putFile(row); } },
    async removeFile(id) { try { await idb.removeFile(id); } catch { /* memory copy still goes */ } await memory.removeFile(id); },
    async listFiles(uid) {
      try { return mix(await idb.listFiles(uid), await memory.listFiles(uid)); }
      catch { return memory.listFiles(uid); }
    },
    async putOutbox(row) { try { await idb.putOutbox(row); } catch { await memory.putOutbox(row); } },
    async removeOutbox(id) { try { await idb.removeOutbox(id); } catch { /* memory copy still goes */ } await memory.removeOutbox(id); },
    async listOutbox(uid) {
      try { return mix(await idb.listOutbox(uid), await memory.listOutbox(uid)); }
      catch { return memory.listOutbox(uid); }
    },
  };
}

let singleton = null;
export function sharedOfflineStore() {
  if (!singleton) singleton = createOfflineStore();
  return singleton;
}

export function canBackgroundSync(registration) {
  return !!(registration && registration.sync && typeof registration.sync.register === "function");
}

export async function registerUploadSync(nav = typeof navigator !== "undefined" ? navigator : null) {
  try {
    if (!nav || !nav.serviceWorker) return false;
    const reg = await nav.serviceWorker.ready;
    if (!canBackgroundSync(reg)) return false;
    await reg.sync.register(SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}
