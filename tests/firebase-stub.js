// Isolated Firebase stand-in for tests/phone-preview.html. No network, no live project.
const calls = [];
function record(op, extra) {
  const row = { op, ...extra };
  calls.push(row);
  if (typeof window !== "undefined") {
    window.__fbCalls = calls;
  }
  return row;
}

const JOBS = [
  { id: "j1", sm8JobNo: "2401", client: "Orbit Homes (Qld) Pty Ltd", type: "backslab",
    address: "Lot 95 · 21 Lumen Street, Redbank Plains QLD 4301",
    date: "2026-11-06", time: "07:00", durationHrs: 4, status: "Scheduled",
    description: "Slab clean, backblade and road base", po: "110210/100/01",
    assigned: ["patrick"], assignedNames: ["Patrick"], log: [] },
  { id: "j2", sm8JobNo: "2402", client: "Orbit Homes (Qld) Pty Ltd", type: "backslab",
    address: "Lot 88 · 14 Brightvale Street, Redbank Plains QLD 4301",
    date: "2026-11-06", time: "08:30", durationHrs: 4, status: "Scheduled",
    description: "Slab clean, backblade and road base", po: "110565/900/01",
    assigned: ["patrick", "admin-preview"], assignedNames: ["Patrick"], log: [],
    photosEmailedAt: "2026-11-06T01:00:00.000Z", photosEmailedCount: 4 },
  { id: "j3", sm8JobNo: "2403", client: "Torsion Built Pty Ltd", type: "spoil",
    address: "Lot 12 · 4 Cedar Court, Redbank Plains QLD 4301",
    date: "2026-11-06", time: "19:00", durationHrs: 2, status: "Scheduled",
    description: "Spoil removal", po: "110200/100/02",
    assigned: ["patrick"], assignedNames: ["Patrick"], log: [] },
  { id: "j4", sm8JobNo: "2404", client: "Silkwood Homes", type: "clean",
    address: "Lot 3 · 9 River Road, Chuwar QLD 4306",
    date: "2026-11-07", time: "07:30", durationHrs: 3, status: "Scheduled",
    description: "Site clean", po: "440011",
    assigned: ["patrick"], assignedNames: ["Patrick"], log: [] },
  { id: "sm8_01a0e504-b690-794e-a99e-374ec5ab19ab_202611060900", sm8JobNo: "674",
    client: "Orbit Homes (Qld) Pty Ltd", type: "backslab",
    address: "Lot 88 · 14 Brightvale Street, Redbank Plains QLD 4301",
    date: "2026-11-06", time: "09:00", durationHrs: 4, status: "Done",
    description: "Slab clean, backblade and road base", po: "110565/900/01",
    assigned: ["patrick", "admin-preview"], assignedNames: ["Patrick"], log: [],
    photosEmailedAt: "2026-11-05T02:47:00.000Z", photosEmailedCount: 4 }
];

const FILLED_RATES = {
  travelPerKm: 2.5, materialPerUnit: 10, tipPerLoad: 40,
  materialUnitLabel: "unit", tipUnitLabel: "load",
  yardAddress: "208-220 Holdsworth Rd, Chuwar QLD 4306",
  yardMapsUrl: "https://maps.example.invalid/depot",
  machineRates: {
    truck: { rate: 120, unit: "hour" },
    skid: { rate: 90, unit: "hour" },
    excavator: { rate: 140, unit: "hour" }
  },
  labourerRate: 55, labourerUnit: "hour"
};

const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
function swmsPreviewRows() {
  const sig = (typeof window !== "undefined" && window.HW_SWMS_SIG) || TINY_PNG;
  const at = iso => Date.parse(iso);
  const row = (uid, name, swmsId, swmsTitle, when, extra = {}) => ({
    id: uid + "-" + swmsId,
    uid, name, swmsId, swmsTitle,
    version: extra.version || "2026-07",
    signedAtMs: at(when),
    sig,
    jobId: extra.jobId || "",
    jobLabel: extra.jobLabel || "",
  });
  // Preview clock is window.HW_NOW (6 Nov 2026). These rows are not production data.
  return [
    row("patrick", "Patrick", "working-near-roads", "Working near roads", "2026-06-01T09:00:00+10:00", {
      jobId: "j2", jobLabel: "#2402 · Lot 88 · 14 Brightvale Street, Redbank Plains QLD 4301",
    }),
    row("patrick", "Patrick", "mobile-plant", "Mobile plant", "2025-11-20T09:00:00+10:00"),
    row("patrick", "Patrick", "working-with-silica", "Working with silica", "2025-10-01T09:00:00+10:00"),
    row("patrick", "Patrick", "hazardous-substances", "Hazardous substances", "2026-08-01T09:00:00+10:00", { version: "2025-07" }),
    row("sam", "Sam", "electrical", "Electrical & underground services", "2026-09-01T09:00:00+10:00"),
    row("sam", "Sam", "mobile-plant", "Mobile plant", "2025-11-10T09:00:00+10:00"),
  ];
}

function role() {
  return (typeof window !== "undefined" && window.HW_PREVIEW_ROLE) || "operator";
}
function uidFor(r) {
  return r === "admin" ? "admin-preview" : "patrick";
}
function snap(rows) {
  return { docs: (rows || []).map(r => ({ id: r.id, data: () => { const { id, ...rest } = r; return rest; } })) };
}
function withGeo(row) {
  const extra = (typeof window !== "undefined" && window.HW_GEO_BY_ID) || {};
  const geo = extra[row.id];
  return geo ? { ...row, geo } : row;
}
function ratesDoc() {
  if (typeof window !== "undefined" && window.HW_PREVIEW_RATES === "blank") {
    return { travelPerKm: null, materialPerUnit: null, tipPerLoad: null, machineRates: {}, labourerRate: null, labourerUnit: "hour" };
  }
  return FILLED_RATES;
}

export function initializeApp() { return { name: "stub" }; }
export function getAuth() { return {}; }
export function connectAuthEmulator() {}
export function signOut() { return Promise.resolve(); }
export function signInWithEmailAndPassword() { return Promise.resolve({ user: { uid: uidFor(role()) } }); }
export function onAuthStateChanged(_auth, cb) {
  const r = role();
  queueMicrotask(() => cb(r === "signedout" ? null : { uid: uidFor(r), email: r + "@heartwood.test" }));
  return () => {};
}

export function initializeFirestore() { return {}; }
export function connectFirestoreEmulator() {}
export function persistentLocalCache() { return {}; }
export function persistentMultipleTabManager() { return {}; }
export function collection(_db, name, ...rest) {
  const parts = [name, ...rest].filter(x => typeof x === "string");
  return { _col: parts[parts.length - 1], _path: parts.join("/") };
}
export function doc(a, ...parts) {
  if (!parts.length) {
    if (a && typeof a === "object") return { _col: a._col, _path: a._path, _id: "auto" };
    return { _col: a, _id: "auto" };
  }
  return { _col: parts.length >= 2 ? parts[parts.length - 2] : parts[0], _id: parts[parts.length - 1], _path: parts.join("/") };
}
export function query(ref, ...extras) {
  const wheres = extras.filter(x => x && x._where).map(x => x._where);
  return { _col: ref && ref._col, _path: ref && ref._path, _id: ref && ref._id, _q: true, _wheres: wheres };
}
export function where(field, op, value) { return { _where: { field, op, value } }; }
export function orderBy() { return {}; }
export function limitToLast() { return {}; }
export function serverTimestamp() { return { _server: true }; }
function chatStamp(value) {
  const d = value instanceof Date ? value : new Date(value || Date.now());
  const ms = Number.isNaN(d.getTime()) ? Date.now() : d.getTime();
  return { seconds: Math.floor(ms / 1000), nanoseconds: 0, toDate: () => new Date(ms), toMillis: () => ms };
}
function chatRows(thread) {
  const table = (typeof window !== "undefined" && window.HW_CHAT) || {};
  return (table[thread] || []).map(row => {
    const createdAt = row.createdAt && row.createdAt.toDate ? row.createdAt : chatStamp(row.createdAt);
    return { ...row, createdAt };
  });
}
export function arrayUnion(...xs) { return { _union: xs }; }

export function getDoc(ref) {
  record("getDoc", { col: ref && ref._col, id: ref && ref._id });
  if (ref && ref._col === "users") {
    const r = role();
    const name = r === "admin" ? "Alex" : r === "supervisor" ? "Sam" : "Patrick";
    const profileRole = r === "admin" ? "operator" : r;
    return Promise.resolve({ exists: () => true, data: () => ({ name, role: profileRole }) });
  }
  if (ref && ref._col === "meta" && ref._id === "quoteRates") {
    return Promise.resolve({ exists: () => true, data: () => ratesDoc() });
  }
  if (ref && ref._col === "runSheets") {
    const sheet = typeof window !== "undefined" ? window.HW_RUNSHEET : null;
    if (sheet && sheet.id === ref._id) {
      const { id, ...rest } = sheet;
      return Promise.resolve({ exists: () => true, data: () => rest });
    }
    return Promise.resolve({ exists: () => false, data: () => undefined });
  }
  return Promise.resolve({ exists: () => false, data: () => undefined });
}

export function getDocs(ref) {
  const col = ref && ref._col;
  record("getDocs", { col });
  if (col === "users") {
    if (role() !== "admin") return Promise.reject(Object.assign(new Error("permission-denied"), { code: "permission-denied" }));
    return Promise.resolve(snap([
      { id: "patrick", name: "Patrick", role: "operator" },
      { id: "sam", name: "Sam", role: "supervisor" }
    ]));
  }
  if (col === "quotes") {
    return Promise.resolve(snap([{
      id: "q1", quoteStatus: "Draft", client: "Orbit Homes (Qld) Pty Ltd",
      address: "Lot 88 · 14 Brightvale Street, Redbank Plains QLD 4301",
      description: "Backslab", type: "backslab", totalEx: 480,
      machines: ["truck", "skid"], presetId: "truck_skid", includeLabourer: false,
      updatedAtIso: "2026-11-06T01:00:00.000Z"
    }]));
  }
  if (col === "jobs") return Promise.resolve(snap([]));
  return Promise.resolve(snap([]));
}

export function onSnapshot(ref, onNext) {
  const col = ref && ref._col;
  const id = ref && ref._id;
  const path = (ref && ref._path) || "";
  record("onSnapshot", { col, id, path });
  queueMicrotask(() => {
    try {
      if (path.includes("/chatSeen/")) {
        onNext({ id, exists: () => false, data: () => undefined });
        return;
      }
      if (path.includes("/chats/") && path.endsWith("/messages")) {
        onNext(snap(chatRows(path.split("/").at(-2))));
        return;
      }
      if (path.includes("/chats/")) {
        const thread = path.split("/").at(-1);
        const rows = chatRows(thread);
        const last = rows[rows.length - 1];
        onNext({
          id: thread,
          exists: () => !!last,
          data: () => (last ? { lastAt: last.createdAt, lastSenderUid: last.senderUid, lastSenderName: last.senderName, preview: last.text || "Photo" } : undefined),
        });
        return;
      }
      if (col === "jobs" && id && id !== "auto") {
        const row = withGeo(JOBS.find(j => j.id === id) || {});
        const found = JOBS.some(j => j.id === id);
        onNext({
          id,
          exists: () => found,
          data: () => { if (!found) return undefined; const { id: _id, ...rest } = row; return rest; }
        });
      } else if (col === "jobs") onNext(snap(JOBS.map(withGeo)));
      else if (col === "fleet") onNext(snap((typeof window !== "undefined" && window.HW_FLEET) || []));
      else if (col === "policies") onNext(snap((typeof window !== "undefined" && window.HW_POLICIES) || []));
      else if (col === "swmsSignatures") {
        let rows = swmsPreviewRows();
        const uidEq = (ref._wheres || []).find(w => w.field === "uid" && w.op === "==");
        if (uidEq) rows = rows.filter(r => r.uid === uidEq.value);
        onNext(snap(rows));
      } else onNext(snap([]));
    } catch (e) {
      if (typeof window !== "undefined") {
        window.__errs = window.__errs || [];
        window.__errs.push("snapshot " + col + ": " + (e && e.stack || e));
      }
    }
  });
  return () => {};
}

export function updateDoc(ref, data) {
  record("updateDoc", { col: ref && ref._col, id: ref && ref._id, status: data && data.status, keys: data ? Object.keys(data) : [] });
  return Promise.resolve();
}
export function setDoc(ref, data) {
  record("setDoc", {
    col: ref && ref._col, id: ref && ref._id,
    keys: data ? Object.keys(data) : [],
    jobIds: data && data.jobIds, status: data && data.status,
    workerUid: data && data.workerUid,
  });
  return Promise.resolve();
}
export function addDoc(ref, data) {
  const brief = data && typeof data.sig === "string" ? { ...data, sig: "png:" + data.sig.length } : data;
  record("addDoc", { col: ref && ref._col, data: brief });
  return Promise.resolve({ id: "new-" + (ref && ref._col || "x") });
}
function storageObjects() {
  return (typeof window !== "undefined" && window.HW_STORAGE_OBJECTS) || [];
}
export function getStorage() { record("getStorage", {}); return { stub: true }; }
export function connectStorageEmulator() { record("connectStorageEmulator", {}); }
export function ref(_storage, path) { return { path, fullPath: path }; }
export function uploadBytes(r, _body, meta) {
  record("uploadBytes", { path: r && (r.fullPath || r.path), contentType: meta && meta.contentType, metadata: meta && meta.customMetadata });
  return Promise.resolve({ ref: r });
}
export function listAll(r) {
  if (typeof window !== "undefined" && window.HW_STORAGE_LIST_ERROR) {
    return Promise.reject(Object.assign(new Error("unauthorized"), { code: "storage/unauthorized" }));
  }
  const prefix = String((r && (r.fullPath || r.path)) || "").replace(/\/$/, "");
  const items = storageObjects().filter(o => {
    const rest = String(o.path || "").startsWith(prefix + "/") ? String(o.path).slice(prefix.length + 1) : "";
    return rest && !rest.includes("/");
  });
  record("listAll", { path: prefix, count: items.length });
  return Promise.resolve({ prefixes: [], items: items.map(o => ({ path: o.path, fullPath: o.path })) });
}
export function getMetadata(r) {
  const path = r && (r.fullPath || r.path);
  if (typeof window !== "undefined" && window.HW_STORAGE_META_ERROR) {
    const code = String(window.HW_STORAGE_META_ERROR);
    record("getMetadata", { path, error: code });
    return Promise.reject(Object.assign(new Error("unauthorized"), { code }));
  }
  const o = storageObjects().find(x => x.path === path);
  record("getMetadata", { path });
  if (!o) return Promise.reject(Object.assign(new Error("object-not-found"), { code: "storage/object-not-found" }));
  return Promise.resolve({
    contentType: o.contentType || "",
    size: o.size,
    customMetadata: o.customMetadata || {},
    timeCreated: o.timeCreated || "2026-11-06T00:00:00.000Z",
  });
}
export function getBlob(r) {
  const path = r && (r.fullPath || r.path);
  const o = storageObjects().find(x => x.path === path);
  record("getBlob", { path });
  if (!o && String(path || "").includes("/chat/")) {
    const c = document.createElement("canvas");
    c.width = 640; c.height = 360;
    const g = c.getContext("2d");
    g.fillStyle = "#e7c59a"; g.fillRect(0, 0, 640, 360);
    g.strokeStyle = "#3b2a1a"; g.lineWidth = 12; g.strokeRect(18, 18, 604, 324);
    g.fillStyle = "#3b2a1a"; g.font = "bold 42px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("Site photo", 320, 180);
    return new Promise(resolve => c.toBlob(blob => resolve(blob), "image/jpeg", 0.86));
  }
  if (!o) return Promise.reject(Object.assign(new Error("object-not-found"), { code: "storage/object-not-found" }));
  const bytes = o.bytes instanceof Uint8Array ? o.bytes : new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  return Promise.resolve(new Blob([bytes], { type: o.contentType || "image/jpeg" }));
}
export function deleteDoc(ref) {
  record("deleteDoc", { col: ref && ref._col, id: ref && ref._id, path: ref && ref._path });
  return Promise.resolve();
}
export function deleteObject(r) {
  record("deleteObject", { path: r && (r.fullPath || r.path) });
  return Promise.resolve();
}
export function runTransaction(_db, fn) {
  record("runTransaction", {});
  return Promise.resolve(fn({ get: () => Promise.resolve({ exists: () => false, data: () => ({}) }), update() {}, set() {} }));
}
