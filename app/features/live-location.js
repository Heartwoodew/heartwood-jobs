// Live crew position. One document per person, only while they are clocked on.
// Heartwood keeps the legacy top-level collection. Every other company uses companies/{id}/liveLocations.
// No trail, no route, and no writes once the shift is closed — the app deletes the doc on clock off.

export const LIVE_SHARE_TEXT = "Your location is shared with your managers only while you're clocked on.";
export const LIVE_LIMIT_NOTE = "A phone browser can't keep sharing once the phone is locked or CallUp isn't on screen. The time is when that phone last sent a position.";
export const SHARE_MIN_MS = 60000;
export const SHARE_MIN_METRES = 50;

const CREW_ROLES = new Set(["labourer", "operator", "supervisor"]);

/** Manager and admin only. A rules-admin (role admin) sees the map. Supervisor and below do not. */
export function canSeeCrewMap(me) {
  if (!me) return false;
  if (CREW_ROLES.has(me.role)) return false;
  if (me.role === "manager" || me.role === "admin") return true;
  return me.staffRole === "manager";
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

export function lastSeenLabel(updatedAt, now = new Date()) {
  const t = asTime(updatedAt);
  if (t == null) return "Last seen unknown";
  const nowMs = now instanceof Date ? now.getTime() : now;
  const sec = Math.max(0, Math.round((nowMs - t) / 1000));
  const clock = new Intl.DateTimeFormat("en-AU", {
    hour: "numeric", minute: "2-digit", hourCycle: "h12", timeZone: "Australia/Brisbane",
  }).format(new Date(t));
  if (sec < 45) return `Last seen just now (${clock})`;
  if (sec < 90) return `Last seen 1 min ago (${clock})`;
  if (sec < 3600) return `Last seen ${Math.round(sec / 60)} min ago (${clock})`;
  const hr = Math.round(sec / 3600);
  return `Last seen ${hr} hour${hr === 1 ? "" : "s"} ago (${clock})`;
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

export function crewMapModel({ locations, jobs, today, now = new Date() } = {}) {
  const people = (locations || []).filter(d => d && d.clockedOn !== false).map(d => {
    const lat = +d.lat, lng = +d.lng;
    const sharing = d.sharing === "gps" && Number.isFinite(lat) && Number.isFinite(lng) ? "gps" : "off";
    const person = { uid: d.uid || d.id, name: String(d.name || "Staff") };
    const mine = (jobs || []).filter(j => j && j.date === today && j.status !== "Cancelled" && j.sm8Status !== "Unsuccessful" && jobAssignedTo(j, person));
    return {
      uid: person.uid,
      name: person.name,
      sharing,
      lat: sharing === "gps" ? lat : null,
      lng: sharing === "gps" ? lng : null,
      accuracy: sharing === "gps" && Number.isFinite(+d.accuracy) ? Math.round(+d.accuracy) : null,
      lastSeen: lastSeenLabel(d.updatedAt, now),
      jobs: mine.map(j => {
        const point = jobPoint(j);
        return {
          id: String(j.id || ""),
          label: jobLabel(j),
          client: String(j.client || ""),
          address: String(j.address || ""),
          time: String(j.time || ""),
          jobNo: String(j.sm8JobNo || ""),
          lat: point ? point.lat : null,
          lng: point ? point.lng : null,
        };
      }),
    };
  }).sort((a, b) => a.name.localeCompare(b.name) || String(a.uid).localeCompare(String(b.uid)));
  return { people };
}

export function crewListHtml(model, esc) {
  const e = typeof esc === "function" ? esc : (s => String(s ?? ""));
  const people = (model && model.people) || [];
  if (!people.length) return `<p class="crew-note">Nobody is clocked on.</p>`;
  return `<div class="crew-list">${people.map(p => {
    const where = p.sharing === "gps"
      ? `${e(p.lastSeen)}${p.accuracy != null ? ` · ±${p.accuracy} m` : ""}`
      : "Location off";
    const jobs = p.jobs.length
      ? p.jobs.map(j => `<li>${j.time ? `${e(j.time)} · ` : ""}${e(j.label)}${j.jobNo ? ` · #${e(j.jobNo)}` : ""}${j.client ? ` · ${e(j.client)}` : ""}${j.lat == null && j.address ? " · no pin" : ""}</li>`).join("")
      : `<li>No job assigned today</li>`;
    return `<article class="crew-card"><b>${e(p.name)}</b><div class="sub">${where}</div><ul>${jobs}</ul></article>`;
  }).join("")}</div>`;
}
