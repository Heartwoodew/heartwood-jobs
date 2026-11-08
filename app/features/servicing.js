// Servicing for fleet assets. Included for every company.
// Last service, and the next one due by a date and/or hours/km interval set on that asset.
// Cost is a separate field for people who can see money. Staff never receive it.
// Invoice photos are not stored. Storage has no servicing path, and this build does not add one.

export const SERVICE_DUE_DAYS = 30;
export const SERVICE_TYPES = Object.freeze([
  ["250hr", "250 hour"],
  ["major", "Major"],
  ["repair", "Repair"],
  ["other", "Other"],
]);

function addIsoDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dateOk(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}
function formatAu(iso) {
  if (!iso) return "";
  const [y, m, day] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[+m - 1];
  return month ? `${+day} ${month} ${y}` : iso;
}

const RANK = { overdue: 0, due: 1, ok: 2, none: 3 };
const LABEL = {
  overdue: "Overdue",
  due: "Due soon",
  ok: "OK",
  none: "No interval",
};

function text(value) {
  return String(value ?? "").trim();
}

function whole(value, max) {
  if (value === "" || value == null) return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

export function servicePayload(input, uid) {
  const assetId = text(input && input.assetId);
  const doneOn = text(input && input.doneOn);
  const reading = whole(input && input.reading, 10000000);
  const readingUnit = text(input && input.readingUnit);
  const serviceType = text(input && input.serviceType);
  const servicedBy = text(input && input.servicedBy);
  const notes = text(input && input.notes);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(assetId)) return { ok: false, reason: "Choose a machine." };
  if (!dateOk(doneOn) || !doneOn) return { ok: false, reason: "Add the date the service was done." };
  if (reading == null) return { ok: false, reason: "Hours or km must be a whole number." };
  if (!["", "hours", "km"].includes(readingUnit)) return { ok: false, reason: "Choose hours or km." };
  if (reading > 0 && !readingUnit) return { ok: false, reason: "Choose hours or km for that reading." };
  if (!SERVICE_TYPES.some(([id]) => id === serviceType)) return { ok: false, reason: "Choose the kind of service." };
  if (servicedBy.length > 120) return { ok: false, reason: "Who or where is too long." };
  if (notes.length > 2000) return { ok: false, reason: "Notes are too long." };
  if (!uid) return { ok: false, reason: "Sign in again." };
  return {
    ok: true,
    data: {
      assetId, doneOn, reading: readingUnit ? reading : 0, readingUnit: reading ? readingUnit : "",
      serviceType, servicedBy, notes, updatedBy: uid,
    },
  };
}

export function planPayload(input, uid) {
  const everyDays = whole(input && input.everyDays, 3650);
  const everyReading = whole(input && input.everyReading, 1000000);
  const currentReading = whole(input && input.currentReading, 10000000);
  let readingUnit = text(input && input.readingUnit);
  if (everyDays == null || everyReading == null || currentReading == null) return { ok: false, reason: "Use whole numbers, or leave the interval blank." };
  if (!["", "hours", "km"].includes(readingUnit)) return { ok: false, reason: "Choose hours or km." };
  if (!everyReading) readingUnit = "";
  if (everyReading && !readingUnit) return { ok: false, reason: "Choose hours or km for the interval." };
  if (!uid) return { ok: false, reason: "Sign in again." };
  return { ok: true, data: { everyDays, everyReading, readingUnit, currentReading, updatedBy: uid } };
}

export function costPayload(input, uid) {
  const amount = text(input && input.amount);
  if (!amount) return { ok: true, data: null };
  if (amount.length > 40) return { ok: false, reason: "Cost is too long." };
  if (!uid) return { ok: false, reason: "Sign in again." };
  return { ok: true, data: { amount, updatedBy: uid } };
}

function unitWord(unit) {
  return unit === "km" ? "km" : "hours";
}

function formatReading(n, unit) {
  if (!n) return "";
  return `${Number(n).toLocaleString("en-AU")} ${unitWord(unit)}`;
}

function typeLabel(id) {
  return (SERVICE_TYPES.find(([k]) => k === id) || [id, id])[1];
}

function worst(keys) {
  return keys.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b));
}

/** "Due soon" window for an hours/km interval: 10% of the interval, or 50 hrs / 1,000 km, whichever is smaller. */
export function dueWindow(everyReading, unit) {
  if (!(everyReading > 0)) return 0;
  return Math.max(1, Math.min(Math.round(everyReading * 0.1), unit === "km" ? 1000 : 50));
}

function readingDate(v) {
  if (!v) return "";
  if (typeof v === "string") return v.slice(0, 10);
  if (typeof v.toDate === "function") return v.toDate().toISOString().slice(0, 10);
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000).toISOString().slice(0, 10);
  return "";
}

/** Service state for one machine after a new reading (used to alert the person submitting a prestart). */
export function serviceAfterReading(asset, records, plan, today, reading, readingUnit) {
  const next = { ...asset, reading: Math.max(Number(asset.reading) || 0, Number(reading) || 0), readingUnit: readingUnit || asset.readingUnit || "" };
  return machineService(next, records, plan, today);
}

export function machineService(asset, records, plan, today) {
  const mine = (records || []).filter(r => r && r.assetId === asset.id).sort((a, b) => String(b.doneOn).localeCompare(String(a.doneOn)) || String(b.id).localeCompare(String(a.id)));
  const last = mine[0] || null;
  const everyDays = plan && plan.everyDays > 0 ? plan.everyDays : 0;
  const everyReading = plan && plan.everyReading > 0 ? plan.everyReading : 0;
  const unit = (plan && plan.readingUnit) || asset.readingUnit || (last && last.readingUnit) || "";
  // Latest reading: the higher of the fleet reading (prestarts move it up) and the interval form's "current".
  const fleetReading = asset.reading > 0 && (!unit || !asset.readingUnit || asset.readingUnit === unit) ? asset.reading : 0;
  const planReading = plan && plan.currentReading > 0 ? plan.currentReading : 0;
  const current = Math.max(fleetReading, planReading);
  const latest = current ? {
    reading: current,
    at: fleetReading >= planReading ? readingDate(asset.readingAt) : "",
    by: fleetReading >= planReading ? String(asset.readingByName || "") : "",
  } : null;
  const lastReading = last && last.reading > 0 && (!unit || !last.readingUnit || last.readingUnit === unit) ? last.reading : 0;
  const sinceService = current && lastReading && current >= lastReading ? current - lastReading : 0;
  const intervalOn = !!(everyDays || everyReading);
  let nextDate = "";
  let dateKey = "none";
  if (everyDays) {
    if (!last) dateKey = "overdue";
    else {
      nextDate = addIsoDays(last.doneOn, everyDays);
      if (nextDate < today) dateKey = "overdue";
      else if (nextDate <= addIsoDays(today, SERVICE_DUE_DAYS)) dateKey = "due";
      else dateKey = "ok";
    }
  }
  let nextReading = 0;
  let readKey = "none";
  if (everyReading) {
    if (!last || !last.reading) readKey = "overdue";
    else {
      nextReading = last.reading + everyReading;
      if (current && current >= nextReading) readKey = "overdue";
      else if (current && nextReading - current <= dueWindow(everyReading, unit)) readKey = "due";
      else readKey = "ok";
    }
  }
  const keys = [dateKey, readKey].filter(k => k !== "none");
  const k = !intervalOn ? "none" : keys.length ? worst(keys) : "none";
  return {
    asset, records: mine, last, plan: plan || null, k, label: LABEL[k],
    nextDate, nextReading, unit, current, everyDays, everyReading, latest, lastReading, sinceService,
    toGo: nextReading && current ? nextReading - current : 0,
    sort: k === "overdue" || k === "due" ? (nextDate || "0000-00-00") : (nextDate || "9999-99-99"),
  };
}

export function serviceViews(assets, records, plans, today) {
  const byAsset = new Map((plans || []).map(p => [p.id, p]));
  return (assets || []).map(asset => machineService(asset, records, byAsset.get(asset.id), today))
    .sort((a, b) => RANK[a.k] - RANK[b.k] || a.sort.localeCompare(b.sort) || String(a.asset.name || "").localeCompare(String(b.asset.name || "")));
}

export function serviceAttention(views) {
  const rows = views || [];
  return {
    overdue: rows.filter(v => v.k === "overdue").length,
    due: rows.filter(v => v.k === "due").length,
    names: rows.filter(v => v.k === "overdue" || v.k === "due").map(v => v.asset.name || "Machine"),
  };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function pill(k, text) {
  const cls = k === "ok" || k === "none" ? "sw-ok" : k === "due" ? "sw-due" : "sw-exp";
  return `<span class="swpill ${cls}">${esc(text)}</span>`;
}

function nextLine(view) {
  const bits = [];
  if (view.nextDate) bits.push(formatAu(view.nextDate));
  if (view.nextReading) bits.push(formatReading(view.nextReading, view.unit));
  if (!bits.length && view.k === "overdue") return "No service recorded";
  if (!bits.length) return "No interval set";
  return bits.join(" · ");
}

function recordLine(row, showCost) {
  const bits = [formatAu(row.doneOn), formatReading(row.reading, row.readingUnit), typeLabel(row.serviceType), row.servicedBy].filter(Boolean);
  const cost = showCost && row.cost ? ` · ${row.cost}` : "";
  return `${bits.join(" · ")}${cost}`;
}

export function servicingHtml(views, { editable = false, showCost = false, costs = null } = {}) {
  if (!(views || []).length) return `<p class="muted pad comp-empty">No machines on the fleet list yet.</p>`;
  const costOf = id => (showCost && costs && costs[id]) ? costs[id] : "";
  return `<div class="comp-list">${views.map(view => {
    const a = view.asset;
    const line = row => recordLine({ ...row, cost: costOf(row.id) }, showCost);
    const last = view.last ? line(view.last) : "No service recorded";
    const history = view.records.slice(view.last ? 1 : 0).map(row => `<div class="sub">${esc(line(row))}</div>`).join("");
    const buttons = [];
    if (editable && view.last) buttons.push(`<button type="button" class="sm-btn" data-comp-edit="service" data-comp-id="${esc(view.last.id)}">Edit last</button>`);
    if (editable) {
      buttons.push(`<button type="button" class="sm-btn" data-comp-add="service" data-asset="${esc(a.id)}">Add service</button>`);
      buttons.push(`<button type="button" class="sm-btn" data-comp-edit="interval" data-comp-id="${esc(a.id)}">Interval</button>`);
    }
    return `<article class="comp-card" data-service-asset="${esc(a.id)}">
      <div class="comp-top"><div><b>${esc(a.name || "Machine")}</b><div class="sub">${esc(a.rego || a.type || "")}</div></div>${pill(view.k, view.label)}</div>
      <div class="comp-lines">
        <div class="comp-line"><span class="lbl">Last</span><span>${esc(last)}</span></div>
        <div class="comp-line"><span class="lbl">Next</span><span>${esc(nextLine(view))}</span></div>
        ${view.latest ? `<div class="comp-line"><span class="lbl">Latest</span><span>${esc([formatReading(view.latest.reading, view.unit), formatAu(view.latest.at), view.latest.by].filter(Boolean).join(" · "))}</span></div>` : ""}
        ${view.lastReading ? `<div class="comp-line"><span class="lbl">At service</span><span>${esc(formatReading(view.lastReading, view.unit))}</span></div>` : ""}
        ${view.sinceService ? `<div class="comp-line"><span class="lbl">Since service</span><span>${esc(formatReading(view.sinceService, view.unit))}</span></div>` : ""}
        ${view.everyReading ? `<div class="comp-line"><span class="lbl">Interval</span><span>Every ${esc(formatReading(view.everyReading, view.unit))}${view.toGo > 0 ? ` · ${esc(formatReading(view.toGo, view.unit))} to go` : ""}</span></div>` : ""}
      </div>
      ${history}
      ${buttons.length ? `<div class="comp-actions">${buttons.join("")}</div>` : ""}
    </article>`;
  }).join("")}</div>`;
}

function options(list, selected) {
  return list.map(([id, label]) => `<option value="${esc(id)}"${id === selected ? " selected" : ""}>${esc(label)}</option>`).join("");
}

export function serviceFormHtml(record, assets, costs, { showCost, presetAsset }) {
  const row = record || {};
  const assetId = row.assetId || presetAsset || (assets[0] && assets[0].id) || "";
  const cost = row.id && costs ? (costs[row.id] || "") : "";
  const machines = (assets || []).map(a => `<option value="${esc(a.id)}"${a.id === assetId ? " selected" : ""}>${esc(a.name || "Machine")}${a.rego ? ` · ${esc(a.rego)}` : ""}</option>`).join("");
  return `<form id="compform" class="comp-form" data-kind="service" data-comp-id="${esc(row.id || "")}">
    <h2>${row.id ? "Edit service" : "Add service"}</h2>
    <p class="comp-help">Record when this machine was serviced. Invoices and photos are not stored in the app.</p>
    <label>Machine<select name="assetId">${machines}</select></label>
    <label>Date done<input name="doneOn" type="date" required value="${esc(row.doneOn || "")}"></label>
    <label>Hours or km<input name="reading" inputmode="numeric" value="${row.reading ? esc(row.reading) : ""}" autocomplete="off"></label>
    <label>Reading unit<select name="readingUnit"><option value=""${!row.readingUnit ? " selected" : ""}>Not recorded</option><option value="hours"${row.readingUnit === "hours" ? " selected" : ""}>Hours</option><option value="km"${row.readingUnit === "km" ? " selected" : ""}>Km</option></select></label>
    <label>Type<select name="serviceType">${options(SERVICE_TYPES, row.serviceType || "major")}</select></label>
    <label>Who / where<input name="servicedBy" maxlength="120" value="${esc(row.servicedBy || "")}" autocomplete="off"></label>
    <label>Notes<textarea name="notes" rows="3" maxlength="2000">${esc(row.notes || "")}</textarea></label>
    ${showCost ? `<label>Cost<input name="amount" maxlength="40" value="${esc(cost)}" autocomplete="off"></label>` : ""}
    <div class="comp-actions"><button class="sm-btn primary" type="submit">Save</button><button class="sm-btn" type="button" data-comp-cancel>Cancel</button>${row.id ? `<button class="sm-btn" type="button" data-comp-delete>Remove</button>` : ""}</div>
  </form>`;
}

export function intervalFormHtml(asset, plan) {
  const p = plan || {};
  const defaultUnit = asset && (asset.readingUnit === "km" || asset.readingUnit === "hours") ? asset.readingUnit : "";
  return `<form id="compform" class="comp-form" data-kind="interval" data-comp-id="${esc(asset.id)}">
    <h2>Service interval</h2>
    <p class="comp-help">${esc(asset.name || "This machine")}. For example every 250 hours, or every 10,000 km. Leave a box blank if you do not use that interval. Prestarts keep the current reading up to date.</p>
    <label>Every (days)<input name="everyDays" inputmode="numeric" value="${p.everyDays ? esc(p.everyDays) : ""}" autocomplete="off"></label>
    <label>Every (hours or km)<input name="everyReading" inputmode="numeric" value="${p.everyReading ? esc(p.everyReading) : ""}" autocomplete="off"></label>
    <label>Unit<select name="readingUnit"><option value=""${!p.readingUnit ? " selected" : ""}>No hours or km interval</option><option value="hours"${p.readingUnit === "hours" ? " selected" : ""}>Hours</option><option value="km"${p.readingUnit === "km" ? " selected" : ""}>Km</option></select>${defaultUnit ? `<p class="comp-help">This machine reads in ${defaultUnit === "km" ? "km" : "hours"}.</p>` : ""}</label>
    <label>Current hours or km<input name="currentReading" inputmode="numeric" value="${p.currentReading ? esc(p.currentReading) : ""}" autocomplete="off"></label>
    <div class="comp-actions"><button class="sm-btn primary" type="submit">Save</button><button class="sm-btn" type="button" data-comp-cancel>Cancel</button></div>
  </form>`;
}
