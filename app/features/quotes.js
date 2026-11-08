// CallUp guided Quotes (Nov 2026). Prices always ex GST.
import { orgSettings, POWERED_BY, PRODUCT_NAME } from "../org-settings.js";
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
 */
export const EQUIPMENT_PRESETS = [
  { id: "truck", label: "Truck only", machines: ["truck"] },
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

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";
const geoCache = new Map();

let api = null;

export function installQuotes(a) {
  api = a;
  return {
    calcQuote, DEFAULT_RATE_KEYS, DEFAULT_DEPOT, FLEET_MACHINES, EQUIPMENT_PRESETS,
    resolvePresetId, machineSelectionFromPreset, quoteLines, roadDistanceKm,
    bindAdmin: bindAdminExtras,
    openQuoteWizard, openRatesEditor, refreshQuotes, ensureRates,
    adminViewRouter, quotesViewHtml
  };
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

export function machineSelectionFromPreset(presetId) {
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

  const rounded = lines.map(l => ({ ...l, amount: l.amount == null ? null : Math.round(l.amount * 100) / 100 }));
  const missingRates = rounded.filter(l => l.qty > 0 && l.rate == null).map(l => l.key);
  const known = rounded.filter(l => l.amount != null);
  const totalEx = missingRates.length ? null
    : (known.length ? Math.round(known.reduce((t, l) => t + l.amount, 0) * 100) / 100 : 0);
  return {
    lines: rounded, totalEx, missingRates, travelKm, hours, machineDays, matQty, tipLoads,
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
  if (ui.quoteRates && !force) return ui.quoteRates;
  try {
    const s = await api.getDoc(api.doc(api.db, "meta", "quoteRates"));
    ui.quoteRates = s.exists() ? { ...emptyRates(), ...s.data() } : emptyRates();
    ui.quoteRates.machineRates = mergeMachineRates(ui.quoteRates.machineRates);
    if (!ui.quoteRates.yardAddress) ui.quoteRates.yardAddress = DEFAULT_DEPOT.yardAddress;
    if (!ui.quoteRates.yardMapsUrl) ui.quoteRates.yardMapsUrl = DEFAULT_DEPOT.yardMapsUrl;
    if (ui.quoteRates.labourerUnit !== "day") ui.quoteRates.labourerUnit = "hour";
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
      <p class="sub">Stored in <code>meta/quoteRates</code>. Dollar rates are ex GST — leave blank until you know them (nothing invented). Plant rates include the operator. Labourer is a separate optional add-on. Depot is travel start.</p>
      <h3>Plant (operator included)</h3>
      <p class="sub">Presets: Truck only · Truck + skid · Truck + excavator · Truck + skid + excavator · Excavator only. Selecting a combo charges each machine once (no double truck).</p>
      ${plantFields}
      <h3>Labourer (optional add-on)</h3>
      <label>Labourer $ (ex GST)<input name="labourerRate" type="number" step="0.01" min="0" value="${esc(rates.labourerRate ?? "")}"></label>
      <label>Labourer unit<select name="labourerUnit"><option value="hour" ${rates.labourerUnit !== "day" ? "selected" : ""}>Per hour</option><option value="day" ${rates.labourerUnit === "day" ? "selected" : ""}>Per day</option></select></label>
      <h3>Travel, materials, tip</h3>
      ${DEFAULT_RATE_KEYS.map(([k, lab]) => `<label>${esc(lab)}<input name="${k}" type="number" step="0.01" min="0" value="${esc(rates[k] ?? "")}"></label>`).join("")}
      <label>Materials unit label<input name="materialUnitLabel" value="${esc(rates.materialUnitLabel || "unit")}"></label>
      <label>Rubbish unit label<input name="tipUnitLabel" value="${esc(rates.tipUnitLabel || "load")}"></label>
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
        updatedAt: serverTimestamp(), updatedBy: me.uid
      };
      try {
        await setDoc(doc(db, "meta", "quoteRates"), data, { merge: true });
        getUi().quoteRates = { ...emptyRates(), ...data, machineRates: mergeMachineRates(machineRates), updatedAt: new Date().toISOString() };
        d.close(); toast("Quote rates saved"); renderAdmin();
      } catch (e) { toast("Not saved: " + (e.code || e.message)); }
    };
  });
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
      presetId: resolvePresetId(initMachines)
    }, existing || {});
    state.machines = normalizeMachineIds(state.machines || []);
    state.presetId = resolvePresetId(state.machines);
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
        ${stepHtml(step, draft, calc, rates, esc, TYPES, CLIENTS, canSeeMoney, $$)}
        ${step === 2 && !calc.complete ? `<p class="warnt pad">Missing rates for: ${esc(calc.missingRates.join(", "))}. Save as draft, or ask an admin to set rates. Total is not shown as valid until every used line has a rate.</p>` : ""}
        ${already ? `<p class="pad sub">Already accepted → job <b>${esc(existing.jobId)}</b>. Accept will not create another job.</p>` : ""}
        </div>
        <p id="qerr" class="err">${esc(shownErr)}</p>
        <div class="btns jc-foot">
          <button type="button" class="sm-btn" id="qwback" ${step === 0 ? "disabled" : ""}>Back</button>
          ${step < 2 ? `<button type="button" class="sm-btn primary" id="qwnext">${step === 0 ? "Choose equipment" : "Continue"}</button>
             <button type="button" class="sm-btn qw-later" id="qwsave">Save &amp; finish later</button>` :
            `<button type="button" class="sm-btn qw-later" id="qwsave">Save draft</button>
             <button type="button" class="sm-btn primary" id="qwaccept" ${canAccept ? "" : "disabled"} title="${canAccept ? "" : already ? "Already accepted" : "Complete site + rates first"}">Accept → create job</button>`}
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
    };
    const syncFormToState = () => {
      const f = $("#qwf"); if (!f) return;
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
    };
    const validateStep = (s, data) => {
      const err = $("#qerr");
      if (s === 0 && (!data.client || !data.address)) { err.textContent = "Client and site address are required."; return false; }
      if (s === 1 && !(data.machines && data.machines.length)) { err.textContent = "Pick an equipment preset (truck and/or skid / excavator)."; return false; }
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
      const data = { ...state, machines: normalizeMachineIds(state.machines) };
      if (!validateStep(0, data)) return;
      if (accept && !validateStep(1, data)) { step = 1; paint(); return; }
      const calc = calcQuote(data, rates);
      if (accept && !calc.complete) { $("#qerr").textContent = "Set quote rates for every used line before accepting."; return; }
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
      const payload = {
        client: data.client, address: data.address, type: data.type, description: data.description,
        travelKm: +data.travelKm || 0, hoursOnSite: +data.hoursOnSite || 0,
        machineDays: Math.max(1, +data.machineDays || 1),
        materialQty: +data.materialQty || 0, tipLoads: +data.tipLoads || 0,
        travelMode: data.travelMode || "oneway", travelNote: data.travelNote || "",
        yardAddress: rates.yardAddress || DEFAULT_DEPOT.yardAddress,
        machines: calc.machines, presetId: calc.presetId, includeLabourer: !!calc.includeLabourer,
        lines: calc.lines, totalEx: calc.complete ? calc.totalEx : null,
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
      } catch (e) { $("#qerr").textContent = e.code || e.message; }
    };
    paint();
  });
}

function stepHtml(step, d, calc, rates, esc, TYPES, CLIENTS, canSeeMoney, $$) {
  const depot = rates.yardAddress || DEFAULT_DEPOT.yardAddress;
  const maps = rates.yardMapsUrl || DEFAULT_DEPOT.yardMapsUrl;
  const rateTxt = (v, suffix) => (v != null && canSeeMoney()) ? `${$$(v)}${suffix} ex GST` : "not set yet";
  if (step === 0) return `<div class="qw-pane">
    <label>Client<input name="client" list="qclients" value="${esc(d.client || "")}" required autocomplete="organization"><datalist id="qclients">${CLIENTS.map(c => `<option value="${esc(c)}">`).join("")}</datalist></label>
    <label>Job address<input name="address" value="${esc(d.address || "")}" required autocomplete="street-address" placeholder="Lot and street"></label>
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
      <p class="sub">Same machines as the list above. Truck is counted once.</p>
      <label class="ck"><input type="checkbox" data-mach="truck" ${sel.has("truck") ? "checked" : ""}> Truck</label>
      <label class="ck"><input type="checkbox" data-mach="skid" ${sel.has("skid") ? "checked" : ""}> Skid steer (Bobcat)</label>
      <label class="ck"><input type="checkbox" data-mach="excavator" ${sel.has("excavator") ? "checked" : ""}> Excavator (JCB)</label>
    </details>`;
    const plantBits = canSeeMoney() ? [...sel].map(id => {
      const { rate, unit } = machineRateOf(rates, id);
      return `<div class="sub">${esc(fleetName(id))} + operator: ${rateTxt(rate, unit === "day" ? "/day" : "/h")}</div>`;
    }).join("") : "";
    return `<div class="qw-pane"><h4>Machine setup</h4>
      <p class="sub">Each machine is included once, with its operator.</p>
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
  const lines = calc.lines.map(l => {
    let amt = "—";
    if (l.qty > 0 && l.rate == null) amt = `<span class="unal">rate missing</span>`;
    else if (l.amount != null && canSeeMoney()) amt = esc($$(l.amount));
    else if (l.qty === 0) amt = canSeeMoney() ? esc($$(0)) : "—";
    return `<div class="qw-line-row"><span>${esc(l.label)}</span><b>${amt}</b></div>`;
  }).join("");
  const total = !calc.complete
    ? `<span class="unal">Incomplete — set rates first</span>`
    : (canSeeMoney() ? esc($$(calc.totalEx)) : "—");
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
    ${d.travelNote ? `<p class="sub">${esc(d.travelNote)}</p>` : ""}
    <div class="qw-sum">${lines}
    <div class="qw-total"><span>Total ex GST</span><b>${total}</b></div></div>
    <p class="sub">Accepting creates a pending unscheduled job with this quote, plant selection and labourer flag preserved. GST is not added here.</p></div>`;
}

async function createJobFromQuote(qid, q) {
  const { db, addDoc, collection, serverTimestamp, getMe } = api;
  const me = getMe();
  if (q.totalEx == null) throw new Error("Cannot create job from incomplete quote");
  const presetLab = EQUIPMENT_PRESETS.find(p => p.id === q.presetId)?.label
    || (q.machines || []).map(fleetName).join(" + ");
  const desc = [q.description || "", "",
    presetLab ? `Equipment: ${presetLab}${q.includeLabourer ? " + labourer" : ""}` : "",
    "Quoted (ex GST):",
    q.travelNote ? `Travel: ${q.travelNote}` : "",
    ...(q.lines || []).map(l => `• ${l.label}${l.amount != null ? `: $${Number(l.amount).toFixed(2)}` : " (rate missing)"}`),
    `Total ex GST: $${Number(q.totalEx).toFixed(2)}`].filter(Boolean).join("\n");
  const ref = await addDoc(collection(db, "jobs"), {
    client: q.client, address: q.address, type: q.type || "other", description: desc,
    date: "", time: "", status: "Scheduled", assigned: [], assignedNames: [],
    source: "quote", quoteId: qid, quoteStatus: "Accepted",
    quote: {
      travelKm: q.travelKm, hoursOnSite: q.hoursOnSite, machineDays: q.machineDays,
      materialQty: q.materialQty, tipLoads: q.tipLoads,
      machines: q.machines || [], presetId: q.presetId || null, includeLabourer: !!q.includeLabourer,
      lines: q.lines, totalEx: q.totalEx, travelMode: q.travelMode || "oneway", travelNote: q.travelNote || "",
      yardAddress: q.yardAddress || DEFAULT_DEPOT.yardAddress
    },
    machines: q.machines || [], presetId: q.presetId || null, includeLabourer: !!q.includeLabourer,
    quoteAmount: q.totalEx, poAmount: q.totalEx, poAmountBasis: "accepted quote (ex GST)", poAmountSource: "quote",
    log: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: me.uid, editedInApp: true
  });
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
