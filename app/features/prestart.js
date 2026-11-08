// Daily prestart for a fleet machine. Staff submit once. The record stays as submitted.
// A fail stays "defect — check before use" until an admin marks it resolved.
// Photos are not stored. Storage has no prestart path, and this build does not add one.

export const PRESTART_ITEMS = Object.freeze([
  ["fluids", "Fluids"],
  ["tyres", "Tyres / tracks"],
  ["lights", "Lights"],
  ["brakes", "Brakes"],
  ["horn", "Horn / beacon"],
  ["seatbelt", "Seatbelt"],
  ["hydraulics", "Hydraulics / hoses"],
  ["attachments", "Attachments / couplers"],
  ["extinguisher", "Fire extinguisher"],
  ["guards", "Guards"],
  ["damage", "Damage"],
]);

const LABEL = Object.fromEntries(PRESTART_ITEMS);

export const DEFAULT_PRESTART = Object.freeze({
  vehicle: Object.freeze(["fluids", "tyres", "lights", "brakes", "horn", "seatbelt", "hydraulics", "attachments", "extinguisher", "guards", "damage"]),
  trailer: Object.freeze(["tyres", "lights", "brakes", "attachments", "guards", "damage"]),
  plant: Object.freeze(["fluids", "tyres", "lights", "horn", "seatbelt", "hydraulics", "attachments", "extinguisher", "guards", "damage"]),
});

function text(value) {
  return String(value ?? "").trim();
}

function whole(value) {
  if (value === "" || value == null) return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 10000000) return null;
  return n;
}

export function itemsFor(type, templates) {
  const saved = (templates || []).find(t => t.id === type);
  if (saved && Array.isArray(saved.items) && saved.items.length) {
    return saved.items.filter(item => item && LABEL[item.id]).map(item => ({
      id: item.id,
      label: text(item.label).slice(0, 60) || LABEL[item.id],
    }));
  }
  return (DEFAULT_PRESTART[type] || DEFAULT_PRESTART.vehicle).map(id => ({ id, label: LABEL[id] }));
}

export function templatePayload(type, picked, uid) {
  if (!DEFAULT_PRESTART[type]) return { ok: false, reason: "Choose vehicle, trailer or plant." };
  const items = PRESTART_ITEMS.filter(([id]) => picked && picked[id] && picked[id].on).map(([id]) => ({
    id,
    label: text(picked[id].label).slice(0, 60) || LABEL[id],
  }));
  if (!items.length || items.length > 12) return { ok: false, reason: "Keep between 1 and 12 checks." };
  if (!uid) return { ok: false, reason: "Sign in again." };
  return { ok: true, data: { items, updatedBy: uid } };
}

export function prestartPayload({ asset, day, reading, readingUnit, answers, signerName, items }, uid) {
  if (!asset || !asset.id) return { ok: false, reason: "Choose a machine." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return { ok: false, reason: "Today's date is missing." };
  const hours = whole(reading);
  const unit = text(readingUnit);
  if (hours == null) return { ok: false, reason: "Hours or km must be a whole number." };
  if (!["", "hours", "km"].includes(unit)) return { ok: false, reason: "Choose hours or km." };
  if (hours > 0 && !unit) return { ok: false, reason: "Choose hours or km for that reading." };
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
    list.push({ id: item.id, result, comment });
  }
  if (!list.length) return { ok: false, reason: "This checklist is empty." };
  return {
    ok: true,
    data: {
      assetId: asset.id,
      assetType: asset.type || "vehicle",
      assetName: text(asset.name).slice(0, 80) || "Machine",
      day,
      reading: unit ? hours : 0,
      readingUnit: hours && unit ? unit : "",
      items: list,
      signerUid: uid,
      signerName: name,
      defect: list.some(item => item.result === "fail"),
      resolved: false,
    },
  };
}

export function hasFail(record) {
  return !!record && Array.isArray(record.items) && record.items.some(item => item.result === "fail");
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

export function prestartFormHtml({ assets, assetId, items, signerName, defects }) {
  const chosen = (assets || []).find(asset => asset.id === assetId) || (assets || [])[0];
  const warn = chosen && (defects || []).some(row => row.assetId === chosen.id);
  const options = (assets || []).map(asset => `<option value="${esc(asset.id)}"${chosen && asset.id === chosen.id ? " selected" : ""}>${esc(asset.name || "Machine")}${asset.rego ? ` · ${esc(asset.rego)}` : ""}</option>`).join("");
  const rows = (items || []).map(item => `<fieldset class="ps-row"><legend>${esc(item.label)}</legend>
    <div class="ps-choices">
      <label class="ps-pass"><input type="radio" name="result-${esc(item.id)}" value="pass" required><span>Pass</span></label>
      <label class="ps-fail"><input type="radio" name="result-${esc(item.id)}" value="fail"><span>Fail</span></label>
      <label class="ps-na"><input type="radio" name="result-${esc(item.id)}" value="na"><span>N/A</span></label>
    </div>
    <label class="ps-note">Comment<input name="comment-${esc(item.id)}" maxlength="500" autocomplete="off"></label>
  </fieldset>`).join("");
  return `<form id="prestartform" class="comp-form">
    <p class="comp-help">Check the machine before you use it. Your name and the time are saved with the checklist. Photos are not stored in the app.</p>
    ${warn ? `<p class="swpill sw-exp">Defect — check before use</p>` : ""}
    <label>Machine<select name="assetId">${options}</select></label>
    <label>Hours or km<input name="reading" inputmode="numeric" autocomplete="off"></label>
    <label>Unit<select name="readingUnit"><option value="">Not recorded</option><option value="hours">Hours</option><option value="km">Km</option></select></label>
    ${rows}
    <label>Your name<input name="signerName" required maxlength="80" value="${esc(signerName || "")}" autocomplete="name"></label>
    <button class="sm-btn primary" type="submit">Submit prestart</button>
  </form>`;
}

export function templateFormHtml(type, items) {
  const on = new Set((items || []).map(item => item.id));
  const labels = Object.fromEntries((items || []).map(item => [item.id, item.label]));
  const rows = PRESTART_ITEMS.map(([id, fallback]) => `<label class="comp-check"><input type="checkbox" name="on-${esc(id)}" ${on.has(id) ? "checked" : ""}><span>${esc(fallback)}</span></label>
    <label>Label<input name="label-${esc(id)}" maxlength="60" value="${esc(labels[id] || fallback)}"></label>`).join("");
  return `<form id="compform" class="comp-form" data-kind="template" data-comp-id="${esc(type)}">
    <h2>Checklist · ${esc(type)}</h2>
    <p class="comp-help">These checks are used the next time someone starts this kind of machine.</p>
    ${rows}
    <div class="comp-actions"><button class="sm-btn primary" type="submit">Save checklist</button><button class="sm-btn" type="button" data-comp-cancel>Cancel</button></div>
  </form>`;
}

export function prestartAdminHtml({ assets, prestarts, jobs, today, canResolve }) {
  const defects = openDefects(prestarts);
  const missing = missingToday({ assets, prestarts, jobs, today });
  const defectCards = defects.map(row => {
    const fails = (row.items || []).filter(item => item.result === "fail").map(item => `${itemLabel(item.id, [])}${item.comment ? ` · ${item.comment}` : ""}`);
    return `<article class="comp-card" data-prestart="${esc(row.id)}">
      <div class="comp-top"><div><b>${esc(row.assetName || "Machine")}</b><div class="sub">${esc(formatAu(row.day))} · ${esc(row.signerName || "")}</div></div><span class="swpill sw-exp">Defect — check before use</span></div>
      <p class="sub">${esc(fails.join(" · "))}</p>
      ${canResolve ? `<div class="comp-actions"><button type="button" class="sm-btn" data-ps-resolve="${esc(row.id)}">Mark resolved</button></div>` : ""}
    </article>`;
  }).join("");
  const history = [...(prestarts || [])].sort((a, b) => String(b.day).localeCompare(String(a.day)) || String(b.assetName || "").localeCompare(String(a.assetName || "")));
  const days = [];
  for (const row of history) {
    const last = days[days.length - 1];
    if (!last || last.day !== row.day) days.push({ day: row.day, rows: [row] });
    else last.rows.push(row);
  }
  const historyHtml = days.map(group => `<h3 class="swh">${esc(formatAu(group.day))}</h3>${group.rows.map(row => {
    const flag = isOpenDefect(row) ? `<span class="swpill sw-exp">Defect — check before use</span>` : hasFail(row) ? `<span class="swpill sw-ok">Resolved</span>` : `<span class="swpill sw-ok">Pass</span>`;
    return `<article class="comp-card"><div class="comp-top"><div><b>${esc(row.assetName || "Machine")}</b><div class="sub">${esc(row.signerName || "")}${row.reading ? ` · ${Number(row.reading).toLocaleString("en-AU")} ${row.readingUnit === "km" ? "km" : "hours"}` : ""}</div></div>${flag}</div></article>`;
  }).join("")}`).join("");
  const machineLine = missing.machines.length ? missing.machines.map(asset => esc(asset.name || "Machine")).join(", ") : "Every machine has a prestart today.";
  const peopleLine = missing.missingPeople.length ? missing.missingPeople.map(esc).join(", ") : "Everyone assigned today has done a prestart.";
  return `<div class="comp-list">
    <section class="comp-card"><b>No prestart today</b><p class="sub">${machineLine}</p><b>Assigned today, no prestart</b><p class="sub">${peopleLine}</p></section>
    ${defectCards}
    ${historyHtml || `<p class="muted pad">No prestarts yet.</p>`}
  </div>`;
}
