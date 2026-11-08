import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_DEPOT } from "../../app/features/quotes.js";
import { SCHEDULING_APPROVED } from "../../app/features/cloud-retention.js";
import {
  EXACT_JOB_LIMIT, RUN_SHEET_KEYS, DEPOT_ADDRESS,
  buildApproval, canApprove, cachedGeo, clearGeoMemory, compareRoutes, evaluateOrder,
  geoPatch, jobsForAllocation, nearestNeighbourOrder, optimiseOrder, orderJobsForRun,
  planRoute, resolveConfig, routeSeconds, runSheetId, twoOptOrder,
} from "../../app/features/route-order.js";

function box(rows) {
  return rows.map(row => row.map(seconds => ({ seconds, metres: seconds * 10 })));
}

// One-way trap: nearest neighbour locks in a long return. 2-opt reverses the tail.
const TRAP = box([
  [0, 1, 5, 5, 5],
  [1, 0, 1, 3, 3],
  [1, 1, 0, 1, 4],
  [5, 3, 1, 0, 1],
  [10, 3, 1, 1, 0],
]);

function brute(matrix, n, returnToDepot) {
  let best = Infinity;
  const cur = [...Array(n).keys()];
  const visit = k => {
    if (k === n) { best = Math.min(best, routeSeconds(cur, matrix, returnToDepot)); return; }
    for (let i = k; i < n; i++) {
      const tmp = cur[k]; cur[k] = cur[i]; cur[i] = tmp;
      visit(k + 1);
      cur[i] = cur[k]; cur[k] = tmp;
    }
  };
  visit(0);
  return best;
}

function rulesSlice(text) {
  const start = text.indexOf("// BEGIN RUN SHEET RULES");
  const end = text.indexOf("// END RUN SHEET RULES");
  assert.ok(start >= 0 && end > start);
  return text.slice(start, end + "// END RUN SHEET RULES".length);
}

test("exact search matches every permutation and 2-opt repairs nearest neighbour", () => {
  assert.equal(EXACT_JOB_LIMIT, 8);
  const exact = optimiseOrder(TRAP, 4, { returnToDepot: true });
  assert.equal(exact.method, "exact");
  assert.equal(exact.seconds, brute(TRAP, 4, true));
  assert.equal(exact.seconds, 7);
  const nn = nearestNeighbourOrder(4, TRAP);
  assert.equal(routeSeconds(nn, TRAP, true), 14);
  const repaired = optimiseOrder(TRAP, 4, { returnToDepot: true, exactLimit: 0 });
  assert.equal(repaired.method, "nearest-neighbour-2opt");
  assert.equal(repaired.seconds, twoOptOrder(nn, TRAP, true) && routeSeconds(twoOptOrder(nn, TRAP, true), TRAP, true));
  assert.ok(repaired.seconds < routeSeconds(nn, TRAP, true));
  assert.equal(repaired.seconds, exact.seconds);
});

test("more than eight stops use nearest neighbour plus 2-opt", () => {
  const n = 9;
  const pts = [[0, 0], ...[...Array(n)].map((_, i) => [Math.cos((i / n) * Math.PI * 2) * 5 + 0.2 * i, Math.sin((i / n) * Math.PI * 2) * 4])];
  const matrix = pts.map((a, i) => pts.map((b, j) => {
    const metres = Math.hypot(a[0] - b[0], a[1] - b[1]) * 1000;
    return { seconds: metres / 10 + (i === j ? 0 : 1), metres };
  }));
  const opt = optimiseOrder(matrix, n, { returnToDepot: true });
  const nn = nearestNeighbourOrder(n, matrix);
  assert.equal(opt.method, "nearest-neighbour-2opt");
  assert.ok(opt.seconds <= routeSeconds(nn, matrix, true) + 1e-6);
  assert.ok(Number.isFinite(opt.seconds));
});

test("allocation is per worker and the approved sequence leads the run sheet", () => {
  const day = "2026-11-06";
  const jobs = [
    { id: "a", date: day, time: "07:00", status: "Scheduled", assigned: ["p"], assignedNames: ["Pat"] },
    { id: "b", date: day, time: "08:00", status: "Scheduled", assigned: ["p", "s"], assignedNames: ["Pat", "Sam"] },
    { id: "c", date: day, time: "19:00", status: "Scheduled", assigned: ["p"], assignedNames: ["Pat"] },
    { id: "x", date: day, time: "07:30", status: "Cancelled", assigned: ["p"], assignedNames: ["Pat"] },
    { id: "y", date: "2026-11-07", time: "07:00", status: "Scheduled", assigned: ["p"], assignedNames: ["Pat"] },
    { id: "z", date: day, time: "09:00", status: "Scheduled", assigned: ["s"], assignedNames: ["Sam"] },
    { id: "d", date: day, time: "06:00", status: "Done", sm8Status: "Completed", assigned: ["p"], assignedNames: ["Pat"] },
  ];
  const pat = jobsForAllocation(jobs, { uid: "p", name: "Pat" }, day).map(j => j.id);
  const sam = jobsForAllocation(jobs, { uid: "s", name: "Sam" }, day).map(j => j.id);
  assert.deepEqual(pat, ["a", "b", "c"]);
  assert.deepEqual(sam, ["b", "z"]);
  const sheet = { status: "approved", jobIds: ["c", "a"] };
  assert.deepEqual(orderJobsForRun(jobsForAllocation(jobs, { uid: "p", name: "Pat" }, day), sheet).map(j => j.id), ["c", "a", "b"]);
  assert.equal(canApprove({ role: "admin" }), true);
  assert.equal(canApprove({ role: "operator" }), false);
  assert.equal(canApprove({ role: "supervisor" }), false);
  assert.equal(canApprove(null), false);
});

test("plan uses cached job pins, compares with the current order, and does not invent a straight line", async () => {
  clearGeoMemory();
  const durations = [
    [0, 1800, 1900, 300],
    [1800, 0, 240, 1700],
    [1900, 240, 0, 1800],
    [300, 1700, 1800, 0],
  ];
  const distances = durations.map(row => row.map(s => s * 12));
  let jobLookups = 0;
  let tables = 0;
  const jobs = [
    { id: "j1", address: "1 Lumen St", time: "07:00", geo: { lat: -27.64, lng: 152.86, query: "1 Lumen St", source: "nominatim" } },
    { id: "j2", address: "2 Bright St", time: "08:00", geo: { lat: -27.65, lng: 152.87, query: "2 Bright St", source: "nominatim" } },
    { id: "j3", address: "3 Cedar Ct", time: "09:00", geo: { lat: -27.57, lng: 152.79, query: "3 Cedar Ct", source: "nominatim" } },
  ];
  const fetch = async url => {
    const u = String(url);
    if (u.includes("nominatim")) {
      if (!u.toLowerCase().includes("holdsworth")) jobLookups += 1;
      return new Response(JSON.stringify([{ lat: "-27.56", lon: "152.78" }]), { status: 200 });
    }
    if (u.includes("/table/")) {
      tables += 1;
      return new Response(JSON.stringify({ code: "Ok", durations, distances }), { status: 200 });
    }
    throw new Error("unexpected " + u);
  };
  const plan = await planRoute(jobs, { fetch, sleep: async () => {}, returnToDepot: false });
  assert.equal(plan.ok, true);
  assert.equal(jobLookups, 0);
  assert.equal(tables, 1);
  assert.deepEqual(plan.orderIds, ["j3", "j1", "j2"]);
  assert.equal(plan.method, "exact");
  assert.equal(plan.suggested.minutes, 37);
  assert.equal(plan.current.minutes, 64);
  assert.match(compareRoutes(plan.suggested, plan.current).text, /shorter than the current order/);
  const swapped = evaluateOrder(plan, ["j1", "j3", "j2"], false);
  assert.ok(swapped.suggested.minutes > plan.suggested.minutes);
  const failed = await planRoute(jobs, {
    fetch: async () => new Response("no", { status: 503 }),
    sleep: async () => {},
    returnToDepot: false,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.km, undefined);
  assert.match(failed.error, /OSRM|road/i);
  assert.equal(failed.suggested, undefined);
});

test("a missing OpenRouteService key falls back and a present key is used", async () => {
  const missing = resolveConfig({ provider: "ors", orsApiKey: "  " });
  assert.equal(missing.provider, "osrm");
  assert.match(missing.degraded, /OpenRouteService key is missing/);
  clearGeoMemory();
  const urls = [];
  const jobs = [
    { id: "j1", address: "1 Lumen St", geo: { lat: -27.6, lng: 152.8, query: "1 Lumen St", source: "ors" } },
  ];
  const fetch = async (url, opts) => {
    urls.push(String(url));
    if (String(url).includes("nominatim")) return new Response(JSON.stringify([{ lat: "-27.56", lon: "152.78" }]), { status: 200 });
    if (String(url).includes("/v2/matrix/")) {
      assert.equal(opts.headers.Authorization, "test-key");
      return new Response(JSON.stringify({ durations: [[0, 600], [600, 0]], distances: [[0, 5000], [5000, 0]] }), { status: 200 });
    }
    throw new Error("osrm should not be called");
  };
  const plan = await planRoute(jobs, {
    fetch, sleep: async () => {}, returnToDepot: true,
    config: { provider: "ors", orsApiKey: "test-key" },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.provider, "ors");
  assert.equal(urls.some(u => u.includes("project-osrm.org")), false);
  assert.equal(plan.suggested.minutes, 20);
});

test("only an admin can approve, and the saved sheet is an order not a track", () => {
  const no = buildApproval({ me: { role: "operator", uid: "p", name: "Pat" }, worker: { uid: "p", name: "Pat" }, date: "2026-11-06", jobIds: ["a"], minutes: 1, km: 1, currentMinutes: 2, currentKm: 2 });
  assert.equal(no.ok, false);
  const yes = buildApproval({
    me: { role: "admin", uid: "admin", name: "Alex" },
    worker: { uid: "patrick", name: "Patrick" },
    date: "2026-11-06", jobIds: ["j3", "j1"], returnToDepot: true, tweaked: true,
    method: "exact", provider: "osrm", minutes: 37, km: 26.9, currentMinutes: 64, currentKm: 46.1,
  });
  assert.equal(yes.ok, true);
  assert.equal(yes.id, "patrick_2026-11-06");
  assert.equal(runSheetId("patrick", "2026-11-06"), yes.id);
  assert.equal(runSheetId("bad/uid", "2026-11-06"), "");
  const stored = { ...yes.data, approvedAt: "server" };
  assert.deepEqual(Object.keys(stored).sort(), [...RUN_SHEET_KEYS].sort());
  const blob = JSON.stringify(stored);
  assert.equal(blob.includes("lat"), false);
  assert.equal(blob.includes("lng"), false);
  assert.equal(blob.includes("gps"), false);
  assert.equal(stored.workerUid, "patrick");
  assert.equal(stored.approvedBy, "admin");
  const patch = geoPatch("1 Lumen St", { lat: -27.6, lng: 152.8, source: "nominatim" });
  assert.deepEqual(Object.keys(patch), ["geo"]);
  assert.deepEqual(Object.keys(patch.geo).sort(), ["at", "lat", "lng", "query", "source"]);
  assert.equal(cachedGeo({ address: "1 Lumen St", geo: patch.geo }).lat, -27.6);
  assert.equal(cachedGeo({ address: "Somewhere else", geo: patch.geo }), null);
});

test("run sheet rules are a merge-in block and do not touch receipts, finance, or scheduling", () => {
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const frag = readFileSync(new URL("../production/firestore.runsheets.rules", import.meta.url), "utf8");
  assert.equal(rulesSlice(emu), rulesSlice(frag));
  assert.match(emu, /match \/receipts\/\{id\}/);
  assert.match(emu, /match \/xeroQueue\/\{id\}/);
  const slice = rulesSlice(frag);
  assert.match(slice, /match \/runSheets\/\{sheetId\}/);
  assert.match(slice, /allow delete: if false/);
  assert.match(slice, /routeIsAdmin\(\)/);
  assert.match(slice, /request\.auth\.uid == routeSheetWorker\(sheetId\)/);
  assert.doesNotMatch(slice, /match \/receipts\/|match \/xeroQueue\/|match \/jobs\/|SCHEDULING_APPROVED/);
  for (const key of RUN_SHEET_KEYS) assert.match(slice, new RegExp('"' + key + '"'));
  assert.equal(SCHEDULING_APPROVED, false);
  assert.equal(DEPOT_ADDRESS, DEFAULT_DEPOT.yardAddress);
  const feature = readFileSync(new URL("../../app/features/route-order.js", import.meta.url), "utf8");
  const config = readFileSync(new URL("../../app/route-config.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(feature + config, /geolocation|getCurrentPosition|watchPosition/);
  assert.match(feature, /Exact|exact/);
  assert.match(feature, /nearest-neighbour-2opt/);
  assert.match(app, /id="optorder"/);
  assert.match(app, /orderJobsForRun/);
  assert.doesNotMatch(app, /SCHEDULING_APPROVED\s*=\s*true/);
  assert.match(readFileSync(new URL("../../app/features/cloud-retention.js", import.meta.url), "utf8"), /export const SCHEDULING_APPROVED = false/);
});
