// Daily prestart for a fleet machine. Staff submit once. The record stays as submitted.
// Built-in checklists cover the usual Australian / Queensland daily plant checks.
// An organisation's saved template replaces the default for that kind. If the
// organisation has no templates, the app can store these defaults once.
// Photos are not stored. Storage has no prestart path, and this build does not add one.

export const PRESTART_SECTIONS = Object.freeze([
  ["walkaround", "Walk-around"],
  ["fluids", "Fluids"],
  ["cab", "Operator cab and controls"],
  ["safety", "Safety devices"],
  ["attachments", "Attachments"],
  ["startup", "Start-up and function test"],
]);

const SECTION_LABEL = Object.fromEntries(PRESTART_SECTIONS);

export const PRESTART_KINDS = Object.freeze([
  Object.freeze({ id: "skid-steer", label: "Skid steer / compact track loader", meter: "hours" }),
  Object.freeze({ id: "excavator", label: "Excavator", meter: "hours" }),
  Object.freeze({ id: "tip-truck", label: "Tip truck", meter: "km" }),
  Object.freeze({ id: "ute", label: "Ute / light vehicle", meter: "km" }),
  Object.freeze({ id: "trailer", label: "Trailer", meter: "none" }),
  Object.freeze({ id: "other-plant", label: "Other plant", meter: "hours" }),
]);

const KIND = Object.fromEntries(PRESTART_KINDS.map(kind => [kind.id, kind]));

function check(id, section, label, critical) {
  return Object.freeze({ id, section, label, critical: !!critical });
}

const CATALOG = Object.freeze({
  "skid-steer": Object.freeze([
    check("ss-leak", "walkaround", "No fresh leaks or damage underneath", true),
    check("ss-tracks", "walkaround", "Tyres or tracks, tension and hardware", true),
    check("ss-steps", "walkaround", "Steps, grab rails and guards fitted", false),
    check("ss-oil", "fluids", "Engine oil level", true),
    check("ss-hyd", "fluids", "Hydraulic oil level and hose leaks", true),
    check("ss-cool", "fluids", "Coolant and fuel, caps secure", false),
    check("ss-belt", "cab", "Seat and seatbelt", true),
    check("ss-horn", "cab", "Controls neutral, horn and beacon", false),
    check("ss-rops", "safety", "ROPS and FOPS secure", true),
    check("ss-ext", "safety", "Fire extinguisher in date", false),
    check("ss-coup", "attachments", "Coupler locked and pins in", true),
    check("ss-brake", "startup", "Park brake and service brake hold", true),
    check("ss-run", "startup", "Start-up, gauges and function test", true),
  ]),
  excavator: Object.freeze([
    check("ex-leak", "walkaround", "No fresh leaks, cracks or loose panels", true),
    check("ex-tracks", "walkaround", "Tracks or tyres, rollers and idlers", true),
    check("ex-pins", "walkaround", "Boom, stick and bucket pins in place", true),
    check("ex-oil", "fluids", "Engine oil level", true),
    check("ex-hyd", "fluids", "Hydraulic oil and boom hoses", true),
    check("ex-cool", "fluids", "Coolant, fuel and pin grease", false),
    check("ex-belt", "cab", "Seat and seatbelt", true),
    check("ex-horn", "cab", "Mirrors, camera, horn and lights", false),
    check("ex-cab", "safety", "Cab, exit and fire extinguisher", true),
    check("ex-hitch", "safety", "Quick hitch pin or alarm, if fitted", true),
    check("ex-bucket", "attachments", "Bucket or hitch locked on", true),
    check("ex-brake", "startup", "Slew and travel brakes", true),
    check("ex-run", "startup", "Slew, boom and travel function test", true),
  ]),
  "tip-truck": Object.freeze([
    check("tt-body", "walkaround", "Body, chassis and suspension", true),
    check("tt-tyres", "walkaround", "Tyres, wheels and wheel nuts", true),
    check("tt-lights", "walkaround", "Lights, indicators and reflectors", false),
    check("tt-glass", "walkaround", "Windscreen, wipers and mirrors", false),
    check("tt-oil", "fluids", "Engine oil level", true),
    check("tt-cool", "fluids", "Coolant, brake fluid and fuel leaks", false),
    check("tt-hyd", "fluids", "Tipper hydraulic oil and hoses", true),
    check("tt-belt", "cab", "Seatbelt", true),
    check("tt-horn", "cab", "Horn, brake pedal and park brake", true),
    check("tt-ext", "safety", "Beacon, extinguisher and warning lamps", false),
    check("tt-gate", "safety", "Tailgate and load cover latched", true),
    check("tt-hoist", "attachments", "Hoist hinges, tailgate and PTO guard", true),
    check("tt-air", "startup", "Brake pressure and warning lamps", true),
    check("tt-tip", "startup", "Body raises and lowers, no creep", true),
  ]),
  ute: Object.freeze([
    check("ut-body", "walkaround", "Body, glass and mirrors", true),
    check("ut-tyres", "walkaround", "Tyres, spare and wheel nuts", true),
    check("ut-lights", "walkaround", "Lights, indicators and brake lights", false),
    check("ut-oil", "fluids", "Engine oil level", true),
    check("ut-cool", "fluids", "Coolant, brake fluid and leaks", false),
    check("ut-belt", "cab", "Seatbelts", true),
    check("ut-horn", "cab", "Horn, wipers and demister", false),
    check("ut-brake", "safety", "Service brake and park brake", true),
    check("ut-ext", "safety", "Extinguisher and first aid kit", false),
    check("ut-load", "safety", "Tray load restrained", true),
    check("ut-tow", "attachments", "Towbar, plug and loose tools", false),
    check("ut-run", "startup", "Start, lamps out and brake test", true),
  ]),
  trailer: Object.freeze([
    check("tr-hitch", "walkaround", "Coupling, hitch and locking pin", true),
    check("tr-chain", "walkaround", "Safety chains and shackles", true),
    check("tr-break", "walkaround", "Breakaway brake and cable", true),
    check("tr-tyres", "walkaround", "Tyres, wheels and wheel nuts", true),
    check("tr-lights", "walkaround", "Lights, reflectors and tape", true),
    check("tr-legs", "walkaround", "Jockey wheel or legs up and locked", false),
    check("tr-fluid", "fluids", "Brake or hydraulic leaks", false),
    check("tr-plug", "cab", "Tow plug and brake controller", true),
    check("tr-park", "safety", "Park brake or wheel chocks", true),
    check("tr-load", "safety", "Load restraint, gates and headboard", true),
    check("tr-ramps", "attachments", "Ramps pinned and secured", true),
    check("tr-lamps", "startup", "Lights work with the tow vehicle", true),
  ]),
  "other-plant": Object.freeze([
    check("op-guard", "walkaround", "Guards fitted, no new damage", true),
    check("op-wheels", "walkaround", "Wheels, tracks or stabilisers", true),
    check("op-leak", "walkaround", "No fresh leaks under the machine", true),
    check("op-oil", "fluids", "Oils and coolant, no leak", true),
    check("op-fuel", "fluids", "Fuel and batteries secure", false),
    check("op-belt", "cab", "Seatbelt if fitted, controls neutral", true),
    check("op-horn", "cab", "Horn, lights and emergency stop", true),
    check("op-iso", "safety", "Isolation and emergency stop", true),
    check("op-ext", "safety", "Fire extinguisher and warning signs", false),
    check("op-pin", "attachments", "Pins, hoses and attachment locks", true),
    check("op-brake", "startup", "Park device or brake holds", true),
    check("op-run", "startup", "Start-up and function test", true),
  ]),
});

const LABEL = {};
for (const rows of Object.values(CATALOG)) {
  for (const item of rows) LABEL[item.id] = item.label;
}

export const DEFAULT_PRESTART = Object.freeze(Object.fromEntries(
  PRESTART_KINDS.map(kind => [kind.id, Object.freeze(CATALOG[kind.id].map(item => item.id))]),
));

function text(value) {
  return String(value ?? "").trim();
}

function whole(value) {
  if (value === "" || value == null) return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 10000000) return null;
  return n;
}

export function kindMeta(id) {
  return KIND[id] || null;
}

export function assetKind(asset) {
  const chosen = asset && asset.prestartKind;
  if (KIND[chosen]) return chosen;
  if (asset && asset.type === "trailer") return "trailer";
  if (asset && asset.type === "plant") return "other-plant";
  return "ute";
}

function catalogOf(kind) {
  return CATALOG[kind] || CATALOG.ute;
}

function copyItem(item, label, critical) {
  return {
    id: item.id,
    label: text(label).slice(0, 60) || item.label,
    section: item.section,
    critical: !!critical,
  };
}

export function itemsFor(kind, templates) {
  const catalog = catalogOf(kind);
  const known = new Map(catalog.map(item => [item.id, item]));
  const saved = (templates || []).find(row => row.id === kind);
  if (saved && Array.isArray(saved.items) && saved.items.length) {
    const items = saved.items.map(item => {
      const base = item && known.get(item.id);
      if (!base) return null;
      const critical = typeof item.critical === "boolean" ? item.critical : base.critical;
      return copyItem(base, item.label, critical);
    }).filter(Boolean);
    if (items.length) return items;
  }
  return catalog.map(item => copyItem(item, item.label, item.critical));
}

export function templatePayload(kind, picked, uid) {
  if (!KIND[kind]) return { ok: false, reason: "Choose a machine kind." };
  const items = catalogOf(kind).filter(item => picked && picked[item.id] && picked[item.id].on).map(item => ({
    id: item.id,
    label: text(picked[item.id].label).slice(0, 60) || item.label,
    critical: !!(picked[item.id].critical),
  }));
  if (!items.length || items.length > 16) return { ok: false, reason: "Keep between 1 and 16 checks." };
  if (!uid) return { ok: false, reason: "Sign in again." };
  return { ok: true, data: { items, updatedBy: uid } };
}

export function templateSeedDocs(existing, uid) {
  if (!uid || (existing && existing.length)) return [];
  return PRESTART_KINDS.map(kind => {
    const picked = {};
    for (const item of CATALOG[kind.id]) picked[item.id] = { on: true, label: item.label, critical: item.critical };
    return { id: kind.id, data: templatePayload(kind.id, picked, uid).data };
  });
}

export function templateReviewMarkdown() {
  const meterLine = {
    hours: "Enter the hour meter (hrs).",
    km: "Enter the odometer (km).",
    both: "Record the engine hours and the odometer.",
    none: "No hour meter. Leave the reading blank.",
  };
  const lines = [];
  for (const kind of PRESTART_KINDS) {
    lines.push(`### ${kind.label}`, "", meterLine[kind.meter], "");
    let section = "";
    for (const item of CATALOG[kind.id]) {
      if (item.section !== section) {
        if (section) lines.push("");
        section = item.section;
        lines.push(`**${SECTION_LABEL[section]}**`, "");
      }
      lines.push(`- ${item.label}${item.critical ? " — **Do not operate**" : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function prestartPayload({ asset, day, reading, readingUnit, odometer, answers, signerName, items }, uid) {
  if (!asset || !asset.id) return { ok: false, reason: "Choose a machine." };
  const kind = assetKind(asset);
  const meta = KIND[kind];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return { ok: false, reason: "Today's date is missing." };
  let hours = whole(reading);
  let km = whole(odometer);
  if (hours == null || km == null) return { ok: false, reason: "Hours or km must be a whole number." };
  if (meta.meter === "km" && !hours) return { ok: false, reason: "Enter the odometer (km)." };
  if ((meta.meter === "hours" || meta.meter === "both") && !hours) return { ok: false, reason: "Enter the hour meter (hrs)." };
  let unit = "";
  if (meta.meter === "none") {
    hours = 0;
    km = 0;
  } else if (meta.meter === "km") {
    unit = hours ? "km" : "";
    km = 0;
  } else if (meta.meter === "both") {
    unit = hours ? "hours" : "";
  } else {
    unit = hours ? "hours" : "";
    km = 0;
  }
  if (text(readingUnit) && !["", "hours", "km"].includes(text(readingUnit))) return { ok: false, reason: "Choose hours or km." };
  const name = text(signerName);
  if (name.length < 2 || name.length > 80) return { ok: false, reason: "Add your name." };
  if (!uid) return { ok: false, reason: "Sign in again." };
  const list = [];
  for (const item of items || []) {
    const answer = answers && answers[item.id];
    const result = answer && answer.result;
    const comment = text(answer && answer.comment);
    if (!["pass", "fail", "na"].includes(result)) return { ok: false, reason: `Mark ${item.label}.` };
    if (result === "fail" && !comment) return { ok: false, reason: `Add a comment for ${item.label}.` };
    if (comment.length > 500) return { ok: false, reason: "A comment is too long." };
    list.push({ id: item.id, result, comment, critical: !!item.critical });
  }
  if (!list.length) return { ok: false, reason: "This checklist is empty." };
  const defect = list.some(item => item.result === "fail");
  return {
    ok: true,
    data: {
      assetId: asset.id,
      assetType: asset.type === "trailer" || asset.type === "plant" || asset.type === "vehicle" ? asset.type : "vehicle",
      assetName: text(asset.name).slice(0, 80) || "Machine",
      kind,
      day,
      reading: unit ? hours : 0,
      readingUnit: unit,
      odometer: km,
      items: list,
      signerUid: uid,
      signerName: name,
      defect,
      doNotOperate: list.some(item => item.result === "fail" && item.critical),
      resolved: false,
    },
  };
}

export function hasFail(record) {
  return !!record && Array.isArray(record.items) && record.items.some(item => item.result === "fail");
}

export function stopsOperation(record) {
  if (!isOpenDefect(record)) return false;
  if (record.doNotOperate) return true;
  return record.items.some(item => item.result === "fail" && item.critical);
}

export function isOpenDefect(record) {
  return hasFail(record) && !record.resolved;
}

export function openDefects(records) {
  return (records || []).filter(isOpenDefect);
}

export function missingToday({ assets, prestarts, jobs, today }) {
  const todayRows = (prestarts || []).filter(row => row.day === today);
  const doneAssets = new Set(todayRows.map(row => row.assetId));
  const signed = new Set(todayRows.map(row => row.signerUid));
  const machines = (assets || []).filter(asset => !doneAssets.has(asset.id));
  const people = new Map();
  for (const job of jobs || []) {
    if (!job || job.date !== today || job.status === "Cancelled") continue;
    const uids = Array.isArray(job.assigned) ? job.assigned : [];
    const names = Array.isArray(job.assignedNames) ? job.assignedNames : [];
    uids.forEach((uid, index) => {
      if (uid && !people.has(uid)) people.set(uid, names[index] || uid);
    });
  }
  const missingPeople = [...people.entries()].filter(([uid]) => !signed.has(uid)).map(([, name]) => name);
  return { machines, missingPeople };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatAu(iso) {
  if (!iso) return "";
  const [y, m, day] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[+m - 1] ? `${+day} ${months[+m - 1]} ${y}` : iso;
}

function itemLabel(id, items) {
  const found = (items || []).find(item => item.id === id);
  return (found && found.label) || LABEL[id] || id;
}

function meterFields(meter) {
  if (meter === "none") {
    return `<input type="hidden" name="reading" value=""><input type="hidden" name="readingUnit" value=""><input type="hidden" name="odometer" value="">`;
  }
  if (meter === "km") {
    return `<label>Odometer (km)<input name="reading" type="number" min="1" step="1" required inputmode="numeric" autocomplete="off" placeholder="km"></label><input type="hidden" name="readingUnit" value="km"><input type="hidden" name="odometer" value="">`;
  }
  if (meter === "both") {
    return `<label>Engine hours<input name="reading" inputmode="numeric" autocomplete="off"></label><label>Odometer (km)<input name="odometer" inputmode="numeric" autocomplete="off"></label><input type="hidden" name="readingUnit" value="hours">`;
  }
  return `<label>Hour meter (hrs)<input name="reading" type="number" min="1" step="1" required inputmode="numeric" autocomplete="off" placeholder="hrs"></label><input type="hidden" name="readingUnit" value="hours"><input type="hidden" name="odometer" value="">`;
}

function meterHint(meter) {
  if (meter === "km") return "Enter the odometer (km).";
  if (meter === "both") return "Record the engine hours and the odometer.";
  if (meter === "none") return "No hour meter on this trailer.";
  return "Enter the hour meter (hrs).";
}

export function prestartFormHtml({ assets, assetId, items, signerName, defects, kind }) {
  const chosen = (assets || []).find(asset => asset.id === assetId) || (assets || [])[0];
  const meta = KIND[kind] || KIND[assetKind(chosen)];
  const open = chosen ? (defects || []).filter(row => row.assetId === chosen.id) : [];
  const stopped = open.some(stopsOperation);
  const warn = stopped ? "Do not operate" : open.length ? "Defect — check before use" : "";
  const options = (assets || []).map(asset => `<option value="${esc(asset.id)}"${chosen && asset.id === chosen.id ? " selected" : ""}>${esc(asset.name || "Machine")}${asset.rego ? ` · ${esc(asset.rego)}` : ""}</option>`).join("");
  const groups = [];
  for (const item of items || []) {
    const last = groups[groups.length - 1];
    if (!last || last.section !== item.section) groups.push({ section: item.section, rows: [item] });
    else last.rows.push(item);
  }
  const rows = groups.map(group => `<h3 class="ps-sec">${esc(SECTION_LABEL[group.section] || "Checks")}</h3>${group.rows.map(item => `<fieldset class="ps-row${item.critical ? " ps-critical" : ""}"><legend>${esc(item.label)}${item.critical ? `<span class="ps-crit">Do not operate</span>` : ""}</legend>
    <div class="ps-choices">
      <label class="ps-pass"><input type="radio" name="result-${esc(item.id)}" value="pass" required><span>Pass</span></label>
      <label class="ps-fail"><input type="radio" name="result-${esc(item.id)}" value="fail"><span>Fail</span></label>
      <label class="ps-na"><input type="radio" name="result-${esc(item.id)}" value="na"><span>N/A</span></label>
    </div>
    <label class="ps-note">Comment<input name="comment-${esc(item.id)}" maxlength="500" autocomplete="off"></label>
  </fieldset>`).join("")}`).join("");
  return `<form id="prestartform" class="comp-form" data-kind="${esc(meta.id)}">
    <p class="comp-help">Any machine in the fleet. You do not have to be assigned to it. A fail on a marked item means do not operate. Your name and the time are saved. Photos are not stored in the app.</p>
    ${warn ? `<p class="swpill sw-exp">${esc(warn)}</p>` : ""}
    <label>Machine<select name="assetId">${options}</select></label>
    <p class="comp-help">Checklist · ${esc(meta.label)}. ${esc(meterHint(meta.meter))}</p>
    ${meterFields(meta.meter)}
    ${rows}
    <label>Your name<input name="signerName" required maxlength="80" value="${esc(signerName || "")}" autocomplete="name"></label>
    <button class="sm-btn primary" type="submit">Submit prestart</button>
  </form>`;
}

export function templateFormHtml(kind, items) {
  const meta = KIND[kind] || PRESTART_KINDS[0];
  const current = new Map((items || []).map(item => [item.id, item]));
  const groups = [];
  for (const item of catalogOf(meta.id)) {
    const last = groups[groups.length - 1];
    if (!last || last.section !== item.section) groups.push({ section: item.section, rows: [item] });
    else last.rows.push(item);
  }
  const rows = groups.map(group => `<h3 class="ps-sec">${esc(SECTION_LABEL[group.section] || "Checks")}</h3>${group.rows.map(item => {
    const saved = current.get(item.id);
    const on = saved ? true : !(items || []).length ? true : false;
    const label = (saved && saved.label) || item.label;
    const critical = saved ? !!saved.critical : !(items || []).length ? item.critical : item.critical;
    return `<label class="comp-check"><input type="checkbox" name="on-${esc(item.id)}" ${on ? "checked" : ""}><span>${esc(item.label)}</span></label>
    <label>Label<input name="label-${esc(item.id)}" maxlength="60" value="${esc(label)}"></label>
    <label class="comp-check"><input type="checkbox" name="crit-${esc(item.id)}" ${critical ? "checked" : ""}><span>Do not operate if this fails</span></label>`;
  }).join("")}`).join("");
  return `<form id="compform" class="comp-form" data-kind="template" data-comp-id="${esc(meta.id)}">
    <h2>Checklist · ${esc(meta.label)}</h2>
    <p class="comp-help">These checks are used the next time someone starts this kind of machine. A fail on a marked item means do not operate.</p>
    ${rows}
    <div class="comp-actions"><button class="sm-btn primary" type="submit">Save checklist</button><button class="sm-btn" type="button" data-comp-cancel>Cancel</button></div>
  </form>`;
}

function readingText(row) {
  const parts = [];
  if (row.reading && row.readingUnit === "hours") parts.push(`${Number(row.reading).toLocaleString("en-AU")} hours`);
  if (row.reading && row.readingUnit === "km") parts.push(`${Number(row.reading).toLocaleString("en-AU")} km`);
  if (row.odometer) parts.push(`${Number(row.odometer).toLocaleString("en-AU")} km`);
  return parts.join(" · ");
}

function statusPill(row) {
  if (stopsOperation(row)) return `<span class="swpill sw-exp">Do not operate</span>`;
  if (isOpenDefect(row)) return `<span class="swpill sw-exp">Defect — check before use</span>`;
  if (hasFail(row)) return `<span class="swpill sw-ok">Resolved</span>`;
  return `<span class="swpill sw-ok">Pass</span>`;
}

export function prestartHistoryHtml(prestarts) {
  const history = [...(prestarts || [])].sort((a, b) => String(b.day).localeCompare(String(a.day)) || String(b.assetName || "").localeCompare(String(a.assetName || "")));
  if (!history.length) return `<p class="muted pad">No prestarts yet.</p>`;
  const days = [];
  for (const row of history) {
    const last = days[days.length - 1];
    if (!last || last.day !== row.day) days.push({ day: row.day, rows: [row] });
    else last.rows.push(row);
  }
  return days.map(group => `<h3 class="swh">${esc(formatAu(group.day))}</h3>${group.rows.map(row => {
    const meter = readingText(row);
    return `<article class="comp-card" data-prestart-history="${esc(row.id || row.assetId)}"><div class="comp-top"><div><b>${esc(row.assetName || "Machine")}</b><div class="sub">${esc(row.signerName || "")}${meter ? ` · ${esc(meter)}` : ""}</div></div>${statusPill(row)}</div></article>`;
  }).join("")}`).join("");
}

export function prestartAdminHtml({ assets, prestarts, jobs, today, canResolve }) {
  const defects = openDefects(prestarts);
  const missing = missingToday({ assets, prestarts, jobs, today });
  const defectCards = defects.map(row => {
    const fails = (row.items || []).filter(item => item.result === "fail").map(item => `${itemLabel(item.id, [])}${item.comment ? ` · ${item.comment}` : ""}`);
    return `<article class="comp-card" data-prestart="${esc(row.id)}">
      <div class="comp-top"><div><b>${esc(row.assetName || "Machine")}</b><div class="sub">${esc(formatAu(row.day))} · ${esc(row.signerName || "")}</div></div>${statusPill(row)}</div>
      <p class="sub">${esc(fails.join(" · "))}</p>
      ${canResolve ? `<div class="comp-actions"><button type="button" class="sm-btn" data-ps-resolve="${esc(row.id)}">Mark resolved</button></div>` : ""}
    </article>`;
  }).join("");
  const machineLine = missing.machines.length ? missing.machines.map(asset => esc(asset.name || "Machine")).join(", ") : "Every machine has a prestart today.";
  const peopleLine = missing.missingPeople.length ? missing.missingPeople.map(esc).join(", ") : "Everyone assigned today has done a prestart.";
  return `<div class="comp-list">
    <section class="comp-card"><b>No prestart today</b><p class="sub">${machineLine}</p><b>Assigned today, no prestart</b><p class="sub">${peopleLine}</p></section>
    ${defectCards}
    ${prestartHistoryHtml(prestarts)}
  </div>`;
}

/**
 * Fleet reading change after a prestart. Only moves the machine's reading up.
 * Returns { update: data|null, warn: "" } — a lower reading is saved with the prestart but not on Fleet.
 */
export function fleetReadingUpdate(asset, prestart, uid, name) {
  const reading = Number(prestart && prestart.reading) || 0;
  const unit = prestart && prestart.readingUnit;
  if (!asset || !reading || !unit) return { update: null, warn: "" };
  const prev = Number(asset.reading) || 0;
  const sameUnit = !asset.readingUnit || asset.readingUnit === unit;
  if (sameUnit && prev && reading < prev) {
    const word = unit === "km" ? "km" : "hrs";
    return { update: null, warn: `That reading (${reading.toLocaleString("en-AU")} ${word}) is lower than the last one on Fleet (${prev.toLocaleString("en-AU")} ${word}). Prestart saved; Fleet not changed. Check the meter.` };
  }
  if (sameUnit && reading === prev) return { update: null, warn: "" };
  return { update: { reading, readingUnit: unit, readingBy: uid, readingByName: String(name || "").slice(0, 80) }, warn: "" };
}
