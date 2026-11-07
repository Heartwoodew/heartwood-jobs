// Optimise order: quickest drive for one worker on one day.
// Starts at the Heartwood depot. Uses job addresses only — never device GPS.
// Small sets (up to EXACT_JOB_LIMIT stops) try every order. Larger sets use
// nearest-neighbour plus 2-opt. See app/route-config.js and
// cloud/production/ROUTE_ORDER.md.

import { routeConfig } from "../route-config.js";

export const DEPOT_ADDRESS = "208-220 Holdsworth Rd, Chuwar QLD 4306";
export const DEPOT_LABEL = "Depot";
export const EXACT_JOB_LIMIT = 8;
export const RUN_SHEET_KEYS = [
  "workerUid", "workerName", "date", "jobIds", "returnToDepot", "status", "depot",
  "method", "provider", "tweaked", "totalMinutes", "totalKm", "currentMinutes", "currentKm",
  "approvedBy", "approvedByName", "approvedAt",
];

const memGeo = new Map();
let lastNominatimAt = 0;

export function clearGeoMemory() {
  memGeo.clear();
  lastNominatimAt = 0;
}

export function geoCacheKey(address) {
  return String(address || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function shortAddress(address) {
  const raw = String(address || "").trim();
  const bits = raw.split(",").map(s => s.trim()).filter(Boolean);
  return bits[0] || raw || "Job";
}

export function runSheetId(uid, date) {
  const u = String(uid || "");
  const d = String(date || "");
  if (!/^[A-Za-z0-9]{1,128}$/.test(u)) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  return `${u}_${d}`;
}

export function canApprove(me) {
  return !!(me && me.role === "admin");
}

/** Cached address pin on the job. Ignored when the address has changed, and never read from the device. */
export function cachedGeo(job) {
  const g = job && job.geo;
  const key = geoCacheKey(job && job.address);
  if (!key || !g || g.lat == null || g.lng == null) return null;
  if (geoCacheKey(g.query || "") !== key) return null;
  const lat = +g.lat, lng = +g.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, source: g.source || "job" };
}

export function geoPatch(address, hit) {
  return {
    geo: {
      lat: hit.lat,
      lng: hit.lng,
      query: String(address || "").replace(/\s+/g, " ").trim(),
      source: hit.source || "nominatim",
      at: new Date().toISOString(),
    },
  };
}

export function resolveConfig(config) {
  const extra = (typeof globalThis !== "undefined" && globalThis.HW_ROUTE_CONFIG) || {};
  const c = { ...routeConfig, ...extra, ...(config || {}) };
  const key = String(c.orsApiKey || "").trim();
  if (c.provider === "ors" && !key) {
    return {
      ...c,
      provider: "osrm",
      orsApiKey: "",
      degraded: "OpenRouteService key is missing. Using OSRM and Nominatim instead.",
    };
  }
  if (c.provider === "ors") return { ...c, orsApiKey: key, degraded: "" };
  return { ...c, provider: "osrm", orsApiKey: "", degraded: c.degraded || "" };
}

export function jobsForAllocation(jobs, worker, date) {
  const uid = worker && worker.uid;
  const name = String((worker && worker.name) || "").trim().toLowerCase();
  return (jobs || []).filter(j => {
    if (!j || j.date !== date) return false;
    if (j.status === "Cancelled" || j.status === "Done" || j.sm8Status === "Unsuccessful" || j.sm8Status === "Completed") return false;
    const ids = Array.isArray(j.assigned) ? j.assigned : [];
    const names = (Array.isArray(j.assignedNames) ? j.assignedNames : []).map(n => String(n).trim().toLowerCase());
    if (uid && ids.includes(uid)) return true;
    if (name && names.includes(name)) return true;
    return false;
  }).sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")) || String(a.id).localeCompare(String(b.id)));
}

export function orderJobsForRun(list, sheet) {
  const byTime = (a, b) => String(a.time || "").localeCompare(String(b.time || "")) || String(a.id).localeCompare(String(b.id));
  const rows = (list || []).slice();
  if (!sheet || sheet.status !== "approved" || !Array.isArray(sheet.jobIds) || !sheet.jobIds.length) return rows.sort(byTime);
  const rank = new Map(sheet.jobIds.map((id, i) => [id, i]));
  return rows.sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : 100000;
    const rb = rank.has(b.id) ? rank.get(b.id) : 100000;
    if (ra !== rb) return ra - rb;
    return byTime(a, b);
  });
}

function legOf(matrix, a, b) {
  const leg = matrix && matrix[a] && matrix[a][b];
  if (!leg || !Number.isFinite(leg.seconds) || !Number.isFinite(leg.metres)) return null;
  if (leg.seconds < 0 || leg.metres < 0) return null;
  return leg;
}

export function routeSeconds(order, matrix, returnToDepot) {
  let prev = 0;
  let total = 0;
  for (const ji of order) {
    const leg = legOf(matrix, prev, ji + 1);
    if (!leg) return Infinity;
    total += leg.seconds;
    prev = ji + 1;
  }
  if (returnToDepot && order.length) {
    const leg = legOf(matrix, prev, 0);
    if (!leg) return Infinity;
    total += leg.seconds;
  }
  return total;
}

function reverseSlice(order, i, k) {
  const next = order.slice();
  while (i < k) {
    const tmp = next[i];
    next[i] = next[k];
    next[k] = tmp;
    i += 1;
    k -= 1;
  }
  return next;
}

export function nearestNeighbourOrder(n, matrix) {
  const left = new Set([...Array(n).keys()]);
  const order = [];
  let prev = 0;
  while (left.size) {
    let best = null;
    let bestCost = Infinity;
    for (const j of left) {
      const leg = legOf(matrix, prev, j + 1);
      const cost = leg ? leg.seconds : Infinity;
      if (cost < bestCost) { bestCost = cost; best = j; }
    }
    if (best == null) break;
    order.push(best);
    left.delete(best);
    prev = best + 1;
  }
  return order;
}

export function twoOptOrder(order, matrix, returnToDepot) {
  let best = order.slice();
  let bestSeconds = routeSeconds(best, matrix, returnToDepot);
  for (let guard = 0; guard < 40; guard++) {
    let improved = null;
    let improvedSeconds = bestSeconds;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const next = reverseSlice(best, i, k);
        const seconds = routeSeconds(next, matrix, returnToDepot);
        if (seconds < improvedSeconds - 1e-9) {
          improved = next;
          improvedSeconds = seconds;
        }
      }
    }
    if (!improved) break;
    best = improved;
    bestSeconds = improvedSeconds;
  }
  return best;
}

/** order is indexes into the job list (matrix row = index + 1; row 0 is the depot). */
export function optimiseOrder(matrix, n, options = {}) {
  const limit = options.exactLimit == null ? EXACT_JOB_LIMIT : options.exactLimit;
  const returnToDepot = !!options.returnToDepot;
  if (n <= 0) return { order: [], method: "exact", seconds: 0 };
  if (n <= limit) {
    let best = null;
    let bestSeconds = Infinity;
    const cur = [...Array(n).keys()];
    const visit = k => {
      if (k === n) {
        const seconds = routeSeconds(cur, matrix, returnToDepot);
        if (seconds < bestSeconds - 1e-9) {
          bestSeconds = seconds;
          best = cur.slice();
        }
        return;
      }
      for (let i = k; i < n; i++) {
        const tmp = cur[k];
        cur[k] = cur[i];
        cur[i] = tmp;
        visit(k + 1);
        cur[i] = cur[k];
        cur[k] = tmp;
      }
    };
    visit(0);
    return { order: best || [...cur], method: "exact", seconds: bestSeconds };
  }
  const seed = nearestNeighbourOrder(n, matrix);
  const order = twoOptOrder(seed, matrix, returnToDepot);
  return { order, method: "nearest-neighbour-2opt", seconds: routeSeconds(order, matrix, returnToDepot) };
}

export function formatMinutes(min) {
  if (min == null || !Number.isFinite(min)) return "—";
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function formatKm(km) {
  if (km == null || !Number.isFinite(km)) return "—";
  return `${(Math.round(km * 10) / 10).toFixed(1)} km`;
}

function roundMinutes(seconds) {
  return Math.round(seconds / 60);
}
function roundKm(metres) {
  return Math.round(metres / 100) / 10;
}

export function describeRoute(jobs, matrix, order, returnToDepot) {
  const nodes = [0, ...order.map(i => i + 1)];
  if (returnToDepot && order.length) nodes.push(0);
  const legs = [];
  let seconds = 0;
  let metres = 0;
  let missing = false;
  const point = idx => idx === 0
    ? { id: "depot", label: DEPOT_LABEL }
    : { id: jobs[idx - 1].id, label: jobs[idx - 1].label || shortAddress(jobs[idx - 1].address) };
  for (let i = 0; i < nodes.length - 1; i++) {
    const from = point(nodes[i]);
    const to = point(nodes[i + 1]);
    const leg = legOf(matrix, nodes[i], nodes[i + 1]);
    if (!leg) {
      missing = true;
      legs.push({ from, to, minutes: null, km: null, missing: true });
    } else {
      seconds += leg.seconds;
      metres += leg.metres;
      legs.push({ from, to, minutes: roundMinutes(leg.seconds), km: roundKm(leg.metres), missing: false });
    }
  }
  return {
    legs,
    missing,
    seconds: missing ? Infinity : seconds,
    metres: missing ? Infinity : metres,
    minutes: missing ? null : roundMinutes(seconds),
    km: missing ? null : roundKm(metres),
  };
}

export function solveOrder(matrix, jobs, currentIds, returnToDepot) {
  const n = jobs.length;
  const index = new Map(jobs.map((j, i) => [j.id, i]));
  const currentIndexes = (currentIds || []).map(id => index.get(id)).filter(i => i != null);
  const best = optimiseOrder(matrix, n, { returnToDepot });
  const orderIds = best.order.map(i => jobs[i].id);
  return {
    method: best.method,
    orderIds,
    suggested: describeRoute(jobs, matrix, best.order, returnToDepot),
    current: describeRoute(jobs, matrix, currentIndexes, returnToDepot),
    currentIds: currentIndexes.map(i => jobs[i].id),
  };
}

export function evaluateOrder(model, jobIds, returnToDepot) {
  if (!model || !model.matrix || !model.jobs) return null;
  const index = new Map(model.jobs.map((j, i) => [j.id, i]));
  const order = (jobIds || []).map(id => index.get(id));
  if (order.length !== model.jobs.length || order.some(i => i == null)) return null;
  const currentIndexes = (model.currentIds || []).map(id => index.get(id)).filter(i => i != null);
  return {
    orderIds: jobIds.slice(),
    suggested: describeRoute(model.jobs, model.matrix, order, returnToDepot),
    current: describeRoute(model.jobs, model.matrix, currentIndexes, returnToDepot),
  };
}

export function compareRoutes(suggested, current) {
  if (!suggested || !current || suggested.minutes == null || current.minutes == null) {
    return { savedMinutes: null, savedKm: null, text: "Drive time is unavailable for one of the orders." };
  }
  const savedMinutes = current.minutes - suggested.minutes;
  const savedKm = Math.round((current.km - suggested.km) * 10) / 10;
  let text;
  if (savedMinutes > 0 || savedKm > 0.05) {
    text = `About ${formatMinutes(Math.max(savedMinutes, 0))} and ${formatKm(Math.max(savedKm, 0))} shorter than the current order.`;
  } else if (savedMinutes < 0 || savedKm < -0.05) {
    text = `About ${formatMinutes(Math.abs(savedMinutes))} and ${formatKm(Math.abs(savedKm))} longer than the current order.`;
  } else {
    text = "Same drive as the current order.";
  }
  return { savedMinutes, savedKm, text };
}

function present(j) {
  return {
    id: String(j.id),
    address: j.address || "",
    time: j.time || "",
    client: j.client || "",
    jobNo: j.sm8JobNo ? String(j.sm8JobNo) : "",
    geo: j.geo || null,
    label: shortAddress(j.address),
  };
}

function readLocal(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch { return null; }
}
function writeLocal(key, value) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* private mode */ }
}

async function geocodeAddress(address, cfg, fetchImpl, sleep) {
  const query = String(address || "").replace(/\s+/g, " ").trim();
  if (!query) return null;
  if (cfg.provider === "ors" && cfg.orsApiKey) {
    try {
      const hit = await geocodeOrs(query, cfg, fetchImpl);
      if (hit) return hit;
    } catch { /* fall through to Nominatim */ }
  }
  const wait = Math.max(0, 1100 - (Date.now() - lastNominatimAt));
  if (wait) await sleep(wait);
  lastNominatimAt = Date.now();
  const url = `${cfg.nominatimUrl}?format=jsonv2&limit=1&countrycodes=au&q=${encodeURIComponent(query + ", Queensland, Australia")}`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const arr = await res.json();
  if (!arr || !arr[0] || arr[0].lat == null) return null;
  const lat = +arr[0].lat, lng = +arr[0].lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, source: "nominatim" };
}

async function geocodeOrs(query, cfg, fetchImpl) {
  const url = `${cfg.orsUrl}/geocode/search?boundary.country=AU&size=1&text=${encodeURIComponent(query + ", Queensland, Australia")}`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json", Authorization: cfg.orsApiKey } });
  if (!res.ok) return null;
  const data = await res.json();
  const coords = data && data.features && data.features[0] && data.features[0].geometry && data.features[0].geometry.coordinates;
  if (!coords) return null;
  const lng = +coords[0], lat = +coords[1];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, source: "ors" };
}

async function locateDepot(cfg, fetchImpl, sleep) {
  const key = geoCacheKey(DEPOT_ADDRESS);
  if (memGeo.has("depot:" + key)) return memGeo.get("depot:" + key);
  const stored = readLocal("hwDepotGeo:v1");
  if (stored && geoCacheKey(stored.query) === key && stored.lat != null && stored.lng != null) {
    const hit = { lat: +stored.lat, lng: +stored.lng, source: stored.source || "nominatim" };
    memGeo.set("depot:" + key, hit);
    return hit;
  }
  const hit = await geocodeAddress(DEPOT_ADDRESS, cfg, fetchImpl, sleep);
  if (!hit) return null;
  memGeo.set("depot:" + key, hit);
  writeLocal("hwDepotGeo:v1", { query: DEPOT_ADDRESS, ...hit });
  return hit;
}

function cellsFromTables(durations, distances) {
  if (!Array.isArray(durations) || !durations.length) throw new Error("Road router returned no table.");
  const n = durations.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) { matrix[i][j] = { seconds: 0, metres: 0 }; continue; }
      const seconds = durations[i] && durations[i][j];
      const metres = distances && distances[i] && distances[i][j];
      if (seconds == null || metres == null) continue;
      if (!Number.isFinite(+seconds) || !Number.isFinite(+metres)) continue;
      matrix[i][j] = { seconds: +seconds, metres: +metres };
    }
  }
  return matrix;
}

async function osrmMatrix(points, cfg, fetchImpl) {
  const coords = points.map(p => `${p.lng},${p.lat}`).join(";");
  const tableUrl = `${cfg.osrmUrl}/table/v1/driving/${coords}?annotations=duration,distance`;
  const res = await fetchImpl(tableUrl);
  if (res.ok) {
    const data = await res.json();
    if (data && data.code === "Ok" && data.durations && data.distances) return cellsFromTables(data.durations, data.distances);
  }
  if (points.length > EXACT_JOB_LIMIT + 1) {
    throw new Error("Road router did not return a full drive table (OSRM).");
  }
  const n = points.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++) matrix[i][i] = { seconds: 0, metres: 0 };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const url = `${cfg.osrmUrl}/route/v1/driving/${points[i].lng},${points[i].lat};${points[j].lng},${points[j].lat}?overview=false`;
      const legRes = await fetchImpl(url);
      if (!legRes.ok) continue;
      const data = await legRes.json();
      const route = data && data.routes && data.routes[0];
      if (!route || route.duration == null || route.distance == null) continue;
      matrix[i][j] = { seconds: +route.duration, metres: +route.distance };
    }
  }
  return matrix;
}

async function orsMatrix(points, cfg, fetchImpl) {
  const res = await fetchImpl(`${cfg.orsUrl}/v2/matrix/driving-car`, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: cfg.orsApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: points.map(p => [p.lng, p.lat]),
      metrics: ["duration", "distance"],
      units: "m",
    }),
  });
  if (!res.ok) throw new Error("OpenRouteService refused the drive table.");
  const data = await res.json();
  return cellsFromTables(data.durations, data.distances);
}

export async function driveMatrix(points, config, fetchImpl) {
  const cfg = resolveConfig(config);
  if (cfg.provider === "ors") {
    try {
      const matrix = await orsMatrix(points, cfg, fetchImpl);
      return { matrix, provider: "ors", degraded: "" };
    } catch {
      const matrix = await osrmMatrix(points, { ...cfg, provider: "osrm" }, fetchImpl);
      return { matrix, provider: "osrm-fallback", degraded: "OpenRouteService did not answer. Using OSRM." };
    }
  }
  const matrix = await osrmMatrix(points, cfg, fetchImpl);
  return { matrix, provider: "osrm", degraded: cfg.degraded || "" };
}

export async function planRoute(jobs, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch.bind(globalThis);
  const sleep = options.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const cfg = resolveConfig(options.config);
  const returnToDepot = !!options.returnToDepot;
  const shaped = (jobs || []).map(present);
  const located = [];
  const skipped = [];
  for (const job of shaped) {
    if (!geoCacheKey(job.address)) {
      skipped.push({ id: job.id, label: job.label, reason: "No site address." });
      continue;
    }
    const cached = cachedGeo(job);
    let hit = cached;
    if (!hit && memGeo.has(geoCacheKey(job.address))) hit = memGeo.get(geoCacheKey(job.address));
    if (!hit) {
      hit = await geocodeAddress(job.address, cfg, fetchImpl, sleep);
      if (hit) memGeo.set(geoCacheKey(job.address), hit);
    }
    if (!hit) {
      skipped.push({ id: job.id, label: job.label || job.address, reason: "Could not geocode this address." });
      continue;
    }
    if (!cached && options.onGeocode) {
      try { await options.onGeocode(job, hit); } catch { /* suggestion still runs */ }
    }
    located.push({ ...job, lat: hit.lat, lng: hit.lng, source: hit.source });
  }
  if (!located.length) {
    return { ok: false, error: "No site addresses could be placed for this worker.", skipped, degraded: cfg.degraded };
  }
  const depot = await locateDepot(cfg, fetchImpl, sleep);
  if (!depot) return { ok: false, error: "Could not geocode the depot (208-220 Holdsworth Rd, Chuwar QLD 4306).", skipped, degraded: cfg.degraded };
  let routed;
  try {
    routed = await driveMatrix([depot, ...located], cfg, fetchImpl);
  } catch (e) {
    return { ok: false, error: (e && e.message) || "Road router unavailable (OSRM).", skipped, degraded: cfg.degraded };
  }
  const currentIds = located.map(j => j.id);
  const solved = solveOrder(routed.matrix, located, currentIds, returnToDepot);
  if (!solved.suggested || solved.suggested.missing) {
    return { ok: false, error: "The router had no road for at least one leg. Straight-line distance is not used.", skipped, degraded: routed.degraded || cfg.degraded };
  }
  return {
    ok: true,
    depot: { label: DEPOT_LABEL, address: DEPOT_ADDRESS, ...depot },
    jobs: located,
    skipped,
    matrix: routed.matrix,
    provider: routed.provider,
    degraded: routed.degraded || cfg.degraded || "",
    method: solved.method,
    returnToDepot,
    orderIds: solved.orderIds,
    currentIds: solved.currentIds,
    suggested: solved.suggested,
    current: solved.current,
    tweaked: false,
  };
}

export function buildApproval(input) {
  if (!canApprove(input && input.me)) return { ok: false, reason: "Only an admin can approve a driving order." };
  const worker = input.worker || {};
  const id = runSheetId(worker.uid, input.date);
  const jobIds = input.jobIds || [];
  if (!id) return { ok: false, reason: "Choose a worker and a day." };
  if (!jobIds.length) return { ok: false, reason: "Nothing to approve." };
  if (input.minutes == null || input.km == null) return { ok: false, reason: "Drive time is missing, so this order cannot be approved." };
  const data = {
    workerUid: worker.uid,
    workerName: String(worker.name || "").slice(0, 80),
    date: input.date,
    jobIds: jobIds.slice(),
    returnToDepot: !!input.returnToDepot,
    status: "approved",
    depot: DEPOT_ADDRESS,
    method: input.method === "nearest-neighbour-2opt" ? "nearest-neighbour-2opt" : "exact",
    provider: ["ors", "osrm-fallback"].includes(input.provider) ? input.provider : "osrm",
    tweaked: !!input.tweaked,
    totalMinutes: input.minutes,
    totalKm: input.km,
    currentMinutes: input.currentMinutes,
    currentKm: input.currentKm,
    approvedBy: input.me.uid,
    approvedByName: String(input.me.name || "").slice(0, 80),
  };
  return { ok: true, id, data };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function methodLabel(method, tweaked) {
  if (tweaked) return "Adjusted by hand";
  if (method === "nearest-neighbour-2opt") return "Nearest stop, then tidied";
  return "Every order checked";
}

export function suggestionHtml(model, opts = {}) {
  if (!model) return "";
  const allow = !!opts.canApprove;
  const cmp = compareRoutes(model.suggested, model.current);
  const currentName = model.currentKind === "approved" ? "approved order" : "time order";
  const stops = new Map(model.jobs.map(j => [j.id, j]));
  let html = "";
  if (model.degraded) html += `<p class="route-warn">${esc(model.degraded)}</p>`;
  html += `<p class="route-kicker">${esc(model.tweaked ? "Your order" : "Suggested order")} · ${esc(methodLabel(model.method, model.tweaked))}</p>`;
  html += `<p class="route-depot"><b>${esc(DEPOT_LABEL)}</b><span>${esc(DEPOT_ADDRESS)}</span></p>`;
  html += `<div id="routelist">`;
  const legs = model.suggested.legs || [];
  let legAt = 0;
  model.orderIds.forEach((id, n) => {
    const leg = legs[legAt++] || null;
    if (leg) {
      html += `<p class="route-leg">${leg.missing ? "No road leg" : `${esc(formatMinutes(leg.minutes))} · ${esc(formatKm(leg.km))}`}</p>`;
    }
    const job = stops.get(id) || { label: id };
    const detail = [job.time, job.jobNo ? "#" + job.jobNo : "", job.client].filter(Boolean).join(" · ");
    html += `<div class="route-stop" data-id="${esc(id)}">
      <button type="button" class="route-handle" aria-label="Drag to reorder" title="Drag to reorder">≡</button>
      <div class="route-stop-main"><b>${n + 1} · ${esc(job.label)}</b>${detail ? `<div class="sub">${esc(detail)}</div>` : ""}</div>
      <div class="route-nudges">
        <button type="button" class="route-nudge" data-dir="-1" aria-label="Move earlier">↑</button>
        <button type="button" class="route-nudge" data-dir="1" aria-label="Move later">↓</button>
      </div>
    </div>`;
  });
  const last = legs[legAt] || null;
  if (model.returnToDepot && last) {
    html += `<p class="route-leg">${last.missing ? "No road leg" : `${esc(formatMinutes(last.minutes))} · ${esc(formatKm(last.km))}`}</p>`;
    html += `<p class="route-depot"><b>${esc(DEPOT_LABEL)}</b><span>Return</span></p>`;
  }
  html += `</div>`;
  if (model.skipped && model.skipped.length) {
    html += `<p class="route-skip">Left in time order after the drive: ${model.skipped.map(s => `${esc(s.label)} (${esc(s.reason)})`).join("; ")}</p>`;
  }
  html += `<div class="route-totals" id="routetotals">
    <div><span>This order</span><b>${esc(formatMinutes(model.suggested.minutes))} · ${esc(formatKm(model.suggested.km))}</b></div>
    <div><span>Current ${esc(currentName)}</span><b>${esc(formatMinutes(model.current.minutes))} · ${esc(formatKm(model.current.km))}</b></div>
    <p class="${cmp.savedMinutes > 0 ? "route-save" : "route-note"}">${esc(cmp.text)}</p>
  </div>`;
  html += `<p class="route-note">Drag a handle, or use the arrows, then approve. Reject leaves the run sheet as it is.</p>`;
  if (allow && !model.saved) {
    html += `<div class="route-actions"><button type="button" class="route-approve" id="routeapprove">Approve order</button><button type="button" class="route-reject" id="routereject">Reject</button></div>`;
  } else if (model.saved) {
    html += `<p class="route-save">Saved. Staff see this order on their run sheet.</p>`;
  }
  return html;
}

function workerChoices(staff, jobs, date) {
  return (staff || []).filter(s => s && s.uid).map(s => ({ ...s, count: jobsForAllocation(jobs, s, date).length }));
}

export function installRouteOrder(api) {
  const state = {
    date: "",
    workerUid: "",
    returnToDepot: false,
    model: null,
    busy: false,
    message: "",
    error: "",
    saved: false,
  };
  let root = null;

  function staff() { return api.getStaff ? api.getStaff() : []; }
  function jobs() { return api.getJobs ? api.getJobs() : []; }
  function me() { return api.getMe ? api.getMe() : null; }

  function selectedWorker() {
    return staff().find(s => s.uid === state.workerUid) || null;
  }

  function paint() {
    if (!root) return;
    const choices = workerChoices(staff(), jobs(), state.date);
    if (!state.workerUid || !choices.some(s => s.uid === state.workerUid)) {
      const withJobs = choices.filter(s => s.count > 0).sort((a, b) => b.count - a.count);
      state.workerUid = (withJobs[0] || choices[0] || {}).uid || "";
    }
    const sheet = api.peekSheet ? api.peekSheet(state.workerUid, state.date) : null;
    const result = state.model ? suggestionHtml({ ...state.model, saved: state.saved }, { canApprove: canApprove(me()) }) : "";
    root.innerHTML = `<div class="route-sheet" id="routesheet" role="dialog" aria-modal="true" aria-labelledby="routetitle">
      <div class="route-top"><button type="button" class="route-x" id="routex" aria-label="Close">✕</button><div><h2 id="routetitle">Optimise order</h2><p class="route-note">Quickest drive from the depot for one worker. Job addresses only. The phone’s location is not used.</p></div></div>
      <div class="route-pick">
        <label>Day<input type="date" id="routeday" value="${esc(state.date)}"></label>
        <label>Worker<select id="routeworker">${choices.map(s => `<option value="${esc(s.uid)}"${s.uid === state.workerUid ? " selected" : ""}>${esc(s.name)} (${s.count})</option>`).join("")}</select></label>
        <label class="ck route-return"><input type="checkbox" id="routereturn"${state.returnToDepot ? " checked" : ""}> Return to the depot at the end</label>
        <button type="button" class="route-go" id="routesuggest"${state.busy ? " disabled" : ""}>${state.busy ? "Working out the drive…" : "Suggest order"}</button>
      </div>
      ${sheet && !state.saved ? `<p class="route-note">An approved order is already saved for this worker. Approving replaces that sequence. Nothing is deleted.</p>` : ""}
      ${state.error ? `<p class="route-error">${esc(state.error)}</p>` : ""}
      ${state.message ? `<p class="route-save">${esc(state.message)}</p>` : ""}
      <div id="routeresult">${result}</div>
    </div>`;
    bind();
  }

  function applyModel(next, tweaked) {
    state.model = next ? { ...next, tweaked: !!tweaked, currentKind: next.currentKind } : null;
    state.saved = false;
    state.message = "";
  }

  async function suggest() {
    const worker = selectedWorker();
    if (!worker) { state.error = "Choose a worker."; paint(); return; }
    const allocated = jobsForAllocation(jobs(), worker, state.date);
    if (!allocated.length) { state.error = "No jobs for this worker on this day."; state.model = null; paint(); return; }
    const sheet = api.peekSheet ? api.peekSheet(worker.uid, state.date) : null;
    const ordered = orderJobsForRun(allocated, sheet);
    state.model = null;
    state.busy = true;
    state.error = "";
    state.message = "";
    state.saved = false;
    paint();
    const plan = await planRoute(ordered, {
      returnToDepot: state.returnToDepot,
      onGeocode: api.cacheGeo,
    });
    state.busy = false;
    if (!plan.ok) { state.error = plan.error || "Could not build a driving order."; state.model = null; paint(); return; }
    state.model = { ...plan, currentKind: sheet ? "approved" : "time", tweaked: false };
    paint();
  }

  function retune(returnToDepot) {
    if (!state.model) return;
    const solved = solveOrder(state.model.matrix, state.model.jobs, state.model.currentIds, returnToDepot);
    if (solved.suggested.missing) { state.error = "No road for that option."; paint(); return; }
    state.returnToDepot = returnToDepot;
    state.model = {
      ...state.model,
      returnToDepot,
      tweaked: false,
      method: solved.method,
      orderIds: solved.orderIds,
      suggested: solved.suggested,
      current: solved.current,
    };
    state.error = "";
    paint();
  }

  function reorder(ids) {
    if (!state.model) return;
    if (ids.length === state.model.orderIds.length && ids.every((id, i) => id === state.model.orderIds[i])) return;
    const scored = evaluateOrder(state.model, ids, state.returnToDepot);
    if (!scored || scored.suggested.missing) { state.error = "That order has a leg with no road."; paint(); return; }
    state.model = { ...state.model, ...scored, tweaked: true };
    state.error = "";
    state.saved = false;
    paint();
  }

  async function approve() {
    if (!canApprove(me())) { api.toast("Only an admin can approve a driving order."); return; }
    if (!state.model) return;
    const worker = selectedWorker();
    const built = buildApproval({
      me: me(),
      worker,
      date: state.date,
      jobIds: state.model.orderIds,
      returnToDepot: state.returnToDepot,
      method: state.model.method,
      provider: state.model.provider,
      tweaked: state.model.tweaked,
      minutes: state.model.suggested.minutes,
      km: state.model.suggested.km,
      currentMinutes: state.model.current.minutes,
      currentKm: state.model.current.km,
    });
    if (!built.ok) { api.toast(built.reason); return; }
    try {
      await api.setDoc(api.doc(api.db, "runSheets", built.id), { ...built.data, approvedAt: api.serverTimestamp() }, { merge: true });
      if (api.rememberSheet) api.rememberSheet(built.id, built.data);
      state.saved = true;
      state.message = `Saved for ${worker.name}. Their run sheet now uses this order.`;
      api.toast(state.message);
      paint();
    } catch (e) {
      const code = e && (e.code || e.message) || "";
      api.toast(String(code).includes("permission-denied")
        ? "Not saved. Run sheet rules are not on this project yet, so nothing was changed."
        : "Not saved: " + code);
    }
  }

  function bindDrag(list) {
    let drag = null;
    list.querySelectorAll(".route-handle").forEach(handle => {
      handle.addEventListener("pointerdown", e => {
        drag = handle.closest(".route-stop");
        if (!drag) return;
        drag.classList.add("dragging");
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      handle.addEventListener("pointermove", e => {
        if (!drag || handle.closest(".route-stop") !== drag) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const over = el && el.closest ? el.closest(".route-stop") : null;
        if (!over || over === drag || over.parentElement !== list) return;
        const mid = over.getBoundingClientRect().top + over.getBoundingClientRect().height / 2;
        list.insertBefore(drag, e.clientY < mid ? over : over.nextSibling);
      });
      const finish = () => {
        if (!drag) return;
        drag.classList.remove("dragging");
        drag = null;
        reorder([...list.querySelectorAll(".route-stop")].map(row => row.dataset.id));
      };
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", () => { if (drag) drag.classList.remove("dragging"); drag = null; });
    });
  }

  function bind() {
    root.querySelector("#routex").onclick = () => close();
    root.querySelector("#routeday").onchange = async e => {
      state.date = e.target.value;
      state.model = null;
      state.error = "";
      state.message = "";
      state.saved = false;
      if (api.loadSheets) await api.loadSheets(state.date);
      paint();
    };
    root.querySelector("#routeworker").onchange = e => {
      state.workerUid = e.target.value;
      state.model = null;
      state.error = "";
      state.message = "";
      state.saved = false;
      paint();
    };
    root.querySelector("#routereturn").onchange = e => {
      if (state.model) retune(e.target.checked);
      else { state.returnToDepot = e.target.checked; }
    };
    root.querySelector("#routesuggest").onclick = () => { suggest().catch(err => { state.busy = false; state.error = err.message || "Could not build a driving order."; paint(); }); };
    const list = root.querySelector("#routelist");
    if (list) {
      bindDrag(list);
      list.querySelectorAll(".route-nudge").forEach(btn => btn.onclick = () => {
        const row = btn.closest(".route-stop");
        const ids = [...list.querySelectorAll(".route-stop")].map(r => r.dataset.id);
        const i = ids.indexOf(row.dataset.id);
        const j = i + (+btn.dataset.dir);
        if (i < 0 || j < 0 || j >= ids.length) return;
        const next = ids.slice();
        const [moved] = next.splice(i, 1);
        next.splice(j, 0, moved);
        reorder(next);
      });
    }
    const ok = root.querySelector("#routeapprove");
    if (ok) ok.onclick = () => approve();
    const no = root.querySelector("#routereject");
    if (no) no.onclick = () => {
      state.model = null;
      state.saved = false;
      state.error = "";
      state.message = "Dismissed. The run sheet was not changed.";
      paint();
    };
  }

  function close() {
    if (root) root.remove();
    root = null;
  }

  async function open(prefill) {
    if (!canApprove(me())) { api.toast("Only an admin can optimise and approve a driving order."); return; }
    close();
    root = document.createElement("div");
    root.className = "route-ov";
    document.body.appendChild(root);
    state.date = (prefill && prefill.date) || api.todayStr();
    state.workerUid = (prefill && prefill.workerUid) || "";
    state.returnToDepot = false;
    state.model = null;
    state.busy = false;
    state.error = "";
    state.message = "";
    state.saved = false;
    if (api.loadSheets) await api.loadSheets(state.date);
    paint();
  }

  return { open, close };
}
