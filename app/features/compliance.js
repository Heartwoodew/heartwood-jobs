// CallUp Pro — Compliance.
// Fleet: registration and Queensland certificate of inspection (COI) for
// heavy vehicles and trailers. COI is not insurance.
// Policies: WorkCover (QLD workers' compensation) and insurance. Admin only.
//
// features.fleet, features.policies and features.servicing are on for Heartwood. Base plan stays off.
// Paper photos are not stored. Storage has no fleet or policy path, and this
// build does not add one. Real plates are not seeded.

import { CALLUP_BASE, HEARTWOOD_TENANT, resolveMembership } from "./cloud-storage.js";
import { costPayload, intervalFormHtml, planPayload, serviceAttention, serviceFormHtml, servicePayload, serviceViews, servicingHtml } from "./servicing.js";

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

// Pro includes fleet and policies. Base includes neither. Heartwood uses Pro for this section only.
export const CALLUP_PLANS = Object.freeze({
  base: Object.freeze({
    plan: "base",
    features: Object.freeze({ fleet: false, policies: false, servicing: false }),
  }),
  pro: Object.freeze({
    plan: "pro",
    features: Object.freeze({ fleet: true, policies: true, servicing: true }),
  }),
});

const OVERALL = { expired: "Expired", due: "Due within 30 days", ok: "OK" };
const RANK = { expired: 0, due: 1, ok: 2 };

export function featuresFor(membership) {
  if (membership?.ok && membership.tenantId === HEARTWOOD_TENANT) return CALLUP_PLANS.pro;
  return CALLUP_PLANS.base;
}

export function complianceFor(me) {
  if (!me?.uid) return CALLUP_PLANS.base;
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
export function canEditServicing(plan, role, staffRole) {
  return canViewServicing(plan) && (role === "admin" || role === "supervisor" || staffRole === "supervisor");
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

export function assetPayload(input, uid) {
  const type = input && input.type;
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
  if (!uid) return { ok: false, reason: "Sign in again." };
  return {
    ok: true,
    data: { type, name, rego, regoExpiry, coiRequired, coiExpiry: coiRequired ? coiExpiry : "", notes, updatedBy: uid },
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

export function fleetCardsHtml(assets, today, { editable = false } = {}) {
  const rows = sortBySoonest(withStatus(assets, today, "asset"));
  if (!rows.length) return `<p class="muted pad comp-empty">No vehicles yet.</p>`;
  return `<div class="comp-list">${rows.map(a => {
    const coi = a.status.coiOn
      ? `<div class="comp-line"><span class="lbl">COI</span><span>${esc(a.status.coi.text)}</span>${pill(a.status.coi.k, a.status.coi.label)}</div>`
      : `<div class="comp-line"><span class="lbl">COI</span><span>Not required</span></div>`;
    const edit = editable ? `<button type="button" class="sm-btn" data-comp-edit="asset" data-comp-id="${esc(a.id)}">Edit</button>` : "";
    return `<article class="comp-card" data-asset="${esc(a.id)}">
      <div class="comp-top"><div><b>${esc(a.name || "Vehicle")}</b><div class="sub">${esc(typeLabel(ASSET_TYPES, a.type))}${a.rego ? ` · ${esc(a.rego)}` : ""}</div></div>${pill(a.status.k, a.status.label)}</div>
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

export function bannerHtml({ assets, policies, today, includePolicies, error, go, serviceOverdue = 0, serviceDue = 0, serviceNames = [] }) {
  if (error && !(assets || []).length && !(includePolicies && (policies || []).length)) {
    const title = includePolicies ? "Compliance couldn't load" : "Fleet status couldn't load";
    return `<button type="button" class="swremind sw-due comp-banner" data-go="${esc(go)}"><span class="ic">🚐</span><span><b>${title}</b><small>${esc(error)}</small></span><span class="chev">›</span></button>`;
  }
  const counts = attentionCounts(assets, policies, today, includePolicies);
  if (!needsAttention(counts) && !serviceOverdue && !serviceDue) return "";
  const parts = [
    countLine(counts.fleetExpired, "fleet item expired", "fleet items expired"),
    countLine(counts.fleetDue, "rego or COI due within 30 days", "regos or COIs due within 30 days"),
    includePolicies ? countLine(counts.policyExpired, "policy expired", "policies expired") : "",
    includePolicies ? countLine(counts.policyDue, "policy due within 30 days", "policies due within 30 days") : "",
    countLine(serviceOverdue, "service overdue", "services overdue"),
    countLine(serviceDue, "service due within 30 days", "services due within 30 days"),
  ].filter(Boolean);
  const named = [
    ...sortBySoonest(withStatus(assets, today, "asset")).filter(a => a.status.k !== "ok").map(a => a.name || "Vehicle"),
    ...(includePolicies ? sortBySoonest(withStatus(policies, today, "policy")).filter(p => p.status.k !== "ok").map(p => typeLabel(POLICY_TYPES, p.type)) : []),
    ...serviceNames,
  ];
  const extra = named.length ? ` — ${named.slice(0, 3).join(", ")}${named.length > 3 ? ` +${named.length - 3}` : ""}` : "";
  const cls = (counts.fleetExpired || counts.policyExpired || serviceOverdue) ? "sw-exp" : "sw-due";
  const title = includePolicies ? "Compliance needs attention" : "Fleet needs attention";
  return `<button type="button" class="swremind ${cls} comp-banner" data-go="${esc(go)}"><span class="ic">🚐</span><span><b>${title}</b><small>${esc(parts.join(" · ") + extra)}</small></span><span class="chev">›</span></button>`;
}

function options(list, selected) {
  return list.map(([id, label]) => `<option value="${esc(id)}"${id === selected ? " selected" : ""}>${esc(label)}</option>`).join("");
}

function assetFormHtml(asset, editableId) {
  const a = asset || {};
  return `<form id="compform" class="comp-form" data-kind="asset" data-comp-id="${esc(editableId || "")}">
    <h2>${editableId ? "Edit vehicle" : "Add vehicle"}</h2>
    <p class="comp-help">Registration and Queensland certificate of inspection (COI) for heavy vehicles and trailers. COI is not insurance. Photos of the paper are not stored in the app.</p>
    <label>Type<select name="type">${options(ASSET_TYPES, a.type || "vehicle")}</select></label>
    <label>Name<input name="name" required maxlength="80" value="${esc(a.name || "")}" autocomplete="off"></label>
    <label>Plate / rego<input name="rego" maxlength="20" value="${esc(a.rego || "")}" autocomplete="off"></label>
    <label>Rego expiry<input name="regoExpiry" type="date" value="${esc(a.regoExpiry || "")}"></label>
    <label class="comp-check"><input name="coiRequired" type="checkbox" ${a.coiRequired ? "checked" : ""}> COI required</label>
    <p class="comp-help">COI is the Queensland certificate of inspection. Leave this off for a light vehicle that does not need one.</p>
    <label data-coi-date ${a.coiRequired ? "" : "hidden"}>COI expiry<input name="coiExpiry" type="date" value="${esc(a.coiExpiry || "")}"></label>
    <label>Notes<textarea name="notes" rows="3" maxlength="2000">${esc(a.notes || "")}</textarea></label>
    <div class="comp-actions"><button class="sm-btn primary" type="submit">Save</button><button class="sm-btn" type="button" data-comp-cancel>Cancel</button>${editableId ? `<button class="sm-btn" type="button" data-comp-delete>Remove</button>` : ""}</div>
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
    fleetError: "",
    policyError: "",
    serviceError: "",
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
  function viewService() { return canViewServicing(plan()); }
  function serviceSummary() {
    if (!viewService()) return { overdue: 0, due: 0, names: [] };
    return serviceAttention(serviceViews(state.assets, state.records, state.plans, today()));
  }
  function rerender() {
    const who = me();
    const ui = deps.getUi();
    if (who && who.role === "admin" && !ui.myJobs) deps.rerenderAdmin();
    else deps.rerenderOperator();
  }

  function refresh() {
    if (document.querySelector("#compform")) return;
    const who = me();
    if (!who) return;
    const ui = deps.getUi();
    if (who.role === "admin" && !ui.myJobs) {
      if (ui.view === "home" || ui.view === "compliance") deps.rerenderAdmin();
    } else if (!ui.opSel && (ui.opTab === "fleet" || ui.opTab === "today" || !ui.opTab)) {
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
    state.fleetError = "";
    state.policyError = "";
    state.serviceError = "";
    state.editing = null;
  }

  function start() {
    stop();
    const who = me();
    const entitlement = plan();
    if (!who || (!canViewFleet(entitlement) && !canViewServicing(entitlement))) return;
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
    state.unsub = () => { offs.forEach(fn => fn()); state.unsub = null; };
  }

  function adminBannerHtml() {
    if (!canViewFleet(plan()) || !admin()) return "";
    const err = [state.fleetError, state.policyError, state.serviceError].filter(Boolean).join(", ");
    const svc = serviceSummary();
    return bannerHtml({
      assets: state.assets, policies: state.policies, today: today(),
      includePolicies: canViewPolicies(plan(), "admin"), error: err, go: "compliance",
      serviceOverdue: svc.overdue, serviceDue: svc.due, serviceNames: svc.names,
    });
  }

  function staffBannerHtml() {
    if (!canViewFleet(plan())) return "";
    return bannerHtml({
      assets: state.assets, policies: [], today: today(),
      includePolicies: false,
      error: state.fleetError ? "Fleet status isn't available right now." : "",
      go: "fleet",
    });
  }

  function tabOf(adminView) {
    const showService = viewService();
    const showPolicies = adminView && canViewPolicies(plan(), "admin");
    if (state.tab === "servicing" && showService) return "servicing";
    if (state.tab === "policies" && showPolicies) return "policies";
    return "fleet";
  }

  function tabsHtml(tab, adminView) {
    const showService = viewService();
    const showPolicies = adminView && canViewPolicies(plan(), "admin");
    return `<div class="qtabs" role="tablist">
      <button type="button" data-ctab="fleet" class="${tab === "fleet" ? "on" : ""}" role="tab" aria-selected="${tab === "fleet"}">Fleet <span>${state.assets.length}</span></button>
      ${showService ? `<button type="button" data-ctab="servicing" class="${tab === "servicing" ? "on" : ""}" role="tab" aria-selected="${tab === "servicing"}">Servicing <span>${state.assets.length}</span></button>` : ""}
      ${showPolicies ? `<button type="button" data-ctab="policies" class="${tab === "policies" ? "on" : ""}" role="tab" aria-selected="${tab === "policies"}">Policies <span>${state.policies.length}</span></button>` : ""}
    </div>`;
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
    return assetFormHtml(row, edit.id);
  }

  function staffHtml() {
    if (!canViewFleet(plan()) && !viewService()) return "";
    if (state.editing && (state.editing.kind === "service" || state.editing.kind === "interval")) return editHtml();
    const tab = tabOf(false);
    const tabs = viewService() ? tabsHtml(tab, false) : "";
    if (tab === "servicing") return `${tabs}${servicingBlock(editService())}`;
    const err = state.fleetError ? `<p class="muted pad">Fleet status isn't available right now.</p>` : "";
    return `${tabs}${err}<p class="comp-help pad-note">Registration and Queensland certificate of inspection (COI). COI is not insurance. You can check a vehicle is roadworthy. Only an admin can change this list.</p>${fleetCardsHtml(state.assets, today(), { editable: false })}`;
  }

  function adminHtml() {
    if (!canViewFleet(plan()) && !viewService()) return `<p class="pad">Compliance is a CallUp Pro feature.</p>`;
    if (state.editing) return editHtml();
    const tab = tabOf(true);
    const add = tab === "policies" ? `<button type="button" class="sm-btn primary comp-add" data-comp-add="policy">Add policy</button>`
      : tab === "servicing" ? (editService() ? `<button type="button" class="sm-btn primary comp-add" data-comp-add="service">Add service</button>` : "")
      : `<button type="button" class="sm-btn primary comp-add" data-comp-add="asset">Add vehicle</button>`;
    const head = `<div class="sm-head"><h1>Compliance <span class="comp-pro">Pro</span></h1>${add}</div>${tabsHtml(tab, true)}`;
    if (tab === "servicing") return `${head}${servicingBlock(true)}`;
    if (tab === "policies") {
      const err = state.policyError ? `<p class="err">Couldn't load policies (${esc(state.policyError)}).</p>` : "";
      return `${head}${err}<p class="comp-help">WorkCover Queensland, public liability, vehicle and plant insurance, and contract works. Staff cannot see policy details.</p>${policyCardsHtml(state.policies, state.assets, today())}`;
    }
    const err = state.fleetError ? `<p class="err">Couldn't load fleet (${esc(state.fleetError)}).</p>` : "";
    return `${head}${err}<p class="comp-help">Registration and Queensland certificate of inspection (COI) for heavy vehicles and trailers. COI is not insurance. Staff can view status and cannot edit.</p>${fleetCardsHtml(state.assets, today(), { editable: true })}`;
  }

  function tenant() {
    return resolveMembership({ uid: me().uid, profile: me().cloudProfile || null }).tenantId;
  }

  async function save(form) {
    if (state.saving) return;
    const kind = form.dataset.kind;
    const serviceKind = kind === "service" || kind === "interval";
    if (serviceKind) {
      if (!editService()) return deps.toast("Only an admin or supervisor can change servicing.");
    } else if (!canEditCompliance(plan(), me() && me().role)) return deps.toast("Only an admin can change this.");
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
      state.tab = b.dataset.ctab === "policies" ? "policies" : b.dataset.ctab === "servicing" ? "servicing" : "fleet";
      state.editing = null;
      rerender();
    });
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
    canSee: () => canViewFleet(plan()) || viewService(),
    canEdit: () => canEditCompliance(plan(), me() && me().role),
    canEditService: () => editService(),
    abandon,
    baseFleet: CALLUP_BASE.features.fleet,
  };
}
