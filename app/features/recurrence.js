// Recurring jobs. The template job stays a normal job. Extra visits are normal jobs
// with their own dates, so the planner and run sheets pick them up unchanged.
// Generation is a rolling window. The same occurrence id is used every time, so a
// second run does not create a duplicate. An edited or skipped visit is left alone.
// Customer signature sign-off is not part of this. A later sign-off would be a
// separate file on the job, not a change to the series.

export const HORIZON_DAYS = 60;
export const FREQUENCIES = Object.freeze(["weekly", "fortnightly", "monthly", "quarterly", "yearly", "every"]);
const UNITS = new Set(["days", "weeks", "months"]);
const COPY_KEYS = ["client", "address", "type", "description", "notes", "time", "durationHrs", "assigned", "assignedNames", "contactName", "contactPhone", "contactEmail", "po"];
const MONEY_KEYS = new Set(["poAmount", "poAmountBasis", "poAmountSource", "quoteAmount", "poLookupCandidates", "invoiceAmount", "xeroCheck", "totalEx", "gst", "totalInc"]);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function isDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function addDays(iso, n) {
  if (!isDay(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + Number(n))).toISOString().slice(0, 10);
}

export function addMonths(iso, n) {
  if (!isDay(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 + Number(n), 1));
  const last = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

export function sanitizeRecurrence(raw) {
  if (!raw || typeof raw !== "object") return null;
  const freq = FREQUENCIES.includes(raw.freq) ? raw.freq : "";
  if (!freq) return null;
  let interval = 1;
  let unit = "";
  if (freq === "every") {
    interval = Math.round(Number(raw.interval));
    if (!Number.isFinite(interval) || interval < 1) return null;
    interval = Math.min(52, interval);
    unit = UNITS.has(raw.unit) ? raw.unit : "";
    if (!unit) return null;
  }
  const endDate = isDay(raw.endDate) ? raw.endDate : "";
  let count = null;
  if (raw.count != null && raw.count !== "") {
    count = Math.round(Number(raw.count));
    if (!Number.isFinite(count) || count < 1) return null;
    count = Math.min(104, count);
  }
  const anchor = isDay(raw.anchor) ? raw.anchor : "";
  return { freq, interval, unit, endDate, count, anchor };
}

export function stepDate(iso, rule) {
  if (rule.freq === "weekly") return addDays(iso, 7);
  if (rule.freq === "fortnightly") return addDays(iso, 14);
  if (rule.freq === "monthly") return addMonths(iso, 1);
  if (rule.freq === "quarterly") return addMonths(iso, 3);
  if (rule.freq === "yearly") return addMonths(iso, 12);
  if (rule.unit === "days") return addDays(iso, rule.interval);
  if (rule.unit === "weeks") return addDays(iso, rule.interval * 7);
  return addMonths(iso, rule.interval);
}

function nthDate(anchor, rule, steps) {
  if (rule.freq === "weekly") return addDays(anchor, 7 * steps);
  if (rule.freq === "fortnightly") return addDays(anchor, 14 * steps);
  if (rule.freq === "monthly") return addMonths(anchor, steps);
  if (rule.freq === "quarterly") return addMonths(anchor, 3 * steps);
  if (rule.freq === "yearly") return addMonths(anchor, 12 * steps);
  if (rule.unit === "days") return addDays(anchor, rule.interval * steps);
  if (rule.unit === "weeks") return addDays(anchor, rule.interval * 7 * steps);
  return addMonths(anchor, rule.interval * steps);
}

export function occurrenceDates(rule, anchor, today, horizonDays = HORIZON_DAYS) {
  const clean = sanitizeRecurrence(rule);
  if (!clean || !isDay(anchor) || !isDay(today)) return [];
  const horizonEnd = addDays(today, horizonDays);
  const hardEnd = clean.endDate && clean.endDate < horizonEnd ? clean.endDate : horizonEnd;
  const out = [];
  for (let step = 1; step < 500; step++) {
    const cursor = nthDate(anchor, clean, step);
    if (!isDay(cursor) || cursor > hardEnd) break;
    if (clean.count != null && step + 1 > clean.count) break;
    if (cursor >= today && cursor !== anchor) out.push(cursor);
  }
  return out;
}

export function newSeriesId(bytes) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const source = bytes || new Uint8Array(10);
  if (!bytes && globalThis.crypto) globalThis.crypto.getRandomValues(source);
  let id = "s";
  for (const b of source) id += alphabet[b % alphabet.length];
  return id.slice(0, 12);
}

export function occurrenceId(seriesId, date) {
  const series = String(seriesId || "").replace(/[^a-z0-9]/gi, "").slice(0, 16);
  const day = String(date || "").replace(/-/g, "");
  return `occ${series}${day}`;
}

function copyScope(template) {
  const data = {};
  for (const key of COPY_KEYS) {
    if (MONEY_KEYS.has(key)) continue;
    if (template[key] == null || template[key] === "") continue;
    data[key] = template[key];
  }
  return data;
}

export function occurrenceDraft(template, date) {
  const data = copyScope(template);
  data.date = date;
  data.status = "Scheduled";
  data.seriesId = template.seriesId;
  data.seriesRole = "occurrence";
  data.templateId = template.id || "";
  data.occurrenceKey = `${template.seriesId}_${date}`;
  data.recurrence = sanitizeRecurrence({ ...template.recurrence, anchor: template.recurrence.anchor || template.date });
  data.skipped = false;
  data.seriesException = false;
  data.source = template.source === "quote" ? "quote" : "series";
  return { id: occurrenceId(template.seriesId, date), data };
}

function sameList(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function scopePatch(template, existing) {
  const next = copyScope(template);
  const patch = {};
  for (const key of Object.keys(next)) {
    const left = next[key];
    const right = existing[key];
    if (Array.isArray(left) ? !sameList(left, right) : left !== right) patch[key] = left;
  }
  if (existing.recurrence && JSON.stringify(existing.recurrence) !== JSON.stringify(template.recurrence)) {
    patch.recurrence = template.recurrence;
  }
  return patch;
}

/**
 * Creates missing visits and updates future visits that still follow the series.
 * A skipped or edited visit is not written again.
 */
export function planSeries({ template, existing, today, horizonDays = HORIZON_DAYS } = {}) {
  const rule = sanitizeRecurrence(template && template.recurrence);
  if (!template || !rule || !template.seriesId || template.seriesRole === "occurrence") {
    return { creates: [], updates: [] };
  }
  const anchor = isDay(template.date) ? template.date : rule.anchor;
  const dates = occurrenceDates({ ...rule, anchor }, anchor, today, horizonDays);
  const rows = (existing || []).filter(row => row && row.id !== template.id && row.seriesId === template.seriesId);
  const byDate = new Map(rows.map(row => [row.date, row]));
  const creates = [];
  const updates = [];
  const wanted = new Set(dates);
  for (const date of dates) {
    const hit = byDate.get(date);
    if (!hit) {
      creates.push(occurrenceDraft({ ...template, recurrence: { ...rule, anchor }, date: anchor }, date));
      continue;
    }
    if (hit.seriesException || hit.skipped || hit.status === "Cancelled") continue;
    const patch = scopePatch({ ...template, recurrence: { ...rule, anchor } }, hit);
    if (Object.keys(patch).some(key => MONEY_KEYS.has(key))) continue;
    for (const key of Object.keys(patch)) if (MONEY_KEYS.has(key)) delete patch[key];
    if (Object.keys(patch).length) updates.push({ id: hit.id, data: patch });
  }
  for (const row of rows) {
    if (!isDay(row.date) || row.date < today || wanted.has(row.date)) continue;
    if (row.seriesException || row.skipped || row.status === "Cancelled") continue;
    updates.push({ id: row.id, data: { status: "Cancelled", skipped: true, seriesException: true } });
  }
  return { creates, updates };
}

export function skipPatch() {
  return { status: "Cancelled", skipped: true, seriesException: true };
}

export function repeatLabel(rule) {
  const clean = sanitizeRecurrence(rule);
  if (!clean) return "";
  if (clean.freq === "every") return `Every ${clean.interval} ${clean.unit}`;
  return clean.freq.charAt(0).toUpperCase() + clean.freq.slice(1);
}

export function repeatFieldHtml(job, { admin = false, suggestion = "" } = {}) {
  const rule = sanitizeRecurrence(job && job.recurrence) || { freq: "weekly", interval: 1, unit: "weeks", endDate: "", count: null };
  const on = !!(job && job.recurrence);
  const occurrence = job && job.seriesRole === "occurrence";
  if (!admin) {
    if (!on && !occurrence) return "";
    return `<p class="sub">Repeats ${esc(repeatLabel(job.recurrence) || "on a series")}. An admin changes the series.</p>`;
  }
  const freq = (id, label) => `<option value="${id}"${rule.freq === id ? " selected" : ""}>${label}</option>`;
  const endMode = rule.endDate ? "date" : (rule.count ? "count" : "");
  return `<fieldset class="repeat-box" id="repeatbox">
    <legend>Repeat</legend>
    ${occurrence ? `<p class="sub">This visit is part of a series.</p>
      <label class="ck"><input type="radio" name="repeatScope" value="one" checked> This visit only</label>
      <label class="ck"><input type="radio" name="repeatScope" value="series"> This visit and the rest of the series</label>
      <label class="ck"><input type="checkbox" name="repeatSkip"> Skip this visit</label>` : `<label class="ck"><input type="checkbox" name="repeatOn"${on ? " checked" : ""}> This job repeats</label>`}
    <label>How often<select name="repeatFreq">
      ${freq("weekly", "Weekly")}
      ${freq("fortnightly", "Fortnightly")}
      ${freq("monthly", "Monthly")}
      ${freq("quarterly", "Quarterly")}
      ${freq("yearly", "Yearly")}
      ${freq("every", "Every…")}
    </select></label>
    <div class="row">
      <label>Every<input name="repeatEvery" type="number" min="1" max="52" value="${esc(rule.interval || 1)}"></label>
      <label>Unit<select name="repeatUnit">
        <option value="days"${rule.unit === "days" ? " selected" : ""}>days</option>
        <option value="weeks"${rule.unit !== "days" && rule.unit !== "months" ? " selected" : ""}>weeks</option>
        <option value="months"${rule.unit === "months" ? " selected" : ""}>months</option>
      </select></label>
    </div>
    <label>End<select name="repeatEnd">
      <option value=""${endMode === "" ? " selected" : ""}>No end date</option>
      <option value="date"${endMode === "date" ? " selected" : ""}>On a date</option>
      <option value="count"${endMode === "count" ? " selected" : ""}>After a number of visits</option>
    </select></label>
    <div class="row">
      <label>End date<input type="date" name="repeatEndDate" value="${esc(rule.endDate || "")}"></label>
      <label>Visits<input type="number" min="1" max="104" name="repeatCount" value="${esc(rule.count || "")}"></label>
    </div>
    <p class="sub">Visits are added for the next ${HORIZON_DAYS} days. Skip or edit one visit without changing the rest.${suggestion ? " " + esc(suggestion) : ""}</p>
  </fieldset>`;
}

export function recurrenceFromForm(form, job) {
  if (!form) return { ok: true, recurrence: null, skip: false, scope: "one" };
  const occurrence = job && job.seriesRole === "occurrence";
  const scope = form.repeatScope && form.repeatScope.value === "series" ? "series" : "one";
  const skip = !!(form.repeatSkip && form.repeatSkip.checked);
  const on = occurrence ? true : !!(form.repeatOn && form.repeatOn.checked);
  if (!on) return { ok: true, recurrence: null, skip: false, scope };
  const end = form.repeatEnd ? form.repeatEnd.value : "";
  const raw = {
    freq: form.repeatFreq ? form.repeatFreq.value : "weekly",
    interval: form.repeatEvery ? form.repeatEvery.value : 1,
    unit: form.repeatUnit ? form.repeatUnit.value : "weeks",
    endDate: end === "date" && form.repeatEndDate ? form.repeatEndDate.value : "",
    count: end === "count" && form.repeatCount ? form.repeatCount.value : null,
    anchor: (form.date && form.date.value) || (job && job.date) || "",
  };
  const recurrence = sanitizeRecurrence(raw);
  if (!recurrence) return { ok: false, reason: "repeat", recurrence: null, skip, scope };
  return { ok: true, recurrence, skip, scope };
}
