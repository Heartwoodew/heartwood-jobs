// CallUp guided Quotes (Nov 2026).
// Line items are ex GST. GST is 10% added once on the ex GST subtotal. The quote stores ex GST, GST and inc GST.
// A skid steer or excavator always brings one truck and the primary operator. The truck is not a separate tick.
// Both of those machines: one truck, plus a dual machines surcharge (default $50 ex GST), not a second truck.
// The primary operator sits inside each machine's full setup rate and is not added again.
// A second operator is optional, default $100 ex GST per hour of on-site time, and only when the job needs two operators.
// Choosing both machines does not add the second operator. Admins set rates. Accepted quotes are not rewritten.
// Depot: 208-220 Holdsworth Rd, Chuwar QLD 4306. Travel via Nominatim+OSRM — never straight-line as billable km.
// No GPS in this build.

export const DEFAULT_DEPOT = {
  yardAddress: "208-220 Holdsworth Rd, Chuwar QLD 4306",
  yardMapsUrl: "https://maps.app.goo.gl/w4AX7X6VtPtqH75S7?g_st=ic"
};

export const GST_RATE = 0.1;
export const DEFAULT_DUAL_MACHINE_SURCHARGE = 50;
export const DEFAULT_SECOND_OPERATOR_RATE = 100;

/** Fleet plant from the Heartwood machine register. Rates stay blank until an admin sets them. */
export const FLEET_MACHINES = [
  { id: "truck", name: "Truck", registerName: "Truck", code: "", kind: "truck", requiresTruck: false, builtin: true },
  { id: "skid", name: "Skid steer (Bobcat)", registerName: "Bobcat", code: "CA", kind: "skid", requiresTruck: true, truckLocked: true, builtin: true },
  { id: "excavator", name: "Excavator (JCB)", registerName: "Jcb", code: "EX", kind: "excavator", requiresTruck: true, truckLocked: true, builtin: true }
];

const QUOTING_BUILTINS = FLEET_MACHINES.filter(m => m.id !== "truck");

/** Legacy preset ids still resolve. Truck-only is not a quoting setup. */
const LEGACY_QUOTING = {
  truck: [],
  truck_skid: ["skid"],
  truck_excavator: ["excavator"],
  truck_skid_excavator: ["skid", "excavator"],
  skid: ["skid"],
  excavator: ["excavator"],
  skid_excavator: ["skid", "excavator"]
};

export const EQUIPMENT_PRESETS = [
  { id: "skid", label: "Skid steer", machines: ["truck", "skid"] },
  { id: "excavator", label: "Excavator", machines: ["truck", "excavator"] },
  { id: "skid_excavator", label: "Skid steer and excavator", machines: ["truck", "skid", "excavator"] }
];

const DEFAULT_RATE_KEYS = [
  ["travelPerKm", "Travel $ / km (ex GST)", "km"],
  ["materialPerUnit", "Materials $ / unit (ex GST)", "unit"],
  ["tipPerLoad", "Rubbish / tip $ / load (ex GST)", "load"]
];

const WRITE_KEYS = new Set([
  "travelPerKm", "materialPerUnit", "tipPerLoad", "materialUnitLabel", "tipUnitLabel",
  "yardAddress", "yardMapsUrl", "machineRates", "customMachines",
  "secondOperatorRate", "dualMachineSurcharge", "hourlyOnSite", "updatedAt", "updatedBy"
]);
const BANNED_WRITE_KEYS = new Set(["labourerRate", "labourerUnit", "gst", "gstRate", "totalEx", "totalInc", "price", "truckRate"]);

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";
const geoCache = new Map();

let api = null;

export function installQuotes(a) {
  api = a;
  return {
    calcQuote, DEFAULT_RATE_KEYS, DEFAULT_DEPOT, FLEET_MACHINES, EQUIPMENT_PRESETS,
    GST_RATE, DEFAULT_DUAL_MACHINE_SURCHARGE, DEFAULT_SECOND_OPERATOR_RATE,
    resolvePresetId, machineSelectionFromPreset, resolvePlant, quoteLines, roadDistanceKm,
    sanitizeQuoteRatesWrite, buildAcceptedJob, plantRunSheetLines, quotePrintHtml, roundMoney,
    describeStaff, describeQuote,
    bindAdmin: bindAdminExtras,
    openQuoteWizard, openRatesEditor, refreshQuotes, ensureRates,
    adminViewRouter, quotesViewHtml
  };
}

export function roundMoney(n) {
  const x = +n;
  if (!Number.isFinite(x)) return null;
  const sign = x < 0 ? -1 : 1;
  const cents = Math.round((Math.abs(x) + 1e-8) * 100);
  return sign * cents / 100;
}

function aud(n) {
  if (n == null || Number.isNaN(+n)) return "—";
  return "$" + roundMoney(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function emptyMachineRates() {
  const out = {};
  for (const m of FLEET_MACHINES) out[m.id] = { rate: null, unit: "hour", primaryOperatorRate: null, driver: null };
  return out;
}

function emptyRates() {
  return {
    travelPerKm: null, materialPerUnit: null, tipPerLoad: null,
    hourlyOnSite: null,
    materialUnitLabel: "unit", tipUnitLabel: "load",
    yardAddress: DEFAULT_DEPOT.yardAddress,
    yardMapsUrl: DEFAULT_DEPOT.yardMapsUrl,
    machineRates: emptyMachineRates(),
    customMachines: [],
    secondOperatorRate: DEFAULT_SECOND_OPERATOR_RATE,
    dualMachineSurcharge: DEFAULT_DUAL_MACHINE_SURCHARGE,
    updatedAt: null
  };
}

function numOrNull(v) {
  if (v === "" || v == null || Number.isNaN(+v)) return null;
  return roundMoney(+v);
}

function canEditRates() {
  return typeof api.canEditQuoteRates === "function" ? !!api.canEditQuoteRates() : !!(api.isAdmin && api.isAdmin());
}

export function quotingCatalog(rates) {
  return [...QUOTING_BUILTINS, ...readCustomMachines(rates && rates.customMachines)];
}

export function readCustomMachines(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(FLEET_MACHINES.map(m => m.id));
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.id === "string" ? raw.id : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!/^m_[a-z0-9]{2,32}$/.test(id) || seen.has(id)) continue;
    if (!/^[\p{L}\p{N}][\p{L}\p{N} '&().-]{1,48}$/u.test(name)) continue;
    if (typeof raw.requiresTruck !== "boolean") continue;
    seen.add(id);
    out.push({ id, name, requiresTruck: raw.requiresTruck });
  }
  return out;
}

function cleanDisplayName(name) {
  if (typeof name !== "string") return null;
  const t = name.trim();
  if (!t || t.length > 40 || /[$<>]/.test(t)) return null;
  return t;
}

function mustPositive(n, label) {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) throw new Error(label + " must be a positive amount ex GST");
  return roundMoney(n);
}

function mustMachineName(s) {
  if (typeof s !== "string") throw new Error("Machine name is required");
  const t = s.trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '&().-]{1,48}$/u.test(t)) throw new Error("Use a plain machine name");
  return t;
}

function mustPersonName(s, label) {
  if (typeof s !== "string") throw new Error(label + " is not valid");
  const t = s.trim();
  if (!/^[\p{L}][\p{L} '&().-]{0,39}$/u.test(t)) throw new Error(label + " is not valid");
  return t;
}

function plainLabel(s, fallback, max) {
  if (s == null || s === "") return fallback;
  if (typeof s !== "string") throw new Error("Bad label");
  const t = s.trim();
  if (!t || t.length > max || /[<>]/.test(t)) throw new Error("Bad label");
  return t;
}

function sanitizeMachineRate(id, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Bad rate for " + id);
  for (const k of Object.keys(raw)) {
    if (!["rate", "unit", "primaryOperatorRate", "driver"].includes(k)) throw new Error("Unexpected rate field: " + k);
  }
  const rate = raw.rate == null || raw.rate === "" ? null : mustPositive(raw.rate, id + " setup");
  if (raw.unit != null && raw.unit !== "hour" && raw.unit !== "day") throw new Error("Bad unit for " + id);
  const unit = raw.unit === "day" ? "day" : "hour";
  let portion = null;
  if (raw.primaryOperatorRate != null && raw.primaryOperatorRate !== "") {
    if (id === "truck") throw new Error("The truck rate is the full truck setup. Do not split a truck operator price onto it.");
    portion = mustPositive(raw.primaryOperatorRate, "Primary operator portion");
    if (rate == null || portion > rate) throw new Error("Primary operator portion must sit inside the full setup rate, and is not added again");
  }
  let driver = null;
  if (raw.driver != null && raw.driver !== "") {
    if (id !== "truck") throw new Error("A driver name belongs on the truck");
    driver = mustPersonName(raw.driver, "Driver name");
  }
  return { rate, unit, primaryOperatorRate: portion, driver };
}

/**
 * Admin write for meta/quoteRates. Rejects unknown fields, the old labourer price, a custom GST rate,
 * zero or negative money, and a primary-operator portion that would be charged on top of the setup.
 */
export function sanitizeQuoteRatesWrite(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Quote rates must be an object");
  for (const k of Object.keys(input)) {
    if (BANNED_WRITE_KEYS.has(k)) throw new Error("Field not allowed: " + k);
    if (!WRITE_KEYS.has(k)) throw new Error("Unexpected field: " + k);
  }
  const custom = [];
  const seen = new Set(FLEET_MACHINES.map(m => m.id));
  if (input.customMachines != null) {
    if (!Array.isArray(input.customMachines)) throw new Error("Machines must be a list");
    for (const raw of input.customMachines) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Bad machine");
      for (const k of Object.keys(raw)) {
        if (!["id", "name", "requiresTruck"].includes(k)) throw new Error("Unexpected machine field: " + k);
      }
      const id = raw.id;
      const name = mustMachineName(raw.name);
      if (typeof id !== "string" || !/^m_[a-z0-9]{2,32}$/.test(id) || seen.has(id)) throw new Error("Machine id is not allowed");
      if (typeof raw.requiresTruck !== "boolean") throw new Error("Say whether the machine needs the truck");
      seen.add(id);
      custom.push({ id, name, requiresTruck: raw.requiresTruck });
    }
  }
  const machineRates = {};
  const incoming = input.machineRates || {};
  if (input.machineRates != null && (typeof incoming !== "object" || Array.isArray(incoming))) throw new Error("Bad machine rates");
  for (const id of Object.keys(incoming)) {
    if (!seen.has(id)) throw new Error("Unknown machine rate: " + id);
  }
  for (const id of seen) machineRates[id] = sanitizeMachineRate(id, incoming[id] || { rate: null, unit: "hour" });
  const second = input.secondOperatorRate == null || input.secondOperatorRate === ""
    ? DEFAULT_SECOND_OPERATOR_RATE
    : mustPositive(input.secondOperatorRate, "Second operator rate");
  const dual = input.dualMachineSurcharge == null || input.dualMachineSurcharge === ""
    ? DEFAULT_DUAL_MACHINE_SURCHARGE
    : mustPositive(input.dualMachineSurcharge, "Dual machines surcharge");
  const moneyKey = key => (input[key] == null || input[key] === "" ? null : mustPositive(input[key], key));
  return {
    travelPerKm: moneyKey("travelPerKm"),
    materialPerUnit: moneyKey("materialPerUnit"),
    tipPerLoad: moneyKey("tipPerLoad"),
    materialUnitLabel: plainLabel(input.materialUnitLabel, "unit", 24),
    tipUnitLabel: plainLabel(input.tipUnitLabel, "load", 24),
    yardAddress: plainLabel(input.yardAddress, DEFAULT_DEPOT.yardAddress, 160),
    yardMapsUrl: plainLabel(input.yardMapsUrl, DEFAULT_DEPOT.yardMapsUrl, 240),
    machineRates,
    customMachines: custom,
    secondOperatorRate: second,
    dualMachineSurcharge: dual,
    hourlyOnSite: null,
    ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt } : {}),
    ...(input.updatedBy !== undefined ? { updatedBy: typeof input.updatedBy === "string" ? input.updatedBy : null } : {})
  };
}

function mergeMachineRates(stored, custom) {
  const ids = [...FLEET_MACHINES.map(m => m.id), ...(custom || []).map(m => m.id)];
  const out = {};
  for (const id of ids) {
    const s = stored && stored[id] && typeof stored[id] === "object" ? stored[id] : {};
    const rate = s.rate != null && s.rate !== "" && Number.isFinite(+s.rate) && +s.rate > 0 ? roundMoney(+s.rate) : null;
    let portion = s.primaryOperatorRate != null && s.primaryOperatorRate !== "" && Number.isFinite(+s.primaryOperatorRate) && +s.primaryOperatorRate > 0
      ? roundMoney(+s.primaryOperatorRate) : null;
    if (id === "truck" || portion == null || rate == null || portion > rate) portion = null;
    out[id] = {
      rate,
      unit: s.unit === "day" ? "day" : "hour",
      primaryOperatorRate: portion,
      driver: id === "truck" ? cleanDisplayName(s.driver) : null
    };
  }
  return out;
}

export function secondOperatorRateOf(rates) {
  const n = rates && rates.secondOperatorRate;
  if (n == null || n === "" || !Number.isFinite(+n) || +n <= 0) return DEFAULT_SECOND_OPERATOR_RATE;
  return roundMoney(+n);
}

export function dualSurchargeOf(rates) {
  const n = rates && rates.dualMachineSurcharge;
  if (n == null || n === "" || !Number.isFinite(+n) || +n <= 0) return DEFAULT_DUAL_MACHINE_SURCHARGE;
  return roundMoney(+n);
}

function machineRateOf(rates, id) {
  const mr = (rates && rates.machineRates && rates.machineRates[id]) || {};
  const rate = mr.rate != null && mr.rate !== "" && Number.isFinite(+mr.rate) ? roundMoney(+mr.rate) : null;
  let portion = mr.primaryOperatorRate != null && Number.isFinite(+mr.primaryOperatorRate) ? roundMoney(+mr.primaryOperatorRate) : null;
  if (id === "truck" || portion == null || portion <= 0 || rate == null || portion > rate) portion = null;
  return {
    rate: rate != null && rate > 0 ? rate : null,
    unit: mr.unit === "day" ? "day" : "hour",
    primaryOperatorRate: portion,
    driver: id === "truck" ? cleanDisplayName(mr.driver) : null
  };
}

export function resolvePlant(inputs, rates) {
  const catalog = quotingCatalog(rates);
  const byId = new Map(catalog.map(m => [m.id, m]));
  let raw = (inputs && (inputs.machines || inputs.machineIds)) || [];
  if ((!raw || !raw.length) && inputs && inputs.presetId && Object.prototype.hasOwnProperty.call(LEGACY_QUOTING, inputs.presetId)) {
    raw = LEGACY_QUOTING[inputs.presetId];
  }
  const chosen = [];
  for (const id of raw) {
    if (id === "truck") continue;
    if (byId.has(id) && !chosen.includes(id)) chosen.push(id);
  }
  const order = catalog.map(m => m.id);
  chosen.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const setups = chosen.map(id => {
    const m = byId.get(id);
    return {
      id: m.id,
      machineId: m.id,
      name: m.name,
      requiresTruck: !!m.requiresTruck,
      operatorId: m.id + ":operator",
      truckId: m.requiresTruck ? "truck" : null,
      truckOperatorId: m.requiresTruck ? "truck:operator" : null
    };
  });
  const needsTruck = setups.some(s => s.requiresTruck);
  const hasSkid = setups.some(s => s.id === "skid");
  const hasEx = setups.some(s => s.id === "excavator");
  const dualMachines = hasSkid && hasEx;
  const secondOperator = !!(inputs && (inputs.secondOperator || inputs.includeLabourer || inputs.needsSecondOperator));
  const driverName = machineRateOf(rates, "truck").driver;
  const operators = setups.map(s => ({
    id: s.operatorId, machineId: s.machineId, role: "operator", primary: true, name: null
  }));
  if (needsTruck) operators.push({ id: "truck:operator", machineId: "truck", role: "driver", primary: false, name: driverName });
  if (secondOperator) operators.push({ id: "second:operator", machineId: null, role: "second-operator", primary: false, name: null });
  let presetId = null;
  if (hasSkid && hasEx) presetId = "skid_excavator";
  else if (hasSkid) presetId = "skid";
  else if (hasEx) presetId = "excavator";
  return {
    setups, operators,
    machines: [...(needsTruck ? ["truck"] : []), ...setups.map(s => s.id)],
    presetId,
    truckId: needsTruck ? "truck" : null,
    truckCount: needsTruck ? 1 : 0,
    driverName,
    dualMachines,
    dualSurchargeExGst: dualMachines ? dualSurchargeOf(rates) : 0,
    secondOperator,
    secondOperatorRate: secondOperator ? secondOperatorRateOf(rates) : 0
  };
}

export function resolvePresetId(machineIds, rates) {
  return resolvePlant({ machines: machineIds }, rates || {}).presetId;
}

export function machineSelectionFromPreset(presetId) {
  if (!Object.prototype.hasOwnProperty.call(LEGACY_QUOTING, presetId)) return [];
  return resolvePlant({ machines: LEGACY_QUOTING[presetId] }, {}).machines;
}

function fleetName(id, rates) {
  return quotingCatalog(rates).find(m => m.id === id)?.name || FLEET_MACHINES.find(m => m.id === id)?.name || id;
}

function truckWords(plant) {
  return plant.driverName ? `Truck + ${plant.driverName}` : "Truck + operator";
}

/** Customer quote sentences. Includes the dual surcharge amount. Not for the staff run sheet. */
export function describeQuote(plant) {
  if (!plant || !plant.setups || !plant.setups.length) return [];
  const truck = truckWords(plant);
  const lines = [];
  for (const s of plant.setups) {
    if (s.requiresTruck) lines.push(`${s.name}: primary operator is inside the setup rate. ${truck} is attached and billed once.`);
    else lines.push(`${s.name}: primary operator is inside the setup rate. This machine does not use the truck.`);
  }
  const truckUsers = plant.setups.filter(s => s.requiresTruck).length;
  if (truckUsers > 1) lines.push(`${truck} is billed once for these machines, not a second time.`);
  if (plant.dualMachines) {
    lines.push(`Dual machines surcharge: ${aud(plant.dualSurchargeExGst)} ex GST for both the skid steer and the excavator. This is the extra for both machines, not a second truck.`);
  }
  lines.push(plant.secondOperator
    ? `Second operator: ${aud(plant.secondOperatorRate)} ex GST per hour for the hours on site, before GST. Added only because two operators are required.`
    : "Second operator: not required. Selecting both machines does not add one.");
  return lines;
}

/** Staff run sheet. Required machines and operators only — no prices and no surcharge. */
export function describeStaff(plant) {
  if (!plant || !plant.setups || !plant.setups.length) return [];
  const lines = [];
  const driver = plant.driverName ? `Truck driver: ${plant.driverName}` : "Truck operator included";
  for (const s of plant.setups) {
    if (s.requiresTruck) lines.push(`${s.name}: primary operator included. ${driver}.`);
    else lines.push(`${s.name}: primary operator included. This machine does not use the truck.`);
  }
  const truckUsers = plant.setups.filter(s => s.requiresTruck).length;
  if (truckUsers > 1) lines.push("One truck is shared by these machines, not a second truck.");
  else if (truckUsers === 1) lines.push("The truck is included once with this machine.");
  if (plant.dualMachines) lines.push("Both the skid steer and excavator are required.");
  lines.push(plant.secondOperator ? "Second operator required." : "Second operator not required.");
  return lines;
}

export function plantFromJob(job) {
  if (!job || !Array.isArray(job.setups) || !job.setups.length) return null;
  const driverName = cleanDisplayName(((job.operators || []).find(o => o.id === "truck:operator") || {}).name);
  const needsTruck = job.setups.some(s => s.requiresTruck) || (job.machines || []).includes("truck");
  return {
    setups: job.setups,
    operators: job.operators || [],
    machines: job.machines || [],
    presetId: job.presetId || null,
    truckId: needsTruck ? "truck" : null,
    truckCount: needsTruck ? 1 : 0,
    driverName,
    dualMachines: !!job.dualMachines,
    dualSurchargeExGst: job.dualMachines ? dualSurchargeOf({ dualMachineSurcharge: job.dualSurchargeExGst }) : 0,
    secondOperator: !!job.secondOperator,
    secondOperatorRate: job.secondOperator ? secondOperatorRateOf({ secondOperatorRate: job.secondOperatorRate }) : 0
  };
}

export function plantRunSheetLines(job) {
  const plant = plantFromJob(job);
  return plant ? describeStaff(plant) : [];
}

function pushLine(lines, row) {
  lines.push({ ...row, exGst: true, amount: row.amount == null ? null : roundMoney(row.amount) });
}

/**
 * Quote math. Every line is ex GST.
 * GST is round(subtotal ex GST × 10%, 2dp) once. It is not added per line and not added again on the inc GST total.
 * Truck is attached once for machines that need it. Both skid and excavator add the dual surcharge instead of a second truck.
 * Primary operator is inside the machine setup rate. Second operator is hours × the second-operator rate, only when requested.
 */
export function calcQuote(inputs, rates) {
  const src = inputs || {};
  const plant = resolvePlant(src, rates);
  const r = rates || {};
  const travelKm = Math.max(0, +src.travelKm || 0);
  const hours = Math.max(0, +src.hoursOnSite || 0);
  const machineDays = Math.max(0, +src.machineDays || 0) || (src.machineDays === 0 ? 0 : 1);
  const matQty = Math.max(0, +src.materialQty || 0);
  const tipLoads = Math.max(0, +src.tipLoads || 0);
  const lines = [];

  pushLine(lines, {
    key: "travel", label: `Travel ${travelKm} km`, qty: travelKm, rate: r.travelPerKm != null ? roundMoney(+r.travelPerKm) : null,
    unit: "km", amount: r.travelPerKm != null ? travelKm * r.travelPerKm : null
  });

  for (const setup of plant.setups) {
    const mr = machineRateOf(r, setup.machineId);
    const qty = mr.unit === "day" ? machineDays : hours;
    const unitLab = mr.unit === "day" ? "day" : "h";
    const detail = mr.primaryOperatorRate != null
      ? `Includes primary operator ${aud(mr.primaryOperatorRate)} ex GST inside this setup (not added again).`
      : "Primary operator is inside this setup rate (not added again).";
    pushLine(lines, {
      key: "machine:" + setup.machineId,
      machineId: setup.machineId,
      setupId: setup.id,
      operatorId: setup.operatorId,
      label: `${setup.name} + primary operator (${qty} ${unitLab})`,
      detail, qty, rate: mr.rate, unit: mr.unit,
      amount: mr.rate != null ? qty * mr.rate : null
    });
  }

  if (plant.truckId) {
    const mr = machineRateOf(r, "truck");
    const qty = mr.unit === "day" ? machineDays : hours;
    const unitLab = mr.unit === "day" ? "day" : "h";
    pushLine(lines, {
      key: "machine:truck",
      machineId: "truck",
      operatorId: "truck:operator",
      label: `${truckWords(plant)} (${qty} ${unitLab})`,
      detail: "Attached to the machine and billed once. Not a second truck.",
      qty, rate: mr.rate, unit: mr.unit,
      amount: mr.rate != null ? qty * mr.rate : null
    });
  }

  if (plant.dualMachines) {
    const rate = plant.dualSurchargeExGst;
    pushLine(lines, {
      key: "dual",
      label: "Dual machines surcharge (skid steer and excavator, not a second truck)",
      detail: "Extra for both machines, ex GST, instead of a second truck.",
      qty: 1, rate, unit: "job", amount: rate
    });
  }

  if (plant.secondOperator) {
    const rate = plant.secondOperatorRate;
    pushLine(lines, {
      key: "second",
      operatorId: "second:operator",
      label: `Second operator (${hours} h)`,
      detail: "Only because this job needs two operators. Ex GST per hour, before GST.",
      qty: hours, rate, unit: "hour", amount: hours * rate
    });
  }

  if (!plant.setups.length && !plant.secondOperator) {
    const rate = r.hourlyOnSite != null ? roundMoney(+r.hourlyOnSite) : null;
    pushLine(lines, {
      key: "time", label: `Time on site ${hours} h`, qty: hours, rate, unit: "hour",
      amount: rate != null ? hours * rate : null
    });
  }

  pushLine(lines, {
    key: "materials", label: `Materials (${matQty} ${r.materialUnitLabel || "unit"})`, qty: matQty,
    rate: r.materialPerUnit != null ? roundMoney(+r.materialPerUnit) : null, unit: "unit",
    amount: r.materialPerUnit != null ? matQty * r.materialPerUnit : null
  });
  pushLine(lines, {
    key: "rubbish", label: `Rubbish removed (${tipLoads} ${r.tipUnitLabel || "load"})`, qty: tipLoads,
    rate: r.tipPerLoad != null ? roundMoney(+r.tipPerLoad) : null, unit: "load",
    amount: r.tipPerLoad != null ? tipLoads * r.tipPerLoad : null
  });

  const missingRates = lines.filter(l => l.qty > 0 && l.rate == null).map(l => l.key);
  const totalEx = missingRates.length ? null : roundMoney(lines.reduce((t, l) => t + (l.amount || 0), 0));
  const gst = totalEx == null ? null : roundMoney(totalEx * GST_RATE);
  const totalInc = totalEx == null || gst == null ? null : roundMoney(totalEx + gst);
  return {
    lines, totalEx, gst, totalInc, gstRate: GST_RATE,
    missingRates, travelKm, hours, machineDays, matQty, tipLoads,
    machines: plant.machines, secondOperator: plant.secondOperator, dualMachines: plant.dualMachines,
    presetId: plant.presetId, plant,
    complete: !missingRates.length,
    gstNote: totalEx == null ? "" : `GST is 10% of ${aud(totalEx)} ex GST = ${aud(gst)}, added once. Total inc GST ${aud(totalInc)}.`
  };
}

function quoteLines(calc) { return calc.lines; }

export function quotePrintHtml(calc, info = {}) {
  const rows = (calc.lines || []).map(l => {
    const amt = l.amount == null ? "—" : aud(l.amount);
    const rate = l.rate == null ? "" : `${l.qty} × ${aud(l.rate)} ex GST`;
    return `<tr><td>${escHtml(l.label)}${l.detail ? `<div class="muted">${escHtml(l.detail)}</div>` : ""}</td><td>${escHtml(rate)}</td><td>${escHtml(amt)}</td></tr>`;
  }).join("");
  const ready = calc.totalEx != null && calc.gst != null && calc.totalInc != null;
  const totals = ready ? `<tr><td>Subtotal ex GST</td><td></td><td>${aud(calc.totalEx)}</td></tr>
    <tr><td>GST 10%</td><td>${aud(calc.totalEx)} × 10%, once</td><td>${aud(calc.gst)}</td></tr>
    <tr class="grand"><td>Total inc GST</td><td></td><td>${aud(calc.totalInc)}</td></tr>` : `<tr><td colspan="3">Totals need a rate on every line that is used.</td></tr>`;
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>Heartwood quote</title>
    <style>body{font:15px/1.4 system-ui,sans-serif;color:#2b2118;background:#fff;margin:24px}h1{font-size:22px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:16px}td{border-bottom:1px solid #eadfd3;padding:8px 6px;vertical-align:top}td:last-child,td:nth-child(2){text-align:right;white-space:nowrap}.grand td{font-weight:800;font-size:18px}.muted{color:#5c4e42;font-size:13px}</style></head>
    <body><h1>Heartwood quote</h1><p>${escHtml(info.client || "")}<br>${escHtml(info.address || "")}</p>
    <p class="muted">${escHtml(info.description || "")}</p>
    <p class="muted">Line amounts are ex GST. GST is 10% of the ex GST subtotal, added once, including travel, materials, rubbish, machines, the truck and any dual machines surcharge or second operator.</p>
    <table><tbody>${rows}${totals}</tbody></table>
    ${ready ? `<p>${escHtml(calc.gstNote || "")}</p>` : ""}</body></html>`;
}

export function buildAcceptedJob(qid, q, actor = {}) {
  const plant = q.plant || resolvePlant(q, q.ratesSnapshot || {});
  const staff = describeStaff(plant);
  const scope = q.scopeNotes != null ? q.scopeNotes : (q.description || "");
  const description = [scope, ...staff].filter(Boolean).join("\n");
  return {
    client: q.client, address: q.address, type: q.type || "other",
    description, scopeNotes: scope,
    date: "", time: "", durationHrs: +q.hoursOnSite > 0 ? +q.hoursOnSite : null,
    status: "Scheduled", assigned: [], assignedNames: [],
    source: "quote", quoteId: qid, quoteStatus: "Accepted",
    machines: plant.machines, setups: plant.setups, operators: plant.operators, presetId: plant.presetId,
    secondOperator: !!plant.secondOperator,
    dualMachines: !!plant.dualMachines,
    dualSurchargeExGst: plant.dualMachines ? plant.dualSurchargeExGst : 0,
    secondOperatorRate: plant.secondOperator ? plant.secondOperatorRate : null,
    quote: {
      travelKm: q.travelKm || 0, hoursOnSite: q.hoursOnSite || 0, machineDays: q.machineDays || 1,
      materialQty: q.materialQty || 0, tipLoads: q.tipLoads || 0,
      machines: plant.machines, setups: plant.setups, operators: plant.operators,
      presetId: plant.presetId, secondOperator: !!plant.secondOperator, dualMachines: !!plant.dualMachines,
      lines: q.lines || [], totalEx: q.totalEx, gst: q.gst, totalInc: q.totalInc, gstRate: GST_RATE,
      travelMode: q.travelMode || "oneway", travelNote: q.travelNote || "",
      yardAddress: q.yardAddress || DEFAULT_DEPOT.yardAddress,
      ratesSnapshot: q.ratesSnapshot || null
    },
    quoteAmount: q.totalEx, poAmount: q.totalEx,
    poAmountBasis: "accepted quote (ex GST)", poAmountSource: "quote",
    log: [], editedInApp: true, updatedBy: actor.uid || null
  };
}

function ratesSnapshotFrom(rates) {
  const custom = readCustomMachines(rates.customMachines);
  return sanitizeQuoteRatesWrite({
    travelPerKm: rates.travelPerKm ?? null,
    materialPerUnit: rates.materialPerUnit ?? null,
    tipPerLoad: rates.tipPerLoad ?? null,
    materialUnitLabel: rates.materialUnitLabel || "unit",
    tipUnitLabel: rates.tipUnitLabel || "load",
    yardAddress: rates.yardAddress || DEFAULT_DEPOT.yardAddress,
    yardMapsUrl: rates.yardMapsUrl || DEFAULT_DEPOT.yardMapsUrl,
    machineRates: mergeMachineRates(rates.machineRates, custom),
    customMachines: custom,
    secondOperatorRate: secondOperatorRateOf(rates),
    dualMachineSurcharge: dualSurchargeOf(rates),
    hourlyOnSite: null
  });
}

async function ensureRates(force) {
  const ui = api.getUi();
  if (ui.quoteRates && !force) return ui.quoteRates;
  try {
    const s = await api.getDoc(api.doc(api.db, "meta", "quoteRates"));
    const data = s.exists() ? s.data() : {};
    const custom = readCustomMachines(data.customMachines);
    ui.quoteRates = {
      ...emptyRates(),
      ...data,
      customMachines: custom,
      machineRates: mergeMachineRates(data.machineRates, custom),
      secondOperatorRate: secondOperatorRateOf(data),
      dualMachineSurcharge: dualSurchargeOf(data),
      hourlyOnSite: null
    };
    delete ui.quoteRates.labourerRate;
    delete ui.quoteRates.labourerUnit;
    if (!ui.quoteRates.yardAddress) ui.quoteRates.yardAddress = DEFAULT_DEPOT.yardAddress;
    if (!ui.quoteRates.yardMapsUrl) ui.quoteRates.yardMapsUrl = DEFAULT_DEPOT.yardMapsUrl;
  } catch {
    ui.quoteRates = emptyRates();
  }
  return ui.quoteRates;
}

async function refreshQuotes() {
  const { getDocs, collection, db, getUi } = api;
  try {
    const s = await getDocs(collection(db, "quotes"));
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
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "HeartwoodCallUp-Quotes/1.0 (alex@heartwoodew.com)" } });
    if (!res.ok) return null;
    const arr = await res.json();
    const hit = arr[0] ? { lat: +arr[0].lat, lng: +arr[0].lon } : null;
    geoCache.set(key, hit);
    try { if (hit) localStorage.setItem("hwQuoteGeo:" + key, JSON.stringify(hit)); } catch {}
    return hit;
  } catch { return null; }
}

/** One-way road distance in km via OSRM, or null if routing unavailable. Never uses straight-line. */
export async function roadDistanceKm(fromAddress, toAddress) {
  const a = await geocodeAu(fromAddress);
  const b = await geocodeAu(toAddress);
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

function equipmentLabel(q) {
  const plant = Array.isArray(q.setups) && q.setups.length ? plantFromJob(q) : resolvePlant(q, {});
  if (!plant.setups.length) return "";
  const names = plant.setups.map(s => s.name).join(" and ");
  const truck = plant.truckCount ? " · truck included once" : "";
  const dual = plant.dualMachines ? " · dual machines surcharge" : "";
  const sec = plant.secondOperator ? " · second operator" : "";
  return names + truck + dual + sec;
}

export function quotesViewHtml(ui, esc, $$, helpers = {}) {
  const rates = ui.quoteRates || emptyRates();
  const list = (ui.quotes || []).slice().sort((a, b) => String(b.updatedAtIso || "").localeCompare(String(a.updatedAtIso || "")));
  const drafts = list.filter(q => q.quoteStatus === "Draft");
  const accepted = list.filter(q => q.quoteStatus === "Accepted").slice(0, 30);
  const catalog = quotingCatalog(rates);
  const plantMissing = catalog.some(m => machineRateOf(rates, m.id).rate == null) || machineRateOf(rates, "truck").rate == null;
  const rateWarn = DEFAULT_RATE_KEYS.some(([k]) => rates[k] == null) || plantMissing;
  const editRates = helpers.canEditQuoteRates != null ? helpers.canEditQuoteRates() : canEditRates();
  const moneyEx = v => (v != null && $$) ? `${esc($$(v))} <span class="sub">ex GST</span>` : `<span class="unal">incomplete</span>`;
  const moneyInc = v => (v != null && $$) ? `${esc($$(v))} <span class="sub">inc GST</span>` : "";
  const row = q => `<tr class="jr" data-qid="${esc(q.id)}"><td><span class="qpill ${q.quoteStatus === "Draft" ? "q-quote" : "q-wo"}">${esc(q.quoteStatus)}</span></td>
    <td><b>${esc(q.client || "")}</b><div class="sub">${esc(q.address || "")}</div><div class="sub">${esc(equipmentLabel(q))}</div></td>
    <td>${esc(q.description || q.type || "")}</td>
    <td>${q.totalInc != null ? `${moneyInc(q.totalInc)}<div class="sub">${moneyEx(q.totalEx)}</div>` : (q.totalEx != null ? moneyEx(q.totalEx) : `<span class="unal">rates needed</span>`)}</td>
    <td>${q.quoteStatus === "Draft" ? `<button type="button" class="sm-btn" data-qaccept="${esc(q.id)}">Accept → job</button>` : `<span class="sub">Job ${esc(q.jobId || "—")}</span>`}</td></tr>`;
  return `<div class="sm-head"><h1>Quotes</h1>
    <div class="row gap"><button type="button" class="sm-btn primary" id="newquote">＋ New quote</button>
    ${editRates ? `<button type="button" class="sm-btn" id="editrates">Quote rates &amp; machines</button>` : `<span class="sub pad">Rates are set by an admin · depot ${esc(rates.yardAddress || DEFAULT_DEPOT.yardAddress)}</span>`}</div></div>
    <p class="pad sub">Three steps: job details, machine setup, then review. A skid steer or excavator includes the truck and the primary operator. Both of those machines add a dual machines surcharge instead of a second truck. A second operator is only added when the job needs two. Review shows ex GST, 10% GST once, and the total inc GST. Accepting creates an unscheduled job. Admins and supervisors only.</p>
    <p class="pad sub">Depot (travel start): <b>${esc(rates.yardAddress || DEFAULT_DEPOT.yardAddress)}</b>
      · <a href="${esc(rates.yardMapsUrl || DEFAULT_DEPOT.yardMapsUrl)}" target="_blank" rel="noopener">Maps</a>
      · Second operator default ${esc(aud(secondOperatorRateOf(rates)))} ex GST / hour · Dual machines ${esc(aud(dualSurchargeOf(rates)))} ex GST</p>
    ${rateWarn ? `<p class="pad warnt">Set machine setup rates, travel, materials and tip before accepting. Nothing is invented for those. GST is 10% once on the ex GST subtotal.</p>` : ""}
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

function machineIdFromName(name, taken) {
  let base = "m_" + String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20);
  if (base.length < 4) base = "m_machine";
  let id = base;
  let n = 2;
  while (taken.has(id)) id = (base + n++).slice(0, 34);
  return id;
}

function openRatesEditor() {
  if (!canEditRates()) return api.toast("Only an admin can change quote rates");
  const { $, esc, toast, db, doc, setDoc, serverTimestamp, getUi, renderAdmin, getMe } = api;
  const me = getMe();
  ensureRates(false).then(rates => {
    const custom = readCustomMachines(rates.customMachines);
    const mr = mergeMachineRates(rates.machineRates, custom);
    const d = $("#dlg"); d.className = ""; d.onclose = () => renderAdmin();
    const builtinFields = FLEET_MACHINES.map(m => {
      const cur = mr[m.id];
      const lock = m.truckLocked ? `<p class="sub">The truck is always attached to this machine and cannot be removed. The rate is the full setup, including the primary operator, ex GST.</p>` : `<p class="sub">Billed once when a selected machine needs the truck. Leave the driver blank if you do not know who drives it.</p>`;
      const portion = m.id === "truck" ? "" : `<label>Primary operator portion $ (ex GST, optional)<input name="op_${m.id}" type="number" step="0.01" min="0.01" value="${esc(cur.primaryOperatorRate ?? "")}"><span class="sub">Inside the setup rate. It is not added again. Example: excavator operator $60 inside the full hourly setup.</span></label>`;
      const driver = m.id === "truck" ? `<label>Driver name, if known<input name="truckDriver" value="${esc(cur.driver || "")}" autocomplete="name"></label>` : "";
      return `<fieldset class="qw-machrate"><legend>${esc(m.name)}${m.code ? ` (${esc(m.code)})` : ""}</legend>
        ${lock}
        <label>Full setup $ / ${cur.unit === "day" ? "day" : "hour"} (ex GST)<input name="mr_${m.id}" type="number" step="0.01" min="0.01" value="${esc(cur.rate ?? "")}"></label>
        <label>Unit<select name="mu_${m.id}"><option value="hour" ${cur.unit !== "day" ? "selected" : ""}>Per hour</option><option value="day" ${cur.unit === "day" ? "selected" : ""}>Per day</option></select></label>
        ${portion}${driver}
      </fieldset>`;
    }).join("");
    const customFields = custom.map(m => {
      const cur = mr[m.id] || { rate: null, unit: "hour", primaryOperatorRate: null };
      return `<fieldset class="qw-machrate" data-custom="${esc(m.id)}" data-name="${esc(m.name)}" data-truck="${m.requiresTruck ? "1" : "0"}">
        <legend>${esc(m.name)}</legend>
        <p class="sub">${m.requiresTruck ? "Needs the truck. The truck rate above is used, once for the job. This machine does not have its own truck price." : "Does not use the truck, so no truck charge is added."}</p>
        <label>Full setup $ (ex GST)<input name="mr_${esc(m.id)}" type="number" step="0.01" min="0.01" value="${esc(cur.rate ?? "")}"></label>
        <label>Unit<select name="mu_${esc(m.id)}"><option value="hour" ${cur.unit !== "day" ? "selected" : ""}>Per hour</option><option value="day" ${cur.unit === "day" ? "selected" : ""}>Per day</option></select></label>
        <label>Primary operator portion $ (ex GST, optional)<input name="op_${esc(m.id)}" type="number" step="0.01" min="0.01" value="${esc(cur.primaryOperatorRate ?? "")}"></label>
        <button type="button" class="sm-btn" data-drop-machine="${esc(m.id)}">Remove from future quotes</button>
      </fieldset>`;
    }).join("");
    d.innerHTML = `<form method="dialog" id="qrf" class="jf"><h2>Quote rates and machines</h2>
      <p class="sub">Stored in <code>meta/quoteRates</code>. Amounts are ex GST. GST at 10% is added once when a quote is reviewed, not here. Accepted quotes keep the rates they were accepted with.</p>
      <h3>Truck, skid steer, excavator</h3>
      <p class="sub">Skid steer and excavator always include this truck and a primary operator. Both together add the dual machines surcharge instead of a second truck.</p>
      ${builtinFields}
      <h3>Dual machines surcharge</h3>
      <label>Extra when both skid steer and excavator are chosen, ex GST<input id="dualsurcharge" name="dualMachineSurcharge" type="number" step="0.01" min="0.01" value="${esc(dualSurchargeOf(rates))}"></label>
      <p class="sub">Default $50 ex GST. This is not a second truck. It is included once in the ex GST subtotal, then GST is added once.</p>
      <h3>Second operator</h3>
      <label>Second operator $ / hour (ex GST)<input id="secondrate" name="secondOperatorRate" type="number" step="0.01" min="0.01" value="${esc(secondOperatorRateOf(rates))}"></label>
      <p class="sub">Default $100 ex GST per hour on site. Charged only when the quote says the job needs two operators. Both machines do not add this on their own. The primary operator stays inside each machine setup.</p>
      <h3>Add a machine</h3>
      <p class="sub">Name it, set the full setup rate (that rate includes the primary operator), and say if it needs the truck. Do not type a truck price on the machine.</p>
      <label>Name<input name="newName" maxlength="48" autocomplete="off"></label>
      <label>Full setup $ (ex GST)<input name="newRate" type="number" step="0.01" min="0.01"></label>
      <label>Primary operator portion $ (ex GST, optional)<input name="newPortion" type="number" step="0.01" min="0.01"></label>
      <label>Unit<select name="newUnit"><option value="hour">Per hour</option><option value="day">Per day</option></select></label>
      <label>Does this machine need the truck?<select name="newTruck" id="newTruck"><option value="">Choose</option><option value="yes">Yes — attach the truck</option><option value="no">No truck</option></select></label>
      <p class="sub" id="newtruckhelp">Choose whether the truck is attached. Yes uses the truck rate above, once. No does not add a truck charge.</p>
      <button type="button" class="sm-btn" id="addmachine">Add this machine</button>
      <div id="customlist">${customFields}</div>
      <h3>Travel, materials, tip</h3>
      ${DEFAULT_RATE_KEYS.map(([k, lab]) => `<label>${esc(lab)}<input name="${k}" type="number" step="0.01" min="0.01" value="${esc(rates[k] ?? "")}"></label>`).join("")}
      <label>Materials unit label<input name="materialUnitLabel" value="${esc(rates.materialUnitLabel || "unit")}"></label>
      <label>Rubbish unit label<input name="tipUnitLabel" value="${esc(rates.tipUnitLabel || "load")}"></label>
      <h3>Depot</h3>
      <label>Depot / yard address<input name="yardAddress" value="${esc(rates.yardAddress || DEFAULT_DEPOT.yardAddress)}"></label>
      <label>Depot Maps link (optional)<input name="yardMapsUrl" value="${esc(rates.yardMapsUrl || DEFAULT_DEPOT.yardMapsUrl)}"></label>
      <div class="btns"><button value="cancel" formnovalidate class="ghost">Cancel</button><button value="save" class="primary">Save</button></div></form>`;
    d.showModal();
    const help = $("#newtruckhelp");
    $("#newTruck").onchange = () => {
      help.textContent = $("#newTruck").value === "yes"
        ? "The truck and its operator come from the truck rate above and are billed once for the job. You are not setting a second truck price."
        : $("#newTruck").value === "no"
          ? "This machine will not add a truck charge."
          : "Choose whether the truck is attached. Yes uses the truck rate above, once. No does not add a truck charge.";
    };
    const taken = () => new Set([...FLEET_MACHINES.map(m => m.id), ...[...d.querySelectorAll("[data-custom]")].map(el => el.dataset.custom)]);
    $("#addmachine").onclick = () => {
      const f = $("#qrf");
      const name = f.newName.value.trim();
      const rate = numOrNull(f.newRate.value);
      const portion = numOrNull(f.newPortion.value);
      const truck = f.newTruck.value;
      if (!name || rate == null || !truck) { toast("Name, a positive setup rate, and a truck choice are required"); return; }
      if (portion != null && portion > rate) { toast("Primary operator portion must sit inside the setup rate"); return; }
      let id;
      try { id = machineIdFromName(mustMachineName(name), taken()); } catch (e) { toast(e.message); return; }
      const box = document.createElement("fieldset");
      box.className = "qw-machrate";
      box.dataset.custom = id;
      box.dataset.name = name;
      box.dataset.truck = truck === "yes" ? "1" : "0";
      box.innerHTML = `<legend>${esc(name)}</legend>
        <p class="sub">${truck === "yes" ? "Needs the truck. Billed from the truck rate, once. No truck price on this machine." : "Does not use the truck."}</p>
        <label>Full setup $ (ex GST)<input name="mr_${esc(id)}" type="number" step="0.01" min="0.01" value="${esc(rate)}"></label>
        <label>Unit<select name="mu_${esc(id)}"><option value="hour" ${f.newUnit.value !== "day" ? "selected" : ""}>Per hour</option><option value="day" ${f.newUnit.value === "day" ? "selected" : ""}>Per day</option></select></label>
        <label>Primary operator portion $ (ex GST, optional)<input name="op_${esc(id)}" type="number" step="0.01" min="0.01" value="${esc(portion ?? "")}"></label>
        <button type="button" class="sm-btn" data-drop-machine="${esc(id)}">Remove from future quotes</button>`;
      $("#customlist").appendChild(box);
      f.newName.value = ""; f.newRate.value = ""; f.newPortion.value = ""; f.newTruck.value = "";
      help.textContent = "Added for this save. Accepted quotes are left as they are.";
    };
    d.onclick = ev => {
      const b = ev.target.closest && ev.target.closest("[data-drop-machine]");
      if (!b || !d.contains(b)) return;
      ev.preventDefault();
      b.closest("[data-custom]")?.remove();
    };
    $("#qrf").onsubmit = async ev => {
      if (ev.submitter?.value !== "save") return;
      ev.preventDefault();
      const f = ev.target;
      const customMachines = [...d.querySelectorAll("[data-custom]")].map(el => ({
        id: el.dataset.custom, name: el.dataset.name, requiresTruck: el.dataset.truck === "1"
      }));
      const machineRates = {};
      const ids = [...FLEET_MACHINES.map(m => m.id), ...customMachines.map(m => m.id)];
      for (const id of ids) {
        machineRates[id] = {
          rate: numOrNull(f["mr_" + id].value),
          unit: f["mu_" + id].value === "day" ? "day" : "hour",
          primaryOperatorRate: f["op_" + id] ? numOrNull(f["op_" + id].value) : null,
          driver: id === "truck" ? f.truckDriver.value.trim() || null : null
        };
      }
      let clean;
      try {
        clean = sanitizeQuoteRatesWrite({
          travelPerKm: numOrNull(f.travelPerKm.value),
          materialPerUnit: numOrNull(f.materialPerUnit.value),
          tipPerLoad: numOrNull(f.tipPerLoad.value),
          materialUnitLabel: f.materialUnitLabel.value.trim() || "unit",
          tipUnitLabel: f.tipUnitLabel.value.trim() || "load",
          yardAddress: f.yardAddress.value.trim() || DEFAULT_DEPOT.yardAddress,
          yardMapsUrl: f.yardMapsUrl.value.trim() || DEFAULT_DEPOT.yardMapsUrl,
          machineRates, customMachines,
          secondOperatorRate: numOrNull(f.secondOperatorRate.value) ?? DEFAULT_SECOND_OPERATOR_RATE,
          dualMachineSurcharge: numOrNull(f.dualMachineSurcharge.value) ?? DEFAULT_DUAL_MACHINE_SURCHARGE,
          hourlyOnSite: null,
          updatedAt: serverTimestamp(), updatedBy: me.uid
        });
      } catch (e) { toast(e.message || "Check the rates"); return; }
      try {
        await setDoc(doc(db, "meta", "quoteRates"), clean, { merge: true });
        getUi().quoteRates = {
          ...emptyRates(), ...clean,
          customMachines: readCustomMachines(clean.customMachines),
          machineRates: mergeMachineRates(clean.machineRates, clean.customMachines),
          updatedAt: new Date().toISOString()
        };
        d.close(); toast("Quote rates saved"); renderAdmin();
      } catch (e) { toast("Not saved: " + (e.code || e.message)); }
    };
  });
}

function storedView(q) {
  return {
    lines: q.lines || [],
    totalEx: q.totalEx ?? null,
    gst: q.gst ?? null,
    totalInc: q.totalInc ?? null,
    gstRate: GST_RATE,
    missingRates: [],
    complete: q.totalEx != null,
    machines: q.machines || [],
    secondOperator: !!(q.secondOperator || q.includeLabourer),
    dualMachines: !!q.dualMachines,
    presetId: q.presetId || null,
    plant: q.plant || plantFromJob(q),
    hours: q.hoursOnSite || 0,
    gstNote: q.gst != null && q.totalEx != null ? `GST is 10% of ${aud(q.totalEx)} ex GST = ${aud(q.gst)}, added once. Total inc GST ${aud(q.totalInc)}.` : "",
    locked: true
  };
}

function openQuoteWizard(existing, opts = {}) {
  const { $, esc, toast, db, doc, addDoc, updateDoc, serverTimestamp, getUi, renderAdmin, CLIENTS, TYPES, canSeeMoney, $$, getMe } = api;
  const me = getMe();
  ensureRates(false).then(rates => {
    const locked = existing?.quoteStatus === "Accepted";
    if (existing?.jobId && locked && opts.jumpToPrice) toast("Already accepted — job kept as " + existing.jobId);
    const init = resolvePlant({
      machines: existing?.machines || [],
      presetId: existing?.presetId,
      secondOperator: existing?.secondOperator != null ? existing.secondOperator : !!existing?.includeLabourer
    }, rates);
    const state = Object.assign({
      quoteStatus: "Draft", client: CLIENTS[0], type: "spoil", travelKm: "", hoursOnSite: "",
      machineDays: "1", materialQty: "", tipLoads: "", address: "", description: "",
      travelMode: "oneway", travelNote: "",
      machines: init.machines, secondOperator: init.secondOperator, presetId: init.presetId
    }, existing || {});
    state.machines = init.machines;
    state.presetId = init.presetId;
    state.secondOperator = init.secondOperator;
    let step = opts.jumpToPrice ? 2 : 0;
    const phases = ["Job", "Setup", "Review"];
    const titles = ["New quote", "Choose equipment", "Review"];
    const subs = ["What needs doing?", "Step 2 of 3", "Step 3 of 3"];
    let holdErr = "";
    const d = $("#dlg"); d.className = "jobcard"; d.onclose = () => renderAdmin();
    const paint = () => {
      const draft = { ...state, machines: state.machines, secondOperator: !!state.secondOperator };
      const calc = locked ? storedView(existing) : calcQuote(draft, rates);
      const already = locked || !!(existing?.jobId && state.quoteStatus === "Accepted");
      const canAccept = !already && calc.complete && calc.totalEx != null && calc.gst != null && !!(draft.client && draft.address);
      const shownErr = holdErr; holdErr = "";
      d.innerHTML = `<form method="dialog" id="qwf" class="jc qw"><div class="jc-top q-quote"><div><div class="jc-no">${existing && step !== 0 ? "Edit quote" : esc(titles[step] || "Quote")}</div>
        <div class="jc-q">${esc(subs[step] || "")}</div></div>
        <button value="cancel" formnovalidate class="jc-x" aria-label="Close">✕</button></div>
        <div class="jc-body qw-body"><div class="qw-steps" aria-label="Quote steps">${phases.map((s, i) => `<span class="qw-phase ${i === step ? "on" : i < step ? "done" : ""}"><b>${i + 1}</b> ${s}</span>`).join("")}</div>
        <div class="qw-bar" aria-hidden="true"><span style="width:${Math.round(((step + 1) / phases.length) * 100)}%"></span></div>
        ${stepHtml(step, draft, calc, rates, esc, TYPES, CLIENTS, canSeeMoney, $$)}
        ${step === 2 && !calc.complete ? `<p class="warnt pad">Missing rates for: ${esc((calc.missingRates || []).join(", "))}. Save as draft, or ask an admin to set rates. GST is not applied to an incomplete quote.</p>` : ""}
        ${already ? `<p class="pad sub">Accepted quotes stay as they were accepted${existing?.jobId ? ` — job <b>${esc(existing.jobId)}</b>` : ""}. Rate changes do not alter this quote.</p>` : ""}
        </div>
        <p id="qerr" class="err">${esc(shownErr)}</p>
        <div class="btns jc-foot">
          ${already ? `<button type="button" class="sm-btn" id="qwback" ${step === 0 ? "disabled" : ""}>Back</button>` : `
          <button type="button" class="sm-btn" id="qwback" ${step === 0 ? "disabled" : ""}>Back</button>
          ${step < 2 ? `<button type="button" class="sm-btn primary" id="qwnext">${step === 0 ? "Choose equipment" : "Continue"}</button>
             <button type="button" class="sm-btn qw-later" id="qwsave">Save &amp; finish later</button>` :
            `<button type="button" class="sm-btn qw-later" id="qwsave">Save draft</button>
             ${canSeeMoney() && calc.complete ? `<button type="button" class="sm-btn" id="qwprint">Print quote</button>` : ""}
             <button type="button" class="sm-btn primary" id="qwaccept" ${canAccept ? "" : "disabled"} title="${canAccept ? "" : "Complete site and rates first"}">Accept → create job</button>`}`}
        </div></form>`;
      d.showModal();
      $("#qwback").onclick = () => { if (!locked) syncFormToState(); step = Math.max(0, step - 1); paint(); };
      $("#qwnext")?.addEventListener("click", () => {
        syncFormToState();
        if (!validateStep(step, state)) return;
        step++; paint();
      });
      $("#qwsave")?.addEventListener("click", () => { syncFormToState(); saveQuote(false); });
      $("#qwaccept")?.addEventListener("click", () => { syncFormToState(); saveQuote(true); });
      $("#qwprint")?.addEventListener("click", () => {
        if (!canSeeMoney()) return;
        const html = quotePrintHtml(calc, { client: state.client, address: state.address, description: state.description });
        const w = window.open("", "heartwood-quote", "noopener,width=800,height=900");
        if (!w) { toast("Pop-up blocked. The totals are on this screen."); return; }
        w.document.open(); w.document.write(html); w.document.close(); w.focus();
        setTimeout(() => { try { w.print(); } catch {} }, 200);
      });
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
      d.querySelectorAll("[data-mach]").forEach(cb => cb.onchange = () => { syncFormToState(); paint(); });
      d.querySelectorAll("[data-lab]").forEach(b => b.onclick = () => {
        const lab = d.querySelector("#qsecond");
        if (!lab) return;
        lab.checked = b.dataset.lab === "yes";
        state.secondOperator = lab.checked;
        paint();
      });
      d.querySelectorAll("[data-type]").forEach(b => b.onclick = () => {
        syncFormToState();
        state.type = b.dataset.type;
        paint();
      });
    };
    const syncFormToState = () => {
      const f = $("#qwf"); if (!f || locked) return;
      if (f.client) state.client = f.client.value.trim();
      if (f.address) state.address = f.address.value.trim();
      if (f.type) state.type = f.type.value;
      if (f.description) state.description = f.description.value.trim();
      if (f.travelKm) state.travelKm = f.travelKm.value;
      if (f.hoursOnSite) state.hoursOnSite = f.hoursOnSite.value;
      if (f.machineDays) state.machineDays = f.machineDays.value;
      if (f.materialQty) state.materialQty = f.materialQty.value;
      if (f.tipLoads) state.tipLoads = f.tipLoads.value;
      const mode = f.querySelector("[name=travelMode]:checked");
      if (mode) state.travelMode = mode.value;
      const sec = f.querySelector("#qsecond");
      if (sec) state.secondOperator = !!sec.checked;
      const boxes = f.querySelectorAll("[data-mach]");
      if (boxes.length) {
        const ids = [];
        boxes.forEach(cb => { if (cb.checked) ids.push(cb.getAttribute("data-mach")); });
        const plant = resolvePlant({ machines: ids, secondOperator: state.secondOperator }, rates);
        state.machines = plant.machines;
        state.presetId = plant.presetId;
      }
    };
    const validateStep = (s, data) => {
      const err = $("#qerr");
      if (!err) return true;
      if (s === 0 && (!data.client || !data.address)) { err.textContent = "Client and site address are required."; return false; }
      const plant = resolvePlant(data, rates);
      if (s === 1 && !plant.setups.length) { err.textContent = "Choose a skid steer, an excavator, or another machine. The truck comes with a machine that needs it."; return false; }
      err.textContent = ""; return true;
    };
    const calcTravel = async () => {
      syncFormToState();
      const depot = rates.yardAddress || DEFAULT_DEPOT.yardAddress;
      const site = state.address;
      const status = $("#qwtravelst");
      if (!site) { if (status) status.textContent = "Enter the site address on step 1 first."; return; }
      if (status) status.textContent = "Looking up road distance (Nominatim + OSRM)…";
      const r = await roadDistanceKm(depot, site);
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
    const saveQuote = async (accept) => {
      if (locked) { $("#qerr").textContent = "This quote is accepted. Rate changes do not alter it."; return; }
      syncFormToState();
      const data = { ...state };
      if (!validateStep(0, data)) { step = 0; paint(); return; }
      if (accept && !validateStep(1, data)) { step = 1; paint(); return; }
      const calc = calcQuote(data, rates);
      if (accept && !calc.complete) { $("#qerr").textContent = "Set quote rates for every used line before accepting."; return; }
      if (accept) {
        const needH = (calc.plant.setups || []).some(s => machineRateOf(rates, s.machineId).unit === "hour")
          || (calc.plant.truckId && machineRateOf(rates, "truck").unit === "hour")
          || calc.secondOperator;
        if (needH && !(+data.hoursOnSite > 0)) {
          holdErr = "Enter hours on site. Hourly setups and a second operator use those hours.";
          step = 0; paint(); return;
        }
      }
      if (accept && existing?.jobId && existing?.quoteStatus === "Accepted") {
        toast("Already accepted — existing job " + existing.jobId);
        d.close(); renderAdmin(); return;
      }
      let snapshot;
      try { snapshot = ratesSnapshotFrom(rates); } catch (e) { $("#qerr").textContent = e.message; return; }
      const payload = {
        client: data.client, address: data.address, type: data.type, description: data.description,
        scopeNotes: data.description || "",
        travelKm: +data.travelKm || 0, hoursOnSite: +data.hoursOnSite || 0,
        machineDays: Math.max(1, +data.machineDays || 1),
        materialQty: +data.materialQty || 0, tipLoads: +data.tipLoads || 0,
        travelMode: data.travelMode || "oneway", travelNote: data.travelNote || "",
        yardAddress: rates.yardAddress || DEFAULT_DEPOT.yardAddress,
        machines: calc.machines, setups: calc.plant.setups, operators: calc.plant.operators,
        presetId: calc.presetId, secondOperator: !!calc.secondOperator,
        dualMachines: !!calc.dualMachines,
        dualSurchargeExGst: calc.plant.dualSurchargeExGst,
        secondOperatorRate: calc.secondOperator ? calc.plant.secondOperatorRate : null,
        lines: calc.lines,
        totalEx: calc.complete ? calc.totalEx : null,
        gst: calc.complete ? calc.gst : null,
        totalInc: calc.complete ? calc.totalInc : null,
        gstRate: GST_RATE,
        plant: calc.plant,
        ratesSnapshot: snapshot,
        quoteStatus: accept ? "Accepted" : "Draft", source: "app",
        updatedAt: serverTimestamp(), updatedBy: me.uid, updatedAtIso: new Date().toISOString()
      };
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
      } catch (e) { const err = $("#qerr"); if (err) err.textContent = e.code || e.message; }
    };
    paint();
  });
}

function stepHtml(step, d, calc, rates, esc, TYPES, CLIENTS, canSeeMoney, $$) {
  const depot = rates.yardAddress || DEFAULT_DEPOT.yardAddress;
  const maps = rates.yardMapsUrl || DEFAULT_DEPOT.yardMapsUrl;
  const see = typeof canSeeMoney === "function" ? canSeeMoney() : true;
  const show = n => (n == null || !see || !$$) ? "—" : esc($$(n));
  const rateTxt = (v, suffix) => (v != null && see && $$) ? `${esc($$(v))}${suffix} ex GST` : "not set yet";
  if (step === 0) return `<div class="qw-pane">
    <label>Client<input name="client" list="qclients" value="${esc(d.client || "")}" required autocomplete="organization"><datalist id="qclients">${CLIENTS.map(c => `<option value="${esc(c)}">`).join("")}</datalist></label>
    <label>Job address<input name="address" value="${esc(d.address || "")}" required autocomplete="street-address" placeholder="Lot and street"></label>
    <label class="qw-hours">Hours on site<input name="hoursOnSite" type="number" min="0" step="0.25" value="${esc(d.hoursOnSite)}" inputmode="decimal"></label>
    <p class="sub">These hours are the on-site time. A second operator, if needed, uses the same hours. No extra time is added.</p>
    <label class="qw-native">Category<select name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${d.type === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
    <div class="qw-types" role="group" aria-label="Job type">${Object.entries(TYPES).map(([k, v]) => `<button type="button" class="qw-type ${d.type === k ? "on" : ""}" data-type="${esc(k)}" aria-pressed="${d.type === k ? "true" : "false"}"><span class="qw-tick" aria-hidden="true"></span><span>${esc(v)}</span></button>`).join("")}</div>
    <p class="sub">One category per job. Mixed work is still split later, from the job.</p>
    <label>Scope / notes<textarea name="description" rows="2">${esc(d.description || "")}</textarea></label>
  </div>`;
  if (step === 1) {
    const plant = calc.plant || resolvePlant(d, rates);
    const sel = new Set(plant.setups.map(s => s.id));
    const cards = quotingCatalog(rates).map(m => {
      const note = m.requiresTruck
        ? "Includes the truck and the primary operator. The truck cannot be removed on its own."
        : "Primary operator is inside the setup rate. This machine does not use the truck.";
      return `<label class="ck qw-preset ${sel.has(m.id) ? "on" : ""}"><input type="checkbox" data-mach="${esc(m.id)}" ${sel.has(m.id) ? "checked" : ""}><span><b>${esc(m.name)}</b><small>${esc(note)}</small></span></label>`;
    }).join("");
    const blurb = (see ? describeQuote(plant) : describeStaff(plant)).map(t => `<p>${esc(t)}</p>`).join("");
    const secOn = !!(d.secondOperator || plant.secondOperator);
    return `<div class="qw-pane"><h4>Machine setup</h4>
      <p class="sub">Tick the machines for this job. The truck is attached when the machine needs it. It is not a separate option.</p>
      <div class="qw-presets">${cards}</div>
      <div class="qw-detail" id="qwsetup">${blurb || `<p>Choose at least one machine.</p>`}</div>
      ${see ? plant.setups.map(s => {
        const mr = machineRateOf(rates, s.machineId);
        const extra = mr.primaryOperatorRate != null ? ` Includes primary operator ${rateTxt(mr.primaryOperatorRate, "")} inside the setup.` : "";
        return `<div class="sub">${esc(s.name)} full setup: ${rateTxt(mr.rate, mr.unit === "day" ? "/day" : "/h")}.${esc(extra)}</div>`;
      }).join("") + (plant.truckId ? `<div class="sub">${esc(truckWords(plant))}: ${rateTxt(machineRateOf(rates, "truck").rate, machineRateOf(rates, "truck").unit === "day" ? "/day" : "/h")}, billed once.</div>` : "") : ""}
      <h4 class="qw-labh">Does this job need two operators?</h4>
      <p class="sub">The machine already includes the primary operator. Choose Yes only when a second operator is required. Both machines do not add one by themselves. The rate is ${see ? rateTxt(secondOperatorRateOf(rates), "/h") : "set by an admin"}, for the hours on site, before GST.</p>
      <div class="qw-yn" role="group" aria-label="Does this job need two operators?">
        <button type="button" class="qw-ynbtn ${secOn ? "on" : ""}" data-lab="yes">Yes, two operators</button>
        <button type="button" class="qw-ynbtn ${secOn ? "" : "on"}" data-lab="no">No</button>
      </div>
      <input type="checkbox" id="qsecond" class="sr" ${secOn ? "checked" : ""}>
    </div>`;
  }
  const plant = calc.plant || resolvePlant(d, rates);
  const anyDay = (plant.setups || []).some(s => machineRateOf(rates, s.machineId).unit === "day")
    || (plant.truckId && machineRateOf(rates, "truck").unit === "day");
  const story = (see ? describeQuote(plant) : describeStaff(plant)).map(t => `<p>${esc(t)}</p>`).join("");
  const lines = (calc.lines || []).map(l => {
    let amt = "—";
    if (l.qty > 0 && l.rate == null) amt = `<span class="unal">rate missing</span>`;
    else if (l.amount != null && see) amt = show(l.amount);
    else if (l.qty === 0 && see) amt = show(0);
    const math = see && l.rate != null && l.qty > 0 ? `<small>${esc(String(l.qty))} × ${show(l.rate)} ex GST</small>` : "";
    const detail = see && l.detail ? `<small>${esc(l.detail)}</small>` : "";
    return `<div class="qw-line-row"><span>${esc(l.label)}${math}${detail}</span><b>${amt}</b></div>`;
  }).join("");
  const totals = !calc.complete || calc.totalEx == null
    ? `<div class="qw-total"><span>Subtotal ex GST</span><b><span class="unal">Incomplete — set rates first</span></b></div>`
    : see ? `<div class="qw-total" data-gst="1"><span>Subtotal ex GST</span><b>${show(calc.totalEx)}</b></div>
      <div class="qw-total"><span>GST 10%</span><b>${show(calc.gst)}</b></div>
      <div class="qw-total"><span>Total inc GST</span><b>${show(calc.totalInc)}</b></div>
      <p class="sub">${esc(calc.gstNote || "")}</p>`
      : `<div class="qw-total"><span>Total</span><b>—</b></div>`;
  return `<div class="qw-pane"><h4>Review</h4>
    <div class="qw-detail">${story}</div>
    <div class="qw-sum">${lines}${totals}</div>
    <details class="qw-extra"><summary>Travel, materials and rubbish</summary>
      <p class="sub">Depot (start): <b>${esc(depot)}</b> · <a href="${esc(maps)}" target="_blank" rel="noopener">Maps link</a>. Calculate travel uses a road distance (OSRM). Straight-line is never filled in as travel km.</p>
      <div class="row gap">
        <label class="ck"><input type="radio" name="travelMode" value="oneway" ${d.travelMode !== "return" ? "checked" : ""}> One-way</label>
        <label class="ck"><input type="radio" name="travelMode" value="return" ${d.travelMode === "return" ? "checked" : ""}> Return (×2)</label>
        <button type="button" class="sm-btn" id="qwcalc">Calculate travel</button>
      </div>
      <p id="qwtravelst" class="sub">${esc(d.travelNote || "")}</p>
      <label>Kilometres (billable)<input name="travelKm" type="number" min="0" step="0.1" value="${esc(d.travelKm)}" inputmode="decimal"></label>
      ${see ? `<p class="sub">Travel rate: ${rateTxt(rates.travelPerKm, "/km")}</p>` : ""}
      <label>Materials (${esc(rates.materialUnitLabel || "unit")})<input name="materialQty" type="number" min="0" step="0.1" value="${esc(d.materialQty)}" inputmode="decimal"></label>
      ${see ? `<p class="sub">Materials rate: ${rateTxt(rates.materialPerUnit, " each")}</p>` : ""}
      <label>Rubbish loads<input name="tipLoads" type="number" min="0" step="1" value="${esc(d.tipLoads)}" inputmode="numeric"></label>
      ${see ? `<p class="sub">Tip rate: ${rateTxt(rates.tipPerLoad, " / load")}</p>` : ""}
      ${anyDay ? `<label>Days (day-rate plant)<input name="machineDays" type="number" min="1" step="1" value="${esc(d.machineDays || 1)}" inputmode="numeric"></label>
        <p class="sub">Day-rate machines use days. A second operator still uses the hours on site.</p>` : `<input type="hidden" name="machineDays" value="${esc(d.machineDays || 1)}">`}
    </details>
    ${d.travelNote ? `<p class="sub">${esc(d.travelNote)}</p>` : ""}
    <p class="sub">Accepting creates an unscheduled job. The job run sheet lists the machines, the truck and whether a second operator is required. It does not show these prices. GST is not sent to Xero from here.</p></div>`;
}

async function createJobFromQuote(qid, q) {
  const { db, addDoc, collection, serverTimestamp, getMe, getUi } = api;
  const me = getMe();
  if (q.totalEx == null || q.gst == null || q.totalInc == null) throw new Error("Cannot create job from incomplete quote");
  const job = buildAcceptedJob(qid, q, me);
  const ref = await addDoc(collection(db, "jobs"), {
    ...job, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  const ui = getUi();
  if (ui) {
    const row = { id: ref.id, ...job };
    ui.undated = [row, ...((ui.undated || []).filter(x => x.id !== ref.id))];
  }
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
