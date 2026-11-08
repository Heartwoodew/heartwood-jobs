// CallUp compliance.
// Fleet: registration and Queensland certificate of inspection (COI) for
// heavy vehicles and trailers. COI is not insurance.
// Policies: WorkCover (QLD workers' compensation) and insurance. Admin only.
//
// Fleet, policies, servicing and prestart are included for every signed-in company.
// Paper photos are not stored. Storage has no fleet or policy path, and this
// build does not add one. Real plates are not seeded.

import { CALLUP_BASE, resolveMembership } from "./cloud-storage.js";
import { costPayload, intervalFormHtml, planPayload, serviceAfterReading, serviceAttention, serviceFormHtml, servicePayload, serviceViews, servicingHtml } from "./servicing.js";
import { PRESTART_KINDS, assetKind, itemsFor, kindMeta, openDefects, prestartAdminHtml, prestartFormHtml, prestartHistoryHtml, prestartPayload, fleetReadingUpdate, templateFormHtml, templatePayload, templateSeedDocs } from "./prestart.js";

export const DUE_DAYS = 30;

export const ASSET_TYPES = Object.freeze([
  ["vehicle", "Vehicle"],
  ["trailer", "Trailer"],
  ["plant", "Plant / machine"],
]);

export const POLICY_TYPES = Object.freeze([
  ["workcover", "WorkCover (QLD)"],
  ["public-liability", "Public liability"],
  ["vehicle", "Vehicle insurance"],
  ["plant", "Plant insurance"],
  ["contract-works", "Contract works"],
]);

export const LINKED_POLICY_TYPES = Object.freeze(["vehicle", "plant"]);

const FEATURES_OFF = Object.freeze({ fleet: false, policies: false, servicing: false, prestart: false });
export const CALLUP_PLAN = Object.freeze({
  plan: "callup",
  features: Object.freeze({ fleet: true, policies: true, servicing: true, prestart: true }),
});
export const CALLUP_PLANS = Object.freeze({ callup: CALLUP_PLAN });

const OVERALL = { expired: "Expired", due: "Due within 30 days", ok: "OK" };
const RANK = { expired: 0, due: 1, ok: 2 };

export function featuresFor(membership) {
  if (membership?.ok) return CALLUP_PLAN;
  return { plan: "callup", features: FEATURES_OFF };
}

export function complianceFor(me) {
  if (!me?.uid) return { plan: "callup", features: FEATURES_OFF };
  return featuresFor(resolveMembership({ uid: me.uid, profile: me.cloudProfile || null }));
}

export function canViewFleet(plan) {
  return !!(plan && plan.features && plan.features.fleet);
}
export function canEditCompliance(plan, role) {
  return canViewFleet(plan) && role === "admin";
}
export function canViewPolicies(plan, role) {
  return !!(plan && plan.features && plan.features.policies && role === "admin");
}
export function canViewServicing(plan) {
  return !!(plan && plan.features && plan.features.servicing);
}
export function canEditFleet(plan, role, staffRole) {
  return canViewFleet(plan) && (role === "admin" || role === "supervisor" || staffRole === "supervisor");
}

export function canEditServicing(plan, role, staffRole) {
  return canViewServicing(plan) && (role === "admin" || role === "supervisor" || staffRole === "supervisor");
}
export function canViewPrestart(plan) {
  return !!(plan && plan.features && plan.features.prestart);
}

export function addIsoDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dateOk(value) {
  return value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

export function formatAu(iso) {
  if (!iso) return "";
  const [y, m, day] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[+m - 1];
  return month ? `${+day} ${month} ${y}` : iso;
}

export function classifyDate(iso, today) {
  if (!iso) return { k: "expired", label: "No date", text: "No date", sort: "" };
  if (!dateOk(iso)) return { k: "expired", label: "No date", text: "No date", sort: "" };
  const when = formatAu(iso);
  if (iso < today) return { k: "expired", label: "Expired", text: `Expired ${when}`, sort: iso };
  if (iso <= addIsoDays(today, DUE_DAYS)) return { k: "due", label: "Due within 30 days", text: `Due ${when}`, sort: iso };
  return { k: "ok", label: "OK", text: `OK until ${when}`, sort: iso };
}

function worst(keys) {
  return keys.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b), "ok");
}

function earliest(dates) {
  if (dates.some(d => !d)) return "";
  return dates.reduce((a, b) => (a < b ? a : b));
}

export function assetStatus(asset, today) {
  const rego = classifyDate(asset && asset.regoExpiry, today);
  const coiOn = !!(asset && asset.coiRequired);
  const coi = coiOn ? classifyDate(asset.coiExpiry, today) : null;
  const keys = coi ? [rego.k, coi.k] : [rego.k];
  const dates = coi ? [rego.sort, coi.sort] : [rego.sort];
  const k = worst(keys);
  return { k, label: OVERALL[k], sort: earliest(dates), rego, coi, coiOn };
}

export function policyStatus(policy, today) {
  const expiry = classifyDate(policy && policy.expiry, today);
  return { k: expiry.k, label: OVERALL[expiry.k], sort: expiry.sort, expiry };
}

export function withStatus(rows, today, kind) {
  const statusOf = kind === "policy" ? policyStatus : assetStatus;
  return (rows || []).map(row => ({ ...row, status: statusOf(row, today) }));
}

export function sortBySoonest(rows) {
  return [...(rows || [])].sort((a, b) => {
    const as = a.status ? a.status.sort : "";
    const bs = b.status ? b.status.sort : "";
    if (as !== bs) return as < bs ? -1 : 1;
    const an = String(a.name || a.insurer || "");
    const bn = String(b.name || b.insurer || "");
    return an.localeCompare(bn);
  });
}

export function attentionCounts(assets, policies, today, includePolicies) {
  const fleet = withStatus(assets, today, "asset");
  const pols = includePolicies ? withStatus(policies, today, "policy") : [];
  const n = (rows, k) => rows.filter(r => r.status.k === k).length;
  return {
    fleetExpired: n(fleet, "expired"),
    fleetDue: n(fleet, "due"),
    policyExpired: n(pols, "expired"),
    policyDue: n(pols, "due"),
  };
}

export function needsAttention(counts) {
  return !!(counts && (counts.fleetExpired || counts.fleetDue || counts.policyExpired || counts.policyDue));
}

function text(value) {
  return String(value ?? "").trim();
}

function typeForKind(kind) {
  return kind === "trailer" ? "trailer" : (kind === "ute" || kind === "tip-truck") ? "vehicle" : "plant";
}

function unitForKind(kind) {
  const meta = kindMeta(kind);
  return !meta || meta.meter === "none" ? "" : meta.meter === "km" ? "km" : "hours";
}

export function assetPayload(input, uid) {
  const askedKind = text(input && input.prestartKind);
  const type = (input && input.type) || (kindMeta(askedKind) ? typeForKind(askedKind) : "");
  const name = text(input && input.name);
  const rego = text(input && input.rego).toUpperCase();
  const regoExpiry = text(input && input.regoExpiry);
  const coiExpiry = text(input && input.coiExpiry);
  const notes = text(input && input.notes);
  const coiRequired = !!(input && input.coiRequired);
  if (!ASSET_TYPES.some(([id]) => id === type)) return { ok: false, reason: "Choose a type." };
  if (!name || name.length > 80) return { ok: false, reason: "Add a name (80 characters or less)." };
  if (rego.length > 20) return { ok: false, reason: "Plate / rego is too long." };
  if (notes.length > 2000) return { ok: false, reason: "Notes are too long." };
  if (!dateOk(regoExpiry) || !dateOk(coiExpiry)) return { ok: false, reason: "Use a date, or leave it blank." };
  const readingText = text(input && input.reading);
  const reading = readingText === "" ? 0 : Number(readingText);
  if (!Number.isInteger(reading) || reading < 0 || reading > 10000000) return { ok: false, reason: "Hours / odometer must be a whole number." };
  if (!uid) return { ok: false, reason: "Sign in again." };
  const asked = askedKind;
  const fallback = type === "trailer" ? "trailer" : type === "plant" ? "other-plant" : "ute";
  const prestartKind = kindMeta(asked) ? asked : fallback;
  return {
    ok: true,
    data: { type, name, rego, regoExpiry, coiRequired, coiExpiry: coiRequired ? coiExpiry : "", notes, prestartKind, reading, readingUnit: unitForKind(prestartKind), updatedBy: uid },
  };
}

export function policyPayload(input, uid) {
  const type = input && input.type;
  const insurer = text(input && input.insurer);
  const policyNumber = text(input && input.policyNumber);
  const startDate = text(input && input.startDate);
  const expiry = text(input && input.expiry);
  const amount = text(input && input.amount);
  const notes = text(input && input.notes);
  let assetId = text(input && input.assetId);
  if (!POLICY_TYPES.some(([id]) => id === type)) return { ok: false, reason: "Choose a policy type." };
  if (!insurer || insurer.length > 120) return { ok: false, reason: "Add the insurer (120 characters or less)." };
  if (policyNumber.length > 60) return { ok: false, reason: "Policy number is too long." };
  if (amount.length > 40) return { ok: false, reason: "Cover amount is too long." };
  if (notes.length > 2000) return { ok: false, reason: "Notes are too long." };
  if (assetId.length > 80) return { ok: false, reason: "Choose a vehicle from the list." };
  if (!dateOk(startDate) || !dateOk(expiry)) return { ok: false, reason: "Use a date, or leave it blank." };
  if (!LINKED_POLICY_TYPES.includes(type)) assetId = "";
  if (!/^[A-Za-z0-9_-]*$/.test(assetId)) return { ok: false, reason: "Choose a vehicle from the list." };
  if (!uid) return { ok: false, reason: "Sign in again." };
  return {
    ok: true,
    data: { type, insurer, policyNumber, startDate, expiry, amount, notes, assetId, updatedBy: uid },
  };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function pill(k, text) {
  const cls = k === "ok" ? "sw-ok" : k === "due" ? "sw-due" : "sw-exp";
  return `<span class="swpill ${cls}">${esc(text)}</span>`;
}

function typeLabel(list, id) {
  return (list.find(([k]) => k === id) || [id, id])[1];
}

export function fleetCardsHtml(assets, today, { editable = false, service = null } = {}) {
  const rows = sortBySoonest(withStatus(assets, today, "asset"));
  if (!rows.length) return `<p class="muted pad comp-empty">No machines yet.</p>`;
  return `<div class="comp-list">${rows.map(a => {
    const coi = a.status.coiOn
      ? `<div class="comp-line"><span class="lbl">COI</span><span>${esc(a.status.coi.text)}</span>${pill(a.status.coi.k, a.status.coi.label)}</div>`
      : `<div class="comp-line"><span class="lbl">COI</span><span>Not required</span></div>`;
    const edit = editable ? `<button type="button" class="sm-btn" data-comp-edit="asset" data-comp-id="${esc(a.id)}">Edit</button>` : "";
    return `<article class="comp-card" data-asset="${esc(a.id)}">
      <div class="comp-top"><div><b>${esc(a.name || "Vehicle")}</b><div class="sub">${esc(typeLabel(ASSET_TYPES, a.type))} · ${esc((kindMeta(assetKind(a)) || {}).label || "Prestart")}${a.rego ? ` · ${esc(a.rego)}` : ""}${a.reading ? ` · ${esc(String(a.reading))} ${a.readingUnit === "km" ? "km" : "hrs"}` : ""}</div></div>${pill(a.status.k, a.status.label)}${service && service[a.id] && (service[a.id].k === "due" || service[a.id].k === "overdue" || service[a.id].k === "ok") ? ` ${pill(service[a.id].k === "overdue" ? "expired" : service[a.id].k, "Service: " + service[a.id].label)}` : ""}</div>
      <div class="comp-lines"><div class="comp-line"><span class="lbl">Rego</span><span>${esc(a.status.rego.text)}</span>${pill(a.status.rego.k, a.status.rego.label)}</div>${coi}</div>
      ${a.notes ? `<p class="sub">${esc(a.notes)}</p>` : ""}
      ${edit ? `<div class="comp-actions">${edit}</div>` : ""}
    </article>`;
  }).join("")}</div>`;
}

export function policyCardsHtml(policies, assets, today) {
  const names = new Map((assets || []).map(a => [a.id, a.name || a.rego || "Vehicle"]));
  const rows = sortBySoonest(withStatus(policies, today, "policy"));
  if (!rows.length) return `<p class="muted pad comp-empty">No policies yet.</p>`;
  return `<div class="comp-list">${rows.map(p => {
    const linked = p.assetId
      ? (names.get(p.assetId) ? `Linked · ${names.get(p.assetId)}` : "Linked vehicle is no longer on the fleet list")
      : "";
    return `<article class="comp-card" data-policy="${esc(p.id)}">
      <div class="comp-top"><div><b>${esc(typeLabel(POLICY_TYPES, p.type))}</b><div class="sub">${esc(p.insurer || "")}${p.policyNumber ? ` · ${esc(p.policyNumber)}` : ""}</div></div>${pill(p.status.k, p.status.label)}</div>
      <div class="comp-lines"><div class="comp-line"><span class="lbl">Renews</span><span>${esc(p.status.expiry.text)}</span>${pill(p.status.expiry.k, p.status.expiry.label)}</div></div>
      ${p.amount ? `<p class="sub">Cover ${esc(p.amount)}</p>` : ""}
      ${linked ? `<p class="sub">${esc(linked)}</p>` : ""}
      ${p.notes ? `<p class="sub">${esc(p.notes)}</p>` : ""}
      <div class="comp-actions"><button type="button" class="sm-btn" data-comp-edit="policy" data-comp-id="${esc(p.id)}">Edit</button></div>
    </article>`;
  }).join("")}</div>`;
}

function countLine(n, one, many) {
  if (!n) return "";
  return `${n} ${n === 1 ? one : many}`;
}

export function bannerHtml({ assets, policies, today, includePolicies, error, go, serviceOverdue = 0, serviceDue = 0, serviceNames = [], prestartDefects = 0, prestartStops = 0, prestartNames = [] }) {
  if (error && !(assets || []).length && !(includePolicies && (policies || []).length)) {
    const title = includePolicies ? "Compliance couldn't load" : "Fleet status couldn't load";
    return `<button type="button" class="swremind sw-due comp-banner" data-go="${esc(go)}"><span class="ic">🚐</span><span><b>${title}</b><small>${esc(error)}</small></span><span class="chev">›</span></button>`;
  }
  const counts = attentionCounts(assets, policies, today, includePolicies);
  if (!needsAttention(counts) && !serviceOverdue && !serviceDue && !prestartDefects) return "";
  const parts = [
    countLine(counts.fleetExpired, "fleet item expired", "fleet items expired"),
    countLine(counts.fleetDue, "rego or COI due within 30 days", "regos or COIs due within 30 days"),
    includePolicies ? countLine(counts.policyExpired, "policy expired", "policies expired") : "",
    includePolicies ? countLine(counts.policyDue, "policy due within 30 days", "policies due within 30 days") : "",
    countLine(serviceOverdue, "service overdue", "services overdue"),
    countLine(serviceDue, "service due soon", "services due soon"),
    countLine(prestartStops, "do not operate", "do not operate"),
    countLine(Math.max(0, prestartDefects - prestartStops), "defect — check before use", "defects — check before use"),
  ].filter(Boolean);
  const named = [
    ...sortBySoonest(withStatus(assets, today, "asset")).filter(a => a.status.k !== "ok").map(a => a.name || "Vehicle"),
    ...(includePolicies ? sortBySoonest(withStatus(policies, today, "policy")).filter(p => p.status.k !== "ok").map(p => typeLabel(POLICY_TYPES, p.type)) : []),
    ...serviceNames,
    ...prestartNames,
  ];
  const extra = named.length ? ` — ${named.slice(0, 3).join(", ")}${named.length > 3 ? ` +${named.length - 3}` : ""}` : "";
  const cls = (counts.fleetExpired || counts.policyExpired || serviceOverdue || prestartDefects) ? "sw-exp" : "sw-due";
  const title = includePolicies ? "Compliance needs attention" : "Fleet needs attention";
  return `<button type="button" class="swremind ${cls} comp-banner" data-go="${esc(go)}"><span class="ic">🚐</span><span><b>${title}</b><small>${esc(parts.join(" · ") + extra)}</small></span><span class="chev">›</span></button>`;
}

function options(list, selected) {
  return list.map(([id, label]) => `<option value="${esc(id)}"${id === selected ? " selected" : ""}>${esc(label)}</option>`).join("");
}

function assetFormHtml(asset, editableId, canRemove = true) {
  const a = asset || {};
  return `<form id="compform" class="comp-form" data-kind="asset" data-comp-id="${esc(editableId || "")}">
    <h2>${editableId ? "Edit machine" : "Add machine"}</h2>
    <p class="comp-help">Registration and Queensland certificate of inspection (COI) for heavy vehicles and trailers. COI is not insurance. Photos of the paper are not stored in the app.</p>
    <label>Name<input name="name" required maxlength="80" value="${esc(a.name || "")}" autocomplete="off"></label>
    <label>Type<select name="prestartKind">${options(PRESTART_KINDS.map(kind => [kind.id, kind.label]), asset ? assetKind(a) : "excavator")}</select></label>
    <p class="comp-help">The type picks the prestart checklist.</p>
    <label>Rego / serial<input name="rego" maxlength="20" value="${esc(a.rego || "")}" autocomplete="off"></label>
    <label>Hours / odometer<input name="reading" type="number" inputmode="numeric" min="0" max="10000000" step="1" value="${a.reading ? esc(String(a.reading)) : ""}" placeholder="Engine hours, or km for road vehicles"></label>
    <label>Rego expiry<input name="regoExpiry" type="date" value="${esc(a.regoExpiry || "")}"></label>
    <label class="comp-check"><input name="coiRequired" type="checkbox" ${a.coiRequired ? "checked" : ""}> COI required</label>
    <p class="comp-help">COI is the Queensland certificate of inspection. Leave this off for a light vehicle that does not need one.</p>
    <label data-coi-date ${a.coiRequired ? "" : "hidden"}>COI expiry<input name="coiExpiry" type="date" value="${esc(a.coiExpiry || "")}"></label>
    <label>Notes<textarea name="notes" rows="3" maxlength="2000">${esc(a.notes || "")}</textarea></label>
    <div class="comp-actions"><button class="sm-btn primary" type="submit">Save</button><button class="sm-btn" type="button" data-comp-cancel>Cancel</button>${editableId && canRemove ? `<button class="sm-btn" type="button" data-comp-delete>Remove</button>` : ""}</div>
  </form>`;
}

function policyFormHtml(policy, assets, editableId) {
  const p = policy || {};
  const linked = LINKED_POLICY_TYPES.includes(p.type || "workcover") || !!p.assetId;
  const assetOptions = [`<option value="">None</option>`].concat((assets || []).map(a =>
    `<option value="${esc(a.id)}"${a.id === p.assetId ? " selected" : ""}>${esc(a.name || "Vehicle")}${a.rego ? ` · ${esc(a.rego)}` : ""}</option>`));
  return `<form id="compform" class="comp-form" data-kind="policy" data-comp-id="${esc(editableId || "")}">
    <h2>${editableId ? "Edit policy" : "Add policy"}</h2>
    <p class="comp-help">WorkCover Queensland and insurance. Staff cannot see this.</p>
    <label>Type<select name="type">${options(POLICY_TYPES, p.type || "workcover")}</select></label>
    <label>Insurer<input name="insurer" required maxlength="120" value="${esc(p.insurer || "")}" autocomplete="off"></label>
    <label>Policy number<input name="policyNumber" maxlength="60" value="${esc(p.policyNumber || "")}" autocomplete="off"></label>
    <label>Start<input name="startDate" type="date" value="${esc(p.startDate || "")}"></label>
    <label>Expiry / renewal<input name="expiry" type="date" value="${esc(p.expiry || "")}"></label>
    <label>Cover amount<input name="amount" maxlength="40" value="${esc(p.amount || "")}" autocomplete="off"></label>
    <label data-asset-field ${linked ? "" : "hidden"}>Linked vehicle or plant<select name="assetId">${assetOptions.join("")}</select></label>
    <label>Notes<textarea name="notes" rows="3" maxlength="2000">${esc(p.notes || "")}</textarea></label>
    <div class="comp-actions"><button class="sm-btn primary" type="submit">Save</button><button class="sm-btn" type="button" data-comp-cancel>Cancel</button>${editableId ? `<button class="sm-btn" type="button" data-comp-delete>Remove</button>` : ""}</div>
  </form>`;
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function installCompliance(deps) {
  const state = {
    assets: [],
    policies: [],
    records: [],
    plans: [],
    costs: {},
    prestarts: [],
    templates: [],
    fleetError: "",
    policyError: "",
    serviceError: "",
    prestartError: "",
    seedTried: false,
    editing: null,
    tab: "fleet",
    unsub: null,
    saving: false,
  };

  function me() { return deps.getMe() || null; }
  function plan() { return complianceFor(me()); }
  function today() { return deps.today(); }
  function admin() { return !!(me() && me().role === "admin"); }
  function seeMoney() { return !!(deps.canSeeMoney && deps.canSeeMoney()); }
  function editService() {
    const who = me();
    return canEditServicing(plan(), who && who.role, who && who.staffRole);
  }
  function editFleet() {
    const who = me();
    return canEditFleet(plan(), who && who.role, who && who.staffRole);
  }
  function addMachineBtn() { return `<button type="button" class="sm-btn primary comp-add" data-comp-add="asset">Add machine</button>`; }
  function viewService() { return canViewServicing(plan()); }
  function viewPrestart() { return canViewPrestart(plan()); }
  function serviceSummary() {
    if (!viewService()) return { overdue: 0, due: 0, names: [] };
    return serviceAttention(serviceViews(state.assets, state.records, state.plans, today()));
  }
  function serviceMap() {
    if (!viewService()) return null;
    const out = {};
    for (const v of serviceViews(state.assets, state.records, state.plans, today())) out[v.asset.id] = v;
    return out;
  }

  // In-app pop-up for supervisors and admins when a machine becomes due soon or overdue for a service.
  // Shown once per machine per due point on this device. The app has no push notifications.
  function servicePopup() {
    if (!viewService() || !editService() || typeof document === "undefined") return;
    if (!state.assets.length || document.querySelector("#svcalert[open], #compform, #prestartform")) return;
    const fresh = [];
    for (const v of serviceViews(state.assets, state.records, state.plans, today())) {
      if (v.k !== "due" && v.k !== "overdue") continue;
      const key = `hw-svc-alert:${v.asset.id}:${v.k}:${v.nextReading || v.nextDate || "none"}`;
      try { if (localStorage.getItem(key)) continue; } catch { /* private mode */ }
      fresh.push({ v, key });
    }
    if (!fresh.length) return;
    showServiceDialog(fresh.map(({ v }) => v), () => fresh.forEach(({ key }) => { try { localStorage.setItem(key, "1"); } catch { /* ignore */ } }));
  }

  function serviceAlertLine(v) {
    const unit = v.unit === "km" ? "km" : "hrs";
    const bits = [`${v.asset.name || "Machine"}: service ${v.k === "overdue" ? "overdue" : "due soon"}`];
    if (v.nextReading) bits.push(`due at ${v.nextReading.toLocaleString("en-AU")} ${unit}${v.current ? `, now ${v.current.toLocaleString("en-AU")} ${unit}` : ""}`);
    else if (v.nextDate) bits.push(`due ${v.nextDate}`);
    return bits.join(" — ");
  }

  function showServiceDialog(views, onClose) {
    let d = document.getElementById("svcalert");
    if (!d) { d = document.createElement("dialog"); d.id = "svcalert"; d.className = "comp-alert"; document.body.appendChild(d); }
    d.innerHTML = `<form method="dialog"><h2>Service due</h2>${views.map(v => `<p>${esc(serviceAlertLine(v))}</p>`).join("")}<div class="comp-actions"><button class="sm-btn primary" value="ok">OK</button><button class="sm-btn" value="view">View servicing</button></div></form>`;
    d.onclose = () => {
      if (onClose) onClose();
      if (d.returnValue === "view") { const ui = deps.getUi(); state.tab = "servicing"; if (ui) ui.view = admin() && !ui.myJobs ? "compliance" : ui.view; if (!admin() || ui.myJobs) ui.opTab = "fleet"; rerender(); }
    };
    if (typeof d.showModal === "function") d.showModal(); else deps.toast(views.map(serviceAlertLine).join(" · "));
  }

  function rerender() {
    const who = me();
    const ui = deps.getUi();
    if (who && who.role === "admin" && !ui.myJobs) deps.rerenderAdmin();
    else deps.rerenderOperator();
  }

  function refresh() {
    servicePopup();
    if (document.querySelector("#compform, #prestartform")) return;
    const who = me();
    if (!who) return;
    const ui = deps.getUi();
    if (who.role === "admin" && !ui.myJobs) {
      if (ui.view === "home" || ui.view === "compliance" || ui.view === "prestart") deps.rerenderAdmin();
    } else if (!ui.opSel && (ui.opTab === "fleet" || ui.opTab === "prestart" || ui.opTab === "today" || !ui.opTab)) {
      deps.rerenderOperator();
    }
  }

  function stop() {
    if (state.unsub) { state.unsub(); state.unsub = null; }
    state.assets = [];
    state.policies = [];
    state.records = [];
    state.plans = [];
    state.costs = {};
    state.prestarts = [];
    state.templates = [];
    state.fleetError = "";
    state.policyError = "";
    state.serviceError = "";
    state.prestartError = "";
    state.seedTried = false;
    state.editing = null;
  }

  async function maybeSeed() {
    if (state.seedTried || state.templates.length || !admin() || !viewPrestart()) return;
    const who = me();
    const docs = templateSeedDocs(state.templates, who && who.uid);
    if (!docs.length) return;
    state.seedTried = true;
    try {
      for (const row of docs) {
        await deps.setDoc(deps.doc(deps.db, "tenants", tenant(), "prestartTemplates", row.id), { ...row.data, updatedAt: deps.serverTimestamp() });
      }
    } catch (err) {
      console.warn("prestart seed", err && (err.code || err.message));
    }
  }

  function start() {
    stop();
    const who = me();
    const entitlement = plan();
    if (!who || (!canViewFleet(entitlement) && !canViewServicing(entitlement) && !canViewPrestart(entitlement))) return;
    const tenantId = resolveMembership({ uid: who.uid, profile: who.cloudProfile || null }).tenantId;
    const offs = [];
    offs.push(deps.onSnapshot(deps.collection(deps.db, "tenants", tenantId, "fleet"), snap => {
      state.assets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      state.fleetError = "";
      refresh();
    }, err => {
      state.fleetError = err && (err.code || err.message) || "unavailable";
      console.warn("fleet", state.fleetError);
      refresh();
    }));
    if (canViewPolicies(entitlement, who.role)) {
      offs.push(deps.onSnapshot(deps.collection(deps.db, "tenants", tenantId, "policies"), snap => {
        state.policies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.policyError = "";
        refresh();
      }, err => {
        state.policyError = err && (err.code || err.message) || "unavailable";
        state.policies = [];
        console.warn("policies", state.policyError);
        refresh();
      }));
    }
    if (canViewServicing(entitlement)) {
      offs.push(deps.onSnapshot(deps.collection(deps.db, "tenants", tenantId, "servicing"), snap => {
        state.records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.serviceError = "";
        refresh();
      }, err => {
        state.serviceError = err && (err.code || err.message) || "unavailable";
        console.warn("servicing", state.serviceError);
        refresh();
      }));
      offs.push(deps.onSnapshot(deps.collection(deps.db, "tenants", tenantId, "servicePlans"), snap => {
        state.plans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        refresh();
      }, err => { console.warn("servicePlans", err && err.code); }));
      if (seeMoney()) {
        offs.push(deps.onSnapshot(deps.collection(deps.db, "tenants", tenantId, "serviceCosts"), snap => {
          const costs = {};
          snap.docs.forEach(d => { costs[d.id] = d.data().amount || ""; });
          state.costs = costs;
          refresh();
        }, err => { state.costs = {}; console.warn("serviceCosts", err && err.code); }));
      }
    }
    if (canViewPrestart(entitlement)) {
      offs.push(deps.onSnapshot(deps.collection(deps.db, "tenants", tenantId, "prestarts"), snap => {
        state.prestarts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.prestartError = "";
        refresh();
      }, err => {
        state.prestartError = err && (err.code || err.message) || "unavailable";
        console.warn("prestarts", state.prestartError);
        refresh();
      }));
      offs.push(deps.onSnapshot(deps.collection(deps.db, "tenants", tenantId, "prestartTemplates"), snap => {
        state.templates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        maybeSeed();
        refresh();
      }, err => { console.warn("prestartTemplates", err && err.code); }));
    }
    state.unsub = () => { offs.forEach(fn => fn()); state.unsub = null; };
  }

  function adminBannerHtml() {
    if (!canViewFleet(plan()) || !admin()) return "";
    const err = [state.fleetError, state.policyError, state.serviceError, state.prestartError].filter(Boolean).join(", ");
    const svc = serviceSummary();
    const defects = viewPrestart() ? openDefects(state.prestarts) : [];
    return bannerHtml({
      assets: state.assets, policies: state.policies, today: today(),
      includePolicies: canViewPolicies(plan(), "admin"), error: err, go: "compliance",
      serviceOverdue: svc.overdue, serviceDue: svc.due, serviceNames: svc.names,
      prestartDefects: defects.length, prestartStops: defects.filter(row => row.doNotOperate).length, prestartNames: defects.map(row => row.assetName || "Machine"),
    });
  }

  function staffBannerHtml() {
    if (!canViewFleet(plan())) return "";
    const svc = editService() ? serviceSummary() : { overdue: 0, due: 0, names: [] };
    return bannerHtml({
      assets: state.assets, policies: [], today: today(),
      includePolicies: false,
      error: state.fleetError ? "Fleet status isn't available right now." : "",
      go: "fleet",
      serviceOverdue: svc.overdue, serviceDue: svc.due, serviceNames: svc.names,
    });
  }

  function tabOf(adminView) {
    const ui = deps.getUi() || {};
    const showService = viewService();
    const showPrestart = viewPrestart();
    const showPolicies = adminView && canViewPolicies(plan(), "admin");
    if ((ui.view === "prestart" || ui.opTab === "prestart") && showPrestart) return "prestart";
    if (state.tab === "servicing" && showService) return "servicing";
    if (state.tab === "prestart" && showPrestart) return "prestart";
    if (state.tab === "policies" && showPolicies) return "policies";
    return "fleet";
  }

  function tabsHtml(tab, adminView) {
    const showService = viewService();
    const showPrestart = viewPrestart();
    const showPolicies = adminView && canViewPolicies(plan(), "admin");
    return `<div class="qtabs" role="tablist">
      <button type="button" data-ctab="fleet" class="${tab === "fleet" ? "on" : ""}" role="tab" aria-selected="${tab === "fleet"}">Fleet <span>${state.assets.length}</span></button>
      ${showService ? `<button type="button" data-ctab="servicing" class="${tab === "servicing" ? "on" : ""}" role="tab" aria-selected="${tab === "servicing"}">Servicing <span>${state.assets.length}</span></button>` : ""}
      ${showPrestart ? `<button type="button" data-ctab="prestart" class="${tab === "prestart" ? "on" : ""}" role="tab" aria-selected="${tab === "prestart"}">Prestart <span>${state.prestarts.length}</span></button>` : ""}
      ${showPolicies ? `<button type="button" data-ctab="policies" class="${tab === "policies" ? "on" : ""}" role="tab" aria-selected="${tab === "policies"}">Policies <span>${state.policies.length}</span></button>` : ""}
    </div>`;
  }

  function prestartBlock(adminView) {
    const err = state.prestartError ? `<p class="err">Couldn't load prestarts (${esc(state.prestartError)}).</p>` : "";
    if (state.editing && state.editing.kind === "template") {
      const type = state.editing.id || "ute";
      return templateFormHtml(type, itemsFor(type, state.templates));
    }
    if (!state.assets.length) {
      const help = editFleet() ? "No machines yet. Add one to start a prestart." : "No machines yet. Ask a supervisor or admin to add one.";
      return `${err}<p class="muted pad comp-empty">${help}</p>${editFleet() ? `<div class="comp-actions">${addMachineBtn()}</div>` : ""}`;
    }
    const asset = state.assets.find(item => item.id === state.prestartAsset) || state.assets[0];
    const kind = assetKind(asset);
    const items = itemsFor(kind, state.templates);
    const form = prestartFormHtml({
      assets: state.assets, assetId: asset && asset.id, items, kind,
      signerName: me() && me().name, defects: openDefects(state.prestarts),
    });
    if (!adminView) return `${err}${form}<h3 class="swh">History</h3>${prestartHistoryHtml(state.prestarts)}`;
    const jobs = deps.getJobs ? deps.getJobs() : [];
    const tools = `<div class="comp-actions">${PRESTART_KINDS.map(row => `<button type="button" class="sm-btn" data-ps-template="${esc(row.id)}">${esc(row.label)}</button>`).join("")}</div>`;
    return `${err}${form}${tools}${prestartAdminHtml({ assets: state.assets, prestarts: state.prestarts, jobs, today: today(), canResolve: true })}`;
  }

  function servicingBlock(editable) {
    const views = serviceViews(state.assets, state.records, state.plans, today());
    const err = state.serviceError ? `<p class="err">Couldn't load servicing (${esc(state.serviceError)}).</p>` : "";
    const who = editable ? "Admins and supervisors can add service records." : "You can see the last service and when the next one is due. Costs are hidden.";
    return `${err}<p class="comp-help">${who} Invoices and photos are not stored in the app.</p>${servicingHtml(views, { editable, showCost: editable && seeMoney(), costs: state.costs })}`;
  }

  function editHtml() {
    const edit = state.editing;
    if (!edit) return "";
    if (edit.kind === "service") {
      const row = state.records.find(r => r.id === edit.id) || null;
      return serviceFormHtml(row, state.assets, state.costs, { showCost: seeMoney(), presetAsset: edit.assetId || "" });
    }
    if (edit.kind === "interval") {
      const asset = state.assets.find(a => a.id === edit.id);
      if (!asset) return "";
      return intervalFormHtml(asset, state.plans.find(p => p.id === asset.id));
    }
    if (edit.kind === "policy") {
      const row = state.policies.find(p => p.id === edit.id) || null;
      return policyFormHtml(row, state.assets, edit.id);
    }
    const row = state.assets.find(a => a.id === edit.id) || null;
    return assetFormHtml(row, edit.id, admin());
  }

  function staffHtml() {
    if (!canViewFleet(plan()) && !viewService() && !viewPrestart()) return "";
    if (state.editing && (state.editing.kind === "service" || state.editing.kind === "interval" || (state.editing.kind === "asset" && editFleet()))) return editHtml();
    const tab = tabOf(false);
    const tabs = (viewService() || viewPrestart()) ? tabsHtml(tab, false) : "";
    if (tab === "prestart") return `${tabs}${prestartBlock(false)}`;
    if (tab === "servicing") return `${tabs}${servicingBlock(editService())}`;
    const err = state.fleetError ? `<p class="muted pad">Fleet status isn't available right now.</p>` : "";
    const canAdd = editFleet();
    const note = canAdd ? "Supervisors and admins can add and edit machines." : "Only a supervisor or admin can change this list.";
    return `${tabs}${err}${canAdd ? `<div class="comp-actions">${addMachineBtn()}</div>` : ""}<p class="comp-help pad-note">Registration and Queensland certificate of inspection (COI). COI is not insurance. You can check a vehicle is roadworthy. ${note}</p>${fleetCardsHtml(state.assets, today(), { editable: canAdd })}`;
  }

  function adminHtml() {
    if (!canViewFleet(plan()) && !viewService() && !viewPrestart()) return `<p class="pad">Compliance is not available for this sign-in.</p>`;
    if (state.editing && state.editing.kind === "template") return prestartBlock(true);
    if (state.editing) return editHtml();
    const tab = tabOf(true);
    const add = tab === "policies" ? `<button type="button" class="sm-btn primary comp-add" data-comp-add="policy">Add policy</button>`
      : tab === "servicing" ? (editService() ? `<button type="button" class="sm-btn primary comp-add" data-comp-add="service">Add service</button>` : "")
      : tab === "prestart" ? ""
      : addMachineBtn();
    const head = `<div class="sm-head"><h1>Compliance</h1>${add}</div>${tabsHtml(tab, true)}`;
    if (tab === "prestart") return `${head}${prestartBlock(true)}`;
    if (tab === "servicing") return `${head}${servicingBlock(true)}`;
    if (tab === "policies") {
      const err = state.policyError ? `<p class="err">Couldn't load policies (${esc(state.policyError)}).</p>` : "";
      return `${head}${err}<p class="comp-help">WorkCover Queensland, public liability, vehicle and plant insurance, and contract works. Staff cannot see policy details.</p>${policyCardsHtml(state.policies, state.assets, today())}`;
    }
    const err = state.fleetError ? `<p class="err">Couldn't load fleet (${esc(state.fleetError)}).</p>` : "";
    return `${head}${err}<p class="comp-help">Registration and Queensland certificate of inspection (COI) for heavy vehicles and trailers. COI is not insurance. Staff can view status and cannot edit.</p>${fleetCardsHtml(state.assets, today(), { editable: true, service: serviceMap() })}`;
  }

  function tenant() {
    return resolveMembership({ uid: me().uid, profile: me().cloudProfile || null }).tenantId;
  }

  async function submitPrestart(form) {
    if (state.saving || !viewPrestart()) return;
    const asset = state.assets.find(item => item.id === form.assetId.value);
    const items = itemsFor(assetKind(asset), state.templates);
    const answers = {};
    for (const item of items) {
      const picked = form.querySelector(`input[name="result-${item.id}"]:checked`);
      answers[item.id] = { result: picked ? picked.value : "", comment: form[`comment-${item.id}`] ? form[`comment-${item.id}`].value : "" };
    }
    const built = prestartPayload({
      asset, day: today(), reading: form.reading.value, readingUnit: form.readingUnit.value, odometer: form.odometer ? form.odometer.value : "",
      answers, signerName: form.signerName.value, items,
    }, me().uid);
    if (!built.ok) return deps.toast(built.reason);
    state.saving = true;
    try {
      await deps.setDoc(deps.doc(deps.db, "tenants", tenant(), "prestarts", newId()), { ...built.data, signedAt: deps.serverTimestamp() });
      form.reset();
      deps.toast(built.data.doNotOperate ? "Do not operate. The defect is flagged." : built.data.defect ? "Submitted. Defect — check before use." : "Prestart submitted.");
      const move = fleetReadingUpdate(asset, built.data, me().uid, built.data.signerName);
      if (move.warn) deps.toast(move.warn);
      if (move.update) {
        try {
          await deps.updateDoc(deps.doc(deps.db, "tenants", tenant(), "fleet", asset.id), { ...move.update, readingAt: deps.serverTimestamp() });
        } catch (err) {
          console.warn("fleet reading", err && (err.code || err.message));
        }
      }
      if (viewService() && built.data.reading) {
        const planRow = state.plans.find(p => p.id === asset.id);
        const before = serviceAfterReading(asset, state.records, planRow, today(), 0, built.data.readingUnit);
        const after = serviceAfterReading(asset, state.records, planRow, today(), built.data.reading, built.data.readingUnit);
        if ((after.k === "due" || after.k === "overdue") && after.k !== before.k) {
          showServiceDialog([after], null);
        }
      }
      rerender();
    } catch (err) {
      deps.toast("Not saved: " + ((err && (err.code || err.message)) || "failed"));
    } finally {
      state.saving = false;
    }
  }

  async function resolveDefect(id) {
    if (!admin()) return;
    const typed = prompt("How was the defect cleared?");
    if (typed == null) return;
    const note = String(typed).trim().slice(0, 500);
    try {
      await deps.updateDoc(deps.doc(deps.db, "tenants", tenant(), "prestarts", id), {
        resolved: true, resolvedBy: me().uid, resolvedNote: note, resolvedAt: deps.serverTimestamp(),
      });
      deps.toast("Defect marked resolved.");
      rerender();
    } catch (err) {
      deps.toast("Not saved: " + ((err && (err.code || err.message)) || "failed"));
    }
  }

  async function save(form) {
    if (state.saving) return;
    const kind = form.dataset.kind;
    if (kind === "template") {
      if (!admin()) return deps.toast("Only an admin can change the checklist.");
      const picked = {};
      for (const item of itemsFor(form.dataset.compId, [])) {
        const box = form[`on-${item.id}`];
        const crit = form[`crit-${item.id}`];
        picked[item.id] = { on: !!(box && box.checked), label: form[`label-${item.id}`] ? form[`label-${item.id}`].value : "", critical: !!(crit && crit.checked) };
      }
      const built = templatePayload(form.dataset.compId, picked, me().uid);
      if (!built.ok) return deps.toast(built.reason);
      state.saving = true;
      try {
        await deps.setDoc(deps.doc(deps.db, "tenants", tenant(), "prestartTemplates", form.dataset.compId), { ...built.data, updatedAt: deps.serverTimestamp() });
        state.editing = null;
        state.tab = "prestart";
        deps.toast("Checklist saved");
        rerender();
      } catch (err) {
        deps.toast("Not saved: " + ((err && (err.code || err.message)) || "failed"));
      } finally {
        state.saving = false;
      }
      return;
    }
    const serviceKind = kind === "service" || kind === "interval";
    if (serviceKind) {
      if (!editService()) return deps.toast("Only an admin or supervisor can change servicing.");
    } else if (kind === "asset" ? !editFleet() : !canEditCompliance(plan(), me() && me().role)) return deps.toast(kind === "asset" ? "Only a supervisor or admin can change machines." : "Only an admin can change this.");
    const raw = Object.fromEntries(new FormData(form).entries());
    if (kind === "asset") raw.coiRequired = !!form.coiRequired.checked;
    const built = kind === "policy" ? policyPayload(raw, me().uid)
      : kind === "service" ? servicePayload(raw, me().uid)
      : kind === "interval" ? planPayload(raw, me().uid)
      : assetPayload(raw, me().uid);
    if (!built.ok) return deps.toast(built.reason);
    const cost = kind === "service" && seeMoney() ? costPayload(raw, me().uid) : { ok: true, data: null };
    if (!cost.ok) return deps.toast(cost.reason);
    const id = kind === "interval" ? form.dataset.compId : (form.dataset.compId || newId());
    const col = kind === "policy" ? "policies" : kind === "service" ? "servicing" : kind === "interval" ? "servicePlans" : "fleet";
    state.saving = true;
    try {
      await deps.setDoc(deps.doc(deps.db, "tenants", tenant(), col, id), { ...built.data, updatedAt: deps.serverTimestamp() });
      if (kind === "service" && seeMoney()) {
        const costRef = deps.doc(deps.db, "tenants", tenant(), "serviceCosts", id);
        if (cost.data) await deps.setDoc(costRef, { ...cost.data, updatedAt: deps.serverTimestamp() });
        else if (state.costs[id]) await deps.deleteDoc(costRef);
      }
      state.editing = null;
      deps.toast("Saved");
      rerender();
    } catch (err) {
      deps.toast("Not saved: " + ((err && (err.code || err.message)) || "failed"));
    } finally {
      state.saving = false;
    }
  }

  async function remove(form) {
    const kind = form.dataset.kind;
    const serviceKind = kind === "service";
    if (serviceKind) {
      if (!editService()) return;
    } else if (!canEditCompliance(plan(), me() && me().role)) return;
    if (!form.dataset.compId) return;
    const label = kind === "policy" ? "policy" : kind === "service" ? "service record" : "vehicle";
    if (!confirm(`Remove this ${label}?`)) return;
    const col = kind === "policy" ? "policies" : kind === "service" ? "servicing" : "fleet";
    try {
      await deps.deleteDoc(deps.doc(deps.db, "tenants", tenant(), col, form.dataset.compId));
      if (kind === "service" && seeMoney() && state.costs[form.dataset.compId]) {
        await deps.deleteDoc(deps.doc(deps.db, "tenants", tenant(), "serviceCosts", form.dataset.compId));
      }
      state.editing = null;
      deps.toast("Removed");
      rerender();
    } catch (err) {
      deps.toast("Not removed: " + ((err && (err.code || err.message)) || "failed"));
    }
  }

  function abandon() { state.editing = null; }

  function bind(root) {
    if (!root) return;
    root.querySelectorAll("[data-ctab]").forEach(b => b.onclick = () => {
      state.tab = b.dataset.ctab === "policies" ? "policies" : b.dataset.ctab === "servicing" ? "servicing" : b.dataset.ctab === "prestart" ? "prestart" : "fleet";
      state.editing = null;
      rerender();
    });
    root.querySelectorAll("[data-ps-template]").forEach(b => b.onclick = () => {
      state.tab = "prestart";
      state.editing = { kind: "template", id: b.dataset.psTemplate };
      rerender();
    });
    root.querySelectorAll("[data-ps-resolve]").forEach(b => b.onclick = () => resolveDefect(b.dataset.psResolve));
    const prestart = root.querySelector("#prestartform");
    if (prestart) {
      prestart.onsubmit = ev => { ev.preventDefault(); submitPrestart(prestart); };
      const machine = prestart.querySelector("[name=assetId]");
      if (machine) machine.onchange = () => { state.prestartAsset = machine.value; rerender(); };
    }
    root.querySelectorAll("[data-comp-add]").forEach(b => b.onclick = () => {
      const add = b.dataset.compAdd;
      state.tab = add === "policies" ? "policies" : add === "service" ? "servicing" : "fleet";
      state.editing = { kind: add === "policy" ? "policy" : add === "service" ? "service" : "asset", id: "", assetId: b.dataset.asset || "" };
      rerender();
    });
    root.querySelectorAll("[data-comp-edit]").forEach(b => b.onclick = () => {
      const kind = b.dataset.compEdit === "policy" ? "policy" : b.dataset.compEdit === "service" ? "service" : b.dataset.compEdit === "interval" ? "interval" : "asset";
      state.editing = { kind, id: b.dataset.compId, assetId: "" };
      rerender();
    });
    const form = root.querySelector("#compform");
    if (!form) return;
    form.onsubmit = ev => { ev.preventDefault(); save(form); };
    const cancel = form.querySelector("[data-comp-cancel]");
    if (cancel) cancel.onclick = () => { state.editing = null; rerender(); };
    const del = form.querySelector("[data-comp-delete]");
    if (del) del.onclick = () => remove(form);
    const coi = form.querySelector("[name=coiRequired]");
    const coiDate = form.querySelector("[data-coi-date]");
    if (coi && coiDate) coi.onchange = () => { coiDate.hidden = !coi.checked; };
    const type = form.querySelector("[name=type]");
    const assetField = form.querySelector("[data-asset-field]");
    if (type && assetField) type.onchange = () => { assetField.hidden = !LINKED_POLICY_TYPES.includes(type.value); };
  }

  return {
    start, stop, bind, adminHtml, staffHtml, adminBannerHtml, staffBannerHtml,
    canSee: () => canViewFleet(plan()) || viewService() || viewPrestart(),
    canEdit: () => canEditCompliance(plan(), me() && me().role),
    canEditService: () => editService(),
    canPrestart: () => viewPrestart(),
    abandon,
    baseFleet: CALLUP_BASE.features.fleet,
  };
}
