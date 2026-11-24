// Live crew position. One document per person. Heartwood keeps the legacy top-level
// collection. Every other company uses companies/{id}/liveLocations. The last-known
// dot is the same for every company: it is not limited to Heartwood.
// No trail and no route. Clock off keeps the last position when SHOW_AFTER_CLOCK_OFF
// is on (clockedOn false, clockedOffAt set). A lapsed update stays on the map and fades.

export const LIVE_SHARE_TEXT = "Your location is shared with your managers only while you're clocked on.";
export const GPS_REMIND_BODY = "Please turn on location sharing — clock on in CallUp, allow location, and keep CallUp open on site.";
export const GPS_REMIND_SENT = "Reminder sent";
export const GPS_REMIND_NONE = "No device registered — ask them to open CallUp";
export const LIVE_LIMIT_NOTE = "A phone browser can't keep sharing once the phone is locked or CallUp isn't on screen. The time is when that phone last sent a position.";
export const CREW_UNSHARED = "Clocked on, location not shared";
export const MAP_OFFLINE = "The map needs a connection. The list below still shows who is clocked on.";
export const MAP_LIBRARY = "The map couldn't load. Tap Retry. The list below still shows who is clocked on.";
export const MAP_TILES = "The map tiles didn't load. Tap Retry. The list below still shows who is clocked on.";
export const SHARE_MIN_MS = 60000;
export const SHARE_MIN_METRES = 50;
export const SHARE_FIX_WAIT_MS = 20000;
// Last-known dots stay after Clock Off. Flip this off to hide those people and delete the doc again.
export const SHOW_AFTER_CLOCK_OFF = true;
// A clocked-on position older than this fades. It stays on the map. Alex has not picked a final value.
export const STALE_MINUTES = 10;
// Every company uses this zone until a company record stores its own. Heartwood is not a special case.
export const COMPANY_TIME_ZONE = "Australia/Brisbane";

const CREW_ROLES = new Set(["labourer", "operator", "supervisor"]);

/** Manager and admin only. A rules-admin (role admin) sees the map. Supervisor and below do not. */
export function canSeeCrewMap(me) {
  if (!me) return false;
  if (CREW_ROLES.has(me.role)) return false;
  if (me.role === "manager" || me.role === "admin") return true;
  return me.staffRole === "manager";
}

/** Home never shows profit. Managers and admins get the live crew card; everyone else gets neither. */
export function homeCrewSlot(me) {
  return canSeeCrewMap(me) ? "crew" : "none";
}

/** A missing company, or any status other than paused, can share. Paused cannot read or write. */
export function companySharesLocation(company) {
  return !company || company.status !== "paused";
}

export function liveCollectionPath(companyId) {
  return companyId === "heartwood" ? ["liveLocations"] : ["companies", companyId, "liveLocations"];
}

export function haversineMetres(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return Infinity;
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
}

/** Send the first fix, then again after a minute or after more than 50 metres. */
export function shouldSendPosition(prev, next, now, opts = {}) {
  const minMs = opts.minMs ?? SHARE_MIN_MS;
  const minMetres = opts.minMetres ?? SHARE_MIN_METRES;
  if (!next || next.sharing !== "gps" || !Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return false;
  if (!prev || prev.sharing !== "gps" || !Number.isFinite(prev.lat) || !Number.isFinite(prev.lng)) return true;
  const at = typeof prev.at === "number" ? prev.at : 0;
  if (typeof now === "number" && now - at >= minMs) return true;
  return haversineMetres(prev, next) > minMetres;
}

export function liveLocationBody({ uid, name, companyId, weekStart, entryId, fix }) {
  const gps = !!(fix && fix.fix === "gps" && Number.isFinite(fix.lat) && Number.isFinite(fix.lng)
    && fix.lat >= -90 && fix.lat <= 90 && fix.lng >= -180 && fix.lng <= 180);
  const body = {
    uid: String(uid || ""),
    name: String(name || "Staff").trim().slice(0, 80) || "Staff",
    companyId: String(companyId || ""),
    clockedOn: true,
    sharing: gps ? "gps" : "off",
    weekStart: String(weekStart || ""),
    entryId: String(entryId || ""),
  };
  if (gps) {
    body.lat = fix.lat;
    body.lng = fix.lng;
    body.accuracy = typeof fix.accuracy === "number" && fix.accuracy >= 0 && fix.accuracy <= 100000 ? fix.accuracy : 0;
  }
  return body;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// The sentence an admin asked this person to see. Tapping it opens clock on.
export function locationRemindBannerHtml(body) {
  const text = String(body || GPS_REMIND_BODY);
  return `<button type="button" class="swremind sw-due gps-remind" data-gps-open><span class="ic" aria-hidden="true">⌖</span><span>${esc(text)}</span><span class="chev">›</span></button>`;
}

/** Offline is the only case that says the map needs a connection. A library or tile failure says so, and can be retried. */
export function mapFailureStatus({ online = true, reason = "" } = {}) {
  if (online === false) return { kind: "offline", text: MAP_OFFLINE, retry: true };
  if (reason === "tiles") return { kind: "tiles", text: MAP_TILES, retry: true };
  return { kind: "library", text: MAP_LIBRARY, retry: true };
}

/** Names of clocked-on people with no pin. Empty when everyone on the list has a position. */
export function crewMapNotice(model) {
  const people = (model && model.people) || [];
  const quiet = people.filter(p => p.sharing !== "gps");
  if (!quiet.length) return "";
  const names = quiet.map(p => String(p.name || "").trim()).filter(Boolean);
  return (names.length ? names.join(", ") + " — " : "") + CREW_UNSHARED;
}

export function shareIndicator({ clockedOn, sharing } = {}) {
  if (!clockedOn) return { visible: false, text: "", mode: "off" };
  if (sharing === "ask") return { visible: true, text: LIVE_SHARE_TEXT, mode: "ask" };
  if (sharing === "gps") return { visible: true, text: "Location sharing on", mode: "on" };
  return { visible: true, text: "Location off", mode: "denied" };
}

function asTime(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v.toDate === "function") {
    try {
      const d = v.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
    } catch { return null; }
  }
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000;
  return null;
}

export function lastSeenLabel(updatedAt, now = new Date(), timeZone = COMPANY_TIME_ZONE) {
  const t = asTime(updatedAt);
  if (t == null) return "Last seen unknown";
  const nowMs = now instanceof Date ? now.getTime() : now;
  const sec = Math.max(0, Math.round((nowMs - t) / 1000));
  const clock = new Intl.DateTimeFormat("en-AU", {
    hour: "numeric", minute: "2-digit", hourCycle: "h12", timeZone: companyTimeZone(timeZone),
  }).format(new Date(t));
  if (sec < 45) return `Last seen just now (${clock})`;
  if (sec < 90) return `Last seen 1 min ago (${clock})`;
  if (sec < 3600) return `Last seen ${Math.round(sec / 60)} min ago (${clock})`;
  const hr = Math.round(sec / 3600);
  return `Last seen ${hr} hour${hr === 1 ? "" : "s"} ago (${clock})`;
}

/** Brisbane for every company, unless that company record has its own time zone. */
export function companyTimeZone(company) {
  const raw = company && typeof company === "object" ? company.timeZone : company;
  const tz = typeof raw === "string" ? raw.trim() : "";
  if (!tz) return COMPANY_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return COMPANY_TIME_ZONE;
  }
}

/** Local clock in the company zone, e.g. 3:12pm. Empty when the time is missing. */
export function seenClock(updatedAt, timeZone = COMPANY_TIME_ZONE) {
  const t = asTime(updatedAt);
  if (t == null) return "";
  const parts = new Intl.DateTimeFormat("en-AU", {
    hour: "numeric", minute: "2-digit", hourCycle: "h12", timeZone: companyTimeZone(timeZone),
  }).formatToParts(new Date(t));
  const hour = (parts.find(p => p.type === "hour") || {}).value || "";
  const minute = (parts.find(p => p.type === "minute") || {}).value || "";
  const period = ((parts.find(p => p.type === "dayPeriod") || {}).value || "").replace(/\./g, "").replace(/\s/g, "").toLowerCase();
  if (!hour || !minute) return "";
  return `${hour}:${minute}${period}`;
}

/** Older than STALE_MINUTES. A missing time is stale. Exactly the threshold is still fresh. */
export function isPositionStale(updatedAt, now = new Date(), staleMinutes = STALE_MINUTES) {
  const t = asTime(updatedAt);
  if (t == null) return true;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const limit = (Number(staleMinutes) || 0) * 60 * 1000;
  return nowMs - t > limit;
}

/** Clock Off fields. updatedAt, lat and lng stay as last reported. */
export function clockOffLocationUpdate(clockedOffAt) {
  return { clockedOn: false, clockedOffAt };
}

export function crewMarkerLabel({ name, updatedAt, clockedOn, stale, timeZone = COMPANY_TIME_ZONE } = {}) {
  const who = String(name || "Staff").trim() || "Staff";
  const clock = seenClock(updatedAt, timeZone);
  const when = clock ? `last seen ${clock}` : "last seen unknown";
  const notes = [];
  if (clockedOn === false) notes.push("clocked off");
  if (stale) notes.push("stale");
  return `${who}, ${when}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}

export function jobAssignedTo(job, person) {
  if (!job || !person) return false;
  const ids = Array.isArray(job.assigned) ? job.assigned : [];
  if (person.uid && ids.includes(person.uid)) return true;
  const name = String(person.name || "").trim().toLowerCase();
  if (!name) return false;
  const names = Array.isArray(job.assignedNames) ? job.assignedNames : [];
  return names.some(n => String(n || "").trim().toLowerCase() === name);
}

/** A stored pin only. Address text with no coordinates is listed, not placed on the map. */
export function jobPoint(job) {
  const g = job && job.geo;
  if (!g || g.lat == null || g.lng == null) return null;
  const addr = String(job.address || "").replace(/\s+/g, " ").trim().toLowerCase();
  const query = String(g.query || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!addr || query !== addr) return null;
  const lat = +g.lat, lng = +g.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function jobLabel(job) {
  const raw = String(job.address || job.client || "Job").trim();
  const bits = raw.split(",").map(s => s.trim()).filter(Boolean);
  return bits[0] || raw || "Job";
}

function presentJob(job) {
  const point = jobPoint(job);
  return {
    id: String(job.id || ""),
    label: jobLabel(job),
    client: String(job.client || ""),
    address: String(job.address || ""),
    time: String(job.time || ""),
    jobNo: String(job.sm8JobNo || ""),
    lat: point ? point.lat : null,
    lng: point ? point.lng : null,
  };
}

function openToday(job, today) {
  return !!(job && job.date === today && job.status !== "Cancelled" && job.sm8Status !== "Unsuccessful");
}

function hasFix(d) {
  return !!(d && d.sharing === "gps" && Number.isFinite(+d.lat) && Number.isFinite(+d.lng));
}

/** Clocked-on people always stay. Clocked-off people stay only when the setting is on and a fix exists. */
export function showOnCrewMap(d, showAfterClockOff = SHOW_AFTER_CLOCK_OFF) {
  if (!d) return false;
  if (d.clockedOn === true) return true;
  return showAfterClockOff === true && d.clockedOn === false && hasFix(d);
}

export function crewMapModel({
  locations, jobs, today, now = new Date(),
  showAfterClockOff = SHOW_AFTER_CLOCK_OFF,
  staleMinutes = STALE_MINUTES,
  timeZone = COMPANY_TIME_ZONE,
} = {}) {
  const zone = companyTimeZone(timeZone);
  const people = (locations || []).filter(d => showOnCrewMap(d, showAfterClockOff)).map(d => {
    const lat = +d.lat, lng = +d.lng;
    const sharing = hasFix(d) ? "gps" : "off";
    const person = { uid: d.uid || d.id, name: String(d.name || "Staff") };
    const mine = (jobs || []).filter(j => openToday(j, today) && jobAssignedTo(j, person));
    const clockedOn = d.clockedOn === true;
    const stale = sharing === "gps" && isPositionStale(d.updatedAt, now, staleMinutes);
    const dot = !clockedOn ? "off" : stale ? "stale" : "live";
    return {
      uid: person.uid,
      name: person.name,
      sharing,
      clockedOn,
      stale,
      dot,
      lat: sharing === "gps" ? lat : null,
      lng: sharing === "gps" ? lng : null,
      accuracy: sharing === "gps" && Number.isFinite(+d.accuracy) ? Math.round(+d.accuracy) : null,
      lastSeen: lastSeenLabel(d.updatedAt, now, zone),
      markerLabel: crewMarkerLabel({ name: person.name, updatedAt: d.updatedAt, clockedOn, stale, timeZone: zone }),
      jobs: mine.map(presentJob),
    };
  }).sort((a, b) => a.name.localeCompare(b.name) || String(a.uid).localeCompare(String(b.uid)));
  let unpinned = 0;
  const pinned = [];
  for (const job of jobs || []) {
    if (!openToday(job, today)) continue;
    const row = presentJob(job);
    if (row.lat == null || row.lng == null) {
      if (String(job.address || "").replace(/\s+/g, " ").trim()) unpinned += 1;
      continue;
    }
    pinned.push(row);
  }
  pinned.sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  return { people, jobs: pinned, unpinned };
}

/** Short line when today's open jobs have an address the map cannot place. */
export function crewPinNote(model) {
  const n = Number(model && model.unpinned) || 0;
  if (n < 1) return "";
  if (n === 1) return "1 of today's jobs has an address but no pin.";
  return `${n} of today's jobs have an address but no pin.`;
}

export function crewListHtml(model, esc) {
  const e = typeof esc === "function" ? esc : (s => String(s ?? ""));
  const people = (model && model.people) || [];
  if (!people.length) return `<p class="crew-note">Nobody is clocked on.</p>`;
  return `<div class="crew-list">${people.map(p => {
    const where = p.sharing === "gps"
      ? `${e(p.markerLabel || p.lastSeen)}${p.accuracy != null ? ` · ±${p.accuracy} m` : ""}`
      : CREW_UNSHARED;
    const jobs = p.jobs.length
      ? p.jobs.map(j => `<li>${j.time ? `${e(j.time)} · ` : ""}${e(j.label)}${j.jobNo ? ` · #${e(j.jobNo)}` : ""}${j.client ? ` · ${e(j.client)}` : ""}${j.lat == null && j.address ? " · no pin" : ""}</li>`).join("")
      : `<li>No job assigned today</li>`;
    const tone = p.dot === "off" ? " off" : p.dot === "stale" ? " stale" : "";
    return `<article class="crew-card${tone}"><b>${e(p.name)}</b><div class="sub">${where}</div><ul>${jobs}</ul></article>`;
  }).join("")}</div>`;
}
