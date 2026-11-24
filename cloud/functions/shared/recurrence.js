// Recurring jobs. The template job stays a normal job. Extra visits are normal jobs
// with their own dates, so the planner and run sheets pick them up unchanged.
// Generation is a rolling window. The same occurrence id is used every time, so a
// second run does not create a duplicate. An edited or skipped visit is left alone.
// Skip sets status to In progress and the skipped flag. The flag is what the
// generator trusts. Stop series marks the template ended and cancels untouched
// future visits the same way a visit past the end date is cancelled.
// Customer signature sign-off is not part of this. A later sign-off would be a
// separate file on the job, not a change to the series.

export const HORIZON_DAYS = 60;
export const FREQUENCIES = Object.freeze(["weekly", "fortnightly", "monthly", "quarterly", "yearly", "every"]);
const UNITS = new Set(["days", "weeks", "months"]);
const COPY_KEYS = ["client", "address", "type", "description", "notes", "time", "durationHrs", "assigned", "assignedNames", "contactName", "contactPhone", "contactEmail", "po"];
const EDIT_KEYS = ["client", "address", "type", "description", "notes", "time", "durationHrs", "assigned", "assignedNames", "contactName", "contactPhone", "contactEmail"];
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
  if (!template || !rule || !template.seriesId || template.seriesRole === "occurrence" || template.seriesEnded) {
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
    updates.push({ id: row.id, data: cancelVisitPatch() });
  }
  return { creates, updates };
}

// Skip stays on the planner as In progress. The skipped flag, not the status,
// stops the generator from rewriting or recreating the visit.
export function skipPatch() {
  return { status: "In progress", skipped: true, seriesException: true };
}

// Same soft cancel the generator uses when a visit falls outside the series.
export function cancelVisitPatch() {
  return { status: "Cancelled", skipped: true, seriesException: true };
}

export function seriesEndedPatch(today) {
  return {
    seriesEnded: true,
    seriesEndedOn: isDay(today) ? today : "",
    recurrence: null,
    seriesRole: "template",
  };
}

export function shouldStopSeries(job, parsed) {
  if (!job || !parsed || parsed.skip) return false;
  if (job.seriesRole === "occurrence") return false;
  if (!job.seriesId || !job.recurrence || job.seriesEnded) return false;
  return !parsed.recurrence;
}

function blank(value) {
  return value == null || value === "" ? "" : value;
}

function fieldsDiffer(visit, template) {
  if (!template) return false;
  for (const key of EDIT_KEYS) {
    const left = visit[key];
    const right = template[key];
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!sameList(left, right)) return true;
      continue;
    }
    if (blank(left) !== blank(right)) return true;
  }
  return false;
}

function hasPhotos(visit, extras) {
  if (visit.photosEmailedAt) return true;
  if (Number(visit.photosEmailedCount) > 0) return true;
  if (visit.cloudPhotosAt) return true;
  if (Array.isArray(visit.photos) && visit.photos.length) return true;
  if (Number(visit.photoCount) > 0) return true;
  const ids = extras && extras.photoJobIds;
  return !!(ids && typeof ids.has === "function" && ids.has(visit.id));
}

function hasDocuments(visit, extras) {
  if (Array.isArray(visit.documents) && visit.documents.length) return true;
  if (Number(visit.documentCount) > 0) return true;
  const ids = extras && extras.documentJobIds;
  return !!(ids && typeof ids.has === "function" && ids.has(visit.id));
}

function hasCrewNotes(visit) {
  return Array.isArray(visit.log) && visit.log.some(row => row && String(row.text || "").trim());
}

function hasInvoiceOrPo(visit, template) {
  if (String(visit.invoiceNo || "").trim()) return true;
  if (visit.invoiced === true || visit.invoiceExcluded === true || visit.doNotInvoice === true) return true;
  if (visit.invoiceAmount != null && visit.invoiceAmount !== "") return true;
  if (String(visit.xeroInvoiceId || "").trim() || String(visit.xeroInvoiceNo || "").trim() || String(visit.xeroStatus || "").trim()) return true;
  if (visit.xeroCheck && typeof visit.xeroCheck === "object") return true;
  if (visit.poAmount != null && visit.poAmount !== "") return true;
  if (String(visit.poAmountBasis || "").trim() || String(visit.poAmountSource || "").trim()) return true;
  if (visit.quoteAmount != null && visit.quoteAmount !== "") return true;
  if (Array.isArray(visit.poLookupCandidates) && visit.poLookupCandidates.length) return true;
  const po = String(visit.po || "").trim();
  const templatePo = String(template && template.po || "").trim();
  return !!(po && po !== templatePo);
}

function timesheetRows(extras) {
  const out = [];
  for (const sheet of (extras && extras.timesheets) || []) {
    if (!sheet) continue;
    out.push(sheet);
    const entries = sheet.entries;
    if (Array.isArray(entries)) out.push(...entries.filter(Boolean));
    else if (entries && typeof entries === "object") out.push(...Object.values(entries).filter(Boolean));
    if (sheet.days && typeof sheet.days === "object") out.push(...Object.values(sheet.days).filter(Boolean));
  }
  return out;
}

function mentionsVisit(entry, visit) {
  if (!entry || !visit) return false;
  if (entry.jobId && entry.jobId === visit.id) return true;
  if (entry.job && typeof entry.job === "object" && entry.job.id === visit.id) return true;
  const entryDate = String(entry.date || "").slice(0, 10);
  if (!isDay(entryDate) || entryDate !== visit.date) return false;
  const chunks = [];
  if (typeof entry.job === "string" && entry.job.trim()) chunks.push(entry.job);
  if (typeof entry.note === "string" && entry.note.trim()) chunks.push(entry.note);
  const text = chunks.join(" ").trim().toLowerCase();
  if (!text) return false;
  const num = String(visit.jobNo || visit.sm8JobNo || "").trim().toLowerCase();
  if (num && (text === num || (num.length >= 4 && text.includes(num)))) return true;
  const address = String(visit.address || "").trim().toLowerCase();
  return !!(address.length >= 8 && (text === address || text.includes(address)));
}

function hasTimesheet(visit, extras) {
  return timesheetRows(extras).some(entry => mentionsVisit(entry, visit));
}

export function visitLabel(visit) {
  const date = isDay(visit && visit.date) ? visit.date : "No date";
  const where = String((visit && (visit.address || visit.client)) || "").trim();
  return where ? `${date} ${where}` : date;
}

export function visitKeepReasons(visit, template, extras) {
  const reasons = [];
  if (!visit) return reasons;
  const uncertain = extras && extras.uncertainJobIds;
  if (uncertain && typeof uncertain.has === "function" && uncertain.has(visit.id)) reasons.push("could not be checked");
  if (visit.skipped) reasons.push("skipped");
  if ((visit.seriesException || fieldsDiffer(visit, template)) && !visit.skipped) reasons.push("edited");
  if ((visit.startedAt || visit.status === "In progress") && !visit.skipped) reasons.push("started");
  if (visit.completedAt || visit.completedBy || visit.status === "Done" || visit.sm8Status === "Completed") reasons.push("completed");
  if ((visit.status === "Cancelled" || visit.sm8Status === "Unsuccessful") && !visit.skipped) reasons.push("already unsuccessful");
  if (hasCrewNotes(visit)) reasons.push("crew notes");
  if (hasPhotos(visit, extras)) reasons.push("photos");
  if (hasDocuments(visit, extras)) reasons.push("documents");
  if (hasTimesheet(visit, extras)) reasons.push("timesheet");
  if (hasInvoiceOrPo(visit, template)) reasons.push("invoice or PO");
  return [...new Set(reasons)];
}

/**
 * Future means after today. Today and earlier stay, including the template job.
 * Untouched future visits are cancelled. Edited, skipped, started, or active ones stay.
 */
export function planStopSeries({ template, existing, today, extras } = {}) {
  const seriesId = template && template.seriesId;
  const rows = (existing || []).filter(row => row && row.id && seriesId && row.id !== template.id && row.seriesId === seriesId);
  const remove = [];
  const keep = [];
  for (const row of rows) {
    if (!isDay(row.date) || !isDay(today) || row.date <= today) continue;
    const reasons = visitKeepReasons(row, template, extras);
    const item = { id: row.id, date: row.date, label: visitLabel(row), reasons };
    if (reasons.length) keep.push(item);
    else remove.push(item);
  }
  remove.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  keep.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { templatePatch: seriesEndedPatch(today), remove, keep };
}

export function stopSeriesConfirmText(plan) {
  const remove = plan && Array.isArray(plan.remove) ? plan.remove : [];
  const keep = plan && Array.isArray(plan.keep) ? plan.keep : [];
  const n = remove.length;
  const lines = [
    "Stop this series?",
    "",
    `${n} future ${n === 1 ? "visit" : "visits"} will be removed. Visits today and earlier stay.`,
  ];
  if (keep.length) {
    lines.push("", "These future visits will be kept because they were changed or already have work:");
    for (const row of keep) lines.push(`• ${row.label} (${row.reasons.join(", ")})`);
  }
  lines.push("", "New visits will not be added.");
  return lines.join("\n");
}

export function stopSeriesResultText(plan) {
  const remove = plan && Array.isArray(plan.remove) ? plan.remove : [];
  const keep = plan && Array.isArray(plan.keep) ? plan.keep : [];
  const n = remove.length;
  const removed = `Removed ${n} future ${n === 1 ? "visit" : "visits"}.`;
  if (!keep.length) return `Series stopped. ${removed}`;
  const listed = keep.map(row => `${row.label} (${row.reasons.join(", ")})`).join("; ");
  return `Series stopped. ${removed} Kept: ${listed}.`;
}

export function repeatLabel(rule) {
  const clean = sanitizeRecurrence(rule);
  if (!clean) return "";
  if (clean.freq === "every") return `Every ${clean.interval} ${clean.unit}`;
  return clean.freq.charAt(0).toUpperCase() + clean.freq.slice(1);
}

export function repeatFieldHtml(job, { admin = false, suggestion = "", seriesEnded = false } = {}) {
  const rule = sanitizeRecurrence(job && job.recurrence) || { freq: "weekly", interval: 1, unit: "weeks", endDate: "", count: null };
  const ended = !!(job && job.seriesEnded) || !!seriesEnded;
  const on = !!(job && job.recurrence) && !ended;
  const occurrence = job && job.seriesRole === "occurrence";
  const canStop = !!(job && job.seriesId) && !ended;
  if (!admin) {
    if (!on && !occurrence && !ended) return "";
    if (ended) return `<p class="sub">This series is stopped. An admin changed it.</p>`;
    const label = esc(repeatLabel(job && job.recurrence) || "on a series");
    return `<p class="sub">Repeats ${label}. An admin changes or stops the series.</p>`;
  }
  const freq = (id, label) => `<option value="${id}"${rule.freq === id ? " selected" : ""}>${label}</option>`;
  const endMode = rule.endDate ? "date" : (rule.count ? "count" : "");
  const open = (occurrence && !ended) || on;
  const hide = open ? "" : " hidden";
  const stopBtn = canStop ? `<button type="button" class="sm-btn" data-stop-series>Stop this series</button>` : "";
  const stoppedNote = ended ? `<p class="sub">This series is stopped. New visits are not added.${occurrence ? " This visit stays." : " Tick This job repeats only to start it again."}</p>` : "";
  return `<fieldset class="repeat-box" id="repeatbox">
    <legend>Repeat</legend>
    ${stoppedNote}
    ${occurrence && !ended ? `<p class="sub">This visit is part of a series.</p>
      <label class="ck"><input type="radio" name="repeatScope" value="one" checked> This visit only</label>
      <label class="ck"><input type="radio" name="repeatScope" value="series"> This visit and the rest of the series</label>
      <label class="ck"><input type="checkbox" name="repeatSkip"> Skip this visit</label>
      <p class="sub">Skip leaves this visit on the planner as In progress. It is not marked Unsuccessful.</p>
      ${stopBtn}` : occurrence ? "" : `<label class="ck"><input type="checkbox" name="repeatOn"${on ? " checked" : ""}> This job repeats</label>${canStop ? " " + stopBtn : ""}`}
    <label class="repeat-more"${hide}>How often<select name="repeatFreq">
      ${freq("weekly", "Weekly")}
      ${freq("fortnightly", "Fortnightly")}
      ${freq("monthly", "Monthly")}
      ${freq("quarterly", "Quarterly")}
      ${freq("yearly", "Yearly")}
      ${freq("every", "Every…")}
    </select></label>
    <div class="row repeat-more"${hide}>
      <label>Every<input name="repeatEvery" type="number" min="1" max="52" value="${esc(rule.interval || 1)}"></label>
      <label>Unit<select name="repeatUnit">
        <option value="days"${rule.unit === "days" ? " selected" : ""}>days</option>
        <option value="weeks"${rule.unit !== "days" && rule.unit !== "months" ? " selected" : ""}>weeks</option>
        <option value="months"${rule.unit === "months" ? " selected" : ""}>months</option>
      </select></label>
    </div>
    <label class="repeat-more"${hide}>End<select name="repeatEnd">
      <option value=""${endMode === "" ? " selected" : ""}>No end date</option>
      <option value="date"${endMode === "date" ? " selected" : ""}>On a date</option>
      <option value="count"${endMode === "count" ? " selected" : ""}>After a number of visits</option>
    </select></label>
    <div class="row repeat-more"${hide}>
      <label>End date<input type="date" name="repeatEndDate" value="${esc(rule.endDate || "")}"></label>
      <label>Visits<input type="number" min="1" max="104" name="repeatCount" value="${esc(rule.count || "")}"></label>
    </div>
    <p class="sub repeat-more"${hide}>Visits are added for the next ${HORIZON_DAYS} days. Skip one visit and it stays on the planner as In progress. Edit one visit without changing the rest. Untick This job repeats, or use Stop this series, to end it and remove future visits that have not been touched.${suggestion ? " " + esc(suggestion) : ""}</p>
  </fieldset>`;
}

export function wireRepeatBox(root, hooks) {
  const box = repeatBox(root);
  if (!box || box.dataset.repeatWired) return;
  box.dataset.repeatWired = "1";
  const onUntick = hooks && hooks.onUntick;
  const onStop = hooks && hooks.onStop;
  const apply = () => {
    const toggle = box.querySelector('input[name="repeatOn"]');
    const hide = !!(toggle && !toggle.checked);
    for (const el of box.querySelectorAll(".repeat-more")) el.hidden = hide;
  };
  apply();
  const stop = box.querySelector("[data-stop-series]");
  if (stop && typeof onStop === "function") {
    stop.addEventListener("click", event => {
      if (event && event.preventDefault) event.preventDefault();
      onStop();
    });
  }
  box.addEventListener("change", event => {
    const target = event && event.target;
    if (target && target.name === "repeatOn") {
      apply();
      if (!target.checked && typeof onUntick === "function") onUntick(target);
    }
  });
}

function repeatBox(root) {
  if (!root || typeof root.querySelector !== "function") return null;
  if (root.id === "repeatbox") return root;
  return root.querySelector("#repeatbox");
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
