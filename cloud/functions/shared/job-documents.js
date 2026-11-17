// Job documents: private files on a job (plans, quotes, invoices, drawings).
// Office (admin, manager, supervisor) uploads, renames and deletes.
// Crew (operator, labourer) only open documents marked "Crew can see", and only
// because the rules also require they are assigned to that job.
// Quotes and invoices are Office only so prices never sit in a crew member's list.
// Storage bytes do not queue themselves. An offline add is kept in IndexedDB and
// uploaded when the phone is back in signal, same idea as a job save that waits.

export const DOC_MAX_BYTES = 25 * 1024 * 1024;
export const OFFICE_ROLES = ["admin", "manager", "supervisor"];
export const CREW_ROLES = ["operator", "labourer"];
export const OFFLINE_COPY = "Offline — this document will upload when you have signal.";
export const OFFLINE_FAIL_COPY = "You're offline, so this document was not uploaded. Try again when you have signal.";
export const PRICE_HINT = "Quotes and invoices should be Office only, so the crew never see prices.";

const DOC_MIMES = [
  "application/pdf",
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/acad", "application/x-acad", "application/dwg", "application/dxf",
  "image/vnd.dwg", "image/vnd.dxf",
];
const EXT_OK = /\.(pdf|jpe?g|png|webp|gif|heic|heif|docx?|xlsx?|dwg|dxf)$/i;

export const DOC_ACCEPT = [
  "application/pdf", "image/*",
  ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif",
  ".doc", ".docx", ".xls", ".xlsx", ".dwg", ".dxf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

export function canManageDocuments(role) {
  return OFFICE_ROLES.includes(role);
}

export function cleanName(value, max = 160) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function newDocumentId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let id = "d";
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}

function extensionOf(name) {
  const m = String(name || "").match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

export function classifyFile(file) {
  if (!file) return { ok: false, reason: "no-file" };
  const size = Number(file.size) || 0;
  if (size <= 0) return { ok: false, reason: "empty-file" };
  if (size > DOC_MAX_BYTES) return { ok: false, reason: "too-large" };
  const rawType = String(file.type || "").toLowerCase();
  const type = rawType === "image/jpg" ? "image/jpeg" : rawType;
  const ext = extensionOf(file.name);
  const known = DOC_MIMES.includes(type) || DOC_MIMES.includes(rawType);
  const loose = (type === "" || type === "application/octet-stream") && EXT_OK.test(String(file.name || ""));
  if (!known && !loose) return { ok: false, reason: "type-not-allowed" };
  const contentType = known ? (type || rawType) : "application/octet-stream";
  return { ok: true, contentType, ext };
}

export function planDocumentUpload({ companyId, jobId, uid, uploaderName, file, visibility, displayName, docId } = {}) {
  const checked = classifyFile(file);
  if (!checked.ok) return checked;
  if (!companyId || !jobId || !uid) return { ok: false, reason: "not-allowed" };
  const id = docId || newDocumentId();
  if (!/^d[A-Za-z0-9]{8,40}$/.test(id)) return { ok: false, reason: "bad-id" };
  const vis = visibility === "office" ? "office" : "crew";
  const fallback = String(file.name || "").trim() || (checked.ext ? `photo.${checked.ext === "jpeg" ? "jpg" : checked.ext}` : "Document");
  const fileName = cleanName(fallback, 200) || "Document";
  const named = cleanName(displayName);
  const name = named || fileName;
  const path = `tenants/${companyId}/jobs/${jobId}/documents/${id}`;
  return {
    ok: true,
    id,
    path,
    contentType: checked.contentType,
    visibility: vis,
    firestore: {
      companyId,
      tenantId: companyId,
      jobId: String(jobId),
      name,
      fileName,
      contentType: checked.contentType,
      size: Number(file.size) || 0,
      visibility: vis,
      storagePath: path,
      uploaderUid: uid,
      uploaderName: cleanName(uploaderName, 80) || "Staff",
    },
    metadata: {
      tenantId: String(companyId),
      jobId: String(jobId),
      uploaderUid: String(uid),
      purpose: "job-document",
      visibility: vis,
      fileName,
    },
  };
}

export function shouldQueueUpload({ online, error } = {}) {
  if (online === false) return true;
  const code = String((error && (error.code || error.message)) || "");
  return /unavailable|retry-limit-exceeded|offline|network-request-failed|failed to fetch|network error/i.test(code);
}

export function documentKind(contentType, fileName) {
  const type = String(contentType || "").toLowerCase();
  const ext = extensionOf(fileName);
  if (type === "application/pdf" || ext === "pdf") return { key: "pdf", icon: "PDF", label: "PDF" };
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(ext)) return { key: "image", icon: "IMG", label: "Image" };
  if (type.includes("word") || type.includes("document") || ext === "doc" || ext === "docx") return { key: "word", icon: "DOC", label: "Word" };
  if (type.includes("sheet") || type.includes("excel") || ext === "xls" || ext === "xlsx") return { key: "excel", icon: "XLS", label: "Excel" };
  if (ext === "dwg" || ext === "dxf" || type.includes("dwg") || type.includes("dxf") || type.includes("acad")) return { key: "cad", icon: "DWG", label: "Drawing" };
  return { key: "file", icon: "FILE", label: "File" };
}

export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  const mb = b / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export function formatDocWhen(value) {
  let ms = 0;
  if (value && typeof value.toDate === "function") ms = value.toDate().getTime();
  else if (value && typeof value.seconds === "number") ms = value.seconds * 1000;
  else if (value instanceof Date) ms = value.getTime();
  else if (typeof value === "number") ms = value;
  else if (value) ms = new Date(value).getTime();
  if (!ms || Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function docTime(row) {
  const v = row && (row.createdAt || row.queuedAt);
  if (v && typeof v.toMillis === "function") return v.toMillis();
  if (v && typeof v.seconds === "number") return v.seconds * 1000;
  if (typeof v === "number") return v;
  const n = v ? new Date(v).getTime() : 0;
  return Number.isFinite(n) ? n : 0;
}

export function visibleDocuments(docs, role) {
  const list = Array.isArray(docs) ? docs : [];
  const shown = canManageDocuments(role) ? list.slice() : list.filter(row => row && row.visibility !== "office");
  shown.sort((a, b) => docTime(b) - docTime(a) || String(a.name || "").localeCompare(String(b.name || "")));
  return shown;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

export function documentErrorText(code) {
  const c = String(code || "");
  if (c === "permission-denied") return "You can't see these documents.";
  if (c === "unavailable" || c === "offline") return OFFLINE_COPY;
  if (!c) return "";
  return "Documents couldn't be loaded.";
}

export function documentsShellHtml({ jobId = "", role, offline = false } = {}) {
  const manage = canManageDocuments(role);
  const add = manage ? `<div class="doc-add">
      <label>Name <span class="muted">(optional, one file)</span><input data-doc-name maxlength="160" autocomplete="off" aria-label="Document name"></label>
      <label>Who can see it<select data-doc-vis aria-label="Who can see this document">
        <option value="crew" selected>Crew can see</option>
        <option value="office">Office only</option>
      </select></label>
      <button type="button" class="sm-btn" data-doc-add>Add documents</button>
      <button type="button" class="sm-btn" data-doc-cam>Take photo</button>
    </div>
    <p class="doc-hint">${esc(PRICE_HINT)}</p>` : "";
  return `<h4>Documents</h4>${add}${offline && manage ? `<p class="doc-wait">${esc(OFFLINE_COPY)}</p>` : ""}<div data-doc-body data-job="${esc(jobId)}"></div>`;
}

export function documentsBodyHtml({ docs = [], role, queued = [], progress = [], error = "", editingId = "", editName = "" } = {}) {
  const manage = canManageDocuments(role);
  const rows = visibleDocuments(docs, role);
  const waiting = (queued || []).filter(row => !(progress || []).some(p => p.id === row.id));
  const bars = (progress || []).map(p => `<div class="doc-progress" data-doc-progress="${esc(p.id)}"><span>${esc(p.name || "Document")}</span><progress value="${Math.max(0, Math.min(100, Number(p.pct) || 0))}" max="100"></progress><span>${Math.round(Number(p.pct) || 0)}%</span></div>`).join("");
  const held = waiting.map(row => `<div class="doc-wait" data-doc-queued="${esc(row.id)}">${esc(row.name || row.fileName || "Document")} · Waiting to upload</div>`).join("");
  const list = rows.map(row => {
    const kind = documentKind(row.contentType, row.fileName || row.name);
    const when = formatDocWhen(row.createdAt);
    const meta = [formatBytes(row.size), row.uploaderName || "", when].filter(Boolean).join(" · ");
    const badge = manage ? `<span class="doc-badge">${row.visibility === "office" ? "Office only" : "Crew can see"}</span>` : "";
    const editing = manage && editingId && editingId === row.id;
    const title = editing
      ? `<input data-doc-edit value="${esc(editName != null ? editName : row.name)}" maxlength="160" aria-label="Document name">`
      : `<button type="button" class="doc-open" data-doc-open="${esc(row.id)}"><span class="doc-name">${esc(row.name || row.fileName || "Document")}</span><span class="doc-meta">${esc(meta)}</span></button>`;
    const actions = manage ? `<span class="doc-actions">${editing
      ? `<button type="button" class="doc-btn" data-doc-save="${esc(row.id)}">Save</button>`
      : `<button type="button" class="doc-btn" data-doc-ren="${esc(row.id)}">Rename</button>`}<button type="button" class="doc-btn" data-doc-del="${esc(row.id)}">Delete</button></span>` : "";
    return `<div class="doc-row" data-doc-id="${esc(row.id)}" data-doc-visibility="${esc(row.visibility || "crew")}">
      <button type="button" class="doc-ico" data-doc-open="${esc(row.id)}" aria-label="${esc(kind.label)}">${esc(kind.icon)}</button>
      <span class="doc-copy">${title}</span>
      ${badge}${actions}
    </div>`;
  }).join("");
  const empty = !rows.length && !waiting.length && !bars ? `<p class="muted sub">${manage ? "No documents yet." : "No documents for the crew on this job."}</p>` : "";
  const err = error ? `<p class="err">${esc(documentErrorText(error))}</p>` : "";
  return `${err}${bars}${held}${list ? `<div class="doc-list">${list}</div>` : empty}`;
}

export function documentsSectionHtml(opts = {}) {
  const shell = documentsShellHtml(opts);
  const body = documentsBodyHtml(opts);
  return `<section class="job-docs" data-job-docs="${esc(opts.jobId || "")}">${shell.replace(`<div data-doc-body data-job="${esc(opts.jobId || "")}"></div>`, `<div data-doc-body data-job="${esc(opts.jobId || "")}">${body}</div>`)}</section>`;
}

export function memoryQueue() {
  const rows = new Map();
  return {
    async put(row) { rows.set(row.id, row); return { ok: true }; },
    async remove(id) { rows.delete(id); },
    async list(uid) { return [...rows.values()].filter(row => row.uid === uid); },
  };
}

let memoryFallback = null;
let queueSingleton = null;

function fallbackQueue() {
  if (!memoryFallback) memoryFallback = memoryQueue();
  return memoryFallback;
}

function idbQueue() {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open("callup-job-documents", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return {
    async put(row) {
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("queue", "readwrite");
        tx.objectStore("queue").put(row);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return { ok: true };
    },
    async remove(id) {
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("queue", "readwrite");
        tx.objectStore("queue").delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    async list(uid) {
      const db = await open();
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction("queue", "readonly");
        const req = tx.objectStore("queue").getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return rows.filter(row => row && row.uid === uid);
    },
  };
}

export function sharedQueue() {
  if (queueSingleton) return queueSingleton;
  if (typeof indexedDB === "undefined") {
    queueSingleton = memoryQueue();
    return queueSingleton;
  }
  const idb = idbQueue();
  queueSingleton = {
    async put(row) {
      try { return await idb.put(row); }
      catch { return fallbackQueue().put(row); }
    },
    async remove(id) {
      try { await idb.remove(id); } catch { /* the memory copy still needs to go */ }
      await fallbackQueue().remove(id);
    },
    async list(uid) {
      try {
        const rows = await idb.list(uid);
        const extra = await fallbackQueue().list(uid);
        const seen = new Set(rows.map(row => row.id));
        return rows.concat(extra.filter(row => !seen.has(row.id)));
      } catch {
        return fallbackQueue().list(uid);
      }
    },
  };
  return queueSingleton;
}

export function queueRow(planned, file, uid) {
  return {
    id: planned.id,
    uid,
    jobId: planned.firestore.jobId,
    name: planned.firestore.name,
    fileName: planned.firestore.fileName,
    path: planned.path,
    contentType: planned.contentType,
    firestore: planned.firestore,
    metadata: planned.metadata,
    file,
    queuedAt: Date.now(),
  };
}

export async function flushDocumentQueue({ queue, uid, online, upload, writeDoc } = {}) {
  if (!queue || !uid) return { uploaded: 0, kept: 0 };
  if (online === false) return { uploaded: 0, kept: (await queue.list(uid)).length };
  const rows = await queue.list(uid);
  let uploaded = 0;
  let kept = 0;
  for (const row of rows) {
    try {
      await upload(row);
      await writeDoc(row);
      await queue.remove(row.id);
      uploaded += 1;
    } catch (error) {
      if (shouldQueueUpload({ online: true, error })) kept += 1;
      else await queue.remove(row.id);
    }
  }
  return { uploaded, kept };
}

export function openDocumentBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const type = String(blob && blob.type || "");
  const viewable = type === "application/pdf" || type.startsWith("image/");
  const finish = () => setTimeout(() => URL.revokeObjectURL(url), 120000);
  if (viewable && typeof window !== "undefined" && window.open) {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) { finish(); return { ok: true, mode: "tab" }; }
  }
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  if (!viewable) a.download = name || "document";
  document.body.appendChild(a);
  a.click();
  a.remove();
  finish();
  return { ok: true, mode: viewable ? "tab" : "download" };
}

function pickFiles({ accept, capture, multiple }) {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    if (capture) input.setAttribute("capture", capture);
    if (multiple) input.multiple = true;
    input.setAttribute("data-doc-picker", "1");
    input.style.cssText = "position:fixed;left:-9999px;opacity:0";
    document.body.appendChild(input);
    let settled = false;
    const finish = files => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish([...(input.files || [])]));
    input.addEventListener("cancel", () => finish([]));
    input.click();
  });
}

let activeMount = null;
let activeUnsub = null;
let flushCtx = null;

export function mountDocuments(root, ctx) {
  unmountDocuments();
  if (!root || !ctx || !ctx.job || !ctx.job.id) return () => {};
  const state = {
    docs: [], error: "", queued: [], progress: [],
    editing: "", editName: "", busy: false,
  };
  const queue = ctx.queue || sharedQueue();
  const manage = canManageDocuments(ctx.role);
  root.innerHTML = documentsShellHtml({ jobId: ctx.job.id, role: ctx.role, offline: ctx.online && ctx.online() === false });
  const body = () => root.querySelector("[data-doc-body]");
  const paint = () => {
    const el = body();
    if (!el) return;
    const editing = el.querySelector("[data-doc-edit]");
    if (editing && document.activeElement === editing) state.editName = editing.value;
    el.innerHTML = documentsBodyHtml({
      docs: state.docs, role: ctx.role, queued: state.queued, progress: state.progress,
      error: state.error, editingId: state.editing, editName: state.editName,
    });
  };
  const reloadQueue = async () => {
    const rows = await queue.list(ctx.uid);
    state.queued = rows.filter(row => row.jobId === ctx.job.id);
    paint();
  };
  const unsub = ctx.listen(crewMustFilter(ctx.role), rows => {
    state.docs = rows || [];
    state.error = "";
    paint();
  }, err => {
    state.docs = [];
    state.error = (err && (err.code || err.message)) || "unavailable";
    paint();
  });
  async function uploadOne(file, visibility, displayName) {
    const planned = planDocumentUpload({
      companyId: ctx.companyId, jobId: ctx.job.id, uid: ctx.uid, uploaderName: ctx.uploaderName,
      file, visibility, displayName,
    });
    if (!planned.ok) {
      ctx.toast(fileReason(planned.reason, file && file.name));
      return;
    }
    const online = !ctx.online || ctx.online() !== false;
    if (!online) {
      const saved = await queue.put(queueRow(planned, file, ctx.uid));
      ctx.toast(saved && saved.ok ? OFFLINE_COPY : OFFLINE_FAIL_COPY);
      await reloadQueue();
      return;
    }
    state.progress.push({ id: planned.id, name: planned.firestore.name, pct: 0 });
    paint();
    try {
      await ctx.upload(planned, file, pct => {
        const row = state.progress.find(p => p.id === planned.id);
        if (row) row.pct = pct;
        const bar = root.querySelector(`[data-doc-progress="${planned.id}"] progress`);
        const label = bar && bar.parentNode.querySelector("span:last-child");
        if (bar) bar.value = pct;
        if (label) label.textContent = `${pct}%`;
      });
      await ctx.writeDoc(planned);
      state.progress = state.progress.filter(p => p.id !== planned.id);
      paint();
    } catch (error) {
      state.progress = state.progress.filter(p => p.id !== planned.id);
      if (shouldQueueUpload({ online: true, error })) {
        const saved = await queue.put(queueRow(planned, file, ctx.uid));
        ctx.toast(saved && saved.ok ? OFFLINE_COPY : OFFLINE_FAIL_COPY);
      } else ctx.toast("Document not uploaded" + (error && error.code ? ` (${error.code})` : "."));
      await reloadQueue();
    }
  }
  async function onFiles(files, kind) {
    if (state.busy || !files || !files.length) return;
    state.busy = true;
    const nameInput = root.querySelector("[data-doc-name]");
    const visInput = root.querySelector("[data-doc-vis]");
    const visibility = visInput ? visInput.value : "crew";
    const displayName = files.length === 1 && nameInput ? nameInput.value : "";
    try {
      for (const file of files) await uploadOne(file, visibility, displayName);
      if (nameInput && files.length === 1) nameInput.value = "";
    } finally { state.busy = false; }
    if (kind) root.dataset.lastPick = kind;
  }
  root.onclick = ev => {
    const add = ev.target.closest("[data-doc-add]");
    const cam = ev.target.closest("[data-doc-cam]");
    if (add || cam) {
      ev.preventDefault();
      const picking = add
        ? pickFiles({ accept: DOC_ACCEPT, multiple: true })
        : pickFiles({ accept: "image/*", capture: "environment" });
      picking.then(files => onFiles(files, add ? "files" : "camera"));
      return;
    }
    const open = ev.target.closest("[data-doc-open]");
    const del = ev.target.closest("[data-doc-del]");
    const ren = ev.target.closest("[data-doc-ren]");
    const save = ev.target.closest("[data-doc-save]");
    if (open && !ev.target.closest("[data-doc-edit], [data-doc-ren], [data-doc-del], [data-doc-save]")) {
      ev.preventDefault();
      const row = state.docs.find(d => d.id === open.dataset.docOpen);
      if (row) ctx.open(row).catch(e => ctx.toast("Document not opened" + (e && e.code ? ` (${e.code})` : ".")));
      return;
    }
    if (ren) {
      ev.preventDefault();
      const row = state.docs.find(d => d.id === ren.dataset.docRen);
      if (!row) return;
      state.editing = row.id;
      state.editName = row.name || "";
      paint();
      root.querySelector("[data-doc-edit]")?.focus();
      return;
    }
    if (save) {
      ev.preventDefault();
      const id = save.dataset.docSave;
      const name = cleanName(root.querySelector("[data-doc-edit]")?.value || state.editName);
      if (!name) { ctx.toast("Give the document a name."); return; }
      ctx.rename(id, name).then(() => { state.editing = ""; state.editName = ""; }).catch(e => ctx.toast("Not renamed" + (e && e.code ? ` (${e.code})` : ".")));
      return;
    }
    if (del) {
      ev.preventDefault();
      const row = state.docs.find(d => d.id === del.dataset.docDel);
      if (!row) return;
      if (typeof confirm === "function" && !confirm("Delete this document? It is removed for everyone.")) return;
      ctx.remove(row).catch(e => ctx.toast("Not deleted" + (e && e.code ? ` (${e.code})` : ".")));
    }
  };
  root.onkeydown = ev => {
    if (ev.key === "Enter" && ev.target.closest("[data-doc-name], [data-doc-edit]")) ev.preventDefault();
  };
  reloadQueue();
  flushCtx = ctx;
  activeMount = { root, ctx, reloadQueue, queue, uid: ctx.uid };
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (unsub) unsub();
    if (activeMount && activeMount.root === root) activeMount = null;
    if (activeUnsub === stop) activeUnsub = null;
  };
  activeUnsub = stop;
  return stop;
}

export function unmountDocuments() {
  const stop = activeUnsub;
  activeUnsub = null;
  activeMount = null;
  if (stop) stop();
}

export function crewMustFilter(role) {
  return !canManageDocuments(role);
}

export async function flushMountedDocuments(deps = {}) {
  const ctx = (activeMount && activeMount.ctx) || flushCtx || {};
  const queue = (activeMount && activeMount.queue) || deps.queue || ctx.queue || sharedQueue();
  const uid = (activeMount && activeMount.uid) || deps.uid || ctx.uid;
  if (!uid) return { uploaded: 0, kept: 0 };
  const online = deps.online != null ? deps.online : (ctx.online ? ctx.online() !== false : true);
  const uploadLive = deps.upload || ctx.upload;
  const writeLive = deps.writeDoc || ctx.writeDoc;
  if (!uploadLive || !writeLive) return { uploaded: 0, kept: 0 };
  const result = await flushDocumentQueue({
    queue, uid, online,
    upload: row => uploadLive({ id: row.id, path: row.path, contentType: row.contentType, metadata: row.metadata, firestore: row.firestore }, row.file, () => {}),
    writeDoc: row => writeLive({ id: row.id, firestore: row.firestore }),
  });
  if (activeMount) await activeMount.reloadQueue();
  return result;
}

function fileReason(reason, name) {
  const label = name ? `${name}: ` : "";
  if (reason === "too-large") return `${label}each file must be 25 MB or smaller.`;
  if (reason === "type-not-allowed") return `${label}use a PDF, photo, Word, Excel, DWG or DXF file.`;
  if (reason === "empty-file") return `${label}that file is empty.`;
  return `${label}that file can't be added.`;
}

if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("online", () => { flushMountedDocuments().catch(() => {}); });
}
