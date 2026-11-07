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

const SWMS_IDS = ["working-near-roads", "mobile-plant", "working-with-silica", "hazardous-substances", "electrical"];

function role() {
  return (typeof window !== "undefined" && window.HW_PREVIEW_ROLE) || "operator";
}
function uidFor(r) {
  return r === "admin" ? "admin-preview" : "patrick";
}
function snap(rows) {
  return { docs: (rows || []).map(r => ({ id: r.id, data: () => { const { id, ...rest } = r; return rest; } })) };
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
  queueMicrotask(() => cb({ uid: uidFor(r), email: r + "@heartwood.test" }));
  return () => {};
}

export function initializeFirestore() { return {}; }
export function connectFirestoreEmulator() {}
export function persistentLocalCache() { return {}; }
export function persistentMultipleTabManager() { return {}; }
export function collection(_db, name) { return { _col: name }; }
export function doc(a, b, c) {
  if (a && typeof a === "object" && a._col && b == null) return { _col: a._col, _id: "auto" };
  return { _col: b, _id: c };
}
export function query(ref) { return { _col: ref && ref._col, _q: true }; }
export function where() { return {}; }
export function orderBy() { return {}; }
export function serverTimestamp() { return { _server: true }; }
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
  record("onSnapshot", { col, id });
  queueMicrotask(() => {
    try {
      if (col === "jobs" && id && id !== "auto") {
        const row = JOBS.find(j => j.id === id);
        onNext({
          id,
          exists: () => !!row,
          data: () => { if (!row) return undefined; const { id: _id, ...rest } = row; return rest; }
        });
      } else if (col === "jobs") onNext(snap(JOBS));
      else if (col === "swmsSignatures") {
        const uid = uidFor(role());
        onNext(snap(SWMS_IDS.map(id => ({
          id: uid + "-" + id, uid, swmsId: id, version: "2026-07", signedAtMs: Date.now(), name: "Patrick"
        }))));
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
  record("setDoc", { col: ref && ref._col, id: ref && ref._id });
  return Promise.resolve();
}
export function addDoc(ref, data) {
  record("addDoc", { col: ref && ref._col });
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
  if (!o) return Promise.reject(Object.assign(new Error("object-not-found"), { code: "storage/object-not-found" }));
  const bytes = o.bytes instanceof Uint8Array ? o.bytes : new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  return Promise.resolve(new Blob([bytes], { type: o.contentType || "image/jpeg" }));
}
export function deleteDoc() { return Promise.resolve(); }
export function runTransaction(_db, fn) {
  record("runTransaction", {});
  return Promise.resolve(fn({ get: () => Promise.resolve({ exists: () => false, data: () => ({}) }), update() {}, set() {} }));
}
