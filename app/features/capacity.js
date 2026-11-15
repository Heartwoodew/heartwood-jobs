// Who is free when (Phase 3). A week grid from job bookings and approved leave.
// Not a rostering product, and not timesheet hours: timesheets stay a separate screen.
// Dates are Australia/Brisbane civil days. Job `date` / `time` / `durationHrs` are Brisbane values
// already stored by the app. No dollar amounts are read or rendered.

import { addDays as addDaysIso, approvedOn, portionLabel, typeLabel } from "./leave.js";

export const CAPACITY_TZ = "Australia/Brisbane";
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SPAN_CAP = 14;

export function brisbaneYmd(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CAPACITY_TZ }).format(date instanceof Date ? date : new Date(date));
}

export function mondayOf(iso) {
  const day = ISO.test(iso || "") ? iso : brisbaneYmd(iso || new Date());
  const dow = (new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7;
  return addDaysIso(day, -dow);
}

export function shiftWeek(todayIso, offset) {
  return addDaysIso(mondayOf(todayIso), 7 * (Number(offset) || 0));
}

export function weekDates(weekStart) {
  const start = mondayOf(weekStart);
  return [...Array(7)].map((_, i) => addDaysIso(start, i));
}

export function recordCompany(row) {
  const id = row && (row.companyId || row.tenantId);
  const text = String(id || "").trim();
  return text || "heartwood";
}

/** Suburb only. A price typed into an address is dropped and never shown. */
export function suburbOf(address) {
  const raw = String(address || "").replace(/(?:A|AU)?\$\s?\d+(?:,\d{3})*(?:\.\d+)?/gi, " ").replace(/\$/g, " ");
  const bits = raw.split(",").map(s => s.trim()).filter(Boolean);
  const tail = bits.length > 1 ? bits[bits.length - 1] : "";
  return tail
    .replace(/\b(QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\b/ig, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/[^A-Za-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMinutes(time) {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(String(time || "").trim());
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  if (m[3]) {
    const ap = m[3].toLowerCase();
    if (h === 12) h = ap === "am" ? 0 : 12;
    else if (ap === "pm") h += 12;
  }
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function books(job) {
  if (!job || !ISO.test(job.date || "")) return false;
  if (job.status === "Cancelled" || job.status === "Unsuccessful" || job.sm8Status === "Unsuccessful") return false;
  return true;
}

/** Calendar days a booking occupies. `endDate` / `dateEnd` is inclusive. A finish after midnight Brisbane adds the next day. */
export function jobDates(job) {
  if (!books(job)) return [];
  const start = job.date;
  let end = start;
  for (const extra of [job.endDate, job.dateEnd]) {
    if (ISO.test(extra || "") && extra >= start && extra > end) end = extra;
  }
  const startMin = parseMinutes(job.time);
  const hours = Number(job.durationHrs);
  if (startMin != null && Number.isFinite(hours) && hours > 0) {
    const extraDays = Math.floor((startMin + hours * 60 - 1) / (24 * 60));
    if (extraDays > 0) {
      const byClock = addDaysIso(start, extraDays);
      if (byClock > end) end = byClock;
    }
  }
  const cap = addDaysIso(start, SPAN_CAP - 1);
  if (end > cap) end = cap;
  const out = [];
  for (let day = start; day <= end; day = addDaysIso(day, 1)) out.push(day);
  return out;
}

function samePerson(person, uid, name) {
  if (!person) return false;
  if (person.uid && uid && person.uid === uid) return true;
  const a = String(person.name || "").trim().toLowerCase();
  const b = String(name || "").trim().toLowerCase();
  return !!a && a === b;
}

function assignedTo(job, person) {
  if (!person) return false;
  if (person.uid && Array.isArray(job.assigned) && job.assigned.includes(person.uid)) return true;
  const names = Array.isArray(job.assignedNames) ? job.assignedNames : [];
  return names.some(name => samePerson(person, "", name));
}

function pushPerson(list, seen, person) {
  const name = String(person && person.name || "").trim();
  const uid = String(person && person.uid || "").trim();
  if (!name && !uid) return;
  const nameKey = name ? "name:" + name.toLowerCase() : "";
  const uidKey = uid ? "uid:" + uid : "";
  const existing = list.find(row => (uid && row.uid === uid) || (nameKey && seen.has(nameKey) && row.name.toLowerCase() === name.toLowerCase()));
  if (existing) {
    if (uid && !existing.uid) existing.uid = uid;
    if (name && existing.name === "Staff") existing.name = name;
    if (uidKey) seen.add(uidKey);
    if (nameKey) seen.add(nameKey);
    return;
  }
  if ((uidKey && seen.has(uidKey)) || (nameKey && seen.has(nameKey))) return;
  if (uidKey) seen.add(uidKey);
  if (nameKey) seen.add(nameKey);
  list.push({ uid, name: name || "Staff" });
}

export function collectPeople({ staff, jobs, leaves, companyId, days }) {
  const company = companyId || "heartwood";
  const list = [];
  const seen = new Set();
  for (const person of staff || []) {
    if (recordCompany(person) !== company) continue;
    pushPerson(list, seen, person);
  }
  const inWeek = new Set(days || []);
  for (const job of jobs || []) {
    if (recordCompany(job) !== company) continue;
    if (!jobDates(job).some(day => inWeek.has(day))) continue;
    const names = Array.isArray(job.assignedNames) ? job.assignedNames : [];
    const ids = Array.isArray(job.assigned) ? job.assigned : [];
    const n = Math.max(ids.length, names.length);
    for (let i = 0; i < n; i++) pushPerson(list, seen, { uid: ids[i] || "", name: names[i] || "" });
  }
  for (const leave of leaves || []) {
    if (leave && leave.companyId && recordCompany(leave) !== company) continue;
    if (!leave || leave.status !== "approved") continue;
    if (![...inWeek].some(day => leave.start <= day && leave.end >= day)) continue;
    pushPerson(list, seen, { uid: leave.uid || "", name: leave.name || "" });
  }
  list.sort((a, b) => a.name.localeCompare(b.name, "en-AU") || a.uid.localeCompare(b.uid));
  return list;
}

function jobsOn(jobs, person, day, company) {
  const hits = [];
  for (const job of jobs || []) {
    if (recordCompany(job) !== company) continue;
    if (!assignedTo(job, person)) continue;
    if (!jobDates(job).includes(day)) continue;
    hits.push(job);
  }
  return hits;
}

function cellFor(person, day, jobs, leaves, company, coverage) {
  const hit = approvedOn(leaves || [], person, day);
  const booked = jobsOn(jobs, person, day, company);
  const suburbs = [];
  for (const job of booked) {
    const suburb = suburbOf(job.address);
    if (suburb && !suburbs.includes(suburb)) suburbs.push(suburb);
  }
  if (hit) {
    return {
      state: "leave",
      label: "On leave",
      detail: [typeLabel(hit.type), portionLabel(hit, day), booked.length ? `also ${booked.length} job${booked.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "),
      jobCount: booked.length,
      suburbs
    };
  }
  if (booked.length) {
    return {
      state: "booked",
      label: "Booked",
      detail: [String(booked.length), suburbs.join(", ")].filter(Boolean).join(" · "),
      jobCount: booked.length,
      suburbs
    };
  }
  const inside = coverage && ISO.test(coverage.from || "") && ISO.test(coverage.to || "") && day >= coverage.from && day <= coverage.to;
  if (!inside) return { state: "unknown", label: "Not loaded", detail: "", jobCount: 0, suburbs: [] };
  return { state: "free", label: "Free", detail: "", jobCount: 0, suburbs: [] };
}

export function buildCapacity({ people, jobs, leaves, weekStart, companyId, coverage }) {
  const company = companyId || "heartwood";
  const days = weekDates(weekStart);
  const rowsPeople = collectPeople({ staff: people, jobs, leaves, companyId: company, days });
  const companyLeaves = (leaves || []).filter(leave => !leave || !leave.companyId || recordCompany(leave) === company);
  const rows = rowsPeople.map(person => ({
    person,
    cells: days.map(day => ({ day, ...cellFor(person, day, jobs, companyLeaves, company, coverage) }))
  }));
  return { weekStart: days[0], days, rows, companyId: company };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function pretty(iso) {
  if (!ISO.test(iso || "")) return iso || "";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function capacityViewHtml({ people, jobs, leaves, weekStart, companyId, coverage, today, staffKnown = true, error = "", offline = false } = {}) {
  const model = buildCapacity({ people, jobs, leaves, weekStart, companyId, coverage });
  const head = model.days.map(day => `<div class="cap-h${day === today ? " cap-today" : ""}">${esc(pretty(day))}</div>`).join("");
  const body = model.rows.map(row => `<div class="cap-name">${esc(row.person.name)}</div>${row.cells.map(cell => `<div class="cap-cell cap-${esc(cell.state)}${cell.day === today ? " cap-today" : ""}" data-cap-state="${esc(cell.state)}" data-cap-day="${esc(cell.day)}" data-cap-person="${esc(row.person.uid || row.person.name)}"><b>${esc(cell.label)}</b>${cell.detail ? `<small>${esc(cell.detail)}</small>` : ""}</div>`).join("")}`).join("");
  const empty = model.rows.length ? "" : `<p class="muted pad">No staff on this company's jobs or leave for this week.</p>`;
  const staffNote = staffKnown ? "" : `<p class="sub">Showing people who are on a job or on approved leave. The full staff list isn't available on this sign-in.</p>`;
  const err = error ? `<p class="warnt">${esc(error === "permission-denied" ? "The company job list isn't available for this sign-in." : error)}</p>` : "";
  return `<div class="sm-head"><h1>Capacity</h1>
      <button type="button" class="sm-btn" data-cap="-1" aria-label="Previous week">‹</button>
      <button type="button" class="sm-btn" data-cap="0">This week</button>
      <button type="button" class="sm-btn" data-cap="1" aria-label="Next week">›</button>
      <span class="drange">${esc(pretty(model.days[0]))} – ${esc(pretty(model.days[6]))}</span></div>
    <p class="sub pad">Who is free, booked, or on approved leave. Built from job bookings and approved leave already on this phone. Hours sheets stay separate.${offline ? " You're offline, so this is the saved copy." : ""}</p>
    ${staffNote}${err}
    ${empty}
    <div class="cap-scroll"><div class="cap-grid">${head ? `<div class="cap-h"></div>${head}` : ""}${body}</div></div>`;
}
