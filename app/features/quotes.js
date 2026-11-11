// CallUp guided Quotes (Nov 2026). Prices always ex GST.
import { orgSettings, POWERED_BY, PRODUCT_NAME } from "../org-settings.js";
import { scopeRecord } from "./company.js";
import { JOB_MONEY_COLLECTION, jobMoneyDoc } from "./job-money.js";
import { attachAddressSearch, placesEnabled, sanitizePlace } from "./places.js";
// Rates from meta/quoteRates only — never invent business rates.
// Draft/Accepted are explicit quoteStatus fields.
// Admins + supervisors (canQuote / canSeeMoney). Rate *edits* admin-only (canEditQuoteRates).
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
export function setDefaultDepot(address) {
  const a = String(address || "").trim();
  DEFAULT_DEPOT.yardAddress = a || HEARTWOOD_DEPOT.yardAddress;
  DEFAULT_DEPOT.yardMapsUrl = a ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a) : HEARTWOOD_DEPOT.yardMapsUrl;
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
    note: cleanStr(x.note, 300)
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
  const plantMissing = FLEET_MACHINES.some(m => (rates.machineRates?.[m.id]?.rate) == null);
  const rateWarn = DEFAULT_RATE_KEYS.some(([k]) => rates[k] == null) || plantMissing || rates.labourerRate == null;
  const editRates = helpers.canEditQuoteRates != null ? helpers.canEditQuoteRates() : canEditRates();
  const money = v => (v != null && $$) ? `${esc($$(v))} <span class="sub">ex GST</span>` : `<span class="unal">incomplete</span>`;
  const mach = q => {
    const ids = normalizeMachineIds(q.machines || []);
    if (!ids.length) return "";
    const lab = EQUIPMENT_PRESETS.find(p => p.id === q.presetId)?.label
      || ids.map(fleetName).join(" + ");
    return `<div class="sub">${esc(lab)}${q.includeLabourer ? " + labourer" : ""}</div>`;
  };
  const row = q => `<tr class="jr" data-qid="${esc(q.id)}"><td><span class="qpill ${q.quoteStatus === "Draft" ? "q-quote" : "q-wo"}">${esc(q.quoteStatus)}</span></td>
    <td><b>${esc(q.client || "")}</b><div class="sub">${esc(q.address || "")}</div>${mach(q)}</td>
    <td>${esc(q.description || q.type || "")}</td>
    <td>${q.totalEx != null ? money(q.totalEx) : `<span class="unal">rates needed</span>`}</td>
    <td>${q.quoteStatus === "Draft" ? `<button type="button" class="sm-btn" data-qaccept="${esc(q.id)}">Accept → job</button>` : `<span class="sub">Job ${esc(q.jobId || "—")}</span>`}</td></tr>`;
  return `<div class="sm-head"><h1>Quotes</h1>
    <div class="row gap"><button type="button" class="sm-btn primary" id="newquote">＋ New quote</button>
    ${editRates ? `<button type="button" class="sm-btn" id="editrates">Quote rates &amp; depot</button>` : `<span class="sub pad">Rates are set by an admin · depot ${esc(rates.yardAddress || DEFAULT_DEPOT.yardAddress)}</span>`}</div></div>
    <p class="pad sub">Three steps: job details, setup (machine and optional labourer), then review. Travel, materials and rubbish sit on the review. Accepting creates an unscheduled job. Admins and supervisors only. Prices stay ex GST and are never invented. Quotes are for ${esc(orgSettings().legalName)}. ${esc(POWERED_BY)}.</p>
    <p class="pad sub">Depot (travel start): <b>${esc(rates.yardAddress || DEFAULT_DEPOT.yardAddress)}</b>
      · <a href="${esc(rates.yardMapsUrl || DEFAULT_DEPOT.yardMapsUrl)}" target="_blank" rel="noopener">Maps</a></p>
    ${rateWarn ? `<p class="pad warnt">Set plant (incl. operator), labourer, travel, materials and tip rates before accepting — nothing is invented for you.</p>` : ""}
    <div class="sm-head"><h2>Drafts <span class="cnt">${drafts.length}</span></h2></div>
    <div class="tablewrap"><table class="jobs"><thead><tr><th>Status</th><th>Client / site</th><th>Scope</th><th>Total</th><th></th></tr></thead>
    <tbody>${drafts.map(row).join("") || `<tr><td colspan="5" class="muted pad">No draft quotes yet.</td></tr>`}</tbody></table></div>
    <div class="sm-head"><h2>Recently accepted</h2></div>
    <div class="tablewrap"><table class="jobs"><thead><tr><th>Status</th><th>Client / site</th><th>Scope</th><th>Total</th><th></th></tr></thead>
    <tbody>${accepted.map(row).join("") || `<tr><td colspan="5" class="muted pad">None yet.</td></tr>`}</tbody></table></div>`;
}

function bindAdminExtras(ctx) {
  const { ui, A } = ctx;
  if (ui.view !== "quotes") return;
  ensureRates(false);
  A.querySelector("#newquote")?.addEventListener("click", () => openQuoteWizard(null));
  A.querySelector("#editrates")?.addEventListener("click", () => openRatesEditor());
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

function openRatesEditor() {
  if (!canEditRates()) return api.toast("Only an admin can change quote rates");
  const { $, esc, toast, db, doc, setDoc, serverTimestamp, getUi, renderAdmin, getMe } = api;
  const me = getMe();
  ensureRates(false).then(rates => {
    const mr = mergeMachineRates(rates.machineRates);
    const d = $("#dlg"); d.className = ""; d.onclose = () => renderAdmin();
    const plantFields = FLEET_MACHINES.map(m => {
      const cur = mr[m.id];
      return `<fieldset class="qw-machrate"><legend>${esc(m.name)}${m.code ? ` (${esc(m.code)})` : ""} — includes operator</legend>
        <label>$ / ${cur.unit === "day" ? "day" : "hour"} (ex GST)<input name="mr_${m.id}" type="number" step="0.01" min="0" value="${esc(cur.rate ?? "")}"></label>
        <label>Unit<select name="mu_${m.id}"><option value="hour" ${cur.unit !== "day" ? "selected" : ""}>Per hour</option><option value="day" ${cur.unit === "day" ? "selected" : ""}>Per day</option></select></label>
      </fieldset>`;
    }).join("");
    d.innerHTML = `<form method="dialog" id="qrf" class="jf"><h2>Quote rates &amp; depot</h2>
      <p class="sub">Saved for your company only. Dollar rates are ex GST — leave blank until you know them (nothing invented). Plant rates include the operator. Labourer is a separate optional add-on. Depot is travel start.</p>
      <h3>Plant (operator included)</h3>
      <p class="sub">Presets: Truck + skid · Truck + excavator · Truck + skid + excavator · Excavator only. Selecting a combo charges each machine once (no double truck). The truck rate is used inside the truck packages.</p>
      ${plantFields}
      <h3>Labourer (optional add-on)</h3>
      <label>Labourer $ (ex GST)<input name="labourerRate" type="number" step="0.01" min="0" value="${esc(rates.labourerRate ?? "")}"></label>
      <label>Labourer unit<select name="labourerUnit"><option value="hour" ${rates.labourerUnit !== "day" ? "selected" : ""}>Per hour</option><option value="day" ${rates.labourerUnit === "day" ? "selected" : ""}>Per day</option></select></label>
      <h3>Travel, materials, tip</h3>
      ${DEFAULT_RATE_KEYS.map(([k, lab]) => `<label>${esc(lab)}<input name="${k}" type="number" step="0.01" min="0" value="${esc(rates[k] ?? "")}"></label>`).join("")}
      <label>Materials unit label<input name="materialUnitLabel" value="${esc(rates.materialUnitLabel || "unit")}"></label>
      <label>Rubbish unit label<input name="tipUnitLabel" value="${esc(rates.tipUnitLabel || "load")}"></label>
      ${savedPresetsEditorHtml(rates.extraPresets, esc)}
      <h3>Depot</h3>
      <label>Depot / yard address<input name="yardAddress" value="${esc(rates.yardAddress || DEFAULT_DEPOT.yardAddress)}"></label>
      <label>Depot Maps link (optional)<input name="yardMapsUrl" value="${esc(rates.yardMapsUrl || DEFAULT_DEPOT.yardMapsUrl)}"></label>
      <div class="btns"><button value="cancel" formnovalidate class="ghost">Cancel</button><button value="save" class="primary">Save</button></div></form>`;
    d.showModal();
    $("#qrf").onsubmit = async ev => {
      if (ev.submitter?.value !== "save") return;
      ev.preventDefault(); const f = ev.target;
      const machineRates = {};
      for (const m of FLEET_MACHINES) {
        machineRates[m.id] = {
          rate: numOrNull(f["mr_" + m.id].value),
          unit: f["mu_" + m.id].value === "day" ? "day" : "hour"
        };
      }
      const data = {
        travelPerKm: numOrNull(f.travelPerKm.value),
        materialPerUnit: numOrNull(f.materialPerUnit.value), tipPerLoad: numOrNull(f.tipPerLoad.value),
        materialUnitLabel: f.materialUnitLabel.value.trim() || "unit", tipUnitLabel: f.tipUnitLabel.value.trim() || "load",
        yardAddress: f.yardAddress.value.trim() || DEFAULT_DEPOT.yardAddress,
        yardMapsUrl: f.yardMapsUrl.value.trim() || DEFAULT_DEPOT.yardMapsUrl,
        machineRates,
        labourerRate: numOrNull(f.labourerRate.value),
        labourerUnit: f.labourerUnit.value === "day" ? "day" : "hour",
        // Clear legacy crew rate from new saves so it cannot double-charge operator.
        hourlyOnSite: null,
        // Saved extra-item presets: keep the ones not ticked for removal.
        extraPresets: sanitizeSavedPresets((rates.extraPresets || []).filter(p => !f.querySelector(`[data-rmpreset="${p.id}"]`)?.checked)),
        updatedAt: serverTimestamp(), updatedBy: me.uid
      };
      try {
        await setDoc(doc(db, ...quoteRatesPath(ratesCompany())), ratesCompany() === "heartwood" ? data : { ...data, companyId: ratesCompany() }, { merge: true });
        getUi().quoteRates = { ...emptyRates(), ...data, machineRates: mergeMachineRates(machineRates), updatedAt: new Date().toISOString() };
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

function openQuoteWizard(existing, opts = {}) {
  const { $, esc, toast, db, doc, addDoc, updateDoc, serverTimestamp, getUi, renderAdmin, CLIENTS, TYPES, canSeeMoney, $$, getMe } = api;
  const me = getMe();
  ensureRates(false).then(rates => {
    if (existing?.jobId && existing?.quoteStatus === "Accepted" && opts.jumpToPrice) {
      toast("Already accepted — job kept as " + existing.jobId);
    }
    const initMachines = normalizeMachineIds(existing?.machines || machineSelectionFromPreset(existing?.presetId) || []);
    const state = Object.assign({
      quoteStatus: "Draft", client: CLIENTS[0], type: "spoil", travelKm: "", hoursOnSite: "",
      machineDays: "1", materialQty: "", tipLoads: "", address: "", description: "",
      travelMode: "oneway", travelNote: "",
      machines: initMachines, includeLabourer: !!existing?.includeLabourer,
      presetId: resolvePresetId(initMachines),
      extraItems: [], priceOverrides: {}
    }, existing || {});
    // Quotes saved before extra items existed have neither field — start empty.
    state.extraItems = sanitizeExtraItems(state.extraItems);
    state.addressPlace = sanitizePlace(state.addressPlace);
    state.priceOverrides = sanitizeOverrides(state.priceOverrides);
    state.machines = normalizeMachineIds(state.machines || []);
    state.presetId = resolvePresetId(state.machines);
    // Saved before truck-only was removed: keep it valid as a legacy quote (opens, calculates, can be accepted).
    const legacyTruck = isTruckOnly(existing?.machines || []);
    // Shown as three steps (job / setup / review). Travel, materials, rubbish and the total stay on review.
    // calcQuote, rate checks and the accept payload are unchanged.
    let step = opts.jumpToPrice ? 2 : 0;
    const phases = ["Job", "Setup", "Review"];
    const titles = ["New quote", "Choose equipment", "Review"];
    const subs = ["What needs doing?", "Step 2 of 3", "Step 3 of 3"];
    let holdErr = "";
    const d = $("#dlg"); d.className = "jobcard"; d.onclose = () => renderAdmin();
    const paint = () => {
      const draft = { ...state, machines: normalizeMachineIds(state.machines) };
      const calc = calcQuote(draft, rates);
      const already = !!(existing?.jobId && (existing.quoteStatus === "Accepted" || state.quoteStatus === "Accepted"));
      const canAccept = !already && calc.complete && calc.totalEx != null && !!(draft.client && draft.address);
      const shownErr = holdErr; holdErr = "";
      d.innerHTML = `<form method="dialog" id="qwf" class="jc qw"><div class="jc-top q-quote"><div><div class="jc-no">${existing && step !== 0 ? "Edit quote" : esc(titles[step] || "Quote")}</div>
        <div class="jc-q">${esc(subs[step] || "")}</div></div>
        <button value="cancel" formnovalidate class="jc-x" aria-label="Close">✕</button></div>
        <div class="jc-body qw-body"><div class="qw-steps" aria-label="Quote steps">${phases.map((s, i) => `<span class="qw-phase ${i === step ? "on" : i < step ? "done" : ""}"><b>${i + 1}</b> ${s}</span>`).join("")}</div>
        <div class="qw-bar" aria-hidden="true"><span style="width:${Math.round(((step + 1) / phases.length) * 100)}%"></span></div>
        ${stepHtml(step, draft, calc, rates, esc, TYPES, CLIENTS, canSeeMoney, $$, canEditRates(), legacyTruck)}
        ${step === 2 ? `<p class="warnt pad" id="qwmissing" ${calc.complete ? "hidden" : ""}>${calc.complete ? "" : `Missing rates for: ${esc(calc.missingRates.map(k => missingLabel(k, calc)).join(", "))}. Save as draft, or set the price. Total is not shown as valid until every used line has a price.`}</p>` : ""}
        ${already ? `<p class="pad sub">Already accepted → job <b>${esc(existing.jobId)}</b>. Accept will not create another job.</p>` : ""}
        </div>
        <p id="qerr" class="err">${esc(shownErr)}</p>
        <div class="btns jc-foot">
          <button type="button" class="sm-btn" id="qwback" ${step === 0 ? "disabled" : ""}>Back</button>
          ${step < 2 ? `<button type="button" class="sm-btn primary" id="qwnext">${step === 0 ? "Choose equipment" : "Continue"}</button>
             <button type="button" class="sm-btn qw-later" id="qwsave">Save &amp; finish later</button>` :
            `<button type="button" class="sm-btn qw-later" id="qwsave">Save draft</button>
             <button type="button" class="sm-btn primary" id="qwaccept" data-can-accept="${canAccept ? "1" : ""}" ${canAccept ? "" : "disabled"} title="${canAccept ? "" : already ? "Already accepted" : "Complete site + rates first"}">Accept → create job</button>`}
        </div></form>`;
      d.showModal();
      $("#qwback").onclick = () => { syncFormToState(); step--; paint(); };
      $("#qwnext")?.addEventListener("click", () => {
        syncFormToState();
        if (!validateStep(step, state)) return;
        step++; paint();
      });
      $("#qwsave")?.addEventListener("click", () => { syncFormToState(); saveQuote(false); });
      $("#qwaccept")?.addEventListener("click", () => { syncFormToState(); saveQuote(true); });
      $("#qwcalc")?.addEventListener("click", () => calcTravel());
      d.querySelectorAll("[name=travelMode]").forEach(r => r.onchange = () => {
        state.travelMode = r.value;
        if (state._oneWayKm != null) {
          const k = state.travelMode === "return" ? Math.round(state._oneWayKm * 2 * 10) / 10 : state._oneWayKm;
          state.travelKm = String(k);
          state.travelNote = state.travelMode === "return"
            ? `Return road trip ≈ ${k} km (2 × ${state._oneWayKm} km one-way, OSRM)`
            : `One-way road ≈ ${state._oneWayKm} km (OSRM depot → site)`;
          paint();
        }
      });
      d.querySelectorAll("[name=preset]").forEach(r => r.onchange = () => {
        state.presetId = r.value;
        state.machines = machineSelectionFromPreset(r.value);
        paint();
      });
      d.querySelectorAll("[data-mach]").forEach(cb => cb.onchange = () => {
        syncFormToState();
        paint();
      });
      d.querySelector("#qlabourer")?.addEventListener("change", () => {
        state.includeLabourer = !!d.querySelector("#qlabourer")?.checked;
        paint();
      });
      d.querySelectorAll("[data-type]").forEach(b => b.onclick = () => {
        syncFormToState();
        state.type = b.dataset.type;
        paint();
      });
      d.querySelectorAll("[data-lab]").forEach(b => b.onclick = () => {
        const lab = d.querySelector("#qlabourer");
        if (!lab) return;
        lab.checked = b.dataset.lab === "yes";
        lab.dispatchEvent(new Event("change"));
      });
      bindExtras();
    };
    // ---- Extra items + guided price overrides (review step). Typing updates totals live without a repaint.
    const keepOpen = () => { state._extrasOpen = true; };
    const bindExtras = () => {
      const addr = d.querySelector("[name=address]");
      if (addr) attachAddressSearch(addr, { onPick: p => {
        state.address = p.formattedAddress; state.addressPlace = p;
        state._oneWayKm = null; // a new site means travel must be recalculated
        const tag = d.querySelector("#qaddrtag"); if (tag) tag.hidden = false;
      } });
      d.querySelectorAll("[data-xadd]").forEach(b => b.onclick = () => {
        syncFormToState();
        const key = b.dataset.xadd;
        const saved = key.startsWith("saved:") ? sanitizeSavedPresets(rates.extraPresets).find(p => p.id === key.slice(6)) : null;
        if (state.extraItems.length >= MAX_EXTRA_ITEMS) { holdErr = `Up to ${MAX_EXTRA_ITEMS} extra items per quote.`; paint(); return; }
        state.extraItems = [...state.extraItems, newExtraItem(saved || key, rates)];
        state._focusExtra = state.extraItems.length - 1;
        keepOpen(); paint();
      });
      d.querySelectorAll("[data-xmove]").forEach(b => b.onclick = () => {
        syncFormToState();
        const [i, delta] = b.dataset.xmove.split(",").map(Number);
        state.extraItems = moveExtraItem(state.extraItems, i, delta);
        keepOpen(); paint();
      });
      d.querySelectorAll("[data-xdel]").forEach(b => b.onclick = () => {
        syncFormToState();
        state.extraItems = removeExtraItem(state.extraItems, +b.dataset.xdel);
        keepOpen(); paint();
      });
      d.querySelectorAll("[data-xsave]").forEach(b => b.onclick = async () => {
        syncFormToState();
        const it = state.extraItems[+b.dataset.xsave];
        if (it && await saveCompanyPreset(it)) { keepOpen(); paint(); }
      });
      d.querySelectorAll("[data-xf]").forEach(inp => {
        const ev = inp.tagName === "SELECT" ? "change" : "input";
        inp.addEventListener(ev, () => { readExtrasFromDom(); liveTotals(); });
      });
      d.querySelectorAll("[data-ov]").forEach(inp => inp.addEventListener("input", () => { readOverridesFromDom(); liveTotals(); }));
      d.querySelectorAll("[data-ovreset]").forEach(b => b.onclick = () => {
        syncFormToState();
        const next = { ...state.priceOverrides }; delete next[b.dataset.ovreset];
        state.priceOverrides = next; state._ovOpen = true; paint();
      });
      d.querySelector("#qwcust")?.addEventListener("click", () => { syncFormToState(); openCustomerQuote(); });
      if (state._focusExtra != null) {
        d.querySelector(`[data-xi="${state._focusExtra}"] [data-xf=description]`)?.focus();
        state._focusExtra = null;
      }
    };
    const readExtrasFromDom = () => {
      const rows = d.querySelectorAll("[data-xi]");
      if (!rows.length) return;
      const next = state.extraItems.slice();
      rows.forEach(row => {
        const i = +row.dataset.xi; const cur = next[i]; if (!cur) return;
        const val = f => row.querySelector(`[data-xf="${f}"]`);
        next[i] = sanitizeExtraItem({
          ...cur,
          description: val("description") ? val("description").value : cur.description,
          material: val("material") ? val("material").value : cur.material,
          qty: val("qty") ? val("qty").value : cur.qty,
          unit: val("unit") ? val("unit").value : cur.unit,
          unitPrice: val("unitPrice") ? val("unitPrice").value : cur.unitPrice,
          note: val("note") ? val("note").value : cur.note
        });
      });
      state.extraItems = next;
    };
    const readOverridesFromDom = () => {
      const inputs = d.querySelectorAll("[data-ov]");
      if (!inputs.length) return;
      const next = {};
      inputs.forEach(inp => { if (inp.value !== "") next[inp.dataset.ov] = inp.value; });
      state.priceOverrides = sanitizeOverrides(next);
    };
    const liveTotals = () => {
      const calc = calcQuote({ ...state, machines: normalizeMachineIds(state.machines) }, rates);
      const sum = d.querySelector("#qwsum");
      if (sum) sum.innerHTML = summaryHtml(calc, esc, canSeeMoney, $$);
      calc.lines.filter(l => l.extra).forEach(l => {
        const cell = d.querySelector(`[data-xamt="${l.extraId}"]`);
        if (cell) cell.innerHTML = lineAmountHtml(l, esc, canSeeMoney, $$);
      });
      const warn = d.querySelector("#qwmissing");
      if (warn) { warn.hidden = calc.complete; warn.textContent = calc.complete ? "" : `Missing rates for: ${calc.missingRates.map(k => missingLabel(k, calc)).join(", ")}. Save as draft, or set the price. Total is not shown as valid until every used line has a price.`; }
      const acc = d.querySelector("#qwaccept");
      const already = !!(existing?.jobId && (existing.quoteStatus === "Accepted" || state.quoteStatus === "Accepted"));
      if (acc) { const ok = !already && calc.complete && calc.totalEx != null && !!(state.client && state.address); acc.dataset.canAccept = ok ? "1" : ""; acc.disabled = !ok || saving; }
    };
    const openCustomerQuote = () => {
      const calc = calcQuote({ ...state, machines: normalizeMachineIds(state.machines) }, rates);
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
      if (f.type) state.type = f.type.value;
      if (f.description) state.description = f.description.value.trim();
      if (f.travelKm) state.travelKm = f.travelKm.value;
      if (f.hoursOnSite) state.hoursOnSite = f.hoursOnSite.value;
      if (f.machineDays) state.machineDays = f.machineDays.value;
      if (f.materialQty) state.materialQty = f.materialQty.value;
      if (f.tipLoads) state.tipLoads = f.tipLoads.value;
      const mode = f.querySelector("[name=travelMode]:checked");
      if (mode) state.travelMode = mode.value;
      // Checkboxes are source of truth when present (and/or builder); presets only set machines on radio change.
      const boxes = f.querySelectorAll("[data-mach]");
      if (boxes.length) {
        const ids = [];
        boxes.forEach(cb => { if (cb.checked) ids.push(cb.getAttribute("data-mach")); });
        state.machines = normalizeMachineIds(ids);
        state.presetId = resolvePresetId(state.machines);
      } else {
        const preset = f.querySelector("[name=preset]:checked");
        if (preset) {
          state.presetId = preset.value;
          state.machines = machineSelectionFromPreset(preset.value);
        }
      }
      const lab = f.querySelector("#qlabourer");
      if (lab) state.includeLabourer = !!lab.checked;
      readExtrasFromDom();
      readOverridesFromDom();
      const xd = f.querySelector("#qwextras"); if (xd) state._extrasOpen = xd.open;
      const od = f.querySelector("#qwov"); if (od) state._ovOpen = od.open;
    };
    const validateStep = (s, data) => {
      const err = $("#qerr");
      if (s === 0 && (!data.client || !data.address)) { err.textContent = "Client and site address are required."; return false; }
      if (s === 1) {
        const m = machineSelectionError(data.machines, { legacyTruck: legacyTruck && isTruckOnly(data.machines) });
        if (m) { err.textContent = m; return false; }
      }
      err.textContent = ""; return true;
    };
    const calcTravel = async () => {
      syncFormToState();
      const depot = rates.yardAddress || DEFAULT_DEPOT.yardAddress;
      const site = state.address;
      const status = $("#qwtravelst");
      if (!site) { if (status) status.textContent = "Enter the site address on step 1 first."; return; }
      if (status) status.textContent = "Looking up road distance (Nominatim + OSRM)…";
      const r = await roadDistanceKm(depot, site, state.addressPlace);
      if (r.km == null) {
        if (status) status.textContent = (r.error || "Could not calculate") + " — enter kilometres manually. Straight-line is not used as travel km.";
        return;
      }
      state._oneWayKm = r.km;
      const mode = state.travelMode || "oneway";
      const k = mode === "return" ? Math.round(r.km * 2 * 10) / 10 : r.km;
      state.travelKm = String(k);
      state.travelNote = mode === "return"
        ? `Return road trip ≈ ${k} km (2 × ${r.km} km one-way, ${r.source})`
        : `One-way road ≈ ${r.km} km (${r.source} depot → site)`;
      paint();
    };
    // One save at a time: a double tap on Save or Accept made two (or three) quotes and jobs.
    let saving = false;
    const saveQuote = async (accept) => {
      if (saving) return;
      saving = true;
      d.querySelectorAll("#qwsave, #qwaccept").forEach(b => { b.disabled = true; });
      try { await saveQuoteOnce(accept); }
      finally { saving = false; if (d.open) d.querySelectorAll("#qwsave, #qwaccept").forEach(b => { b.disabled = b.id === "qwaccept" ? b.dataset.canAccept !== "1" : false; }); }
    };
    const saveQuoteOnce = async (accept) => {
      const data = { ...state, machines: normalizeMachineIds(state.machines) };
      if (!validateStep(0, data)) return;
      if (accept && !validateStep(1, data)) { step = 1; paint(); return; }
      const calc = calcQuote(data, rates);
      if (accept && !calc.complete) { $("#qerr").textContent = "Set quote rates for every used line before accepting."; return; }
      if (accept && calc.extraItems.some(it => it.qty > 0 && !it.description && !(it.kind === "material" && it.material))) {
        $("#qerr").textContent = "Give every extra item a description before accepting."; return;
      }
      if (accept) {
        const needH = (calc.machines || []).some(id => machineRateOf(rates, id).unit === "hour")
          || (calc.includeLabourer && rates.labourerUnit !== "day");
        if (needH && !(+data.hoursOnSite > 0)) {
          holdErr = "Enter hours on site for hourly plant / labourer.";
          step = 0; paint(); return;
        }
      }
      if (accept && existing?.jobId && existing?.quoteStatus === "Accepted") {
        toast("Already accepted — existing job " + existing.jobId);
        d.close(); renderAdmin(); return;
      }
      const payload = scopeRecord({
        client: data.client, address: data.address, type: data.type, description: data.description,
        addressPlace: sanitizePlace(data.addressPlace),
        travelKm: +data.travelKm || 0, hoursOnSite: +data.hoursOnSite || 0,
        machineDays: Math.max(1, +data.machineDays || 1),
        materialQty: +data.materialQty || 0, tipLoads: +data.tipLoads || 0,
        travelMode: data.travelMode || "oneway", travelNote: data.travelNote || "",
        yardAddress: rates.yardAddress || DEFAULT_DEPOT.yardAddress,
        machines: calc.machines, presetId: calc.presetId, includeLabourer: !!calc.includeLabourer,
        lines: calc.lines, totalEx: calc.complete ? calc.totalEx : null,
        extraItems: calc.extraItems, priceOverrides: canEditRates() ? calc.priceOverrides : sanitizeOverrides(existing?.priceOverrides),
        gst: calc.complete ? calc.gst : null, totalInc: calc.complete ? calc.totalInc : null,
        ratesSnapshot: {
          travelPerKm: rates.travelPerKm,
          materialPerUnit: rates.materialPerUnit, tipPerLoad: rates.tipPerLoad,
          materialUnitLabel: rates.materialUnitLabel, tipUnitLabel: rates.tipUnitLabel,
          yardAddress: rates.yardAddress || DEFAULT_DEPOT.yardAddress,
          machineRates: mergeMachineRates(rates.machineRates),
          labourerRate: rates.labourerRate, labourerUnit: rates.labourerUnit
        },
        quoteStatus: accept ? "Accepted" : "Draft", source: "app",
        updatedAt: serverTimestamp(), updatedBy: me.uid, updatedAtIso: new Date().toISOString()
      }, orgSettings().companyId || "heartwood");
      try {
        let qid = existing?.id;
        if (qid) await updateDoc(doc(db, "quotes", qid), payload);
        else {
          const ref = await addDoc(api.collection(db, "quotes"), { ...payload, createdAt: serverTimestamp(), createdBy: me.uid, createdByName: me.name });
          qid = ref.id;
          existing = { id: qid, ...payload };
        }
        if (accept) {
          if (existing?.jobId) { toast("Already accepted"); d.close(); renderAdmin(); return; }
          const jobId = await createJobFromQuote(qid, payload);
          await updateDoc(doc(db, "quotes", qid), { jobId, quoteStatus: "Accepted", acceptedAt: serverTimestamp() });
          toast("Quote accepted — unscheduled job created");
        } else toast("Draft quote saved");
        d.close();
        api.getUi()._quotesFetched = false;
        await refreshQuotes();
        renderAdmin();
      } catch (e) { $("#qerr").textContent = e.code || e.message; }
    };
    paint();
  });
}

function stepHtml(step, d, calc, rates, esc, TYPES, CLIENTS, canSeeMoney, $$, isAdmin = false, legacyTruck = false) {
  const depot = rates.yardAddress || DEFAULT_DEPOT.yardAddress;
  const maps = rates.yardMapsUrl || DEFAULT_DEPOT.yardMapsUrl;
  const rateTxt = (v, suffix) => (v != null && canSeeMoney()) ? `${$$(v)}${suffix} ex GST` : "not set yet";
  if (step === 0) return `<div class="qw-pane">
    <label>Client<input name="client" list="qclients" value="${esc(d.client || "")}" required autocomplete="organization"><datalist id="qclients">${CLIENTS.map(c => `<option value="${esc(c)}">`).join("")}</datalist></label>
    <label class="plc-wrap">Job address<input name="address" value="${esc(d.address || "")}" required autocomplete="street-address" placeholder="${placesEnabled() ? "Start typing to search Google Maps" : "Lot and street"}"></label>
    <p class="sub plc-tag" id="qaddrtag" ${d.addressPlace ? "" : "hidden"}>📍 Matched on Google Maps — travel uses this exact spot.</p>
    <label class="qw-hours">Hours on site<input name="hoursOnSite" type="number" min="0" step="0.25" value="${esc(d.hoursOnSite)}" inputmode="decimal"></label>
    <label class="qw-native">Category<select name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${d.type === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
    <div class="qw-types" role="group" aria-label="Job type">${Object.entries(TYPES).map(([k, v]) => `<button type="button" class="qw-type ${d.type === k ? "on" : ""}" data-type="${esc(k)}" aria-pressed="${d.type === k ? "true" : "false"}"><span class="qw-tick" aria-hidden="true"></span><span>${esc(v)}</span></button>`).join("")}</div>
    <p class="sub">One category per job. Mixed work is still split later, from the job.</p>
    <label>Scope / notes<textarea name="description" rows="2">${esc(d.description || "")}</textarea></label>
  </div>`;
  if (step === 1) {
    const sel = new Set(normalizeMachineIds(d.machines || []));
    const preset = d.presetId || resolvePresetId([...sel]);
    const presets = EQUIPMENT_PRESETS.map(p => {
      const blurb = p.machines.map(id => `${fleetName(id)} and operator`).join(" · ");
      return `<label class="ck qw-preset ${preset === p.id ? "on" : ""}"><input type="radio" name="preset" value="${esc(p.id)}" ${preset === p.id ? "checked" : ""}><span><b>${esc(p.label)}</b><small>${esc(blurb)}</small></span></label>`;
    }).join("");
    // and/or builder mirrors preset: truck + optional skid + optional excavator. Same ids, truck once.
    const builder = `<details class="qw-builder"><summary>Adjust machines</summary>
      <p class="sub">Same machines as the list above. Truck is counted once, and only with a skid steer or excavator.</p>
      <label class="ck"><input type="checkbox" data-mach="truck" ${sel.has("truck") ? "checked" : ""}> Truck</label>
      <label class="ck"><input type="checkbox" data-mach="skid" ${sel.has("skid") ? "checked" : ""}> Skid steer (Bobcat)</label>
      <label class="ck"><input type="checkbox" data-mach="excavator" ${sel.has("excavator") ? "checked" : ""}> Excavator (JCB)</label>
    </details>`;
    const plantBits = canSeeMoney() ? [...sel].map(id => {
      const { rate, unit } = machineRateOf(rates, id);
      return `<div class="sub">${esc(fleetName(id))} + operator: ${rateTxt(rate, unit === "day" ? "/day" : "/h")}</div>`;
    }).join("") : "";
    const truckOnly = isTruckOnly([...sel]);
    return `<div class="qw-pane"><h4>Machine setup</h4>
      <p class="sub">Each machine is included once, with its operator. The truck comes with a skid steer or excavator.</p>
      ${truckOnly ? `<p class="${legacyTruck ? "sub" : "warnt"} qw-legacy">${legacyTruck
        ? "Older truck-only quote — kept as it was. Truck on its own is no longer offered for new quotes."
        : "Truck on its own isn't offered. Add a skid steer or excavator."}</p>` : ""}
      <div class="qw-presets">${presets}</div>
      ${builder}
      <h4 class="qw-labh">Need a labourer?</h4>
      <div class="qw-yn" role="group" aria-label="Need a labourer?">
        <button type="button" class="qw-ynbtn ${d.includeLabourer ? "on" : ""}" data-lab="yes">Yes</button>
        <button type="button" class="qw-ynbtn ${d.includeLabourer ? "" : "on"}" data-lab="no">No</button>
      </div>
      <input type="checkbox" id="qlabourer" class="sr" ${d.includeLabourer ? "checked" : ""}>
      ${canSeeMoney() ? `<p class="sub">Labourer (separate rate): ${rateTxt(rates.labourerRate, rates.labourerUnit === "day" ? "/day" : "/h")}</p>${plantBits}` : `<p class="sub">A labourer is optional and priced separately from the machine.</p>`}
    </div>`;
  }
  const anyDay = (d.machines || []).some(id => machineRateOf(rates, id).unit === "day")
    || (d.includeLabourer && rates.labourerUnit === "day");
  const presetLab = EQUIPMENT_PRESETS.find(p => p.id === calc.presetId)?.label
    || (calc.machines || []).map(fleetName).join(" + ") || "—";
  return `<div class="qw-pane"><h4>Review</h4>
    <p class="sub">Equipment: <b>${esc(presetLab)}</b>${calc.includeLabourer ? " + labourer" : ""} · one job category only</p>
    <details class="qw-extra"><summary>Travel, materials and rubbish</summary>
      <p class="sub">Depot (start): <b>${esc(depot)}</b> · <a href="${esc(maps)}" target="_blank" rel="noopener">Maps link</a>. Calculate travel uses a road distance (OSRM). Straight-line is never filled in as travel km.</p>
      <div class="row gap">
        <label class="ck"><input type="radio" name="travelMode" value="oneway" ${d.travelMode !== "return" ? "checked" : ""}> One-way</label>
        <label class="ck"><input type="radio" name="travelMode" value="return" ${d.travelMode === "return" ? "checked" : ""}> Return (×2)</label>
        <button type="button" class="sm-btn" id="qwcalc">Calculate travel</button>
      </div>
      <p id="qwtravelst" class="sub">${esc(d.travelNote || "")}</p>
      <label>Kilometres (billable)<input name="travelKm" type="number" min="0" step="0.1" value="${esc(d.travelKm)}" inputmode="decimal"></label>
      ${canSeeMoney() ? `<p class="sub">Travel rate: ${rateTxt(rates.travelPerKm, "/km")}</p>` : ""}
      <label>Materials (${esc(rates.materialUnitLabel || "unit")})<input name="materialQty" type="number" min="0" step="0.1" value="${esc(d.materialQty)}" inputmode="decimal"></label>
      ${canSeeMoney() ? `<p class="sub">Materials rate: ${rateTxt(rates.materialPerUnit, " each")}</p>` : ""}
      <label>Rubbish loads<input name="tipLoads" type="number" min="0" step="1" value="${esc(d.tipLoads)}" inputmode="numeric"></label>
      ${canSeeMoney() ? `<p class="sub">Tip rate: ${rateTxt(rates.tipPerLoad, " / load")}</p>` : ""}
      ${anyDay ? `<label>Days (day-rate plant or labourer)<input name="machineDays" type="number" min="1" step="1" value="${esc(d.machineDays || 1)}" inputmode="numeric"></label>
        <p class="sub">Day rates use days, not hours.</p>` : `<input type="hidden" name="machineDays" value="${esc(d.machineDays || 1)}">`}
    </details>
    ${extrasHtml(d, calc, rates, esc, canSeeMoney, $$, isAdmin)}
    ${isAdmin && canSeeMoney() ? overridesHtml(d, calc, esc, $$) : ""}
    ${d.travelNote ? `<p class="sub">${esc(d.travelNote)}</p>` : ""}
    <div class="qw-sum" id="qwsum">${summaryHtml(calc, esc, canSeeMoney, $$)}</div>
    ${canSeeMoney() ? `<div class="row gap qw-custrow"><button type="button" class="sm-btn" id="qwcust">Customer quote (print / PDF)</button></div>` : ""}
    <p class="sub">Accepting creates a pending unscheduled job with this quote, plant selection, labourer flag and extra items preserved. The crew sees amounts, never prices. GST is 10% on the subtotal.</p></div>`;
}

function missingLabel(key, calc) {
  if (key.startsWith("extra:") || key.startsWith("machine:")) {
    const l = calc.lines.find(x => x.key === key);
    return l ? l.label : "extra item";
  }
  return key;
}

function lineAmountHtml(l, esc, canSeeMoney, $$) {
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
function extrasHtml(d, calc, rates, esc, canSeeMoney, $$, isAdmin) {
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
  const rows = items.map((it, i) => `<div class="qx-row" data-xi="${i}" data-kind="${esc(it.kind)}">
      <div class="qx-head"><input class="qx-desc" data-xf="description" value="${esc(it.description)}" placeholder="Description" aria-label="Item ${i + 1} description" maxlength="200">
        <b class="qx-amt" data-xamt="${esc(it.id)}">${lineAmountHtml(lineOf(it), esc, canSeeMoney, $$)}</b></div>
      ${typeField(it, i)}
      <div class="qx-grid">
        <label>${AMOUNT_KINDS.includes(it.kind) ? "Amount" : "Qty"}<input data-xf="qty" type="number" min="0" step="0.1" inputmode="decimal" value="${esc(it.qty)}"></label>
        <label>Unit<select data-xf="unit">${unitOptions(it.kind, it.unit, esc)}</select></label>
        ${money ? `<label>$ / unit ex GST<input data-xf="unitPrice" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(it.unitPrice ?? "")}" placeholder="price"></label>` : ""}
      </div>
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
  return `<details class="qw-extra qx" id="qwextras" ${open}><summary>Extra items${items.length ? ` <span class="cnt">${items.length}</span>` : ""}</summary>
    <p class="sub">Add your own lines on top of the machine and labour. Every price is ex GST and editable${saved.length ? "; ★ are your saved presets" : ""}.</p>
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
      <input data-ov="${esc(l.key)}" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(ov[l.key] ?? "")}" placeholder="${base != null ? esc(base.toFixed(2)) : "price"}" aria-label="Price for ${esc(l.label)}">
      ${ov[l.key] != null ? `<button type="button" class="sm-btn" data-ovreset="${esc(l.key)}">Reset</button>` : ""}</div>`;
  }).join("");
  return `<details class="qw-extra qx" id="qwov" ${d._ovOpen || Object.keys(ov).length ? "open" : ""}><summary>Adjust guided prices${Object.keys(ov).length ? ` <span class="cnt">${Object.keys(ov).length}</span>` : ""}</summary>
    <p class="sub">Admins only. Type a new line price (ex GST) to replace the calculated one; leave blank to keep it.</p>${rows}</details>`;
}

/** Stand-alone customer quote page (print or save as PDF from the browser). Prices only — no internal rates. */
export function customerQuoteHtml(q, calc, org) {
  const e = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const m = v => v == null ? "—" : "$" + Number(v).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const o = org || {};
  const date = (q.dateIso || new Date().toISOString()).slice(0, 10).split("-").reverse().join("/");
  const shown = (calc.lines || []).filter(l => l.amount != null && (l.amount !== 0 || l.extra || l.overridden));
  const rows = shown.map(l => `<tr><td>${e(l.label)}${l.note ? `<div class="n">${e(l.note)}</div>` : ""}</td><td class="r">${m(l.amount)}</td></tr>`).join("");
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quote — ${e(q.client)} — ${e(q.address)}</title>
<style>body{font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1a16;max-width:760px;margin:24px auto;padding:0 18px}
h1{font-size:24px;margin:0 0 2px}.org{color:#5c4e42}.meta{display:grid;grid-template-columns:auto 1fr;gap:2px 14px;margin:18px 0}
.meta b{color:#5c4e42;font-weight:600}table{width:100%;border-collapse:collapse;margin:12px 0}td,th{padding:8px 6px;border-bottom:1px solid #e4dbd0;text-align:left;vertical-align:top}
.r{text-align:right;white-space:nowrap}.n{color:#6b5d50;font-size:13px}tfoot td{border:0;padding:4px 6px}tfoot tr.t td{font-weight:800;font-size:18px;border-top:2px solid #1d1a16;padding-top:8px}
.btn{margin:16px 0;padding:10px 16px;border-radius:10px;border:1px solid #8a5a2b;background:#8a5a2b;color:#fff;font-weight:700}
@media print{.btn{display:none}body{margin:0}}</style></head><body>
<button class="btn" onclick="print()">Print / save as PDF</button>
<h1>Quote</h1><div class="org"><b>${e(o.legalName || o.name || "")}</b>${o.abn ? ` · ABN ${e(o.abn)}` : ""}${o.phone ? ` · ${e(o.phone)}` : ""}${o.email ? ` · ${e(o.email)}` : ""}</div>
<div class="meta"><b>Date</b><span>${e(date)}</span><b>Client</b><span>${e(q.client)}</span><b>Site</b><span>${e(q.address)}</span>
${q.description ? `<b>Scope</b><span>${e(q.description)}</span>` : ""}${q.quoteId ? `<b>Ref</b><span>${e(q.quoteId)}</span>` : ""}</div>
<table><thead><tr><th>Item</th><th class="r">Amount ex GST</th></tr></thead><tbody>${rows || `<tr><td colspan="2">No priced items.</td></tr>`}</tbody>
<tfoot><tr><td class="r">Subtotal ex GST</td><td class="r">${m(calc.subtotalEx)}</td></tr><tr><td class="r">GST (10%)</td><td class="r">${m(calc.gst)}</td></tr>
<tr class="t"><td class="r">Total inc GST</td><td class="r">${m(calc.totalInc)}</td></tr></tfoot></table>
<p class="n">Prices in AUD. ${e(POWERED_BY)}.</p></body></html>`;
}

async function createJobFromQuote(qid, q) {
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
