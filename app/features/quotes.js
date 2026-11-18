// CallUp guided Quotes (Nov 2026). Prices always ex GST.
import { orgSettings, POWERED_BY, PRODUCT_NAME } from "../org-settings.js";
import { scopeRecord } from "./company.js";
import { JOB_MONEY_COLLECTION, jobMoneyDoc } from "./job-money.js";
import { attachAddressSearch, placesEnabled, sanitizePlace } from "./places.js";
import { bindDescriptionPicker, descriptionPickerHtml, inputAttrs } from "./autofill.js";
import { LINE_TYPES, measureQty, normalizeLineType, quotePack, quotePackNote, rateSaveChoice, sanitizeTradeList, tradeLabel, tradeToolsHtml, typeInfo } from "./trades.js";
import { calcLandscaping } from "./packs/landscaping.js";
import { calcConcreting } from "./packs/concreting.js";
import { calcFencing } from "./packs/fencing.js";
import { calcCarpentry } from "./packs/carpentry.js";
import { calcTiling } from "./packs/tiling.js";
import { calcPlumbing } from "./packs/plumbing.js";
import { calcElectrical } from "./packs/electrical.js";
import { calcConcreteCutting } from "./packs/concrete-cutting.js";
import { companyRatesForTrade, defaultMeasures, gstFromEx, packRateInputs, prettyUnit, roundMoney, sanitizeQuotePrices, sanitizeTradeRates, savedTradeRate, splitCalcKey, tradeMapFromLegacy, writeTradeRate } from "./packs/money.js";
import { measureReviewHtml, measureSetupHtml } from "./packs/form.js";
import { changeLines, compareHtml, commercialSnapshot, diffRevisions, revisionBody, revisionDocId, revisionNeeded, revisionsPanelHtml } from "./quote-revisions.js";
// Rates from meta/quoteRates only — never invent business rates.
// Draft/Accepted are explicit quoteStatus fields.
// Admins, managers and supervisors (canQuote / canSeeMoney). Rate edits: admin or manager (canEditQuoteRates).
// Depot: 208-220 Holdsworth Rd, Chuwar QLD 4306. Travel via Nominatim+OSRM — never straight-line as billable km.
// Equipment: fleet Machine-register names; presets Truck ± skid ± excavator; each machine rate includes operator.
// Optional labourer is a separate rate. Hours drive hourly packages; day rates use machineDays (not × hours).
// No GPS in this build.

export const DEFAULT_DEPOT = {
  yardAddress: "208-220 Holdsworth Rd, Chuwar QLD 4306",
  yardMapsUrl: "https://maps.app.goo.gl/w4AX7X6VtPtqH75S7?g_st=ic"
};
const HEARTWOOD_DEPOT = { ...DEFAULT_DEPOT };
// Other companies: the depot default is their own company address (no Heartwood maps link).
// A CallUp company with no address gets no depot (never Heartwood's yard): the admin sets it under Quote rates & depot.
export function setDefaultDepot(address, { heartwood = false } = {}) {
  const a = String(address || "").trim();
  DEFAULT_DEPOT.yardAddress = a || (heartwood ? HEARTWOOD_DEPOT.yardAddress : "");
  DEFAULT_DEPOT.yardMapsUrl = a ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a) : (heartwood ? HEARTWOOD_DEPOT.yardMapsUrl : "");
}

/** Fleet plant from Heartwood Machine register (names/codes). Rates blank until admin sets them. */
export const FLEET_MACHINES = [
  { id: "truck", name: "Truck", registerName: "Truck", code: "", kind: "truck" },
  { id: "skid", name: "Skid steer (Bobcat)", registerName: "Bobcat", code: "CA", kind: "skid" },
  { id: "excavator", name: "Excavator (JCB)", registerName: "Jcb", code: "EX", kind: "excavator" }
];

/**
 * Equipment presets (Alex Nov 2026): Truck with skid and/or excavator.
 * Each preset lists machine ids once — truck is never charged twice.
 * Preset package rate includes operator; labourer is optional add-on.
 * No truck-only option (Alex, 11 Nov 2026): the truck comes with a skid steer or excavator. Saved truck-only
 * quotes still open and calculate as legacy (isTruckOnly) and are never forced to change.
 */
export const EQUIPMENT_PRESETS = [
  { id: "truck_skid", label: "Truck + skid steer", machines: ["truck", "skid"] },
  { id: "truck_excavator", label: "Truck + excavator", machines: ["truck", "excavator"] },
  { id: "truck_skid_excavator", label: "Truck + skid steer + excavator", machines: ["truck", "skid", "excavator"] },
  { id: "excavator", label: "Excavator only", machines: ["excavator"] }
];

const DEFAULT_RATE_KEYS = [
  ["travelPerKm", "Travel $ / km (ex GST)", "km"],
  ["materialPerUnit", "Materials $ / unit (ex GST)", "unit"],
  ["tipPerLoad", "Rubbish / tip $ / load (ex GST)", "load"]
];

// ---- Extra line items (Nov 2026): admin/supervisor-added items on top of the guided machine + labour lines.
// Prices ex GST. Preset prices come from the company's own rates (or saved presets) when set, otherwise blank —
// never invented — and every price stays editable on the quote.
export const GST_RATE = 0.1;
export const EXTRA_UNITS = [
  ["each", "each"], ["hr", "hr"], ["m3", "m³"], ["t", "t"], ["load", "load"], ["bag", "bag"], ["skip", "skip"],
  ["km", "km"], ["day", "day"], ["lot", "lot"]
];
const UNIT_IDS = EXTRA_UNITS.map(u => u[0]);
export const EXTRA_KINDS = ["rubbish", "concrete", "material", "tip", "travel", "misc", "custom"];
// Amount items: the crew sees the amount (never the price) on the job and run sheet.
export const AMOUNT_KINDS = ["rubbish", "concrete", "material", "tip"];
// Units offered per kind (everything else gets the full list).
export const KIND_UNITS = {
  rubbish: ["m3", "t", "load", "bag", "skip"],
  concrete: ["m3", "t", "load"],
  material: ["m3", "t", "load"]
};
export const WASTE_TYPES = ["General waste", "Green waste", "Concrete / bricks", "Soil / spoil", "Timber", "Mixed"];
export const MATERIAL_TYPES = ["Road base", "Topsoil", "Crusher dust", "Gravel", "Sand", "Turf underlay", "Mulch"];
// The optional type field: material name for deliveries, waste type for rubbish.
const TYPE_FIELD_KINDS = ["material", "rubbish"];
export const EXTRA_PRESETS = [
  { id: "rubbish", label: "Rubbish removal", description: "Rubbish removal", unit: "m3", rateKey: "tipPerLoad", material: true },
  { id: "concrete", label: "Concrete removal", description: "Concrete removal", unit: "m3" },
  { id: "material", label: "Bring material to site", description: "Supply and deliver material", unit: "m3", rateKey: "materialPerUnit", material: true },
  { id: "tip", label: "Tip fees", description: "Tip fees", unit: "t" },
  { id: "travel", label: "Travel", description: "Travel", unit: "km", rateKey: "travelPerKm" },
  { id: "misc", label: "Misc", description: "Miscellaneous", unit: "each" }
];
export const MAX_EXTRA_ITEMS = 40;
export const MAX_SAVED_PRESETS = 20;
// Guided line keys an admin may override (price = the line amount ex GST).
const OVERRIDE_KEY = /^(travel|time|materials|rubbish|labourer|machine:[a-z]{1,20})$/;

export function unitLabel(u) {
  return (EXTRA_UNITS.find(x => x[0] === u) || [u, u || "each"])[1];
}
function cleanStr(v, max) { return String(v == null ? "" : v).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max); }
// Caps keep totals exact in cents (a 1e12 qty × $1e6 printed a $1e18 total with the cents lost).
export const MAX_ITEM_QTY = 100000;
export const MAX_ITEM_PRICE = 1000000;
function cleanQty(v) {
  if (v === "" || v == null || !Number.isFinite(+v)) return 0;
  return Math.min(MAX_ITEM_QTY, Math.max(0, Math.round(+v * 1000) / 1000));
}
function cleanPrice(v) {
  const n = numOrNull(v);
  return n == null || !Number.isFinite(n) ? null : Math.min(MAX_ITEM_PRICE, Math.max(0, Math.round(n * 100) / 100));
}
let quoteTrade = null;
let quoteFocus = "";
export function setQuoteTradeSetup(setup) {
  quoteTrade = setup || null;
  const enabled = (quoteTrade && quoteTrade.enabled) || [];
  if (quoteFocus && !enabled.includes(quoteFocus)) quoteFocus = "";
}
export function quoteTradeSetup() { return quoteTrade; }
export function setQuoteFocus(id) { quoteFocus = String(id || ""); }
export function activeQuoteTradeId() {
  const enabled = (quoteTrade && quoteTrade.enabled) || [];
  const ready = id => {
    const row = quotePack(id);
    return !!(row && row.ready);
  };
  if (quoteFocus && enabled.includes(quoteFocus) && ready(quoteFocus)) return quoteFocus;
  const firstReady = enabled.find(ready);
  if (firstReady) return firstReady;
  return enabled[0] || "earthworks";
}

function tradeReady(id) {
  const row = quotePack(id);
  return !!(row && row.ready);
}

/** Trade of a job's category, when that trade is on the company. */
export function quoteTradeForJob(job, setup) {
  if (!job || typeof job !== "object") return "";
  const enabled = setup && Array.isArray(setup.enabled) ? setup.enabled : [];
  const ids = Array.isArray(job.types) && job.types.length ? job.types : [job.type];
  for (const id of ids) {
    const info = typeInfo(id);
    if (!info) continue;
    if (!enabled.length || enabled.includes(info.packId)) return info.packId;
  }
  return "";
}

/**
 * New quotes start on the job's trade, otherwise the company's primary trade.
 * No category is selected here.
 */
export function startingQuoteTrade(setup, job) {
  const fromJob = quoteTradeForJob(job, setup);
  if (fromJob && tradeReady(fromJob)) return fromJob;
  const enabled = setup && Array.isArray(setup.enabled) && setup.enabled.length ? setup.enabled : ["earthworks"];
  if (tradeReady(enabled[0])) return enabled[0];
  return enabled.find(tradeReady) || enabled[0] || "";
}

export function quoteTradeIdOf(quote) {
  const q = quote && typeof quote === "object" ? quote : {};
  if (q.packId && q.packId !== "multi") return q.packId;
  const first = Array.isArray(q.sections) ? q.sections.find(s => s && s.packId) : null;
  if (first) return first.packId;
  const info = typeInfo(q.type);
  return (info && info.packId) || "";
}

/** List cell when a draft has no total. Explains the next step and links to that trade's rates. */
export function ratesNeededHtml(quote, esc) {
  const e = typeof esc === "function" ? esc : (s => String(s ?? ""));
  const trade = quoteTradeIdOf(quote);
  const label = tradeLabel(trade) || "this trade";
  return `<span class="unal">Rates needed.</span> <span class="sub">Enter the ${e(label)} prices under Quote rates. Nothing is filled in for you.</span> <button type="button" class="sm-btn" data-rates-trade="${e(trade)}">Open ${e(label)} quote rates</button>`;
}

let xSeq = 0;
function newItemId() {
  xSeq = (xSeq + 1) % 1000;
  return "x" + Date.now().toString(36) + xSeq.toString(36) + Math.random().toString(36).slice(2, 5);
}

export function unitsForKind(kind) { return KIND_UNITS[kind] || UNIT_IDS; }
function unitFor(kind, u) {
  const allowed = unitsForKind(kind);
  return allowed.includes(u) ? u : (allowed.includes("each") ? "each" : allowed[0]);
}
/** One saved/editable extra item, cleaned. Unknown fields are dropped. */
export function sanitizeExtraItem(it) {
  const x = it && typeof it === "object" ? it : {};
  const kind = EXTRA_KINDS.includes(x.kind) ? x.kind : "custom";
  const out = {
    id: cleanStr(x.id, 40).replace(/[^A-Za-z0-9_-]/g, "") || newItemId(),
    kind,
    description: cleanStr(x.description, 200),
    qty: cleanQty(x.qty),
    unit: unitFor(kind, x.unit),
    unitPrice: cleanPrice(x.unitPrice),
    note: cleanStr(x.note, 300),
    lineType: normalizeLineType(x.lineType, kind)
  };
  if (TYPE_FIELD_KINDS.includes(kind)) out.material = cleanStr(x.material, 80);
  return out;
}
export function sanitizeExtraItems(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const it of list.slice(0, MAX_EXTRA_ITEMS)) {
    const c = sanitizeExtraItem(it);
    if (seen.has(c.id)) c.id = newItemId();
    seen.add(c.id);
    out.push(c);
  }
  return out;
}
/** Admin price overrides on guided lines: { lineKey: amount ex GST }. Blank / invalid entries are dropped. */
export function sanitizeOverrides(map) {
  const out = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const [k, v] of Object.entries(map).slice(0, 20)) {
    if (!OVERRIDE_KEY.test(k)) continue;
    const n = cleanPrice(v);
    if (n != null) out[k] = n;
  }
  return out;
}
/** Company presets saved on the quote-rates doc (extraPresets). */
export function sanitizeSavedPresets(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_SAVED_PRESETS).map(p => {
    const x = p && typeof p === "object" ? p : {};
    const kind = EXTRA_KINDS.includes(x.kind) ? x.kind : "custom";
    const out = {
      id: cleanStr(x.id, 40).replace(/[^A-Za-z0-9_-]/g, "") || newItemId(),
      kind,
      label: cleanStr(x.label || x.description, 60),
      description: cleanStr(x.description || x.label, 200),
      unit: unitFor(kind, x.unit),
      unitPrice: cleanPrice(x.unitPrice)
    };
    if (TYPE_FIELD_KINDS.includes(kind)) out.material = cleanStr(x.material, 80);
    return out;
  }).filter(p => p.label);
}

/** A new extra item from a built-in preset id, a saved company preset object, or blank ("custom"). */
export function newExtraItem(preset, rates) {
  const r = rates || {};
  if (preset && typeof preset === "object") {
    return sanitizeExtraItem({ ...preset, id: newItemId(), qty: 1, note: "" });
  }
  const p = EXTRA_PRESETS.find(x => x.id === preset);
  if (!p) return sanitizeExtraItem({ kind: "custom", description: "", qty: 1, unit: "each", unitPrice: null });
  const rate = p.rateKey && r[p.rateKey] != null ? r[p.rateKey] : null;
  // Rubbish is priced per load in the rate card, so a rate-card price starts the item in loads.
  const unit = p.id === "rubbish" && rate != null ? "load" : p.unit;
  return sanitizeExtraItem({
    kind: p.id, description: p.description, qty: 1, unit, unitPrice: rate,
    ...(p.material ? { material: "" } : {})
  });
}

export function extraItemLabel(it) {
  const desc = it.description || (EXTRA_PRESETS.find(p => p.id === it.kind)?.label) || "Extra item";
  const mat = TYPE_FIELD_KINDS.includes(it.kind) && it.material ? ` — ${it.material}` : "";
  return `${desc}${mat} (${it.qty} ${unitLabel(it.unit)})`;
}

/** Move item at index i by delta (-1 up, +1 down). Returns a new array. */
export function moveExtraItem(list, i, delta) {
  const arr = (list || []).slice();
  const j = i + delta;
  if (i < 0 || i >= arr.length || j < 0 || j >= arr.length) return arr;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return arr;
}
export function removeExtraItem(list, i) {
  return (list || []).filter((_, k) => k !== i);
}

const r2 = v => Math.round(v * 100) / 100;

/**
 * Price-free amounts for the crew (job card, run sheet): "Rubbish removal — Green waste: 6 m³ (note)".
 * Covers extra items with a quantity and the guided materials / rubbish quantities. Never includes dollars.
 */
// Crew-visible text built from a quote: drop anything that looks like a price ("$450", "$ 1,200.50", "A$90").
export function noDollars(text) {
  return String(text == null ? "" : text).replace(/(?:A|AU)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:ex|inc|incl)\.?\s?GST)?/gi, "[price removed]").replace(/\$/g, "");
}
export function workAmounts(q) {
  const out = [];
  const r = q.ratesSnapshot || {};
  if (+q.materialQty > 0) out.push(`Materials: ${+q.materialQty} ${r.materialUnitLabel || "unit"}`);
  if (+q.tipLoads > 0) out.push(`Rubbish removed: ${+q.tipLoads} ${r.tipUnitLabel || "load"}`);
  for (const it of sanitizeExtraItems(q.extraItems)) {
    if (!(it.qty > 0)) continue;
    const desc = it.description || EXTRA_PRESETS.find(p => p.id === it.kind)?.label || "Extra item";
    const type = TYPE_FIELD_KINDS.includes(it.kind) && it.material ? ` — ${it.material}` : "";
    const note = it.note ? ` (${it.note})` : "";
    out.push(noDollars(`${desc}${type}: ${it.qty} ${unitLabel(it.unit)}${note}`).slice(0, 200));
  }
  return out.slice(0, 20);
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";
const geoCache = new Map();

let api = null;

export function installQuotes(a) {
  api = a;
  return {
    calcQuote, isTruckOnly, machineSelectionError, DEFAULT_RATE_KEYS, DEFAULT_DEPOT, FLEET_MACHINES, EQUIPMENT_PRESETS,
    resolvePresetId, machineSelectionFromPreset, quoteLines, roadDistanceKm,
    bindAdmin: bindAdminExtras,
    openQuoteWizard, openRatesEditor, refreshQuotes, ensureRates,
    adminViewRouter, quotesViewHtml,
    EXTRA_PRESETS, EXTRA_UNITS, newExtraItem, sanitizeExtraItems, sanitizeOverrides, customerQuoteHtml
  };
}

// Quote rates live per company. Heartwood keeps meta/quoteRates exactly as before; every other company has
// companyMeta/{companyId}_quoteRates, which starts empty (no rates invented) until its admin fills it in.
export function quoteRatesPath(companyId) {
  const id = String(companyId || "heartwood");
  return id === "heartwood" ? ["meta", "quoteRates"] : ["companyMeta", id + "_quoteRates"];
}
function ratesCompany() {
  return (api && typeof api.getCompanyId === "function" && api.getCompanyId()) || "heartwood";
}

function emptyMachineRates() {
  const out = {};
  for (const m of FLEET_MACHINES) {
    out[m.id] = { rate: null, unit: "hour" }; // hour | day — blank $ until admin fills
  }
  return out;
}

function emptyRates() {
  return {
    travelPerKm: null, materialPerUnit: null, tipPerLoad: null,
    // Legacy key kept null and unused when plant is selected (avoids operator double-charge).
    hourlyOnSite: null,
    materialUnitLabel: "unit", tipUnitLabel: "load",
    yardAddress: DEFAULT_DEPOT.yardAddress,
    yardMapsUrl: DEFAULT_DEPOT.yardMapsUrl,
    machineRates: emptyMachineRates(),
    labourerRate: null,
    labourerUnit: "hour",
    extraPresets: [],
    packRates: {},
    tradeRates: {},
    updatedAt: null
  };
}

function numOrNull(v) {
  if (v === "" || v == null || Number.isNaN(+v)) return null;
  return Math.round(+v * 100) / 100;
}

function canEditRates() {
  return typeof api.canEditQuoteRates === "function" ? !!api.canEditQuoteRates() : !!(api.isAdmin && api.isAdmin());
}

function normalizeMachineIds(ids) {
  const allowed = new Set(FLEET_MACHINES.map(m => m.id));
  const uniq = [];
  for (const id of ids || []) {
    if (allowed.has(id) && !uniq.includes(id)) uniq.push(id);
  }
  // Stable order: truck, skid, excavator
  const order = FLEET_MACHINES.map(m => m.id);
  return uniq.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Map a selection of machine ids to a known preset id, or null if custom/empty. */
export function resolvePresetId(machineIds) {
  const sel = normalizeMachineIds(machineIds).join(",");
  if (!sel) return null;
  for (const p of EQUIPMENT_PRESETS) {
    if (normalizeMachineIds(p.machines).join(",") === sel) return p.id;
  }
  return null;
}

/** A selection that is just the truck — no longer offered for new quotes. */
export function isTruckOnly(machineIds) {
  return normalizeMachineIds(machineIds).join(",") === "truck";
}

/** Step-2 machine check. Returns an error message or "". Legacy truck-only quotes (legacyTruck) stay allowed. */
export function machineSelectionError(machineIds, { legacyTruck = false } = {}) {
  const ids = normalizeMachineIds(machineIds);
  if (!ids.length) return "Pick an equipment preset (skid steer and/or excavator).";
  if (isTruckOnly(ids) && !legacyTruck) return "The truck comes with a skid steer or excavator. Pick a package with one of them.";
  return "";
}

export function machineSelectionFromPreset(presetId) {
  if (presetId === "truck") return ["truck"]; // legacy preset id on older saved quotes
  const p = EQUIPMENT_PRESETS.find(x => x.id === presetId);
  return p ? normalizeMachineIds(p.machines) : [];
}

function fleetName(id) {
  return FLEET_MACHINES.find(m => m.id === id)?.name || id;
}

function machineRateOf(rates, id) {
  const mr = (rates && rates.machineRates && rates.machineRates[id]) || {};
  return {
    rate: mr.rate != null ? +mr.rate : null,
    unit: mr.unit === "day" ? "day" : "hour"
  };
}

/**
 * Quote math.
 * - Travel / materials / tip as before.
 * - Each selected machine once (no double truck): rate includes operator.
 * - Hourly machine → × hoursOnSite; day machine → × machineDays (default 1) — never × hours.
 * - Optional labourer add-on (separate rate); same unit rule.
 * - Generic hourlyOnSite is NOT added when any machine is selected (operator is in the plant rate).
 * - If any used line is missing a rate, totalEx is null.
 */
export function calcQuote(inputs, rates) {
  const travelKm = Math.max(0, +inputs.travelKm || 0);
  const hours = Math.max(0, +inputs.hoursOnSite || 0);
  const machineDays = Math.max(0, +inputs.machineDays || 0) || (inputs.machineDays === 0 ? 0 : 1);
  const matQty = Math.max(0, +inputs.materialQty || 0);
  const tipLoads = Math.max(0, +inputs.tipLoads || 0);
  const machines = normalizeMachineIds(inputs.machines || inputs.machineIds || []);
  const includeLabourer = !!(inputs.includeLabourer || inputs.labourer);
  const r = rates || {};

  const lines = [
    { key: "travel", label: `Travel ${travelKm} km`, qty: travelKm, rate: r.travelPerKm,
      amount: r.travelPerKm != null ? travelKm * r.travelPerKm : null }
  ];

  // Plant + operator packages (each machine once)
  for (const mid of machines) {
    const { rate, unit } = machineRateOf(r, mid);
    const qty = unit === "day" ? machineDays : hours;
    const unitLab = unit === "day" ? "day" : "h";
    lines.push({
      key: "machine:" + mid,
      machineId: mid,
      label: `${fleetName(mid)} + operator (${qty} ${unitLab})`,
      qty, rate, unit,
      amount: rate != null ? qty * rate : null
    });
  }

  // Optional labourer — never folded into plant rate
  if (includeLabourer) {
    const unit = r.labourerUnit === "day" ? "day" : "hour";
    const qty = unit === "day" ? machineDays : hours;
    const unitLab = unit === "day" ? "day" : "h";
    const rate = r.labourerRate != null ? +r.labourerRate : null;
    lines.push({
      key: "labourer",
      label: `Labourer (${qty} ${unitLab})`,
      qty, rate, unit,
      amount: rate != null ? qty * rate : null
    });
  }

  // Legacy crew-only time: only when NO plant selected (avoids operator double-charge).
  if (!machines.length && !includeLabourer) {
    const rate = r.hourlyOnSite != null ? +r.hourlyOnSite : null;
    lines.push({
      key: "time",
      label: `Time on site ${hours} h`,
      qty: hours, rate,
      amount: rate != null ? hours * rate : null
    });
  }

  lines.push(
    { key: "materials", label: `Materials (${matQty} ${r.materialUnitLabel || "unit"})`, qty: matQty,
      rate: r.materialPerUnit, amount: r.materialPerUnit != null ? matQty * r.materialPerUnit : null },
    { key: "rubbish", label: `Rubbish removed (${tipLoads} ${r.tipUnitLabel || "load"})`, qty: tipLoads,
      rate: r.tipPerLoad, amount: r.tipPerLoad != null ? tipLoads * r.tipPerLoad : null }
  );

  // Admin price overrides on guided lines (amount ex GST). The original amount is kept so the change is visible.
  const overrides = sanitizeOverrides(inputs.priceOverrides);
  const rounded = lines.map(l => {
    const amount = l.amount == null ? null : r2(l.amount);
    if (overrides[l.key] == null) return { ...l, amount };
    return { ...l, amount: overrides[l.key], originalAmount: amount, overridden: true };
  });

  // Extra line items, in the admin's order, after the guided lines.
  const extraItems = sanitizeExtraItems(inputs.extraItems);
  for (const it of extraItems) {
    rounded.push({
      key: "extra:" + it.id, extraId: it.id, kind: it.kind, extra: true,
      label: extraItemLabel(it), qty: it.qty, unit: it.unit, rate: it.unitPrice,
      note: it.note || "",
      amount: it.unitPrice != null ? r2(it.qty * it.unitPrice) : null
    });
  }

  const missingRates = rounded.filter(l => l.qty > 0 && l.rate == null && !l.overridden).map(l => l.key);
  const known = rounded.filter(l => l.amount != null);
  const totalEx = missingRates.length ? null
    : (known.length ? r2(known.reduce((t, l) => t + l.amount, 0)) : 0);
  const adjustmentEx = r2(rounded.filter(l => l.overridden && l.originalAmount != null)
    .reduce((t, l) => t + (l.amount - l.originalAmount), 0));
  const extrasEx = r2(rounded.filter(l => l.extra && l.amount != null).reduce((t, l) => t + l.amount, 0));
  // GST in whole cents, half a cent rounds up (10.35 ex GST → 1.04, not the 1.03 that float maths gives).
  const gst = totalEx == null ? null : Math.round(Math.round(totalEx * 100) / 10) / 100;
  const totalInc = totalEx == null ? null : r2(totalEx + gst);
  return {
    lines: rounded, totalEx, subtotalEx: totalEx, gst, totalInc, gstRate: GST_RATE,
    adjustmentEx, extrasEx, extraItems, priceOverrides: overrides,
    missingRates, travelKm, hours, machineDays, matQty, tipLoads,
    machines, includeLabourer, presetId: resolvePresetId(machines),
    complete: !missingRates.length
  };
}

function quoteLines(calc) { return calc.lines; }

function mergeMachineRates(stored) {
  const base = emptyMachineRates();
  if (!stored || typeof stored !== "object") return base;
  for (const m of FLEET_MACHINES) {
    const s = stored[m.id];
    if (s && typeof s === "object") {
      base[m.id] = {
        rate: s.rate != null && s.rate !== "" && !Number.isNaN(+s.rate) ? +s.rate : null,
        unit: s.unit === "day" ? "day" : "hour"
      };
    }
  }
  return base;
}

async function ensureRates(force) {
  const ui = api.getUi();
  const cid = ratesCompany();
  if (ui.quoteRates && ui.quoteRatesFor === cid && !force) return ui.quoteRates;
  ui.quoteRatesFor = cid;
  try {
    const s = await api.getDoc(api.doc(api.db, ...quoteRatesPath(cid)));
    ui.quoteRates = s.exists() ? { ...emptyRates(), ...s.data() } : emptyRates();
    ui.quoteRates.machineRates = mergeMachineRates(ui.quoteRates.machineRates);
    if (!ui.quoteRates.yardAddress) ui.quoteRates.yardAddress = DEFAULT_DEPOT.yardAddress;
    if (!ui.quoteRates.yardMapsUrl) ui.quoteRates.yardMapsUrl = DEFAULT_DEPOT.yardMapsUrl;
    if (ui.quoteRates.labourerUnit !== "day") ui.quoteRates.labourerUnit = "hour";
    ui.quoteRates.extraPresets = sanitizeSavedPresets(ui.quoteRates.extraPresets);
    ui.quoteRates.tradeRates = sanitizeTradeRates(ui.quoteRates.tradeRates);
    if (!ui.quoteRates.packRates || typeof ui.quoteRates.packRates !== "object") ui.quoteRates.packRates = {};
  } catch {
    ui.quoteRates = emptyRates();
  }
  return ui.quoteRates;
}

async function refreshQuotes() {
  const { getDocs, collection, query, where, db, getUi } = api;
  try {
    const companyId = orgSettings().companyId || "heartwood";
    const s = await getDocs(query(collection(db, "quotes"), where("companyId", "==", companyId)));
    getUi().quotes = s.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("quotes", e.code || e.message);
    getUi().quotes = getUi().quotes || [];
  }
}

async function geocodeAu(address) {
  const key = String(address || "").trim().toLowerCase();
  if (!key) return null;
  if (geoCache.has(key)) return geoCache.get(key);
  try {
    const cached = JSON.parse(localStorage.getItem("hwQuoteGeo:" + key) || "null");
    if (cached?.lat != null) { geoCache.set(key, cached); return cached; }
  } catch {}
  const ui = api.getUi();
  const wait = Math.max(0, 1100 - (Date.now() - (ui._nomAt || 0)));
  if (wait) await new Promise(r => setTimeout(r, wait));
  ui._nomAt = Date.now();
  const url = `${NOMINATIM}?format=json&limit=1&countrycodes=au&q=${encodeURIComponent(address + ", Queensland, Australia")}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": `${PRODUCT_NAME}-Quotes/1.0 (alex@heartwoodew.com)` } });
    if (!res.ok) return null;
    const arr = await res.json();
    const hit = arr[0] ? { lat: +arr[0].lat, lng: +arr[0].lon } : null;
    geoCache.set(key, hit);
    try { if (hit) localStorage.setItem("hwQuoteGeo:" + key, JSON.stringify(hit)); } catch {}
    return hit;
  } catch { return null; }
}

/** One-way road distance in km via OSRM, or null if routing unavailable. Never uses straight-line. */
export async function roadDistanceKm(fromAddress, toAddress, toCoords) {
  const a = await geocodeAu(fromAddress);
  // A Google-picked site already has exact coordinates, so it skips the Nominatim lookup.
  const picked = sanitizePlace(toCoords);
  const b = picked ? { lat: picked.lat, lng: picked.lng } : await geocodeAu(toAddress);
  if (!a || !b) return { km: null, error: "Could not geocode depot or site (Nominatim)." };
  const url = `${OSRM}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { km: null, error: "Road router unavailable (OSRM)." };
    const data = await res.json();
    const metres = data?.routes?.[0]?.distance;
    if (metres == null) return { km: null, error: "No road route found." };
    return { km: Math.round((metres / 1000) * 10) / 10, error: null, source: "OSRM road" };
  } catch {
    return { km: null, error: "Road router request failed." };
  }
}

export function quotesViewHtml(ui, esc, $$, helpers = {}) {
  const rates = ui.quoteRates || emptyRates();
  const list = (ui.quotes || []).slice().sort((a, b) => String(b.updatedAtIso || "").localeCompare(String(a.updatedAtIso || "")));
  const drafts = list.filter(q => q.quoteStatus === "Draft");
  const accepted = list.filter(q => q.quoteStatus === "Accepted").slice(0, 30);
  const enabledNow = quoteTrade && Array.isArray(quoteTrade.enabled) && quoteTrade.enabled.length ? quoteTrade.enabled : null;
  const earthworksOn = !enabledNow || enabledNow.includes("earthworks");
  const plantMissing = earthworksOn && FLEET_MACHINES.some(m => (rates.machineRates?.[m.id]?.rate) == null);
  const rateWarn = earthworksOn && (DEFAULT_RATE_KEYS.some(([k]) => rates[k] == null) || plantMissing || rates.labourerRate == null);
  const editRates = helpers.canEditQuoteRates != null ? helpers.canEditQuoteRates() : canEditRates();
  const money = v => (v != null && $$) ? `${esc($$(v))} <span class="sub">ex GST</span>` : `<span class="unal">incomplete</span>`;
  const viewing = activePack();
  const measuredView = !!(viewing && viewing.wizard === "measure");
  const mach = q => {
    if (Array.isArray(q.sections) && q.sections.length > 1) {
      return `<div class="sub">${esc(q.sections.map(s => s.label || s.type).filter(Boolean).join(" · "))}</div>`;
    }
    if (q.packId && q.packId !== "earthworks") return `<div class="sub">${esc(tradeLabel(q.packId) || q.packId)}</div>`;
    const ids = normalizeMachineIds(q.machines || []);
    if (!ids.length) return "";
    const lab = EQUIPMENT_PRESETS.find(p => p.id === q.presetId)?.label
      || ids.map(fleetName).join(" + ");
    return `<div class="sub">${esc(lab)}${q.includeLabourer ? " + labourer" : ""}</div>`;
  };
  const row = q => `<tr class="jr" data-qid="${esc(q.id)}"><td><span class="qpill ${q.quoteStatus === "Draft" ? "q-quote" : "q-wo"}">${esc(q.quoteStatus)}</span>${q.revisionCount ? `<div class="sub">Rev ${esc(q.revisionCount)}${q.acceptedRevision ? ` · accepted ${esc(q.acceptedRevision)}` : ""}</div>` : ""}</td>
    <td><b>${esc(q.client || "")}</b><div class="sub">${esc(q.address || "")}</div>${mach(q)}</td>
    <td>${esc(q.description || q.type || "")}</td>
    <td>${q.totalEx != null ? money(q.totalEx) : ratesNeededHtml(q, esc)}</td>
    <td>${q.quoteStatus === "Draft" ? `<button type="button" class="sm-btn primary qaccept" data-qaccept="${esc(q.id)}">Quote accepted</button>` : `<span class="sub">Job ${esc(q.jobId || "—")}</span>`}</td></tr>`;
  return `<div class="sm-head"><h1>Quotes</h1>
    <div class="row gap"><button type="button" class="sm-btn primary" id="newquote">＋ New quote</button>
    ${editRates ? `<button type="button" class="sm-btn" id="editrates">Quote rates &amp; depot</button>` : `<span class="sub pad">Rates are set by an admin or a manager · depot ${esc(rates.yardAddress || DEFAULT_DEPOT.yardAddress)}</span>`}</div></div>
    <p class="pad sub">${measuredView || !earthworksOn
      ? `Three steps: categories, measurements for each section, then review. One quote can cover several categories. Prices are starting-point defaults to review (A$ ex GST). Accepting creates an unscheduled job, or one job per section. Allocated hours are the sum of the sections and do not change timesheets. Admins, managers and supervisors only. Quotes are for ${esc(orgSettings().legalName)}. ${esc(POWERED_BY)}.`
      : `Three steps: categories, plant for each section, then review. One quote can cover several categories and trades. Accepting creates an unscheduled job, or one job per section. Admins, managers and supervisors only. Prices stay ex GST and are never invented. Quotes are for ${esc(orgSettings().legalName)}. ${esc(POWERED_BY)}.`}</p>
    ${quotePackNote(quoteTrade)}
    ${quoteTrade ? tradeToolsHtml(quoteTrade, { canEdit: editRates, focus: activeQuoteTradeId() }) : ""}
    <p class="pad sub">Depot (travel start): <b>${esc(rates.yardAddress || DEFAULT_DEPOT.yardAddress || "not set")}</b>
      · <a href="${esc(rates.yardMapsUrl || DEFAULT_DEPOT.yardMapsUrl)}" target="_blank" rel="noopener">Maps</a></p>
    ${measuredView || !earthworksOn
      ? `<p class="pad warnt">Prices in this pack are starting-point defaults to review (A$ ex GST). Change a price on the quote, or save it as your company default.</p>`
      : (rateWarn ? `<p class="pad warnt">Set plant (incl. operator), labourer, travel, materials and tip rates before accepting — nothing is invented for you.</p>` : "")}
    <div class="sm-head"><h2>Drafts <span class="cnt">${drafts.length}</span></h2></div>
    <div class="tablewrap"><table class="jobs qlist"><thead><tr><th>Status</th><th>Client / site</th><th>Scope</th><th>Total</th><th></th></tr></thead>
    <tbody>${drafts.map(row).join("") || `<tr><td colspan="5" class="muted pad">No draft quotes yet.</td></tr>`}</tbody></table></div>
    <div class="sm-head"><h2>Recently accepted</h2></div>
    <div class="tablewrap"><table class="jobs qlist"><thead><tr><th>Status</th><th>Client / site</th><th>Scope</th><th>Total</th><th></th></tr></thead>
    <tbody>${accepted.map(row).join("") || `<tr><td colspan="5" class="muted pad">None yet.</td></tr>`}</tbody></table></div>`;
}

function bindAdminExtras(ctx) {
  const { ui, A } = ctx;
  if (ui.view !== "quotes") return;
  ensureRates(false);
  A.querySelector("#newquote")?.addEventListener("click", () => openQuoteWizard(null));
  A.querySelector("#editrates")?.addEventListener("click", () => openRatesEditor());
  A.querySelectorAll("[data-rates-trade]").forEach(b => b.addEventListener("click", ev => {
    ev.stopPropagation();
    openRatesEditor(b.dataset.ratesTrade);
  }));
  A.querySelector("#quotetrade")?.addEventListener("change", ev => {
    setQuoteFocus(ev.target.value);
    if (typeof api.renderAdmin === "function") api.renderAdmin();
  });
  A.querySelector("#tradeadd")?.addEventListener("submit", async ev => {
    ev.preventDefault();
    const id = ev.target.trade && ev.target.trade.value;
    if (!id || typeof api.saveExtraTrade !== "function") return;
    try { await api.saveExtraTrade(id); }
    catch (e) { api.toast("Couldn't add that trade (" + ((e && e.code) || "error") + ")."); }
  });
  A.querySelectorAll("[data-qid]").forEach(b => b.onclick = () => {
    const q = (ui.quotes || []).find(x => x.id === b.dataset.qid);
    if (q) openQuoteWizard(q);
  });
  A.querySelectorAll("[data-qaccept]").forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const q = (ui.quotes || []).find(x => x.id === b.dataset.qaccept);
    if (q) openQuoteWizard(q, { jumpToPrice: true });
  });
}

function rateTrades(setup) {
  const listed = sanitizeTradeList(setup && setup.enabled);
  return listed.length ? listed : ["earthworks"];
}

/** Settings card under Company. Earthworks-only keeps the plant sentence. Other trades do not mention the fleet. */
export function quoteRatesSettingsBlurb(trades) {
  const ids = sanitizeTradeList(trades);
  const earth = !ids.length || ids.includes("earthworks");
  if (earth && ids.length <= 1) return "Your plant, labour, travel and tip rates for quotes. They start blank and are only used by your company.";
  if (earth) return "Rates for each trade this company does, plus travel and the depot. Earthworks keeps the plant and labourer rates. They are only used by your company.";
  return "Rates for each trade this company does, plus travel and the depot. A blank rate keeps that line's starting-point default. They are only used by your company.";
}

function quoteRatesEditorIntro(trades) {
  if (trades.includes("earthworks") && trades.length === 1) {
    return "Saved for your company only. Dollar rates are ex GST — leave blank until you know them (nothing invented). Plant rates include the operator. Labourer is a separate optional add-on. Depot is travel start.";
  }
  if (trades.includes("earthworks")) {
    return "Saved for your company only. Dollar rates are ex GST. Earthworks plant rates include the operator. Other trades use their own lines: leave a line blank to keep its starting-point default. Travel and the depot are shared.";
  }
  return "Saved for your company only. Dollar rates are ex GST. Each line starts from the pack default shown in the box; leave it blank to keep that default. Travel and the depot are shared. Turning a trade off hides its rates and does not delete them.";
}

function earthworksRatesSectionHtml(rates, esc) {
  const mr = mergeMachineRates(rates.machineRates);
  const plantFields = FLEET_MACHINES.map(m => {
    const cur = mr[m.id];
    return `<fieldset class="qw-machrate"><legend>${esc(m.name)}${m.code ? ` (${esc(m.code)})` : ""} — includes operator</legend>
        <label>$ / ${cur.unit === "day" ? "day" : "hour"} (ex GST)<input name="mr_${m.id}" type="number" step="0.01" min="0" value="${esc(cur.rate ?? "")}"></label>
        <label>Unit<select name="mu_${m.id}"><option value="hour" ${cur.unit !== "day" ? "selected" : ""}>Per hour</option><option value="day" ${cur.unit === "day" ? "selected" : ""}>Per day</option></select></label>
      </fieldset>`;
  }).join("");
  const materialKeys = DEFAULT_RATE_KEYS.filter(([k]) => k !== "travelPerKm");
  return `<section data-rates-trade="earthworks"><h3>Earthworks</h3>
      <h4>Plant (operator included)</h4>
      <p class="sub">Presets: Truck + skid · Truck + excavator · Truck + skid + excavator · Excavator only. Selecting a combo charges each machine once (no double truck). The truck rate is used inside the truck packages.</p>
      ${plantFields}
      <h4>Labourer (optional add-on)</h4>
      <label>Labourer $ (ex GST)<input name="labourerRate" type="number" step="0.01" min="0" value="${esc(rates.labourerRate ?? "")}"></label>
      <label>Labourer unit<select name="labourerUnit"><option value="hour" ${rates.labourerUnit !== "day" ? "selected" : ""}>Per hour</option><option value="day" ${rates.labourerUnit === "day" ? "selected" : ""}>Per day</option></select></label>
      <h4>Materials and tip</h4>
      <p class="sub">These are the earthworks materials and rubbish lines. Other trades price materials on their own pack lines.</p>
      ${materialKeys.map(([k, lab]) => `<label>${esc(lab)}<input name="${k}" type="number" step="0.01" min="0" value="${esc(rates[k] ?? "")}"></label>`).join("")}
      <label>Materials unit label<input name="materialUnitLabel" value="${esc(rates.materialUnitLabel || "unit")}"></label>
      <label>Rubbish unit label<input name="tipUnitLabel" value="${esc(rates.tipUnitLabel || "load")}"></label>
    </section>`;
}

function measuredRatesSectionHtml(id, rates, esc) {
  const pack = quotePack(id);
  if (!pack || !pack.data) return "";
  const rows = packRateInputs(pack.data).map(row => {
    const saved = savedTradeRate(rates, id, row.lineId, row.variant, row.calcKey);
    const unit = prettyUnit(row.unit);
    return `<label>${esc(row.label)} <span class="sub">$ / ${esc(unit)} ex GST</span><input name="${esc(row.name)}" data-rate-key="${esc(row.calcKey)}" type="number" step="0.01" min="0" inputmode="decimal" placeholder="${esc(row.defaultRate ?? "")}" value="${esc(saved ?? "")}"></label>`;
  }).join("");
  const label = pack.label || tradeLabel(id);
  return `<section data-rates-trade="${esc(id)}"><h3>${esc(label)}</h3>
      <p class="sub">Ex GST. The number in the box is the starting point. Leave a line blank to keep that default.</p>
      ${rows}</section>`;
}

function sharedRatesSectionHtml(rates, esc) {
  const travel = DEFAULT_RATE_KEYS.find(([k]) => k === "travelPerKm");
  return `<section data-rates-shared="travel"><h3>Travel and depot</h3>
      <p class="sub">Shared by every trade. Travel is the per-kilometre rate. The depot is where travel starts.</p>
      <label>${esc(travel[1])}<input name="travelPerKm" type="number" step="0.01" min="0" value="${esc(rates.travelPerKm ?? "")}"></label>
      ${savedPresetsEditorHtml(rates.extraPresets, esc)}
      <h4>Depot</h4>
      <label>Depot / yard address<input name="yardAddress" value="${esc(rates.yardAddress || DEFAULT_DEPOT.yardAddress)}"></label>
      <label>Depot Maps link (optional)<input name="yardMapsUrl" value="${esc(rates.yardMapsUrl || DEFAULT_DEPOT.yardMapsUrl)}"></label>
    </section>`;
}

/** Rates dialog body, one section per selected trade, then the shared travel and depot block. */
export function ratesEditorHtml(rates, setup, escFn) {
  const esc = escFn || (s => String(s ?? ""));
  const stored = rates || {};
  const trades = rateTrades(setup);
  const sections = trades.map(id => id === "earthworks" ? earthworksRatesSectionHtml(stored, esc) : measuredRatesSectionHtml(id, stored, esc)).filter(Boolean).join("");
  return `<h2>Quote rates &amp; depot</h2>
      <p class="sub">${esc(quoteRatesEditorIntro(trades))}</p>
      ${sections}
      ${sharedRatesSectionHtml(stored, esc)}`;
}

/**
 * Fields to merge onto the quote-rates doc, plus a full replacement map for each selected
 * measured trade. Trades that are not selected are absent on purpose: the save must not
 * delete their stored rates. Earthworks plant stays on machineRates / labourerRate.
 */
export function buildQuoteRatesSave(values, previous, setup) {
  const v = values || {};
  const prev = previous || {};
  const trades = rateTrades(setup);
  const earth = trades.includes("earthworks");
  const remove = new Set(Array.isArray(v.removePresetIds) ? v.removePresetIds : []);
  const fields = {
    travelPerKm: numOrNull(v.travelPerKm),
    yardAddress: String(v.yardAddress || "").trim() || DEFAULT_DEPOT.yardAddress,
    yardMapsUrl: String(v.yardMapsUrl || "").trim() || DEFAULT_DEPOT.yardMapsUrl,
    extraPresets: sanitizeSavedPresets((prev.extraPresets || []).filter(p => !remove.has(p.id))),
  };
  if (earth) {
    const machineRates = {};
    for (const m of FLEET_MACHINES) {
      machineRates[m.id] = {
        rate: numOrNull(v["mr_" + m.id]),
        unit: v["mu_" + m.id] === "day" ? "day" : "hour",
      };
    }
    Object.assign(fields, {
      machineRates,
      labourerRate: numOrNull(v.labourerRate),
      labourerUnit: v.labourerUnit === "day" ? "day" : "hour",
      // Clear legacy crew rate from new saves so it cannot double-charge operator.
      hourlyOnSite: null,
      materialPerUnit: numOrNull(v.materialPerUnit),
      tipPerLoad: numOrNull(v.tipPerLoad),
      materialUnitLabel: String(v.materialUnitLabel || "").trim() || "unit",
      tipUnitLabel: String(v.tipUnitLabel || "").trim() || "load",
    });
  }
  const tradeRates = {};
  for (const id of trades) {
    if (id === "earthworks") continue;
    const pack = quotePack(id);
    if (!pack || !pack.data) continue;
    const map = {};
    for (const row of packRateInputs(pack.data)) {
      const n = numOrNull(v[row.name]);
      if (n == null) continue;
      if (row.variant) map[row.lineId] = { ...(map[row.lineId] || {}), [row.variant]: n };
      else map[row.lineId] = n;
    }
    tradeRates[id] = map;
  }
  return { fields, tradeRates, trades };
}

function rememberRates(previous, fields, tradeRates) {
  const next = {
    ...emptyRates(),
    ...previous,
    ...fields,
    machineRates: mergeMachineRates(fields.machineRates || (previous && previous.machineRates)),
    extraPresets: fields.extraPresets || [],
    tradeRates: { ...((previous && previous.tradeRates) || {}) },
    packRates: (previous && previous.packRates) || {},
    updatedAt: new Date().toISOString(),
  };
  for (const [id, map] of Object.entries(tradeRates || {})) next.tradeRates[id] = map;
  return next;
}

function openRatesEditor(focusTrade) {
  if (!canEditRates()) return api.toast("Only an admin or a manager can change quote rates");
  const { $, esc, toast, db, doc, setDoc, updateDoc, serverTimestamp, getUi, renderAdmin, getMe } = api;
  const me = getMe();
  ensureRates(false).then(rates => {
    const d = $("#dlg"); d.className = ""; d.onclose = () => renderAdmin();
    d.innerHTML = `<form method="dialog" id="qrf" class="jf">${ratesEditorHtml(rates, quoteTradeSetup(), esc)}
      <div class="btns"><button value="cancel" formnovalidate class="ghost">Cancel</button><button value="save" class="primary">Save</button></div></form>`;
    d.showModal();
    const focus = String(focusTrade || "").replace(/[^a-z0-9-]/g, "");
    const target = focus && d.querySelector(`[data-rates-trade="${focus}"]`);
    if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
    $("#qrf").onsubmit = async ev => {
      if (ev.submitter?.value !== "save") return;
      ev.preventDefault(); const f = ev.target;
      const values = { removePresetIds: [...f.querySelectorAll("[data-rmpreset]:checked")].map(el => el.dataset.rmpreset) };
      for (const el of f.elements) {
        if (!el.name || el.type === "checkbox" || el.type === "button") continue;
        values[el.name] = el.value;
      }
      const built = buildQuoteRatesSave(values, rates, quoteTradeSetup());
      const cid = ratesCompany();
      const data = { ...built.fields, updatedAt: serverTimestamp(), updatedBy: me.uid };
      try {
        const ref = doc(db, ...quoteRatesPath(cid));
        await setDoc(ref, cid === "heartwood" ? data : { ...data, companyId: cid }, { merge: true });
        // Replace the whole tradeRates map so a cleared line drops, and a trade that is
        // switched off (not in this save) is copied through and kept.
        if (Object.keys(built.tradeRates).length) {
          const nextTrade = { ...(rates.tradeRates || {}) };
          for (const [id, map] of Object.entries(built.tradeRates)) nextTrade[id] = map;
          await updateDoc(ref, { tradeRates: nextTrade });
        }
        getUi().quoteRates = rememberRates(rates, built.fields, built.tradeRates);
        d.close(); toast("Quote rates saved"); renderAdmin();
      } catch (e) { toast("Not saved: " + (e.code || e.message)); }
    };
  });
}

function savedPresetsEditorHtml(list, esc) {
  const items = sanitizeSavedPresets(list);
  return `<h3>Saved extra items</h3>
    <p class="sub">Your company's own quick-add items for quotes. Save one from a quote with “Save as preset”. Tick to remove.</p>
    ${items.length ? items.map(p => `<label class="ck"><input type="checkbox" data-rmpreset="${esc(p.id)}"> Remove <b>${esc(p.label)}</b>
      <span class="sub">${esc(unitLabel(p.unit))}${p.unitPrice != null ? " · $" + esc(p.unitPrice.toFixed(2)) + " ex GST" : " · price blank"}</span></label>`).join("")
      : `<p class="sub muted">None saved yet.</p>`}`;
}

/** Save one quote line as a company preset (admins only; written to the company's quote-rates doc). */
async function saveCompanyPreset(item) {
  if (!canEditRates()) { api.toast("Only an admin can save presets"); return false; }
  const { db, doc, setDoc, serverTimestamp, getMe, getUi } = api;
  const rates = await ensureRates(false);
  const it = sanitizeExtraItem(item);
  const label = (it.description || "Extra item") + (it.kind === "material" && it.material ? " — " + it.material : "");
  const existing = sanitizeSavedPresets(rates.extraPresets);
  if (existing.length >= MAX_SAVED_PRESETS) { api.toast(`Up to ${MAX_SAVED_PRESETS} saved items — remove one in Quote rates first`); return false; }
  const preset = sanitizeSavedPresets([{ kind: it.kind, label, description: it.description, unit: it.unit, unitPrice: it.unitPrice, material: it.material }])[0];
  if (!preset) return false;
  const next = [...existing.filter(p => p.label.toLowerCase() !== preset.label.toLowerCase()), preset];
  const cid = ratesCompany();
  const data = { extraPresets: next, updatedAt: serverTimestamp(), updatedBy: getMe().uid };
  try {
    await setDoc(doc(db, ...quoteRatesPath(cid)), cid === "heartwood" ? data : { ...data, companyId: cid }, { merge: true });
    getUi().quoteRates = { ...rates, extraPresets: next };
    api.toast("Saved “" + preset.label + "” as a preset");
    return true;
  } catch (e) { api.toast("Not saved: " + (e.code || e.message)); return false; }
}

const PACK_CALCS = {
  landscaping: calcLandscaping, concreting: calcConcreting, fencing: calcFencing,
  carpentry: calcCarpentry, tiling: calcTiling, plumbing: calcPlumbing, electrical: calcElectrical,
  "concrete-cutting": calcConcreteCutting,
};

function combinePackExtras(packCalc, data, rates) {
  const extraCalc = calcQuote({
    hoursOnSite: 0, machines: [], includeLabourer: false, travelKm: 0, materialQty: 0, tipLoads: 0,
    extraItems: (data && data.extraItems) || [], priceOverrides: {},
  }, rates || {});
  const extras = (extraCalc.lines || []).filter(l => l.extra);
  if (!packCalc.ok) return packCalc;
  const lines = [...(packCalc.lines || []), ...extras];
  const missing = [
    ...(packCalc.missingRates || []),
    ...extras.filter(l => l.qty > 0 && l.rate == null).map(l => l.key),
  ];
  if (!lines.length || missing.length) {
    return {
      ...packCalc, lines, extraItems: extraCalc.extraItems,
      missingRates: missing.length ? missing : ["quantity"],
      complete: false, totalEx: null, subtotalEx: null, gst: null, totalInc: null,
    };
  }
  const totalEx = roundMoney((packCalc.totalEx || 0) + extras.reduce((t, l) => t + (l.amount || 0), 0));
  const tax = gstFromEx(totalEx);
  return {
    ...packCalc, lines, extraItems: extraCalc.extraItems, missingRates: [], complete: true,
    totalEx, subtotalEx: totalEx, gst: tax.gst, totalInc: tax.totalInc,
  };
}

function measuredCalc(wizard, data, rates) {
  const fn = wizard && PACK_CALCS[wizard.id];
  if (!fn) {
    return { ok: false, reason: "Quote pack is not ready.", lines: [], complete: false, totalEx: null, gst: null, totalInc: null, missingRates: [], adjustmentEx: 0, allocatedHours: 0 };
  }
  const packOnly = fn({
    packageId: data.packageId,
    measures: data.measures,
    quotePrices: data.quotePrices,
    hoursOnSite: data.hoursOnSite,
    includeLabour: data.includeLabour,
  }, companyRatesForTrade(rates, wizard.id));
  return combinePackExtras(packOnly, data, rates);
}

async function savePackDefault(packId, rateKey, price) {
  if (!canEditRates()) { api.toast("Only an admin or a manager can save quote rates"); return false; }
  const { db, doc, setDoc, serverTimestamp, getMe, getUi } = api;
  const current = await ensureRates(false);
  const n = price == null || !Number.isFinite(+price) ? null : Math.round(+price * 100) / 100;
  if (n == null) return false;
  const packRates = { ...(current.packRates || {}) };
  packRates[packId] = { ...(packRates[packId] || {}), [rateKey]: n };
  const hadTrade = current.tradeRates && Object.prototype.hasOwnProperty.call(current.tradeRates, packId);
  const base = hadTrade ? current.tradeRates[packId] : tradeMapFromLegacy(packRates[packId]);
  const { lineId, variant } = splitCalcKey(rateKey);
  const trade = writeTradeRate(base, lineId, variant, n);
  const tradeRates = { ...(current.tradeRates || {}), [packId]: trade };
  const cid = ratesCompany();
  const data = { packRates, tradeRates, updatedAt: serverTimestamp(), updatedBy: getMe().uid };
  try {
    await setDoc(doc(db, ...quoteRatesPath(cid)), cid === "heartwood" ? data : { ...data, companyId: cid }, { merge: true });
    current.packRates = packRates;
    current.tradeRates = tradeRates;
    getUi().quoteRates = { ...current, packRates, tradeRates };
    api.toast("Saved as the company default");
    return true;
  } catch (e) { api.toast("Not saved: " + (e.code || e.message)); return false; }
}

/** Crew-safe fields for a measured quote. Prices stay off the job. Hours are not a timesheet. */
export function measuredJobFields(q) {
  const hours = Math.max(0, +((q && q.allocatedHours) || (q && q.hoursOnSite) || 0));
  const rounded = Math.round(hours * 1000) / 1000;
  const lines = Array.isArray(q && q.lines) ? q.lines : [];
  const work = [];
  for (const l of lines) {
    if (!(l && +l.qty > 0)) continue;
    const title = noDollars(l.name || l.label || "Item").replace(/\s+/g, " ").trim();
    const unit = l.unit === "m2" ? "m²" : l.unit === "m3" ? "m³" : (l.unit || "");
    const row = l.name ? `${title}: ${l.qty} ${unit}` : title;
    work.push(noDollars(row).slice(0, 200));
    if (work.length >= 20) break;
  }
  const quoteLines = lines.filter(l => l && +l.qty > 0).slice(0, 40).map(l => ({
    id: String(l.id || "").slice(0, 40),
    name: noDollars(l.name || l.label || "").slice(0, 200),
    qty: +l.qty,
    unit: String(l.unit || "").slice(0, 12),
    lineType: ["labour", "material", "compliance", "hire", "waste"].includes(l.lineType) ? l.lineType : "labour",
    note: noDollars(l.note || "").slice(0, 300),
  }));
  const description = [tradeLabel(q && q.packId), noDollars((q && q.description) || ""), rounded > 0 ? "Allocated hours: " + rounded : ""]
    .filter(Boolean).join("\n");
  return {
    allocatedHours: rounded > 0 ? rounded : null,
    description,
    workAmounts: work,
    quote: {
      packId: (q && q.packId) || "",
      packageId: (q && q.packageId) || "",
      hoursOnSite: rounded,
      allocatedHours: rounded,
      lines: quoteLines,
    },
  };
}

// One quote, several categories. Each ticked category is a section priced by its own pack.
// A quote saved before this (no `sections`) is one section and prices the same as before.
export const MAX_QUOTE_SECTIONS = 8;
const CATEGORY_PACKAGE = {
  "ls-turf": "soft", "ls-garden": "soft", "ls-maintain": "soft",
  "ls-paving": "hard", "ls-retaining": "hard", "ls-other": "both",
  "cc-floor": "floor", "cc-wall": "wall", "cc-core": "core", "cc-wire": "wire", "cc-hand": "hand",
  "cc-joint": "joint", "cc-crack": "crack", "cc-break": "break", "cc-grind": "grind", "cc-scan": "scan",
};

export function categoryChoices(setup) {
  const ids = setup && Array.isArray(setup.enabled) && setup.enabled.length ? setup.enabled : ["earthworks"];
  const out = [];
  for (const id of ids) {
    const pack = quotePack(id);
    if (!pack || !pack.ready) continue;
    out.push({
      tradeId: pack.id,
      tradeLabel: pack.label,
      categories: pack.jobTypes.map(([type, label]) => ({ type, label, packId: pack.id })),
    });
  }
  return out;
}

function defaultPackageId(pack, type) {
  if (!pack || !pack.data || !pack.data.packages.length) return "";
  const want = CATEGORY_PACKAGE[type];
  if (want && pack.data.packages.some(p => p.id === want)) return want;
  return pack.data.packages[0].id;
}

function freshSectionId(used) {
  for (let n = 1; n < 100; n++) {
    const id = "s" + n;
    if (!used.has(id)) return id;
  }
  return "s" + Date.now().toString(36).slice(-4);
}

/** A blank section for a newly ticked category. */
export function blankSection(type, { id, used } = {}) {
  const info = typeInfo(type);
  const packId = (info && info.packId) || "earthworks";
  const pack = quotePack(packId);
  const section = {
    id: id || freshSectionId(used || new Set()),
    type: (info && info.type) || String(type || "other"),
    packId,
    label: (info && info.label) || String(type || "Section"),
    workDay: 1,
    hoursOnSite: "",
    extraItems: [],
    priceOverrides: {},
  };
  if (pack && pack.wizard === "measure" && pack.data) {
    section.packageId = defaultPackageId(pack, section.type);
    section.measures = defaultMeasures(pack.data);
    section.quotePrices = {};
    section.includeLabour = false;
  } else {
    section.machines = [];
    section.presetId = null;
    section.includeLabourer = false;
    section.machineDays = "1";
    section.travelKm = "";
    section.materialQty = "";
    section.tipLoads = "";
    section.travelMode = "oneway";
    section.travelNote = "";
  }
  return section;
}

function hydrateSection(raw, used) {
  const src = raw && typeof raw === "object" ? raw : {};
  const info = typeInfo(src.type);
  const packId = (src.packId && quotePack(src.packId) && src.packId) || (info && info.packId) || "earthworks";
  const pack = quotePack(packId);
  let id = String(src.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 12);
  if (!id || used.has(id)) id = freshSectionId(used);
  used.add(id);
  const section = {
    id,
    type: (info && info.type) || String(src.type || (pack && pack.jobTypes[0] && pack.jobTypes[0][0]) || "other"),
    packId,
    label: cleanStr(src.label, 80) || (info && info.label) || String(src.type || "Section"),
    workDay: Math.max(1, Math.min(31, Math.round(+src.workDay || 1))),
    hoursOnSite: src.hoursOnSite ?? "",
    extraItems: sanitizeExtraItems(src.extraItems),
    priceOverrides: sanitizeOverrides(src.priceOverrides),
    legacy: src.legacy === true,
  };
  if (pack && pack.wizard === "measure" && pack.data) {
    section.packageId = src.packageId || defaultPackageId(pack, section.type);
    section.measures = { ...defaultMeasures(pack.data), ...(src.measures && typeof src.measures === "object" ? src.measures : {}) };
    section.quotePrices = sanitizeQuotePrices(src.quotePrices);
    section.includeLabour = !!src.includeLabour;
  } else {
    section.machines = normalizeMachineIds(src.machines || machineSelectionFromPreset(src.presetId) || []);
    section.presetId = resolvePresetId(section.machines);
    if (!section.presetId && src.presetId === "truck" && isTruckOnly(section.machines)) section.presetId = "truck";
    section.includeLabourer = !!src.includeLabourer;
    section.machineDays = src.machineDays ?? "1";
    section.travelKm = src.travelKm ?? "";
    section.materialQty = src.materialQty ?? "";
    section.tipLoads = src.tipLoads ?? "";
    section.travelMode = src.travelMode === "return" ? "return" : "oneway";
    section.travelNote = cleanStr(src.travelNote, 300);
    section.legacyTruck = src.legacyTruck === true || isTruckOnly(section.machines);
  }
  return section;
}

/** Saved quote → sections. No `sections` array means the old single-category quote. An explicit empty list stays empty. */
export function normalizeQuoteSections(quote) {
  const q = quote && typeof quote === "object" ? quote : {};
  if (Array.isArray(q.sections)) {
    if (!q.sections.length) return [];
    const used = new Set();
    const out = [];
    for (const raw of q.sections) {
      if (!raw || !raw.type) continue;
      if (out.length >= MAX_QUOTE_SECTIONS) break;
      out.push(hydrateSection(raw, used));
    }
    return out;
  }
  return [hydrateSection({ ...q, id: "s1", legacy: true }, new Set())];
}

function sectionHours(section) {
  const n = Number(section && section.hoursOnSite);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(100000, n) * 1000) / 1000;
}

function priceOneSection(section, rates) {
  const pack = quotePack(section.packId);
  if (pack && pack.wizard === "measure") {
    const calc = measuredCalc(pack, section, rates);
    return { ...calc, kind: "measure" };
  }
  const calc = calcQuote(section, rates);
  return { ...calc, kind: "earthworks", ok: true, reason: "" };
}

/**
 * Same machine (or the travel trip) on two earthworks sections the same day is one mobilisation.
 * Inside a section, calcQuote already charges each machine once.
 * Same hours: drop the duplicate, no review flag. Different hours or hour-vs-day: charge the longer
 * stay once and flag it, because the hours might be sequential rather than overlapping.
 */
function shareMobilisation(priced) {
  const notes = [];
  const groups = new Map();
  priced.forEach((row, si) => {
    if (row.calc.kind !== "earthworks") return;
    const day = String(row.section.workDay || 1);
    (row.calc.lines || []).forEach((line, li) => {
      let bucket = "";
      if (line.machineId && line.qty > 0) bucket = day + "|m|" + line.machineId;
      else if (line.key === "travel" && line.qty > 0) bucket = day + "|travel";
      if (!bucket) return;
      if (!groups.has(bucket)) groups.set(bucket, []);
      groups.get(bucket).push({ si, li, line });
    });
  });
  for (const hits of groups.values()) {
    if (hits.length < 2) continue;
    const units = new Set(hits.map(h => h.line.unit || (h.line.key === "travel" ? "km" : "")));
    const sameUnit = units.size <= 1;
    const qtys = hits.map(h => +h.line.qty || 0);
    const sameQty = qtys.every(q => q === qtys[0]);
    let keep = hits[0];
    if (sameUnit) {
      for (const h of hits) if ((+h.line.qty || 0) > (+keep.line.qty || 0)) keep = h;
    }
    const keepLabel = priced[keep.si].section.label || priced[keep.si].section.type;
    const name = keep.line.machineId ? fleetName(keep.line.machineId) : "Travel";
    for (const h of hits) {
      if (h.si === keep.si && h.li === keep.li) continue;
      const line = priced[h.si].calc.lines[h.li];
      line.sharedMobilisation = true;
      line.originalAmount = line.amount;
      line.amount = 0;
      const note = `Same day as ${keepLabel} — not charged again.`;
      line.note = line.note ? `${line.note} ${note}` : note;
    }
    if (!sameUnit || !sameQty) {
      const bits = hits.map(h => {
        const lab = priced[h.si].section.label || priced[h.si].section.type;
        const unit = h.line.unit || (h.line.key === "travel" ? "km" : "");
        return `${lab} ${h.line.qty}${unit ? " " + unit : ""}`;
      }).join(", ");
      notes.push(`${name} is on more than one section the same day (${bits}). Charged once on ${keepLabel} so mobilisation is not doubled. Check this before you send.`);
    }
  }
  for (const row of priced) {
    const lines = row.calc.lines || [];
    const missing = lines.filter(l => !l.sharedMobilisation && l.qty > 0 && l.rate == null && !l.overridden).map(l => l.key);
    const emptyMeasure = row.calc.kind === "measure" && !lines.some(l => l.qty > 0);
    const complete = !missing.length && !emptyMeasure && (row.calc.kind === "measure" ? row.calc.ok !== false : true);
    const subtotalEx = complete ? r2(lines.reduce((t, l) => t + (l.amount || 0), 0)) : null;
    row.calc.missingRates = missing;
    row.calc.complete = complete;
    row.calc.subtotalEx = subtotalEx;
    row.calc.totalEx = subtotalEx;
  }
  return notes;
}

function presentLine(section, line, multi) {
  const baseKey = line.key;
  if (!multi) return { ...line, baseKey };
  return {
    ...line,
    baseKey,
    key: section.id + ":" + line.key,
    label: `${section.label}: ${line.label}`,
    sectionId: section.id,
    sectionType: section.type,
    sectionLabel: section.label,
  };
}

/**
 * Price every section, then one ex-GST / GST / inc-GST total.
 * One legacy section returns the same lines and totals as calcQuote or the pack calculator.
 */
export function calcSections(input, rates) {
  const sections = normalizeQuoteSections(input);
  const priced = sections.map(section => ({ section, calc: priceOneSection(section, rates) }));
  const single = priced.length === 1;
  const reviewNotes = single ? [] : shareMobilisation(priced);
  if (single) {
    const row = priced[0];
    const calc = row.calc;
    const hours = sectionHours(row.section);
    return {
      ...calc,
      sections: [{
        ...row.section,
        lines: calc.lines,
        subtotalEx: calc.totalEx,
        complete: calc.complete,
        missingRates: calc.missingRates || [],
        kind: calc.kind,
      }],
      lines: calc.lines,
      allocatedHours: hours,
      reviewNotes: [],
      multi: false,
    };
  }
  const presented = priced.map(row => ({
    ...row.section,
    lines: (row.calc.lines || []).map(line => presentLine(row.section, line, true)),
    subtotalEx: row.calc.subtotalEx,
    complete: !!row.calc.complete,
    missingRates: row.calc.missingRates || [],
    kind: row.calc.kind,
    ok: row.calc.ok !== false,
    reason: row.calc.reason || "",
    machines: row.calc.machines || row.section.machines || [],
    presetId: row.calc.presetId || null,
    includeLabourer: !!row.calc.includeLabourer,
    extraItems: row.calc.extraItems || row.section.extraItems || [],
    priceOverrides: row.calc.priceOverrides || row.section.priceOverrides || {},
  }));
  const missingRates = presented.flatMap(s => (s.missingRates || []).map(k => s.id + ":" + k));
  const complete = presented.every(s => s.complete) && presented.some(s => (s.lines || []).some(l => l.qty > 0));
  const totalEx = complete ? r2(presented.reduce((t, s) => t + (s.subtotalEx || 0), 0)) : null;
  const tax = gstFromEx(totalEx);
  const lines = presented.flatMap(s => s.lines);
  const allocatedHours = Math.round(presented.reduce((t, s) => t + sectionHours(s), 0) * 1000) / 1000;
  return {
    ok: presented.every(s => s.ok !== false),
    reason: (presented.find(s => s.reason) || {}).reason || "",
    lines,
    sections: presented,
    missingRates,
    complete,
    totalEx,
    subtotalEx: totalEx,
    gst: tax.gst,
    totalInc: tax.totalInc,
    gstRate: GST_RATE,
    adjustmentEx: r2(lines.filter(l => l.overridden && l.originalAmount != null).reduce((t, l) => t + ((l.amount || 0) - l.originalAmount), 0)),
    extrasEx: r2(lines.filter(l => l.extra && l.amount != null).reduce((t, l) => t + l.amount, 0)),
    allocatedHours,
    reviewNotes,
    multi: true,
    extraItems: presented.flatMap(s => s.extraItems || []),
    priceOverrides: Object.assign({}, ...presented.map(s => s.priceOverrides || {})),
  };
}

function crewQtyLine(line) {
  const name = noDollars(line.name || line.label || "Item").replace(/\s+/g, " ").trim();
  const unit = line.unit === "m2" ? "m²" : line.unit === "m3" ? "m³" : (line.unit || "");
  const row = line.name || line.sectionLabel ? `${name}: ${line.qty} ${unit}`.trim() : name;
  return {
    text: noDollars(row).slice(0, 200),
    item: {
      id: String(line.id || line.key || "").slice(0, 40),
      name: name.slice(0, 200),
      qty: +line.qty || 0,
      unit: String(line.unit || "").slice(0, 12),
      lineType: ["labour", "material", "compliance", "hire", "waste"].includes(line.lineType) ? line.lineType : "labour",
      note: noDollars(line.note || "").slice(0, 300),
    },
  };
}

function sectionCrew(section) {
  const items = [];
  const amounts = [];
  for (const line of section.lines || []) {
    if (!(+line.qty > 0) || line.sharedMobilisation) continue;
    const row = crewQtyLine(line);
    if (amounts.length < 20) amounts.push(row.text);
    if (items.length < 40) items.push(row.item);
  }
  return { items, amounts };
}

/** Job ids written when this quote was accepted. The first one is the quote's `jobId`. */
export function acceptedJobIds(quote) {
  const ids = [];
  const push = id => {
    const s = String(id || "").trim();
    if (s && !ids.includes(s)) ids.push(s);
  };
  if (quote && typeof quote === "object") {
    push(quote.jobId);
    for (const id of quote.jobIds || []) push(id);
  }
  return ids;
}

/** Top-of-quote banner once the quote is a job. No prices. */
export function acceptedQuoteBannerHtml(quote, esc) {
  const e = typeof esc === "function" ? esc : (s => String(s ?? ""));
  const ids = acceptedJobIds(quote);
  const primary = ids[0] || "—";
  const extra = ids.length > 1 ? `<span class="sub">${ids.slice(1).map(id => "Job " + e(id)).join(" · ")}</span>` : "";
  const buttons = ids.map((id, i) => `<button type="button" class="sm-btn qw-openjob" data-job="${e(id)}">${i === 0 ? "Open job" : "Open job " + e(id)}</button>`).join("");
  return `<div class="qw-accepted" role="status"><div class="qw-accepted-copy"><b>Accepted · Job ${e(primary)}</b>${extra}</div>${buttons}</div>`;
}

/** Prominent accept control. Stays tappable when the quote is not ready yet. */
export function quoteAcceptedButtonHtml(ready) {
  return `<button type="button" class="qw-accept" id="qwaccept" data-can-accept="${ready ? "1" : "0"}"><span class="qw-accept-label">Quote accepted</span><span class="qw-accept-sub">Turns this quote into a job</span></button>`;
}

/**
 * First thing stopping accept, or null when the existing accept path can run.
 * Address and rates use the phrases the office asked for. The focus selector is a field to jump to.
 */
export function acceptGap(state, calc, rates) {
  const data = state && typeof state === "object" ? state : {};
  const priced = calc && typeof calc === "object" ? calc : {};
  const rateBook = rates && typeof rates === "object" ? rates : {};
  if (!String(data.address || "").trim()) return { message: "Add the site address first", step: 0, focus: "[name=address]" };
  if (!String(data.client || "").trim()) return { message: "Add the client first", step: 0, focus: "[name=client]" };
  if (!(data.sections || []).length) return { message: "Tick a category first", step: 0, focus: "[data-type]" };
  for (const sec of data.sections || []) {
    const pack = quotePack(sec.packId);
    const label = sec.label || "Section";
    if (pack && pack.wizard === "measure") {
      const one = priceOneSection(sec, rateBook);
      if (!one.ok) return { message: label + ": " + (one.reason || "Check this section."), step: 1, focus: `[data-sec="${sec.id}"]` };
      if (!(one.lines || []).some(l => l.qty > 0)) return { message: label + ": enter a measurement so this section has a quantity.", step: 1, focus: `[data-sec="${sec.id}"] [data-m]` };
    } else {
      const m = machineSelectionError(sec.machines, { legacyTruck: !!sec.legacyTruck && isTruckOnly(sec.machines) });
      if (m) return { message: label + ": " + m, step: 1, focus: `[data-sec="${sec.id}"] [data-preset]` };
    }
  }
  if (priced.ok === false && priced.reason) return { message: priced.reason, step: 1, focus: ".qw-sec" };
  for (const sec of priced.sections || []) {
    if (sec.kind === "measure" || sec.packId !== "earthworks") continue;
    const hourly = (sec.machines || []).some(id => machineRateOf(rateBook, id).unit === "hour")
      || (sec.includeLabourer && rateBook.labourerUnit !== "day");
    if (hourly && !(+sec.hoursOnSite > 0)) {
      return { message: (sec.label || "Section") + ": enter hours on site for hourly plant / labourer.", step: 1, focus: `[data-field="hoursOnSite"][data-sec="${sec.id}"]` };
    }
  }
  if (!priced.complete || priced.totalEx == null) return { message: "Add rates first", step: 2, focus: "#qwmissing" };
  const extras = (priced.sections || []).flatMap(s => s.extraItems || priced.extraItems || []);
  if (extras.some(it => it.qty > 0 && !it.description && !(it.kind === "material" && it.material))) {
    return { message: "Give every extra item a description before accepting.", step: 2, focus: "[data-xf=\"description\"]" };
  }
  return null;
}

/** Price-free job plans. `split` is one job per section; otherwise one job whose types are every category. */
export function jobsFromAcceptedQuote(quote, calc, mode) {
  const q = quote && typeof quote === "object" ? quote : {};
  const sections = (calc && calc.sections) || [];
  const split = mode === "split" && sections.length > 1;
  const hours = n => (n > 0 ? n : null);
  const planFor = (list, moneyEx) => {
    const types = list.map(s => s.type).filter(Boolean);
    const crew = list.map(sectionCrew);
    const amounts = crew.flatMap(c => c.amounts).slice(0, 20);
    const allocated = Math.round(list.reduce((t, s) => t + sectionHours(s), 0) * 1000) / 1000;
    const scope = noDollars(q.description || "");
    const heads = list.map(s => {
      const equip = s.kind === "earthworks" || (s.machines && s.machines.length)
        ? (EQUIPMENT_PRESETS.find(p => p.id === (s.presetId || resolvePresetId(s.machines)))?.label
          || (s.machines || []).map(fleetName).join(" + "))
        : "";
      const travel = s.travelNote ? `Travel: ${noDollars(s.travelNote)}` : "";
      return [s.label, equip ? `Equipment: ${equip}${s.includeLabourer ? " + labourer" : ""}` : "", travel].filter(Boolean).join(" — ");
    });
    const description = [scope, ...heads, allocated > 0 ? "Allocated hours: " + allocated : ""].filter(Boolean).join("\n");
    const quoteDoc = {
      hoursOnSite: allocated,
      allocatedHours: allocated,
      sections: list.map((s, i) => ({
        id: s.id,
        type: s.type,
        label: noDollars(s.label).slice(0, 80),
        packId: s.packId,
        hoursOnSite: sectionHours(s),
        items: crew[i].items,
        ...(s.machines && s.machines.length ? { machines: s.machines, presetId: s.presetId || null, includeLabourer: !!s.includeLabourer } : {}),
      })),
    };
    if (list.length === 1 && list[0].kind !== "measure" && list[0].packId === "earthworks") {
      const s = list[0];
      Object.assign(quoteDoc, {
        travelKm: +s.travelKm || 0,
        machineDays: Math.max(1, +s.machineDays || 1),
        materialQty: +s.materialQty || 0,
        tipLoads: +s.tipLoads || 0,
        machines: s.machines || [],
        presetId: s.presetId || null,
        includeLabourer: !!s.includeLabourer,
        travelMode: s.travelMode || "oneway",
        travelNote: noDollars(s.travelNote || ""),
        extraItems: sanitizeExtraItems(s.extraItems).map(({ unitPrice, ...rest }) => ({
          ...rest, description: noDollars(rest.description), note: noDollars(rest.note),
        })),
      });
    }
    return {
      type: types[0] || "other",
      types,
      description,
      workAmounts: list.length === 1 && list[0].packId === "earthworks" && !calc.multi
        ? workAmounts({ ...q, ...list[0], ratesSnapshot: q.ratesSnapshot })
        : amounts,
      allocatedHours: hours(allocated),
      quote: quoteDoc,
      moneyEx,
      machines: list.length === 1 ? (list[0].machines || []) : [],
      presetId: list.length === 1 ? (list[0].presetId || null) : null,
      includeLabourer: list.length === 1 ? !!list[0].includeLabourer : false,
    };
  };
  if (!split) return [planFor(sections, calc.totalEx)];
  return sections.map(s => planFor([s], s.subtotalEx));
}

function openQuoteWizard(existing, opts = {}) {
  const { $, esc, toast, db, doc, addDoc, updateDoc, serverTimestamp, getUi, renderAdmin, CLIENTS, TYPES, canSeeMoney, $$, getMe } = api;
  const me = getMe();
  ensureRates(false).then(rates => {
    if (existing?.jobId && existing?.quoteStatus === "Accepted" && opts.jumpToPrice) {
      toast("Already accepted — job kept as " + existing.jobId);
    }
    const job = opts.job && typeof opts.job === "object" ? opts.job : null;
    const startTrade = startingQuoteTrade(quoteTrade, job);
    if (!existing && startTrade) setQuoteFocus(startTrade);
    const state = Object.assign({
      quoteStatus: "Draft", client: job && job.client ? job.client : (CLIENTS[0] || ""), address: job && job.address || "", description: job && job.description || "",
    }, existing || {});
    state.addressPlace = sanitizePlace(state.addressPlace);
    if (!existing) {
      state.sections = [];
    } else {
      state.sections = normalizeQuoteSections(existing).filter(s => s && s.type);
    }
    state.type = state.sections[0] ? state.sections[0].type : "";
    let step = opts.jumpToPrice ? 2 : 0;
    const locked = existing?.quoteStatus === "Accepted";
    let revisions = [];
    const phases = ["Job", "Sections", "Review"];
    const titles = ["New quote", "Each section", "Review"];
    const subs = ["Tick every category this quote covers.", "Measurements and plant, one section at a time.", "Step 3 of 3"];
    let holdErr = "";
    const d = $("#dlg"); d.className = "jobcard"; d.onclose = () => renderAdmin();
    const bindCompare = () => {
      const box = d.querySelector("#revdiff");
      const selA = d.querySelector("#reva");
      const selB = d.querySelector("#revb");
      if (!box || !selA || !selB) return;
      const draw = () => {
        state._cmpA = selA.value;
        state._cmpB = selB.value;
        const left = revisions.find(rev => String(rev.revision) === selA.value);
        const right = revisions.find(rev => String(rev.revision) === selB.value);
        box.innerHTML = left && right ? compareHtml(left, right, { showMoney: !!canSeeMoney() }) : "";
      };
      selA.onchange = draw;
      selB.onchange = draw;
    };
    const bindOpenJobs = () => {
      d.querySelectorAll(".qw-openjob").forEach(b => b.addEventListener("click", () => {
        if (typeof api.openJob === "function") api.openJob(b.dataset.job);
        else toast("Open that job from the jobs list");
      }));
    };
    const showAcceptGap = gap => {
      step = gap.step;
      holdErr = gap.message;
      paint();
      toast(gap.message);
      const target = String(gap.focus || "").split(",").map(s => d.querySelector(s.trim())).find(el => el && !el.hidden);
      if (!target) return;
      target.scrollIntoView({ block: "nearest" });
      if (typeof target.focus === "function") target.focus();
    };
    const sectionById = id => (state.sections || []).find(s => s.id === id);
    const splitMeasureId = raw => {
      const text = String(raw || "");
      const cut = text.indexOf("~");
      if (cut < 0) return { sec: state.sections[0] && state.sections[0].id, id: text };
      return { sec: text.slice(0, cut), id: text.slice(cut + 1) };
    };
    const toggleCategory = type => {
      const on = state.sections.some(s => s.type === type);
      if (on) {
        state.sections = state.sections.filter(s => s.type !== type);
      } else {
        if (state.sections.length >= MAX_QUOTE_SECTIONS) { holdErr = `Up to ${MAX_QUOTE_SECTIONS} categories on one quote.`; return; }
        const used = new Set(state.sections.map(s => s.id));
        state.sections = [...state.sections, blankSection(type, { used })];
      }
      state.type = state.sections[0] ? state.sections[0].type : "";
    };
    const paint = () => {
      if (typeof api.refreshAutofill === "function") api.refreshAutofill();
      const calc = calcSections(state, rates);
      const money = !!canSeeMoney();
      const revHtml = revisionsPanelHtml(revisions, {
        showMoney: money,
        acceptedRevision: existing?.acceptedRevision || null,
        compareA: state._cmpA || "",
        compareB: state._cmpB || ""
      });
      if (locked) {
        d.innerHTML = `<form method="dialog" id="qwf" class="jc qw"><div class="jc-top q-wo"><div><div class="jc-no">Accepted quote</div>
          <div class="jc-q">Revision ${esc(existing?.acceptedRevision || existing?.revisionCount || "—")} is read-only</div></div>
          <button value="cancel" formnovalidate class="jc-x" aria-label="Close">✕</button></div>
          <div class="qw-acceptbar">${acceptedQuoteBannerHtml(existing, esc)}</div>
          <div class="jc-body qw-body"><p class="sub">${esc(existing?.client || "")} · ${esc(existing?.address || "")}</p>
          ${sectionsSummaryHtml(calc, esc, canSeeMoney, $$)}
          ${money ? revHtml : ""}
          <p class="sub">Accepted revisions are kept as they were. Saving a company default rate is a separate action and does not change this revision.</p></div>
          <div class="btns jc-foot"><button value="cancel" class="primary">Close</button></div></form>`;
        d.showModal();
        bindCompare();
        bindOpenJobs();
        return;
      }
      const already = !!(existing?.jobId && (existing.quoteStatus === "Accepted" || state.quoteStatus === "Accepted"));
      const acceptReady = !already && !acceptGap(state, calc, rates);
      const shownErr = holdErr; holdErr = "";
      d.innerHTML = `<form method="dialog" id="qwf" class="jc qw"><div class="jc-top q-quote"><div><div class="jc-no">${existing && step !== 0 ? "Edit quote" : esc(titles[step] || "Quote")}</div>
        <div class="jc-q">${esc(subs[step] || "")}</div></div>
        <button value="cancel" formnovalidate class="jc-x" aria-label="Close">✕</button></div>
        <div class="qw-acceptbar">${already ? acceptedQuoteBannerHtml(existing, esc) : quoteAcceptedButtonHtml(acceptReady)}</div>
        <div class="jc-body qw-body"><div class="qw-steps" aria-label="Quote steps">${phases.map((s, i) => `<span class="qw-phase ${i === step ? "on" : i < step ? "done" : ""}"><b>${i + 1}</b> ${s}</span>`).join("")}</div>
        <div class="qw-bar" aria-hidden="true"><span style="width:${Math.round(((step + 1) / phases.length) * 100)}%"></span></div>
        ${stepHtml(step, state, calc, rates, esc, CLIENTS, canSeeMoney, $$, canEditRates())}
        ${step === 2 ? `<p class="warnt pad" id="qwmissing" tabindex="-1" ${calc.complete ? "hidden" : ""}>${calc.complete ? "" : `Missing rates for: ${esc(calc.missingRates.map(k => missingLabel(k, calc)).join(", "))}. Save as draft, or set the price. Total is not shown as valid until every used line has a price.`}</p>${money ? `<div id="revslot">${revHtml}</div>` : ""}` : ""}
        ${already ? `<p class="pad sub">Already accepted → job <b>${esc(existing.jobId)}</b>. Accept will not create another job.</p>` : ""}
        </div>
        <p id="qerr" class="err">${esc(shownErr)}</p>
        <div class="btns jc-foot">
          <button type="button" class="sm-btn" id="qwback" ${step === 0 ? "disabled" : ""}>Back</button>
          ${step < 2 ? `<button type="button" class="sm-btn primary" id="qwnext">${step === 0 ? "Section details" : "Review quote"}</button>
             <button type="button" class="sm-btn qw-later" id="qwsave">Save &amp; finish later</button>` :
            `<button type="button" class="sm-btn qw-later" id="qwsave">Save draft</button>`}
        </div></form>`;
      d.showModal();
      $("#qwback").onclick = () => { syncFormToState(); step--; paint(); };
      $("#qwnext")?.addEventListener("click", () => {
        syncFormToState();
        if (!validateStep(step, state)) return;
        step++; paint();
      });
      $("#qwsave")?.addEventListener("click", () => { syncFormToState(); saveQuote(false); });
      $("#qwaccept")?.addEventListener("click", () => {
        syncFormToState();
        const gap = acceptGap(state, calcSections(state, rates), rates);
        if (gap) { showAcceptGap(gap); return; }
        if ((state.sections || []).length > 1) {
          if (step !== 2) { step = 2; paint(); }
          const box = d.querySelector("#qwsplit");
          if (box) { box.hidden = false; box.scrollIntoView({ block: "nearest" }); return; }
        }
        saveQuote(true, "one");
      });
      d.querySelector("#qwone")?.addEventListener("click", () => { syncFormToState(); saveQuote(true, "one"); });
      d.querySelector("#qwsplits")?.addEventListener("click", () => { syncFormToState(); saveQuote(true, "split"); });
      d.querySelectorAll("[data-qwcalc]").forEach(b => b.onclick = () => calcTravel(b.dataset.qwcalc));
      d.querySelectorAll("[data-field=travelMode]").forEach(r => r.onchange = () => {
        syncFormToState();
        const sec = sectionById(r.dataset.sec);
        if (!sec) return;
        sec.travelMode = r.value;
        if (sec._oneWayKm != null) {
          const k = sec.travelMode === "return" ? Math.round(sec._oneWayKm * 2 * 10) / 10 : sec._oneWayKm;
          sec.travelKm = String(k);
          sec.travelNote = sec.travelMode === "return"
            ? `Return road trip ≈ ${k} km (2 × ${sec._oneWayKm} km one-way, OSRM)`
            : `One-way road ≈ ${sec._oneWayKm} km (OSRM depot → site)`;
          paint();
        }
      });
      d.querySelectorAll("[data-preset]").forEach(r => r.onchange = () => {
        syncFormToState();
        const sec = sectionById(r.dataset.sec);
        if (!sec || !r.checked) return;
        sec.presetId = r.value;
        sec.machines = machineSelectionFromPreset(r.value);
        paint();
      });
      d.querySelectorAll("[data-mach]").forEach(cb => cb.onchange = () => {
        syncFormToState();
        paint();
      });
      d.querySelectorAll("[data-seclab]").forEach(cb => cb.addEventListener("change", () => {
        syncFormToState();
        paint();
      }));
      d.querySelector("#qwtrade")?.addEventListener("change", ev => {
        syncFormToState();
        setQuoteFocus(ev.target.value);
        paint();
      });
      d.querySelectorAll("[data-type]").forEach(b => b.onclick = () => {
        syncFormToState();
        toggleCategory(b.dataset.type);
        paint();
      });
      d.querySelectorAll("[data-secpkg]").forEach(r => r.onchange = () => {
        syncFormToState();
        const sec = sectionById(r.dataset.secpkg);
        if (sec) sec.packageId = r.value;
        paint();
      });
      d.querySelectorAll("[data-mf=style]").forEach(sel => sel.onchange = () => {
        syncFormToState();
        const parsed = splitMeasureId(sel.dataset.m);
        const sec = sectionById(parsed.sec) || state.sections[0];
        const pack = sec && quotePack(sec.packId);
        const line = pack && pack.data && pack.data.lines.find(l => l.styles && (l.group || l.id) === parsed.id);
        if (line && sec) {
          const raw = (sec.measures && sec.measures[parsed.id]) || {};
          const style = line.styles.find(s => s.id === raw.style) || line.styles[0];
          if (style && !style.heights.some(h => h.id === String(raw.height))) {
            sec.measures[parsed.id] = { ...raw, height: style.heights[0].id };
          }
        }
        paint();
      });
      d.querySelectorAll("[data-packprice]").forEach(inp => inp.addEventListener("input", () => {
        const row = inp.closest("[data-packrow]");
        const scope = row && row.querySelector("[data-packscope]");
        const flag = row && row.querySelector("[data-packflag]");
        const changed = inp.value !== "" && Number(inp.value) !== Number(inp.dataset.packbase);
        if (scope) scope.hidden = !changed;
        if (flag) flag.textContent = changed ? "This quote only" : (flag.dataset.packidle || "Default to review");
        readPackPrices();
        liveTotals();
      }));
      d.querySelectorAll("[data-packonly]").forEach(b => b.onclick = () => {
        const scope = b.closest("[data-packrow]") && b.closest("[data-packrow]").querySelector("[data-packscope]");
        if (scope) scope.hidden = true;
      });
      d.querySelectorAll("[data-packdefault]").forEach(b => b.onclick = async () => {
        if (rateSaveChoice("company") !== "company") return;
        readPackPrices();
        const sec = sectionById(b.dataset.sec);
        const key = b.dataset.packdefault;
        const price = sec && sec.quotePrices && sec.quotePrices[key];
        if (!sec || price == null || !await savePackDefault(sec.packId, key, price)) return;
        delete sec.quotePrices[key];
        paint();
      });
      d.querySelectorAll("[data-lab]").forEach(b => b.onclick = () => {
        syncFormToState();
        const sec = sectionById(b.dataset.sec);
        if (!sec) return;
        sec.includeLabourer = b.dataset.lab === "yes";
        paint();
      });
      bindExtras();
      bindCompare();
      bindOpenJobs();
    };
    if (existing?.id && canSeeMoney()) {
      const companyId = orgSettings().companyId || "heartwood";
      api.getDocs(api.query(api.collection(db, "quotes", existing.id, "revisions"), api.where("companyId", "==", companyId))).then(snap => {
        revisions = snap.docs.map(row => ({ id: row.id, ...row.data() })).sort((a, b) => (a.revision || 0) - (b.revision || 0));
        if (d.open) {
          if (!locked && d.querySelector("#qwf")) syncFormToState();
          paint();
        }
      }).catch(() => {});
    }
    // ---- Extra items + guided price overrides (review step). Typing updates totals live without a repaint.
    const keepOpen = sec => { if (sec) sec._extrasOpen = true; };
    const extraSection = node => sectionById(node && node.closest && (node.closest("[data-sec]") || {}).dataset && node.closest("[data-sec]").dataset.sec);
    const bindExtras = () => {
      bindDescriptionPicker(d);
      if (typeof api.wireClientPrefill === "function") api.wireClientPrefill(d);
      const addr = d.querySelector("[name=address]");
      if (addr) attachAddressSearch(addr, { onPick: p => {
        state.address = p.formattedAddress; state.addressPlace = p;
        state._oneWayKm = null; // a new site means travel must be recalculated
        const tag = d.querySelector("#qaddrtag"); if (tag) tag.hidden = false;
      } });
      d.querySelectorAll("[data-xadd]").forEach(b => b.onclick = () => {
        syncFormToState();
        const sec = extraSection(b);
        if (!sec) return;
        const count = state.sections.reduce((n, s) => n + (s.extraItems || []).length, 0);
        if (count >= MAX_EXTRA_ITEMS) { holdErr = `Up to ${MAX_EXTRA_ITEMS} extra items per quote.`; paint(); return; }
        const key = b.dataset.xadd;
        const saved = key.startsWith("saved:") ? sanitizeSavedPresets(rates.extraPresets).find(p => p.id === key.slice(6)) : null;
        sec.extraItems = [...(sec.extraItems || []), newExtraItem(saved || key, rates)];
        sec._focusExtra = sec.extraItems.length - 1;
        keepOpen(sec); paint();
      });
      d.querySelectorAll("[data-xmove]").forEach(b => b.onclick = () => {
        syncFormToState();
        const sec = extraSection(b);
        if (!sec) return;
        const [i, delta] = b.dataset.xmove.split(",").map(Number);
        sec.extraItems = moveExtraItem(sec.extraItems, i, delta);
        keepOpen(sec); paint();
      });
      d.querySelectorAll("[data-xdel]").forEach(b => b.onclick = () => {
        syncFormToState();
        const sec = extraSection(b);
        if (!sec) return;
        sec.extraItems = removeExtraItem(sec.extraItems, +b.dataset.xdel);
        keepOpen(sec); paint();
      });
      d.querySelectorAll("[data-xsave]").forEach(b => b.onclick = async () => {
        syncFormToState();
        const sec = extraSection(b);
        const it = sec && sec.extraItems[+b.dataset.xsave];
        if (it && await saveCompanyPreset(it)) { keepOpen(sec); paint(); }
      });
      d.querySelectorAll("[data-xf]").forEach(inp => {
        const ev = inp.tagName === "SELECT" ? "change" : "input";
        inp.addEventListener(ev, () => {
          readExtrasFromDom();
          liveTotals();
          if (inp.dataset.xf === "unitPrice") {
            const row = inp.closest("[data-xi]");
            const scope = row && row.querySelector("[data-xscope]");
            if (scope) scope.hidden = false;
          }
        });
      });
      d.querySelectorAll("[data-xonly]").forEach(b => b.onclick = () => {
        const row = b.closest("[data-xi]");
        const scope = row && row.querySelector("[data-xscope]");
        if (scope) scope.hidden = true;
      });
      d.querySelectorAll("[data-xdefault]").forEach(b => b.onclick = async () => {
        if (rateSaveChoice("company") !== "company") return;
        syncFormToState();
        const sec = extraSection(b);
        const it = sec && sec.extraItems[+b.dataset.xdefault];
        if (it && await saveCompanyPreset(it)) {
          const row = b.closest("[data-xi]");
          const scope = row && row.querySelector("[data-xscope]");
          if (scope) scope.hidden = true;
          keepOpen(sec); paint();
        }
      });
      d.querySelectorAll("[data-xcalc]").forEach(b => b.onclick = () => {
        const row = b.closest("[data-xi]");
        if (!row) return;
        const val = name => row.querySelector(`[data-xf="${name}"]`);
        const measured = measureQty({
          measure: val("measure") && val("measure").value,
          length: val("len") && val("len").value,
          width: val("wid") && val("wid").value,
          depth: val("dep") && val("dep").value,
          wastePct: val("waste") && val("waste").value,
        });
        const err = d.querySelector("#qerr");
        if (!measured.ok) { if (err) err.textContent = measured.reason; return; }
        if (err) err.textContent = "";
        const qty = row.querySelector("[data-xf=qty]");
        if (qty) qty.value = String(measured.qty);
        const unit = row.querySelector("[data-xf=unit]");
        if (unit && [...unit.options].some(o => o.value === measured.unit)) unit.value = measured.unit;
        readExtrasFromDom();
        liveTotals();
      });
      d.querySelectorAll("[data-ov]").forEach(inp => inp.addEventListener("input", () => { readOverridesFromDom(); liveTotals(); }));
      d.querySelectorAll("[data-ovreset]").forEach(b => b.onclick = () => {
        syncFormToState();
        const sec = sectionById(b.dataset.sec);
        if (!sec) return;
        const next = { ...(sec.priceOverrides || {}) }; delete next[b.dataset.ovreset];
        sec.priceOverrides = next; sec._ovOpen = true; paint();
      });
      d.querySelector("#qwcust")?.addEventListener("click", () => { syncFormToState(); openCustomerQuote(); });
      const focus = (state.sections || []).find(s => s._focusExtra != null);
      if (focus) {
        d.querySelector(`[data-sec="${focus.id}"] [data-xi="${focus._focusExtra}"] [data-xf=description]`)?.focus();
        focus._focusExtra = null;
      }
    };
    const readMeasuresFromDom = () => {
      const inputs = d.querySelectorAll("[data-m]");
      const checks = d.querySelectorAll("[data-mon]");
      if (!inputs.length && !checks.length) return;
      inputs.forEach(inp => {
        const parsed = splitMeasureId(inp.dataset.m);
        const sec = sectionById(parsed.sec);
        if (!sec) return;
        sec.measures = { ...(sec.measures || {}) };
        sec.measures[parsed.id] = { ...(sec.measures[parsed.id] || {}), [inp.dataset.mf]: inp.value };
      });
      checks.forEach(cb => {
        const parsed = splitMeasureId(cb.dataset.mon);
        const sec = sectionById(parsed.sec);
        if (!sec) return;
        sec.measures = { ...(sec.measures || {}) };
        sec.measures[parsed.id] = { ...(sec.measures[parsed.id] || {}), on: !!cb.checked };
      });
    };
    const readPackPrices = () => {
      const inputs = d.querySelectorAll("[data-packprice]");
      if (!inputs.length) return;
      inputs.forEach(inp => {
        const sec = sectionById((inp.closest("[data-sec]") || {}).dataset && inp.closest("[data-sec]").dataset.sec);
        if (!sec) return;
        const next = { ...(sec.quotePrices || {}) };
        const key = inp.dataset.packprice;
        if (inp.value === "" || Number(inp.value) === Number(inp.dataset.packbase)) delete next[key];
        else next[key] = inp.value;
        sec.quotePrices = sanitizeQuotePrices(next);
      });
    };
    const readExtrasFromDom = () => {
      const rows = d.querySelectorAll("[data-xi]");
      if (!rows.length && !d.querySelector(".qx")) return;
      const grouped = new Map((state.sections || []).map(s => [s.id, (s.extraItems || []).slice()]));
      rows.forEach(row => {
        const sec = extraSection(row);
        if (!sec) return;
        const next = grouped.get(sec.id) || [];
        const i = +row.dataset.xi; const cur = next[i]; if (!cur) return;
        const val = f => row.querySelector(`[data-xf="${f}"]`);
        next[i] = sanitizeExtraItem({
          ...cur,
          description: val("description") ? val("description").value : cur.description,
          material: val("material") ? val("material").value : cur.material,
          qty: val("qty") ? val("qty").value : cur.qty,
          unit: val("unit") ? val("unit").value : cur.unit,
          unitPrice: val("unitPrice") ? val("unitPrice").value : cur.unitPrice,
          note: val("note") ? val("note").value : cur.note,
          lineType: val("lineType") ? val("lineType").value : cur.lineType
        });
        grouped.set(sec.id, next);
      });
      for (const sec of state.sections || []) if (grouped.has(sec.id) && d.querySelector(`[data-sec="${sec.id}"] .qx`)) sec.extraItems = grouped.get(sec.id);
    };
    const readOverridesFromDom = () => {
      const inputs = d.querySelectorAll("[data-ov]");
      if (!inputs.length) return;
      const grouped = new Map();
      inputs.forEach(inp => {
        const id = inp.dataset.sec;
        if (!grouped.has(id)) grouped.set(id, {});
        if (inp.value !== "") grouped.get(id)[inp.dataset.ov] = inp.value;
      });
      for (const [id, map] of grouped) {
        const sec = sectionById(id);
        if (sec) sec.priceOverrides = sanitizeOverrides(map);
      }
    };
    const liveTotals = () => {
      const calc = calcSections(state, rates);
      const sum = d.querySelector("#qwsum");
      if (sum) sum.innerHTML = sectionsSummaryHtml(calc, esc, canSeeMoney, $$);
      calc.lines.filter(l => l.extra).forEach(l => {
        const cell = d.querySelector(`[data-xamt="${l.extraId}"]`);
        if (cell) cell.innerHTML = lineAmountHtml(l, esc, canSeeMoney, $$);
      });
      const warn = d.querySelector("#qwmissing");
      if (warn) { warn.hidden = calc.complete; warn.textContent = calc.complete ? "" : `Missing rates for: ${calc.missingRates.map(k => missingLabel(k, calc)).join(", ")}. Save as draft, or set the price. Total is not shown as valid until every used line has a price.`; }
      const acc = d.querySelector("#qwaccept");
      const already = !!(existing?.jobId && (existing.quoteStatus === "Accepted" || state.quoteStatus === "Accepted"));
      if (acc && !saving) acc.dataset.canAccept = (!already && !acceptGap(state, calc, rates)) ? "1" : "0";
    };
    const openCustomerQuote = () => {
      const calc = calcSections(state, rates);
      if (!calc.complete) { $("#qerr").textContent = "Set a price for every used line before making the customer quote."; return; }
      const html = customerQuoteHtml({ ...state, quoteId: existing?.id || "", dateIso: new Date().toISOString() }, calc, orgSettings());
      // A same-origin blob page (no network, nothing stored). Pop-up blocked → toast instead of a silent fail.
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const w = window.open(url, "_blank");
      if (!w) toast("Allow pop-ups for this site to open the customer quote");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    };
    const syncFormToState = () => {
      const f = $("#qwf"); if (!f) return;
      if (f.client) state.client = f.client.value.trim();
      if (f.address) {
        state.address = f.address.value.trim();
        if (state.addressPlace && state.address !== state.addressPlace.formattedAddress) state.addressPlace = null;
      }
      if (f.description) state.description = f.description.value.trim();
      f.querySelectorAll("[data-field]").forEach(inp => {
        const sec = sectionById(inp.dataset.sec);
        if (!sec) return;
        if (inp.type === "radio" || inp.type === "checkbox") { if (inp.checked) sec[inp.dataset.field] = inp.value; }
        else sec[inp.dataset.field] = inp.value;
      });
      const seenMach = new Set();
      f.querySelectorAll("[data-mach]").forEach(cb => {
        const sec = sectionById(cb.dataset.sec);
        if (!sec) return;
        if (!seenMach.has(sec.id)) { sec.machines = []; seenMach.add(sec.id); }
        if (cb.checked) sec.machines.push(cb.dataset.mach);
      });
      for (const id of seenMach) {
        const sec = sectionById(id);
        sec.machines = normalizeMachineIds(sec.machines);
        sec.presetId = resolvePresetId(sec.machines) || (isTruckOnly(sec.machines) ? "truck" : null);
      }
      f.querySelectorAll("[data-seclab]").forEach(cb => {
        const sec = sectionById(cb.dataset.sec);
        if (sec) sec.includeLabourer = !!cb.checked;
      });
      f.querySelectorAll("[data-seclabour]").forEach(cb => {
        const sec = sectionById(cb.dataset.seclabour || cb.dataset.sec);
        if (sec) sec.includeLabour = !!cb.checked;
      });
      f.querySelectorAll("[data-secpkg]").forEach(r => {
        if (!r.checked) return;
        const sec = sectionById(r.dataset.secpkg);
        if (sec) sec.packageId = r.value;
      });
      readMeasuresFromDom();
      readPackPrices();
      readExtrasFromDom();
      readOverridesFromDom();
      f.querySelectorAll(".qx[data-sec]").forEach(box => {
        const sec = sectionById(box.dataset.sec);
        if (!sec) return;
        if (box.id && box.id.startsWith("qwextras")) sec._extrasOpen = box.open;
        if (box.id && box.id.startsWith("qwov")) sec._ovOpen = box.open;
      });
      state.type = state.sections[0] ? state.sections[0].type : "";
    };
    const validateStep = (s, data) => {
      const err = $("#qerr");
      if (s === 0 && (!data.client || !data.address)) { err.textContent = "Client and site address are required."; return false; }
      if (s === 0 && !(data.sections || []).length) { err.textContent = "Tick at least one category."; return false; }
      if (s === 1) {
        for (const sec of data.sections || []) {
          const pack = quotePack(sec.packId);
          if (pack && pack.wizard === "measure") {
            const calc = priceOneSection(sec, rates);
            if (!calc.ok) { err.textContent = sec.label + ": " + calc.reason; return false; }
            if (!(calc.lines || []).some(l => l.qty > 0)) { err.textContent = sec.label + ": enter a measurement so this section has a quantity."; return false; }
          } else {
            const m = machineSelectionError(sec.machines, { legacyTruck: !!sec.legacyTruck && isTruckOnly(sec.machines) });
            if (m) { err.textContent = sec.label + ": " + m; return false; }
          }
        }
      }
      err.textContent = ""; return true;
    };
    const calcTravel = async (secId) => {
      syncFormToState();
      const sec = sectionById(secId) || (state.sections || []).find(s => s.packId === "earthworks");
      const depot = rates.yardAddress || DEFAULT_DEPOT.yardAddress;
      const site = state.address;
      const status = sec ? d.querySelector(`[data-travelst="${sec.id}"]`) : null;
      if (!depot) { if (status) status.textContent = "Set the depot address under Quote rates & depot first."; return; }
      if (!site) { if (status) status.textContent = "Enter the site address on step 1 first."; return; }
      if (status) status.textContent = "Looking up road distance (Nominatim + OSRM)…";
      const r = await roadDistanceKm(depot, site, state.addressPlace);
      if (!sec) return;
      if (r.km == null) {
        if (status) status.textContent = (r.error || "Could not calculate") + " — enter kilometres manually. Straight-line is not used as travel km.";
        return;
      }
      sec._oneWayKm = r.km;
      const mode = sec.travelMode || "oneway";
      const k = mode === "return" ? Math.round(r.km * 2 * 10) / 10 : r.km;
      sec.travelKm = String(k);
      sec.travelNote = mode === "return"
        ? `Return road trip ≈ ${k} km (2 × ${r.km} km one-way, ${r.source})`
        : `One-way road ≈ ${r.km} km (${r.source} depot → site)`;
      paint();
    };
    // One save at a time: a double tap on Save or Accept made two (or three) quotes and jobs.
    let saving = false;
    const saveQuote = async (accept, mode) => {
      if (saving) return;
      saving = true;
      d.querySelectorAll("#qwsave, #qwaccept, #qwone, #qwsplits").forEach(b => { b.disabled = true; });
      try { await saveQuoteOnce(accept, mode || "one"); }
      finally { saving = false; if (d.open) d.querySelectorAll("#qwsave, #qwaccept, #qwone, #qwsplits").forEach(b => { b.disabled = false; }); }
    };
    const saveQuoteOnce = async (accept, mode) => {
      if (existing?.quoteStatus === "Accepted" || state.quoteStatus === "Accepted") {
        toast("Accepted revision " + (existing?.acceptedRevision || existing?.revisionCount || "") + " is read-only.");
        return;
      }
      const data = state;
      data.sections = (data.sections || []).filter(s => s && s.type);
      if (!validateStep(0, data)) return;
      if (accept && !validateStep(1, data)) { step = 1; paint(); return; }
      const calc = calcSections(data, rates);
      if (!calc.ok && calc.reason) { $("#qerr").textContent = calc.reason; return; }
      if (accept && !calc.complete) { $("#qerr").textContent = "Set a price for every used line before accepting."; return; }
      const extras = (calc.sections || []).flatMap(s => s.extraItems || calc.extraItems || []);
      if (accept && extras.some(it => it.qty > 0 && !it.description && !(it.kind === "material" && it.material))) {
        $("#qerr").textContent = "Give every extra item a description before accepting."; return;
      }
      if (accept) {
        for (const sec of calc.sections || []) {
          if (sec.kind === "measure" || sec.packId !== "earthworks") continue;
          const hourly = (sec.machines || []).some(id => machineRateOf(rates, id).unit === "hour")
            || (sec.includeLabourer && rates.labourerUnit !== "day");
          if (hourly && !(+sec.hoursOnSite > 0)) {
            holdErr = sec.label + ": enter hours on site for hourly plant / labourer.";
            step = 1; paint(); return;
          }
        }
      }
      if (accept && existing?.jobId && existing?.quoteStatus === "Accepted") {
        toast("Already accepted — existing job " + existing.jobId);
        d.close(); renderAdmin(); return;
      }
      if ((calc.lines || []).length > 80) {
        $("#qerr").textContent = "This quote has too many lines to keep a revision (80). Remove a section or an extra item.";
        return;
      }
      const first = (calc.sections || [])[0] || {};
      const packs = [...new Set((calc.sections || []).map(s => s.packId))];
      const mirror = calc.multi ? {} : (first.packId === "earthworks" ? {
        travelKm: +first.travelKm || 0, hoursOnSite: +first.hoursOnSite || 0,
        machineDays: Math.max(1, +first.machineDays || 1),
        materialQty: +first.materialQty || 0, tipLoads: +first.tipLoads || 0,
        travelMode: first.travelMode || "oneway", travelNote: first.travelNote || "",
        machines: first.machines || [], presetId: first.presetId || null, includeLabourer: !!first.includeLabourer,
        extraItems: first.extraItems || [], priceOverrides: canEditRates() ? (first.priceOverrides || {}) : sanitizeOverrides(existing?.priceOverrides),
      } : {
        packId: first.packId, packageId: first.packageId || "",
        measures: first.measures || {}, quotePrices: sanitizeQuotePrices(first.quotePrices),
        includeLabour: !!first.includeLabour,
        hoursOnSite: +first.hoursOnSite || 0,
        machines: [], presetId: null, includeLabourer: false,
        travelKm: 0, machineDays: 1, materialQty: 0, tipLoads: 0,
        extraItems: first.extraItems || [], priceOverrides: {},
      });
      const payload = scopeRecord({
        client: data.client, address: data.address, description: data.description,
        addressPlace: sanitizePlace(data.addressPlace),
        type: first.type || "other",
        types: (calc.sections || []).map(s => s.type),
        packId: packs.length === 1 ? packs[0] : "multi",
        sections: (calc.sections || []).map(s => ({
          id: s.id, type: s.type, packId: s.packId, label: s.label, workDay: s.workDay || 1,
          hoursOnSite: +s.hoursOnSite || 0,
          extraItems: sanitizeExtraItems(s.extraItems),
          priceOverrides: canEditRates() ? sanitizeOverrides(s.priceOverrides) : sanitizeOverrides((existing?.sections || []).find(x => x.id === s.id)?.priceOverrides),
          ...(s.packId !== "earthworks" && quotePack(s.packId) && quotePack(s.packId).wizard === "measure" ? {
            packageId: s.packageId || "", measures: s.measures || {}, quotePrices: sanitizeQuotePrices(s.quotePrices), includeLabour: !!s.includeLabour,
          } : {
            machines: s.machines || [], presetId: s.presetId || null, includeLabourer: !!s.includeLabourer,
            machineDays: Math.max(1, +s.machineDays || 1),
            travelKm: +s.travelKm || 0, materialQty: +s.materialQty || 0, tipLoads: +s.tipLoads || 0,
            travelMode: s.travelMode || "oneway", travelNote: s.travelNote || "",
            legacyTruck: !!s.legacyTruck,
          }),
        })),
        ...mirror,
        allocatedHours: calc.allocatedHours || 0,
        hoursOnSite: calc.allocatedHours || (+first.hoursOnSite || 0),
        yardAddress: rates.yardAddress || DEFAULT_DEPOT.yardAddress,
        lines: calc.lines, totalEx: calc.complete ? calc.totalEx : null,
        gst: calc.complete ? calc.gst : null, totalInc: calc.complete ? calc.totalInc : null,
        ratesSnapshot: {
          travelPerKm: rates.travelPerKm,
          materialPerUnit: rates.materialPerUnit, tipPerLoad: rates.tipPerLoad,
          materialUnitLabel: rates.materialUnitLabel, tipUnitLabel: rates.tipUnitLabel,
          yardAddress: rates.yardAddress || DEFAULT_DEPOT.yardAddress,
          machineRates: mergeMachineRates(rates.machineRates),
          labourerRate: rates.labourerRate, labourerUnit: rates.labourerUnit,
          packRates: rates.packRates || {},
          ...(rates.tradeRates && Object.keys(rates.tradeRates).length ? { tradeRates: rates.tradeRates } : {}),
        },
        quoteStatus: "Draft", source: "app",
        updatedAt: serverTimestamp(), updatedBy: me.uid, updatedAtIso: new Date().toISOString()
      }, orgSettings().companyId || "heartwood");
      try {
        let qid = existing?.id;
        if (!qid) {
          const ref = await addDoc(api.collection(db, "quotes"), { ...payload, revisionCount: 0, createdAt: serverTimestamp(), createdBy: me.uid, createdByName: me.name });
          qid = ref.id;
          existing = { id: qid, ...payload, revisionCount: 0 };
        }
        const companyId = payload.companyId || orgSettings().companyId || "heartwood";
        const rev = await api.runTransaction(db, async tx => {
          const ref = doc(db, "quotes", qid);
          const snap = await tx.get(ref);
          const cur = snap.exists() ? snap.data() : {};
          if (cur.quoteStatus === "Accepted") throw new Error("accepted");
          const make = revisionNeeded(cur, payload);
          const n = make ? (Number(cur.revisionCount) || 0) + 1 : (Number(cur.revisionCount) || 0);
          if (make) {
            const diff = diffRevisions(cur.revisionCount ? cur : commercialSnapshot({}), payload);
            const changes = cur.revisionCount ? changeLines(diff, { showMoney: true }) : ["First saved version"];
            tx.set(doc(db, "quotes", qid, "revisions", revisionDocId(n)), {
              ...revisionBody({
                revision: n, quoteId: qid, companyId, uid: me.uid, name: me.name,
                atIso: new Date().toISOString(), snapshot: payload, changes
              }),
              createdAt: serverTimestamp()
            });
          }
          tx.set(ref, { ...payload, revisionCount: n }, { merge: true });
          return { n, created: make };
        });
        if (typeof api.remember === "function") api.remember({ client: payload.client, address: payload.address, description: payload.description });
        if (accept) {
          if (existing?.jobId) { toast("Already accepted"); d.close(); renderAdmin(); return; }
          const plans = jobsFromAcceptedQuote(payload, calc, mode);
          const jobIds = [];
          for (const plan of plans) jobIds.push(await writeQuoteJob(qid, payload, plan));
          await updateDoc(doc(db, "quotes", qid), {
            jobId: jobIds[0], jobIds, acceptMode: plans.length > 1 ? "split" : "one",
            quoteStatus: "Accepted", acceptedRevision: rev.n, acceptedBy: me.uid, acceptedAt: serverTimestamp()
          });
          toast(plans.length > 1
            ? "Quote accepted — revision " + rev.n + " — " + plans.length + " unscheduled jobs created"
            : "Quote accepted — revision " + rev.n + " — unscheduled job created");
        } else toast(rev.created ? "Draft saved · revision " + rev.n : "Draft saved — no change, so no new revision");
        d.close();
        api.getUi()._quotesFetched = false;
        await refreshQuotes();
        renderAdmin();
      } catch (e) {
        const code = String((e && (e.code || e.message)) || "");
        $("#qerr").textContent = code.includes("failed-precondition") ? "Someone else just changed this, try again" : (e.code || e.message);
      }
    };
    paint();
  });
}

function activePack() {
  if (!quoteTrade) return null;
  return quotePack(activeQuoteTradeId());
}

function categoryStepHtml(d, esc, CLIENTS) {
  const picked = new Set((d.sections || []).map(s => s.type));
  const groups = categoryChoices(quoteTrade);
  const focus = activeQuoteTradeId();
  const ordered = [...groups.filter(g => g.tradeId === focus), ...groups.filter(g => g.tradeId !== focus)];
  const picker = groups.length > 1
    ? `<label>Which trade is this quote for?<select id="qwtrade" aria-label="Quote trade">${groups.map(g => `<option value="${esc(g.tradeId)}"${g.tradeId === focus ? " selected" : ""}>${esc(g.tradeLabel)}</option>`).join("")}</select></label>`
    : "";
  const blocks = ordered.map(g => `<fieldset class="qw-sec"><legend>${esc(g.tradeLabel)}</legend>
    <div class="qw-types" role="group" aria-label="${esc(g.tradeLabel)} categories">${g.categories.map(c => {
      const on = picked.has(c.type);
      return `<button type="button" class="qw-type ${on ? "on" : ""}" data-type="${esc(c.type)}" aria-pressed="${on ? "true" : "false"}"><span class="qw-tick" aria-hidden="true"></span><span>${esc(c.label)}</span></button>`;
    }).join("")}</div></fieldset>`).join("");
  return `<div class="qw-pane">
    <label>Client<input name="client" ${inputAttrs("client")} value="${esc(d.client || "")}" required></label>
    <label class="plc-wrap">Job address<input name="address" ${placesEnabled() ? 'autocomplete="off"' : inputAttrs("address")} value="${esc(d.address || "")}" required placeholder="${placesEnabled() ? "Start typing to search Google Maps" : "Lot and street"}"></label>
    <p class="sub plc-tag" id="qaddrtag" ${d.addressPlace ? "" : "hidden"}>📍 Matched on Google Maps — travel uses this exact spot.</p>
    ${picker}
    <p class="sub">Tick every category this quote covers. Nothing is added until you tick it, and an empty section is not saved. Each ticked category is priced by that trade's pack. Hours sit on the next step. They are optional for the crew and are not written to a timesheet.</p>
    ${blocks || `<p class="sub">Quote pack coming soon for this company. Add a trade with a ready pack to price a quote.</p>`}
    ${descriptionPickerHtml(api && typeof api.suggestions === "function" ? api.suggestions("description") : [])}
    <label>Scope / notes<textarea name="description" rows="2">${esc(d.description || "")}</textarea></label>
  </div>`;
}

function earthworksSetupHtml(sec, rates, esc, canSeeMoney, showDay) {
  const sel = new Set(normalizeMachineIds(sec.machines || []));
  const preset = sec.presetId || resolvePresetId([...sel]);
  const rateTxt = (v, suffix) => (v != null && canSeeMoney) ? `$${Number(v).toFixed(2)}${suffix} ex GST` : "not set yet";
  const presets = EQUIPMENT_PRESETS.map(p => {
    const blurb = p.machines.map(id => `${fleetName(id)} and operator`).join(" · ");
    return `<label class="ck qw-preset ${preset === p.id ? "on" : ""}"><input type="radio" data-preset="1" data-sec="${esc(sec.id)}" name="preset-${esc(sec.id)}" value="${esc(p.id)}" ${preset === p.id ? "checked" : ""}><span><b>${esc(p.label)}</b><small>${esc(blurb)}</small></span></label>`;
  }).join("");
  const truckOnly = isTruckOnly([...sel]);
  const legacyTruck = !!sec.legacyTruck && truckOnly;
  return `<div class="qw-pane">
    <label class="qw-hours">Hours on site<input data-field="hoursOnSite" data-sec="${esc(sec.id)}" type="number" min="0" step="any" value="${esc(sec.hoursOnSite)}" inputmode="decimal"></label>
    <p class="sub">Hourly plant uses these hours. They are copied onto the job and are not written to a timesheet.</p>
    ${showDay ? `<label>Day on site<input data-field="workDay" data-sec="${esc(sec.id)}" type="number" min="1" max="31" step="1" value="${esc(sec.workDay || 1)}" inputmode="numeric"></label>
      <p class="sub">Sections on day 1 share one mobilisation for the same machine. Use another day only when the plant comes back later.</p>` : ""}
    <p class="sub">Each machine is included once, with its operator. The truck comes with a skid steer or excavator.</p>
    ${truckOnly ? `<p class="${legacyTruck ? "sub" : "warnt"} qw-legacy">${legacyTruck
      ? "Older truck-only quote — kept as it was. Truck on its own is no longer offered for new quotes."
      : "Truck on its own isn't offered. Add a skid steer or excavator."}</p>` : ""}
    <div class="qw-presets">${presets}</div>
    <details class="qw-builder"><summary>Adjust machines</summary>
      <p class="sub">Same machines as the list above. Truck is counted once, and only with a skid steer or excavator.</p>
      <label class="ck"><input type="checkbox" data-sec="${esc(sec.id)}" data-mach="truck" ${sel.has("truck") ? "checked" : ""}> Truck</label>
      <label class="ck"><input type="checkbox" data-sec="${esc(sec.id)}" data-mach="skid" ${sel.has("skid") ? "checked" : ""}> Skid steer (Bobcat)</label>
      <label class="ck"><input type="checkbox" data-sec="${esc(sec.id)}" data-mach="excavator" ${sel.has("excavator") ? "checked" : ""}> Excavator (JCB)</label>
    </details>
    <h4 class="qw-labh">Need a labourer?</h4>
    <div class="qw-yn" role="group" aria-label="Need a labourer?">
      <button type="button" class="qw-ynbtn ${sec.includeLabourer ? "on" : ""}" data-lab="yes" data-sec="${esc(sec.id)}">Yes</button>
      <button type="button" class="qw-ynbtn ${sec.includeLabourer ? "" : "on"}" data-lab="no" data-sec="${esc(sec.id)}">No</button>
    </div>
    <input type="checkbox" data-seclab="1" data-sec="${esc(sec.id)}" class="sr" ${sec.includeLabourer ? "checked" : ""}>
    ${canSeeMoney ? `<p class="sub">Labourer (separate rate): ${rateTxt(rates.labourerRate, rates.labourerUnit === "day" ? "/day" : "/h")}</p>` : `<p class="sub">A labourer is optional and priced separately from the machine.</p>`}
  </div>`;
}

function earthworksReviewFields(sec, rates, esc, canSeeMoney) {
  const depot = rates.yardAddress || DEFAULT_DEPOT.yardAddress;
  const maps = rates.yardMapsUrl || DEFAULT_DEPOT.yardMapsUrl;
  const rateTxt = (v, suffix) => (v != null && canSeeMoney) ? `$${Number(v).toFixed(2)}${suffix} ex GST` : "not set yet";
  const anyDay = (sec.machines || []).some(id => machineRateOf(rates, id).unit === "day")
    || (sec.includeLabourer && rates.labourerUnit === "day");
  return `<details class="qw-extra"><summary>Travel, materials and rubbish</summary>
    <p class="sub">Depot (start): <b>${esc(depot)}</b> · <a href="${esc(maps)}" target="_blank" rel="noopener">Maps link</a>. Calculate travel uses a road distance (OSRM). Straight-line is never filled in as travel km.</p>
    <div class="row gap">
      <label class="ck"><input type="radio" data-field="travelMode" data-sec="${esc(sec.id)}" name="travelMode-${esc(sec.id)}" value="oneway" ${sec.travelMode !== "return" ? "checked" : ""}> One-way</label>
      <label class="ck"><input type="radio" data-field="travelMode" data-sec="${esc(sec.id)}" name="travelMode-${esc(sec.id)}" value="return" ${sec.travelMode === "return" ? "checked" : ""}> Return (×2)</label>
      <button type="button" class="sm-btn" data-qwcalc="${esc(sec.id)}">Calculate travel</button>
    </div>
    <p class="sub" data-travelst="${esc(sec.id)}">${esc(sec.travelNote || "")}</p>
    <label>Kilometres (billable)<input data-field="travelKm" data-sec="${esc(sec.id)}" type="number" min="0" step="0.1" value="${esc(sec.travelKm)}" inputmode="decimal"></label>
    ${canSeeMoney ? `<p class="sub">Travel rate: ${rateTxt(rates.travelPerKm, "/km")}</p>` : ""}
    <label>Materials (${esc(rates.materialUnitLabel || "unit")})<input data-field="materialQty" data-sec="${esc(sec.id)}" type="number" min="0" step="0.1" value="${esc(sec.materialQty)}" inputmode="decimal"></label>
    ${canSeeMoney ? `<p class="sub">Materials rate: ${rateTxt(rates.materialPerUnit, " each")}</p>` : ""}
    <label>Rubbish loads<input data-field="tipLoads" data-sec="${esc(sec.id)}" type="number" min="0" step="1" value="${esc(sec.tipLoads)}" inputmode="numeric"></label>
    ${canSeeMoney ? `<p class="sub">Tip rate: ${rateTxt(rates.tipPerLoad, " / load")}</p>` : ""}
    ${anyDay ? `<label>Days (day-rate plant or labourer)<input data-field="machineDays" data-sec="${esc(sec.id)}" type="number" min="1" step="1" value="${esc(sec.machineDays || 1)}" inputmode="numeric"></label>
      <p class="sub">Day rates use days, not hours.</p>` : `<input type="hidden" data-field="machineDays" data-sec="${esc(sec.id)}" value="${esc(sec.machineDays || 1)}">`}
  </details>`;
}

function stepHtml(step, d, calc, rates, esc, CLIENTS, canSeeMoney, $$, isAdmin = false) {
  if (step === 0) return categoryStepHtml(d, esc, CLIENTS);
  const sections = calc.sections || d.sections || [];
  const earthCount = sections.filter(s => (quotePack(s.packId) || {}).wizard !== "measure").length;
  if (step === 1) {
    const body = sections.map(sec => {
      const pack = quotePack(sec.packId);
      const inner = pack && pack.wizard === "measure" && pack.data
        ? `<label class="qw-hours">Allocated hours<input data-field="hoursOnSite" data-sec="${esc(sec.id)}" type="number" min="0" step="any" value="${esc(sec.hoursOnSite)}" inputmode="decimal"></label>
           <p class="sub">Optional. Copied onto the job for the crew. It does not change timesheets, and nothing here is required before the job can be marked done.</p>
           ${measureSetupHtml(pack.data, { ...sec, sectionId: sec.id }, esc)}`
        : earthworksSetupHtml(sec, rates, esc, canSeeMoney(), earthCount > 1);
      return `<section class="qw-sec" data-sec="${esc(sec.id)}"><h4>${esc(sec.label)} <span class="sub">${esc(tradeLabel(sec.packId))}</span></h4>${inner}</section>`;
    }).join("");
    return `<div class="qw-pane">${body || `<p class="sub">Tick a category on the first step.</p>`}</div>`;
  }
  const blocks = sections.map(sec => {
    const pack = quotePack(sec.packId);
    const measured = !!(pack && pack.wizard === "measure" && pack.data);
    const secCalc = { ...calc, lines: sec.lines || [], extraItems: sec.extraItems || [], priceOverrides: sec.priceOverrides || {} };
    const body = measured
      ? measureReviewHtml(secCalc, esc, canSeeMoney(), isAdmin)
      : earthworksReviewFields(sec, rates, esc, canSeeMoney());
    const extras = extrasHtml(sec, secCalc, rates, esc, canSeeMoney, $$, isAdmin, measured ? "Add your own lines on top of the measured lines. Every price is ex GST and editable." : "");
    const overs = isAdmin && canSeeMoney() && !measured ? overridesHtml(sec, secCalc, esc, $$) : "";
    return `<section class="qw-sec" data-sec="${esc(sec.id)}"><h4>${esc(sec.label)} <span class="sub">${esc(tradeLabel(sec.packId))}</span></h4>${body}${extras}${overs}</section>`;
  }).join("");
  const split = sections.length > 1 ? `<div id="qwsplit" hidden class="qw-sec">
    <p><b>Accept this quote</b></p>
    <p class="sub">One job keeps every category on the same job. Split makes one unscheduled job per section. The accepted quote stays locked either way.</p>
    <div class="row gap"><button type="button" class="sm-btn primary" id="qwone">One job</button><button type="button" class="sm-btn" id="qwsplits">One job per section</button></div>
  </div>` : "";
  return `<div class="qw-pane"><h4>Review</h4>
    ${blocks}
    <div class="qw-sum" id="qwsum">${sectionsSummaryHtml(calc, esc, canSeeMoney, $$)}</div>
    ${canSeeMoney() ? `<div class="row gap qw-custrow"><button type="button" class="sm-btn" id="qwcust">Customer quote (print / PDF)</button></div>` : ""}
    ${split}
    <p class="sub">Accepting creates a pending unscheduled job. The crew sees quantities, never prices. Allocated hours are the sum of the sections and do not change timesheets. GST is 10% on the quote subtotal.</p></div>`;
}

function sectionsSummaryHtml(calc, esc, canSeeMoney, $$) {
  const money = !!canSeeMoney();
  const row = l => {
    let amt = "—";
    if (l.sharedMobilisation) amt = money ? `<span class="sub">Included</span>` : "—";
    else if (l.qty > 0 && l.rate == null && !l.overridden) amt = `<span class="unal">rate missing</span>`;
    else if (money) amt = lineAmountHtml(l, esc, canSeeMoney, $$);
    return `<div class="qw-line-row${l.extra ? " qx-line" : ""}${l.overridden ? " qx-ovline" : ""}"><span>${l.extra ? `<i class="qx-tag">Extra</i> ` : ""}${esc(l.label)}${l.note ? `<small class="qx-lnote">${esc(l.note)}</small>` : ""}</span><b>${amt}</b></div>`;
  };
  if (!calc.multi) return summaryHtml(calc, esc, canSeeMoney, $$);
  const blocks = (calc.sections || []).map(sec => {
    const sub = !sec.complete || sec.subtotalEx == null ? `<span class="unal">Incomplete</span>` : (money ? esc($$(sec.subtotalEx)) : "—");
    return `<h4>${esc(sec.label)}</h4>${(sec.lines || []).map(row).join("")}
      <div class="qw-line-row qx-subtotal"><span>${esc(sec.label)} subtotal ex GST</span><b>${sub}</b></div>`;
  }).join("");
  const notes = (calc.reviewNotes || []).map(n => `<p class="warnt">${esc(n)}</p>`).join("");
  const hours = `<p class="sub">Allocated hours: ${calc.allocatedHours > 0 ? esc(calc.allocatedHours) : "not set"} — the sum of the sections. Not written to a timesheet.</p>`;
  if (!calc.complete) return `${blocks}${notes}${hours}<div class="qw-total"><span>Total</span><b><span class="unal">Incomplete — set rates first</span></b></div>`;
  if (!money) return `${blocks}${notes}${hours}<div class="qw-total"><span>Total</span><b>—</b></div>`;
  return `${blocks}${notes}${hours}
    <div class="qw-line-row qx-subtotal"><span>Subtotal ex GST</span><b data-qsub>${esc($$(calc.subtotalEx))}</b></div>
    <div class="qw-line-row"><span>GST (10%)</span><b data-qgst>${esc($$(calc.gst))}</b></div>
    <div class="qw-total"><span>Total inc GST</span><b data-qtotal>${esc($$(calc.totalInc))}</b></div>`;
}

function missingLabel(key, calc) {
  if (key.startsWith("extra:") || key.startsWith("machine:")) {
    const l = calc.lines.find(x => x.key === key);
    return l ? l.label : "extra item";
  }
  return key;
}

function lineAmountHtml(l, esc, canSeeMoney, $$) {
  if (l.sharedMobilisation) return canSeeMoney() ? `<span class="sub">Included</span>` : "—";
  if (!canSeeMoney()) return "—";
  if (l.qty > 0 && l.rate == null && !l.overridden) return `<span class="unal">price missing</span>`;
  if (l.overridden) return `${l.originalAmount != null ? `<s class="qx-was">${esc($$(l.originalAmount))}</s> ` : ""}${esc($$(l.amount))} <span class="qx-adj">adjusted</span>`;
  if (l.amount != null) return esc($$(l.amount));
  return l.qty === 0 ? esc($$(0)) : "—";
}

/** Line list + subtotal / adjustments / GST / total. Repainted live while typing. */
function summaryHtml(calc, esc, canSeeMoney, $$) {
  const rows = calc.lines.map(l => {
    let amt = "—";
    if (l.qty > 0 && l.rate == null && !l.overridden) amt = `<span class="unal">rate missing</span>`;
    else if (canSeeMoney()) amt = lineAmountHtml(l, esc, canSeeMoney, $$);
    return `<div class="qw-line-row${l.extra ? " qx-line" : ""}${l.overridden ? " qx-ovline" : ""}"><span>${l.extra ? `<i class="qx-tag">Extra</i> ` : ""}${esc(l.label)}${l.note ? `<small class="qx-lnote">${esc(l.note)}</small>` : ""}</span><b>${amt}</b></div>`;
  }).join("");
  if (!calc.complete) return `${rows}<div class="qw-total"><span>Total</span><b><span class="unal">Incomplete — set rates first</span></b></div>`;
  if (!canSeeMoney()) return `${rows}<div class="qw-total"><span>Total</span><b>—</b></div>`;
  return `${rows}
    ${calc.adjustmentEx ? `<div class="qw-line-row qx-adjrow"><span>Price adjustments (included above)</span><b>${calc.adjustmentEx > 0 ? "+" : "−"}${esc($$(Math.abs(calc.adjustmentEx)))}</b></div>` : ""}
    <div class="qw-line-row qx-subtotal"><span>Subtotal ex GST</span><b data-qsub>${esc($$(calc.subtotalEx))}</b></div>
    <div class="qw-line-row"><span>GST (10%)</span><b data-qgst>${esc($$(calc.gst))}</b></div>
    <div class="qw-total"><span>Total inc GST</span><b data-qtotal>${esc($$(calc.totalInc))}</b></div>`;
}

function unitOptions(kind, cur, esc) {
  return unitsForKind(kind).map(u => `<option value="${esc(u)}" ${u === cur ? "selected" : ""}>${esc(unitLabel(u))}</option>`).join("");
}

/** Extra items editor (quick-add presets, rows with description / qty / unit / price / note, reorder, delete). */
function extrasHtml(d, calc, rates, esc, canSeeMoney, $$, isAdmin, lead) {
  const items = sanitizeExtraItems(d.extraItems);
  const money = canSeeMoney();
  const saved = sanitizeSavedPresets(rates.extraPresets);
  const lineOf = it => calc.lines.find(l => l.extraId === it.id) || { qty: it.qty, rate: it.unitPrice, amount: null };
  const typeField = (it, i) => {
    if (it.kind === "material") return `<label class="qx-type">Material<input data-xf="material" list="qxmat" value="${esc(it.material || "")}" placeholder="e.g. road base, topsoil" maxlength="80"></label>`;
    if (it.kind === "rubbish") return `<label class="qx-type">Waste type (optional)<input data-xf="material" list="qxwaste" value="${esc(it.material || "")}" placeholder="e.g. green waste, general, concrete / bricks, soil" maxlength="80"></label>`;
    return "";
  };
  const notePh = it => it.kind === "concrete" ? "e.g. reinforced or not, slab or footpath, break-up needed" : "Shown to the customer and the crew";
  const rows = items.map((it, i) => `<div class="qx-row" data-xi="${i}" data-sec="${esc(d.id || "")}" data-kind="${esc(it.kind)}">
      <div class="qx-head"><input class="qx-desc" data-xf="description" value="${esc(it.description)}" placeholder="Description" aria-label="Item ${i + 1} description" maxlength="200">
        <b class="qx-amt" data-xamt="${esc(it.id)}">${lineAmountHtml(lineOf(it), esc, canSeeMoney, $$)}</b></div>
      ${typeField(it, i)}
      <div class="qx-grid">
        <label>${AMOUNT_KINDS.includes(it.kind) ? "Amount" : "Qty"}<input data-xf="qty" type="number" min="0" step="0.1" inputmode="decimal" value="${esc(it.qty)}"></label>
        <label>Unit<select data-xf="unit">${unitOptions(it.kind, it.unit, esc)}</select></label>
        ${money ? `<label>$ / unit ex GST<input data-xf="unitPrice" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(it.unitPrice ?? "")}" placeholder="price"></label>` : ""}
        <label>Line<select data-xf="lineType">${LINE_TYPES.map(([id, label]) => `<option value="${esc(id)}"${it.lineType === id ? " selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
      </div>
      <div class="qx-calc">
        <span class="sub">Measure</span>
        <select data-xf="measure" aria-label="Measure"><option value="">Qty as entered</option><option value="area">Area m²</option><option value="volume">Volume m³</option><option value="linear">Linear metre</option></select>
        <input data-xf="len" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Length m" aria-label="Length metres">
        <input data-xf="wid" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Width m" aria-label="Width metres">
        <input data-xf="dep" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Depth m" aria-label="Depth metres">
        <input data-xf="waste" type="number" min="0" max="100" step="1" inputmode="decimal" placeholder="Waste %" aria-label="Waste percent">
        <button type="button" class="sm-btn" data-xcalc="${i}">Apply measure</button>
      </div>
      ${isAdmin && money ? `<p class="qx-scope sub" data-xscope="${i}" hidden>This price changed. <button type="button" class="sm-btn" data-xonly="${i}">This quote only</button> <button type="button" class="sm-btn" data-xdefault="${i}">Save as company default</button></p>` : ""}
      <label class="qx-note">Note (optional)<input data-xf="note" value="${esc(it.note || "")}" placeholder="${esc(notePh(it))}" maxlength="300"></label>
      <div class="qx-acts">
        <button type="button" class="sm-btn" data-xmove="${i},-1" ${i === 0 ? "disabled" : ""} aria-label="Move item ${i + 1} up">↑</button>
        <button type="button" class="sm-btn" data-xmove="${i},1" ${i === items.length - 1 ? "disabled" : ""} aria-label="Move item ${i + 1} down">↓</button>
        ${isAdmin ? `<button type="button" class="sm-btn" data-xsave="${i}">Save as preset</button>` : `<span></span>`}
        <button type="button" class="sm-btn qx-del" data-xdel="${i}" aria-label="Remove item ${i + 1}">Remove</button>
      </div></div>`).join("");
  const chips = EXTRA_PRESETS.map(p => `<button type="button" class="qx-chip" data-xadd="${esc(p.id)}">＋ ${esc(p.label)}</button>`).join("")
    + saved.map(p => `<button type="button" class="qx-chip qx-saved" data-xadd="saved:${esc(p.id)}" title="Saved preset">★ ${esc(p.label)}</button>`).join("")
    + `<button type="button" class="qx-chip" data-xadd="custom">＋ Blank item</button>`;
  const open = d._extrasOpen || items.length ? "open" : "";
  return `<details class="qw-extra qx" id="qwextras-${esc(d.id || "q")}" data-sec="${esc(d.id || "")}" ${open}><summary>Extra items${items.length ? ` <span class="cnt">${items.length}</span>` : ""}</summary>
    <p class="sub">${lead || `Add your own lines on top of the machine and labour. Every price is ex GST and editable${saved.length ? "; ★ are your saved presets" : ""}.`}</p>
    <div class="qx-chips" role="group" aria-label="Quick add">${chips}</div>
    <div class="qx-rows">${rows || `<p class="sub muted">No extra items.</p>`}</div>
    <datalist id="qxmat">${MATERIAL_TYPES.map(m => `<option value="${esc(m)}">`).join("")}</datalist>
    <datalist id="qxwaste">${WASTE_TYPES.map(m => `<option value="${esc(m)}">`).join("")}</datalist>
  </details>`;
}

/** Admin-only: override the price of a guided line. The summary shows the old price struck through. */
function overridesHtml(d, calc, esc, $$) {
  const guided = calc.lines.filter(l => !l.extra && (l.qty > 0 || l.overridden));
  if (!guided.length) return "";
  const ov = sanitizeOverrides(d.priceOverrides);
  const rows = guided.map(l => {
    const base = l.overridden ? l.originalAmount : l.amount;
    return `<div class="qx-ovrow"><span>${esc(l.label)}<small class="sub">${base != null ? "Calculated " + esc($$(base)) : "No rate set"}</small></span>
      <input data-ov="${esc(l.baseKey || l.key)}" data-sec="${esc(d.id || "")}" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(ov[l.baseKey || l.key] ?? "")}" placeholder="${base != null ? esc(base.toFixed(2)) : "price"}" aria-label="Price for ${esc(l.label)}">
      ${ov[l.baseKey || l.key] != null ? `<button type="button" class="sm-btn" data-ovreset="${esc(l.baseKey || l.key)}" data-sec="${esc(d.id || "")}">Reset</button>` : ""}</div>`;
  }).join("");
  return `<details class="qw-extra qx" id="qwov-${esc(d.id || "q")}" data-sec="${esc(d.id || "")}" ${d._ovOpen || Object.keys(ov).length ? "open" : ""}><summary>Adjust guided prices${Object.keys(ov).length ? ` <span class="cnt">${Object.keys(ov).length}</span>` : ""}</summary>
    <p class="sub">Admins only. Type a new line price (ex GST) to replace the calculated one; leave blank to keep it.</p>${rows}</details>`;
}

/** Stand-alone customer quote page (print or save as PDF from the browser). Prices only — no internal rates. */
export function customerQuoteHtml(q, calc, org) {
  const e = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const m = v => v == null ? "—" : "$" + Number(v).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const o = org || {};
  const date = (q.dateIso || new Date().toISOString()).slice(0, 10).split("-").reverse().join("/");
  const multi = !!(calc.sections && calc.sections.length > 1);
  const lineRow = l => {
    const amt = l.sharedMobilisation ? "Included" : m(l.amount);
    return `<tr><td>${e(l.label)}${l.note ? `<div class="n">${e(l.note)}</div>` : ""}</td><td class="r">${amt}</td></tr>`;
  };
  const shownOf = lines => (lines || []).filter(l => l.sharedMobilisation || (l.amount != null && (l.amount !== 0 || l.extra || l.overridden)));
  const sectionBlocks = multi ? calc.sections.map(sec => {
    const rows = shownOf(sec.lines).map(lineRow).join("");
    return `<h2>${e(sec.label)}</h2><p class="n">${e(tradeLabel(sec.packId) || sec.packId || "")}</p>
      <table><thead><tr><th>Item</th><th class="r">Amount ex GST</th></tr></thead><tbody>${rows || `<tr><td colspan="2">No priced items.</td></tr>`}</tbody>
      <tfoot><tr><td class="r">${e(sec.label)} subtotal ex GST</td><td class="r">${m(sec.subtotalEx)}</td></tr></tfoot></table>`;
  }).join("") : "";
  const shown = shownOf(calc.lines);
  const rows = shown.map(lineRow).join("");
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quote — ${e(q.client)} — ${e(q.address)}</title>
<style>body{font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1a16;max-width:760px;margin:24px auto;padding:0 18px}
h1{font-size:24px;margin:0 0 2px}h2{font-size:18px;margin:18px 0 0}.org{color:#5c4e42}.meta{display:grid;grid-template-columns:auto 1fr;gap:2px 14px;margin:18px 0}
.meta b{color:#5c4e42;font-weight:600}table{width:100%;border-collapse:collapse;margin:12px 0}td,th{padding:8px 6px;border-bottom:1px solid #e4dbd0;text-align:left;vertical-align:top}
.r{text-align:right;white-space:nowrap}.n{color:#6b5d50;font-size:13px}tfoot td{border:0;padding:4px 6px}tfoot tr.t td{font-weight:800;font-size:18px;border-top:2px solid #1d1a16;padding-top:8px}
.btn{margin:16px 0;padding:10px 16px;border-radius:10px;border:1px solid #8a5a2b;background:#8a5a2b;color:#fff;font-weight:700}
@media print{.btn{display:none}body{margin:0}}</style></head><body>
<button class="btn" onclick="print()">Print / save as PDF</button>
<h1>Quote</h1><div class="org"><b>${e(o.legalName || o.name || "")}</b>${o.abn ? ` · ABN ${e(o.abn)}` : ""}${o.phone ? ` · ${e(o.phone)}` : ""}${o.email ? ` · ${e(o.email)}` : ""}</div>
<div class="meta"><b>Date</b><span>${e(date)}</span><b>Client</b><span>${e(q.client)}</span><b>Site</b><span>${e(q.address)}</span>
${q.description ? `<b>Scope</b><span>${e(q.description)}</span>` : ""}${q.quoteId ? `<b>Ref</b><span>${e(q.quoteId)}</span>` : ""}</div>
${multi ? sectionBlocks + `<table><tfoot><tr><td class="r">Subtotal ex GST</td><td class="r">${m(calc.subtotalEx)}</td></tr><tr><td class="r">GST (10%)</td><td class="r">${m(calc.gst)}</td></tr><tr class="t"><td class="r">Total inc GST</td><td class="r">${m(calc.totalInc)}</td></tr></tfoot></table>`
  : `<table><thead><tr><th>Item</th><th class="r">Amount ex GST</th></tr></thead><tbody>${rows || `<tr><td colspan="2">No priced items.</td></tr>`}</tbody>
<tfoot><tr><td class="r">Subtotal ex GST</td><td class="r">${m(calc.subtotalEx)}</td></tr><tr><td class="r">GST (10%)</td><td class="r">${m(calc.gst)}</td></tr>
<tr class="t"><td class="r">Total inc GST</td><td class="r">${m(calc.totalInc)}</td></tr></tfoot></table>`}
<p class="n">Prices in AUD. ${e(POWERED_BY)}.</p></body></html>`;
}

async function writeQuoteJob(qid, q, plan) {
  const { db, doc, setDoc, collection, serverTimestamp, getMe } = api;
  const me = getMe();
  if (plan.moneyEx == null) throw new Error("Cannot create job from incomplete quote");
  const ref = doc(collection(db, "jobs"));
  const companyId = orgSettings().companyId;
  const jobDoc = scopeRecord({
    client: q.client, address: q.address, type: plan.type || "other",
    ...(Array.isArray(plan.types) && plan.types.length ? { types: plan.types } : {}),
    description: plan.description,
    date: "", time: "", status: "Scheduled", assigned: [], assignedNames: [],
    source: "quote", quoteId: qid, quoteStatus: "Accepted",
    ...(plan.allocatedHours ? { allocatedHours: plan.allocatedHours } : {}),
    quote: plan.quote,
    workAmounts: plan.workAmounts || [],
    ...(q.addressPlace ? {
      addressPlace: q.addressPlace,
      geo: { lat: q.addressPlace.lat, lng: q.addressPlace.lng, query: String(q.address || "").replace(/\s+/g, " ").trim(), source: "google-places", at: new Date().toISOString() }
    } : {}),
    machines: plan.machines || [], presetId: plan.presetId || null, includeLabourer: !!plan.includeLabourer,
    log: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: me.uid, editedInApp: true
  }, companyId);
  await setDoc(ref, jobDoc);
  await setDoc(doc(db, JOB_MONEY_COLLECTION, ref.id), jobMoneyDoc(ref.id, jobDoc.companyId,
    { quoteAmount: plan.moneyEx, poAmount: plan.moneyEx, poAmountBasis: "accepted quote (ex GST)", poAmountSource: "quote" },
    { updatedAt: serverTimestamp(), updatedBy: me.uid }));
  return ref.id;
}

async function createMeasuredJob(qid, q) {
  const { db, doc, setDoc, collection, serverTimestamp, getMe } = api;
  const me = getMe();
  if (q.totalEx == null) throw new Error("Cannot create job from incomplete quote");
  const safe = measuredJobFields(q);
  const ref = doc(collection(db, "jobs"));
  const companyId = orgSettings().companyId;
  const jobDoc = scopeRecord({
    client: q.client, address: q.address, type: q.type || "other", description: safe.description,
    date: "", time: "", status: "Scheduled", assigned: [], assignedNames: [],
    source: "quote", quoteId: qid, quoteStatus: "Accepted",
    ...(safe.allocatedHours ? { allocatedHours: safe.allocatedHours } : {}),
    quote: safe.quote,
    workAmounts: safe.workAmounts,
    ...(q.addressPlace ? {
      addressPlace: q.addressPlace,
      geo: { lat: q.addressPlace.lat, lng: q.addressPlace.lng, query: String(q.address || "").replace(/\s+/g, " ").trim(), source: "google-places", at: new Date().toISOString() }
    } : {}),
    machines: [], presetId: null, includeLabourer: false,
    log: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: me.uid, editedInApp: true
  }, companyId);
  await setDoc(ref, jobDoc);
  await setDoc(doc(db, JOB_MONEY_COLLECTION, ref.id), jobMoneyDoc(ref.id, jobDoc.companyId,
    { quoteAmount: q.totalEx, poAmount: q.totalEx, poAmountBasis: "accepted quote (ex GST)", poAmountSource: "quote" },
    { updatedAt: serverTimestamp(), updatedBy: me.uid }));
  return ref.id;
}

async function createJobFromQuote(qid, q) {
  if (q && q.packId && q.packId !== "earthworks") return createMeasuredJob(qid, q);
  const { db, doc, setDoc, collection, serverTimestamp, getMe } = api;
  const me = getMe();
  if (q.totalEx == null) throw new Error("Cannot create job from incomplete quote");
  const presetLab = EQUIPMENT_PRESETS.find(p => p.id === q.presetId)?.label
    || (q.machines || []).map(fleetName).join(" + ");
  // The job description is visible to assigned crew, so it carries scope and amounts only — never dollars.
  // Line prices stay on the quote (office only). The ex GST total (quoteAmount / poAmount) goes to jobMoney/{jobId},
  // which only the office reads (round 3, Q6): assigned crew can read the job document and keep it offline.
  const amounts = workAmounts(q);
  const desc = [noDollars(q.description || ""), "",
    presetLab ? `Equipment: ${presetLab}${q.includeLabourer ? " + labourer" : ""}` : "",
    q.travelNote ? `Travel: ${noDollars(q.travelNote)}` : ""].filter(Boolean).join("\n");
  // Amounts (rubbish / concrete / material …) go on job.workAmounts, shown on the job card, job form and run sheet.
  const ref = doc(collection(db, "jobs"));
  const companyId = orgSettings().companyId;
  const jobDoc = scopeRecord({
    client: q.client, address: q.address, type: q.type || "other", description: desc,
    date: "", time: "", status: "Scheduled", assigned: [], assignedNames: [],
    source: "quote", quoteId: qid, quoteStatus: "Accepted",
    // Assigned crew can read the whole job document (and it sits in their phone's offline cache), so the
    // copy on the job holds amounts only. Line prices, overrides and GST stay on the office-only quote (quoteId).
    quote: {
      travelKm: q.travelKm, hoursOnSite: q.hoursOnSite, machineDays: q.machineDays,
      materialQty: q.materialQty, tipLoads: q.tipLoads,
      machines: q.machines || [], presetId: q.presetId || null, includeLabourer: !!q.includeLabourer,
      travelMode: q.travelMode || "oneway", travelNote: noDollars(q.travelNote || ""),
      yardAddress: q.yardAddress || DEFAULT_DEPOT.yardAddress,
      extraItems: sanitizeExtraItems(q.extraItems).map(({ unitPrice, ...rest }) => ({ ...rest, description: noDollars(rest.description), note: noDollars(rest.note) }))
    },
    workAmounts: amounts,
    // A Google-picked site seeds the run-sheet geocode, so route ordering uses the exact spot.
    ...(q.addressPlace ? {
      addressPlace: q.addressPlace,
      geo: { lat: q.addressPlace.lat, lng: q.addressPlace.lng, query: String(q.address || "").replace(/\s+/g, " ").trim(), source: "google-places", at: new Date().toISOString() }
    } : {}),
    machines: q.machines || [], presetId: q.presetId || null, includeLabourer: !!q.includeLabourer,
    log: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: me.uid, editedInApp: true
  }, companyId);
  await setDoc(ref, jobDoc);
  await setDoc(doc(db, JOB_MONEY_COLLECTION, ref.id), jobMoneyDoc(ref.id, jobDoc.companyId,
    { quoteAmount: q.totalEx, poAmount: q.totalEx, poAmountBasis: "accepted quote (ex GST)", poAmountSource: "quote" },
    { updatedAt: serverTimestamp(), updatedBy: me.uid }));
  return ref.id;
}

export function adminViewRouter(view, ui, helpers) {
  if (view !== "quotes") return null;
  if (!ui._quotesFetched) {
    ui._quotesFetched = true;
    Promise.all([refreshQuotes(), ensureRates(false)]).finally(() => {
      helpers.rerender();
    });
  }
  return quotesViewHtml(ui, helpers.esc, helpers.$$, helpers);
}
