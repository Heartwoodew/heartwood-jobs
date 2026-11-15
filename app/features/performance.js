// Staff performance ranking. Pure functions: the app passes timesheets, jobs, leave,
// incidents, prestarts and Take 5s that a manager or admin can already read.
// Crew and supervisors never receive this panel. Money stays out of their screens.

import { addDays, portionLabel } from "./leave.js";
import { entryList, paidShift, shiftHours } from "./timesheet.js";

export const FIELD_ROLES = Object.freeze(["labourer", "operator"]);
export const LEADER_ROLES = Object.freeze(["supervisor", "manager", "admin"]);

export const DEFAULT_WEIGHTS = Object.freeze({
  hours: 1,
  money: 1,
  jobs: 1,
  prestart: 1,
  take5: 1,
  incidents: 1,
  sick: 1,
  annual: 0,
});

export const WEIGHT_LABELS = Object.freeze([
  ["hours", "Hours worked"],
  ["money", "Money made"],
  ["jobs", "Jobs completed"],
  ["prestart", "Prestart completion"],
  ["take5", "Take 5 completion"],
  ["incidents", "Incidents (lowers the score)"],
  ["sick", "Sick days (lowers the score)"],
  ["annual", "Annual leave (0 leaves it out of the score)"],
]);

export const MONEY_METHOD = "Money is the completed job's invoice amount, or else the PO value, or else the accepted quote, ex GST. It is split across the people assigned to that job by the hours each person recorded against the job. When nobody recorded hours against the job, it is split evenly. $ per hour is that share divided by hours worked in the period.";

export const SCORE_METHOD = "Each figure is scaled from the lowest to the highest person in this list for the period. More hours, money, completed jobs, prestart completion and Take 5 completion raise the score. More incidents and sick days lower it. Annual leave stays out of the score unless an admin sets a weight above 0, and then more annual leave lowers the score. The score shown is 0 to 100 within this list. Take 5 completion is left out entirely while Take 5s are off.";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function num(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function iso(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parts(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function monthEnd(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(date, n) {
  const p = parts(date);
  if (!p) return "";
  const dt = new Date(Date.UTC(p.y, p.m - 1 + n, 1));
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = Math.min(p.d, monthEnd(y, m));
  return iso(y, m, d);
}

export function weekStartOf(date) {
  const p = parts(date);
  if (!p) return "";
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const monday = new Date(dt);
  monday.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export function periodBounds(kind, today, custom = {}) {
  const day = DATE.test(today || "") ? today : "";
  if (!day) return { kind: "month", start: "", end: "", label: "This month" };
  if (kind === "week") {
    const start = weekStartOf(day);
    return { kind, start, end: addDays(start, 6), label: "This week" };
  }
  if (kind === "3months") {
    return { kind, start: addMonths(day, -3), end: day, label: "Last 3 months" };
  }
  if (kind === "fy") {
    const p = parts(day);
    const startYear = p.m >= 7 ? p.y : p.y - 1;
    return { kind, start: iso(startYear, 7, 1), end: day, label: "Financial year" };
  }
  if (kind === "custom") {
    const start = DATE.test(custom.start || "") ? custom.start : day;
    const end = DATE.test(custom.end || "") ? custom.end : day;
    return start <= end
      ? { kind, start, end, label: "Custom" }
      : { kind, start: end, end: start, label: "Custom" };
  }
  const p = parts(day);
  return { kind: "month", start: iso(p.y, p.m, 1), end: iso(p.y, p.m, monthEnd(p.y, p.m)), label: "This month" };
}

export function sanitizeWeights(input) {
  const out = { ...DEFAULT_WEIGHTS };
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const n = num(input && input[key]);
    if (n == null || n < 0 || n > 10) continue;
    out[key] = Math.round(n * 10) / 10;
  }
  return out;
}

export function canSeeStaffPerformance(me) {
  if (!me) return false;
  const shell = me.role || "";
  const profileRole = me.staffRole || "";
  if (shell === "supervisor" || profileRole === "supervisor") return false;
  if (shell === "labourer" || shell === "operator") return false;
  if (profileRole === "labourer") return false;
  if (shell === "admin") return true;
  return shell === "manager" || profileRole === "manager";
}

export function canEditPerformanceSettings(me) {
  if (!canSeeStaffPerformance(me)) return false;
  if ((me.staffRole || "") === "manager" || me.role === "manager") return false;
  return me.role === "admin" || me.staffRole === "admin";
}

export function isFieldCrew(me) {
  if (!me) return false;
  const role = me.staffRole || me.role || "";
  return role === "labourer" || role === "operator";
}

function inRange(date, start, end) {
  return DATE.test(date || "") && date >= start && date <= end;
}

function eachDate(start, end, fn) {
  if (!DATE.test(start) || !DATE.test(end) || start > end) return;
  let date = start;
  for (let i = 0; i < 400 && date <= end; i++) {
    fn(date);
    date = addDays(date, 1);
  }
}

export function hoursByDate(sheet) {
  const map = {};
  const entries = entryList(sheet && sheet.entries).map(paidShift);
  const taken = new Set();
  for (const entry of entries) {
    if (!entry || !entry.date) continue;
    taken.add(entry.date);
    map[entry.date] = round2((map[entry.date] || 0) + shiftHours(entry));
  }
  for (const [date, day] of Object.entries((sheet && sheet.days) || {})) {
    if (taken.has(date)) continue;
    map[date] = round2((map[date] || 0) + shiftHours(day));
  }
  return map;
}

function personRole(person) {
  return String((person && (person.role || person.staffRole)) || "");
}

export function includeInRanking(person, excludeLeaders) {
  if (!person || !person.uid) return false;
  if (!excludeLeaders) return true;
  return FIELD_ROLES.includes(personRole(person));
}

export function jobValueEx(job) {
  if (!job) return { amount: 0, basis: "" };
  if (num(job.invoiceAmount) > 0) return { amount: num(job.invoiceAmount), basis: "invoice" };
  if (num(job.poAmount) > 0) return { amount: num(job.poAmount), basis: "PO" };
  if (num(job.quoteAmount) > 0) return { amount: num(job.quoteAmount), basis: "quote" };
  return { amount: 0, basis: "" };
}

function jobLabel(job) {
  return String(job.sm8JobNo || job.jobNo || job.id || "");
}

function entryMatchesJob(text, job) {
  const raw = String(text || "").trim().toLowerCase();
  if (!raw || !job) return false;
  const id = String(job.id || "").trim().toLowerCase();
  if (id && raw === id) return true;
  const no = String(job.sm8JobNo || job.jobNo || "").trim().toLowerCase();
  if (!no) return false;
  if (raw === no || raw === `#${no}`) return true;
  if (no.length < 3) return false;
  return new RegExp(`(^|[^a-z0-9])${no.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(raw);
}

function assignedUids(job) {
  return [...new Set((Array.isArray(job && job.assigned) ? job.assigned : []).map(uid => String(uid || "")).filter(Boolean))];
}

function jobDate(job) {
  return DATE.test(job && job.date) ? job.date : "";
}

function neutralFill(values) {
  const known = values.filter(value => value != null);
  const fill = known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : 0;
  return values.map(value => (value == null ? fill : value));
}

function scale(values, higherIsBetter) {
  const nums = values.map(v => Number(v) || 0);
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  if (max === min) {
    if (!higherIsBetter) return nums.map(() => 0);
    return nums.map(() => (max > 0 ? 1 : 0));
  }
  return nums.map(v => (v - min) / (max - min));
}

function leaveDays(leaves, person, start, end, type) {
  let total = 0;
  for (const leave of leaves || []) {
    if (!leave || leave.status !== "approved" || leave.type !== type) continue;
    const uidMatch = person.uid && leave.uid === person.uid;
    const nameMatch = person.name && leave.name && String(leave.name).trim().toLowerCase() === String(person.name).trim().toLowerCase();
    if (!uidMatch && !nameMatch) continue;
    eachDate(start > leave.start ? start : leave.start, end < leave.end ? end : leave.end, date => {
      if (!inRange(date, leave.start, leave.end)) return;
      const portion = portionLabel(leave, date);
      total += portion === "all day" || portion === "" ? 1 : 0.5;
    });
  }
  return round2(total);
}

function incidentHits(incident, person) {
  const ids = Array.isArray(incident && incident.staffInvolved) ? incident.staffInvolved : [];
  if (ids.includes(person.uid)) return true;
  const people = String(incident && incident.people || "").toLowerCase();
  const name = String(person.name || "").trim().toLowerCase();
  return name.length >= 3 && people.includes(name);
}

function incidentDay(incident) {
  const raw = String(incident && (incident.occurredAt || incident.reportedAt) || "");
  return raw.slice(0, 10);
}

function moneyText(n) {
  return "$" + (Number(n) || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function hourText(n) {
  const v = round2(n);
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "")) + " h";
}

function pctText(ratio) {
  if (ratio == null) return "–";
  return `${Math.round(ratio * 100)}%`;
}

function dayText(n, missing) {
  if (missing) return "–";
  const v = round2(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Rank one company's staff for a period.
 * sources.* === "absent" means that feed is not loaded: the figure counts as 0 and the cell shows a dash.
 * take5On defaults to true (no saved setting still counts Take 5s). false drops them from the score.
 * excludeLeaders true (the default) keeps labourers and operators only.
 */
export function rankPerformance({
  people = [],
  timesheets = [],
  jobs = [],
  incidents = [],
  leaves = [],
  prestarts = [],
  take5s = [],
  period,
  excludeLeaders = true,
  weights,
  take5On = true,
  sources = {},
} = {}) {
  const w = sanitizeWeights(weights);
  const start = period && period.start;
  const end = period && period.end;
  const roster = (people || []).filter(person => includeInRanking(person, excludeLeaders !== false));
  const sheetsByUid = new Map();
  for (const sheet of timesheets || []) {
    const uid = sheet && (sheet.uid || String(sheet.id || "").split("_")[0]);
    if (!uid) continue;
    if (!sheetsByUid.has(uid)) sheetsByUid.set(uid, []);
    sheetsByUid.get(uid).push(sheet);
  }
  const hoursOnJob = new Map();
  for (const person of roster) {
    for (const sheet of sheetsByUid.get(person.uid) || []) {
      for (const entry of entryList(sheet.entries).map(paidShift)) {
        if (!entry || !inRange(entry.date, start, end)) continue;
        const hours = shiftHours(entry);
        if (!hours) continue;
        for (const job of jobs || []) {
          if (!entryMatchesJob(entry.job, job) && !entryMatchesJob(entry.jobId, job)) continue;
          if (!hoursOnJob.has(job.id)) hoursOnJob.set(job.id, {});
          const bag = hoursOnJob.get(job.id);
          bag[person.uid] = round2((bag[person.uid] || 0) + hours);
        }
      }
    }
  }
  const completed = (jobs || []).filter(job => job && job.status === "Done" && inRange(jobDate(job), start, end));
  const started = (jobs || []).filter(job => job && (job.status === "Done" || job.status === "In progress") && inRange(jobDate(job), start, end));
  const metrics = roster.map(person => {
    const byDate = {};
    for (const sheet of sheetsByUid.get(person.uid) || []) {
      for (const [date, hours] of Object.entries(hoursByDate(sheet))) {
        if (!inRange(date, start, end)) continue;
        byDate[date] = round2((byDate[date] || 0) + hours);
      }
    }
    const hours = round2(Object.values(byDate).reduce((sum, n) => sum + n, 0));
    const daysWorked = Object.keys(byDate).filter(date => byDate[date] > 0);
    let money = 0;
    const jobsDetail = [];
    let jobsDone = 0;
    for (const job of completed) {
      if (!assignedUids(job).includes(person.uid)) continue;
      jobsDone += 1;
      const value = jobValueEx(job);
      const crew = assignedUids(job);
      const recorded = hoursOnJob.get(job.id) || {};
      const recordedSum = crew.reduce((sum, uid) => sum + (recorded[uid] || 0), 0);
      const share = recordedSum > 0 ? (recorded[person.uid] || 0) / recordedSum : (crew.length ? 1 / crew.length : 0);
      const amount = round2(value.amount * share);
      money += amount;
      if (value.amount > 0) {
        jobsDetail.push({
          id: job.id,
          label: jobLabel(job),
          value: value.amount,
          basis: value.basis,
          share,
          amount,
          method: recordedSum > 0 ? "hours" : "even",
        });
      }
    }
    money = round2(money);
    const prestartDays = new Set((prestarts || []).filter(row => row && row.signerUid === person.uid && daysWorked.includes(row.day)).map(row => row.day));
    const prestartRatio = daysWorked.length ? prestartDays.size / daysWorked.length : null;
    const expectedJobs = started.filter(job => assignedUids(job).includes(person.uid));
    const doneJobs = new Set((take5s || []).filter(row => row && row.uid === person.uid && expectedJobs.some(job => job.id === row.jobId)).map(row => row.jobId));
    const take5Ratio = expectedJobs.length ? doneJobs.size / expectedJobs.length : null;
    const incidentCount = (incidents || []).filter(row => inRange(incidentDay(row), start, end) && incidentHits(row, person)).length;
    const leaveKnown = sources.leave !== "absent";
    return {
      uid: person.uid,
      name: person.name || "Staff",
      role: personRole(person),
      hours,
      money,
      perHour: hours > 0 ? round2(money / hours) : null,
      jobs: jobsDone,
      incidents: incidentCount,
      sick: leaveKnown ? leaveDays(leaves, person, start, end, "sick") : 0,
      annual: leaveKnown ? leaveDays(leaves, person, start, end, "annual") : 0,
      prestart: prestartRatio,
      take5: take5Ratio,
      jobsDetail,
    };
  });
  const norm = {
    hours: scale(metrics.map(row => row.hours), true),
    money: scale(metrics.map(row => row.money), true),
    jobs: scale(metrics.map(row => row.jobs), true),
    prestart: scale(neutralFill(metrics.map(row => row.prestart)), true),
    take5: scale(neutralFill(metrics.map(row => row.take5)), true),
    incidents: scale(metrics.map(row => row.incidents), false),
    sick: scale(metrics.map(row => row.sick), false),
    annual: scale(metrics.map(row => row.annual), false),
  };
  const scored = metrics.map((row, i) => {
    let raw = w.hours * norm.hours[i] + w.money * norm.money[i] + w.jobs * norm.jobs[i] + w.prestart * norm.prestart[i];
    if (take5On) raw += w.take5 * norm.take5[i];
    raw -= w.incidents * norm.incidents[i] + w.sick * norm.sick[i] + w.annual * norm.annual[i];
    return { ...row, rawScore: round2(raw) };
  });
  scored.sort((a, b) => b.rawScore - a.rawScore || String(a.name).localeCompare(String(b.name)) || String(a.uid).localeCompare(String(b.uid)));
  const max = scored.reduce((n, row) => Math.max(n, row.rawScore), 0);
  const min = scored.reduce((n, row) => Math.min(n, row.rawScore), 0);
  const rows = scored.map((row, index) => ({
    ...row,
    rank: index + 1,
    score: max === min ? (max > 0 ? 100 : 0) : Math.round(((row.rawScore - min) / (max - min)) * 100),
  }));
  return {
    period: period || { kind: "month", start, end, label: "This month" },
    take5On: !!take5On,
    excludeLeaders: excludeLeaders !== false,
    weights: w,
    sources: {
      leave: sources.leave === "absent" ? "absent" : "ok",
      incidents: sources.incidents === "absent" ? "absent" : "ok",
      prestarts: sources.prestarts === "absent" ? "absent" : "ok",
      timesheets: sources.timesheets === "absent" ? "absent" : "ok",
      take5: sources.take5 === "absent" ? "absent" : "ok",
    },
    rows,
  };
}

function cell(text, title) {
  return `<td${title ? ` title="${esc(title)}"` : ""}>${text}</td>`;
}

export function performancePanelHtml(result, { periodKind = "month", custom = {}, selected = "" } = {}) {
  const data = result || { rows: [], sources: {}, take5On: true, excludeLeaders: true, period: periodBounds("month", "2000-01-01") };
  const rows = data.rows || [];
  const src = data.sources || {};
  const take5On = !!data.take5On;
  const options = [
    ["week", "This week"],
    ["month", "This month"],
    ["3months", "Last 3 months"],
    ["fy", "Financial year"],
    ["custom", "Custom"],
  ];
  const customOn = periodKind === "custom";
  const head = `<tr><th>Rank</th><th>Staff</th><th>Score</th><th>Hours</th><th>$ / hour</th><th>Money made</th><th>Jobs</th><th>Incidents</th><th>Sick</th><th>Annual leave</th><th>Prestart</th>${take5On ? "<th>Take 5</th>" : ""}</tr>`;
  const body = rows.map(row => {
    const on = selected === row.uid ? " on" : "";
    return `<tr class="jr perf-row${on}" data-perf="${esc(row.uid)}"><td>${row.rank}</td><td><b>${esc(row.name)}</b><div class="sub">${esc(row.role || "crew")}</div></td><td>${row.score}</td>`
      + cell(src.timesheets === "absent" ? "–" : hourText(row.hours), src.timesheets === "absent" ? "Hours are not available yet" : "")
      + cell(row.perHour == null || src.timesheets === "absent" ? "–" : moneyText(row.perHour))
      + cell(moneyText(row.money))
      + cell(String(row.jobs))
      + cell(src.incidents === "absent" ? "–" : String(row.incidents), src.incidents === "absent" ? "Incidents are not available yet" : "")
      + cell(dayText(row.sick, src.leave === "absent"), src.leave === "absent" ? "Leave is not available yet" : "")
      + cell(dayText(row.annual, src.leave === "absent"))
      + cell(src.prestarts === "absent" ? "–" : pctText(row.prestart), src.prestarts === "absent" ? "Prestarts are not available yet" : "Prestarts signed on days with hours, divided by those days")
      + (take5On ? cell(src.take5 === "absent" ? "–" : pctText(row.take5), "Take 5s filed on jobs they started or finished, divided by those jobs") : "")
      + `</tr>`;
  }).join("") || `<tr><td colspan="${take5On ? 12 : 11}" class="muted pad">Nobody to rank for this period.</td></tr>`;
  const picked = rows.find(row => row.uid === selected);
  return `<section class="perf" id="staffperf">
    <div class="sm-head"><h2>Performance</h2><span class="sub">${esc(data.period && data.period.start || "")} – ${esc(data.period && data.period.end || "")}</span></div>
    <div class="perf-bar">
      <label>Period <select id="perfperiod">${options.map(([id, label]) => `<option value="${id}"${periodKind === id ? " selected" : ""}>${label}</option>`).join("")}</select></label>
      <label class="perf-custom"${customOn ? "" : " hidden"}>From <input id="perffrom" type="date" value="${esc(custom.start || data.period.start || "")}"></label>
      <label class="perf-custom"${customOn ? "" : " hidden"}>To <input id="perfto" type="date" value="${esc(custom.end || data.period.end || "")}"></label>
      <label class="perf-toggle"><input id="perfexclude" type="checkbox"${data.excludeLeaders !== false ? " checked" : ""}> Remove supervisors and above</label>
    </div>
    <details class="perf-tip"><summary>How the ranking works</summary><p>${esc(MONEY_METHOD)}</p><p>${esc(SCORE_METHOD)}</p></details>
    <div class="perf-scroll"><table class="jt perf-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    ${picked ? breakdownHtml(picked, src, take5On) : `<p class="sub">Tap a person for the breakdown.</p>`}
  </section>`;
}

function breakdownHtml(row, src, take5On) {
  const lines = (row.jobsDetail || []).map(job => `<li>#${esc(job.label)} · ${esc(moneyText(job.value))} ${esc(job.basis)} · ${job.method === "hours" ? "by hours" : "split evenly"} · ${esc(moneyText(job.amount))}</li>`).join("");
  return `<article class="perf-break" data-perf-detail="${esc(row.uid)}">
    <h3>${esc(row.name)} · rank ${row.rank} · score ${row.score}</h3>
    <p class="sub">${esc(hourText(row.hours))} worked · ${esc(moneyText(row.money))} made${row.perHour == null ? "" : ` · ${esc(moneyText(row.perHour))} per hour`} · ${row.jobs} job${row.jobs === 1 ? "" : "s"} completed · ${src.incidents === "absent" ? "incidents –" : row.incidents + " incident" + (row.incidents === 1 ? "" : "s")} · sick ${dayText(row.sick, src.leave === "absent")} · annual leave ${dayText(row.annual, src.leave === "absent")} · prestart ${src.prestarts === "absent" ? "–" : pctText(row.prestart)}${take5On ? ` · Take 5 ${src.take5 === "absent" ? "–" : pctText(row.take5)}` : ""}</p>
    ${lines ? `<ul class="perf-jobs">${lines}</ul>` : `<p class="sub">No completed job with a price in this period.</p>`}
  </article>`;
}

export function performanceSettingsHtml(settings, { take5On = true } = {}) {
  const weights = sanitizeWeights(settings && settings.weights);
  const fields = WEIGHT_LABELS.map(([key, label]) => `<label>${esc(label)}<input name="w_${key}" type="number" min="0" max="10" step="0.1" value="${esc(weights[key])}"></label>`).join("");
  return `<section class="pad perf-set"><h3>Staff performance</h3>
    <p class="sub">Managers and admins see the ranking on Staff. Crew and supervisors do not. Weights apply to everyone in the company. 1 is the starting weight. Annual leave starts at 0 so it does not move the rank.</p>
    <form id="take5set"><label class="perf-toggle"><input name="enabled" type="checkbox"${take5On ? " checked" : ""}> Take 5s on</label>
      <p class="sub">Take 5s start on for every company, including when nothing has been saved yet. Field crew complete one before they start a job, and completion counts in the ranking. Switch this off to stop asking and to leave Take 5s out of the score.</p>
      <button class="sm-btn" type="submit">Save Take 5 setting</button></form>
    <form id="perfweights"><div class="perf-weights">${fields}</div><button class="sm-btn" type="submit">Save weights</button></form>
  </section>`;
}

export function weightsFromForm(form) {
  const raw = {};
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const input = form && (form[`w_${key}`] || form.querySelector && form.querySelector(`[name="w_${key}"]`));
    raw[key] = input ? input.value : DEFAULT_WEIGHTS[key];
  }
  return sanitizeWeights(raw);
}
