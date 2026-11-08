// Clock on / clock off for the existing timesheet week.
// One GPS fix per tap, via getCurrentPosition. No continuous or background tracking.
export const TS_LUNCH_MIN = 30;
export const TS_CONSENT = "Location is captured only when you tap Clock on or Clock off (and Break start or Break end, if you use them). Each tap takes one fix. Heartwood does not track your location in the background. If location is denied or unavailable, the time is still recorded and marked no location.";

export function needsLocationConsent({ stored, already }) {
  return !stored && !already;
}

export function newTsId() {
  let s = "e";
  while (s.length < 16) s += Math.random().toString(36).slice(2);
  return s.replace(/[^a-z0-9]/g, "a").slice(0, 16);
}

export function entryList(entries) {
  if (!entries) return [];
  return Array.isArray(entries) ? entries.filter(Boolean) : Object.values(entries).filter(Boolean);
}

export function sortedEntries(entries) {
  return entryList(entries).slice().sort((a, b) =>
    String(a.date || "").localeCompare(String(b.date || ""))
    || String(a.start || "").localeCompare(String(b.start || ""))
    || String(a.id || "").localeCompare(String(b.id || "")));
}

export function openClock(entries) {
  return entryList(entries).find(e => e.source === "clock" && (e.status === "open" || e.status === "break")) || null;
}

// Ask once, after this session's clock on. A rerender keeps the same shift id; a saved choice ends it.
export function machinePromptNeeded(entry, sessionShiftId) {
  return !!(entry && entry.source === "clock" && sessionShiftId && entry.id === sessionShiftId && !entry.machineChoice);
}

export function machineChoicePatch(choice, asset) {
  if (choice === "skip") return { machineChoice: "skip", machineId: "", machineName: "" };
  if (choice === "none") return { machineChoice: "none", machineId: "", machineName: "" };
  const id = asset && typeof asset.id === "string" ? asset.id.trim() : "";
  const name = asset && typeof asset.name === "string" ? asset.name.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !name || name.length > 80) return null;
  return { machineChoice: "asset", machineId: id, machineName: name };
}

export function latestPrestart(records, assetId, day) {
  const rows = (records || []).filter(row => row && row.assetId === assetId && row.day === day);
  rows.sort((a, b) => (asDate(a.signedAt)?.getTime() || 0) - (asDate(b.signedAt)?.getTime() || 0));
  return rows.length ? rows[rows.length - 1] : null;
}

// available false means the prestart collection or screen is not on this build.
export function prestartStatus({ available, records, assetId, day }) {
  if (!assetId) return { kind: "hidden" };
  if (!available) return { kind: "soon" };
  const row = latestPrestart(records, assetId, day);
  if (!row) return { kind: "reminder", assetId };
  return { kind: "done", assetId, when: row.signedAt, by: row.signerName || "" };
}

export function asDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v.toDate === "function") {
    try {
      const d = v.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch { return null; }
  }
  if (typeof v === "object" && typeof v.seconds === "number") return new Date(v.seconds * 1000);
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function brisbaneHM(value, timeZone = "Australia/Brisbane") {
  const d = asDate(value);
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).formatToParts(d);
  let h = parts.find(p => p.type === "hour")?.value || "";
  const m = parts.find(p => p.type === "minute")?.value || "";
  if (h === "24") h = "00";
  return h && m ? `${h}:${m}` : "";
}

export function stampText(value, timeZone = "Australia/Brisbane") {
  const d = asDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hourCycle: "h12", timeZone,
  }).format(d);
}

export function editList(entry) {
  return Object.entries(entry?.edits || {})
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => (asDate(a.at)?.getTime() || 0) - (asDate(b.at)?.getTime() || 0));
}

const hm = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };

export function shiftHours(d) {
  const a = hm(d?.start), b = hm(d?.finish);
  if (a == null || b == null) return 0;
  let mins = b >= a ? b - a : b + 1440 - a;
  const bs = hm(d?.breakStart), be = hm(d?.breakEnd);
  if (bs != null && be != null) mins -= be >= bs ? be - bs : be + 1440 - bs;
  else mins -= TS_LUNCH_MIN;
  return Math.max(0, Math.round(mins / 60 * 100) / 100);
}

export function paidShift(entry) {
  if (!entry || entry.source !== "clock" || editList(entry).length) return entry;
  const start = brisbaneHM(entry.clockOn?.at) || entry.start || "";
  const finish = entry.clockOff ? (brisbaneHM(entry.clockOff.at) || entry.finish || "") : (entry.finish || "");
  const breakStart = entry.breakOn ? (brisbaneHM(entry.breakOn.at) || entry.breakStart || "") : (entry.breakStart || "");
  const breakEnd = entry.breakOff ? (brisbaneHM(entry.breakOff.at) || entry.breakEnd || "") : (entry.breakEnd || "");
  return { ...entry, start, finish, breakStart, breakEnd };
}

export function sheetHours(sheet) {
  const entries = entryList(sheet?.entries).map(paidShift);
  const taken = new Set(entries.map(e => e.date).filter(Boolean));
  let total = entries.reduce((t, e) => t + shiftHours(e), 0);
  for (const [ds, day] of Object.entries(sheet?.days || {})) {
    if (!taken.has(ds)) total += shiftHours(day);
  }
  return Math.round(total * 100) / 100;
}

export function daysForSheet(sheet) {
  const days = {};
  const entries = entryList(sheet?.entries).map(paidShift);
  const taken = new Set(entries.map(e => e.date).filter(Boolean));
  for (const [ds, d] of Object.entries(sheet?.days || {})) {
    if (taken.has(ds)) continue;
    const row = { start: d.start || "", finish: d.finish || "", note: d.note || "" };
    if (d.breakStart) row.breakStart = d.breakStart;
    if (d.breakEnd) row.breakEnd = d.breakEnd;
    if (row.start || row.finish || row.note) days[ds] = row;
  }
  const grouped = {};
  for (const e of entries) {
    if (!e.date) continue;
    (grouped[e.date] ||= []).push(e);
  }
  for (const [ds, list] of Object.entries(grouped)) {
    const starts = list.map(e => e.start).filter(Boolean).sort();
    const finishes = list.map(e => e.finish).filter(Boolean).sort();
    const note = list.map(e => [e.job, e.note].filter(Boolean).join(" — ")).filter(Boolean).join("; ").slice(0, 200);
    const withBreak = list.find(e => e.breakStart && e.breakEnd);
    const row = { start: starts[0] || "", finish: finishes[finishes.length - 1] || "", note };
    if (withBreak) { row.breakStart = withBreak.breakStart; row.breakEnd = withBreak.breakEnd; }
    if (row.start || row.finish || row.note) days[ds] = row;
  }
  return days;
}

export function locationMap(fix) {
  if (!fix || fix.fix !== "gps" || typeof fix.lat !== "number" || typeof fix.lng !== "number"
    || Number.isNaN(fix.lat) || Number.isNaN(fix.lng)) return { fix: "no location" };
  const accuracy = typeof fix.accuracy === "number" && fix.accuracy >= 0 && fix.accuracy <= 100000 ? fix.accuracy : 0;
  return { fix: "gps", lat: fix.lat, lng: fix.lng, accuracy };
}

export function mapsHref(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) return "";
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function coordText(fix) {
  if (!fix || fix.fix !== "gps" || typeof fix.lat !== "number" || typeof fix.lng !== "number") return "";
  return `${Number(fix.lat).toFixed(5)}, ${Number(fix.lng).toFixed(5)}`;
}

export function accuracyText(fix) {
  if (!fix || fix.fix !== "gps" || typeof fix.accuracy !== "number") return "";
  return `±${Math.round(fix.accuracy)} m`;
}

export function captureFix(geo, opts = {}) {
  const g = geo === undefined ? (typeof navigator !== "undefined" ? navigator.geolocation : null) : geo;
  const timeoutMs = opts.timeoutMs ?? 12000;
  const positionTimeout = opts.positionTimeout ?? 10000;
  return new Promise(resolve => {
    if (!g || typeof g.getCurrentPosition !== "function") {
      resolve({ fix: "no location" });
      return;
    }
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish({ fix: "no location" }), timeoutMs);
    try {
      g.getCurrentPosition(pos => {
        clearTimeout(timer);
        const c = pos && pos.coords;
        if (!c || typeof c.latitude !== "number" || typeof c.longitude !== "number") finish({ fix: "no location" });
        else finish({ fix: "gps", lat: c.latitude, lng: c.longitude, accuracy: typeof c.accuracy === "number" ? c.accuracy : null });
      }, () => {
        clearTimeout(timer);
        finish({ fix: "no location" });
      }, { enableHighAccuracy: true, timeout: positionTimeout, maximumAge: 0 });
    } catch {
      clearTimeout(timer);
      finish({ fix: "no location" });
    }
  });
}
