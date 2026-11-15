// Dispatch start times. Pure: no Firebase, no timesheet writes.
// A job's hours here are only for spacing the board. They never change a timesheet.
//
// Duration: quote hours on the job, else the median clocked time for that job type,
// else the company default table. Anything under 1 hour is treated as 1 hour.
// Spacing: auto jobs fill the free gaps in a stable order, from the company day start.
// A hand-set or finished job keeps its start and reserves its estimate plus the travel gap.
// A start someone typed (or any saved time other than the old 07:00 default) stays put.

import { orderJobsForRun, runSheetId } from "./route-order.js";
import { entryList, paidShift, shiftHours } from "./timesheet.js";

export const MIN_JOB_HOURS = 1;
export const DEFAULT_DAY_START = "07:00";
export const DEFAULT_TRAVEL_GAP_MIN = 30;
export const DRIVE_KMH = 40;
export const DISPATCH_TZ = "Australia/Brisbane";

export const DISPATCH_CATEGORIES = Object.freeze([
  { id: "spoil", label: "Spoil removal", hours: 2.5 },
  { id: "backslab", label: "Slab clean / backblade", hours: 3 },
  { id: "roof-clean", label: "Roof clean", hours: 2 },
  { id: "scaffold-clean", label: "Scaffold clean", hours: 1.5 },
  { id: "final-clean", label: "Final clean", hours: 2.5 },
  { id: "site-clean", label: "Site clean", hours: 2 },
  { id: "waterproof", label: "Waterproofing", hours: 4 },
  { id: "other", label: "Other", hours: 2 },
]);

const CATEGORY_IDS = new Set(DISPATCH_CATEGORIES.map(c => c.id));
const LOCAL_KEY = "callup.dispatchTimes.v1";

export function defaultDurations() {
  return Object.fromEntries(DISPATCH_CATEGORIES.map(c => [c.id, c.hours]));
}

export function clampJobHours(hours) {
  const n = Number(hours);
  if (!Number.isFinite(n)) return MIN_JOB_HOURS;
  const rounded = Math.round(n * 100) / 100;
  if (rounded < MIN_JOB_HOURS) return MIN_JOB_HOURS;
  if (rounded > 24) return 24;
  return rounded;
}

export function normaliseTime(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || "").trim());
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min) || h > 23 || min > 59) return "";
  return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
}

export function parseMinutes(value) {
  const t = normaliseTime(value);
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function formatMinutes(mins) {
  const rounded = Math.round(Number(mins));
  if (!Number.isFinite(rounded)) return DEFAULT_DAY_START;
  const day = ((rounded % 1440) + 1440) % 1440;
  const h = Math.floor(day / 60);
  const m = day % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/** Nearest 15 minutes, kept inside the same calendar day (00:00–23:45). */
export function roundTo15(mins) {
  if (!Number.isFinite(mins)) return 0;
  const rounded = Math.round(mins / 15) * 15;
  return Math.max(0, Math.min(23 * 60 + 45, rounded));
}

export function brisbaneWallClock(iso, timeZone = DISPATCH_TZ) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone,
  }).formatToParts(d);
  let h = parts.find(p => p.type === "hour")?.value || "";
  const m = parts.find(p => p.type === "minute")?.value || "";
  if (h === "24") h = "00";
  return h && m ? `${h}:${m}` : "";
}

export function clampGap(value, missing = DEFAULT_TRAVEL_GAP_MIN) {
  if (value == null || value === "") return missing;
  const n = Number(value);
  if (!Number.isFinite(n)) return missing;
  return Math.max(0, Math.min(180, Math.round(n)));
}

export function sanitizeDispatchSettings(raw) {
  const durations = defaultDurations();
  const src = raw && raw.durations && typeof raw.durations === "object" ? raw.durations : {};
  for (const cat of DISPATCH_CATEGORIES) {
    if (src[cat.id] == null || src[cat.id] === "") continue;
    const n = Number(src[cat.id]);
    if (Number.isFinite(n)) durations[cat.id] = clampJobHours(n);
  }
  return {
    dayStart: normaliseTime(raw && raw.dayStart) || DEFAULT_DAY_START,
    travelGapMin: clampGap(raw && raw.travelGapMin),
    durations,
  };
}

export function readDispatchLocal(companyId, storage) {
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return null;
    const bag = JSON.parse(store.getItem(LOCAL_KEY) || "null");
    const row = bag && companyId ? bag[companyId] : null;
    return row ? sanitizeDispatchSettings(row) : null;
  } catch {
    return null;
  }
}

export function writeDispatchLocal(companyId, settings, storage) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store || !companyId) return sanitizeDispatchSettings(settings);
  let bag = {};
  try { bag = JSON.parse(store.getItem(LOCAL_KEY) || "null") || {}; } catch { bag = {}; }
  if (!bag || typeof bag !== "object") bag = {};
  bag[companyId] = sanitizeDispatchSettings(settings);
  store.setItem(LOCAL_KEY, JSON.stringify(bag));
  return bag[companyId];
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function dispatchSettingsHtml(settings, { canEdit = false } = {}) {
  const s = sanitizeDispatchSettings(settings);
  const lock = canEdit ? "" : " disabled";
  const rows = DISPATCH_CATEGORIES.map(c => `<label>${esc(c.label)} (hours)
      <input name="dur_${esc(c.id)}" type="number" min="${MIN_JOB_HOURS}" max="24" step="0.5" inputmode="decimal" value="${esc(s.durations[c.id])}"${lock} required>
    </label>`).join("");
  return `<section class="card" id="dispatchsettings"><h3>Dispatch times</h3>
    <p class="sub">Each person's jobs start at the day start, then one after another. The gap is the travel time. A quote's hours are used when the job has them. Otherwise the median clocked time for that kind of job, otherwise the hours below. Minimum 1 hour. This does not change timesheets, and it does not show prices.</p>
    <form id="dispatchform">
      <label>Day starts<input type="time" name="dayStart" value="${esc(s.dayStart)}"${lock} required></label>
      <label>Travel gap (minutes)<span class="sub">Used when the two sites have no map pin. With pins, the gap is the straight-line distance at 40 km/h, rounded to 15 minutes.</span>
        <input name="travelGapMin" type="number" min="0" max="180" step="15" value="${esc(s.travelGapMin)}"${lock} required></label>
      <div class="dispatch-durs">${rows}</div>
      ${canEdit ? `<div class="btns"><button type="submit" class="primary">Save dispatch times</button></div>` : `<p class="sub">An admin or a manager can change these.</p>`}
    </form></section>`;
}

/** Quote hours copied onto the job. Blank or zero means there is no allocation. */
export function quoteHours(job) {
  const q = job && job.quote;
  if (!q || typeof q !== "object") return null;
  const n = Number(q.hoursOnSite);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function categoryOf(job) {
  const type = String((job && job.type) || "").toLowerCase();
  const text = `${type} ${(job && job.description) || ""} ${(job && job.notes) || ""}`.toLowerCase();
  if (/roof\s*clean/.test(text) || (/\broof\b/.test(text) && /\bclean\b/.test(text))) return "roof-clean";
  if (/scaffold/.test(text) && /clean/.test(text)) return "scaffold-clean";
  if (/final\s*clean/.test(text)) return "final-clean";
  if (/back\s?blade|back\s?slab|slab\s*clean|backslab/.test(text) || type === "backslab") return "backslab";
  if (/\bspoil\b/.test(text) || type === "spoil") return "spoil";
  if (/site\s*clean/.test(text) || type === "clean") return "site-clean";
  if (/waterproof/.test(text) || type === "waterproof") return "waterproof";
  if (CATEGORY_IDS.has(type)) return type;
  return "other";
}

export function isTerminal(job) {
  if (!job) return false;
  if (job.status === "Done" || job.status === "Cancelled") return true;
  if (job.sm8Status === "Completed" || job.sm8Status === "Unsuccessful") return true;
  return false;
}

/** A time the office set on purpose. The untouched 07:00 default is not one of these. */
export function isManualStart(job) {
  if (!job || job.timeSource === "auto") return false;
  if (job.timeSource === "manual") return true;
  const t = normaliseTime(job.time);
  if (!t || t === DEFAULT_DAY_START) return false;
  return true;
}

export function keepsStart(job) {
  return isTerminal(job) || isManualStart(job);
}

function entryMatchesJob(entry, job) {
  if (!entry || !job) return false;
  if (entry.jobId && job.id && entry.jobId === job.id) return true;
  if (entry.jobId) return false;
  if (entry.date && job.date && entry.date !== job.date) return false;
  const label = String(entry.job || "").trim().toLowerCase();
  if (!label) return false;
  const street = String(job.address || "").split(",")[0].trim().toLowerCase();
  if (street && label === street) return true;
  const no = String(job.sm8JobNo || "").trim().toLowerCase();
  return !!(no && label === no);
}

/** Clocked hours for one completed job. Timesheet rows are read and not changed. Falls back to start/finish stamps on the job. */
export function clockedHoursForJob(job, entries) {
  const linked = entryList(entries).filter(e => entryMatchesJob(e, job));
  let sum = 0;
  let any = false;
  for (const entry of linked) {
    const h = shiftHours(paidShift(entry));
    if (h > 0) { sum += h; any = true; }
  }
  if (any) return Math.round(sum * 100) / 100;
  const start = Date.parse(job && (job.startedAt && job.startedAt.toDate ? job.startedAt.toDate() : job.startedAt));
  const end = Date.parse(job && (job.completedAt && job.completedAt.toDate ? job.completedAt.toDate() : job.completedAt));
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    const h = (end - start) / 3600000;
    if (h > 0 && h <= 16) return Math.round(h * 100) / 100;
  }
  return null;
}

export function median(nums) {
  const s = (nums || []).filter(n => Number.isFinite(n) && n > 0).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  const value = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(value * 100) / 100;
}

export function historyMedians(jobs, entries) {
  const buckets = new Map();
  for (const job of jobs || []) {
    if (!job || (job.status !== "Done" && job.sm8Status !== "Completed")) continue;
    const hours = clockedHoursForJob(job, entries);
    if (hours == null) continue;
    const key = categoryOf(job);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(hours);
  }
  const out = {};
  for (const [key, list] of buckets) {
    const value = median(list);
    if (value != null) out[key] = value;
  }
  return out;
}

export function estimateDuration(job, { durations, history } = {}) {
  const quoted = quoteHours(job);
  if (quoted != null) return { hours: clampJobHours(quoted), source: "quote" };
  const cat = categoryOf(job);
  const hist = history && Number(history[cat]);
  if (Number.isFinite(hist) && hist > 0) return { hours: clampJobHours(hist), source: "history" };
  const table = { ...defaultDurations(), ...(durations || {}) };
  const fallback = table[cat] != null ? table[cat] : table.other;
  return { hours: clampJobHours(fallback == null ? MIN_JOB_HOURS : fallback), source: "default" };
}

function durationFor(job, settings, history, reuseStored) {
  const quoted = quoteHours(job);
  if (quoted != null) return { hours: clampJobHours(quoted), source: "quote" };
  if (reuseStored && job && Number(job.estHours) > 0 && (job.estSource === "history" || job.estSource === "default" || job.estSource === "quote")) {
    return { hours: clampJobHours(job.estHours), source: job.estSource };
  }
  return estimateDuration(job, { durations: settings.durations, history });
}

export function formatEstimate(hours) {
  const h = clampJobHours(hours);
  const text = Number.isInteger(h) ? String(h) : String(Math.round(h * 10) / 10);
  return `~${text} h, est.`;
}

export function straightKm(a, b) {
  if (!a || !b) return null;
  const lat1 = +a.lat, lng1 = +a.lng, lat2 = +b.lat, lng2 = +b.lng;
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const p = Math.PI / 180;
  const dLat = (lat2 - lat1) * p;
  const dLng = (lng2 - lng1) * p;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function jobCoords(job) {
  const g = job && job.geo;
  if (!g) return null;
  const lat = +g.lat, lng = +g.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (g.query) {
    const q = String(g.query).replace(/\s+/g, " ").trim().toLowerCase();
    const addr = String(job.address || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (q && addr && q !== addr) return null;
  }
  return { lat, lng };
}

export function travelGapMinutes(fromJob, toJob, fallbackMin) {
  const fallback = clampGap(fallbackMin);
  const a = jobCoords(fromJob);
  const b = jobCoords(toJob);
  if (!a || !b) return fallback;
  const km = straightKm(a, b);
  if (km == null) return fallback;
  return roundTo15((km / DRIVE_KMH) * 60);
}

function anchorTime(job, settings) {
  return normaliseTime(job && job.time) || settings.dayStart;
}

function ceil15(mins) {
  if (!Number.isFinite(mins)) return 0;
  return Math.max(0, Math.min(23 * 60 + 45, Math.ceil(mins / 15) * 15));
}

function hitsBlock(start, estMin, gap, block) {
  const end = start + estMin;
  const release = block.end + gap;
  if (start < block.end && end > block.start) return true;
  if (start < block.start && end + gap > block.start) return true;
  if (start >= block.end && start < release) return true;
  return false;
}

function placeAuto(earliest, estMin, job, blocks, gapDefault) {
  let start = roundTo15(earliest);
  if (start < earliest) start = ceil15(earliest);
  const limit = 23 * 60 + 45;
  for (let n = 0; n < 96 && start < limit; n++) {
    let jump = null;
    for (const block of blocks) {
      const gap = travelGapMinutes(block.job, job, gapDefault);
      if (!hitsBlock(start, estMin, gap, block)) continue;
      const rel = ceil15(block.end + gap);
      if (jump == null || rel > jump) jump = rel;
    }
    if (jump == null) return start;
    start = jump > start ? jump : start + 15;
  }
  return Math.min(start, limit);
}

/**
 * Space one person's jobs for one day.
 * Hand-set and finished jobs stay put and reserve their duration plus the travel gap.
 * Auto jobs fill the free gaps in a stable order (run sheet, or the order given).
 * Spacing the result again does not move them.
 */
export function spaceDay(jobs, options = {}) {
  const settings = sanitizeDispatchSettings(options.settings);
  const history = options.history || {};
  const reuse = !!options.reuseStored;
  const list = (jobs || []).filter(Boolean);
  const ordered = options.ordered ? list.slice() : orderJobsForRun(list, options.sheet || null);
  const gapDefault = settings.travelGapMin;
  const details = ordered.map(job => {
    const est = durationFor(job, settings, history, reuse);
    const estMin = Math.round(est.hours * 60);
    const fixed = keepsStart(job);
    const start = fixed ? parseMinutes(anchorTime(job, settings)) : null;
    return { job, est, estMin, fixed, start };
  });
  const blocks = details.filter(row => row.fixed && row.start != null).map(row => ({
    start: row.start,
    end: row.start + row.estMin,
    job: row.job,
    id: row.job.id,
  }));
  const placed = new Map();
  let prev = null;
  const dayStart = parseMinutes(settings.dayStart);
  for (const row of details) {
    if (row.fixed) continue;
    const gap = prev ? travelGapMinutes(prev.job, row.job, gapDefault) : 0;
    const earliest = prev ? prev.start + prev.estMin + gap : dayStart;
    const start = placeAuto(earliest, row.estMin, row.job, blocks, gapDefault);
    placed.set(row.job.id, start);
    prev = { job: row.job, start, estMin: row.estMin };
  }
  return details.map(row => ({
    id: row.job.id,
    time: formatMinutes(row.fixed ? row.start : placed.get(row.job.id)),
    fixed: row.fixed,
    estHours: row.est.hours,
    estSource: row.est.source,
    estLabel: formatEstimate(row.est.hours),
  }));
}

export function primaryKey(job) {
  const ids = Array.isArray(job && job.assigned) ? job.assigned.filter(Boolean) : [];
  if (ids[0]) return String(ids[0]);
  const name = Array.isArray(job && job.assignedNames) ? job.assignedNames.filter(Boolean)[0] : "";
  if (name) return "name:" + name;
  return "_none";
}

export function approvedSheet(sheets, person, date) {
  if (!sheets || !person || person === "_none" || String(person).startsWith("name:")) return null;
  const id = runSheetId(person, date);
  if (!id) return null;
  const sheet = sheets[id];
  if (sheet && sheet.status === "approved" && Array.isArray(sheet.jobIds) && sheet.jobIds.length) return sheet;
  return null;
}

function sameAuto(job, row) {
  return normaliseTime(job.time) === row.time
    && job.timeSource === "auto"
    && Number(job.estHours) === row.estHours
    && job.estSource === row.estSource;
}

/** Auto times to write. Manual and finished jobs are left out. Does not include timesheet fields. */
export function planAutoTimes(jobs, options = {}) {
  const settings = sanitizeDispatchSettings(options.settings);
  const history = options.history || {};
  const dates = options.dates ? new Set(options.dates) : null;
  const groups = new Map();
  for (const job of jobs || []) {
    if (!job || !job.id || !/^\d{4}-\d{2}-\d{2}$/.test(job.date || "")) continue;
    if (dates && !dates.has(job.date)) continue;
    const key = primaryKey(job) + "|" + job.date;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(job);
  }
  const writes = [];
  for (const [key, list] of groups) {
    const bar = key.lastIndexOf("|");
    const person = key.slice(0, bar);
    const date = key.slice(bar + 1);
    const plan = spaceDay(list, {
      settings, history,
      sheet: approvedSheet(options.sheets, person, date),
      reuseStored: !!options.reuseStored,
    });
    for (const row of plan) {
      if (row.fixed) continue;
      const job = list.find(j => j.id === row.id);
      if (!job || sameAuto(job, row)) continue;
      writes.push({
        id: row.id,
        time: row.time,
        timeSource: "auto",
        estHours: row.estHours,
        estSource: row.estSource,
      });
    }
  }
  writes.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return writes;
}

/** Put an auto job at an hour so the next spacing uses that order. A pinned start is not moved here. */
export function withSortHint(jobs, jobId, hour) {
  const hh = String(hour == null ? "" : hour).padStart(2, "0");
  if (!/^\d{2}$/.test(hh)) return (jobs || []).slice();
  return (jobs || []).map(job => {
    if (!job || job.id !== jobId || keepsStart(job)) return job;
    return { ...job, time: `${hh}:00`, timeSource: "auto" };
  });
}
