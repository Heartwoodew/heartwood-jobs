// Company checklists and required photo steps. Defaults come from the industry.
// A custom row is kept when the company changes industry. Untouched defaults for a
// trade that was removed are dropped. Jobs already saved are not touched here.
import { INDUSTRY_PRESETS, RECURRENCE_HINTS, SERVICE_TRADES } from "./packs/service-trades.js";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function cleanLabel(value) {
  const raw = String(value ?? "");
  if (/[\n\r\t<>]/.test(raw)) return "";
  const s = raw.trim().replace(/ +/g, " ");
  if (!s || s.length > 120) return "";
  return s;
}

function cleanId(value, fallback) {
  const id = String(value || fallback || "").toLowerCase().replace(/[^a-z0-9:_-]/g, "").slice(0, 40);
  return id || "";
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function rowFrom(raw, kind) {
  if (!raw || typeof raw !== "object") return null;
  const label = cleanLabel(raw.label);
  const id = cleanId(raw.id, "");
  if (!label || !id) return null;
  const jobTypes = asList(raw.jobTypes).map(x => cleanId(x, "")).filter(Boolean).slice(0, 12);
  const row = {
    id,
    label,
    jobTypes: jobTypes.length ? jobTypes : ["*"],
    custom: raw.custom === true,
    trade: cleanId(raw.trade, "") || "",
  };
  if (kind === "photo") row.required = raw.required !== false;
  return row;
}

export function sanitizePresetList(list, kind) {
  const out = [];
  const seen = new Set();
  for (const raw of asList(list).slice(0, 60)) {
    const row = rowFrom(raw, kind);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function stamped(rows, trade, kind) {
  return rows.map(raw => rowFrom({ ...raw, trade, custom: false }, kind)).filter(Boolean);
}

export function defaultPresets(tradeIds) {
  const checklists = [];
  const photoSteps = [];
  for (const id of asList(tradeIds)) {
    const src = INDUSTRY_PRESETS[id];
    if (!src) continue;
    checklists.push(...stamped(src.checklists, id, "check"));
    photoSteps.push(...stamped(src.photoSteps, id, "photo"));
  }
  return { checklists, photoSteps };
}

function mergeRows(defaults, saved) {
  const byId = new Map(defaults.map(row => [row.id, row]));
  const out = [];
  const seen = new Set();
  for (const row of saved) {
    const fresh = byId.get(row.id);
    if (row.custom || (fresh && fresh.label !== row.label)) {
      out.push({ ...row, custom: true });
      seen.add(row.id);
      continue;
    }
    if (fresh) {
      out.push(fresh);
      seen.add(row.id);
    }
  }
  for (const row of defaults) if (!seen.has(row.id)) out.push(row);
  return out.slice(0, 60);
}

/** Saved custom rows stay. Defaults follow the trades that are on now. */
export function mergeIndustryPresets(stored, tradeIds) {
  const defaults = defaultPresets(tradeIds);
  return {
    checklists: mergeRows(defaults.checklists, sanitizePresetList(stored && stored.checklists, "check")),
    photoSteps: mergeRows(defaults.photoSteps, sanitizePresetList(stored && stored.photoSteps, "photo")),
  };
}

export function stepsForJob(setup, typeId) {
  const type = String(typeId || "");
  const match = row => !type || asList(row.jobTypes).includes("*") || asList(row.jobTypes).includes(type) || asList(row.jobTypes).length === 0;
  return {
    checklists: asList(setup && setup.checklists).filter(match),
    photoSteps: asList(setup && setup.photoSteps).filter(match),
  };
}

export function recurrenceHint(typeId) {
  return RECURRENCE_HINTS[String(typeId || "")] || null;
}

export function jobStepsHtml(job, setup) {
  const steps = stepsForJob(setup, job && job.type);
  if (!steps.checklists.length && !steps.photoSteps.length) return "";
  const checks = steps.checklists.map(row => `<li>${esc(row.label)}</li>`).join("");
  const photos = steps.photoSteps.map(row => `<li>${esc(row.label)}${row.required === false ? "" : " <span class=\"sub\">Required</span>"}</li>`).join("");
  return `<section class="card job-steps"><h3>Checklist and photos</h3>
    ${checks ? `<p class="sub">Checklist</p><ul class="job-check">${checks}</ul>` : ""}
    ${photos ? `<p class="sub">Photos</p><ul class="job-photos-steps">${photos}</ul>` : ""}
  </section>`;
}

export function presetEditorHtml(setup, { canEdit = false } = {}) {
  const checks = sanitizePresetList(setup && setup.checklists, "check");
  const photos = sanitizePresetList(setup && setup.photoSteps, "photo");
  const line = (row, kind) => `<li data-preset-row="${esc(row.id)}" data-preset-kind="${kind}">
    ${canEdit
      ? `<input data-preset-label value="${esc(row.label)}" maxlength="120" aria-label="Preset label">
         <button type="button" class="sm-btn" data-preset-remove="${esc(row.id)}">Remove</button>`
      : `<b>${esc(row.label)}</b>`}
    ${row.custom ? `<span class="sub">Added by you</span>` : `<span class="sub">${esc(row.trade || "")}</span>`}
  </li>`;
  const form = canEdit ? `<form id="presetadd" class="jf">
    <label>Add a checklist item or photo step<input name="label" maxlength="120" required placeholder="e.g. After photo"></label>
    <label>Kind<select name="kind"><option value="check">Checklist</option><option value="photo">Required photo</option></select></label>
    <button type="submit" class="sm-btn">Add</button>
    <p id="preseterr" class="err"></p>
  </form>` : `<p class="sub">An admin or a manager can edit these. Changing industry keeps anything you added.</p>`;
  const names = SERVICE_TRADES.map(row => row.label).join(", ");
  return `<section class="card preset-editor" id="preseteditor">
    <h2>Checklists and photos</h2>
    <p class="sub">Each industry starts with a checklist and the photos to take. Earthworks site cleans start with before and after photos. ${esc(names)} are included. Your company's name stays on quotes and certificates.</p>
    <h3>Checklist</h3>
    <ul class="preset-list">${checks.map(row => line(row, "check")).join("") || `<li class="muted">None yet.</li>`}</ul>
    <h3>Photos</h3>
    <ul class="preset-list">${photos.map(row => line(row, "photo")).join("") || `<li class="muted">None yet.</li>`}</ul>
    ${form}
  </section>`;
}

export function addPresetRow(setup, { label, kind } = {}) {
  const checklists = sanitizePresetList(setup && setup.checklists, "check");
  const photoSteps = sanitizePresetList(setup && setup.photoSteps, "photo");
  const clean = cleanLabel(label);
  if (!clean) return { ok: false, reason: "name", checklists, photoSteps };
  const id = "custom-" + clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  const row = { id: id || "custom-row", label: clean, jobTypes: ["*"], custom: true, trade: "" };
  if (kind === "photo") photoSteps.push({ ...row, id: row.id + "-photo", required: true });
  else checklists.push(row);
  return { ok: true, checklists: checklists.slice(0, 60), photoSteps: photoSteps.slice(0, 60) };
}

export function removePresetRow(setup, id) {
  const checklists = sanitizePresetList(setup && setup.checklists, "check").filter(row => row.id !== id);
  const photoSteps = sanitizePresetList(setup && setup.photoSteps, "photo").filter(row => row.id !== id);
  return { checklists, photoSteps };
}

export function readPresetEditor(root, setup) {
  const checklists = sanitizePresetList(setup && setup.checklists, "check").map(row => ({ ...row }));
  const photoSteps = sanitizePresetList(setup && setup.photoSteps, "photo").map(row => ({ ...row }));
  if (!root || !root.querySelectorAll) return { checklists, photoSteps };
  root.querySelectorAll("[data-preset-row]").forEach(li => {
    const input = li.querySelector("[data-preset-label]");
    if (!input) return;
    const label = cleanLabel(input.value);
    const kind = li.getAttribute("data-preset-kind");
    const list = kind === "photo" ? photoSteps : checklists;
    const row = list.find(item => item.id === li.getAttribute("data-preset-row"));
    if (!row || !label) return;
    if (row.label !== label) row.custom = true;
    row.label = label;
  });
  return { checklists, photoSteps };
}
